import { getClient } from '../db/poolManager.js';
import type {
  CreateMindfulnessSessionBody,
  UpdateMindfulnessSessionBody,
  MindfulnessSessionResponse,
  MindfulnessDaySummaryResponse,
} from '@workspace/shared';

function mapRowToSession(
  row: Record<string, unknown>
): MindfulnessSessionResponse {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    entry_date: String(row.entry_date).split('T')[0] ?? String(row.entry_date),
    start_time: row.start_time
      ? new Date(row.start_time as string).toISOString()
      : null,
    end_time: row.end_time
      ? new Date(row.end_time as string).toISOString()
      : null,
    duration_seconds: Number(row.duration_seconds),
    session_type: String(row.session_type),
    provider: String(row.provider),
    external_id: row.external_id ? String(row.external_id) : null,
    heart_rate_avg:
      row.heart_rate_avg !== null && row.heart_rate_avg !== undefined
        ? Number(row.heart_rate_avg)
        : null,
    heart_rate_start:
      row.heart_rate_start !== null && row.heart_rate_start !== undefined
        ? Number(row.heart_rate_start)
        : null,
    heart_rate_end:
      row.heart_rate_end !== null && row.heart_rate_end !== undefined
        ? Number(row.heart_rate_end)
        : null,
    hrv_rmssd:
      row.hrv_rmssd !== null && row.hrv_rmssd !== undefined
        ? Number(row.hrv_rmssd)
        : null,
    stress_level_start:
      row.stress_level_start !== null && row.stress_level_start !== undefined
        ? Number(row.stress_level_start)
        : null,
    stress_level_end:
      row.stress_level_end !== null && row.stress_level_end !== undefined
        ? Number(row.stress_level_end)
        : null,
    mood_entry_id: row.mood_entry_id ? String(row.mood_entry_id) : null,
    notes: row.notes ? String(row.notes) : null,
    created_at: row.created_at
      ? new Date(row.created_at as string).toISOString()
      : null,
    updated_at: row.updated_at
      ? new Date(row.updated_at as string).toISOString()
      : null,
  };
}

export async function createMindfulnessSession(
  userId: string,
  data: CreateMindfulnessSessionBody,
  authenticatedUserId?: string
): Promise<MindfulnessSessionResponse> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `INSERT INTO mindfulness_sessions (
        user_id, entry_date, start_time, end_time, duration_seconds,
        session_type, provider, external_id, heart_rate_avg, heart_rate_start,
        heart_rate_end, hrv_rmssd, stress_level_start, stress_level_end,
        mood_entry_id, notes, created_by_user_id
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17
      )
      ON CONFLICT (user_id, provider, external_id)
        WHERE external_id IS NOT NULL
      DO UPDATE SET
        entry_date = EXCLUDED.entry_date,
        start_time = COALESCE(EXCLUDED.start_time, mindfulness_sessions.start_time),
        end_time = COALESCE(EXCLUDED.end_time, mindfulness_sessions.end_time),
        duration_seconds = EXCLUDED.duration_seconds,
        session_type = EXCLUDED.session_type,
        heart_rate_avg = COALESCE(EXCLUDED.heart_rate_avg, mindfulness_sessions.heart_rate_avg),
        heart_rate_start = COALESCE(EXCLUDED.heart_rate_start, mindfulness_sessions.heart_rate_start),
        heart_rate_end = COALESCE(EXCLUDED.heart_rate_end, mindfulness_sessions.heart_rate_end),
        hrv_rmssd = COALESCE(EXCLUDED.hrv_rmssd, mindfulness_sessions.hrv_rmssd),
        stress_level_start = COALESCE(EXCLUDED.stress_level_start, mindfulness_sessions.stress_level_start),
        stress_level_end = COALESCE(EXCLUDED.stress_level_end, mindfulness_sessions.stress_level_end),
        mood_entry_id = COALESCE(EXCLUDED.mood_entry_id, mindfulness_sessions.mood_entry_id),
        notes = COALESCE(EXCLUDED.notes, mindfulness_sessions.notes),
        updated_by_user_id = EXCLUDED.created_by_user_id,
        updated_at = NOW()
      RETURNING *`,
      [
        userId,
        data.entry_date,
        data.start_time ?? null,
        data.end_time ?? null,
        data.duration_seconds,
        data.session_type ?? 'meditation',
        data.provider ?? 'manual',
        data.external_id ?? null,
        data.heart_rate_avg ?? null,
        data.heart_rate_start ?? null,
        data.heart_rate_end ?? null,
        data.hrv_rmssd ?? null,
        data.stress_level_start ?? null,
        data.stress_level_end ?? null,
        data.mood_entry_id ?? null,
        data.notes ?? null,
        authenticatedUserId ?? userId,
      ]
    );

    return mapRowToSession(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function getMindfulnessSessionsByDate(
  userId: string,
  entryDate: string,
  authenticatedUserId?: string
): Promise<MindfulnessSessionResponse[]> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT * FROM mindfulness_sessions
       WHERE user_id = $1 AND entry_date = $2
       ORDER BY COALESCE(start_time, created_at) DESC`,
      [userId, entryDate]
    );
    return result.rows.map(mapRowToSession);
  } finally {
    client.release();
  }
}

export async function getMindfulnessSessionsRange(
  userId: string,
  startDate: string,
  endDate: string,
  authenticatedUserId?: string
): Promise<MindfulnessSessionResponse[]> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT * FROM mindfulness_sessions
       WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3
       ORDER BY entry_date DESC, COALESCE(start_time, created_at) DESC`,
      [userId, startDate, endDate]
    );
    return result.rows.map(mapRowToSession);
  } finally {
    client.release();
  }
}

