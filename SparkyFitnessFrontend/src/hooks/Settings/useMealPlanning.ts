import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  CoachMealPlanActionRequest,
  ConfirmCoachShoppingPurchaseRequest,
  CreateCoachPantryItemRequest,
  CreateCoachShoppingItemRequest,
  GenerateCoachMealPlanRequest,
  PatchCoachPantryItemRequest,
  PatchCoachShoppingItemRequest,
  ReplaceCoachMealPlanEntryRequest,
} from '@workspace/shared';
import { coachMealPlanningKeys } from '@/api/keys/settings';
import {
  applyCoachMealPlanAction,
  archiveCoachPantryItem,
  confirmCoachShoppingPurchase,
  createCoachPantryItem,
  createCoachShoppingItem,
  generateCoachMealPlan,
  getCoachMealPlanningDashboard,
  patchCoachPantryItem,
  patchCoachShoppingItem,
  recalculateCoachShoppingList,
  removeCoachShoppingItem,
  replaceCoachMealPlanEntry,
  deleteCoachMealPlanEntry,
} from '@/api/Settings/mealPlanning';
import { useAuth } from '@/hooks/useAuth';

interface PantryItemPatchVariables {
  itemId: string;
  request: PatchCoachPantryItemRequest;
}

interface ShoppingItemPatchVariables {
  itemId: string;
  request: PatchCoachShoppingItemRequest;
}

interface MealPlanActionVariables {
  entryId: string;
  request: CoachMealPlanActionRequest;
}

interface MealPlanReplacementVariables {
  entryId: string;
  request: ReplaceCoachMealPlanEntryRequest;
}

function useInvalidateMealPlanningDashboard() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: coachMealPlanningKeys.all });
}

export const useCoachMealPlanningDashboard = (
  startDate: string,
  days: number
) => {
  const { user } = useAuth();
  const { t } = useTranslation();
  return useQuery({
    queryKey: coachMealPlanningKeys.dashboard(startDate, days),
    queryFn: () => getCoachMealPlanningDashboard({ startDate, days }),
    enabled: !!user && startDate.length > 0,
    meta: {
      errorMessage: t(
        'settings.mealPlanning.messages.loadError',
        'Could not load meal planning.'
      ),
    },
  });
};

export const useCreateCoachPantryItem = () => {
  const invalidate = useInvalidateMealPlanningDashboard();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (request: CreateCoachPantryItemRequest) =>
      createCoachPantryItem(request),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'settings.mealPlanning.messages.pantrySaved',
        'Pantry item saved.'
      ),
      errorMessage: t(
        'settings.mealPlanning.messages.pantrySaveError',
        'Could not save the pantry item.'
      ),
    },
  });
};

export const usePatchCoachPantryItem = () => {
  const invalidate = useInvalidateMealPlanningDashboard();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ itemId, request }: PantryItemPatchVariables) =>
      patchCoachPantryItem(itemId, request),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'settings.mealPlanning.messages.pantrySaved',
        'Pantry item saved.'
      ),
      errorMessage: t(
        'settings.mealPlanning.messages.pantrySaveError',
        'Could not save the pantry item.'
      ),
    },
  });
};

export const useArchiveCoachPantryItem = () => {
  const invalidate = useInvalidateMealPlanningDashboard();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: archiveCoachPantryItem,
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'settings.mealPlanning.messages.pantryArchived',
        'Pantry item archived.'
      ),
      errorMessage: t(
        'settings.mealPlanning.messages.pantryArchiveError',
        'Could not archive the pantry item.'
      ),
    },
  });
};

export const useCreateCoachShoppingItem = () => {
  const invalidate = useInvalidateMealPlanningDashboard();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (request: CreateCoachShoppingItemRequest) =>
      createCoachShoppingItem(request),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'settings.mealPlanning.messages.shoppingSaved',
        'Shopping item saved.'
      ),
      errorMessage: t(
        'settings.mealPlanning.messages.shoppingSaveError',
        'Could not save the shopping item.'
      ),
    },
  });
};

export const usePatchCoachShoppingItem = () => {
  const invalidate = useInvalidateMealPlanningDashboard();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ itemId, request }: ShoppingItemPatchVariables) =>
      patchCoachShoppingItem(itemId, request),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'settings.mealPlanning.messages.shoppingSaved',
        'Shopping item saved.'
      ),
      errorMessage: t(
        'settings.mealPlanning.messages.shoppingSaveError',
        'Could not save the shopping item.'
      ),
    },
  });
};

export const useRemoveCoachShoppingItem = () => {
  const invalidate = useInvalidateMealPlanningDashboard();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: removeCoachShoppingItem,
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'settings.mealPlanning.messages.shoppingRemoved',
        'Shopping item removed.'
      ),
      errorMessage: t(
        'settings.mealPlanning.messages.shoppingRemoveError',
        'Could not remove the shopping item.'
      ),
    },
  });
};

export const useConfirmCoachShoppingPurchase = () => {
  const invalidate = useInvalidateMealPlanningDashboard();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (request: ConfirmCoachShoppingPurchaseRequest) =>
      confirmCoachShoppingPurchase(request),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'settings.mealPlanning.messages.purchaseConfirmed',
        'Purchase added to your pantry.'
      ),
      errorMessage: t(
        'settings.mealPlanning.messages.purchaseConfirmError',
        'Could not confirm the purchase.'
      ),
    },
  });
};

export const useGenerateCoachMealPlan = () => {
  const invalidate = useInvalidateMealPlanningDashboard();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (request: GenerateCoachMealPlanRequest) =>
      generateCoachMealPlan(request),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'settings.mealPlanning.messages.planGenerated',
        'Meal plan created.'
      ),
      errorMessage: t(
        'settings.mealPlanning.messages.planGenerateError',
        'Could not create the meal plan.'
      ),
    },
  });
};

export const useApplyCoachMealPlanAction = () => {
  const invalidate = useInvalidateMealPlanningDashboard();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ entryId, request }: MealPlanActionVariables) =>
      applyCoachMealPlanAction(entryId, request),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'settings.mealPlanning.messages.planUpdated',
        'Meal updated.'
      ),
      errorMessage: t(
        'settings.mealPlanning.messages.planUpdateError',
        'Could not update the meal.'
      ),
    },
  });
};

export const useReplaceCoachMealPlanEntry = () => {
  const invalidate = useInvalidateMealPlanningDashboard();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ entryId, request }: MealPlanReplacementVariables) =>
      replaceCoachMealPlanEntry(entryId, request),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'settings.mealPlanning.messages.mealReplaced',
        'Meal replaced.'
      ),
      errorMessage: t(
        'settings.mealPlanning.messages.mealReplaceError',
        'Could not replace the meal.'
      ),
    },
  });
};

export const useDeleteCoachMealPlanEntry = () => {
  const invalidate = useInvalidateMealPlanningDashboard();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (entryId: string) => deleteCoachMealPlanEntry(entryId),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'settings.mealPlanning.messages.mealDeleted',
        'Meal removed and shopping list updated.'
      ),
      errorMessage: t(
        'settings.mealPlanning.messages.mealDeleteError',
        'Could not remove the meal.'
      ),
    },
  });
};

export const useRecalculateCoachShoppingList = () => {
  const invalidate = useInvalidateMealPlanningDashboard();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: () => recalculateCoachShoppingList(),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'settings.mealPlanning.messages.shoppingRecalculated',
        'Shopping list recalculated.'
      ),
      errorMessage: t(
        'settings.mealPlanning.messages.shoppingRecalculateError',
        'Could not recalculate the shopping list.'
      ),
    },
  });
};
