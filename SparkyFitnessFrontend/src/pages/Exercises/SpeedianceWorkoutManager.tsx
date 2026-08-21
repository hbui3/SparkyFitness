import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  SpeedianceCompletionUnit,
  SpeedianceExercise,
  SpeedianceTemplatePreset,
  SpeedianceWorkoutDefinition,
  SpeedianceWorkoutExercise,
  SpeedianceWorkoutSet,
  SpeedianceWorkoutSummary,
} from '@workspace/shared';
import {
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  Edit3,
  Flame,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  useSaveSpeedianceWorkout,
  useDeleteSpeedianceWorkout,
  useLoadSpeedianceWorkout,
  useSearchSpeedianceExercises,
  useSetSpeedianceReservation,
  useSpeedianceWorkouts,
} from '@/hooks/Exercises/useSpeedianceWorkoutManager';
import { formatDateToYYYYMMDD } from '@/lib/utils';

const PRESET_OPTIONS: Array<{
  value: SpeedianceTemplatePreset;
  key: string;
  fallback: string;
}> = [
  { value: -1, key: 'fixedKg', fallback: 'Fixed kg' },
  { value: 0, key: 'warmup', fallback: 'Warm-up' },
  { value: 1, key: 'muscleGain', fallback: 'Muscle gain' },
  { value: 3, key: 'stamina', fallback: 'Stamina' },
  { value: 5, key: 'strength', fallback: 'Strength' },
];

function defaultSet(
  setType: 'warmup' | 'working' = 'working',
  unit: SpeedianceCompletionUnit = 'repetitions',
  isVita = false
): SpeedianceWorkoutSet {
  const target = unit === 'seconds' ? 30 : unit === 'calories' ? 20 : 10;
  return {
    repetitions: setType === 'warmup' ? 12 : target,
    targetRm: setType === 'warmup' ? 18 : 12,
    durationSeconds: unit === 'seconds' ? target : undefined,
    calorieTarget: unit === 'calories' ? target : undefined,
    level: isVita ? 5 : undefined,
    setType,
    mode: 'standard',
    restSeconds: setType === 'warmup' ? 45 : 90,
  };
}

function detectedCompletionUnit(
  exercise: SpeedianceExercise
): SpeedianceCompletionUnit {
  if (exercise.completionMethod === 5) return 'calories';
  if (
    exercise.completionMethod === 2 ||
    (exercise.completionMethod === 0 && exercise.selectCompletionMethod === 1)
  ) {
    return 'seconds';
  }
  return 'repetitions';
}

function setCompletionUnit(
  set: SpeedianceWorkoutSet,
  unit: SpeedianceCompletionUnit
): SpeedianceWorkoutSet {
  return {
    ...set,
    durationSeconds:
      unit === 'seconds' ? (set.durationSeconds ?? set.repetitions) : undefined,
    calorieTarget:
      unit === 'calories' ? (set.calorieTarget ?? set.repetitions) : undefined,
  };
}

function emptyWorkout(): SpeedianceWorkoutDefinition {
  return {
    name: '',
    exercises: [],
    acknowledgedPreferenceIds: [],
  };
}

