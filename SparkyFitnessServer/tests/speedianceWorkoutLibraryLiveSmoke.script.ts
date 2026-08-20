import 'dotenv/config';
import { speedianceRegionSchema, todayInZone } from '@workspace/shared';
import { SpeedianceApiClient } from '../integrations/speediance/speedianceApiClient.js';

interface LibraryCandidate {
  id: string;
  title: string;
  category: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function selectedFields(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return {
    id: value.id ?? null,
    title: value.title ?? value.name ?? null,
    mainMuscleGroupName: value.mainMuscleGroupName ?? null,
    auxiliaryMuscleGroupName: value.auxiliaryMuscleGroupName ?? null,
    accessories: value.accessories ?? null,
    isLeftRight: value.isLeftRight ?? null,
    isBarbell: value.isBarbell ?? null,
    dataStatType: value.dataStatType ?? null,
    completionMethod: value.completionMethod ?? null,
  };
}

const email = process.env.SPEEDIANCE_TEST_EMAIL;
const password = process.env.SPEEDIANCE_TEST_PASSWORD;
const region = speedianceRegionSchema.parse(
  process.env.SPEEDIANCE_TEST_REGION ?? 'EU'
);
const timezone = process.env.SPEEDIANCE_TEST_TIMEZONE ?? 'Europe/Berlin';
const queryTerms = (
  process.env.SPEEDIANCE_TEST_EXERCISE_QUERY ??
  'bench,press,row,squat,deadlift,curl,triceps,pulldown,pull down,lateral raise,hip thrust,lunge'
)
  .split(',')
  .map((term) => term.trim().toLocaleLowerCase('en-US'))
  .filter(Boolean);
const requestedLimit = Number(process.env.SPEEDIANCE_TEST_EXERCISE_LIMIT ?? 80);
const inspectRemoteContracts =
  process.env.SPEEDIANCE_TEST_INSPECT_WORKOUT_CONTRACTS?.toLowerCase() ===
  'true';
const limit =
  Number.isInteger(requestedLimit) &&
  requestedLimit >= 1 &&
  requestedLimit <= 200
    ? requestedLimit
    : 80;

if (!email || !password) {
  throw new Error(
    'Set SPEEDIANCE_TEST_EMAIL and SPEEDIANCE_TEST_PASSWORD in the local environment before running this smoke test.'
  );
}

const client = new SpeedianceApiClient({ region, timezone });
await client.login(email, password);

const tabs = await client.getActionLibraryTabs(1);
const candidates = new Map<string, LibraryCandidate>();
for (const tab of records(tabs)) {
  const tabId = text(tab.id);
  if (!tabId) continue;
  const category = text(tab.name) ?? text(tab.title);
  const groups = await client.getActionLibraryGroups(tabId, 1);
  for (const muscleGroup of records(groups)) {
    for (const action of records(muscleGroup.actionLibraryGroupList)) {
      const id = text(action.id);
      const title = text(action.title) ?? text(action.name);
      if (!id || !title || candidates.has(id)) continue;
      if (
        queryTerms.some((term) =>
          title.toLocaleLowerCase('en-US').includes(term)
        )
      ) {
        candidates.set(id, { id, title, category });
      }
    }
  }
}

const matches: Record<string, unknown>[] = [];
for (const candidate of Array.from(candidates.values())
  .sort((left, right) => left.title.localeCompare(right.title))
  .slice(0, limit)) {
  const detail = await client.getActionLibraryGroup(candidate.id);
  if (!isRecord(detail)) continue;
  matches.push({
    ...candidate,
    detail: selectedFields(detail),
    variantIds: records(detail.actionLibraryList)
      .map((variant) => text(variant.id))
      .filter((id): id is string => Boolean(id)),
  });
}

const accessories = (await client.getAccessories())
  .map(selectedFields)
  .filter((item): item is Record<string, unknown> => Boolean(item));

let remoteContractEvidence: Record<string, unknown> | undefined;
if (inspectRemoteContracts) {
  const customWorkouts = await client.getCustomWorkouts(1);
  const sampleWorkout = records(customWorkouts)[0];
  const code = text(sampleWorkout?.code) ?? text(sampleWorkout?.templateCode);
  const detail = code ? await client.getCustomWorkoutDetail(code) : null;
  const detailRecord = isRecord(detail) ? detail : null;
  const firstAction = records(detailRecord?.actionLibraryList)[0];
  const today = todayInZone(timezone);
  const calendar = await client.getTrainingCalendarMonth(today.slice(0, 7), 1);
  const calendarDay = records(calendar).find(
    (item) => text(item.date) === today
  );
  const firstCalendarEntry = records(calendarDay?.trainingPlanList)[0];
  remoteContractEvidence = {
    customWorkoutCount: customWorkouts.length,
    listItemKeys: sampleWorkout ? Object.keys(sampleWorkout).sort() : [],
    detailKeys: detailRecord ? Object.keys(detailRecord).sort() : [],
    actionKeys: firstAction ? Object.keys(firstAction).sort() : [],
    calendarDayKeys: calendarDay ? Object.keys(calendarDay).sort() : [],
    calendarEntryKeys: firstCalendarEntry
      ? Object.keys(firstCalendarEntry).sort()
      : [],
  };
}

console.log(
  JSON.stringify(
    {
      authenticated: true,
      region,
      queryTerms,
      matchCount: matches.length,
      matches,
      accessories,
      ...(remoteContractEvidence ? { remoteContractEvidence } : {}),
    },
    null,
    2
  )
);
