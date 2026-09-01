import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachProfileResponse } from '@workspace/shared';
import coachProfileService from '../services/coachProfileService.js';
import {
  SWISS_RETAIL_PRODUCT_CATALOG,
  getSwissRetailProductReference,
  getSwissRetailProductReferences,
} from '../constants/swissRetailProductCatalog.js';
import {
  buildCoachShoppingList,
  coachIngredientKey,
  getCoachMealCatalog,
  getCoachMealSuggestion,
  getCoachMealSuggestionById,
  getCoachMealSuggestions,
  renderCoachMealSuggestion,
  toCoachMealSuggestionPayload,
} from '../services/coachMealSuggestionService.js';

vi.mock('../services/coachProfileService.js', () => ({
  default: {
    getCoachProfile: vi.fn(),
    validateMealSuggestion: vi.fn(),
  },
}));

const profile: CoachProfileResponse = {
  enabled: true,
  dietaryPattern: 'vegan',
  primaryGoal: 'maintain_weight',
  calorieTarget: 2400,
  proteinTargetG: 140,
  waterTargetMl: 2500,
  excludedIngredients: [],
  preferredIngredients: [],
  dislikedIngredients: [],
  routines: [],
  coachingNotes: null,
  adaptiveCheckInsEnabled: true,
  adaptiveStartTime: '07:00',
  adaptiveEndTime: '20:00',
  adaptiveIntervalMinutes: 120,
  proactiveCategories: ['nutrition', 'hydration'],
  memoryEnabled: true,
  autoMemoryEnabled: false,
  dailyCheckInEnabled: true,
  dailyCheckInTime: '20:00',
  weeklyReviewEnabled: true,
  weeklyReviewDay: 0,
  weeklyReviewTime: '18:00',
  updatedAt: '2026-08-24T08:00:00.000Z',
};

const targets = {
  caloriesRemaining: 700,
  proteinRemainingG: 50,
};

