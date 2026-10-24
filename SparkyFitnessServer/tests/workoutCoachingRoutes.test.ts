import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
// @ts-expect-error TS(7016): no type declarations shipped for supertest
import request from 'supertest';
import {
  WorkoutFeedbackValidationError,
  WorkoutSessionNotFoundError,
  getWorkoutCoachingSettings,
  getWorkoutSessionFeedback,
  updateWorkoutCoachingSettings,
  updateWorkoutSessionFeedback,
} from '../services/workoutCoachingService.js';
import { getWorkoutCoachingSignals } from '../services/adaptiveWorkoutService.js';
import workoutCoachingRoutes from '../routes/v2/workoutCoachingRoutes.js';

vi.mock('../services/workoutCoachingService.js', () => {
  class WorkoutSessionNotFoundError extends Error {}
  class WorkoutFeedbackValidationError extends Error {}
  return {
    WorkoutSessionNotFoundError,
    WorkoutFeedbackValidationError,
    getWorkoutCoachingSettings: vi.fn(),
    getWorkoutSessionFeedback: vi.fn(),
    updateWorkoutCoachingSettings: vi.fn(),
    updateWorkoutSessionFeedback: vi.fn(),
  };
});
vi.mock('../services/adaptiveWorkoutService.js', () => ({
  getWorkoutCoachingSignals: vi.fn(),
}));
vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
const actor = { userId: 'owner-1', authenticatedUserId: 'owner-1' };
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.userId = actor.userId;
    req.authenticatedUserId = actor.authenticatedUserId;
    next();
  },
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const app = express();
app.use(express.json());
app.use('/v2/workout-coaching', workoutCoachingRoutes);
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: err.message });
});

const SESSION = '11111111-1111-4111-8111-111111111111';
const ENTRY = '22222222-2222-4222-8222-222222222222';
const feedback = {
  exercise_preset_entry_id: SESSION,
  session: {
    difficulty: 'too_hard',
    pain: true,
    pain_note: 'left shoulder',
    updated_at: '2026-09-26T10:00:00.000Z',
  },
  exercises: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  actor.userId = 'owner-1';
  actor.authenticatedUserId = 'owner-1';
  vi.mocked(getWorkoutSessionFeedback).mockResolvedValue(
    feedback as Awaited<ReturnType<typeof getWorkoutSessionFeedback>>
  );
  vi.mocked(updateWorkoutSessionFeedback).mockResolvedValue(
    feedback as Awaited<ReturnType<typeof updateWorkoutSessionFeedback>>
  );
});

