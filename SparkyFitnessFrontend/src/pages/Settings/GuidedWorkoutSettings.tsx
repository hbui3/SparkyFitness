import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2 } from 'lucide-react';
import {
  GUIDED_COUNTDOWN_MAX_SEC,
  GUIDED_COUNTDOWN_MIN_SEC,
  GUIDED_SPEECH_RATE_MAX,
  GUIDED_SPEECH_RATE_MIN,
  GUIDED_SPEECH_RATE_STEP,
} from '@workspace/shared';
import { AccordionContent, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  useWorkoutCoachingSettings,
  useUpdateWorkoutCoachingSettings,
} from '@/hooks/Exercises/useWorkoutCoaching';
import {
  setGuidedWorkoutPreferences,
  useGuidedWorkoutPreferences,
} from '@/utils/guidedWorkoutPreferences';
import { speakGuided } from '@/utils/guidedWorkoutSpeech';
import {
  isSpeechSynthesisSupported,
  subscribeToSpeechVoices,
} from '@/utils/speechNarrator';

/** Select value for "use the browser default voice". */
const DEFAULT_VOICE = 'default';

const RATE_OPTIONS: number[] = [];
for (
  let rate = GUIDED_SPEECH_RATE_MIN;
  rate <= GUIDED_SPEECH_RATE_MAX + 1e-9;
  rate += GUIDED_SPEECH_RATE_STEP
) {
  RATE_OPTIONS.push(Math.round(rate * 100) / 100);
}

const COUNTDOWN_OPTIONS: number[] = [];
for (
  let sec = GUIDED_COUNTDOWN_MIN_SEC;
  sec <= GUIDED_COUNTDOWN_MAX_SEC;
  sec++
) {
  COUNTDOWN_OPTIONS.push(sec);
}

/**
 * Settings → Guided workouts (#1507) and adaptive suggestions (#1560).
 * Guided-workout preferences are stored in this browser only (installed
 * voices differ per browser and device); the adaptive-suggestions switch is
 * an account setting shared with the mobile app.
 */
export const GuidedWorkoutSettings = () => {
  const { t, i18n } = useTranslation();
  const prefs = useGuidedWorkoutPreferences();
  const { data: coachingSettings, isLoading: coachingLoading } =
    useWorkoutCoachingSettings();
  const { mutate: updateCoachingSettings, isPending: isUpdatingCoaching } =
    useUpdateWorkoutCoachingSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const supported = isSpeechSynthesisSupported();

  useEffect(() => {
    if (!prefs.enabled) return;
    return subscribeToSpeechVoices(setVoices);
  }, [prefs.enabled]);

  // Offer the voices for the app language first; there can be hundreds.
  const shownVoices = useMemo(() => {
    const lang = i18n.language.split('-')[0]?.toLowerCase() ?? '';
    const matching = voices.filter((v) =>
      v.lang.toLowerCase().startsWith(lang)
    );
    return matching.length > 0 ? matching : voices;
  }, [voices, i18n.language]);

  return (
    <>
      <AccordionTrigger
        className="flex items-center gap-2 p-4 hover:no-underline"
        description={t(
          'guidedWorkout.settings.description',
          'Spoken cues, countdowns and automatic set changes in the workout player'
        )}
      >
        <Volume2 className="h-5 w-5" />
        {t('guidedWorkout.settings.section', 'Guided workouts')}
      </AccordionTrigger>
      <AccordionContent className="p-4 pt-0 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="guided-workout-enabled">
              {t('guidedWorkout.settings.enabled', 'Guided mode')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t(
                'guidedWorkout.settings.enabledSubtitleWeb',
                'Speaks each exercise and its target, counts you in, runs timed sets on their own, and moves to the next set. Saved in this browser only.'
              )}
            </p>
          </div>
          <Switch
            id="guided-workout-enabled"
            checked={prefs.enabled}
            onCheckedChange={(checked) =>
              setGuidedWorkoutPreferences({ enabled: checked })
            }
          />
        </div>

        {prefs.enabled && !supported && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {t(
              'guidedWorkout.settings.unsupported',
              'This browser cannot speak. The guided view still works, without narration.'
            )}
          </p>
        )}

        {prefs.enabled && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="guided-workout-voice">
                {t('guidedWorkout.settings.voice', 'Voice')}
              </Label>
              <Select
                value={prefs.voiceURI ?? DEFAULT_VOICE}
                onValueChange={(value) =>
                  setGuidedWorkoutPreferences({
                    voiceURI: value === DEFAULT_VOICE ? null : value,
                  })
                }
              >
                <SelectTrigger id="guided-workout-voice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_VOICE}>
                    {t(
                      'guidedWorkout.settings.voiceDefaultWeb',
                      'Browser default'
                    )}
                  </SelectItem>
                  {shownVoices.map((voice) => (
                    <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} ({voice.lang})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="guided-workout-rate">
                {t('guidedWorkout.settings.rate', 'Speech rate')}
              </Label>
              <Select
                value={String(prefs.rate)}
                onValueChange={(value) =>
                  setGuidedWorkoutPreferences({ rate: Number(value) })
                }
              >
                <SelectTrigger id="guided-workout-rate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RATE_OPTIONS.map((rate) => (
                    <SelectItem key={rate} value={String(rate)}>
                      {t('guidedWorkout.settings.rateValue', {
                        defaultValue: '{{rate}}×',
                        rate,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="guided-workout-countdown">
                {t('guidedWorkout.settings.countdown', 'Get-ready countdown')}
              </Label>
              <Select
                value={String(prefs.countdownSec)}
                onValueChange={(value) =>
                  setGuidedWorkoutPreferences({ countdownSec: Number(value) })
                }
              >
                <SelectTrigger id="guided-workout-countdown">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTDOWN_OPTIONS.map((sec) => (
                    <SelectItem key={sec} value={String(sec)}>
                      {t('guidedWorkout.settings.countdownValue', {
                        defaultValue: '{{count}} s',
                        count: sec,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t(
                  'guidedWorkout.settings.countdownSubtitle',
                  'Before the first exercise and before each timed set.'
                )}
              </p>
            </div>
          </div>
        )}

        {prefs.enabled && supported && (
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              speakGuided(
                [
                  t(
                    'guidedWorkout.settings.sample',
                    'This is how your guided workouts will sound.'
                  ),
                ],
                { interrupt: true, lang: i18n.language }
              )
            }
          >
            {t('guidedWorkout.settings.test', 'Test voice')}
          </Button>
        )}

        <div className="flex items-start justify-between gap-4 pt-4 border-t">
          <div className="space-y-1">
            <Label htmlFor="adaptive-coaching-enabled">
              {t(
                'workoutCoaching.settingsTitle',
                'Adaptive workout suggestions'
              )}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t(
                'workoutCoaching.settingsSubtitle',
                'Adapts upcoming sets and exercise suggestions based on your logged session feedback (difficulty, pain flags).'
              )}
            </p>
          </div>
          <Switch
            id="adaptive-coaching-enabled"
            checked={coachingSettings?.adaptive_suggestions ?? true}
            disabled={coachingLoading || isUpdatingCoaching}
            onCheckedChange={(checked) =>
              updateCoachingSettings({ adaptive_suggestions: checked })
            }
          />
        </div>
      </AccordionContent>
    </>
  );
};
