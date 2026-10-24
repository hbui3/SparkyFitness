import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePreferences } from '@/contexts/PreferencesContext';
import {
  compareDays,
  daysBetween,
  isDayString,
  todayInZone,
} from '@workspace/shared';

interface MuscleGroupRecoveryTrackerProps {
  recoveryData: {
    [muscleGroup: string]: string; // Maps muscle group to last workout YYYY-MM-DD
  } | null;
}

function recoveryAgeLabel(
  lastWorkoutDate: string,
  today: string
): { days: number | null; fallback: string } {
  if (!isDayString(lastWorkoutDate) || !isDayString(today)) {
    return { days: null, fallback: lastWorkoutDate };
  }
  return {
    days: daysBetween(lastWorkoutDate, today),
    fallback: lastWorkoutDate,
  };
}

const MuscleGroupRecoveryTracker = ({
  recoveryData,
}: MuscleGroupRecoveryTrackerProps) => {
  const { t } = useTranslation();
  const { timezone } = usePreferences();
  const today = todayInZone(timezone);

  if (!recoveryData || Object.keys(recoveryData).length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {t('muscleGroupRecovery.title', 'Muscle Group Recovery')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            {t(
              'muscleGroupRecovery.noRecoveryData',
              'No muscle group recovery data available.'
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  const sortedMuscleGroups = Object.entries(recoveryData).sort(
    ([, dateA], [, dateB]) => compareDays(dateB, dateA)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('muscleGroupRecovery.title', 'Muscle Group Recovery')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sortedMuscleGroups.map(([muscle, lastWorkoutDate]) => {
            const { days, fallback } = recoveryAgeLabel(lastWorkoutDate, today);
            const label =
              days === null
                ? fallback
                : days <= 0
                  ? t('muscleGroupRecovery.today', 'Today')
                  : days === 1
                    ? t('muscleGroupRecovery.yesterday', 'Yesterday')
                    : t('muscleGroupRecovery.daysAgo', `${days} days ago`, {
                        count: days,
                      });
            return (
              <div key={muscle} className="flex items-center justify-between">
                <span className="font-medium capitalize">
                  {t(`muscleGroups.${muscle.toLowerCase()}`, muscle)}
                </span>
                <span className="text-sm text-muted-foreground">{label}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default MuscleGroupRecoveryTracker;
