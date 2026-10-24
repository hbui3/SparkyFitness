import { log } from '../../config/logging.js';
import {
  createGuardedFetch,
  PUBLIC_ONLY_AI_NETWORK_POLICY,
} from '../../utils/outboundUrlPolicy.js';

const guardedFetch = createGuardedFetch(PUBLIC_ONLY_AI_NETWORK_POLICY);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

export async function cnfFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await guardedFetch(currentUrl, init);
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) {
      return response;
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error(`CNF fetch exceeded ${MAX_REDIRECTS} redirects`);
}

const DEFAULT_BASE_URL =
  'https://food-nutrition.canada.ca/api/canadian-nutrient-file';

const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;

function resolveLanguage(lang: string | null | undefined): 'en' | 'fr' {
  if (!lang || typeof lang !== 'string') {
    return 'en';
  }
  const normalized = lang.trim().toLowerCase().slice(0, 2);
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(normalized)
    ? (normalized as 'en' | 'fr')
    : 'en';
}

export interface CnfFoodSummary {
  food_code: number;
  food_description: string;
}

export interface CnfNutrientItem {
  food_code: number;
  nutrient_value: number;
  standard_error?: number;
  number_observation?: number;
  nutrient_name_id: number;
  nutrient_web_name: string;
  nutrient_source_id?: number;
}

export interface CnfServingSizeItem {
  conversion_factor_value: number;
  food_code: number;
  food_description?: string;
  measure_name: string;
}

export interface CnfFoodVariant {
  serving_size: number;
  serving_unit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  saturated_fat?: number;
  polyunsaturated_fat?: number;
  monounsaturated_fat?: number;
  trans_fat?: number;
  cholesterol?: number;
  sodium?: number;
  potassium?: number;
  dietary_fiber?: number;
  sugars?: number;
  calcium?: number;
  iron?: number;
  vitamin_a?: number;
  vitamin_c?: number;
  caffeine_mg?: number;
  alcohol_g?: number;
  water_ml?: number;
  provider_nutrients: Record<string, number>;
  provider_nutrient_units: Record<string, string>;
  is_default: boolean;
  custom_nutrients?: Record<string, number>;
  [key: string]: unknown;
}

export interface CnfFoodDetail {
  name: string;
  brand: string;
  provider_external_id: string;
  provider_type: 'canadian-nutrient-file';
  is_custom: boolean;
  default_variant: CnfFoodVariant;
  variants: CnfFoodVariant[];
  [key: string]: unknown;
}

// In-memory cache for the complete food directory (per language) to avoid
// refetching 460KB on every keystroke during live on-demand search.
interface CachedFoodDirectory {
  timestamp: number;
  foods: CnfFoodSummary[];
}

const foodDirectoryCache = new Map<string, CachedFoodDirectory>();
const foodDetailCache = new Map<
  string,
  { timestamp: number; detail: CnfFoodDetail }
>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function clearCnfCachesForTesting(): void {
  foodDirectoryCache.clear();
  foodDetailCache.clear();
}

export async function getCnfFoodDirectory(
  language = 'en',
  customBaseUrl?: string | null
): Promise<CnfFoodSummary[]> {
  const queryLang = resolveLanguage(language);
  const rawBaseUrl = customBaseUrl?.trim() || DEFAULT_BASE_URL;
  let baseUrl = rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }

  const cacheKey = `${baseUrl}|${queryLang}`;
  const cached = foodDirectoryCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.foods;
  }

  const url = `${baseUrl}/food/?lang=${queryLang}&type=json`;

  try {
    const response = await cnfFetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SparkyFitness/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`CNF API returned status ${response.status}`);
    }

    const items = (await response.json()) as CnfFoodSummary[];
    if (!Array.isArray(items)) {
      throw new Error(
        'Invalid response format from CNF API: expected an array'
      );
    }

    foodDirectoryCache.set(cacheKey, {
      timestamp: now,
      foods: items,
    });

    return items;
  } catch (error) {
    // If cache has a stale copy, return it as fallback on network failure
    if (cached && cached.foods.length > 0) {
      log(
        'warn',
        `CNF directory fetch failed; returning stale cache: ${error}`
      );
      return cached.foods;
    }
    const msg = error instanceof Error ? error.message : String(error);
    log('error', `Error fetching CNF food directory: ${msg}`);
    throw error;
  }
}

