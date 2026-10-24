import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { usePreferences } from '@/contexts/PreferencesContext';
import { formatSecondsClock } from '@/utils/timeFormatters';
import WorkoutFeedbackPanel from './WorkoutFeedbackPanel';

export interface WorkoutFinishSummary {
  name: string;
  durationSeconds: number;
  /** Server-computed total for the saved session, in kcal. */
  caloriesKcal: number;
  completedSets: number;
  totalSets: number;
  volume: number;
  /** The saved session, for end-of-workout feedback (#1560). */
  sessionId?: string;
  exercises?: { id: string; name: string }[];
}

interface WorkoutPlaybackFinishDialogProps {
  summary: WorkoutFinishSummary | null;
  onClose: () => void;
}

/**
 * Shown once a workout has saved (#1507 step 6): how long it took and what it
 * burned, before returning to the diary.
 */
export default function WorkoutPlaybackFinishDialog({
  summary,
  onClose,
}: WorkoutPlaybackFinishDialogProps) {
  const { t } = useTranslation();
  const { energyUnit, convertEnergy, getEnergyUnitString } = usePreferences();

  const calories = summary
    ? Math.round(convertEnergy(summary.caloriesKcal, 'kcal', energyUnit))
    : 0;

  const tiles = summary
    ? [
        {
          label: t('exercise.workoutFinishSummary.duration', 'Duration'),
          value: formatSecondsClock(summary.durationSeconds),
        },
        {
          label: t('exercise.workoutFinishSummary.calories', 'Calories'),
          value: `${calories} ${getEnergyUnitString(energyUnit)}`,
        },
        {
          label: t('exercise.workoutFinishSummary.sets', 'Sets'),
          value: `${summary.completedSets}/${summary.totalSets}`,
        },
        {
          label: t('exercise.workoutFinishSummary.volume', 'Volume'),
          value: `${Number(summary.volume.toFixed(1))}`,
        },
      ]
    : [];

  return (
    <Dialog
      open={summary != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader className="items-center text-center">
          <Trophy className="h-8 w-8 text-amber-500" />
          <DialogTitle>
            {t('exercise.workoutFinishSummary.title', 'Workout complete')}
          </DialogTitle>
          <DialogDescription>{summary?.name}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className="rounded-lg border bg-muted/40 p-3 text-center"
            >
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {tile.label}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {tile.value}
              </div>
            </div>
          ))}
        </div>
        {summary?.sessionId && (
          <WorkoutFeedbackPanel
            presetEntryId={summary.sessionId}
            exercises={summary.exercises ?? []}
          />
        )}
        <DialogFooter>
          <Button type="button" className="w-full" onClick={onClose}>
            {t('exercise.workoutFinishSummary.done', 'Done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
