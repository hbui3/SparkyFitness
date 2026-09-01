import { describe, expect, it } from 'vitest';
import {
  coachMealPlanEntriesSchema,
  coachMealPlanIngredientsSchema,
  coachMealPlanningDashboardQuerySchema,
  coachMealPlanningDashboardResponseSchema,
  coachMealPlanActionRequestSchema,
  coachMealPlansSchema,
  coachPantryEventsSchema,
  coachPantryItemsSchema,
  coachShoppingListItemsSchema,
  coachShoppingListsSchema,
  confirmCoachShoppingPurchaseRequestSchema,
  createCoachPantryItemRequestSchema,
  createCoachShoppingItemRequestSchema,
  generateCoachMealPlanRequestSchema,
  patchCoachPantryItemRequestSchema,
  patchCoachShoppingItemRequestSchema,
  replaceCoachMealPlanEntryRequestSchema,
  retailProductRefSchema,
} from '@workspace/shared';

const USER_ID = '00000000-0000-4000-a000-000000000001';
const PANTRY_ID = '00000000-0000-4000-a000-000000000002';
const EVENT_ID = '00000000-0000-4000-a000-000000000003';
const SHOPPING_LIST_ID = '00000000-0000-4000-a000-000000000004';
const SHOPPING_ITEM_ID = '00000000-0000-4000-a000-000000000005';
const MEAL_PLAN_ID = '00000000-0000-4000-a000-000000000006';
const MEAL_ENTRY_ID = '00000000-0000-4000-a000-000000000007';
const INGREDIENT_ID = '00000000-0000-4000-a000-000000000008';
const OPERATION_ID = '00000000-0000-4000-a000-000000000009';
const NOW = '2026-09-01T10:00:00.000Z';

const coopProduct = {
  retailer: 'coop' as const,
  retailerProductId: '6568630',
  gtin: null,
  name: 'Prix Garantie Magerquark',
  packageQuantity: 500,
  packageUnit: 'g' as const,
  directUrl:
    'https://www.coop.ch/de/lebensmittel/milchprodukte-eier/quark/quark-nature/prix-garantie-magerquark/p/6568630',
  verifiedAt: NOW,
  note: null,
};

const pantryRow = {
  id: PANTRY_ID,
  user_id: USER_ID,
  ingredient_key: 'magerquark',
  name: 'Magerquark',
  quantity: 500,
  minimum_quantity: 250,
  unit: 'g' as const,
  category: 'chilled' as const,
  preferred_retailer: 'coop' as const,
  preferred_retailer_product_id: '6568630',
  expires_on: '2026-09-05',
  is_active: true,
  created_at: new Date(NOW),
  updated_at: new Date(NOW),
};

const pantryEventRow = {
  id: EVENT_ID,
  user_id: USER_ID,
  pantry_item_id: PANTRY_ID,
  event_type: 'purchase' as const,
  delta_quantity: 500,
  unit: 'g' as const,
  source: 'shopping' as const,
  source_id: SHOPPING_ITEM_ID,
  idempotency_key: `${OPERATION_ID}:${SHOPPING_ITEM_ID}`,
  notes: null,
  created_at: new Date(NOW),
};

const shoppingListRow = {
  id: SHOPPING_LIST_ID,
  user_id: USER_ID,
  title: 'Wocheneinkauf',
  coverage_start: '2026-09-01',
  coverage_end: '2026-09-07',
  status: 'open' as const,
  completed_at: null,
  created_at: new Date(NOW),
  updated_at: new Date(NOW),
};

const shoppingItemRow = {
  id: SHOPPING_ITEM_ID,
  user_id: USER_ID,
  shopping_list_id: SHOPPING_LIST_ID,
  ingredient_key: 'magerquark',
  name: 'Magerquark',
  required_quantity: 500,
  purchased_quantity: 0,
  unit: 'g' as const,
  category: 'chilled' as const,
  status: 'needed' as const,
  is_manual: false,
  quantity_locked: false,
  notes: null,
  source_entry_ids: [MEAL_ENTRY_ID],
  selected_product_retailer: 'coop' as const,
  selected_product_retailer_id: '6568630',
  selected_product_gtin: null,
  selected_product_name: 'Prix Garantie Magerquark',
  selected_product_package_quantity: 500,
  selected_product_package_unit: 'g' as const,
  selected_product_direct_url: coopProduct.directUrl,
  selected_product_verified_at: new Date(NOW),
  selected_product_note: null,
  created_at: new Date(NOW),
  updated_at: new Date(NOW),
};

