-- =============================================================================
-- Generic symptom & episode tracking (issue #1882).
--
-- Promotes the medication-scoped symptom tables into a standalone domain that
-- any symptom type can use (migraine, pain, GI, skin, mental health, ...):
--   * user_custom_symptoms  -> symptom definitions (template, sections, custom fields)
--   * symptom_entries       -> quick logs and episodes (start/end, locations,
--                              qualities, associated symptoms, triggers, severity timeline)
--   * user_symptom_options  -> generic pick-list library (replaces
--                              user_custom_symptom_locations)
--   * symptom_entry_treatments / symptom_entry_photos / symptom_free_days
--   * new family-sharing permission can_manage_symptoms, backfilled from
--     can_manage_medications so no existing delegate loses access.
--
-- Written to be safely re-runnable: every statement is IF [NOT] EXISTS or guarded.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Symptom definitions
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_custom_symptoms
    ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'general',
    ADD COLUMN IF NOT EXISTS template VARCHAR(30) NOT NULL DEFAULT 'generic',
    -- Per-symptom overrides of the template's section visibility, e.g. {"triggers": false}.
    ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- User-defined extra fields: [{key, label, type, options?, unit?}].
    ADD COLUMN IF NOT EXISTS custom_field_defs JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS is_episodic BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS color VARCHAR(20),
    ADD COLUMN IF NOT EXISTS icon VARCHAR(40),
    ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- 2. Symptom entries: quick logs + episodes
-- ---------------------------------------------------------------------------
ALTER TABLE public.symptom_entries
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS body_locations TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS qualities TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS associated_symptoms TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS triggers TEXT[] NOT NULL DEFAULT '{}',
    -- Headache template: {"prodrome": [...], "aura": [...], "postdrome": [...]}.
    ADD COLUMN IF NOT EXISTS phases JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS impact VARCHAR(20),
    ADD COLUMN IF NOT EXISTS peak_severity NUMERIC,
    -- Severity updates during an episode: [{"at": "<iso>", "severity": n}].
    ADD COLUMN IF NOT EXISTS severity_timeline JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.symptom_entries
    DROP CONSTRAINT IF EXISTS symptom_entries_episode_order_check;
ALTER TABLE public.symptom_entries
    ADD CONSTRAINT symptom_entries_episode_order_check
    CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at);

ALTER TABLE public.symptom_entries
    DROP CONSTRAINT IF EXISTS symptom_entries_impact_check;
ALTER TABLE public.symptom_entries
    ADD CONSTRAINT symptom_entries_impact_check
    CHECK (impact IS NULL OR impact IN ('none', 'mild', 'moderate', 'severe'));

-- Carry the legacy single location into the multi-select column.
UPDATE public.symptom_entries
   SET body_locations = ARRAY[body_location]
 WHERE body_location IS NOT NULL
   AND body_location <> ''
   AND cardinality(body_locations) = 0;

-- Seed peak severity for existing rows so reports can rely on it.
UPDATE public.symptom_entries
   SET peak_severity = severity
 WHERE peak_severity IS NULL
   AND severity IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_symptom_entries_user_symptom_date
    ON public.symptom_entries (user_id, symptom_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_symptom_entries_ongoing
    ON public.symptom_entries (user_id)
    WHERE started_at IS NOT NULL AND ended_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Generic pick-list library (locations, qualities, triggers, ...)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_symptom_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    kind VARCHAR(30) NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    -- TRUE hides a built-in option of the same name from the pickers.
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_symptom_option UNIQUE (user_id, kind, name),
    CONSTRAINT user_symptom_options_kind_check CHECK (
        kind IN ('location', 'head_location', 'quality', 'associated', 'trigger', 'relief')
    )
);
CREATE INDEX IF NOT EXISTS idx_user_symptom_options_user_kind
    ON public.user_symptom_options (user_id, kind);
DROP TRIGGER IF EXISTS set_timestamp ON public.user_symptom_options;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.user_symptom_options
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- Move the old custom-locations library into the generic table, then retire it.
DO $$
BEGIN
  IF to_regclass('public.user_custom_symptom_locations') IS NOT NULL THEN
    INSERT INTO public.user_symptom_options (user_id, kind, name, created_at, updated_at)
    SELECT user_id, 'location', name, created_at, updated_at
      FROM public.user_custom_symptom_locations
    ON CONFLICT (user_id, kind, name) DO NOTHING;

    DROP TABLE public.user_custom_symptom_locations;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Treatments & relief taken for an entry, with effectiveness
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.symptom_entry_treatments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    symptom_entry_id UUID NOT NULL REFERENCES public.symptom_entries(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL DEFAULT 'relief',
    medication_id UUID REFERENCES public.medications(id) ON DELETE SET NULL,
    medication_entry_id UUID REFERENCES public.medication_entries(id) ON DELETE SET NULL,
    name_snapshot TEXT NOT NULL,
    dose_snapshot TEXT,
    taken_at TIMESTAMPTZ,
    -- NULL = not rated yet.
    effectiveness VARCHAR(10),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT symptom_entry_treatments_kind_check CHECK (kind IN ('medication', 'relief')),
    CONSTRAINT symptom_entry_treatments_effectiveness_check CHECK (
        effectiveness IS NULL OR effectiveness IN ('none', 'partial', 'full')
    )
);
CREATE INDEX IF NOT EXISTS idx_symptom_entry_treatments_entry
    ON public.symptom_entry_treatments (symptom_entry_id);
CREATE INDEX IF NOT EXISTS idx_symptom_entry_treatments_user
    ON public.symptom_entry_treatments (user_id);
CREATE INDEX IF NOT EXISTS idx_symptom_entry_treatments_medication_entry
    ON public.symptom_entry_treatments (medication_entry_id);
DROP TRIGGER IF EXISTS set_timestamp ON public.symptom_entry_treatments;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.symptom_entry_treatments
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- ---------------------------------------------------------------------------
-- 5. Photos attached to an entry (served only through an authenticated route)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.symptom_entry_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    symptom_entry_id UUID NOT NULL REFERENCES public.symptom_entries(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    caption TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_symptom_entry_photos_entry
    ON public.symptom_entry_photos (symptom_entry_id);
CREATE INDEX IF NOT EXISTS idx_symptom_entry_photos_user
    ON public.symptom_entry_photos (user_id);
DROP TRIGGER IF EXISTS set_timestamp ON public.symptom_entry_photos;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.symptom_entry_photos
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- ---------------------------------------------------------------------------
-- 6. Explicit "no symptoms today" markers (the baseline for pattern analysis;
--    a day with no marker and no entry is unknown, not symptom-free).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.symptom_free_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_symptom_free_day UNIQUE (user_id, entry_date)
);
DROP TRIGGER IF EXISTS set_timestamp ON public.symptom_free_days;
CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.symptom_free_days
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- ---------------------------------------------------------------------------
-- 7. Family sharing: new can_manage_symptoms permission. Existing medication
--    delegates keep symptom access. Rows that already carry the key (including
--    an explicit false) are left alone, so a re-run never re-grants access.
-- ---------------------------------------------------------------------------
UPDATE public.family_access
   SET access_permissions = access_permissions || '{"can_manage_symptoms": true}'::jsonb
 WHERE (access_permissions->>'can_manage_medications')::boolean IS TRUE
   AND NOT (access_permissions ? 'can_manage_symptoms');
