import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BrainCircuit,
  Check,
  Dumbbell,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import type {
  AdaptiveTrainingReason,
  AdaptiveTrainingSettingsResponse,
} from '@workspace/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import MuscleBodyMap from '@/components/ExerciseCharts/MuscleBodyMap';
import {
  useAdaptiveTrainingDashboard,
  useAdaptiveTrainingWorkoutPreset,
  useRegenerateAdaptiveTraining,
  useUpdateAdaptiveTrainingSettings,
  useUpdateAdaptiveTrainingStatus,
} from '@/hooks/Exercises/useAdaptiveTraining';
import { createWorkoutPlaybackRouteState } from '@/utils/workoutPlayback';
import { toast } from '@/hooks/use-toast';

interface AdaptiveTrainingDashboardProps {
  userId?: string;
}

function reasonText(
  reason: AdaptiveTrainingReason,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const muscles = reason.muscles.join(', ');
  switch (reason.code) {
    case 'muscles_ready':
      return t('adaptiveTraining.reason.musclesReady', {
        defaultValue: 'Target muscles are well recovered ({{value}}/100).',
        value: reason.value ?? 0,
      });
    case 'preferred_muscles':
      return t('adaptiveTraining.reason.preferredMuscles', {
        defaultValue: 'Matches your priority muscles: {{muscles}}.',
        muscles,
      });
    case 'within_duration':
      return t('adaptiveTraining.reason.withinDuration', {
        defaultValue: 'Fits your time limit at about {{value}} minutes.',
        value: reason.value ?? 0,
      });
    case 'weekly_target_reached':
      return t('adaptiveTraining.reason.weeklyTargetReached', {
        defaultValue:
          'Your weekly target of {{value}} strength sessions is reached.',
        value: reason.value ?? 0,
      });
    case 'trained_yesterday':
      return t(
        'adaptiveTraining.reason.trainedYesterday',
        'You trained strength yesterday.'
      );
    case 'low_readiness':
      return t('adaptiveTraining.reason.lowReadiness', {
        defaultValue: 'Recovery readiness is low today ({{value}}/100).',
        value: reason.value ?? 0,
      });
    case 'poor_sleep':
      return t('adaptiveTraining.reason.poorSleep', {
        defaultValue: 'Sleep was short at {{value}} hours.',
        value: reason.value ?? 0,
      });
    case 'no_eligible_presets':
      return t(
        'adaptiveTraining.reason.noEligiblePresets',
        'No eligible workout template is configured.'
      );
    case 'insufficient_muscle_data':
      return t(
        'adaptiveTraining.reason.insufficientMuscleData',
        'The workout template has no muscle assignments yet.'
      );
    case 'adaptive_disabled':
      return t(
        'adaptiveTraining.reason.disabled',
        'Adaptive workout planning is disabled.'
      );
  }
}

function loadColor(score: number): string {
  if (score >= 80) return '[&>div]:bg-rose-600';
  if (score >= 55) return '[&>div]:bg-orange-500';
  if (score >= 30) return '[&>div]:bg-yellow-400';
  return '[&>div]:bg-emerald-500';
}

