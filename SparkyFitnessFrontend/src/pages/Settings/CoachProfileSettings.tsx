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

function optionalNumber(value: string): number | null {
  return value === '' ? null : Number(value);
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
    const { updatedAt: _updatedAt, ...payload } = form;
    updateProfile.mutate(payload satisfies UpdateCoachProfileRequest);
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
            value={form.primaryGoal ?? ''}
            onChange={(event) =>
              setForm({ ...form, primaryGoal: event.target.value || null })
            }
            placeholder={t(
              'settings.coachProfile.primaryGoalPlaceholder',
              'e.g. Build strength while maintaining weight'
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
            onChange={(event) =>
              setForm({
                ...form,
                calorieTarget: optionalNumber(event.target.value),
              })
            }
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
            onChange={(event) =>
              setForm({
                ...form,
                proteinTargetG: optionalNumber(event.target.value),
              })
            }
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
            onChange={(event) =>
              setForm({
                ...form,
                waterTargetMl: optionalNumber(event.target.value),
              })
            }
          />
        </div>
      </div>

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
