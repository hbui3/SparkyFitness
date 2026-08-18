import 'dotenv/config';
import {
  addDays,
  speedianceRegionSchema,
  todayInZone,
} from '@workspace/shared';
import { SpeedianceApiClient } from '../integrations/speediance/speedianceApiClient.js';
import {
  parseSpeedianceTrainingDetail,
  parseSpeedianceTrainingRecords,
} from '../integrations/speediance/speedianceMapper.js';

const email = process.env.SPEEDIANCE_TEST_EMAIL;
const password = process.env.SPEEDIANCE_TEST_PASSWORD;
const region = speedianceRegionSchema.parse(
  process.env.SPEEDIANCE_TEST_REGION ?? 'EU'
);
const timezone = process.env.SPEEDIANCE_TEST_TIMEZONE ?? 'Europe/Berlin';
const inspectSchema =
  process.env.SPEEDIANCE_TEST_INSPECT_SCHEMA?.toLowerCase() === 'true';
const requestedLookbackDays = Number(
  process.env.SPEEDIANCE_TEST_LOOKBACK_DAYS ?? '30'
);
const lookbackDays =
  Number.isInteger(requestedLookbackDays) &&
  requestedLookbackDays >= 1 &&
  requestedLookbackDays <= 3_650
    ? requestedLookbackDays
    : 30;

if (!email || !password) {
  throw new Error(
    'Set SPEEDIANCE_TEST_EMAIL and SPEEDIANCE_TEST_PASSWORD in the local environment before running this smoke test.'
  );
}

const endDate = todayInZone(timezone);
const startDate = addDays(endDate, -lookbackDays);
const client = new SpeedianceApiClient({ region, timezone });

await client.login(email, password);
const rawRecords = await client.getTrainingRecords(startDate, endDate);
const records = parseSpeedianceTrainingRecords(rawRecords);
const workoutTypes = records.reduce<Record<string, number>>(
  (counts, record) => {
    const key = String(record.type);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  },
  {}
);
const sampleTitlesByType = records.reduce<Record<string, string[]>>(
  (titles, record) => {
    const key = String(record.type);
    const typeTitles = titles[key] ?? [];
    if (!typeTitles.includes(record.title) && typeTitles.length < 10) {
      typeTitles.push(record.title);
    }
    titles[key] = typeTitles;
    return titles;
  },
  {}
);
const summaryKeysByType = records.reduce<Record<string, string[]>>(
  (keysByType, record) => {
    const key = String(record.type);
    keysByType[key] = Array.from(
      new Set([...(keysByType[key] ?? []), ...Object.keys(record.raw)])
    ).sort();
    return keysByType;
  },
  {}
);
const sampleMetricsByType = records.reduce<
  Record<string, Record<string, unknown>>
>((samples, record) => {
  const key = String(record.type);
  if (samples[key]) return samples;
  samples[key] = {
    title: record.title,
    trainingTime: record.trainingTime,
    calorie: record.calorie,
    totalCapacity: record.totalCapacity,
    totalEnergy: record.raw.totalEnergy,
    goalLabel: record.raw.goalLabel,
    trainingPartSetsInfoList: record.raw.trainingPartSetsInfoList,
  };
  return samples;
}, {});

function collectKeyPaths(
  value: unknown,
  path = '$',
  depth = 0,
  paths = new Set<string>()
): Set<string> {
  if (!value || typeof value !== 'object' || depth > 6 || paths.size >= 500) {
    return paths;
  }
  if (Array.isArray(value)) {
    paths.add(`${path}[]`);
    for (const item of value.slice(0, 10)) {
      collectKeyPaths(item, `${path}[]`, depth + 1, paths);
    }
    return paths;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    paths.add(childPath);
    collectKeyPaths(child, childPath, depth + 1, paths);
  }
  return paths;
}

const summaryKeyPathsByType: Record<string, string[]> = {};
if (inspectSchema) {
  const pathSets = new Map<string, Set<string>>();
  for (const record of records) {
    const key = String(record.type);
    const paths = pathSets.get(key) ?? new Set<string>();
    collectKeyPaths(record.raw, '$', 0, paths);
    pathSets.set(key, paths);
  }
  for (const [type, paths] of pathSets) {
    summaryKeyPathsByType[type] = Array.from(paths).sort();
  }
}

const detailCandidates = new Map<number, (typeof records)[number]>();
for (const record of records) {
  if (!detailCandidates.has(record.type)) {
    detailCandidates.set(record.type, record);
  }
}
const detailedExerciseCounts: Record<string, number | null> = {};
const detailKeyPathsByType: Record<string, string[]> = {};
for (const [type, detailCandidate] of detailCandidates) {
  try {
    const rawDetail = await client.getTrainingDetail(
      detailCandidate.trainingId,
      detailCandidate.type
    );
    detailedExerciseCounts[String(type)] =
      parseSpeedianceTrainingDetail(rawDetail).length;
    if (inspectSchema) {
      detailKeyPathsByType[String(type)] = Array.from(
        collectKeyPaths(rawDetail)
      ).sort();
    }
  } catch {
    detailedExerciseCounts[String(type)] = null;
  }
}

console.log(
  JSON.stringify({
    authenticated: true,
    region,
    startDate,
    endDate,
    workoutCount: records.length,
    workoutTypes,
    detailedExerciseCounts,
    ...(inspectSchema
      ? {
          sampleTitlesByType,
          sampleMetricsByType,
          summaryKeysByType,
          summaryKeyPathsByType,
          detailKeyPathsByType,
        }
      : {}),
  })
);
