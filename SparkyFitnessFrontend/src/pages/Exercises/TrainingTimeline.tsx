import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Dumbbell,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TrainingTimelineItem } from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useTrainingTimeline } from '@/hooks/Exercises/useWorkoutPlans';

function statusVariant(status: TrainingTimelineItem['status']) {
  if (status === 'completed') return 'default' as const;
  if (status === 'missed') return 'destructive' as const;
  return 'secondary' as const;
}

const TrainingTimeline = () => {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useTrainingTimeline(user?.id);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(`${date}T12:00:00`));
  const weekday = (day: number) =>
    new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(
      new Date(2026, 7, 23 + day, 12)
    );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          {t('common.loading', 'Loading...')}
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl sm:text-2xl">
          <CalendarClock className="h-5 w-5" />
          {t('trainingTimeline.title', 'Training timeline')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t(
            'trainingTimeline.description',
            'Your active plan, completed training, missed sessions, and every upcoming workout in one chronology.'
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {data.activePlans.map((plan) => (
          <section key={plan.id} className="rounded-lg border p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{plan.name}</h3>
                {plan.description && (
                  <p className="text-sm text-muted-foreground">
                    {plan.description}
                  </p>
                )}
              </div>
              <Badge>{t('workoutPlansManager.activeStatus', 'Active')}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDate(plan.startDate)} –{' '}
              {plan.endDate
                ? formatDate(plan.endDate)
                : t('workoutPlansManager.ongoingStatus', 'Ongoing')}
            </p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {plan.assignments.map((assignment, index) => (
                <div
                  key={`${assignment.dayOfWeek}-${assignment.presetId}-${index}`}
                  className="rounded-md bg-muted/50 p-3 text-sm"
                >
                  <div className="font-medium">
                    {weekday(assignment.dayOfWeek)} · {assignment.workoutName}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('trainingTimeline.exactCounts', {
                      exercises: assignment.exerciseCount,
                      sets: assignment.totalSetCount,
                      warmups: assignment.warmupSetCount,
                      defaultValue:
                        '{{exercises}} exercises · {{sets}} sets · {{warmups}} warm-up sets',
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <section>
          <h3 className="mb-3 font-semibold">
            {t('trainingTimeline.chronology', 'Recent and upcoming training')}
          </h3>
          {data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'trainingTimeline.empty',
                'No training is available in this period.'
              )}
            </p>
          ) : (
            <div className="max-h-[42rem] space-y-2 overflow-y-auto pr-1">
              {data.items.map((item) => (
                <article
                  key={`${item.status}-${item.id}`}
                  className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    {item.status === 'completed' ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    ) : item.status === 'missed' ? (
                      <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                    ) : (
                      <Dumbbell className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.name}</span>
                        <Badge variant={statusVariant(item.status)}>
                          {t(
                            `trainingTimeline.status.${item.status}`,
                            item.status
                          )}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatDate(item.date)} · {item.source}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground sm:text-right">
                    <div>
                      {t('trainingTimeline.exactCounts', {
                        exercises: item.exerciseCount,
                        sets: item.totalSetCount,
                        warmups: item.warmupSetCount,
                        defaultValue:
                          '{{exercises}} exercises · {{sets}} sets · {{warmups}} warm-up sets',
                      })}
                    </div>
                    {item.warmupSetCount === 0 && item.totalSetCount > 0 && (
                      <div className="font-medium text-amber-700 dark:text-amber-400">
                        {t(
                          'trainingTimeline.noWarmups',
                          'No warm-up sets configured'
                        )}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
};

export default TrainingTimeline;
