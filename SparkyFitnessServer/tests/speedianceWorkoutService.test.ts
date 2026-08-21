import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SpeedianceCreateAndScheduleWorkoutRequest,
  SpeedianceExerciseSearchRequest,
  SpeedianceWorkoutDefinition,
} from '@workspace/shared';
import type { SpeedianceCustomWorkoutPayload } from '../integrations/speediance/speedianceApiClient.js';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  getTabs: vi.fn(),
  getGroups: vi.fn(),
  getAccessories: vi.fn(),
  getGroupDetail: vi.fn(),
  getCustomWorkouts: vi.fn(),
  getCustomWorkoutDetail: vi.fn(),
  createCustomWorkout: vi.fn(),
  updateCustomWorkout: vi.fn(),
  deleteCustomWorkout: vi.fn(),
  getCalendar: vi.fn(),
  setReservation: vi.fn(),
  getCredentials: vi.fn(),
  loadTimezone: vi.fn(),
  getTrainingLearningContext: vi.fn(),
  getNativeExercise: vi.fn(),
  createNativeExercise: vi.fn(),
  updateNativeExercise: vi.fn(),
  getNativePreset: vi.fn(),
  getNativePresetBySpeedianceCode: vi.fn(),
  createNativePreset: vi.fn(),
  updateNativePreset: vi.fn(),
  getNativePlans: vi.fn(),
  createNativePlan: vi.fn(),
  updateNativePlan: vi.fn(),
}));

vi.mock('../integrations/speediance/speedianceApiClient.js', () => ({
  SpeedianceApiClient: vi.fn(function SpeedianceApiClientMock() {
    return {
      login: mocks.login,
      getActionLibraryTabs: mocks.getTabs,
      getActionLibraryGroups: mocks.getGroups,
      getAccessories: mocks.getAccessories,
      getActionLibraryGroup: mocks.getGroupDetail,
      getCustomWorkouts: mocks.getCustomWorkouts,
      getCustomWorkoutDetail: mocks.getCustomWorkoutDetail,
      createCustomWorkout: mocks.createCustomWorkout,
      updateCustomWorkout: mocks.updateCustomWorkout,
      deleteCustomWorkout: mocks.deleteCustomWorkout,
      getTrainingCalendarMonth: mocks.getCalendar,
      setTemplateReservation: mocks.setReservation,
    };
  }),
  SpeedianceAuthenticationError: class SpeedianceAuthenticationError extends Error {},
  SpeedianceApiError: class SpeedianceApiError extends Error {},
}));

vi.mock('../integrations/speediance/speedianceRepository.js', () => ({
  getSpeedianceProviderCredentials: mocks.getCredentials,
}));

vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: mocks.loadTimezone,
}));

vi.mock('../services/trainingFeedbackService.js', () => ({
  default: {
    getTrainingLearningContext: mocks.getTrainingLearningContext,
  },
}));

vi.mock('../models/exercise.js', () => ({
  default: {
    getExerciseBySourceAndSourceId: mocks.getNativeExercise,
    createExercise: mocks.createNativeExercise,
    updateExercise: mocks.updateNativeExercise,
  },
}));

vi.mock('../models/workoutPresetRepository.js', () => ({
  default: {
    getWorkoutPresetByName: mocks.getNativePreset,
    getWorkoutPresetBySpeedianceCode: mocks.getNativePresetBySpeedianceCode,
    createWorkoutPreset: mocks.createNativePreset,
    updateWorkoutPreset: mocks.updateNativePreset,
  },
}));

vi.mock('../services/workoutPlanTemplateService.js', () => ({
  default: {
    getWorkoutPlanTemplatesByUserId: mocks.getNativePlans,
    createWorkoutPlanTemplate: mocks.createNativePlan,
    updateWorkoutPlanTemplate: mocks.updateNativePlan,
  },
}));

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

import {
  createAndScheduleSpeedianceWorkout,
  createSpeediancePlan,
  deleteSpeedianceWorkout,
  searchSpeedianceExercises,
  upsertSpeedianceWorkout,
} from '../integrations/speediance/speedianceWorkoutService.js';

const scheduleDate = '2099-08-20';

