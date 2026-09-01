export const externalProviderKeys = {
  all: ['externalProviders'] as const,
  lists: () => [...externalProviderKeys.all, 'list'] as const,
};

export const syncedDataKeys = {
  all: ['syncedData'] as const,
  sources: () => [...syncedDataKeys.all, 'sources'] as const,
};

export const familyAccessKeys = {
  all: ['familyAccess'] as const,
  lists: () => [...familyAccessKeys.all, 'list'] as const,
  userSearch: (email: string) =>
    [...familyAccessKeys.all, 'search', email] as const,
};

export const passkeyKeys = {
  all: ['passkeys'] as const,
  lists: () => [...passkeyKeys.all, 'list'] as const,
};

export const waterContainerKeys = {
  all: ['waterContainers'] as const,
  lists: () => [...waterContainerKeys.all, 'list'] as const,
};

export const apiKeyKeys = {
  all: ['apiKeys'] as const,
  lists: () => [...apiKeyKeys.all, 'list'] as const,
};

export const preferencesKeys = {
  all: ['preferences'] as const,
  user: () => [...preferencesKeys.all, 'user'] as const,
  nutrients: () => [...preferencesKeys.all, 'nutrients'] as const,
  nutrientGoalDirection: () =>
    [...preferencesKeys.all, 'nutrient-goal-direction'] as const,
  coachProfile: () => [...preferencesKeys.all, 'coach-profile'] as const,
  coachTelegram: () => [...preferencesKeys.all, 'coach-telegram'] as const,
  coachMemories: () => [...preferencesKeys.all, 'coach-memories'] as const,
};

export const coachMealPlanningKeys = {
  all: ['coach-meal-planning'] as const,
  dashboard: (startDate: string, days: number) =>
    [...coachMealPlanningKeys.all, 'dashboard', { startDate, days }] as const,
};
