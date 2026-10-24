import { getClient } from '../db/poolManager.js';
import type {
  CreateSymptomOptionBody,
  UpdateSymptomOptionBody,
} from '../schemas/symptomSchemas.js';

export interface SymptomOptionRow {
  id: string;
  user_id: string;
  kind: string;
  name: string;
  sort_order: number;
  is_hidden: boolean;
  created_at: Date;
  updated_at: Date;
}

const OPTION_COLS =
  'id, user_id, kind, name, sort_order, is_hidden, created_at, updated_at';

async function listSymptomOptions(
  userId: string,
  kind?: string
): Promise<SymptomOptionRow[]> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT ${OPTION_COLS} FROM user_symptom_options
       WHERE user_id = $1 AND ($2::text IS NULL OR kind = $2)
       ORDER BY kind ASC, sort_order ASC, name ASC`,
      [userId, kind ?? null]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Creates an option, or updates the one with the same kind and name. Sending an
 * existing name with `is_hidden` hides or restores a built-in of that name.
 */
async function createSymptomOption(
  userId: string,
  data: CreateSymptomOptionBody
): Promise<SymptomOptionRow> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `INSERT INTO user_symptom_options (user_id, kind, name, sort_order, is_hidden)
       VALUES ($1, $2, $3, COALESCE($4, 0), COALESCE($5, FALSE))
       ON CONFLICT (user_id, kind, name) DO UPDATE
       SET sort_order = COALESCE($4, user_symptom_options.sort_order),
           is_hidden = COALESCE($5, user_symptom_options.is_hidden),
           updated_at = NOW()
       RETURNING ${OPTION_COLS}`,
      [
        userId,
        data.kind,
        data.name.trim(),
        data.sort_order ?? null,
        data.is_hidden ?? null,
      ]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function updateSymptomOption(
  userId: string,
  id: string,
  data: UpdateSymptomOptionBody
): Promise<SymptomOptionRow | null> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `UPDATE user_symptom_options
          SET name = COALESCE($3, name),
              sort_order = COALESCE($4, sort_order),
              is_hidden = COALESCE($5, is_hidden),
              updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING ${OPTION_COLS}`,
      [
        id,
        userId,
        data.name?.trim() ?? null,
        data.sort_order ?? null,
        data.is_hidden ?? null,
      ]
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

async function deleteSymptomOption(
  userId: string,
  id: string
): Promise<boolean> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      'DELETE FROM user_symptom_options WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

const symptomOptionRepository = {
  listSymptomOptions,
  createSymptomOption,
  updateSymptomOption,
  deleteSymptomOption,
};

export {
  listSymptomOptions,
  createSymptomOption,
  updateSymptomOption,
  deleteSymptomOption,
};

export default symptomOptionRepository;
