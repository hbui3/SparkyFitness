import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listPreferences: vi.fn(),
  listFeedback: vi.fn(),
  record: vi.fn(),
  upsertPreference: vi.fn(),
  deactivatePreference: vi.fn(),
  loadTimezone: vi.fn(),
}));

vi.mock('../models/coachTrainingFeedbackRepository.js', () => ({
  default: {
    listActivePreferences: mocks.listPreferences,
    listRecentFeedback: mocks.listFeedback,
    recordFeedbackWithPreferences: mocks.record,
    upsertPreference: mocks.upsertPreference,
    deactivatePreference: mocks.deactivatePreference,
  },
}));

vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: mocks.loadTimezone,
}));

import trainingFeedbackService from '../services/trainingFeedbackService.js';

const preference = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  kind: 'exercise' as const,
  subject: 'Barbell Squat',
  sentiment: 'avoid' as const,
  notes: 'Prefer a belt squat alternative.',
  source: 'feedback' as const,
  source_feedback_id: '33333333-3333-4333-8333-333333333333',
  active: true,
  created_at: new Date('2026-08-20T06:00:00.000Z'),
  updated_at: new Date('2026-08-20T06:00:00.000Z'),
};

const feedback = {
  id: '33333333-3333-4333-8333-333333333333',
  user_id: preference.user_id,
  workout_date: '2026-08-20',
  workout_name: 'Sparky Full Body A',
  provider: 'speediance' as const,
  overall_rating: 2,
  difficulty: 'too_hard' as const,
  energy_rating: 2,
  pain_level: 4,
  notes: 'Too much volume today.',
  exercise_feedback: [
    {
      exerciseName: 'Barbell Squat',
      discomfortLevel: 5,
      notes: 'Knee discomfort.',
    },
  ],
  created_at: new Date('2026-08-20T06:00:00.000Z'),
  updated_at: new Date('2026-08-20T06:00:00.000Z'),
};

describe('trainingFeedbackService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPreferences.mockResolvedValue([]);
    mocks.listFeedback.mockResolvedValue([]);
    mocks.loadTimezone.mockResolvedValue('Europe/Berlin');
  });

  it('returns neutral adaptation when no feedback exists', async () => {
    await expect(
      trainingFeedbackService.getTrainingLearningContext(preference.user_id)
    ).resolves.toMatchObject({
      suggestedVolumeFactor: 1,
      suggestedRestSecondsDelta: 0,
      recentPainReported: false,
      preferences: [],
      recentFeedback: [],
    });
  });

  it('reduces volume, adds rest, and exposes explicit avoid preferences after hard painful feedback', async () => {
    mocks.listPreferences.mockResolvedValue([preference]);
    mocks.listFeedback.mockResolvedValue([feedback]);

    const result = await trainingFeedbackService.getTrainingLearningContext(
      preference.user_id
    );

    expect(result.suggestedVolumeFactor).toBe(0.8);
    expect(result.suggestedRestSecondsDelta).toBe(15);
    expect(result.recentPainReported).toBe(true);
    expect(result.avoidedExercises).toEqual(['Barbell Squat']);
    expect(result.preferences[0]).toMatchObject({
      id: preference.id,
      subject: 'Barbell Squat',
      sentiment: 'avoid',
    });
  });

  it('treats exercise-specific discomfort as a bounded caution signal', async () => {
    mocks.listFeedback.mockResolvedValue([
      {
        ...feedback,
        overall_rating: 4,
        difficulty: 'just_right',
        pain_level: 0,
      },
    ]);

    const result = await trainingFeedbackService.getTrainingLearningContext(
      preference.user_id
    );

    expect(result.suggestedVolumeFactor).toBe(0.9);
    expect(result.suggestedRestSecondsDelta).toBe(15);
    expect(result.recentPainReported).toBe(true);
  });

  it('records feedback and explicit preferences atomically', async () => {
    mocks.record.mockResolvedValue({
      feedback,
      preferences: [preference],
    });
    mocks.listPreferences.mockResolvedValue([preference]);
    mocks.listFeedback.mockResolvedValue([feedback]);

    const result = await trainingFeedbackService.recordTrainingFeedback(
      preference.user_id,
      {
        workoutDate: '2026-08-20',
        workoutName: feedback.workout_name,
        provider: 'speediance',
        difficulty: 'too_hard',
        painLevel: 4,
        exerciseFeedback: feedback.exercise_feedback,
        preferenceUpdates: [
          {
            kind: 'exercise',
            subject: 'Barbell Squat',
            sentiment: 'avoid',
            notes: 'Prefer a belt squat alternative.',
          },
        ],
      },
      'Europe/Berlin'
    );

    expect(mocks.record).toHaveBeenCalledWith(
      preference.user_id,
      expect.objectContaining({
        workoutDate: '2026-08-20',
        workoutName: feedback.workout_name,
      })
    );
    expect(result.success).toBe(true);
    expect(result.updatedPreferences[0].id).toBe(preference.id);
    expect(result.learningContext.suggestedVolumeFactor).toBe(0.8);
  });
});
