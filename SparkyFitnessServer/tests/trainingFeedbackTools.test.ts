import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTrainingFeedbackTools } from '../ai/tools/trainingFeedbackTools.js';
import trainingFeedbackService from '../services/trainingFeedbackService.js';

vi.mock('../services/trainingFeedbackService.js', () => ({
  default: {
    getTrainingLearningContext: vi.fn(),
    recordTrainingFeedback: vi.fn(),
    setTrainingPreference: vi.fn(),
    forgetTrainingPreference: vi.fn(),
  },
}));

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const toolOptions = { toolCallId: 'feedback-call-1', messages: [] };

describe('sparky_manage_training_feedback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records structured feedback with explicit preference updates', async () => {
    vi.mocked(trainingFeedbackService.recordTrainingFeedback).mockResolvedValue(
      {
        success: true,
        feedback: {
          id: '11111111-1111-4111-8111-111111111111',
          workoutDate: '2026-08-20',
          workoutName: 'Sparky Full Body A',
          provider: 'speediance',
          overallRating: 4,
          difficulty: 'just_right',
          energyRating: null,
          painLevel: 0,
          notes: 'Rows felt great.',
          exerciseFeedback: [],
          createdAt: '2026-08-20T06:00:00.000Z',
        },
        updatedPreferences: [],
        learningContext: {
          suggestedVolumeFactor: 1,
          suggestedRestSecondsDelta: 0,
          recentPainReported: false,
          preferredExercises: [],
          avoidedExercises: [],
          requiredEquipment: [],
          constraints: [],
          preferences: [],
          recentFeedback: [],
        },
      }
    );
    const tool = buildTrainingFeedbackTools(
      'user-1',
      'Europe/Berlin'
    ).sparky_manage_training_feedback;

    const result = await tool.execute!(
      {
        action: 'record',
        workoutName: 'Sparky Full Body A',
        provider: 'speediance',
        overallRating: 4,
        difficulty: 'just_right',
        painLevel: 0,
        notes: 'Rows felt great.',
        exerciseFeedback: [],
        preferenceUpdates: [],
      },
      toolOptions
    );

    expect(trainingFeedbackService.recordTrainingFeedback).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ workoutName: 'Sparky Full Body A' }),
      'Europe/Berlin'
    );
    expect(result).toContain('Sparky Full Body A');
  });

  it('rejects an empty feedback record', async () => {
    const tool = buildTrainingFeedbackTools(
      'user-1',
      'Europe/Berlin'
    ).sparky_manage_training_feedback;

    const result = await tool.execute!(
      {
        action: 'record',
        workoutName: 'Sparky Full Body A',
        provider: 'speediance',
        exerciseFeedback: [],
        preferenceUpdates: [],
      },
      toolOptions
    );

    expect(result).toContain('At least one feedback value is required');
    expect(
      trainingFeedbackService.recordTrainingFeedback
    ).not.toHaveBeenCalled();
  });
});
