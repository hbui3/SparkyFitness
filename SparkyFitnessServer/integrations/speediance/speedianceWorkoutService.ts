import {
  todayInZone,
  type SpeedianceCreateAndScheduleWorkoutRequest,
  type SpeedianceCreateAndScheduleWorkoutResponse,
  type SpeedianceExercise,
  type SpeedianceExerciseSearchRequest,
  type SpeedianceExerciseSearchResponse,
  type SpeedianceResistanceMode,
  type SpeedianceWorkoutExercise,
  type SpeedianceWorkoutSet,
} from '@workspace/shared';
import { log } from '../../config/logging.js';
import { loadUserTimezone } from '../../utils/timezoneLoader.js';
import {
  SpeedianceApiClient,
  SpeedianceApiError,
  type SpeedianceCustomWorkoutActionPayload,
  type SpeedianceCustomWorkoutPayload,
} from './speedianceApiClient.js';
import { getSpeedianceProviderCredentials } from './speedianceRepository.js';

const GYM_MONSTER_DEVICE_TYPE = 1;
const GAIN_MUSCLE_PRESET_ID = 1;
const CREATE_VISIBILITY_RETRY_MS = 300;
const CREATE_VISIBILITY_ATTEMPTS = 3;

interface SpeedianceTemplateIdentity {
  id: string;
  code: string;
  name: string;
}

interface ResolvedWorkoutPayload {
  payload: SpeedianceCustomWorkoutPayload;
  remoteSetCount: number;
}

interface CanonicalRemoteAction {
  groupId: string;
  actionLibraryId: string;
  templatePresetId: number;
  setsAndReps: string;
  breakTime2: string;
  sportMode: string;
  leftRight: string;
  completionMethod: string;
  countType: string;
  counterweight2: string;
}

export class SpeedianceWorkoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeedianceWorkoutValidationError';
  }
}

export class SpeedianceWorkoutConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeedianceWorkoutConflictError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function remoteId(value: unknown): string | null {
  const candidate = stringValue(value);
  return candidate && /^\d+$/.test(candidate) ? candidate : null;
}

function numericRemoteId(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new SpeedianceWorkoutValidationError(
      `${label} is outside the supported Speediance identifier range.`
    );
  }
  return parsed;
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function parseRemoteIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  return Array.from(
    new Set(
      values.map(remoteId).filter((item): item is string => Boolean(item))
    )
  );
}

