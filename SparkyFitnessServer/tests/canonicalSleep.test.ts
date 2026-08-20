import { describe, expect, it } from 'vitest';
import {
  canonicalSleepScore,
  canonicalSleepSeconds,
  selectCanonicalSleepEntry,
  type CanonicalSleepCandidate,
} from '../utils/canonicalSleep.js';

function candidate(
  overrides: Partial<CanonicalSleepCandidate>
): CanonicalSleepCandidate {
  return {
    entry_date: '2026-08-19',
    duration_in_seconds: 8 * 3600,
    time_asleep_in_seconds: 7.5 * 3600,
    sleep_score: 82,
    source: 'HealthKit',
    updated_at: '2026-08-19T14:00:00.000Z',
    ...overrides,
  };
}

describe('canonical sleep selection', () => {
  it('prefers a complete nightly record over a later inconsistent provider row', () => {
    const healthKit = candidate({});
    const withings = candidate({
      duration_in_seconds: 3.04 * 3600,
      time_asleep_in_seconds: 6.08 * 3600,
      sleep_score: 0,
      source: 'Withings',
      updated_at: '2026-08-19T21:00:00.000Z',
    });

    const selected = selectCanonicalSleepEntry([withings, healthKit]);

    expect(selected?.source).toBe('HealthKit');
    expect(selected && canonicalSleepSeconds(selected)).toBe(7.5 * 3600);
    expect(selected && canonicalSleepScore(selected)).toBe(82);
  });

  it('prefers a full previous night over a short newer nap', () => {
    const fullNight = candidate({ entry_date: '2026-08-18' });
    const nap = candidate({
      entry_date: '2026-08-19',
      duration_in_seconds: 90 * 60,
      time_asleep_in_seconds: 75 * 60,
      sleep_score: null,
      source: 'manual',
    });

    expect(selectCanonicalSleepEntry([nap, fullNight])?.source).toBe(
      'HealthKit'
    );
  });

  it('falls back to time in bed and treats a zero score as missing', () => {
    const durationOnly = candidate({
      time_asleep_in_seconds: null,
      sleep_score: 0,
    });

    expect(canonicalSleepSeconds(durationOnly)).toBe(8 * 3600);
    expect(canonicalSleepScore(durationOnly)).toBeNull();
  });

  it('ignores Withings as a canonical sleep source', () => {
    const withings = candidate({ source: 'Withings' });

    expect(selectCanonicalSleepEntry([withings])).toBeNull();
  });
});