const mealPlanRow = {
  id: MEAL_PLAN_ID,
  user_id: USER_ID,
  start_date: '2026-09-01',
  end_date: '2026-09-07',
  status: 'active' as const,
  source: 'coach' as const,
  algorithm_version: 'meal-v1',
  generation_key: OPERATION_ID,
  warnings: ['Brokkoli vor dem Wochenende nachkaufen.'],
  created_at: new Date(NOW),
  updated_at: new Date(NOW),
};

const mealEntryRow = {
  id: MEAL_ENTRY_ID,
  user_id: USER_ID,
  meal_plan_id: MEAL_PLAN_ID,
  plan_date: '2026-09-01',
  slot: 'breakfast' as const,
  status: 'planned' as const,
  recipe_key: 'quark-oats',
  recipe_name: 'Magerquark mit Haferflocken',
  recipe_description: 'Ein schnelles proteinreiches Frühstück.',
  recipe_instructions: ['Quark und Haferflocken verrühren.'],
  prep_minutes: 5,
  servings: 1,
  calories_kcal: 420,
  protein_g: 42,
  carbs_g: 45,
  fat_g: 6,
  safety_status: 'validated' as const,
  replacement_for_id: null,
  notes: null,
  created_at: new Date(NOW),
  updated_at: new Date(NOW),
};

const ingredientRow = {
  id: INGREDIENT_ID,
  user_id: USER_ID,
  meal_plan_entry_id: MEAL_ENTRY_ID,
  pantry_item_id: PANTRY_ID,
  ingredient_key: 'magerquark',
  name: 'Magerquark',
  quantity: 250,
  unit: 'g' as const,
  category: 'chilled' as const,
  shopping_required: false,
  created_at: new Date(NOW),
  updated_at: new Date(NOW),
};

