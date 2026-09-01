import { createHash, randomUUID } from 'node:crypto';
import {
  addDays,
  type CoachMealPlanActionRequest,
  type CoachMealPlanEntryResponse,
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
import coachProfileService from './coachProfileService.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import {
  coachIngredientKey,
  getCoachMealCatalog,
  getCoachMealSuggestionById,
  getCoachMealSuggestions,
  type CoachMealIngredient,
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

const COACH_MEAL_PLAN_ALGORITHM_VERSION = 'goal-aware-pantry-plan-v2';
const GENERATED_SLOTS: readonly CoachMealSlot[] = [
  'breakfast',
  'lunch',
  'dinner',
];

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
  language: string
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
  return warnings;
}

export async function getDashboard(
  userId: string,
  startDate: string,
  days: number
): Promise<CoachMealPlanningDashboardResponse> {
  const endDate = addDays(startDate, days - 1);
  const [pantry, planEntries, shopping, catalog, language] = await Promise.all([
    coachMealPlanningRepository.listPantryItems(userId),
    coachMealPlanningRepository.listMealPlanEntries(userId, startDate, endDate),
    coachMealPlanningRepository.getOpenShoppingList(userId),
    getCoachMealCatalog(userId),
    coachProfileRepository.getCoachLanguage(userId),
  ]);
  return {
    startDate,
    days,
    pantry: pantry.map(pantryResponse),
    shoppingList: shopping
      ? shoppingListResponse(shopping.list, shopping.items)
      : null,
    planEntries: planEntries.map(mealPlanEntryResponse),
    mealCatalog: catalog.map(recipeCatalogItem),
    warnings: dashboardWarnings(pantry, planEntries, language),
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
  available: ReadonlyMap<string, number>
): number {
  let required = 0;
  let covered = 0;
  for (const ingredient of meal.ingredients) {
    if (ingredient.shoppingRequired === false) continue;
    const key = `${coachIngredientKey(ingredient.nameDe)}\u0000${ingredient.unit}`;
    required += ingredient.amount;
    covered += Math.min(ingredient.amount, available.get(key) ?? 0);
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
  suggestionRank: ReadonlyMap<string, number>
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
      pantryCoverage(right, available) - pantryCoverage(left, available);
    if (Math.abs(coverageDifference) > 0.001) return coverageDifference;
    return (
      seededRecipeValue(`${date}:${slot}`, left.id) -
      seededRecipeValue(`${date}:${slot}`, right.id)
    );
  });
  return candidates[0] ?? null;
}

function perMealTarget(target: number | null): number | null {
  return target === null ? null : target / GENERATED_SLOTS.length;
}

function consumeVirtualPantry(
  available: Map<string, number>,
  ingredients: readonly CoachMealIngredient[]
): void {
  for (const ingredient of ingredients) {
    if (ingredient.shoppingRequired === false) continue;
    const key = `${coachIngredientKey(ingredient.nameDe)}\u0000${ingredient.unit}`;
    available.set(
      key,
      Math.max(0, (available.get(key) ?? 0) - ingredient.amount)
    );
  }
}

function planEntryInput(
  meal: CoachMealSuggestion,
  date: string,
  slot: CoachMealSlot
): PlanEntryInput {
  return {
    planDate: date,
    mealSlot: slot,
    recipeKey: meal.id,
    recipeName: meal.nameDe,
    servings: 1,
    estimatedCalories: meal.calories,
    estimatedProteinG: meal.proteinG,
    estimatedCarbsG: meal.carbsG,
    estimatedFatG: meal.fatG,
    prepMinutes: 30,
    preparation: meal.preparationDe,
    safetyStatus: 'validated',
    ingredients: meal.ingredients.map((ingredient) => ({
      ingredientKey: coachIngredientKey(ingredient.nameDe),
      name: ingredient.nameDe,
      category: ingredient.category,
      quantity: ingredient.amount,
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
  const [pantry, catalog, occupied, profile, language] = await Promise.all([
    coachMealPlanningRepository.listPantryItems(userId),
    getCoachMealCatalog(userId),
    input.replaceExisting
      ? Promise.resolve([])
      : coachMealPlanningRepository.listOccupiedPlanSlots(
          userId,
          input.startDate,
          endDate
        ),
    coachProfileService.getCoachProfile(userId),
    coachProfileRepository.getCoachLanguage(userId),
  ]);
  const german = language.toLowerCase().startsWith('de');
  const targets: CoachMealTargets = {
    caloriesRemaining: perMealTarget(profile.calorieTarget),
    proteinRemainingG: perMealTarget(profile.proteinTargetG),
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
  const occupiedKeys = new Set(
    occupied.map((entry) => `${entry.plan_date}\u0000${entry.meal_slot}`)
  );
  const available = new Map(
    pantry.map((item) => [
      `${item.ingredient_key}\u0000${item.unit}`,
      item.available_quantity,
    ])
  );
  const usage = new Map<string, number>();
  const entries: PlanEntryInput[] = [];
  const warnings: string[] = [];
  for (let dayIndex = 0; dayIndex < input.days; dayIndex += 1) {
    const date = addDays(input.startDate, dayIndex);
    for (const slot of GENERATED_SLOTS) {
      if (occupiedKeys.has(`${date}\u0000${slot}`)) continue;
      const recipe = chooseRecipe(
        catalog,
        slot,
        date,
        available,
        usage,
        suggestionRank
      );
      if (!recipe) {
        warnings.push(
          german
            ? `Für ${date} (${slot}) gibt es wegen deiner Ernährungsregeln noch kein sicher validiertes Rezept.`
            : `There is no safely validated recipe for ${date} (${slot}) under your dietary rules yet.`
        );
        continue;
      }
      entries.push(planEntryInput(recipe, date, slot));
      usage.set(recipe.id, (usage.get(recipe.id) ?? 0) + 1);
      consumeVirtualPantry(available, recipe.ingredients);
    }
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
    planEntryInput(meal, oldEntry.plan_date, oldEntry.meal_slot)
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
  getRestockReminder,
};