function exerciseFromSearch(
  exercise: SpeedianceExercise
): SpeedianceWorkoutExercise {
  const completionUnit = detectedCompletionUnit(exercise);
  const isVita = exercise.dataStatType === 6;
  return {
    groupId: exercise.groupId,
    variantId: exercise.variantId,
    expectedTitle: exercise.title,
    category: exercise.category,
    primaryMuscle: exercise.primaryMuscle,
    accessoryNames: exercise.accessoryNames,
    dataStatType: exercise.dataStatType,
    presetId: isVita ? -1 : 1,
    completionUnit,
    sets: [
      defaultSet('working', completionUnit, isVita),
      defaultSet('working', completionUnit, isVita),
      defaultSet('working', completionUnit, isVita),
    ],
  };
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function numberInput(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function SpeedianceWorkoutManager() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [draft, setDraft] = useState<SpeedianceWorkoutDefinition>(emptyWorkout);
  const [searchTerm, setSearchTerm] = useState('');
  const [scheduleDates, setScheduleDates] = useState<Record<string, string>>(
    {}
  );
  const [deletingWorkout, setDeletingWorkout] =
    useState<SpeedianceWorkoutSummary | null>(null);

  const workoutsQuery = useSpeedianceWorkouts(Boolean(user?.id));
  const detailLoader = useLoadSpeedianceWorkout();
  const search = useSearchSpeedianceExercises();
  const save = useSaveSpeedianceWorkout();
  const reservation = useSetSpeedianceReservation();
  const removeWorkout = useDeleteSpeedianceWorkout();

  const compatibleResults = useMemo(
    () =>
      (search.data?.exercises ?? []).filter(
        (exercise) => exercise.compatibleForWorkout
      ),
    [search.data?.exercises]
  );

  const openNew = () => {
    setEditingCode(null);
    setDraft(emptyWorkout());
    setSearchTerm('');
    search.reset();
    setEditorOpen(true);
  };

  const openEdit = (code: string) => {
    setEditingCode(code);
    setDraft(emptyWorkout());
    setSearchTerm('');
    search.reset();
    setEditorOpen(true);
    detailLoader.mutate(
      { code },
      {
        onSuccess: (detail) => {
          setDraft({
            remoteId: detail.id,
            remoteCode: detail.code,
            name: detail.name,
            exercises: detail.exercises,
            acknowledgedPreferenceIds: [],
          });
        },
        onError: () => setEditorOpen(false),
      }
    );
  };

  const updateExercise = (
    index: number,
    updater: (exercise: SpeedianceWorkoutExercise) => SpeedianceWorkoutExercise
  ) => {
    setDraft((current) => ({
      ...current,
      exercises: current.exercises.map((exercise, exerciseIndex) =>
        exerciseIndex === index ? updater(exercise) : exercise
      ),
    }));
  };

  const updateSet = (
    exerciseIndex: number,
    setIndex: number,
    updater: (set: SpeedianceWorkoutSet) => SpeedianceWorkoutSet
  ) => {
    updateExercise(exerciseIndex, (exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set, index) =>
        index === setIndex ? updater(set) : set
      ),
    }));
  };

  const addWarmup = (index: number) => {
    setDraft((current) => {
      const source = current.exercises[index];
      if (!source) return current;
      const warmup: SpeedianceWorkoutExercise = {
        ...source,
        presetId: 0,
        sets: [
          defaultSet(
            'warmup',
            source.completionUnit,
            source.dataStatType === 6
          ),
          defaultSet(
            'warmup',
            source.completionUnit,
            source.dataStatType === 6
          ),
        ],
      };
      const exercises = [...current.exercises];
      exercises.splice(index, 0, warmup);
      return { ...current, exercises };
    });
  };

  const handleSave = async () => {
    if (!draft.name.trim() || draft.exercises.length === 0) return;
    try {
      await save.mutateAsync(draft);
      toast({
        title: t('common.success', 'Success'),
        description: t(
          'speedianceManager.saved',
          'Workout was synchronized with Speediance and Sparky.'
        ),
      });
      setEditorOpen(false);
    } catch {
      // The global API handler shows the server's verified error.
    }
  };

  const handleSchedule = async (code: string) => {
    const date = scheduleDates[code] ?? formatDateToYYYYMMDD(new Date());
    try {
      await reservation.mutateAsync({ code, date, scheduled: true });
      toast({
        title: t('common.success', 'Success'),
        description: t('speedianceManager.scheduled', 'Workout scheduled.'),
      });
    } catch {
      // The API handler reports the reason.
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Dumbbell className="h-5 w-5" />
            {t('speedianceManager.title', 'Speediance Workout Manager')}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              'speedianceManager.description',
              'Build complete workouts once and keep Speediance and Sparky synchronized.'
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => workoutsQuery.refetch()}
            disabled={workoutsQuery.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${workoutsQuery.isFetching ? 'animate-spin' : ''}`}
            />
          </Button>
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" />
            {t('speedianceManager.newWorkout', 'New workout')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {workoutsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading', 'Loading...')}
          </div>
        ) : workoutsQuery.isError ? (
          <p className="text-sm text-destructive">
            {t(
              'speedianceManager.connectionRequired',
              'Connect an active Speediance provider in Settings to load the manager.'
            )}
          </p>
        ) : workoutsQuery.data?.workouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'speedianceManager.empty',
              'No custom Speediance workouts found.'
            )}
          </p>
        ) : (
          workoutsQuery.data?.workouts.map((workout) => {
            const date =
              scheduleDates[workout.code] ?? formatDateToYYYYMMDD(new Date());
            return (
              <div
                key={workout.code}
                className="flex flex-col gap-3 rounded-lg border p-3 lg:flex-row lg:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{workout.name}</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      {workout.exerciseCount}{' '}
                      {t('speedianceManager.exercises', 'exercises')}
                    </Badge>
                    {workout.nativeWorkoutPresetId && (
                      <Badge variant="outline">
                        {t('speedianceManager.linked', 'Linked to Sparky')}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    className="w-auto"
                    min={formatDateToYYYYMMDD(new Date())}
                    value={date}
                    onChange={(event) =>
                      setScheduleDates((current) => ({
                        ...current,
                        [workout.code]: event.target.value,
                      }))
                    }
                  />
                  <Button
                    variant="outline"
                    onClick={() => handleSchedule(workout.code)}
                    disabled={reservation.isPending}
                  >
                    <CalendarPlus className="mr-2 h-4 w-4" />
                    {t('speedianceManager.schedule', 'Schedule')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => openEdit(workout.code)}
                  >
                    <Edit3 className="mr-2 h-4 w-4" />
                    {t('common.edit', 'Edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeletingWorkout(workout)}
                    aria-label={t('speedianceManager.delete', 'Delete workout')}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent
          requireConfirmation
          className="max-h-[92vh] max-w-6xl overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>
              {editingCode
                ? t('speedianceManager.editTitle', 'Edit Speediance workout')
                : t(
                    'speedianceManager.createTitle',
                    'Create Speediance workout'
                  )}
            </DialogTitle>
            <DialogDescription>
              {t(
                'speedianceManager.germanCoachHint',
                'Exercise search uses the German Speediance coach/video version by default.'
              )}
            </DialogDescription>
          </DialogHeader>

          {detailLoader.isPending ? (
            <Loader2 className="mx-auto my-12 h-6 w-6 animate-spin" />
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="speediance-workout-name">
                  {t('speedianceManager.name', 'Workout name')}
                </Label>
                <Input
                  id="speediance-workout-name"
                  value={draft.name}
                  maxLength={100}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="rounded-lg border p-4">
                <Label>
                  {t('speedianceManager.library', 'Exercise library')}
                </Label>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={searchTerm}
                    placeholder={t(
                      'speedianceManager.searchPlaceholder',
                      'Search Speediance exercises'
                    )}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && searchTerm.trim()) {
                        search.mutate({ query: searchTerm.trim() });
                      }
                    }}
                  />
                  <Button
                    type="button"
                    onClick={() => search.mutate({ query: searchTerm.trim() })}
                    disabled={!searchTerm.trim() || search.isPending}
                  >
                    {search.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {compatibleResults.length > 0 && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {compatibleResults.map((exercise) => (
                      <Button
                        key={exercise.groupId}
                        type="button"
                        variant="outline"
                        className="h-auto justify-start py-2 text-left"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            exercises: [
                              ...current.exercises,
                              exerciseFromSearch(exercise),
                            ],
                          }))
                        }
                      >
                        <Plus className="mr-2 h-4 w-4 shrink-0" />
                        <span>
                          <span className="block">{exercise.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {[
                              exercise.primaryMuscle,
                              ...exercise.accessoryNames,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {draft.exercises.map((exercise, exerciseIndex) => (
                  <div
                    key={`${exercise.groupId}-${exerciseIndex}`}
                    className="rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {exercise.expectedTitle}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[
                            exercise.primaryMuscle,
                            ...(exercise.accessoryNames ?? []),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            exercises: moveItem(
                              current.exercises,
                              exerciseIndex,
                              exerciseIndex - 1
                            ),
                          }))
                        }
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            exercises: moveItem(
                              current.exercises,
                              exerciseIndex,
                              exerciseIndex + 1
                            ),
                          }))
                        }
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      {exercise.presetId !== 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => addWarmup(exerciseIndex)}
                        >
                          <Flame className="mr-2 h-4 w-4" />
                          {t('speedianceManager.addWarmup', 'Add warm-up')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            exercises: current.exercises.filter(
                              (_item, index) => index !== exerciseIndex
                            ),
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <div>
                        <Label>{t('speedianceManager.preset', 'Preset')}</Label>
                        <Select
                          value={String(exercise.presetId)}
                          onValueChange={(value) =>
                            updateExercise(exerciseIndex, (current) => ({
                              ...current,
                              presetId: Number(
                                value
                              ) as SpeedianceTemplatePreset,
                              sets: current.sets.map((set) => ({
                                ...set,
                                setType:
                                  Number(value) === 0 ? 'warmup' : 'working',
                              })),
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PRESET_OPTIONS.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={String(option.value)}
                              >
                                {t(
                                  `speedianceManager.${option.key}`,
                                  option.fallback
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>
                          {t(
                            'speedianceManager.completionUnit',
                            'Completion target'
                          )}
                        </Label>
                        <Select
                          value={exercise.completionUnit ?? 'repetitions'}
                          onValueChange={(value: SpeedianceCompletionUnit) =>
                            updateExercise(exerciseIndex, (current) => ({
                              ...current,
                              completionUnit: value,
                              sets: current.sets.map((set) =>
                                setCompletionUnit(set, value)
                              ),
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="repetitions">
                              {t(
                                'speedianceManager.repetitions',
                                'Repetitions'
                              )}
                            </SelectItem>
                            <SelectItem value="seconds">
                              {t('speedianceManager.seconds', 'Seconds')}
                            </SelectItem>
                            <SelectItem value="calories">
                              {t('speedianceManager.calories', 'Calories')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {exercise.sets.map((set, setIndex) => (
                        <div
                          key={setIndex}
                          className="grid items-end gap-2 rounded-md bg-muted/40 p-2 md:grid-cols-[60px_1fr_1fr_1fr_1fr_40px]"
                        >
                          <div>
                            <Label className="text-xs">#</Label>
                            <div className="h-9 py-2 text-center text-sm">
                              {setIndex + 1}
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">
                              {(exercise.completionUnit ?? 'repetitions') ===
                              'seconds'
                                ? t(
                                    'speedianceManager.durationSeconds',
                                    'Duration (s)'
                                  )
                                : exercise.completionUnit === 'calories'
                                  ? t(
                                      'speedianceManager.calorieTarget',
                                      'Calories (kcal)'
                                    )
                                  : t('speedianceManager.reps', 'Reps')}
                            </Label>
                            <Input
                              type="number"
                              min={1}
                              max={
                                exercise.completionUnit === 'seconds'
                                  ? 7200
                                  : exercise.completionUnit === 'calories'
                                    ? 5000
                                    : 99
                              }
                              value={
                                exercise.completionUnit === 'seconds'
                                  ? (set.durationSeconds ?? set.repetitions)
                                  : exercise.completionUnit === 'calories'
                                    ? (set.calorieTarget ?? set.repetitions)
                                    : set.repetitions
                              }
                              onChange={(event) =>
                                updateSet(
                                  exerciseIndex,
                                  setIndex,
                                  (current) => {
                                    const value = numberInput(
                                      event.target.value,
                                      1
                                    );
                                    if (exercise.completionUnit === 'seconds') {
                                      return {
                                        ...current,
                                        repetitions: value,
                                        durationSeconds: value,
                                      };
                                    }
                                    if (
                                      exercise.completionUnit === 'calories'
                                    ) {
                                      return {
                                        ...current,
                                        repetitions: value,
                                        calorieTarget: value,
                                      };
                                    }
                                    return {
                                      ...current,
                                      repetitions: value,
                                    };
                                  }
                                )
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-xs">
                              {exercise.dataStatType === 6
                                ? t(
                                    'speedianceManager.vitaLevel',
                                    'Vita level (1–10)'
                                  )
                                : exercise.presetId === -1
                                  ? t('speedianceManager.weight', 'Weight (kg)')
                                  : t(
                                      'speedianceManager.targetRm',
                                      'Target RM'
                                    )}
                            </Label>
                            <Input
                              type="number"
                              min={
                                exercise.dataStatType === 6
                                  ? 1
                                  : exercise.presetId === -1
                                    ? 0
                                    : 1
                              }
                              max={exercise.dataStatType === 6 ? 10 : undefined}
                              step={
                                exercise.dataStatType === 6
                                  ? 1
                                  : exercise.presetId === -1
                                    ? 0.5
                                    : 1
                              }
                              value={
                                exercise.dataStatType === 6
                                  ? (set.level ?? 5)
                                  : exercise.presetId === -1
                                    ? (set.weightKg ?? 3.5)
                                    : set.targetRm
                              }
                              onChange={(event) =>
                                updateSet(exerciseIndex, setIndex, (current) =>
                                  exercise.dataStatType === 6
                                    ? {
                                        ...current,
                                        level: numberInput(
                                          event.target.value,
                                          5
                                        ),
                                      }
                                    : exercise.presetId === -1
                                      ? {
                                          ...current,
                                          weightKg: numberInput(
                                            event.target.value,
                                            3.5
                                          ),
                                        }
                                      : {
                                          ...current,
                                          targetRm: numberInput(
                                            event.target.value,
                                            12
                                          ),
                                        }
                                )
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-xs">
                              {t('speedianceManager.rest', 'Rest (s)')}
                            </Label>
                            <Input
                              type="number"
                              min={0}
                              max={300}
                              value={set.restSeconds}
                              onChange={(event) =>
                                updateSet(
                                  exerciseIndex,
                                  setIndex,
                                  (current) => ({
                                    ...current,
                                    restSeconds: numberInput(
                                      event.target.value,
                                      0
                                    ),
                                  })
                                )
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-xs">
                              {t('speedianceManager.mode', 'Mode')}
                            </Label>
                            <Select
                              value={set.mode}
                              onValueChange={(
                                value: SpeedianceWorkoutSet['mode']
                              ) =>
                                updateSet(
                                  exerciseIndex,
                                  setIndex,
                                  (current) => ({
                                    ...current,
                                    mode: value,
                                  })
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="standard">
                                  {t('speedianceManager.standard', 'Standard')}
                                </SelectItem>
                                <SelectItem value="chains">
                                  {t('speedianceManager.chains', 'Chains')}
                                </SelectItem>
                                <SelectItem value="eccentric">
                                  {t(
                                    'speedianceManager.eccentric',
                                    'Eccentric'
                                  )}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            disabled={exercise.sets.length === 1}
                            onClick={() =>
                              updateExercise(exerciseIndex, (current) => ({
                                ...current,
                                sets: current.sets.filter(
                                  (_item, index) => index !== setIndex
                                ),
                              }))
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateExercise(exerciseIndex, (current) => ({
                            ...current,
                            sets: [
                              ...current.sets,
                              defaultSet(
                                current.presetId === 0 ? 'warmup' : 'working',
                                current.completionUnit,
                                current.dataStatType === 6
                              ),
                            ],
                          }))
                        }
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        {t('speedianceManager.addSet', 'Add set')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                save.isPending ||
                detailLoader.isPending ||
                !draft.name.trim() ||
                draft.exercises.length === 0
              }
            >
              {save.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t('speedianceManager.save', 'Save and sync')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={Boolean(deletingWorkout)}
        onOpenChange={(open) => {
          if (!open) setDeletingWorkout(null);
        }}
        title={t('speedianceManager.deleteTitle', 'Delete Speediance workout?')}
        description={t('speedianceManager.deleteDescription', {
          name: deletingWorkout?.name ?? '',
          defaultValue:
            '“{{name}}” will be deleted from Speediance. Its native Sparky preset is preserved for history and offline training.',
        })}
        warning={t(
          'speedianceManager.deleteWarning',
          'This changes the remote workout identity and cannot be undone automatically.'
        )}
        variant="destructive"
        confirmLabel={t('common.delete', 'Delete')}
        onConfirm={async () => {
          if (!deletingWorkout) return;
          try {
            await removeWorkout.mutateAsync({
              id: deletingWorkout.id,
              code: deletingWorkout.code,
              name: deletingWorkout.name,
            });
            toast({
              title: t('common.success', 'Success'),
              description: t(
                'speedianceManager.deleted',
                'Remote workout deleted; the Sparky preset was preserved.'
              ),
            });
            setDeletingWorkout(null);
          } catch {
            // The verified server error is shown globally.
          }
        }}
      />
    </Card>
  );
}
