import { tool } from 'ai';
import { todayInZone } from '@workspace/shared';
import { z } from 'zod';
import workoutPlanTemplateService from '../../services/workoutPlanTemplateService.js';
import plannedWorkoutScheduleService from '../../services/plannedWorkoutScheduleService.js';
import workoutPresetRepository from '../../models/workoutPresetRepository.js';
import { log } from '../../config/logging.js';
import {
  formatConfirmation,
  formatJsonResult,
  formatList,
} from './formatting.js';
import { ERRORS, formatZodError, toolError } from './errors.js';
import {
  manageWorkoutPlansSchema,
  manageWorkoutPlansInput,
  WORKOUT_PLAN_ACTIONS,
  type ManageWorkoutPlansInput,
} from './schemas/workoutPlans.js';
import { normalizeActionArgs } from './dates.js';

const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD calendar day');

const workoutPlanAssignmentSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    weekIndex: z.number().int().min(0).max(7).optional(),
    workoutPresetName: z.string().trim().min(1).max(255),
  })
  .strict();

const listNativeWorkoutPlansSchema = z
  .object({ action: z.literal('list') })
  .strict();

const upsertWorkoutPlanSchema = z
  .object({
    action: z.literal('upsert'),
    planName: z.string().trim().min(1).max(255),
    description: z.string().trim().max(2_000).optional(),
    startDate: calendarDaySchema,
    endDate: calendarDaySchema.optional(),
    isActive: z.boolean().optional().default(true),
    cycleLengthWeeks: z.number().int().min(1).max(8).optional(),
    assignments: z.array(workoutPlanAssignmentSchema).min(1).max(14),
    currentClientDate: calendarDaySchema.optional(),
  })
  .strict()
  .refine((value) => !value.endDate || value.endDate >= value.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })
  .refine(
    (value) =>
      value.assignments.every(
        (assignment) =>
          (assignment.weekIndex ?? 0) < (value.cycleLengthWeeks ?? 1)
      ),
    {
      message:
        'Every assignment weekIndex must be smaller than cycleLengthWeeks',
      path: ['assignments'],
    }
  );

const setWorkoutPlanActiveSchema = z
  .object({
    action: z.literal('set_active'),
    planName: z.string().trim().min(1).max(255),
    isActive: z.boolean(),
    currentClientDate: calendarDaySchema.optional(),
  })
  .strict();

const manageNativeWorkoutPlanSchema = z.discriminatedUnion('action', [
  listNativeWorkoutPlansSchema,
  upsertWorkoutPlanSchema,
  setWorkoutPlanActiveSchema,
]);

const manageCombinedWorkoutPlanSchema = z.union([
  manageWorkoutPlansSchema,
  manageNativeWorkoutPlanSchema,
]);

const NATIVE_WORKOUT_PLAN_ACTIONS = ['list', 'upsert', 'set_active'] as const;
const VALID_ACTIONS = [
  ...WORKOUT_PLAN_ACTIONS,
  ...NATIVE_WORKOUT_PLAN_ACTIONS,
] as const;

// Keep the published schema flat while exposing both upstream template
// inspection/deletion and the fork's owner-requested plan-writing operations.
const manageCombinedWorkoutPlansInput = manageWorkoutPlansInput.extend({
  action: z.enum(VALID_ACTIONS).optional(),
  planName: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(2_000).optional(),
  startDate: calendarDaySchema.optional(),
  endDate: calendarDaySchema.optional(),
  isActive: z.boolean().optional(),
  cycleLengthWeeks: z.number().int().min(1).max(8).optional(),
  assignments: z.array(workoutPlanAssignmentSchema).max(14).optional(),
  currentClientDate: calendarDaySchema.optional(),
});

type NativeWorkoutPlanInput = z.infer<typeof manageNativeWorkoutPlanSchema>;

interface WorkoutPresetLookup {
  id: number;
  name: string;
}

interface WorkoutPlanAssignmentRecord {
  id?: number;
  day_of_week: number;
  week_index: number;
  workout_preset_id: number;
  workout_preset_name?: string;
  exercise_id?: string | null;
  sort_order: number;
  sets: unknown[];
}

interface WorkoutPlanRecord {
  id: number;
  plan_name: string;
  description: string | null;
  start_date: string | Date;
  end_date: string | Date | null;
  is_active: boolean;
  cycle_length_weeks: number;
  assignments: WorkoutPlanAssignmentRecord[];
}

interface WorkoutPlanAssignmentRow {
  day_of_week: number;
  workout_preset_name?: string | null;
  exercise_name?: string | null;
  sets?: unknown[] | null;
}

interface WorkoutPlanTemplateRow {
  id: number | string;
  plan_name: string;
  description?: string | null;
  is_active?: boolean;
  assignments?: WorkoutPlanAssignmentRow[];
}

