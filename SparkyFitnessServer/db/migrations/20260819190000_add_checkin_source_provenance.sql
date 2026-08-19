-- A check-in row is a per-day aggregate: weight may come from Withings while
-- steps come from HealthKit and waist is entered manually. A single source
-- column would therefore be misleading. Keep provenance per populated metric.
ALTER TABLE public.check_in_measurements
  ADD COLUMN IF NOT EXISTS source_provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.check_in_measurements.source_provenance IS
  'Per-metric source metadata, keyed by measurement column (for example weight or steps).';

-- Safely recover historical Withings smart-scale provenance where the retained
-- Withings fat-free-mass and fat-mass values add up to the stored daily weight.
-- The tight tolerance prevents unrelated same-day Withings telemetry from
-- being treated as proof that a check-in value came from the scale.
WITH withings_scale_days AS (
  SELECT
    cm.user_id,
    cm.entry_date,
    max(cm.value::numeric) FILTER (
      WHERE lower(cc.name) = 'fat free mass'
    ) AS fat_free_mass_kg,
    max(cm.value::numeric) FILTER (
      WHERE lower(cc.name) = 'fat mass weight'
    ) AS fat_mass_kg
  FROM public.custom_measurements cm
  JOIN public.custom_categories cc ON cc.id = cm.category_id
  WHERE lower(cm.source) = 'withings'
    AND lower(cc.name) IN ('fat free mass', 'fat mass weight')
    AND cm.value ~ '^[0-9]+([.][0-9]+)?$'
  GROUP BY cm.user_id, cm.entry_date
),
matched AS (
  SELECT
    ci.id,
    ci.weight,
    ci.body_fat_percentage,
    ci.muscle_mass_kg,
    ci.bone_mass_kg,
    scale.fat_mass_kg
  FROM public.check_in_measurements ci
  JOIN withings_scale_days scale
    ON scale.user_id = ci.user_id
   AND scale.entry_date = ci.entry_date
  WHERE ci.weight IS NOT NULL
    AND scale.fat_free_mass_kg IS NOT NULL
    AND scale.fat_mass_kg IS NOT NULL
    AND abs(ci.weight - (scale.fat_free_mass_kg + scale.fat_mass_kg)) <= 0.05
)
UPDATE public.check_in_measurements ci
SET source_provenance = ci.source_provenance || jsonb_strip_nulls(
  jsonb_build_object(
    'weight', jsonb_build_object('source', 'Withings'),
    'body_fat_percentage', CASE
      WHEN matched.body_fat_percentage IS NOT NULL
       AND abs(
         matched.body_fat_percentage
         - (matched.fat_mass_kg * 100 / NULLIF(matched.weight, 0))
       ) <= 0.15
      THEN jsonb_build_object('source', 'Withings')
    END,
    'muscle_mass_kg', CASE
      WHEN matched.muscle_mass_kg IS NOT NULL
      THEN jsonb_build_object('source', 'Withings')
    END,
    'bone_mass_kg', CASE
      WHEN matched.bone_mass_kg IS NOT NULL
      THEN jsonb_build_object('source', 'Withings')
    END
  )
)
FROM matched
WHERE ci.id = matched.id;
