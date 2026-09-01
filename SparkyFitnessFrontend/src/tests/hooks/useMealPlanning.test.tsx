import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CoachMealPlanningDashboardResponse } from '@workspace/shared';
import { coachMealPlanningKeys } from '@/api/keys/settings';
import * as mealPlanningApi from '@/api/Settings/mealPlanning';
import {
  useApplyCoachMealPlanAction,
  useArchiveCoachPantryItem,
  useCoachMealPlanningDashboard,
  useConfirmCoachShoppingPurchase,
  useCreateCoachPantryItem,
  useCreateCoachShoppingItem,
  useGenerateCoachMealPlan,
  usePatchCoachPantryItem,
  usePatchCoachShoppingItem,
  useRemoveCoachShoppingItem,
  useReplaceCoachMealPlanEntry,
} from '@/hooks/Settings/useMealPlanning';
import { useAuth } from '@/hooks/useAuth';

jest.mock('@/api/Settings/mealPlanning');
jest.mock('@/hooks/useAuth', () => ({ useAuth: jest.fn() }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';

const emptyDashboard: CoachMealPlanningDashboardResponse = {
  startDate: '2026-09-01',
  days: 5,
  pantry: [],
  shoppingList: null,
  planEntries: [],
  mealCatalog: [],
  warnings: [],
  lastUpdatedAt: '2026-09-01T08:00:00.000Z',
};

describe('meal-planning hooks', () => {
  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    jest.mocked(useAuth).mockReturnValue({
      user: { id: 'owner-1' },
    } as unknown as ReturnType<typeof useAuth>);
  });

  it('loads the owner dashboard for the selected date range', async () => {
    jest
      .mocked(mealPlanningApi.getCoachMealPlanningDashboard)
      .mockResolvedValue(emptyDashboard);

    const { result } = renderHook(
      () => useCoachMealPlanningDashboard('2026-09-01', 5),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mealPlanningApi.getCoachMealPlanningDashboard).toHaveBeenCalledWith({
      startDate: '2026-09-01',
      days: 5,
    });
    expect(result.current.data).toEqual(emptyDashboard);
  });

  it('keeps the dashboard disabled until an authenticated owner is available', () => {
    jest.mocked(useAuth).mockReturnValue({
      user: null,
    } as unknown as ReturnType<typeof useAuth>);

    renderHook(() => useCoachMealPlanningDashboard('2026-09-01', 5), {
      wrapper,
    });

    expect(
      mealPlanningApi.getCoachMealPlanningDashboard
    ).not.toHaveBeenCalled();
  });

  it('invalidates every dashboard range after each supported mutation', async () => {
    jest
      .mocked(mealPlanningApi.createCoachPantryItem)
      .mockResolvedValue({ id: ITEM_ID });
    jest.mocked(mealPlanningApi.patchCoachPantryItem).mockResolvedValue();
    jest.mocked(mealPlanningApi.archiveCoachPantryItem).mockResolvedValue();
    jest
      .mocked(mealPlanningApi.createCoachShoppingItem)
      .mockResolvedValue({ id: ITEM_ID });
    jest.mocked(mealPlanningApi.patchCoachShoppingItem).mockResolvedValue();
    jest.mocked(mealPlanningApi.removeCoachShoppingItem).mockResolvedValue();
    jest
      .mocked(mealPlanningApi.confirmCoachShoppingPurchase)
      .mockResolvedValue();
    jest.mocked(mealPlanningApi.generateCoachMealPlan).mockResolvedValue({
      planId: ENTRY_ID,
      addedEntries: 1,
      warnings: [],
    });
    jest.mocked(mealPlanningApi.applyCoachMealPlanAction).mockResolvedValue();
    jest
      .mocked(mealPlanningApi.replaceCoachMealPlanEntry)
      .mockResolvedValue({ entryId: ENTRY_ID });
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () => ({
        createPantry: useCreateCoachPantryItem(),
        patchPantry: usePatchCoachPantryItem(),
        archivePantry: useArchiveCoachPantryItem(),
        createShopping: useCreateCoachShoppingItem(),
        patchShopping: usePatchCoachShoppingItem(),
        removeShopping: useRemoveCoachShoppingItem(),
        purchase: useConfirmCoachShoppingPurchase(),
        generate: useGenerateCoachMealPlan(),
        action: useApplyCoachMealPlanAction(),
        replace: useReplaceCoachMealPlanEntry(),
      }),
      { wrapper }
    );

    await act(async () => {
      await result.current.createPantry.mutateAsync({
        name: 'Rice',
        quantity: 500,
        minimumQuantity: 250,
        unit: 'g',
        category: 'pantry',
        preferredProduct: null,
        expiresOn: null,
      });
      await result.current.patchPantry.mutateAsync({
        itemId: ITEM_ID,
        request: { quantity: 450 },
      });
      await result.current.archivePantry.mutateAsync(ITEM_ID);
      await result.current.createShopping.mutateAsync({
        name: 'Tomatoes',
        requiredQuantity: 4,
        unit: 'piece',
        category: 'produce',
        notes: null,
        selectedProduct: null,
      });
      await result.current.patchShopping.mutateAsync({
        itemId: ITEM_ID,
        request: { requiredQuantity: 3 },
      });
      await result.current.removeShopping.mutateAsync(ITEM_ID);
      await result.current.purchase.mutateAsync({
        operationId: OPERATION_ID,
        purchases: [{ itemId: ITEM_ID, quantity: 2 }],
      });
      await result.current.generate.mutateAsync({
        operationId: OPERATION_ID,
        startDate: '2026-09-01',
        days: 5,
        replaceExisting: false,
      });
      await result.current.action.mutateAsync({
        entryId: ENTRY_ID,
        request: { operationId: OPERATION_ID, action: 'prepared' },
      });
      await result.current.replace.mutateAsync({
        entryId: ENTRY_ID,
        request: { operationId: OPERATION_ID, recipeKey: 'lentil-bowl' },
      });
    });

    expect(invalidate).toHaveBeenCalledTimes(10);
    for (const call of invalidate.mock.calls) {
      expect(call[0]).toEqual({ queryKey: coachMealPlanningKeys.all });
    }
  });
});
