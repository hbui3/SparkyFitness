import workoutPlanTemplateRepository from '../models/workoutPlanTemplateRepository.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';
import exerciseRepository from '../models/exerciseRepository.js';
import { log } from '../config/logging.js';
import { resolveTemplateStartDay } from '../utils/timezoneLoader.js';

export interface WorkoutPlanAssignmentSetInput {
  id?: number | string | null;
  set_number: number;
  set_type?: string | null;
  reps?: number | null;
  weight?: number | null;
  duration?: number | null;
  rest_time?: number | null;
  notes?: string | null;
}

export interface WorkoutPlanAssignmentInput {
  id?: number | string | null;
  day_of_week?: number | null;
  week_index?: number;
  session_index?: number | null;
  session_name?: string | null;
  workout_preset_id?: number | string | null;
  exercise_id?: string | null;
  sort_order?: number | null;
  sets?: WorkoutPlanAssignmentSetInput[] | null;
}

export interface CreateWorkoutPlanTemplateInput {
  plan_name: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active?: boolean | null;
  cycle_length_weeks?: number | null;
  schedule_type?: 'weekly' | 'sequential';
  entry_mode?: 'prompt' | 'prefill';
  assignments?: WorkoutPlanAssignmentInput[] | null;
  currentClientDate?: string | null;
}

export interface UpdateWorkoutPlanTemplateInput {
  plan_name?: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active?: boolean | null;
  cycle_length_weeks?: number | null;
  schedule_type?: 'weekly' | 'sequential';
  entry_mode?: 'prompt' | 'prefill';
  assignments?: WorkoutPlanAssignmentInput[] | null;
  currentClientDate?: string | null;
}

function validatePlanCycle(
  cycleLengthWeeks: number,
  assignments: WorkoutPlanAssignmentInput[]
): void {
  if (
    !Number.isInteger(cycleLengthWeeks) ||
    cycleLengthWeeks < 1 ||
    cycleLengthWeeks > 8
  ) {
    throw new Error('Workout plan cycle_length_weeks must be between 1 and 8.');
  }
  if (
    assignments.some(
      (assignment) =>
        (assignment.week_index ?? 0) < 0 ||
        (assignment.week_index ?? 0) >= cycleLengthWeeks
    )
  ) {
    throw new Error(
      'Every workout plan assignment week_index must fall within the plan cycle.'
    );
  }
}

async function validateAndNormalizeAssignments(
  assignments: WorkoutPlanAssignmentInput[],
  scheduleType: 'weekly' | 'sequential',
  userId: string
): Promise<void> {
  for (const assignment of assignments) {
    if (scheduleType === 'weekly') {
      if (
        assignment.day_of_week === undefined ||
        assignment.day_of_week === null ||
        assignment.day_of_week < 0 ||
        assignment.day_of_week > 6
      ) {
        throw new Error(
          'Weekly workout plan assignments must have a valid day_of_week (0-6).'
        );
      }
    } else if (scheduleType === 'sequential') {
      assignment.day_of_week = null;
    }
    if (assignment.workout_preset_id) {
      const preset = await workoutPresetRepository.getWorkoutPresetById(
        assignment.workout_preset_id,
        userId
      );
      if (!preset) {
        throw new Error(
          `Workout Preset with ID ${assignment.workout_preset_id} not found.`
        );
      }
    }
    if (assignment.exercise_id) {
      const exercise = await exerciseRepository.getExerciseById(
        assignment.exercise_id,
        userId
      );
      if (!exercise) {
        throw new Error(
          `Exercise with ID ${assignment.exercise_id} not found.`
        );
      }
    }
  }
}

async function createWorkoutPlanTemplate(
  userId: string,
  planData: CreateWorkoutPlanTemplateInput
) {
  log(
    'info',
    'createWorkoutPlanTemplate service - received planData:',
    planData
  );
  // Validate assignments
  const scheduleType =
    planData.schedule_type ||
    (planData.cycle_length_weeks !== undefined ? 'weekly' : 'sequential');
  validatePlanCycle(
    planData.cycle_length_weeks ?? 1,
    planData.assignments ?? []
  );
  const entryMode =
    scheduleType === 'sequential' ? 'prompt' : planData.entry_mode || 'prompt';
  if (planData.assignments) {
    await validateAndNormalizeAssignments(
      planData.assignments,
      scheduleType,
      userId
    );
  }
  try {
    const newPlan =
      await workoutPlanTemplateRepository.createWorkoutPlanTemplate({
        ...planData,
        schedule_type: scheduleType,
        entry_mode: entryMode,
        user_id: userId,
      });
    log(
      'info',
      'createWorkoutPlanTemplate service - newPlan created:',
      newPlan
    );
    if (
      newPlan.is_active &&
      newPlan.schedule_type !== 'sequential' &&
      newPlan.entry_mode === 'prefill'
    ) {
      log(
        'info',
        `createWorkoutPlanTemplate service - New plan is active, weekly, and prefill, creating exercise entries from template ${newPlan.id}`
      );
      const today = await resolveTemplateStartDay(
        userId,
        planData.currentClientDate
      );
      await exerciseRepository.createExerciseEntriesFromTemplate(
        newPlan.id,
        userId,
        today
      );
    } else {
      log(
        'info',
        'createWorkoutPlanTemplate service - Skipping exercise entry creation (inactive, sequential, or prompt mode).'
      );
    }
    return newPlan;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(
      'error',
      `Error creating workout plan template for user ${userId}: ${message}`,
      error
    );
    throw new Error('Failed to create workout plan template.', {
      cause: error,
    });
  }
}

