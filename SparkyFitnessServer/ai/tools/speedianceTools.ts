import { tool } from 'ai';
import {
  speedianceCreateAndScheduleWorkoutRequestSchema,
  speedianceExerciseSearchRequestSchema,
  speedianceManageWorkoutRequestSchema,
} from '@workspace/shared';
import { log } from '../../config/logging.js';
import speedianceWorkoutService, {
  SpeedianceWorkoutConflictError,
  SpeedianceWorkoutValidationError,
} from '../../integrations/speediance/speedianceWorkoutService.js';
import {
  SpeedianceApiError,
  SpeedianceAuthenticationError,
} from '../../integrations/speediance/speedianceApiClient.js';
import { formatJsonResult } from './formatting.js';
import { toolError } from './errors.js';

function speedianceToolError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  log('error', `[speedianceTools] Speediance operation failed: ${message}`);
  if (
    error instanceof SpeedianceWorkoutValidationError ||
    error instanceof SpeedianceWorkoutConflictError
  ) {
    return toolError('SPEEDIANCE_VALIDATION', message);
  }
  if (error instanceof SpeedianceAuthenticationError) {
    return toolError(
      'SPEEDIANCE_AUTH',
      'The configured Speediance account could not be authenticated.',
      'Ask the user to verify the Speediance provider credentials and region in Settings.'
    );
  }
  if (error instanceof SpeedianceApiError) {
    return toolError(
      'SPEEDIANCE_API',
      message,
      'Do not blindly retry a write. Report the failure and preserve the presented plan.'
    );
  }
  return toolError(
    'SPEEDIANCE_ERROR',
    'The Speediance operation failed unexpectedly.'
  );
}

export function buildSpeedianceTools(userId: string) {
  return {
    sparky_search_speediance_exercises: tool({
      description:
        "Search the authenticated owner's real Speediance Gym Monster exercise library. First read sparky_manage_training_feedback action=context, then use a specific query. The result includes exact groupId/title/variantId, accessories, unilateral behavior, and whether the exercise is compatible with workout creation. variantId is the German coach/video variant; compatibleForWorkout is false when Speediance has no German coach video for that exercise.",
      inputSchema: speedianceExerciseSearchRequestSchema,
      execute: async (args) => {
        try {
          return formatJsonResult(
            await speedianceWorkoutService.searchSpeedianceExercises(
              userId,
              args
            )
          );
        } catch (error) {
          return speedianceToolError(error);
        }
      },
    }),

    sparky_schedule_speediance_workout: tool({
      description:
        'Create (or idempotently reuse) a rep-based Speediance Gym Monster workout with the Gain Muscle preset, then schedule it on a YYYY-MM-DD date. This writes to the external Speediance account. Call only after the user explicitly asked to create/schedule the presented workout. First read sparky_manage_training_feedback action=context and adapt the plan to its volume/rest guidance and active preferences. Every expectedTitle, groupId, and German-coach variantId must come from sparky_search_speediance_exercises and compatibleForWorkout must be true. Never substitute another coach/video variant. An avoided exercise is blocked unless the user explicitly overrides the listed preference and its ID is included in acknowledgedPreferenceIds. Existing same-name workouts are reused only when all exercises and sets match; conflicts and ambiguous calendar state are blocked. If the user asked for recurring or multi-week planning, also maintain a canonical Sparky workout preset with the same workout name and use sparky_manage_workout_plans to assign that preset to fixed weekdays; one Speediance calendar reservation alone is not a recurring Sparky plan.',
      inputSchema: speedianceCreateAndScheduleWorkoutRequestSchema,
      execute: async (args) => {
        try {
          return formatJsonResult(
            await speedianceWorkoutService.createAndScheduleSpeedianceWorkout(
              userId,
              args
            )
          );
        } catch (error) {
          return speedianceToolError(error);
        }
      },
    }),

    sparky_manage_speediance_workouts: tool({
      description:
        'Complete owner-only Speediance workout and program manager. It lists and reads exact remote workouts; atomically transforms or clones an existing workout; creates or updates complete workouts; schedules exact dates; and creates an active date-bounded multi-month Sparky plan while synchronizing every workout and date to Speediance. For simple edits use action=transform after action=get: add_warmups is idempotent and inserts real presetId 0 warm-up blocks, adjust_sets changes a matching block, replace_exercise preserves its sets, and newName clones instead of overwriting. For a new A/B or multi-week program use one create_plan call: it upserts every supplied workout before replacing the native plan, supports cycleLengthWeeks/weekIndex rotation, and materializes the calendar. Do not call sparky_manage_workout_plans first for Speediance programs. Always call get before describing an existing workout and report exact setType values; never infer warm-ups. Search replacement exercise IDs with sparky_search_speediance_exercises and use only its German variantId. External writes require explicit user intent. A write is complete only when this tool returns success; report failedDates and errors verbatim instead of claiming success.',
      inputSchema: speedianceManageWorkoutRequestSchema,
      execute: async (args) => {
        try {
          switch (args.action) {
            case 'list':
              return formatJsonResult(
                await speedianceWorkoutService.listSpeedianceWorkouts(
                  userId,
                  args.providerId
                )
              );
            case 'get':
              return formatJsonResult(
                await speedianceWorkoutService.getSpeedianceWorkout(
                  userId,
                  args.code,
                  args.providerId
                )
              );
            case 'upsert':
              return formatJsonResult(
                await speedianceWorkoutService.upsertSpeedianceWorkout(
                  userId,
                  args.workout
                )
              );
            case 'transform':
              return formatJsonResult(
                await speedianceWorkoutService.transformSpeedianceWorkout(
                  userId,
                  args.request
                )
              );
            case 'schedule':
              return formatJsonResult(
                await speedianceWorkoutService.setSpeedianceWorkoutSchedule(
                  userId,
                  args.code,
                  args.date,
                  true,
                  args.providerId
                )
              );
            case 'unschedule':
              return formatJsonResult(
                await speedianceWorkoutService.setSpeedianceWorkoutSchedule(
                  userId,
                  args.code,
                  args.date,
                  false,
                  args.providerId
                )
              );
            case 'create_plan':
              return formatJsonResult(
                await speedianceWorkoutService.createSpeediancePlan(
                  userId,
                  args.plan
                )
              );
            case 'delete':
              return formatJsonResult(
                await speedianceWorkoutService.deleteSpeedianceWorkout(
                  userId,
                  args.id,
                  args.code,
                  args.confirmName,
                  args.providerId
                )
              );
          }
        } catch (error) {
          return speedianceToolError(error);
        }
      },
    }),
  };
}

export default { buildSpeedianceTools };
