/**
 * ISO timestamp for a wall-clock time in the test machine's time zone, so
 * fixtures land on the intended local calendar day in any zone.
 */
export const atLocalTime = (day: string, time = '12:00'): string => {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, date, hours, minutes).toISOString();
};
