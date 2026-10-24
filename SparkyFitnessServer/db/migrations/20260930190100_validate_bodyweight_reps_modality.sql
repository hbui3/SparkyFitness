-- Validate the modality checks added as NOT VALID by
-- 20260930190000_add_bodyweight_reps_modality.sql. A separate file so the
-- scan is not in the same transaction as that lock.
ALTER TABLE exercises VALIDATE CONSTRAINT exercises_modality_check;
ALTER TABLE exercise_entries VALIDATE CONSTRAINT exercise_entries_modality_check;
