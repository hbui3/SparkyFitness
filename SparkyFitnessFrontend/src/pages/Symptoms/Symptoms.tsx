import { useSearchParams } from 'react-router-dom';
import { todayInZone } from '@workspace/shared';
import DayNavigator from '@/components/DayNavigator';
import { usePreferences } from '@/contexts/PreferencesContext';
import SymptomsPanel from './SymptomsPanel';

/**
 * Symptoms on their own page. Owners reach symptoms from Check-in; this page is
 * for a family delegate who may track symptoms but has no Check-in access.
 */
export default function Symptoms() {
  const { timezone } = usePreferences();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedDate = searchParams.get('date') || todayInZone(timezone);
  const setDate = (day: string) =>
    setSearchParams((prev) => {
      prev.set('date', day);
      return prev;
    });

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <DayNavigator
          selectedDate={selectedDate}
          onDateChange={setDate}
          className="grid-cols-none mb-0 flex items-center gap-2"
        />
      </div>
      <SymptomsPanel selectedDate={selectedDate} onDateChange={setDate} />
    </div>
  );
}
