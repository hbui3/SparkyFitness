-- Reliable Telegram transport, configurable adaptive coaching, and private
-- coach memory. Transport inbox rows are system-only; every user-owned table
-- receives an owner-only RLS policy from db/rls_policies.sql at startup.

ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS adaptive_start_time TIME NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS adaptive_end_time TIME NOT NULL DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS adaptive_interval_minutes SMALLINT NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS proactive_categories TEXT[] NOT NULL
    DEFAULT ARRAY['nutrition', 'hydration', 'training', 'recovery']::TEXT[],
  ADD COLUMN IF NOT EXISTS adaptive_last_signature TEXT,
  ADD COLUMN IF NOT EXISTS memory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS auto_memory_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.coach_profiles
  DROP CONSTRAINT IF EXISTS coach_profiles_adaptive_interval_minutes_check,
  ADD CONSTRAINT coach_profiles_adaptive_interval_minutes_check
    CHECK (adaptive_interval_minutes BETWEEN 30 AND 360),
  DROP CONSTRAINT IF EXISTS coach_profiles_adaptive_time_window_check,
  ADD CONSTRAINT coach_profiles_adaptive_time_window_check
    CHECK (adaptive_start_time < adaptive_end_time),
  DROP CONSTRAINT IF EXISTS coach_profiles_proactive_categories_check,
  ADD CONSTRAINT coach_profiles_proactive_categories_check
    CHECK (
      proactive_categories <@ ARRAY[
        'nutrition', 'hydration', 'training', 'recovery'
      ]::TEXT[]
    );

COMMENT ON COLUMN public.coach_profiles.adaptive_start_time IS
  'Local start of the configurable adaptive coach notification window.';
COMMENT ON COLUMN public.coach_profiles.adaptive_end_time IS
  'Local end of the configurable adaptive coach notification window.';
COMMENT ON COLUMN public.coach_profiles.adaptive_interval_minutes IS
  'Minimum minutes between adaptive coach evaluation slots.';
COMMENT ON COLUMN public.coach_profiles.proactive_categories IS
  'Enabled proactive domains: nutrition, hydration, training, recovery.';
COMMENT ON COLUMN public.coach_profiles.adaptive_last_signature IS
  'Signature of the last adaptive message state used to suppress unchanged nudges.';
COMMENT ON COLUMN public.coach_profiles.memory_enabled IS
  'Whether active owner-controlled coach memories are included in coach context.';
COMMENT ON COLUMN public.coach_profiles.auto_memory_enabled IS
  'Whether the coach may store stable facts without an explicit remember command.';

CREATE TABLE IF NOT EXISTS public.coach_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coach_memories_category_check
    CHECK (category IN ('preference', 'routine', 'constraint', 'injury', 'goal', 'achievement', 'context')),
  CONSTRAINT coach_memories_source_check
    CHECK (source IN ('user', 'coach', 'import')),
  CONSTRAINT coach_memories_content_check
    CHECK (length(btrim(content)) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS coach_memories_user_active_idx
  ON public.coach_memories (user_id, active, pinned DESC, updated_at DESC);
ALTER TABLE public.coach_memories ENABLE ROW LEVEL SECURITY;

-- Exact update IDs are persisted before Telegram receives HTTP 200. The table
-- intentionally has no user RLS policy because payloads can arrive before a
-- Telegram chat has been paired with a Sparky user.
CREATE TABLE IF NOT EXISTS public.telegram_update_inbox (
  update_id BIGINT PRIMARY KEY,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT telegram_update_inbox_status_check
    CHECK (status IN ('pending', 'processing', 'processed', 'dead_letter')),
  CONSTRAINT telegram_update_inbox_attempt_count_check
    CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS telegram_update_inbox_pending_idx
  ON public.telegram_update_inbox (available_at, update_id)
  WHERE status IN ('pending', 'processing');
ALTER TABLE public.telegram_update_inbox ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.coach_delivery_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'telegram',
  telegram_chat_id BIGINT,
  content TEXT NOT NULL,
  buttons JSONB NOT NULL DEFAULT '[]'::JSONB,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coach_delivery_outbox_channel_check
    CHECK (channel IN ('telegram')),
  CONSTRAINT coach_delivery_outbox_status_check
    CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'skipped')),
  CONSTRAINT coach_delivery_outbox_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT coach_delivery_outbox_content_check
    CHECK (length(btrim(content)) BETWEEN 1 AND 50000),
  CONSTRAINT coach_delivery_outbox_buttons_check
    CHECK (jsonb_typeof(buttons) = 'array')
);

CREATE INDEX IF NOT EXISTS coach_delivery_outbox_pending_idx
  ON public.coach_delivery_outbox (available_at, created_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS coach_delivery_outbox_user_idx
  ON public.coach_delivery_outbox (user_id, created_at DESC);
ALTER TABLE public.coach_delivery_outbox ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.coach_action_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'completed',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  undone_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coach_action_receipts_status_check
    CHECK (status IN ('completed', 'undone', 'expired')),
  CONSTRAINT coach_action_receipts_payload_check
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS coach_action_receipts_user_idx
  ON public.coach_action_receipts (user_id, created_at DESC);
ALTER TABLE public.coach_action_receipts ENABLE ROW LEVEL SECURITY;
