import React from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { usePreferences } from '../hooks/usePreferences';
import { formatTime } from '../utils/fasting';
import { localizeEatingBand } from '../utils/fastingLocalization';

export { localizeEatingBand };

export interface EatingWindowZoneBarProps {
  startTime: string | Date;
  targetEndTime: string | Date;
  remainingMinutes?: number | null;
  showTitle?: boolean;
}

export const EATING_WINDOW_BANDS = [
  {
    key: 'open',
    name: 'Window Open',
    shortName: 'Open',
    color: '#10B981',
    description: '',
  },
  {
    key: 'fuel',
    name: 'Optimal Fuel',
    shortName: 'Fuel',
    color: '#14B8A6',
    description: '',
  },
  {
    key: 'sustain',
    name: 'Mid Window',
    shortName: 'Sustain',
    color: '#06B6D4',
    description: '',
  },
  {
    key: 'closing',
    name: 'Window Closing',
    shortName: 'Closing',
    color: '#F59E0B',
    description: '',
  },
];

export function getActiveEatingWindowBand(
  startTime: string | Date,
  targetEndTime: string | Date
) {
  const startMs =
    typeof startTime === 'string'
      ? new Date(startTime).getTime()
      : startTime.getTime();
  const endMs =
    typeof targetEndTime === 'string'
      ? new Date(targetEndTime).getTime()
      : targetEndTime.getTime();

  const totalMs = Math.max(60000, endMs - startMs);
  const nowMs = Date.now();
  const elapsedMs = Math.max(0, nowMs - startMs);
  const progressRatio = Math.min(1, Math.max(0, elapsedMs / totalMs));

  const activeIndex = Math.min(
    EATING_WINDOW_BANDS.length - 1,
    Math.max(0, Math.floor(progressRatio * EATING_WINDOW_BANDS.length))
  );
  return EATING_WINDOW_BANDS[activeIndex] ?? EATING_WINDOW_BANDS[0];
}

export const EatingWindowZoneBar: React.FC<EatingWindowZoneBarProps> = ({
  startTime,
  targetEndTime,
  remainingMinutes: _remainingMinutes,
  showTitle = true,
}) => {
  const { t } = useTranslation();
  const { preferences } = usePreferences();

  const startMs =
    typeof startTime === 'string'
      ? new Date(startTime).getTime()
      : startTime.getTime();
  const endMs =
    typeof targetEndTime === 'string'
      ? new Date(targetEndTime).getTime()
      : targetEndTime.getTime();

  const totalMs = Math.max(60000, endMs - startMs);
  const totalHours = totalMs / (1000 * 60 * 60);

  const activeBand = getActiveEatingWindowBand(startTime, targetEndTime);
  const activeIndex = Math.max(
    0,
    EATING_WINDOW_BANDS.findIndex((b) => b.key === activeBand.key)
  );

  const startTimeStr =
    typeof startTime === 'string' ? startTime : startTime.toISOString();
  const endTimeStr =
    typeof targetEndTime === 'string'
      ? targetEndTime
      : targetEndTime.toISOString();

  const quarterHours = Math.round(totalHours * 0.25);
  const halfHours = Math.round(totalHours * 0.5);
  const threeQuarterHours = Math.round(totalHours * 0.75);
  const roundedTotalHours = Math.round(totalHours);

  const localizedBand = localizeEatingBand(t, activeBand);

  return (
    <View className="w-full">
      {/* Top row: Start time, Active Band, End time */}
      <View className="flex-row justify-between items-center mb-1.5">
        <Text className="text-xs text-text-secondary font-medium">
          {t('fastingDetail.startedAt', {
            defaultValue: 'Started {{time}}',
            time: formatTime(startTimeStr, preferences?.time_format),
          })}
        </Text>
        {showTitle && (
          <View
            className="px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${activeBand.color}20` }}
          >
            <Text
              className="text-xs font-bold"
              style={{ color: activeBand.color }}
            >
              {localizedBand.shortName}
            </Text>
          </View>
        )}
        <Text className="text-xs text-text-secondary font-medium">
          {t('fastingDetail.closesAt', {
            defaultValue: 'Closes {{time}}',
            time: formatTime(endTimeStr, preferences?.time_format),
          })}
        </Text>
      </View>

      {/* Segmented Color Bands Bar */}
      <View className="w-full h-3.5 bg-border-subtle rounded-full overflow-hidden flex-row p-0.5">
        {EATING_WINDOW_BANDS.map((band, index) => {
          const isPassed = index < activeIndex;
          const isActive = index === activeIndex;
          const opacity = isPassed ? 1 : isActive ? 1 : 0.22;

          return (
            <View
              key={band.key}
              style={{
                flex: 1,
                backgroundColor: band.color,
                opacity,
                marginHorizontal: 1,
                borderRadius: 4,
                ...(isActive
                  ? {
                      borderWidth: 1.5,
                      borderColor: '#FFFFFF',
                    }
                  : {}),
              }}
            />
          );
        })}
      </View>

      {/* Bottom row: Hour milestones */}
      <View className="flex-row justify-between mt-1 px-0.5">
        <Text className="font-medium text-text-muted" style={{ fontSize: 10 }}>
          0{t('time.hoursShort', { defaultValue: 'h' })}
        </Text>
        <Text className="font-medium text-text-muted" style={{ fontSize: 10 }}>
          {quarterHours}
          {t('time.hoursShort', { defaultValue: 'h' })}
        </Text>
        <Text className="font-medium text-text-muted" style={{ fontSize: 10 }}>
          {halfHours}
          {t('time.hoursShort', { defaultValue: 'h' })}
        </Text>
        <Text className="font-medium text-text-muted" style={{ fontSize: 10 }}>
          {threeQuarterHours}
          {t('time.hoursShort', { defaultValue: 'h' })}
        </Text>
        <Text className="font-medium text-text-muted" style={{ fontSize: 10 }}>
          {roundedTotalHours}
          {t('time.hoursShort', { defaultValue: 'h' })}
        </Text>
      </View>
    </View>
  );
};
