import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as reportRepository from '../models/reportRepository.js';
import { getClient } from '../db/poolManager.js';

vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(),
}));

describe('reportRepository source provenance', () => {
  const query = vi.fn();
  const release = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue({ rows: [] });
    (getClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      query,
      release,
    });
  });

  it('includes source metadata for standalone foods and aggregated meals', async () => {
    await reportRepository.getTabularFoodData(
      'user-1',
      '2026-08-01',
      '2026-08-19'
    );

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("COALESCE(fe.source, 'manual') AS source");
    expect(sql).toMatch(/cfe\.source,\s*cfe\.source_id/);
    expect(sql).toMatch(/string_agg\([\s\S]*cfe_meal\.source/);
    expect(release).toHaveBeenCalledOnce();
  });

  it('returns smart-scale composition and per-metric source provenance', async () => {
    await reportRepository.getMeasurementData(
      'user-1',
      '2026-08-01',
      '2026-08-19'
    );

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('muscle_mass_kg');
    expect(sql).toContain('bone_mass_kg');
    expect(sql).toContain('body_water_percentage');
    expect(sql).toContain('source_provenance');
    expect(release).toHaveBeenCalledOnce();
  });
});
