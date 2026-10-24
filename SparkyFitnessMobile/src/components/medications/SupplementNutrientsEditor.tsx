import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { MACRO_PICKER_FIELDS, MULTIVITAMIN_PANEL_IDS } from '@workspace/shared';
import BottomSheetPicker, { type PickerSection } from '../BottomSheetPicker';
import FormInput from '../FormInput';
import Icon from '../Icon';
import {
  addRows,
  macroRow,
  pickerCatalogEntries,
  rowsForCatalogId,
  type NutrientRow,
} from '../../utils/supplements';

interface SupplementNutrientsEditorProps {
  rows: NutrientRow[];
  onChange: (rows: NutrientRow[]) => void;
}

/**
 * The nutrients in one serving of a supplement: a row per nutrient with its
 * amount, a picker for more, and a preset for a standard multivitamin.
 */
const SupplementNutrientsEditor: React.FC<SupplementNutrientsEditorProps> = ({
  rows,
  onChange,
}) => {
  const { t } = useTranslation();
  const [accent, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
  ]) as [string, string];

  const sections = useMemo<PickerSection<string>[]>(() => {
    const taken = new Set(rows.map((row) => row.id));
    const macros = MACRO_PICKER_FIELDS.filter(
      (field) => !taken.has(`fixed:${field.fieldKey}`)
    ).map((field) => ({
      label: `${field.displayName} (${field.unit})`,
      value: `macro:${field.fieldKey}`,
    }));
    const catalog = pickerCatalogEntries()
      .filter((entry) => {
        const parts = rowsForCatalogId(entry.id);
        return parts.some((part) => !taken.has(part.id));
      })
      .map((entry) => ({
        label: `${entry.displayName} (${entry.unit})`,
        value: `catalog:${entry.id}`,
      }));
    return [
      {
        title: t('medications.supplement.energyAndMacros', {
          defaultValue: 'Energy and macros',
        }),
        options: macros,
      },
      {
        title: t('medications.supplement.vitaminsAndMinerals', {
          defaultValue: 'Vitamins, minerals and more',
        }),
        options: catalog,
      },
    ].filter((section) => section.options.length > 0);
  }, [rows, t]);

  const handlePick = (value: string) => {
    const [kind, key] = value.split(':');
    if (kind === 'macro') {
      const field = MACRO_PICKER_FIELDS.find((f) => f.fieldKey === key);
      if (field) onChange(addRows(rows, [macroRow(field)]));
      return;
    }
    onChange(addRows(rows, rowsForCatalogId(key)));
  };

  const addMultivitaminPanel = () =>
    onChange(addRows(rows, MULTIVITAMIN_PANEL_IDS.flatMap(rowsForCatalogId)));

  const setValue = (id: string, value: string) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, value } : row)));

  const remove = (id: string) => onChange(rows.filter((row) => row.id !== id));

  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-text-primary text-base font-medium">
          {t('medications.supplement.nutritionTitle', {
            defaultValue: 'Nutrition per serving',
          })}
        </Text>
        <Text className="text-text-muted text-sm">
          {t('medications.supplement.nutritionHint', {
            defaultValue:
              'Enter the amounts from the label for one serving. Each dose you log adds them to your day.',
          })}
        </Text>
      </View>

      {rows.map((row) => (
        <View key={row.id} className="flex-row items-center gap-2">
          <Text
            className="text-text-primary text-base flex-1"
            numberOfLines={2}
          >
            {row.label}
          </Text>
          <FormInput
            className="w-24 bg-raised border border-border-subtle px-3 py-2 text-right"
            placeholder="0"
            value={row.value}
            onChangeText={(v) => setValue(row.id, v)}
            keyboardType="decimal-pad"
            accessibilityLabel={t('medications.supplement.amountA11y', {
              defaultValue: '{{name}} amount in {{unit}}',
              name: row.label,
              unit: row.unit,
            })}
          />
          <Text className="text-text-secondary text-sm w-9">{row.unit}</Text>
          <TouchableOpacity
            onPress={() => remove(row.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('medications.supplement.removeNutrient', {
              defaultValue: 'Remove {{name}}',
              name: row.label,
            })}
          >
            <Icon name="close" size={16} color={textMuted} />
          </TouchableOpacity>
        </View>
      ))}

      <View className="flex-row gap-4 items-center">
        {sections.length > 0 && (
          <BottomSheetPicker<string>
            value=""
            sections={sections}
            onSelect={handlePick}
            title={t('medications.supplement.addNutrient', {
              defaultValue: 'Add nutrient',
            })}
            renderTrigger={({ onPress }) => (
              <TouchableOpacity
                onPress={onPress}
                activeOpacity={0.7}
                accessibilityRole="button"
                className="flex-row items-center gap-1 py-1"
              >
                <Icon name="add-circle" size={18} color={accent} />
                <Text className="text-accent-primary text-base font-medium">
                  {t('medications.supplement.addNutrient', {
                    defaultValue: 'Add nutrient',
                  })}
                </Text>
              </TouchableOpacity>
            )}
          />
        )}
        <TouchableOpacity
          onPress={addMultivitaminPanel}
          activeOpacity={0.7}
          accessibilityRole="button"
          className="py-1"
        >
          <Text className="text-accent-primary text-base font-medium">
            {t('medications.supplement.multivitaminPanel', {
              defaultValue: 'Multivitamin panel',
            })}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default SupplementNutrientsEditor;
