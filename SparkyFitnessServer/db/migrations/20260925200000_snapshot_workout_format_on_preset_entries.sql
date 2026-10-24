-- Snapshot the preset's workout format onto each logged session. Reading it
-- live from workout_presets let a later format edit reclassify old sessions,
-- and deleting the preset (workout_preset_id ON DELETE SET NULL) silently
-- turned WOD history back into standard strength work.
ALTER TABLE public.exercise_preset_entries
  ADD COLUMN IF NOT EXISTS workout_format varchar(20) NOT NULL DEFAULT 'standard';

ALTER TABLE public.exercise_preset_entries
  DROP CONSTRAINT IF EXISTS chk_exercise_preset_entries_format;
ALTER TABLE public.exercise_preset_entries
  ADD CONSTRAINT chk_exercise_preset_entries_format
  CHECK (workout_format IN ('standard', 'interval', 'tabata', 'amrap', 'emom', 'for_time'));

-- Backfill from the presets that still exist. Sessions whose preset was
-- already deleted cannot be recovered and stay 'standard'.
UPDATE public.exercise_preset_entries epe
   SET workout_format = wp.workout_format
  FROM public.workout_presets wp
 WHERE epe.workout_preset_id = wp.id
   AND wp.workout_format <> 'standard';

COMMENT ON COLUMN public.exercise_preset_entries.workout_format IS 'Workout format of the source preset at the time the session was logged; not updated when the preset is edited or deleted';
