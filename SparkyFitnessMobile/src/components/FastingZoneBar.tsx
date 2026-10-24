import React from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { localizeFastingStage } from '../utils/fastingLocalization';

import { usePreferences } from '../hooks/usePreferences';
import { formatTime } from '../utils/fasting';

export interface FastingZoneBarProps {
  hoursFasted: number;
  showTitle?: boolean;
  startTime?: string | Date;
  targetEndTime?: string | Date;
}

export const FASTING_ZONES = [
  {
    key: 'anabolic',
    name: 'Anabolic',
    start: 0,
    end: 4,
    color: '#3B82F6',
    description: '',
    rangeLabel: '0–4h',
  },
  {
    key: 'catabolic',
    name: 'Catabolic',
    start: 4,
    end: 16,
    color: '#F97316',
    description: '',
    rangeLabel: '4–16h',
  },
  {
    key: 'fat-burning',
    name: 'Fat Burning',
    start: 16,
    end: 24,
    color: '#EF4444',
    description: '',
    rangeLabel: '16–24h',
  },
  {
    key: 'ketosis',
    name: 'Ketosis',
    start: 24,
    end: 72,
    color: '#A855F7',
    description: '',
    rangeLabel: '24–72h',
  },
  {
    key: 'deep-ketosis',
    name: 'Deep Ketosis',
    start: 72,
    end: 1000,
    color: '#6366F1',
    description: '',
    rangeLabel: '72h+',
  },
];

export const FastingZoneBar: React.FC<FastingZoneBarProps> = ({
  hoursFasted,
  showTitle = true,
  startTime,
  targetEndTime,
}) => {
  const { t } = useTranslation();
  const { preferences } = usePreferences();
  const currentZoneIndex = FASTING_ZONES.findIndex((z) => hoursFasted < z.end);
  const activeIndex =
    currentZoneIndex === -1 ? FASTING_ZONES.length - 1 : currentZoneIndex;
  const activeZone = FASTING_ZONES[activeIndex];
  const localizedActiveName = localizeFastingStage(t, activeZone).name;

  const startTimeStr =
    startTime != null
      ? typeof startTime === 'string'
        ? startTime
        : startTime.toISOString()
      : undefined;
  const endTimeStr =
    targetEndTime != null
      ? typeof targetEndTime === 'string'
        ? targetEndTime
        : targetEndTime.toISOString()
      : undefined;

  return (
    <View className="w-full">
      {(startTimeStr || endTimeStr) && (
        <View className="flex-row justify-between items-center mb-1">
          {startTimeStr ? (
            <Text className="text-xs text-text-secondary font-medium">
              {t('fastingDetail.startedAt', {
                defaultValue: 'Started {{time}}',
                time: formatTime(startTimeStr, preferences?.time_format),
              })}
            </Text>
          ) : (
            <View />
          )}
          {endTimeStr ? (
            <Text className="text-xs text-text-secondary font-medium">
              {t('fastingDetail.targetAt', {
                defaultValue: 'Target {{time}}',
                time: formatTime(endTimeStr, preferences?.time_format),
              })}
            </Text>
          ) : (
            <View />
          )}
        </View>
      )}
      {showTitle && (
        <View className="flex-row justify-between items-center mb-1.5">
          <Text className="text-xs font-semibold uppercase text-text-muted tracking-wider">
            {t('fastingDetail.metabolicState', {
              defaultValue: 'Metabolic State',
            })}
          </Text>
          <Text
            className="text-xs font-bold"
            style={{ color: activeZone.color }}
          >
            {localizedActiveName}
          </Text>
        </View>
      )}
      <View className="w-full h-3.5 bg-border-subtle rounded-full overflow-hidden flex-row p-0.5">
        {FASTING_ZONES.map((zone, index) => {
          const isPassed = index < activeIndex;
          const isActive = index === activeIndex;
          const opacity = isPassed ? 1 : isActive ? 1 : 0.22;
          return (
            <View
              key={zone.key}
              style={{
                flex: 1,
                backgroundColor: zone.color,
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
      <View className="flex-row justify-between mt-1 px-0.5">
        <Text className="font-medium text-text-muted" style={{ fontSize: 10 }}>
          0{t('time.hoursShort', { defaultValue: 'h' })}
        </Text>
        <Text className="font-medium text-text-muted" style={{ fontSize: 10 }}>
          16{t('time.hoursShort', { defaultValue: 'h' })}
        </Text>
        <Text className="font-medium text-text-muted" style={{ fontSize: 10 }}>
          24{t('time.hoursShort', { defaultValue: 'h' })}
        </Text>
        <Text className="font-medium text-text-muted" style={{ fontSize: 10 }}>
          72{t('time.hoursShort', { defaultValue: 'h' })}+
        </Text>
      </View>
    </View>
  );
};