export function parseServingMeasure(measureName: string): {
  serving_size: number;
  serving_unit: string;
} {
  const trimmed = measureName.trim();
  // Match common patterns like "100ml diced", "50g", "1 cup (245g)", "1 slice (30 g)"
  const regex = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+(?:\s+.*)?)$/;
  const match = trimmed.match(regex);
  if (match) {
    const size = parseFloat(match[1]);
    const unit = match[2]?.trim() || 'serving';
    return {
      serving_size: Number.isFinite(size) && size > 0 ? size : 1,
      serving_unit: unit,
    };
  }
  return {
    serving_size: 1,
    serving_unit: trimmed || 'serving',
  };
}

export function mapCanadianNutrientFood(
  foodCode: number,
  foodDescription: string,
  nutrientItems: CnfNutrientItem[],
  servingItems: CnfServingSizeItem[] = []
): CnfFoodDetail {
  const nutrientsById: Record<number, number> = {};
  const providerNutrientsByLabel: Record<string, number> = {};
  const providerNutrientUnits: Record<string, string> = {};

  for (const n of nutrientItems || []) {
    if (typeof n.nutrient_name_id === 'number') {
      nutrientsById[n.nutrient_name_id] = n.nutrient_value ?? 0;
    }
    const label = n.nutrient_web_name?.trim();
    if (label) {
      providerNutrientsByLabel[label] = n.nutrient_value ?? 0;
      // Standardize known units for common CNF micronutrients
      if (
        label.includes('Vitamin C') ||
        label.includes('Iron') ||
        label.includes('Calcium') ||
        label.includes('Sodium') ||
        label.includes('Potassium') ||
        label.includes('Zinc') ||
        label.includes('Magnesium') ||
        label.includes('Phosphorus') ||
        label.includes('Caffeine')
      ) {
        providerNutrientUnits[label] = 'mg';
      } else if (
        label.includes('Vitamin D') ||
        label.includes('Folate') ||
        label.includes('Selenium') ||
        label.includes('RAE')
      ) {
        providerNutrientUnits[label] = 'mcg';
      } else {
        providerNutrientUnits[label] = 'g';
      }
    }
  }

  // Base 100g edible portion values from CNF
  const base100g = {
    calories: Math.round(nutrientsById[208] ?? 0),
    protein: Math.round((nutrientsById[203] ?? 0) * 10) / 10,
    carbs: Math.round((nutrientsById[205] ?? 0) * 10) / 10,
    fat: Math.round((nutrientsById[204] ?? 0) * 10) / 10,
    saturated_fat: Math.round((nutrientsById[606] ?? 0) * 10) / 10,
    polyunsaturated_fat: Math.round((nutrientsById[646] ?? 0) * 10) / 10,
    monounsaturated_fat: Math.round((nutrientsById[645] ?? 0) * 10) / 10,
    trans_fat: Math.round((nutrientsById[605] ?? 0) * 10) / 10,
    cholesterol: Math.round((nutrientsById[601] ?? 0) * 10) / 10,
    sodium: Math.round((nutrientsById[307] ?? 0) * 10) / 10,
    potassium: Math.round((nutrientsById[306] ?? 0) * 10) / 10,
    dietary_fiber: Math.round((nutrientsById[291] ?? 0) * 10) / 10,
    sugars: Math.round((nutrientsById[269] ?? 0) * 10) / 10,
    calcium: Math.round((nutrientsById[301] ?? 0) * 10) / 10,
    iron: Math.round((nutrientsById[303] ?? 0) * 10) / 10,
    vitamin_a:
      Math.round((nutrientsById[814] ?? nutrientsById[319] ?? 0) * 10) / 10,
    vitamin_c: Math.round((nutrientsById[401] ?? 0) * 10) / 10,
    caffeine_mg: Math.round((nutrientsById[262] ?? 0) * 10) / 10,
    alcohol_g: Math.round((nutrientsById[221] ?? 0) * 10) / 10,
    water_ml: Math.round((nutrientsById[255] ?? 0) * 10) / 10,
  };

  const defaultVariant = {
    serving_size: 100,
    serving_unit: 'g',
    ...base100g,
    provider_nutrients: providerNutrientsByLabel,
    provider_nutrient_units: providerNutrientUnits,
    is_default: true,
  };

  const variants = [defaultVariant];

  // Map portion measures as additional variants
  for (const serving of servingItems || []) {
    const factor = serving.conversion_factor_value;
    if (
      !factor ||
      factor <= 0 ||
      serving.measure_name?.toLowerCase().includes('no serving specified')
    ) {
      continue;
    }
    const { serving_size, serving_unit } = parseServingMeasure(
      serving.measure_name
    );

    // Scale provider nutrients by conversion factor
    const scaledProviderNutrients: Record<string, number> = {};
    for (const [key, val] of Object.entries(providerNutrientsByLabel)) {
      scaledProviderNutrients[key] = Math.round(val * factor * 100) / 100;
    }

    variants.push({
      serving_size,
      serving_unit,
      calories: Math.round(base100g.calories * factor),
      protein: Math.round(base100g.protein * factor * 10) / 10,
      carbs: Math.round(base100g.carbs * factor * 10) / 10,
      fat: Math.round(base100g.fat * factor * 10) / 10,
      saturated_fat: Math.round(base100g.saturated_fat * factor * 10) / 10,
      polyunsaturated_fat:
        Math.round(base100g.polyunsaturated_fat * factor * 10) / 10,
      monounsaturated_fat:
        Math.round(base100g.monounsaturated_fat * factor * 10) / 10,
      trans_fat: Math.round(base100g.trans_fat * factor * 10) / 10,
      cholesterol: Math.round(base100g.cholesterol * factor * 10) / 10,
      sodium: Math.round(base100g.sodium * factor * 10) / 10,
      potassium: Math.round(base100g.potassium * factor * 10) / 10,
      dietary_fiber: Math.round(base100g.dietary_fiber * factor * 10) / 10,
      sugars: Math.round(base100g.sugars * factor * 10) / 10,
      calcium: Math.round(base100g.calcium * factor * 10) / 10,
      iron: Math.round(base100g.iron * factor * 10) / 10,
      vitamin_a: Math.round(base100g.vitamin_a * factor * 10) / 10,
      vitamin_c: Math.round(base100g.vitamin_c * factor * 10) / 10,
      caffeine_mg: Math.round(base100g.caffeine_mg * factor * 10) / 10,
      alcohol_g: Math.round(base100g.alcohol_g * factor * 10) / 10,
      water_ml: Math.round(base100g.water_ml * factor * 10) / 10,
      provider_nutrients: scaledProviderNutrients,
      provider_nutrient_units: providerNutrientUnits,
      is_default: false,
    });
  }

  return {
    name: foodDescription,
    brand: 'Canadian Nutrient File',
    provider_external_id: String(foodCode),
    provider_type: 'canadian-nutrient-file',
    is_custom: false,
    default_variant: defaultVariant,
    variants,
  };
}

