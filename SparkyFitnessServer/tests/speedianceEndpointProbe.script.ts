import 'dotenv/config';
import type { AxiosInstance } from 'axios';
import {
  addDays,
  speedianceRegionSchema,
  todayInZone,
} from '@workspace/shared';
import { SpeedianceApiClient } from '../integrations/speediance/speedianceApiClient.js';
import { parseSpeedianceTrainingRecords } from '../integrations/speediance/speedianceMapper.js';

const email = process.env.SPEEDIANCE_TEST_EMAIL;
const password = process.env.SPEEDIANCE_TEST_PASSWORD;
const region = speedianceRegionSchema.parse(
  process.env.SPEEDIANCE_TEST_REGION ?? 'EU'
);
const timezone = process.env.SPEEDIANCE_TEST_TIMEZONE ?? 'Europe/Berlin';

if (!email || !password) {
  throw new Error(
    'Set SPEEDIANCE_TEST_EMAIL and SPEEDIANCE_TEST_PASSWORD before running this probe.'
  );
}

interface DiagnosticClientAccess {
  http: AxiosInstance;
  authenticatedHeaders(): Record<string, string>;
}

interface Envelope {
  code?: unknown;
  data?: unknown;
  msg?: unknown;
  message?: unknown;
}

interface ProbeResult {
  status: number | null;
  code: unknown;
  message: unknown;
  dataKind: string;
  dataSize: number | null;
  dataKeyPaths: string[];
}

