import { createHash, randomUUID } from 'node:crypto';
import {
  addDays,
  COACH_MEAL_PLANNING_CALORIE_TOLERANCE_RATIO,
  type CoachMealPlanActionRequest,
  type CoachMealPlanEntryResponse,
  type CoachMealPlanningDailyNutrition,
  type CoachMealPlanningDashboardResponse,
  type CoachPantryItemResponse,
  type CoachRecipeCatalogItem,
  type CoachShoppingListItemResponse,
  type CoachShoppingListResponse,
  type ConfirmCoachShoppingPurchaseRequest,
  type CreateCoachPantryItemRequest,
  type CreateCoachShoppingItemRequest,
  type GenerateCoachMealPlanRequest,
  type PatchCoachPantryItemRequest,
  type PatchCoachShoppingItemRequest,
  type PreferredRetailProduct,
  type RetailProductRef,
  type ReplaceCoachMealPlanEntryRequest,
} from '@workspace/shared';
import coachEventService from './coachEventService.js';
import goalService from './goalService.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import {
  coachIngredientKey,
  getCoachMealCatalog,
  getCoachMealSuggestionById,
  getCoachMealSuggestions,
  type CoachMealSlot,
  type CoachMealSuggestion,
  type CoachMealTargets,
} from './coachMealSuggestionService.js';
import {
  getSwissRetailProductReferences,
  type SwissRetailProductReference,
} from '../constants/swissRetailProductCatalog.js';
import coachMealPlanningRepository, {
  CoachMealPlanningConflictError,
  type CoachPlanningUnit,
  type MealPlanEntryRow,
  type PantryProjectionRow,
  type PlanEntryInput,
  type ShoppingListItemRow,
  type ShoppingListRow,
  type ShoppingItemPatch,
  type ShoppingProductSnapshot,
} from '../models/coachMealPlanningRepository.js';

const COACH_MEAL_PLAN_ALGORITHM_VERSION = 'goal-aware-pantry-plan-v3';
const GENERATED_SLOTS: readonly CoachMealSlot[] = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
];
const DEFAULT_MEAL_PERCENTAGES: Readonly<Record<CoachMealSlot, number>> = {
  breakfast: 0.25,
  lunch: 0.25,
  dinner: 0.25,
  snack: 0.25,
};
const MIN_SLOT_CALORIES_KCAL = 1;

interface ResolvedDailyGoal {
  caloriesKcal: number | null;
  proteinG: number | null;
  mealPercentages: Readonly<Record<CoachMealSlot, number>>;
}

interface MealSlotAllocation {
  slot: CoachMealSlot;
  caloriesKcal: number | null;
  proteinG: number | null;
}

interface DailyGenerationContext {
  date: string;
  goal: ResolvedDailyGoal;
  allocations: MealSlotAllocation[];
  knownCaloriesKcal: number;
  estimateComplete: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function roundPlanningNumber(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}

function normalizeMealPercentages(
  goal: Record<string, unknown> | null
): Readonly<Record<CoachMealSlot, number>> {
  const raw: Record<CoachMealSlot, number> = {
    breakfast: nonNegativeNumber(goal?.breakfast_percentage) ?? 0,
    lunch: nonNegativeNumber(goal?.lunch_percentage) ?? 0,
    dinner: nonNegativeNumber(goal?.dinner_percentage) ?? 0,
    snack: nonNegativeNumber(goal?.snacks_percentage) ?? 0,
  };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return DEFAULT_MEAL_PERCENTAGES;
  return {
    breakfast: raw.breakfast / total,
    lunch: raw.lunch / total,
    dinner: raw.dinner / total,
    snack: raw.snack / total,
  };
}

function resolveDailyGoal(
  goalRange: Readonly<Record<string, unknown>>,
  date: string
): ResolvedDailyGoal {
  const goal = asRecord(goalRange[date]);
  return {
    caloriesKcal: positiveNumber(goal?.calories),
    proteinG: nonNegativeNumber(goal?.protein),
    mealPercentages: normalizeMealPercentages(goal),
  };
}

function allocateAcrossSlots(
  total: number,
  slots: readonly CoachMealSlot[],
  percentages: Readonly<Record<CoachMealSlot, number>>
): ReadonlyMap<CoachMealSlot, number> {
  if (slots.length === 0 || total <= 0) return new Map();
  const totalWeight = slots.reduce((sum, slot) => sum + percentages[slot], 0);
  if (totalWeight <= 0) return new Map();
  const allocations = new Map<CoachMealSlot, number>();
  let allocated = 0;
  slots.forEach((slot, index) => {
    const value =
      index === slots.length - 1
        ? roundPlanningNumber(total - allocated)
        : roundPlanningNumber((total * percentages[slot]) / totalWeight);
    allocations.set(slot, Math.max(0, value));
    allocated = roundPlanningNumber(allocated + value);
  });
  return allocations;
}

function buildDailyNutrition(
  startDate: string,
  days: number,
  entries: readonly MealPlanEntryRow[],
  goalRange: Readonly<Record<string, unknown>>
): CoachMealPlanningDailyNutrition[] {
  return Array.from({ length: days }, (_, dayIndex) => {
    const date = addDays(startDate, dayIndex);
    const goal = resolveDailyGoal(goalRange, date);
    const entriesForDate = entries.filter((entry) => entry.plan_date === date);
    const included = entriesForDate.filter(
      (entry) => entry.status === 'planned' || entry.status === 'prepared'
    );
    const isEstimateComplete = !entriesForDate.some(
      (entry) => entry.status === 'eaten_out'
    );
    const plannedCaloriesKcal = roundPlanningNumber(
      included.reduce((sum, entry) => sum + entry.estimated_calories, 0)
    );
    const plannedProteinG = roundPlanningNumber(
      included.reduce((sum, entry) => sum + entry.estimated_protein_g, 0)
    );
    return {
      date,
      targetCaloriesKcal: goal.caloriesKcal,
      targetProteinG: goal.proteinG,
      plannedCaloriesKcal,
      plannedProteinG,
      calorieDifferenceKcal:
        isEstimateComplete && goal.caloriesKcal !== null
          ? roundPlanningNumber(plannedCaloriesKcal - goal.caloriesKcal)
          : null,
      proteinDifferenceG:
        isEstimateComplete && goal.proteinG !== null
          ? roundPlanningNumber(plannedProteinG - goal.proteinG)
          : null,
      isEstimateComplete,
    };
  });
}

export class CoachMealPlanningNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoachMealPlanningNotFoundError';
  }
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function asRetailProduct(
  product: SwissRetailProductReference
): RetailProductRef {
  return {
    retailer: product.retailer,
    retailerProductId: product.retailerProductId,
    gtin: product.gtin,
    name: product.name,
    packageQuantity: product.packageQuantity,
    packageUnit: product.packageUnit,
    directUrl: product.directUrl,
    verifiedAt: product.verifiedAt,
    note: product.note,
  };
}

