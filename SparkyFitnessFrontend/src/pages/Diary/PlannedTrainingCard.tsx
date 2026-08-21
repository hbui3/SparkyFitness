import { CalendarCheck2, Dumbbell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useTrainingTimeline } from '@/hooks/Exercises/useWorkoutPlans';

interface PlannedTrainingCardProps {
  selectedDate: string;
}

const PlannedTrainingCard = ({ selectedDate }: PlannedTrainingCardProps) => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { data, isLoading } = useTrainingTimeline(user?.id, {
    startDate: selectedDate,
    endDate: selectedDate,
  });
  const day = data?.days.find((summary) => summary.date === selectedDate);
  const plannedNames = day?.scheduledNames ?? [];
  const completedNames = day?.completedNames ?? [];
  const progress = day
    ? day.scheduledSetCount > 0
      ? Math.round(
          (day.completedScheduledSetCount / day.scheduledSetCount) * 100
        )
      : day.scheduledWorkoutCount > 0
        ? Math.round(
            (day.completedScheduledWorkoutCount / day.scheduledWorkoutCount) *
              100
          )
        : day.completedWorkoutCount > 0
          ? 100
          : 0
    : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck2 className="h-4 w-4" />
            {t('diary.plannedTraining', 'Planned training')}
          </CardTitle>
          {day && (
            <Badge variant="outline">
              {t(`trainingTimeline.status.${day.status}`, day.status)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t('common.loading', 'Loading...')}
          </p>
        ) : !day ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {t(
                'diary.noTrainingPlanned',
                'No workout is planned for this day.'
              )}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/exercises">
                {t('diary.openTrainingCalendar', 'Open training calendar')}
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {(plannedNames.length > 0
                    ? plannedNames
                    : completedNames
                  ).join(', ')}
                </p>
                {day.sources.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('common.source', 'Source')}: {day.sources.join(', ')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 text-lg font-bold">
                <Dumbbell className="h-5 w-5 text-muted-foreground" />
                {progress}%
              </div>
            </div>
            {day.scheduledWorkoutCount > 0 && (
              <>
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  aria-label={t('diary.trainingProgress', 'Training progress')}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-muted/50 p-2">
                    <div className="font-semibold">
                      {day.completedScheduledWorkoutCount} /{' '}
                      {day.scheduledWorkoutCount}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('trainingCalendar.workouts', 'Workouts')}
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <div className="font-semibold">
                      {day.completedScheduledExerciseCount} /{' '}
                      {day.scheduledExerciseCount}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('trainingCalendar.exercises', 'Exercises')}
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <div className="font-semibold">
                      {day.completedScheduledSetCount} / {day.scheduledSetCount}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('trainingCalendar.sets', 'Sets')}
                    </div>
                  </div>
                </div>
              </>
            )}
            {day.scheduledWorkoutCount === 0 &&
              day.completedWorkoutCount > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('diary.unplannedTrainingCompleted', {
                    count: day.completedWorkoutCount,
                    defaultValue:
                      '{{count}} completed workout was not part of the schedule.',
                  })}
                </p>
              )}
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm">
                <Link to="/exercises">
                  {t('diary.openTrainingCalendar', 'Open training calendar')}
                </Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default PlannedTrainingCard;
