import React from 'react';
import { DashPathEffect } from '@shopify/react-native-skia';
import { Line } from 'victory-native';
import type { ChartBounds, PointsArray, Scale } from 'victory-native';

type TrendGoalLineProps = {
  /** The same points array the chart's own data series was given, used only for its x
   * pixel positions -- one goal value is expected per point, same order. */
  points: PointsArray;
  chartBounds: ChartBounds;
  yScale: Scale;
  goals: (number | null | undefined)[];
  color: string;
};

const GOAL_LINE_STROKE_WIDTH = 1.5;
const GOAL_LINE_DASH_INTERVALS = [6, 4];

/**
 * Builds the dashed goal line's own point series from the chart's plotted points and a
 * resolved goal value per point: each plotted x position gets the goal that was in effect
 * for that day, stepping to a new value exactly where it changed. Returns `null` when no
 * day has a usable (positive) goal, matching `TrendGoalLine`'s "draw nothing" rule.
 *
 * Two synthetic points are added at the chart's left/right edges, holding the first and
 * last resolved values, so the line still reaches the plot's edges the way a flat
 * reference line always did instead of stopping at the first/last day's own x position.
 */
export const buildGoalLinePoints = (
  points: PointsArray,
  goals: (number | null | undefined)[],
  yScale: Scale,
  chartBounds: ChartBounds
): PointsArray | null => {
  const resolved = points
    .map((point, index) => ({ point, goal: goals[index] }))
    .filter(
      (entry): entry is { point: PointsArray[number]; goal: number } =>
        entry.goal != null && entry.goal > 0
    );

  if (resolved.length === 0) {
    return null;
  }

  const firstGoal = resolved[0].goal;
  const lastGoal = resolved[resolved.length - 1].goal;

  return [
    {
      x: chartBounds.left,
      y: yScale(firstGoal),
      xValue: '',
      yValue: firstGoal,
    },
    ...resolved.map(({ point, goal }) => ({
      x: point.x,
      y: yScale(goal),
      xValue: point.xValue,
      yValue: goal,
    })),
    { x: chartBounds.right, y: yScale(lastGoal), xValue: '', yValue: lastGoal },
  ];
};

/**
 * A dashed reference line across a `CartesianChart` plot, stepping to the resolved goal
 * for each plotted day -- shared by every trend chart that draws a user-set goal alongside
 * its plotted series. A caller with no per-day history (Weight) passes the same scalar
 * goal repeated once per point, which draws identically to the old flat line.
 */
const TrendGoalLine: React.FC<TrendGoalLineProps> = ({
  points,
  chartBounds,
  yScale,
  goals,
  color,
}) => {
  const goalPoints = buildGoalLinePoints(points, goals, yScale, chartBounds);

  if (goalPoints == null) {
    return null;
  }

  return (
    <Line
      points={goalPoints}
      curveType="stepAfter"
      color={color}
      strokeWidth={GOAL_LINE_STROKE_WIDTH}
    >
      <DashPathEffect intervals={GOAL_LINE_DASH_INTERVALS} />
    </Line>
  );
};

export default TrendGoalLine;
