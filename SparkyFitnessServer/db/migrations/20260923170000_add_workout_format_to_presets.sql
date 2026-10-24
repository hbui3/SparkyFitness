ALTER TABLE workout_presets
  ADD COLUMN workout_format varchar(20) NOT NULL DEFAULT 'standard',
  ADD COLUMN time_cap_seconds integer;

ALTER TABLE workout_presets
  ADD CONSTRAINT chk_workout_presets_format
  CHECK (workout_format IN ('standard', 'interval', 'tabata', 'amrap', 'emom', 'for_time'));
