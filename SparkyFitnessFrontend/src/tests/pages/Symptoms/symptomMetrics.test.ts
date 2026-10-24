import {
  analyzeEpisodeFactors,
  computeSymptomMetrics,
  type MetricsEntry,
  type SymptomEpisodeContext,
} from '@workspace/shared';

const entry = (over: Partial<MetricsEntry> = {}): MetricsEntry => ({
  entry_date: '2026-09-29',
  logged_at: '2026-09-29T09:00:00.000Z',
  started_at: null,
  ended_at: null,
  source: 'manual',
  triggers: [],
  treatments: [],
  ...over,
});

const utcHour = (iso: string) => new Date(iso).getUTCHours();

describe('computeSymptomMetrics', () => {
  it('is all zeros for nothing logged', () => {
    expect(computeSymptomMetrics([], [], utcHour)).toMatchObject({
      symptomDays: 0,
      episodes: 0,
      symptomFreeDays: 0,
      averageEpisodeMinutes: null,
      acuteMedicationDays: 0,
      triggerCounts: [],
    });
  });

  it('counts days, not entries', () => {
    const m = computeSymptomMetrics(
      [
        entry({ entry_date: '2026-09-28' }),
        entry({ entry_date: '2026-09-28' }),
        entry({ entry_date: '2026-09-29' }),
      ],
      [],
      utcHour
    );
    expect(m.symptomDays).toBe(2);
  });

  it('leaves cycle-hub entries out of every figure', () => {
    const m = computeSymptomMetrics(
      [
        entry({
          source: 'cycle',
          started_at: '2026-09-29T09:00:00Z',
          ended_at: '2026-09-29T10:00:00Z',
          triggers: ['Stress'],
          treatments: [{ kind: 'medication' }],
        }),
      ],
      [],
      utcHour
    );
    expect(m).toMatchObject({
      symptomDays: 0,
      episodes: 0,
      acuteMedicationDays: 0,
      triggerCounts: [],
    });
    expect(m.entriesByHour.every((n) => n === 0)).toBe(true);
  });

  it('averages only the episodes that have ended', () => {
    const m = computeSymptomMetrics(
      [
        entry({
          started_at: '2026-09-29T09:00:00Z',
          ended_at: '2026-09-29T11:00:00Z',
        }),
        entry({
          started_at: '2026-09-28T09:00:00Z',
          ended_at: '2026-09-28T10:00:00Z',
        }),
        entry({ started_at: '2026-09-27T09:00:00Z' }),
      ],
      [],
      utcHour
    );
    expect(m.episodes).toBe(3);
    expect(m.averageEpisodeMinutes).toBe(90);
  });

  it('never reports a negative duration', () => {
    const m = computeSymptomMetrics(
      [
        entry({
          started_at: '2026-09-29T11:00:00Z',
          ended_at: '2026-09-29T09:00:00Z',
        }),
      ],
      [],
      utcHour
    );
    expect(m.averageEpisodeMinutes).toBe(0);
  });

  it('counts a symptom-free day once, and not when the day has an entry', () => {
    const m = computeSymptomMetrics(
      [entry({ entry_date: '2026-09-29' })],
      ['2026-09-27', '2026-09-27', '2026-09-28', '2026-09-29'],
      utcHour
    );
    expect(m.symptomFreeDays).toBe(2);
  });

  it('counts days with a medication treatment, and relief methods do not count', () => {
    const m = computeSymptomMetrics(
      [
        entry({
          entry_date: '2026-09-28',
          treatments: [{ kind: 'medication' }, { kind: 'medication' }],
        }),
        entry({
          entry_date: '2026-09-28',
          treatments: [{ kind: 'medication' }],
        }),
        entry({
          entry_date: '2026-09-29',
          treatments: [{ kind: 'relief' }],
        }),
      ],
      [],
      utcHour
    );
    expect(m.acuteMedicationDays).toBe(1);
  });

  it('tallies triggers once per entry and orders them by how often they came up', () => {
    const m = computeSymptomMetrics(
      [
        entry({ triggers: ['Stress', 'Stress', 'Poor sleep'] }),
        entry({ triggers: ['Poor sleep'] }),
        entry({ triggers: ['Poor sleep', 'Alcohol'] }),
      ],
      [],
      utcHour
    );
    expect(m.triggerCounts).toEqual([
      { label: 'Poor sleep', count: 3 },
      { label: 'Alcohol', count: 1 },
      { label: 'Stress', count: 1 },
    ]);
  });

  it('buckets entries by the hour the caller says, preferring an episode start', () => {
    const m = computeSymptomMetrics(
      [
        entry({ logged_at: '2026-09-29T09:15:00Z' }),
        entry({
          logged_at: '2026-09-29T20:00:00Z',
          started_at: '2026-09-29T06:30:00Z',
        }),
      ],
      [],
      utcHour
    );
    expect(m.entriesByHour[9]).toBe(1);
    expect(m.entriesByHour[6]).toBe(1);
    expect(m.entriesByHour[20]).toBe(0);
    expect(m.entriesByHour).toHaveLength(24);
  });

  it('ignores an hour outside 0 to 23', () => {
    const m = computeSymptomMetrics([entry()], [], () => 24);
    expect(m.entriesByHour.every((n) => n === 0)).toBe(true);
  });
});

