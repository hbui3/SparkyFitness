-- Bodyweight exercises with added or assisted weight (issue #56).
--
-- A new modality, bodyweight_reps: sets carry reps plus a signed weight, where
-- a positive weight is load added (dip belt, vest) and a negative one is
-- assistance (band, assisted machine). Volume and estimated 1RM count the
-- lifter's body weight plus that value; see effectiveLoadKg in
-- @workspace/shared.
--
-- Only the CHECK constraints change. No existing row is converted: an exercise
-- becomes bodyweight when its owner picks the modality, or when it is created
-- or imported with bodyweight-only equipment. Idempotent: each constraint is
-- dropped if present and recreated with the full list. Validation is a later
-- migration: this runner sends a whole file as one transaction, and validating
-- here would hold the add-constraint lock for the scan.
ALTER TABLE exercises DROP CONSTRAINT IF EXISTS exercises_modality_check;
ALTER TABLE exercises ADD CONSTRAINT exercises_modality_check
    CHECK (modality IN ('weight_reps', 'reps_only', 'bodyweight_reps', 'duration', 'duration_distance'))
    NOT VALID;

ALTER TABLE exercise_entries DROP CONSTRAINT IF EXISTS exercise_entries_modality_check;
ALTER TABLE exercise_entries ADD CONSTRAINT exercise_entries_modality_check
    CHECK (modality IN ('weight_reps', 'reps_only', 'bodyweight_reps', 'duration', 'duration_distance'))
    NOT VALID;
