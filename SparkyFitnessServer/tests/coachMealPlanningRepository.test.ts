import type { PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../db/poolManager.js';
import {
  CoachMealPlanningConflictError,
  applyPlanEntryAction,
  archivePantryItem,
  confirmPurchases,
  createManualShoppingItem,
  createPantryItem,
  generatePlan,
  getOpenShoppingList,
  getPlanGenerationResult,
  listPantryItems,
  replacePlanEntry,
  updatePantryItem,
  updateShoppingItem,
  type PantryItemInput,
  type PlanEntryInput,
  type ShoppingItemInput,
} from '../models/coachMealPlanningRepository.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

vi.mock('../db/poolManager.js', () => ({ getClient: vi.fn() }));
vi.mock('../utils/timezoneLoader.js', () => ({ loadUserTimezone: vi.fn() }));

type DbRow = Record<string, unknown>;
type QueryHandler = (sql: string, parameters: readonly unknown[]) => DbRow[];

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function mockClient(handler: QueryHandler): {
  client: PoolClient;
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(
    async (sql: string, parameters: readonly unknown[] = []) => ({
      rows: handler(compactSql(sql), parameters),
    })
  );
  const release = vi.fn();
  return {
    client: { query, release } as unknown as PoolClient,
    query,
    release,
  };
}

function isTransactionControl(sql: string): boolean {
  return (
    sql === 'BEGIN' ||
    sql === 'COMMIT' ||
    sql === 'ROLLBACK' ||
    sql.includes('pg_advisory_xact_lock')
  );
}

const pantryInput: PantryItemInput = {
  ingredientKey: 'reis',
  name: 'Reis',
  quantity: 10,
  minQuantity: 2,
  unit: 'g',
  category: 'pantry',
  preferredRetailer: 'coop',
  preferredProductId: '6554390',
  expiresOn: null,
};

const shoppingInput: ShoppingItemInput = {
  ingredientKey: 'reis',
  name: 'Reis',
  requiredQuantity: 600,
  unit: 'g',
  category: 'pantry',
  notes: null,
  product: null,
};

const planEntry: PlanEntryInput = {
  planDate: '2026-09-02',
  mealSlot: 'dinner',
  recipeKey: 'chicken-rice-bowl',
  recipeName: 'Hähnchen-Reis-Gemüse-Bowl',
  servings: 1,
  estimatedCalories: 680,
  estimatedProteinG: 53,
  estimatedCarbsG: 76,
  estimatedFatG: 17,
  preparation: 'Reis kochen und Hähnchen anbraten.',
  safetyStatus: 'validated',
  ingredients: [
    {
      ingredientKey: 'reis',
      name: 'Reis',
      quantity: 80,
      unit: 'g',
      category: 'pantry',
      shoppingRequired: true,
    },
  ],
};

const openList = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Einkauf für deinen Essensplan',
  status: 'open',
  coverage_start: null,
  coverage_end: null,
  completed_at: null,
  created_at: new Date('2026-09-01T10:00:00.000Z'),
  updated_at: new Date('2026-09-01T10:00:00.000Z'),
};