export async function searchCanadianNutrientFoods(
  query: string,
  page = 1,
  pageSize = 20,
  language = 'en',
  customBaseUrl?: string | null
) {
  const queryLang = resolveLanguage(language);
  const directory = await getCnfFoodDirectory(queryLang, customBaseUrl);

  const cleanQuery = query.trim().toLowerCase();
  const searchTerms = cleanQuery.split(/\s+/).filter(Boolean);

  const matched = directory.filter((item) => {
    const desc = item.food_description.toLowerCase();
    return searchTerms.every((term) => desc.includes(term));
  });

  const offset = (page - 1) * pageSize;
  const paginated = matched.slice(offset, offset + pageSize);

  const mappedFoods: CnfFoodDetail[] = [];
  const CONCURRENCY_LIMIT = 5;
  for (let i = 0; i < paginated.length; i += CONCURRENCY_LIMIT) {
    const chunk = paginated.slice(i, i + CONCURRENCY_LIMIT);
    const chunkResults = await Promise.all(
      chunk.map(async (item) => {
        try {
          const detail = await getCanadianNutrientFoodDetails(
            String(item.food_code),
            queryLang,
            customBaseUrl
          );
          if (detail) {
            return detail;
          }
        } catch (err) {
          log(
            'warn',
            `Failed to fetch details for CNF food ${item.food_code}: ${err}`
          );
        }

        return null;
      })
    );
    mappedFoods.push(
      ...chunkResults.filter((food): food is CnfFoodDetail => food !== null)
    );
  }

  return {
    foods: mappedFoods,
    pagination: {
      page,
      pageSize,
      totalCount: matched.length,
      hasMore: offset + pageSize < matched.length,
    },
  };
}