class WorkoutPresetNotFoundError extends Error {
  constructor(presetName: string) {
    super(`Workout preset "${presetName}" was not found.`);
    this.name = 'WorkoutPresetNotFoundError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asPositiveInteger(value: unknown): number | null {
  const candidate = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
}

function asWorkoutPlan(value: unknown): WorkoutPlanRecord | null {
  if (!isRecord(value)) return null;
  const id = asPositiveInteger(value.id);
  if (id === null || typeof value.plan_name !== 'string') return null;
  return {
    id,
    plan_name: value.plan_name,
    description:
      typeof value.description === 'string' ? value.description : null,
    start_date:
      typeof value.start_date === 'string' || value.start_date instanceof Date
        ? value.start_date
        : '',
    end_date:
      typeof value.end_date === 'string' || value.end_date instanceof Date
        ? value.end_date
        : null,
    is_active: value.is_active === true,
    cycle_length_weeks: asPositiveInteger(value.cycle_length_weeks) ?? 1,
    assignments: Array.isArray(value.assignments)
      ? (value.assignments as WorkoutPlanAssignmentRecord[])
      : [],
  };
}

async function listPlans(userId: string): Promise<WorkoutPlanRecord[]> {
  const raw: unknown =
    await workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId(userId);
  return Array.isArray(raw)
    ? raw
        .map(asWorkoutPlan)
        .filter((plan): plan is WorkoutPlanRecord => plan !== null)
    : [];
}

async function resolvePreset(
  userId: string,
  presetName: string
): Promise<WorkoutPresetLookup> {
  const raw: unknown = await workoutPresetRepository.getWorkoutPresetByName(
    userId,
    presetName
  );
  if (!isRecord(raw)) {
    throw new WorkoutPresetNotFoundError(presetName);
  }
  const id = asPositiveInteger(raw.id);
  if (id === null) {
    throw new Error(`Workout preset "${presetName}" has an invalid ID.`);
  }
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : presetName,
  };
}

async function resolveAssignments(
  userId: string,
  assignments: z.infer<typeof workoutPlanAssignmentSchema>[]
): Promise<WorkoutPlanAssignmentRecord[]> {
  return Promise.all(
    assignments.map(async (assignment, index) => {
      const preset = await resolvePreset(userId, assignment.workoutPresetName);
      return {
        day_of_week: assignment.dayOfWeek,
        week_index: assignment.weekIndex ?? 0,
        workout_preset_id: preset.id,
        workout_preset_name: preset.name,
        exercise_id: null,
        sort_order: index,
        sets: [],
      };
    })
  );
}

function workoutPlanToolError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  log('error', `[workoutPlanTools] Workout plan operation failed: ${message}`);
  if (error instanceof WorkoutPresetNotFoundError) {
    return toolError(
      'WORKOUT_PRESET_NOT_FOUND',
      message,
      'Do not retry this native plan write with the same missing preset. For a Speediance program, call sparky_manage_speediance_workouts action=create_plan with the complete workouts and schedule; it upserts the Speediance workouts and canonical presets before writing the plan. For a native-only plan, create the missing workout preset first.'
    );
  }
  return toolError('WORKOUT_PLAN_ERROR', message);
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function formatAssignment(assignment: WorkoutPlanAssignmentRow): string {
  const day =
    DAY_NAMES[assignment.day_of_week] ?? `Day ${assignment.day_of_week}`;
  const item =
    assignment.workout_preset_name ??
    assignment.exercise_name ??
    'Unknown item';
  const setCount = assignment.sets?.length ?? 0;
  const sets =
    setCount > 0 ? ` — ${setCount} set${setCount === 1 ? '' : 's'}` : '';
  return `${day}: ${item}${sets}`;
}

