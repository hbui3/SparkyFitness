import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChefHat,
  Clock3,
  RefreshCw,
  SkipForward,
  Trash2,
  TriangleAlert,
  Utensils,
} from 'lucide-react';
import {
  addDays,
  COACH_MEAL_PLANNING_CALORIE_TOLERANCE_RATIO,
} from '@workspace/shared';
import type {
  CoachMealPlanActionRequest,
  CoachMealPlanEntryResponse,
  CoachMealPlanningDailyNutrition,
  CoachRecipeCatalogItem,
} from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  formatPlanningDay,
  formatPlanningQuantity,
  mealSlotLabel,
  mealStatusLabel,
  planningUnitLabel,
} from './mealPlanningUi';

type MealPlanAction = CoachMealPlanActionRequest['action'];

interface MealPlanViewProps {
  entries: CoachMealPlanEntryResponse[];
  dailyNutrition: CoachMealPlanningDailyNutrition[];
  catalog: CoachRecipeCatalogItem[];
  startDate: string;
  days: number;
  onDaysChange: (days: number) => void;
  onGenerate: (replaceExisting: boolean) => void;
  onAction: (entryId: string, action: MealPlanAction) => void;
  onReplace: (entryId: string, recipeKey: string) => void;
  onDelete?: (entryId: string) => void;
  isGenerating: boolean;
  isUpdating: boolean;
}

const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

type NutritionMetric = 'calories' | 'protein';

interface DailyNutritionSummaryProps {
  summary: CoachMealPlanningDailyNutrition;
  dateLabel: string;
}

function nutritionDifferenceLabel(
  metric: NutritionMetric,
  difference: number,
  t: ReturnType<typeof useTranslation>['t'],
  isWithinTargetRange = false
): string {
  const amount = formatPlanningQuantity(Math.abs(difference));

  if (metric === 'calories') {
    if (difference === 0) {
      return t(
        'settings.mealPlanning.plan.calorieTargetMet',
        'Calorie target met'
      );
    }
    if (isWithinTargetRange) {
      return difference < 0
        ? t(
            'settings.mealPlanning.plan.calorieWithinTargetRangeBelow',
            'Within calorie target range ({{amount}} kcal below target)',
            { amount }
          )
        : t(
            'settings.mealPlanning.plan.calorieWithinTargetRangeAbove',
            'Within calorie target range ({{amount}} kcal above target)',
            { amount }
          );
    }
    if (difference < 0) {
      return t(
        'settings.mealPlanning.plan.calorieBelowTarget',
        '{{amount}} kcal below target',
        { amount }
      );
    }
    if (difference > 0) {
      return t(
        'settings.mealPlanning.plan.calorieAboveTarget',
        '{{amount}} kcal above target',
        { amount }
      );
    }
  }

  if (difference < 0) {
    return t(
      'settings.mealPlanning.plan.proteinBelowTarget',
      '{{amount}} g protein below target',
      { amount }
    );
  }
  if (difference > 0) {
    return t(
      'settings.mealPlanning.plan.proteinAboveTarget',
      '{{amount}} g protein above target',
      { amount }
    );
  }
  return t('settings.mealPlanning.plan.proteinTargetMet', 'Protein target met');
}

