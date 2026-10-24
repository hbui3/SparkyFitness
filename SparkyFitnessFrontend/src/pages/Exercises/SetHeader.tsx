import {
  Repeat,
  Dumbbell,
  Hourglass,
  Timer,
  Activity,
  Ruler,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SET_TABLE_LAYOUT, type SetTableModality } from '@/constants/exercises';
import { usePreferences } from '@/contexts/PreferencesContext';
import { carryDistanceUnitLabel } from '@workspace/shared';

interface SetColumnHeadersProps {
  modality: SetTableModality;
  /** Diary entries record RIR; presets don't, so they leave this off. */
  showRir?: boolean;
}

export const SetColumnHeaders = ({
  modality,
  showRir = false,
}: SetColumnHeadersProps) => {
  const { t } = useTranslation();
  const { distanceUnit } = usePreferences();
  const cell =
    'text-[10px] font-bold uppercase text-muted-foreground tracking-wide flex items-center gap-1';
  const layout = SET_TABLE_LAYOUT[modality];
  const { showReps, showWeight, showDistance, signedWeight } = layout;
  const gridClass = showRir ? layout.gridClassWithRir : layout.gridClass;

  return (
    <div className="flex items-center gap-2 px-1 mb-0.5">
      {/* spacer for grip handle */}
      <div className="w-4 shrink-0" />
      <div className={gridClass}>
        <div className={cell}>#</div>
        <div className={cell}>{t('workout.type', 'Type')}</div>
        {showReps && (
          <div className={cell}>
            <Repeat className="h-3 w-3 mr-1 text-blue-500" />
            {t('workout.reps', 'Reps')}
          </div>
        )}
        {showDistance && (
          <div className={cell}>
            <Ruler className="h-3 w-3 text-sky-500" />
            {t('workout.distanceUnit', {
              defaultValue: 'Distance ({{unit}})',
              unit: carryDistanceUnitLabel(distanceUnit),
            })}
          </div>
        )}
        {showWeight && (
          <div className={cell}>
            <Dumbbell className="h-3 w-3 text-red-500" />
            {signedWeight
              ? t('workout.addedWeight', '+/− weight')
              : t('workout.weight', 'weight')}
          </div>
        )}
        <div className={cell}>
          <Activity className="h-3 w-3 text-emerald-500" />
          {t('workout.rpe', 'RPE')}
        </div>
        {showRir && (
          <div className={cell}>
            <Activity className="h-3 w-3 text-teal-500" />
            {t('workout.rir', 'RIR')}
          </div>
        )}
        <div className={cell}>
          <Hourglass className="h-3 w-3 text-orange-500" />
          {t('workout.durationSec', 'Duration (s)')}
        </div>
        <div className={cell}>
          <Timer className="h-3 w-3 text-purple-500" />
          {t('workout.restSec', 'Rest (s)')}
        </div>
        {/* spacer for actions column */}
        <div />
      </div>
    </div>
  );
};
