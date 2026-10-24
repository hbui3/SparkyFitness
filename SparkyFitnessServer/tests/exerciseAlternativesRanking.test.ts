import { describe, expect, it } from 'vitest';
import {
  normalizeEquipment,
  normalizeEquipmentList,
  normalizeMuscle,
  muscleSpellings,
} from '@workspace/shared';
import {
  exerciseNameKey,
  isRankableSource,
  rankAlternatives,
  type AlternativeCandidate,
  type AlternativeSource,
} from '../utils/exerciseAlternativesRanking.js';

const benchPress: AlternativeSource = {
  modality: 'weight_reps',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['shoulders', 'triceps'],
  equipment: ['barbell'],
  mechanic: 'compound',
  force: 'push',
};

function candidate(
  overrides: Partial<AlternativeCandidate> & { key: string }
): AlternativeCandidate {
  return {
    name: overrides.key,
    modality: 'weight_reps',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: ['dumbbell'],
    mechanic: null,
    force: null,
    inLibrary: false,
    recentSessionCount: 0,
    ...overrides,
  };
}

describe('exercise taxonomy normalizers', () => {
  it('maps synonyms and casing onto the canonical vocabulary', () => {
    expect(normalizeMuscle('Quads')).toBe('quadriceps');
    expect(normalizeMuscle(' Pectoralis  Major ')).toBe('chest');
    expect(normalizeMuscle('Delts')).toBe('shoulders');
    expect(normalizeMuscle('chest')).toBe('chest');
    expect(normalizeMuscle('elbows')).toBeNull();
    expect(normalizeEquipment('bodyweight')).toBe('body only');
    expect(normalizeEquipment('Kettlebell')).toBe('kettlebells');
    expect(normalizeEquipment('ez-bar')).toBe('e-z curl bar');
  });

  it('ignores accessories and treats "no equipment" as bodyweight', () => {
    expect(normalizeEquipment('bench')).toBeNull();
    expect(normalizeEquipmentList(['bench'])).toEqual(['body only']);
    expect(normalizeEquipmentList([])).toEqual(['body only']);
    expect(normalizeEquipmentList(['Barbell', 'bench'])).toEqual(['barbell']);
  });

  it('expands every spelling of a muscle for the SQL prefilter', () => {
    const spellings = muscleSpellings(['quadriceps']);
    expect(spellings).toEqual(
      expect.arrayContaining(['quadriceps', 'quads', 'quad'])
    );
    expect(spellings).not.toContain('chest');
  });
});

describe('rankAlternatives', () => {
  it('drops candidates with no shared primary muscle or another modality', () => {
    const ranked = rankAlternatives(
      benchPress,
      [
        candidate({ key: 'squat', primaryMuscles: ['quadriceps'] }),
        candidate({ key: 'rower', modality: 'duration_distance' }),
        candidate({ key: 'db-press' }),
      ],
      { mode: 'similar' }
    );
    expect(ranked.map((r) => r.candidate.key)).toEqual(['db-press']);
  });

  it('prefers an exact primary match, then matching equipment', () => {
    const ranked = rankAlternatives(
      benchPress,
      [
        candidate({ key: 'partial', primaryMuscles: ['chest', 'triceps'] }),
        candidate({ key: 'db-press', equipment: ['dumbbell'] }),
        candidate({ key: 'incline-bb', equipment: ['barbell'] }),
      ],
      { mode: 'similar' }
    );
    expect(ranked.map((r) => r.candidate.key)).toEqual([
      'incline-bb',
      'db-press',
      'partial',
    ]);
    expect(ranked[0].reasons).toEqual(
      expect.arrayContaining(['same_primary_muscles', 'same_equipment'])
    );
    expect(ranked[2].reasons).toContain('shares_primary_muscle');
  });

  it('matches muscles by meaning, not spelling', () => {
    const ranked = rankAlternatives(
      benchPress,
      [candidate({ key: 'custom', primaryMuscles: ['Pecs'] })],
      { mode: 'similar' }
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].reasons).toContain('same_primary_muscles');
  });

  it('different_equipment excludes anything sharing the source equipment', () => {
    const ranked = rankAlternatives(
      benchPress,
      [
        candidate({ key: 'bb', equipment: ['barbell'] }),
        candidate({ key: 'pushup', equipment: [] }),
        candidate({ key: 'db', equipment: ['dumbbell'] }),
      ],
      { mode: 'different_equipment' }
    );
    expect(ranked.map((r) => r.candidate.key).sort()).toEqual(['db', 'pushup']);
    expect(ranked.every((r) => r.reasons.includes('different_equipment'))).toBe(
      true
    );
  });

  it('limits results to the available equipment (no equipment = bodyweight)', () => {
    const ranked = rankAlternatives(
      benchPress,
      [
        candidate({ key: 'pushup', equipment: [] }),
        candidate({ key: 'db', equipment: ['dumbbell'] }),
        candidate({ key: 'cable', equipment: ['cable'] }),
      ],
      { mode: 'similar', availableEquipment: ['dumbbells', 'bodyweight'] }
    );
    expect(ranked.map((r) => r.candidate.key).sort()).toEqual(['db', 'pushup']);
  });

  it('never suggests an exercise that works an excluded muscle', () => {
    const ranked = rankAlternatives(
      benchPress,
      [
        candidate({ key: 'dips', secondaryMuscles: ['shoulders'] }),
        candidate({ key: 'fly', secondaryMuscles: [] }),
      ],
      { mode: 'similar', excludeMuscles: ['Delts'] }
    );
    expect(ranked.map((r) => r.candidate.key)).toEqual(['fly']);
  });

  it('boosts familiar exercises without letting them beat a better muscle match', () => {
    const ranked = rankAlternatives(
      benchPress,
      [
        candidate({
          key: 'familiar-partial',
          primaryMuscles: ['chest', 'triceps', 'shoulders'],
          recentSessionCount: 20,
          inLibrary: true,
        }),
        candidate({ key: 'new-exact' }),
      ],
      { mode: 'similar' }
    );
    expect(ranked[0].candidate.key).toBe('new-exact');
    expect(ranked[1].reasons).toEqual(
      expect.arrayContaining(['recently_performed', 'in_library'])
    );
  });

  it('flags a matching movement pattern', () => {
    const [ranked] = rankAlternatives(
      benchPress,
      [candidate({ key: 'db', mechanic: 'Compound', force: 'push' })],
      { mode: 'similar' }
    );
    expect(ranked.reasons).toContain('same_movement');
  });

  it('returns nothing for a source without recognisable muscles', () => {
    const source = { ...benchPress, primaryMuscles: ['elbows'] };
    expect(isRankableSource(source)).toBe(false);
    expect(
      rankAlternatives(source, [candidate({ key: 'x' })], { mode: 'similar' })
    ).toEqual([]);
  });

  it('breaks score ties by name so results are stable', () => {
    const ranked = rankAlternatives(
      benchPress,
      [
        candidate({ key: 'b', name: 'Beta' }),
        candidate({ key: 'a', name: 'Alpha' }),
      ],
      { mode: 'similar' }
    );
    expect(ranked.map((r) => r.candidate.name)).toEqual(['Alpha', 'Beta']);
  });
});

describe('exerciseNameKey', () => {
  it('ignores case and punctuation', () => {
    expect(exerciseNameKey('Push-Up (Wide)')).toBe(
      exerciseNameKey('push up wide')
    );
  });
});
