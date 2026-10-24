import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useCSSVariable } from 'uniwind';
import { formatDose, type Medication } from '@workspace/shared';
import { countNutrients } from '../../utils/supplements';
import { localizedDescribeSchedules } from '../../utils/medicationScheduleLocalization';
import Icon from '../Icon';

interface MedicationRowProps {
  medication: Medication;
  onPress: () => void;
}

/** One medication in the user's regimen. */
const MedicationRow: React.FC<MedicationRowProps> = ({
  medication,
  onPress,
}) => {
  const { t } = useTranslation();
  const [iconDecorative] = useCSSVariable(['--color-icon-decorative']) as [
    string,
  ];
  const nutrientCount = medication.is_supplement
    ? countNutrients(medication.nutrients)
    : 0;
  const summary = [
    formatDose(medication),
    nutrientCount > 0
      ? t('medications.supplement.nutrientCount', {
          defaultValue: '{{count}} nutrients',
          defaultValue_one: '{{count}} nutrient',
          count: nutrientCount,
        })
      : null,
    localizedDescribeSchedules(t, medication.schedules ?? []),
  ]
    .filter((part) => part != null && part !== '')
    .join(' · ');

  return (
    <TouchableOpacity
      className="py-3 px-4 bg-surface flex-row items-center"
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={t('medications.card.medicationA11y', {
        defaultValue: '{{name}}{{summary}}',
        name: medication.name,
        summary: summary ? `, ${summary}` : '',
      })}
    >
      <View className="flex-1">
        <Text
          className={`text-base ${medication.is_active ? 'text-text-primary' : 'text-text-muted'}`}
          numberOfLines={1}
        >
          {medication.name}
        </Text>
        {summary !== '' && (
          <Text className="text-xs text-text-secondary mt-1" numberOfLines={1}>
            {summary}
          </Text>
        )}
      </View>
      <Icon name="chevron-forward" size={16} color={iconDecorative} />
    </TouchableOpacity>
  );
};

export default MedicationRow;
