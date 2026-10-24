import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import type { WorkoutFormat } from '@workspace/shared';
import { formatDuration } from '../utils/workoutSession';

interface WorkoutCompleteWodCardProps {
  workoutFormat: WorkoutFormat;
  intervalStatus?: 'rx' | 'scaled' | null;
  intervalRoundsCompleted?: number | null;
  intervalRepsCompleted?: number | null;
  intervalScalingNotes?: string | null;
  timeCapSeconds?: number | null;
  durationMinutes: number;
  completedSetCount: number;
}

export default function WorkoutCompleteWodCard({
  workoutFormat,
  intervalStatus,
  intervalRoundsCompleted,
  intervalRepsCompleted,
  intervalScalingNotes,
  timeCapSeconds,
  durationMinutes,
  completedSetCount,
}: WorkoutCompleteWodCardProps) {
  const { t } = useTranslation();

  return (
    <View className="bg-surface rounded-xl shadow-sm px-3.5 py-3 mb-2 border border-border/40">
      <View className="flex-row items-center justify-between mb-1.5">
        <View className="flex-row items-center gap-1.5">
          <View className="bg-accent-primary/10 px-2 py-0.5 rounded-md">
            <Text className="text-xs font-bold text-accent-primary tracking-wide">
              {workoutFormat.toUpperCase().replace('_', ' ')}
            </Text>
          </View>
          <Text className="text-xs font-semibold uppercase text-text-muted">
            {t('interval.wodScore', { defaultValue: 'WOD Score' })}
          </Text>
        </View>

        {intervalStatus && (
          <View
            className={`px-2 py-0.5 rounded-md ${
              intervalStatus === 'rx'
                ? 'bg-accent-primary/20'
                : 'bg-amber-500/20'
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                intervalStatus === 'rx'
                  ? 'text-accent-primary'
                  : 'text-amber-500'
              }`}
            >
              {intervalStatus.toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      <Text className="text-lg font-bold text-text-primary">
        {workoutFormat === 'amrap'
          ? t('interval.amrapScore', {
              defaultValue: '{{rounds}} rounds + {{reps}} reps',
              rounds: intervalRoundsCompleted ?? 0,
              reps: intervalRepsCompleted ?? 0,
            })
          : workoutFormat === 'for_time'
            ? durationMinutes > 0
              ? formatDuration(durationMinutes)
              : t('interval.completed', { defaultValue: 'Completed' })
            : t('interval.roundsCompleted', {
                defaultValue: '{{rounds}} rounds completed',
                rounds: completedSetCount || intervalRoundsCompleted || 0,
              })}
      </Text>

      {timeCapSeconds != null && (
        <Text className="text-xs text-text-muted mt-0.5">
          {t('interval.timeCapLabel', {
            defaultValue: 'Cap: {{cap}}',
            cap: formatDuration(Math.floor(timeCapSeconds / 60)),
          })}
        </Text>
      )}

      {Boolean(intervalScalingNotes) && (
        <Text className="text-xs italic text-text-muted mt-1.5">
          “{intervalScalingNotes}”
        </Text>
      )}
    </View>
  );
}
