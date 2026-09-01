import { createHash } from 'node:crypto';
import { todayInZone } from '@workspace/shared';
import type { PoolClient } from 'pg';
import { getClient } from '../db/poolManager.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

export type CoachPlanningUnit = 'g' | 'ml' | 'piece' | 'tsp' | 'tbsp';
export type CoachShoppingCategory =
  'chilled' | 'produce' | 'pantry' | 'frozen' | 'other';
export type CoachRetailer = 'coop' | 'migros';
export type CoachMealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type CoachMealPlanEntryStatus =
  'planned' | 'prepared' | 'eaten_out' | 'replaced' | 'skipped';

export interface PantryProjectionRow {
  id: string;
  ingredient_key: string;
  name: string;
  category: CoachShoppingCategory;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  shortage_quantity: number;
  unit: CoachPlanningUnit;
  min_quantity: number;
  expires_on: string | null;
  preferred_retailer: CoachRetailer | null;
  preferred_product_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ShoppingListRow {
  id: string;
  title: string;
  status: 'open' | 'completed' | 'cancelled';
  coverage_start: string | null;
  coverage_end: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ShoppingListItemRow {
  id: string;
  list_id: string;
  ingredient_key: string;
  name: string;
  category: CoachShoppingCategory;
  needed_quantity: number;
  purchased_quantity: number;
  unit: CoachPlanningUnit;
  status: 'needed' | 'purchased' | 'skipped';
  is_manual: boolean;
  quantity_locked: boolean;
  source_meal_entry_ids: string[];
  selected_retailer: CoachRetailer | null;
  selected_product_id: string | null;
  selected_product_gtin: string | null;
  product_name: string | null;
  product_url: string | null;
  package_quantity: number | null;
  package_unit: CoachPlanningUnit | null;
  product_verified_at: Date | null;
  product_note: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MealPlanIngredientRow {
  id: string;
  pantry_item_id: string | null;
  ingredient_key: string;
  name: string;
  category: CoachShoppingCategory;
  quantity: number;
  unit: CoachPlanningUnit;
  shopping_required: boolean;
}

export interface MealPlanEntryRow {
  id: string;
  plan_id: string;
  plan_date: string;
  meal_slot: CoachMealSlot;
  recipe_key: string;
  recipe_name: string;
  servings: number;
  status: CoachMealPlanEntryStatus;
  estimated_calories: number;
  estimated_protein_g: number;
  estimated_carbs_g: number;
  estimated_fat_g: number;
  recipe_description?: string | null;
  recipe_instructions?: string[];
  prep_minutes?: number;
  preparation: string;
  safety_status: 'validated' | 'needs_user_input';
  replacement_for_entry_id: string | null;
  notes: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  ingredients: MealPlanIngredientRow[];
}

export interface PantryItemInput {
  ingredientKey: string;
  name: string;
  category: CoachShoppingCategory;
  quantity: number;
  unit: CoachPlanningUnit;
  minQuantity: number;
  expiresOn: string | null;
  preferredRetailer: CoachRetailer | null;
  preferredProductId: string | null;
}

export interface PantryItemPatch {
  name?: string;
  category?: CoachShoppingCategory;
  quantity?: number;
  minQuantity?: number;
  expiresOn?: string | null;
  preferredRetailer?: CoachRetailer | null;
  preferredProductId?: string | null;
}

export interface ShoppingProductSnapshot {
  retailer: CoachRetailer;
  productId: string;
  gtin?: string | null;
  name: string;
  url: string;
  packageQuantity: number;
  packageUnit: CoachPlanningUnit;
  verifiedAt: string;
  note: string | null;
}

export interface ShoppingItemInput {
  ingredientKey: string;
  name: string;
  category: CoachShoppingCategory;
  requiredQuantity: number;
  unit: CoachPlanningUnit;
  notes: string | null;
  product: ShoppingProductSnapshot | null;
}

export interface ShoppingItemPatch {
  name?: string;
  category?: CoachShoppingCategory;
  requiredQuantity?: number;
  quantityLocked?: boolean;
  status?: 'needed' | 'skipped';
  notes?: string | null;
  product?: ShoppingProductSnapshot | null;
}

export interface PurchaseInput {
  itemId: string;
  quantity: number;
}

export interface PlanIngredientInput {
  ingredientKey: string;
  name: string;
  category: CoachShoppingCategory;
  quantity: number;
  unit: CoachPlanningUnit;
  shoppingRequired: boolean;
}

export interface PlanEntryInput {
  planDate: string;
  mealSlot: CoachMealSlot;
  recipeKey: string;
  recipeName: string;
  servings: number;
  estimatedCalories: number;
  estimatedProteinG: number;
  estimatedCarbsG: number;
  estimatedFatG: number;
  prepMinutes?: number;
  preparation: string;
  safetyStatus: 'validated' | 'needs_user_input';
  replacementForEntryId?: string | null;
  notes?: string | null;
  ingredients: PlanIngredientInput[];
}

export interface PlanGenerationInput {
  operationId: string;
  startDate: string;
  endDate: string;
  replaceExisting: boolean;
  algorithmVersion: string;
  warnings: string[];
  entries: PlanEntryInput[];
}

export type PlanGenerationRequestIdentity = Pick<
  PlanGenerationInput,
  'startDate' | 'endDate' | 'replaceExisting'
>;

export interface PlanGenerationResult {
  planId: string;
  created: boolean;
  entryIds: string[];
  warnings: string[];
}

export class CoachMealPlanningConflictError extends Error {
  readonly details: Record<string, unknown> | null;

  constructor(message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'CoachMealPlanningConflictError';
    this.details = details;
  }
}

const PURCHASE_BATCH_NOTE_PREFIX = 'purchase-batch-sha256:';
const PLAN_REQUEST_FINGERPRINT_PREFIX = 'plan-request-sha256:';
const REPLACEMENT_OPERATION_NOTE_PREFIX = '[coach-replacement-operation:';
const REPLACEMENT_RECIPE_NOTE_PREFIX = '[coach-replacement-recipe:';

function purchaseBatchFingerprint(purchases: readonly PurchaseInput[]): {
  fingerprint: string;
  sorted: PurchaseInput[];
} {
  const sorted = [...purchases].sort((left, right) =>
    left.itemId.localeCompare(right.itemId)
  );
  const itemIds = new Set<string>();
  for (const purchase of sorted) {
    if (itemIds.has(purchase.itemId)) {
      throw new CoachMealPlanningConflictError(
        'Each shopping item may occur only once in a purchase operation.'
      );
    }
    itemIds.add(purchase.itemId);
  }
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        sorted.map((purchase) => [purchase.itemId, purchase.quantity])
      )
    )
    .digest('hex');
  return { fingerprint, sorted };
}

function purchaseBatchNote(fingerprint: string, productName: string | null) {
  const marker = `${PURCHASE_BATCH_NOTE_PREFIX}${fingerprint}`;
  return productName ? `${marker}; ${productName}` : marker;
}

function planRequestFingerprint(
  request: PlanGenerationRequestIdentity
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        request.startDate,
        request.endDate,
        request.replaceExisting,
      ])
    )
    .digest('hex');
}

function planRequestMarker(request: PlanGenerationRequestIdentity): string {
  return `${PLAN_REQUEST_FINGERPRINT_PREFIX}${planRequestFingerprint(request)}`;
}

function visiblePlanWarnings(warnings: readonly string[]): string[] {
  return warnings.filter(
    (warning) => !warning.startsWith(PLAN_REQUEST_FINGERPRINT_PREFIX)
  );
}

function replacementOperationMarker(operationId: string): string {
  return `${REPLACEMENT_OPERATION_NOTE_PREFIX}${operationId}]`;
}

function replacementRecipeMarker(recipeKey: string): string {
  return `${REPLACEMENT_RECIPE_NOTE_PREFIX}${recipeKey}]`;
}

function notesContainLine(notes: string | null, expected: string): boolean {
  return notes?.split('\n').includes(expected) ?? false;
}

function sourceEntryIdsKey(sourceEntryIds: readonly string[]): string {
  return JSON.stringify([...sourceEntryIds].sort());
}

