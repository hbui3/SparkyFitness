import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../db/migrations/20260827180000_add_bmr_to_check_in_measurements.sql'
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
