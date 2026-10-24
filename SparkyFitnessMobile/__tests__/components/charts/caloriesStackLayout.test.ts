import {
  buildCaloriesStackDays,
  buildCaloriesBarLayout,
  buildCaloriesGoalSegments,
  resolveEffectiveMaxCalories,
  type CaloriesStackDay,
} from '../../../src/components/charts/caloriesStackLayout';
import type { CaloriesDataPoint } from '../../../src/types/healthTrends';

const point = (overrides: Partial<CaloriesDataPoint>): CaloriesDataPoint => ({
  day: '2026-09-20',
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  ...overrides,
});

describe('buildCaloriesStackDays', () => {
  test('splits a day into protein/carbs/fat segments in the fixed carbs/fat/protein order', () => {
    // protein 20g*4=80, carbs 50g*4=200, fat 10g*9=90 -> 370, matching logged calories.
    const [day] = buildCaloriesStackDays([
      point({ protein: 20, carbs: 50, fat: 10, calories: 370 }),
    ]);

    expect(day.totalCalories).toBe(370);
    expect(day.segments).toEqual([
      { macro: 'carbs', calories: 200 },
      { macro: 'fat', calories: 90 },
      { macro: 'protein', calories: 80 },
    ]);
  });

  test('keeps the fixed carbs/fat/protein order regardless of which macro is largest', () => {
    const [day] = buildCaloriesStackDays([
      point({ protein: 100, carbs: 10, fat: 5, calories: 485 }),
    ]);

    expect(day.segments.map((segment) => segment.macro)).toEqual([
      'carbs',
      'fat',
      'protein',
    ]);
  });

  test('omits a macro with no calories rather than drawing a zero-height segment', () => {
    const [day] = buildCaloriesStackDays([
      point({ protein: 10, calories: 40 }),
    ]);

    expect(day.segments).toEqual([{ macro: 'protein', calories: 40 }]);
  });

  test("adds an `other` segment for calories the macros don't account for, at their true size", () => {
    // Macro grams only account for 200 kcal (protein 10g*4=40, carbs 40g*4=160), but the day
    // logged 300 -- e.g. alcohol, which this chart doesn't track by macro. The macro segments
    // keep their true gram-derived size; the other 100 kcal gets its own segment rather than
    // inflating carbs/protein to cover it.
    const [day] = buildCaloriesStackDays([
      point({ protein: 10, carbs: 40, calories: 300 }),
    ]);

    expect(day.totalCalories).toBe(300);
    expect(day.segments).toEqual([
      { macro: 'carbs', calories: 160 },
      { macro: 'protein', calories: 40 },
      { macro: 'other', calories: 100 },
    ]);
  });

  test('draws a single neutral `other` segment for calories logged with no macros', () => {
    const [day] = buildCaloriesStackDays([point({ calories: 120 })]);

    expect(day.totalCalories).toBe(120);
    expect(day.segments).toEqual([{ macro: 'other', calories: 120 }]);
  });

  test('draws no segments for a zero-calorie day', () => {
    const [day] = buildCaloriesStackDays([point({})]);

    expect(day.totalCalories).toBe(0);
    expect(day.segments).toEqual([]);
  });

  test('scales macro segments down when they overshoot the logged total', () => {
    // carbs 40g*4 = 160 kcal, but the day only logged 100 -- e.g. a manual calorie
    // override, since macro grams are stored independently of the total. Scale down by
    // 100/160 = 0.625 rather than drawing a bar (and a tooltip percentage) past 100%.
    const [day] = buildCaloriesStackDays([point({ carbs: 40, calories: 100 })]);

    expect(day.totalCalories).toBe(100);
    expect(day.segments).toEqual([{ macro: 'carbs', calories: 100 }]);
    const segmentSum = day.segments.reduce((sum, s) => sum + s.calories, 0);
    expect(segmentSum).toBe(day.totalCalories);
  });

  test('scales every macro down proportionally on an overshoot, not just one', () => {
    // protein 30g*4=120, carbs 20g*4=80 -> 200 kcal of macros, but only 150 logged.
    // Scale = 150/200 = 0.75, applied to both segments so their ratio is unchanged.
    const [day] = buildCaloriesStackDays([
      point({ protein: 30, carbs: 20, calories: 150 }),
    ]);

    expect(day.segments).toEqual([
      { macro: 'carbs', calories: 60 },
      { macro: 'protein', calories: 90 },
    ]);
    const segmentSum = day.segments.reduce((sum, s) => sum + s.calories, 0);
    expect(segmentSum).toBe(day.totalCalories);
  });
});

