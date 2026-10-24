/** Which AI read a label. */
export type LabelScanSource = 'device' | 'server';

interface LabelScanSession {
  /** The photo that was read, base64 JPEG, so the other AI can read it again. */
  base64: string;
  source: LabelScanSource;
}

// Held in memory only: the photo is large and belongs to the form it filled in.
let session: LabelScanSession | null = null;
// Bumped on every scan so a form can free only the photo it was opened with: a
// retry replaces the form with a new one that holds a newer photo.
let generation = 0;

export function rememberLabelScan(base64: string, source: LabelScanSource) {
  session = { base64, source };
  generation += 1;
}

export function getLabelScanGeneration(): number {
  return generation;
}

/**
 * Drops the held photo. With a generation, only when no newer scan has
 * replaced it, so an old form closing never frees a newer form's photo.
 */
export function clearLabelScanSession(ifGeneration?: number) {
  if (ifGeneration !== undefined && ifGeneration !== generation) return;
  session = null;
}

export function getLabelScanPhoto(): string | null {
  return session?.base64 ?? null;
}