function deficitSuppressionKey(
  ingredientKey: string,
  unit: CoachPlanningUnit,
  sourceEntryIds: readonly string[]
): string {
  return `${ingredientKey}\u0000${unit}\u0000${sourceEntryIdsKey(sourceEntryIds)}`;
}

async function withTransaction<T>(
  userId: string,
  work: (client: PoolClient, ownerToday: string) => Promise<T>
): Promise<T> {
  const ownerToday = todayInZone(await loadUserTimezone(userId));
  const client: PoolClient = await getClient(userId, userId);
  try {
    await client.query('BEGIN');
    // All planning mutations for one owner share this advisory transaction
    // lock. It closes the absent-row race around partial unique indexes while
    // still allowing different owners to plan concurrently.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`coach-meal-planning:${userId}`]
    );
    const result = await work(client, ownerToday);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function withClient<T>(
  userId: string,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client: PoolClient = await getClient(userId, userId);
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

async function findPlanGeneration(
  client: PoolClient,
  userId: string,
  operationId: string,
  request: PlanGenerationRequestIdentity
): Promise<Omit<PlanGenerationResult, 'created'> | null> {
  const { rows: plans } = await client.query<{
    id: string;
    start_date: string;
    end_date: string;
    warnings: string[];
  }>(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date,
            warnings
       FROM coach_meal_plans
      WHERE user_id = $1 AND generation_key = $2`,
    [userId, operationId]
  );
  const plan = plans[0];
  if (!plan) return null;
  const expectedMarker = planRequestMarker(request);
  const storedMarker = plan.warnings.find((warning) =>
    warning.startsWith(PLAN_REQUEST_FINGERPRINT_PREFIX)
  );
  const legacyDatesMatch =
    storedMarker === undefined &&
    plan.start_date === request.startDate &&
    plan.end_date === request.endDate;
  if (storedMarker !== expectedMarker && !legacyDatesMatch) {
    throw new CoachMealPlanningConflictError(
      'The meal-plan operation id was already used with a different generation request.'
    );
  }
  const { rows: entries } = await client.query<{ id: string }>(
    `SELECT id
       FROM coach_meal_plan_entries
      WHERE user_id = $1 AND meal_plan_id = $2
        AND replacement_for_id IS NULL
      ORDER BY created_at`,
    [userId, plan.id]
  );
  return {
    planId: plan.id,
    entryIds: entries.map((entry) => entry.id),
    warnings: visiblePlanWarnings(plan.warnings),
  };
}

export async function getPlanGenerationResult(
  userId: string,
  operationId: string,
  request: PlanGenerationRequestIdentity
): Promise<PlanGenerationResult | null> {
  return withClient(userId, async (client) => {
    const existing = await findPlanGeneration(
      client,
      userId,
      operationId,
      request
    );
    return existing ? { ...existing, created: false } : null;
  });
}

async function upsertEmptyPantryItem(
  client: PoolClient,
  userId: string,
  ingredient: Pick<
    PlanIngredientInput,
    'ingredientKey' | 'name' | 'category' | 'unit'
  >
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO coach_pantry_items (
       user_id, ingredient_key, name, category, quantity, unit, is_active
     ) VALUES ($1, $2, $3, $4, 0, $5, TRUE)
     ON CONFLICT (user_id, ingredient_key, unit) DO UPDATE SET
       is_active = TRUE,
       updated_at = now()
     RETURNING id`,
    [
      userId,
      ingredient.ingredientKey,
      ingredient.name,
      ingredient.category,
      ingredient.unit,
    ]
  );
  return rows[0].id;
}

async function insertPlanEntry(
  client: PoolClient,
  userId: string,
  planId: string,
  entry: PlanEntryInput
): Promise<string> {
  const recipeInstructions = [entry.preparation];
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO coach_meal_plan_entries (
       user_id, meal_plan_id, plan_date, slot, status, recipe_key, recipe_name,
       recipe_description, recipe_instructions, prep_minutes, servings,
       calories_kcal, protein_g, carbs_g, fat_g, safety_status,
       replacement_for_id, notes
     ) VALUES (
       $1, $2, $3::date, $4, 'planned', $5, $6, NULL, $7::text[], $8,
       $9, $10, $11, $12, $13, $14, $15, $16
     ) RETURNING id`,
    [
      userId,
      planId,
      entry.planDate,
      entry.mealSlot,
      entry.recipeKey,
      entry.recipeName,
      recipeInstructions,
      entry.prepMinutes ?? 30,
      entry.servings,
      entry.estimatedCalories,
      entry.estimatedProteinG,
      entry.estimatedCarbsG,
      entry.estimatedFatG,
      entry.safetyStatus,
      entry.replacementForEntryId ?? null,
      entry.notes ?? null,
    ]
  );
  const entryId = rows[0].id;
  for (const ingredient of entry.ingredients) {
    const pantryItemId = ingredient.shoppingRequired
      ? await upsertEmptyPantryItem(client, userId, ingredient)
      : null;
    await client.query(
      `INSERT INTO coach_meal_plan_ingredients (
         user_id, meal_plan_entry_id, pantry_item_id, ingredient_key, name,
         quantity, unit, category, shopping_required
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        entryId,
        pantryItemId,
        ingredient.ingredientKey,
        ingredient.name,
        ingredient.quantity,
        ingredient.unit,
        ingredient.category,
        ingredient.shoppingRequired,
      ]
    );
  }
  return entryId;
}

interface DeficitRow {
  ingredient_key: string;
  name: string;
  category: CoachShoppingCategory;
  unit: CoachPlanningUnit;
  deficit: number;
  source_meal_entry_ids: string[];
}

async function listDeficits(
  client: PoolClient,
  userId: string,
  ownerToday: string
): Promise<DeficitRow[]> {
  const { rows } = await client.query<DeficitRow>(
    `WITH stock AS (
       SELECT ingredient_key, unit, quantity::float8 AS quantity,
              minimum_quantity::float8 AS min_quantity,
              name, category, expires_on
         FROM coach_pantry_items
        WHERE user_id = $1 AND is_active = TRUE
     ), planned_need AS (
       SELECT
         ingredient.ingredient_key,
         ingredient.unit,
         MAX(ingredient.name) AS name,
         MAX(ingredient.category) AS category,
         COALESCE(
           SUM(ingredient.quantity) FILTER (
             WHERE stock.expires_on IS NULL
                OR stock.expires_on >= entry.plan_date
           ),
           0
         )::float8 AS stock_eligible_quantity,
         COALESCE(
           SUM(ingredient.quantity) FILTER (
             WHERE stock.expires_on IS NOT NULL
               AND stock.expires_on < entry.plan_date
           ),
           0
         )::float8 AS after_expiry_quantity,
         ARRAY_AGG(
           DISTINCT ingredient.meal_plan_entry_id
           ORDER BY ingredient.meal_plan_entry_id
         )
           AS source_meal_entry_ids
       FROM coach_meal_plan_ingredients ingredient
       JOIN coach_meal_plan_entries entry
         ON entry.id = ingredient.meal_plan_entry_id
        AND entry.user_id = ingredient.user_id
       LEFT JOIN stock
         ON stock.ingredient_key = ingredient.ingredient_key
        AND stock.unit = ingredient.unit
       WHERE ingredient.user_id = $1
         AND ingredient.shopping_required = TRUE
         AND entry.status = 'planned'
         AND entry.plan_date >= $2::date
       GROUP BY ingredient.ingredient_key, ingredient.unit
     ), projected AS (
       SELECT
         COALESCE(need.ingredient_key, stock.ingredient_key) AS ingredient_key,
         COALESCE(need.name, stock.name) AS name,
         COALESCE(need.category, stock.category)::text AS category,
         COALESCE(need.unit, stock.unit)::text AS unit,
         CASE
           WHEN COALESCE(need.after_expiry_quantity, 0) > 0 THEN
             GREATEST(
               COALESCE(need.stock_eligible_quantity, 0)
                 - CASE
                     WHEN stock.expires_on IS NOT NULL
                      AND stock.expires_on < $2::date THEN 0
                     ELSE COALESCE(stock.quantity, 0)
                   END,
               0
             )
               + COALESCE(need.after_expiry_quantity, 0)
               + COALESCE(stock.min_quantity, 0)
           ELSE
             GREATEST(
               COALESCE(need.stock_eligible_quantity, 0)
                 + COALESCE(stock.min_quantity, 0)
                 - CASE
                     WHEN stock.expires_on IS NOT NULL
                      AND stock.expires_on < $2::date THEN 0
                     ELSE COALESCE(stock.quantity, 0)
                   END,
               0
             )
         END::float8 AS deficit,
         COALESCE(need.source_meal_entry_ids, ARRAY[]::uuid[])::text[]
           AS source_meal_entry_ids
       FROM planned_need need
       FULL OUTER JOIN stock
         ON stock.ingredient_key = need.ingredient_key
        AND stock.unit = need.unit
     )
     SELECT ingredient_key, name, category, unit, deficit,
            source_meal_entry_ids
       FROM projected
      WHERE deficit > 0
     ORDER BY category, name`,
    [userId, ownerToday]
  );
  return rows;
}