const context = (
  over: Partial<SymptomEpisodeContext> = {}
): SymptomEpisodeContext => ({
  entry_id: 'a',
  sleep: null,
  days: [
    {
      date: '2026-09-28',
      label: 'day_before',
      foods: [],
      water_ml: null,
      steps: null,
      workouts: [],
    },
    {
      date: '2026-09-29',
      label: 'day_of',
      foods: [],
      water_ml: null,
      steps: null,
      workouts: [],
    },
  ],
  medications: [],
  cycle: null,
  ...over,
});

type ContextDay = SymptomEpisodeContext['days'][number];

const withDays = (
  before: Partial<ContextDay>,
  same: Partial<ContextDay> = {}
) => {
  const [dayBefore, dayOf] = context().days as [ContextDay, ContextDay];
  return context({
    days: [
      { ...dayBefore, ...before },
      { ...dayOf, ...same },
    ],
  });
};

const find = (results: ReturnType<typeof analyzeEpisodeFactors>, key: string) =>
  results.find((r) => r.key === key);

describe('analyzeEpisodeFactors', () => {
  it('counts each trigger once per episode', () => {
    const results = analyzeEpisodeFactors(
      [
        { id: 'a', triggers: ['Stress', 'Stress'] },
        { id: 'b', triggers: ['Stress', 'Alcohol'] },
      ],
      {}
    );
    expect(find(results, 'trigger:Stress')).toEqual({
      key: 'trigger:Stress',
      count: 2,
      known: 2,
    });
    expect(find(results, 'trigger:Alcohol')?.count).toBe(1);
  });

  it('calls a night under six hours short, and six hours exactly not short', () => {
    const results = analyzeEpisodeFactors(
      [
        { id: 'a', triggers: [] },
        { id: 'b', triggers: [] },
        { id: 'c', triggers: [] },
      ],
      {
        a: context({ sleep: { minutes: 359, bedtime: '', wake_time: '' } }),
        b: context({ sleep: { minutes: 360, bedtime: '', wake_time: '' } }),
        // No sleep data at all: neither short nor long, just unknown.
        c: context(),
      }
    );
    expect(find(results, 'short_sleep')).toEqual({
      key: 'short_sleep',
      count: 1,
      known: 2,
    });
  });

  it('judges water by the day before, and only when it was logged', () => {
    const results = analyzeEpisodeFactors(
      [
        { id: 'a', triggers: [] },
        { id: 'b', triggers: [] },
        { id: 'c', triggers: [] },
      ],
      {
        a: withDays({ water_ml: 1200 }),
        b: withDays({ water_ml: 2000 }),
        // The day of does not count, however little.
        c: withDays({ water_ml: null }, { water_ml: 100 }),
      }
    );
    expect(find(results, 'low_water')).toEqual({
      key: 'low_water',
      count: 1,
      known: 2,
    });
  });

  it('reads alcohol and caffeine from the food names of either day', () => {
    const results = analyzeEpisodeFactors([{ id: 'a', triggers: [] }], {
      a: withDays(
        { foods: ['Toast'] },
        { foods: ['Red wine', 'Flat white latte'] }
      ),
    });
    expect(find(results, 'alcohol')?.count).toBe(1);
    expect(find(results, 'caffeine')?.count).toBe(1);
  });

  it('does not take ginger for gin or a drum for rum', () => {
    const results = analyzeEpisodeFactors([{ id: 'a', triggers: [] }], {
      a: withDays({ foods: ['Ginger biscuit', 'Drumstick'] }),
    });
    expect(find(results, 'alcohol')).toBeUndefined();
  });

  it('does not judge food when nothing was logged either day', () => {
    const results = analyzeEpisodeFactors([{ id: 'a', triggers: [] }], {
      a: context(),
    });
    expect(find(results, 'alcohol')).toBeUndefined();
    expect(find(results, 'caffeine')).toBeUndefined();
  });

  it('notes when an episode fell in the menstrual phase', () => {
    const results = analyzeEpisodeFactors(
      [
        { id: 'a', triggers: [] },
        { id: 'b', triggers: [] },
      ],
      {
        a: context({ cycle: { phase: 'menstrual', cycle_day: 2 } }),
        b: context({ cycle: { phase: 'luteal', cycle_day: 22 } }),
      }
    );
    expect(find(results, 'menstrual_phase')).toEqual({
      key: 'menstrual_phase',
      count: 1,
      known: 2,
    });
  });

  it('lists only what was actually present, most common first', () => {
    const results = analyzeEpisodeFactors(
      [
        { id: 'a', triggers: ['Stress'] },
        { id: 'b', triggers: ['Stress'] },
      ],
      {
        a: context({ sleep: { minutes: 600, bedtime: '', wake_time: '' } }),
        b: context({ sleep: { minutes: 300, bedtime: '', wake_time: '' } }),
      }
    );
    expect(results.map((r) => r.key)).toEqual([
      'trigger:Stress',
      'short_sleep',
    ]);
  });

  it('copes with episodes that have no context', () => {
    expect(analyzeEpisodeFactors([{ id: 'zzz', triggers: [] }], {})).toEqual(
      []
    );
  });
});
