import { z } from "zod";
import {
  coachMealPlanningCategorySchema,
  coachMealPlanningDaySchema,
  coachMealPlanningQuantitySchema,
  coachMealPlanningRetailerSchema,
  coachMealPlanningUnitSchema,
} from "../database/CoachPantryItems.zod.ts";
import {
  coachMealPlanEntryStatusSchema,
  coachMealSafetyStatusSchema,
  coachMealSlotSchema,
} from "../database/CoachMealPlanEntries.zod.ts";
import {
  coachShoppingListItemStatusSchema,
  isOfficialCoachRetailerUrl,
} from "../database/CoachShoppingListItems.zod.ts";
import { coachShoppingListStatusSchema } from "../database/CoachShoppingLists.zod.ts";
import { addDays } from "../../utils/timezone.ts";

export const COACH_MEAL_PLANNING_CALORIE_TOLERANCE_RATIO = 0.05;

const compactTextSchema = z.string().trim().min(1).max(200);
const positiveQuantitySchema = coachMealPlanningQuantitySchema.positive();
const responseTimestampSchema = z.string().datetime({ offset: true });

export const retailProductRefSchema = z
  .object({
    retailer: coachMealPlanningRetailerSchema,
    retailerProductId: z.string().trim().min(1).max(200),
    gtin: z
      .string()
      .regex(/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/)
      .nullable(),
    name: z.string().trim().min(1).max(300),
    packageQuantity: positiveQuantitySchema,
    packageUnit: coachMealPlanningUnitSchema,
    directUrl: z.string().url(),
    verifiedAt: responseTimestampSchema,
    note: z.string().trim().min(1).max(500).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!isOfficialCoachRetailerUrl(value.retailer, value.directUrl)) {
      ctx.addIssue({
        code: "custom",
        message: `Expected an official ${value.retailer} HTTPS product URL`,
        path: ["directUrl"],
      });
    }
  });

export const preferredRetailProductSchema = z
  .object({
    retailer: coachMealPlanningRetailerSchema,
    retailerProductId: z.string().trim().min(1).max(200),
  })
  .strict();

export const coachPantryItemResponseSchema = z
  .object({
    id: z.string().uuid(),
    ingredientKey: compactTextSchema,
    name: compactTextSchema,
    quantity: coachMealPlanningQuantitySchema,
    minimumQuantity: coachMealPlanningQuantitySchema,
    reservedQuantity: coachMealPlanningQuantitySchema,
    availableQuantity: coachMealPlanningQuantitySchema,
    shortageQuantity: coachMealPlanningQuantitySchema,
    unit: coachMealPlanningUnitSchema,
    category: coachMealPlanningCategorySchema,
    preferredRetailer: coachMealPlanningRetailerSchema.nullable(),
    preferredRetailerProductId: z.string().trim().min(1).max(200).nullable(),
    expiresOn: coachMealPlanningDaySchema.nullable(),
    isActive: z.boolean(),
    productOptions: z.array(retailProductRefSchema).max(20),
    createdAt: responseTimestampSchema,
    updatedAt: responseTimestampSchema,
  })
  .strict()
  .refine(
    (value) =>
      (value.preferredRetailer === null) ===
      (value.preferredRetailerProductId === null),
    {
      message: "Preferred retailer and product id must be supplied together",
      path: ["preferredRetailerProductId"],
    },
  );

export const createCoachPantryItemRequestSchema = z
  .object({
    ingredientKey: compactTextSchema.optional(),
    name: compactTextSchema,
    quantity: coachMealPlanningQuantitySchema,
    minimumQuantity: coachMealPlanningQuantitySchema.default(0),
    unit: coachMealPlanningUnitSchema,
    category: coachMealPlanningCategorySchema,
    preferredProduct: preferredRetailProductSchema.nullable().default(null),
    expiresOn: coachMealPlanningDaySchema.nullable().default(null),
  })
  .strict();