interface ScanAggregate {
  tested: number;
  nonEmpty: number;
  statusCounts: Record<string, number>;
  codeCounts: Record<string, number>;
  dataKindCounts: Record<string, number>;
  largestDataSize: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dataKind(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function collectKeyPaths(
  value: unknown,
  path = '$',
  depth = 0,
  paths = new Set<string>(),
  maxDepth = 5
): Set<string> {
  if (
    !value ||
    typeof value !== 'object' ||
    depth > maxDepth ||
    paths.size >= 500
  ) {
    return paths;
  }
  if (Array.isArray(value)) {
    paths.add(`${path}[]`);
    for (const item of value.slice(0, 3)) {
      collectKeyPaths(item, `${path}[]`, depth + 1, paths, maxDepth);
    }
    return paths;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    paths.add(childPath);
    collectKeyPaths(child, childPath, depth + 1, paths, maxDepth);
  }
  return paths;
}

function envelope(value: unknown): Envelope {
  return isRecord(value) ? value : {};
}

function stringIdentifier(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null;
}

const client = new SpeedianceApiClient({ region, timezone });
await client.login(email, password);

const endDate = todayInZone(timezone);
const startDate = addDays(endDate, -365);
const records = parseSpeedianceTrainingRecords(
  await client.getTrainingRecords(startDate, endDate)
);
const samples = new Map<number, (typeof records)[number]>();
for (const record of records) {
  if ([1, 7, 9].includes(record.type) && !samples.has(record.type)) {
    samples.set(record.type, record);
  }
}

const access = client as unknown as DiagnosticClientAccess;
const headers = access.authenticatedHeaders.call(client);

const commonCandidates: Record<string, string> = {
  courseInfo: '/api/app/trainingInfo/courseTrainingInfo/{id}',
  courseDetail: '/api/app/trainingInfo/courseTrainingInfoDetail/{id}',
  cttInfo: '/api/app/trainingInfo/cttTrainingInfo/{id}',
  cttDetail: '/api/app/trainingInfo/cttTrainingInfoDetail/{id}',
  freeTraining: '/api/app/trainingInfo/freeTraining/{id}',
  freeTrainingDetail: '/api/app/trainingInfo/freeTrainingDetail/{id}',
  aiCourseTrainingInfo: '/api/app/trainingInfo/aiCourseTrainingInfo/{id}',
  aiCourseTrainingInfoDetail:
    '/api/app/trainingInfo/aiCourseTrainingInfoDetail/{id}',
  planTrainingInfo: '/api/app/trainingInfo/planTrainingInfo/{id}',
  planTrainingInfoDetail: '/api/app/trainingInfo/planTrainingInfoDetail/{id}',
  genericInfo: '/api/app/trainingInfo/trainingInfo/{id}',
  genericDetail: '/api/app/trainingInfo/trainingInfoDetail/{id}',
};

const typeCandidates: Record<number, Record<string, string>> = {
  1: {
    freeInfo: '/api/app/trainingInfo/freeTrainingInfo/{id}',
    freeDetail: '/api/app/trainingInfo/freeTrainingInfoDetail/{id}',
    freeLiftInfo: '/api/app/trainingInfo/freeLiftTrainingInfo/{id}',
    freeLiftDetail: '/api/app/trainingInfo/freeLiftTrainingInfoDetail/{id}',
  },
  7: {
    quickInfo: '/api/app/trainingInfo/quickTrainingInfo/{id}',
    quickDetail: '/api/app/trainingInfo/quickTrainingInfoDetail/{id}',
    actionInfo: '/api/app/trainingInfo/actionTrainingInfo/{id}',
    actionDetail: '/api/app/trainingInfo/actionTrainingInfoDetail/{id}',
  },
  9: {
    goalInfo: '/api/app/trainingInfo/goalTrainingInfo/{id}',
    goalDetail: '/api/app/trainingInfo/goalTrainingInfoDetail/{id}',
    goalCourseInfo: '/api/app/trainingInfo/goalCourseTrainingInfo/{id}',
    goalCourseDetail: '/api/app/trainingInfo/goalCourseTrainingInfoDetail/{id}',
  },
};

async function probe(path: string): Promise<ProbeResult> {
  try {
    const response = await access.http.get(path, {
      headers,
      validateStatus: () => true,
    });
    const body = envelope(response.data);
    const data = body.data;
    return {
      status: response.status,
      code: body.code ?? null,
      message: body.message ?? body.msg ?? null,
      dataKind: dataKind(data),
      dataSize: Array.isArray(data)
        ? data.length
        : isRecord(data)
          ? Object.keys(data).length
          : null,
      dataKeyPaths: Array.from(collectKeyPaths(data)).sort(),
    };
  } catch (error) {
    return {
      status: null,
      code: null,
      message: error instanceof Error ? error.message : String(error),
      dataKind: 'request-error',
      dataSize: null,
      dataKeyPaths: [],
    };
  }
}

async function fetchData(path: string): Promise<unknown> {
  const response = await access.http.get(path, {
    headers,
    validateStatus: () => true,
  });
  return envelope(response.data).data;
}

const results: Record<string, Record<string, ProbeResult>> = {};
for (const [type, record] of samples) {
  const candidates: Record<string, string> = {
    ...commonCandidates,
    ...typeCandidates[type],
  };
  const rawRecordId = record.raw.id;
  if (
    (typeof rawRecordId === 'string' || typeof rawRecordId === 'number') &&
    String(rawRecordId) !== record.trainingId
  ) {
    for (const [name, template] of Object.entries({
      ...commonCandidates,
      ...typeCandidates[type],
    })) {
      candidates[`rawId_${name}`] = template.replace(
        '{id}',
        encodeURIComponent(String(rawRecordId))
      );
    }
  }

  const actionLibraryId = record.raw.actionLibraryId;
  if (
    typeof actionLibraryId === 'string' ||
    typeof actionLibraryId === 'number'
  ) {
    const encodedActionId = encodeURIComponent(String(actionLibraryId));
    candidates.actionLibraryGroup = `/api/app/actionLibraryGroup/${encodedActionId}?isDisplay=1`;
    candidates.actionLibrary = `/api/app/actionLibrary/${encodedActionId}`;
    candidates.actionLibraryGroupList = `/api/app/actionLibraryGroup/list?ids=${encodedActionId}`;
    candidates.actionStats = `/api/app/actionLibraryGroup/userActionStatPage?id=${encodedActionId}&pageNo=1&pageSize=100`;

    const actionData = await fetchData(
      `/api/app/actionLibrary/${encodedActionId}`
    );
    const actionGroupId = isRecord(actionData)
      ? stringIdentifier(actionData.groupId)
      : null;
    if (actionGroupId) {
      const encodedGroupId = encodeURIComponent(actionGroupId);
      candidates.resolvedActionLibraryGroup = `/api/app/actionLibraryGroup/${encodedGroupId}?isDisplay=1`;
      candidates.resolvedActionStats = `/api/app/actionLibraryGroup/userActionStatPage?id=${encodedGroupId}&pageNo=1&pageSize=100`;
    }
  }

  candidates.globalActionStats =
    '/api/app/actionLibraryGroup/userActionStatPage?pageNo=1&pageSize=100';

  const courseId = record.raw.courseId;
  if (typeof courseId === 'string' || typeof courseId === 'number') {
    const encodedCourseId = encodeURIComponent(String(courseId));
    candidates.courseLibraryV2 = `/api/app/v2/course/info/${encodedCourseId}?weightConfig=1`;
    candidates.courseLibrary = `/api/app/course/${encodedCourseId}`;
  }

  const startDate = new Date(record.startTimestamp * 1000);
  const month = `${startDate.getUTCFullYear()}-${String(
    startDate.getUTCMonth() + 1
  ).padStart(2, '0')}`;
  const deviceType =
    typeof record.raw.deviceType === 'number' ? record.raw.deviceType : 1;
  const calendarPath = `/api/app/v5/trainingCalendar/monthNew?date=${month}&selectedDeviceType=${deviceType}`;
  candidates.calendarMonth = calendarPath;

  const calendarData = await fetchData(calendarPath);
  const recordDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(startDate);
  const calendarDay = Array.isArray(calendarData)
    ? calendarData.find(
        (day) => isRecord(day) && String(day.date) === recordDate
      )
    : null;
  const plans =
    isRecord(calendarDay) && Array.isArray(calendarDay.trainingPlanList)
      ? calendarDay.trainingPlanList
      : [];
  const calendarPlan = plans.find((plan) => {
    if (!isRecord(plan)) return false;
    return (
      String(plan.trainingId ?? '') === record.trainingId ||
      String(plan.trainingId ?? '') === String(record.raw.id ?? '') ||
      String(plan.title ?? '') === record.title
    );
  });
  if (isRecord(calendarPlan)) {
    const planCode = stringIdentifier(calendarPlan.code);
    if (planCode) {
      const encodedCode = encodeURIComponent(planCode);
      candidates.planCustomDetailByCodeV3 = `/api/app/v3/customTrainingTemplate/detailByCode?code=${encodedCode}`;
      candidates.planCustomDetailByCodeV2 = `/api/app/v2/customTrainingTemplate/detailByCode?code=${encodedCode}`;
      candidates.planCourseDetailByCodeV3 = `/api/app/v3/course/detailByCode?code=${encodedCode}`;
    }
    const planCourseId = stringIdentifier(calendarPlan.courseId);
    if (planCourseId) {
      candidates.planCourseLibraryV2 = `/api/app/v2/course/info/${encodeURIComponent(planCourseId)}?weightConfig=1`;
    }
  }

  const dailyGoal = isRecord(calendarDay)
    ? calendarDay.trainingDailyGoal
    : null;
  const dailyGoalId = isRecord(dailyGoal)
    ? stringIdentifier(dailyGoal.dailyGoalId)
    : null;
  if (dailyGoalId) {
    const encodedGoalId = encodeURIComponent(dailyGoalId);
    candidates.dailyGoal = `/api/app/trainingDailyGoal/${encodedGoalId}`;
    candidates.dailyGoalDetail = `/api/app/trainingDailyGoal/detail/${encodedGoalId}`;
    candidates.dailyGoalV2 = `/api/app/v2/trainingDailyGoal/${encodedGoalId}`;
    candidates.trainingGoal = `/api/app/trainingGoal/${encodedGoalId}`;
  }

  const typeResults: Record<string, ProbeResult> = {};
  for (const [name, template] of Object.entries(candidates)) {
    const path = template.includes('{id}')
      ? template.replace('{id}', encodeURIComponent(record.trainingId))
      : template;
    typeResults[name] = await probe(path);
  }
  results[String(type)] = typeResults;
}

const globalCandidates: Record<string, string> = {
  reportUserTrainingRecord: `/api/mobile/v2/report/userTrainingRecord?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  reportUserTrainingStat: `/api/mobile/v2/report/userTrainingStat?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  reportUserTrainingData: `/api/app/report/userTrainingData?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  reportUserTrainingStatApp: `/api/app/report/userTrainingStat?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  reportWeekly: `/api/app/report/weekly?date=${encodeURIComponent(endDate)}`,
  trainingMuscle: '/api/app/userDataStat/trainingMuscle',
  trainingMuscleV2: '/api/app/userDataStat/v2/trainingMuscle',
  trainingMuscleByRange: `/api/app/userDataStat/trainingMuscle?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  trainingMuscleV2ByRange: `/api/app/userDataStat/v2/trainingMuscle?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  trainingMuscleDetail: '/api/app/userDataStat/trainingMuscleDetail',
  trainingMuscleDetailArms:
    '/api/app/userDataStat/trainingMuscleDetail?trainingPartId2=16',
  trainingPartFatigueInfo: '/api/app/userDataStat/trainingPartFatigueInfo',
  trainingPartFatigueInfoArms:
    '/api/app/userDataStat/trainingPartFatigueInfo?trainingPartId2=16',
};
const globalResults: Record<string, ProbeResult> = {};
for (const [name, path] of Object.entries(globalCandidates)) {
  globalResults[name] = await probe(path);
}

const focusedResults: Record<string, unknown> = {};
const type1Sample = samples.get(1);
if (type1Sample) {
  const data = await fetchData(
    `/api/app/trainingInfo/freeTraining/${encodeURIComponent(type1Sample.trainingId)}`
  );
  focusedResults.type1FreeTrainingKeyPaths = Array.from(
    collectKeyPaths(data, '$', 0, new Set<string>(), 10)
  ).sort();
  const firstAction =
    isRecord(data) && Array.isArray(data.actionList)
      ? data.actionList.find(isRecord)
      : null;
  const actionLibraryId = isRecord(firstAction)
    ? stringIdentifier(firstAction.actionLibraryId)
    : null;
  focusedResults.type1EmbeddedActionIdentity = isRecord(firstAction)
    ? {
        actionLibraryId: firstAction.actionLibraryId,
        actionSource: firstAction.actionSource,
      }
    : null;
  if (actionLibraryId) {
    const actionData = await fetchData(
      `/api/app/actionLibrary/${encodeURIComponent(actionLibraryId)}`
    );
    focusedResults.type1ActionLibraryKeyPaths = Array.from(
      collectKeyPaths(actionData, '$', 0, new Set<string>(), 10)
    ).sort();
    focusedResults.type1ActionLibraryIdentity = isRecord(actionData)
      ? {
          actionName: actionData.actionName,
          name: actionData.name,
          title: actionData.title,
          groupId: actionData.groupId,
        }
      : null;
  }
}
const type7Sample = samples.get(7);
if (type7Sample) {
  const data = await fetchData(
    `/api/app/trainingInfo/freeTrainingDetail/${encodeURIComponent(type7Sample.trainingId)}`
  );
  focusedResults.type7FreeTrainingDetailKeyPaths = Array.from(
    collectKeyPaths(data, '$', 0, new Set<string>(), 10)
  ).sort();
}
const type9Sample = samples.get(9);
if (type9Sample) {
  const data = await fetchData(
    `/api/app/trainingInfo/aiCourseTrainingInfoDetail/${encodeURIComponent(type9Sample.trainingId)}`
  );
  focusedResults.type9AiCourseDetailKeyPaths = Array.from(
    collectKeyPaths(data, '$', 0, new Set<string>(), 10)
  ).sort();
  const firstExercise = Array.isArray(data) ? data.find(isRecord) : null;
  const actionLibraryGroupId = isRecord(firstExercise)
    ? stringIdentifier(firstExercise.actionLibraryGroupId)
    : null;
  focusedResults.type9ExerciseIdentity = isRecord(firstExercise)
    ? {
        actionLibraryGroupId: firstExercise.actionLibraryGroupId,
        actionLibraryName: firstExercise.actionLibraryName,
        trainingPartId2: firstExercise.trainingPartId2,
        categoryId: firstExercise.categoryId,
      }
    : null;
  if (actionLibraryGroupId) {
    const actionGroupData = await fetchData(
      `/api/app/actionLibraryGroup/${encodeURIComponent(actionLibraryGroupId)}?isDisplay=1`
    );
    focusedResults.type9ActionLibraryGroupKeyPaths = Array.from(
      collectKeyPaths(actionGroupData, '$', 0, new Set<string>(), 10)
    ).sort();
    focusedResults.type9ActionLibraryGroup = isRecord(actionGroupData)
      ? {
          title: actionGroupData.title,
          trainingPartId2: actionGroupData.trainingPartId2,
          mainMuscles: Array.isArray(actionGroupData.mainMuscleGroupList)
            ? actionGroupData.mainMuscleGroupList.map((muscle) =>
                isRecord(muscle) ? muscle.muscleGroupName : null
              )
            : [],
          auxiliaryMuscles: Array.isArray(
            actionGroupData.auxiliaryMuscleGroupList
          )
            ? actionGroupData.auxiliaryMuscleGroupList.map((muscle) =>
                isRecord(muscle) ? muscle.muscleGroupName : null
              )
            : [],
        }
      : null;
  }
}

const muscleDetailData = await fetchData(
  '/api/app/userDataStat/trainingMuscleDetail'
);
focusedResults.muscleDetail = Array.isArray(muscleDetailData)
  ? muscleDetailData.map((part) => {
      if (!isRecord(part)) return {};
      return {
        trainingPartId2: part.trainingPartId2,
        totalCapacity: part.totalCapacity,
        muscles: Array.isArray(part.muscleDetailList)
          ? part.muscleDetailList.map((muscle) =>
              isRecord(muscle)
                ? {
                    name: muscle.muscleGroupName,
                    fatigue: muscle.fatigue,
                    isTrained: muscle.isTrained,
                  }
                : {}
            )
          : [],
      };
    })
  : [];
const fatigueData = await fetchData(
  '/api/app/userDataStat/trainingPartFatigueInfo'
);
focusedResults.trainingPartFatigue = Array.isArray(fatigueData)
  ? fatigueData.map((part) =>
      isRecord(part)
        ? {
            trainingPartId2: part.trainingPartId2,
            fatigue: part.fatigue,
          }
        : {}
    )
  : [];
const trainingMuscleV2Data = await fetchData(
  '/api/app/userDataStat/v2/trainingMuscle'
);
focusedResults.trainingMuscleV2KeyPaths = Array.from(
  collectKeyPaths(trainingMuscleV2Data, '$', 0, new Set<string>(), 10)
).sort();

const scan: Record<string, Record<string, ScanAggregate>> = {};
const scanRecords =
  process.env.SPEEDIANCE_TEST_SCAN_ALL?.toLowerCase() === 'true'
    ? records.filter((item) => [1, 7, 9].includes(item.type))
    : [];
for (const record of scanRecords) {
  const encodedTrainingId = encodeURIComponent(record.trainingId);
  const paths: Record<string, string> =
    record.type === 1
      ? {
          freeTraining: `/api/app/trainingInfo/freeTraining/${encodedTrainingId}`,
        }
      : record.type === 7
        ? {
            freeTraining: `/api/app/trainingInfo/freeTraining/${encodedTrainingId}`,
            freeTrainingDetail: `/api/app/trainingInfo/freeTrainingDetail/${encodedTrainingId}`,
          }
        : {
            aiCourseTrainingInfo: `/api/app/trainingInfo/aiCourseTrainingInfo/${encodedTrainingId}`,
            aiCourseTrainingInfoDetail: `/api/app/trainingInfo/aiCourseTrainingInfoDetail/${encodedTrainingId}`,
          };

  const typeScan = (scan[String(record.type)] ??= {});
  for (const [name, path] of Object.entries(paths)) {
    const aggregate = (typeScan[name] ??= {
      tested: 0,
      nonEmpty: 0,
      statusCounts: {},
      codeCounts: {},
      dataKindCounts: {},
      largestDataSize: 0,
    });
    const observation = await probe(path);
    aggregate.tested++;
    const statusKey = String(observation.status);
    const codeKey = String(observation.code);
    aggregate.statusCounts[statusKey] =
      (aggregate.statusCounts[statusKey] ?? 0) + 1;
    aggregate.codeCounts[codeKey] = (aggregate.codeCounts[codeKey] ?? 0) + 1;
    aggregate.dataKindCounts[observation.dataKind] =
      (aggregate.dataKindCounts[observation.dataKind] ?? 0) + 1;
    const size = observation.dataSize ?? 0;
    if (size > 0) aggregate.nonEmpty++;
    aggregate.largestDataSize = Math.max(aggregate.largestDataSize, size);
  }
}

console.log(
  JSON.stringify(
    process.env.SPEEDIANCE_TEST_SCAN_ONLY?.toLowerCase() === 'true'
      ? { authenticated: true, region, scan }
      : process.env.SPEEDIANCE_TEST_FOCUSED_ONLY?.toLowerCase() === 'true'
        ? { authenticated: true, region, focusedResults }
        : {
            authenticated: true,
            region,
            results,
            globalResults,
            focusedResults,
            scan,
          }
  )
);
