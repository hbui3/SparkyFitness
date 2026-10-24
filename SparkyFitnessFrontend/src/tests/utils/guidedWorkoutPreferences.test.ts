import { act, renderHook } from '@testing-library/react';
import {
  DEFAULT_GUIDED_WORKOUT_PREFERENCES,
  __resetGuidedWorkoutPreferencesForTests,
  getGuidedWorkoutPreferences,
  setGuidedWorkoutPreferences,
  useGuidedWorkoutPreferences,
} from '@/utils/guidedWorkoutPreferences';

const KEY = 'sparky.guidedWorkoutPreferences.v1';

describe('guidedWorkoutPreferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetGuidedWorkoutPreferencesForTests();
  });

  it('is off by default', () => {
    expect(getGuidedWorkoutPreferences()).toEqual(
      DEFAULT_GUIDED_WORKOUT_PREFERENCES
    );
    expect(getGuidedWorkoutPreferences().enabled).toBe(false);
  });

  it('persists changes to localStorage', () => {
    setGuidedWorkoutPreferences({ enabled: true, voiceURI: 'v1' });
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}')).toMatchObject({
      enabled: true,
      voiceURI: 'v1',
    });
    __resetGuidedWorkoutPreferencesForTests();
    expect(getGuidedWorkoutPreferences().voiceURI).toBe('v1');
  });

  it('clamps rate and countdown into range', () => {
    setGuidedWorkoutPreferences({ rate: 9, countdownSec: 1 });
    expect(getGuidedWorkoutPreferences()).toMatchObject({
      rate: 2,
      countdownSec: 3,
    });
  });

  it('falls back to defaults for corrupt storage', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(getGuidedWorkoutPreferences()).toEqual(
      DEFAULT_GUIDED_WORKOUT_PREFERENCES
    );
  });

  it('re-renders subscribers on change', () => {
    const { result } = renderHook(() => useGuidedWorkoutPreferences());
    expect(result.current.enabled).toBe(false);
    act(() => setGuidedWorkoutPreferences({ enabled: true }));
    expect(result.current.enabled).toBe(true);
  });
});
