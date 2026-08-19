import { describe, expect, it } from 'vitest';
import {
  mapSpeedianceSet,
  parseSpeedianceExerciseMetadata,
  parseSpeedianceTrainingDetail,
  parseSpeedianceTrainingRecords,
} from '../integrations/speediance/speedianceMapper.js';

describe('Speediance workout mapping', () => {
  it('maps Speediance primary and auxiliary muscles to Sparky vocabulary', () => {
    expect(
      parseSpeedianceExerciseMetadata({
        groupId: 44,
        mainMuscleGroupList: [
          { muscleGroupName: 'Pecs' },
          { muscleGroupName: 'Front Delts' },
        ],
        auxiliaryMuscleGroupList: [
          { muscleGroupName: 'Triceps' },
          { muscleGroupName: 'Pecs' },
          { muscleGroupName: 'Back Extensors' },
        ],
      })
    ).toEqual({
      actionLibraryGroupId: '44',
      primaryMuscles: ['chest', 'shoulders'],
      secondaryMuscles: ['triceps', 'lower back'],
    });
  });

  it('parses summary records and ignores malformed rows', () => {
    const records = parseSpeedianceTrainingRecords([
      {
        trainingId: 123,
        title: 'Upper Body',
        type: 5,
        startTimestamp: 1_776_500_000,
        trainingTime: 1_800,
        calorie: 220.4,
        totalCapacity: 3_400,
      },
      { title: 'Missing identity' },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      trainingId: '123',
      title: 'Upper Body',
      type: 5,
      trainingTime: 1_800,
      calorie: 220.4,
    });
  });

  it('uses completed capacity to calculate a stable average set weight', () => {
    const [exercise] = parseSpeedianceTrainingDetail([
      {
        actionLibraryName: 'Chest Press',
        actionLibraryGroupId: 44,
        completionMethod: 1,
        isLeftRight: 0,
        finishedReps: [
          {
            finishedCount: 10,
            targetCount: 12,
            capacity: 425,
            trainingInfoDetail: { weights: [45, 45, 40, 40] },
          },
        ],
      },
    ]);

    expect(exercise).toBeDefined();
    const mapped = mapSpeedianceSet(
      exercise!.finishedReps[0]!,
      0,
      exercise!.completionMethod,
      exercise!.isLeftRight
    );
    expect(mapped).toEqual({
      set_number: 1,
      set_type: 'Working Set',
      weight: 42.5,
      reps: 10,
      duration: null,
    });
  });

  it('preserves unilateral side and timed-set duration', () => {
    const [exercise] = parseSpeedianceTrainingDetail([
      {
        actionLibraryName: 'Timed Pull',
        completionMethod: 0,
        isLeftRight: 1,
        finishedReps: [
          { targetCount: 45, time: 42, leftRight: 1, finishedCount: 0 },
        ],
      },
    ]);
    const mapped = mapSpeedianceSet(
      exercise!.finishedReps[0]!,
      0,
      exercise!.completionMethod,
      exercise!.isLeftRight
    );

    expect(mapped).toMatchObject({
      set_type: 'Working Set (Left)',
      reps: null,
      duration: 42,
    });
  });

  it('finds the exercise list inside a nested detail response', () => {
    const exercises = parseSpeedianceTrainingDetail({
      course: {
        sections: [
          {
            items: [
              {
                actionLibraryName: 'Nested Row',
                finishedReps: [],
              },
            ],
          },
        ],
      },
    });

    expect(exercises).toHaveLength(1);
    expect(exercises[0]?.actionLibraryName).toBe('Nested Row');
  });

  it('parses embedded Free Lift actions, sets, and raw repetition telemetry', () => {
    const exercises = parseSpeedianceTrainingDetail({
      actionList: [
        {
          actionLibraryId: 0,
          actionSource: 'unknown',
          totalCapacity: 240,
          setList: [
            {
              startTimestamp: 1_776_500_100,
              summary: {
                finishedCount: 6,
                totalCapacity: 240,
                time: 28,
                weight: 40,
              },
              rawRepList: [
                { repIndex: 1, weight: 40, speedMps: 0.42, powerWatt: 210 },
                { repIndex: 2, weight: 40, speedMps: 0.4, powerWatt: 205 },
              ],
            },
          ],
        },
      ],
    });

    expect(exercises).toHaveLength(1);
    expect(exercises[0]).toMatchObject({
      actionLibraryName: 'Speediance Free Lift',
      actionLibraryId: null,
      actionLibraryGroupId: null,
      totalCapacity: 240,
      maxWeight: 40,
    });
    expect(exercises[0]?.finishedReps[0]).toMatchObject({
      finishedCount: 6,
      capacity: 240,
      time: 28,
      weights: [40, 40],
    });
    expect(exercises[0]?.finishedReps[0]?.raw.rawRepList).toBeInstanceOf(Array);

    const mapped = mapSpeedianceSet(
      exercises[0]!.finishedReps[0]!,
      0,
      exercises[0]!.completionMethod,
      exercises[0]!.isLeftRight
    );
    expect(mapped).toMatchObject({ weight: 40, reps: 6, duration: null });
  });

  it('keeps the Free Lift action identity separate from its group identity', () => {
    const [exercise] = parseSpeedianceTrainingDetail({
      actionList: [
        {
          actionLibraryId: 789077895708672,
          actionSource: 'manual',
          actionLibraryName: 'Standing Dual-Handle Biceps Curl',
          setList: [],
        },
      ],
    });

    expect(exercise).toMatchObject({
      actionLibraryName: 'Standing Dual-Handle Biceps Curl',
      actionLibraryId: '789077895708672',
      actionLibraryGroupId: null,
    });
  });
});