function DailyNutritionSummary({
  summary,
  dateLabel,
}: DailyNutritionSummaryProps) {
  const { t } = useTranslation();
  const calorieWithinTargetRange =
    summary.calorieDifferenceKcal !== null &&
    (summary.calorieDifferenceKcal === 0 ||
      (summary.targetCaloriesKcal !== null &&
        summary.targetCaloriesKcal > 0 &&
        Math.abs(summary.calorieDifferenceKcal) / summary.targetCaloriesKcal <=
          COACH_MEAL_PLANNING_CALORIE_TOLERANCE_RATIO));
  const differenceClass = (isWithinTargetRange: boolean): string =>
    isWithinTargetRange
      ? 'text-emerald-700 dark:text-emerald-300'
      : 'text-amber-700 dark:text-amber-300';

  return (
    <section
      className="rounded-md border bg-muted/20 p-3"
      aria-label={t(
        'settings.mealPlanning.plan.dailyNutritionFor',
        'Daily nutrition for {{date}}',
        { date: dateLabel }
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('settings.mealPlanning.plan.calories', 'Calories')}
          </p>
          <p className="text-sm font-semibold">
            {summary.targetCaloriesKcal === null
              ? t(
                  'settings.mealPlanning.plan.caloriesWithoutTarget',
                  '{{planned}} kcal planned · target not set',
                  {
                    planned: formatPlanningQuantity(
                      summary.plannedCaloriesKcal
                    ),
                  }
                )
              : t(
                  'settings.mealPlanning.plan.calorieProgress',
                  '{{planned}} / {{target}} kcal planned / target',
                  {
                    planned: formatPlanningQuantity(
                      summary.plannedCaloriesKcal
                    ),
                    target: formatPlanningQuantity(summary.targetCaloriesKcal),
                  }
                )}
          </p>
          {summary.isEstimateComplete &&
            summary.calorieDifferenceKcal !== null && (
              <p
                className={`text-xs font-medium ${differenceClass(calorieWithinTargetRange)}`}
              >
                {nutritionDifferenceLabel(
                  'calories',
                  summary.calorieDifferenceKcal,
                  t,
                  calorieWithinTargetRange
                )}
              </p>
            )}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('settings.mealPlanning.plan.protein', 'Protein')}
          </p>
          <p className="text-sm font-semibold">
            {summary.targetProteinG === null
              ? t(
                  'settings.mealPlanning.plan.proteinWithoutTarget',
                  '{{planned}} g protein planned · target not set',
                  {
                    planned: formatPlanningQuantity(summary.plannedProteinG),
                  }
                )
              : t(
                  'settings.mealPlanning.plan.proteinProgress',
                  '{{planned}} / {{target}} g protein planned / target',
                  {
                    planned: formatPlanningQuantity(summary.plannedProteinG),
                    target: formatPlanningQuantity(summary.targetProteinG),
                  }
                )}
          </p>
          {summary.isEstimateComplete &&
            summary.proteinDifferenceG !== null && (
              <p
                className={`text-xs font-medium ${differenceClass(summary.proteinDifferenceG === 0)}`}
              >
                {nutritionDifferenceLabel(
                  'protein',
                  summary.proteinDifferenceG,
                  t
                )}
              </p>
            )}
        </div>
      </div>
      {!summary.isEstimateComplete && (
        <p className="mt-3 flex items-start gap-2 border-t pt-3 text-xs font-medium text-amber-700 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {t(
              'settings.mealPlanning.plan.incompleteNutritionEstimate',
              'Incomplete total: eating-out nutrition is not included.'
            )}
          </span>
        </p>
      )}
    </section>
  );
}

function entryStatusClass(
  status: CoachMealPlanEntryResponse['status']
): string {
  switch (status) {
    case 'prepared':
      return 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200';
    case 'eaten_out':
      return 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200';
    case 'skipped':
    case 'replaced':
      return 'text-muted-foreground';
    case 'planned':
      return '';
  }
}

