-- Migration: Remember the timezone an exercise entry's entry_time is in
--
-- Health sync turns a workout's start instant into the wall-clock entry_time
-- using the zone the phone reports (falling back to the profile timezone),
-- then dropped that zone. Read paths had to assume the viewer's current
-- profile timezone, so a workout recorded while travelling had its start
-- shifted and its heart-rate window missed the samples.
--
-- Purely additive and nullable: NULL means "no recording zone known" and
-- read paths fall back to the profile timezone, so existing rows render
-- exactly as before.

ALTER TABLE public.exercise_entries
  ADD COLUMN IF NOT EXISTS record_timezone text;

COMMENT ON COLUMN public.exercise_entries.record_timezone IS 'IANA timezone entry_time is expressed in (e.g. America/New_York). NULL when unknown; read paths fall back to the profile timezone.';
