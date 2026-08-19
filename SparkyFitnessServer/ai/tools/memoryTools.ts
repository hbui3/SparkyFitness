import { tool } from 'ai';
import { z } from 'zod';
import coachMemoryService from '../../services/coachMemoryService.js';
import coachProfileService from '../../services/coachProfileService.js';
import { ERRORS, formatZodError } from './errors.js';
import { formatConfirmation, formatList } from './formatting.js';
import { log } from '../../config/logging.js';

const categorySchema = z.enum([
  'preference',
  'routine',
  'constraint',
  'injury',
  'goal',
  'achievement',
  'context',
]);

export const COACH_MEMORY_TOOL_NAME = 'sparky_manage_coach_memory';

const memoryActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('list'),
    })
    .strict(),
  z
    .object({
      action: z.literal('remember'),
      category: categorySchema,
      content: z.string().trim().min(1).max(500),
      pinned: z.boolean().default(false),
      user_confirmed: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      memory_id: z.string().uuid(),
      category: categorySchema.optional(),
      content: z.string().trim().min(1).max(500).optional(),
      active: z.boolean().optional(),
      pinned: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('forget'),
      memory_id: z.string().uuid(),
    })
    .strict(),
]);

export function buildMemoryTools(userId: string) {
  return {
    [COACH_MEMORY_TOOL_NAME]: tool({
      description:
        'List, remember, edit, or forget owner-controlled long-term coach memories. Only remember a fact when the user explicitly asks, unless automatic memory is enabled in the coach profile.',
      inputSchema: memoryActionSchema,
      execute: async (rawArgs) => {
        const parsed = memoryActionSchema.safeParse(rawArgs);
        if (!parsed.success) return formatZodError(parsed.error);
        try {
          const profile = await coachProfileService.getCoachProfile(userId);
          if (!profile.memoryEnabled) {
            return ERRORS.FORBIDDEN(
              'Coach memory is disabled in the user settings.'
            );
          }
          const args = parsed.data;
          if (args.action === 'list') {
            const memories = await coachMemoryService.listMemories(userId);
            return formatList(
              memories,
              'Coach memories',
              (memory) =>
                `${memory.id}: [${memory.category}] ${memory.content} (${memory.active ? 'active' : 'inactive'}${memory.pinned ? ', pinned' : ''})`
            );
          }
          if (args.action === 'remember') {
            if (!args.user_confirmed && !profile.autoMemoryEnabled) {
              return ERRORS.FORBIDDEN(
                'Automatic memory is disabled. Ask the user for confirmation before storing this fact.'
              );
            }
            const memory = await coachMemoryService.createMemory(
              userId,
              {
                category: args.category,
                content: args.content,
                pinned: args.pinned,
              },
              'coach'
            );
            return formatConfirmation(
              `Remembered [${memory.category}] "${memory.content}" (id ${memory.id}).`
            );
          }
          if (args.action === 'update') {
            const memory = await coachMemoryService.updateMemory(
              userId,
              args.memory_id,
              {
                ...(args.category !== undefined && { category: args.category }),
                ...(args.content !== undefined && { content: args.content }),
                ...(args.active !== undefined && { active: args.active }),
                ...(args.pinned !== undefined && { pinned: args.pinned }),
              }
            );
            return memory
              ? formatConfirmation(`Updated coach memory ${memory.id}.`)
              : ERRORS.NOT_FOUND('Coach memory', args.memory_id);
          }
          return (await coachMemoryService.deleteMemory(userId, args.memory_id))
            ? formatConfirmation(`Forgot coach memory ${args.memory_id}.`)
            : ERRORS.NOT_FOUND('Coach memory', args.memory_id);
        } catch (error) {
          log('error', '[Coach Memory Tool] failed:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
  };
}
