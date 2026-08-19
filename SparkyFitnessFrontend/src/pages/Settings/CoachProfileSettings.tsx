import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CoachDietaryPattern,
  CoachMemoryResponse,
  ProactiveCoachCategory,
  CoachProfileResponse,
  UpdateCoachProfileRequest,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  useCoachProfile,
  useCoachMemories,
  useCreateCoachMemory,
  useDeleteCoachMemory,
  useCoachTelegram,
  useCreateCoachTelegramLink,
  useDisconnectCoachTelegram,
  useUpdateCoachProfile,
  useUpdateCoachMemory,
} from '@/hooks/Settings/useCoachProfile';

const EMPTY_PROFILE: CoachProfileResponse = {
  enabled: true,
  dietaryPattern: 'omnivore',
  primaryGoal: null,
  calorieTarget: null,
  proteinTargetG: null,
  waterTargetMl: null,
  excludedIngredients: [],
  preferredIngredients: [],
  dislikedIngredients: [],
  routines: [],
  coachingNotes: null,
  adaptiveCheckInsEnabled: false,
  adaptiveStartTime: '07:00',
  adaptiveEndTime: '20:00',
  adaptiveIntervalMinutes: 120,
  proactiveCategories: ['nutrition', 'hydration', 'training', 'recovery'],
  memoryEnabled: true,
  autoMemoryEnabled: false,
  dailyCheckInEnabled: false,
  dailyCheckInTime: '20:00',
  weeklyReviewEnabled: false,
  weeklyReviewDay: 0,
  weeklyReviewTime: '18:00',
  updatedAt: null,
};

const DIETARY_PATTERNS: CoachDietaryPattern[] = [
  'omnivore',
  'vegetarian',
  'vegan',
  'pescatarian',
  'other',
];

function listToText(values: string[]): string {
  return values.join(', ');
}

function textToList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function primaryGoalLabel(value: string | null): string {
  if (!value) return '';
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function CoachProfileSettings() {
  const { t } = useTranslation();
  const { data, isLoading } = useCoachProfile();

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('settings.coachProfile.loading', 'Loading coach profile…')}
      </p>
    );
  }

  // Keep the settings usable during rolling updates if an older server or a
  // cached response does not yet contain newly added optional controls.
  const initialProfile: CoachProfileResponse = { ...EMPTY_PROFILE, ...data };
  return (
    <CoachProfileForm
      key={initialProfile.updatedAt ?? 'unsaved'}
      initialProfile={initialProfile}
    />
  );
}

