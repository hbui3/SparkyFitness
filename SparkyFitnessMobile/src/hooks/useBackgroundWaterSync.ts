import { useEffect } from 'react';
import type { WaterContainer } from '../types/measurements';
import {
  onAppBecameActive,
  syncBackgroundWater,
} from '../services/backgroundWater';
import { usePreferences } from './usePreferences';

/**
 * Keeps the native Siri, Shortcuts, widget and control actions pointed at the
 * container the dashboard is using and the weight unit in use, and holding the
 * current login (a session token can be renewed while the app runs). Removing
 * the server erases the native copy.
 */
export function useBackgroundWaterSync(
  container: WaterContainer | undefined
): void {
  const { preferences } = usePreferences();
  const weightUnit: 'kg' | 'lbs' =
    preferences?.default_weight_unit === 'lbs' ||
    preferences?.default_weight_unit === 'st_lbs'
      ? 'lbs'
      : 'kg';
  const id = container?.id;
  const name = container?.name;
  const volume = container?.volume;
  const unit = container?.unit;
  const servings = container?.servings_per_container;
  const linkedFoodId = container?.linked_food_id;

  useEffect(() => {
    // Until preferences load the weight unit is a guess, and a shortcut would
    // log a pounds entry as kilograms.
    if (preferences == null) return;
    const target =
      id != null && name != null && volume != null && unit != null
        ? {
            id,
            name,
            volume,
            unit,
            servings_per_container: servings ?? 1,
            linked_food_id: linkedFoodId,
          }
        : undefined;
    const sync = (): void => void syncBackgroundWater(target, weightUnit);
    sync();
    return onAppBecameActive(sync);
  }, [id, name, volume, unit, servings, linkedFoodId, preferences, weightUnit]);
}
