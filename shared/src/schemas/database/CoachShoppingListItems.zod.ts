import { z } from "zod";
import {
  coachMealPlanningCategorySchema,
  coachMealPlanningQuantitySchema,
  coachMealPlanningRetailerSchema,
  coachMealPlanningUnitSchema,
} from "./CoachPantryItems.zod.ts";

export function isOfficialCoachRetailerUrl(
  retailer: z.infer<typeof coachMealPlanningRetailerSchema>,
  directUrl: string,
): boolean {
  try {
    const url = new URL(directUrl);
    const officialDomain = retailer === "coop" ? "coop.ch" : "migros.ch";
    return (
      url.protocol === "https:" &&
      (url.hostname === officialDomain ||
        url.hostname.endsWith(`.${officialDomain}`))
    );
  } catch {
    return false;
  }
}

export const coachShoppingListItemStatusSchema = z.enum([
  "needed",
  "purchased",
  "skipped",
]);

export const coachShoppingListItemsSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    shopping_list_id: z.string().uuid(),
    ingredient_key: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    required_quantity: coachMealPlanningQuantitySchema.positive(),
    purchased_quantity: coachMealPlanningQuantitySchema,
    unit: coachMealPlanningUnitSchema,
    category: coachMealPlanningCategorySchema,
    status: coachShoppingListItemStatusSchema,
    is_manual: z.boolean(),
    quantity_locked: z.boolean(),
    notes: z.string().trim().min(1).max(1_000).nullable(),
    source_entry_ids: z.array(z.string().uuid()),
    selected_product_retailer: coachMealPlanningRetailerSchema.nullable(),
    selected_product_retailer_id: z.string().trim().min(1).max(200).nullable(),
    selected_product_gtin: z
      .string()
      .regex(/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/)
      .nullable(),
    selected_product_name: z.string().trim().min(1).max(300).nullable(),
    selected_product_package_quantity: coachMealPlanningQuantitySchema
      .positive()
      .nullable(),
    selected_product_package_unit: coachMealPlanningUnitSchema.nullable(),
    selected_product_direct_url: z.string().url().nullable(),
    selected_product_verified_at: z.coerce.date().nullable(),
    selected_product_note: z.string().trim().min(1).max(500).nullable(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const requiredSnapshotValues = [
      value.selected_product_retailer,
      value.selected_product_retailer_id,
      value.selected_product_name,
      value.selected_product_package_quantity,
      value.selected_product_package_unit,
      value.selected_product_direct_url,
      value.selected_product_verified_at,
    ];
    const hasSnapshot = requiredSnapshotValues.some((item) => item !== null);
    const hasCompleteSnapshot = requiredSnapshotValues.every(
      (item) => item !== null,
    );

    if (hasSnapshot && !hasCompleteSnapshot) {
      ctx.addIssue({
        code: "custom",
        message: "Selected product snapshot is incomplete",
        path: ["selected_product_retailer"],
      });
    }
    if (
      !hasSnapshot &&
      (value.selected_product_gtin !== null ||
        value.selected_product_note !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "GTIN and note require a selected product snapshot",
        path: ["selected_product_gtin"],
      });
    }
    if (
      value.selected_product_retailer !== null &&
      value.selected_product_direct_url !== null &&
      !isOfficialCoachRetailerUrl(
        value.selected_product_retailer,
        value.selected_product_direct_url,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Expected an official ${value.selected_product_retailer} HTTPS product URL`,
        path: ["selected_product_direct_url"],
      });
    }
  });

export type CoachShoppingListItemStatus = z.infer<
  typeof coachShoppingListItemStatusSchema
>;
export type CoachShoppingListItem = z.infer<
  typeof coachShoppingListItemsSchema
>;
