import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SpeedianceCreateAndScheduleWorkoutRequest,
  SpeedianceExerciseSearchRequest,
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
  getCalendar: vi.fn(),
  setReservation: vi.fn(),
  getCredentials: vi.fn(),
  loadTimezone: vi.fn(),
  getTrainingLearningContext: vi.fn(),
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

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

import {
  createAndScheduleSpeedianceWorkout,
  searchSpeedianceExercises,
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
  mocks.getGroupDetail.mockImplementation(async (groupId: string) => {
    if (groupId === '116') {
      return {
        title: 'Barbell Bench Press',
        isLeftRight: 0,
        dataStatType: 0,
        completionMethod: 1,
        accessories: '2,5',
        actionLibraryList: [{ id: 9001 }],
      };
    }
    return {
      title: 'Single-Arm Row',
      isLeftRight: 1,
      dataStatType: 0,
      completionMethod: 1,
      accessories: '5',
      actionLibraryList: [{ id: 9002 }],
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
        },
      ],
      total: 1,
    });
    expect(mocks.getGroups).toHaveBeenCalledWith('1', 1);
    expect(mocks.getGroups).toHaveBeenCalledWith('2', 1);
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

  it('reuses an identical workout and existing reservation without duplicate writes', async () => {
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
      completionMethod: '1,1',
      countType: '1,1',
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
    ).rejects.toThrow('not a supported repetition-based resistance exercise');
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
    expect(mocks.setReservation).not.toHaveBeenCalled();
  });
});
