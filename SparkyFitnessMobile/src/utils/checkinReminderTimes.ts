export const MAX_CHECKIN_REMINDERS = 5;
export const DEFAULT_CHECKIN_REMINDER_TIME = '20:30';
/** `data.kind` carried by every mood check-in reminder notification. */
export const MOOD_CHECKIN_KIND = 'mood-checkin';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Keeps only valid zero-padded `HH:MM` strings, de-duplicated, sorted and capped
 * at MAX_CHECKIN_REMINDERS. An empty result falls back to the default time.
 */
export function normalizeCheckinReminderTimes(
  times: readonly string[]
): string[] {
  const valid = [...new Set(times.filter((t) => TIME_PATTERN.test(t)))]
    .sort()
    .slice(0, MAX_CHECKIN_REMINDERS);
  return valid.length > 0 ? valid : [DEFAULT_CHECKIN_REMINDER_TIME];
}