export async function getMindfulnessSessionById(
  userId: string,
  sessionId: string,
  authenticatedUserId?: string
): Promise<MindfulnessSessionResponse | null> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `SELECT * FROM mindfulness_sessions
       WHERE user_id = $1 AND id = $2`,
      [userId, sessionId]
    );
    if (result.rows.length === 0) return null;
    return mapRowToSession(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function updateMindfulnessSession(
  userId: string,
  sessionId: string,
  data: UpdateMindfulnessSessionBody,
  authenticatedUserId?: string
): Promise<MindfulnessSessionResponse | null> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `UPDATE mindfulness_sessions SET
        entry_date = COALESCE($3, entry_date),
        start_time = COALESCE($4, start_time),
        end_time = COALESCE($5, end_time),
        duration_seconds = COALESCE($6, duration_seconds),
        session_type = COALESCE($7, session_type),
        notes = COALESCE($8, notes),
        heart_rate_avg = COALESCE($9, heart_rate_avg),
        heart_rate_start = COALESCE($10, heart_rate_start),
        heart_rate_end = COALESCE($11, heart_rate_end),
        hrv_rmssd = COALESCE($12, hrv_rmssd),
        stress_level_start = COALESCE($13, stress_level_start),
        stress_level_end = COALESCE($14, stress_level_end),
        mood_entry_id = COALESCE($15, mood_entry_id),
        updated_by_user_id = $16,
        updated_at = NOW()
       WHERE user_id = $1 AND id = $2
       RETURNING *`,
      [
        userId,
        sessionId,
        data.entry_date ?? null,
        data.start_time ?? null,
        data.end_time ?? null,
        data.duration_seconds ?? null,
        data.session_type ?? null,
        data.notes ?? null,
        data.heart_rate_avg ?? null,
        data.heart_rate_start ?? null,
        data.heart_rate_end ?? null,
        data.hrv_rmssd ?? null,
        data.stress_level_start ?? null,
        data.stress_level_end ?? null,
        data.mood_entry_id ?? null,
        authenticatedUserId ?? userId,
      ]
    );
    if (result.rows.length === 0) return null;
    return mapRowToSession(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function deleteMindfulnessSession(
  userId: string,
  sessionId: string,
  authenticatedUserId?: string
): Promise<boolean> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    const result = await client.query(
      `DELETE FROM mindfulness_sessions
       WHERE user_id = $1 AND id = $2
       RETURNING id`,
      [userId, sessionId]
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

export async function getMindfulnessDaySummary(
  userId: string,
  entryDate: string,
  authenticatedUserId?: string
): Promise<MindfulnessDaySummaryResponse> {
  const sessions = await getMindfulnessSessionsByDate(
    userId,
    entryDate,
    authenticatedUserId
  );
  const totalDurationSeconds = sessions.reduce(
    (acc, s) => acc + s.duration_seconds,
    0
  );
  const totalMindfulMinutes = Math.round(totalDurationSeconds / 60);

  return {
    entry_date: entryDate,
    total_duration_seconds: totalDurationSeconds,
    total_mindful_minutes: totalMindfulMinutes,
    session_count: sessions.length,
    sessions,
  };
}
