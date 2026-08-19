CREATE TABLE IF NOT EXISTS public.adaptive_training_settings (
  user_id uuid PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  sessions_per_week smallint NOT NULL DEFAULT 3
    CHECK (sessions_per_week BETWEEN 1 AND 7),
  max_duration_minutes smallint NOT NULL DEFAULT 45
    CHECK (max_duration_minutes BETWEEN 15 AND 180),
  recovery_window_hours smallint NOT NULL DEFAULT 72
    CHECK (recovery_window_hours BETWEEN 24 AND 168),
  preferred_muscles text[] NOT NULL DEFAULT ARRAY[]::text[],
  candidate_workout_preset_ids integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  avoid_consecutive_training_days boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.adaptive_training_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  recommendation_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('workout', 'recovery')),
  workout_preset_id integer REFERENCES public.workout_presets(id)
    ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'accepted', 'skipped', 'completed')),
  score numeric(5, 2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  volume_factor numeric(4, 2) NOT NULL DEFAULT 1
    CHECK (volume_factor BETWEEN 0.5 AND 1.25),
  muscle_load_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  workout_snapshot jsonb,
  rationale jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  algorithm_version text NOT NULL DEFAULT 'adaptive-v1',
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adaptive_training_recommendations_user_day_unique
    UNIQUE (user_id, recommendation_date)
);

CREATE INDEX IF NOT EXISTS adaptive_training_recommendations_user_date_idx
  ON public.adaptive_training_recommendations (user_id, recommendation_date DESC);

DROP TRIGGER IF EXISTS update_adaptive_training_settings_timestamp
  ON public.adaptive_training_settings;
CREATE TRIGGER update_adaptive_training_settings_timestamp
  BEFORE UPDATE ON public.adaptive_training_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

DROP TRIGGER IF EXISTS update_adaptive_training_recommendations_timestamp
  ON public.adaptive_training_recommendations;
CREATE TRIGGER update_adaptive_training_recommendations_timestamp
  BEFORE UPDATE ON public.adaptive_training_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

COMMENT ON TABLE public.adaptive_training_settings IS
  'Per-user settings for recovery-aware workout recommendations.';
COMMENT ON TABLE public.adaptive_training_recommendations IS
  'Persisted, explainable daily workout or recovery recommendations.';
