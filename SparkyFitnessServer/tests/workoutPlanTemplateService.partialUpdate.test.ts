import { beforeEach, describe, expect, it, vi } from 'vitest';
import workoutPlanTemplateService from '../services/workoutPlanTemplateService.js';
import workoutPlanTemplateRepository from '../models/workoutPlanTemplateRepository.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';
import exerciseRepository from '../models/exerciseRepository.js';

vi.mock('../models/workoutPlanTemplateRepository.js', () => ({
  default: {
    getWorkoutPlanTemplateOwnerId: vi.fn(),
    getWorkoutPlanTemplateById: vi.fn(),
    updateWorkoutPlanTemplate: vi.fn(),
  },
}));

vi.mock('../models/workoutPresetRepository.js', () => ({
  default: { getWorkoutPresetById: vi.fn() },
}));

vi.mock('../models/exerciseRepository.js', () => ({
  default: {
    getExerciseById: vi.fn(),
    deleteExerciseEntriesByTemplateId: vi.fn(),
    createExerciseEntriesFromTemplate: vi.fn(),
  },
}));

vi.mock('../utils/timezoneLoader.js', () => ({
  resolveTemplateStartDay: vi.fn().mockResolvedValue('2026-08-20'),
}));

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const storedPlan = {
  id: 9,
  plan_name: 'Sparky Muskelaufbau',
  description: 'Acht Wochen.',
  start_date: '2026-08-24',
  end_date: '2026-10-18',
  is_active: true,
  assignments: [
    {
      id: 15,
      day_of_week: 1,
      workout_preset_id: 41,
      exercise_id: null,
      sort_order: 0,
      sets: [],
    },
  ],
};

describe('workoutPlanTemplateService partial updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(
      workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId
    ).mockResolvedValue('user-1');
    vi.mocked(
      workoutPlanTemplateRepository.getWorkoutPlanTemplateById
    ).mockResolvedValue(storedPlan);
    vi.mocked(workoutPresetRepository.getWorkoutPresetById).mockResolvedValue({
      id: 41,
    });
    vi.mocked(
      exerciseRepository.deleteExerciseEntriesByTemplateId
    ).mockResolvedValue(3);
  });

  it('preserves dates, name, description, and assignments on an active toggle', async () => {
    vi.mocked(
      workoutPlanTemplateRepository.updateWorkoutPlanTemplate
    ).mockResolvedValue({ ...storedPlan, is_active: false });

    await workoutPlanTemplateService.updateWorkoutPlanTemplate('user-1', 9, {
      is_active: false,
      currentClientDate: '2026-08-20',
    });

    expect(
      workoutPlanTemplateRepository.updateWorkoutPlanTemplate
    ).toHaveBeenCalledWith(9, 'user-1', {
      plan_name: storedPlan.plan_name,
      description: storedPlan.description,
      start_date: storedPlan.start_date,
      end_date: storedPlan.end_date,
      is_active: false,
      cycle_length_weeks: 1,
      assignments: storedPlan.assignments,
      currentClientDate: '2026-08-20',
    });
    expect(
      exerciseRepository.createExerciseEntriesFromTemplate
    ).not.toHaveBeenCalled();
  });
});
