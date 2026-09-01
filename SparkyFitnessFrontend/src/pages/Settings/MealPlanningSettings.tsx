import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CalendarDays, RefreshCw } from 'lucide-react';
import { todayInZone } from '@workspace/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MealPlanView from '@/components/MealPlanning/MealPlanView';
import PantryView from '@/components/MealPlanning/PantryView';
import ShoppingListView from '@/components/MealPlanning/ShoppingListView';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  useApplyCoachMealPlanAction,
  useCoachMealPlanningDashboard,
  useGenerateCoachMealPlan,
  useReplaceCoachMealPlanEntry,
} from '@/hooks/Settings/useMealPlanning';
import { generateClientId } from '@/utils/generateClientId';

const MealPlanningSettings = () => {
  const { t } = useTranslation();
  const { timezone } = usePreferences();
  const [days, setDays] = useState(5);
  const startDate = todayInZone(timezone);
  const dashboard = useCoachMealPlanningDashboard(startDate, days);
  const generatePlan = useGenerateCoachMealPlan();
  const applyAction = useApplyCoachMealPlanAction();
  const replaceEntry = useReplaceCoachMealPlanEntry();

  if (dashboard.isLoading) {
    return (
      <div
        className="space-y-4"
        aria-label={t('settings.mealPlanning.loading', 'Loading meal planning')}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>
          {t(
            'settings.mealPlanning.errorTitle',
            'Meal planning is unavailable'
          )}
        </AlertTitle>
        <AlertDescription className="mt-2 space-y-3">
          <p>
            {t(
              'settings.mealPlanning.errorDescription',
              'Your plan, shopping list, and pantry could not be loaded.'
            )}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void dashboard.refetch()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('settings.mealPlanning.retry', 'Try again')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const data = dashboard.data;
  const shoppingSelectionKey = [
    data.shoppingList?.id ?? 'no-list',
    ...(data.shoppingList?.items ?? [])
      .filter((item) => item.status === 'needed' && item.remainingQuantity > 0)
      .map((item) => {
        const effectiveProduct =
          item.selectedProduct ?? item.productOptions[0] ?? null;
        const selectedProductKey = effectiveProduct
          ? `${effectiveProduct.retailer}:${effectiveProduct.retailerProductId}:${effectiveProduct.packageQuantity}:${effectiveProduct.packageUnit}`
          : 'none';
        return `${item.id}:${item.remainingQuantity}:${selectedProductKey}`;
      })
      .sort(),
  ].join(':');

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          {t(
            'settings.mealPlanning.workspaceTitle',
            'Plan meals and groceries together'
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {t(
            'settings.mealPlanning.workspaceDescription',
            'Keep your upcoming meals, shopping list, and pantry in one place.'
          )}
        </p>
      </div>

      {data.warnings.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {t('settings.mealPlanning.warningsTitle', 'Please check')}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="plan" className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="plan">
            {t('settings.mealPlanning.tabs.plan', 'Plan')}
          </TabsTrigger>
          <TabsTrigger value="shopping">
            {t('settings.mealPlanning.tabs.shopping', 'Shopping')}
          </TabsTrigger>
          <TabsTrigger value="pantry">
            {t('settings.mealPlanning.tabs.pantry', 'Pantry')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="mt-5">
          <MealPlanView
            entries={data.planEntries}
            catalog={data.mealCatalog}
            startDate={startDate}
            days={days}
            onDaysChange={setDays}
            onGenerate={(replaceExisting) =>
              generatePlan.mutate({
                operationId: generateClientId(),
                startDate,
                days,
                replaceExisting,
              })
            }
            onAction={(entryId, action) =>
              applyAction.mutate({
                entryId,
                request: { operationId: generateClientId(), action },
              })
            }
            onReplace={(entryId, recipeKey) =>
              replaceEntry.mutate({
                entryId,
                request: { operationId: generateClientId(), recipeKey },
              })
            }
            isGenerating={generatePlan.isPending}
            isUpdating={applyAction.isPending || replaceEntry.isPending}
          />
        </TabsContent>

        <TabsContent value="shopping" className="mt-5">
          <ShoppingListView
            key={shoppingSelectionKey}
            shoppingList={data.shoppingList}
          />
        </TabsContent>

        <TabsContent value="pantry" className="mt-5">
          <PantryView pantry={data.pantry} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MealPlanningSettings;