async function executeTemplateAction(
  userId: string,
  args: ManageWorkoutPlansInput
): Promise<string> {
  try {
    switch (args.action) {
      case 'list_workout_plans': {
        const rows =
          (await workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId(
            userId
          )) as unknown as WorkoutPlanTemplateRow[];
        return formatList(rows, 'Workout Plans', (row) => {
          const count = row.assignments?.length ?? 0;
          const state = row.is_active ? 'active' : 'inactive';
          return `**${row.plan_name}** (${state}, ${count} assignment${count === 1 ? '' : 's'})\n  ID: ${row.id}`;
        });
      }
      case 'get_workout_plan': {
        const plan =
          (await workoutPlanTemplateService.getWorkoutPlanTemplateById(
            userId,
            args.plan_id
          )) as unknown as WorkoutPlanTemplateRow;
        return formatList(
          plan.assignments ?? [],
          `Workout Plan: ${plan.plan_name}`,
          formatAssignment
        );
      }
      case 'delete_workout_plan':
        await workoutPlanTemplateService.deleteWorkoutPlanTemplate(
          userId,
          args.plan_id
        );
        return formatConfirmation('Workout plan deleted.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.toLowerCase().includes('not found')) {
      return ERRORS.NOT_FOUND(
        'Workout plan',
        'plan_id' in args ? String(args.plan_id) : ''
      );
    }
    log('error', '[Workout Plan Tool] Error:', error);
    return ERRORS.DB_ERROR(error);
  }
}

async function executeNativeAction(
  userId: string,
  timezone: string,
  args: NativeWorkoutPlanInput
): Promise<string> {
  try {
    const plans = await listPlans(userId);
    if (args.action === 'list') {
      const timeline = await plannedWorkoutScheduleService.getTrainingTimeline(
        userId,
        todayInZone(timezone)
      );
      return formatJsonResult({ plans, timeline });
    }

    const currentClientDate = args.currentClientDate ?? todayInZone(timezone);
    const existing = plans.find((plan) => plan.plan_name === args.planName);

    if (args.action === 'set_active') {
      if (!existing) {
        return toolError(
          'WORKOUT_PLAN_NOT_FOUND',
          `Workout plan "${args.planName}" was not found.`
        );
      }
      const updated: unknown =
        await workoutPlanTemplateService.updateWorkoutPlanTemplate(
          userId,
          existing.id,
          {
            plan_name: existing.plan_name,
            description: existing.description,
            start_date: existing.start_date,
            end_date: existing.end_date,
            is_active: args.isActive,
            cycle_length_weeks: existing.cycle_length_weeks,
            assignments: existing.assignments,
            currentClientDate,
          }
        );
      return formatJsonResult({ plan: updated, operation: 'updated' });
    }

    const assignments = await resolveAssignments(userId, args.assignments);
    const planData = {
      plan_name: args.planName,
      description: args.description ?? null,
      start_date: args.startDate,
      end_date: args.endDate ?? null,
      is_active: args.isActive,
      cycle_length_weeks: args.cycleLengthWeeks ?? 1,
      assignments,
      currentClientDate,
    };

    if (existing) {
      const updated: unknown =
        await workoutPlanTemplateService.updateWorkoutPlanTemplate(
          userId,
          existing.id,
          planData
        );
      return formatJsonResult({ plan: updated, operation: 'updated' });
    }

    const created: unknown =
      await workoutPlanTemplateService.createWorkoutPlanTemplate(
        userId,
        planData
      );
    return formatJsonResult({ plan: created, operation: 'created' });
  } catch (error) {
    return workoutPlanToolError(error);
  }
}

export function buildWorkoutPlanTools(userId: string, timezone: string) {
  return {
    sparky_manage_workout_plans: tool({
      description: `List and inspect native SparkyFitness workout plans, delete a plan, or—after an explicit user request—create, update, and activate a plan made from existing workout presets.

This tool takes a FLAT object with an "action" field. Do NOT nest fields under the action name.

Actions:
- action: 'list_workout_plans' — list saved plan templates with IDs
- action: 'get_workout_plan' (fields: plan_id) — inspect one plan's assignments
- action: 'delete_workout_plan' (fields: plan_id) — permanently delete a plan
- action: 'list' — return native plans plus the canonical completed/missed/upcoming training timeline and exact exercise/set counts
- action: 'upsert' (fields: planName, startDate, assignments, optional description/endDate/isActive/cycleLengthWeeks/currentClientDate) — create or replace the same-named native plan
- action: 'set_active' (fields: planName, isActive, optional currentClientDate) — activate or deactivate a native plan

Call a write action only after the user explicitly asked for it. Each workoutPresetName must already exist in sparky_manage_exercise action=get_workout_presets. Never introduce a new Speediance workout here; use sparky_manage_speediance_workouts action=create_plan so remote workouts and canonical presets are synchronized before the schedule is written. Prefer stable multi-week plans adapted from saved training feedback.`,
      inputSchema: manageCombinedWorkoutPlansInput,
      execute: async (rawArgs) => {
        const normalized = normalizeActionArgs(
          rawArgs,
          timezone,
          [...VALID_ACTIONS],
          () => 'list_workout_plans'
        );
        const parsed = manageCombinedWorkoutPlanSchema.safeParse(normalized);
        if (!parsed.success) return formatZodError(parsed.error);

        if (
          parsed.data.action === 'list_workout_plans' ||
          parsed.data.action === 'get_workout_plan' ||
          parsed.data.action === 'delete_workout_plan'
        ) {
          return executeTemplateAction(userId, parsed.data);
        }
        return executeNativeAction(userId, timezone, parsed.data);
      },
    }),
  };
}

export default { buildWorkoutPlanTools };
