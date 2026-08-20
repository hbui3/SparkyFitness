import { tool } from 'ai';
import { z } from 'zod';
import {
  forgetTrainingPreferenceRequestSchema,
  recordTrainingFeedbackRequestSchema,
  setTrainingPreferenceRequestSchema,
} from '@workspace/shared';
import trainingFeedbackService from '../../services/trainingFeedbackService.js';
import { log } from '../../config/logging.js';
import { ERRORS, formatZodError } from './errors.js';
import { formatConfirmation, formatJsonResult } from './formatting.js';

const manageTrainingFeedbackSchema = z.discriminatedUnion('action', [
  recordTrainingFeedbackRequestSchema.safeExtend({
    action: z.literal('record'),
  }),
  z.object({ action: z.literal('context') }).strict(),
  setTrainingPreferenceRequestSchema
    .extend({ action: z.literal('set_preference') })
    .strict(),
  forgetTrainingPreferenceRequestSchema
    .extend({ action: z.literal('forget_preference') })
    .strict(),
]);

export const TRAINING_FEEDBACK_TOOL_NAME = 'sparky_manage_training_feedback';

export function buildTrainingFeedbackTools(userId: string, timezone: string) {
  return {
    [TRAINING_FEEDBACK_TOOL_NAME]: tool({
      description:
        'Record structured post-workout feedback, read the learned training context, or manage persistent training preferences. Use record when the user reports workout difficulty, enjoyment, energy, discomfort/pain, or exercise-specific feedback. Put only explicitly stated stable likes, dislikes, equipment, schedule choices, or constraints in preferenceUpdates. Before proposing or scheduling a Speediance workout, use action=context and adapt volume, rest, exercise selection, and constraints. Never diagnose pain; recommend appropriate caution when pain is reported.',
      inputSchema: manageTrainingFeedbackSchema,
      execute: async (rawArgs) => {
        const parsed = manageTrainingFeedbackSchema.safeParse(rawArgs);
        if (!parsed.success) return formatZodError(parsed.error);
        try {
          const args = parsed.data;
          if (args.action === 'context') {
            return formatJsonResult(
              await trainingFeedbackService.getTrainingLearningContext(userId)
            );
          }
          if (args.action === 'record') {
            const { action: _action, ...input } = args;
            return formatJsonResult(
              await trainingFeedbackService.recordTrainingFeedback(
                userId,
                input,
                timezone
              )
            );
          }
          if (args.action === 'set_preference') {
            const { action: _action, ...input } = args;
            return formatJsonResult(
              await trainingFeedbackService.setTrainingPreference(userId, input)
            );
          }
          return (await trainingFeedbackService.forgetTrainingPreference(
            userId,
            args.preferenceId
          ))
            ? formatConfirmation(
                `Forgot training preference ${args.preferenceId}.`
              )
            : ERRORS.NOT_FOUND('Training preference', args.preferenceId);
        } catch (error) {
          log('error', '[Training Feedback Tool] failed:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
  };
}

export default { buildTrainingFeedbackTools };
