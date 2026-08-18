import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CoachDietaryPattern,
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
  useUpdateCoachProfile,
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

  const initialProfile = data ?? EMPTY_PROFILE;
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

        <div className="grid gap-4 md:grid-cols-2">
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
