-- Persistent, owner-only context for the AI coach. Personal coaching settings
-- are deliberately not delegated through family/diary access.
CREATE TABLE public.coach_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public."user"(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  dietary_pattern TEXT NOT NULL DEFAULT 'omnivore'
    CHECK (dietary_pattern IN ('omnivore', 'vegetarian', 'vegan', 'pescatarian', 'other')),
  primary_goal TEXT,
  calorie_target NUMERIC CHECK (calorie_target IS NULL OR calorie_target BETWEEN 500 AND 10000),
  protein_target_g NUMERIC CHECK (protein_target_g IS NULL OR protein_target_g BETWEEN 0 AND 500),
  water_target_ml INTEGER CHECK (water_target_ml IS NULL OR water_target_ml BETWEEN 0 AND 15000),
  excluded_ingredients TEXT[] NOT NULL DEFAULT '{}',
  preferred_ingredients TEXT[] NOT NULL DEFAULT '{}',
  disliked_ingredients TEXT[] NOT NULL DEFAULT '{}',
  routines TEXT[] NOT NULL DEFAULT '{}',
  coaching_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.coach_profiles ENABLE ROW LEVEL SECURITY;