function parseDeviceTypes(value: unknown): number[] {
  const ids = parseRemoteIds(value)
    .map(Number)
    .filter((item) => Number.isSafeInteger(item) && item > 0);
  return ids.length > 0 ? ids : [GYM_MONSTER_DEVICE_TYPE];
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function authenticatedClient(
  userId: string,
  providerId?: string
): Promise<{ api: SpeedianceApiClient; timezone: string }> {
  const timezone = await loadUserTimezone(userId);
  const credentials = await getSpeedianceProviderCredentials(
    userId,
    providerId
  );
  const api = new SpeedianceApiClient({
    region: credentials.region,
    timezone,
  });
  await api.login(credentials.email, credentials.password);
  return { api, timezone };
}

function parseLibraryGroups(
  rawGroups: unknown[],
  category: string | null
): Omit<
  SpeedianceExercise,
  'variantId' | 'accessoryNames' | 'isUnilateral' | 'compatibleForWorkout'
>[] {
  const result: Omit<
    SpeedianceExercise,
    'variantId' | 'accessoryNames' | 'isUnilateral' | 'compatibleForWorkout'
  >[] = [];
  for (const muscleGroup of records(rawGroups)) {
    const fallbackMuscle =
      stringValue(muscleGroup.trainingPartName) ??
      stringValue(muscleGroup.name) ??
      stringValue(muscleGroup.title);
    for (const action of records(muscleGroup.actionLibraryGroupList)) {
      const groupId = remoteId(action.id);
      const title = stringValue(action.title) ?? stringValue(action.name);
      if (!groupId || !title) continue;
      result.push({
        groupId,
        title,
        category,
        primaryMuscle:
          stringValue(action.mainMuscleGroupName) ?? fallbackMuscle ?? null,
        accessories: parseRemoteIds(action.accessories),
        deviceTypes: parseDeviceTypes(
          action.deviceTypeList ?? action.deviceTypes ?? action.deviceType
        ),
      });
    }
  }
  return result;
}

function accessoryNameMap(rawAccessories: unknown[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const accessory of records(rawAccessories)) {
    const id = remoteId(accessory.id);
    const name = stringValue(accessory.name) ?? stringValue(accessory.title);
    if (id && name) result.set(id, name);
  }
  return result;
}

async function enrichLibraryExercise(
  api: SpeedianceApiClient,
  exercise: Omit<
    SpeedianceExercise,
    'variantId' | 'accessoryNames' | 'isUnilateral' | 'compatibleForWorkout'
  >,
  accessoryNamesById: Map<string, string>
): Promise<SpeedianceExercise | null> {
  const detail = await api.getActionLibraryGroup(exercise.groupId);
  if (!isRecord(detail)) return null;
  const title = stringValue(detail.title) ?? stringValue(detail.name);
  const variantId = remoteId(records(detail.actionLibraryList)[0]?.id);
  if (!title || !variantId) return null;
  const accessories = parseRemoteIds(detail.accessories);
  const completionMethod = Number(detail.completionMethod ?? 1);
  const dataStatType = Number(detail.dataStatType ?? 0);
  return {
    ...exercise,
    variantId,
    title,
    primaryMuscle:
      stringValue(detail.mainMuscleGroupName) ?? exercise.primaryMuscle,
    accessories,
    accessoryNames: accessories
      .map((id) => accessoryNamesById.get(id))
      .filter((name): name is string => Boolean(name)),
    isUnilateral: Number(detail.isLeftRight ?? 0) === 1,
    compatibleForWorkout: dataStatType !== 6 && completionMethod === 1,
  };
}

export async function searchSpeedianceExercises(
  userId: string,
  request: SpeedianceExerciseSearchRequest
): Promise<SpeedianceExerciseSearchResponse> {
  const { api } = await authenticatedClient(userId, request.providerId);
  const tabs = await api.getActionLibraryTabs(GYM_MONSTER_DEVICE_TYPE);
  const byId = new Map<
    string,
    Omit<
      SpeedianceExercise,
      'variantId' | 'accessoryNames' | 'isUnilateral' | 'compatibleForWorkout'
    >
  >();

  for (const tab of records(tabs)) {
    const tabId = remoteId(tab.id);
    if (!tabId) continue;
    const category = stringValue(tab.name) ?? stringValue(tab.title);
    const rawGroups = await api.getActionLibraryGroups(
      tabId,
      GYM_MONSTER_DEVICE_TYPE
    );
    for (const exercise of parseLibraryGroups(rawGroups, category)) {
      if (!byId.has(exercise.groupId)) byId.set(exercise.groupId, exercise);
    }
  }

  const query = normalizeLabel(request.query);
  const matches = Array.from(byId.values())
    .filter((exercise) => {
      if (!query) return true;
      return normalizeLabel(
        [
          exercise.title,
          exercise.category ?? '',
          exercise.primaryMuscle ?? '',
        ].join(' ')
      ).includes(query);
    })
    .sort((left, right) => left.title.localeCompare(right.title));

  const accessoryNamesById = accessoryNameMap(await api.getAccessories());
  const exercises: SpeedianceExercise[] = [];
  for (const match of matches.slice(0, request.limit)) {
    const exercise = await enrichLibraryExercise(
      api,
      match,
      accessoryNamesById
    );
    if (exercise) exercises.push(exercise);
  }

  return {
    exercises,
    total: matches.length,
  };
}

function modeNumber(mode: SpeedianceResistanceMode): number {
  switch (mode) {
    case 'chains':
      return 2;
    case 'eccentric':
      return 3;
    case 'standard':
      return 1;
  }
}

function expandSets(
  sets: SpeedianceWorkoutSet[],
  unilateral: boolean
): SpeedianceWorkoutSet[] {
  if (!unilateral) return sets;
  return sets.flatMap((set) => [{ ...set }, { ...set }]);
}

function resolveVariantId(
  detail: Record<string, unknown>,
  exercise: SpeedianceWorkoutExercise
): number {
  const variants = records(detail.actionLibraryList);
  const selected = variants.find(
    (variant) => remoteId(variant.id) === exercise.variantId
  );
  const variantId = remoteId(selected?.id);
  if (!variantId) {
    throw new SpeedianceWorkoutValidationError(
      `No compatible Speediance exercise variant was found for "${exercise.expectedTitle}".`
    );
  }
  return numericRemoteId(variantId, 'Exercise variant ID');
}

function validateRepBasedExercise(
  detail: Record<string, unknown>,
  exercise: SpeedianceWorkoutExercise
): void {
  const actualTitle =
    stringValue(detail.title) ?? stringValue(detail.name) ?? '';
  if (
    !actualTitle ||
    normalizeLabel(actualTitle) !== normalizeLabel(exercise.expectedTitle)
  ) {
    throw new SpeedianceWorkoutValidationError(
      `Speediance exercise ${exercise.groupId} did not match the expected title "${exercise.expectedTitle}".`
    );
  }

  const dataStatType = Number(detail.dataStatType ?? 0);
  const completionMethod = Number(detail.completionMethod ?? 1);
  if (dataStatType === 6 || completionMethod !== 1) {
    throw new SpeedianceWorkoutValidationError(
      `"${actualTitle}" is not a supported repetition-based resistance exercise.`
    );
  }
}

function actionPayload(
  detail: Record<string, unknown>,
  exercise: SpeedianceWorkoutExercise
): { action: SpeedianceCustomWorkoutActionPayload; remoteSetCount: number } {
  validateRepBasedExercise(detail, exercise);
  const unilateral = Number(detail.isLeftRight ?? 0) === 1;
  const sets = expandSets(exercise.sets, unilateral);
  const repetitions = sets.map((set) => String(set.repetitions));
  const rests = sets.map((set) => String(set.restSeconds));
  const modes = sets.map((set) => String(modeNumber(set.mode)));
  const targetRms = sets.map((set) => String(set.targetRm));
  const leftRight = sets.map((_set, index) =>
    unilateral ? String((index % 2) + 1) : '0'
  );
  const capacity = sets.reduce(
    (sum, set) => sum + set.repetitions * set.targetRm * 2.2,
    0
  );

  return {
    action: {
      groupId: numericRemoteId(exercise.groupId, 'Exercise group ID'),
      actionLibraryId: resolveVariantId(detail, exercise),
      templatePresetId: GAIN_MUSCLE_PRESET_ID,
      setsAndReps: repetitions.join(','),
      breakTime: rests.join(','),
      breakTime2: rests.join(','),
      sportMode: modes.join(','),
      leftRight: leftRight.join(','),
      selectCompletionMethod: sets.map(() => '1').join(','),
      completionMethod: sets.map(() => '1').join(','),
      countType: sets.map(() => '1').join(','),
      weights: sets.map(() => '3.5').join(','),
      counterweight2: targetRms.join(','),
      counterweight: targetRms.join(','),
      level: sets.map(() => '0').join(','),
      capacity,
    },
    remoteSetCount: sets.length,
  };
}

async function buildWorkoutPayload(
  api: SpeedianceApiClient,
  request: SpeedianceCreateAndScheduleWorkoutRequest
): Promise<ResolvedWorkoutPayload> {
  const actions: SpeedianceCustomWorkoutActionPayload[] = [];
  let remoteSetCount = 0;
  for (const exercise of request.exercises) {
    const detail = await api.getActionLibraryGroup(exercise.groupId);
    if (!isRecord(detail)) {
      throw new SpeedianceWorkoutValidationError(
        `Speediance exercise ${exercise.groupId} could not be resolved.`
      );
    }
    const resolved = actionPayload(detail, exercise);
    actions.push(resolved.action);
    remoteSetCount += resolved.remoteSetCount;
  }

  return {
    payload: {
      name: request.name,
      actionLibraryList: actions,
      totalCapacity: actions.reduce((sum, action) => sum + action.capacity, 0),
      deviceType: GYM_MONSTER_DEVICE_TYPE,
      bgColor: 0,
    },
    remoteSetCount,
  };
}

function templateIdentity(
  value: unknown,
  fallbackName?: string
): SpeedianceTemplateIdentity | null {
  if (!isRecord(value)) return null;
  const id = remoteId(value.id);
  const code = stringValue(value.code) ?? stringValue(value.templateCode);
  const name =
    stringValue(value.name) ?? stringValue(value.title) ?? fallbackName ?? null;
  return id && code && name ? { id, code, name } : null;
}

async function exactTemplates(
  api: SpeedianceApiClient,
  name: string
): Promise<SpeedianceTemplateIdentity[]> {
  const templates = await api.getCustomWorkouts(GYM_MONSTER_DEVICE_TYPE);
  return templates
    .map((item) => templateIdentity(item))
    .filter((item): item is SpeedianceTemplateIdentity => Boolean(item))
    .filter((item) => item.name === name);
}

function canonicalAction(value: unknown): CanonicalRemoteAction | null {
  if (!isRecord(value)) return null;
  const groupId = remoteId(value.groupId);
  const actionLibraryId = remoteId(value.actionLibraryId);
  if (!groupId || !actionLibraryId) return null;
  return {
    groupId,
    actionLibraryId,
    templatePresetId: Number(value.templatePresetId),
    setsAndReps: String(value.setsAndReps ?? ''),
    breakTime2: String(value.breakTime2 ?? value.breakTime ?? ''),
    sportMode: String(value.sportMode ?? ''),
    leftRight: String(value.leftRight ?? ''),
    completionMethod: String(value.completionMethod ?? ''),
    countType: String(value.countType ?? ''),
    counterweight2: String(value.counterweight2 ?? value.counterweight ?? ''),
  };
}

function canonicalPayloadActions(
  payload: SpeedianceCustomWorkoutPayload
): CanonicalRemoteAction[] {
  return payload.actionLibraryList.map((action) => ({
    groupId: String(action.groupId),
    actionLibraryId: String(action.actionLibraryId),
    templatePresetId: action.templatePresetId,
    setsAndReps: action.setsAndReps,
    breakTime2: action.breakTime2,
    sportMode: action.sportMode,
    leftRight: action.leftRight,
    completionMethod: action.completionMethod,
    countType: action.countType,
    counterweight2: action.counterweight2,
  }));
}

function customWorkoutMatches(
  detail: unknown,
  payload: SpeedianceCustomWorkoutPayload
): boolean {
  if (!isRecord(detail)) return false;
  const actions = records(detail.actionLibraryList)
    .map(canonicalAction)
    .filter((item): item is CanonicalRemoteAction => Boolean(item));
  return (
    stringValue(detail.name) === payload.name &&
    JSON.stringify(actions) === JSON.stringify(canonicalPayloadActions(payload))
  );
}

async function verifyTemplate(
  api: SpeedianceApiClient,
  identity: SpeedianceTemplateIdentity,
  payload: SpeedianceCustomWorkoutPayload
): Promise<void> {
  const detail = await api.getCustomWorkoutDetail(identity.code);
  if (!customWorkoutMatches(detail, payload)) {
    throw new SpeedianceWorkoutConflictError(
      `A Speediance workout named "${payload.name}" exists with different exercises or sets.`
    );
  }
}

async function resolveCreatedTemplate(
  api: SpeedianceApiClient,
  name: string,
  createResult: unknown
): Promise<SpeedianceTemplateIdentity> {
  const responseIdentity = templateIdentity(createResult, name);
  for (let attempt = 0; attempt < CREATE_VISIBILITY_ATTEMPTS; attempt++) {
    if (attempt > 0) await wait(CREATE_VISIBILITY_RETRY_MS);
    const matches = await exactTemplates(api, name);
    if (matches.length > 1) {
      throw new SpeedianceWorkoutConflictError(
        `Speediance returned multiple workouts named "${name}" after creation.`
      );
    }
    if (matches.length === 1) return matches[0];
  }
  if (responseIdentity) return responseIdentity;
  throw new SpeedianceApiError(
    'Speediance created the workout but its remote identity could not be verified.'
  );
}

async function ensureTemplate(
  api: SpeedianceApiClient,
  payload: SpeedianceCustomWorkoutPayload
): Promise<{ identity: SpeedianceTemplateIdentity; created: boolean }> {
  const matches = await exactTemplates(api, payload.name);
  if (matches.length > 1) {
    throw new SpeedianceWorkoutConflictError(
      `Speediance contains multiple workouts named "${payload.name}".`
    );
  }
  if (matches.length === 1) {
    await verifyTemplate(api, matches[0], payload);
    return { identity: matches[0], created: false };
  }

  const createResult = await api.createCustomWorkout(payload);
  const identity = await resolveCreatedTemplate(
    api,
    payload.name,
    createResult
  );
  await verifyTemplate(api, identity, payload);
  return { identity, created: true };
}

function calendarEntries(calendar: unknown[], day: string): unknown[] {
  const calendarDay = records(calendar).find(
    (item) => stringValue(item.date) === day
  );
  return calendarDay && Array.isArray(calendarDay.trainingPlanList)
    ? calendarDay.trainingPlanList
    : [];
}

function reservationCode(value: unknown): string | null {
  if (!isRecord(value) || value.isReservation === false) return null;
  return stringValue(value.code) ?? stringValue(value.templateCode);
}

function matchingReservations(entries: unknown[], code: string): unknown[] {
  return entries.filter((entry) => reservationCode(entry) === code);
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalJsonValue(value[key]);
  }
  return sorted;
}