describe('coach meal-planning API schemas', () => {
  it('accepts a null GTIN and enforces an official retailer host', () => {
    expect(retailProductRefSchema.parse(coopProduct)).toEqual(coopProduct);

    expect(
      retailProductRefSchema.safeParse({
        ...coopProduct,
        directUrl: 'https://www.migros.ch/de/product/200803100000',
      }).success
    ).toBe(false);
    expect(
      retailProductRefSchema.safeParse({
        ...coopProduct,
        directUrl: 'https://coop.ch.example.test/product/6568630',
      }).success
    ).toBe(false);
  });

  it('keeps requests strict and reserves purchased quantity for confirmation', () => {
    expect(
      createCoachPantryItemRequestSchema.safeParse({
        name: 'Magerquark',
        quantity: 0,
        unit: 'g',
        category: 'chilled',
      }).success
    ).toBe(true);
    expect(
      createCoachShoppingItemRequestSchema.safeParse({
        name: 'Brokkoli',
        requiredQuantity: 750,
        unit: 'g',
        category: 'frozen',
      }).success
    ).toBe(true);
    expect(
      createCoachPantryItemRequestSchema.safeParse({
        name: 'Magerquark',
        quantity: 0,
        unit: 'g',
        category: 'chilled',
        unexpected: true,
      }).success
    ).toBe(false);
    expect(patchCoachPantryItemRequestSchema.safeParse({}).success).toBe(false);
    expect(patchCoachShoppingItemRequestSchema.safeParse({}).success).toBe(
      false
    );
    expect(
      patchCoachShoppingItemRequestSchema.safeParse({ purchasedQuantity: 1 })
        .success
    ).toBe(false);
  });

  it('requires a selected shopping product to use the item unit', () => {
    expect(
      createCoachShoppingItemRequestSchema.safeParse({
        name: 'Magerquark',
        requiredQuantity: 500,
        unit: 'g',
        category: 'chilled',
        selectedProduct: coopProduct,
      }).success
    ).toBe(true);

    const incompatible = createCoachShoppingItemRequestSchema.safeParse({
      name: 'Magerquark',
      requiredQuantity: 500,
      unit: 'ml',
      category: 'chilled',
      selectedProduct: coopProduct,
    });

    expect(incompatible.success).toBe(false);
    if (!incompatible.success) {
      expect(incompatible.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['selectedProduct', 'packageUnit'],
          }),
        ])
      );
    }
  });

  it('enforces day, range, and positive-quantity bounds', () => {
    expect(
      coachMealPlanningDashboardQuerySchema.safeParse({
        startDate: '2026-02-30',
        days: '5',
      }).success
    ).toBe(false);
    expect(
      coachMealPlanningDashboardQuerySchema.safeParse({
        startDate: '2026-09-01',
        days: '0',
      }).success
    ).toBe(false);
    expect(
      generateCoachMealPlanRequestSchema.safeParse({
        operationId: OPERATION_ID,
        startDate: '2026-09-01',
        days: 8,
        replaceExisting: false,
      }).success
    ).toBe(false);
    expect(
      createCoachPantryItemRequestSchema.safeParse({
        name: 'Magerquark',
        quantity: -1,
        unit: 'g',
        category: 'chilled',
      }).success
    ).toBe(false);
    expect(
      createCoachShoppingItemRequestSchema.safeParse({
        name: 'Brokkoli',
        requiredQuantity: 0,
        unit: 'g',
        category: 'frozen',
      }).success
    ).toBe(false);
    expect(
      confirmCoachShoppingPurchaseRequestSchema.safeParse({
        operationId: OPERATION_ID,
        purchases: [{ itemId: SHOPPING_ITEM_ID, quantity: 0 }],
      }).success
    ).toBe(false);
  });

  it('rejects duplicate shopping items within one purchase operation', () => {
    const parsed = confirmCoachShoppingPurchaseRequestSchema.safeParse({
      operationId: OPERATION_ID,
      purchases: [
        { itemId: SHOPPING_ITEM_ID, quantity: 250 },
        { itemId: SHOPPING_ITEM_ID, quantity: 250 },
      ],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['purchases', 1, 'itemId'],
        })
      );
    }
  });

  it('rejects an inverted shopping-list coverage range', () => {
    const parsed = coachMealPlanningDashboardResponseSchema.safeParse({
      startDate: '2026-09-01',
      days: 7,
      pantry: [],
      shoppingList: {
        id: SHOPPING_LIST_ID,
        title: 'Wocheneinkauf',
        coverageStart: '2026-09-07',
        coverageEnd: '2026-09-01',
        status: 'open',
        items: [],
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      planEntries: [],
      mealCatalog: [],
      warnings: [],
      lastUpdatedAt: NOW,
    });

    expect(parsed.success).toBe(false);
  });

  it('round-trips a complete dashboard response', () => {
    const recipe = {
      recipeKey: 'quark-oats',
      name: 'Magerquark mit Haferflocken',
      description: 'Ein schnelles proteinreiches Frühstück.',
      prepMinutes: 5,
      instructions: ['Quark und Haferflocken verrühren.'],
    };
    const dashboard = {
      startDate: '2026-09-01',
      days: 7,
      pantry: [
        {
          id: PANTRY_ID,
          ingredientKey: 'magerquark',
          name: 'Magerquark',
          quantity: 500,
          minimumQuantity: 250,
          reservedQuantity: 250,
          availableQuantity: 250,
          shortageQuantity: 0,
          unit: 'g',
          category: 'chilled',
          preferredRetailer: 'coop',
          preferredRetailerProductId: '6568630',
          expiresOn: '2026-09-05',
          isActive: true,
          productOptions: [coopProduct],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      shoppingList: {
        id: SHOPPING_LIST_ID,
        title: 'Wocheneinkauf',
        coverageStart: '2026-09-01',
        coverageEnd: '2026-09-07',
        status: 'open',
        items: [
          {
            id: SHOPPING_ITEM_ID,
            ingredientKey: 'magerquark',
            name: 'Magerquark',
            requiredQuantity: 500,
            purchasedQuantity: 0,
            remainingQuantity: 500,
            unit: 'g',
            category: 'chilled',
            status: 'needed',
            isManual: false,
            quantityLocked: false,
            notes: null,
            sourceEntryIds: [MEAL_ENTRY_ID],
            selectedProduct: coopProduct,
            productOptions: [coopProduct],
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      planEntries: [
        {
          id: MEAL_ENTRY_ID,
          mealPlanId: MEAL_PLAN_ID,
          date: '2026-09-01',
          slot: 'breakfast',
          status: 'planned',
          recipe,
          servings: 1,
          caloriesKcal: 420,
          proteinG: 42,
          carbsG: 45,
          fatG: 6,
          safetyStatus: 'validated',
          replacementForId: null,
          notes: null,
          ingredients: [
            {
              id: INGREDIENT_ID,
              pantryItemId: PANTRY_ID,
              ingredientKey: 'magerquark',
              name: 'Magerquark',
              quantity: 250,
              unit: 'g',
              category: 'chilled',
              shoppingRequired: false,
            },
          ],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      mealCatalog: [
        {
          recipe,
          slots: ['breakfast'],
          servings: 1,
          caloriesKcal: 420,
          proteinG: 42,
          carbsG: 45,
          fatG: 6,
          ingredients: [
            {
              ingredientKey: 'magerquark',
              name: 'Magerquark',
              quantity: 250,
              unit: 'g',
              category: 'chilled',
            },
          ],
        },
      ],
      warnings: ['Brokkoli vor dem Wochenende nachkaufen.'],
      lastUpdatedAt: NOW,
    };

    expect(coachMealPlanningDashboardResponseSchema.parse(dashboard)).toEqual(
      dashboard
    );
  });

  it('accepts the bounded meal-entry action and replacement requests', () => {
    expect(
      coachMealPlanActionRequestSchema.safeParse({
        operationId: OPERATION_ID,
        action: 'prepared',
      }).success
    ).toBe(true);
    expect(
      replaceCoachMealPlanEntryRequestSchema.safeParse({
        operationId: OPERATION_ID,
        recipeKey: 'quark-oats',
      }).success
    ).toBe(true);
  });
});

describe('coach meal-planning database row schemas', () => {
  const cases = [
    {
      name: 'coach_pantry_items',
      schema: coachPantryItemsSchema,
      row: pantryRow,
    },
    {
      name: 'coach_pantry_events',
      schema: coachPantryEventsSchema,
      row: pantryEventRow,
    },
    {
      name: 'coach_shopping_lists',
      schema: coachShoppingListsSchema,
      row: shoppingListRow,
    },
    {
      name: 'coach_shopping_list_items',
      schema: coachShoppingListItemsSchema,
      row: shoppingItemRow,
    },
    {
      name: 'coach_meal_plans',
      schema: coachMealPlansSchema,
      row: mealPlanRow,
    },
    {
      name: 'coach_meal_plan_entries',
      schema: coachMealPlanEntriesSchema,
      row: mealEntryRow,
    },
    {
      name: 'coach_meal_plan_ingredients',
      schema: coachMealPlanIngredientsSchema,
      row: ingredientRow,
    },
  ];

  it.each(cases)('$name accepts its exact row shape', ({ schema, row }) => {
    expect(schema.safeParse(row).success).toBe(true);
  });

  it.each(cases)('$name rejects database column drift', ({ schema, row }) => {
    expect(
      schema.safeParse({ ...row, unexpected_database_column: true }).success
    ).toBe(false);
  });

  it('requires a selected product URL on the matching official HTTPS retailer host', () => {
    expect(
      coachShoppingListItemsSchema.safeParse(shoppingItemRow).success
    ).toBe(true);
    expect(
      coachShoppingListItemsSchema.safeParse({
        ...shoppingItemRow,
        selected_product_direct_url: 'https://shop.coop.ch/de/product/6568630',
      }).success
    ).toBe(true);
    expect(
      coachShoppingListItemsSchema.safeParse({
        ...shoppingItemRow,
        selected_product_direct_url:
          'https://www.migros.ch/de/product/200803100000',
      }).success
    ).toBe(false);
    expect(
      coachShoppingListItemsSchema.safeParse({
        ...shoppingItemRow,
        selected_product_direct_url:
          'https://coop.ch.example.test/de/product/6568630',
      }).success
    ).toBe(false);
    expect(
      coachShoppingListItemsSchema.safeParse({
        ...shoppingItemRow,
        selected_product_direct_url: 'http://www.coop.ch/de/product/6568630',
      }).success
    ).toBe(false);
  });
});
