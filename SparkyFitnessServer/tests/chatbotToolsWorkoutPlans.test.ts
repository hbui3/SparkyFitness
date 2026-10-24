import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/workoutPlanTemplateService.js', () => ({
  default: {
    getWorkoutPlanTemplatesByUserId: vi.fn(),
    getWorkoutPlanTemplateById: vi.fn(),
    getActiveWorkoutPlanForDate: vi.fn(),
    createWorkoutPlanTemplate: vi.fn(),
    updateWorkoutPlanTemplate: vi.fn(),
    deleteWorkoutPlanTemplate: vi.fn(),
  },
}));

vi.mock('../models/workoutPresetRepository.js', () => ({
  default: {
    getWorkoutPresetByName: vi.fn(),
  },
}));

vi.mock('../services/exerciseService.js', () => ({
  default: {
    searchExercises: vi.fn(),
  },
}));

vi.mock('../config/logging.js', () => ({
  log: vi.fn(),
}));

import workoutPlanTemplateService from '../services/workoutPlanTemplateService.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';
import exerciseService from '../services/exerciseService.js';
import { buildWorkoutPlanTools } from '../ai/tools/workoutPlanTools.js';
import { toolOpts } from './helpers/toolExecutionOptions.js';

const opts = toolOpts;

const PLAN_ID = 42;

const DB_ERROR_TEXT =
  'Error [DB_ERROR]: A database error occurred.\n\nSuggestion: Do NOT retry the same call — it will fail the same way. Tell the user what failed and stop.';

const svc = workoutPlanTemplateService as unknown as {
  getWorkoutPlanTemplatesByUserId: ReturnType<typeof vi.fn>;
  getWorkoutPlanTemplateById: ReturnType<typeof vi.fn>;
  getActiveWorkoutPlanForDate: ReturnType<typeof vi.fn>;
  createWorkoutPlanTemplate: ReturnType<typeof vi.fn>;
  updateWorkoutPlanTemplate: ReturnType<typeof vi.fn>;
  deleteWorkoutPlanTemplate: ReturnType<typeof vi.fn>;
};

const presetRepo = workoutPresetRepository as unknown as {
  getWorkoutPresetByName: ReturnType<typeof vi.fn>;
};

const exSvc = exerciseService as unknown as {
  searchExercises: ReturnType<typeof vi.fn>;
};

function getTool() {
  const tools = buildWorkoutPlanTools('user-1', 'UTC');
  return tools.sparky_manage_workout_plans;
}

