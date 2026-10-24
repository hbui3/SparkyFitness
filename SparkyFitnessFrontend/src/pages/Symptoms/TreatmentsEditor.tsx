import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import {
  TREATMENT_EFFECTIVENESS,
  type TreatmentEffectiveness,
  resolveOptionItems,
  reliefDraft,
  type TreatmentDraft,
} from '@workspace/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useCreateSymptomOptionMutation,
  useDeleteSymptomOptionMutation,
  useSymptomOptions,
} from '@/hooks/useSymptoms';
import { cn } from '@/lib/utils';
import type { MedicationDetail } from '@/types/medications';
import ChipPicker from './ChipPicker';
import { medicationDraft } from './treatmentDrafts';

interface TreatmentsEditorProps {
  value: TreatmentDraft[];
  onChange: (next: TreatmentDraft[]) => void;
  meds: MedicationDetail[];
}

const EFFECT_LABEL: Record<TreatmentEffectiveness, [string, string]> = {
  full: ['symptoms.treatments.helped', 'Helped'],
  partial: ['symptoms.treatments.partly', 'Partly'],
  none: ['symptoms.treatments.didnt', "Didn't help"],
};

/**
 * Medications and relief methods taken for an entry, each with a "did it help?"
 * choice. Controlled: the parent owns the list and saves it with the entry.
 */
export default function TreatmentsEditor({
  value,
  onChange,
  meds,
}: TreatmentsEditorProps) {
  const { t } = useTranslation();
  const { data: storedOptions = [] } = useSymptomOptions();
  const createOption = useCreateSymptomOptionMutation();
  const deleteOption = useDeleteSymptomOptionMutation();

  const hasRelief = (name: string) =>
    value.some((tr) => tr.kind === 'relief' && tr.name === name);

  const toggleRelief = (name: string) =>
    onChange(
      hasRelief(name)
        ? value.filter((tr) => !(tr.kind === 'relief' && tr.name === name))
        : [...value, reliefDraft(name, new Date())]
    );

  const setEffectiveness = (
    key: string,
    effectiveness: TreatmentEffectiveness | null
  ) =>
    onChange(
      value.map((tr) => (tr.key === key ? { ...tr, effectiveness } : tr))
    );

  return (
    <div className="flex flex-col gap-3">
      {meds.length > 0 && (
        <Select
          value=""
          onValueChange={(id) => {
            const med = meds.find((m) => m.id === id);
            if (med) onChange([...value, medicationDraft(med, value.length)]);
          }}
        >
          <SelectTrigger
            aria-label={t(
              'symptoms.treatments.addMedication',
              'Add a medication'
            )}
          >
            <SelectValue
              placeholder={t(
                'symptoms.treatments.addMedication',
                'Add a medication'
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {meds.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.display_name || m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <ChipPicker
        items={resolveOptionItems('relief', storedOptions)}
        selected={value
          .filter((tr) => tr.kind === 'relief')
          .map((tr) => tr.name)}
        onToggle={toggleRelief}
        onAddCustom={(label) =>
          createOption.mutate(
            { kind: 'relief', name: label },
            { onSuccess: () => toggleRelief(label) }
          )
        }
        onRemoveCustom={(id, label) =>
          deleteOption.mutate(id, {
            onSuccess: () =>
              onChange(
                value.filter(
                  (tr) => !(tr.kind === 'relief' && tr.name === label)
                )
              ),
          })
        }
      />
      {value.map((tr) => (
        <div
          key={tr.key}
          className="flex flex-col gap-2 rounded-lg border p-2.5"
        >
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">
              {tr.name}
              {tr.dose && (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  · {tr.dose}
                </span>
              )}
            </span>
            {tr.kind === 'medication' && (
              <button
                type="button"
                aria-label={t('symptoms.chips.remove', 'Remove {{name}}', {
                  name: tr.name,
                })}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onChange(value.filter((x) => x.key !== tr.key))}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div
            className="inline-flex rounded-lg bg-muted p-0.5"
            role="group"
            aria-label={t('symptoms.treatments.didItHelp', 'Did it help?')}
          >
            {TREATMENT_EFFECTIVENESS.map((level) => {
              const [key, fallback] = EFFECT_LABEL[level];
              return (
                <button
                  key={level}
                  type="button"
                  aria-pressed={tr.effectiveness === level}
                  onClick={() =>
                    setEffectiveness(
                      tr.key,
                      tr.effectiveness === level ? null : level
                    )
                  }
                  className={cn(
                    'flex-1 rounded-md px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    tr.effectiveness === level
                      ? 'bg-background font-semibold shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t(key, fallback)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
