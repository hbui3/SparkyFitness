/**
 * The workout format stored on a `wod_score` activity detail. Web and the AI
 * write the shared schema's `workout_format`; earlier mobile builds wrote
 * `format`. Read both so a score shows correctly wherever it was logged.
 */
export function wodScoreFormat(record: Record<string, unknown>): string | null {
  const value = record.workout_format ?? record.format;
  return typeof value === 'string' ? value : null;
}
