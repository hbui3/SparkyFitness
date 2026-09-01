import { tool } from 'ai';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { addDays, todayInZone } from '@workspace/shared';
import { log } from '../../config/logging.js';
import coachContextService from '../../services/coachContextService.js';
import coachMealPlanningService from '../../services/coachMealPlanningService.js';
import {
  buildCoachShoppingList,
  COACH_MEAL_INGREDIENT_QUESTIONS,
  getCoachMealSuggestion,
  MIN_COACH_MEAL_CALORIES,
  toCoachMealSuggestionPayload,
  toCoachShoppingListPayload,
} from '../../services/coachMealSuggestionService.js';
import { ERRORS, formatZodError } from './errors.js';
import { formatSuccess } from './formatting.js';

const SuggestNextMealSchema = z.object({
  servings_to_prepare: z.number().int().min(1).max(6).optional(),
  planning_day: z.enum(['today', 'tomorrow']).optional(),
});

const PlanningWindowSchema = z.object({
  planning_day: z.enum(['today', 'tomorrow']).optional(),
  days: z.number().int().min(1).max(7).optional(),
});

const GenerateMealPlanSchema = PlanningWindowSchema.extend({
  operation_id: z.string().uuid().optional(),
  replace_existing: z.boolean().optional(),
});

const ConfirmPurchaseSchema = z
  .object({
    operation_id: z.string().uuid().optional(),
    purchases: z
      .array(
        z.object({
          item_id: z.string().uuid(),
          quantity: z.number().positive(),
        })
      )
      .min(1)
      .max(100),
  })
  .superRefine((value, ctx) => {
    const seenItemIds = new Set<string>();
    value.purchases.forEach((purchase, index) => {
      if (seenItemIds.has(purchase.item_id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Each shopping item may only appear once per purchase',
          path: ['purchases', index, 'item_id'],
        });
      }
      seenItemIds.add(purchase.item_id);
    });
  });

const UpdatePlannedMealSchema = z.object({
  entry_id: z.string().uuid(),
  operation_id: z.string().uuid().optional(),
  action: z.enum(['prepared', 'eaten_out', 'skipped']),
  notes: z.string().trim().min(1).max(2_000).optional(),
});

const ReplacePlannedMealSchema = z.object({
  entry_id: z.string().uuid(),
  operation_id: z.string().uuid().optional(),
  recipe_key: z.string().trim().min(1).max(200),
});

const ManagePantrySchema = z
  .object({
    action: z.enum(['add', 'update', 'remove']),
    item_id: z.string().uuid().optional(),
    ingredient_key: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    quantity: z.number().min(0).optional(),
    minimum_quantity: z.number().min(0).optional(),
    unit: z.enum(['g', 'ml', 'piece', 'tsp', 'tbsp']).optional(),
    category: z
      .enum(['chilled', 'produce', 'pantry', 'frozen', 'other'])
      .optional(),
    preferred_retailer: z.enum(['coop', 'migros']).optional(),
    preferred_retailer_product_id: z.string().trim().min(1).max(200).optional(),
    expires_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'add') {
      for (const field of ['name', 'quantity', 'unit', 'category'] as const) {
        if (value[field] === undefined) {
          ctx.addIssue({
            code: 'custom',
            message: `${field} is required when adding pantry stock`,
            path: [field],
          });
        }
      }
    } else if (!value.item_id) {
      ctx.addIssue({
        code: 'custom',
        message: 'item_id is required when updating or removing pantry stock',
        path: ['item_id'],
      });
    }
    if (
      (value.preferred_retailer === undefined) !==
      (value.preferred_retailer_product_id === undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'preferred_retailer and preferred_retailer_product_id must be supplied together',
        path: ['preferred_retailer_product_id'],
      });
    }
  });

function planningStart(
  tz: string,
  planningDay: 'today' | 'tomorrow' | undefined
): string {
  const today = todayInZone(tz);
  return planningDay === 'tomorrow' ? addDays(today, 1) : today;
}

