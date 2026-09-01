import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachContextSnapshot } from '../services/coachContextService.js';
import type { CoachMealSuggestion } from '../services/coachMealSuggestionService.js';
import coachContextService from '../services/coachContextService.js';
import { getCoachMealSuggestion } from '../services/coachMealSuggestionService.js';
import { buildMealPlanningTools } from '../ai/tools/mealPlanningTools.js';
import coachMealPlanningService from '../services/coachMealPlanningService.js';

vi.mock('../services/coachContextService.js', () => ({
  default: { getCoachContextSnapshot: vi.fn() },
}));

vi.mock('../services/coachMealSuggestionService.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../services/coachMealSuggestionService.js')
    >();
  return { ...actual, getCoachMealSuggestion: vi.fn() };
});

vi.mock('../services/coachMealPlanningService.js', () => ({
  default: {
    getDashboard: vi.fn(),
    createPantryItem: vi.fn(),
    updatePantryItem: vi.fn(),
    removePantryItem: vi.fn(),
    confirmShoppingPurchase: vi.fn(),
    generateMealPlan: vi.fn(),
    applyMealPlanAction: vi.fn(),
    replaceMealPlanEntry: vi.fn(),
  },
}));

const today = {
  date: '2026-09-01',
  primaryGoal: 'maintain_weight',
  calorieTarget: 2200,
  proteinTargetG: 150,
  waterTargetMl: 2500,
  caloriesConsumed: 1200,
  caloriesBurned: 0,
  netCalories: 1200,
  caloriesRemaining: 1000,
  proteinConsumedG: 75,
  proteinRemainingG: 75,
  waterConsumedMl: 1200,
  waterRemainingMl: 1300,
};