async function findOpenShoppingList(
  client: PoolClient,
  userId: string
): Promise<ShoppingListRow | null> {
  const { rows } = await client.query<ShoppingListRow>(
    `SELECT id, title, status, coverage_start, coverage_end, completed_at,
            created_at, updated_at
       FROM coach_shopping_lists
      WHERE user_id = $1 AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [userId]
  );
  return rows[0] ?? null;
}

async function createOpenShoppingList(
  client: PoolClient,
  userId: string,
  coverageStart: string | null,
  coverageEnd: string | null
): Promise<ShoppingListRow> {
  const { rows } = await client.query<ShoppingListRow>(
    `INSERT INTO coach_shopping_lists (
       user_id, title, status, coverage_start, coverage_end
     ) VALUES ($1, 'Einkauf für deinen Essensplan', 'open', $2::date, $3::date)
     RETURNING id, title, status, coverage_start, coverage_end, completed_at,
               created_at, updated_at`,
    [userId, coverageStart, coverageEnd]
  );
  return rows[0];
}

async function planCoverage(
  client: PoolClient,
  userId: string,
  ownerToday: string
): Promise<{ start: string | null; end: string | null }> {
  const { rows } = await client.query<{
    start: string | null;
    end: string | null;
  }>(
    `SELECT MIN(plan_date)::text AS start, MAX(plan_date)::text AS end
       FROM coach_meal_plan_entries
      WHERE user_id = $1 AND status = 'planned'
        AND plan_date >= $2::date`,
    [userId, ownerToday]
  );
  return rows[0] ?? { start: null, end: null };
}

async function listSkippedAutoDeficitKeys(
  client: PoolClient,
  userId: string
): Promise<Set<string>> {
  const { rows } = await client.query<{
    ingredient_key: string;
    unit: CoachPlanningUnit;
    source_meal_entry_ids: string[];
  }>(
    `SELECT ingredient_key, unit,
            source_entry_ids::text[] AS source_meal_entry_ids
       FROM coach_shopping_list_items
      WHERE user_id = $1 AND is_manual = FALSE AND status = 'skipped'`,
    [userId]
  );
  return new Set(
    rows.map((row) =>
      deficitSuppressionKey(
        row.ingredient_key,
        row.unit,
        row.source_meal_entry_ids
      )
    )
  );
}

async function syncShoppingList(
  client: PoolClient,
  userId: string,
  ownerToday: string
): Promise<ShoppingListRow | null> {
  let deficits = await listDeficits(client, userId, ownerToday);
  let list = await findOpenShoppingList(client, userId);
  const skippedAutoDeficitKeys = await listSkippedAutoDeficitKeys(
    client,
    userId
  );
  if (!list) {
    deficits = deficits.filter(
      (deficit) =>
        !skippedAutoDeficitKeys.has(
          deficitSuppressionKey(
            deficit.ingredient_key,
            deficit.unit,
            deficit.source_meal_entry_ids
          )
        )
    );
  }
  if (!list && deficits.length === 0) return null;
  if (!list) {
    const coverage = await planCoverage(client, userId, ownerToday);
    list = await createOpenShoppingList(
      client,
      userId,
      coverage.start,
      coverage.end
    );
  } else {
    const coverage = await planCoverage(client, userId, ownerToday);
    const { rows } = await client.query<ShoppingListRow>(
      `UPDATE coach_shopping_lists
          SET coverage_start = $3::date,
              coverage_end = $4::date,
              updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING id, title, status, coverage_start, coverage_end, completed_at,
                  created_at, updated_at`,
      [list.id, userId, coverage.start, coverage.end]
    );
    list = rows[0];
  }

  const deficitKeys: string[] = [];
  for (const deficit of deficits) {
    const { rows: matchingItems } = await client.query<{
      id: string;
      quantity_locked: boolean;
      status: 'needed' | 'purchased' | 'skipped';
      is_manual: boolean;
      source_meal_entry_ids: string[];
    }>(
      `SELECT id, quantity_locked, status, is_manual,
              source_entry_ids::text[] AS source_meal_entry_ids
         FROM coach_shopping_list_items
        WHERE user_id = $1 AND shopping_list_id = $2
          AND ingredient_key = $3 AND unit = $4
        ORDER BY is_manual DESC, created_at
        LIMIT 1
        FOR UPDATE`,
      [userId, list.id, deficit.ingredient_key, deficit.unit]
    );
    const matchingItem = matchingItems[0];
    const suppressionKey = deficitSuppressionKey(
      deficit.ingredient_key,
      deficit.unit,
      deficit.source_meal_entry_ids
    );
    if (!matchingItem && skippedAutoDeficitKeys.has(suppressionKey)) continue;
    deficitKeys.push(`${deficit.ingredient_key}\u0000${deficit.unit}`);
    if (matchingItem) {
      const shouldReevaluateSkipped =
        matchingItem.status === 'skipped' &&
        !matchingItem.is_manual &&
        sourceEntryIdsKey(matchingItem.source_meal_entry_ids) !==
          sourceEntryIdsKey(deficit.source_meal_entry_ids);
      await client.query(
        `UPDATE coach_shopping_list_items
            SET source_entry_ids = $3::uuid[],
                required_quantity = CASE
                  WHEN $5 THEN purchased_quantity + $4
                  WHEN quantity_locked THEN required_quantity
                  ELSE purchased_quantity + $4
                END,
                quantity_locked = CASE
                  WHEN $5 THEN FALSE
                  ELSE quantity_locked
                END,
                status = CASE
                  WHEN $5 THEN 'needed'
                  WHEN status = 'skipped' THEN 'skipped'
                  WHEN quantity_locked THEN status
                  ELSE 'needed'
                END,
                updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [
          matchingItem.id,
          userId,
          deficit.source_meal_entry_ids,
          deficit.deficit,
          shouldReevaluateSkipped,
        ]
      );
    } else {
      await client.query(
        `INSERT INTO coach_shopping_list_items (
           user_id, shopping_list_id, ingredient_key, name,
           required_quantity, purchased_quantity, unit, category, status,
           is_manual, quantity_locked, source_entry_ids
         ) VALUES (
           $1, $2, $3, $4, $5, 0, $6, $7, 'needed', FALSE, FALSE, $8::uuid[]
         )`,
        [
          userId,
          list.id,
          deficit.ingredient_key,
          deficit.name,
          deficit.deficit,
          deficit.unit,
          deficit.category,
          deficit.source_meal_entry_ids,
        ]
      );
    }
  }

  const { rows: autoItems } = await client.query<{
    id: string;
    ingredient_key: string;
    unit: CoachPlanningUnit;
    purchased_quantity: number;
  }>(
    `SELECT id, ingredient_key, unit,
            purchased_quantity::float8 AS purchased_quantity
       FROM coach_shopping_list_items
      WHERE user_id = $1 AND shopping_list_id = $2
        AND is_manual = FALSE AND quantity_locked = FALSE
        AND status <> 'skipped'`,
    [userId, list.id]
  );
  const activeKeys = new Set(deficitKeys);
  for (const item of autoItems) {
    if (activeKeys.has(`${item.ingredient_key}\u0000${item.unit}`)) continue;
    if (item.purchased_quantity === 0) {
      await client.query(
        `DELETE FROM coach_shopping_list_items
          WHERE id = $1 AND user_id = $2`,
        [item.id, userId]
      );
    } else {
      await client.query(
        `UPDATE coach_shopping_list_items
            SET required_quantity = purchased_quantity,
                status = 'purchased',
                updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [item.id, userId]
      );
    }
  }

  const { rows: remainingRows } = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
      FROM coach_shopping_list_items
      WHERE user_id = $1 AND shopping_list_id = $2
        AND status = 'needed'
        AND required_quantity > purchased_quantity`,
    [userId, list.id]
  );
  if ((remainingRows[0]?.count ?? 0) === 0) {
    await client.query(
      `UPDATE coach_shopping_lists
          SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE id = $1 AND user_id = $2`,
      [list.id, userId]
    );
    return null;
  }
  return list;
}

export async function listPantryItems(
  userId: string,
  excludedPlannedEntryIds: readonly string[] = []
): Promise<PantryProjectionRow[]> {
  const ownerToday = todayInZone(await loadUserTimezone(userId));
  return withClient(userId, async (client) => {
    const { rows } = await client.query<PantryProjectionRow>(
      `WITH reservation AS (
         SELECT ingredient.pantry_item_id,
                COALESCE(
                  SUM(ingredient.quantity) FILTER (
                    WHERE pantry.expires_on IS NULL
                       OR pantry.expires_on >= entry.plan_date
                  ),
                  0
                )::float8 AS reserved_quantity,
                COALESCE(
                  SUM(ingredient.quantity) FILTER (
                    WHERE pantry.expires_on IS NOT NULL
                      AND pantry.expires_on < entry.plan_date
                  ),
                  0
                )::float8 AS after_expiry_quantity
           FROM coach_meal_plan_ingredients ingredient
           JOIN coach_meal_plan_entries entry
             ON entry.id = ingredient.meal_plan_entry_id
            AND entry.user_id = ingredient.user_id
           JOIN coach_pantry_items pantry
             ON pantry.id = ingredient.pantry_item_id
            AND pantry.user_id = ingredient.user_id
           WHERE ingredient.user_id = $1
             AND ingredient.shopping_required = TRUE
             AND entry.status = 'planned'
             AND entry.plan_date >= $2::date
             AND NOT (entry.id = ANY($3::uuid[]))
           GROUP BY ingredient.pantry_item_id
       )
       SELECT pantry.id, pantry.ingredient_key, pantry.name, pantry.category,
              pantry.quantity::float8 AS quantity,
              COALESCE(reservation.reserved_quantity, 0)::float8
                AS reserved_quantity,
              CASE
                WHEN pantry.expires_on IS NOT NULL
                 AND pantry.expires_on < $2::date THEN 0
                ELSE GREATEST(
                  pantry.quantity
                    - COALESCE(reservation.reserved_quantity, 0),
                  0
                )
              END::float8 AS available_quantity,
              CASE
                WHEN COALESCE(reservation.after_expiry_quantity, 0) > 0 THEN
                  GREATEST(
                    COALESCE(reservation.reserved_quantity, 0)
                      - CASE
                          WHEN pantry.expires_on IS NOT NULL
                           AND pantry.expires_on < $2::date THEN 0
                          ELSE pantry.quantity
                        END,
                    0
                  )
                    + COALESCE(reservation.after_expiry_quantity, 0)
                    + pantry.minimum_quantity
                ELSE
                  GREATEST(
                    COALESCE(reservation.reserved_quantity, 0)
                      + pantry.minimum_quantity
                      - CASE
                          WHEN pantry.expires_on IS NOT NULL
                           AND pantry.expires_on < $2::date THEN 0
                          ELSE pantry.quantity
                        END,
                    0
                  )
              END::float8 AS shortage_quantity,
              pantry.unit, pantry.minimum_quantity::float8 AS min_quantity,
              pantry.expires_on, pantry.preferred_retailer,
              pantry.preferred_retailer_product_id AS preferred_product_id,
              pantry.is_active,
              pantry.created_at, pantry.updated_at
         FROM coach_pantry_items pantry
         LEFT JOIN reservation ON reservation.pantry_item_id = pantry.id
        WHERE pantry.user_id = $1
          AND (pantry.is_active = TRUE OR pantry.quantity > 0
               OR COALESCE(reservation.reserved_quantity, 0) > 0
               OR COALESCE(reservation.after_expiry_quantity, 0) > 0)
        ORDER BY pantry.category, pantry.name`,
      [userId, ownerToday, excludedPlannedEntryIds]
    );
    return rows;
  });
}

export async function listMealPlanEntries(
  userId: string,
  startDate: string,
  endDate: string
): Promise<MealPlanEntryRow[]> {
  return withClient(userId, async (client) => {
    const { rows: entries } = await client.query<
      Omit<MealPlanEntryRow, 'ingredients'>
    >(
      `SELECT id, meal_plan_id AS plan_id, plan_date, slot AS meal_slot,
              recipe_key, recipe_name,
              servings::float8 AS servings, status,
              calories_kcal::float8 AS estimated_calories,
              protein_g::float8 AS estimated_protein_g,
              carbs_g::float8 AS estimated_carbs_g,
              fat_g::float8 AS estimated_fat_g,
              recipe_description, recipe_instructions, prep_minutes,
              array_to_string(recipe_instructions, E'\n') AS preparation,
              safety_status,
              replacement_for_id AS replacement_for_entry_id,
              notes,
              CASE WHEN status = 'planned' THEN NULL ELSE updated_at END
                AS completed_at,
              created_at, updated_at
         FROM coach_meal_plan_entries
        WHERE user_id = $1 AND plan_date BETWEEN $2::date AND $3::date
        ORDER BY plan_date,
          CASE slot
            WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2
            WHEN 'dinner' THEN 3 ELSE 4
          END,
          created_at`,
      [userId, startDate, endDate]
    );
    if (entries.length === 0) return [];
    const entryIds = entries.map((entry) => entry.id);
    const { rows: ingredients } = await client.query<
      MealPlanIngredientRow & { entry_id: string }
    >(
      `SELECT id, meal_plan_entry_id AS entry_id, pantry_item_id,
              ingredient_key, name, category,
              quantity::float8 AS quantity, unit, shopping_required
         FROM coach_meal_plan_ingredients
        WHERE user_id = $1 AND meal_plan_entry_id = ANY($2::uuid[])
        ORDER BY name`,
      [userId, entryIds]
    );
    const byEntry = new Map<string, MealPlanIngredientRow[]>();
    for (const ingredient of ingredients) {
      const list = byEntry.get(ingredient.entry_id) ?? [];
      const { entry_id: _entryId, ...row } = ingredient;
      list.push(row);
      byEntry.set(ingredient.entry_id, list);
    }
    return entries.map((entry) => ({
      ...entry,
      ingredients: byEntry.get(entry.id) ?? [],
    }));
  });
}

export async function getMealPlanEntry(
  userId: string,
  entryId: string
): Promise<MealPlanEntryRow | null> {
  return withClient(userId, async (client) => {
    const { rows } = await client.query<Omit<MealPlanEntryRow, 'ingredients'>>(
      `SELECT id, meal_plan_id AS plan_id, plan_date, slot AS meal_slot,
              recipe_key, recipe_name,
              servings::float8 AS servings, status,
              calories_kcal::float8 AS estimated_calories,
              protein_g::float8 AS estimated_protein_g,
              carbs_g::float8 AS estimated_carbs_g,
              fat_g::float8 AS estimated_fat_g,
              recipe_description, recipe_instructions, prep_minutes,
              array_to_string(recipe_instructions, E'\n') AS preparation,
              safety_status,
              replacement_for_id AS replacement_for_entry_id,
              notes,
              CASE WHEN status = 'planned' THEN NULL ELSE updated_at END
                AS completed_at,
              created_at, updated_at
         FROM coach_meal_plan_entries
        WHERE id = $1 AND user_id = $2`,
      [entryId, userId]
    );
    const entry = rows[0];
    if (!entry) return null;
    const { rows: ingredients } = await client.query<MealPlanIngredientRow>(
      `SELECT id, pantry_item_id, ingredient_key, name, category,
              quantity::float8 AS quantity, unit, shopping_required
         FROM coach_meal_plan_ingredients
        WHERE meal_plan_entry_id = $1 AND user_id = $2
        ORDER BY name`,
      [entryId, userId]
    );
    return { ...entry, ingredients };
  });
}

export async function getOpenShoppingList(
  userId: string
): Promise<{ list: ShoppingListRow; items: ShoppingListItemRow[] } | null> {
  return withTransaction(userId, async (client, ownerToday) => {
    const list = await syncShoppingList(client, userId, ownerToday);
    if (!list) return null;
    const { rows: items } = await client.query<ShoppingListItemRow>(
      `SELECT id, shopping_list_id AS list_id, ingredient_key, name, category,
              required_quantity::float8 AS needed_quantity,
              purchased_quantity::float8 AS purchased_quantity,
              unit, status, is_manual, quantity_locked,
              source_entry_ids::text[] AS source_meal_entry_ids,
              selected_product_retailer AS selected_retailer,
              selected_product_retailer_id AS selected_product_id,
              selected_product_gtin,
              selected_product_name AS product_name,
              selected_product_direct_url AS product_url,
              selected_product_package_quantity::float8 AS package_quantity,
              selected_product_package_unit AS package_unit,
              selected_product_verified_at AS product_verified_at,
              selected_product_note AS product_note, notes,
              created_at, updated_at
         FROM coach_shopping_list_items
        WHERE user_id = $1 AND shopping_list_id = $2
        ORDER BY status = 'skipped', category, name`,
      [userId, list.id]
    );
    return { list, items };
  });
}

export async function createPantryItem(
  userId: string,
  input: PantryItemInput,
  idempotencyKey: string
): Promise<string> {
  return withTransaction(userId, async (client, ownerToday) => {
    const ledgerNotes = `Initial absolute stock for ${input.ingredientKey} set to ${input.quantity} ${input.unit}.`;
    const { rows: existingEvents } = await client.query<{
      pantry_item_id: string;
      notes: string | null;
    }>(
      `SELECT pantry_item_id, notes
         FROM coach_pantry_events
        WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey]
    );
    const existingEvent = existingEvents[0];
    if (existingEvent) {
      if (existingEvent.notes !== ledgerNotes) {
        throw new CoachMealPlanningConflictError(
          'The pantry operation id was already used with a different quantity.'
        );
      }
      return existingEvent.pantry_item_id;
    }
    const { rows: currentRows } = await client.query<{
      id: string;
      quantity: number;
    }>(
      `SELECT id, quantity::float8 AS quantity
         FROM coach_pantry_items
        WHERE user_id = $1 AND ingredient_key = $2 AND unit = $3
        FOR UPDATE`,
      [userId, input.ingredientKey, input.unit]
    );
    const current = currentRows[0];
    let pantryItemId: string;
    if (current) {
      pantryItemId = current.id;
      await client.query(
        `UPDATE coach_pantry_items
            SET name = $3,
                quantity = $4,
                minimum_quantity = $5,
                category = $6,
                preferred_retailer = $7,
                preferred_retailer_product_id = $8,
                expires_on = $9::date,
                is_active = TRUE,
                updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [
          pantryItemId,
          userId,
          input.name,
          input.quantity,
          input.minQuantity,
          input.category,
          input.preferredRetailer,
          input.preferredProductId,
          input.expiresOn,
        ]
      );
    } else {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO coach_pantry_items (
           user_id, ingredient_key, name, quantity, minimum_quantity, unit,
           category, preferred_retailer, preferred_retailer_product_id,
           expires_on, is_active
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, TRUE
         )
         RETURNING id`,
        [
          userId,
          input.ingredientKey,
          input.name,
          input.quantity,
          input.minQuantity,
          input.unit,
          input.category,
          input.preferredRetailer,
          input.preferredProductId,
          input.expiresOn,
        ]
      );
      pantryItemId = rows[0].id;
    }
    const delta = input.quantity - (current?.quantity ?? 0);
    if (delta !== 0) {
      await client.query(
        `INSERT INTO coach_pantry_events (
           user_id, pantry_item_id, event_type, delta_quantity, unit,
           source, idempotency_key, notes
         ) VALUES ($1, $2, 'adjust', $3, $4, 'manual', $5, $6)`,
        [userId, pantryItemId, delta, input.unit, idempotencyKey, ledgerNotes]
      );
    }
    await syncShoppingList(client, userId, ownerToday);
    return pantryItemId;
  });
}

export async function updatePantryItem(
  userId: string,
  itemId: string,
  patch: PantryItemPatch,
  idempotencyKey: string
): Promise<boolean> {
  return withTransaction(userId, async (client, ownerToday) => {
    const { rows } = await client.query<{
      quantity: number;
      unit: CoachPlanningUnit;
    }>(
      `SELECT quantity::float8 AS quantity, unit
         FROM coach_pantry_items
        WHERE id = $1 AND user_id = $2
        FOR UPDATE`,
      [itemId, userId]
    );
    const current = rows[0];
    if (!current) return false;
    const nextQuantity = patch.quantity ?? current.quantity;
    const delta = nextQuantity - current.quantity;
    const expiresOnIsSet =
      patch.expiresOn !== undefined &&
      Object.prototype.hasOwnProperty.call(patch, 'expiresOn');
    const preferredRetailerIsSet =
      patch.preferredRetailer !== undefined &&
      Object.prototype.hasOwnProperty.call(patch, 'preferredRetailer');
    const preferredProductIdIsSet =
      patch.preferredProductId !== undefined &&
      Object.prototype.hasOwnProperty.call(patch, 'preferredProductId');
    await client.query(
      `UPDATE coach_pantry_items SET
         name = COALESCE($3, name),
         category = COALESCE($4, category),
         quantity = $5,
         minimum_quantity = COALESCE($6, minimum_quantity),
         expires_on = CASE WHEN $7 THEN $8::date ELSE expires_on END,
         preferred_retailer = CASE WHEN $9 THEN $10 ELSE preferred_retailer END,
         preferred_retailer_product_id = CASE
           WHEN $11 THEN $12
           ELSE preferred_retailer_product_id
         END,
         is_active = TRUE,
         updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [
        itemId,
        userId,
        patch.name ?? null,
        patch.category ?? null,
        nextQuantity,
        patch.minQuantity ?? null,
        expiresOnIsSet,
        patch.expiresOn ?? null,
        preferredRetailerIsSet,
        patch.preferredRetailer ?? null,
        preferredProductIdIsSet,
        patch.preferredProductId ?? null,
      ]
    );
    if (delta !== 0) {
      await client.query(
        `INSERT INTO coach_pantry_events (
           user_id, pantry_item_id, event_type, delta_quantity, unit,
           source, idempotency_key, notes
         ) VALUES ($1, $2, 'adjust', $3, $4, 'manual', $5, 'Manual stock correction')`,
        [userId, itemId, delta, current.unit, idempotencyKey]
      );
    }
    await syncShoppingList(client, userId, ownerToday);
    return true;
  });
}