export async function getCanadianNutrientFoodDetails(
  externalId: string,
  language = 'en',
  customBaseUrl?: string | null
): Promise<CnfFoodDetail> {
  const foodCode = parseInt(externalId, 10);
  if (!Number.isFinite(foodCode)) {
    throw new Error(`Invalid foodCode: ${externalId}`);
  }

  const queryLang = resolveLanguage(language);
  const rawBaseUrl = customBaseUrl?.trim() || DEFAULT_BASE_URL;
  let baseUrl = rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }

  const detailCacheKey = `${baseUrl}|${queryLang}|${foodCode}`;
  const cachedDetail = foodDetailCache.get(detailCacheKey);
  const now = Date.now();
  if (cachedDetail && now - cachedDetail.timestamp < CACHE_TTL_MS) {
    return cachedDetail.detail;
  }

  const nutrientUrl = `${baseUrl}/nutrientamount/?id=${foodCode}&lang=${queryLang}&type=json`;
  const servingUrl = `${baseUrl}/servingsize/?id=${foodCode}&lang=${queryLang}&type=json`;

  try {
    const [nutrientRes, servingRes] = await Promise.all([
      cnfFetch(nutrientUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SparkyFitness/1.0',
        },
      }),
      cnfFetch(servingUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SparkyFitness/1.0',
        },
      }).catch((err) => {
        log(
          'warn',
          `[CNF] Failed to fetch serving sizes for food ${foodCode}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        return null;
      }),
    ]);

    if (!nutrientRes.ok) {
      throw new Error(`CNF nutrient API returned status ${nutrientRes.status}`);
    }

    const rawNutrients = (await nutrientRes.json()) as unknown;
    if (!Array.isArray(rawNutrients)) {
      throw new Error(
        'Invalid response format from CNF nutrient API: expected an array'
      );
    }
    const nutrientItems = rawNutrients as CnfNutrientItem[];

    const rawServings = servingRes?.ok
      ? ((await servingRes.json().catch(() => [])) as unknown)
      : [];
    const servingItems = Array.isArray(rawServings)
      ? (rawServings as CnfServingSizeItem[])
      : [];

    // Find food description from directory cache or first item description
    let description = servingItems[0]?.food_description;
    if (!description) {
      const directory = await getCnfFoodDirectory(queryLang, rawBaseUrl).catch(
        () => []
      );
      description =
        directory.find((d) => d.food_code === foodCode)?.food_description ||
        `Canadian Food #${foodCode}`;
    }

    const detail = mapCanadianNutrientFood(
      foodCode,
      description,
      nutrientItems,
      servingItems
    );

    foodDetailCache.set(detailCacheKey, {
      timestamp: now,
      detail,
    });

    return detail;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log('error', `Error fetching Canadian Nutrient Food details: ${msg}`);
    throw error;
  }
}

export default {
  getCnfFoodDirectory,
  searchCanadianNutrientFoods,
  getCanadianNutrientFoodDetails,
  mapCanadianNutrientFood,
};
