import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import Icon from './Icon';
import { formatLocalizedNumber } from '../localization';
import { withAlpha } from '../utils/colors';
import { formatSetLoad } from '../utils/workoutSession';

interface PrRow {
  exerciseName: string;
  weightKg?: number | null;
  reps?: number | null;
  durationSec?: number | null;
}

interface WorkoutCompletePrCardProps {
  prRows: PrRow[];
  weightUnit: 'kg' | 'lbs';
}

export default function WorkoutCompletePrCard({
  prRows,
  weightUnit,
}: WorkoutCompletePrCardProps) {
  const { t } = useTranslation();
  const prColor = String(useCSSVariable('--color-pr'));

  if (prRows.length === 0) return null;

  return (
    <View className="bg-surface rounded-xl shadow-sm mt-2 overflow-hidden">
      <View className="flex-row items-center gap-2.5 px-3.5 pt-3 pb-2.5">
        <View
          className="w-8 h-8 rounded-lg items-center justify-center"
          style={{ backgroundColor: withAlpha(prColor, 0.13) }}
        >
          <Icon name="trophy" size={17} color={prColor} />
        </View>
        <Text className="text-sm font-bold text-text-primary">
          {t('workoutComplete.labels.personalRecordCount', {
            count: prRows.length,
            formattedCount: formatLocalizedNumber(prRows.length),
            defaultValue: '{{formattedCount}} Personal Records',
            defaultValue_one: '{{formattedCount}} Personal Record',
            defaultValue_other: '{{formattedCount}} Personal Records',
          })}
        </Text>
      </View>
      {prRows.map((pr, index) => (
        <View
          key={index}
          className="flex-row items-baseline gap-2 px-3.5 py-2 border-t border-border-subtle"
        >
          <Text
            className="flex-1 text-sm font-semibold text-text-primary"
            numberOfLines={1}
          >
            {pr.exerciseName}
          </Text>
          <Text
            className="text-sm font-medium"
            style={{ color: prColor, fontVariant: ['tabular-nums'] }}
          >
            {formatSetLoad(
              {
                weightKg: pr.weightKg ?? null,
                reps: pr.reps ?? null,
                durationSec: pr.durationSec ?? null,
              },
              weightUnit,
              t
            ) ?? ''}
          </Text>
        </View>
      ))}
    </View>
  );
}
