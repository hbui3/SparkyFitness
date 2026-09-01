-- Migration: Add bmr column to check_in_measurements table
ALTER TABLE check_in_measurements
ADD COLUMN IF NOT EXISTS bmr NUMERIC(6, 1);

ALTER TABLE check_in_measurements
DROP CONSTRAINT IF EXISTS check_in_measurements_bmr_check,
ADD CONSTRAINT check_in_measurements_bmr_check CHECK (bmr IS NULL OR (bmr >= 300 AND bmr <= 10000));

COMMENT ON COLUMN check_in_measurements.bmr IS 'Basal Metabolic Rate (BMR) in kcal, measured from smart weight scale or synced from health provider.';

-- Backfill check_in_measurements.bmr from the latest valid custom measurement.
-- Keep its provider provenance, including source_id on installations that have
-- that legacy extension. Never overwrite a different BMR or its provenance,
-- and only delete legacy rows after the exact value and provenance were stored.
WITH legacy_bmr AS (
  SELECT
    cm.id,
    cm.user_id,
    cm.entry_date,
    cm.updated_at,
    cm.entry_timestamp,
    COALESCE(NULLIF(BTRIM(cm.source), ''), 'manual') AS source,
    NULLIF(BTRIM(to_jsonb(cm)->>'source_id'), '') AS source_id,
    CASE
      WHEN BTRIM(cm.value) ~ '^[0-9]+([.][0-9]+)?$'
      THEN BTRIM(cm.value)::numeric
    END AS parsed_value
  FROM public.custom_measurements cm
  JOIN public.custom_categories cc ON cc.id = cm.category_id
  WHERE cc.name = 'basal_metabolic_rate'
),
latest_bmr AS (
  SELECT DISTINCT ON (user_id, entry_date)
    id AS legacy_id,
    user_id,
    entry_date,
    ROUND(parsed_value, 1)::numeric(6, 1) AS bmr,
    jsonb_build_object(
      'bmr',
      jsonb_strip_nulls(jsonb_build_object(
        'source', source,
        'source_id', source_id
      ))
    ) AS provenance
  FROM legacy_bmr
  WHERE parsed_value BETWEEN 300 AND 10000
  ORDER BY
    user_id,
    entry_date,
    updated_at DESC NULLS LAST,
    entry_timestamp DESC NULLS LAST,
    id DESC
),
upserted AS (
  INSERT INTO public.check_in_measurements AS ci
    (user_id, entry_date, bmr, source_provenance)
  SELECT user_id, entry_date, bmr, provenance
  FROM latest_bmr
  ON CONFLICT (user_id, entry_date) DO UPDATE
  SET
    bmr = COALESCE(ci.bmr, EXCLUDED.bmr),
    source_provenance = CASE
      WHEN ci.bmr IS NULL
        OR NOT (COALESCE(ci.source_provenance, '{}'::jsonb) ? 'bmr')
      THEN COALESCE(ci.source_provenance, '{}'::jsonb)
        || EXCLUDED.source_provenance
      ELSE ci.source_provenance
    END
  WHERE ci.bmr IS NULL OR ci.bmr = EXCLUDED.bmr
  RETURNING user_id, entry_date, bmr, source_provenance
),
migrated_rows AS (
  SELECT latest_bmr.legacy_id
  FROM upserted
  JOIN latest_bmr USING (user_id, entry_date)
  WHERE upserted.bmr = latest_bmr.bmr
    AND (upserted.source_provenance->'bmr') = (latest_bmr.provenance->'bmr')
)
DELETE FROM public.custom_measurements cm
USING public.custom_categories cc, migrated_rows migrated
WHERE cc.id = cm.category_id
  AND cc.name = 'basal_metabolic_rate'
  AND migrated.legacy_id = cm.id;

-- 4. Remove the basal_metabolic_rate custom category only if all its rows were cleaned up
DELETE FROM public.custom_categories cc
WHERE cc.name = 'basal_metabolic_rate'
  AND NOT EXISTS (
    SELECT 1 FROM public.custom_measurements cm WHERE cm.category_id = cc.id
  );
