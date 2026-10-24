import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../services/foodIntegrationService.js', () => ({
  getFatSecretNutrients: vi.fn(),
  searchFatSecretFoods: vi.fn(),
  searchMealieFoods: vi.fn(),
  searchTandoorFoods: vi.fn(),
  searchNorishFoods: vi.fn(),
}));

vi.mock('../integrations/fatsecret/fatsecretService.js', () => ({
  mapFatSecretSearchItem: vi.fn((item) => item),
  mapFatSecretFood: vi.fn(),
  foodNutrientCache: new Map(),
  getFatSecretAccessToken: vi.fn(),
}));

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../services/externalProviderService.js', () => ({
  default: {
    getExternalDataProviderDetails: vi.fn(),
    getActiveOpenFoodFactsProviderId: vi.fn(),
  },
}));
vi.mock('../services/preferenceService.js', () => ({
  default: { getUserPreferences: vi.fn() },
}));
vi.mock('../integrations/openfoodfacts/openFoodFactsService.js', () => ({
  searchOpenFoodFacts: vi.fn(),
  mapOpenFoodFactsProduct: vi.fn(),
}));
vi.mock('../integrations/usda/usdaService.js', () => ({
  searchUsdaFoods: vi.fn(),
  mapUsdaBarcodeProduct: vi.fn(),
}));
vi.mock('../integrations/yazio/yazioService.js', () => ({
  searchYazioFoods: vi.fn(),
}));
vi.mock('../integrations/swissfood/swissFoodService.js', () => ({
  searchSwissFoods: vi.fn(),
}));
vi.mock('../integrations/cnf/cnfService.js', () => ({
  searchCanadianNutrientFoods: vi.fn(),
  getCanadianNutrientFoodDetails: vi.fn(),
}));

import {
  searchCanadianNutrientFoods,
  getCanadianNutrientFoodDetails,
} from '../integrations/cnf/cnfService.js';
import {
  searchProviderFoods,
  resolveProviderCredentials,
} from '../services/externalFoodSearchService.js';
import { fetchProviderFoodDetails } from '../services/foodProviderDetailService.js';

const mockSearchCanadianNutrientFoods = vi.mocked(searchCanadianNutrientFoods);
const mockGetCanadianNutrientFoodDetails = vi.mocked(
  getCanadianNutrientFoodDetails
);

describe('externalFoodSearchService - canadian-nutrient-file', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves empty credentials when providerId is omitted for canadian-nutrient-file', async () => {
    const creds = await resolveProviderCredentials(
      'user-1',
      undefined,
      'canadian-nutrient-file'
    );
    expect(creds).toEqual({});
  });

  it('dispatches search to searchCanadianNutrientFoods and returns ranked results', async () => {
    mockSearchCanadianNutrientFoods.mockResolvedValueOnce({
      foods: [
        {
          name: 'Canadian Atlantic Salmon',
          brand: 'Canadian Nutrient File',
          provider_external_id: '1234',
          provider_type: 'canadian-nutrient-file',
          is_custom: false,
          default_variant: {
            serving_size: 100,
            serving_unit: 'g',
            calories: 200,
            protein: 20,
            carbs: 0,
            fat: 13,
            provider_nutrients: {},
            provider_nutrient_units: {},
            is_default: true,
          },
          variants: [],
        },
      ],
      pagination: {
        page: 1,
        pageSize: 20,
        totalCount: 1,
        hasMore: false,
      },
    });

    const result = await searchProviderFoods(
      'user-1',
      'canadian-nutrient-file',
      'salmon'
    );

    expect(mockSearchCanadianNutrientFoods).toHaveBeenCalledWith(
      'salmon',
      1,
      20,
      'en',
      undefined
    );
    expect(result.foods).toHaveLength(1);
    const firstFood = result.foods[0] as {
      name: string;
      default_variant: { calories: number; protein: number };
    };
    expect(firstFood.name).toBe('Canadian Atlantic Salmon');
    expect(firstFood.default_variant.calories).toBe(200);
    expect(firstFood.default_variant.protein).toBe(20);
  });

  it('fetches full details via fetchProviderFoodDetails', async () => {
    mockGetCanadianNutrientFoodDetails.mockResolvedValueOnce({
      name: 'Canadian Atlantic Salmon',
      brand: 'Canadian Nutrient File',
      provider_external_id: '1234',
      provider_type: 'canadian-nutrient-file',
      is_custom: false,
      default_variant: {
        serving_size: 100,
        serving_unit: 'g',
        calories: 200,
        protein: 20,
        carbs: 0,
        fat: 13,
        provider_nutrients: {},
        provider_nutrient_units: {},
        is_default: true,
      },
      variants: [],
    });

    const food = await fetchProviderFoodDetails({
      credentialUserId: 'user-1',
      dataUserId: 'user-1',
      providerType: 'canadian-nutrient-file',
      externalId: '1234',
    });

    expect(mockGetCanadianNutrientFoodDetails).toHaveBeenCalledWith(
      '1234',
      'en',
      undefined
    );
    expect(food).not.toBeNull();
    expect((food as { name: string }).name).toBe('Canadian Atlantic Salmon');
  });
});
