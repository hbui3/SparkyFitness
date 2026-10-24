import { vi, beforeEach, describe, expect, it } from 'vitest';
import {
  mapCanadianNutrientFood,
  searchCanadianNutrientFoods,
  getCanadianNutrientFoodDetails,
  parseServingMeasure,
  clearCnfCachesForTesting,
  CnfNutrientItem,
  CnfServingSizeItem,
} from '../integrations/cnf/cnfService.js';

vi.mock('../config/logging', () => ({
  log: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('cnfService - parseServingMeasure', () => {
  it('parses standard measure strings correctly', () => {
    expect(parseServingMeasure('100ml diced')).toEqual({
      serving_size: 100,
      serving_unit: 'ml diced',
    });
    expect(parseServingMeasure('50g')).toEqual({
      serving_size: 50,
      serving_unit: 'g',
    });
    expect(parseServingMeasure('1 cup (245g)')).toEqual({
      serving_size: 1,
      serving_unit: 'cup (245g)',
    });
    expect(parseServingMeasure('slice')).toEqual({
      serving_size: 1,
      serving_unit: 'slice',
    });
  });
});

describe('cnfService - mapCanadianNutrientFood', () => {
  const sampleNutrients: CnfNutrientItem[] = [
    {
      food_code: 109,
      nutrient_name_id: 208,
      nutrient_value: 357,
      nutrient_web_name: 'Energy (kcal)',
    },
    {
      food_code: 109,
      nutrient_name_id: 203,
      nutrient_value: 24.94,
      nutrient_web_name: 'Protein',
    },
    {
      food_code: 109,
      nutrient_name_id: 205,
      nutrient_value: 2.22,
      nutrient_web_name: 'Carbohydrate',
    },
    {
      food_code: 109,
      nutrient_name_id: 204,
      nutrient_value: 28,
      nutrient_web_name: 'Total Fat',
    },
    {
      food_code: 109,
      nutrient_name_id: 606,
      nutrient_value: 17.6,
      nutrient_web_name: 'Fatty acids, saturated, total',
    },
    {
      food_code: 109,
      nutrient_name_id: 307,
      nutrient_value: 819,
      nutrient_web_name: 'Sodium, Na',
    },
    {
      food_code: 109,
      nutrient_name_id: 309,
      nutrient_value: 3.9,
      nutrient_web_name: 'Zinc, Zn',
    },
  ];

  const sampleServings: CnfServingSizeItem[] = [
    { conversion_factor_value: 0.5, food_code: 109, measure_name: '50g' },
    {
      conversion_factor_value: 0,
      food_code: 109,
      measure_name: 'no serving specified',
    },
  ];

  it('maps Canadian food details and variants correctly', () => {
    const result = mapCanadianNutrientFood(
      109,
      'Gouda Cheese',
      sampleNutrients,
      sampleServings
    );

    expect(result.name).toBe('Gouda Cheese');
    expect(result.brand).toBe('Canadian Nutrient File');
    expect(result.provider_external_id).toBe('109');
    expect(result.provider_type).toBe('canadian-nutrient-file');
    expect(result.is_custom).toBe(false);

    // 100g base variant
    expect(result.default_variant.serving_size).toBe(100);
    expect(result.default_variant.serving_unit).toBe('g');
    expect(result.default_variant.calories).toBe(357);
    expect(result.default_variant.protein).toBe(24.9);
    expect(result.default_variant.carbs).toBe(2.2);
    expect(result.default_variant.fat).toBe(28);
    expect(result.default_variant.saturated_fat).toBe(17.6);
    expect(result.default_variant.sodium).toBe(819);
    expect(result.default_variant.provider_nutrients['Zinc, Zn']).toBe(3.9);
    expect(result.default_variant.provider_nutrient_units['Zinc, Zn']).toBe(
      'mg'
    );

    // Scaled portion variant (50g, factor 0.5)
    expect(result.variants).toHaveLength(2);
    const portion = result.variants[1];
    expect(portion.serving_size).toBe(50);
    expect(portion.serving_unit).toBe('g');
    expect(portion.calories).toBe(179); // 357 * 0.5 rounded
    expect(portion.protein).toBe(12.5); // 24.94 * 0.5 = 12.47 -> 12.5
    expect(portion.fat).toBe(14); // 28 * 0.5
    expect(portion.provider_nutrients['Zinc, Zn']).toBe(1.95);
  });
});

describe('cnfService - searchCanadianNutrientFoods & getCanadianNutrientFoodDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCnfCachesForTesting();
  });

  it('filters cached directory by query keywords', async () => {
    // 1st call for food directory
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { food_code: 109, food_description: 'Cheese, gouda' },
        { food_code: 571, food_description: 'Chicken, broiler, giblets, raw' },
        {
          food_code: 572,
          food_description: 'Chicken, broiler, meat only, roasted',
        },
      ],
    });
    // 2nd call for nutrientamount of matched food 572
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          food_code: 572,
          nutrient_name_id: 208,
          nutrient_value: 239,
          nutrient_web_name: 'Energy (kcal)',
        },
        {
          food_code: 572,
          nutrient_name_id: 203,
          nutrient_value: 27.3,
          nutrient_web_name: 'Protein',
        },
      ],
    });
    // 3rd call for servingsize of matched food 572
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          conversion_factor_value: 1,
          food_code: 572,
          food_description: 'Chicken, broiler, meat only, roasted',
          measure_name: '100g',
        },
      ],
    });

    const result = await searchCanadianNutrientFoods('chicken roasted', 1, 10);
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0].name).toBe('Chicken, broiler, meat only, roasted');
    expect(result.foods[0].provider_external_id).toBe('572');
    expect(result.foods[0].provider_type).toBe('canadian-nutrient-file');
    expect(result.foods[0].default_variant.calories).toBe(239);
    expect(result.foods[0].default_variant.protein).toBe(27.3);
    expect(result.pagination.totalCount).toBe(1);
  });

  it('fetches single food details and combines nutrient and serving APIs', async () => {
    // 1st call for nutrientamount
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          food_code: 571,
          nutrient_name_id: 208,
          nutrient_value: 124,
          nutrient_web_name: 'Energy (kcal)',
        },
        {
          food_code: 571,
          nutrient_name_id: 203,
          nutrient_value: 18.2,
          nutrient_web_name: 'Protein',
        },
      ],
    });
    // 2nd call for servingsize
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          conversion_factor_value: 0.9,
          food_code: 571,
          food_description: 'Chicken giblets',
          measure_name: '90g',
        },
      ],
    });

    const details = await getCanadianNutrientFoodDetails('571', 'en');
    expect(details.name).toBe('Chicken giblets');
    expect(details.provider_external_id).toBe('571');
    expect(details.default_variant.calories).toBe(124);
    expect(details.variants).toHaveLength(2);
    expect(details.variants[1].serving_size).toBe(90);
  });

  it('handles 302 redirects properly when fetching nutrient data', async () => {
    let redirectServed = false;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('nutrientamount')) {
        if (!redirectServed) {
          redirectServed = true;
          return {
            status: 302,
            ok: false,
            headers: {
              get: (h: string) =>
                h.toLowerCase() === 'location'
                  ? 'https://food-nutrition.canada.ca/api/canadian-nutrient-file/nutrientamount/?id=571&lang=en&type=json'
                  : null,
            },
            body: { cancel: vi.fn() },
          };
        }
        return {
          status: 200,
          ok: true,
          json: async () => [
            {
              food_code: 571,
              nutrient_name_id: 208,
              nutrient_value: 150,
              nutrient_web_name: 'Energy (kcal)',
            },
          ],
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => [],
      };
    });

    const details = await getCanadianNutrientFoodDetails('571', 'en');
    expect(details.default_variant.calories).toBe(150);
  });

  it('omits foods from search results when their detail request fails', async () => {
    // 1st call for food directory (2 matches)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { food_code: 101, food_description: 'Valid Apple' },
        { food_code: 102, food_description: 'Broken Apple' },
      ],
    });
    // Detail calls for food 101 (nutrient + serving)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          food_code: 101,
          nutrient_name_id: 208,
          nutrient_value: 52,
          nutrient_web_name: 'Energy (kcal)',
        },
      ],
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          conversion_factor_value: 1,
          food_code: 101,
          measure_name: '100g',
        },
      ],
    });
    // Detail call for food 102 (nutrient API fails with 500)
    mockFetch.mockResolvedValueOnce({
      status: 500,
      ok: false,
    });
    mockFetch.mockResolvedValueOnce({
      status: 500,
      ok: false,
    });

    const result = await searchCanadianNutrientFoods('Apple', 1, 10);
    // Broken apple must be omitted, not returned with 0 calories
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0].name).toBe('Valid Apple');
    expect(result.foods[0].default_variant.calories).toBe(52);
  });

  it('throws an error if nutrient API returns a non-array response', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ error: 'Not an array' }),
    });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => [],
    });

    await expect(getCanadianNutrientFoodDetails('999', 'en')).rejects.toThrow(
      'Invalid response format from CNF nutrient API: expected an array'
    );
  });

  it('returns food details with default serving when serving-size request rejects', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => [
        {
          food_code: 888,
          nutrient_name_id: 208,
          nutrient_value: 120,
          nutrient_web_name: 'Energy (kcal)',
        },
      ],
    });
    mockFetch.mockRejectedValueOnce(new Error('Network connection reset'));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { food_code: 888, food_description: 'Resilient Food' },
      ],
    });

    const details = await getCanadianNutrientFoodDetails('888', 'en');
    expect(details.name).toBe('Resilient Food');
    expect(details.default_variant.calories).toBe(120);
    expect(details.default_variant.serving_size).toBe(100);
    expect(details.default_variant.serving_unit).toBe('g');
  });
});
