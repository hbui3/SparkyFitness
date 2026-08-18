-- Register Speediance as a strictly-private workout import provider.
-- Credentials are stored in the existing encrypted app_id/app_key columns;
-- base_url holds one of the allow-listed regional API origins.

INSERT INTO public.external_provider_types (
  id,
  display_name,
  description,
  is_strictly_private,
  categories,
  required_fields,
  field_labels,
  supports_barcode
)
VALUES (
  'speediance',
  'Speediance',
  'Imports completed workouts from a Speediance account via the unofficial mobile API',
  TRUE,
  ARRAY['exercise'],
  ARRAY['app_id', 'app_key'],
  '{"app_id":"Speediance email","app_key":"Speediance password"}'::jsonb,
  FALSE
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  is_strictly_private = EXCLUDED.is_strictly_private,
  categories = EXCLUDED.categories,
  required_fields = EXCLUDED.required_fields,
  field_labels = EXCLUDED.field_labels,
  supports_barcode = EXCLUDED.supports_barcode;
