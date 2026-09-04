import { apiCall } from '@/api/api';
import type {
  CoachMealPlanActionRequest,
  CoachMealPlanningDashboardQuery,
  CoachMealPlanningDashboardResponse,
  CoachShoppingListResponse,
  ConfirmCoachShoppingPurchaseRequest,
  CreateCoachPantryItemRequest,
  CreateCoachShoppingItemRequest,
  GenerateCoachMealPlanRequest,
  PatchCoachPantryItemRequest,
  PatchCoachShoppingItemRequest,
  ReplaceCoachMealPlanEntryRequest,
} from '@workspace/shared';

const BASE_PATH = '/coach-meal-planning';

interface CreatedResourceResponse {
  id: string;
}

interface GeneratedMealPlanResponse {
  planId: string | null;
  addedEntries: number;
  warnings: string[];
}

interface ReplacedMealPlanEntryResponse {
  entryId: string;
}

export const getCoachMealPlanningDashboard = (
  query: CoachMealPlanningDashboardQuery
): Promise<CoachMealPlanningDashboardResponse> =>
  apiCall(`${BASE_PATH}/dashboard`, {
    params: { startDate: query.startDate, days: query.days },
  });

export const createCoachPantryItem = (
  request: CreateCoachPantryItemRequest
): Promise<CreatedResourceResponse> =>
  apiCall(`${BASE_PATH}/pantry`, { method: 'POST', body: request });

export const patchCoachPantryItem = (
  itemId: string,
  request: PatchCoachPantryItemRequest
): Promise<void> =>
  apiCall(`${BASE_PATH}/pantry/${itemId}`, {
    method: 'PATCH',
    body: request,
  });

export const archiveCoachPantryItem = (itemId: string): Promise<void> =>
  apiCall(`${BASE_PATH}/pantry/${itemId}`, { method: 'DELETE' });

export const createCoachShoppingItem = (
  request: CreateCoachShoppingItemRequest
): Promise<CreatedResourceResponse> =>
  apiCall(`${BASE_PATH}/shopping/items`, { method: 'POST', body: request });

export const patchCoachShoppingItem = (
  itemId: string,
  request: PatchCoachShoppingItemRequest
): Promise<void> =>
  apiCall(`${BASE_PATH}/shopping/items/${itemId}`, {
    method: 'PATCH',
    body: request,
  });

export const removeCoachShoppingItem = (itemId: string): Promise<void> =>
  apiCall(`${BASE_PATH}/shopping/items/${itemId}`, { method: 'DELETE' });

export const confirmCoachShoppingPurchase = (
  request: ConfirmCoachShoppingPurchaseRequest
): Promise<void> =>
  apiCall(`${BASE_PATH}/shopping/purchase`, {
    method: 'POST',
    body: request,
  });

export const generateCoachMealPlan = (
  request: GenerateCoachMealPlanRequest
): Promise<GeneratedMealPlanResponse> =>
  apiCall(`${BASE_PATH}/plan/generate`, { method: 'POST', body: request });

export const applyCoachMealPlanAction = (
  entryId: string,
  request: CoachMealPlanActionRequest
): Promise<void> =>
  apiCall(`${BASE_PATH}/plan/${entryId}/action`, {
    method: 'POST',
    body: request,
  });

export const replaceCoachMealPlanEntry = (
  entryId: string,
  request: ReplaceCoachMealPlanEntryRequest
): Promise<ReplacedMealPlanEntryResponse> =>
  apiCall(`${BASE_PATH}/plan/${entryId}/replace`, {
    method: 'POST',
    body: request,
  });

export const deleteCoachMealPlanEntry = (entryId: string): Promise<void> =>
  apiCall(`${BASE_PATH}/plan/${entryId}`, { method: 'DELETE' });

export const recalculateCoachShoppingList =
  (): Promise<CoachShoppingListResponse | null> =>
    apiCall(`${BASE_PATH}/shopping/recalculate`, { method: 'POST' });
