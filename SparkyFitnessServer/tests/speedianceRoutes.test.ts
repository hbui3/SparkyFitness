import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
// @ts-expect-error TS(7016): supertest has no declaration in this workspace.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware.js', () => ({
  default: {
    authenticate: (req: Request, _res: Response, next: NextFunction) => {
      req.userId = '11111111-1111-4111-8111-111111111111';
      req.authenticatedUserId = req.userId;
      next();
    },
  },
}));

vi.mock('../integrations/speediance/speedianceService.js', () => ({
  default: {
    syncSpeedianceData: vi.fn(),
    getSpeedianceStatus: vi.fn(),
  },
}));

vi.mock('../integrations/speediance/speedianceWorkoutService.js', () => ({
  default: {
    searchSpeedianceExercises: vi.fn(),
    createAndScheduleSpeedianceWorkout: vi.fn(),
    listSpeedianceWorkouts: vi.fn(),
    getSpeedianceWorkout: vi.fn(),
    upsertSpeedianceWorkout: vi.fn(),
    setSpeedianceWorkoutSchedule: vi.fn(),
    createSpeediancePlan: vi.fn(),
    deleteSpeedianceWorkout: vi.fn(),
  },
  SpeedianceWorkoutConflictError: class SpeedianceWorkoutConflictError extends Error {},
  SpeedianceWorkoutValidationError: class SpeedianceWorkoutValidationError extends Error {},
}));

import speedianceRoutes from '../routes/speedianceRoutes.js';
import speedianceService from '../integrations/speediance/speedianceService.js';
import speedianceWorkoutService from '../integrations/speediance/speedianceWorkoutService.js';

const app = express();
app.use(express.json());
app.use('/api/integrations/speediance', speedianceRoutes);

