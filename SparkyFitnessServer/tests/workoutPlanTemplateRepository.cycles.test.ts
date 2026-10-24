import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '../db/poolManager.js';
import workoutPlanTemplateRepository from '../models/workoutPlanTemplateRepository.js';

vi.mock('../db/poolManager.js', () => ({ getClient: vi.fn() }));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const client = { query: vi.fn(), release: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClient).mockResolvedValue(client as unknown as PoolClient);
});

describe('weekly plan cycles alongside sequential progression', () => {
  it.each([
    { day: '2026-10-05', expected: 101 },
    { day: '2026-10-12', expected: 102 },
    { day: '2026-10-19', expected: 101 },
  ])('selects only the due cycle week on $day', async ({ day, expected }) => {
    client.query.mockResolvedValue({
      rows: [
        {
          id: 1,
          schedule_type: 'weekly',
          start_date: '2026-10-05',
          cycle_length_weeks: 2,
          assignments: [
            { id: 101, day_of_week: 1, week_index: 0 },
            { id: 102, day_of_week: 1, week_index: 1 },
          ],
        },
      ],
    });

    const plans =
      await workoutPlanTemplateRepository.getActiveWorkoutPlanForDate(
        'owner',
        day
      );

    expect(
      plans[0].next_assignments?.map((assignment) => assignment.id)
    ).toEqual([expected]);
    expect(plans[0].next_assignment?.id).toBe(expected);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
