import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SymptomScaleType } from '@workspace/shared';

interface SeveritySliderProps {
  scaleType: SymptomScaleType;
  value: number | null;
  onChange: (val: number | null) => void;
}

const NONE_SEVERE_LEVELS = [0, 1, 2, 3, 4] as const;

export default function SeveritySlider({
  scaleType,
  value,
  onChange,
}: SeveritySliderProps) {
  const { t } = useTranslation();

  const getNoneSevereLabel = (val: number) => {
    switch (val) {
      case 0:
        return t('symptoms.severity.none', { defaultValue: 'None' });
      case 1:
        return t('symptoms.severity.mild', { defaultValue: 'Mild' });
      case 2:
        return t('symptoms.severity.moderate', { defaultValue: 'Moderate' });
      case 3:
        return t('symptoms.severity.severe', { defaultValue: 'Severe' });
      case 4:
        return t('symptoms.severity.unbearable', {
          defaultValue: 'Unbearable',
        });
      default:
        return `${val}`;
    }
  };

  const getSeverityLabel = (val: number | null) => {
    if (val === null || val === undefined)
      return t('symptoms.severity.unset', { defaultValue: 'Not set' });
    if (scaleType === '1-5') {
      if (val <= 1)
        return t('symptoms.severity.mild', { defaultValue: 'Mild' });
      if (val === 2)
        return t('symptoms.severity.moderate', { defaultValue: 'Moderate' });
      if (val === 3)
        return t('symptoms.severity.substantial', {
          defaultValue: 'Substantial',
        });
      if (val === 4)
        return t('symptoms.severity.severe', { defaultValue: 'Severe' });
      return t('symptoms.severity.unbearable', { defaultValue: 'Unbearable' });
    }
    if (scaleType === 'none-severe') {
      return getNoneSevereLabel(val);
    }
    // 1-10 default
    if (val === 0) return t('symptoms.severity.none', { defaultValue: 'None' });
    if (val <= 3) return t('symptoms.severity.mild', { defaultValue: 'Mild' });
    if (val <= 6)
      return t('symptoms.severity.moderate', { defaultValue: 'Moderate' });
    if (val <= 8)
      return t('symptoms.severity.severe', { defaultValue: 'Severe' });
    return t('symptoms.severity.unbearable', { defaultValue: 'Unbearable' });
  };

  if (scaleType === 'none-severe') {
    return (
      <View className="space-y-2">
        <Text className="text-sm font-medium text-text-primary">
          {t('symptoms.severityTitle', { defaultValue: 'Severity' })}:{' '}
          {getSeverityLabel(value)}
        </Text>
        <View className="flex-row flex-wrap gap-1.5">
          {NONE_SEVERE_LEVELS.map((lvl) => (
            <TouchableOpacity
              key={lvl}
              onPress={() => onChange(value === lvl ? null : lvl)}
              className={`flex-1 min-w-[65px] py-2 px-1 rounded-lg items-center border ${
                value === lvl
                  ? 'bg-accent-primary border-accent-primary'
                  : 'bg-surface border-border'
              }`}
            >
              <Text
                className={`text-xs font-semibold ${
                  value === lvl ? 'text-white' : 'text-text-primary'
                }`}
              >
                {getNoneSevereLabel(lvl)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  const maxVal = scaleType === '1-5' ? 5 : 10;
  const minVal = scaleType === '1-5' ? 1 : 1;
  const stepCount = maxVal - minVal + 1;
  const numbers = Array.from({ length: stepCount }, (_, i) => minVal + i);

  return (
    <View className="space-y-3">
      <View className="flex-row justify-between items-center">
        <Text className="text-sm font-medium text-text-primary">
          {t('symptoms.severityTitle', { defaultValue: 'Severity' })}
        </Text>
        <Text className="text-sm font-bold text-accent-primary">
          {value != null
            ? `${value}/${maxVal} · ${getSeverityLabel(value)}`
            : getSeverityLabel(value)}
        </Text>
      </View>

      <View className="flex-row gap-1">
        {numbers.map((num) => {
          const isSelected = value === num;
          const isBelowOrEqual = value !== null && num <= value;
          return (
            <TouchableOpacity
              key={num}
              onPress={() => onChange(isSelected ? null : num)}
              className={`flex-1 py-3 rounded-md items-center justify-center border ${
                isSelected
                  ? 'bg-accent-primary border-accent-primary'
                  : isBelowOrEqual
                    ? 'bg-accent-primary/20 border-accent-primary/40'
                    : 'bg-surface border-border'
              }`}
            >
              <Text
                className={`text-xs font-bold ${
                  isSelected
                    ? 'text-white'
                    : isBelowOrEqual
                      ? 'text-accent-primary'
                      : 'text-text-muted'
                }`}
              >
                {num}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
