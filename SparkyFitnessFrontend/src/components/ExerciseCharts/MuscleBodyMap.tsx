import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useBodyMapSvgQuery } from '@/hooks/Exercises/useExercises';
import { svgClassToSchemaName } from '@/constants/exercises';
import type { AdaptiveTrainingMuscleLoad } from '@workspace/shared';
import './MuscleBodyMap.css';

type MuscleBodyMapProps =
  | {
      variant: 'targets';
      primaryMuscles: string[];
      secondaryMuscles: string[];
    }
  | {
      variant: 'load';
      muscleLoad: AdaptiveTrainingMuscleLoad[];
    };

const SVG_MUSCLE_ALIASES: Record<string, string[]> = {
  abdominal: ['abdominals', 'abs', 'core'],
  obliques: ['abdominals', 'obliques', 'abs', 'core'],
  lowerback: ['lower back', 'back extensors'],
  quads: ['quadriceps', 'quads'],
  chest: ['chest', 'pecs'],
  shoulders: ['shoulders', 'front delts', 'side delts', 'rear delts'],
  traps: [
    'traps',
    'trapezius',
    'upper back',
    'middle back',
    'lats',
    'latissimus dorsi',
    'back',
  ],
};

const STATUS_PRIORITY: Record<AdaptiveTrainingMuscleLoad['status'], number> = {
  ready: 0,
  light: 1,
  moderate: 2,
  high: 3,
};

function muscleCandidates(svgClassName: string): string[] {
  return Array.from(
    new Set([
      svgClassToSchemaName[svgClassName] ?? svgClassName,
      svgClassName,
      ...(SVG_MUSCLE_ALIASES[svgClassName] ?? []),
    ])
  ).map((muscle) => muscle.toLowerCase());
}

export function MuscleBodyMap(props: MuscleBodyMapProps) {
  const { t } = useTranslation();
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const { data: svgContent } = useBodyMapSvgQuery();
  const loadByMuscle = useMemo(
    () =>
      props.variant === 'load'
        ? new Map(props.muscleLoad.map((item) => [item.muscle, item.status]))
        : new Map<string, AdaptiveTrainingMuscleLoad['status']>(),
    [props]
  );
  const primaryMuscles = useMemo(
    () =>
      new Set(
        props.variant === 'targets'
          ? props.primaryMuscles.map((muscle) => muscle.toLowerCase())
          : []
      ),
    [props]
  );
  const secondaryMuscles = useMemo(
    () =>
      new Set(
        props.variant === 'targets'
          ? props.secondaryMuscles.map((muscle) => muscle.toLowerCase())
          : []
      ),
    [props]
  );

  useEffect(() => {
    if (!svgContent || !svgContainerRef.current) return;
    const container = svgContainerRef.current;
    container.innerHTML = svgContent;
    const svgElement = container.querySelector('svg');
    if (!svgElement) return;
    svgElement.setAttribute('width', '100%');
    svgElement.style.maxWidth = '380px';
    svgElement.style.height = 'auto';
    for (const path of svgElement.querySelectorAll('path[class]')) {
      const svgClassName = path.getAttribute('class') ?? '';
      const candidates = muscleCandidates(svgClassName);
      path.classList.remove(
        'map-primary',
        'map-secondary',
        'map-ready',
        'map-light',
        'map-moderate',
        'map-high',
        'map-inactive'
      );
      if (props.variant === 'targets') {
        if (candidates.some((muscle) => primaryMuscles.has(muscle))) {
          path.classList.add('map-primary');
        } else if (candidates.some((muscle) => secondaryMuscles.has(muscle))) {
          path.classList.add('map-secondary');
        } else {
          path.classList.add('map-inactive');
        }
      } else {
        const status = candidates
          .map((muscle) => loadByMuscle.get(muscle))
          .filter(
            (value): value is AdaptiveTrainingMuscleLoad['status'] =>
              value !== undefined
          )
          .sort(
            (first, second) => STATUS_PRIORITY[second] - STATUS_PRIORITY[first]
          )[0];
        path.classList.add(status ? `map-${status}` : 'map-inactive');
      }
    }
  }, [
    loadByMuscle,
    primaryMuscles,
    props.variant,
    secondaryMuscles,
    svgContent,
  ]);

  return (
    <div className="muscle-body-map-wrap">
      <div ref={svgContainerRef} className="muscle-body-map" />
      {props.variant === 'targets' ? (
        <div className="muscle-map-legend">
          <Legend
            color="bg-rose-600"
            label={t('muscleMap.primary', 'Primary')}
          />
          <Legend
            color="bg-amber-500"
            label={t('muscleMap.secondary', 'Secondary')}
          />
          <Legend
            color="bg-slate-400"
            label={t('muscleMap.untargeted', 'Untargeted')}
          />
        </div>
      ) : (
        <div className="muscle-map-legend">
          <Legend
            color="bg-emerald-500"
            label={t('adaptiveTraining.ready', 'Ready')}
          />
          <Legend
            color="bg-yellow-400"
            label={t('adaptiveTraining.light', 'Light load')}
          />
          <Legend
            color="bg-orange-500"
            label={t('adaptiveTraining.moderate', 'Moderate')}
          />
          <Legend
            color="bg-rose-600"
            label={t('adaptiveTraining.high', 'High load')}
          />
          <Legend
            color="bg-slate-400"
            label={t('adaptiveTraining.noRecentData', 'No recent data')}
          />
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export default MuscleBodyMap;
