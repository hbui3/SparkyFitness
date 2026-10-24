-- Migration: Create mindfulness_sessions table and add total_mindful_minutes to daily_health_metrics
-- Date: 2026-10-05

CREATE TABLE IF NOT EXISTS public.mindfulness_sessions (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    duration_seconds INTEGER NOT NULL,
    session_type VARCHAR(50) NOT NULL DEFAULT 'meditation',
    provider VARCHAR(50) NOT NULL DEFAULT 'manual',
    external_id VARCHAR(255),
    heart_rate_avg NUMERIC(5, 1),
    heart_rate_start INTEGER,
    heart_rate_end INTEGER,
    hrv_rmssd NUMERIC(5, 1),
    stress_level_start INTEGER,
    stress_level_end INTEGER,
    mood_entry_id UUID REFERENCES public.mood_entries(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_id UUID REFERENCES public."user"(id),
    updated_by_user_id UUID REFERENCES public."user"(id)
);

-- Index for efficient user date queries
CREATE INDEX IF NOT EXISTS idx_mindfulness_sessions_user_date
    ON public.mindfulness_sessions(user_id, entry_date);

-- Index for user start time ordering
CREATE INDEX IF NOT EXISTS idx_mindfulness_sessions_user_start
    ON public.mindfulness_sessions(user_id, start_time);

-- Idempotency index for provider sync
CREATE UNIQUE INDEX IF NOT EXISTS idx_mindfulness_sessions_user_external
    ON public.mindfulness_sessions(user_id, provider, external_id)
    WHERE external_id IS NOT NULL;

-- Daily rollup column on daily_health_metrics
ALTER TABLE public.daily_health_metrics
ADD COLUMN IF NOT EXISTS total_mindful_minutes INTEGER;
