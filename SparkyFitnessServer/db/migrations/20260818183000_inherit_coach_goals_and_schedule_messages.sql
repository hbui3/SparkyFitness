-- Coach goals now come from onboarding_data, user_preferences, and user_goals.
-- Remove the duplicate values and add opt-in schedules for proactive chat
-- messages. Delivery markers make the background job idempotent.
ALTER TABLE public.coach_profiles
  DROP COLUMN IF EXISTS primary_goal,
  DROP COLUMN IF EXISTS calorie_target,
  DROP COLUMN IF EXISTS protein_target_g,
  DROP COLUMN IF EXISTS water_target_ml,
  ADD COLUMN IF NOT EXISTS daily_check_in_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS daily_check_in_time TIME NOT NULL DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS weekly_review_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS weekly_review_day SMALLINT NOT NULL DEFAULT 0
    CHECK (weekly_review_day BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS weekly_review_time TIME NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS daily_last_sent_on DATE,
  ADD COLUMN IF NOT EXISTS weekly_last_sent_on DATE;

COMMENT ON COLUMN public.coach_profiles.daily_check_in_time IS
  'Local user time for an opt-in daily proactive coach message.';
COMMENT ON COLUMN public.coach_profiles.weekly_review_day IS
  'Local weekday for an opt-in weekly review; 0 is Sunday and 6 is Saturday.';
COMMENT ON COLUMN public.coach_profiles.weekly_review_time IS
  'Local user time for an opt-in weekly proactive coach review.';
