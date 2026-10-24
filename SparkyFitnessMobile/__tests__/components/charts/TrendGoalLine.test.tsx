import React from 'react';
import { render, screen } from '@testing-library/react-native';
import type { ChartBounds, PointsArray, Scale } from 'victory-native';
import TrendGoalLine, {
  buildGoalLinePoints,
} from '../../../src/components/charts/TrendGoalLine';

// The global `@shopify/react-native-skia` mock in jest.setup.js renders `DashPathEffect`
// as `null`, so prop wiring on it could not be asserted against it. Stub it as an
// identifiable View carrying its props instead.
jest.mock('@shopify/react-native-skia', () => {
  const ReactModule: typeof import('react') = require('react');
  const { View }: typeof import('react-native') = require('react-native');
  return {
    DashPathEffect: (props: Record<string, unknown>) =>
      ReactModule.createElement(View, { testID: 'goal-line-dash', ...props }),
  };
});

// victory-native's own `Line` draws through a real Skia `Path`, which the global mock
// renders as `null` -- stub it as an identifiable View so this suite can assert its
// `points`/`curveType` props instead of rendering an actual path.
jest.mock('victory-native', () => {
  const ReactModule: typeof import('react') = require('react');
  const { View }: typeof import('react-native') = require('react-native');
  return {
    Line: ({ children, ...props }: Record<string, unknown>) =>
      ReactModule.createElement(
        View,
        { testID: 'goal-line', ...props },
        children
      ),
  };
});

const chartBounds: ChartBounds = { left: 10, right: 210, top: 5, bottom: 105 };

// A stand-in linear scale simple enough to hand-verify: yScale(v) = 100 - v.
const yScale = ((value: number) => 100 - value) as unknown as Scale;

const points: PointsArray = [
  { x: 20, xValue: '2026-06-01', y: 0, yValue: 0 },
  { x: 60, xValue: '2026-06-02', y: 0, yValue: 0 },
  { x: 100, xValue: '2026-06-03', y: 0, yValue: 0 },
  { x: 140, xValue: '2026-06-04', y: 0, yValue: 0 },
];

describe('buildGoalLinePoints', () => {
  it('returns null when every goal is null, undefined, zero, or negative', () => {
    expect(
      buildGoalLinePoints(points, [null, undefined, 0, -5], yScale, chartBounds)
    ).toBeNull();
  });

  it('steps to the resolved value on the day it changed', () => {
    const result = buildGoalLinePoints(
      points,
      [1800, 1800, 2000, 2000],
      yScale,
      chartBounds
    );

    expect(result).not.toBeNull();
    // Interior points (skip the two synthetic edge points).
    const interior = result!.slice(1, -1);
    expect(interior.map((point) => point.y)).toEqual([
      100 - 1800,
      100 - 1800,
      100 - 2000,
      100 - 2000,
    ]);
  });

  it('extends the line to the chart edges using the first and last resolved values', () => {
    const result = buildGoalLinePoints(
      points,
      [1800, 1800, 2000, 2000],
      yScale,
      chartBounds
    );

    expect(result![0]).toMatchObject({ x: chartBounds.left, y: 100 - 1800 });
    expect(result![result!.length - 1]).toMatchObject({
      x: chartBounds.right,
      y: 100 - 2000,
    });
  });

  it('skips a day whose goal did not resolve rather than breaking the line', () => {
    const result = buildGoalLinePoints(
      points,
      [1800, null, 2000, 2000],
      yScale,
      chartBounds
    );

    const interior = result!.slice(1, -1);
    expect(interior).toHaveLength(3);
    expect(interior.map((point) => point.x)).toEqual([20, 100, 140]);
  });
});

describe('TrendGoalLine', () => {
  it('renders a dashed stepped line through the resolved per-day goals', () => {
    render(
      <TrendGoalLine
        points={points}
        chartBounds={chartBounds}
        yScale={yScale}
        goals={[1800, 1800, 2000, 2000]}
        color="#94A3B8"
      />
    );

    const line = screen.getByTestId('goal-line');
    expect(line.props.curveType).toBe('stepAfter');
    expect(line.props.color).toBe('#94A3B8');
    expect(line.props.points[0]).toMatchObject({ y: 100 - 1800 });
    expect(line.props.points.at(-1)).toMatchObject({ y: 100 - 2000 });

    expect(screen.getByTestId('goal-line-dash')).toBeTruthy();
  });

  it.each([
    ['all null', [null, null, null, null]],
    ['all undefined', [undefined, undefined, undefined, undefined]],
    ['all zero', [0, 0, 0, 0]],
    ['all negative', [-5, -5, -5, -5]],
  ])('renders nothing when every goal is %s', (_label, goals) => {
    render(
      <TrendGoalLine
        points={points}
        chartBounds={chartBounds}
        yScale={yScale}
        goals={goals as (number | null | undefined)[]}
        color="#94A3B8"
      />
    );

    expect(screen.queryByTestId('goal-line')).toBeNull();
  });
});