function workoutRequest(): SpeedianceCreateAndScheduleWorkoutRequest {
  return {
    name: 'Sparky Full Body A',
    scheduleDate,
    acknowledgedPreferenceIds: [],
    exercises: [
      {
        groupId: '116',
        variantId: '9001',
        expectedTitle: 'Barbell Bench Press',
        sets: [
          {
            repetitions: 10,
            targetRm: 12,
            mode: 'standard',
            restSeconds: 90,
          },
          {
            repetitions: 10,
            targetRm: 12,
            mode: 'eccentric',
            restSeconds: 90,
          },
        ],
      },
      {
        groupId: '200',
        variantId: '9002',
        expectedTitle: 'Single-Arm Row',
        sets: [
          {
            repetitions: 12,
            targetRm: 13,
            mode: 'standard',
            restSeconds: 60,
          },
          {
            repetitions: 12,
            targetRm: 13,
            mode: 'standard',
            restSeconds: 60,
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadTimezone.mockResolvedValue('Europe/Berlin');
  mocks.getCredentials.mockResolvedValue({
    providerId: 'provider-1',
    email: 'local@example.com',
    password: 'local-password',
    region: 'EU',
    lastSyncAt: null,
  });
  mocks.getAccessories.mockResolvedValue([
    { id: 2, name: 'Tricep Rope' },
    { id: 5, name: 'Handles' },
  ]);
  mocks.getTrainingLearningContext.mockResolvedValue({
    suggestedVolumeFactor: 1,
    suggestedRestSecondsDelta: 0,
    recentPainReported: false,
    preferredExercises: [],
    avoidedExercises: [],
    requiredEquipment: [],
    constraints: [],
    preferences: [],
    recentFeedback: [],
  });
  mocks.getNativeExercise.mockResolvedValue(null);
  mocks.createNativeExercise.mockImplementation(
    async (exercise: { source_id: string }) => ({
      id: `native-${exercise.source_id}`,
      user_id: 'user-1',
      source: 'Speediance',
    })
  );
  mocks.updateNativeExercise.mockImplementation(async (id: string) => ({
    id,
    user_id: 'user-1',
    source: 'Speediance',
  }));
  mocks.getNativePreset.mockResolvedValue(null);
  mocks.getNativePresetBySpeedianceCode.mockResolvedValue(null);
  mocks.createNativePreset.mockResolvedValue({
    id: 44,
    description: 'Managed by the Sparky Speediance workout manager.',
  });
  mocks.updateNativePreset.mockResolvedValue({
    id: 44,
    description: 'Managed by the Sparky Speediance workout manager.',
  });
  mocks.getNativePlans.mockResolvedValue([]);
  mocks.createNativePlan.mockResolvedValue({
    id: 81,
    plan_name: 'Sparky 3 Month Plan',
  });
  mocks.updateNativePlan.mockResolvedValue({
    id: 81,
    plan_name: 'Sparky 3 Month Plan',
  });
  mocks.getGroupDetail.mockImplementation(async (groupId: string) => {
    if (groupId === '116') {
      return {
        title: 'Barbell Bench Press',
        isLeftRight: 0,
        dataStatType: 0,
        completionMethod: 1,
        accessories: '2,5',
        actionLibraryList: [
          { id: 8001, coachLanguage: 'en', coach: { name: 'Mike' } },
          { id: 9001, coachLanguage: 'de', coach: { name: 'Daniel' } },
        ],
      };
    }
    return {
      title: 'Single-Arm Row',
      isLeftRight: 1,
      dataStatType: 0,
      completionMethod: 1,
      accessories: '5',
      actionLibraryList: [
        { id: 8002, coachLanguage: 'en', coach: { name: 'Mike' } },
        { id: 9002, coachLanguage: 'de', coach: { name: 'Daniel' } },
      ],
    };
  });
});

describe('searchSpeedianceExercises', () => {
  it('searches and deduplicates the real Gym Monster library by group ID', async () => {
    mocks.getTabs.mockResolvedValue([
      { id: 1, name: 'Upper Body' },
      { id: 2, name: 'Favorites' },
    ]);
    mocks.getGroups.mockResolvedValue([
      {
        name: 'Chest',
        actionLibraryGroupList: [
          {
            id: 116,
            title: 'Barbell Bench Press',
            accessories: '2,5',
            deviceTypeList: [1],
          },
        ],
      },
    ]);
    const request: SpeedianceExerciseSearchRequest = {
      query: 'bench press',
      limit: 20,
    };

    const result = await searchSpeedianceExercises('user-1', request);

    expect(result).toEqual({
      exercises: [
        {
          groupId: '116',
          variantId: '9001',
          title: 'Barbell Bench Press',
          category: 'Upper Body',
          primaryMuscle: 'Chest',
          accessories: ['2', '5'],
          accessoryNames: ['Tricep Rope', 'Handles'],
          deviceTypes: [1],
          isUnilateral: false,
          compatibleForWorkout: true,
          completionMethod: 1,
          selectCompletionMethod: 0,
          dataStatType: 0,
        },
      ],
      total: 1,
    });
    expect(mocks.getGroups).toHaveBeenCalledWith('1', 1);
    expect(mocks.getGroups).toHaveBeenCalledWith('2', 1);
  });

  it('marks an exercise without a German coach video as unavailable for workout creation', async () => {
    mocks.getTabs.mockResolvedValue([{ id: 1, name: 'Upper Body' }]);
    mocks.getGroups.mockResolvedValue([
      {
        name: 'Chest',
        actionLibraryGroupList: [
          {
            id: 116,
            title: 'Barbell Bench Press',
            accessories: '2,5',
            deviceTypeList: [1],
          },
        ],
      },
    ]);
    mocks.getGroupDetail.mockResolvedValueOnce({
      title: 'Barbell Bench Press',
      isLeftRight: 0,
      dataStatType: 0,
      completionMethod: 1,
      accessories: '2,5',
      actionLibraryList: [
        { id: 8001, coachLanguage: 'en', coach: { name: 'Mike' } },
      ],
    });

    const result = await searchSpeedianceExercises('user-1', {
      query: 'bench press',
      limit: 20,
    });

    expect(result.exercises[0]).toMatchObject({
      variantId: '8001',
      compatibleForWorkout: false,
    });
  });
});

describe('createAndScheduleSpeedianceWorkout', () => {
  it('blocks an explicitly avoided exercise before authenticating or writing', async () => {
    const preferenceId = '11111111-1111-4111-8111-111111111111';
    mocks.getTrainingLearningContext.mockResolvedValue({
      suggestedVolumeFactor: 0.9,
      suggestedRestSecondsDelta: 15,
      recentPainReported: false,
      preferredExercises: [],
      avoidedExercises: ['Barbell Bench Press'],
      requiredEquipment: [],
      constraints: [],
      preferences: [
        {
          id: preferenceId,
          kind: 'exercise',
          subject: 'Barbell Bench Press',
          sentiment: 'avoid',
          notes: 'User dislikes this movement.',
          source: 'feedback',
          active: true,
          updatedAt: '2026-08-20T06:00:00.000Z',
        },
      ],
      recentFeedback: [],
    });

    await expect(
      createAndScheduleSpeedianceWorkout('user-1', workoutRequest())
    ).rejects.toThrow(`Barbell Bench Press (${preferenceId})`);
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.createCustomWorkout).not.toHaveBeenCalled();
    expect(mocks.setReservation).not.toHaveBeenCalled();
  });

  it('creates a verified Gain Muscle workout, expands unilateral sets, and schedules by date and code', async () => {
    const acknowledgedPreferenceId = '11111111-1111-4111-8111-111111111111';
    mocks.getTrainingLearningContext.mockResolvedValue({
      suggestedVolumeFactor: 1,
      suggestedRestSecondsDelta: 0,
      recentPainReported: false,
      preferredExercises: [],
      avoidedExercises: ['Barbell Bench Press'],
      requiredEquipment: [],
      constraints: [],
      preferences: [
        {
          id: acknowledgedPreferenceId,
          kind: 'exercise',
          subject: 'Barbell Bench Press',
          sentiment: 'avoid',
          notes: null,
          source: 'user',
          active: true,
          updatedAt: '2026-08-20T06:00:00.000Z',
        },
      ],
      recentFeedback: [],
    });
    let created = false;
    let scheduled = false;
    const capturedPayloads: SpeedianceCustomWorkoutPayload[] = [];
    mocks.getCustomWorkouts.mockImplementation(async () =>
      created
        ? [{ id: 501, code: 'sparky-code', name: 'Sparky Full Body A' }]
        : []
    );
    mocks.createCustomWorkout.mockImplementation(
      async (payload: SpeedianceCustomWorkoutPayload) => {
        capturedPayloads.push(payload);
        created = true;
        return { id: 501, code: 'sparky-code' };
      }
    );
    mocks.getCustomWorkoutDetail.mockImplementation(async () => {
      const payload = capturedPayloads.at(-1);
      return {
        name: payload?.name,
        actionLibraryList: payload?.actionLibraryList,
      };
    });
    mocks.getCalendar.mockImplementation(async () => [
      {
        date: scheduleDate,
        trainingPlanList: [
          { id: 700, code: 'other-code', title: 'Other Workout' },
          ...(scheduled
            ? [
                {
                  id: 701,
                  code: 'sparky-code',
                  title: 'Sparky Full Body A',
                  isReservation: true,
                },
              ]
            : []),
        ],
      },
    ]);
    mocks.setReservation.mockImplementation(async () => {
      scheduled = true;
      return true;
    });

    const request = workoutRequest();
    request.acknowledgedPreferenceIds = [acknowledgedPreferenceId];
    const result = await createAndScheduleSpeedianceWorkout('user-1', request);

    expect(result.workout).toMatchObject({
      id: '501',
      code: 'sparky-code',
      created: true,
      exerciseCount: 2,
      remoteSetCount: 6,
    });
    expect(result.schedule).toEqual({
      date: scheduleDate,
      status: 'scheduled',
    });
    expect(capturedPayloads[0].actionLibraryList[0]).toMatchObject({
      groupId: 116,
      actionLibraryId: 9001,
      templatePresetId: 1,
      setsAndReps: '10,10',
      sportMode: '1,3',
      leftRight: '0,0',
      completionMethod: '1,1',
      countType: '1,1',
      counterweight2: '12,12',
    });
    expect(capturedPayloads[0].actionLibraryList[1]).toMatchObject({
      groupId: 200,
      actionLibraryId: 9002,
      setsAndReps: '12,12,12,12',
      leftRight: '1,2,1,2',
      counterweight2: '13,13,13,13',
    });
    expect(mocks.setReservation).toHaveBeenCalledWith(
      scheduleDate,
      'sparky-code',
      1,
      1
    );
  });

  it('reuses a workout after Speediance normalizes managed action fields', async () => {
    const expected = workoutRequest();
    expected.exercises = [expected.exercises[0]];
    const action = {
      groupId: 116,
      actionLibraryId: 9001,
      templatePresetId: 1,
      setsAndReps: '10,10',
      breakTime2: '90,90',
      sportMode: '1,3',
      leftRight: '0,0',
      completionMethod: '1',
      countType: '2',
      counterweight2: '12,12',
    };
    mocks.getCustomWorkouts.mockResolvedValue([
      { id: 501, code: 'sparky-code', name: expected.name },
    ]);
    mocks.getCustomWorkoutDetail.mockResolvedValue({
      name: expected.name,
      actionLibraryList: [action],
    });
    mocks.getCalendar.mockResolvedValue([
      {
        date: scheduleDate,
        trainingPlanList: [
          {
            id: 701,
            code: 'sparky-code',
            title: expected.name,
            isReservation: true,
          },
        ],
      },
    ]);

    const result = await createAndScheduleSpeedianceWorkout('user-1', expected);

    expect(result.workout.created).toBe(false);
    expect(result.schedule.status).toBe('already_scheduled');
    expect(mocks.createCustomWorkout).not.toHaveBeenCalled();
    expect(mocks.updateCustomWorkout).not.toHaveBeenCalled();
    expect(mocks.setReservation).not.toHaveBeenCalled();
  });

  it('updates an existing workout when only its coach video variants differ', async () => {
    const expected = workoutRequest();
    expected.exercises = [expected.exercises[0]];
    const englishAction = {
      groupId: 116,
      actionLibraryId: 8001,
      templatePresetId: 1,
      setsAndReps: '10,10',
      breakTime2: '90,90',
      sportMode: '1,3',
      leftRight: '0,0',
      completionMethod: '1',
      counterweight2: '12,12',
    };
    let updatedPayload: SpeedianceCustomWorkoutPayload | null = null;
    mocks.getCustomWorkouts.mockResolvedValue([
      { id: 501, code: 'sparky-code', name: expected.name },
    ]);
    mocks.getCustomWorkoutDetail.mockImplementation(async () => ({
      name: expected.name,
      actionLibraryList: updatedPayload?.actionLibraryList ?? [englishAction],
    }));
    mocks.updateCustomWorkout.mockImplementation(
      async (_templateId: number, payload: SpeedianceCustomWorkoutPayload) => {
        updatedPayload = payload;
        return { id: 501, code: 'sparky-code' };
      }
    );
    mocks.getCalendar.mockResolvedValue([
      {
        date: scheduleDate,
        trainingPlanList: [
          {
            id: 701,
            code: 'sparky-code',
            title: expected.name,
            isReservation: true,
          },
        ],
      },
    ]);

    const result = await createAndScheduleSpeedianceWorkout('user-1', expected);

    expect(result.workout.created).toBe(false);
    expect(result.schedule.status).toBe('already_scheduled');
    expect(mocks.updateCustomWorkout).toHaveBeenCalledWith(
      501,
      expect.objectContaining({
        name: expected.name,
        actionLibraryList: [expect.objectContaining({ actionLibraryId: 9001 })],
      })
    );
    expect(mocks.createCustomWorkout).not.toHaveBeenCalled();
    expect(mocks.setReservation).not.toHaveBeenCalled();
  });

  it('blocks a hallucinated group ID/title pairing before any remote write', async () => {
    const request = workoutRequest();
    request.exercises[0].expectedTitle = 'Incline Barbell Bench Press';

    await expect(
      createAndScheduleSpeedianceWorkout('user-1', request)
    ).rejects.toThrow('did not match the expected title');
    expect(mocks.createCustomWorkout).not.toHaveBeenCalled();
    expect(mocks.setReservation).not.toHaveBeenCalled();
  });

  it('blocks a variant that does not belong to the verified exercise group', async () => {
    const request = workoutRequest();
    request.exercises[0].variantId = '9999';

    await expect(
      createAndScheduleSpeedianceWorkout('user-1', request)
    ).rejects.toThrow('No compatible Speediance exercise variant');
    expect(mocks.createCustomWorkout).not.toHaveBeenCalled();
    expect(mocks.setReservation).not.toHaveBeenCalled();
  });

  it('blocks a non-German coach variant before any remote write', async () => {
    const request = workoutRequest();
    request.exercises[0].variantId = '8001';

    await expect(
      createAndScheduleSpeedianceWorkout('user-1', request)
    ).rejects.toThrow('is not the default German coach video');
    expect(mocks.createCustomWorkout).not.toHaveBeenCalled();
    expect(mocks.setReservation).not.toHaveBeenCalled();
  });

  it('blocks workout creation when Speediance offers no German coach video', async () => {
    mocks.getGroupDetail.mockResolvedValueOnce({
      title: 'Barbell Bench Press',
      isLeftRight: 0,
      dataStatType: 0,
      completionMethod: 1,
      actionLibraryList: [
        { id: 8001, coachLanguage: 'en', coach: { name: 'Mike' } },
      ],
    });
    const request = workoutRequest();
    request.exercises[0].variantId = '8001';

    await expect(
      createAndScheduleSpeedianceWorkout('user-1', request)
    ).rejects.toThrow('No German Speediance coach video is available');
    expect(mocks.createCustomWorkout).not.toHaveBeenCalled();
    expect(mocks.setReservation).not.toHaveBeenCalled();
  });

  it('blocks time-based exercises before any remote write', async () => {
    mocks.getGroupDetail.mockResolvedValueOnce({
      title: 'Aerobic Rowing',
      isLeftRight: 0,
      dataStatType: 2,
      completionMethod: 2,
      actionLibraryList: [{ id: 471 }],
    });
    const request = workoutRequest();
    request.exercises = [
      {
        groupId: '183',
        variantId: '471',
        expectedTitle: 'Aerobic Rowing',
        sets: request.exercises[0].sets,
      },
    ];

    await expect(
      createAndScheduleSpeedianceWorkout('user-1', request)
    ).rejects.toThrow('does not support the selected completion unit');
    expect(mocks.createCustomWorkout).not.toHaveBeenCalled();
    expect(mocks.setReservation).not.toHaveBeenCalled();
  });

  it('blocks same-name templates with different content instead of overwriting them', async () => {
    mocks.getCustomWorkouts.mockResolvedValue([
      { id: 501, code: 'sparky-code', name: 'Sparky Full Body A' },
    ]);
    mocks.getCustomWorkoutDetail.mockResolvedValue({
      name: 'Sparky Full Body A',
      actionLibraryList: [],
    });

    await expect(
      createAndScheduleSpeedianceWorkout('user-1', workoutRequest())
    ).rejects.toThrow('exists with different exercises or sets');
    expect(mocks.createCustomWorkout).not.toHaveBeenCalled();
    expect(mocks.updateCustomWorkout).not.toHaveBeenCalled();
    expect(mocks.setReservation).not.toHaveBeenCalled();
  });

  it('edits an exact existing workout and preserves separate warm-up and working blocks', async () => {
    const definition: SpeedianceWorkoutDefinition = {
      remoteId: '501',
      remoteCode: 'sparky-code',
      name: 'Sparky Full Body A v2',
      acknowledgedPreferenceIds: [],
      exercises: [
        {
          groupId: '116',
          variantId: '9001',
          expectedTitle: 'Barbell Bench Press',
          presetId: 0,
          completionUnit: 'repetitions',
          sets: [
            {
              repetitions: 12,
              targetRm: 18,
              setType: 'warmup',
              mode: 'standard',
              restSeconds: 45,
            },
          ],
        },
        {
          groupId: '116',
          variantId: '9001',
          expectedTitle: 'Barbell Bench Press',
          presetId: 1,
          completionUnit: 'repetitions',
          sets: [
            {
              repetitions: 10,
              targetRm: 12,
              setType: 'working',
              mode: 'eccentric',
              restSeconds: 90,
            },
          ],
        },
      ],
    };
    let updatedPayload: SpeedianceCustomWorkoutPayload | null = null;
    mocks.getCustomWorkoutDetail
      .mockResolvedValueOnce({
        id: 501,
        code: 'sparky-code',
        name: 'Sparky Full Body A',
        actionLibraryList: [],
      })
      .mockImplementationOnce(async () => ({
        id: 501,
        code: 'sparky-code',
        name: updatedPayload?.name,
        actionLibraryList: updatedPayload?.actionLibraryList,
      }));
    mocks.updateCustomWorkout.mockImplementation(
      async (_id: number, payload: SpeedianceCustomWorkoutPayload) => {
        updatedPayload = payload;
        return { success: true };
      }
    );

    const result = await upsertSpeedianceWorkout('user-1', definition);

    expect(result.workout).toMatchObject({
      id: '501',
      code: 'sparky-code',
      name: 'Sparky Full Body A v2',
      created: false,
      nativeWorkoutPresetId: 44,
    });
    const persistedPayload = mocks.updateCustomWorkout.mock.calls[0]?.[1] as
      | SpeedianceCustomWorkoutPayload
      | undefined;
    expect(persistedPayload?.actionLibraryList).toEqual([
      expect.objectContaining({ templatePresetId: 0, setsAndReps: '12' }),
      expect.objectContaining({
        templatePresetId: 1,
        setsAndReps: '10',
        sportMode: '3',
      }),
    ]);
    expect(mocks.updateNativePreset).not.toHaveBeenCalled();
    expect(mocks.createNativePreset).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sparky Full Body A v2',
        exercises: expect.arrayContaining([
          expect.objectContaining({
            sets: [expect.objectContaining({ set_type: 'warmup' })],
          }),
        ]),
      })
    );
  });

  it('deletes only the exact confirmed remote identity and preserves native data', async () => {
    mocks.getCustomWorkoutDetail.mockResolvedValue({
      id: 501,
      code: 'sparky-code',
      name: 'Sparky Full Body A',
      actionLibraryList: [],
    });
    mocks.deleteCustomWorkout.mockResolvedValue({ success: true });
    mocks.getCustomWorkouts.mockResolvedValue([]);

    const result = await deleteSpeedianceWorkout(
      'user-1',
      '501',
      'sparky-code',
      'Sparky Full Body A'
    );

    expect(mocks.deleteCustomWorkout).toHaveBeenCalledWith(501);
    expect(result).toEqual({
      success: true,
      id: '501',
      code: 'sparky-code',
      name: 'Sparky Full Body A',
      nativeWorkoutPresetPreserved: true,
    });
    expect(mocks.updateNativePreset).not.toHaveBeenCalled();
  });

  it('uses Speediance calorie completion and Vita level fields without cable weights', async () => {
    const definition: SpeedianceWorkoutDefinition = {
      remoteId: '777',
      remoteCode: 'vita-code',
      name: 'Vita calorie session',
      acknowledgedPreferenceIds: [],
      exercises: [
        {
          groupId: '522',
          variantId: '9522',
          expectedTitle: 'Vita Burn',
          dataStatType: 6,
          presetId: -1,
          completionUnit: 'calories',
          sets: [
            {
              repetitions: 50,
              calorieTarget: 50,
              targetRm: 12,
              level: 7,
              mode: 'standard',
              restSeconds: 30,
            },
          ],
        },
      ],
    };
    mocks.getGroupDetail.mockResolvedValue({
      title: 'Vita Burn',
      isLeftRight: 0,
      dataStatType: 6,
      completionMethod: 5,
      actionLibraryList: [
        { id: 9522, coachLanguage: 'de', coach: { name: 'Daniel' } },
      ],
    });
    let updatedPayload: SpeedianceCustomWorkoutPayload | null = null;
    mocks.getCustomWorkoutDetail
      .mockResolvedValueOnce({
        id: 777,
        code: 'vita-code',
        name: 'Vita calorie session',
        actionLibraryList: [],
      })
      .mockImplementationOnce(async () => ({
        id: 777,
        code: 'vita-code',
        name: updatedPayload?.name,
        actionLibraryList: updatedPayload?.actionLibraryList,
      }));
    mocks.updateCustomWorkout.mockImplementation(
      async (_id: number, payload: SpeedianceCustomWorkoutPayload) => {
        updatedPayload = payload;
        return { success: true };
      }
    );

    await upsertSpeedianceWorkout('user-1', definition);

    expect(mocks.updateCustomWorkout).toHaveBeenCalledWith(
      777,
      expect.objectContaining({
        totalCapacity: 0,
        actionLibraryList: [
          expect.objectContaining({
            setsAndReps: '50',
            completionMethod: '5',
            selectCompletionMethod: '1',
            countType: '5',
            weights: '0',
            counterweight2: '',
            level: '7',
            capacity: 0,
          }),
        ],
      })
    );
  });

  it('creates a date-bounded native plan and verifies every Speediance reservation', async () => {
    const definition = workoutRequest().exercises[0];
    let created = false;
    let scheduled = false;
    let capturedPayload: SpeedianceCustomWorkoutPayload | null = null;
    mocks.getCustomWorkouts.mockImplementation(async () =>
      created
        ? [
            {
              id: 501,
              code: 'sparky-code',
              name: 'Sparky Full Body A',
            },
          ]
        : []
    );
    mocks.createCustomWorkout.mockImplementation(
      async (payload: SpeedianceCustomWorkoutPayload) => {
        created = true;
        capturedPayload = payload;
        return { id: 501, code: 'sparky-code' };
      }
    );
    mocks.getCustomWorkoutDetail.mockImplementation(async () => ({
      id: 501,
      code: 'sparky-code',
      name: capturedPayload?.name,
      actionLibraryList: capturedPayload?.actionLibraryList,
    }));
    mocks.getCalendar.mockImplementation(async () => [
      {
        date: '2099-08-20',
        trainingPlanList: scheduled
          ? [
              {
                id: 701,
                code: 'sparky-code',
                title: 'Sparky Full Body A',
                isReservation: true,
              },
            ]
          : [],
      },
    ]);
    mocks.setReservation.mockImplementation(async () => {
      scheduled = true;
      return true;
    });

    const result = await createSpeediancePlan('user-1', {
      planName: 'Sparky 3 Month Plan',
      description: 'Hypertrophy plan',
      startDate: '2099-08-20',
      endDate: '2099-08-20',
      sessions: [
        {
          dayOfWeek: 4,
          workout: {
            name: 'Sparky Full Body A',
            acknowledgedPreferenceIds: [],
            exercises: definition ? [definition] : [],
          },
        },
      ],
    });

    expect(mocks.createNativePlan).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        plan_name: 'Sparky 3 Month Plan',
        start_date: '2099-08-20',
        end_date: '2099-08-20',
        is_active: true,
        assignments: [
          expect.objectContaining({
            day_of_week: 4,
            workout_preset_id: 44,
          }),
        ],
      })
    );
    expect(mocks.setReservation).toHaveBeenCalledWith(
      '2099-08-20',
      'sparky-code',
      1,
      1
    );
    expect(result.plan).toMatchObject({
      id: '81',
      workoutCount: 1,
      scheduledDates: 1,
      failedDates: [],
    });
  });
});
