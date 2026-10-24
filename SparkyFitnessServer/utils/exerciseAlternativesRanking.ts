import {
  normalizeEquipmentList,
  normalizeMuscleList,
  type CanonicalEquipment,
  type CanonicalMuscle,
  type ExerciseAlternativeMode,
  type ExerciseAlternativeReason,
  type ExerciseModality,
} from '@workspace/shared';

/**
 * Pure ranking for exercise alternatives (issue #1560). Kept free of I/O so
 * the service, the AI tools and workout-variation suggestions share one
 * definition of "similar" and it can be unit-tested exhaustively.
 */

export interface AlternativeCandidate {
  /** Stable identity across library + catalog, e.g. `library:<uuid>`. */
  key: string;
  name: string;
  modality: ExerciseModality;
  primaryMuscles: readonly string[];
  secondaryMuscles: readonly string[];
  equipment: readonly string[];
  mechanic: string | null;
  force: string | null;
  inLibrary: boolean;
  /** Sessions logged in the recency window. */
  recentSessionCount: number;
}

export interface AlternativeSource {
  modality: ExerciseModality;
  primaryMuscles: readonly string[];
  secondaryMuscles: readonly string[];
  equipment: readonly string[];
  mechanic: string | null;
  force: string | null;
}

export interface AlternativeRankingOptions {
  mode: ExerciseAlternativeMode;
  /** When non-empty, a candidate may only need equipment from this list. */
  availableEquipment?: readonly string[];
  /** A candidate working any of these muscles (primary or secondary) is dropped. */
  excludeMuscles?: readonly string[];
}

export interface RankedAlternative<T extends AlternativeCandidate> {
  candidate: T;
  score: number;
  reasons: ExerciseAlternativeReason[];
}

// Weights, in points. Muscles dominate: a substitute that trains something
// else is not a substitute, however familiar or convenient.
export const RANKING_WEIGHTS = {
  primaryOverlap: 50,
  exactPrimaryMatch: 10,
  secondaryOverlap: 10,
  sameEquipment: 15,
  sameMechanic: 8,
  sameForce: 6,
  recentlyPerformedBase: 6,
  recentlyPerformedPerSession: 2,
  recentlyPerformedMaxSessions: 5,
  inLibrary: 5,
} as const;

function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function intersects<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  for (const item of a) if (b.has(item)) return true;
  return false;
}

function sameText(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Whether a source has enough muscle data to rank anything against. */
export function isRankableSource(source: AlternativeSource): boolean {
  return normalizeMuscleList(source.primaryMuscles).length > 0;
}

export function rankAlternatives<T extends AlternativeCandidate>(
  source: AlternativeSource,
  candidates: readonly T[],
  options: AlternativeRankingOptions
): RankedAlternative<T>[] {
  const sourcePrimary = new Set<CanonicalMuscle>(
    normalizeMuscleList(source.primaryMuscles)
  );
  if (sourcePrimary.size === 0) return [];
  const sourceSecondary = new Set<CanonicalMuscle>(
    normalizeMuscleList(source.secondaryMuscles)
  );
  const sourceEquipment = new Set<CanonicalEquipment>(
    normalizeEquipmentList(source.equipment)
  );
  const available =
    options.availableEquipment && options.availableEquipment.length > 0
      ? new Set<CanonicalEquipment>(
          normalizeEquipmentList(options.availableEquipment)
        )
      : null;
  const excluded = new Set<CanonicalMuscle>(
    normalizeMuscleList(options.excludeMuscles ?? [])
  );

  const ranked: RankedAlternative<T>[] = [];
  for (const candidate of candidates) {
    // A cardio machine is never a substitute for a lift, nor vice versa.
    if (candidate.modality !== source.modality) continue;

    const primary = new Set<CanonicalMuscle>(
      normalizeMuscleList(candidate.primaryMuscles)
    );
    if (!intersects(primary, sourcePrimary)) continue;
    const secondary = new Set<CanonicalMuscle>(
      normalizeMuscleList(candidate.secondaryMuscles)
    );
    if (
      excluded.size > 0 &&
      (intersects(primary, excluded) || intersects(secondary, excluded))
    ) {
      continue;
    }

    const equipment = new Set<CanonicalEquipment>(
      normalizeEquipmentList(candidate.equipment)
    );
    const sharesEquipment = intersects(equipment, sourceEquipment);
    if (options.mode === 'different_equipment' && sharesEquipment) continue;
    if (available && ![...equipment].every((item) => available.has(item))) {
      continue;
    }

    const reasons: ExerciseAlternativeReason[] = [];
    const primaryScore = jaccard(primary, sourcePrimary);
    let score = primaryScore * RANKING_WEIGHTS.primaryOverlap;
    if (primaryScore === 1) {
      score += RANKING_WEIGHTS.exactPrimaryMatch;
      reasons.push('same_primary_muscles');
    } else {
      reasons.push('shares_primary_muscle');
    }
    score +=
      jaccard(secondary, sourceSecondary) * RANKING_WEIGHTS.secondaryOverlap;

    if (options.mode === 'different_equipment') {
      reasons.push('different_equipment');
    } else if (sharesEquipment) {
      score += RANKING_WEIGHTS.sameEquipment;
      reasons.push('same_equipment');
    }

    const sameMechanic = sameText(candidate.mechanic, source.mechanic);
    const sameForce = sameText(candidate.force, source.force);
    if (sameMechanic) score += RANKING_WEIGHTS.sameMechanic;
    if (sameForce) score += RANKING_WEIGHTS.sameForce;
    if (sameMechanic && sameForce) reasons.push('same_movement');

    if (candidate.recentSessionCount > 0) {
      score +=
        RANKING_WEIGHTS.recentlyPerformedBase +
        Math.min(
          candidate.recentSessionCount,
          RANKING_WEIGHTS.recentlyPerformedMaxSessions
        ) *
          RANKING_WEIGHTS.recentlyPerformedPerSession;
      reasons.push('recently_performed');
    }
    if (candidate.inLibrary) {
      score += RANKING_WEIGHTS.inLibrary;
      reasons.push('in_library');
    }

    ranked.push({
      candidate,
      score: Math.round(score * 10) / 10,
      reasons,
    });
  }

  return ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.candidate.name.localeCompare(b.candidate.name) ||
      a.candidate.key.localeCompare(b.candidate.key)
  );
}

/** Lowercased, punctuation-free name used to spot the same exercise across sources. */
export function exerciseNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
