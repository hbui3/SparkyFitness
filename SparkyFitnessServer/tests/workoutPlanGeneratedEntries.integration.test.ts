import pg from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getSystemClient, endPool } from '../db/poolManager.js';
import exerciseService from '../services/exerciseService.js';
import workoutPlanTemplateService from '../services/workoutPlanTemplateService.js';
import { WORKOUT_PLAN_ENTRY_SOURCE } from '../models/exerciseTemplate.js';

/**
 * #2677 against a real database: a prefill plan's generated rows that the user
 * edited in place survive editing and deactivating the plan, untouched rows are
 * regenerated or removed, and no second row appears next to an edited one.
 * Runs only against a database named *_test, like the other integration tests.
 */
async function dbReachable(): Promise<boolean> {
  if (process.env.SKIP_RLS_MATRIX === '1') return false;
  if (
    !process.env.SPARKY_FITNESS_DB_HOST ||
    !process.env.SPARKY_FITNESS_APP_DB_USER
  )
    return false;
  if (!/(^|[_-])test([_-]|$)/i.test(process.env.SPARKY_FITNESS_DB_NAME ?? ''))
    return false;
  const probe = new pg.Client({
    host: process.env.SPARKY_FITNESS_DB_HOST,
    port: Number(process.env.SPARKY_FITNESS_DB_PORT) || 5432,
    database: process.env.SPARKY_FITNESS_DB_NAME,
    user: process.env.SPARKY_FITNESS_APP_DB_USER,
    password: process.env.SPARKY_FITNESS_APP_DB_PASSWORD,
    connectionTimeoutMillis: 2000,
  });
  try {
    await probe.connect();
    await probe.query('SELECT id FROM public.workout_plan_templates LIMIT 0');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

const RUN = await dbReachable();
const OWNER = '00000000-0000-4000-b277-000000000001';
const EXERCISE = '00000000-0000-4000-b277-000000000002';
// Plans start no earlier than the user's real today (resolveTemplateStartDay),
// so the fixture uses the current UTC day and the same weekday a week later.
const now = new Date();
const TODAY = now.toISOString().slice(0, 10);
const DOW = now.getUTCDay();
const NEXT_WEEK = new Date(now.getTime() + 7 * 86_400_000)
  .toISOString()
  .slice(0, 10);

describe.runIf(RUN)('workout plan generated entries (#2677)', () => {
  let sys: pg.PoolClient;
  let presetId: number;
  let planId: string | number;

  /** Diary rows linked to the plan on a day, standalone and grouped. */
  async function rowsOn(day: string) {
    const standalone = await sys.query(
      `SELECT ee.id, ee.source
       FROM public.exercise_entries ee
       JOIN public.workout_plan_template_assignments a ON a.id = ee.workout_plan_assignment_id
       WHERE a.template_id = $1 AND ee.entry_date = $2 AND ee.exercise_preset_entry_id IS NULL`,
      [planId, day]
    );
    const sessions = await sys.query(
      `SELECT DISTINCT pe.id, pe.source
       FROM public.exercise_preset_entries pe
       JOIN public.exercise_entries ee ON ee.exercise_preset_entry_id = pe.id
       JOIN public.workout_plan_template_assignments a ON a.id = ee.workout_plan_assignment_id
       WHERE a.template_id = $1 AND pe.entry_date = $2`,
      [planId, day]
    );
    return { standalone: standalone.rows, sessions: sessions.rows };
  }

  async function clearFixtures() {
    await sys.query(
      'DELETE FROM public.exercise_preset_entries WHERE user_id = $1',
      [OWNER]
    );
    await sys.query('DELETE FROM public.exercise_entries WHERE user_id = $1', [
      OWNER,
    ]);
    await sys.query(
      'DELETE FROM public.workout_plan_templates WHERE user_id = $1',
      [OWNER]
    );
    await sys.query('DELETE FROM public.workout_presets WHERE user_id = $1', [
      OWNER,
    ]);
    await sys.query('DELETE FROM public.exercises WHERE id = $1', [EXERCISE]);
    await sys.query('DELETE FROM public."user" WHERE id = $1', [OWNER]);
  }

  beforeAll(async () => {
    sys = await getSystemClient();
    await clearFixtures();
    await sys.query(
      'INSERT INTO public."user" (id, email, email_verified) VALUES ($1, $2, true)',
      [OWNER, 'workout-plan-2677@example.test']
    );
    await sys.query(
      "INSERT INTO public.exercises (id, name, source, user_id, is_custom, category) VALUES ($1, 'Plan fixture', 'test', $2, true, 'Strength')",
      [EXERCISE, OWNER]
    );
    presetId = (
      await sys.query(
        "INSERT INTO public.workout_presets (user_id, name) VALUES ($1, 'Plan fixture preset') RETURNING id",
        [OWNER]
      )
    ).rows[0].id;
    const presetExercise = (
      await sys.query(
        'INSERT INTO public.workout_preset_exercises (workout_preset_id, exercise_id) VALUES ($1, $2) RETURNING id',
        [presetId, EXERCISE]
      )
    ).rows[0].id;
    await sys.query(
      'INSERT INTO public.workout_preset_exercise_sets (workout_preset_exercise_id, set_number, reps, weight) VALUES ($1, 1, 10, 40)',
      [presetExercise]
    );
  });

  afterAll(async () => {
    try {
      await clearFixtures();
    } finally {
      sys.release();
      await endPool();
    }
  });

  it('keeps edited generated rows on plan edit and deactivation, without duplicates', async () => {
    // The app always sends the whole plan; the repository update overwrites
    // every column, so a missing is_active would deactivate the plan.
    const planFields = {
      plan_name: 'Plan fixture',
      start_date: TODAY,
      end_date: NEXT_WEEK,
      is_active: true,
      schedule_type: 'weekly',
      entry_mode: 'prefill',
      currentClientDate: TODAY,
    };
    const plan = await workoutPlanTemplateService.createWorkoutPlanTemplate(
      OWNER,
      {
        ...planFields,
        assignments: [
          {
            day_of_week: DOW,
            exercise_id: EXERCISE,
            sets: [{ set_number: 1, reps: 8, weight: 50 }],
          },
          { day_of_week: DOW, workout_preset_id: presetId },
        ],
      } as never
    );
    planId = plan.id;

    const generated = await rowsOn(TODAY);
    expect(generated.standalone).toHaveLength(1);
    expect(generated.sessions).toHaveLength(1);
    expect(generated.standalone[0].source).toBe(WORKOUT_PLAN_ENTRY_SOURCE);
    expect(generated.sessions[0].source).toBe(WORKOUT_PLAN_ENTRY_SOURCE);
    const entryId = generated.standalone[0].id;
    const sessionId = generated.sessions[0].id;

    // The user fills in today's prefilled rows through the regular update paths.
    await exerciseService.updateExerciseEntry(OWNER, OWNER, entryId, {
      sets: [{ set_number: 1, reps: 12, weight: 55 }],
    });
    await exerciseService.updateGroupedWorkoutSession(OWNER, OWNER, sessionId, {
      notes: 'done',
    });

    const nextWeekBefore = await rowsOn(NEXT_WEEK);
    expect(nextWeekBefore.standalone).toHaveLength(1);
    expect(nextWeekBefore.sessions).toHaveLength(1);

    await workoutPlanTemplateService.updateWorkoutPlanTemplate(OWNER, planId, {
      ...planFields,
      plan_name: 'Plan fixture renamed',
    } as never);

    const afterEdit = await rowsOn(TODAY);
    expect(afterEdit.standalone.map((r) => r.id)).toEqual([entryId]);
    expect(afterEdit.sessions.map((r) => r.id)).toEqual([sessionId]);
    // Untouched rows of the next week were regenerated, once each.
    const nextWeekAfter = await rowsOn(NEXT_WEEK);
    expect(nextWeekAfter.standalone).toHaveLength(1);
    expect(nextWeekAfter.sessions).toHaveLength(1);
    expect(nextWeekAfter.standalone[0].id).not.toBe(
      nextWeekBefore.standalone[0].id
    );

    await workoutPlanTemplateService.updateWorkoutPlanTemplate(OWNER, planId, {
      ...planFields,
      plan_name: 'Plan fixture renamed',
      is_active: false,
    } as never);

    const afterDeactivate = await rowsOn(TODAY);
    expect(afterDeactivate.standalone.map((r) => r.id)).toEqual([entryId]);
    expect(afterDeactivate.sessions.map((r) => r.id)).toEqual([sessionId]);
    const nextWeekGone = await rowsOn(NEXT_WEEK);
    expect(nextWeekGone.standalone).toHaveLength(0);
    expect(nextWeekGone.sessions).toHaveLength(0);
  });
});
