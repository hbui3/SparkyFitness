import { getClient } from '../db/poolManager.js';

/**
 * Returns the raw `permissions` column of one of the user's API keys, `null`
 * when the key has none, or `undefined` when no such key is visible to the
 * user. RLS scopes api_key to its owner (reference_id).
 */
async function getApiKeyPermissions(
  userId: string,
  apiKeyId: string
): Promise<string | null | undefined> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      'SELECT permissions FROM api_key WHERE id = $1',
      [apiKeyId]
    );
    const rows = result.rows as { permissions: string | null }[];
    if (rows.length === 0) return undefined;
    return rows[0].permissions;
  } finally {
    client.release();
  }
}

export { getApiKeyPermissions };
export default { getApiKeyPermissions };