describe('settings', () => {
  it('reads the setting for the active user', async () => {
    vi.mocked(getWorkoutCoachingSettings).mockResolvedValue({
      adaptive_suggestions: true,
    });
    const res = await request(app).get('/v2/workout-coaching/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ adaptive_suggestions: true });
  });

  it('saves the setting for the owner', async () => {
    vi.mocked(updateWorkoutCoachingSettings).mockResolvedValue({
      adaptive_suggestions: false,
    });
    const res = await request(app)
      .put('/v2/workout-coaching/settings')
      .send({ adaptive_suggestions: false });
    expect(res.status).toBe(200);
    expect(updateWorkoutCoachingSettings).toHaveBeenCalledWith('owner-1', {
      adaptive_suggestions: false,
    });
  });

  it('refuses a delegate changing the owner setting', async () => {
    actor.authenticatedUserId = 'delegate-1';
    const res = await request(app)
      .put('/v2/workout-coaching/settings')
      .send({ adaptive_suggestions: false });
    expect(res.status).toBe(403);
    expect(updateWorkoutCoachingSettings).not.toHaveBeenCalled();
  });

  it('rejects a malformed body', async () => {
    const res = await request(app)
      .put('/v2/workout-coaching/settings')
      .send({ adaptive_suggestions: 'yes' });
    expect(res.status).toBe(400);
  });
});

describe('session feedback', () => {
  it('returns session feedback', async () => {
    const res = await request(app).get(
      `/v2/workout-coaching/sessions/${SESSION}/feedback`
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual(feedback);
    expect(getWorkoutSessionFeedback).toHaveBeenCalledWith(
      'owner-1',
      'owner-1',
      SESSION
    );
  });

  it('parses and forwards a replacement, trimming notes', async () => {
    const res = await request(app)
      .put(`/v2/workout-coaching/sessions/${SESSION}/feedback`)
      .send({
        session: { difficulty: 'too_hard', pain: true, pain_note: '  knee  ' },
        exercises: [
          { exercise_entry_id: ENTRY, difficulty: 'too_easy', pain: false },
        ],
      });
    expect(res.status).toBe(200);
    expect(updateWorkoutSessionFeedback).toHaveBeenCalledWith(
      'owner-1',
      'owner-1',
      SESSION,
      {
        session: { difficulty: 'too_hard', pain: true, pain_note: 'knee' },
        exercises: [
          {
            exercise_entry_id: ENTRY,
            difficulty: 'too_easy',
            pain: false,
            pain_note: null,
          },
        ],
      }
    );
  });

  it.each([
    [
      'a note without pain',
      { session: { difficulty: null, pain: false, pain_note: 'x' } },
    ],
    ['an unknown difficulty', { session: { difficulty: 'meh', pain: false } }],
    [
      'a note over 500 chars',
      { session: { difficulty: null, pain: true, pain_note: 'x'.repeat(501) } },
    ],
    [
      'duplicate exercise entries',
      {
        session: null,
        exercises: [
          { exercise_entry_id: ENTRY, difficulty: 'too_easy', pain: false },
          { exercise_entry_id: ENTRY, difficulty: 'too_hard', pain: false },
        ],
      },
    ],
  ])('rejects %s', async (_label, body) => {
    const res = await request(app)
      .put(`/v2/workout-coaching/sessions/${SESSION}/feedback`)
      .send(body);
    expect(res.status).toBe(400);
    expect(updateWorkoutSessionFeedback).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid session id', async () => {
    const res = await request(app).get(
      '/v2/workout-coaching/sessions/nope/feedback'
    );
    expect(res.status).toBe(400);
  });

  it('maps service errors to 404 and 400', async () => {
    vi.mocked(getWorkoutSessionFeedback).mockRejectedValueOnce(
      new WorkoutSessionNotFoundError()
    );
    expect(
      (
        await request(app).get(
          `/v2/workout-coaching/sessions/${SESSION}/feedback`
        )
      ).status
    ).toBe(404);

    vi.mocked(updateWorkoutSessionFeedback).mockRejectedValueOnce(
      new WorkoutFeedbackValidationError('not in session')
    );
    const res = await request(app)
      .put(`/v2/workout-coaching/sessions/${SESSION}/feedback`)
      .send({ session: null, exercises: [] });
    expect(res.status).toBe(400);
  });
});

describe('signals', () => {
  const EX1 = '33333333-3333-4333-8333-333333333333';
  const EX2 = '44444444-4444-4444-8444-444444444444';

  it('forwards exercise ids and the in-progress session', async () => {
    vi.mocked(getWorkoutCoachingSignals).mockResolvedValue({
      adaptive_suggestions: true,
      signals: [
        {
          exercise_id: EX1,
          last_performed_date: '2026-09-24',
          days_since_last_performed: 2,
          last_difficulty: 'too_hard',
          last_pain: null,
          too_easy_streak: 0,
          too_hard_streak: 1,
          pain_streak: 0,
          avg_rpe: 9,
          avg_rir: null,
          sessions_in_variation_window: 4,
        },
      ],
    });
    const res = await request(app).get(
      `/v2/workout-coaching/signals?exerciseIds=${EX1},${EX2}&excludePresetEntryId=${SESSION}`
    );
    expect(res.status).toBe(200);
    expect(res.body.signals[0].last_difficulty).toBe('too_hard');
    expect(getWorkoutCoachingSignals).toHaveBeenCalledWith(
      'owner-1',
      'owner-1',
      [EX1, EX2],
      SESSION
    );
  });

  it.each([
    ['no ids', '/v2/workout-coaching/signals'],
    ['a non-uuid id', '/v2/workout-coaching/signals?exerciseIds=abc'],
  ])('rejects %s', async (_label, path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(400);
    expect(getWorkoutCoachingSignals).not.toHaveBeenCalled();
  });
});
