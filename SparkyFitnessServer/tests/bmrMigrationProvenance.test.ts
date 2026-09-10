import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../db/migrations/20260827180000_add_bmr_to_check_in_measurements.sql'
);
const boundsMigrationPath = resolve(
  __dirname,
  '../db/migrations/20260908120000_narrow_check_in_bmr_bounds.sql'
);
const staleProvenanceMigrationPath = resolve(
  __dirname,
  '../db/migrations/20260910120000_remove_stale_bmr_provenance.sql'
);

describe('BMR check-in migration provenance', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('carries source and an optional legacy source_id into BMR provenance', () => {
    expect(sql).toContain("NULLIF(BTRIM(to_jsonb(cm)->>'source_id'), '')");
    expect(sql).toMatch(
      /jsonb_strip_nulls\(jsonb_build_object\([\s\S]*?'source', source,[\s\S]*?'source_id', source_id/
    );
  });

  it('upserts value and provenance without overwriting a different BMR', () => {
    expect(sql).toMatch(
      /INSERT INTO public\.check_in_measurements AS ci[\s\S]*?ON CONFLICT \(user_id, entry_date\) DO UPDATE/
    );
    expect(sql).toContain('WHERE ci.bmr IS NULL OR ci.bmr = EXCLUDED.bmr');
    expect(sql).toContain(
      "COALESCE(ci.source_provenance, '{}'::jsonb) ? 'bmr'"
    );
  });

  it('chooses the latest valid row deterministically', () => {
    expect(sql).toContain('WHERE parsed_value BETWEEN 300 AND 10000');
    expect(sql).toMatch(
      /updated_at DESC NULLS LAST,[\s\S]*?entry_timestamp DESC NULLS LAST,[\s\S]*?id DESC/
    );
  });

  it('deletes only valid legacy rows whose exact value and provenance were stored', () => {
    expect(sql).toContain('upserted.bmr = latest_bmr.bmr');
    expect(sql).toContain(
      "(upserted.source_provenance->'bmr') = (latest_bmr.provenance->'bmr')"
    );
    expect(sql).toContain('id AS legacy_id');
    expect(sql).toContain('migrated.legacy_id = cm.id');
    expect(sql).not.toMatch(/ci\.bmr IS NOT NULL/);
  });
});

describe('BMR bounds migration provenance', () => {
  const boundsSql = readFileSync(boundsMigrationPath, 'utf8');
  const staleProvenanceSql = readFileSync(staleProvenanceMigrationPath, 'utf8');

  it('clears only values outside the narrowed bounds', () => {
    expect(boundsSql).toContain('SET bmr = NULL');
    expect(boundsSql).toContain('bmr < 600 OR bmr > 6000');
  });

  it('removes stale BMR provenance in a separately replay-safe migration', () => {
    expect(staleProvenanceSql).toContain("source_provenance - 'bmr'");
    expect(staleProvenanceSql).toContain('WHERE bmr IS NULL');
    expect(staleProvenanceSql).toContain("source_provenance ? 'bmr'");
  });
});
