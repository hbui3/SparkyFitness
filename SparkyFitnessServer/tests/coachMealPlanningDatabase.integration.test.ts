/**
 * Real-DB invariants for persistent coach meal planning.
 *
 * This suite exercises constraints and triggers that mocked repository tests
 * cannot prove. It only runs against a reachable database whose name contains
 * "test" and rolls every fixture transaction back. Never point it at production.
 */
import pg from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { endPool, getSystemClient } from '../db/poolManager.js';

async function mealPlanningTestDbReachable(): Promise<boolean> {
  if (process.env.SKIP_RLS_MATRIX === '1') return false;
  const database = process.env.SPARKY_FITNESS_DB_NAME ?? '';
  if (!/test/i.test(database)) return false;
  if (
    !process.env.SPARKY_FITNESS_DB_HOST ||
    !process.env.SPARKY_FITNESS_DB_USER
  ) {
    return false;
  }
  const probe = new pg.Client({
    host: process.env.SPARKY_FITNESS_DB_HOST,
    port: Number(process.env.SPARKY_FITNESS_DB_PORT) || 5432,
    database,
    user: process.env.SPARKY_FITNESS_DB_USER,
    password: process.env.SPARKY_FITNESS_DB_PASSWORD,
    connectionTimeoutMillis: 2_000,
  });
  try {
    await probe.connect();
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

const RUN = await mealPlanningTestDbReachable();

const USER_ID = '00000000-0000-4000-c000-000000000001';
const PANTRY_ITEM_ID = '00000000-0000-4000-c000-000000000002';
const PANTRY_EVENT_ID = '00000000-0000-4000-c000-000000000003';
const SHOPPING_LIST_ID = '00000000-0000-4000-c000-000000000004';
const SHOPPING_ITEM_ID = '00000000-0000-4000-c000-000000000005';
const DUPLICATE_SHOPPING_ITEM_ID = '00000000-0000-4000-c000-000000000006';
const MEAL_PLAN_ID = '00000000-0000-4000-c000-000000000007';
const MEAL_ENTRY_ID = '00000000-0000-4000-c000-000000000008';

async function withRollback(
  work: (client: PoolClient) => Promise<void>
): Promise<void> {
  const client = await getSystemClient();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await work(client);
  } finally {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    client.release();
  }
}

async function seedUser(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO public."user" (id, email, email_verified)
     VALUES ($1, $2, true)`,
    [USER_ID, 'coach-meal-planning-db@example.test']
  );
}

async function expectRejectedStatement(
  client: PoolClient,
  savepoint: string,
  sql: string,
  parameters: unknown[],
  expectedCode: string
): Promise<void> {
  await client.query(`SAVEPOINT ${savepoint}`);
  await expect(client.query(sql, parameters)).rejects.toMatchObject({
    code: expectedCode,
  });
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
}

describe.runIf(RUN)('coach meal-planning database invariants', () => {
  afterAll(async () => {
    await endPool();
  });

  it('rejects direct ledger mutations while allowing the owner-account cascade', async () => {
    await withRollback(async (client) => {
      await seedUser(client);
      await client.query(
        `INSERT INTO public.coach_pantry_items (
           id, user_id, ingredient_key, name, quantity, minimum_quantity,
           unit, category
         ) VALUES ($1, $2, 'reis', 'Reis', 500, 0, 'g', 'pantry')`,
        [PANTRY_ITEM_ID, USER_ID]
      );
      await client.query(
        `INSERT INTO public.coach_pantry_events (
           id, user_id, pantry_item_id, event_type, delta_quantity, unit,
           source, idempotency_key
         ) VALUES ($1, $2, $3, 'adjust', 500, 'g', 'manual', 'db-ledger-test')`,
        [PANTRY_EVENT_ID, USER_ID, PANTRY_ITEM_ID]
      );

      await expectRejectedStatement(
        client,
        'ledger_update',
        'UPDATE public.coach_pantry_events SET notes = $2 WHERE id = $1',
        [PANTRY_EVENT_ID, 'mutated'],
        'P0001'
      );
      await expectRejectedStatement(
        client,
        'ledger_delete',
        'DELETE FROM public.coach_pantry_events WHERE id = $1',
        [PANTRY_EVENT_ID],
        'P0001'
      );

      const beforeCascade = await client.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM public.coach_pantry_events WHERE id = $1',
        [PANTRY_EVENT_ID]
      );
      expect(beforeCascade.rows[0]?.count).toBe(1);

      await client.query('DELETE FROM public."user" WHERE id = $1', [USER_ID]);
      const afterCascade = await client.query<{
        events: number;
        pantry_items: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM public.coach_pantry_events
             WHERE user_id = $1) AS events,
           (SELECT COUNT(*)::int FROM public.coach_pantry_items
             WHERE user_id = $1) AS pantry_items`,
        [USER_ID]
      );
      expect(afterCascade.rows[0]).toEqual({ events: 0, pantry_items: 0 });
    });
  });

  it('enforces one consolidated shopping item per list, ingredient, and unit', async () => {
    await withRollback(async (client) => {
      await seedUser(client);
      await client.query(
        `INSERT INTO public.coach_shopping_lists (id, user_id, title)
         VALUES ($1, $2, 'DB constraint test')`,
        [SHOPPING_LIST_ID, USER_ID]
      );
      await client.query(
        `INSERT INTO public.coach_shopping_list_items (
           id, user_id, shopping_list_id, ingredient_key, name,
           required_quantity, unit, category
         ) VALUES ($1, $2, $3, 'reis', 'Reis', 500, 'g', 'pantry')`,
        [SHOPPING_ITEM_ID, USER_ID, SHOPPING_LIST_ID]
      );

      await client.query('SAVEPOINT duplicate_shopping_item');
      await expect(
        client.query(
          `INSERT INTO public.coach_shopping_list_items (
             id, user_id, shopping_list_id, ingredient_key, name,
             required_quantity, unit, category
           ) VALUES ($1, $2, $3, 'reis', 'Reis doppelt', 250, 'g', 'pantry')`,
          [DUPLICATE_SHOPPING_ITEM_ID, USER_ID, SHOPPING_LIST_ID]
        )
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'coach_shopping_list_items_identity_unique_idx',
      });
      await client.query('ROLLBACK TO SAVEPOINT duplicate_shopping_item');
      await client.query('RELEASE SAVEPOINT duplicate_shopping_item');

      const result = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM public.coach_shopping_list_items
          WHERE shopping_list_id = $1 AND ingredient_key = 'reis' AND unit = 'g'`,
        [SHOPPING_LIST_ID]
      );
      expect(result.rows[0]?.count).toBe(1);
    });
  });

  it('enforces the Zod text bounds for persisted warnings and instructions', async () => {
    await withRollback(async (client) => {
      await seedUser(client);
      const invalidTextArrays: Array<Array<string | null>> = [
        [''],
        ['x'.repeat(1_001)],
        [null],
      ];

      for (const [index, warnings] of invalidTextArrays.entries()) {
        await expectRejectedStatement(
          client,
          `invalid_warnings_${index}`,
          `INSERT INTO public.coach_meal_plans (
             id, user_id, start_date, end_date, source, algorithm_version,
             generation_key, warnings
           ) VALUES (
             gen_random_uuid(), $1, '2026-09-01', '2026-09-01', 'coach',
             'db-test', $2, $3::text[]
           )`,
          [USER_ID, `invalid-warnings-${index}`, warnings],
          '23514'
        );
      }

      await client.query(
        `INSERT INTO public.coach_meal_plans (
           id, user_id, start_date, end_date, source, algorithm_version,
           generation_key, warnings
         ) VALUES (
           $1, $2, '2026-09-01', '2026-09-01', 'coach', 'db-test',
           'valid-warning-bounds', $3::text[]
         )`,
        [MEAL_PLAN_ID, USER_ID, ['x', 'x'.repeat(1_000)]]
      );

      for (const [index, instructions] of invalidTextArrays.entries()) {
        await expectRejectedStatement(
          client,
          `invalid_instructions_${index}`,
          `INSERT INTO public.coach_meal_plan_entries (
             id, user_id, meal_plan_id, plan_date, slot, recipe_key,
             recipe_name, recipe_instructions, servings, safety_status
           ) VALUES (
             gen_random_uuid(), $1, $2, '2026-09-01', 'breakfast',
             'db-test-recipe', 'DB test recipe', $3::text[], 1, 'validated'
           )`,
          [USER_ID, MEAL_PLAN_ID, instructions],
          '23514'
        );
      }

      await client.query(
        `INSERT INTO public.coach_meal_plan_entries (
           id, user_id, meal_plan_id, plan_date, slot, recipe_key,
           recipe_name, recipe_instructions, servings, safety_status
         ) VALUES (
           $1, $2, $3, '2026-09-01', 'breakfast', 'db-test-recipe',
           'DB test recipe', $4::text[], 1, 'validated'
         )`,
        [MEAL_ENTRY_ID, USER_ID, MEAL_PLAN_ID, ['x', 'x'.repeat(1_000)]]
      );
      const result = await client.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM public.coach_meal_plan_entries WHERE id = $1',
        [MEAL_ENTRY_ID]
      );
      expect(result.rows[0]?.count).toBe(1);
    });
  });
});