export const patchCoachPantryItemRequestSchema = z
  .object({
    name: compactTextSchema.optional(),
    quantity: coachMealPlanningQuantitySchema.optional(),
    minimumQuantity: coachMealPlanningQuantitySchema.optional(),
    category: coachMealPlanningCategorySchema.optional(),
    preferredProduct: preferredRetailProductSchema.nullable().optional(),
    expiresOn: coachMealPlanningDaySchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((item) => item !== undefined),
    "No changes supplied",
  );

export const coachShoppingListItemResponseSchema = z
  .object({
    id: z.string().uuid(),
    ingredientKey: compactTextSchema,
    name: compactTextSchema,
    requiredQuantity: positiveQuantitySchema,
    purchasedQuantity: coachMealPlanningQuantitySchema,
    remainingQuantity: coachMealPlanningQuantitySchema,
    unit: coachMealPlanningUnitSchema,
    category: coachMealPlanningCategorySchema,
    status: coachShoppingListItemStatusSchema,
    isManual: z.boolean(),
    quantityLocked: z.boolean(),
    notes: z.string().trim().min(1).max(1_000).nullable(),
    sourceEntryIds: z.array(z.string().uuid()).max(100),
    selectedProduct: retailProductRefSchema.nullable(),
    productOptions: z.array(retailProductRefSchema).max(20),
    createdAt: responseTimestampSchema,
    updatedAt: responseTimestampSchema,
  })
  .strict();

export const coachShoppingListResponseSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    coverageStart: coachMealPlanningDaySchema.nullable(),
    coverageEnd: coachMealPlanningDaySchema.nullable(),
    status: coachShoppingListStatusSchema,
    items: z.array(coachShoppingListItemResponseSchema),
    completedAt: responseTimestampSchema.nullable(),
    createdAt: responseTimestampSchema,
    updatedAt: responseTimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.coverageStart === null) !== (value.coverageEnd === null)) {
      ctx.addIssue({
        code: "custom",
        message: "Shopping-list coverage dates must be supplied together",
        path: ["coverageEnd"],
      });
      return;
    }
    if (
      value.coverageStart !== null &&
      value.coverageEnd !== null &&
      value.coverageEnd < value.coverageStart
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Shopping-list coverage end must not precede its start",
        path: ["coverageEnd"],
      });
    }
  });

export const createCoachShoppingItemRequestSchema = z
  .object({
    ingredientKey: compactTextSchema.optional(),
    name: compactTextSchema,
    requiredQuantity: positiveQuantitySchema,
    unit: coachMealPlanningUnitSchema,
    category: coachMealPlanningCategorySchema,
    notes: z.string().trim().min(1).max(1_000).nullable().default(null),
    selectedProduct: retailProductRefSchema.nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.selectedProduct !== null &&
      value.selectedProduct.packageUnit !== value.unit
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Selected product package unit must match the shopping item unit",
        path: ["selectedProduct", "packageUnit"],
      });
    }
  });