describe('buildCaloriesBarLayout', () => {
  const days: CaloriesStackDay[] = [
    {
      day: '2026-09-19',
      totalCalories: 100,
      segments: [{ macro: 'protein', calories: 100 }],
    },
    {
      day: '2026-09-20',
      totalCalories: 50,
      segments: [{ macro: 'protein', calories: 50 }],
    },
  ];

  test('places one evenly spaced column per day', () => {
    const columns = buildCaloriesBarLayout(days, {
      width: 100,
      height: 50,
      innerPadding: 0.2,
      maxCalories: 100,
    });

    expect(columns).toHaveLength(2);
    expect(columns[0]).toMatchObject({ dayIndex: 0, x: 5, width: 40 });
    expect(columns[1]).toMatchObject({ dayIndex: 1, x: 55, width: 40 });
  });

  test('sizes a column proportional to its share of maxCalories', () => {
    const columns = buildCaloriesBarLayout(days, {
      width: 100,
      height: 50,
      innerPadding: 0.2,
      maxCalories: 100,
    });

    // Day 1 fills the whole plot height; day 2 (half the calories) fills half of it.
    expect(columns[0].blocks[0]).toEqual({
      y: 0,
      height: 50,
      macro: 'protein',
    });
    expect(columns[1].blocks[0]).toEqual({
      y: 25,
      height: 25,
      macro: 'protein',
    });
  });

  test('stacks multiple segments bottom-to-top in the order given', () => {
    const stackedDay: CaloriesStackDay = {
      day: '2026-09-21',
      totalCalories: 100,
      segments: [
        { macro: 'fat', calories: 60 },
        { macro: 'protein', calories: 40 },
      ],
    };

    const [column] = buildCaloriesBarLayout([stackedDay], {
      width: 10,
      height: 100,
      innerPadding: 0,
      maxCalories: 100,
    });

    expect(column.blocks).toEqual([
      { y: 40, height: 60, macro: 'fat' },
      { y: 0, height: 40, macro: 'protein' },
    ]);
  });

  test('returns no columns before layout is measured', () => {
    expect(
      buildCaloriesBarLayout(days, {
        width: 0,
        height: 50,
        innerPadding: 0.2,
        maxCalories: 100,
      })
    ).toEqual([]);
  });
});

describe('resolveEffectiveMaxCalories', () => {
  test('expands to the highest positive goal in the array', () => {
    expect(resolveEffectiveMaxCalories(1000, [1800, null, 2000])).toBe(2000);
  });

  test('ignores null, undefined, zero, and negative entries', () => {
    expect(resolveEffectiveMaxCalories(1000, [null, undefined, 0, -5])).toBe(
      1000
    );
  });

  test('leaves the data max alone when every goal is below it', () => {
    expect(resolveEffectiveMaxCalories(3000, [1800, 2000])).toBe(3000);
  });
});

describe('buildCaloriesGoalSegments', () => {
  const days: CaloriesStackDay[] = [
    {
      day: '2026-09-19',
      totalCalories: 100,
      segments: [{ macro: 'protein', calories: 100 }],
    },
    {
      day: '2026-09-20',
      totalCalories: 50,
      segments: [{ macro: 'protein', calories: 50 }],
    },
  ];

  // width: 100, two days -> columns at x=5 (width 40, center 25) and x=55 (width 40,
  // center 75), matching `buildCaloriesBarLayout`'s own fixture above.
  const columns = buildCaloriesBarLayout(days, {
    width: 100,
    height: 50,
    innerPadding: 0.2,
    maxCalories: 2000,
  });

  test('returns null when every goal is null, undefined, zero, or negative', () => {
    expect(
      buildCaloriesGoalSegments(columns, [null, undefined], 2000, 100, 50)
    ).toBeNull();
  });

  test('returns null when there are no columns yet (layout not measured)', () => {
    expect(
      buildCaloriesGoalSegments([], [1800, 2000], 2000, 100, 50)
    ).toBeNull();
  });

  test('holds flat across a day whose goal did not change, then steps on the day it did', () => {
    const segments = buildCaloriesGoalSegments(
      columns,
      [1800, 2000],
      2000,
      100,
      50
    );

    // Day 1 goal 1800 -> y = 50 - (1800/2000)*50 = 5; day 2 goal 2000 -> y = 0.
    expect(segments).toEqual([
      { p1: { x: 0, y: 5 }, p2: { x: 25, y: 5 } },
      { p1: { x: 25, y: 5 }, p2: { x: 75, y: 5 } },
      { p1: { x: 75, y: 5 }, p2: { x: 75, y: 0 } },
      { p1: { x: 75, y: 0 }, p2: { x: 100, y: 0 } },
    ]);
  });

  test('skips a day whose goal did not resolve rather than breaking the line', () => {
    const segments = buildCaloriesGoalSegments(
      columns,
      [1800, null],
      2000,
      100,
      50
    );

    // Only day 1 resolved, so the line holds flat edge-to-edge at its value.
    expect(segments).toEqual([
      { p1: { x: 0, y: 5 }, p2: { x: 25, y: 5 } },
      { p1: { x: 25, y: 5 }, p2: { x: 100, y: 5 } },
    ]);
  });
});