function productOptions(ingredientKey: string): RetailProductRef[] {
  return getSwissRetailProductReferences(ingredientKey).map(asRetailProduct);
}

function resolvePreferredProduct(
  ingredientKey: string,
  preferred: PreferredRetailProduct | null | undefined
): RetailProductRef | null {
  if (!preferred) return null;
  const product = productOptions(ingredientKey).find(
    (candidate) =>
      candidate.retailer === preferred.retailer &&
      candidate.retailerProductId === preferred.retailerProductId
  );
  if (!product) {
    throw new CoachMealPlanningConflictError(
      'The selected retailer product does not match this ingredient.'
    );
  }
  return product;
}

function validateRetailProduct(
  ingredientKey: string,
  selected: RetailProductRef | null | undefined,
  expectedUnit?: CoachPlanningUnit
): RetailProductRef | null {
  if (!selected) return null;
  const product = productOptions(ingredientKey).find(
    (candidate) =>
      candidate.retailer === selected.retailer &&
      candidate.retailerProductId === selected.retailerProductId
  );
  if (!product) {
    throw new CoachMealPlanningConflictError(
      'Only a verified product option for this ingredient can be selected.'
    );
  }
  if (expectedUnit !== undefined && product.packageUnit !== expectedUnit) {
    throw new CoachMealPlanningConflictError(
      'The selected retailer product unit does not match the shopping item unit.'
    );
  }
  return product;
}

function productSnapshot(
  product: RetailProductRef | null
): ShoppingProductSnapshot | null {
  if (!product) return null;
  return {
    retailer: product.retailer,
    productId: product.retailerProductId,
    gtin: product.gtin,
    name: product.name,
    url: product.directUrl,
    packageQuantity: product.packageQuantity,
    packageUnit: product.packageUnit,
    verifiedAt: product.verifiedAt,
    note: product.note,
  };
}

