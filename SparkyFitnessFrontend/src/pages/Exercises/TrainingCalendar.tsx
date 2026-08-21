import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TrainingDaySummary } from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useTrainingTimeline } from '@/hooks/Exercises/useWorkoutPlans';
import { cn } from '@/lib/utils';

function toDayString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromDayString(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1, 12);
}

function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function statusClass(status: TrainingDaySummary['status'] | undefined) {
  if (status === 'completed')
    return 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30';
  if (status === 'in_progress')
    return 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30';
  if (status === 'missed') return 'border-destructive/40 bg-destructive/5';
  if (status === 'planned')
    return 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30';
  return 'border-border bg-card';
}

const TrainingCalendar = () => {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const initialToday = useMemo(() => new Date(), []);
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(initialToday.getFullYear(), initialToday.getMonth(), 1, 12)
  );
  const [selectedDate, setSelectedDate] = useState(() =>
    toDayString(initialToday)
  );
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const monthStart = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth(),
    1,
    12
  );
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = addCalendarDays(monthStart, -mondayOffset);
  const calendarDays = Array.from({ length: 42 }, (_, index) =>
    addCalendarDays(gridStart, index)
  );
  const range = {
    startDate: toDayString(calendarDays[0]!),
    endDate: toDayString(calendarDays[41]!),
  };
  const { data, isLoading } = useTrainingTimeline(user?.id, range);
  const summaries = new Map(data?.days.map((day) => [day.date, day]) ?? []);
  const selectedSummary = summaries.get(selectedDate);
  const selectedItems =
    data?.items.filter((item) => item.date === selectedDate) ?? [];
  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(
      new Date(2026, 7, 17 + index, 12)
    )
  );
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(visibleMonth);
  const selectedLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(fromDayString(selectedDate));

  const changeMonth = (offset: number) => {
    const next = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth() + offset,
      1,
      12
    );
    setVisibleMonth(next);
    setSelectedDate(toDayString(next));
  };
  const selectToday = () => {
    const today = fromDayString(data?.today ?? toDayString(new Date()));
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1, 12));
    setSelectedDate(toDayString(today));
  };

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl sm:text-2xl">
              <CalendarDays className="h-5 w-5" />
              {t('trainingCalendar.title', 'Training calendar')}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                'trainingCalendar.description',
                'All planned and completed workouts in one calendar.'
              )}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={selectToday}>
              {t('common.today', 'Today')}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => changeMonth(-1)}
              aria-label={t('trainingCalendar.previousMonth', 'Previous month')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => changeMonth(1)}
              aria-label={t('trainingCalendar.nextMonth', 'Next month')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="text-center text-lg font-semibold capitalize">
          {monthLabel}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
          {weekdayLabels.map((label) => (
            <div key={label} className="py-1">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((date) => {
            const day = toDayString(date);
            const summary = summaries.get(day);
            const isCurrentMonth = date.getMonth() === visibleMonth.getMonth();
            const isSelected = day === selectedDate;
            const isToday = day === data?.today;
            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDate(day)}
                className={cn(
                  'min-h-20 rounded-md border p-1.5 text-left transition-colors hover:border-primary/60 sm:min-h-24 sm:p-2',
                  statusClass(summary?.status),
                  !isCurrentMonth && 'opacity-45',
                  isSelected && 'ring-2 ring-primary ring-offset-1',
                  isToday && 'font-bold'
                )}
              >
                <span
                  className={cn(
                    'inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs',
                    isToday && 'bg-primary text-primary-foreground'
                  )}
                >
                  {date.getDate()}
                </span>
                {summary && (
                  <div className="mt-1 space-y-0.5">
                    {[...summary.scheduledNames, ...summary.completedNames]
                      .filter(
                        (name, index, names) => names.indexOf(name) === index
                      )
                      .slice(0, 2)
                      .map((name) => (
                        <div
                          key={name}
                          className="truncate text-[10px] font-medium leading-tight sm:text-xs"
                          title={name}
                        >
                          {name}
                        </div>
                      ))}
                    {(summary.scheduledWorkoutCount > 1 ||
                      summary.completedWorkoutCount > 1) && (
                      <div className="text-[10px] text-muted-foreground">
                        {t('trainingCalendar.workoutCount', {
                          count: Math.max(
                            summary.scheduledWorkoutCount,
                            summary.completedWorkoutCount
                          ),
                          defaultValue: '{{count}} workouts',
                        })}
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t('common.loading', 'Loading...')}
          </p>
        ) : (
          <section className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold capitalize">{selectedLabel}</h3>
              {selectedSummary && (
                <Badge variant="outline">
                  {t(
                    `trainingTimeline.status.${selectedSummary.status}`,
                    selectedSummary.status
                  )}
                </Badge>
              )}
            </div>
            {!selectedSummary ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t(
                  'trainingCalendar.noTraining',
                  'No planned or completed workout on this day.'
                )}
              </p>
            ) : (
              <div className="mt-3 space-y-3 text-sm">
                {selectedSummary.scheduledWorkoutCount > 0 && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                      <span className="text-muted-foreground">
                        {t('trainingCalendar.workouts', 'Workouts')}:{' '}
                      </span>
                      {selectedSummary.completedScheduledWorkoutCount} /{' '}
                      {selectedSummary.scheduledWorkoutCount}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t('trainingCalendar.exercises', 'Exercises')}:{' '}
                      </span>
                      {selectedSummary.completedScheduledExerciseCount} /{' '}
                      {selectedSummary.scheduledExerciseCount}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t('trainingCalendar.sets', 'Sets')}:{' '}
                      </span>
                      {selectedSummary.completedScheduledSetCount} /{' '}
                      {selectedSummary.scheduledSetCount}
                    </div>
                  </div>
                )}
                {selectedItems.map((item) => (
                  <div
                    key={`${item.status}-${item.id}`}
                    className="rounded-md bg-muted/50 p-3"
                  >
                    <div className="font-medium">{item.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.source} ·{' '}
                      {t('trainingTimeline.exactCounts', {
                        exercises: item.exerciseCount,
                        sets: item.totalSetCount,
                        warmups: item.warmupSetCount,
                        defaultValue:
                          '{{exercises}} exercises · {{sets}} sets · {{warmups}} warm-up sets',
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {(['completed', 'in_progress', 'planned', 'missed'] as const).map(
            (status) => (
              <span key={status} className="flex items-center gap-1.5">
                <span
                  className={cn('h-3 w-3 rounded border', statusClass(status))}
                />
                {t(`trainingTimeline.status.${status}`, status)}
              </span>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default TrainingCalendar;