async function getWorkoutPlanTemplatesByUserId(userId: string) {
  return workoutPlanTemplateRepository.getWorkoutPlanTemplatesByUserId(userId);
}

async function getWorkoutPlanTemplateById(
  userId: string,
  templateId: string | number
) {
  // RLS already gates read access (owner or family-shared via
  // can_view_exercise_library). If the row comes back, the caller is allowed to
  // see it; an extra owner check here would wrongly 403 shared templates.
  const template =
    await workoutPlanTemplateRepository.getWorkoutPlanTemplateById(
      templateId,
      userId
    );
  if (!template) {
    throw new Error('Workout plan template not found.');
  }
  return template;
}

/**
 * Updates a workout plan template owned by the user. For a stored prefill plan
 * the entries it generated from today on are removed first (logged and edited
 * entries are kept, see deleteExerciseEntriesByTemplateId); prompt and
 * sequential plans never generate entries, so nothing is removed. If the
 * updated plan is an active weekly prefill plan, its entries are regenerated.
 *
 * @param userId - Owner of the template.
 * @param templateId - Template to update.
 * @param updateData - Changed fields, assignments and the client's current date.
 * @returns The updated plan.
 */
async function updateWorkoutPlanTemplate(
  userId: string,
  templateId: string | number,
  updateData: UpdateWorkoutPlanTemplateInput
) {
  log(
    'info',
    `updateWorkoutPlanTemplate service - received updateData for template ${templateId}:`,
    updateData
  );
  const ownerId =
    await workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId(
      templateId,
      userId
    );
  if (!ownerId) {
    throw new Error('Workout plan template not found.');
  }
  if (ownerId !== userId) {
    throw new Error(
      'Forbidden: You do not have permission to update this workout plan template.'
    );
  }
  // Also needed to know whether the stored plan generates diary entries at all.
  const existingTemplate =
    await workoutPlanTemplateRepository.getWorkoutPlanTemplateById(
      templateId,
      userId
    );
  if (!existingTemplate) throw new Error('Workout plan template not found.');
  validatePlanCycle(
    updateData.cycle_length_weeks ?? existingTemplate.cycle_length_weeks ?? 1,
    updateData.assignments ?? existingTemplate.assignments ?? []
  );
  // If schedule_type changed between weekly and sequential, require updated assignments
  if (
    updateData.schedule_type &&
    existingTemplate?.schedule_type &&
    updateData.schedule_type !== existingTemplate.schedule_type &&
    !updateData.assignments
  ) {
    throw new Error(
      'Changing schedule_type requires providing updated assignments.'
    );
  }
  // Validate assignments if they are being updated
  if (updateData.assignments) {
    const scheduleType: 'weekly' | 'sequential' =
      updateData.schedule_type ||
      (existingTemplate?.schedule_type === 'sequential'
        ? 'sequential'
        : 'weekly');
    await validateAndNormalizeAssignments(
      updateData.assignments,
      scheduleType,
      userId
    );
  }
  try {
    const today = await resolveTemplateStartDay(
      userId,
      updateData.currentClientDate
    );
    // When a prefill plan is updated, remove the entries it generated so they
    // can be regenerated. A prompt or sequential plan never generates entries;
    // every row linked to it was logged by the user, so there is nothing to
    // remove.
    const storedPlanGeneratesEntries =
      !existingTemplate ||
      (existingTemplate.schedule_type !== 'sequential' &&
        existingTemplate.entry_mode !== 'prompt');
    if (storedPlanGeneratesEntries) {
      log(
        'info',
        `updateWorkoutPlanTemplate service - Deleting generated exercise entries for template ${templateId}`
      );
      await exerciseRepository.deleteExerciseEntriesByTemplateId(
        templateId,
        userId,
        today
      );
    } else {
      log(
        'info',
        `updateWorkoutPlanTemplate service - Template ${templateId} does not generate entries (prompt or sequential), nothing to delete`
      );
    }
    const shouldUnlinkHistoricalEntries =
      existingTemplate?.schedule_type === 'weekly' &&
      updateData.schedule_type === 'sequential';
    if (shouldUnlinkHistoricalEntries) {
      log(
        'info',
        `updateWorkoutPlanTemplate service - Unlinking historical exercise entries for template ${templateId} on transition to sequential`
      );
    }
    const mergedUpdateData = {
      plan_name: updateData.plan_name ?? existingTemplate.plan_name,
      description:
        updateData.description !== undefined
          ? updateData.description
          : existingTemplate.description,
      start_date: updateData.start_date ?? existingTemplate.start_date,
      end_date:
        updateData.end_date !== undefined
          ? updateData.end_date
          : existingTemplate.end_date,
      is_active: updateData.is_active ?? existingTemplate.is_active,
      cycle_length_weeks:
        updateData.cycle_length_weeks ??
        existingTemplate.cycle_length_weeks ??
        1,
      assignments: updateData.assignments ?? existingTemplate.assignments,
      currentClientDate: updateData.currentClientDate,
      ...(updateData.schedule_type || existingTemplate.schedule_type
        ? {
            schedule_type:
              updateData.schedule_type ?? existingTemplate.schedule_type,
          }
        : {}),
      ...(updateData.entry_mode || existingTemplate.entry_mode
        ? { entry_mode: updateData.entry_mode ?? existingTemplate.entry_mode }
        : {}),
    };
    const payload =
      updateData.schedule_type === 'sequential'
        ? { ...mergedUpdateData, entry_mode: 'prompt' as const }
        : mergedUpdateData;
    const updatedPlan =
      await workoutPlanTemplateRepository.updateWorkoutPlanTemplate(
        templateId,
        userId,
        payload,
        shouldUnlinkHistoricalEntries
      );
    log(
      'info',
      'updateWorkoutPlanTemplate service - updatedPlan:',
      updatedPlan
    );
    if (
      updatedPlan.is_active &&
      updatedPlan.schedule_type !== 'sequential' &&
      updatedPlan.entry_mode === 'prefill'
    ) {
      log(
        'info',
        `updateWorkoutPlanTemplate service - Updated plan is active, weekly, and prefill, creating exercise entries from template ${updatedPlan.id}`
      );
      await exerciseRepository.createExerciseEntriesFromTemplate(
        updatedPlan.id,
        userId,
        today
      );
    } else {
      log(
        'info',
        'updateWorkoutPlanTemplate service - Skipping exercise entry creation (inactive, sequential, or prompt mode).'
      );
    }
    return updatedPlan;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(
      'error',
      `Error updating workout plan template ${templateId} for user ${userId}: ${message}`,
      error
    );
    throw new Error('Failed to update workout plan template.', {
      cause: error,
    });
  }
}

