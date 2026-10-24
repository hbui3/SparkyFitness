import type { SeverityBand } from '@workspace/shared';

export const SEVERITY_BAND_CLASS: Record<SeverityBand, string> = {
  low: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  mid: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  high: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

/** ISO instant to the value an `<input type="datetime-local">` expects. */
export function toDatetimeLocal(iso: string | Date): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Authenticated image route for a stored photo. The session cookie travels with
 * an <img> request, and the server checks the caller may see the entry.
 */
export const symptomPhotoUrl = (photoId: string): string =>
  `/api/v2/symptoms/photos/file/${photoId}`;
