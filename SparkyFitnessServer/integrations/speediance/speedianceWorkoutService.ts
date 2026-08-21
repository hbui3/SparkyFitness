import {
  addDays,
  dayOfWeek,
  todayInZone,
  type SpeedianceCompletionUnit,
  type SpeedianceCreatePlanRequest,
  type SpeedianceCreatePlanResponse,
  type SpeedianceCreateAndScheduleWorkoutRequest,
  type SpeedianceCreateAndScheduleWorkoutResponse,
  type SpeedianceExercise,
  type SpeedianceExerciseSearchRequest,
  type SpeedianceExerciseSearchResponse,
  type SpeedianceResistanceMode,
  type SpeedianceTemplatePreset,
  type SpeedianceWorkoutDefinition,
  type SpeedianceWorkoutDetail,
  type SpeedianceWorkoutDeleteResponse,
  type SpeedianceWorkoutExercise,
  type SpeedianceWorkoutListResponse,
  type SpeedianceWorkoutScheduleResponse,
  type SpeedianceWorkoutSet,
  type SpeedianceWorkoutSummary,
  type SpeedianceWorkoutUpsertResponse,
} from '@workspace/shared';
import { log } from '../../config/logging.js';
import { loadUserTimezone } from '../../utils/timezoneLoader.js';
import trainingFeedbackService from '../../services/trainingFeedbackService.js';
import {
  SpeedianceApiClient,
  SpeedianceApiError,
  type SpeedianceCustomWorkoutActionPayload,
  type SpeedianceCustomWorkoutPayload,
} from './speedianceApiClient.js';
import { getSpeedianceProviderCredentials } from './speedianceRepository.js';
import exerciseRepository from '../../models/exercise.js';
import workoutPresetRepository from '../../models/workoutPresetRepository.js';
import workoutPlanTemplateService from '../../services/workoutPlanTemplateService.js';

const GYM_MONSTER_DEVICE_TYPE = 1;
const DEFAULT_WORKOUT_COACH_LANGUAGE = 'de';
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

interface NativeExerciseRow {
  id: string;
  user_id?: string | null;
  source?: string | null;
}

interface NativeWorkoutPresetRow {
  id: number;
  description?: string | null;
}

