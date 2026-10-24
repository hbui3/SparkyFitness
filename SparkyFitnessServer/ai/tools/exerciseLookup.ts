import exerciseService from '../../services/exerciseService.js';

// Case-insensitive exact name lookup (MCP's `name ILIKE $1` without
// wildcards). The server search returns substring matches; the exact match,
// when present, is always among them.
export async function findExerciseByExactName(userId: string, name: string) {
  const rows = await exerciseService.searchExercises(
    userId,
    name,
    userId,
    undefined,
    undefined
  );
  return rows.find(
    (e: { name: unknown }) =>
      String(e.name).toLowerCase() === name.toLowerCase()
  );
}