describe('coachMealPlanningRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T23:30:00.000Z'));
    vi.mocked(loadUserTimezone).mockResolvedValue('Europe/Berlin');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the owner-local day as the floor for reservations, deficits, and shopping coverage', async () => {
    const { client, query } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (sql.includes('planned_need AS')) return [];
      if (sql.startsWith('SELECT id, title, status')) return [openList];
      if (sql.startsWith('SELECT ingredient_key, unit')) return [];
      if (sql.startsWith('SELECT MIN(plan_date)')) {
        return [{ start: null, end: null }];
      }
      if (sql.startsWith('UPDATE coach_shopping_lists')) return [openList];
      if (sql.startsWith('SELECT id, ingredient_key, unit')) return [];
      if (sql.startsWith('SELECT COUNT(*)::int')) return [{ count: 0 }];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(getOpenShoppingList('user-1')).resolves.toBeNull();

    const deficitQuery = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).includes('planned_need AS')
    );
    expect(deficitQuery?.[1]).toEqual(['user-1', '2026-09-02']);
    expect(compactSql(String(deficitQuery?.[0]))).toContain(
      "entry.status = 'planned' AND entry.plan_date >= $2::date"
    );
    expect(compactSql(String(deficitQuery?.[0]))).toContain(
      'stock.expires_on >= entry.plan_date'
    );
    expect(compactSql(String(deficitQuery?.[0]))).toContain(
      'stock.expires_on < entry.plan_date'
    );

    const coverageQuery = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).startsWith('SELECT MIN(plan_date)')
    );
    expect(coverageQuery?.[1]).toEqual(['user-1', '2026-09-02']);
    expect(compactSql(String(coverageQuery?.[0]))).toContain(
      'plan_date >= $2::date'
    );
    expect(loadUserTimezone).toHaveBeenCalledWith('user-1');
  });

  it('projects only current and future reservations against stock valid on each meal date', async () => {
    const { client, query } = mockClient(() => []);
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(listPantryItems('user-1')).resolves.toEqual([]);

    const projectionQuery = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).startsWith('WITH reservation AS')
    );
    expect(projectionQuery?.[1]).toEqual(['user-1', '2026-09-02']);
    const sql = compactSql(String(projectionQuery?.[0]));
    expect(sql).toContain('entry.plan_date >= $2::date');
    expect(sql).toContain('pantry.expires_on >= entry.plan_date');
    expect(sql).toContain('pantry.expires_on < entry.plan_date');
    expect(sql).toContain('pantry.expires_on < $2::date THEN 0');
    expect(sql).toContain('after_expiry_quantity');
  });

  it('ignores past and after-expiry reservations when deciding whether pantry can be archived', async () => {
    const pantryItemId = '22222222-2222-4222-8222-222222222222';
    const { client, query } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (
        sql.startsWith('SELECT quantity::float8 AS quantity') &&
        !sql.includes('SUM(ingredient.quantity)')
      ) {
        return [{ quantity: 0 }];
      }
      if (sql.startsWith('SELECT COALESCE(SUM(ingredient.quantity)')) {
        return [{ reserved: 0 }];
      }
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(archivePantryItem('user-1', pantryItemId)).resolves.toBe(true);

    const reservationQuery = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).startsWith(
        'SELECT COALESCE(SUM(ingredient.quantity)'
      )
    );
    expect(reservationQuery?.[1]).toEqual([
      pantryItemId,
      'user-1',
      '2026-09-02',
    ]);
    const sql = compactSql(String(reservationQuery?.[0]));
    expect(sql).toContain('entry.plan_date >= $3::date');
    expect(sql).toContain('pantry.expires_on >= entry.plan_date');
  });

  it('sets pantry quantity absolutely and makes a repeated create operation a no-op', async () => {
    const pantryItemId = '22222222-2222-4222-8222-222222222222';
    const operationId = 'manual-create:operation-1';
    const ledgerNotes = 'Initial absolute stock for reis set to 10 g.';
    let eventExists = false;
    const { client, query, release } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (sql.includes('FROM coach_pantry_events')) {
        return eventExists
          ? [{ pantry_item_id: pantryItemId, notes: ledgerNotes }]
          : [];
      }
      if (
        sql.includes('FROM coach_pantry_items') &&
        sql.includes('ingredient_key = $2')
      ) {
        return [{ id: pantryItemId, quantity: 5 }];
      }
      if (sql.startsWith('INSERT INTO coach_pantry_events')) {
        eventExists = true;
        return [];
      }
      if (sql.includes('planned_need AS')) return [];
      if (sql.includes('FROM coach_shopping_lists')) return [];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(
      createPantryItem('user-1', pantryInput, operationId)
    ).resolves.toBe(pantryItemId);
    await expect(
      createPantryItem('user-1', pantryInput, operationId)
    ).resolves.toBe(pantryItemId);

    const pantryUpdates = query.mock.calls.filter(([sql]) =>
      compactSql(String(sql)).startsWith('UPDATE coach_pantry_items')
    );
    const eventInserts = query.mock.calls.filter(([sql]) =>
      compactSql(String(sql)).startsWith('INSERT INTO coach_pantry_events')
    );
    expect(pantryUpdates).toHaveLength(1);
    expect(compactSql(String(pantryUpdates[0][0]))).toContain('quantity = $4');
    expect(compactSql(String(pantryUpdates[0][0]))).not.toContain(
      'quantity = quantity +'
    );
    expect(eventInserts).toHaveLength(1);
    expect(compactSql(String(eventInserts[0][0]))).toContain(
      'event_type, delta_quantity, unit, source, idempotency_key, notes'
    );
    expect(eventInserts[0][1]).toEqual([
      'user-1',
      pantryItemId,
      5,
      'g',
      operationId,
      ledgerNotes,
    ]);
    expect(getClient).toHaveBeenCalledTimes(2);
    expect(getClient).toHaveBeenNthCalledWith(1, 'user-1', 'user-1');
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('preserves undefined pantry optionals while explicit null still clears them', async () => {
    const pantryItemId = '22222222-2222-4222-8222-222222222222';
    const { client, query } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (
        sql.startsWith('SELECT quantity::float8 AS quantity, unit') &&
        sql.includes('FROM coach_pantry_items')
      ) {
        return [{ quantity: 500, unit: 'g' }];
      }
      if (sql.includes('planned_need AS')) return [];
      if (sql.includes('FROM coach_shopping_lists')) return [];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(
      updatePantryItem(
        'user-1',
        pantryItemId,
        {
          name: 'Basmatireis',
          expiresOn: undefined,
          preferredRetailer: undefined,
          preferredProductId: undefined,
        },
        'manual-update:preserve-optionals'
      )
    ).resolves.toBe(true);
    await expect(
      updatePantryItem(
        'user-1',
        pantryItemId,
        {
          expiresOn: null,
          preferredRetailer: null,
          preferredProductId: null,
        },
        'manual-update:clear-optionals'
      )
    ).resolves.toBe(true);

    const pantryUpdates = query.mock.calls.filter(([sql]) =>
      compactSql(String(sql)).startsWith('UPDATE coach_pantry_items SET')
    );
    expect(pantryUpdates).toHaveLength(2);
    expect(pantryUpdates[0][1]?.slice(6, 12)).toEqual([
      false,
      null,
      false,
      null,
      false,
      null,
    ]);
    expect(pantryUpdates[1][1]?.slice(6, 12)).toEqual([
      true,
      null,
      true,
      null,
      true,
      null,
    ]);
  });

  it('sets a manual shopping target absolutely when the same item is created again', async () => {
    const itemId = '33333333-3333-4333-8333-333333333333';
    let itemExists = false;
    const { client, query } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (sql.includes('FROM coach_shopping_lists')) return [openList];
      if (
        sql.startsWith('SELECT id, purchased_quantity::float8') &&
        sql.includes('FROM coach_shopping_list_items')
      ) {
        return itemExists ? [{ id: itemId, purchased_quantity: 0 }] : [];
      }
      if (sql.startsWith('INSERT INTO coach_shopping_list_items')) {
        itemExists = true;
        return [{ id: itemId }];
      }
      if (sql.includes('planned_need AS')) return [];
      if (sql.startsWith('SELECT MIN(plan_date)')) {
        return [{ start: null, end: null }];
      }
      if (sql.startsWith('UPDATE coach_shopping_lists')) return [openList];
      if (sql.startsWith('SELECT id, ingredient_key, unit')) return [];
      if (sql.startsWith('SELECT COUNT(*)::int')) return [{ count: 1 }];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(
      createManualShoppingItem('user-1', shoppingInput)
    ).resolves.toBe(itemId);
    await expect(
      createManualShoppingItem('user-1', shoppingInput)
    ).resolves.toBe(itemId);

    const itemInserts = query.mock.calls.filter(([sql]) =>
      compactSql(String(sql)).startsWith(
        'INSERT INTO coach_shopping_list_items'
      )
    );
    const absoluteUpdates = query.mock.calls.filter(([sql]) =>
      compactSql(String(sql)).includes('SET name = $3, required_quantity = $4')
    );
    expect(itemInserts).toHaveLength(1);
    expect(absoluteUpdates).toHaveLength(1);
    expect(absoluteUpdates[0][1]?.[3]).toBe(600);
    expect(compactSql(String(absoluteUpdates[0][0]))).not.toContain(
      '+ EXCLUDED.required_quantity'
    );
    expect(compactSql(String(itemInserts[0][0]))).toContain('shopping_list_id');
    expect(compactSql(String(itemInserts[0][0]))).toContain(
      'selected_product_retailer_id'
    );
  });

  it('persists editable shopping-item name and category fields', async () => {
    const itemId = '33333333-3333-4333-8333-333333333333';
    const { client, query } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (
        sql.startsWith('SELECT purchased_quantity::float8') &&
        sql.includes('FROM coach_shopping_list_items item')
      ) {
        return [{ purchased_quantity: 0 }];
      }
      if (sql.includes('planned_need AS')) return [];
      if (sql.includes('FROM coach_shopping_lists')) return [openList];
      if (sql.startsWith('SELECT MIN(plan_date)')) {
        return [{ start: null, end: null }];
      }
      if (sql.startsWith('UPDATE coach_shopping_lists')) return [openList];
      if (sql.startsWith('SELECT id, ingredient_key, unit')) return [];
      if (sql.startsWith('SELECT COUNT(*)::int')) return [{ count: 1 }];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(
      updateShoppingItem('user-1', itemId, {
        name: 'Basmatireis',
        category: 'pantry',
      })
    ).resolves.toBe(true);

    const itemUpdate = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).includes(
        'SET name = COALESCE($3, name), category = COALESCE($4, category)'
      )
    );
    expect(itemUpdate).toBeDefined();
    expect(itemUpdate?.[1]?.slice(0, 4)).toEqual([
      itemId,
      'user-1',
      'Basmatireis',
      'pantry',
    ]);
  });

  it('keeps user-edited item metadata while automatic quantities stay unlocked', async () => {
    const itemId = '33333333-3333-4333-8333-333333333333';
    const sourceEntryId = '55555555-5555-4555-8555-555555555555';
    const { client, query } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (
        sql.startsWith('SELECT purchased_quantity::float8') &&
        sql.includes('FROM coach_shopping_list_items item')
      ) {
        return [{ purchased_quantity: 100 }];
      }
      if (sql.includes('planned_need AS')) {
        return [
          {
            ingredient_key: 'reis',
            name: 'Reis aus dem Rezept',
            category: 'other',
            unit: 'g',
            deficit: 400,
            source_meal_entry_ids: [sourceEntryId],
          },
        ];
      }
      if (sql.includes('FROM coach_shopping_lists')) return [openList];
      if (sql.startsWith('SELECT MIN(plan_date)')) {
        return [{ start: '2026-09-02', end: '2026-09-02' }];
      }
      if (sql.startsWith('UPDATE coach_shopping_lists')) return [openList];
      if (sql.startsWith('SELECT id, quantity_locked, status')) {
        return [
          {
            id: itemId,
            quantity_locked: false,
            status: 'needed',
            is_manual: false,
            source_meal_entry_ids: [sourceEntryId],
          },
        ];
      }
      if (sql.startsWith('SELECT id, ingredient_key, unit')) {
        return [
          {
            id: itemId,
            ingredient_key: 'reis',
            unit: 'g',
            purchased_quantity: 100,
          },
        ];
      }
      if (sql.startsWith('SELECT COUNT(*)::int')) return [{ count: 1 }];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(
      updateShoppingItem('user-1', itemId, {
        name: 'Mein Basmatireis',
        category: 'pantry',
      })
    ).resolves.toBe(true);

    const syncUpdate = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).includes('SET source_entry_ids = $3::uuid[]')
    );
    expect(syncUpdate).toBeDefined();
    expect(compactSql(String(syncUpdate?.[0]))).not.toContain('SET name =');
    expect(compactSql(String(syncUpdate?.[0]))).not.toContain('category =');
    expect(compactSql(String(syncUpdate?.[0]))).toContain(
      'WHEN quantity_locked THEN required_quantity'
    );
    expect(syncUpdate?.[1]).toEqual([
      itemId,
      'user-1',
      [sourceEntryId],
      400,
      false,
    ]);
  });

  it('suppresses an unchanged skipped auto deficit across completed lists', async () => {
    const sourceEntryId = '55555555-5555-4555-8555-555555555555';
    const { client, query } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (sql.includes('planned_need AS')) {
        return [
          {
            ingredient_key: 'reis',
            name: 'Reis',
            category: 'pantry',
            unit: 'g',
            deficit: 400,
            source_meal_entry_ids: [sourceEntryId],
          },
        ];
      }
      if (sql.includes('FROM coach_shopping_lists')) return [];
      if (sql.startsWith('SELECT ingredient_key, unit')) {
        return [
          {
            ingredient_key: 'reis',
            unit: 'g',
            source_meal_entry_ids: [sourceEntryId],
          },
        ];
      }
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(getOpenShoppingList('user-1')).resolves.toBeNull();
    expect(
      query.mock.calls.some(([sql]) =>
        compactSql(String(sql)).startsWith('INSERT INTO coach_shopping_lists')
      )
    ).toBe(false);
  });

  it('re-evaluates a skipped auto deficit when its source plan entries change', async () => {
    const oldSourceEntryId = '55555555-5555-4555-8555-555555555555';
    const newSourceEntryId = '77777777-7777-4777-8777-777777777777';
    let createdList = false;
    const { client, query } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (sql.includes('planned_need AS')) {
        return [
          {
            ingredient_key: 'reis',
            name: 'Reis',
            category: 'pantry',
            unit: 'g',
            deficit: 400,
            source_meal_entry_ids: [newSourceEntryId],
          },
        ];
      }
      if (sql.startsWith('SELECT id, title, status')) {
        return createdList ? [openList] : [];
      }
      if (sql.startsWith('SELECT ingredient_key, unit')) {
        return [
          {
            ingredient_key: 'reis',
            unit: 'g',
            source_meal_entry_ids: [oldSourceEntryId],
          },
        ];
      }
      if (sql.startsWith('SELECT MIN(plan_date)')) {
        return [{ start: '2026-09-02', end: '2026-09-02' }];
      }
      if (sql.startsWith('INSERT INTO coach_shopping_lists')) {
        createdList = true;
        return [openList];
      }
      if (sql.startsWith('SELECT id, quantity_locked, status')) return [];
      if (sql.startsWith('SELECT id, ingredient_key, unit')) return [];
      if (sql.startsWith('SELECT COUNT(*)::int')) return [{ count: 1 }];
      if (sql.startsWith('SELECT id, shopping_list_id AS list_id')) return [];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(getOpenShoppingList('user-1')).resolves.toEqual({
      list: openList,
      items: [],
    });
    const itemInsert = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).startsWith(
        'INSERT INTO coach_shopping_list_items'
      )
    );
    expect(itemInsert).toBeDefined();
    expect(itemInsert?.[1]?.[7]).toEqual([newSourceEntryId]);
  });

  it('confirms a partial purchase atomically and reuses its ledger event on retry', async () => {
    const itemId = '33333333-3333-4333-8333-333333333333';
    const pantryItemId = '22222222-2222-4222-8222-222222222222';
    const priorEvents: Array<{
      idempotency_key: string;
      notes: string;
    }> = [];
    const { client, query } = mockClient((sql, parameters) => {
      if (isTransactionControl(sql)) return [];
      if (sql.startsWith('SELECT idempotency_key, notes')) {
        const operationPrefix = String(parameters[1]);
        return priorEvents.filter((event) =>
          event.idempotency_key.startsWith(operationPrefix)
        );
      }
      if (sql.includes('FROM coach_shopping_list_items item')) {
        return [
          {
            id: itemId,
            list_id: openList.id,
            ingredient_key: 'reis',
            name: 'Reis',
            category: 'pantry',
            needed_quantity: 1000,
            purchased_quantity: 0,
            unit: 'g',
            status: 'needed',
            is_manual: true,
            quantity_locked: true,
            source_meal_entry_ids: [],
            selected_retailer: null,
            selected_product_id: null,
            selected_product_gtin: null,
            product_name: null,
            product_url: null,
            package_quantity: null,
            package_unit: null,
            product_verified_at: null,
            product_note: null,
            notes: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ];
      }
      if (sql.startsWith('INSERT INTO coach_pantry_items')) {
        return [{ id: pantryItemId }];
      }
      if (
        sql.startsWith('SELECT quantity::float8 AS quantity') &&
        sql.includes('AS is_expired')
      ) {
        return [{ quantity: 0, is_expired: true }];
      }
      if (sql.startsWith('INSERT INTO coach_pantry_events')) {
        priorEvents.push({
          idempotency_key: String(parameters[5]),
          notes: String(parameters[6]),
        });
        return [];
      }
      if (sql.includes('planned_need AS')) return [];
      if (sql.includes('FROM coach_shopping_lists')) return [openList];
      if (sql.startsWith('SELECT MIN(plan_date)')) {
        return [{ start: null, end: null }];
      }
      if (sql.startsWith('UPDATE coach_shopping_lists')) return [openList];
      if (sql.startsWith('SELECT id, ingredient_key, unit')) return [];
      if (sql.startsWith('SELECT COUNT(*)::int')) return [{ count: 1 }];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await confirmPurchases('user-1', 'purchase-operation-1', [
      { itemId, quantity: 300 },
    ]);
    await confirmPurchases('user-1', 'purchase-operation-2', [
      { itemId, quantity: 300 },
    ]);
    await confirmPurchases('user-1', 'purchase-operation-1', [
      { itemId, quantity: 300 },
    ]);

    const pantryIncrements = query.mock.calls.filter(([sql]) =>
      compactSql(String(sql)).includes('SET quantity = CASE')
    );
    const eventInserts = query.mock.calls.filter(([sql]) =>
      compactSql(String(sql)).startsWith('INSERT INTO coach_pantry_events')
    );
    const purchaseUpdates = query.mock.calls.filter(([sql]) =>
      compactSql(String(sql)).includes(
        'SET purchased_quantity = purchased_quantity + $3'
      )
    );
    expect(pantryIncrements).toHaveLength(2);
    expect(pantryIncrements[0][1]?.[5]).toBe(true);
    expect(compactSql(String(pantryIncrements[0][0]))).toContain(
      'WHEN $6 THEN $3 ELSE quantity + $3'
    );
    expect(eventInserts).toHaveLength(2);
    expect(purchaseUpdates).toHaveLength(2);
    expect(compactSql(String(eventInserts[0][0]))).toContain(
      'delta_quantity, unit, source, source_id, idempotency_key, notes'
    );
    expect(eventInserts[0][1]?.[6]).toMatch(
      /^purchase-batch-sha256:[a-f0-9]{64}$/
    );
    expect(compactSql(String(purchaseUpdates[0][0]))).toContain(
      'purchased_quantity + $3 >= required_quantity'
    );
    expect(compactSql(String(purchaseUpdates[0][0]))).not.toContain(
      'SET purchased_quantity = purchased_quantity + $3, required_quantity ='
    );

    await expect(
      confirmPurchases('user-1', 'purchase-operation-1', [
        { itemId, quantity: 301 },
      ])
    ).rejects.toBeInstanceOf(CoachMealPlanningConflictError);
    expect(
      query.mock.calls.filter(([sql]) => String(sql) === 'ROLLBACK')
    ).toHaveLength(1);
  });

  it('rejects a new purchase operation for an already fully purchased item', async () => {
    const itemId = '33333333-3333-4333-8333-333333333333';
    const { client, query } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (sql.startsWith('SELECT idempotency_key, notes')) return [];
      if (sql.includes('FROM coach_shopping_list_items item')) {
        return [
          {
            id: itemId,
            list_id: openList.id,
            ingredient_key: 'reis',
            name: 'Reis',
            category: 'pantry',
            needed_quantity: 1000,
            purchased_quantity: 1000,
            unit: 'g',
            status: 'purchased',
            is_manual: true,
            quantity_locked: true,
            source_meal_entry_ids: [],
            selected_retailer: null,
            selected_product_id: null,
            selected_product_gtin: null,
            product_name: null,
            product_url: null,
            package_quantity: null,
            package_unit: null,
            product_verified_at: null,
            product_note: null,
            notes: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ];
      }
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(
      confirmPurchases('user-1', 'new-purchase-operation', [
        { itemId, quantity: 100 },
      ])
    ).rejects.toBeInstanceOf(CoachMealPlanningConflictError);

    expect(
      query.mock.calls.some(([sql]) =>
        compactSql(String(sql)).startsWith('INSERT INTO coach_pantry_items')
      )
    ).toBe(false);
  });

  it('spoils expired stock before a fresh purchase, closes the list, and exposes only fresh stock', async () => {
    const itemId = '33333333-3333-4333-8333-333333333333';
    const pantryItemId = '22222222-2222-4222-8222-222222222222';
    let pantryQuantity = 250;
    let expiresOn: string | null = '2026-09-01';
    let purchasedQuantity = 0;
    let listStatus: 'open' | 'completed' = 'open';
    const ledgerEvents: Array<{
      eventType: 'purchase' | 'spoil';
      delta: number;
      idempotencyKey: string;
    }> = [];
    const { client, query } = mockClient((sql, parameters) => {
      if (isTransactionControl(sql)) return [];
      if (sql.startsWith('SELECT idempotency_key, notes')) return [];
      if (sql.includes('FROM coach_shopping_list_items item')) {
        return [
          {
            id: itemId,
            list_id: openList.id,
            ingredient_key: 'reis',
            name: 'Reis',
            category: 'pantry',
            needed_quantity: 100,
            purchased_quantity: purchasedQuantity,
            unit: 'g',
            status: 'needed',
            is_manual: false,
            quantity_locked: false,
            source_meal_entry_ids: [],
            selected_retailer: null,
            selected_product_id: null,
            selected_product_gtin: null,
            product_name: null,
            product_url: null,
            package_quantity: null,
            package_unit: null,
            product_verified_at: null,
            product_note: null,
            notes: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ];
      }
      if (sql.startsWith('INSERT INTO coach_pantry_items')) {
        return [{ id: pantryItemId }];
      }
      if (
        sql.startsWith('SELECT quantity::float8 AS quantity') &&
        sql.includes('AS is_expired')
      ) {
        return [{ quantity: pantryQuantity, is_expired: expiresOn !== null }];
      }
      if (
        sql.startsWith('INSERT INTO coach_pantry_events') &&
        sql.includes("'spoil'")
      ) {
        ledgerEvents.push({
          eventType: 'spoil',
          delta: Number(parameters[2]),
          idempotencyKey: String(parameters[5]),
        });
        return [];
      }
      if (sql.startsWith('UPDATE coach_pantry_items')) {
        const replacesExpiredStock = Boolean(parameters[5]);
        pantryQuantity = replacesExpiredStock
          ? Number(parameters[2])
          : pantryQuantity + Number(parameters[2]);
        if (replacesExpiredStock) expiresOn = null;
        return [];
      }
      if (sql.startsWith('INSERT INTO coach_pantry_events')) {
        ledgerEvents.push({
          eventType: 'purchase',
          delta: Number(parameters[2]),
          idempotencyKey: String(parameters[5]),
        });
        return [];
      }
      if (
        sql.startsWith('UPDATE coach_shopping_list_items') &&
        sql.includes('purchased_quantity = purchased_quantity + $3')
      ) {
        purchasedQuantity += Number(parameters[2]);
        return [];
      }
      if (sql.includes('planned_need AS')) return [];
      if (sql.startsWith('SELECT id, title, status')) {
        return listStatus === 'open' ? [openList] : [];
      }
      if (sql.startsWith('SELECT MIN(plan_date)')) {
        return [{ start: null, end: null }];
      }
      if (
        sql.startsWith('UPDATE coach_shopping_lists') &&
        sql.includes("SET status = 'completed'")
      ) {
        listStatus = 'completed';
        return [];
      }
      if (sql.startsWith('UPDATE coach_shopping_lists')) return [openList];
      if (sql.startsWith('SELECT id, ingredient_key, unit')) {
        return [
          {
            id: itemId,
            ingredient_key: 'reis',
            unit: 'g',
            purchased_quantity: purchasedQuantity,
          },
        ];
      }
      if (sql.startsWith('SELECT COUNT(*)::int')) return [{ count: 0 }];
      if (sql.startsWith('WITH reservation AS')) {
        return [
          {
            id: pantryItemId,
            ingredient_key: 'reis',
            name: 'Reis',
            category: 'pantry',
            quantity: pantryQuantity,
            reserved_quantity: 0,
            available_quantity: pantryQuantity,
            shortage_quantity: 0,
            unit: 'g',
            min_quantity: 0,
            expires_on: expiresOn,
            preferred_retailer: null,
            preferred_product_id: null,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ];
      }
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await confirmPurchases('user-1', 'purchase-expired-operation', [
      { itemId, quantity: 100 },
    ]);

    expect(ledgerEvents).toEqual([
      {
        eventType: 'spoil',
        delta: -250,
        idempotencyKey: `spoil:purchase-expired-operation:${itemId}`,
      },
      {
        eventType: 'purchase',
        delta: 100,
        idempotencyKey: `purchase:purchase-expired-operation:${itemId}`,
      },
    ]);
    expect(pantryQuantity).toBe(100);
    expect(expiresOn).toBeNull();
    expect(listStatus).toBe('completed');
    await expect(getOpenShoppingList('user-1')).resolves.toBeNull();
    await expect(listPantryItems('user-1')).resolves.toEqual([
      expect.objectContaining({
        id: pantryItemId,
        quantity: 100,
        available_quantity: 100,
        expires_on: null,
      }),
    ]);

    const spoilInsert = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).includes("VALUES ($1, $2, 'spoil'")
    );
    expect(spoilInsert).toBeDefined();
  });

  it('binds a purchase operation id to the complete item batch', async () => {
    const firstItemId = '33333333-3333-4333-8333-333333333333';
    const secondItemId = '88888888-8888-4888-8888-888888888888';
    const pantryItemId = '22222222-2222-4222-8222-222222222222';
    const priorEvents: Array<{
      idempotency_key: string;
      notes: string;
    }> = [];
    const { client, query } = mockClient((sql, parameters) => {
      if (isTransactionControl(sql)) return [];
      if (sql.startsWith('SELECT idempotency_key, notes')) return priorEvents;
      if (sql.includes('FROM coach_shopping_list_items item')) {
        return [
          {
            id: firstItemId,
            list_id: openList.id,
            ingredient_key: 'reis',
            name: 'Reis',
            category: 'pantry',
            needed_quantity: 1000,
            purchased_quantity: 0,
            unit: 'g',
            status: 'needed',
            is_manual: true,
            quantity_locked: true,
            source_meal_entry_ids: [],
            selected_retailer: null,
            selected_product_id: null,
            selected_product_gtin: null,
            product_name: null,
            product_url: null,
            package_quantity: null,
            package_unit: null,
            product_verified_at: null,
            product_note: null,
            notes: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ];
      }
      if (sql.startsWith('INSERT INTO coach_pantry_items')) {
        return [{ id: pantryItemId }];
      }
      if (
        sql.startsWith('SELECT quantity::float8 AS quantity') &&
        sql.includes('AS is_expired')
      ) {
        return [{ quantity: 200, is_expired: false }];
      }
      if (sql.startsWith('INSERT INTO coach_pantry_events')) {
        priorEvents.push({
          idempotency_key: String(parameters[5]),
          notes: String(parameters[6]),
        });
      }
      if (sql.includes('planned_need AS')) return [];
      if (sql.includes('FROM coach_shopping_lists')) return [openList];
      if (sql.startsWith('SELECT MIN(plan_date)')) {
        return [{ start: null, end: null }];
      }
      if (sql.startsWith('UPDATE coach_shopping_lists')) return [openList];
      if (sql.startsWith('SELECT id, ingredient_key, unit')) return [];
      if (sql.startsWith('SELECT COUNT(*)::int')) return [{ count: 1 }];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await confirmPurchases('user-1', 'purchase-operation-2', [
      { itemId: firstItemId, quantity: 300 },
    ]);

    await expect(
      confirmPurchases('user-1', 'purchase-operation-2', [
        { itemId: firstItemId, quantity: 300 },
        { itemId: secondItemId, quantity: 200 },
      ])
    ).rejects.toBeInstanceOf(CoachMealPlanningConflictError);
    await expect(
      confirmPurchases('user-1', 'purchase-operation-2', [
        { itemId: secondItemId, quantity: 200 },
      ])
    ).rejects.toBeInstanceOf(CoachMealPlanningConflictError);

    expect(
      query.mock.calls.filter(([sql]) =>
        compactSql(String(sql)).includes('SET quantity = CASE')
      )
    ).toHaveLength(1);
    const pantryUpdate = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).includes('SET quantity = CASE')
    );
    expect(pantryUpdate?.[1]?.[5]).toBe(false);
    expect(compactSql(String(pantryUpdate?.[0]))).toContain(
      'expires_on = CASE WHEN $6 THEN NULL ELSE expires_on END'
    );
  });

  it('stores warnings and recipe instructions as PostgreSQL text arrays without consuming stock', async () => {
    const planId = '44444444-4444-4444-8444-444444444444';
    const entryId = '55555555-5555-4555-8555-555555555555';
    const pantryItemId = '22222222-2222-4222-8222-222222222222';
    const { client, query } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (
        sql.startsWith('SELECT id, start_date::text AS start_date') ||
        (sql.startsWith('SELECT id FROM coach_meal_plan_entries') &&
          sql.includes("status = 'planned'"))
      ) {
        return [];
      }
      if (sql.startsWith('INSERT INTO coach_meal_plans')) {
        return [{ id: planId }];
      }
      if (sql.startsWith('INSERT INTO coach_meal_plan_entries')) {
        return [{ id: entryId }];
      }
      if (sql.startsWith('INSERT INTO coach_pantry_items')) {
        return [{ id: pantryItemId }];
      }
      if (sql.includes('planned_need AS')) return [];
      if (sql.includes('FROM coach_shopping_lists')) return [];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(
      generatePlan('user-1', {
        operationId: 'generation-operation-1',
        startDate: '2026-09-02',
        endDate: '2026-09-02',
        replaceExisting: false,
        algorithmVersion: 'pantry-plan-v1',
        warnings: ['Noch kein Frühstück verfügbar.'],
        entries: [planEntry],
      })
    ).resolves.toEqual({
      planId,
      created: true,
      entryIds: [entryId],
      warnings: ['Noch kein Frühstück verfügbar.'],
    });

    const planInsert = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).startsWith('INSERT INTO coach_meal_plans')
    );
    const entryInsert = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).startsWith('INSERT INTO coach_meal_plan_entries')
    );
    const ingredientInsert = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).startsWith(
        'INSERT INTO coach_meal_plan_ingredients'
      )
    );
    expect(planInsert).toBeDefined();
    expect(compactSql(String(planInsert?.[0]))).toContain('$6::text[]');
    expect(compactSql(String(planInsert?.[0]))).not.toContain('::jsonb');
    expect(planInsert?.[1]?.[5]).toEqual([
      expect.stringMatching(/^plan-request-sha256:[a-f0-9]{64}$/),
      'Noch kein Frühstück verfügbar.',
    ]);
    expect(compactSql(String(entryInsert?.[0]))).toContain(
      'meal_plan_id, plan_date, slot, status'
    );
    expect(compactSql(String(entryInsert?.[0]))).toContain(
      'recipe_description, recipe_instructions, prep_minutes'
    );
    expect(compactSql(String(entryInsert?.[0]))).toContain(
      'calories_kcal, protein_g, carbs_g, fat_g'
    );
    expect(entryInsert?.[1]?.[6]).toEqual([
      'Reis kochen und Hähnchen anbraten.',
    ]);
    expect(compactSql(String(ingredientInsert?.[0]))).toContain(
      'meal_plan_entry_id'
    );
    expect(
      query.mock.calls.some(([sql]) =>
        compactSql(String(sql)).includes('quantity = quantity -')
      )
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        compactSql(String(sql)).startsWith('INSERT INTO coach_pantry_events')
      )
    ).toBe(false);
  });

  it('loads the original root entries and warnings for a generation retry', async () => {
    const planId = '44444444-4444-4444-8444-444444444444';
    const firstEntryId = '55555555-5555-4555-8555-555555555555';
    const secondEntryId = '77777777-7777-4777-8777-777777777777';
    const { client, query } = mockClient((sql) => {
      if (sql.startsWith('SELECT id, start_date::text AS start_date')) {
        return [
          {
            id: planId,
            start_date: '2026-09-02',
            end_date: '2026-09-02',
            warnings: ['Gespeicherte Warnung'],
          },
        ];
      }
      if (
        sql.startsWith('SELECT id') &&
        sql.includes('replacement_for_id IS NULL')
      ) {
        return [{ id: firstEntryId }, { id: secondEntryId }];
      }
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(
      getPlanGenerationResult('user-1', 'generation-operation-1', {
        startDate: '2026-09-02',
        endDate: '2026-09-02',
        replaceExisting: false,
      })
    ).resolves.toEqual({
      planId,
      created: false,
      entryIds: [firstEntryId, secondEntryId],
      warnings: ['Gespeicherte Warnung'],
    });

    const entryLookup = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).includes('replacement_for_id IS NULL')
    );
    expect(entryLookup).toBeDefined();
  });

  it('binds a generation operation id to its canonical request without exposing the fingerprint warning', async () => {
    const planId = '44444444-4444-4444-8444-444444444444';
    let storedWarnings: string[] | null = null;
    const { client } = mockClient((sql, parameters) => {
      if (isTransactionControl(sql)) return [];
      if (sql.startsWith('SELECT id, start_date::text AS start_date')) {
        return storedWarnings
          ? [
              {
                id: planId,
                start_date: '2026-09-02',
                end_date: '2026-09-02',
                warnings: storedWarnings,
              },
            ]
          : [];
      }
      if (sql.startsWith('INSERT INTO coach_meal_plans')) {
        storedWarnings = [...(parameters[5] as string[])];
        return [{ id: planId }];
      }
      if (
        sql.startsWith('SELECT id') &&
        sql.includes('replacement_for_id IS NULL')
      ) {
        return [];
      }
      if (sql.includes('planned_need AS')) return [];
      if (sql.startsWith('SELECT id, title, status')) return [];
      if (sql.startsWith('SELECT ingredient_key, unit')) return [];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);
    const request = {
      startDate: '2026-09-02',
      endDate: '2026-09-02',
      replaceExisting: false,
    };

    await expect(
      generatePlan('user-1', {
        operationId: 'generation-operation-bound',
        ...request,
        algorithmVersion: 'pantry-plan-v1',
        warnings: ['Visible warning'],
        entries: [],
      })
    ).resolves.toEqual({
      planId,
      created: true,
      entryIds: [],
      warnings: ['Visible warning'],
    });
    await expect(
      getPlanGenerationResult('user-1', 'generation-operation-bound', request)
    ).resolves.toEqual({
      planId,
      created: false,
      entryIds: [],
      warnings: ['Visible warning'],
    });
    await expect(
      getPlanGenerationResult('user-1', 'generation-operation-bound', {
        ...request,
        endDate: '2026-09-03',
      })
    ).rejects.toBeInstanceOf(CoachMealPlanningConflictError);

    expect(storedWarnings).toEqual([
      expect.stringMatching(/^plan-request-sha256:[a-f0-9]{64}$/),
      'Visible warning',
    ]);
  });

  it.each(['eaten_out', 'skipped'] as const)(
    'releases a planned reservation on %s without changing physical stock',
    async (action) => {
      const entryId = '55555555-5555-4555-8555-555555555555';
      const { client, query } = mockClient((sql) => {
        if (isTransactionControl(sql)) return [];
        if (
          sql.startsWith(
            'SELECT id, status, plan_date::text AS plan_date FROM coach_meal_plan_entries'
          )
        ) {
          return [{ id: entryId, status: 'planned', plan_date: '2026-09-02' }];
        }
        if (sql.includes('planned_need AS')) return [];
        if (sql.includes('FROM coach_shopping_lists')) return [];
        return [];
      });
      vi.mocked(getClient).mockResolvedValue(client);

      await expect(
        applyPlanEntryAction(
          'user-1',
          entryId,
          action,
          'action-operation-1',
          null
        )
      ).resolves.toBe(action);

      const entryUpdate = query.mock.calls.find(([sql]) =>
        compactSql(String(sql)).startsWith('UPDATE coach_meal_plan_entries')
      );
      expect(entryUpdate?.[1]).toEqual([entryId, 'user-1', action, null]);
      expect(
        query.mock.calls.some(([sql]) =>
          compactSql(String(sql)).startsWith('UPDATE coach_pantry_items')
        )
      ).toBe(false);
      expect(
        query.mock.calls.some(([sql]) =>
          compactSql(String(sql)).startsWith('INSERT INTO coach_pantry_events')
        )
      ).toBe(false);
    }
  );

  it('rejects late preparation when stock expired before the later of meal date and owner-local today', async () => {
    const entryId = '55555555-5555-4555-8555-555555555555';
    const ingredientId = '66666666-6666-4666-8666-666666666666';
    const pantryItemId = '22222222-2222-4222-8222-222222222222';
    const { client, query } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (
        sql.startsWith(
          'SELECT id, status, plan_date::text AS plan_date FROM coach_meal_plan_entries'
        )
      ) {
        return [{ id: entryId, status: 'planned', plan_date: '2026-09-01' }];
      }
      if (
        sql.includes('FROM coach_meal_plan_ingredients') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: ingredientId,
            entry_id: entryId,
            pantry_item_id: pantryItemId,
            ingredient_key: 'reis',
            name: 'Reis',
            category: 'pantry',
            quantity: 200,
            unit: 'g',
            shopping_required: true,
          },
        ];
      }
      if (
        sql.startsWith('SELECT quantity::float8 AS quantity') &&
        sql.includes('FROM coach_pantry_items')
      ) {
        return [{ quantity: 500, usable_on_relevant_date: false }];
      }
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(
      applyPlanEntryAction(
        'user-1',
        entryId,
        'prepared',
        'prepare-expired-operation',
        null
      )
    ).rejects.toMatchObject({
      details: {
        shortages: [{ name: 'Reis', required: 200, available: 0, unit: 'g' }],
      },
    });

    const stockQuery = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).includes('AS usable_on_relevant_date')
    );
    expect(stockQuery?.[1]).toEqual([
      pantryItemId,
      'user-1',
      '2026-09-01',
      '2026-09-02',
    ]);
    expect(compactSql(String(stockQuery?.[0]))).toContain(
      'expires_on >= GREATEST($3::date, $4::date)'
    );
    expect(
      query.mock.calls.some(([sql]) =>
        compactSql(String(sql)).includes('SET quantity = quantity - $3')
      )
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        compactSql(String(sql)).startsWith('UPDATE coach_meal_plan_entries')
      )
    ).toBe(false);
  });

  it('decrements physical pantry stock exactly once when a meal is prepared', async () => {
    const entryId = '55555555-5555-4555-8555-555555555555';
    const ingredientId = '66666666-6666-4666-8666-666666666666';
    const pantryItemId = '22222222-2222-4222-8222-222222222222';
    let status: 'planned' | 'prepared' = 'planned';
    const { client, query } = mockClient((sql) => {
      if (isTransactionControl(sql)) return [];
      if (
        sql.startsWith(
          'SELECT id, status, plan_date::text AS plan_date FROM coach_meal_plan_entries'
        )
      ) {
        return [{ id: entryId, status, plan_date: '2026-09-02' }];
      }
      if (
        sql.includes('FROM coach_meal_plan_ingredients') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: ingredientId,
            entry_id: entryId,
            pantry_item_id: pantryItemId,
            ingredient_key: 'reis',
            name: 'Reis',
            category: 'pantry',
            quantity: 200,
            unit: 'g',
            shopping_required: true,
          },
        ];
      }
      if (
        sql.startsWith('SELECT quantity::float8 AS quantity') &&
        sql.includes('FROM coach_pantry_items')
      ) {
        return [{ quantity: 500, usable_on_relevant_date: true }];
      }
      if (sql.startsWith('UPDATE coach_meal_plan_entries')) {
        status = 'prepared';
        return [];
      }
      if (sql.includes('planned_need AS')) return [];
      if (sql.includes('FROM coach_shopping_lists')) return [];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(
      applyPlanEntryAction(
        'user-1',
        entryId,
        'prepared',
        'prepare-operation-1',
        null
      )
    ).resolves.toBe('prepared');
    await expect(
      applyPlanEntryAction(
        'user-1',
        entryId,
        'prepared',
        'prepare-operation-1',
        null
      )
    ).resolves.toBe('prepared');

    const pantryDecrements = query.mock.calls.filter(([sql]) =>
      compactSql(String(sql)).includes('SET quantity = quantity - $3')
    );
    const eventInserts = query.mock.calls.filter(([sql]) =>
      compactSql(String(sql)).startsWith('INSERT INTO coach_pantry_events')
    );
    expect(pantryDecrements).toHaveLength(1);
    expect(pantryDecrements[0][1]).toEqual([pantryItemId, 'user-1', 200]);
    expect(eventInserts).toHaveLength(1);
    expect(eventInserts[0][1]).toEqual([
      'user-1',
      pantryItemId,
      -200,
      'g',
      entryId,
      `consume:prepare-operation-1:${entryId}:${ingredientId}`,
      'Reis',
    ]);
    expect(compactSql(String(eventInserts[0][0]))).toContain(
      'event_type, delta_quantity, unit, source, source_id, idempotency_key, notes'
    );
    const stockQuery = query.mock.calls.find(([sql]) =>
      compactSql(String(sql)).includes('AS usable_on_relevant_date')
    );
    expect(stockQuery?.[1]).toEqual([
      pantryItemId,
      'user-1',
      '2026-09-02',
      '2026-09-02',
    ]);
    expect(compactSql(String(stockQuery?.[0]))).toContain(
      'expires_on >= GREATEST($3::date, $4::date)'
    );
  });

  it('marks a replaced entry before inserting its replacement and never consumes pantry stock', async () => {
    const oldEntryId = '55555555-5555-4555-8555-555555555555';
    const newEntryId = '77777777-7777-4777-8777-777777777777';
    const planId = '44444444-4444-4444-8444-444444444444';
    let oldStatus: 'planned' | 'replaced' = 'planned';
    let oldNotes: string | null = null;
    const { client, query } = mockClient((sql, parameters) => {
      if (isTransactionControl(sql)) return [];
      if (sql.startsWith('SELECT id, meal_plan_id AS plan_id, status')) {
        return [
          {
            id: oldEntryId,
            plan_id: planId,
            status: oldStatus,
            plan_date: '2026-09-02',
            meal_slot: 'dinner',
            notes: oldNotes,
          },
        ];
      }
      if (sql.startsWith('SELECT id, recipe_key')) {
        return oldStatus === 'replaced'
          ? [{ id: newEntryId, recipe_key: planEntry.recipeKey }]
          : [];
      }
      if (
        sql.startsWith('SELECT id') &&
        sql.includes("position($2 in COALESCE(notes, ''))")
      ) {
        return [];
      }
      if (
        sql.startsWith('UPDATE coach_meal_plan_entries') &&
        sql.includes("status = 'replaced'")
      ) {
        oldStatus = 'replaced';
        oldNotes = `${String(parameters[2])}\n${String(parameters[3])}`;
        return [];
      }
      if (sql.startsWith('INSERT INTO coach_meal_plan_entries')) {
        return [{ id: newEntryId }];
      }
      if (sql.startsWith('INSERT INTO coach_pantry_items')) {
        return [{ id: '22222222-2222-4222-8222-222222222222' }];
      }
      if (sql.includes('planned_need AS')) return [];
      if (sql.includes('FROM coach_shopping_lists')) return [];
      return [];
    });
    vi.mocked(getClient).mockResolvedValue(client);

    await expect(
      replacePlanEntry('user-1', oldEntryId, 'replace-operation-1', planEntry)
    ).resolves.toEqual({ entryId: newEntryId, created: true });
    await expect(
      replacePlanEntry('user-1', oldEntryId, 'replace-operation-1', planEntry)
    ).resolves.toEqual({ entryId: newEntryId, created: false });
    await expect(
      replacePlanEntry('user-1', oldEntryId, 'replace-operation-2', planEntry)
    ).rejects.toBeInstanceOf(CoachMealPlanningConflictError);
    await expect(
      replacePlanEntry('user-1', oldEntryId, 'replace-operation-1', {
        ...planEntry,
        recipeKey: 'different-recipe',
      })
    ).rejects.toBeInstanceOf(CoachMealPlanningConflictError);

    expect(
      query.mock.calls.filter(([sql]) =>
        compactSql(String(sql)).startsWith(
          'INSERT INTO coach_meal_plan_entries'
        )
      )
    ).toHaveLength(1);
    expect(
      query.mock.calls.some(([sql]) =>
        compactSql(String(sql)).includes('quantity = quantity -')
      )
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        compactSql(String(sql)).startsWith('INSERT INTO coach_pantry_events')
      )
    ).toBe(false);
  });
});