interface NativeWorkoutPlanRow {
  id: string | number;
  plan_name: string;
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

function normalizeLanguage(value: unknown): string | null {
  const language = stringValue(value);
  if (!language) return null;
  return language.replace(/_/g, '-').split('-')[0]?.toLowerCase() ?? null;
}

function variantCoachLanguage(variant: Record<string, unknown>): string | null {
  const coach = isRecord(variant.coach) ? variant.coach : null;
  return normalizeLanguage(
    variant.coachLanguage ?? coach?.coachLanguage ?? coach?.language
  );
}

function germanCoachVariant(
  variants: Record<string, unknown>[]
): Record<string, unknown> | null {
  return (
    variants.find(
      (variant) =>
        remoteId(variant.id) !== null &&
        variantCoachLanguage(variant) === DEFAULT_WORKOUT_COACH_LANGUAGE
    ) ?? null
  );
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

function normalizeUniformList(value: unknown): string {
  const serialized = String(value ?? '');
  const parts = serialized.split(',');
  return parts.length > 0 && parts.every((part) => part === parts[0])
    ? parts[0]
    : serialized;
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
  const variants = records(detail.actionLibraryList);
  const preferredVariant = germanCoachVariant(variants);
  const fallbackVariant = variants.find(
    (variant) => remoteId(variant.id) !== null
  );
  const variantId = remoteId((preferredVariant ?? fallbackVariant)?.id);
  if (!title || !variantId) return null;
  const accessories = parseRemoteIds(detail.accessories);
  const completionMethod = Number(detail.completionMethod ?? 1);
  const selectCompletionMethod = Number(detail.selectCompletionMethod ?? 0);
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
    compatibleForWorkout:
      preferredVariant !== null &&
      (completionMethod === 1 ||
        completionMethod === 2 ||
        completionMethod === 5 ||
        (completionMethod === 0 && selectCompletionMethod === 1) ||
        dataStatType === 6),
    completionMethod,
    selectCompletionMethod,
    dataStatType,
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
  if (!selected || !variantId) {
    throw new SpeedianceWorkoutValidationError(
      `No compatible Speediance exercise variant was found for "${exercise.expectedTitle}".`
    );
  }
  if (variantCoachLanguage(selected) !== DEFAULT_WORKOUT_COACH_LANGUAGE) {
    if (!germanCoachVariant(variants)) {
      throw new SpeedianceWorkoutValidationError(
        `No German Speediance coach video is available for "${exercise.expectedTitle}".`
      );
    }
    throw new SpeedianceWorkoutValidationError(
      `Speediance variant ${variantId} for "${exercise.expectedTitle}" is not the default German coach video. Search the exercise library again and use its current variantId.`
    );
  }
  return numericRemoteId(variantId, 'Exercise variant ID');
}

function validateWorkoutExercise(
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
  const selectCompletionMethod = Number(detail.selectCompletionMethod ?? 0);
  const unit = exercise.completionUnit ?? 'repetitions';
  const expectedCompletionMethod =
    unit === 'repetitions' ? 1 : unit === 'seconds' ? 2 : 5;
  if (
    dataStatType !== 6 &&
    completionMethod !== expectedCompletionMethod &&
    !(
      unit === 'seconds' &&
      completionMethod === 0 &&
      selectCompletionMethod === 1
    )
  ) {
    throw new SpeedianceWorkoutValidationError(
      `"${actualTitle}" does not support the selected completion unit (${unit}).`
    );
  }
}

function setTarget(
  set: SpeedianceWorkoutSet,
  unit: SpeedianceCompletionUnit
): number {
  if (unit === 'seconds') return set.durationSeconds ?? set.repetitions;
  if (unit === 'calories') return set.calorieTarget ?? set.repetitions;
  return set.repetitions;
}

function completionMethodNumber(unit: SpeedianceCompletionUnit): number {
  return unit === 'repetitions' ? 1 : unit === 'seconds' ? 2 : 5;
}

function presetWeight(
  set: SpeedianceWorkoutSet,
  presetId: SpeedianceTemplatePreset
): number {
  return presetId === -1 ? (set.weightKg ?? 3.5) : 3.5;
}

function actionPayload(
  detail: Record<string, unknown>,
  exercise: SpeedianceWorkoutExercise
): { action: SpeedianceCustomWorkoutActionPayload; remoteSetCount: number } {
  validateWorkoutExercise(detail, exercise);
  const unit = exercise.completionUnit ?? 'repetitions';
  const presetId = exercise.presetId ?? 1;
  const isVita = Number(detail.dataStatType ?? 0) === 6;
  const unilateral = Number(detail.isLeftRight ?? 0) === 1;
  const sets = expandSets(exercise.sets, unilateral);
  const repetitions = sets.map((set) => String(setTarget(set, unit)));
  const rests = sets.map((set) => String(set.restSeconds));
  const modes = sets.map((set) => String(modeNumber(set.mode)));
  const targetRms = sets.map((set) => String(set.targetRm));
  const completionMethod = completionMethodNumber(unit);
  const leftRight = sets.map((_set, index) =>
    unilateral ? String((index % 2) + 1) : '0'
  );
  const capacity = isVita
    ? 0
    : sets.reduce(
        (sum, set) =>
          sum +
          setTarget(set, unit) *
            (presetId === -1 ? presetWeight(set, presetId) : set.targetRm) *
            2.2,
        0
      );
  const weights = isVita
    ? sets.map(() => '0')
    : sets.map((set) => String(presetWeight(set, presetId)));
  const counterweights = isVita || presetId === -1 ? '' : targetRms.join(',');

  return {
    action: {
      groupId: numericRemoteId(exercise.groupId, 'Exercise group ID'),
      actionLibraryId: resolveVariantId(detail, exercise),
      templatePresetId: presetId,
      setsAndReps: repetitions.join(','),
      breakTime: rests.join(','),
      breakTime2: rests.join(','),
      sportMode: modes.join(','),
      leftRight: leftRight.join(','),
      selectCompletionMethod: sets.map(() => '1').join(','),
      completionMethod: sets.map(() => String(completionMethod)).join(','),
      countType: sets.map(() => String(completionMethod)).join(','),
      weights: weights.join(','),
      counterweight2: counterweights,
      counterweight: counterweights,
      level: sets.map((set) => String(set.level ?? 0)).join(','),
      capacity,
    },
    remoteSetCount: sets.length,
  };
}

async function buildWorkoutPayload(
  api: SpeedianceApiClient,
  request: SpeedianceWorkoutDefinition
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
    completionMethod: normalizeUniformList(value.completionMethod),
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
    completionMethod: normalizeUniformList(action.completionMethod),
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

function canonicalActionStructure(
  action: CanonicalRemoteAction
): Omit<CanonicalRemoteAction, 'actionLibraryId'> {
  return {
    groupId: action.groupId,
    templatePresetId: action.templatePresetId,
    setsAndReps: action.setsAndReps,
    breakTime2: action.breakTime2,
    sportMode: action.sportMode,
    leftRight: action.leftRight,
    completionMethod: action.completionMethod,
    counterweight2: action.counterweight2,
  };
}

function customWorkoutDiffersOnlyByVariant(
  detail: unknown,
  payload: SpeedianceCustomWorkoutPayload
): boolean {
  if (!isRecord(detail) || stringValue(detail.name) !== payload.name) {
    return false;
  }
  const remoteActions = records(detail.actionLibraryList)
    .map(canonicalAction)
    .filter((item): item is CanonicalRemoteAction => Boolean(item));
  const expectedActions = canonicalPayloadActions(payload);
  if (
    remoteActions.length !== records(detail.actionLibraryList).length ||
    remoteActions.length !== expectedActions.length
  ) {
    return false;
  }
  return remoteActions.every((action, index) => {
    const expectedAction = expectedActions[index];
    return (
      expectedAction !== undefined &&
      JSON.stringify(canonicalActionStructure(action)) ===
        JSON.stringify(canonicalActionStructure(expectedAction))
    );
  });
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
    const existing = matches[0];
    const detail = await api.getCustomWorkoutDetail(existing.code);
    if (customWorkoutMatches(detail, payload)) {
      return { identity: existing, created: false };
    }
    if (!customWorkoutDiffersOnlyByVariant(detail, payload)) {
      throw new SpeedianceWorkoutConflictError(
        `A Speediance workout named "${payload.name}" exists with different exercises or sets.`
      );
    }
    await api.updateCustomWorkout(
      numericRemoteId(existing.id, 'Workout template ID'),
      payload
    );
    await verifyTemplate(api, existing, payload);
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

async function upsertTemplate(
  api: SpeedianceApiClient,
  payload: SpeedianceCustomWorkoutPayload,
  request: SpeedianceWorkoutDefinition
): Promise<{ identity: SpeedianceTemplateIdentity; created: boolean }> {
  if (!request.remoteId && !request.remoteCode) {
    return ensureTemplate(api, payload);
  }
  if (!request.remoteId || !request.remoteCode) {
    throw new SpeedianceWorkoutValidationError(
      'Editing a Speediance workout requires both remoteId and remoteCode.'
    );
  }
  const current = await api.getCustomWorkoutDetail(request.remoteCode);
  const currentName = isRecord(current) ? stringValue(current.name) : null;
  const currentIdentity =
    templateIdentity(current) ??
    (currentName
      ? { id: request.remoteId, code: request.remoteCode, name: currentName }
      : null);
  if (currentIdentity?.id !== request.remoteId) {
    throw new SpeedianceWorkoutConflictError(
      'The selected Speediance workout identity changed. Reload it before editing.'
    );
  }
  if (customWorkoutMatches(current, payload)) {
    return { identity: currentIdentity, created: false };
  }
  await api.updateCustomWorkout(
    numericRemoteId(request.remoteId, 'Workout template ID'),
    payload
  );
  const identity = { ...currentIdentity, name: payload.name };
  await verifyTemplate(api, identity, payload);
  return { identity, created: false };
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

async function ensureUnscheduled(
  api: SpeedianceApiClient,
  day: string,
  templateCode: string
): Promise<'unscheduled' | 'already_unscheduled'> {
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
  if (existing.length === 0) return 'already_unscheduled';
  const unrelatedBefore = unrelatedState(beforeEntries, templateCode);
  await api.setTemplateReservation(
    day,
    templateCode,
    0,
    GYM_MONSTER_DEVICE_TYPE
  );
  const afterCalendar = await api.getTrainingCalendarMonth(
    month,
    GYM_MONSTER_DEVICE_TYPE
  );
  const afterEntries = calendarEntries(afterCalendar, day);
  if (matchingReservations(afterEntries, templateCode).length !== 0) {
    throw new SpeedianceApiError(
      'Speediance unscheduling state could not be verified.'
    );
  }
  if (
    JSON.stringify(unrelatedState(afterEntries, templateCode)) !==
    JSON.stringify(unrelatedBefore)
  ) {
    throw new SpeedianceApiError(
      'Speediance changed unrelated calendar entries while unscheduling.'
    );
  }
  return 'unscheduled';
}

function preferenceExerciseNames(
  request: SpeedianceWorkoutDefinition
): Set<string> {
  return new Set(
    request.exercises.map((exercise) => normalizeLabel(exercise.expectedTitle))
  );
}

async function assertTrainingPreferences(
  userId: string,
  request: SpeedianceWorkoutDefinition
): Promise<void> {
  const learningContext =
    await trainingFeedbackService.getTrainingLearningContext(userId);
  const acknowledged = new Set(request.acknowledgedPreferenceIds);
  const requestedExerciseNames = preferenceExerciseNames(request);
  const blocked = learningContext.preferences.filter(
    (preference) =>
      preference.kind === 'exercise' &&
      preference.sentiment === 'avoid' &&
      requestedExerciseNames.has(normalizeLabel(preference.subject)) &&
      !acknowledged.has(preference.id)
  );
  if (blocked.length > 0) {
    throw new SpeedianceWorkoutValidationError(
      `The plan contains an avoided exercise: ${blocked
        .map((preference) => `${preference.subject} (${preference.id})`)
        .join(
          ', '
        )}. Choose an alternative, or include its preference ID in acknowledgedPreferenceIds only after the user explicitly overrides it.`
    );
  }
}

function nativeSetNotes(
  exercise: SpeedianceWorkoutExercise,
  set: SpeedianceWorkoutSet
): string {
  const presetId = exercise.presetId ?? 1;
  const parts = [`Speediance preset ${presetId}`];
  if (presetId !== -1) parts.push(`target RM ${set.targetRm}`);
  parts.push(`mode ${set.mode}`);
  return parts.join('; ');
}

async function findOrCreateNativeExercise(
  userId: string,
  exercise: SpeedianceWorkoutExercise
): Promise<NativeExerciseRow> {
  let row = (await exerciseRepository.getExerciseBySourceAndSourceId(
    'Speediance',
    exercise.groupId,
    userId
  )) as NativeExerciseRow | null;
  const primaryMuscles = exercise.primaryMuscle ? [exercise.primaryMuscle] : [];
  if (!row) {
    row = (await exerciseRepository.createExercise({
      user_id: userId,
      name: exercise.expectedTitle,
      category: exercise.category ?? 'Strength',
      source: 'Speediance',
      source_id: exercise.groupId,
      is_custom: true,
      shared_with_public: false,
      equipment: exercise.accessoryNames ?? [],
      primary_muscles: primaryMuscles,
      secondary_muscles: [],
      modality:
        (exercise.completionUnit ?? 'repetitions') === 'repetitions'
          ? 'weight_reps'
          : 'duration',
    })) as NativeExerciseRow | null;
  } else if (row.user_id === userId && row.source === 'Speediance') {
    row = (await exerciseRepository.updateExercise(row.id, userId, {
      name: exercise.expectedTitle,
      category: exercise.category ?? 'Strength',
      equipment: exercise.accessoryNames ?? [],
      primary_muscles: primaryMuscles,
      modality:
        (exercise.completionUnit ?? 'repetitions') === 'repetitions'
          ? 'weight_reps'
          : 'duration',
    })) as NativeExerciseRow | null;
  }
  if (!row) {
    throw new SpeedianceWorkoutValidationError(
      `Unable to create the native Sparky exercise "${exercise.expectedTitle}".`
    );
  }
  return row;
}

async function syncNativeWorkoutPreset(
  userId: string,
  request: SpeedianceWorkoutDefinition
): Promise<number> {
  const exercises = [];
  for (
    let exerciseIndex = 0;
    exerciseIndex < request.exercises.length;
    exerciseIndex++
  ) {
    const exercise = request.exercises[exerciseIndex];
    if (!exercise) continue;
    const nativeExercise = await findOrCreateNativeExercise(userId, exercise);
    exercises.push({
      exercise_id: nativeExercise.id,
      image_url: null,
      sort_order: exerciseIndex,
      superset_group: null,
      sets: exercise.sets.map((set, setIndex) => ({
        set_number: setIndex + 1,
        set_type: set.setType === 'warmup' ? 'warmup' : 'normal',
        reps:
          (exercise.completionUnit ?? 'repetitions') === 'repetitions'
            ? set.repetitions
            : null,
        weight: set.weightKg ?? null,
        duration:
          exercise.completionUnit === 'seconds'
            ? (set.durationSeconds ?? set.repetitions)
            : null,
        distance: null,
        rest_time: set.restSeconds,
        notes: nativeSetNotes(exercise, set),
      })),
    });
  }

  let preset = request.remoteCode
    ? ((await workoutPresetRepository.getWorkoutPresetBySpeedianceCode(
        userId,
        request.remoteCode
      )) as NativeWorkoutPresetRow | null)
    : null;
  preset ??= (await workoutPresetRepository.getWorkoutPresetByName(
    userId,
    request.name
  )) as NativeWorkoutPresetRow | null;
  const description = `Managed by the Sparky Speediance workout manager. Remote code: ${request.remoteCode ?? 'pending'}`;
  if (!preset) {
    preset = (await workoutPresetRepository.createWorkoutPreset({
      user_id: userId,
      name: request.name,
      description,
      is_public: false,
      exercises,
    })) as NativeWorkoutPresetRow | null;
  } else {
    const managerOwned = preset.description?.includes('Speediance') ?? false;
    if (!managerOwned) {
      throw new SpeedianceWorkoutConflictError(
        `A native Sparky workout named "${request.name}" already exists and is not managed by Speediance. Rename one of the workouts before syncing.`
      );
    }
    preset = (await workoutPresetRepository.updateWorkoutPreset(
      preset.id,
      userId,
      {
        name: request.name,
        description,
        is_public: false,
        exercises,
      }
    )) as NativeWorkoutPresetRow | null;
  }
  if (!preset) {
    throw new SpeedianceWorkoutValidationError(
      `Unable to synchronize the native Sparky workout "${request.name}".`
    );
  }
  return preset.id;
}

function workoutExerciseCount(value: Record<string, unknown>): number {
  if (Array.isArray(value.actionLibraryList))
    return value.actionLibraryList.length;
  const count = Number(value.actionCount ?? value.exerciseCount ?? 0);
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : 0;
}

async function nativePresetId(
  userId: string,
  name: string,
  remoteCode?: string
): Promise<number | null> {
  const byRemoteCode = remoteCode
    ? ((await workoutPresetRepository.getWorkoutPresetBySpeedianceCode(
        userId,
        remoteCode
      )) as NativeWorkoutPresetRow | null)
    : null;
  const preset =
    byRemoteCode ??
    ((await workoutPresetRepository.getWorkoutPresetByName(
      userId,
      name
    )) as NativeWorkoutPresetRow | null);
  return preset?.id ?? null;
}

export async function listSpeedianceWorkouts(
  userId: string,
  providerId?: string
): Promise<SpeedianceWorkoutListResponse> {
  const { api } = await authenticatedClient(userId, providerId);
  const raw = await api.getCustomWorkouts(GYM_MONSTER_DEVICE_TYPE);
  const workouts: SpeedianceWorkoutSummary[] = [];
  for (const item of records(raw)) {
    const identity = templateIdentity(item);
    if (!identity) continue;
    workouts.push({
      ...identity,
      exerciseCount: workoutExerciseCount(item),
      nativeWorkoutPresetId: await nativePresetId(
        userId,
        identity.name,
        identity.code
      ),
    });
  }
  workouts.sort((left, right) => left.name.localeCompare(right.name));
  return { workouts };
}

function numberList(value: unknown): number[] {
  return String(value ?? '')
    .split(',')
    .map(Number)
    .filter((item) => Number.isFinite(item));
}

function listValue(values: number[], index: number, fallback: number): number {
  return values[index] ?? values[0] ?? fallback;
}

function resistanceMode(value: number): SpeedianceResistanceMode {
  if (value === 2) return 'chains';
  if (value === 3) return 'eccentric';
  return 'standard';
}

function templatePreset(value: unknown): SpeedianceTemplatePreset {
  const preset = Number(value);
  return preset === -1 ||
    preset === 0 ||
    preset === 1 ||
    preset === 3 ||
    preset === 5
    ? preset
    : 1;
}

function completionUnit(value: number): SpeedianceCompletionUnit {
  if (value === 5) return 'calories';
  if (value === 2) return 'seconds';
  return 'repetitions';
}

function workoutSetsFromRemote(
  action: Record<string, unknown>,
  presetId: SpeedianceTemplatePreset,
  unilateral: boolean
): SpeedianceWorkoutSet[] {
  const targets = numberList(action.setsAndReps);
  const rests = numberList(action.breakTime2 ?? action.breakTime);
  const modes = numberList(action.sportMode);
  const targetRms = numberList(action.counterweight2 ?? action.counterweight);
  const weights = numberList(action.weights);
  const levels = numberList(action.level);
  const completionMethods = numberList(action.completionMethod);
  const leftRight = numberList(action.leftRight);
  const sets: SpeedianceWorkoutSet[] = [];
  for (let index = 0; index < targets.length; index++) {
    if (unilateral && listValue(leftRight, index, 0) === 2) continue;
    const target = targets[index] ?? 1;
    const unit = completionUnit(listValue(completionMethods, index, 1));
    sets.push({
      repetitions: Math.max(1, Math.round(target)),
      targetRm: Math.max(1, Math.round(listValue(targetRms, index, 12))),
      weightKg: presetId === -1 ? listValue(weights, index, 3.5) : undefined,
      durationSeconds: unit === 'seconds' ? Math.round(target) : undefined,
      calorieTarget: unit === 'calories' ? Math.round(target) : undefined,
      level:
        listValue(levels, index, 0) > 0
          ? Math.round(listValue(levels, index, 0))
          : undefined,
      setType: presetId === 0 ? 'warmup' : 'working',
      mode: resistanceMode(listValue(modes, index, 1)),
      restSeconds: Math.max(0, Math.round(listValue(rests, index, 90))),
    });
  }
  return sets;
}

async function detailExercise(
  api: SpeedianceApiClient,
  action: Record<string, unknown>,
  accessoryNamesById: Map<string, string>
): Promise<SpeedianceWorkoutExercise | null> {
  const groupId = remoteId(action.groupId);
  const variantId = remoteId(action.actionLibraryId);
  if (!groupId || !variantId) return null;
  const detail = await api.getActionLibraryGroup(groupId);
  if (!isRecord(detail)) return null;
  const expectedTitle = stringValue(detail.title) ?? stringValue(detail.name);
  if (!expectedTitle) return null;
  const presetId = templatePreset(action.templatePresetId);
  const unilateral = Number(detail.isLeftRight ?? 0) === 1;
  const accessories = parseRemoteIds(detail.accessories);
  const actionCompletionMethod =
    numberList(action.completionMethod)[0] ??
    Number(detail.completionMethod ?? 1);
  const selectCompletionMethod =
    numberList(action.selectCompletionMethod)[0] ??
    Number(detail.selectCompletionMethod ?? 0);
  const unit =
    actionCompletionMethod === 0 && selectCompletionMethod === 1
      ? 'seconds'
      : completionUnit(actionCompletionMethod);
  return {
    groupId,
    variantId,
    expectedTitle,
    category: stringValue(detail.trainingPartName),
    primaryMuscle: stringValue(detail.mainMuscleGroupName),
    accessoryNames: accessories
      .map((id) => accessoryNamesById.get(id))
      .filter((name): name is string => Boolean(name)),
    dataStatType: Number(detail.dataStatType ?? 0),
    presetId,
    completionUnit: unit,
    sets: workoutSetsFromRemote(action, presetId, unilateral),
  };
}

export async function getSpeedianceWorkout(
  userId: string,
  code: string,
  providerId?: string
): Promise<SpeedianceWorkoutDetail> {
  const { api } = await authenticatedClient(userId, providerId);
  const detail = await api.getCustomWorkoutDetail(code);
  if (!isRecord(detail)) {
    throw new SpeedianceWorkoutValidationError('Speediance workout not found.');
  }
  const listIdentity = (
    await exactTemplates(api, stringValue(detail.name) ?? '')
  ).find((item) => item.code === code);
  const identity = templateIdentity(detail) ?? listIdentity;
  if (!identity) {
    throw new SpeedianceWorkoutValidationError(
      'Speediance workout identity could not be resolved.'
    );
  }
  const accessoryNamesById = accessoryNameMap(await api.getAccessories());
  const exercises: SpeedianceWorkoutExercise[] = [];
  for (const action of records(detail.actionLibraryList)) {
    const parsed = await detailExercise(api, action, accessoryNamesById);
    if (parsed && parsed.sets.length > 0) exercises.push(parsed);
  }
  return {
    ...identity,
    exerciseCount: exercises.length,
    nativeWorkoutPresetId: await nativePresetId(
      userId,
      identity.name,
      identity.code
    ),
    exercises,
  };
}

async function upsertWithClient(
  userId: string,
  api: SpeedianceApiClient,
  request: SpeedianceWorkoutDefinition
): Promise<SpeedianceWorkoutUpsertResponse> {
  const resolved = await buildWorkoutPayload(api, request);
  const template = await upsertTemplate(api, resolved.payload, request);
  const nativeWorkoutPresetId = await syncNativeWorkoutPreset(userId, {
    ...request,
    remoteId: template.identity.id,
    remoteCode: template.identity.code,
  });
  return {
    success: true,
    workout: {
      ...template.identity,
      created: template.created,
      exerciseCount: request.exercises.length,
      remoteSetCount: resolved.remoteSetCount,
      nativeWorkoutPresetId,
    },
  };
}

export async function upsertSpeedianceWorkout(
  userId: string,
  request: SpeedianceWorkoutDefinition
): Promise<SpeedianceWorkoutUpsertResponse> {
  await assertTrainingPreferences(userId, request);
  const { api } = await authenticatedClient(userId, request.providerId);
  return upsertWithClient(userId, api, request);
}

async function validateScheduleDay(
  userId: string,
  date: string,
  timezone: string
): Promise<void> {
  const today = todayInZone(timezone);
  if (date < today) {
    throw new SpeedianceWorkoutValidationError(
      `Speediance workouts cannot be scheduled in the past (${date} < ${today}) for user ${userId}.`
    );
  }
}

export async function setSpeedianceWorkoutSchedule(
  userId: string,
  code: string,
  date: string,
  scheduled: boolean,
  providerId?: string
): Promise<SpeedianceWorkoutScheduleResponse> {
  const { api, timezone } = await authenticatedClient(userId, providerId);
  if (scheduled) await validateScheduleDay(userId, date, timezone);
  const status = scheduled
    ? await ensureScheduled(api, date, code)
    : await ensureUnscheduled(api, date, code);
  return { success: true, code, date, status };
}

export async function deleteSpeedianceWorkout(
  userId: string,
  id: string,
  code: string,
  confirmName: string,
  providerId?: string
): Promise<SpeedianceWorkoutDeleteResponse> {
  const { api } = await authenticatedClient(userId, providerId);
  const detail = await api.getCustomWorkoutDetail(code);
  const currentName = isRecord(detail) ? stringValue(detail.name) : null;
  if (!currentName || currentName !== confirmName) {
    throw new SpeedianceWorkoutConflictError(
      'The confirmation name does not match the current Speediance workout. Reload it before deleting.'
    );
  }
  const detailId = isRecord(detail) ? remoteId(detail.id) : null;
  if (detailId && detailId !== id) {
    throw new SpeedianceWorkoutConflictError(
      'The selected Speediance workout identity changed. Reload it before deleting.'
    );
  }
  await api.deleteCustomWorkout(numericRemoteId(id, 'Workout template ID'));
  const remaining = await api.getCustomWorkouts(GYM_MONSTER_DEVICE_TYPE);
  if (
    records(remaining).some((item) => {
      const identity = templateIdentity(item);
      return identity?.id === id || identity?.code === code;
    })
  ) {
    throw new SpeedianceApiError(
      'Speediance deletion could not be verified. Do not retry blindly.'
    );
  }
  log(
    'info',
    `[speedianceWorkoutService] Deleted remote workout ${id} for user ${userId}; the native Sparky preset was preserved.`
  );
  return {
    success: true,
    id,
    code,
    name: currentName,
    nativeWorkoutPresetPreserved: true,
  };
}

function uniquePlanDays(request: SpeedianceCreatePlanRequest): void {
  const days = request.sessions.map((session) => session.dayOfWeek);
  if (new Set(days).size !== days.length) {
    throw new SpeedianceWorkoutValidationError(
      'A Speediance plan can contain only one workout per weekday.'
    );
  }
}

export async function createSpeediancePlan(
  userId: string,
  request: SpeedianceCreatePlanRequest
): Promise<SpeedianceCreatePlanResponse> {
  uniquePlanDays(request);
  const { api, timezone } = await authenticatedClient(
    userId,
    request.providerId
  );
  await validateScheduleDay(userId, request.startDate, timezone);
  const resolvedSessions: Array<{
    dayOfWeek: number;
    name: string;
    code: string;
    nativeWorkoutPresetId: number;
  }> = [];
  for (const session of request.sessions) {
    const definition: SpeedianceWorkoutDefinition = {
      ...session.workout,
      providerId: request.providerId,
    };
    await assertTrainingPreferences(userId, definition);
    const result = await upsertWithClient(userId, api, definition);
    if (result.workout.nativeWorkoutPresetId === null) {
      throw new SpeedianceWorkoutValidationError(
        `Native Sparky preset for "${result.workout.name}" is missing.`
      );
    }
    resolvedSessions.push({
      dayOfWeek: session.dayOfWeek,
      name: result.workout.name,
      code: result.workout.code,
      nativeWorkoutPresetId: result.workout.nativeWorkoutPresetId,
    });
  }

  const plans =
    (await workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId(
      userId
    )) as NativeWorkoutPlanRow[];
  const existing = plans.find((plan) => plan.plan_name === request.planName);
  const planInput = {
    plan_name: request.planName,
    description:
      request.description ||
      'Managed by the Sparky Speediance workout manager.',
    start_date: request.startDate,
    end_date: request.endDate,
    is_active: true,
    currentClientDate: todayInZone(timezone),
    assignments: resolvedSessions.map((session, index) => ({
      day_of_week: session.dayOfWeek,
      workout_preset_id: session.nativeWorkoutPresetId,
      sort_order: index,
    })),
  };
  const nativePlan = existing
    ? await workoutPlanTemplateService.updateWorkoutPlanTemplate(
        userId,
        existing.id,
        planInput
      )
    : await workoutPlanTemplateService.createWorkoutPlanTemplate(
        userId,
        planInput
      );
  const nativePlanRecord = nativePlan as NativeWorkoutPlanRow;

  let scheduledDates = 0;
  const failedDates: Array<{ date: string; workoutName: string }> = [];
  for (
    let date = request.startDate;
    date <= request.endDate;
    date = addDays(date, 1)
  ) {
    const session = resolvedSessions.find(
      (candidate) => candidate.dayOfWeek === dayOfWeek(date)
    );
    if (!session) continue;
    try {
      await ensureScheduled(api, date, session.code);
      scheduledDates++;
    } catch (error) {
      log(
        'error',
        `[speedianceWorkoutService] Unable to schedule ${session.name} on ${date}: ${error instanceof Error ? error.message : String(error)}`
      );
      failedDates.push({ date, workoutName: session.name });
    }
  }

  return {
    success: true,
    plan: {
      id: String(nativePlanRecord.id),
      name: request.planName,
      startDate: request.startDate,
      endDate: request.endDate,
      workoutCount: resolvedSessions.length,
      scheduledDates,
      failedDates,
    },
  };
}

export async function createAndScheduleSpeedianceWorkout(
  userId: string,
  request: SpeedianceCreateAndScheduleWorkoutRequest
): Promise<SpeedianceCreateAndScheduleWorkoutResponse> {
  const definition: SpeedianceWorkoutDefinition = {
    providerId: request.providerId,
    name: request.name,
    exercises: request.exercises,
    acknowledgedPreferenceIds: request.acknowledgedPreferenceIds,
  };
  await assertTrainingPreferences(userId, definition);
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

  const upserted = await upsertWithClient(userId, api, definition);
  const scheduleStatus = await ensureScheduled(
    api,
    request.scheduleDate,
    upserted.workout.code
  );

  log(
    'info',
    `[speedianceWorkoutService] ${upserted.workout.created ? 'Created' : 'Updated/reused'} and ${scheduleStatus} workout ${upserted.workout.id} for user ${userId} on ${request.scheduleDate}.`
  );

  return {
    success: true,
    workout: {
      id: upserted.workout.id,
      code: upserted.workout.code,
      name: upserted.workout.name,
      created: upserted.workout.created,
      exerciseCount: upserted.workout.exerciseCount,
      remoteSetCount: upserted.workout.remoteSetCount,
    },
    schedule: {
      date: request.scheduleDate,
      status: scheduleStatus,
    },
  };
}

export default {
  searchSpeedianceExercises,
  listSpeedianceWorkouts,
  getSpeedianceWorkout,
  upsertSpeedianceWorkout,
  setSpeedianceWorkoutSchedule,
  deleteSpeedianceWorkout,
  createSpeediancePlan,
  createAndScheduleSpeedianceWorkout,
};
