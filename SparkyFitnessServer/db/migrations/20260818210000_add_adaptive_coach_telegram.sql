-- Adaptive coach nudges reuse the existing owner-only coach profile. The
-- slot marker makes the five-minute scheduler idempotent across restarts and
-- multiple server instances.
ALTER TABLE public.coach_profiles
  ADD COLUMN IF NOT EXISTS adaptive_check_ins_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS adaptive_last_sent_slot TEXT
    CHECK (
      adaptive_last_sent_slot IS NULL
      OR adaptive_last_sent_slot ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'
    );

COMMENT ON COLUMN public.coach_profiles.adaptive_check_ins_enabled IS
  'Opt-in contextual coach nudges every two hours from 07:00 through 19:00 local time.';
COMMENT ON COLUMN public.coach_profiles.adaptive_last_sent_slot IS
  'Latest claimed local two-hour slot, formatted YYYY-MM-DDTHH:MM.';

-- Telegram identities and one-time pairing material are private. The webhook
-- resolves them with the system client only after Telegram's secret header and
-- the one-time pairing token have been verified.
CREATE TABLE IF NOT EXISTS public.coach_telegram_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public."user"(id) ON DELETE CASCADE,
  telegram_chat_id BIGINT UNIQUE,
  telegram_user_id BIGINT,
  telegram_username TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  link_token_hash TEXT UNIQUE,
  link_token_expires_at TIMESTAMPTZ,
  last_telegram_update_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coach_telegram_link_pair
    CHECK (
      (link_token_hash IS NULL AND link_token_expires_at IS NULL)
      OR (link_token_hash IS NOT NULL AND link_token_expires_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS coach_telegram_connections_user_id_idx
  ON public.coach_telegram_connections (user_id);

ALTER TABLE public.coach_telegram_connections ENABLE ROW LEVEL SECURITY;

-- The instance-wide bot credential is encrypted with the existing application
-- encryption key. RLS intentionally has no user policy: only the system client
-- used by admin-only routes may access the row.
CREATE TABLE IF NOT EXISTS public.telegram_coach_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  encrypted_bot_token TEXT,
  bot_token_iv TEXT,
  bot_token_tag TEXT,
  encrypted_webhook_secret TEXT,
  webhook_secret_iv TEXT,
  webhook_secret_tag TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT telegram_coach_bot_token_encryption_complete
    CHECK (
      (encrypted_bot_token IS NULL AND bot_token_iv IS NULL AND bot_token_tag IS NULL)
      OR (encrypted_bot_token IS NOT NULL AND bot_token_iv IS NOT NULL AND bot_token_tag IS NOT NULL)
    ),
  CONSTRAINT telegram_coach_webhook_secret_encryption_complete
    CHECK (
      (encrypted_webhook_secret IS NULL AND webhook_secret_iv IS NULL AND webhook_secret_tag IS NULL)
      OR (encrypted_webhook_secret IS NOT NULL AND webhook_secret_iv IS NOT NULL AND webhook_secret_tag IS NOT NULL)
    )
);

INSERT INTO public.telegram_coach_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.telegram_coach_settings ENABLE ROW LEVEL SECURITY;
