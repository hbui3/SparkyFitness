CREATE OR REPLACE FUNCTION public.coach_text_array_elements_within_bounds(
  values_to_check text[],
  minimum_length integer,
  maximum_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    bool_and(
      value IS NOT NULL
      AND length(btrim(value)) BETWEEN minimum_length AND maximum_length
    ),
    true
  )
  FROM unnest(values_to_check) AS element(value);
$$;

CREATE TABLE IF NOT EXISTS public.coach_pantry_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  ingredient_key text NOT NULL,
  name text NOT NULL,
  quantity numeric(12, 3) NOT NULL DEFAULT 0,
  minimum_quantity numeric(12, 3) NOT NULL DEFAULT 0,
  unit text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  preferred_retailer text,
  preferred_retailer_product_id text,
  expires_on date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_pantry_items_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT coach_pantry_items_identity_unique
    UNIQUE (user_id, ingredient_key, unit),
  CONSTRAINT coach_pantry_items_key_check
    CHECK (length(btrim(ingredient_key)) BETWEEN 1 AND 200),
  CONSTRAINT coach_pantry_items_name_check
    CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT coach_pantry_items_quantity_check CHECK (quantity >= 0),
  CONSTRAINT coach_pantry_items_minimum_check CHECK (minimum_quantity >= 0),
  CONSTRAINT coach_pantry_items_unit_check
    CHECK (unit IN ('g', 'ml', 'piece', 'tsp', 'tbsp')),
  CONSTRAINT coach_pantry_items_category_check
    CHECK (category IN ('chilled', 'produce', 'pantry', 'frozen', 'other')),
  CONSTRAINT coach_pantry_items_preferred_product_check CHECK (
    (preferred_retailer IS NULL AND preferred_retailer_product_id IS NULL)
    OR (
      preferred_retailer IS NOT NULL
      AND preferred_retailer_product_id IS NOT NULL
      AND preferred_retailer IN ('coop', 'migros')
      AND length(btrim(preferred_retailer_product_id)) BETWEEN 1 AND 200
    )
  )
);

CREATE TABLE IF NOT EXISTS public.coach_pantry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  pantry_item_id uuid NOT NULL,
  event_type text NOT NULL,
  delta_quantity numeric(12, 3) NOT NULL,
  unit text NOT NULL,
  source text NOT NULL,
  source_id uuid,
  idempotency_key text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_pantry_events_item_owner_fkey
    FOREIGN KEY (pantry_item_id, user_id)
    REFERENCES public.coach_pantry_items(id, user_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT coach_pantry_events_idempotency_unique
    UNIQUE (user_id, idempotency_key),
  CONSTRAINT coach_pantry_events_type_check
    CHECK (event_type IN ('adjust', 'purchase', 'consume', 'spoil')),
  CONSTRAINT coach_pantry_events_delta_check CHECK (delta_quantity <> 0),
  CONSTRAINT coach_pantry_events_unit_check
    CHECK (unit IN ('g', 'ml', 'piece', 'tsp', 'tbsp')),
  CONSTRAINT coach_pantry_events_source_check
    CHECK (source IN ('manual', 'shopping', 'meal_plan')),
  CONSTRAINT coach_pantry_events_idempotency_key_check
    CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  CONSTRAINT coach_pantry_events_notes_check
    CHECK (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 1000)
);

