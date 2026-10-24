import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorkoutPlaybackIntervalHud from '@/pages/Diary/WorkoutPlaybackIntervalHud';
import type { WorkoutPlaybackExerciseDraft } from '@/utils/workoutPlayback';
import {
  __resetGuidedWorkoutPreferencesForTests,
  setGuidedWorkoutPreferences,
} from '@/utils/guidedWorkoutPreferences';
import { speakGuided } from '@/utils/guidedWorkoutSpeech';
import { playIntervalCue } from '@/utils/workoutSounds';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);
jest.mock('@/utils/guidedWorkoutSpeech', () => ({
  ...jest.requireActual('@/utils/guidedWorkoutSpeech'),
  speakGuided: jest.fn(),
  stopGuidedSpeech: jest.fn(),
}));
jest.mock('@/utils/workoutSounds', () => ({
  playIntervalCue: jest.fn(),
}));

const mockSpeak = speakGuided as jest.MockedFunction<typeof speakGuided>;
const mockCue = playIntervalCue as jest.MockedFunction<typeof playIntervalCue>;

const START = new Date('2026-09-25T10:00:00Z').getTime();

const exercises = ['Burpee', 'Squat'].map((name) => ({
  exercise_id: name,
  exercise_name: name,
  modality: 'reps_only',
  notes: null,
  image_url: `${name.toLowerCase()}.gif`,
  sets: [
    {
      set_number: 1,
      reps: null,
      duration: 20,
      rest_time: 10,
      completed: false,
      completed_at: null,
    },
  ],
})) as unknown as WorkoutPlaybackExerciseDraft[];

function renderHud() {
  return render(
    <WorkoutPlaybackIntervalHud
      workoutFormat="tabata"
      startedAtIso={new Date(START).toISOString()}
      roundsCompleted={0}
      repsCompleted={0}
      status="rx"
      exercises={exercises}
      onAddRound={jest.fn()}
      onDecrementRound={jest.fn()}
      onSetReps={jest.fn()}
      onSetStatus={jest.fn()}
    />
  );
}

describe('WorkoutPlaybackIntervalHud in guided mode', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    __resetGuidedWorkoutPreferencesForTests();
    mockSpeak.mockClear();
    mockCue.mockClear();
  });

  afterEach(() => jest.useRealTimers());

  it('keeps today’s HUD with guided mode off', () => {
    jest.setSystemTime(START + 1000);
    renderHud();
    expect(mockCue).toHaveBeenCalledWith('work');
    expect(mockSpeak).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('interval-guided-step')
    ).not.toBeInTheDocument();
  });

  it('names the exercise over the work chime and shows it', () => {
    setGuidedWorkoutPreferences({ enabled: true });
    jest.setSystemTime(START + 1000);
    renderHud();
    expect(mockCue).toHaveBeenCalledWith('work');
    expect(mockSpeak).toHaveBeenCalledWith(['Burpee. 20 seconds.'], {
      interrupt: true,
      lang: 'en',
    });
    expect(screen.getByText('Burpee')).toBeInTheDocument();
    expect(screen.getByAltText('Burpee')).toBeInTheDocument();
  });

  it('announces rest and the next exercise', () => {
    setGuidedWorkoutPreferences({ enabled: true });
    jest.setSystemTime(START + 19_500);
    renderHud();
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockCue).toHaveBeenCalledWith('rest');
    expect(mockSpeak).toHaveBeenLastCalledWith(['Rest.', 'Next: Squat.'], {
      interrupt: true,
      lang: 'en',
    });
    expect(screen.getByText('Next up')).toBeInTheDocument();
    expect(screen.getByText('Squat')).toBeInTheDocument();
  });
});
