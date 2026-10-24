import { Canvas, RoundedRect } from '@shopify/react-native-skia';
import type { RecordZone } from '@workspace/shared';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import {
  isPlottedSleepStage,
  laneForStageType,
  SLEEP_STAGE_LANES,
  type SleepStageEvent,
} from '../types/sleep';
import { usePreferences } from '../hooks/usePreferences';
import { formatClockTime } from '../utils/sleepDay';
import { localizeSleepStage } from '../utils/sleepLocalization';

/**
 * The stage vocabulary now lives in `types/sleep`, shared with the Dashboard sleep
 * timeline. Aliased to the hypnogram's original name because here the stages are
 * literally drawn as lanes.
 */

type HypnogramLane = (typeof SLEEP_STAGE_LANES)[number];

/**
 * A stage shorter than this would render as an invisible sliver or, at exactly zero
 * length, as a zero-width rect Skia refuses to draw. Clamping keeps every event visible
 * and guarantees callers never see a non-positive width.
 */
const MIN_SEGMENT_WIDTH = 1;

export interface HypnogramBounds {
  width: number;
}

export interface HypnogramSegment {
  x: number;
  width: number;
  lane: HypnogramLane;
  stageType: string;
}

interface TimedStage {
  startMs: number;
  endMs: number;
  stageType: string;
}

const toTimedStage = (stage: SleepStageEvent): TimedStage | null => {
  const startMs = new Date(stage.start_time).getTime();
  const endMs = new Date(stage.end_time).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return { startMs, endMs, stageType: stage.stage_type };
};

const NAMED_HYPNOGRAM_LANES = SLEEP_STAGE_LANES.filter(
  (lane) => lane !== 'other'
);

/**
 * Lays stage events out along a fixed-width timeline.
 *
 * Exported separately from the Skia rendering because Skia draws nothing assertable under
 * jsdom — this pure builder is the only part of the hypnogram that can be tested, so it
 * owns all of the arithmetic and none of the drawing.
 *
 * Envelope-only types (`in_bed`, `unknown`) are dropped: HealthKit writes a
 * bedtime→wake InBed sample that is not a sleep stage, and including it stretched the
 * axis across hours of gray "Other" while the scored stages bunched at wake.
 *
 * The window spans the earliest start to the latest end across the plotted events, so the
 * timeline always fills `bounds.width` exactly.
 */
export const buildHypnogramSegments = (
  stages: SleepStageEvent[],
  bounds: HypnogramBounds
): HypnogramSegment[] => {
  if (stages.length === 0 || bounds.width <= 0) return [];

  // Sorted defensively: the server already orders by `start_time`, but the builder must
  // not silently mislay a timeline if a caller ever hands it an unsorted array.
  const timedStages = stages
    .filter((stage) => isPlottedSleepStage(stage.stage_type))
    .map(toTimedStage)
    .filter((stage): stage is TimedStage => stage !== null)
    .sort((first, second) => first.startMs - second.startMs);

  if (timedStages.length === 0) return [];

  const windowStart = Math.min(...timedStages.map((stage) => stage.startMs));
  const windowEnd = Math.max(...timedStages.map((stage) => stage.endMs));
  const windowSpanMs = windowEnd - windowStart;

  // Every event collapsed to a single instant. There is no timeline to scale against, so
  // lay them out as minimum-width marks rather than dividing by zero.
  if (windowSpanMs <= 0) {
    return timedStages.map((stage) => ({
      x: 0,
      width: MIN_SEGMENT_WIDTH,
      lane: laneForStageType(stage.stageType),
      stageType: stage.stageType,
    }));
  }

  const pixelsPerMs = bounds.width / windowSpanMs;

  return timedStages.map((stage) => {
    const x = (stage.startMs - windowStart) * pixelsPerMs;
    const rawWidth = (stage.endMs - stage.startMs) * pixelsPerMs;
    return {
      x,
      width: Math.max(MIN_SEGMENT_WIDTH, rawWidth),
      lane: laneForStageType(stage.stageType),
      stageType: stage.stageType,
    };
  });
};

/**
 * Lanes drawn next to the chart. Named stages stay so an empty Deep lane still reads as
 * "no deep sleep"; Other only appears when a plotted event actually uses it.
 */
export const hypnogramLanesToShow = (
  stages: SleepStageEvent[]
): readonly HypnogramLane[] => {
  const showOther = stages.some(
    (stage) =>
      isPlottedSleepStage(stage.stage_type) &&
      laneForStageType(stage.stage_type) === 'other'
  );
  return showOther ? SLEEP_STAGE_LANES : NAMED_HYPNOGRAM_LANES;
};

/**
 * The instants the timeline spans, for the axis labels.
 *
 * Derived rather than read off `stages[0]` and `stages.at(-1)` so the labels stay correct
 * for the same unsorted input `buildHypnogramSegments` already defends against.
 */
