/**
 * The real importer, repositories, RLS role and PostgreSQL transactions. No
 * provider requests are made. Only a reachable, migrated *_test database may
 * run this suite; CI requires it explicitly so a missing DB cannot skip it.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endPool, getSystemClient } from '../db/poolManager.js';
import {
  processSpeedianceWorkouts,
  type SpeedianceWorkoutBundle,
} from '../integrations/speediance/speedianceDataProcessor.js';

async function testDatabaseReachable(): Promise<boolean> {
  if (process.env.SKIP_RLS_MATRIX === '1') return false;
  if (
    !process.env.SPARKY_FITNESS_DB_HOST ||
    !process.env.SPARKY_FITNESS_APP_DB_USER ||
    !/(^|[_-])test([_-]|$)/i.test(process.env.SPARKY_FITNESS_DB_NAME ?? '')
  )
    return false;
  const probe = new pg.Client({
    host: process.env.SPARKY_FITNESS_DB_HOST,
    port: Number(process.env.SPARKY_FITNESS_DB_PORT) || 5432,
    database: process.env.SPARKY_FITNESS_DB_NAME,
    user: process.env.SPARKY_FITNESS_APP_DB_USER,
    password: process.env.SPARKY_FITNESS_APP_DB_PASSWORD,
    connectionTimeoutMillis: 2_000,
  });
  try {
    await probe.connect();
    await probe.query(
      'SELECT manual_fields, watch_duration_minutes FROM public.exercise_entries LIMIT 0'
    );
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

const RUN = await testDatabaseReachable();
if (process.env.REQUIRE_SPEEDIANCE_DB_INTEGRATION === '1' && !RUN) {
  throw new Error(
    'Speediance DB integration requires a reachable, migrated PostgreSQL test database and app role.'
  );
}

const OWNER = randomUUID();
const FIXTURE = randomUUID();
const DAY = '2026-08-18';
const WORKOUT_NAME = `Speediance DB ${FIXTURE}`;

interface StoredEntry {
  id: string;
  source_id: string;
  exercise_preset_entry_id: string;
  workout_preset_id: number;
  calories_burned: number;
  duration_minutes: number;
  notes: string | null;
  manual_fields: string[];
  watch_duration_minutes: number | null;
  sets: Array<{ reps: number; weight: number }>;
}

function bundle(
  trainingId: string,
  groups: string[] = ['a', 'b']
): SpeedianceWorkoutBundle {
  return {
    record: {
      trainingId,
      title: WORKOUT_NAME,
      type: 5,
      startTimestamp: Date.parse(`${DAY}T05:30:00Z`) / 1000,
      endTimestamp: null,
      trainingTime: 1_800,
      calorie: 210,
      totalCapacity: 1_000,
      raw: {
        trainingId,
        startTimestamp: Date.parse(`${DAY}T05:30:00Z`) / 1000,
      },
    },
    exercises: groups.map((group) => ({
      actionLibraryName: `Speediance DB ${FIXTURE} ${group}`,
      actionLibraryId: null,
      actionLibraryGroupId: `${FIXTURE}-${group}`,
      completionMethod: 1,
      isLeftRight: false,
      totalCapacity: 500,
      maxWeight: 40,
      primaryMuscles: ['chest'],
      secondaryMuscles: ['triceps'],
      finishedReps: [
        {
          finishedCount: 10,
          targetCount: 10,
          capacity: 400,
          time: 0,
          leftRight: null,
          weights: [40],
          leftWeights: [],
          rightWeights: [],
          raw: { finishedCount: 10 },
        },
      ],
      raw: { group },
    })),
  };
}

describe.runIf(RUN)('Speediance import persistence (real PostgreSQL)', () => {
  let sys: pg.PoolClient;

  const importBundle = (input: SpeedianceWorkoutBundle) =>
    processSpeedianceWorkouts(OWNER, OWNER, [input], DAY, DAY, 'UTC');

  async function entries(trainingId: string): Promise<StoredEntry[]> {
    const result = await sys.query<StoredEntry>(
      `SELECT ee.id, ee.source_id, ee.exercise_preset_entry_id, epe.workout_preset_id,
              ee.calories_burned, ee.duration_minutes, ee.notes, ee.manual_fields,
              ee.watch_duration_minutes,
              COALESCE((SELECT json_agg(json_build_object('reps', s.reps, 'weight', s.weight) ORDER BY s.set_number)
                        FROM public.exercise_entry_sets s WHERE s.exercise_entry_id = ee.id), '[]'::json) AS sets
         FROM public.exercise_entries ee
         JOIN public.exercise_preset_entries epe ON epe.id = ee.exercise_preset_entry_id
        WHERE ee.user_id = $1 AND ee.source = 'Speediance'
          AND left(ee.source_id, length($2)) = $2
        ORDER BY ee.source_id`,
      [OWNER, `${trainingId}:`]
    );
    return result.rows;
  }

  function expectTotals(
    rows: StoredEntry[],
    calories = 210,
    duration = 30
  ): void {
    expect(
      rows.reduce((sum, row) => sum + Number(row.calories_burned), 0)
    ).toBe(calories);
    expect(
      rows.reduce((sum, row) => sum + Number(row.duration_minutes), 0)
    ).toBe(duration);
  }

  async function detailCount(trainingId: string): Promise<number> {
    const result = await sys.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.exercise_entry_activity_details d
       JOIN public.exercise_entries ee ON ee.id = d.exercise_entry_id
       WHERE ee.user_id = $1 AND left(ee.source_id, length($2)) = $2`,
      [OWNER, `${trainingId}:`]
    );
    return result.rows[0]!.count;
  }

  async function withRejectedWrite<T>(
    table: 'exercise_entries' | 'exercise_entry_activity_details',
    matchingValue: string,
    work: () => Promise<T>
  ): Promise<T> {
    const name = `speediance_fixture_${randomUUID().replaceAll('-', '')}`;
    const condition =
      table === 'exercise_entries'
        ? 'NEW.user_id::text = TG_ARGV[0] AND NEW.source_id = TG_ARGV[1]'
        : "NEW.created_by_user_id::text = TG_ARGV[0] AND NEW.detail_data #>> '{training,trainingId}' = TG_ARGV[1]";
    // Names and arguments below are generated UUIDs plus fixed fixture suffixes,
    // never external input. The trigger rejects only this suite's owner/record.
    await sys.query(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF ${condition} THEN
          RAISE EXCEPTION 'synthetic Speediance write failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$`);
    try {
      await sys.query(`CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON public.${table}
        FOR EACH ROW EXECUTE FUNCTION public.${name}('${OWNER}', '${matchingValue}')`);
      return await work();
    } finally {
      await sys.query(`DROP TRIGGER IF EXISTS ${name} ON public.${table}`);
      await sys.query(`DROP FUNCTION IF EXISTS public.${name}()`);
    }
  }

  beforeAll(async () => {
    sys = await getSystemClient();
    await sys.query(
      'INSERT INTO public."user" (id, email, email_verified) VALUES ($1, $2, true)',
      [OWNER, `speediance-${OWNER}@example.test`]
    );
  });

  afterAll(async () => {
    try {
      if (sys) {
        await sys.query(
          'DELETE FROM public.exercise_entries WHERE user_id = $1',
          [OWNER]
        );
        await sys.query(
          'DELETE FROM public.exercise_preset_entries WHERE user_id = $1',
          [OWNER]
        );
        await sys.query(
          'DELETE FROM public.workout_presets WHERE user_id = $1',
          [OWNER]
        );
        await sys.query('DELETE FROM public.exercises WHERE user_id = $1', [
          OWNER,
        ]);
        await sys.query('DELETE FROM public."user" WHERE id = $1', [OWNER]);
      }
    } finally {
      sys?.release();
      await endPool();
    }
  });

  it('persists detail and reuses workout, exercise and reusable-template identities on retry', async () => {
    const input = bundle(`${FIXTURE}-repeat`);
    expect(await importBundle(input)).toEqual({
      importedWorkouts: 1,
      importedExercises: 2,
      skippedWorkouts: 0,
    });
    const first = await entries(input.record.trainingId);
    expect(first).toHaveLength(2);
    expect(first.every((row) => row.sets.length === 1)).toBe(true);
    expectTotals(first);
    await importBundle(input);
    const repeated = await entries(input.record.trainingId);
    expect(repeated).toEqual(first);
    expect(
      new Set(repeated.map((row) => row.exercise_preset_entry_id)).size
    ).toBe(1);
    expect(await detailCount(input.record.trainingId)).toBe(2);
    const library = await sys.query<{ exercises: number; sets: number }>(
      `SELECT count(DISTINCT e.id)::int AS exercises, count(s.id)::int AS sets
         FROM public.workout_preset_exercises e
         LEFT JOIN public.workout_preset_exercise_sets s ON s.workout_preset_exercise_id = e.id
        WHERE e.workout_preset_id = $1`,
      [first[0]!.workout_preset_id]
    );
    expect(library.rows[0]).toEqual({ exercises: 2, sets: 2 });
  });

  it.each(['provider', 'split', 'watch'])(
    'retains an omitted exercise and counts each total once after a partial retry (%s)',
    async (mode) => {
      const input = bundle(`${FIXTURE}-partial-${mode}`);
      await importBundle(input);
      const before = await entries(input.record.trainingId);
      const a = before[0]!;
      const b = before[1]!;
      const fields = [
        'notes',
        'sets',
        ...(mode === 'split' ? ['duration_minutes'] : []),
      ];
      await sys.query(
        `UPDATE public.exercise_entries SET notes = 'My retained notes', manual_fields = $2::text[],
           duration_minutes = $3, watch_duration_minutes = $4 WHERE id = $1`,
        [
          a.id,
          fields,
          mode === 'watch' ? 37 : mode === 'split' ? 35 : 30,
          mode === 'watch' ? 37 : null,
        ]
      );
      await sys.query(
        'UPDATE public.exercise_entry_sets SET reps = 42 WHERE exercise_entry_id = $1',
        [a.id]
      );
      if (mode !== 'provider') {
        await sys.query(
          "UPDATE public.exercise_entries SET calories_burned = 240, manual_fields = ARRAY['calories_burned']::text[] WHERE id = $1",
          [b.id]
        );
      }
      input.exercises = input.exercises.slice(1);
      await importBundle(input);
      await importBundle(input);
      const after = await entries(input.record.trainingId);
      expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
      expect(after[0]!.notes).toBe('My retained notes');
      expect(after[0]!.sets[0]!.reps).toBe(42);
      expectTotals(
        after,
        mode === 'provider' ? 210 : 240,
        mode === 'watch' ? 37 : mode === 'split' ? 35 : 30
      );
      expect(await detailCount(input.record.trainingId)).toBe(2);
    }
  );

  it.each(['plain', 'manual', 'watch', 'zones', 'telemetry'])(
    'upgrades a summary without deleting protected corrections or telemetry (%s)',
    async (mode) => {
      const input = bundle(`${FIXTURE}-summary-${mode}`, []);
      await importBundle(input);
      const summary = (await entries(input.record.trainingId))[0]!;
      if (mode === 'manual') {
        await sys.query(
          `UPDATE public.exercise_entries SET notes = 'Keep this summary note', calories_burned = 240,
            duration_minutes = 35, manual_fields = ARRAY['notes', 'calories_burned', 'duration_minutes']::text[]
           WHERE id = $1`,
          [summary.id]
        );
      }
      if (mode === 'watch') {
        await sys.query(
          'UPDATE public.exercise_entries SET watch_duration_minutes = 37, duration_minutes = 37 WHERE id = $1',
          [summary.id]
        );
      }
      if (mode === 'telemetry') {
        await sys.query(
          'UPDATE public.exercise_entries SET max_heart_rate = 175 WHERE id = $1',
          [summary.id]
        );
      }
      if (mode === 'watch' || mode === 'zones') {
        await sys.query(
          `INSERT INTO public.exercise_entry_hr_zones (user_id, exercise_entry_id, entry_date, zone_index, seconds_in_zone)
           VALUES ($1, $2, $3, 2, 600)`,
          [OWNER, summary.id, DAY]
        );
      }
      const detailed = bundle(input.record.trainingId);
      await importBundle(detailed);
      const after = await entries(input.record.trainingId);
      expect(after).toHaveLength(mode === 'plain' ? 2 : 3);
      expect(after.some((row) => row.id === summary.id)).toBe(mode !== 'plain');
      expectTotals(
        after,
        mode === 'manual' ? 240 : 210,
        mode === 'watch' ? 37 : mode === 'manual' ? 35 : 30
      );
      if (mode === 'manual')
        expect(after.find((row) => row.id === summary.id)?.notes).toBe(
          'Keep this summary note'
        );
      if (mode === 'watch' || mode === 'zones') {
        const zones = await sys.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM public.exercise_entry_hr_zones WHERE exercise_entry_id = $1',
          [summary.id]
        );
        expect(zones.rows[0]!.count).toBe(1);
      }
    }
  );

  it('preserves detail when the provider returns no workouts or no sets', async () => {
    const input = bundle(`${FIXTURE}-empty`);
    await importBundle(input);
    const before = await entries(input.record.trainingId);
    await processSpeedianceWorkouts(OWNER, OWNER, [], DAY, DAY, 'UTC');
    input.exercises = [];
    expect((await importBundle(input)).skippedWorkouts).toBe(1);
    expect(await entries(input.record.trainingId)).toEqual(before);
    expect(await detailCount(input.record.trainingId)).toBe(2);
  });

  it('rolls back earlier exercise and detail writes when a later database statement fails', async () => {
    const input = bundle(`${FIXTURE}-rollback`);
    await importBundle(input);
    const before = await entries(input.record.trainingId);
    input.record.calorie = 999;
    input.exercises[0]!.finishedReps[0]!.weights = [60];
    const result = await withRejectedWrite(
      'exercise_entries',
      `${input.record.trainingId}:${FIXTURE}-b`,
      () => importBundle(input)
    );
    expect(result).toEqual({
      importedWorkouts: 0,
      importedExercises: 0,
      skippedWorkouts: 1,
    });
    expect(await entries(input.record.trainingId)).toEqual(before);
    expect(await detailCount(input.record.trainingId)).toBe(2);
  });

  it.each([false, true])(
    'recovers from a raw-detail SQL failure through the savepoint and retains existing raw data (%s)',
    async (existing) => {
      const input = bundle(`${FIXTURE}-raw-failure-${existing}`);
      if (existing) await importBundle(input);
      const result = await withRejectedWrite(
        'exercise_entry_activity_details',
        input.record.trainingId,
        () => importBundle(input)
      );
      expect(result).toEqual({
        importedWorkouts: 1,
        importedExercises: 2,
        skippedWorkouts: 0,
      });
      const stored = await entries(input.record.trainingId);
      expect(stored).toHaveLength(2);
      expect(stored.every((row) => row.sets.length === 1)).toBe(true);
      expectTotals(stored);
      expect(await detailCount(input.record.trainingId)).toBe(existing ? 2 : 0);
    }
  );
});
