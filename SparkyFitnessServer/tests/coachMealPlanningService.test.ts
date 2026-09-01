import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetailProductRef } from '@workspace/shared';
import type {
  MealPlanEntryRow,
  PantryProjectionRow,
  ShoppingListItemRow,
  ShoppingListRow,
} from '../models/coachMealPlanningRepository.js';
import type { CoachMealSuggestion } from '../services/coachMealSuggestionService.js';

const repositoryMocks = vi.hoisted(() => ({
  listPantryItems: vi.fn(),
  listMealPlanEntries: vi.fn(),
  getOpenShoppingList: vi.fn(),
  createPantryItem: vi.fn(),
  updatePantryItem: vi.fn(),
  archivePantryItem: vi.fn(),
  createManualShoppingItem: vi.fn(),
  updateShoppingItem: vi.fn(),
  skipShoppingItem: vi.fn(),
  confirmPurchases: vi.fn(),
  listOccupiedPlanSlots: vi.fn(),
  getPlanGenerationResult: vi.fn(),
  generatePlan: vi.fn(),
  applyPlanEntryAction: vi.fn(),
  getMealPlanEntry: vi.fn(),
  replacePlanEntry: vi.fn(),
}));

const mealCatalogMocks = vi.hoisted(() => ({
  coachIngredientKey: vi.fn((name: string) =>
    name
      .toLocaleLowerCase('de')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  ),
  getCoachMealCatalog: vi.fn(),
  getCoachMealSuggestionById: vi.fn(),
  getCoachMealSuggestions: vi.fn(),
}));

const coachProfileMocks = vi.hoisted(() => ({
  getCoachProfile: vi.fn(),
}));

const coachProfileRepositoryMocks = vi.hoisted(() => ({
  getCoachLanguage: vi.fn(),
}));

