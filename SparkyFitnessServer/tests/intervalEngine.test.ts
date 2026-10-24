import { describe, it, expect } from 'vitest';
import {
  buildIntervalPhases,
  resolvePhaseAt,
  shiftPhasesForPause,
  type IntervalEngineConfig,
} from '@workspace/shared';

describe('Interval Engine — Unit Tests', () => {
  const baseStartMs = 1700000000000;

  describe('Tabata format', () => {
    it('generates 5s countdown + 8 rounds of 20s work and 10s rest', () => {
      const config: IntervalEngineConfig = {
        format: 'tabata',
        countdownSeconds: 5,
        steps: [{ exerciseName: 'Burpees', durationSec: 20, restSec: 10 }],
        tabataWorkSec: 20,
        tabataRestSec: 10,
        tabataRounds: 8,
      };

      const phases = buildIntervalPhases(config, baseStartMs);

      // 1 countdown + 8 * (1 work + 1 rest) = 17 phases
      expect(phases).toHaveLength(17);

      // Phase 0: countdown
      expect(phases[0]).toEqual({
        kind: 'countdown',
        phaseIndex: 0,
        stepIndex: null,
        round: 1,
        totalRounds: null,
        durationSec: 5,
        startsAt: baseStartMs,
        endsAt: baseStartMs + 5000,
      });

      // Phase 1: Round 1 Work
      expect(phases[1]).toEqual({
        kind: 'work',
        phaseIndex: 1,
        stepIndex: 0,
        round: 1,
        totalRounds: 8,
        durationSec: 20,
        startsAt: baseStartMs + 5000,
        endsAt: baseStartMs + 25000,
      });

      // Phase 2: Round 1 Rest
      expect(phases[2]).toEqual({
        kind: 'rest',
        phaseIndex: 2,
        stepIndex: 0,
        round: 1,
        totalRounds: 8,
        durationSec: 10,
        startsAt: baseStartMs + 25000,
        endsAt: baseStartMs + 35000,
      });

      // Phase 16: Round 8 Rest (last phase)
      const last = phases[16];
      expect(last.kind).toBe('rest');
      expect(last.round).toBe(8);
      // Total duration = 5s + 8 * 30s = 245s
      expect(last.endsAt).toBe(baseStartMs + 245000);
    });
  });

  describe('EMOM format', () => {
    it('generates 1 work + 1 rest phase per minute for configured rounds', () => {
      const config: IntervalEngineConfig = {
        format: 'emom',
        countdownSeconds: 5,
        emomRounds: 5,
        steps: [
          { exerciseName: 'Kettlebell Swings', durationSec: 25, restSec: 35 },
        ],
      };

      const phases = buildIntervalPhases(config, baseStartMs);
      // 1 countdown + 5 rounds * (1 work 25s + 1 rest 35s) = 11 phases
      expect(phases).toHaveLength(11);

      // Round 1 Work: 25s
      expect(phases[1].durationSec).toBe(25);
      expect(phases[1].kind).toBe('work');

      // Round 1 Rest: 35s
      expect(phases[2].durationSec).toBe(35);
      expect(phases[2].kind).toBe('rest');

      // Total EMOM time = 5s + 5 * 60s = 305s
      expect(phases[10].endsAt).toBe(baseStartMs + 305000);
    });
  });

  describe('Interval / HIIT format', () => {
    it('generates work and rest phases per step', () => {
      const config: IntervalEngineConfig = {
        format: 'interval',
        countdownSeconds: 5,
        steps: [
          { exerciseName: 'Jump Rope', durationSec: 45, restSec: 15 },
          { exerciseName: 'Push Ups', durationSec: 30, restSec: 15 },
          { exerciseName: 'Squats', durationSec: 40, restSec: 20 },
        ],
      };

      const phases = buildIntervalPhases(config, baseStartMs);
      // 1 countdown + 3 * (1 work + 1 rest) = 7 phases
      expect(phases).toHaveLength(7);

      expect(phases[1].durationSec).toBe(45);
      expect(phases[1].kind).toBe('work');
      expect(phases[1].stepIndex).toBe(0);

      expect(phases[2].durationSec).toBe(15);
      expect(phases[2].kind).toBe('rest');

      expect(phases[3].durationSec).toBe(30);
      expect(phases[3].stepIndex).toBe(1);
    });
  });

  describe('AMRAP format', () => {
    it('generates global time cap work phase', () => {
      const config: IntervalEngineConfig = {
        format: 'amrap',
        timeCapSeconds: 720, // 12 min
        countdownSeconds: 5,
        steps: [
          { exerciseName: 'Double Unders', reps: 50 },
          { exerciseName: 'Toes to Bar', reps: 10 },
        ],
      };

      const phases = buildIntervalPhases(config, baseStartMs);
      expect(phases).toHaveLength(2); // 1 countdown + 1 work phase spanning 720s
      expect(phases[1].kind).toBe('work');
      expect(phases[1].durationSec).toBe(720);
      expect(phases[1].endsAt).toBe(baseStartMs + 5000 + 720000);
    });
  });

  describe('For Time format', () => {
    it('generates work phase with cap', () => {
      const config: IntervalEngineConfig = {
        format: 'for_time',
        timeCapSeconds: 840, // 14 min cap
        countdownSeconds: 5,
        steps: [{ exerciseName: 'Napster' }],
      };

      const phases = buildIntervalPhases(config, baseStartMs);
      expect(phases).toHaveLength(2);
      expect(phases[1].kind).toBe('work');
      expect(phases[1].durationSec).toBe(840);
    });
  });

  describe('Phase resolution and background fast-forwarding', () => {
    it('resolves active phase and fast-forwards across multiple phases', () => {
      const config: IntervalEngineConfig = {
        format: 'tabata',
        countdownSeconds: 5,
        steps: [{ exerciseName: 'Burpees' }],
        tabataWorkSec: 20,
        tabataRestSec: 10,
        tabataRounds: 8,
      };

      const phases = buildIntervalPhases(config, baseStartMs);

      // At start + 2s -> countdown phase, 3s remaining
      const r1 = resolvePhaseAt(phases, baseStartMs + 2000);
      expect(r1.isFinished).toBe(false);
      expect(r1.phase?.kind).toBe('countdown');
      expect(r1.remainingMs).toBe(3000);

      // Jump ahead 50 seconds (simulating 50s app backgrounding):
      // 5s countdown + 30s Round 1 + 15s into Round 2 Work (ends at +55s)
      const r2 = resolvePhaseAt(phases, baseStartMs + 50000);
      expect(r2.isFinished).toBe(false);
      expect(r2.phase?.kind).toBe('work');
      expect(r2.phase?.round).toBe(2);
      expect(r2.remainingMs).toBe(5000); // 5s remaining in Round 2 work

      // Jump past all phases (e.g. at +300s):
      const r3 = resolvePhaseAt(phases, baseStartMs + 300000);
      expect(r3.isFinished).toBe(true);
      expect(r3.phase?.kind).toBe('finished');
      expect(r3.remainingMs).toBe(0);
    });
  });

  describe('Pause & Resume phase timestamp shifting', () => {
    it('shifts subsequent phase timestamps by the paused duration', () => {
      const config: IntervalEngineConfig = {
        format: 'tabata',
        countdownSeconds: 5,
        steps: [{ exerciseName: 'Burpees' }],
        tabataWorkSec: 20,
        tabataRestSec: 10,
        tabataRounds: 4,
      };

      const phases = buildIntervalPhases(config, baseStartMs);
      const originalPhase2Start = phases[2].startsAt;
      const originalPhase2End = phases[2].endsAt;

      // Pause occurred during Phase 1 for 15 seconds (15000 ms)
      const shifted = shiftPhasesForPause(phases, 1, 15000);

      // Phase 0 unchanged (already completed before pause)
      expect(shifted[0].startsAt).toBe(phases[0].startsAt);

      // Phase 1 and onwards shifted by 15s
      expect(shifted[1].startsAt).toBe(phases[1].startsAt + 15000);
      expect(shifted[1].endsAt).toBe(phases[1].endsAt + 15000);

      expect(shifted[2].startsAt).toBe(originalPhase2Start + 15000);
      expect(shifted[2].endsAt).toBe(originalPhase2End + 15000);
    });
  });
});
