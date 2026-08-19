-- Register iGPSPORT as a strictly-private workout import provider.
-- Credentials use the existing encrypted app_id/app_key columns; base_url is
-- restricted by the server to the global or China iGPSPORT API origin.

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
  'igpsport',
  'iGPSPORT',
  'Imports cycling activities and full FIT telemetry from an iGPSPORT account via the unofficial web API',
  TRUE,
  ARRAY['exercise'],
  ARRAY['app_id', 'app_key'],
  '{"app_id":"iGPSPORT email or phone","app_key":"iGPSPORT password"}'::jsonb,
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