const productCatalogMocks = vi.hoisted(() => ({
  getSwissRetailProductReferences: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock('../models/coachMealPlanningRepository.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../models/coachMealPlanningRepository.js')
    >();
  return { ...actual, default: repositoryMocks };
});

vi.mock('../services/coachMealSuggestionService.js', () => ({
  coachIngredientKey: mealCatalogMocks.coachIngredientKey,
  getCoachMealCatalog: mealCatalogMocks.getCoachMealCatalog,
  getCoachMealSuggestionById: mealCatalogMocks.getCoachMealSuggestionById,
  getCoachMealSuggestions: mealCatalogMocks.getCoachMealSuggestions,
}));

vi.mock('../services/coachProfileService.js', () => ({
  default: coachProfileMocks,
}));

vi.mock('../models/coachProfileRepository.js', () => ({
  default: coachProfileRepositoryMocks,
}));

vi.mock('../constants/swissRetailProductCatalog.js', () => ({
  getSwissRetailProductReferences:
    productCatalogMocks.getSwissRetailProductReferences,
}));

vi.mock('../services/coachEventService.js', () => ({
  default: eventMocks,
}));

import { CoachMealPlanningConflictError } from '../models/coachMealPlanningRepository.js';
import coachMealPlanningService, {
  CoachMealPlanningNotFoundError,
} from '../services/coachMealPlanningService.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const LIST_ID = '55555555-5555-4555-8555-555555555555';
const OPERATION_ID = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-09-01T12:00:00.000Z');

const coopRice: RetailProductRef = {
  retailer: 'coop',
  retailerProductId: '6554390',
  gtin: null,
  name: 'Prix Garantie Langkornreis Parboiled',
  packageQuantity: 1000,
  packageUnit: 'g',
  directUrl:
    'https://www.coop.ch/de/lebensmittel/vorraete/grundnahrungsmittel/reis/langkorn-vitamin-camolino/prix-garantie-langkornreis-parboiled/p/6554390',
  verifiedAt: '2026-09-01T00:00:00.000Z',
  note: null,
};

function pantryRow(
  overrides: Partial<PantryProjectionRow> = {}
): PantryProjectionRow {
  return {
    id: ITEM_ID,
    ingredient_key: 'reis',
    name: 'Reis',
    category: 'pantry',
    quantity: 500,
    reserved_quantity: 300,
    available_quantity: 200,
    shortage_quantity: 80,
    unit: 'g',
    min_quantity: 100,
    expires_on: null,
    preferred_retailer: 'coop',
    preferred_product_id: '6554390',
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function shoppingListRow(
  overrides: Partial<ShoppingListRow> = {}
): ShoppingListRow {
  return {
    id: LIST_ID,
    title: 'Einkauf für die nächsten Tage',
    status: 'open',
    coverage_start: '2026-09-01',
    coverage_end: '2026-09-03',
    completed_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function shoppingItemRow(
  overrides: Partial<ShoppingListItemRow> = {}
): ShoppingListItemRow {
  return {
    id: ITEM_ID,
    list_id: LIST_ID,
    ingredient_key: 'reis',
    name: 'Reis',
    category: 'pantry',
    needed_quantity: 500,
    purchased_quantity: 200,
    unit: 'g',
    status: 'needed',
    is_manual: false,
    quantity_locked: false,
    source_meal_entry_ids: [ENTRY_ID],
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
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function planEntryRow(
  overrides: Partial<MealPlanEntryRow> = {}
): MealPlanEntryRow {
  return {
    id: ENTRY_ID,
    plan_id: PLAN_ID,
    plan_date: '2026-09-01',
    meal_slot: 'dinner',
    recipe_key: 'tofu-rice-bowl',
    recipe_name: 'Tofu-Reis-Bowl',
    servings: 1,
    status: 'planned',
    estimated_calories: 620,
    estimated_protein_g: 36,
    estimated_carbs_g: 72,
    estimated_fat_g: 18,
    preparation: 'Reis kochen und Tofu anbraten.',
    safety_status: 'validated',
    replacement_for_entry_id: null,
    notes: null,
    completed_at: null,
    created_at: NOW,
    updated_at: NOW,
    ingredients: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        pantry_item_id: ITEM_ID,
        ingredient_key: 'reis',
        name: 'Reis',
        category: 'pantry',
        quantity: 80,
        unit: 'g',
        shopping_required: true,
      },
    ],
    ...overrides,
  };
}

const breakfastMeal: CoachMealSuggestion = {
  id: 'quark-oats',
  nameDe: 'Magerquark-Hafer-Bowl',
  nameEn: 'Quark oat bowl',
  calories: 510,
  proteinG: 48,
  carbsG: 55,
  fatG: 10,
  mealSlots: ['breakfast'],
  ingredients: [
    {
      nameDe: 'Magerquark',
      nameEn: 'low-fat quark',
      amount: 300,
      unit: 'g',
      category: 'chilled',
    },
  ],
  preparationDe: 'Alles verrühren.',
  preparationEn: 'Mix everything.',
  shoppingServings: 2,
};

const mainMeal: CoachMealSuggestion = {
  id: 'tofu-rice-bowl',
  nameDe: 'Tofu-Reis-Bowl',
  nameEn: 'Tofu rice bowl',
  calories: 620,
  proteinG: 36,
  carbsG: 72,
  fatG: 18,
  mealSlots: ['lunch', 'dinner'],
  ingredients: [
    {
      nameDe: 'Reis',
      nameEn: 'rice',
      amount: 80,
      unit: 'g',
      category: 'pantry',
    },
    {
      nameDe: 'Naturtofu',
      nameEn: 'natural tofu',
      amount: 200,
      unit: 'g',
      category: 'chilled',
    },
  ],
  preparationDe: 'Reis kochen und Tofu anbraten.',
  preparationEn: 'Cook rice and fry tofu.',
  shoppingServings: 2,
};

describe('coach meal-planning service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    productCatalogMocks.getSwissRetailProductReferences.mockImplementation(
      (ingredientKey: string) => (ingredientKey === 'reis' ? [coopRice] : [])
    );
    repositoryMocks.listPantryItems.mockResolvedValue([]);
    repositoryMocks.listMealPlanEntries.mockResolvedValue([]);
    repositoryMocks.getOpenShoppingList.mockResolvedValue(null);
    repositoryMocks.listOccupiedPlanSlots.mockResolvedValue([]);
    repositoryMocks.getPlanGenerationResult.mockResolvedValue(null);
    mealCatalogMocks.getCoachMealCatalog.mockResolvedValue([]);
    mealCatalogMocks.getCoachMealSuggestions.mockResolvedValue([]);
    coachProfileMocks.getCoachProfile.mockResolvedValue({
      calorieTarget: null,
      proteinTargetG: null,
    });
    coachProfileRepositoryMocks.getCoachLanguage.mockResolvedValue('de-CH');
  });

  it('maps physical, reserved, and available stock plus verified products into the dashboard', async () => {
    repositoryMocks.listPantryItems.mockResolvedValue([pantryRow()]);
    repositoryMocks.listMealPlanEntries.mockResolvedValue([planEntryRow()]);
    repositoryMocks.getOpenShoppingList.mockResolvedValue({
      list: shoppingListRow(),
      items: [shoppingItemRow()],
    });
    mealCatalogMocks.getCoachMealCatalog.mockResolvedValue([mainMeal]);

    const dashboard = await coachMealPlanningService.getDashboard(
      USER_ID,
      '2026-09-01',
      3
    );

    expect(repositoryMocks.getOpenShoppingList).toHaveBeenCalledWith(USER_ID);
    expect(dashboard.pantry[0]).toEqual(
      expect.objectContaining({
        quantity: 500,
        minimumQuantity: 100,
        reservedQuantity: 300,
        availableQuantity: 200,
        shortageQuantity: 80,
        productOptions: [coopRice],
      })
    );
    expect(dashboard.shoppingList?.items[0]).toEqual(
      expect.objectContaining({
        requiredQuantity: 500,
        purchasedQuantity: 200,
        remainingQuantity: 300,
        selectedProduct: null,
        productOptions: [coopRice],
      })
    );
    expect(dashboard.planEntries[0]).toEqual(
      expect.objectContaining({
        date: '2026-09-01',
        slot: 'dinner',
        caloriesKcal: 620,
        proteinG: 36,
      })
    );
    expect(dashboard.mealCatalog[0]).toEqual(
      expect.objectContaining({
        slots: ['lunch', 'dinner'],
        caloriesKcal: 620,
        carbsG: 72,
        fatG: 18,
      })
    );
    expect(dashboard.warnings[0]).toContain('1 Artikel');
  });

  it('localizes dashboard warnings from the owner language and defaults non-German languages to English', async () => {
    repositoryMocks.listPantryItems.mockResolvedValue([
      pantryRow({ shortage_quantity: 80 }),
    ]);

    coachProfileRepositoryMocks.getCoachLanguage.mockResolvedValueOnce('en-US');
    const english = await coachMealPlanningService.getDashboard(
      USER_ID,
      '2026-09-01',
      3
    );
    coachProfileRepositoryMocks.getCoachLanguage.mockResolvedValueOnce('de-DE');
    const german = await coachMealPlanningService.getDashboard(
      USER_ID,
      '2026-09-01',
      3
    );

    expect(english.warnings).toEqual([
      expect.stringContaining('There is no meal plan yet'),
      expect.stringContaining('1 item is still missing'),
    ]);
    expect(german.warnings).toEqual([
      expect.stringContaining('noch kein Essensplan'),
      expect.stringContaining('1 Artikel'),
    ]);
  });

  it('stores only the canonical retailer selection for a pantry item', async () => {
    repositoryMocks.createPantryItem.mockResolvedValue(ITEM_ID);

    const id = await coachMealPlanningService.createPantryItem(USER_ID, {
      ingredientKey: 'reis',
      name: 'Reis',
      quantity: 1000,
      minimumQuantity: 200,
      unit: 'g',
      category: 'pantry',
      preferredProduct: {
        retailer: 'coop',
        retailerProductId: '6554390',
      },
      expiresOn: null,
    });

    expect(id).toBe(ITEM_ID);
    expect(repositoryMocks.createPantryItem).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        ingredientKey: 'reis',
        preferredRetailer: 'coop',
        preferredProductId: '6554390',
      }),
      expect.stringMatching(/^manual-create:/)
    );
    expect(eventMocks.publish).toHaveBeenCalledWith(USER_ID, 'coach');
  });

  it('rejects a retailer product that is not verified for the ingredient', async () => {
    await expect(
      coachMealPlanningService.createPantryItem(USER_ID, {
        ingredientKey: 'reis',
        name: 'Reis',
        quantity: 1000,
        minimumQuantity: 0,
        unit: 'g',
        category: 'pantry',
        preferredProduct: {
          retailer: 'migros',
          retailerProductId: 'unknown-product',
        },
        expiresOn: null,
      })
    ).rejects.toBeInstanceOf(CoachMealPlanningConflictError);
    expect(repositoryMocks.createPantryItem).not.toHaveBeenCalled();
  });

  it('replaces client product metadata with the verified catalog snapshot', async () => {
    repositoryMocks.createManualShoppingItem.mockResolvedValue(ITEM_ID);

    await coachMealPlanningService.createShoppingItem(USER_ID, {
      ingredientKey: 'reis',
      name: 'Reis',
      requiredQuantity: 1000,
      unit: 'g',
      category: 'pantry',
      notes: null,
      selectedProduct: {
        ...coopRice,
        name: 'Vom Client veränderter Name',
        directUrl: 'https://www.coop.ch/de/product/falscher-pfad',
      },
    });

    expect(repositoryMocks.createManualShoppingItem).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        product: expect.objectContaining({
          name: coopRice.name,
          url: coopRice.directUrl,
          productId: coopRice.retailerProductId,
        }),
      })
    );
  });

  it('rejects retailer products whose package unit differs from the shopping item unit on create and patch', async () => {
    const mismatchedProduct: RetailProductRef = {
      ...coopRice,
      packageQuantity: 1,
      packageUnit: 'piece',
    };
    productCatalogMocks.getSwissRetailProductReferences.mockReturnValue([
      mismatchedProduct,
    ]);
    repositoryMocks.getOpenShoppingList.mockResolvedValue({
      list: shoppingListRow(),
      items: [shoppingItemRow({ unit: 'g' })],
    });

    await expect(
      coachMealPlanningService.createShoppingItem(USER_ID, {
        ingredientKey: 'reis',
        name: 'Reis',
        requiredQuantity: 1000,
        unit: 'g',
        category: 'pantry',
        notes: null,
        selectedProduct: mismatchedProduct,
      })
    ).rejects.toBeInstanceOf(CoachMealPlanningConflictError);
    await expect(
      coachMealPlanningService.updateShoppingItem(USER_ID, ITEM_ID, {
        selectedProduct: mismatchedProduct,
      })
    ).rejects.toBeInstanceOf(CoachMealPlanningConflictError);

    expect(repositoryMocks.createManualShoppingItem).not.toHaveBeenCalled();
    expect(repositoryMocks.updateShoppingItem).not.toHaveBeenCalled();
  });

  it('keeps omitted and explicitly cleared retailer selections distinct', async () => {
    repositoryMocks.getOpenShoppingList.mockResolvedValue({
      list: shoppingListRow(),
      items: [shoppingItemRow()],
    });
    repositoryMocks.updateShoppingItem.mockResolvedValue(true);

    await coachMealPlanningService.updateShoppingItem(USER_ID, ITEM_ID, {
      notes: 'Für später',
    });
    await coachMealPlanningService.updateShoppingItem(USER_ID, ITEM_ID, {
      selectedProduct: null,
    });

    expect(repositoryMocks.updateShoppingItem).toHaveBeenNthCalledWith(
      1,
      USER_ID,
      ITEM_ID,
      { notes: 'Für später' }
    );
    expect(repositoryMocks.updateShoppingItem).toHaveBeenNthCalledWith(
      2,
      USER_ID,
      ITEM_ID,
      { product: null }
    );
  });

  it('generates only open meal slots and snapshots macros and ingredients', async () => {
    repositoryMocks.listPantryItems.mockResolvedValue([
      pantryRow({
        ingredient_key: 'reis',
        quantity: 1000,
        reserved_quantity: 0,
        available_quantity: 1000,
        shortage_quantity: 0,
      }),
    ]);
    repositoryMocks.listOccupiedPlanSlots.mockResolvedValue([
      { plan_date: '2026-09-01', meal_slot: 'lunch' },
    ]);
    mealCatalogMocks.getCoachMealCatalog.mockResolvedValue([
      breakfastMeal,
      mainMeal,
    ]);
    repositoryMocks.generatePlan.mockResolvedValue({
      planId: PLAN_ID,
      created: true,
      entryIds: [ENTRY_ID, ITEM_ID],
      warnings: [],
    });

    const result = await coachMealPlanningService.generateMealPlan(USER_ID, {
      operationId: OPERATION_ID,
      startDate: '2026-09-01',
      days: 1,
      replaceExisting: false,
    });

    expect(result).toEqual({
      planId: PLAN_ID,
      addedEntries: 2,
      warnings: [],
    });
    expect(repositoryMocks.listOccupiedPlanSlots).toHaveBeenCalledWith(
      USER_ID,
      '2026-09-01',
      '2026-09-01'
    );
    const generation = repositoryMocks.generatePlan.mock.calls[0]?.[1];
    expect(generation).toEqual(
      expect.objectContaining({
        operationId: OPERATION_ID,
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        replaceExisting: false,
        algorithmVersion: 'goal-aware-pantry-plan-v2',
      })
    );
    expect(generation?.entries).toEqual([
      expect.objectContaining({
        mealSlot: 'breakfast',
        recipeKey: 'quark-oats',
        estimatedCalories: 510,
      }),
      expect.objectContaining({
        mealSlot: 'dinner',
        recipeKey: 'tofu-rice-bowl',
        estimatedProteinG: 36,
        ingredients: expect.arrayContaining([
          expect.objectContaining({
            ingredientKey: 'reis',
            quantity: 80,
            shoppingRequired: true,
          }),
        ]),
      }),
    ]);
    expect(eventMocks.publish).toHaveBeenCalledWith(USER_ID, 'coach');
  });

  it('localizes no-safe-recipe generation warnings in English and German', async () => {
    mealCatalogMocks.getCoachMealCatalog.mockResolvedValue([breakfastMeal]);
    repositoryMocks.generatePlan.mockImplementation(
      async (_userId: string, generation: { warnings: string[] }) => ({
        planId: PLAN_ID,
        created: true,
        entryIds: [ENTRY_ID],
        warnings: generation.warnings,
      })
    );

    coachProfileRepositoryMocks.getCoachLanguage.mockResolvedValueOnce('fr-CH');
    const english = await coachMealPlanningService.generateMealPlan(USER_ID, {
      operationId: OPERATION_ID,
      startDate: '2026-09-01',
      days: 1,
      replaceExisting: false,
    });
    coachProfileRepositoryMocks.getCoachLanguage.mockResolvedValueOnce('de-CH');
    const german = await coachMealPlanningService.generateMealPlan(USER_ID, {
      operationId: '77777777-7777-4777-8777-777777777777',
      startDate: '2026-09-01',
      days: 1,
      replaceExisting: false,
    });

    expect(english.warnings).toEqual([
      expect.stringContaining('There is no safely validated recipe'),
      expect.stringContaining('There is no safely validated recipe'),
    ]);
    expect(german.warnings).toEqual([
      expect.stringContaining('kein sicher validiertes Rezept'),
      expect.stringContaining('kein sicher validiertes Rezept'),
    ]);
  });

  it('uses per-meal goals and the preference-aware suggestion rank before pantry coverage', async () => {
    const pantryFirstMeal: CoachMealSuggestion = {
      ...mainMeal,
      id: 'pantry-first-meal',
      nameDe: 'Vorratsgericht',
      mealSlots: ['lunch'],
      calories: 700,
      proteinG: 25,
      ingredients: [mainMeal.ingredients[0]],
    };
    const goalAlignedMeal: CoachMealSuggestion = {
      ...mainMeal,
      id: 'goal-aligned-preferred-meal',
      nameDe: 'Zielgericht',
      mealSlots: ['lunch'],
      calories: 600,
      proteinG: 40,
      ingredients: [
        {
          nameDe: 'Lieblingszutat',
          nameEn: 'preferred ingredient',
          amount: 200,
          unit: 'g',
          category: 'produce',
        },
      ],
    };
    repositoryMocks.listPantryItems.mockResolvedValue([
      pantryRow({
        ingredient_key: 'reis',
        quantity: 1000,
        reserved_quantity: 0,
        available_quantity: 1000,
        shortage_quantity: 0,
      }),
    ]);
    repositoryMocks.listOccupiedPlanSlots.mockResolvedValue([
      { plan_date: '2026-09-01', meal_slot: 'breakfast' },
      { plan_date: '2026-09-01', meal_slot: 'dinner' },
    ]);
    coachProfileMocks.getCoachProfile.mockResolvedValue({
      calorieTarget: 1800,
      proteinTargetG: 120,
    });
    mealCatalogMocks.getCoachMealCatalog.mockResolvedValue([
      pantryFirstMeal,
      goalAlignedMeal,
    ]);
    mealCatalogMocks.getCoachMealSuggestions.mockResolvedValue([
      goalAlignedMeal,
      pantryFirstMeal,
    ]);
    repositoryMocks.generatePlan.mockResolvedValue({
      planId: PLAN_ID,
      created: true,
      entryIds: [ENTRY_ID],
      warnings: [],
    });

    await coachMealPlanningService.generateMealPlan(USER_ID, {
      operationId: OPERATION_ID,
      startDate: '2026-09-01',
      days: 1,
      replaceExisting: false,
    });

    expect(mealCatalogMocks.getCoachMealSuggestions).toHaveBeenCalledWith(
      USER_ID,
      { caloriesRemaining: 600, proteinRemainingG: 40 },
      `meal-plan:${OPERATION_ID}`,
      2
    );
    expect(repositoryMocks.generatePlan.mock.calls[0]?.[1].entries).toEqual([
      expect.objectContaining({ recipeKey: goalAlignedMeal.id }),
    ]);
  });

  it('returns the original generation result before occupied slots can hide a retry', async () => {
    repositoryMocks.getPlanGenerationResult.mockResolvedValue({
      planId: PLAN_ID,
      created: false,
      entryIds: [ENTRY_ID, ITEM_ID],
      warnings: ['Gespeicherte Warnung'],
    });

    await expect(
      coachMealPlanningService.generateMealPlan(USER_ID, {
        operationId: OPERATION_ID,
        startDate: '2026-09-01',
        days: 1,
        replaceExisting: false,
      })
    ).resolves.toEqual({
      planId: PLAN_ID,
      addedEntries: 2,
      warnings: ['Gespeicherte Warnung'],
    });

    expect(repositoryMocks.listPantryItems).not.toHaveBeenCalled();
    expect(repositoryMocks.listOccupiedPlanSlots).not.toHaveBeenCalled();
    expect(repositoryMocks.generatePlan).not.toHaveBeenCalled();
    expect(mealCatalogMocks.getCoachMealCatalog).not.toHaveBeenCalled();
    expect(mealCatalogMocks.getCoachMealSuggestions).not.toHaveBeenCalled();
    expect(coachProfileMocks.getCoachProfile).not.toHaveBeenCalled();
    expect(eventMocks.publish).not.toHaveBeenCalled();
    expect(repositoryMocks.getPlanGenerationResult).toHaveBeenCalledWith(
      USER_ID,
      OPERATION_ID,
      {
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        replaceExisting: false,
      }
    );
  });

  it('persists an empty generation receipt so its operation id remains bound', async () => {
    repositoryMocks.listOccupiedPlanSlots.mockResolvedValue([
      { plan_date: '2026-09-01', meal_slot: 'breakfast' },
      { plan_date: '2026-09-01', meal_slot: 'lunch' },
      { plan_date: '2026-09-01', meal_slot: 'dinner' },
    ]);
    mealCatalogMocks.getCoachMealCatalog.mockResolvedValue([
      breakfastMeal,
      mainMeal,
    ]);
    repositoryMocks.generatePlan.mockResolvedValue({
      planId: PLAN_ID,
      created: true,
      entryIds: [],
      warnings: [],
    });

    await expect(
      coachMealPlanningService.generateMealPlan(USER_ID, {
        operationId: OPERATION_ID,
        startDate: '2026-09-01',
        days: 1,
        replaceExisting: false,
      })
    ).resolves.toEqual({
      planId: PLAN_ID,
      addedEntries: 0,
      warnings: [],
    });

    expect(repositoryMocks.getPlanGenerationResult).toHaveBeenCalledOnce();
    expect(repositoryMocks.generatePlan).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        operationId: OPERATION_ID,
        entries: [],
      })
    );
  });

  it('delegates purchases and terminal meal actions so repository transactions own stock changes', async () => {
    repositoryMocks.applyPlanEntryAction.mockResolvedValue('prepared');

    await coachMealPlanningService.confirmShoppingPurchase(USER_ID, {
      operationId: OPERATION_ID,
      purchases: [{ itemId: ITEM_ID, quantity: 250 }],
    });
    await coachMealPlanningService.applyMealPlanAction(USER_ID, ENTRY_ID, {
      operationId: OPERATION_ID,
      action: 'prepared',
      notes: 'Gekocht und gegessen',
    });

    expect(repositoryMocks.confirmPurchases).toHaveBeenCalledWith(
      USER_ID,
      OPERATION_ID,
      [{ itemId: ITEM_ID, quantity: 250 }]
    );
    expect(repositoryMocks.applyPlanEntryAction).toHaveBeenCalledWith(
      USER_ID,
      ENTRY_ID,
      'prepared',
      OPERATION_ID,
      'Gekocht und gegessen'
    );
    expect(eventMocks.publish).toHaveBeenCalledTimes(2);
  });

  it('delegates a safe replacement with the original date and slot', async () => {
    repositoryMocks.getMealPlanEntry.mockResolvedValue(planEntryRow());
    mealCatalogMocks.getCoachMealSuggestionById.mockResolvedValue(mainMeal);
    repositoryMocks.replacePlanEntry.mockResolvedValue({
      entryId: ITEM_ID,
      created: true,
    });

    const replacementId = await coachMealPlanningService.replaceMealPlanEntry(
      USER_ID,
      ENTRY_ID,
      {
        operationId: OPERATION_ID,
        recipeKey: mainMeal.id,
      }
    );

    expect(replacementId).toBe(ITEM_ID);
    expect(repositoryMocks.replacePlanEntry).toHaveBeenCalledWith(
      USER_ID,
      ENTRY_ID,
      OPERATION_ID,
      expect.objectContaining({
        planDate: '2026-09-01',
        mealSlot: 'dinner',
        recipeKey: mainMeal.id,
      })
    );
  });

  it('turns missing action targets into a service-level 404 signal', async () => {
    repositoryMocks.applyPlanEntryAction.mockResolvedValue(null);

    await expect(
      coachMealPlanningService.applyMealPlanAction(USER_ID, ENTRY_ID, {
        operationId: OPERATION_ID,
        action: 'skipped',
      })
    ).rejects.toBeInstanceOf(CoachMealPlanningNotFoundError);
  });

  it('builds a stable reminder from remaining needed quantities only', async () => {
    repositoryMocks.getOpenShoppingList.mockResolvedValue({
      list: shoppingListRow(),
      items: [
        shoppingItemRow(),
        shoppingItemRow({
          id: '88888888-8888-4888-8888-888888888888',
          name: 'Eier',
          ingredient_key: 'eier',
          unit: 'piece',
          needed_quantity: 10,
          purchased_quantity: 0,
        }),
        shoppingItemRow({
          id: '99999999-9999-4999-8999-999999999999',
          status: 'purchased',
          needed_quantity: 500,
          purchased_quantity: 500,
        }),
      ],
    });

    const first = await coachMealPlanningService.getRestockReminder(USER_ID);
    const second = await coachMealPlanningService.getRestockReminder(USER_ID);

    expect(first).toEqual(
      expect.objectContaining({
        itemCount: 2,
        listId: LIST_ID,
        signature: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
    expect(first?.textDe).toContain('300 g Reis');
    expect(first?.textDe).toContain('10 Stück Eier');
    expect(first?.textEn).toContain('2 grocery items are');
    expect(second?.signature).toBe(first?.signature);
  });

  it('does not remind when no open shopping list remains', async () => {
    repositoryMocks.getOpenShoppingList.mockResolvedValue(null);

    await expect(
      coachMealPlanningService.getRestockReminder(USER_ID)
    ).resolves.toBeNull();
  });
});