CREATE TABLE IF NOT EXISTS public.coach_shopping_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  title text NOT NULL,
  coverage_start date,
  coverage_end date,
  status text NOT NULL DEFAULT 'open',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_shopping_lists_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT coach_shopping_lists_title_check
    CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT coach_shopping_lists_coverage_check CHECK (
    (coverage_start IS NULL AND coverage_end IS NULL)
    OR (
      coverage_start IS NOT NULL
      AND coverage_end IS NOT NULL
      AND coverage_end >= coverage_start
    )
  ),
  CONSTRAINT coach_shopping_lists_status_check
    CHECK (status IN ('open', 'completed', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS coach_shopping_lists_one_open_per_user_idx
  ON public.coach_shopping_lists (user_id)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.coach_shopping_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  shopping_list_id uuid NOT NULL,
  ingredient_key text NOT NULL,
  name text NOT NULL,
  required_quantity numeric(12, 3) NOT NULL,
  purchased_quantity numeric(12, 3) NOT NULL DEFAULT 0,
  unit text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  status text NOT NULL DEFAULT 'needed',
  is_manual boolean NOT NULL DEFAULT false,
  quantity_locked boolean NOT NULL DEFAULT false,
  notes text,
  source_entry_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  selected_product_retailer text,
  selected_product_retailer_id text,
  selected_product_gtin text,
  selected_product_name text,
  selected_product_package_quantity numeric(12, 3),
  selected_product_package_unit text,
  selected_product_direct_url text,
  selected_product_verified_at timestamptz,
  selected_product_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_shopping_list_items_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT coach_shopping_list_items_list_owner_fkey
    FOREIGN KEY (shopping_list_id, user_id)
    REFERENCES public.coach_shopping_lists(id, user_id) ON DELETE CASCADE,
  CONSTRAINT coach_shopping_list_items_key_check
    CHECK (length(btrim(ingredient_key)) BETWEEN 1 AND 200),
  CONSTRAINT coach_shopping_list_items_name_check
    CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT coach_shopping_list_items_required_check
    CHECK (required_quantity > 0),
  CONSTRAINT coach_shopping_list_items_purchased_check
    CHECK (purchased_quantity >= 0),
  CONSTRAINT coach_shopping_list_items_unit_check
    CHECK (unit IN ('g', 'ml', 'piece', 'tsp', 'tbsp')),
  CONSTRAINT coach_shopping_list_items_category_check
    CHECK (category IN ('chilled', 'produce', 'pantry', 'frozen', 'other')),
  CONSTRAINT coach_shopping_list_items_status_check
    CHECK (status IN ('needed', 'purchased', 'skipped')),
  CONSTRAINT coach_shopping_list_items_notes_check
    CHECK (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 1000),
  CONSTRAINT coach_shopping_list_items_product_snapshot_check CHECK (
    (
      selected_product_retailer IS NULL
      AND selected_product_retailer_id IS NULL
      AND selected_product_gtin IS NULL
      AND selected_product_name IS NULL
      AND selected_product_package_quantity IS NULL
      AND selected_product_package_unit IS NULL
      AND selected_product_direct_url IS NULL
      AND selected_product_verified_at IS NULL
      AND selected_product_note IS NULL
    )
    OR (
      selected_product_retailer IS NOT NULL
      AND selected_product_retailer_id IS NOT NULL
      AND selected_product_name IS NOT NULL
      AND selected_product_package_quantity IS NOT NULL
      AND selected_product_package_unit IS NOT NULL
      AND selected_product_retailer IN ('coop', 'migros')
      AND length(btrim(selected_product_retailer_id)) BETWEEN 1 AND 200
      AND length(btrim(selected_product_name)) BETWEEN 1 AND 300
      AND selected_product_package_quantity > 0
      AND selected_product_package_unit IN ('g', 'ml', 'piece', 'tsp', 'tbsp')
      AND selected_product_direct_url IS NOT NULL
      AND selected_product_verified_at IS NOT NULL
      AND (
        selected_product_gtin IS NULL
        OR selected_product_gtin ~ '^(\d{8}|\d{12}|\d{13}|\d{14})$'
      )
      AND (
        selected_product_note IS NULL
        OR length(btrim(selected_product_note)) BETWEEN 1 AND 500
      )
      AND (
        (
          selected_product_retailer = 'coop'
          AND selected_product_direct_url ~* '^https://([[:alnum:]-]+\.)*coop\.ch(/|$)'
        )
        OR (
          selected_product_retailer = 'migros'
          AND selected_product_direct_url ~* '^https://([[:alnum:]-]+\.)*migros\.ch(/|$)'
        )
      )
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS coach_shopping_list_items_identity_unique_idx
  ON public.coach_shopping_list_items
  (shopping_list_id, ingredient_key, unit);

CREATE INDEX IF NOT EXISTS coach_shopping_list_items_list_status_idx
  ON public.coach_shopping_list_items
  (user_id, shopping_list_id, status, category, created_at);

CREATE TABLE IF NOT EXISTS public.coach_meal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL,
  algorithm_version text NOT NULL,
  generation_key text NOT NULL,
  warnings text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_meal_plans_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT coach_meal_plans_generation_unique
    UNIQUE (user_id, generation_key),
  CONSTRAINT coach_meal_plans_dates_check
    CHECK ((end_date - start_date) BETWEEN 0 AND 6),
  CONSTRAINT coach_meal_plans_status_check
    CHECK (status IN ('active', 'completed', 'archived')),
  CONSTRAINT coach_meal_plans_source_check CHECK (source IN ('coach', 'user')),
  CONSTRAINT coach_meal_plans_algorithm_check
    CHECK (length(btrim(algorithm_version)) BETWEEN 1 AND 100),
  CONSTRAINT coach_meal_plans_generation_key_check
    CHECK (length(btrim(generation_key)) BETWEEN 1 AND 200),
  CONSTRAINT coach_meal_plans_warnings_check CHECK (
    public.coach_text_array_elements_within_bounds(warnings, 1, 1000)
  )
);

CREATE INDEX IF NOT EXISTS coach_meal_plans_user_dates_idx
  ON public.coach_meal_plans (user_id, start_date DESC, end_date DESC);

CREATE TABLE IF NOT EXISTS public.coach_meal_plan_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  meal_plan_id uuid NOT NULL,
  plan_date date NOT NULL,
  slot text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  recipe_key text NOT NULL,
  recipe_name text NOT NULL,
  recipe_description text,
  recipe_instructions text[] NOT NULL,
  prep_minutes integer NOT NULL DEFAULT 0,
  servings numeric(12, 3) NOT NULL,
  calories_kcal numeric(12, 3) NOT NULL DEFAULT 0,
  protein_g numeric(12, 3) NOT NULL DEFAULT 0,
  carbs_g numeric(12, 3) NOT NULL DEFAULT 0,
  fat_g numeric(12, 3) NOT NULL DEFAULT 0,
  safety_status text NOT NULL,
  replacement_for_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_meal_plan_entries_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT coach_meal_plan_entries_plan_owner_fkey
    FOREIGN KEY (meal_plan_id, user_id)
    REFERENCES public.coach_meal_plans(id, user_id) ON DELETE CASCADE,
  CONSTRAINT coach_meal_plan_entries_replacement_owner_fkey
    FOREIGN KEY (replacement_for_id, user_id)
    REFERENCES public.coach_meal_plan_entries(id, user_id),
  CONSTRAINT coach_meal_plan_entries_slot_check
    CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
  CONSTRAINT coach_meal_plan_entries_status_check
    CHECK (status IN ('planned', 'prepared', 'eaten_out', 'replaced', 'skipped')),
  CONSTRAINT coach_meal_plan_entries_recipe_key_check
    CHECK (length(btrim(recipe_key)) BETWEEN 1 AND 200),
  CONSTRAINT coach_meal_plan_entries_recipe_name_check
    CHECK (length(btrim(recipe_name)) BETWEEN 1 AND 300),
  CONSTRAINT coach_meal_plan_entries_recipe_description_check CHECK (
    recipe_description IS NULL
    OR length(btrim(recipe_description)) BETWEEN 1 AND 2000
  ),
  CONSTRAINT coach_meal_plan_entries_instructions_check
    CHECK (
      cardinality(recipe_instructions) BETWEEN 1 AND 100
      AND public.coach_text_array_elements_within_bounds(
        recipe_instructions,
        1,
        1000
      )
    ),
  CONSTRAINT coach_meal_plan_entries_prep_check
    CHECK (prep_minutes BETWEEN 0 AND 1440),
  CONSTRAINT coach_meal_plan_entries_servings_check CHECK (servings > 0),
  CONSTRAINT coach_meal_plan_entries_nutrition_check CHECK (
    calories_kcal >= 0 AND protein_g >= 0 AND carbs_g >= 0 AND fat_g >= 0
  ),
  CONSTRAINT coach_meal_plan_entries_safety_check
    CHECK (safety_status IN ('validated', 'needs_user_input')),
  CONSTRAINT coach_meal_plan_entries_notes_check
    CHECK (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 2000)
);

CREATE UNIQUE INDEX IF NOT EXISTS coach_meal_plan_entries_planned_slot_idx
  ON public.coach_meal_plan_entries (user_id, plan_date, slot)
  WHERE status = 'planned';

CREATE INDEX IF NOT EXISTS coach_meal_plan_entries_plan_date_idx
  ON public.coach_meal_plan_entries (user_id, meal_plan_id, plan_date, slot);

CREATE TABLE IF NOT EXISTS public.coach_meal_plan_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  meal_plan_entry_id uuid NOT NULL,
  pantry_item_id uuid,
  ingredient_key text NOT NULL,
  name text NOT NULL,
  quantity numeric(12, 3) NOT NULL,
  unit text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  shopping_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_meal_plan_ingredients_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT coach_meal_plan_ingredients_entry_owner_fkey
    FOREIGN KEY (meal_plan_entry_id, user_id)
    REFERENCES public.coach_meal_plan_entries(id, user_id) ON DELETE CASCADE,
  CONSTRAINT coach_meal_plan_ingredients_pantry_owner_fkey
    FOREIGN KEY (pantry_item_id, user_id)
    REFERENCES public.coach_pantry_items(id, user_id),
  CONSTRAINT coach_meal_plan_ingredients_key_check
    CHECK (length(btrim(ingredient_key)) BETWEEN 1 AND 200),
  CONSTRAINT coach_meal_plan_ingredients_name_check
    CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT coach_meal_plan_ingredients_quantity_check CHECK (quantity > 0),
  CONSTRAINT coach_meal_plan_ingredients_unit_check
    CHECK (unit IN ('g', 'ml', 'piece', 'tsp', 'tbsp')),
  CONSTRAINT coach_meal_plan_ingredients_category_check
    CHECK (category IN ('chilled', 'produce', 'pantry', 'frozen', 'other'))
);

CREATE INDEX IF NOT EXISTS coach_meal_plan_ingredients_entry_idx
  ON public.coach_meal_plan_ingredients
  (user_id, meal_plan_entry_id, shopping_required);

CREATE OR REPLACE FUNCTION public.reject_coach_pantry_event_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'coach_pantry_events is an append-only ledger';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reject_coach_pantry_event_mutation
  ON public.coach_pantry_events;
CREATE TRIGGER reject_coach_pantry_event_mutation
  BEFORE UPDATE OR DELETE ON public.coach_pantry_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_coach_pantry_event_mutation();

DROP TRIGGER IF EXISTS update_coach_pantry_items_timestamp
  ON public.coach_pantry_items;
CREATE TRIGGER update_coach_pantry_items_timestamp
  BEFORE UPDATE ON public.coach_pantry_items
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

DROP TRIGGER IF EXISTS update_coach_shopping_lists_timestamp
  ON public.coach_shopping_lists;
CREATE TRIGGER update_coach_shopping_lists_timestamp
  BEFORE UPDATE ON public.coach_shopping_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

DROP TRIGGER IF EXISTS update_coach_shopping_list_items_timestamp
  ON public.coach_shopping_list_items;
CREATE TRIGGER update_coach_shopping_list_items_timestamp
  BEFORE UPDATE ON public.coach_shopping_list_items
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

DROP TRIGGER IF EXISTS update_coach_meal_plans_timestamp
  ON public.coach_meal_plans;
CREATE TRIGGER update_coach_meal_plans_timestamp
  BEFORE UPDATE ON public.coach_meal_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

DROP TRIGGER IF EXISTS update_coach_meal_plan_entries_timestamp
  ON public.coach_meal_plan_entries;
CREATE TRIGGER update_coach_meal_plan_entries_timestamp
  BEFORE UPDATE ON public.coach_meal_plan_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

DROP TRIGGER IF EXISTS update_coach_meal_plan_ingredients_timestamp
  ON public.coach_meal_plan_ingredients;
CREATE TRIGGER update_coach_meal_plan_ingredients_timestamp
  BEFORE UPDATE ON public.coach_meal_plan_ingredients
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

ALTER TABLE public.coach_pantry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_pantry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_meal_plan_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_meal_plan_ingredients ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.coach_pantry_items IS
  'Private current pantry balances and replenishment preferences used by the persistent AI coach.';
COMMENT ON TABLE public.coach_pantry_events IS
  'Private immutable, idempotent ledger of pantry quantity changes.';
COMMENT ON TABLE public.coach_shopping_lists IS
  'Private owner-only shopping-list headers generated or maintained with the AI coach.';
COMMENT ON TABLE public.coach_shopping_list_items IS
  'Private consolidated shopping needs, purchase progress, and verified retailer product snapshots.';
COMMENT ON TABLE public.coach_meal_plans IS
  'Private idempotent one-to-seven-day meal plans generated by the AI coach or owner.';
COMMENT ON TABLE public.coach_meal_plan_entries IS
  'Private dated meal slots with immutable recipe snapshots, nutrition, safety, and action state.';
COMMENT ON TABLE public.coach_meal_plan_ingredients IS
  'Private ingredient requirements linking meal entries to pantry and shopping state.';
