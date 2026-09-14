-- New accounts in this fork start in German. Existing user choices are kept.
ALTER TABLE public.user_preferences
  ALTER COLUMN language SET DEFAULT 'de';