export default function AdaptiveTrainingDashboard({
  userId,
}: AdaptiveTrainingDashboardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, isLoading, isError } = useAdaptiveTrainingDashboard(userId);
  const updateSettings = useUpdateAdaptiveTrainingSettings(userId, data?.date);
  const regenerate = useRegenerateAdaptiveTraining(userId, data?.date);
  const updateStatus = useUpdateAdaptiveTrainingStatus(userId, data?.date);
  const workoutPreset = useAdaptiveTrainingWorkoutPreset();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<AdaptiveTrainingSettingsResponse | null>(
    null
  );
  const [preferredMusclesText, setPreferredMusclesText] = useState('');
  const topLoads = useMemo(() => data?.muscleLoad.slice(0, 8) ?? [], [data]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t('adaptiveTraining.loading', 'Calculating adaptive training...')}
        </CardContent>
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          {t(
            'adaptiveTraining.loadError',
            'Adaptive training could not be loaded.'
          )}
        </CardContent>
      </Card>
    );
  }

  const recommendation = data.recommendation;
  const editableSettings = draft ?? data.settings;
  const saveSettings = async () => {
    await updateSettings.mutateAsync({
      ...editableSettings,
      preferredMuscles: preferredMusclesText
        .split(',')
        .map((muscle) => muscle.trim().toLowerCase())
        .filter(Boolean),
    });
    setSettingsOpen(false);
    toast({
      title: t('common.success', 'Success'),
      description: t(
        'adaptiveTraining.settingsSaved',
        'Adaptive training settings saved.'
      ),
    });
  };

  const startWorkout = async () => {
    if (recommendation.presetId === null) return;
    const preset = await workoutPreset.mutateAsync(recommendation.presetId);
    await updateStatus.mutateAsync('accepted');
    navigate(`/workout-playback?date=${data.date}`, {
      state: createWorkoutPlaybackRouteState(
        preset,
        data.date,
        `${location.pathname}${location.search}`
      ),
    });
  };

  return (
    <Card className="overflow-hidden border-primary/20">
      <CardHeader className="border-b bg-primary/[0.03]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-primary" />
              {t('adaptiveTraining.title', 'Adaptive Training')}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                'adaptiveTraining.subtitle',
                'Recovery-aware planning based on canonical workouts, sleep and readiness.'
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${regenerate.isPending ? 'animate-spin' : ''}`}
              />
              {t('adaptiveTraining.recalculate', 'Recalculate')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(data.settings);
                setPreferredMusclesText(
                  data.settings.preferredMuscles.join(', ')
                );
                setSettingsOpen(true);
              }}
            >
              <Settings2 className="mr-2 h-4 w-4" />
              {t('adaptiveTraining.settings', 'Settings')}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(260px,0.8fr)_minmax(320px,1.2fr)]">
          <MuscleBodyMap variant="load" muscleLoad={data.muscleLoad} />
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Badge
                    variant={
                      recommendation.kind === 'workout'
                        ? 'default'
                        : 'secondary'
                    }
                  >
                    {recommendation.kind === 'workout'
                      ? t('adaptiveTraining.workoutDay', 'Workout day')
                      : t('adaptiveTraining.recoveryDay', 'Recovery day')}
                  </Badge>
                  <h3 className="mt-3 text-xl font-semibold">
                    {recommendation.presetName ??
                      t('adaptiveTraining.activeRecovery', 'Active recovery')}
                  </h3>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold">
                    {recommendation.score}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('adaptiveTraining.fitScore', 'fit score / 100')}
                  </div>
                </div>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {recommendation.rationale.map((reason, index) => (
                  <li key={`${reason.code}-${index}`} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {reasonText(reason, t)}
                  </li>
                ))}
              </ul>
              {recommendation.kind === 'workout' && (
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    onClick={startWorkout}
                    disabled={updateStatus.isPending}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    {t('adaptiveTraining.startWorkout', 'Start workout')}
                  </Button>
                  {recommendation.volumeFactor < 1 && (
                    <Badge variant="outline" className="self-center">
                      {t('adaptiveTraining.reducedVolume', {
                        defaultValue: 'Reduced volume: {{percent}}%',
                        percent: Math.round(recommendation.volumeFactor * 100),
                      })}
                    </Badge>
                  )}
                </div>
              )}
              {data.availablePresets.length === 0 && (
                <Button
                  className="mt-5"
                  variant="outline"
                  onClick={() => navigate('/exercises')}
                >
                  <Dumbbell className="mr-2 h-4 w-4" />
                  {t(
                    'adaptiveTraining.createPresets',
                    'Create workout templates'
                  )}
                </Button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <Metric
                label={t('adaptiveTraining.readiness', 'Readiness')}
                value={`${data.readiness.score}/100`}
              />
              <Metric
                label={t('adaptiveTraining.sleep', 'Sleep')}
                value={
                  data.readiness.sleepHours === null
                    ? '–'
                    : `${data.readiness.sleepHours} h`
                }
              />
              <Metric
                label={t('adaptiveTraining.weeklyPlan', 'Weekly plan')}
                value={`${data.settings.sessionsPerWeek}×`}
              />
            </div>
          </div>
        </div>

        <div>
          <h3 className="mb-3 font-semibold">
            {t('adaptiveTraining.muscleLoad', 'Muscle load')}
          </h3>
          {topLoads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'adaptiveTraining.noMuscleLoad',
                'No recent strength load found. Your muscles are treated as ready.'
              )}
            </p>
          ) : (
            <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
              {topLoads.map((item) => (
                <div key={item.muscle}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="capitalize">{item.muscle}</span>
                    <span className="text-muted-foreground">
                      {item.loadScore}/100
                    </span>
                  </div>
                  <Progress
                    value={item.loadScore}
                    className={`h-2 ${loadColor(item.loadScore)}`}
                  />
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.lastTrainedOn ?? '–'} ·{' '}
                    {item.sources.join(', ') ||
                      t('adaptiveTraining.unknown', 'Unknown')}
                  </div>
                </div>
              ))}
            </div>
          )}
          {data.hiddenDuplicateWorkouts > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              {t('adaptiveTraining.duplicatesHidden', {
                defaultValue:
                  '{{count}} mirrored workout entries were excluded from this calculation.',
                count: data.hiddenDuplicateWorkouts,
              })}
            </p>
          )}
        </div>
      </CardContent>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t(
                'adaptiveTraining.settingsTitle',
                'Adaptive training settings'
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                'adaptiveTraining.settingsDescription',
                'Choose your weekly frequency, time limit and eligible workout templates.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <SettingSwitch
              label={t('adaptiveTraining.enabled', 'Enable adaptive training')}
              checked={editableSettings.enabled}
              onCheckedChange={(enabled) =>
                setDraft({ ...editableSettings, enabled })
              }
            />
            <SettingSwitch
              label={t(
                'adaptiveTraining.avoidConsecutive',
                'Avoid consecutive strength days'
              )}
              checked={editableSettings.avoidConsecutiveTrainingDays}
              onCheckedChange={(avoidConsecutiveTrainingDays) =>
                setDraft({
                  ...editableSettings,
                  avoidConsecutiveTrainingDays,
                })
              }
            />
            <SliderSetting
              label={t(
                'adaptiveTraining.sessionsPerWeek',
                'Strength sessions per week'
              )}
              value={editableSettings.sessionsPerWeek}
              min={1}
              max={7}
              step={1}
              suffix="×"
              onChange={(sessionsPerWeek) =>
                setDraft({ ...editableSettings, sessionsPerWeek })
              }
            />
            <SliderSetting
              label={t(
                'adaptiveTraining.maxDuration',
                'Maximum workout duration'
              )}
              value={editableSettings.maxDurationMinutes}
              min={15}
              max={120}
              step={5}
              suffix=" min"
              onChange={(maxDurationMinutes) =>
                setDraft({ ...editableSettings, maxDurationMinutes })
              }
            />
            <SliderSetting
              label={t(
                'adaptiveTraining.recoveryWindow',
                'Muscle recovery window'
              )}
              value={editableSettings.recoveryWindowHours}
              min={24}
              max={168}
              step={24}
              suffix=" h"
              onChange={(recoveryWindowHours) =>
                setDraft({ ...editableSettings, recoveryWindowHours })
              }
            />
            <div className="space-y-2">
              <Label htmlFor="adaptive-priority-muscles">
                {t(
                  'adaptiveTraining.priorityMuscles',
                  'Priority muscles (optional)'
                )}
              </Label>
              <Input
                id="adaptive-priority-muscles"
                value={preferredMusclesText}
                onChange={(event) =>
                  setPreferredMusclesText(event.target.value)
                }
                placeholder="back, chest, quadriceps"
              />
            </div>
            <div className="space-y-3">
              <Label>
                {t(
                  'adaptiveTraining.eligiblePresets',
                  'Eligible workout templates'
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t(
                  'adaptiveTraining.allPresetsHint',
                  'If none are selected, all of your templates are eligible.'
                )}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.availablePresets.length === 0 && (
                  <p className="text-sm text-muted-foreground sm:col-span-2">
                    {t(
                      'adaptiveTraining.noPresets',
                      'Create at least one workout template in Exercises so the planner can choose a session.'
                    )}
                  </p>
                )}
                {data.availablePresets.map((preset) => {
                  const checked =
                    editableSettings.candidateWorkoutPresetIds.includes(
                      preset.id
                    );
                  return (
                    <label
                      key={preset.id}
                      className="flex cursor-pointer gap-3 rounded-lg border p-3"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          setDraft({
                            ...editableSettings,
                            candidateWorkoutPresetIds: value
                              ? [
                                  ...editableSettings.candidateWorkoutPresetIds,
                                  preset.id,
                                ]
                              : editableSettings.candidateWorkoutPresetIds.filter(
                                  (id) => id !== preset.id
                                ),
                          })
                        }
                      />
                      <span>
                        <span className="block text-sm font-medium">
                          {preset.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {preset.estimatedDurationMinutes} min ·{' '}
                          {preset.exerciseCount}{' '}
                          {t('adaptiveTraining.exercises', 'exercises')}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={saveSettings} disabled={updateSettings.isPending}>
              {updateSettings.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t('common.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function SettingSwitch({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function SliderSetting({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-sm font-semibold">
          {value}
          {suffix}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => next !== undefined && onChange(next)}
      />
    </div>
  );
}