function CoachProfileForm({
  initialProfile,
}: {
  initialProfile: CoachProfileResponse;
}) {
  const { t } = useTranslation();
  const updateProfile = useUpdateCoachProfile();
  const [form, setForm] = useState<CoachProfileResponse>(initialProfile);
  const toggleCategory = (
    category: ProactiveCoachCategory,
    enabled: boolean
  ) => {
    const next = enabled
      ? [...new Set([...form.proactiveCategories, category])]
      : form.proactiveCategories.filter((item) => item !== category);
    if (next.length > 0) setForm({ ...form, proactiveCategories: next });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const payload: UpdateCoachProfileRequest = {
      enabled: form.enabled,
      dietaryPattern: form.dietaryPattern,
      excludedIngredients: form.excludedIngredients,
      preferredIngredients: form.preferredIngredients,
      dislikedIngredients: form.dislikedIngredients,
      routines: form.routines,
      coachingNotes: form.coachingNotes,
      adaptiveCheckInsEnabled: form.adaptiveCheckInsEnabled,
      adaptiveStartTime: form.adaptiveStartTime,
      adaptiveEndTime: form.adaptiveEndTime,
      adaptiveIntervalMinutes: form.adaptiveIntervalMinutes,
      proactiveCategories: form.proactiveCategories,
      memoryEnabled: form.memoryEnabled,
      autoMemoryEnabled: form.autoMemoryEnabled,
      dailyCheckInEnabled: form.dailyCheckInEnabled,
      dailyCheckInTime: form.dailyCheckInTime,
      weeklyReviewEnabled: form.weeklyReviewEnabled,
      weeklyReviewDay: form.weeklyReviewDay,
      weeklyReviewTime: form.weeklyReviewTime,
    };
    updateProfile.mutate(payload);
  };

  return (
    <form className="space-y-6" onSubmit={submit}>
      <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-4">
        <div className="space-y-1">
          <Label htmlFor="coach-enabled" className="text-base">
            {t('settings.coachProfile.enabled', 'Use persistent coach profile')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t(
              'settings.coachProfile.enabledDescription',
              'Automatically gives the AI coach these goals and preferences in every conversation.'
            )}
          </p>
        </div>
        <Switch
          id="coach-enabled"
          checked={form.enabled}
          onCheckedChange={(enabled) => setForm({ ...form, enabled })}
        />
      </div>

      <CoachLongTermMemorySection
        memoryEnabled={form.memoryEnabled}
        autoMemoryEnabled={form.autoMemoryEnabled}
        onMemoryEnabledChange={(memoryEnabled) =>
          setForm({ ...form, memoryEnabled })
        }
        onAutoMemoryEnabledChange={(autoMemoryEnabled) =>
          setForm({ ...form, autoMemoryEnabled })
        }
        isSaving={updateProfile.isPending}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="dietary-pattern">
            {t('settings.coachProfile.dietaryPattern', 'Dietary pattern')}
          </Label>
          <Select
            value={form.dietaryPattern}
            onValueChange={(value) =>
              setForm({
                ...form,
                dietaryPattern: value as CoachDietaryPattern,
              })
            }
          >
            <SelectTrigger id="dietary-pattern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIETARY_PATTERNS.map((pattern) => (
                <SelectItem key={pattern} value={pattern}>
                  {t(`settings.coachProfile.patterns.${pattern}`, pattern)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="primary-goal">
            {t('settings.coachProfile.primaryGoal', 'Primary goal')}
          </Label>
          <Input
            id="primary-goal"
            value={primaryGoalLabel(form.primaryGoal)}
            readOnly
            placeholder={t(
              'settings.coachProfile.primaryGoalPlaceholder',
              'Not set during onboarding'
            )}
          />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="calorie-target">
            {t('settings.coachProfile.calorieTarget', 'Calories / day')}
          </Label>
          <Input
            id="calorie-target"
            type="number"
            min={500}
            max={10000}
            value={form.calorieTarget ?? ''}
            readOnly
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="protein-target">
            {t('settings.coachProfile.proteinTarget', 'Protein (g) / day')}
          </Label>
          <Input
            id="protein-target"
            type="number"
            min={0}
            max={500}
            value={form.proteinTargetG ?? ''}
            readOnly
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="water-target">
            {t('settings.coachProfile.waterTarget', 'Water (ml) / day')}
          </Label>
          <Input
            id="water-target"
            type="number"
            min={0}
            max={15000}
            value={form.waterTargetMl ?? ''}
            readOnly
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t(
          'settings.coachProfile.inheritedGoalsDescription',
          'Primary goal is inherited from onboarding. Calories, protein, and water are inherited from the active dated Goals entry and automatically stay in sync.'
        )}
      </p>

      <div className="grid gap-5 md:grid-cols-2">
        <ListField
          id="excluded-ingredients"
          label={t(
            'settings.coachProfile.excludedIngredients',
            'Hard ingredient exclusions'
          )}
          description={t(
            'settings.coachProfile.excludedDescription',
            'The meal validator blocks these ingredients.'
          )}
          value={form.excludedIngredients}
          onChange={(excludedIngredients) =>
            setForm({ ...form, excludedIngredients })
          }
        />
        <ListField
          id="preferred-ingredients"
          label={t(
            'settings.coachProfile.preferredIngredients',
            'Preferred ingredients'
          )}
          description={t(
            'settings.coachProfile.preferredDescription',
            'The coach should favor these when practical.'
          )}
          value={form.preferredIngredients}
          onChange={(preferredIngredients) =>
            setForm({ ...form, preferredIngredients })
          }
        />
        <ListField
          id="disliked-ingredients"
          label={t(
            'settings.coachProfile.dislikedIngredients',
            'Disliked ingredients'
          )}
          description={t(
            'settings.coachProfile.dislikedDescription',
            'Soft preference: avoid these when alternatives fit.'
          )}
          value={form.dislikedIngredients}
          onChange={(dislikedIngredients) =>
            setForm({ ...form, dislikedIngredients })
          }
        />
        <ListField
          id="routines"
          label={t('settings.coachProfile.routines', 'Routines')}
          description={t(
            'settings.coachProfile.routinesDescription',
            'Comma-separated habits or schedule constraints.'
          )}
          value={form.routines}
          onChange={(routines) => setForm({ ...form, routines })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="coaching-notes">
          {t('settings.coachProfile.coachingNotes', 'Coaching notes')}
        </Label>
        <Textarea
          id="coaching-notes"
          rows={4}
          value={form.coachingNotes ?? ''}
          onChange={(event) =>
            setForm({ ...form, coachingNotes: event.target.value || null })
          }
          placeholder={t(
            'settings.coachProfile.coachingNotesPlaceholder',
            'Tone, recurring schedule, budget, cooking time, or other stable context…'
          )}
        />
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <div>
          <h3 className="font-medium">
            {t(
              'settings.coachProfile.proactiveTitle',
              'Proactive coach messages'
            )}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t(
              'settings.coachProfile.proactiveDescription',
              'Sparky writes scheduled summaries into your private chat using your local timezone.'
            )}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-3 rounded-md bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="adaptive-check-ins-enabled">
                  {t(
                    'settings.coachProfile.adaptiveCheckIns',
                    'Adaptive check-ins'
                  )}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'settings.coachProfile.adaptiveCheckInsDescription',
                    'Every two hours from 07:00 to 20:00, Sparky checks today’s live values and only sends the next relevant action.'
                  )}
                </p>
              </div>
              <Switch
                id="adaptive-check-ins-enabled"
                checked={form.adaptiveCheckInsEnabled}
                onCheckedChange={(adaptiveCheckInsEnabled) =>
                  setForm({ ...form, adaptiveCheckInsEnabled })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="adaptive-start-time">
                  {t('settings.coachProfile.adaptiveStart', 'Start')}
                </Label>
                <Input
                  id="adaptive-start-time"
                  type="time"
                  value={form.adaptiveStartTime}
                  disabled={!form.adaptiveCheckInsEnabled}
                  onChange={(event) =>
                    setForm({ ...form, adaptiveStartTime: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="adaptive-end-time">
                  {t('settings.coachProfile.adaptiveEnd', 'End')}
                </Label>
                <Input
                  id="adaptive-end-time"
                  type="time"
                  value={form.adaptiveEndTime}
                  disabled={!form.adaptiveCheckInsEnabled}
                  onChange={(event) =>
                    setForm({ ...form, adaptiveEndTime: event.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="adaptive-interval">
                {t(
                  'settings.coachProfile.adaptiveInterval',
                  'Interval (minutes)'
                )}
              </Label>
              <Input
                id="adaptive-interval"
                type="number"
                min={30}
                max={360}
                step={30}
                value={form.adaptiveIntervalMinutes}
                disabled={!form.adaptiveCheckInsEnabled}
                onChange={(event) =>
                  setForm({
                    ...form,
                    adaptiveIntervalMinutes: Number(event.target.value),
                  })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {(
                [
                  ['nutrition', 'Nutrition'],
                  ['hydration', 'Hydration'],
                  ['training', 'Training'],
                  ['recovery', 'Recovery'],
                ] as const
              ).map(([category, label]) => (
                <label key={category} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.proactiveCategories.includes(category)}
                    disabled={!form.adaptiveCheckInsEnabled}
                    onChange={(event) =>
                      toggleCategory(category, event.target.checked)
                    }
                  />
                  {t(
                    `settings.coachProfile.proactiveCategories.${category}`,
                    label
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-md bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="daily-check-in-enabled">
                  {t('settings.coachProfile.dailyCheckIn', 'Daily check-in')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'settings.coachProfile.dailyCheckInDescription',
                    'Today’s calories, protein, water, and a concrete next step.'
                  )}
                </p>
              </div>
              <Switch
                id="daily-check-in-enabled"
                checked={form.dailyCheckInEnabled}
                onCheckedChange={(dailyCheckInEnabled) =>
                  setForm({ ...form, dailyCheckInEnabled })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="daily-check-in-time">
                {t('settings.coachProfile.deliveryTime', 'Delivery time')}
              </Label>
              <Input
                id="daily-check-in-time"
                type="time"
                value={form.dailyCheckInTime}
                disabled={!form.dailyCheckInEnabled}
                onChange={(event) =>
                  setForm({ ...form, dailyCheckInTime: event.target.value })
                }
              />
            </div>
          </div>

          <div className="space-y-3 rounded-md bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="weekly-review-enabled">
                  {t('settings.coachProfile.weeklyReview', 'Weekly review')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'settings.coachProfile.weeklyReviewDescription',
                    'Seven-day adherence plus your 30-day weight and nutrition trend.'
                  )}
                </p>
              </div>
              <Switch
                id="weekly-review-enabled"
                checked={form.weeklyReviewEnabled}
                onCheckedChange={(weeklyReviewEnabled) =>
                  setForm({ ...form, weeklyReviewEnabled })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="weekly-review-day">
                  {t('settings.coachProfile.deliveryDay', 'Day')}
                </Label>
                <Select
                  value={String(form.weeklyReviewDay)}
                  disabled={!form.weeklyReviewEnabled}
                  onValueChange={(value) =>
                    setForm({ ...form, weeklyReviewDay: Number(value) })
                  }
                >
                  <SelectTrigger id="weekly-review-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      'Sunday',
                      'Monday',
                      'Tuesday',
                      'Wednesday',
                      'Thursday',
                      'Friday',
                      'Saturday',
                    ].map((day, index) => (
                      <SelectItem key={day} value={String(index)}>
                        {t(
                          `settings.coachProfile.weekdays.${day.toLowerCase()}`,
                          day
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="weekly-review-time">
                  {t('settings.coachProfile.deliveryTime', 'Delivery time')}
                </Label>
                <Input
                  id="weekly-review-time"
                  type="time"
                  value={form.weeklyReviewTime}
                  disabled={!form.weeklyReviewEnabled}
                  onChange={(event) =>
                    setForm({ ...form, weeklyReviewTime: event.target.value })
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <CoachTelegramSettings />

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {t(
            'settings.coachProfile.privacy',
            'Private to your account and never shared through family access.'
          )}
        </p>
        <Button type="submit" disabled={updateProfile.isPending}>
          {updateProfile.isPending
            ? t('settings.coachProfile.saving', 'Saving…')
            : t('settings.coachProfile.save', 'Save coach profile')}
        </Button>
      </div>
    </form>
  );
}

function CoachLongTermMemorySection({
  memoryEnabled,
  autoMemoryEnabled,
  onMemoryEnabledChange,
  onAutoMemoryEnabledChange,
  isSaving,
}: {
  memoryEnabled: boolean;
  autoMemoryEnabled: boolean;
  onMemoryEnabledChange: (enabled: boolean) => void;
  onAutoMemoryEnabledChange: (enabled: boolean) => void;
  isSaving: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">
            {t('settings.coachProfile.memoryTitle', 'Long-term coach memory')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t(
              'settings.coachProfile.memoryDescription',
              'Active memories are private and automatically included in every Web and Telegram coach conversation.'
            )}
          </p>
        </div>
        <Switch
          id="memory-enabled"
          checked={memoryEnabled}
          onCheckedChange={onMemoryEnabledChange}
        />
      </div>
      <div className="flex items-start justify-between gap-4 rounded-md bg-muted/30 p-3">
        <div>
          <Label htmlFor="auto-memory-enabled">
            {t(
              'settings.coachProfile.autoMemory',
              'Automatically learn stable facts'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t(
              'settings.coachProfile.autoMemoryDescription',
              'When enabled, the coach remembers future-relevant preferences, routines, constraints, goals, and achievements. Daily totals, secrets, and speculative diagnoses are never saved.'
            )}
          </p>
        </div>
        <Switch
          id="auto-memory-enabled"
          checked={autoMemoryEnabled}
          disabled={!memoryEnabled}
          onCheckedChange={onAutoMemoryEnabledChange}
        />
      </div>
      <CoachMemorySettings enabled={memoryEnabled} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t(
            'settings.coachProfile.memorySaveNotice',
            'Changes to the two switches take effect after saving.'
          )}
        </p>
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving
            ? t('settings.coachProfile.saving', 'Saving…')
            : t('settings.coachProfile.memorySave', 'Save memory settings')}
        </Button>
      </div>
    </div>
  );
}

function CoachMemorySettings({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const { data: memories = [], isLoading } = useCoachMemories();
  const createMemory = useCreateCoachMemory();
  const updateMemory = useUpdateCoachMemory();
  const deleteMemory = useDeleteCoachMemory();
  const [category, setCategory] =
    useState<CoachMemoryResponse['category']>('preference');
  const [content, setContent] = useState('');

  const addMemory = () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    createMemory.mutate(
      { category, content: trimmed, pinned: false },
      { onSuccess: () => setContent('') }
    );
  };

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('settings.coachProfile.memoryLoading', 'Loading memories…')}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">
          {t('settings.coachProfile.memorySaved', 'Saved memories')}:{' '}
          {memories.length}
        </span>
        <span className="text-muted-foreground">
          {t(
            'settings.coachProfile.memoryHowTo',
            'You can also tell the coach: “Remember that …”'
          )}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
        <Select
          value={category}
          disabled={!enabled}
          onValueChange={(value) =>
            setCategory(value as CoachMemoryResponse['category'])
          }
        >
          <SelectTrigger
            aria-label={t(
              'settings.coachProfile.memoryCategory',
              'Memory category'
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              'preference',
              'routine',
              'constraint',
              'injury',
              'goal',
              'achievement',
              'context',
            ].map((value) => (
              <SelectItem key={value} value={value}>
                {t(`settings.coachProfile.memoryCategories.${value}`, value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={content}
          maxLength={500}
          disabled={!enabled}
          placeholder={t(
            'settings.coachProfile.memoryPlaceholder',
            'e.g. I train on Tuesdays and Thursdays'
          )}
          onChange={(event) => setContent(event.target.value)}
        />
        <Button
          type="button"
          disabled={!enabled || !content.trim() || createMemory.isPending}
          onClick={addMemory}
        >
          {t('settings.coachProfile.memoryAdd', 'Remember')}
        </Button>
      </div>
      {memories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(
            'settings.coachProfile.memoryEmpty',
            'No additional memories saved yet.'
          )}
        </p>
      ) : (
        <div className="space-y-2">
          {memories.map((memory) => (
            <div
              key={memory.id}
              className="flex flex-wrap items-center gap-2 rounded-md border p-3"
            >
              <span className="rounded bg-muted px-2 py-1 text-xs">
                {memory.category}
              </span>
              <span
                className={`min-w-0 flex-1 text-sm ${memory.active ? '' : 'line-through opacity-60'}`}
              >
                {memory.content}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  updateMemory.mutate({
                    id: memory.id,
                    memory: { pinned: !memory.pinned },
                  })
                }
              >
                {memory.pinned
                  ? t('settings.coachProfile.memoryUnpin', 'Unpin')
                  : t('settings.coachProfile.memoryPin', 'Pin')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  updateMemory.mutate({
                    id: memory.id,
                    memory: { active: !memory.active },
                  })
                }
              >
                {memory.active
                  ? t('settings.coachProfile.memoryPause', 'Pause')
                  : t('settings.coachProfile.memoryActivate', 'Activate')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => deleteMemory.mutate(memory.id)}
              >
                {t('settings.coachProfile.memoryDelete', 'Delete')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CoachTelegramSettings() {
  const { t } = useTranslation();
  const { data: telegram, isLoading } = useCoachTelegram();
  const createLink = useCreateCoachTelegramLink();
  const disconnect = useDisconnectCoachTelegram();

  const connect = async () => {
    const link = await createLink.mutateAsync();
    window.location.assign(link.url);
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="font-medium">
          {t('settings.coachProfile.telegramTitle', 'Telegram coach chat')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(
            'settings.coachProfile.telegramDescription',
            'Connect a private Telegram chat to receive proactive coach messages and reply in the same Sparky chat history.'
          )}
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          {t(
            'settings.coachProfile.telegramLoading',
            'Loading Telegram connection…'
          )}
        </p>
      ) : !telegram?.available ? (
        <p className="text-sm text-muted-foreground">
          {t(
            'settings.coachProfile.telegramUnavailable',
            'Telegram is not configured on this SparkyFitness server yet.'
          )}
        </p>
      ) : telegram.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/30 p-4">
          <div>
            <p className="text-sm font-medium">
              {t('settings.coachProfile.telegramConnected', 'Connected')}
            </p>
            <p className="text-xs text-muted-foreground">
              {telegram.telegramUsername
                ? `@${telegram.telegramUsername}`
                : t(
                    'settings.coachProfile.telegramPrivateChat',
                    'Private Telegram chat'
                  )}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate()}
          >
            {t('settings.coachProfile.telegramDisconnect', 'Disconnect')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">
            {telegram.botUsername
              ? t(
                  'settings.coachProfile.telegramBotReady',
                  'The bot @{{username}} is ready to connect.',
                  { username: telegram.botUsername }
                )
              : t(
                  'settings.coachProfile.telegramReady',
                  'The Telegram bot is ready to connect.'
                )}
          </p>
          <Button
            type="button"
            disabled={createLink.isPending}
            onClick={() => void connect()}
          >
            {createLink.isPending
              ? t('settings.coachProfile.telegramOpening', 'Opening Telegram…')
              : t('settings.coachProfile.telegramConnect', 'Connect Telegram')}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t(
          'settings.coachProfile.telegramPrivacy',
          'Telegram receives the messages delivered through the bot. SparkyFitness keeps the complete conversation private to your account.'
        )}
      </p>
    </div>
  );
}

function ListField({
  id,
  label,
  description,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => listToText(value));
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(textToList(event.target.value));
        }}
        placeholder={t(
          'settings.coachProfile.commaSeparatedPlaceholder',
          'comma, separated, values'
        )}
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
