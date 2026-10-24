import {
  buildWorkoutHeartRateSeries,
  type HealthMetricSamples,
} from '@workspace/shared';

function heartRateBucket(
  samples: { t: string; bpm: number; ex?: string }[]
): HealthMetricSamples {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    user_id: 'user-1',
    entry_date: '2026-09-20',
    source_provider: 'apple_health',
    device_name: null,
    created_at: null,
    updated_at: null,
    metric: 'heart_rate',
    samples,
  } as HealthMetricSamples;
}

describe('buildWorkoutHeartRateSeries', () => {
  it('prefers samples tagged with the workout', () => {
    const series = buildWorkoutHeartRateSeries(
      [
        heartRateBucket([
          { t: '2026-09-20T12:01:00Z', bpm: 130, ex: 'workout-1' },
          { t: '2026-09-20T12:00:00Z', bpm: 120, ex: 'workout-1' },
          { t: '2026-09-20T12:02:00Z', bpm: 90 },
        ]),
      ],
      'workout-1',
      {
        entry_date: '2026-09-20',
        entry_time: '12:00',
        record_timezone: 'UTC',
        duration_minutes: 30,
      },
      'UTC'
    );
    expect(series.map((p) => p.bpm)).toEqual([120, 130]);
    expect(series.map((p) => p.elapsedMinutes)).toEqual([0, 1]);
  });

  it('falls back to untagged samples inside the workout window', () => {
    const series = buildWorkoutHeartRateSeries(
      [
        heartRateBucket([
          { t: '2026-09-20T15:59:00Z', bpm: 70 },
          { t: '2026-09-20T16:10:00Z', bpm: 140 },
          { t: '2026-09-20T16:40:00Z', bpm: 75 },
          { t: '2026-09-20T16:15:00Z', bpm: 150, ex: 'other-workout' },
        ]),
      ],
      'workout-1',
      {
        entry_date: '2026-09-20',
        entry_time: '12:00:00',
        record_timezone: 'America/New_York',
        duration_minutes: 30,
      },
      'UTC'
    );
    expect(series.map((p) => p.bpm)).toEqual([140]);
  });

  it('uses the fallback zone when the entry has no recorded zone', () => {
    const series = buildWorkoutHeartRateSeries(
      [heartRateBucket([{ t: '2026-09-20T16:10:00Z', bpm: 140 }])],
      'workout-1',
      {
        entry_date: '2026-09-20',
        entry_time: '12:00',
        record_timezone: null,
        duration_minutes: 30,
      },
      'America/New_York'
    );
    expect(series).toHaveLength(1);
  });

  it('returns nothing without a start time or tagged samples', () => {
    expect(
      buildWorkoutHeartRateSeries(
        [heartRateBucket([{ t: '2026-09-20T16:10:00Z', bpm: 140 }])],
        'workout-1',
        { entry_date: '2026-09-20', entry_time: null },
        'UTC'
      )
    ).toEqual([]);
    expect(
      buildWorkoutHeartRateSeries(undefined, 'workout-1', undefined, 'UTC')
    ).toEqual([]);
  });
});
