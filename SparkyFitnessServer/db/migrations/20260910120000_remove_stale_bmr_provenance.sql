-- Keep per-metric provenance consistent when a BMR value has been cleared.
--
-- The bounds migration may already have run on an installation before this
-- cleanup was added. Target every NULL BMR carrying stale BMR provenance so
-- both fresh installs and previously migrated databases converge safely.
UPDATE check_in_measurements
SET source_provenance = source_provenance - 'bmr'
WHERE bmr IS NULL
  AND source_provenance ? 'bmr';