describe('sparky_manage_workout_plans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list_workout_plans', () => {
    it('lists sequential and weekly workout plans with correct session/day counts', async () => {
      svc.getWorkoutPlanTemplatesByUserId.mockResolvedValue([
        {
          id: PLAN_ID,
          plan_name: 'Push Pull Legs',
          is_active: true,
          schedule_type: 'sequential',
          assignments: [
            { session_index: 1, session_name: 'Push' },
            { session_index: 1, session_name: 'Push' },
            { session_index: 2, session_name: 'Pull' },
            { session_index: 3, session_name: 'Legs' },
          ],
        },
        {
          id: 43,
          plan_name: 'Upper Lower',
          is_active: false,
          schedule_type: 'weekly',
          assignments: [
            { day_of_week: 1 },
            { day_of_week: 2 },
            { day_of_week: 4 },
            { day_of_week: 5 },
          ],
        },
      ]);
      const result = await getTool().execute!({}, opts);
      expect(result).toBe(
        '# Workout Plans\n\n**Push Pull Legs** (active, sequential, 3 sessions)\n  ID: ' +
          PLAN_ID +
          '\n\n**Upper Lower** (inactive, weekly, 4 days)\n  ID: 43'
      );
    });

    it('renders no results when there are no plans', async () => {
      svc.getWorkoutPlanTemplatesByUserId.mockResolvedValue([]);
      const result = await getTool().execute!(
        { action: 'list_workout_plans' },
        opts
      );
      expect(result).toBe('# Workout Plans\n\nNo results found.');
    });
  });

  describe('get_workout_plan', () => {
    it('gets a sequential workout plan grouped by session_index with formats and sets', async () => {
      svc.getWorkoutPlanTemplateById.mockResolvedValue({
        id: PLAN_ID,
        plan_name: 'Push Pull Legs',
        is_active: true,
        schedule_type: 'sequential',
        assignments: [
          {
            session_index: 1,
            session_name: 'Push',
            workout_preset_name: 'Push Day',
            workout_preset_format: 'tabata',
            sets: [{ id: 's1' }],
          },
          {
            session_index: 1,
            session_name: 'Push',
            exercise_name: 'Push Up',
            sets: [{ id: 's2' }, { id: 's3' }],
          },
          {
            session_index: 2,
            session_name: 'Pull',
            workout_preset_name: 'Pull Day',
            workout_preset_format: 'standard',
          },
        ],
      });
      const result = await getTool().execute!(
        { action: 'get_workout_plan', plan_id: PLAN_ID },
        opts
      );
      expect(result).toBe(
        '# Workout Plan: Push Pull Legs (Sequential)\n\n' +
          'Session 1 — Push:\n' +
          '  1. Push Day (preset, tabata) — 1 set\n' +
          '  2. Push Up — 2 sets\n\n' +
          'Session 2 — Pull:\n' +
          '  1. Pull Day (preset)'
      );
      expect(svc.getWorkoutPlanTemplateById).toHaveBeenCalledWith(
        'user-1',
        PLAN_ID
      );
    });

    it('gets a weekly workout plan grouped by day_of_week with day names', async () => {
      svc.getWorkoutPlanTemplateById.mockResolvedValue({
        id: PLAN_ID,
        plan_name: 'Weekly Split',
        is_active: true,
        schedule_type: 'weekly',
        assignments: [
          {
            day_of_week: 1,
            workout_preset_name: 'Chest',
          },
          {
            day_of_week: 3,
            exercise_name: 'Deadlift',
            sets: [{ id: 's1' }],
          },
        ],
      });
      const result = await getTool().execute!(
        { action: 'get_workout_plan', plan_id: PLAN_ID },
        opts
      );
      expect(result).toBe(
        '# Workout Plan: Weekly Split (Weekly)\n\n' +
          'Monday:\n' +
          '  1. Chest (preset)\n\n' +
          'Wednesday:\n' +
          '  1. Deadlift — 1 set'
      );
    });

    it('returns empty message when plan has no assignments', async () => {
      svc.getWorkoutPlanTemplateById.mockResolvedValue({
        id: PLAN_ID,
        plan_name: 'Empty Plan',
        schedule_type: 'sequential',
        assignments: [],
      });
      const result = await getTool().execute!(
        { action: 'get_workout_plan', plan_id: PLAN_ID },
        opts
      );
      expect(result).toBe(
        '# Workout Plan: Empty Plan (Sequential)\n\n_No assignments in this plan._'
      );
    });

    it('returns NOT_FOUND when getting a missing plan', async () => {
      svc.getWorkoutPlanTemplateById.mockRejectedValue(
        new Error('Workout plan template not found.')
      );
      const result = await getTool().execute!(
        { action: 'get_workout_plan', plan_id: PLAN_ID },
        opts
      );
      expect(result).toBe(
        "Error [NOT_FOUND]: Workout plan with ID '" +
          PLAN_ID +
          "' not found.\n\nSuggestion: Check the ID and try again."
      );
    });
  });

  describe('get_active_workout_plan', () => {
    it('returns progression and next session for active sequential plan', async () => {
      svc.getActiveWorkoutPlanForDate.mockResolvedValue([
        {
          id: PLAN_ID,
          plan_name: 'Hypertrophy Block',
          schedule_type: 'sequential',
          sequence_position: {
            current: 2,
            total: 3,
            session_name: 'Pull Day',
          },
          next_assignments: [
            {
              workout_preset_name: 'Pull Workout',
              workout_preset_format: 'standard',
            },
            {
              exercise_name: 'Bicep Curls',
              sets: [{ id: 1 }, { id: 2 }, { id: 3 }],
            },
          ],
        },
      ]);
      const result = await getTool().execute!(
        { action: 'get_active_workout_plan', date: '2026-09-24' },
        opts
      );
      expect(result).toContain(
        '# Active Plan: **Hypertrophy Block** (Sequential)'
      );
      expect(result).toContain('Next up: Session 2 of 3 — Pull Day');
      expect(result).toContain('1. Pull Workout (preset)');
      expect(result).toContain('2. Bicep Curls — 3 sets');
    });

    it('returns today session for active weekly plan', async () => {
      // 2026-09-24 is a Thursday (day 4)
      svc.getActiveWorkoutPlanForDate.mockResolvedValue([
        {
          id: PLAN_ID,
          plan_name: '5x5 Program',
          schedule_type: 'weekly',
          assignments: [
            {
              day_of_week: 4,
              workout_preset_name: 'Thursday Strength',
            },
          ],
          // The repository selects the query date's weekday assignments.
          next_assignments: [
            {
              day_of_week: 4,
              workout_preset_name: 'Thursday Strength',
            },
          ],
        },
      ]);
      const result = await getTool().execute!(
        { action: 'get_active_workout_plan', date: '2026-09-24' },
        opts
      );
      expect(result).toContain('# Active Plan: **5x5 Program** (Weekly)');
      expect(result).toContain('Session for Thursday (2026-09-24):');
      expect(result).toContain('1. Thursday Strength (preset)');
    });

    it('returns rest day message when weekly plan has no assignments for date', async () => {
      // 2026-09-24 is a Thursday (day 4)
      svc.getActiveWorkoutPlanForDate.mockResolvedValue([
        {
          id: PLAN_ID,
          plan_name: '5x5 Program',
          schedule_type: 'weekly',
          assignments: [
            {
              day_of_week: 1, // Monday only
              workout_preset_name: 'Monday Workout',
            },
          ],
          next_assignments: [],
        },
      ]);
      const result = await getTool().execute!(
        { action: 'get_active_workout_plan', date: '2026-09-24' },
        opts
      );
      expect(result).toContain('# Active Plan: **5x5 Program** (Weekly)');
      expect(result).toContain(
        'Rest day: nothing scheduled for Thursday (2026-09-24).'
      );
    });

    it('returns not found message when no active plan exists', async () => {
      svc.getActiveWorkoutPlanForDate.mockResolvedValue([]);
      const result = await getTool().execute!(
        { action: 'get_active_workout_plan', date: '2026-09-24' },
        opts
      );
      expect(result).toBe('No active workout plan found for 2026-09-24.');
    });
  });

  describe('create_workout_plan', () => {
    it('creates sequential plan by default with preset_name and exercise_name resolution', async () => {
      presetRepo.getWorkoutPresetByName.mockResolvedValue({
        id: 101,
        name: 'Push Day',
      });
      // Substring search results: only the exact (case-insensitive) match
      // may be picked.
      exSvc.searchExercises.mockResolvedValue([
        { id: 'ex-uuid-2', name: 'Incline Bench Press' },
        { id: 'ex-uuid-1', name: 'bench press' },
      ]);
      svc.createWorkoutPlanTemplate.mockResolvedValue({
        id: PLAN_ID,
        plan_name: 'My PPL',
      });

      const result = await getTool().execute!(
        {
          action: 'create_workout_plan',
          plan_name: 'My PPL',
          sessions: [
            { preset_name: 'Push Day', session_name: 'Push' },
            {
              exercise_name: 'Bench Press',
              session_name: 'Push',
              sets: [{ reps: 10, weight: 80 }],
            },
            { preset_name: 'Push Day', session_name: 'Pull' },
          ],
        },
        opts
      );

      expect(result).toContain('Workout plan "My PPL" created');
      expect(result).toContain('sequential');
      expect(svc.createWorkoutPlanTemplate).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          plan_name: 'My PPL',
          schedule_type: 'sequential',
          entry_mode: 'prompt',
          assignments: [
            expect.objectContaining({
              workout_preset_id: 101,
              session_index: 1,
              session_name: 'Push',
            }),
            expect.objectContaining({
              exercise_id: 'ex-uuid-1',
              session_index: 1,
              session_name: 'Push',
              sets: [
                expect.objectContaining({
                  set_number: 1,
                  reps: 10,
                  weight: 80,
                }),
              ],
            }),
            expect.objectContaining({
              workout_preset_id: 101,
              session_index: 2,
              session_name: 'Pull',
            }),
          ],
        })
      );
    });

    it('coerces entry_mode prefill to prompt on sequential plan and adds notice', async () => {
      svc.createWorkoutPlanTemplate.mockResolvedValue({
        id: PLAN_ID,
        plan_name: 'Sequential Plan',
      });

      const result = await getTool().execute!(
        {
          action: 'create_workout_plan',
          plan_name: 'Sequential Plan',
          schedule_type: 'sequential',
          entry_mode: 'prefill',
        },
        opts
      );

      expect(result).toContain(
        'Note: Sequential plans only support "prompt" entry mode'
      );
      expect(svc.createWorkoutPlanTemplate).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          schedule_type: 'sequential',
          entry_mode: 'prompt',
        })
      );
    });

    it('creates weekly plan with day names parsed to 0-6', async () => {
      presetRepo.getWorkoutPresetByName.mockResolvedValue({
        id: 102,
        name: 'Full Body',
      });
      svc.createWorkoutPlanTemplate.mockResolvedValue({
        id: PLAN_ID,
        plan_name: 'Weekly Full Body',
      });

      const result = await getTool().execute!(
        {
          action: 'create_workout_plan',
          plan_name: 'Weekly Full Body',
          schedule_type: 'weekly',
          sessions: [
            { preset_name: 'Full Body', day_of_week: 'Monday' },
            { preset_name: 'Full Body', day_of_week: 'Friday' },
          ],
        },
        opts
      );

      expect(result).toContain('Workout plan "Weekly Full Body" created');
      expect(svc.createWorkoutPlanTemplate).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          schedule_type: 'weekly',
          assignments: [
            expect.objectContaining({
              workout_preset_id: 102,
              day_of_week: 1,
            }),
            expect.objectContaining({
              workout_preset_id: 102,
              day_of_week: 5,
            }),
          ],
        })
      );
    });

    it('returns NOT_FOUND-style validation error when exercise_name has no exact match', async () => {
      exSvc.searchExercises.mockResolvedValue([
        { id: 'ex-uuid-2', name: 'Incline Bench Press' },
      ]);

      const result = await getTool().execute!(
        {
          action: 'create_workout_plan',
          plan_name: 'Bench Plan',
          sessions: [{ exercise_name: 'Bench Press' }],
        },
        opts
      );

      expect(result).toContain('Error [VALIDATION]');
      expect(result).toContain('Exercise with name "Bench Press" not found');
      expect(svc.createWorkoutPlanTemplate).not.toHaveBeenCalled();
    });

    it('validates sessions passed as a JSON string', async () => {
      const result = await getTool().execute!(
        {
          action: 'create_workout_plan',
          plan_name: 'Bad JSON Items',
          sessions: JSON.stringify([{ preset_name: 'Push', bogus: 1 }]),
        },
        opts
      );

      expect(result).toContain('Error [VALIDATION]');
      expect(svc.createWorkoutPlanTemplate).not.toHaveBeenCalled();
    });

    it('maps an unknown preset ID from the service to a validation error, not plan not found', async () => {
      svc.createWorkoutPlanTemplate.mockRejectedValue(
        new Error('Workout Preset with ID 999 not found.')
      );

      const result = await getTool().execute!(
        {
          action: 'create_workout_plan',
          plan_name: 'Ghost Preset',
          sessions: [{ workout_preset_id: 999 }],
        },
        opts
      );

      expect(result).toContain('Error [VALIDATION]');
      expect(result).toContain('Workout Preset with ID 999 not found.');
    });

    it('returns validation error when weekly plan assignment is missing day_of_week', async () => {
      presetRepo.getWorkoutPresetByName.mockResolvedValue({
        id: 102,
        name: 'Full Body',
      });

      const result = await getTool().execute!(
        {
          action: 'create_workout_plan',
          plan_name: 'Weekly Invalid',
          schedule_type: 'weekly',
          sessions: [{ preset_name: 'Full Body' }],
        },
        opts
      );

      expect(result).toContain('Error [VALIDATION]');
      expect(result).toContain('missing required day_of_week');
      expect(svc.createWorkoutPlanTemplate).not.toHaveBeenCalled();
    });
  });

  describe('update_workout_plan', () => {
    it('returns confirmation prompt when confirmed is omitted', async () => {
      const result = await getTool().execute!(
        {
          action: 'update_workout_plan',
          plan_id: PLAN_ID,
          plan_name: 'New Name',
        },
        opts
      );

      expect(result).toContain(
        `Updating workout plan ${PLAN_ID} can replace all assignments`
      );
      expect(result).toContain('Nothing was changed.');
      expect(svc.updateWorkoutPlanTemplate).not.toHaveBeenCalled();
    });

    it('updates workout plan when confirmed=true', async () => {
      svc.getWorkoutPlanTemplateById.mockResolvedValue({
        id: PLAN_ID,
        plan_name: 'Old Name',
        schedule_type: 'sequential',
        entry_mode: 'prompt',
        assignments: [],
      });
      svc.updateWorkoutPlanTemplate.mockResolvedValue({
        id: PLAN_ID,
        plan_name: 'Renamed Plan',
      });

      const result = await getTool().execute!(
        {
          action: 'update_workout_plan',
          plan_id: PLAN_ID,
          confirmed: true,
          plan_name: 'Renamed Plan',
        },
        opts
      );

      expect(result).toBe('✅ Workout plan "Renamed Plan" updated.');
      expect(svc.updateWorkoutPlanTemplate).toHaveBeenCalledWith(
        'user-1',
        PLAN_ID,
        expect.objectContaining({
          plan_name: 'Renamed Plan',
        })
      );
    });
  });

  describe('update_workout_plan on weekly plans', () => {
    it('does not flip a weekly prefill plan to prompt on a rename and preserves existing fields', async () => {
      svc.getWorkoutPlanTemplateById.mockResolvedValue({
        id: PLAN_ID,
        plan_name: 'Weekly 5x5',
        description: 'Heavy strength',
        is_active: true,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        schedule_type: 'weekly',
        entry_mode: 'prefill',
        assignments: [],
      });
      svc.updateWorkoutPlanTemplate.mockResolvedValue({
        id: PLAN_ID,
        plan_name: 'Weekly 5x5 v2',
      });

      await getTool().execute!(
        {
          action: 'update_workout_plan',
          plan_id: PLAN_ID,
          confirmed: true,
          plan_name: 'Weekly 5x5 v2',
        },
        opts
      );

      const payload = svc.updateWorkoutPlanTemplate.mock.calls[0][2];
      expect(payload.entry_mode).toBe('prefill');
      expect(payload.schedule_type).toBe('weekly');
      expect(payload.is_active).toBe(true);
      expect(payload.start_date).toBe('2026-01-01');
      expect(payload.end_date).toBe('2026-12-31');
      expect(payload.description).toBe('Heavy strength');
    });

    it('resolves new sessions against the existing weekly schedule', async () => {
      svc.getWorkoutPlanTemplateById.mockResolvedValue({
        id: PLAN_ID,
        plan_name: 'Weekly 5x5',
        schedule_type: 'weekly',
        entry_mode: 'prefill',
        assignments: [],
      });
      presetRepo.getWorkoutPresetByName.mockResolvedValue({
        id: 7,
        name: 'Squat Day',
      });
      svc.updateWorkoutPlanTemplate.mockResolvedValue({
        id: PLAN_ID,
        plan_name: 'Weekly 5x5',
      });

      await getTool().execute!(
        {
          action: 'update_workout_plan',
          plan_id: PLAN_ID,
          confirmed: true,
          sessions: [{ preset_name: 'Squat Day', day_of_week: 'Wed' }],
        },
        opts
      );

      expect(svc.updateWorkoutPlanTemplate).toHaveBeenCalledWith(
        'user-1',
        PLAN_ID,
        expect.objectContaining({
          assignments: [
            expect.objectContaining({
              workout_preset_id: 7,
              day_of_week: 3,
              session_index: null,
            }),
          ],
        })
      );
    });
  });

  describe('delete_workout_plan', () => {
    it('returns confirmation prompt when confirmed is omitted', async () => {
      const result = await getTool().execute!(
        { action: 'delete_workout_plan', plan_id: PLAN_ID },
        opts
      );

      expect(result).toContain(
        `Deleting workout plan ${PLAN_ID} is permanent. Confirm with the user first.`
      );
      expect(result).toContain('Nothing was deleted.');
      expect(svc.deleteWorkoutPlanTemplate).not.toHaveBeenCalled();
    });

    it('deletes a workout plan when confirmed=true', async () => {
      svc.deleteWorkoutPlanTemplate.mockResolvedValue({
        message: 'Workout plan template deleted successfully.',
      });
      const result = await getTool().execute!(
        { action: 'delete_workout_plan', plan_id: PLAN_ID, confirmed: true },
        opts
      );
      expect(result).toBe('✅ Workout plan deleted.');
      expect(svc.deleteWorkoutPlanTemplate).toHaveBeenCalledWith(
        'user-1',
        PLAN_ID
      );
    });

    it('returns NOT_FOUND when deleting a missing plan', async () => {
      svc.deleteWorkoutPlanTemplate.mockRejectedValue(
        new Error('Workout plan template not found.')
      );
      const result = await getTool().execute!(
        { action: 'delete_workout_plan', plan_id: PLAN_ID, confirmed: true },
        opts
      );
      expect(result).toBe(
        "Error [NOT_FOUND]: Workout plan with ID '" +
          PLAN_ID +
          "' not found.\n\nSuggestion: Check the ID and try again."
      );
    });
  });

  describe('validation and error handling', () => {
    it('rejects a non-integer plan_id (VALIDATION)', async () => {
      const result = await getTool().execute!(
        { action: 'get_workout_plan', plan_id: 'not-a-number' },
        opts
      );
      expect(result).toContain('Error [VALIDATION]');
      expect(svc.getWorkoutPlanTemplateById).not.toHaveBeenCalled();
    });

    it('returns DB_ERROR when the service throws a generic error', async () => {
      svc.getWorkoutPlanTemplatesByUserId.mockRejectedValue(new Error('boom'));
      const result = await getTool().execute!(
        { action: 'list_workout_plans' },
        opts
      );
      expect(result).toBe(DB_ERROR_TEXT);
    });
  });
});