export const getHypnogramWindow = (
  stages: SleepStageEvent[]
): { startMs: number; endMs: number } | null => {
  const timedStages = stages
    .filter((stage) => isPlottedSleepStage(stage.stage_type))
    .map(toTimedStage)
    .filter((stage): stage is TimedStage => stage !== null);
  if (timedStages.length === 0) return null;

  return {
    startMs: Math.min(...timedStages.map((stage) => stage.startMs)),
    endMs: Math.max(...timedStages.map((stage) => stage.endMs)),
  };
};

const LANE_HEIGHT = 22;
const LANE_GAP = 4;
const SEGMENT_RADIUS = 3;

/**
 * Drawn from the existing categorical palette rather than new `--color-sleep-*` tokens,
 * because `--color-cat-*` is already defined and tuned across Light, Dark, and AMOLED.
 */
const LANE_COLOR_VARIABLES: Record<HypnogramLane, string> = {
  awake: '--color-cat-orange',
  rem: '--color-cat-violet',
  light: '--color-cat-blue',
  deep: '--color-cat-teal',
  other: '--color-text-muted',
};

interface HypnogramProps {
  stages: SleepStageEvent[];
  /**
   * The wall clock the axis labels are read against — the session's recording zone, from
   * `resolveSleepZone`. Null renders them on the device's clock.
   */
  zone?: RecordZone | null;
}

/**
 * A stage timeline: time across, sleep depth down, one block per stage event.
 *
 * A thin shell over `buildHypnogramSegments` — this component measures the available
 * width, picks theme colours, and draws. It contains no layout arithmetic.
 */
const Hypnogram: React.FC<HypnogramProps> = ({ stages, zone }) => {
  const { t } = useTranslation();
  const { preferences } = usePreferences();
  const [chartWidth, setChartWidth] = useState(0);

  const visibleLanes = useMemo(() => hypnogramLanesToShow(stages), [stages]);
  const chartHeight = visibleLanes.length * (LANE_HEIGHT + LANE_GAP);

  const laneColors = useCSSVariable(
    visibleLanes.map((lane) => LANE_COLOR_VARIABLES[lane])
  ) as string[];

  const segments = useMemo(
    () => buildHypnogramSegments(stages, { width: chartWidth }),
    [stages, chartWidth]
  );

  const hasPlottedStages = stages.some((stage) =>
    isPlottedSleepStage(stage.stage_type)
  );

  if (!hasPlottedStages) {
    return (
      <View
        testID="hypnogram-empty"
        className="bg-surface rounded-xl p-4 mb-3 shadow-sm"
      >
        <Text className="text-base font-semibold text-text-primary mb-2">
          {t('sleep.hypnogram', { defaultValue: 'Sleep Stages' })}
        </Text>
        <Text className="text-sm text-text-muted">
          {t('sleep.hypnogramEmpty', {
            defaultValue: 'This source did not record sleep stages.',
          })}
        </Text>
      </View>
    );
  }

  const window = getHypnogramWindow(stages);

  return (
    <View
      testID="hypnogram"
      className="bg-surface rounded-xl p-4 mb-3 shadow-sm"
    >
      <Text className="text-base font-semibold text-text-primary mb-2">
        {t('sleep.hypnogram', { defaultValue: 'Sleep Stages' })}
      </Text>

      <View className="flex-row">
        <View style={{ height: chartHeight }} className="justify-around mr-2">
          {visibleLanes.map((lane) => (
            <Text
              key={lane}
              className="text-xs text-text-muted"
              style={{ height: LANE_HEIGHT }}
            >
              {localizeSleepStage(t, lane)}
            </Text>
          ))}
        </View>

        <View
          className="flex-1"
          style={{ height: chartHeight }}
          onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
        >
          <Canvas style={{ flex: 1 }}>
            {segments.map((segment, index) => {
              const laneIndex = visibleLanes.indexOf(segment.lane);
              return (
                <RoundedRect
                  key={`${segment.stageType}-${index}`}
                  x={segment.x}
                  y={laneIndex * (LANE_HEIGHT + LANE_GAP)}
                  width={segment.width}
                  height={LANE_HEIGHT}
                  r={SEGMENT_RADIUS}
                  color={laneColors[laneIndex]}
                />
              );
            })}
          </Canvas>
        </View>
      </View>

      {window ? (
        <View className="flex-row justify-between mt-1">
          <Text className="text-xs text-text-muted">
            {formatClockTime(
              new Date(window.startMs).toISOString(),
              preferences?.time_format,
              zone
            )}
          </Text>
          <Text className="text-xs text-text-muted">
            {formatClockTime(
              new Date(window.endMs).toISOString(),
              preferences?.time_format,
              zone
            )}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

export default Hypnogram;