const meal: CoachMealSuggestion = {
  id: 'chicken-rice-bowl',
  nameDe: 'Hähnchen-Reis-Gemüse-Bowl',
  nameEn: 'Chicken, rice, and vegetable bowl',
  calories: 680,
  proteinG: 53,
  carbsG: 76,
  fatG: 17,
  mealSlots: ['lunch', 'dinner'],
  ingredients: [
    {
      nameDe: 'Hähnchenbrust',
      nameEn: 'chicken breast',
      amount: 180,
      unit: 'g',
      category: 'chilled',
    },
  ],
  preparationDe: 'Hähnchen anbraten.',
  preparationEn: 'Pan-fry the chicken.',
  shoppingServings: 2,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function snapshotWithToday(
  overrides: Partial<typeof today> = {}
): CoachContextSnapshot {
  return {
    today: { ...today, ...overrides },
  } as unknown as CoachContextSnapshot;
}

describe('sparky_suggest_next_meal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachContextService.getCoachContextSnapshot).mockResolvedValue(
      snapshotWithToday()
    );
    vi.mocked(getCoachMealSuggestion).mockResolvedValue(meal);
    vi.mocked(coachMealPlanningService.getDashboard).mockResolvedValue({
      startDate: '2026-09-01',
      days: 7,
      pantry: [],
      shoppingList: null,
      planEntries: [],
      mealCatalog: [],
      warnings: [],
      lastUpdatedAt: '2026-09-01T10:00:00.000Z',
    });
    vi.mocked(coachMealPlanningService.generateMealPlan).mockResolvedValue({
      planId: '10000000-0000-4000-8000-000000000001',
      addedEntries: 9,
      warnings: [],
    });
    vi.mocked(coachMealPlanningService.replaceMealPlanEntry).mockResolvedValue(
      '20000000-0000-4000-8000-000000000001'
    );
  });

  it('returns one safe meal and derives the shopping list for the requested servings', async () => {
    const tool = buildMealPlanningTools(
      'user-1',
      'Europe/Berlin'
    ).sparky_suggest_next_meal;

    const result = (await tool.execute!(
      { servings_to_prepare: 3 },
      { toolCallId: 'call-1', messages: [] }
    )) as string;
    const parsed = JSON.parse(result.replace('# Next Meal Suggestion\n\n', ''));

    expect(parsed.status).toBe('ready');
    expect(parsed.meal).toEqual(
      expect.objectContaining({
        id: 'chicken-rice-bowl',
        servings_to_prepare: 3,
        estimated_carbs_g_per_serving: 76,
        estimated_fat_g_per_serving: 17,
        meal_slots: ['lunch', 'dinner'],
        ingredients_per_serving: [
          expect.objectContaining({
            ingredient_key: 'hahnchenbrust',
            amount: 180,
            unit: 'g',
            category: 'chilled',
            shopping_required: true,
          }),
        ],
      })
    );
    expect(parsed.consolidated_shopping_list).toEqual([
      expect.objectContaining({ amount: 540, unit: 'g' }),
    ]);
    expect(getCoachMealSuggestion).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ caloriesRemaining: 1000 }),
      'next-meal:2026-09-01:1200:75'
    );
  });

  it('does not recommend another full meal when the calorie budget is exhausted', async () => {
    vi.mocked(coachContextService.getCoachContextSnapshot).mockResolvedValue(
      snapshotWithToday({ caloriesRemaining: -100, proteinRemainingG: 30 })
    );
    const tool = buildMealPlanningTools(
      'user-1',
      'Europe/Berlin'
    ).sparky_suggest_next_meal;

    const result = (await tool.execute!(
      {},
      { toolCallId: 'call-1', messages: [] }
    )) as string;
    const parsed = JSON.parse(result.replace('# Next Meal Suggestion\n\n', ''));

    expect(parsed.status).toBe('calorie_budget_reached');
    expect(parsed.question_de).toContain('morgen');
    expect(parsed.follow_up_args).toEqual({ planning_day: 'tomorrow' });
    expect(getCoachMealSuggestion).not.toHaveBeenCalled();

    const tomorrowResult = (await tool.execute!(
      { planning_day: 'tomorrow' },
      { toolCallId: 'call-2', messages: [] }
    )) as string;
    const tomorrow = JSON.parse(
      tomorrowResult.replace('# Next Meal Suggestion\n\n', '')
    );

    expect(tomorrow.status).toBe('ready');
    expect(tomorrow.date).toBe('2026-09-02');
    expect(getCoachMealSuggestion).toHaveBeenCalledWith(
      'user-1',
      { caloriesRemaining: 2200, proteinRemainingG: 150 },
      'next-meal:2026-09-02:tomorrow'
    );
  });

  it('asks exactly one constraint question when no catalog meal is safe', async () => {
    vi.mocked(getCoachMealSuggestion).mockResolvedValue(null);
    const tool = buildMealPlanningTools(
      'user-1',
      'Europe/Berlin'
    ).sparky_suggest_next_meal;

    const result = (await tool.execute!(
      {},
      { toolCallId: 'call-1', messages: [] }
    )) as string;
    const parsed = JSON.parse(result.replace('# Next Meal Suggestion\n\n', ''));

    expect(parsed.status).toBe('needs_user_input');
    expect(parsed.question_de).toContain('vollständige Zutatenliste');
    expect(parsed.follow_up_tool).toBe('sparky_validate_meal_suggestion');
  });

  it('persists a dated plan before returning its derived shopping state', async () => {
    const persistentTool = buildMealPlanningTools(
      'user-1',
      'Europe/Berlin'
    ).sparky_generate_meal_plan;

    const result = (await persistentTool.execute!(
      { days: 3, replace_existing: true },
      { toolCallId: 'call-plan', messages: [] }
    )) as string;

    expect(result).toContain('Generated Meal Plan');
    expect(coachMealPlanningService.generateMealPlan).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        startDate: '2026-09-01',
        days: 3,
        replaceExisting: true,
        operationId: expect.any(String),
      })
    );
    expect(coachMealPlanningService.getDashboard).toHaveBeenCalledWith(
      'user-1',
      '2026-09-01',
      3
    );
  });

  it('derives stable scoped operation ids from the tool call and preserves an explicit id', async () => {
    const tools = buildMealPlanningTools('user-1', 'Europe/Berlin');
    const explicitOperationId = '50000000-0000-4000-8000-000000000001';

    await tools.sparky_generate_meal_plan.execute!(
      { days: 2 },
      { toolCallId: 'same-call', messages: [] }
    );
    await tools.sparky_generate_meal_plan.execute!(
      { days: 2 },
      { toolCallId: 'same-call', messages: [] }
    );
    await tools.sparky_generate_meal_plan.execute!(
      { days: 2, operation_id: explicitOperationId },
      { toolCallId: 'different-call', messages: [] }
    );
    await tools.sparky_update_planned_meal.execute!(
      {
        entry_id: '40000000-0000-4000-8000-000000000001',
        action: 'skipped',
      },
      { toolCallId: 'same-call', messages: [] }
    );

    const firstGeneratedId = vi.mocked(
      coachMealPlanningService.generateMealPlan
    ).mock.calls[0]?.[1].operationId;
    const secondGeneratedId = vi.mocked(
      coachMealPlanningService.generateMealPlan
    ).mock.calls[1]?.[1].operationId;
    const explicitGeneratedId = vi.mocked(
      coachMealPlanningService.generateMealPlan
    ).mock.calls[2]?.[1].operationId;
    const mealActionId = vi.mocked(coachMealPlanningService.applyMealPlanAction)
      .mock.calls[0]?.[2].operationId;

    expect(firstGeneratedId).toMatch(UUID_PATTERN);
    expect(secondGeneratedId).toBe(firstGeneratedId);
    expect(explicitGeneratedId).toBe(explicitOperationId);
    expect(mealActionId).toMatch(UUID_PATTERN);
    expect(mealActionId).not.toBe(firstGeneratedId);
  });

  it('confirms partial purchases and meal outcomes through explicit mutations', async () => {
    const tools = buildMealPlanningTools('user-1', 'Europe/Berlin');
    const itemId = '30000000-0000-4000-8000-000000000001';
    const entryId = '40000000-0000-4000-8000-000000000001';

    await tools.sparky_confirm_grocery_purchase.execute!(
      { purchases: [{ item_id: itemId, quantity: 250 }] },
      { toolCallId: 'call-purchase', messages: [] }
    );
    await tools.sparky_update_planned_meal.execute!(
      { entry_id: entryId, action: 'eaten_out' },
      { toolCallId: 'call-meal', messages: [] }
    );

    expect(
      coachMealPlanningService.confirmShoppingPurchase
    ).toHaveBeenCalledWith('user-1', {
      operationId: expect.any(String),
      purchases: [{ itemId, quantity: 250 }],
    });
    expect(coachMealPlanningService.applyMealPlanAction).toHaveBeenCalledWith(
      'user-1',
      entryId,
      {
        operationId: expect.any(String),
        action: 'eaten_out',
        notes: undefined,
      }
    );
  });

  it('rejects duplicate shopping item ids before confirming a purchase', async () => {
    const tool = buildMealPlanningTools(
      'user-1',
      'Europe/Berlin'
    ).sparky_confirm_grocery_purchase;
    const itemId = '30000000-0000-4000-8000-000000000001';

    const result = (await tool.execute!(
      {
        purchases: [
          { item_id: itemId, quantity: 100 },
          { item_id: itemId, quantity: 50 },
        ],
      },
      { toolCallId: 'call-purchase', messages: [] }
    )) as string;

    expect(result).toContain('VALIDATION');
    expect(result).toContain('Each shopping item may only appear once');
    expect(
      coachMealPlanningService.confirmShoppingPurchase
    ).not.toHaveBeenCalled();
  });
});