function unrelatedEntryFingerprint(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value)) ?? String(value);
}

function unrelatedState(entries: unknown[], targetCode: string): string[] {
  return entries
    .filter((entry) => reservationCode(entry) !== targetCode)
    .map(unrelatedEntryFingerprint)
    .sort();
}

async function ensureScheduled(
  api: SpeedianceApiClient,
  day: string,
  templateCode: string
): Promise<'scheduled' | 'already_scheduled'> {
  const month = day.slice(0, 7);
  const beforeCalendar = await api.getTrainingCalendarMonth(
    month,
    GYM_MONSTER_DEVICE_TYPE
  );
  const beforeEntries = calendarEntries(beforeCalendar, day);
  const existing = matchingReservations(beforeEntries, templateCode);
  if (existing.length > 1) {
    throw new SpeedianceWorkoutConflictError(
      'Speediance contains duplicate reservations for this workout and date.'
    );
  }
  if (existing.length === 1) return 'already_scheduled';

  const unrelatedBefore = unrelatedState(beforeEntries, templateCode);
  await api.setTemplateReservation(
    day,
    templateCode,
    1,
    GYM_MONSTER_DEVICE_TYPE
  );
  const afterCalendar = await api.getTrainingCalendarMonth(
    month,
    GYM_MONSTER_DEVICE_TYPE
  );
  const afterEntries = calendarEntries(afterCalendar, day);
  if (matchingReservations(afterEntries, templateCode).length !== 1) {
    throw new SpeedianceApiError(
      'Speediance scheduling state could not be verified.'
    );
  }
  if (
    JSON.stringify(unrelatedState(afterEntries, templateCode)) !==
    JSON.stringify(unrelatedBefore)
  ) {
    throw new SpeedianceApiError(
      'Speediance changed unrelated calendar entries while scheduling.'
    );
  }
  return 'scheduled';
}