export async function archivePantryItem(
  userId: string,
  itemId: string
): Promise<boolean> {
  return withTransaction(userId, async (client, ownerToday) => {
    const { rows } = await client.query<{ quantity: number }>(
      `SELECT quantity::float8 AS quantity
         FROM coach_pantry_items
        WHERE id = $1 AND user_id = $2
        FOR UPDATE`,
      [itemId, userId]
    );
    const pantryItem = rows[0];
    if (!pantryItem) return false;
    const { rows: reservationRows } = await client.query<{ reserved: number }>(
      `SELECT COALESCE(SUM(ingredient.quantity), 0)::float8 AS reserved
       FROM coach_meal_plan_ingredients ingredient
       JOIN coach_meal_plan_entries entry
         ON entry.id = ingredient.meal_plan_entry_id
        AND entry.user_id = ingredient.user_id
       JOIN coach_pantry_items pantry
         ON pantry.id = ingredient.pantry_item_id
        AND pantry.user_id = ingredient.user_id
      WHERE ingredient.pantry_item_id = $1
        AND ingredient.user_id = $2
        AND entry.status = 'planned'
        AND entry.plan_date >= $3::date
        AND (pantry.expires_on IS NULL
             OR pantry.expires_on >= entry.plan_date)`,
      [itemId, userId, ownerToday]
    );
    const item = {
      quantity: pantryItem.quantity,
      reserved: reservationRows[0]?.reserved ?? 0,
    };
    if (item.quantity > 0 || item.reserved > 0) {
      throw new CoachMealPlanningConflictError(
        'Only empty, unreserved pantry items can be removed.',
        { quantity: item.quantity, reservedQuantity: item.reserved }
      );
    }
    await client.query(
      `UPDATE coach_pantry_items
          SET is_active = FALSE, updated_at = now()
        WHERE id = $1 AND user_id = $2`,
      [itemId, userId]
    );
    return true;
  });
}

