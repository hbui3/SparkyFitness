import { useActiveUser } from '@/contexts/ActiveUserContext';
import { useMedications } from '@/hooks/useMedications';
import type { MedicationDetail } from '@/types/medications';
import SymptomsHub from './SymptomsHub';

interface SymptomsPanelProps {
  selectedDate: string;
  onDateChange: (day: string) => void;
}

/**
 * The symptom tracker for pages that do not already load medications (Check-in
 * and the standalone Symptoms page). Medications are only requested when the
 * viewer may read them, so a delegate with just the symptoms permission does not
 * hit a forbidden request.
 */
export default function SymptomsPanel({
  selectedDate,
  onDateChange,
}: SymptomsPanelProps) {
  const { hasPermission } = useActiveUser();
  const canSeeMeds = hasPermission('can_manage_medications');
  const { data: meds = [] } = useMedications(
    { activeOnly: true },
    { enabled: canSeeMeds }
  );
  return (
    <SymptomsHub
      selectedDate={selectedDate}
      onDateChange={onDateChange}
      meds={meds as MedicationDetail[]}
    />
  );
}
