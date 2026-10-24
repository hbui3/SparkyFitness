import type { TFunction } from 'i18next';
import { formatTaxonomyFallback } from '@workspace/shared';

export type ExerciseTaxonomyKind =
  | 'category'
  | 'modality'
  | 'level'
  | 'force'
  | 'mechanic'
  | 'muscle'
  | 'equipment';

export function localizeExerciseTaxonomyValue(
  t: TFunction,
  kind: ExerciseTaxonomyKind,
  value: string | null | undefined
): string {
  if (!value) return '';
  const normalized = value.trim().toLowerCase();
  if (kind === 'muscle') {
    switch (normalized) {
      case 'abdominals':
        return t('muscles.abdominals', { defaultValue: 'Abdominals' });
      case 'abductors':
        return t('muscles.abductors', { defaultValue: 'Abductors' });
      case 'adductors':
        return t('muscles.adductors', { defaultValue: 'Adductors' });
      case 'biceps':
        return t('muscles.biceps', { defaultValue: 'Biceps' });
      case 'calves':
        return t('muscles.calves', { defaultValue: 'Calves' });
      case 'chest':
        return t('muscles.chest', { defaultValue: 'Chest' });
      case 'forearms':
        return t('muscles.forearms', { defaultValue: 'Forearms' });
      case 'glutes':
        return t('muscles.glutes', { defaultValue: 'Glutes' });
      case 'hamstrings':
        return t('muscles.hamstrings', { defaultValue: 'Hamstrings' });
      case 'lats':
        return t('muscles.lats', { defaultValue: 'Lats' });
      case 'lower back':
        return t('muscles.lower back', { defaultValue: 'Lower Back' });
      case 'middle back':
        return t('muscles.middle back', { defaultValue: 'Middle Back' });
      case 'neck':
        return t('muscles.neck', { defaultValue: 'Neck' });
      case 'quadriceps':
        return t('muscles.quadriceps', { defaultValue: 'Quadriceps' });
      case 'shoulders':
        return t('muscles.shoulders', { defaultValue: 'Shoulders' });
      case 'traps':
        return t('muscles.traps', { defaultValue: 'Traps' });
      case 'triceps':
        return t('muscles.triceps', { defaultValue: 'Triceps' });
      default:
        return formatTaxonomyFallback(value);
    }
  }
  if (kind === 'equipment') {
    switch (normalized) {
      case 'barbell':
        return t('equipment.barbell', { defaultValue: 'Barbell' });
      case 'dumbbell':
        return t('equipment.dumbbell', { defaultValue: 'Dumbbell' });
      case 'body only':
        return t('equipment.body only', { defaultValue: 'Body Only' });
      case 'cable':
        return t('equipment.cable', { defaultValue: 'Cable' });
      case 'machine':
        return t('equipment.machine', { defaultValue: 'Machine' });
      case 'kettlebells':
        return t('equipment.kettlebells', { defaultValue: 'Kettlebells' });
      case 'bands':
        return t('equipment.bands', { defaultValue: 'Bands' });
      case 'medicine ball':
        return t('equipment.medicine ball', { defaultValue: 'Medicine Ball' });
      case 'exercise ball':
        return t('equipment.exercise ball', { defaultValue: 'Exercise Ball' });
      case 'e-z curl bar':
        return t('equipment.e-z curl bar', { defaultValue: 'E-Z Curl Bar' });
      case 'foam roll':
        return t('equipment.foam roll', { defaultValue: 'Foam Roll' });
      case 'other':
        return t('equipment.other', { defaultValue: 'Other' });
      default:
        return formatTaxonomyFallback(value);
    }
  }
  switch (`${kind}:${normalized}`) {
    case 'category:general':
      return t('workout.categoryGeneral', { defaultValue: 'General' });
    case 'category:strength':
      return t('workout.categoryStrength', { defaultValue: 'Strength' });
    case 'category:cardio':
      return t('workout.categoryCardio', { defaultValue: 'Cardio' });
    case 'category:yoga':
      return t('workout.categoryYoga', { defaultValue: 'Yoga' });
    case 'category:powerlifting':
      return t('workout.categoryPowerlifting', {
        defaultValue: 'Powerlifting',
      });
    case 'category:olympic weightlifting':
      return t('workout.categoryOlympicWeightlifting', {
        defaultValue: 'Olympic Weightlifting',
      });
    case 'category:strongman':
      return t('workout.categoryStrongman', { defaultValue: 'Strongman' });
    case 'category:plyometrics':
      return t('workout.categoryPlyometrics', { defaultValue: 'Plyometrics' });
    case 'category:stretching':
      return t('workout.categoryStretching', { defaultValue: 'Stretching' });
    case 'category:isometric':
      return t('workout.categoryIsometric', { defaultValue: 'Isometric' });
    case 'modality:weight_reps':
      return t('workout.modalityWeightReps', { defaultValue: 'Weight & Reps' });
    case 'modality:reps_only':
      return t('workout.modalityReps', { defaultValue: 'Reps' });
    case 'modality:bodyweight_reps':
      return t('workout.modalityBodyweight', {
        defaultValue: 'Bodyweight (+/− weight)',
      });
    case 'modality:weight_distance':
      return t('workout.modalityWeightDistance', {
        defaultValue: 'Weight & Distance (carries)',
      });
    case 'modality:weight_duration':
      return t('workout.modalityWeightDuration', {
        defaultValue: 'Weight & Duration (loaded holds)',
      });
    case 'modality:duration':
      return t('workout.modalityDuration', { defaultValue: 'Duration' });
    case 'modality:duration_distance':
      return t('workout.modalityDurationDistance', {
        defaultValue: 'Duration & Distance',
      });
    case 'level:beginner':
      return t('workout.levelBeginner', { defaultValue: 'Beginner' });
    case 'level:intermediate':
      return t('workout.levelIntermediate', { defaultValue: 'Intermediate' });
    case 'level:expert':
      return t('workout.levelExpert', { defaultValue: 'Expert' });
    case 'force:pull':
      return t('workout.forcePull', { defaultValue: 'Pull' });
    case 'force:push':
      return t('workout.forcePush', { defaultValue: 'Push' });
    case 'force:static':
      return t('workout.forceStatic', { defaultValue: 'Static' });
    case 'mechanic:compound':
      return t('workout.mechanicCompound', { defaultValue: 'Compound' });
    case 'mechanic:isolation':
      return t('workout.mechanicIsolation', { defaultValue: 'Isolation' });
    default:
      return value;
  }
}
