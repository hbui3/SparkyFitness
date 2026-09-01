import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ChefHat,
  Clock3,
  RefreshCw,
  SkipForward,
  TriangleAlert,
  Utensils,
} from 'lucide-react';
import { addDays } from '@workspace/shared';
import type {
  CoachMealPlanActionRequest,
  CoachMealPlanEntryResponse,
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
  catalog: CoachRecipeCatalogItem[];
  startDate: string;
  days: number;
  onDaysChange: (days: number) => void;
  onGenerate: (replaceExisting: boolean) => void;
  onAction: (entryId: string, action: MealPlanAction) => void;
  onReplace: (entryId: string, recipeKey: string) => void;
  isGenerating: boolean;
  isUpdating: boolean;
}

const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

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
  catalog,
  startDate,
  days,
  onDaysChange,
  onGenerate,
  onAction,
  onReplace,
  isGenerating,
  isUpdating,
}: MealPlanViewProps) {
  const { t, i18n } = useTranslation();
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [replacementEntry, setReplacementEntry] =
    useState<CoachMealPlanEntryResponse | null>(null);
  const [replacementRecipeKey, setReplacementRecipeKey] = useState('');
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const dates = useMemo(
    () => Array.from({ length: days }, (_, index) => addDays(startDate, index)),
    [days, startDate]
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
          const dayEntries = entries
            .filter((entry) => entry.date === date)
            .sort(
              (left, right) =>
                SLOT_ORDER.indexOf(left.slot) - SLOT_ORDER.indexOf(right.slot)
            );
          return (
            <Card key={date}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="capitalize">
                    {formatPlanningDay(date, locale)}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {date}
                  </span>
                </CardTitle>
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
