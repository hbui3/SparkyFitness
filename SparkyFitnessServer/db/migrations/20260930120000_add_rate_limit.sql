-- Migration: rate_limit
-- Better Auth's sign-in rate limit counters, one row per client address and
-- route. Kept in the database so every server instance counts against the same
-- limit. Better Auth reads and writes these rows through its own owner pool;
-- the app role is denied entirely in rls_policies.sql.

CREATE TABLE IF NOT EXISTS public.rate_limit (
  id           uuid PRIMARY KEY,
  key          text NOT NULL UNIQUE,
  count        integer NOT NULL,
  last_request bigint NOT NULL          -- epoch milliseconds
);

-- Better Auth deletes expired rows by last_request.
CREATE INDEX IF NOT EXISTS idx_rate_limit_last_request
  ON public.rate_limit (last_request);
