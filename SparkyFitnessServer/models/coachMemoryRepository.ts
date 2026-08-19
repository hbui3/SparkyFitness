import type {
  CoachMemory,
  CoachMemoryCategory,
  CreateCoachMemoryRequest,
  UpdateCoachMemoryRequest,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

async function listMemories(
  userId: string,
  activeOnly = false
): Promise<CoachMemory[]> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `SELECT id, user_id, category, content, source, active, pinned,
              created_at, updated_at
       FROM coach_memories
       WHERE user_id = $1
         AND ($2::boolean = FALSE OR active = TRUE)
       ORDER BY pinned DESC, updated_at DESC`,
      [userId, activeOnly]
    );
    return rows as CoachMemory[];
  } finally {
    client.release();
  }
}

async function createMemory(
  userId: string,
  input: CreateCoachMemoryRequest,
  source: 'user' | 'coach' | 'import' = 'user'
): Promise<CoachMemory> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `INSERT INTO coach_memories
         (user_id, category, content, source, pinned)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, category, content, source, active, pinned,
                 created_at, updated_at`,
      [userId, input.category, input.content.trim(), source, input.pinned]
    );
    return rows[0] as CoachMemory;
  } finally {
    client.release();
  }
}

async function updateMemory(
  userId: string,
  memoryId: string,
  input: UpdateCoachMemoryRequest
): Promise<CoachMemory | null> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `UPDATE coach_memories
       SET category = COALESCE($3, category),
           content = COALESCE($4, content),
           active = COALESCE($5, active),
           pinned = COALESCE($6, pinned),
           updated_at = now()
       WHERE id = $1::uuid AND user_id = $2
       RETURNING id, user_id, category, content, source, active, pinned,
                 created_at, updated_at`,
      [
        memoryId,
        userId,
        input.category ?? null,
        input.content?.trim() ?? null,
        input.active ?? null,
        input.pinned ?? null,
      ]
    );
    return (rows[0] as CoachMemory | undefined) ?? null;
  } finally {
    client.release();
  }
}

async function deleteMemory(
  userId: string,
  memoryId: string
): Promise<boolean> {
  const client = await getClient(userId, userId);
  try {
    const result = await client.query(
      'DELETE FROM coach_memories WHERE id = $1::uuid AND user_id = $2',
      [memoryId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

async function findActiveDuplicate(
  userId: string,
  category: CoachMemoryCategory,
  content: string
): Promise<CoachMemory | null> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `SELECT id, user_id, category, content, source, active, pinned,
              created_at, updated_at
       FROM coach_memories
       WHERE user_id = $1
         AND category = $2
         AND active = TRUE
         AND lower(content) = lower($3)
       LIMIT 1`,
      [userId, category, content.trim()]
    );
    return (rows[0] as CoachMemory | undefined) ?? null;
  } finally {
    client.release();
  }
}

export default {
  listMemories,
  createMemory,
  updateMemory,
  deleteMemory,
  findActiveDuplicate,
};
