ALTER TABLE public.exercise_preset_entries
  ADD COLUMN IF NOT EXISTS location varchar(255);

ALTER TABLE public.exercise_entry_sets
  ADD COLUMN IF NOT EXISTS rir numeric(3, 1);

COMMENT ON COLUMN public.exercise_preset_entries.location IS 'Optional location or gym name for the workout session';
COMMENT ON COLUMN public.exercise_entry_sets.rir IS 'Reps In Reserve (0-10 scale)';