export async function createManualShoppingItem(
  userId: string,
  input: ShoppingItemInput
): Promise<string> {
  return withTransaction(userId, async (client, ownerToday) => {
    let list = await findOpenShoppingList(client, userId);
    if (!list) list = await createOpenShoppingList(client, userId, null, null);
    const product = input.product;
    const { rows: currentRows } = await client.query<{
      id: string;
      purchased_quantity: number;
    }>(
      `SELECT id, purchased_quantity::float8 AS purchased_quantity
         FROM coach_shopping_list_items
        WHERE user_id = $1 AND shopping_list_id = $2
          AND ingredient_key = $3 AND unit = $4
        ORDER BY is_manual DESC, created_at
        LIMIT 1
        FOR UPDATE`,
      [userId, list.id, input.ingredientKey, input.unit]
    );
    const current = currentRows[0];
    if (current && input.requiredQuantity < current.purchased_quantity) {
      throw new CoachMealPlanningConflictError(
        'Required quantity cannot be lower than the quantity already purchased.'
      );
    }
    let itemId: string;
    if (current) {
      itemId = current.id;
      await client.query(
        `UPDATE coach_shopping_list_items
            SET name = $3,
                required_quantity = $4,
                category = $5,
                status = CASE
                  WHEN purchased_quantity >= $4 THEN 'purchased'
                  ELSE 'needed'
                END,
                is_manual = TRUE,
                quantity_locked = TRUE,
                notes = $6,
                selected_product_retailer = $7,
                selected_product_retailer_id = $8,
                selected_product_gtin = $9,
                selected_product_name = $10,
                selected_product_package_quantity = $11,
                selected_product_package_unit = $12,
                selected_product_direct_url = $13,
                selected_product_verified_at = $14::timestamptz,
                selected_product_note = $15,
                updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [
          itemId,
          userId,
          input.name,
          input.requiredQuantity,
          input.category,
          input.notes,
          product?.retailer ?? null,
          product?.productId ?? null,
          product?.gtin ?? null,
          product?.name ?? null,
          product?.packageQuantity ?? null,
          product?.packageUnit ?? null,
          product?.url ?? null,
          product?.verifiedAt ?? null,
          product?.note ?? null,
        ]
      );
    } else {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO coach_shopping_list_items (
           user_id, shopping_list_id, ingredient_key, name,
           required_quantity, purchased_quantity, unit, category, status,
           is_manual, quantity_locked, notes, source_entry_ids,
           selected_product_retailer, selected_product_retailer_id,
           selected_product_gtin, selected_product_name,
           selected_product_package_quantity, selected_product_package_unit,
           selected_product_direct_url, selected_product_verified_at,
           selected_product_note
         ) VALUES (
           $1, $2, $3, $4, $5, 0, $6, $7, 'needed', TRUE, TRUE, $8,
           ARRAY[]::uuid[], $9, $10, $11, $12, $13, $14, $15,
           $16::timestamptz, $17
         )
         RETURNING id`,
        [
          userId,
          list.id,
          input.ingredientKey,
          input.name,
          input.requiredQuantity,
          input.unit,
          input.category,
          input.notes,
          product?.retailer ?? null,
          product?.productId ?? null,
          product?.gtin ?? null,
          product?.name ?? null,
          product?.packageQuantity ?? null,
          product?.packageUnit ?? null,
          product?.url ?? null,
          product?.verifiedAt ?? null,
          product?.note ?? null,
        ]
      );
      itemId = rows[0].id;
    }
    await syncShoppingList(client, userId, ownerToday);
    return itemId;
  });
}

