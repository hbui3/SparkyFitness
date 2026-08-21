ALTER TABLE public.ai_service_settings
  ADD COLUMN IF NOT EXISTS planning_model_name TEXT;

COMMENT ON COLUMN public.ai_service_settings.planning_model_name IS
  'Optional stronger model used for workout and multi-week training-plan turns.';

ALTER TABLE public.workout_plan_templates
  ADD COLUMN IF NOT EXISTS cycle_length_weeks INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.workout_plan_template_assignments
  ADD COLUMN IF NOT EXISTS week_index INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.workout_plan_templates
  DROP CONSTRAINT IF EXISTS workout_plan_templates_cycle_length_weeks_check;

ALTER TABLE public.workout_plan_templates
  ADD CONSTRAINT workout_plan_templates_cycle_length_weeks_check
  CHECK (cycle_length_weeks BETWEEN 1 AND 8);

ALTER TABLE public.workout_plan_template_assignments
  DROP CONSTRAINT IF EXISTS workout_plan_template_assignments_week_index_check;

ALTER TABLE public.workout_plan_template_assignments
  ADD CONSTRAINT workout_plan_template_assignments_week_index_check
  CHECK (week_index BETWEEN 0 AND 7);

CREATE INDEX IF NOT EXISTS idx_workout_plan_assignments_cycle_day
  ON public.workout_plan_template_assignments(template_id, week_index, day_of_week);
