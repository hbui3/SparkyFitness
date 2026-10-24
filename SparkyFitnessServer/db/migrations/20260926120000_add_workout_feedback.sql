-- Issue #1560: session feedback ("too easy / just right / too hard", plus a
-- pain/discomfort flag) that later sessions adapt to.
--
-- One row per logged workout session (exercise_preset_entry_id) or per
-- exercise within it (exercise_entry_id), never both. Access follows the
-- diary rows it describes (see rls_policies.sql and the database security
-- tiers doc).

CREATE TABLE IF NOT EXISTS public.workout_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  exercise_preset_entry_id UUID REFERENCES public.exercise_preset_entries(id) ON DELETE CASCADE,
  exercise_entry_id UUID REFERENCES public.exercise_entries(id) ON DELETE CASCADE,
  difficulty TEXT,
  pain BOOLEAN NOT NULL DEFAULT FALSE,
  pain_note TEXT,
  created_by_user_id UUID REFERENCES "user"(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workout_feedback_one_target CHECK (
    (exercise_preset_entry_id IS NULL) <> (exercise_entry_id IS NULL)
  ),
  CONSTRAINT workout_feedback_difficulty_check CHECK (
    difficulty IS NULL OR difficulty IN ('too_easy', 'just_right', 'too_hard')
  ),
  CONSTRAINT workout_feedback_pain_note_length CHECK (
    pain_note IS NULL OR char_length(pain_note) <= 500
  ),
  -- A note only means something alongside the flag.
  CONSTRAINT workout_feedback_pain_note_requires_pain CHECK (
    pain_note IS NULL OR pain
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS workout_feedback_preset_entry_unique
  ON public.workout_feedback (exercise_preset_entry_id)
  WHERE exercise_preset_entry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS workout_feedback_exercise_entry_unique
  ON public.workout_feedback (exercise_entry_id)
  WHERE exercise_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS workout_feedback_user_created_idx
  ON public.workout_feedback (user_id, created_at DESC);

COMMENT ON TABLE public.workout_feedback IS
  'How a logged workout (or one exercise in it) felt: difficulty and an optional pain flag/note. Drives adaptive workout suggestions.';
COMMENT ON COLUMN public.workout_feedback.difficulty IS
  'too_easy | just_right | too_hard; null when only pain was reported.';
COMMENT ON COLUMN public.workout_feedback.pain_note IS
  'Free-text pain/discomfort detail. Shared like the diary it describes.';

-- Adaptive suggestions are on by default. Without feedback the only possible
-- change is holding weight after near-max logged effort (RPE/RIR), and every
-- change states its reason.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS adaptive_workout_suggestions BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.user_preferences.adaptive_workout_suggestions IS
  'When true, workout suggestions adapt to session feedback (difficulty, pain). When false, progression behaves exactly as before feedback existed.';