export const patchCoachShoppingItemRequestSchema = z
  .object({
    name: compactTextSchema.optional(),
    requiredQuantity: positiveQuantitySchema.optional(),
    category: coachMealPlanningCategorySchema.optional(),
    status: z.enum(["needed", "skipped"]).optional(),
    quantityLocked: z.boolean().optional(),
    notes: z.string().trim().min(1).max(1_000).nullable().optional(),
    selectedProduct: retailProductRefSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((item) => item !== undefined),
    "No changes supplied",
  );

export const confirmCoachShoppingPurchaseRequestSchema = z
  .object({
    operationId: z.string().uuid(),
    purchases: z
      .array(
        z
          .object({
            itemId: z.string().uuid(),
            quantity: positiveQuantitySchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seenItemIds = new Set<string>();
    value.purchases.forEach((purchase, index) => {
      if (seenItemIds.has(purchase.itemId)) {
        ctx.addIssue({
          code: "custom",
          message: "Each shopping item may only appear once per purchase",
          path: ["purchases", index, "itemId"],
        });
      }
      seenItemIds.add(purchase.itemId);
    });
  });

export const recipeSnapshotSchema = z
  .object({
    recipeKey: compactTextSchema,
    name: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(2_000).nullable(),
    prepMinutes: z.number().int().min(0).max(1_440),
    instructions: z.array(z.string().trim().min(1).max(1_000)).min(1).max(100),
  })
  .strict();

export const coachMealPlanIngredientResponseSchema = z
  .object({
    id: z.string().uuid(),
    pantryItemId: z.string().uuid().nullable(),
    ingredientKey: compactTextSchema,
    name: compactTextSchema,
    quantity: positiveQuantitySchema,
    unit: coachMealPlanningUnitSchema,
    category: coachMealPlanningCategorySchema,
    shoppingRequired: z.boolean(),
  })
  .strict();

export const coachMealPlanEntryResponseSchema = z
  .object({
    id: z.string().uuid(),
    mealPlanId: z.string().uuid(),
    date: coachMealPlanningDaySchema,
    slot: coachMealSlotSchema,
    status: coachMealPlanEntryStatusSchema,
    recipe: recipeSnapshotSchema,
    servings: positiveQuantitySchema,
    caloriesKcal: coachMealPlanningQuantitySchema,
    proteinG: coachMealPlanningQuantitySchema,
    carbsG: coachMealPlanningQuantitySchema,
    fatG: coachMealPlanningQuantitySchema,
    safetyStatus: coachMealSafetyStatusSchema,
    replacementForId: z.string().uuid().nullable(),
    notes: z.string().trim().min(1).max(2_000).nullable(),
    ingredients: z.array(coachMealPlanIngredientResponseSchema).min(1).max(100),
    createdAt: responseTimestampSchema,
    updatedAt: responseTimestampSchema,
  })
  .strict();

export const coachMealPlanningDailyNutritionSchema = z
  .object({
    date: coachMealPlanningDaySchema,
    targetCaloriesKcal: coachMealPlanningQuantitySchema.nullable(),
    targetProteinG: coachMealPlanningQuantitySchema.nullable(),
    plannedCaloriesKcal: coachMealPlanningQuantitySchema,
    plannedProteinG: coachMealPlanningQuantitySchema,
    calorieDifferenceKcal: z.number().finite().nullable(),
    proteinDifferenceG: z.number().finite().nullable(),
    isEstimateComplete: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const validateDifference = (
      label: "Calorie" | "Protein",
      target: number | null,
      planned: number,
      difference: number | null,
      path: "calorieDifferenceKcal" | "proteinDifferenceG",
    ): void => {
      const shouldHaveDifference = value.isEstimateComplete && target !== null;
      if (!shouldHaveDifference && difference !== null) {
        ctx.addIssue({
          code: "custom",
          message: `${label} difference must be null without a target or for an incomplete estimate`,
          path: [path],
        });
      } else if (shouldHaveDifference && difference === null) {
        ctx.addIssue({
          code: "custom",
          message: `${label} difference is required for a complete estimate`,
          path: [path],
        });
      } else if (
        shouldHaveDifference &&
        target !== null &&
        difference !== null &&
        Math.abs(difference - (planned - target)) > 0.001
      ) {
        ctx.addIssue({
          code: "custom",
          message: `${label} difference must equal planned amount minus target`,
          path: [path],
        });
      }
    };

    validateDifference(
      "Calorie",
      value.targetCaloriesKcal,
      value.plannedCaloriesKcal,
      value.calorieDifferenceKcal,
      "calorieDifferenceKcal",
    );
    validateDifference(
      "Protein",
      value.targetProteinG,
      value.plannedProteinG,
      value.proteinDifferenceG,
      "proteinDifferenceG",
    );
  });

export const recipeCatalogIngredientSchema = z
  .object({
    ingredientKey: compactTextSchema,
    name: compactTextSchema,
    quantity: positiveQuantitySchema,
    unit: coachMealPlanningUnitSchema,
    category: coachMealPlanningCategorySchema,
  })
  .strict();

export const coachRecipeCatalogItemSchema = z
  .object({
    recipe: recipeSnapshotSchema,
    slots: z.array(coachMealSlotSchema).min(1).max(4),
    servings: positiveQuantitySchema,
    caloriesKcal: coachMealPlanningQuantitySchema,
    proteinG: coachMealPlanningQuantitySchema,
    carbsG: coachMealPlanningQuantitySchema,
    fatG: coachMealPlanningQuantitySchema,
    ingredients: z.array(recipeCatalogIngredientSchema).min(1).max(100),
  })
  .strict();

export const coachMealPlanningDashboardQuerySchema = z
  .object({
    startDate: coachMealPlanningDaySchema,
    days: z.coerce.number().int().min(1).max(7),
  })
  .strict();

export const generateCoachMealPlanRequestSchema = z
  .object({
    operationId: z.string().uuid(),
    startDate: coachMealPlanningDaySchema,
    days: z.number().int().min(1).max(7),
    replaceExisting: z.boolean(),
  })
  .strict();

export const coachMealPlanActionRequestSchema = z
  .object({
    operationId: z.string().uuid(),
    action: z.enum(["prepared", "eaten_out", "skipped"]),
    notes: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export const replaceCoachMealPlanEntryRequestSchema = z
  .object({
    operationId: z.string().uuid(),
    recipeKey: compactTextSchema,
  })
  .strict();

export const coachMealPlanningDashboardResponseSchema = z
  .object({
    startDate: coachMealPlanningDaySchema,
    days: z.number().int().min(1).max(7),
    pantry: z.array(coachPantryItemResponseSchema),
    shoppingList: coachShoppingListResponseSchema.nullable(),
    planEntries: z.array(coachMealPlanEntryResponseSchema),
    dailyNutrition: z
      .array(coachMealPlanningDailyNutritionSchema)
      .min(1)
      .max(7),
    mealCatalog: z.array(coachRecipeCatalogItemSchema),
    warnings: z.array(z.string().trim().min(1).max(1_000)).max(100),
    lastUpdatedAt: responseTimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.dailyNutrition.length !== value.days) {
      ctx.addIssue({
        code: "custom",
        message: "Expected one daily nutrition summary per requested day",
        path: ["dailyNutrition"],
      });
      return;
    }

    value.dailyNutrition.forEach((summary, index) => {
      const expectedDate = addDays(value.startDate, index);
      if (summary.date !== expectedDate) {
        ctx.addIssue({
          code: "custom",
          message: `Expected daily nutrition summary for ${expectedDate}`,
          path: ["dailyNutrition", index, "date"],
        });
      }

      const entriesForDate = value.planEntries.filter(
        (entry) => entry.date === summary.date,
      );
      const activeEntries = entriesForDate.filter(
        (entry) => entry.status === "planned" || entry.status === "prepared",
      );
      const expectedCaloriesKcal = activeEntries.reduce(
        (total, entry) => total + entry.caloriesKcal,
        0,
      );
      const expectedProteinG = activeEntries.reduce(
        (total, entry) => total + entry.proteinG,
        0,
      );
      if (
        Math.abs(summary.plannedCaloriesKcal - expectedCaloriesKcal) > 0.001
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Planned calories must equal the total for planned and prepared entries",
          path: ["dailyNutrition", index, "plannedCaloriesKcal"],
        });
      }
      if (Math.abs(summary.plannedProteinG - expectedProteinG) > 0.001) {
        ctx.addIssue({
          code: "custom",
          message:
            "Planned protein must equal the total for planned and prepared entries",
          path: ["dailyNutrition", index, "plannedProteinG"],
        });
      }

      const expectedEstimateComplete = !entriesForDate.some(
        (entry) => entry.status === "eaten_out",
      );
      if (summary.isEstimateComplete !== expectedEstimateComplete) {
        ctx.addIssue({
          code: "custom",
          message:
            "Estimate completeness must reflect whether the day contains an eating-out entry",
          path: ["dailyNutrition", index, "isEstimateComplete"],
        });
      }
    });

    const summaryDates = new Set(
      value.dailyNutrition.map((summary) => summary.date),
    );
    value.planEntries.forEach((entry, index) => {
      if (!summaryDates.has(entry.date)) {
        ctx.addIssue({
          code: "custom",
          message: "Meal-plan entry date must be covered by daily nutrition",
          path: ["planEntries", index, "date"],
        });
      }
    });
  });

export type RetailProductRef = z.infer<typeof retailProductRefSchema>;
export type PreferredRetailProduct = z.infer<
  typeof preferredRetailProductSchema
>;
export type CoachPantryItemResponse = z.infer<
  typeof coachPantryItemResponseSchema
>;
export type CreateCoachPantryItemRequest = z.infer<
  typeof createCoachPantryItemRequestSchema
>;
export type PatchCoachPantryItemRequest = z.infer<
  typeof patchCoachPantryItemRequestSchema
>;
export type CoachShoppingListItemResponse = z.infer<
  typeof coachShoppingListItemResponseSchema
>;
export type CoachShoppingListResponse = z.infer<
  typeof coachShoppingListResponseSchema
>;
export type CreateCoachShoppingItemRequest = z.infer<
  typeof createCoachShoppingItemRequestSchema
>;
export type PatchCoachShoppingItemRequest = z.infer<
  typeof patchCoachShoppingItemRequestSchema
>;
export type ConfirmCoachShoppingPurchaseRequest = z.infer<
  typeof confirmCoachShoppingPurchaseRequestSchema
>;
export type RecipeSnapshot = z.infer<typeof recipeSnapshotSchema>;
export type CoachMealPlanIngredientResponse = z.infer<
  typeof coachMealPlanIngredientResponseSchema
>;
export type CoachMealPlanEntryResponse = z.infer<
  typeof coachMealPlanEntryResponseSchema
>;
export type CoachMealPlanningDailyNutrition = z.infer<
  typeof coachMealPlanningDailyNutritionSchema
>;
export type CoachRecipeCatalogItem = z.infer<
  typeof coachRecipeCatalogItemSchema
>;
export type CoachMealPlanningDashboardQuery = z.infer<
  typeof coachMealPlanningDashboardQuerySchema
>;
export type GenerateCoachMealPlanRequest = z.infer<
  typeof generateCoachMealPlanRequestSchema
>;
export type CoachMealPlanActionRequest = z.infer<
  typeof coachMealPlanActionRequestSchema
>;
export type ReplaceCoachMealPlanEntryRequest = z.infer<
  typeof replaceCoachMealPlanEntryRequestSchema
>;
export type CoachMealPlanningDashboardResponse = z.infer<
  typeof coachMealPlanningDashboardResponseSchema
>;
