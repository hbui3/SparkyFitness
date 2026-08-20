CREATE TABLE IF NOT EXISTS public.coach_workout_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  workout_date date NOT NULL,
  workout_name text NOT NULL,
  provider text NOT NULL DEFAULT 'speediance',
  overall_rating smallint,
  difficulty text,
  energy_rating smallint,
  pain_level smallint,
  notes text,
  exercise_feedback jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_workout_feedback_name_check
    CHECK (length(btrim(workout_name)) BETWEEN 1 AND 200),
  CONSTRAINT coach_workout_feedback_provider_check
    CHECK (provider IN ('speediance', 'sparky', 'manual', 'other')),
  CONSTRAINT coach_workout_feedback_rating_check
    CHECK (overall_rating IS NULL OR overall_rating BETWEEN 1 AND 5),
  CONSTRAINT coach_workout_feedback_difficulty_check
    CHECK (difficulty IS NULL OR difficulty IN ('too_easy', 'just_right', 'too_hard')),
  CONSTRAINT coach_workout_feedback_energy_check
    CHECK (energy_rating IS NULL OR energy_rating BETWEEN 1 AND 5),
  CONSTRAINT coach_workout_feedback_pain_check
    CHECK (pain_level IS NULL OR pain_level BETWEEN 0 AND 10),
  CONSTRAINT coach_workout_feedback_notes_check
    CHECK (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 2000),
  CONSTRAINT coach_workout_feedback_exercises_check
    CHECK (jsonb_typeof(exercise_feedback) = 'array')
);

CREATE INDEX IF NOT EXISTS coach_workout_feedback_user_date_idx
  ON public.coach_workout_feedback (user_id, workout_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.coach_training_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  kind text NOT NULL,
  subject text NOT NULL,
  sentiment text NOT NULL,
  notes text,
  source text NOT NULL DEFAULT 'user',
  source_feedback_id uuid REFERENCES public.coach_workout_feedback(id)
    ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_training_preferences_kind_check
    CHECK (kind IN ('exercise', 'equipment', 'training_style', 'schedule', 'constraint')),
  CONSTRAINT coach_training_preferences_subject_check
    CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
  CONSTRAINT coach_training_preferences_sentiment_check
    CHECK (sentiment IN ('prefer', 'avoid', 'require', 'neutral')),
  CONSTRAINT coach_training_preferences_notes_check
    CHECK (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 1000),
  CONSTRAINT coach_training_preferences_source_check
    CHECK (source IN ('user', 'feedback', 'coach'))
);

CREATE UNIQUE INDEX IF NOT EXISTS coach_training_preferences_identity_idx
  ON public.coach_training_preferences (user_id, kind, lower(subject));
CREATE INDEX IF NOT EXISTS coach_training_preferences_user_active_idx
  ON public.coach_training_preferences (user_id, active, updated_at DESC);

DROP TRIGGER IF EXISTS update_coach_workout_feedback_timestamp
  ON public.coach_workout_feedback;
CREATE TRIGGER update_coach_workout_feedback_timestamp
  BEFORE UPDATE ON public.coach_workout_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

DROP TRIGGER IF EXISTS update_coach_training_preferences_timestamp
  ON public.coach_training_preferences;
CREATE TRIGGER update_coach_training_preferences_timestamp
  BEFORE UPDATE ON public.coach_training_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

ALTER TABLE public.coach_workout_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_training_preferences ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.coach_workout_feedback IS
  'Private structured post-workout feedback used by the AI coach for future training adaptation.';
COMMENT ON TABLE public.coach_training_preferences IS
  'Private active exercise, equipment, schedule, style, and constraint preferences learned from explicit user feedback.';