async function deleteWorkoutPlanTemplate(
  userId: string,
  templateId: string | number
) {
  log(
    'info',
    `deleteWorkoutPlanTemplate service - received templateId: ${templateId} for user: ${userId}`
  );
  const ownerId =
    await workoutPlanTemplateRepository.getWorkoutPlanTemplateOwnerId(
      templateId,
      userId
    );
  if (ownerId === null || ownerId === undefined) {
    throw new Error('Workout plan template not found.');
  }
  if (ownerId !== userId) {
    throw new Error(
      'Forbidden: You do not have permission to delete this workout plan template.'
    );
  }
  try {
    // Delete future associated exercise entries, and decouple past ones via ON DELETE SET NULL
    log(
      'info',
      `deleteWorkoutPlanTemplate service - Deleting future associated exercise entries for template ${templateId}`
    );
    const today = await resolveTemplateStartDay(userId);
    await exerciseRepository.deleteExerciseEntriesByTemplateId(
      templateId,
      userId,
      today
    );
    const deleted =
      await workoutPlanTemplateRepository.deleteWorkoutPlanTemplate(
        templateId,
        userId
      );
    if (!deleted) {
      throw new Error(
        'Workout plan template not found or could not be deleted.'
      );
    }
    log('info', `Workout plan template ${templateId} deleted successfully.`);
    return { message: 'Workout plan template deleted successfully.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(
      'error',
      `Error deleting workout plan template ${templateId} for user ${userId}: ${message}`,
      error
    );
    throw new Error('Failed to delete workout plan template.', {
      cause: error,
    });
  }
}

async function getActiveWorkoutPlanForDate(userId: string, date: string) {
  return workoutPlanTemplateRepository.getActiveWorkoutPlanForDate(
    userId,
    date
  );
}

export { createWorkoutPlanTemplate };
export { getWorkoutPlanTemplatesByUserId };
export { getWorkoutPlanTemplateById };
export { updateWorkoutPlanTemplate };
export { deleteWorkoutPlanTemplate };
export { getActiveWorkoutPlanForDate };
export default {
  createWorkoutPlanTemplate,
  getWorkoutPlanTemplatesByUserId,
  getWorkoutPlanTemplateById,
  updateWorkoutPlanTemplate,
  deleteWorkoutPlanTemplate,
  getActiveWorkoutPlanForDate,
};