export async function updateShoppingItem(
  userId: string,
  itemId: string,
  patch: ShoppingItemPatch
): Promise<boolean> {
  return withTransaction(userId, async (client, ownerToday) => {
    const { rows } = await client.query<{ purchased_quantity: number }>(
      `SELECT purchased_quantity::float8 AS purchased_quantity
         FROM coach_shopping_list_items item
         JOIN coach_shopping_lists list
           ON list.id = item.shopping_list_id AND list.user_id = item.user_id
        WHERE item.id = $1 AND item.user_id = $2 AND list.status = 'open'
        FOR UPDATE OF item`,
      [itemId, userId]
    );
    const item = rows[0];
    if (!item) return false;
    if (
      patch.requiredQuantity !== undefined &&
      patch.requiredQuantity < item.purchased_quantity
    ) {
      throw new CoachMealPlanningConflictError(
        'Required quantity cannot be lower than the quantity already purchased.'
      );
    }
    const product = patch.product;
    await client.query(
      `UPDATE coach_shopping_list_items SET
         name = COALESCE($3, name),
         category = COALESCE($4, category),
         required_quantity = COALESCE($5, required_quantity),
         quantity_locked = COALESCE($6, quantity_locked),
         status = CASE
           WHEN $7::text IS NOT NULL THEN $7
           WHEN $5::numeric IS NULL THEN status
           WHEN purchased_quantity >= $5 THEN 'purchased'
           ELSE 'needed'
         END,
         notes = CASE WHEN $8 THEN $9 ELSE notes END,
         selected_product_retailer = CASE
           WHEN $10 THEN $11 ELSE selected_product_retailer
         END,
         selected_product_retailer_id = CASE
           WHEN $10 THEN $12 ELSE selected_product_retailer_id
         END,
         selected_product_gtin = CASE
           WHEN $10 THEN $13 ELSE selected_product_gtin
         END,
         selected_product_name = CASE
           WHEN $10 THEN $14 ELSE selected_product_name
         END,
         selected_product_package_quantity = CASE
           WHEN $10 THEN $15 ELSE selected_product_package_quantity
         END,
         selected_product_package_unit = CASE
           WHEN $10 THEN $16 ELSE selected_product_package_unit
         END,
         selected_product_direct_url = CASE
           WHEN $10 THEN $17 ELSE selected_product_direct_url
         END,
         selected_product_verified_at = CASE
           WHEN $10 THEN $18::timestamptz ELSE selected_product_verified_at
         END,
         selected_product_note = CASE
           WHEN $10 THEN $19 ELSE selected_product_note
         END,
         updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [
        itemId,
        userId,
        patch.name ?? null,
        patch.category ?? null,
        patch.requiredQuantity ?? null,
        patch.quantityLocked ?? null,
        patch.status ?? null,
        Object.prototype.hasOwnProperty.call(patch, 'notes'),
        patch.notes ?? null,
        Object.prototype.hasOwnProperty.call(patch, 'product'),
        product?.retailer ?? null,
        product?.productId ?? null,
        product?.gtin ?? null,
        product?.name ?? null,
        product?.packageQuantity ?? null,
        product?.packageUnit ?? null,
        product?.url ?? null,
        product?.verifiedAt ?? null,
        product?.note ?? null,
      ]
    );
    await syncShoppingList(client, userId, ownerToday);
    return true;
  });
}

export async function skipShoppingItem(
  userId: string,
  itemId: string
): Promise<boolean> {
  return updateShoppingItem(userId, itemId, {
    status: 'skipped',
    quantityLocked: true,
  });
}

export async function confirmPurchases(
  userId: string,
  operationId: string,
  purchases: readonly PurchaseInput[]
): Promise<void> {
  const { fingerprint, sorted } = purchaseBatchFingerprint(purchases);
  const batchMarker = `${PURCHASE_BATCH_NOTE_PREFIX}${fingerprint}`;
  const operationPrefix = `purchase:${operationId}:`;
  await withTransaction(userId, async (client, ownerToday) => {
    const { rows: priorEvents } = await client.query<{
      idempotency_key: string;
      notes: string | null;
    }>(
      `SELECT idempotency_key, notes
         FROM coach_pantry_events
        WHERE user_id = $1 AND source = 'shopping'
          AND left(idempotency_key, char_length($2)) = $2
        ORDER BY idempotency_key`,
      [userId, operationPrefix]
    );
    if (priorEvents.length > 0) {
      const expectedEventKeys = new Set(
        sorted.map((purchase) => `${operationPrefix}${purchase.itemId}`)
      );
      const isIdenticalRetry =
        priorEvents.length === expectedEventKeys.size &&
        priorEvents.every(
          (event) =>
            expectedEventKeys.has(event.idempotency_key) &&
            event.notes?.startsWith(batchMarker) === true
        );
      if (!isIdenticalRetry) {
        throw new CoachMealPlanningConflictError(
          'The purchase operation id was already used with a different purchase batch.'
        );
      }
      return;
    }
    for (const purchase of sorted) {
      const eventKey = `${operationPrefix}${purchase.itemId}`;
      const { rows } = await client.query<ShoppingListItemRow>(
        `SELECT item.id, item.shopping_list_id AS list_id,
                item.ingredient_key, item.name, item.category,
                item.required_quantity::float8 AS needed_quantity,
                item.purchased_quantity::float8 AS purchased_quantity,
                item.unit, item.status, item.is_manual, item.quantity_locked,
                item.source_entry_ids::text[] AS source_meal_entry_ids,
                item.selected_product_retailer AS selected_retailer,
                item.selected_product_retailer_id AS selected_product_id,
                item.selected_product_gtin,
                item.selected_product_name AS product_name,
                item.selected_product_direct_url AS product_url,
                item.selected_product_package_quantity::float8
                  AS package_quantity,
                item.selected_product_package_unit AS package_unit,
                item.selected_product_verified_at AS product_verified_at,
                item.selected_product_note AS product_note,
                item.notes, item.created_at, item.updated_at
           FROM coach_shopping_list_items item
           JOIN coach_shopping_lists list
             ON list.id = item.shopping_list_id
            AND list.user_id = item.user_id
          WHERE item.id = $1 AND item.user_id = $2 AND list.status = 'open'
          FOR UPDATE OF item`,
        [purchase.itemId, userId]
      );
      const item = rows[0];
      if (!item || item.status === 'skipped' || item.status === 'purchased') {
        throw new CoachMealPlanningConflictError(
          `Shopping item ${purchase.itemId} is not available for purchase.`
        );
      }
      const pantryItemId = await upsertEmptyPantryItem(client, userId, {
        ingredientKey: item.ingredient_key,
        name: item.name,
        category: item.category,
        unit: item.unit,
      });
      const { rows: pantryStateRows } = await client.query<{
        quantity: number;
        is_expired: boolean;
      }>(
        `SELECT quantity::float8 AS quantity,
                (expires_on IS NOT NULL AND expires_on < $3::date)
                  AS is_expired
           FROM coach_pantry_items
          WHERE id = $1 AND user_id = $2
          FOR UPDATE`,
        [pantryItemId, userId, ownerToday]
      );
      const pantryState = pantryStateRows[0];
      if (!pantryState) {
        throw new Error(
          `Pantry item ${pantryItemId} disappeared during purchase.`
        );
      }
      if (pantryState.is_expired && pantryState.quantity > 0) {
        await client.query(
          `INSERT INTO coach_pantry_events (
             user_id, pantry_item_id, event_type, delta_quantity, unit,
             source, source_id, idempotency_key, notes
           ) VALUES ($1, $2, 'spoil', $3, $4, 'shopping', $5, $6, $7)`,
          [
            userId,
            pantryItemId,
            -pantryState.quantity,
            item.unit,
            item.id,
            `spoil:${operationId}:${item.id}`,
            'Expired stock discarded before adding a fresh purchase.',
          ]
        );
      }
      await client.query(
        `UPDATE coach_pantry_items
            SET quantity = CASE
                  WHEN $6 THEN $3
                  ELSE quantity + $3
                END,
                expires_on = CASE WHEN $6 THEN NULL ELSE expires_on END,
                is_active = TRUE,
                updated_at = now(),
                preferred_retailer = COALESCE($4, preferred_retailer),
                preferred_retailer_product_id = COALESCE(
                  $5,
                  preferred_retailer_product_id
                )
          WHERE id = $1 AND user_id = $2`,
        [
          pantryItemId,
          userId,
          purchase.quantity,
          item.selected_retailer,
          item.selected_product_id,
          pantryState.is_expired,
        ]
      );
      await client.query(
        `INSERT INTO coach_pantry_events (
           user_id, pantry_item_id, event_type, delta_quantity, unit,
           source, source_id, idempotency_key, notes
         ) VALUES ($1, $2, 'purchase', $3, $4, 'shopping', $5, $6, $7)`,
        [
          userId,
          pantryItemId,
          purchase.quantity,
          item.unit,
          item.id,
          eventKey,
          purchaseBatchNote(fingerprint, item.product_name),
        ]
      );
      await client.query(
        `UPDATE coach_shopping_list_items
            SET purchased_quantity = purchased_quantity + $3,
                status = CASE
                  WHEN purchased_quantity + $3 >= required_quantity
                    THEN 'purchased'
                  ELSE 'needed'
                END,
                updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [item.id, userId, purchase.quantity]
      );
    }
    await syncShoppingList(client, userId, ownerToday);
  });
}

