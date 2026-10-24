import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import type { PresetSessionResponse } from '@workspace/shared';
import { ExerciseThumb } from './ActiveWorkoutExerciseCard';
import Icon from './Icon';
import { formatSetLoad, formatVolume } from '../utils/workoutSession';
import type { GetImageSource } from '../hooks/useExerciseImageSource';

interface ExerciseSummaryRow {
  entryId: string;
  name: string;
  hasPr: boolean;
  totalSetCount: number;
  completedSetCount: number;
  volumeKg: number;
  notes?: string | null;
  topSet?: {
    weightKg?: number | null;
    reps?: number | null;
    durationSec?: number | null;
  } | null;
}

interface WorkoutCompleteExerciseListProps {
  session: PresetSessionResponse;
  exercises: ExerciseSummaryRow[];
  weightUnit: 'kg' | 'lbs';
  getImageSource: GetImageSource;
}

export default function WorkoutCompleteExerciseList({
  session,
  exercises,
  weightUnit,
  getImageSource,
}: WorkoutCompleteExerciseListProps) {
  const { t } = useTranslation();
  const prColor = String(useCSSVariable('--color-pr'));

  return (
    <>
      <View className="flex-row items-baseline px-4 pt-6 pb-1.5">
        <Text
          className="text-xs font-bold uppercase text-text-muted"
          style={{ letterSpacing: 1 }}
        >
          {t('workoutComplete.sections.exercises', {
            defaultValue: 'Exercises',
          })}
        </Text>
        <Text
          className="ml-auto text-xs font-bold uppercase text-text-muted"
          style={{ letterSpacing: 1 }}
        >
          {t('workoutComplete.sections.volume', { defaultValue: 'Volume' })}
        </Text>
      </View>

      <View className="border-t border-border-subtle">
        {exercises.map((row) => {
          const entry = session.exercises.find((e) => e.id === row.entryId);
          const topText =
            row.topSet != null
              ? formatSetLoad(
                  {
                    weightKg: row.topSet.weightKg ?? null,
                    reps: row.topSet.reps ?? null,
                    durationSec: row.topSet.durationSec ?? null,
                  },
                  weightUnit,
                  t
                )
              : null;

          return (
            <View
              key={row.entryId}
              className="flex-row items-center gap-3 px-4 py-3 border-b border-border-subtle"
            >
              {entry != null && (
                <ExerciseThumb
                  exercise={entry}
                  getImageSource={getImageSource}
                  size={38}
                />
              )}
              <View className="flex-1">
                <View className="flex-row items-center gap-1.5">
                  <Text
                    className="text-sm font-semibold text-text-primary shrink"
                    numberOfLines={1}
                  >
                    {row.name}
                  </Text>
                  {row.hasPr && (
                    <Icon name="trophy" size={14} color={prColor} />
                  )}
                </View>
                <Text
                  className="text-xs font-medium text-text-secondary mt-0.5"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  <Text className="font-semibold">
                    {row.completedSetCount === row.totalSetCount
                      ? t('workoutComplete.labels.allSets', {
                          defaultValue: '{{count}} sets',
                          count: row.totalSetCount,
                        })
                      : t('workoutComplete.labels.partialSets', {
                          defaultValue: '{{completed}} of {{total}} sets',
                          completed: row.completedSetCount,
                          total: row.totalSetCount,
                        })}
                  </Text>
                  {topText != null &&
                    ` · ${t('workoutComplete.labels.top', { defaultValue: 'top' })} ${topText}`}
                </Text>
                {row.notes != null && (
                  <Text
                    className="text-xs italic text-text-muted mt-0.5"
                    numberOfLines={1}
                  >
                    “{row.notes}”
                  </Text>
                )}
              </View>
              <Text
                className="text-sm font-medium text-text-primary"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {row.volumeKg > 0
                  ? formatVolume(row.volumeKg, weightUnit)
                  : '—'}
              </Text>
            </View>
          );
        })}
      </View>
    </>
  );
}
