-- SparkyFitnessServer/db/migrations/20260927180000_add_coros_provider_type.sql

INSERT INTO public.external_provider_types (id, display_name, description)
VALUES ('coros_mcp', 'COROS', 'Import COROS workouts via official OAuth connection. No API keys required.')
ON CONFLICT (id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description;

UPDATE public.external_provider_types
SET categories = ARRAY['other'],
    required_fields = ARRAY[]::VARCHAR[],
    is_strictly_private = TRUE
WHERE id = 'coros_mcp';
