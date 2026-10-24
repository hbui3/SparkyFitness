import {
  attributeWatchBatch,
  boundedWatchCompletedAt,
} from '../../src/utils/watchTelemetryAttribution';

const steps = [
  { setId: 'a1', exerciseEntryId: 'bench' },
  { setId: 'a2', exerciseEntryId: 'bench' },
  { setId: 'b1', exerciseEntryId: 'row' },
];

const startedAt = Date.parse('2026-09-17T10:00:00.000Z');

describe('attributeWatchBatch', () => {
  it('keeps a batch on the watch tag when the phone has not moved on', () => {
    const result = attributeWatchBatch({
      samples: [
        { t: '2026-09-17T10:00:30.000Z', bpm: 120 },
        { t: '2026-09-17T10:01:00.000Z', bpm: 128 },
      ],
      activeEnergyKcal: 12,
      taggedExerciseEntryId: 'bench',
      steps,
      completedAtBySetId: {},
      startedAt,
      activeSetId: 'a1',
      now: Date.parse('2026-09-17T10:01:00.000Z'),
    });

    expect(result.samplesByExercise.get('bench')).toHaveLength(2);
    expect(result.samplesByExercise.has('row')).toBe(false);
    expect(result.energyByExercise.get('bench')).toBe(12);
    expect(result.durationsByExercise).toBeNull();
  });

  it('splits a watch batch once the phone has finished the earlier exercise', () => {
    const result = attributeWatchBatch({
      samples: [
        { t: '2026-09-17T10:01:00.000Z', bpm: 110 },
        { t: '2026-09-17T10:04:00.000Z', bpm: 140 },
        { t: '2026-09-17T10:05:00.000Z', bpm: 142 },
      ],
      activeEnergyKcal: 30,
      taggedExerciseEntryId: 'bench',
      steps,
      completedAtBySetId: {
        a1: Date.parse('2026-09-17T10:02:00.000Z'),
        a2: Date.parse('2026-09-17T10:03:00.000Z'),
      },
      startedAt,
      activeSetId: 'b1',
      now: Date.parse('2026-09-17T10:06:00.000Z'),
    });

    expect(
      result.samplesByExercise.get('bench')?.map((sample) => sample.bpm)
    ).toEqual([110]);
    expect(
      result.samplesByExercise.get('row')?.map((sample) => sample.bpm)
    ).toEqual([140, 142]);
    expect(result.energyByExercise.get('bench')).toBe(10);
    expect(result.energyByExercise.get('row')).toBe(20);
    expect(result.durationsByExercise?.get('bench')).toBe(3);
    expect(result.durationsByExercise?.get('row')).toBe(3);
  });

  it('credits a skipped set by when the later set was actually completed', () => {
    const result = attributeWatchBatch({
      samples: [
        { t: '2026-09-17T10:01:00.000Z', bpm: 100 },
        { t: '2026-09-17T10:04:00.000Z', bpm: 150 },
        { t: '2026-09-17T10:04:30.000Z', bpm: 152 },
      ],
      taggedExerciseEntryId: 'row',
      steps,
      completedAtBySetId: {
        a1: Date.parse('2026-09-17T10:02:00.000Z'),
        b1: Date.parse('2026-09-17T10:05:00.000Z'),
      },
      startedAt,
      // The cursor has circled back to the hole. Samples during the row
      // belong to the row, which is the next set that was actually logged.
      activeSetId: 'a2',
      now: Date.parse('2026-09-17T10:05:00.000Z'),
    });

    expect(
      result.samplesByExercise.get('bench')?.map((sample) => sample.bpm)
    ).toEqual([100]);
    expect(
      result.samplesByExercise.get('row')?.map((sample) => sample.bpm)
    ).toEqual([150, 152]);
    expect(result.durationsByExercise?.get('row')).toBe(3);
    expect(result.durationsByExercise?.get('bench')).toBe(2);
  });

  it('keeps the time after the last logged set off a skipped set', () => {
    const result = attributeWatchBatch({
      samples: [
        { t: '2026-09-17T10:05:00.000Z', bpm: 150 },
        { t: '2026-09-17T10:07:00.000Z', bpm: 155 },
      ],
      taggedExerciseEntryId: 'row',
      steps,
      completedAtBySetId: {
        a1: Date.parse('2026-09-17T10:02:00.000Z'),
        b1: Date.parse('2026-09-17T10:04:00.000Z'),
      },
      startedAt,
      // Logging b1 with a2 still open sends the cursor back to a2.
      activeSetId: 'a2',
      now: Date.parse('2026-09-17T10:08:00.000Z'),
      forceTimeline: true,
    });

    expect(result.samplesByExercise.get('bench')).toBeUndefined();
    expect(
      result.samplesByExercise.get('row')?.map((sample) => sample.bpm)
    ).toEqual([150, 155]);
    expect(result.durationsByExercise?.get('bench')).toBe(2);
    expect(result.durationsByExercise?.get('row')).toBe(6);
  });

  it('does not count a completion that is earlier than the workout start', () => {
    const result = attributeWatchBatch({
      samples: [
        { t: '2026-09-17T10:11:00.000Z', bpm: 130 },
        { t: '2026-09-17T10:11:30.000Z', bpm: 132 },
      ],
      taggedExerciseEntryId: 'bench',
      steps,
      completedAtBySetId: {
        a1: Date.parse('2026-09-17T09:50:00.000Z'),
        b1: Date.parse('2026-09-17T10:12:00.000Z'),
      },
      startedAt: Date.parse('2026-09-17T10:10:00.000Z'),
      activeSetId: 'a2',
      now: Date.parse('2026-09-17T10:14:00.000Z'),
    });

    expect(
      result.samplesByExercise.get('row')?.map((sample) => sample.bpm)
    ).toEqual([130, 132]);
    // The bench set was logged before this workout's start, so it adds no
    // time. The row runs from the start until now: the cursor went back to
    // the skipped bench set, which is behind the row, so it does not take
    // the open stretch.
    expect(result.durationsByExercise?.get('row')).toBe(4);
    expect(result.durationsByExercise?.get('bench') ?? 0).toBe(0);
  });
});

describe('boundedWatchCompletedAt', () => {
  const now = Date.parse('2026-09-17T10:30:00.000Z');

  it('uses a tap time inside the workout', () => {
    expect(
      boundedWatchCompletedAt('2026-09-17T10:20:00.000Z', startedAt, now)
    ).toBe(Date.parse('2026-09-17T10:20:00.000Z'));
  });

  it('pulls a slightly fast watch clock back to now', () => {
    expect(
      boundedWatchCompletedAt('2026-09-17T10:31:00.000Z', startedAt, now)
    ).toBe(now);
  });

  it('ignores a time outside the workout or unreadable', () => {
    expect(
      boundedWatchCompletedAt('2026-09-17T09:59:00.000Z', startedAt, now)
    ).toBeUndefined();
    expect(
      boundedWatchCompletedAt('2026-09-17T11:30:00.000Z', startedAt, now)
    ).toBeUndefined();
    expect(
      boundedWatchCompletedAt('not a date', startedAt, now)
    ).toBeUndefined();
    expect(boundedWatchCompletedAt(null, startedAt, now)).toBeUndefined();
  });
});
