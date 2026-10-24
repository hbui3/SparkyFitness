-- Optional within-session weight ramp. Null = off, so every existing preset is
-- unchanged. Distinct from increment_value, which is the between-session
-- progression step.
ALTER TABLE public.workout_preset_exercises
  ADD COLUMN IF NOT EXISTS ramp_increment numeric(6, 2);

COMMENT ON COLUMN public.workout_preset_exercises.ramp_increment IS 'Kg added to each successive working set within one session (negative ramps down); null = off';
