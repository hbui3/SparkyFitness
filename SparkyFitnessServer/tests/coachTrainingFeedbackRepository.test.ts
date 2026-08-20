import { beforeEach, describe, expect, it, vi } from 'vitest';
import coachTrainingFeedbackRepository from '../models/coachTrainingFeedbackRepository.js';
import { getClient } from '../db/poolManager.js';

vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(),
}));

const userId = '22222222-2222-4222-8222-222222222222';
const feedbackId = '33333333-3333-4333-8333-333333333333';

describe('coachTrainingFeedbackRepository', () => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClient).mockResolvedValue(client as never);
  });

  it('stores feedback and explicit preference updates atomically', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: feedbackId,
            user_id: userId,
            workout_date: '2026-08-20',
            workout_name: 'Sparky Full Body A',
            provider: 'speediance',
            overall_rating: 4,
            difficulty: 'just_right',
            energy_rating: null,
            pain_level: 0,
            notes: 'Rows felt great.',
            exercise_feedback: [],
            created_at: new Date('2026-08-20T06:00:00.000Z'),
            updated_at: new Date('2026-08-20T06:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            user_id: userId,
            kind: 'exercise',
            subject: 'Seated Barbell Row',
            sentiment: 'prefer',
            notes: null,
            source: 'feedback',
            source_feedback_id: feedbackId,
            active: true,
            created_at: new Date('2026-08-20T06:00:00.000Z'),
            updated_at: new Date('2026-08-20T06:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({});

    const result =
      await coachTrainingFeedbackRepository.recordFeedbackWithPreferences(
        userId,
        {
          workoutDate: '2026-08-20',
          workoutName: 'Sparky Full Body A',
          provider: 'speediance',
          overallRating: 4,
          difficulty: 'just_right',
          painLevel: 0,
          exerciseFeedback: [],
          preferenceUpdates: [
            {
              kind: 'exercise',
              subject: 'Seated Barbell Row',
              sentiment: 'prefer',
            },
          ],
        }
      );

    expect(getClient).toHaveBeenCalledWith(userId, userId);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[2][0]).toContain(
      'ON CONFLICT (user_id, kind, lower(subject))'
    );
    expect(client.query.mock.calls[3][0]).toBe('COMMIT');
    expect(result.preferences[0].subject).toBe('Seated Barbell Row');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the owner-scoped client after a write failure', async () => {
    const failure = new Error('preference insert failed');
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: feedbackId,
            user_id: userId,
            workout_date: '2026-08-20',
            workout_name: 'Sparky Full Body A',
            provider: 'speediance',
            overall_rating: null,
            difficulty: 'too_hard',
            energy_rating: null,
            pain_level: null,
            notes: null,
            exercise_feedback: [],
            created_at: new Date('2026-08-20T06:00:00.000Z'),
            updated_at: new Date('2026-08-20T06:00:00.000Z'),
          },
        ],
      })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({});

    await expect(
      coachTrainingFeedbackRepository.recordFeedbackWithPreferences(userId, {
        workoutDate: '2026-08-20',
        workoutName: 'Sparky Full Body A',
        provider: 'speediance',
        difficulty: 'too_hard',
        exerciseFeedback: [],
        preferenceUpdates: [
          {
            kind: 'exercise',
            subject: 'Barbell Squat',
            sentiment: 'avoid',
          },
        ],
      })
    ).rejects.toThrow('preference insert failed');

    expect(client.query.mock.calls[3][0]).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
