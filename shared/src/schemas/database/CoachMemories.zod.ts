import { z } from "zod";

export const coachMemoryCategorySchema = z.enum([
  "preference",
  "routine",
  "constraint",
  "injury",
  "goal",
  "achievement",
  "context",
]);

export const coachMemorySourceSchema = z.enum(["user", "coach", "import"]);

export const coachMemoriesSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  category: coachMemoryCategorySchema,
  content: z.string().trim().min(1).max(500),
  source: coachMemorySourceSchema,
  active: z.boolean(),
  pinned: z.boolean(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export type CoachMemoryCategory = z.infer<typeof coachMemoryCategorySchema>;
export type CoachMemorySource = z.infer<typeof coachMemorySourceSchema>;
export type CoachMemory = z.infer<typeof coachMemoriesSchema>;