describe('coachMealSuggestionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachProfileService.getCoachProfile).mockResolvedValue(profile);
    vi.mocked(coachProfileService.validateMealSuggestion).mockResolvedValue({
      allowed: true,
      violations: [],
    });
  });

  it('returns a concrete meal compatible with the dietary pattern', async () => {
    const suggestion = await getCoachMealSuggestion(
      'user-1',
      targets,
      '2026-08-24:daily'
    );

    expect(suggestion).not.toBeNull();
    expect(suggestion?.ingredients.length).toBeGreaterThan(0);
    expect(suggestion?.carbsG).toBeGreaterThan(0);
    expect(suggestion?.fatG).toBeGreaterThan(0);
    expect(suggestion?.mealSlots.length).toBeGreaterThan(0);
    expect(
      suggestion?.ingredients.map((ingredient) => ingredient.nameDe)
    ).not.toEqual(
      expect.arrayContaining(['Hähnchenbrust', 'Lachsfilet', 'Eier'])
    );
  });

  it('never presents a blocked candidate and tries the next safe meal', async () => {
    vi.mocked(coachProfileService.getCoachProfile).mockResolvedValue({
      ...profile,
      preferredIngredients: ['tofu'],
    });
    vi.mocked(coachProfileService.validateMealSuggestion).mockImplementation(
      async (_userId, ingredients) =>
        ingredients.some((ingredient) => ingredient.includes('Naturtofu'))
          ? {
              allowed: false,
              violations: [
                {
                  type: 'allergen',
                  ingredient: 'Naturtofu',
                  matchedTerm: 'soy',
                  reason: 'Tracked soy allergen',
                },
              ],
            }
          : { allowed: true, violations: [] }
    );

    const suggestion = await getCoachMealSuggestion(
      'user-1',
      targets,
      '2026-08-24:daily'
    );

    expect(suggestion?.id).not.toBe('tofu-edamame-rice');
    expect(
      suggestion?.ingredients.some(
        (ingredient) => ingredient.nameDe === 'Naturtofu'
      )
    ).toBe(false);
    expect(coachProfileService.validateMealSuggestion).toHaveBeenCalledTimes(2);
  });

  it('renders exact portions, preparation, and a categorized two-serving shopping list', async () => {
    vi.mocked(coachProfileService.getCoachProfile).mockResolvedValue({
      ...profile,
      preferredIngredients: ['tofu'],
    });
    const suggestion = await getCoachMealSuggestion(
      'user-1',
      targets,
      '2026-08-24:daily'
    );

    expect(suggestion).not.toBeNull();
    const message = renderCoachMealSuggestion(suggestion!, 'de').join('\n');

    expect(message).toContain('Für eine Portion: 200 g Naturtofu');
    expect(message).toContain(`${suggestion?.carbsG} g Kohlenhydrate`);
    expect(message).toContain(`${suggestion?.fatG} g Fett`);
    expect(message).toContain('Zubereitung:');
    expect(message).toContain('Einkauf für 2 Portionen:');
    expect(message).toContain('Kühlregal: 400 g Naturtofu');
    expect(message).toContain('Tiefkühl: 200 g Edamame');
    expect(message).toContain('Vorrat: 120 g Reis');
  });

  it('does not recommend a full meal after the calorie budget is exhausted', async () => {
    const suggestion = await getCoachMealSuggestion(
      'user-1',
      { caloriesRemaining: -100, proteinRemainingG: 30 },
      '2026-08-24:over-target'
    );

    expect(suggestion).toBeNull();
    expect(coachProfileService.getCoachProfile).not.toHaveBeenCalled();
    expect(coachProfileService.validateMealSuggestion).not.toHaveBeenCalled();
  });

  it('keeps a low remaining-calorie suggestion within the allowed tolerance', async () => {
    const suggestion = await getCoachMealSuggestion(
      'user-1',
      { caloriesRemaining: 500, proteinRemainingG: 30 },
      '2026-08-24:small-meal'
    );

    expect(suggestion).not.toBeNull();
    expect(suggestion?.calories).toBeLessThanOrEqual(575);
    expect(suggestion?.ingredients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nameDe: 'Wasser', amount: 400, unit: 'ml' }),
      ])
    );
    expect(
      buildCoachShoppingList(suggestion ? [suggestion] : []).some(
        (item) => item.nameDe === 'Wasser'
      )
    ).toBe(false);
  });

  it('consolidates shared ingredients across the selected meals', async () => {
    const suggestions = await getCoachMealSuggestions(
      'user-1',
      targets,
      '2026-08-24:plan',
      3
    );
    const list = buildCoachShoppingList(suggestions);
    const mealsWithRice = suggestions.filter((suggestion) =>
      suggestion.ingredients.some(
        (ingredient) => ingredient.nameDe === 'Reis, trocken'
      )
    );
    const expectedRiceAmount = mealsWithRice.reduce((total, suggestion) => {
      const rice = suggestion.ingredients.find(
        (ingredient) => ingredient.nameDe === 'Reis, trocken'
      );
      return total + (rice?.amount ?? 0) * suggestion.shoppingServings;
    }, 0);
    const rice = list.find((item) => item.nameDe === 'Reis, trocken');

    expect(suggestions).toHaveLength(3);
    expect(list.length).toBeGreaterThan(0);
    expect(rice?.amount).toBe(expectedRiceAmount);
    expect(rice?.mealIds).toHaveLength(mealsWithRice.length);
  });

  it('normalizes storage qualifiers and Swiss ingredient synonyms to stable keys', () => {
    expect(coachIngredientKey('TK-Brokkoli')).toBe('brokkoli');
    expect(coachIngredientKey('Reis, trocken')).toBe('reis');
    expect(coachIngredientKey('Kichererbsen, abgetropft')).toBe('kichererbsen');
    expect(coachIngredientKey('Naturtofu')).toBe('naturtofu');
    expect(coachIngredientKey('Pouletbrust')).toBe('hahnchenbrust');
    expect(coachIngredientKey('Gemüsemischung')).toBe('gemusemischung');
  });

  it('returns a safe slot-filtered catalog including the Magerquark bowl', async () => {
    vi.mocked(coachProfileService.getCoachProfile).mockResolvedValue({
      ...profile,
      dietaryPattern: 'vegetarian',
    });

    const breakfastMeals = await getCoachMealCatalog('user-1', 'breakfast');
    const bowl = breakfastMeals.find(
      (suggestion) => suggestion.id === 'magerquark-oat-bowl'
    );

    expect(breakfastMeals.length).toBeGreaterThan(0);
    expect(
      breakfastMeals.every((suggestion) =>
        suggestion.mealSlots.includes('breakfast')
      )
    ).toBe(true);
    expect(bowl).toEqual(
      expect.objectContaining({
        nameDe: 'Magerquark-Hafer-Bowl',
        carbsG: 96,
        fatG: 7,
      })
    );
    expect(bowl?.ingredients.map(({ nameDe }) => nameDe)).toEqual([
      'Magerquark',
      'Haferflocken',
      'TK-Beeren',
      'Banane',
    ]);
  });

  it('resolves a catalog recipe by id only after deterministic safety validation', async () => {
    vi.mocked(coachProfileService.getCoachProfile).mockResolvedValue({
      ...profile,
      dietaryPattern: 'vegetarian',
    });

    const safe = await getCoachMealSuggestionById(
      'user-1',
      'magerquark-oat-bowl'
    );
    expect(safe?.nameDe).toBe('Magerquark-Hafer-Bowl');
    expect(coachProfileService.validateMealSuggestion).toHaveBeenCalledWith(
      'user-1',
      expect.arrayContaining([expect.stringContaining('Magerquark')])
    );

    vi.mocked(coachProfileService.validateMealSuggestion).mockResolvedValue({
      allowed: false,
      violations: [
        {
          type: 'allergen',
          ingredient: 'Magerquark',
          matchedTerm: 'milk',
          reason: 'Tracked milk allergen',
        },
      ],
    });
    await expect(
      getCoachMealSuggestionById('user-1', 'magerquark-oat-bowl')
    ).resolves.toBeNull();
  });

  it('emits macro, slot, ingredient-key, category, and shopping metadata', async () => {
    vi.mocked(coachProfileService.getCoachProfile).mockResolvedValue({
      ...profile,
      dietaryPattern: 'vegetarian',
    });
    const suggestion = await getCoachMealSuggestionById(
      'user-1',
      'magerquark-oat-bowl'
    );

    expect(suggestion).not.toBeNull();
    expect(toCoachMealSuggestionPayload(suggestion!)).toEqual(
      expect.objectContaining({
        estimated_carbs_g_per_serving: 96,
        estimated_fat_g_per_serving: 7,
        meal_slots: ['breakfast', 'snack'],
        ingredients_per_serving: expect.arrayContaining([
          expect.objectContaining({
            ingredient_key: 'magerquark',
            category: 'chilled',
            shopping_required: true,
          }),
        ]),
      })
    );
  });

  it('exposes only verified official retailer references without GTIN, price, or stock', () => {
    const references = Object.values(SWISS_RETAIL_PRODUCT_CATALOG).flat();

    expect(references).toHaveLength(16);
    for (const ingredientReferences of Object.values(
      SWISS_RETAIL_PRODUCT_CATALOG
    )) {
      expect(
        ingredientReferences.map(({ retailer }) => retailer).sort()
      ).toEqual(['coop', 'migros']);
    }
    for (const reference of references) {
      expect(reference.gtin).toBeNull();
      expect(reference.verifiedAt).toBe('2026-09-01T00:00:00.000Z');
      expect(reference).not.toHaveProperty('price');
      expect(reference).not.toHaveProperty('stock');
      const url = new URL(reference.directUrl);
      expect(['www.coop.ch', 'www.migros.ch']).toContain(url.hostname);
      expect(reference.directUrl).toContain(reference.retailerProductId);
    }

    expect(getSwissRetailProductReferences('magerquark')).toHaveLength(2);
    expect(getSwissRetailProductReference('magerquark', 'coop')).toEqual(
      expect.objectContaining({
        retailerProductId: '6568630',
        packageQuantity: 500,
        packageUnit: 'g',
      })
    );
    expect(getSwissRetailProductReference('reis', 'migros')).toEqual(
      expect.objectContaining({
        retailerProductId: '104415300000',
        packageQuantity: 1000,
        packageUnit: 'g',
      })
    );
    expect(getSwissRetailProductReferences('unknown')).toEqual([]);
    expect(
      getSwissRetailProductReference('hahnchenbrust', 'migros')?.note
    ).toContain('Würzlake');
    expect(getSwissRetailProductReference('gemusemischung', 'coop')?.note).toBe(
      'Enthält Sellerie.'
    );
  });
});
