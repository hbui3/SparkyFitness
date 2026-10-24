import { isBodyweightModality, isExerciseModality } from '@workspace/shared';
import { ValidationError } from './errors.js';

/**
 * A negative set weight is added/assisting load on a bodyweight exercise.
 * Any other modality, or an unknown one, must not persist it.
 */
export function assertSetWeightSign(
  sets: readonly { weight?: number | string | null }[] | null | undefined,
  modality: string | null | undefined
): void {
  if (isExerciseModality(modality) && isBodyweightModality(modality)) return;
  for (const set of sets ?? []) {
    const weight = numericWeight(set.weight);
    if (weight !== null && weight < 0) {
      throw new ValidationError(
        'Negative weight is only valid on a bodyweight exercise.'
      );
    }
  }
}

/** A number, or a non-empty numeric string. Anything else is not a weight. */
function numericWeight(
  weight: number | string | null | undefined
): number | null {
  if (typeof weight === 'number')
    return Number.isFinite(weight) ? weight : null;
  if (typeof weight === 'string' && weight.trim() !== '') {
    const parsed = Number(weight);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