export async function generatePlan(
  userId: string,
  input: PlanGenerationInput
): Promise<PlanGenerationResult> {
  return withTransaction(userId, async (client, ownerToday) => {
    const existing = await findPlanGeneration(
      client,
      userId,
      input.operationId,
      input
    );
    if (existing) return { ...existing, created: false };
    if (input.replaceExisting) {
      await client.query(
        `UPDATE coach_meal_plan_entries
            SET status = 'replaced',
                notes = COALESCE(notes || E'\n', '') || 'Replaced by regenerated plan.',
                updated_at = now()
          WHERE user_id = $1
            AND plan_date BETWEEN $2::date AND $3::date
            AND status = 'planned'`,
        [userId, input.startDate, input.endDate]
      );
    }
    const { rows: planRows } = await client.query<{ id: string }>(
      `INSERT INTO coach_meal_plans (
       user_id, start_date, end_date, status, source, algorithm_version,
       generation_key, warnings
       ) VALUES ($1, $2::date, $3::date, 'active', 'coach', $4, $5, $6::text[])
       RETURNING id`,
      [
        userId,
        input.startDate,
        input.endDate,
        input.algorithmVersion,
        input.operationId,
        [planRequestMarker(input), ...input.warnings],
      ]
    );
    const planId = planRows[0].id;
    const entryIds: string[] = [];
    for (const entry of input.entries) {
      const { rows: occupied } = await client.query<{ id: string }>(
        `SELECT id FROM coach_meal_plan_entries
          WHERE user_id = $1 AND plan_date = $2::date
            AND slot = $3 AND status <> 'replaced'
          LIMIT 1`,
        [userId, entry.planDate, entry.mealSlot]
      );
      if (occupied[0]) {
        throw new CoachMealPlanningConflictError(
          'A meal-plan slot changed while the plan was being generated. Please retry.',
          { planDate: entry.planDate, mealSlot: entry.mealSlot }
        );
      }
      entryIds.push(await insertPlanEntry(client, userId, planId, entry));
    }
    await syncShoppingList(client, userId, ownerToday);
    return { planId, created: true, entryIds, warnings: input.warnings };
  });
}

