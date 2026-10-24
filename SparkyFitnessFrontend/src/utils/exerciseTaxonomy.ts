import type { TFunction } from 'i18next';
import { formatTaxonomyFallback } from '@workspace/shared';

export function localizeMuscle(
  t: TFunction,
  muscle: string | null | undefined
): string {
  if (!muscle) return '';
  const trimmed = muscle.trim();
  const lower = trimmed.toLowerCase();
  const fallback = formatTaxonomyFallback(trimmed);
  return t(`muscles.${lower}`, { defaultValue: fallback });
}

export function localizeEquipment(
  t: TFunction,
  equipment: string | null | undefined
): string {
  if (!equipment) return '';
  const trimmed = equipment.trim();
  const lower = trimmed.toLowerCase();
  const fallback = formatTaxonomyFallback(trimmed);
  return t(`equipment.${lower}`, { defaultValue: fallback });
}
