import { describe, expect, it } from 'vitest';
import {
  calculateMuscleLoad,
  parseMuscleNames,
} from '../services/muscleLoadService.js';

describe('muscleLoadService', () => {
  it('parses JSON and legacy comma-separated muscle snapshots', () => {
    expect(parseMuscleNames('["Chest", "Triceps"]')).toEqual([
      'chest',
      'triceps',
    ]);
    expect(parseMuscleNames('Back, Biceps')).toEqual(['back', 'biceps']);
    expect(parseMuscleNames(null)).toEqual([]);
  });

  it('weights primary muscles above secondary muscles and decays over 72 hours', () => {
    const workout = {
      entryDate: '2026-08-19',
      primaryMuscles: '["chest"]',
      secondaryMuscles: '["triceps"]',
      volumeKg: 5000,
      durationMinutes: 45,
      setCount: 4,
      source: 'Speediance',
    };
    const today = calculateMuscleLoad([workout], '2026-08-19', 72);
    const twoDaysLater = calculateMuscleLoad([workout], '2026-08-21', 72);

    expect(today.find((item) => item.muscle === 'chest')).toEqual(
      expect.objectContaining({
        loadScore: expect.any(Number),
        status: 'high',
        recentVolumeKg: 5000,
        sources: ['Speediance'],
      })
    );
    expect(
      today.find((item) => item.muscle === 'triceps')?.loadScore
    ).toBeLessThan(
      today.find((item) => item.muscle === 'chest')?.loadScore ?? 0
    );
    expect(twoDaysLater.find((item) => item.muscle === 'chest')).toEqual(
      expect.objectContaining({ status: 'light' })
    );
  });

  it('drops load when the configured recovery window has elapsed', () => {
    expect(
      calculateMuscleLoad(
        [
          {
            entryDate: '2026-08-16',
            primaryMuscles: '["back"]',
            secondaryMuscles: '[]',
            volumeKg: 3000,
            durationMinutes: 40,
            setCount: 4,
            source: 'Speediance',
          },
        ],
        '2026-08-19',
        72
      )
    ).toEqual([]);
  });
});