export async function applyPlanEntryAction(
  userId: string,
  entryId: string,
  action: 'prepared' | 'eaten_out' | 'skipped',
  operationId: string,
  notes: string | null
): Promise<CoachMealPlanEntryStatus | null> {
  return withTransaction(userId, async (client, ownerToday) => {
    const { rows } = await client.query<{
      id: string;
      status: CoachMealPlanEntryStatus;
      plan_date: string;
    }>(
      `SELECT id, status, plan_date::text AS plan_date
         FROM coach_meal_plan_entries
        WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [entryId, userId]
    );
    const entry = rows[0];
    if (!entry) return null;
    if (entry.status === action) return entry.status;
    if (entry.status !== 'planned') {
      throw new CoachMealPlanningConflictError(
        `A ${entry.status} meal can no longer be changed.`
      );
    }
    if (action === 'prepared') {
      const { rows: ingredients } = await client.query<
        MealPlanIngredientRow & { entry_id: string }
      >(
        `SELECT id, meal_plan_entry_id AS entry_id, pantry_item_id,
                ingredient_key, name, category,
                quantity::float8 AS quantity, unit, shopping_required
           FROM coach_meal_plan_ingredients
          WHERE meal_plan_entry_id = $1 AND user_id = $2
            AND shopping_required = TRUE
          ORDER BY pantry_item_id
          FOR UPDATE`,
        [entryId, userId]
      );
      const shortages: Array<{
        name: string;
        required: number;
        available: number;
        unit: CoachPlanningUnit;
      }> = [];
      const requirementsByPantryItem = new Map<
        string,
        {
          name: string;
          required: number;
          unit: CoachPlanningUnit;
        }
      >();
      for (const ingredient of ingredients) {
        if (!ingredient.pantry_item_id) {
          shortages.push({
            name: ingredient.name,
            required: ingredient.quantity,
            available: 0,
            unit: ingredient.unit,
          });
          continue;
        }
        const existing = requirementsByPantryItem.get(
          ingredient.pantry_item_id
        );
        requirementsByPantryItem.set(ingredient.pantry_item_id, {
          name: existing?.name ?? ingredient.name,
          required: (existing?.required ?? 0) + ingredient.quantity,
          unit: ingredient.unit,
        });
      }
      for (const [pantryItemId, requirement] of requirementsByPantryItem) {
        const { rows: pantryRows } = await client.query<{
          quantity: number;
          usable_on_relevant_date: boolean;
        }>(
          `SELECT quantity::float8 AS quantity,
                  (
                    expires_on IS NULL
                    OR expires_on >= GREATEST($3::date, $4::date)
                  ) AS usable_on_relevant_date
             FROM coach_pantry_items
            WHERE id = $1 AND user_id = $2
            FOR UPDATE`,
          [pantryItemId, userId, entry.plan_date, ownerToday]
        );
        const pantryRow = pantryRows[0];
        const available = pantryRow?.usable_on_relevant_date
          ? pantryRow.quantity
          : 0;
        if (available < requirement.required) {
          shortages.push({
            name: requirement.name,
            required: requirement.required,
            available,
            unit: requirement.unit,
          });
        }
      }
      if (shortages.length > 0) {
        throw new CoachMealPlanningConflictError(
          'The pantry does not contain enough ingredients for this meal.',
          { shortages }
        );
      }
      for (const ingredient of ingredients) {
        if (!ingredient.pantry_item_id) continue;
        await client.query(
          `UPDATE coach_pantry_items
              SET quantity = quantity - $3, updated_at = now()
            WHERE id = $1 AND user_id = $2`,
          [ingredient.pantry_item_id, userId, ingredient.quantity]
        );
        await client.query(
          `INSERT INTO coach_pantry_events (
             user_id, pantry_item_id, event_type, delta_quantity, unit,
             source, source_id, idempotency_key, notes
           ) VALUES ($1, $2, 'consume', $3, $4, 'meal_plan', $5, $6, $7)`,
          [
            userId,
            ingredient.pantry_item_id,
            -ingredient.quantity,
            ingredient.unit,
            entryId,
            `consume:${operationId}:${entryId}:${ingredient.id}`,
            ingredient.name,
          ]
        );
      }
    }
    await client.query(
      `UPDATE coach_meal_plan_entries
          SET status = $3,
              notes = CASE WHEN $4::text IS NULL THEN notes ELSE $4 END,
              updated_at = now()
        WHERE id = $1 AND user_id = $2`,
      [entryId, userId, action, notes]
    );
    await syncShoppingList(client, userId, ownerToday);
    return action;
  });
}

export async function replacePlanEntry(
  userId: string,
  entryId: string,
  operationId: string,
  replacement: PlanEntryInput
): Promise<{ entryId: string; created: boolean } | null> {
  return withTransaction(userId, async (client, ownerToday) => {
    const { rows } = await client.query<{
      id: string;
      plan_id: string;
      status: CoachMealPlanEntryStatus;
      plan_date: string;
      meal_slot: CoachMealSlot;
      notes: string | null;
    }>(
      `SELECT id, meal_plan_id AS plan_id, status, plan_date,
              slot AS meal_slot, notes
         FROM coach_meal_plan_entries
        WHERE id = $1 AND user_id = $2
        FOR UPDATE`,
      [entryId, userId]
    );
    const oldEntry = rows[0];
    if (!oldEntry) return null;
    const operationMarker = replacementOperationMarker(operationId);
    const recipeMarker = replacementRecipeMarker(replacement.recipeKey);
    if (oldEntry.status === 'replaced') {
      const { rows: replacements } = await client.query<{
        id: string;
        recipe_key: string;
      }>(
        `SELECT id, recipe_key FROM coach_meal_plan_entries
          WHERE user_id = $1 AND replacement_for_id = $2
          ORDER BY created_at DESC LIMIT 1`,
        [userId, entryId]
      );
      const existing = replacements[0];
      if (!existing) {
        throw new CoachMealPlanningConflictError(
          'The original meal was replaced but its replacement is unavailable.'
        );
      }
      if (
        !notesContainLine(oldEntry.notes, operationMarker) ||
        !notesContainLine(oldEntry.notes, recipeMarker) ||
        existing.recipe_key !== replacement.recipeKey
      ) {
        throw new CoachMealPlanningConflictError(
          'The replacement operation id was already used with a different operation or recipe.'
        );
      }
      return { entryId: existing.id, created: false };
    }
    if (oldEntry.status !== 'planned') {
      throw new CoachMealPlanningConflictError(
        `A ${oldEntry.status} meal can no longer be replaced.`
      );
    }
    const { rows: reusedOperations } = await client.query<{ id: string }>(
      `SELECT id
         FROM coach_meal_plan_entries
        WHERE user_id = $1
          AND position($2 in COALESCE(notes, '')) > 0
        LIMIT 1`,
      [userId, operationMarker]
    );
    if (reusedOperations[0]) {
      throw new CoachMealPlanningConflictError(
        'The replacement operation id was already used for another meal.'
      );
    }
    await client.query(
      `UPDATE coach_meal_plan_entries
          SET status = 'replaced', updated_at = now(),
              notes = COALESCE(notes || E'\n', '') || $3 || E'\n' || $4
        WHERE id = $1 AND user_id = $2`,
      [entryId, userId, operationMarker, recipeMarker]
    );
    const replacementEntry: PlanEntryInput = {
      ...replacement,
      planDate: oldEntry.plan_date,
      mealSlot: oldEntry.meal_slot,
      replacementForEntryId: entryId,
    };
    const newEntryId = await insertPlanEntry(
      client,
      userId,
      oldEntry.plan_id,
      replacementEntry
    );
    await syncShoppingList(client, userId, ownerToday);
    return { entryId: newEntryId, created: true };
  });
}

export async function listOccupiedPlanSlots(
  userId: string,
  startDate: string,
  endDate: string
): Promise<Array<{ plan_date: string; meal_slot: CoachMealSlot }>> {
  return withClient(userId, async (client) => {
    const { rows } = await client.query<{
      plan_date: string;
      meal_slot: CoachMealSlot;
    }>(
      `SELECT plan_date, slot AS meal_slot
         FROM coach_meal_plan_entries
        WHERE user_id = $1 AND plan_date BETWEEN $2::date AND $3::date
          AND status = 'planned'`,
      [userId, startDate, endDate]
    );
    return rows;
  });
}

export default {
  listPantryItems,
  listMealPlanEntries,
  getMealPlanEntry,
  getOpenShoppingList,
  createPantryItem,
  updatePantryItem,
  archivePantryItem,
  createManualShoppingItem,
  updateShoppingItem,
  skipShoppingItem,
  confirmPurchases,
  getPlanGenerationResult,
  generatePlan,
  applyPlanEntryAction,
  replacePlanEntry,
  listOccupiedPlanSlots,
};
