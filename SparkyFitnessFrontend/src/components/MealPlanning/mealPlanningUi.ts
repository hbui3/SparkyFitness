import type { TFunction } from 'i18next';
import type {
  CoachMealPlanEntryStatus,
  CoachMealPlanningCategory,
  CoachMealPlanningRetailer,
  CoachMealPlanningUnit,
  CoachMealSlot,
} from '@workspace/shared';

export const MEAL_PLANNING_CATEGORIES: CoachMealPlanningCategory[] = [
  'produce',
  'chilled',
  'pantry',
  'frozen',
  'other',
];

export const MEAL_PLANNING_UNITS: CoachMealPlanningUnit[] = [
  'g',
  'ml',
  'piece',
  'tsp',
  'tbsp',
];

export function formatPlanningQuantity(quantity: number): string {
  return Number.isInteger(quantity)
    ? String(quantity)
    : String(Number(quantity.toFixed(2)));
}

export function planningUnitLabel(
  t: TFunction,
  unit: CoachMealPlanningUnit
): string {
  switch (unit) {
    case 'piece':
      return t('settings.mealPlanning.units.piece', 'piece');
    case 'tsp':
      return t('settings.mealPlanning.units.tsp', 'tsp');
    case 'tbsp':
      return t('settings.mealPlanning.units.tbsp', 'tbsp');
    case 'g':
      return t('settings.mealPlanning.units.g', 'g');
    case 'ml':
      return t('settings.mealPlanning.units.ml', 'ml');
  }
}

export function planningCategoryLabel(
  t: TFunction,
  category: CoachMealPlanningCategory
): string {
  switch (category) {
    case 'produce':
      return t(
        'settings.mealPlanning.categories.produce',
        'Fruit & vegetables'
      );
    case 'chilled':
      return t('settings.mealPlanning.categories.chilled', 'Chilled');
    case 'pantry':
      return t('settings.mealPlanning.categories.pantry', 'Pantry');
    case 'frozen':
      return t('settings.mealPlanning.categories.frozen', 'Frozen');
    case 'other':
      return t('settings.mealPlanning.categories.other', 'Other');
  }
}

export function mealSlotLabel(t: TFunction, slot: CoachMealSlot): string {
  switch (slot) {
    case 'breakfast':
      return t('settings.mealPlanning.slots.breakfast', 'Breakfast');
    case 'lunch':
      return t('settings.mealPlanning.slots.lunch', 'Lunch');
    case 'dinner':
      return t('settings.mealPlanning.slots.dinner', 'Dinner');
    case 'snack':
      return t('settings.mealPlanning.slots.snack', 'Snack');
  }
}

export function mealStatusLabel(
  t: TFunction,
  status: CoachMealPlanEntryStatus
): string {
  switch (status) {
    case 'planned':
      return t('settings.mealPlanning.status.planned', 'Planned');
    case 'prepared':
      return t('settings.mealPlanning.status.prepared', 'Prepared');
    case 'eaten_out':
      return t('settings.mealPlanning.status.eatenOut', 'Eating out');
    case 'replaced':
      return t('settings.mealPlanning.status.replaced', 'Replaced');
    case 'skipped':
      return t('settings.mealPlanning.status.skipped', 'Skipped');
  }
}

export function retailerLabel(
  t: TFunction,
  retailer: CoachMealPlanningRetailer
): string {
  return retailer === 'coop'
    ? t('settings.mealPlanning.retailers.coop', 'Coop')
    : t('settings.mealPlanning.retailers.migros', 'Migros');
}

export function formatPlanningDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}
