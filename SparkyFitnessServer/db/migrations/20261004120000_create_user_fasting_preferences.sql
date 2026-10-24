-- Issue #1610: Fasting auto-calculation and user preferences for fasting tracking
CREATE TABLE IF NOT EXISTS public.user_fasting_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
    auto_calculate BOOLEAN NOT NULL DEFAULT FALSE,
    default_protocol TEXT NOT NULL DEFAULT '16-8',
    target_fasting_hours NUMERIC(4, 1) NOT NULL DEFAULT 16.0,
    target_eating_hours NUMERIC(4, 1) NOT NULL DEFAULT 8.0,
    calorie_threshold INTEGER NOT NULL DEFAULT 10,
    pre_end_alert_minutes INTEGER NOT NULL DEFAULT 30,
    eating_window_alert BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_fasting_preferences_fasting_hours_check CHECK (target_fasting_hours > 0 AND target_fasting_hours <= 168),
    CONSTRAINT user_fasting_preferences_eating_hours_check CHECK (target_eating_hours >= 0 AND target_eating_hours <= 24),
    CONSTRAINT user_fasting_preferences_calorie_threshold_check CHECK (calorie_threshold >= 0 AND calorie_threshold <= 500),
    CONSTRAINT user_fasting_preferences_pre_end_alert_check CHECK (pre_end_alert_minutes >= 0 AND pre_end_alert_minutes <= 180)
);

CREATE INDEX IF NOT EXISTS idx_user_fasting_preferences_user_id ON public.user_fasting_preferences(user_id);

COMMENT ON TABLE public.user_fasting_preferences IS 'Per-user preferences for intermittent fasting targets, auto-calculation from food entries, and notification timing.';
COMMENT ON COLUMN public.user_fasting_preferences.auto_calculate IS 'Whether fasting windows and current fasting status are automatically calculated from food entries.';
COMMENT ON COLUMN public.user_fasting_preferences.calorie_threshold IS 'Minimum calories in a food entry required to break a fast (ignoring plain water, black coffee, etc.).';
COMMENT ON COLUMN public.user_fasting_preferences.pre_end_alert_minutes IS 'Advance warning notification in minutes before the target fasting goal is reached.';

DROP TRIGGER IF EXISTS update_user_fasting_preferences_updated_at ON public.user_fasting_preferences;
CREATE TRIGGER update_user_fasting_preferences_updated_at
    BEFORE UPDATE ON public.user_fasting_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
