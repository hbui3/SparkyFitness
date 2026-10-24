import {
  buildWatchGoalNutrients,
  shownInOrder,
  WATCH_STANDARD_NUTRIENT_KEYS,
} from '../../src/utils/watchNutrients';
import type { DailySummary } from '../../src/types/dailySummary';

const t = (_key: string, options: { defaultValue: string }) =>
  options.defaultValue;

const summary = {
  protein: { consumed: 112, goal: 150 },
  carbs: { consumed: 200, goal: 180 },
  fat: { consumed: 50, goal: 60 },
  fiber: { consumed: 21, goal: 30 },
  foodEntries: [
    { serving_size: 100, quantity: 200, sodium: 400 },
    { serving_size: 0, quantity: 100, sodium: 999 },
  ],
  supplementTotals: {},
  goals: { dietary_fiber: 30, sodium: 0 },
  customNutrientTotals: { Creatine: 5 },
  customNutrientGoals: { Creatine: 10 },
} as unknown as DailySummary;

describe('shownInOrder', () => {
  test('orders the shown keys by the saved order, appending new ones', () => {
    expect(
      shownInOrder(['fat', 'sodium', 'protein'], ['protein', 'fat', 'iron'])
    ).toEqual(['fat', 'protein', 'iron']);
  });
});

describe('WATCH_STANDARD_NUTRIENT_KEYS', () => {
  test('leaves out calories and the glycemic index', () => {
    expect(WATCH_STANDARD_NUTRIENT_KEYS).toContain('protein');
    expect(WATCH_STANDARD_NUTRIENT_KEYS).not.toContain('calories');
    expect(WATCH_STANDARD_NUTRIENT_KEYS).not.toContain('glycemic_index');
  });
});

describe('buildWatchGoalNutrients', () => {
  const customUnits = new Map([['Creatine', 'g']]);

  test('builds rows in the given order with amounts, goals and fill', () => {
    const rows = buildWatchGoalNutrients(
      summary,
      ['dietary_fiber', 'carbs', 'Creatine'],
      customUnits,
      t
    );

    expect(rows).toEqual([
      {
        key: 'dietary_fiber',
        label: 'Fiber',
        unit: 'g',
        consumed: 21,
        goal: 30,
        progress: 0.7,
      },
      {
        key: 'carbs',
        label: 'Carbs',
        unit: 'g',
        consumed: 200,
        goal: 180,
        progress: 1,
      },
      {
        key: 'Creatine',
        label: 'Creatine',
        unit: 'g',
        consumed: 5,
        goal: 10,
        progress: 0.5,
      },
    ]);
  });

  test('a nutrient without a goal has a null goal and no fill', () => {
    const [sodium] = buildWatchGoalNutrients(
      summary,
      ['sodium'],
      customUnits,
      t
    );

    expect(sodium).toEqual({
      key: 'sodium',
      label: 'Sodium',
      unit: 'mg',
      consumed: 800,
      goal: null,
      progress: 0,
    });
  });

  test('drops keys that are neither standard nor a known custom nutrient', () => {
    expect(
      buildWatchGoalNutrients(
        summary,
        ['Deleted custom', 'calories', 'protein'],
        customUnits,
        t
      ).map((row) => row.key)
    ).toEqual(['protein']);
  });
});