export default function MealPlanView({
  entries,
  dailyNutrition,
  catalog,
  startDate,
  days,
  onDaysChange,
  onGenerate,
  onAction,
  onReplace,
  onDelete,
  isGenerating,
  isUpdating,
}: MealPlanViewProps) {
  const { t, i18n } = useTranslation();
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [replacementEntry, setReplacementEntry] =
    useState<CoachMealPlanEntryResponse | null>(null);
  const [replacementRecipeKey, setReplacementRecipeKey] = useState('');
  const [deletingEntry, setDeletingEntry] =
    useState<CoachMealPlanEntryResponse | null>(null);
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const dates = useMemo(
    () => Array.from({ length: days }, (_, index) => addDays(startDate, index)),
    [days, startDate]
  );
  const dailyNutritionByDate = useMemo(
    () => new Map(dailyNutrition.map((summary) => [summary.date, summary])),
    [dailyNutrition]
  );
  const replacementOptions = useMemo(() => {
    if (!replacementEntry) return [];
    return catalog.filter(
      (item) =>
        item.slots.includes(replacementEntry.slot) &&
        item.recipe.recipeKey !== replacementEntry.recipe.recipeKey
    );
  }, [catalog, replacementEntry]);
  const selectedReplacement = replacementOptions.find(
    (item) => item.recipe.recipeKey === replacementRecipeKey
  );
  const hasExistingPlan = entries.length > 0;

  const openReplacement = (entry: CoachMealPlanEntryResponse) => {
    const firstOption = catalog.find(
      (item) =>
        item.slots.includes(entry.slot) &&
        item.recipe.recipeKey !== entry.recipe.recipeKey
    );
    setReplacementEntry(entry);
    setReplacementRecipeKey(firstOption?.recipe.recipeKey ?? '');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold">
            {t('settings.mealPlanning.plan.title', 'Your meal plan')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t(
              'settings.mealPlanning.plan.description',
              'Exact portions and short preparation steps for the days ahead.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-md border bg-background p-1"
            role="group"
            aria-label={t(
              'settings.mealPlanning.plan.periodLabel',
              'Planning period'
            )}
          >
            {[5, 7].map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={days === option ? 'secondary' : 'ghost'}
                aria-pressed={days === option}
                onClick={() => onDaysChange(option)}
              >
                {t('settings.mealPlanning.plan.days', '{{count}} days', {
                  count: option,
                })}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            onClick={() => setGenerateDialogOpen(true)}
            disabled={isGenerating}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`}
            />
            {hasExistingPlan
              ? t('settings.mealPlanning.plan.rebuild', 'Rebuild plan')
              : t('settings.mealPlanning.plan.create', 'Create plan')}
          </Button>
        </div>
      </div>

      {!hasExistingPlan && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <ChefHat className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">
            {t('settings.mealPlanning.plan.emptyTitle', 'No meals planned yet')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              'settings.mealPlanning.plan.emptyDescription',
              'Create a plan based on your goals, food preferences, and pantry.'
            )}
          </p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {dates.map((date) => {
          const dayNutrition = dailyNutritionByDate.get(date);
          const dayEntries = entries
            .filter(
              (entry) => entry.date === date && entry.status !== 'replaced'
            )
            .sort(
              (left, right) =>
                SLOT_ORDER.indexOf(left.slot) - SLOT_ORDER.indexOf(right.slot)
            );
          return (
            <Card key={date}>
              <CardHeader className="space-y-3 pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="capitalize">
                    {formatPlanningDay(date, locale)}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {date}
                  </span>
                </CardTitle>
                {dayNutrition && (
                  <DailyNutritionSummary
                    summary={dayNutrition}
                    dateLabel={formatPlanningDay(date, locale)}
                  />
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {dayEntries.length === 0 ? (
                  <p className="rounded-md bg-muted/30 p-3 text-sm text-muted-foreground">
                    {t(
                      'settings.mealPlanning.plan.noMealsForDay',
                      'No meals planned for this day.'
                    )}
                  </p>
                ) : (
                  dayEntries.map((entry) => {
                    const isPlanned = entry.status === 'planned';
                    return (
                      <article
                        key={entry.id}
                        className={`space-y-3 rounded-lg border p-3 ${entryStatusClass(entry.status)}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {mealSlotLabel(t, entry.slot)}
                            </p>
                            <h4 className="font-semibold">
                              {entry.recipe.name}
                            </h4>
                            {entry.recipe.description && (
                              <p className="mt-1 text-sm text-muted-foreground">
                                {entry.recipe.description}
                              </p>
                            )}
                          </div>
                          <Badge variant="outline">
                            {mealStatusLabel(t, entry.status)}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant="secondary">
                            {formatPlanningQuantity(entry.servings)}{' '}
                            {t(
                              'settings.mealPlanning.plan.servings',
                              'servings'
                            )}
                          </Badge>
                          <Badge variant="secondary">
                            {Math.round(entry.caloriesKcal)} kcal
                          </Badge>
                          <Badge variant="secondary">
                            {t('settings.mealPlanning.plan.proteinShort', 'P')}:{' '}
                            {formatPlanningQuantity(entry.proteinG)} g
                          </Badge>
                          <Badge variant="secondary">
                            {t('settings.mealPlanning.plan.carbsShort', 'C')}:{' '}
                            {formatPlanningQuantity(entry.carbsG)} g
                          </Badge>
                          <Badge variant="secondary">
                            {t('settings.mealPlanning.plan.fatShort', 'F')}:{' '}
                            {formatPlanningQuantity(entry.fatG)} g
                          </Badge>
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Clock3 className="h-3.5 w-3.5" />
                            {t(
                              'settings.mealPlanning.plan.prepMinutes',
                              '{{count}} min',
                              { count: entry.recipe.prepMinutes }
                            )}
                          </span>
                        </div>

                        {entry.safetyStatus === 'needs_user_input' && (
                          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                            {t(
                              'settings.mealPlanning.plan.safetyNeedsInput',
                              'Check this meal before preparing it because a dietary detail is still unclear.'
                            )}
                          </div>
                        )}

                        <details className="text-sm">
                          <summary className="cursor-pointer font-medium">
                            {t(
                              'settings.mealPlanning.plan.ingredientsAndPreparation',
                              'Ingredients & preparation'
                            )}
                          </summary>
                          <div className="mt-2 grid gap-3 sm:grid-cols-2">
                            <ul className="space-y-1 text-muted-foreground">
                              {entry.ingredients.map((ingredient) => (
                                <li key={ingredient.id}>
                                  {formatPlanningQuantity(ingredient.quantity)}{' '}
                                  {planningUnitLabel(t, ingredient.unit)}{' '}
                                  {ingredient.name}
                                </li>
                              ))}
                            </ul>
                            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                              {entry.recipe.instructions.map((instruction) => (
                                <li key={instruction}>{instruction}</li>
                              ))}
                            </ol>
                          </div>
                        </details>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            aria-label={t(
                              'settings.mealPlanning.plan.preparedFor',
                              'Mark {{meal}} on {{date}} as prepared',
                              {
                                meal: entry.recipe.name,
                                date: formatPlanningDay(entry.date, locale),
                              }
                            )}
                            onClick={() => onAction(entry.id, 'prepared')}
                            disabled={!isPlanned || isUpdating}
                          >
                            <Check className="mr-1.5 h-4 w-4" />
                            {t(
                              'settings.mealPlanning.plan.prepared',
                              'Prepared'
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={t(
                              'settings.mealPlanning.plan.eatingOutFor',
                              'Mark {{meal}} on {{date}} as eating out',
                              {
                                meal: entry.recipe.name,
                                date: formatPlanningDay(entry.date, locale),
                              }
                            )}
                            onClick={() => onAction(entry.id, 'eaten_out')}
                            disabled={!isPlanned || isUpdating}
                          >
                            <Utensils className="mr-1.5 h-4 w-4" />
                            {t(
                              'settings.mealPlanning.plan.eatingOut',
                              'Eating out'
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={t(
                              'settings.mealPlanning.plan.skipFor',
                              'Skip {{meal}} on {{date}}',
                              {
                                meal: entry.recipe.name,
                                date: formatPlanningDay(entry.date, locale),
                              }
                            )}
                            onClick={() => onAction(entry.id, 'skipped')}
                            disabled={!isPlanned || isUpdating}
                          >
                            <SkipForward className="mr-1.5 h-4 w-4" />
                            {t('settings.mealPlanning.plan.skip', 'Skip')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={t(
                              'settings.mealPlanning.plan.replaceFor',
                              'Replace {{meal}} on {{date}}',
                              {
                                meal: entry.recipe.name,
                                date: formatPlanningDay(entry.date, locale),
                              }
                            )}
                            onClick={() => openReplacement(entry)}
                            disabled={!isPlanned || isUpdating}
                          >
                            <RefreshCw className="mr-1.5 h-4 w-4" />
                            {t('settings.mealPlanning.plan.replace', 'Replace')}
                          </Button>
                          {onDelete && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              aria-label={t(
                                'settings.mealPlanning.plan.deleteFor',
                                'Delete {{meal}} on {{date}}',
                                {
                                  meal: entry.recipe.name,
                                  date: formatPlanningDay(entry.date, locale),
                                }
                              )}
                              onClick={() => setDeletingEntry(entry)}
                              disabled={!isPlanned || isUpdating}
                            >
                              <Trash2 className="mr-1.5 h-4 w-4" />
                              {t('common.delete', 'Delete')}
                            </Button>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog
        open={Boolean(deletingEntry)}
        onOpenChange={(open) => {
          if (!open) setDeletingEntry(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                'settings.mealPlanning.plan.deleteConfirmTitle',
                'Delete this planned meal?'
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'settings.mealPlanning.plan.deleteConfirmDescription',
                'The meal will be removed from your plan and unneeded ingredients will be removed from your shopping list.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('common.cancel', 'Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deletingEntry && onDelete) {
                  onDelete(deletingEntry.id);
                  setDeletingEntry(null);
                }
              }}
            >
              {t('common.delete', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasExistingPlan
                ? t(
                    'settings.mealPlanning.plan.rebuildConfirmTitle',
                    'Replace the current plan?'
                  )
                : t(
                    'settings.mealPlanning.plan.createConfirmTitle',
                    'Create this meal plan?'
                  )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasExistingPlan
                ? t(
                    'settings.mealPlanning.plan.rebuildConfirmDescription',
                    'Planned meals in this period will be replaced and the shopping list will be recalculated.'
                  )
                : t(
                    'settings.mealPlanning.plan.createConfirmDescription',
                    'The coach will use your goals, preferences, and pantry and will build the matching shopping list.'
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('common.cancel', 'Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onGenerate(hasExistingPlan);
                setGenerateDialogOpen(false);
              }}
            >
              {hasExistingPlan
                ? t('settings.mealPlanning.plan.rebuild', 'Rebuild plan')
                : t('settings.mealPlanning.plan.create', 'Create plan')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={replacementEntry !== null}
        onOpenChange={(open) => !open && setReplacementEntry(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('settings.mealPlanning.plan.replaceTitle', 'Replace meal')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'settings.mealPlanning.plan.replaceDescription',
                'Choose another safe option for the same meal slot. Quantities and shopping are updated automatically.'
              )}
            </DialogDescription>
          </DialogHeader>
          {replacementOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'settings.mealPlanning.plan.noReplacement',
                'No suitable alternative is currently available.'
              )}
            </p>
          ) : (
            <div className="space-y-3">
              <Select
                value={replacementRecipeKey}
                onValueChange={setReplacementRecipeKey}
              >
                <SelectTrigger
                  aria-label={t(
                    'settings.mealPlanning.plan.replacementLabel',
                    'Replacement meal'
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {replacementOptions.map((item) => (
                    <SelectItem
                      key={item.recipe.recipeKey}
                      value={item.recipe.recipeKey}
                    >
                      {item.recipe.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedReplacement && (
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  <p>{selectedReplacement.recipe.description}</p>
                  <p className="mt-2 text-muted-foreground">
                    {Math.round(selectedReplacement.caloriesKcal)} kcal ·{' '}
                    {formatPlanningQuantity(selectedReplacement.proteinG)} g{' '}
                    {t('settings.mealPlanning.plan.protein', 'protein')}
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplacementEntry(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={
                !replacementEntry || !replacementRecipeKey || isUpdating
              }
              onClick={() => {
                if (!replacementEntry || !replacementRecipeKey) return;
                onReplace(replacementEntry.id, replacementRecipeKey);
                setReplacementEntry(null);
              }}
            >
              {t('settings.mealPlanning.plan.replace', 'Replace')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