function pantryResponse(row: PantryProjectionRow): CoachPantryItemResponse {
  return {
    id: row.id,
    ingredientKey: row.ingredient_key,
    name: row.name,
    quantity: row.quantity,
    minimumQuantity: row.min_quantity,
    reservedQuantity: row.reserved_quantity,
    availableQuantity: row.available_quantity,
    shortageQuantity: row.shortage_quantity,
    unit: row.unit,
    category: row.category,
    preferredRetailer: row.preferred_retailer,
    preferredRetailerProductId: row.preferred_product_id,
    expiresOn: row.expires_on,
    isActive: row.is_active,
    productOptions: productOptions(row.ingredient_key),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function storedProduct(row: ShoppingListItemRow): RetailProductRef | null {
  if (
    !row.selected_retailer ||
    !row.selected_product_id ||
    !row.product_name ||
    !row.product_url ||
    row.package_quantity === null ||
    !row.package_unit ||
    !row.product_verified_at
  ) {
    return null;
  }
  return {
    retailer: row.selected_retailer,
    retailerProductId: row.selected_product_id,
    gtin: row.selected_product_gtin,
    name: row.product_name,
    packageQuantity: row.package_quantity,
    packageUnit: row.package_unit,
    directUrl: row.product_url,
    verifiedAt: iso(row.product_verified_at),
    note: row.product_note,
  };
}

function shoppingItemResponse(
  row: ShoppingListItemRow
): CoachShoppingListItemResponse {
  const options = productOptions(row.ingredient_key);
  return {
    id: row.id,
    ingredientKey: row.ingredient_key,
    name: row.name,
    requiredQuantity: row.needed_quantity,
    purchasedQuantity: row.purchased_quantity,
    remainingQuantity: Math.max(
      0,
      row.needed_quantity - row.purchased_quantity
    ),
    unit: row.unit,
    category: row.category,
    status: row.status,
    isManual: row.is_manual,
    quantityLocked: row.quantity_locked,
    sourceEntryIds: row.source_meal_entry_ids,
    selectedProduct: storedProduct(row),
    productOptions: options,
    notes: row.notes,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function shoppingListResponse(
  list: ShoppingListRow,
  items: ShoppingListItemRow[]
): CoachShoppingListResponse {
  return {
    id: list.id,
    title: list.title,
    coverageStart: list.coverage_start,
    coverageEnd: list.coverage_end,
    status: list.status,
    items: items.map(shoppingItemResponse),
    completedAt: list.completed_at ? iso(list.completed_at) : null,
    createdAt: iso(list.created_at),
    updatedAt: iso(list.updated_at),
  };
}

function mealPlanEntryResponse(
  row: MealPlanEntryRow
): CoachMealPlanEntryResponse {
  return {
    id: row.id,
    mealPlanId: row.plan_id,
    date: row.plan_date,
    slot: row.meal_slot,
    status: row.status,
    recipe: {
      recipeKey: row.recipe_key,
      name: row.recipe_name,
      description: row.recipe_description ?? null,
      prepMinutes: row.prep_minutes ?? 30,
      instructions: row.recipe_instructions ?? [row.preparation],
    },
    servings: row.servings,
    caloriesKcal: row.estimated_calories,
    proteinG: row.estimated_protein_g,
    carbsG: row.estimated_carbs_g,
    fatG: row.estimated_fat_g,
    safetyStatus: row.safety_status,
    replacementForId: row.replacement_for_entry_id,
    notes: row.notes,
    ingredients: row.ingredients.map((ingredient) => ({
      id: ingredient.id,
      pantryItemId: ingredient.pantry_item_id,
      ingredientKey: ingredient.ingredient_key,
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      category: ingredient.category,
      shoppingRequired: ingredient.shopping_required,
    })),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function recipeCatalogItem(meal: CoachMealSuggestion): CoachRecipeCatalogItem {
  return {
    recipe: {
      recipeKey: meal.id,
      name: meal.nameDe,
      description: null,
      prepMinutes: 30,
      instructions: [meal.preparationDe],
    },
    slots: meal.mealSlots,
    servings: 1,
    caloriesKcal: meal.calories,
    proteinG: meal.proteinG,
    carbsG: meal.carbsG,
    fatG: meal.fatG,
    ingredients: meal.ingredients.map((ingredient) => ({
      ingredientKey: coachIngredientKey(ingredient.nameDe),
      name: ingredient.nameDe,
      quantity: ingredient.amount,
      unit: ingredient.unit,
      category: ingredient.category,
    })),
  };
}

function dashboardWarnings(
  pantry: PantryProjectionRow[],
  entries: MealPlanEntryRow[],
  language: string,
  dailyNutrition: readonly CoachMealPlanningDailyNutrition[]
): string[] {
  const german = language.toLowerCase().startsWith('de');
  const warnings: string[] = [];
  if (entries.length === 0) {
    warnings.push(
      german
        ? 'Es ist noch kein Essensplan vorhanden. Erstelle zuerst einen Plan; daraus entsteht automatisch die Einkaufsliste.'
        : 'There is no meal plan yet. Create a plan first; its shopping list will be generated automatically.'
    );
  }
  const shortages = pantry.filter((item) => item.shortage_quantity > 0);
  if (shortages.length > 0) {
    warnings.push(
      german
        ? `Für den aktuellen Plan fehlen noch ${shortages.length} ${shortages.length === 1 ? 'Artikel' : 'Artikel'} im Vorrat.`
        : `${shortages.length} ${shortages.length === 1 ? 'item is' : 'items are'} still missing from the pantry for the current plan.`
    );
  }
  const datesWithEstimatedMeals = new Set(
    entries
      .filter(
        (entry) => entry.status === 'planned' || entry.status === 'prepared'
      )
      .map((entry) => entry.plan_date)
  );
  for (const summary of dailyNutrition) {
    if (
      !datesWithEstimatedMeals.has(summary.date) ||
      !summary.isEstimateComplete ||
      summary.targetCaloriesKcal === null ||
      summary.targetCaloriesKcal <= 0 ||
      summary.calorieDifferenceKcal === null
    ) {
      continue;
    }
    const differenceRatio =
      Math.abs(summary.calorieDifferenceKcal) / summary.targetCaloriesKcal;
    if (differenceRatio <= COACH_MEAL_PLANNING_CALORIE_TOLERANCE_RATIO) {
      continue;
    }
    const difference = Math.round(Math.abs(summary.calorieDifferenceKcal));
    const percentage = Math.round(differenceRatio * 100);
    warnings.push(
      german
        ? `Der Essensplan für ${summary.date} weicht um ${difference} kcal (${percentage} %) vom Tagesziel ab.`
        : `The meal plan for ${summary.date} differs from the daily target by ${difference} kcal (${percentage}%).`
    );
  }
  return warnings;
}

export async function getDashboard(
  userId: string,
  startDate: string,
  days: number
): Promise<CoachMealPlanningDashboardResponse> {
  const endDate = addDays(startDate, days - 1);
  const [pantry, planEntries, shopping, catalog, language, goalRange] =
    await Promise.all([
      coachMealPlanningRepository.listPantryItems(userId),
      coachMealPlanningRepository.listMealPlanEntries(
        userId,
        startDate,
        endDate
      ),
      coachMealPlanningRepository.getOpenShoppingList(userId),
      getCoachMealCatalog(userId),
      coachProfileRepository.getCoachLanguage(userId),
      goalService.getUserGoalsForRange(userId, startDate, endDate, true),
    ]);
  const dailyNutrition = buildDailyNutrition(
    startDate,
    days,
    planEntries,
    goalRange
  );
  return {
    startDate,
    days,
    pantry: pantry.map(pantryResponse),
    shoppingList: shopping
      ? shoppingListResponse(shopping.list, shopping.items)
      : null,
    planEntries: planEntries.map(mealPlanEntryResponse),
    dailyNutrition,
    mealCatalog: catalog.map(recipeCatalogItem),
    warnings: dashboardWarnings(pantry, planEntries, language, dailyNutrition),
    lastUpdatedAt: new Date().toISOString(),
  };
}

export async function createPantryItem(
  userId: string,
  input: CreateCoachPantryItemRequest
): Promise<string> {
  const ingredientKey = input.ingredientKey ?? coachIngredientKey(input.name);
  const preferred = resolvePreferredProduct(
    ingredientKey,
    input.preferredProduct
  );
  const id = await coachMealPlanningRepository.createPantryItem(
    userId,
    {
      ingredientKey,
      name: input.name,
      category: input.category,
      quantity: input.quantity,
      unit: input.unit,
      minQuantity: input.minimumQuantity,
      expiresOn: input.expiresOn,
      preferredRetailer: preferred?.retailer ?? null,
      preferredProductId: preferred?.retailerProductId ?? null,
    },
    `manual-create:${randomUUID()}`
  );
  coachEventService.publish(userId, 'coach');
  return id;
}

export async function updatePantryItem(
  userId: string,
  itemId: string,
  input: PatchCoachPantryItemRequest
): Promise<void> {
  const pantry = await coachMealPlanningRepository.listPantryItems(userId);
  const existing = pantry.find((item) => item.id === itemId);
  if (!existing)
    throw new CoachMealPlanningNotFoundError('Pantry item not found.');
  const preferred = Object.prototype.hasOwnProperty.call(
    input,
    'preferredProduct'
  )
    ? resolvePreferredProduct(existing.ingredient_key, input.preferredProduct)
    : undefined;
  const updated = await coachMealPlanningRepository.updatePantryItem(
    userId,
    itemId,
    {
      name: input.name,
      category: input.category,
      quantity: input.quantity,
      minQuantity: input.minimumQuantity,
      expiresOn: input.expiresOn,
      preferredRetailer:
        preferred === undefined ? undefined : (preferred?.retailer ?? null),
      preferredProductId:
        preferred === undefined
          ? undefined
          : (preferred?.retailerProductId ?? null),
    },
    `manual-update:${randomUUID()}`
  );
  if (!updated)
    throw new CoachMealPlanningNotFoundError('Pantry item not found.');
  coachEventService.publish(userId, 'coach');
}

export async function removePantryItem(
  userId: string,
  itemId: string
): Promise<void> {
  if (!(await coachMealPlanningRepository.archivePantryItem(userId, itemId))) {
    throw new CoachMealPlanningNotFoundError('Pantry item not found.');
  }
  coachEventService.publish(userId, 'coach');
}

export async function createShoppingItem(
  userId: string,
  input: CreateCoachShoppingItemRequest
): Promise<string> {
  const ingredientKey = input.ingredientKey ?? coachIngredientKey(input.name);
  const selected = validateRetailProduct(
    ingredientKey,
    input.selectedProduct,
    input.unit
  );
  const id = await coachMealPlanningRepository.createManualShoppingItem(
    userId,
    {
      ingredientKey,
      name: input.name,
      category: input.category,
      requiredQuantity: input.requiredQuantity,
      unit: input.unit,
      notes: input.notes,
      product: productSnapshot(selected),
    }
  );
  coachEventService.publish(userId, 'coach');
  return id;
}

export async function updateShoppingItem(
  userId: string,
  itemId: string,
  input: PatchCoachShoppingItemRequest
): Promise<void> {
  const current = await coachMealPlanningRepository.getOpenShoppingList(userId);
  const item = current?.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new CoachMealPlanningNotFoundError('Shopping-list item not found.');
  }
  const selectedProductIsSet =
    Object.prototype.hasOwnProperty.call(input, 'selectedProduct') &&
    input.selectedProduct !== undefined;
  const selected = selectedProductIsSet
    ? validateRetailProduct(
        item.ingredient_key,
        input.selectedProduct,
        item.unit
      )
    : undefined;
  const patch: ShoppingItemPatch = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.requiredQuantity !== undefined
      ? { requiredQuantity: input.requiredQuantity }
      : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.quantityLocked !== undefined
      ? { quantityLocked: input.quantityLocked }
      : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'notes') &&
    input.notes !== undefined
      ? { notes: input.notes }
      : {}),
    ...(selectedProductIsSet
      ? { product: productSnapshot(selected ?? null) }
      : {}),
  };
  const updated = await coachMealPlanningRepository.updateShoppingItem(
    userId,
    itemId,
    patch
  );
  if (!updated) {
    throw new CoachMealPlanningNotFoundError('Shopping-list item not found.');
  }
  coachEventService.publish(userId, 'coach');
}

export async function removeShoppingItem(
  userId: string,
  itemId: string
): Promise<void> {
  if (!(await coachMealPlanningRepository.skipShoppingItem(userId, itemId))) {
    throw new CoachMealPlanningNotFoundError('Shopping-list item not found.');
  }
  coachEventService.publish(userId, 'coach');
}

export async function confirmShoppingPurchase(
  userId: string,
  input: ConfirmCoachShoppingPurchaseRequest
): Promise<void> {
  await coachMealPlanningRepository.confirmPurchases(
    userId,
    input.operationId,
    input.purchases
  );
  coachEventService.publish(userId, 'coach');
}

function pantryCoverage(
  meal: CoachMealSuggestion,
  available: ReadonlyMap<string, number>,
  targetCaloriesKcal: number | null
): number {
  const scale =
    targetCaloriesKcal === null || meal.calories <= 0
      ? 1
      : targetCaloriesKcal / meal.calories;
  let required = 0;
  let covered = 0;
  for (const ingredient of meal.ingredients) {
    if (ingredient.shoppingRequired === false) continue;
    const key = `${coachIngredientKey(ingredient.nameDe)}\u0000${ingredient.unit}`;
    const scaledAmount = ingredient.amount * scale;
    required += scaledAmount;
    covered += Math.min(scaledAmount, available.get(key) ?? 0);
  }
  return required === 0 ? 1 : covered / required;
}

function seededRecipeValue(seed: string, recipeKey: string): number {
  return createHash('sha256')
    .update(`${seed}:${recipeKey}`)
    .digest()
    .readUInt32BE(0);
}

function chooseRecipe(
  catalog: readonly CoachMealSuggestion[],
  slot: CoachMealSlot,
  date: string,
  available: ReadonlyMap<string, number>,
  usage: ReadonlyMap<string, number>,
  suggestionRank: ReadonlyMap<string, number>,
  targetCaloriesKcal: number | null
): CoachMealSuggestion | null {
  const candidates = catalog.filter((meal) => meal.mealSlots.includes(slot));
  candidates.sort((left, right) => {
    const usageDifference =
      (usage.get(left.id) ?? 0) - (usage.get(right.id) ?? 0);
    if (usageDifference !== 0) return usageDifference;
    const rankDifference =
      (suggestionRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (suggestionRank.get(right.id) ?? Number.MAX_SAFE_INTEGER);
    if (rankDifference !== 0) return rankDifference;
    const coverageDifference =
      pantryCoverage(right, available, targetCaloriesKcal) -
      pantryCoverage(left, available, targetCaloriesKcal);
    if (Math.abs(coverageDifference) > 0.001) return coverageDifference;
    return (
      seededRecipeValue(`${date}:${slot}`, left.id) -
      seededRecipeValue(`${date}:${slot}`, right.id)
    );
  });
  return candidates[0] ?? null;
}

function consumeVirtualPantry(
  available: Map<string, number>,
  ingredients: Readonly<PlanEntryInput['ingredients']>
): void {
  for (const ingredient of ingredients) {
    if (ingredient.shoppingRequired === false) continue;
    const key = `${ingredient.ingredientKey}\u0000${ingredient.unit}`;
    available.set(
      key,
      Math.max(0, (available.get(key) ?? 0) - ingredient.quantity)
    );
  }
}

function planEntryInput(
  meal: CoachMealSuggestion,
  date: string,
  slot: CoachMealSlot,
  targetCaloriesKcal: number | null = null
): PlanEntryInput {
  const scale =
    targetCaloriesKcal === null || meal.calories <= 0
      ? 1
      : targetCaloriesKcal / meal.calories;
  const scaledQuantity = (quantity: number): number =>
    Math.max(0.001, roundPlanningNumber(quantity * scale));
  return {
    planDate: date,
    mealSlot: slot,
    recipeKey: meal.id,
    recipeName: meal.nameDe,
    servings: Math.max(0.001, roundPlanningNumber(scale)),
    estimatedCalories: roundPlanningNumber(meal.calories * scale),
    estimatedProteinG: roundPlanningNumber(meal.proteinG * scale),
    estimatedCarbsG: roundPlanningNumber(meal.carbsG * scale),
    estimatedFatG: roundPlanningNumber(meal.fatG * scale),
    prepMinutes: 30,
    preparation: meal.preparationDe,
    safetyStatus: 'validated',
    ingredients: meal.ingredients.map((ingredient) => ({
      ingredientKey: coachIngredientKey(ingredient.nameDe),
      name: ingredient.nameDe,
      category: ingredient.category,
      quantity: scaledQuantity(ingredient.amount),
      unit: ingredient.unit,
      shoppingRequired: ingredient.shoppingRequired !== false,
    })),
  };
}

export async function generateMealPlan(
  userId: string,
  input: GenerateCoachMealPlanRequest
): Promise<{
  planId: string | null;
  addedEntries: number;
  warnings: string[];
}> {
  const endDate = addDays(input.startDate, input.days - 1);
  const requestIdentity = {
    startDate: input.startDate,
    endDate,
    replaceExisting: input.replaceExisting,
  };
  const previous = await coachMealPlanningRepository.getPlanGenerationResult(
    userId,
    input.operationId,
    requestIdentity
  );
  if (previous) {
    return {
      planId: previous.planId,
      addedEntries: previous.entryIds.length,
      warnings: previous.warnings,
    };
  }
  const [catalog, existingEntries, goalRange, language] = await Promise.all([
    getCoachMealCatalog(userId),
    coachMealPlanningRepository.listMealPlanEntries(
      userId,
      input.startDate,
      endDate
    ),
    goalService.getUserGoalsForRange(userId, input.startDate, endDate, true),
    coachProfileRepository.getCoachLanguage(userId),
  ]);
  const replacedPlannedEntryIds = input.replaceExisting
    ? existingEntries
        .filter((entry) => entry.status === 'planned')
        .map((entry) => entry.id)
    : [];
  const pantry = await coachMealPlanningRepository.listPantryItems(
    userId,
    replacedPlannedEntryIds
  );
  const german = language.toLowerCase().startsWith('de');
  const warnings: string[] = [];
  const generationContexts: DailyGenerationContext[] = [];
  for (let dayIndex = 0; dayIndex < input.days; dayIndex += 1) {
    const date = addDays(input.startDate, dayIndex);
    const goal = resolveDailyGoal(goalRange, date);
    const entriesForDate = existingEntries.filter(
      (entry) => entry.plan_date === date && entry.status !== 'replaced'
    );
    const preservedEntries = entriesForDate.filter(
      (entry) => !(input.replaceExisting && entry.status === 'planned')
    );
    const occupiedSlots = new Set(
      preservedEntries.map((entry) => entry.meal_slot)
    );
    const knownEntries = preservedEntries.filter(
      (entry) => entry.status === 'planned' || entry.status === 'prepared'
    );
    const knownCaloriesKcal = roundPlanningNumber(
      knownEntries.reduce((sum, entry) => sum + entry.estimated_calories, 0)
    );
    const knownProteinG = roundPlanningNumber(
      knownEntries.reduce((sum, entry) => sum + entry.estimated_protein_g, 0)
    );
    const estimateComplete = !preservedEntries.some(
      (entry) => entry.status === 'eaten_out'
    );
    const openSlots = GENERATED_SLOTS.filter(
      (slot) => goal.mealPercentages[slot] > 0 && !occupiedSlots.has(slot)
    );
    const feasibleSlots = openSlots.filter((slot) => {
      const feasible = catalog.some((meal) => meal.mealSlots.includes(slot));
      if (!feasible) {
        warnings.push(
          german
            ? `Für ${date} (${slot}) gibt es wegen deiner Ernährungsregeln noch kein sicher validiertes Rezept.`
            : `There is no safely validated recipe for ${date} (${slot}) under your dietary rules yet.`
        );
      }
      return feasible;
    });
    const dailyCaloriesTarget = goal.caloriesKcal;
    const calorieAllocations =
      dailyCaloriesTarget === null
        ? new Map<CoachMealSlot, number>()
        : estimateComplete
          ? allocateAcrossSlots(
              Math.max(0, dailyCaloriesTarget - knownCaloriesKcal),
              feasibleSlots,
              goal.mealPercentages
            )
          : new Map(
              feasibleSlots.map((slot) => [
                slot,
                roundPlanningNumber(
                  dailyCaloriesTarget * goal.mealPercentages[slot]
                ),
              ])
            );
    const dailyProteinTarget = goal.proteinG;
    const proteinAllocations =
      dailyProteinTarget === null
        ? new Map<CoachMealSlot, number>()
        : estimateComplete
          ? allocateAcrossSlots(
              Math.max(0, dailyProteinTarget - knownProteinG),
              feasibleSlots,
              goal.mealPercentages
            )
          : new Map(
              feasibleSlots.map((slot) => [
                slot,
                roundPlanningNumber(
                  dailyProteinTarget * goal.mealPercentages[slot]
                ),
              ])
            );
    const allocations = feasibleSlots.flatMap((slot) => {
      const caloriesKcal = calorieAllocations.get(slot) ?? null;
      if (
        dailyCaloriesTarget !== null &&
        (caloriesKcal === null || caloriesKcal < MIN_SLOT_CALORIES_KCAL)
      ) {
        warnings.push(
          german
            ? `Für ${date} (${slot}) bleibt nach bereits eingeplanten Mahlzeiten kein sinnvoller Kalorienanteil übrig.`
            : `No meaningful calorie allocation remains for ${date} (${slot}) after existing meals are counted.`
        );
        return [];
      }
      return [
        {
          slot,
          caloriesKcal,
          proteinG: proteinAllocations.get(slot) ?? null,
        },
      ];
    });
    generationContexts.push({
      date,
      goal,
      allocations,
      knownCaloriesKcal,
      estimateComplete,
    });
  }
  const allAllocations = generationContexts.flatMap(
    (context) => context.allocations
  );
  const targets: CoachMealTargets = {
    caloriesRemaining:
      allAllocations.length === 0 ||
      allAllocations.some((allocation) => allocation.caloriesKcal === null)
        ? null
        : roundPlanningNumber(
            allAllocations.reduce(
              (sum, allocation) => sum + (allocation.caloriesKcal ?? 0),
              0
            ) / allAllocations.length
          ),
    proteinRemainingG:
      allAllocations.length === 0 ||
      allAllocations.some((allocation) => allocation.proteinG === null)
        ? null
        : roundPlanningNumber(
            allAllocations.reduce(
              (sum, allocation) => sum + (allocation.proteinG ?? 0),
              0
            ) / allAllocations.length
          ),
  };
  const rankedSuggestions = await getCoachMealSuggestions(
    userId,
    targets,
    `meal-plan:${input.operationId}`,
    Math.max(1, catalog.length)
  );
  const suggestionRank = new Map(
    rankedSuggestions.map((meal, index) => [meal.id, index])
  );
  const available = new Map(
    pantry.map((item) => [
      `${item.ingredient_key}\u0000${item.unit}`,
      item.available_quantity,
    ])
  );
  const usage = new Map<string, number>();
  const entries: PlanEntryInput[] = [];
  for (const context of generationContexts) {
    for (const allocation of context.allocations) {
      const recipe = chooseRecipe(
        catalog,
        allocation.slot,
        context.date,
        available,
        usage,
        suggestionRank,
        allocation.caloriesKcal
      );
      if (!recipe) {
        warnings.push(
          german
            ? `Für ${context.date} (${allocation.slot}) gibt es wegen deiner Ernährungsregeln noch kein sicher validiertes Rezept.`
            : `There is no safely validated recipe for ${context.date} (${allocation.slot}) under your dietary rules yet.`
        );
        continue;
      }
      const entry = planEntryInput(
        recipe,
        context.date,
        allocation.slot,
        allocation.caloriesKcal
      );
      entries.push(entry);
      usage.set(recipe.id, (usage.get(recipe.id) ?? 0) + 1);
      consumeVirtualPantry(available, entry.ingredients);
    }
  }
  for (const context of generationContexts) {
    if (!context.estimateComplete) {
      warnings.push(
        german
          ? `Die Kalorienabweichung für ${context.date} kann wegen einer auswärts gegessenen Mahlzeit nicht vollständig geprüft werden.`
          : `The calorie deviation for ${context.date} cannot be checked completely because a meal was eaten out.`
      );
      continue;
    }
    if (context.goal.caloriesKcal === null) continue;
    const generatedCalories = entries
      .filter((entry) => entry.planDate === context.date)
      .reduce((sum, entry) => sum + entry.estimatedCalories, 0);
    const plannedCalories = roundPlanningNumber(
      context.knownCaloriesKcal + generatedCalories
    );
    const difference = plannedCalories - context.goal.caloriesKcal;
    const differenceRatio = Math.abs(difference) / context.goal.caloriesKcal;
    if (differenceRatio <= COACH_MEAL_PLANNING_CALORIE_TOLERANCE_RATIO) {
      continue;
    }
    warnings.push(
      german
        ? `Der Essensplan für ${context.date} erreicht ${Math.round(plannedCalories)} statt ${Math.round(context.goal.caloriesKcal)} kcal und weicht damit um ${Math.round(Math.abs(difference))} kcal (${Math.round(differenceRatio * 100)} %) vom Tagesziel ab.`
        : `The meal plan for ${context.date} reaches ${Math.round(plannedCalories)} instead of ${Math.round(context.goal.caloriesKcal)} kcal, a deviation of ${Math.round(Math.abs(difference))} kcal (${Math.round(differenceRatio * 100)}%).`
    );
  }
  const generated = await coachMealPlanningRepository.generatePlan(userId, {
    operationId: input.operationId,
    startDate: input.startDate,
    endDate,
    replaceExisting: input.replaceExisting,
    algorithmVersion: COACH_MEAL_PLAN_ALGORITHM_VERSION,
    warnings,
    entries,
  });
  coachEventService.publish(userId, 'coach');
  return {
    planId: generated.planId,
    addedEntries: generated.entryIds.length,
    warnings: generated.warnings,
  };
}

export async function applyMealPlanAction(
  userId: string,
  entryId: string,
  input: CoachMealPlanActionRequest
): Promise<void> {
  const status = await coachMealPlanningRepository.applyPlanEntryAction(
    userId,
    entryId,
    input.action,
    input.operationId,
    input.notes ?? null
  );
  if (!status) {
    throw new CoachMealPlanningNotFoundError('Meal-plan entry not found.');
  }
  coachEventService.publish(userId, 'coach');
}

export async function replaceMealPlanEntry(
  userId: string,
  entryId: string,
  input: ReplaceCoachMealPlanEntryRequest
): Promise<string> {
  const oldEntry = await coachMealPlanningRepository.getMealPlanEntry(
    userId,
    entryId
  );
  if (!oldEntry) {
    throw new CoachMealPlanningNotFoundError('Meal-plan entry not found.');
  }
  const meal = await getCoachMealSuggestionById(userId, input.recipeKey);
  if (!meal || !meal.mealSlots.includes(oldEntry.meal_slot)) {
    throw new CoachMealPlanningConflictError(
      'The replacement recipe is unavailable or unsuitable for this meal slot.'
    );
  }
  const replaced = await coachMealPlanningRepository.replacePlanEntry(
    userId,
    entryId,
    input.operationId,
    planEntryInput(
      meal,
      oldEntry.plan_date,
      oldEntry.meal_slot,
      oldEntry.estimated_calories
    )
  );
  if (!replaced) {
    throw new CoachMealPlanningNotFoundError('Meal-plan entry not found.');
  }
  coachEventService.publish(userId, 'coach');
  return replaced.entryId;
}

function formatQuantity(quantity: number, unit: CoachPlanningUnit): string {
  const amount = Number.isInteger(quantity)
    ? String(quantity)
    : String(Number(quantity.toFixed(1)));
  const localizedUnit =
    unit === 'piece'
      ? 'Stück'
      : unit === 'tsp'
        ? 'TL'
        : unit === 'tbsp'
          ? 'EL'
          : unit;
  return `${amount} ${localizedUnit}`;
}

export interface CoachRestockReminder {
  itemCount: number;
  listId: string;
  signature: string;
  textDe: string;
  textEn: string;
}

export async function getRestockReminder(
  userId: string
): Promise<CoachRestockReminder | null> {
  const shopping =
    await coachMealPlanningRepository.getOpenShoppingList(userId);
  if (!shopping) return null;
  const remaining = shopping.items.filter(
    (item) =>
      item.status === 'needed' && item.needed_quantity > item.purchased_quantity
  );
  if (remaining.length === 0) return null;
  const previewDe = remaining
    .slice(0, 5)
    .map(
      (item) =>
        `${formatQuantity(item.needed_quantity - item.purchased_quantity, item.unit)} ${item.name}`
    )
    .join(', ');
  const extra =
    remaining.length > 5 ? ` und ${remaining.length - 5} weitere` : '';
  const signature = createHash('sha256')
    .update(
      JSON.stringify(
        remaining.map((item) => [
          item.id,
          item.needed_quantity - item.purchased_quantity,
        ])
      )
    )
    .digest('hex');
  return {
    itemCount: remaining.length,
    listId: shopping.list.id,
    signature,
    textDe: `Für deine geplanten Mahlzeiten fehlt noch: ${previewDe}${extra}. Kaufe das heute ein, damit der Plan für die nächsten Tage nicht ins Leere läuft.`,
    textEn: `${remaining.length} grocery ${remaining.length === 1 ? 'item is' : 'items are'} still missing for your planned meals. Buy them today so the next few days remain covered.`,
  };
}

export async function deleteMealPlanEntry(
  userId: string,
  entryId: string
): Promise<void> {
  const deleted = await coachMealPlanningRepository.deletePlanEntry(
    userId,
    entryId
  );
  if (!deleted) {
    throw new CoachMealPlanningNotFoundError('Meal-plan entry not found.');
  }
  coachEventService.publish(userId, 'coach');
}

export async function recalculateShoppingList(
  userId: string
): Promise<CoachShoppingListResponse | null> {
  await coachMealPlanningRepository.recalculateShoppingList(userId);
  coachEventService.publish(userId, 'coach');
  const shopping =
    await coachMealPlanningRepository.getOpenShoppingList(userId);
  return shopping ? shoppingListResponse(shopping.list, shopping.items) : null;
}

export default {
  getDashboard,
  createPantryItem,
  updatePantryItem,
  removePantryItem,
  createShoppingItem,
  updateShoppingItem,
  removeShoppingItem,
  confirmShoppingPurchase,
  generateMealPlan,
  applyMealPlanAction,
  replaceMealPlanEntry,
  deleteMealPlanEntry,
  recalculateShoppingList,
  getRestockReminder,
};