export async function createAndScheduleSpeedianceWorkout(
  userId: string,
  request: SpeedianceCreateAndScheduleWorkoutRequest
): Promise<SpeedianceCreateAndScheduleWorkoutResponse> {
  const { api, timezone } = await authenticatedClient(
    userId,
    request.providerId
  );
  const today = todayInZone(timezone);
  if (request.scheduleDate < today) {
    throw new SpeedianceWorkoutValidationError(
      `Speediance workouts cannot be scheduled in the past (${request.scheduleDate} < ${today}).`
    );
  }

  const resolved = await buildWorkoutPayload(api, request);
  const template = await ensureTemplate(api, resolved.payload);
  const scheduleStatus = await ensureScheduled(
    api,
    request.scheduleDate,
    template.identity.code
  );

  log(
    'info',
    `[speedianceWorkoutService] ${template.created ? 'Created' : 'Reused'} and ${scheduleStatus} workout ${template.identity.id} for user ${userId} on ${request.scheduleDate}.`
  );

  return {
    success: true,
    workout: {
      id: template.identity.id,
      code: template.identity.code,
      name: template.identity.name,
      created: template.created,
      exerciseCount: request.exercises.length,
      remoteSetCount: resolved.remoteSetCount,
    },
    schedule: {
      date: request.scheduleDate,
      status: scheduleStatus,
    },
  };
}

export default {
  searchSpeedianceExercises,
  createAndScheduleSpeedianceWorkout,
};