describe('Speediance routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an incomplete date range', async () => {
    const response = await request(app)
      .post('/api/integrations/speediance/sync')
      .send({ startDate: '2026-08-01' });

    expect(response.status).toBe(400);
    expect(speedianceService.syncSpeedianceData).not.toHaveBeenCalled();
  });

  it('returns the validated sync result', async () => {
    vi.mocked(speedianceService.syncSpeedianceData).mockResolvedValue({
      success: true,
      importedWorkouts: 2,
      importedExercises: 8,
      skippedWorkouts: 0,
      startDate: '2026-08-01',
      endDate: '2026-08-18',
    });

    const response = await request(app)
      .post('/api/integrations/speediance/sync')
      .send({ startDate: '2026-08-01', endDate: '2026-08-18' });

    expect(response.status).toBe(200);
    expect(response.body.importedExercises).toBe(8);
  });

  it('searches the authenticated owner Speediance exercise library', async () => {
    vi.mocked(
      speedianceWorkoutService.searchSpeedianceExercises
    ).mockResolvedValue({
      exercises: [
        {
          groupId: '116',
          variantId: '2927',
          title: 'Barbell Bench Press',
          category: 'Upper Body',
          primaryMuscle: 'Chest',
          accessories: ['2'],
          accessoryNames: ['Tricep Rope'],
          deviceTypes: [1],
          isUnilateral: false,
          compatibleForWorkout: true,
        },
      ],
      total: 1,
    });

    const response = await request(app)
      .post('/api/integrations/speediance/exercises/search')
      .send({ query: 'bench', limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.exercises[0].groupId).toBe('116');
  });

  it('validates and schedules an exact Speediance workout request', async () => {
    vi.mocked(
      speedianceWorkoutService.createAndScheduleSpeedianceWorkout
    ).mockResolvedValue({
      success: true,
      workout: {
        id: '501',
        code: 'sparky-code',
        name: 'Sparky Full Body A',
        created: true,
        exerciseCount: 1,
        remoteSetCount: 3,
      },
      schedule: { date: '2026-08-20', status: 'scheduled' },
    });

    const response = await request(app)
      .post('/api/integrations/speediance/workouts/schedule')
      .send({
        name: 'Sparky Full Body A',
        scheduleDate: '2026-08-20',
        exercises: [
          {
            groupId: '116',
            variantId: '2927',
            expectedTitle: 'Barbell Bench Press',
            sets: [
              {
                repetitions: 10,
                targetRm: 12,
                mode: 'standard',
                restSeconds: 90,
              },
              {
                repetitions: 10,
                targetRm: 12,
                mode: 'standard',
                restSeconds: 90,
              },
              {
                repetitions: 10,
                targetRm: 12,
                mode: 'standard',
                restSeconds: 90,
              },
            ],
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.schedule.status).toBe('scheduled');
  });

  it('rejects a workout exercise without an exact title guard', async () => {
    const response = await request(app)
      .post('/api/integrations/speediance/workouts/schedule')
      .send({
        name: 'Unsafe Workout',
        scheduleDate: '2026-08-20',
        exercises: [
          {
            groupId: '116',
            variantId: '2927',
            sets: [{ repetitions: 10 }],
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(
      speedianceWorkoutService.createAndScheduleSpeedianceWorkout
    ).not.toHaveBeenCalled();
  });

  it('updates a complete manager workout definition', async () => {
    vi.mocked(
      speedianceWorkoutService.upsertSpeedianceWorkout
    ).mockResolvedValue({
      success: true,
      workout: {
        id: '501',
        code: 'sparky-code',
        name: 'Sparky Full Body A',
        created: false,
        exerciseCount: 2,
        remoteSetCount: 4,
        nativeWorkoutPresetId: 44,
      },
    });

    const response = await request(app)
      .post('/api/integrations/speediance/workouts')
      .send({
        remoteId: '501',
        remoteCode: 'sparky-code',
        name: 'Sparky Full Body A',
        exercises: [
          {
            groupId: '116',
            variantId: '2927',
            expectedTitle: 'Barbell Bench Press',
            presetId: 0,
            completionUnit: 'repetitions',
            sets: [{ repetitions: 12, targetRm: 18, setType: 'warmup' }],
          },
          {
            groupId: '116',
            variantId: '2927',
            expectedTitle: 'Barbell Bench Press',
            presetId: 1,
            completionUnit: 'repetitions',
            sets: [{ repetitions: 10, targetRm: 12, setType: 'working' }],
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.workout.nativeWorkoutPresetId).toBe(44);
    expect(
      speedianceWorkoutService.upsertSpeedianceWorkout
    ).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ remoteId: '501', remoteCode: 'sparky-code' })
    );
  });

  it('creates an explicitly dated Speediance-backed workout plan', async () => {
    vi.mocked(speedianceWorkoutService.createSpeediancePlan).mockResolvedValue({
      success: true,
      plan: {
        id: '81',
        name: 'Three month hypertrophy',
        startDate: '2026-08-24',
        endDate: '2026-11-22',
        workoutCount: 1,
        scheduledDates: 13,
        failedDates: [],
      },
    });

    const response = await request(app)
      .post('/api/integrations/speediance/plans')
      .send({
        planName: 'Three month hypertrophy',
        startDate: '2026-08-24',
        endDate: '2026-11-22',
        sessions: [
          {
            dayOfWeek: 1,
            workout: {
              name: 'Full Body A',
              exercises: [
                {
                  groupId: '116',
                  variantId: '2927',
                  expectedTitle: 'Barbell Bench Press',
                  sets: [{ repetitions: 10, targetRm: 12 }],
                },
              ],
            },
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.plan.scheduledDates).toBe(13);
    expect(speedianceWorkoutService.createSpeediancePlan).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ planName: 'Three month hypertrophy' })
    );
  });

  it('deletes only an exact confirmed remote workout', async () => {
    vi.mocked(
      speedianceWorkoutService.deleteSpeedianceWorkout
    ).mockResolvedValue({
      success: true,
      id: '501',
      code: 'sparky-code',
      name: 'Sparky Full Body A',
      nativeWorkoutPresetPreserved: true,
    });

    const response = await request(app)
      .delete('/api/integrations/speediance/workouts/501')
      .send({
        remoteCode: 'sparky-code',
        confirmName: 'Sparky Full Body A',
      });

    expect(response.status).toBe(200);
    expect(response.body.nativeWorkoutPresetPreserved).toBe(true);
    expect(
      speedianceWorkoutService.deleteSpeedianceWorkout
    ).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '501',
      'sparky-code',
      'Sparky Full Body A',
      undefined
    );
  });
});
