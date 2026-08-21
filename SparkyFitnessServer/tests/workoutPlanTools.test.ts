import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWorkoutPlanTools } from '../ai/tools/workoutPlanTools.js';
import workoutPlanTemplateService from '../services/workoutPlanTemplateService.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';
import plannedWorkoutScheduleService from '../services/plannedWorkoutScheduleService.js';

vi.mock('../services/workoutPlanTemplateService.js', () => ({
  default: {
    getWorkoutPlanTemplatesByUserId: vi.fn(),
    createWorkoutPlanTemplate: vi.fn(),
    updateWorkoutPlanTemplate: vi.fn(),
  },
}));

vi.mock('../models/workoutPresetRepository.js', () => ({
  default: {
    getWorkoutPresetByName: vi.fn(),
  },
}));

vi.mock('../services/plannedWorkoutScheduleService.js', () => ({
  default: { getTrainingTimeline: vi.fn() },
}));

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const toolOptions = { toolCallId: 'workout-plan-call-1', messages: [] };

const existingPlan = {
  id: 9,
  plan_name: 'Sparky Muskelaufbau',
  description: 'Vier feste Trainingstage.',
  start_date: '2026-08-24',
  end_date: '2026-10-18',
  is_active: true,
  assignments: [
    {
      id: 15,
      day_of_week: 1,
      workout_preset_id: 41,
      workout_preset_name: 'Upper A',
      exercise_id: null,
      sort_order: 0,
      sets: [],
    },
  ],
};

describe('sparky_manage_workout_plans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(
      workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId
    ).mockResolvedValue([]);
    vi.mocked(
      workoutPresetRepository.getWorkoutPresetByName
    ).mockImplementation(async (_userId, name) => ({
      id: name === 'Upper A' ? 41 : 42,
      name,
    }));
    vi.mocked(
      plannedWorkoutScheduleService.getTrainingTimeline
    ).mockResolvedValue({
      today: '2026-08-21',
      rangeStart: '2026-07-22',
      rangeEnd: '2026-12-19',
      activePlans: [],
      items: [
        {
          id: 'planned-1',
          date: '2026-08-24',
          name: 'Upper A',
          source: 'Workout Plan',
          status: 'planned',
          workoutPresetId: 41,
          workoutPlanAssignmentId: 15,
          exerciseCount: 7,
          totalSetCount: 18,
          warmupSetCount: 0,
          workingSetCount: 18,
        },
      ],
      days: [],
    });
  });

  it('lists native workout plans', async () => {
    vi.mocked(
      workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId
    ).mockResolvedValue([existingPlan]);
    const tool = buildWorkoutPlanTools(
      'user-1',
      'Europe/Berlin'
    ).sparky_manage_workout_plans;

    const result = await tool.execute!({ action: 'list' }, toolOptions);

    expect(result).toContain('Sparky Muskelaufbau');
    expect(result).toContain('"warmupSetCount":0');
    expect(
      workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId
    ).toHaveBeenCalledWith('user-1');
  });

  it('creates an active plan from existing workout preset names', async () => {
    vi.mocked(
      workoutPlanTemplateService.createWorkoutPlanTemplate
    ).mockResolvedValue({ ...existingPlan, id: 10 });
    const tool = buildWorkoutPlanTools(
      'user-1',
      'Europe/Berlin'
    ).sparky_manage_workout_plans;

    const result = await tool.execute!(
      {
        action: 'upsert',
        planName: 'Sparky Muskelaufbau',
        description: 'Vier feste Trainingstage.',
        startDate: '2026-08-24',
        endDate: '2026-10-18',
        isActive: true,
        currentClientDate: '2026-08-20',
        assignments: [
          { dayOfWeek: 1, workoutPresetName: 'Upper A' },
          { dayOfWeek: 4, workoutPresetName: 'Upper B' },
        ],
      },
      toolOptions
    );

    expect(
      workoutPlanTemplateService.createWorkoutPlanTemplate
    ).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        plan_name: 'Sparky Muskelaufbau',
        start_date: '2026-08-24',
        currentClientDate: '2026-08-20',
        assignments: [
          expect.objectContaining({
            day_of_week: 1,
            workout_preset_id: 41,
          }),
          expect.objectContaining({
            day_of_week: 4,
            workout_preset_id: 42,
          }),
        ],
      })
    );
    expect(result).toContain('created');
  });

  it('updates the same named plan instead of creating a duplicate', async () => {
    vi.mocked(
      workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId
    ).mockResolvedValue([existingPlan]);
    vi.mocked(
      workoutPlanTemplateService.updateWorkoutPlanTemplate
    ).mockResolvedValue(existingPlan);
    const tool = buildWorkoutPlanTools(
      'user-1',
      'Europe/Berlin'
    ).sparky_manage_workout_plans;

    await tool.execute!(
      {
        action: 'upsert',
        planName: 'Sparky Muskelaufbau',
        startDate: '2026-08-24',
        endDate: '2026-10-18',
        isActive: true,
        currentClientDate: '2026-08-20',
        assignments: [{ dayOfWeek: 1, workoutPresetName: 'Upper A' }],
      },
      toolOptions
    );

    expect(
      workoutPlanTemplateService.updateWorkoutPlanTemplate
    ).toHaveBeenCalledWith(
      'user-1',
      9,
      expect.objectContaining({ plan_name: 'Sparky Muskelaufbau' })
    );
    expect(
      workoutPlanTemplateService.createWorkoutPlanTemplate
    ).not.toHaveBeenCalled();
  });

  it('preserves all plan fields when only toggling activation', async () => {
    vi.mocked(
      workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId
    ).mockResolvedValue([existingPlan]);
    vi.mocked(
      workoutPlanTemplateService.updateWorkoutPlanTemplate
    ).mockResolvedValue({ ...existingPlan, is_active: false });
    const tool = buildWorkoutPlanTools(
      'user-1',
      'Europe/Berlin'
    ).sparky_manage_workout_plans;

    await tool.execute!(
      {
        action: 'set_active',
        planName: 'Sparky Muskelaufbau',
        isActive: false,
        currentClientDate: '2026-08-20',
      },
      toolOptions
    );

    expect(
      workoutPlanTemplateService.updateWorkoutPlanTemplate
    ).toHaveBeenCalledWith(
      'user-1',
      9,
      expect.objectContaining({
        plan_name: existingPlan.plan_name,
        start_date: existingPlan.start_date,
        end_date: existingPlan.end_date,
        assignments: existingPlan.assignments,
        is_active: false,
      })
    );
  });

  it('does not write when a referenced workout preset is missing', async () => {
    vi.mocked(workoutPresetRepository.getWorkoutPresetByName).mockResolvedValue(
      null
    );
    const tool = buildWorkoutPlanTools(
      'user-1',
      'Europe/Berlin'
    ).sparky_manage_workout_plans;

    const result = await tool.execute!(
      {
        action: 'upsert',
        planName: 'Sparky Muskelaufbau',
        startDate: '2026-08-24',
        isActive: true,
        assignments: [{ dayOfWeek: 1, workoutPresetName: 'Missing' }],
      },
      toolOptions
    );

    expect(result).toContain('Error [WORKOUT_PRESET_NOT_FOUND]');
    expect(result).toContain(
      'sparky_manage_speediance_workouts action=create_plan'
    );
    expect(
      workoutPlanTemplateService.createWorkoutPlanTemplate
    ).not.toHaveBeenCalled();
  });
});
