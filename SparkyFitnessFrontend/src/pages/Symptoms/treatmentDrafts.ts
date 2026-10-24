import type { TreatmentDraft } from '@workspace/shared';
import type { MedicationDetail } from '@/types/medications';

export const medicationDose = (m: MedicationDetail): string | null =>
  m.dose_amount != null && m.dose_unit
    ? `${m.dose_amount} ${m.dose_unit}`
    : null;

export const medicationDraft = (
  med: MedicationDetail,
  serial: number
): TreatmentDraft => ({
  key: `med-${med.id}-${serial}`,
  kind: 'medication',
  name: med.display_name || med.name,
  medicationId: med.id,
  dose: medicationDose(med),
  takenAt: new Date().toISOString(),
  effectiveness: null,
});