function operationIdFromToolCall(scope: string, toolCallId: string): string {
  const bytes = createHash('sha256')
    .update(`${scope}\u0000${toolCallId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function refreshedDashboard(userId: string, tz: string, days = 7) {
  return coachMealPlanningService.getDashboard(userId, todayInZone(tz), days);
}

export function buildMealPlanningTools(userId: string, tz: string) {
  return {
    sparky_suggest_next_meal: tool({
      description:
        'Use for a one-off, unplanned meal idea when the user explicitly wants something outside the persistent plan or no dated plan exists. For pantry-aware questions, first read sparky_get_meal_planning_dashboard and present an existing planned meal or use sparky_generate_meal_plan. This tool returns one deterministic, safety-checked meal with exact per-serving quantities, brief preparation, and a categorized shopping list. Set planning_day=tomorrow when the user accepts the returned offer to plan tomorrow. Present this result instead of inventing a recipe. If status is not ready, ask only the returned question.',
      inputSchema: SuggestNextMealSchema,
      execute: async (rawArgs) => {
        const parsed = SuggestNextMealSchema.safeParse(rawArgs ?? {});
        if (!parsed.success) return formatZodError(parsed.error);
        try {
          const snapshot = await coachContextService.getCoachContextSnapshot(
            userId,
            tz
          );
          const planningDay = parsed.data.planning_day ?? 'today';
          const targetDate =
            planningDay === 'tomorrow'
              ? addDays(snapshot.today.date, 1)
              : snapshot.today.date;
          const targets =
            planningDay === 'tomorrow'
              ? {
                  caloriesRemaining: snapshot.today.calorieTarget,
                  proteinRemainingG: snapshot.today.proteinTargetG,
                }
              : snapshot.today;
          if (
            planningDay === 'today' &&
            targets.caloriesRemaining !== null &&
            targets.caloriesRemaining < MIN_COACH_MEAL_CALORIES
          ) {
            return formatSuccess(
              {
                status: 'calorie_budget_reached',
                date: targetDate,
                calories_remaining: targets.caloriesRemaining,
                protein_remaining_g: targets.proteinRemainingG,
                question_de:
                  'Dein verbleibendes Kalorienbudget reicht gerade nicht für eine vollständige Mahlzeit. Soll ich stattdessen die erste Mahlzeit für morgen planen?',
                question_en:
                  'Your remaining calorie budget is too small for a full meal right now. Should I plan tomorrow’s first meal instead?',
                follow_up_tool: 'sparky_suggest_next_meal',
                follow_up_args: { planning_day: 'tomorrow' },
              },
              'Next Meal Suggestion'
            );
          }

          const suggestion = await getCoachMealSuggestion(
            userId,
            targets,
            planningDay === 'tomorrow'
              ? `next-meal:${targetDate}:tomorrow`
              : `next-meal:${targetDate}:${snapshot.today.caloriesConsumed}:${snapshot.today.proteinConsumedG}`
          );
          if (!suggestion) {
            return formatSuccess(
              {
                status: 'needs_user_input',
                date: targetDate,
                question_de: COACH_MEAL_INGREDIENT_QUESTIONS.de,
                question_en: COACH_MEAL_INGREDIENT_QUESTIONS.en,
                follow_up_tool: 'sparky_validate_meal_suggestion',
              },
              'Next Meal Suggestion'
            );
          }

          const preparedMeal = {
            ...suggestion,
            shoppingServings: parsed.data.servings_to_prepare ?? 2,
          };
          return formatSuccess(
            {
              status: 'ready',
              date: targetDate,
              calories_remaining_before_meal: targets.caloriesRemaining,
              protein_remaining_g_before_meal: targets.proteinRemainingG,
              meal: toCoachMealSuggestionPayload(preparedMeal),
              consolidated_shopping_list: toCoachShoppingListPayload(
                buildCoachShoppingList([preparedMeal])
              ),
            },
            'Next Meal Suggestion'
          );
        } catch (error) {
          log('error', '[Meal Planning Tool] suggestion error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
    sparky_get_meal_planning_dashboard: tool({
      description:
        'Read the authenticated owner’s persistent pantry, remaining shopping list, verified Coop/Migros product options, and dated meal plan. Use this before answering questions about what is in stock, what to buy, or what is planned. Quantities marked reserved are planned only; they are not deducted until a meal is confirmed prepared.',
      inputSchema: PlanningWindowSchema,
      execute: async (rawArgs) => {
        const parsed = PlanningWindowSchema.safeParse(rawArgs ?? {});
        if (!parsed.success) return formatZodError(parsed.error);
        try {
          return formatSuccess(
            await coachMealPlanningService.getDashboard(
              userId,
              planningStart(tz, parsed.data.planning_day),
              parsed.data.days ?? 7
            ),
            'Meal Planning Dashboard'
          );
        } catch (error) {
          log('error', '[Meal Planning Tool] dashboard error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
    sparky_generate_meal_plan: tool({
      description:
        'Create a persistent one-to-seven-day meal plan with exact portions and nutrition. This automatically calculates reservations and the missing shopping quantities. Use replace_existing=true only after the user asks to regenerate occupied meal slots.',
      inputSchema: GenerateMealPlanSchema,
      execute: async (rawArgs, options) => {
        const parsed = GenerateMealPlanSchema.safeParse(rawArgs ?? {});
        if (!parsed.success) return formatZodError(parsed.error);
        try {
          const startDate = planningStart(tz, parsed.data.planning_day);
          const days = parsed.data.days ?? 3;
          const generation = await coachMealPlanningService.generateMealPlan(
            userId,
            {
              operationId:
                parsed.data.operation_id ??
                operationIdFromToolCall(
                  'generate-meal-plan',
                  options.toolCallId
                ),
              startDate,
              days,
              replaceExisting: parsed.data.replace_existing ?? false,
            }
          );
          return formatSuccess(
            {
              generation,
              dashboard: await coachMealPlanningService.getDashboard(
                userId,
                startDate,
                days
              ),
            },
            'Generated Meal Plan'
          );
        } catch (error) {
          log('error', '[Meal Planning Tool] generation error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
    sparky_confirm_grocery_purchase: tool({
      description:
        'Confirm exact quantities the user says they bought. Supports partial purchases. Each confirmed quantity atomically increases pantry stock and reduces the remaining shopping need; never call this merely because an item was suggested.',
      inputSchema: ConfirmPurchaseSchema,
      execute: async (rawArgs, options) => {
        const parsed = ConfirmPurchaseSchema.safeParse(rawArgs ?? {});
        if (!parsed.success) return formatZodError(parsed.error);
        try {
          await coachMealPlanningService.confirmShoppingPurchase(userId, {
            operationId:
              parsed.data.operation_id ??
              operationIdFromToolCall(
                'confirm-grocery-purchase',
                options.toolCallId
              ),
            purchases: parsed.data.purchases.map((purchase) => ({
              itemId: purchase.item_id,
              quantity: purchase.quantity,
            })),
          });
          return formatSuccess(
            await refreshedDashboard(userId, tz),
            'Confirmed Grocery Purchase'
          );
        } catch (error) {
          log('error', '[Meal Planning Tool] purchase error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
    sparky_update_planned_meal: tool({
      description:
        'Mark a persistent planned meal as prepared, eaten outside, or skipped only after the user confirms that outcome. Prepared consumes its ingredient quantities from pantry; eaten_out and skipped only release their reservations.',
      inputSchema: UpdatePlannedMealSchema,
      execute: async (rawArgs, options) => {
        const parsed = UpdatePlannedMealSchema.safeParse(rawArgs ?? {});
        if (!parsed.success) return formatZodError(parsed.error);
        try {
          await coachMealPlanningService.applyMealPlanAction(
            userId,
            parsed.data.entry_id,
            {
              operationId:
                parsed.data.operation_id ??
                operationIdFromToolCall(
                  'update-planned-meal',
                  options.toolCallId
                ),
              action: parsed.data.action,
              notes: parsed.data.notes,
            }
          );
          return formatSuccess(
            await refreshedDashboard(userId, tz),
            'Updated Planned Meal'
          );
        } catch (error) {
          log('error', '[Meal Planning Tool] meal action error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
    sparky_replace_planned_meal: tool({
      description:
        'Replace one planned meal with a safety-checked recipe from mealCatalog. The original reservation is released and the replacement reservation and shopping needs are calculated atomically. Use for user-requested swaps, not for merely eating outside.',
      inputSchema: ReplacePlannedMealSchema,
      execute: async (rawArgs, options) => {
        const parsed = ReplacePlannedMealSchema.safeParse(rawArgs ?? {});
        if (!parsed.success) return formatZodError(parsed.error);
        try {
          const entryId = await coachMealPlanningService.replaceMealPlanEntry(
            userId,
            parsed.data.entry_id,
            {
              operationId:
                parsed.data.operation_id ??
                operationIdFromToolCall(
                  'replace-planned-meal',
                  options.toolCallId
                ),
              recipeKey: parsed.data.recipe_key,
            }
          );
          return formatSuccess(
            {
              replacementEntryId: entryId,
              dashboard: await refreshedDashboard(userId, tz),
            },
            'Replaced Planned Meal'
          );
        } catch (error) {
          log('error', '[Meal Planning Tool] replacement error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
    sparky_manage_meal_pantry: tool({
      description:
        'Add, correct, or remove an item in the authenticated owner’s persistent meal pantry. Quantities are absolute current stock, never deltas. Remove is allowed only when the item is empty and unreserved. Use verified retailer product ids returned by the dashboard when setting a preference.',
      inputSchema: ManagePantrySchema,
      execute: async (rawArgs) => {
        const parsed = ManagePantrySchema.safeParse(rawArgs ?? {});
        if (!parsed.success) return formatZodError(parsed.error);
        try {
          const input = parsed.data;
          if (input.action === 'add') {
            if (
              input.name === undefined ||
              input.quantity === undefined ||
              input.unit === undefined ||
              input.category === undefined
            ) {
              return formatSuccess(
                { status: 'invalid', message: 'Missing pantry fields.' },
                'Manage Meal Pantry'
              );
            }
            await coachMealPlanningService.createPantryItem(userId, {
              ingredientKey: input.ingredient_key,
              name: input.name,
              quantity: input.quantity,
              minimumQuantity: input.minimum_quantity ?? 0,
              unit: input.unit,
              category: input.category,
              preferredProduct:
                input.preferred_retailer && input.preferred_retailer_product_id
                  ? {
                      retailer: input.preferred_retailer,
                      retailerProductId: input.preferred_retailer_product_id,
                    }
                  : null,
              expiresOn: input.expires_on ?? null,
            });
          } else if (input.action === 'remove') {
            if (!input.item_id) {
              return formatSuccess(
                { status: 'invalid', message: 'Missing pantry item id.' },
                'Manage Meal Pantry'
              );
            }
            await coachMealPlanningService.removePantryItem(
              userId,
              input.item_id
            );
          } else {
            if (!input.item_id) {
              return formatSuccess(
                { status: 'invalid', message: 'Missing pantry item id.' },
                'Manage Meal Pantry'
              );
            }
            await coachMealPlanningService.updatePantryItem(
              userId,
              input.item_id,
              {
                name: input.name,
                quantity: input.quantity,
                minimumQuantity: input.minimum_quantity,
                category: input.category,
                preferredProduct:
                  input.preferred_retailer &&
                  input.preferred_retailer_product_id
                    ? {
                        retailer: input.preferred_retailer,
                        retailerProductId: input.preferred_retailer_product_id,
                      }
                    : undefined,
                expiresOn: input.expires_on,
              }
            );
          }
          return formatSuccess(
            await refreshedDashboard(userId, tz),
            'Managed Meal Pantry'
          );
        } catch (error) {
          log('error', '[Meal Planning Tool] pantry error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
  };
}
