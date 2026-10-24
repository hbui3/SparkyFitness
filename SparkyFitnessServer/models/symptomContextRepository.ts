import { getClient } from '../db/poolManager.js';

// Read-only queries that gather the diary around a symptom entry. Every query
// goes through `getClient(userId)`, so row-level security decides what the caller
// may see: a delegate without diary or check-in access simply gets no rows.

export interface EntryAnchor {
  id: string;
  entry_date: string;
  /** When the entry began: an episode's start, otherwise when it was logged. */
  at: Date;
  /** When an episode started; null for a quick log. */
  started_at: Date | null;
  /** When an episode ended; null for a quick log or one still running. */
  ended_at: Date | null;
}

export interface FoodNameRow {
  entry_date: string;
  food_name: string;
}

export interface StepsRow {
  entry_date: string;
  steps: number;
}

export interface WorkoutNameRow {
  entry_date: string;
  exercise_name: string;
}

export interface PreviousSleepRow {
  entry_id: string;
  bedtime: Date;
  wake_time: Date;
  asleep_seconds: number;
}

export interface DoseRow {
  entry_id: string;
  med_name_snapshot: string | null;
  dose_amount_snapshot: number | null;
  dose_unit_snapshot: string | null;
  taken_at: Date;
}

async function getEntryAnchors(
  userId: string,
  ids: string[]
): Promise<EntryAnchor[]> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT id, entry_date,
              COALESCE(started_at, logged_at) AS at,
              started_at,
              ended_at
         FROM symptom_entries
        WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, ids]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function getFoodNames(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<FoodNameRow[]> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT entry_date, food_name
         FROM food_entries
        WHERE user_id = $1
          AND entry_date BETWEEN $2 AND $3
          AND food_name IS NOT NULL
        ORDER BY entry_date, entry_time NULLS LAST, created_at`,
      [userId, fromDate, toDate]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/** The highest step count any source recorded for each day. */
async function getSteps(userId: string, dates: string[]): Promise<StepsRow[]> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT entry_date, MAX(steps) AS steps
         FROM (
           SELECT entry_date, steps
             FROM check_in_measurements
            WHERE user_id = $1 AND entry_date = ANY($2::date[]) AND steps IS NOT NULL
           UNION ALL
           SELECT entry_date, total_steps
             FROM daily_health_metrics
            WHERE user_id = $1 AND entry_date = ANY($2::date[]) AND total_steps IS NOT NULL
         ) s
        GROUP BY entry_date`,
      [userId, dates]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function getWorkoutNames(
  userId: string,
  dates: string[]
): Promise<WorkoutNameRow[]> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT entry_date, exercise_name
         FROM exercise_entries
        WHERE user_id = $1
          AND entry_date = ANY($2::date[])
          AND exercise_name IS NOT NULL
        ORDER BY entry_date, entry_time NULLS LAST, created_at`,
      [userId, dates]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/** For each anchor, the latest sleep that ended within 36 hours before it. */
async function getPreviousSleep(
  userId: string,
  anchors: Array<{ id: string; at: Date }>
): Promise<PreviousSleepRow[]> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT DISTINCT ON (a.id)
              a.id AS entry_id, s.bedtime, s.wake_time,
              COALESCE(s.time_asleep_in_seconds, s.duration_in_seconds) AS asleep_seconds
         FROM unnest($2::text[], $3::timestamptz[]) AS a(id, at)
         JOIN sleep_entries s
           ON s.user_id = $1
          AND s.wake_time <= a.at
          AND s.wake_time > a.at - interval '36 hours'
        ORDER BY a.id, s.wake_time DESC`,
      [userId, anchors.map((a) => a.id), anchors.map((a) => a.at)]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/** Doses taken inside each window, oldest first. */
async function getDoses(
  userId: string,
  windows: Array<{ id: string; from: Date; to: Date }>
): Promise<DoseRow[]> {
  if (windows.length === 0) return [];
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT w.id AS entry_id, m.med_name_snapshot, m.dose_amount_snapshot,
              m.dose_unit_snapshot, m.taken_at
         FROM unnest($2::text[], $3::timestamptz[], $4::timestamptz[]) AS w(id, from_at, to_at)
         JOIN medication_entries m
           ON m.user_id = $1
          AND m.status = 'taken'
          AND m.taken_at BETWEEN w.from_at AND w.to_at
        ORDER BY m.taken_at`,
      [
        userId,
        windows.map((w) => w.id),
        windows.map((w) => w.from),
        windows.map((w) => w.to),
      ]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

const symptomContextRepository = {
  getEntryAnchors,
  getFoodNames,
  getSteps,
  getWorkoutNames,
  getPreviousSleep,
  getDoses,
};

export default symptomContextRepository;
