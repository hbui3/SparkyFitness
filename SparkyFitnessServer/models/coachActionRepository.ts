import { getClient } from '../db/poolManager.js';

export interface CoachActionReceipt {
  id: string;
  userId: string;
  actionType: string;
  resourceType: string;
  resourceId: string | null;
  payload: Record<string, unknown>;
  status: 'completed' | 'undone' | 'expired';
  expiresAt: Date;
}

function mapReceipt(row: Record<string, unknown>): CoachActionReceipt {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    actionType: String(row.action_type),
    resourceType: String(row.resource_type),
    resourceId: row.resource_id ? String(row.resource_id) : null,
    payload:
      row.payload && typeof row.payload === 'object'
        ? (row.payload as Record<string, unknown>)
        : {},
    status: String(row.status) as CoachActionReceipt['status'],
    expiresAt: new Date(String(row.expires_at)),
  };
}

async function createReceipt(input: {
  userId: string;
  actionType: string;
  resourceType: string;
  resourceId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<CoachActionReceipt> {
  const client = await getClient(input.userId, input.userId);
  try {
    const { rows } = await client.query(
      `INSERT INTO coach_action_receipts
         (user_id, action_type, resource_type, resource_id, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING *`,
      [
        input.userId,
        input.actionType,
        input.resourceType,
        input.resourceId ?? null,
        JSON.stringify(input.payload ?? {}),
      ]
    );
    return mapReceipt(rows[0] as Record<string, unknown>);
  } finally {
    client.release();
  }
}

async function claimUndo(
  userId: string,
  receiptId: string
): Promise<CoachActionReceipt | null> {
  const client = await getClient(userId, userId);
  try {
    const { rows } = await client.query(
      `UPDATE coach_action_receipts
       SET status = 'undone', undone_at = now()
       WHERE id = $1::uuid
         AND user_id = $2
         AND status = 'completed'
         AND expires_at > now()
       RETURNING *`,
      [receiptId, userId]
    );
    return rows[0] ? mapReceipt(rows[0] as Record<string, unknown>) : null;
  } finally {
    client.release();
  }
}

async function restoreCompleted(
  userId: string,
  receiptId: string
): Promise<void> {
  const client = await getClient(userId, userId);
  try {
    await client.query(
      `UPDATE coach_action_receipts
       SET status = 'completed', undone_at = NULL
       WHERE id = $1::uuid AND user_id = $2 AND status = 'undone'`,
      [receiptId, userId]
    );
  } finally {
    client.release();
  }
}

export default { createReceipt, claimUndo, restoreCompleted };
