import {
  buildExerciseReplaceContext,
  exerciseFromAlternative,
  externalItemFromAlternative,
} from '../../src/utils/exerciseReplace';
import type { ExerciseAlternative } from '@workspace/shared';

describe('buildExerciseReplaceContext', () => {
  const entries = [
    { exerciseId: 'a', exerciseName: 'Bench' },
    { exerciseId: 'b', exerciseName: 'Row' },
    { exerciseId: 'b', exerciseName: 'Row again' },
    { exerciseId: null, exerciseName: 'Deleted' },
  ];

  it('excludes the other exercises in the workout, once each', () => {
    expect(buildExerciseReplaceContext(entries[0], entries)).toEqual({
      exerciseId: 'a',
      exerciseName: 'Bench',
      excludeIds: ['b'],
    });
  });

  it('returns undefined when there is nothing to rank against', () => {
    expect(buildExerciseReplaceContext(entries[3], entries)).toBeUndefined();
    expect(buildExerciseReplaceContext(undefined, entries)).toBeUndefined();
  });
});

describe('alternative mappers', () => {
  const alternative: ExerciseAlternative = {
    origin: 'catalog',
    id: 'Cable_Crossover',
    name: 'Cable Crossover',
    source: null,
    category: 'strength',
    modality: 'weight_reps',
    level: 'beginner',
    mechanic: 'isolation',
    force: 'push',
    equipment: ['cable'],
    primary_muscles: ['chest'],
    secondary_muscles: ['shoulders'],
    images: ['https://example/0.jpg'],
    instructions: ['Pull.'],
    description: null,
    calories_per_hour: null,
    score: 60,
    reasons: ['same_primary_muscles'],
    last_performed_date: null,
  };

  it('never hands a null calorie rate to the workout', () => {
    expect(exerciseFromAlternative(alternative)).toMatchObject({
      calories_per_hour: 0,
      source: 'custom',
      instructions: ['Pull.'],
      tags: [],
    });
  });

  it('defaults a catalog item to the free-exercise-db import source', () => {
    expect(externalItemFromAlternative(alternative)).toMatchObject({
      id: 'Cable_Crossover',
      source: 'free-exercise-db',
      images: ['https://example/0.jpg'],
    });
  });
});
