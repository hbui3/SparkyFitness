import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useCSSVariable } from 'uniwind';
import Icon from '../Icon';
import type { TreatmentEffectiveness } from '@workspace/shared';

export type MobileTreatmentEffectiveness = TreatmentEffectiveness | 'unknown';

export interface MobileTreatmentDraft {
  name_snapshot: string;
  kind: 'medication' | 'relief';
  effectiveness: MobileTreatmentEffectiveness;
  notes?: string | null;
}

interface TreatmentsSectionProps {
  treatments: MobileTreatmentDraft[];
  onChange: (treatments: MobileTreatmentDraft[]) => void;
}

const EFFECTIVENESS_OPTIONS: {
  value: MobileTreatmentEffectiveness;
  labelKey: string;
  defaultLabel: string;
}[] = [
  {
    value: 'full',
    labelKey: 'symptoms.effectiveness.helped',
    defaultLabel: 'Helped',
  },
  {
    value: 'partial',
    labelKey: 'symptoms.effectiveness.partly',
    defaultLabel: 'Partly',
  },
  {
    value: 'none',
    labelKey: 'symptoms.effectiveness.didntHelp',
    defaultLabel: "Didn't help",
  },
  {
    value: 'unknown',
    labelKey: 'symptoms.effectiveness.unknown',
    defaultLabel: 'Unsure',
  },
];

export default function TreatmentsSection({
  treatments,
  onChange,
}: TreatmentsSectionProps) {
  const { t } = useTranslation();
  const [textMuted] = useCSSVariable(['--color-text-muted']) as [string];
  const [newTreatmentName, setNewTreatmentName] = useState('');
  const [newTreatmentKind, setNewTreatmentKind] = useState<
    'medication' | 'relief'
  >('relief');

  const handleAdd = () => {
    if (!newTreatmentName.trim()) return;
    const updated = [
      ...treatments,
      {
        name_snapshot: newTreatmentName.trim(),
        kind: newTreatmentKind,
        effectiveness: 'unknown' as MobileTreatmentEffectiveness,
      },
    ];
    onChange(updated);
    setNewTreatmentName('');
  };

  const handleRemove = (index: number) => {
    onChange(treatments.filter((_, i) => i !== index));
  };

  const handleUpdateEffectiveness = (
    index: number,
    eff: MobileTreatmentEffectiveness
  ) => {
    const updated = treatments.map((item, i) =>
      i === index ? { ...item, effectiveness: eff } : item
    );
    onChange(updated);
  };

  const renderEffectivenessLabel = (eff: MobileTreatmentEffectiveness) => {
    switch (eff) {
      case 'full':
        return t('symptoms.effectiveness.helped', { defaultValue: 'Helped' });
      case 'partial':
        return t('symptoms.effectiveness.partly', { defaultValue: 'Partly' });
      case 'none':
        return t('symptoms.effectiveness.didntHelp', {
          defaultValue: "Didn't help",
        });
      case 'unknown':
        return t('symptoms.effectiveness.unknown', { defaultValue: 'Unsure' });
    }
  };

  return (
    <View className="space-y-3">
      {/* Existing treatments */}
      {treatments.map((treatment, idx) => (
        <View
          key={idx}
          className="bg-surface border border-border p-3 rounded-xl space-y-2"
        >
          <View className="flex-row justify-between items-center">
            <View className="flex-row items-center space-x-2 flex-1">
              <Icon
                name={
                  treatment.kind === 'medication' ? 'medication' : 'wellness'
                }
                size={16}
                color={treatment.kind === 'medication' ? '#3b82f6' : '#10b981'}
              />
              <Text className="text-sm font-semibold text-text-primary flex-1">
                {treatment.name_snapshot}
              </Text>
            </View>
            <TouchableOpacity onPress={() => handleRemove(idx)} className="p-1">
              <Icon name="close" size={16} color="#ef4444" />
            </TouchableOpacity>
          </View>

          {/* Effectiveness selector */}
          <View className="flex-row gap-1 pt-1">
            {EFFECTIVENESS_OPTIONS.map((opt) => {
              const isSelected = treatment.effectiveness === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => handleUpdateEffectiveness(idx, opt.value)}
                  className={`flex-1 py-1.5 px-1 rounded-lg items-center border ${
                    isSelected
                      ? opt.value === 'full'
                        ? 'bg-emerald-600 border-emerald-600'
                        : opt.value === 'partial'
                          ? 'bg-amber-600 border-amber-600'
                          : opt.value === 'none'
                            ? 'bg-rose-600 border-rose-600'
                            : 'bg-accent-primary border-accent-primary'
                      : 'bg-background border-border'
                  }`}
                >
                  <Text
                    className={`text-[10px] font-bold ${
                      isSelected ? 'text-white' : 'text-text-muted'
                    }`}
                  >
                    {renderEffectivenessLabel(opt.value)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      {/* Add new treatment input */}
      <View className="bg-surface/50 border border-border p-3 rounded-xl space-y-2">
        <View className="flex-row items-center space-x-2">
          <TextInput
            placeholder={t('symptoms.addTreatmentPlaceholder', {
              defaultValue: 'Add medicine or relief method...',
            })}
            placeholderTextColor={textMuted || '#94a3b8'}
            value={newTreatmentName}
            onChangeText={setNewTreatmentName}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-text-primary"
          />
          <TouchableOpacity
            onPress={handleAdd}
            disabled={!newTreatmentName.trim()}
            className={`px-3 py-2 rounded-lg items-center justify-center ${
              newTreatmentName.trim()
                ? 'bg-accent-primary'
                : 'bg-raised opacity-50'
            }`}
          >
            <Icon name="add" size={18} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* Kind Toggle */}
        <View className="flex-row space-x-2">
          <TouchableOpacity
            onPress={() => setNewTreatmentKind('relief')}
            className={`px-3 py-1 rounded-full border ${
              newTreatmentKind === 'relief'
                ? 'bg-emerald-600/20 border-emerald-500'
                : 'bg-transparent border-border'
            }`}
          >
            <Text
              className={`text-xs ${
                newTreatmentKind === 'relief'
                  ? 'text-emerald-500 font-semibold'
                  : 'text-text-muted'
              }`}
            >
              {t('symptoms.kinds.relief', {
                defaultValue: 'Relief / Non-drug',
              })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setNewTreatmentKind('medication')}
            className={`px-3 py-1 rounded-full border ${
              newTreatmentKind === 'medication'
                ? 'bg-accent-primary/20 border-accent-primary'
                : 'bg-transparent border-border'
            }`}
          >
            <Text
              className={`text-xs ${
                newTreatmentKind === 'medication'
                  ? 'text-accent-primary font-semibold'
                  : 'text-text-muted'
              }`}
            >
              {t('symptoms.kinds.medication', { defaultValue: 'Medication' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
