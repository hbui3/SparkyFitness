import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExercisePresetEntryDisplay from '@/pages/Diary/ExercisePresetEntryDisplay';
import type { ExerciseEntry, PresetSessionEntry } from '@/types/exercises';

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    weightUnit: 'kg',
    distanceUnit: 'km',
    convertDistance: (value: number) => value,
    timeFormat: 'HH:mm',
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const makeExercise = (
  id: string,
  name: string,
  durationMinutes: number,
  caloriesBurned: number
): ExerciseEntry =>
  ({
    id,
    exercise_id: `exercise-${id}`,
    exercise_preset_entry_id: 'preset-entry-1',
    entry_date: '2026-08-20',
    entry_time: '21:39',
    duration_minutes: durationMinutes,
    calories_burned: caloriesBurned,
    distance: null,
    avg_heart_rate: null,
    notes: '',
    image_url: null,
    sets: [
      {
        id: Number(id),
        set_number: 1,
        set_type: 'Working Set',
        reps: 10,
        weight: 40,
        duration: null,
        distance: null,
        rest_time: null,
        notes: null,
        rpe: null,
        completed_at: null,
        is_pr: false,
      },
    ],
    activity_details: [],
    exercise_snapshot: {
      id: `exercise-${id}`,
      name,
      category: 'strength',
      modality: 'weight_reps',
    },
  }) as unknown as ExerciseEntry;

const renderPreset = (source: string) => {
  const preset = {
    type: 'preset',
    id: 'preset-entry-1',
    entry_date: '2026-08-20',
    workout_preset_id: 25,
    name: 'Speediance Session',
    description: null,
    notes: null,
    source,
    total_duration_minutes: 54,
    exercises: [
      makeExercise('1', 'Barbell Bench Press', 54, 353),
      makeExercise('2', 'Barbell Squat', 0, 0),
    ],
    activity_details: [],
  } as PresetSessionEntry;

  return render(
    <ExercisePresetEntryDisplay
      presetEntry={preset}
      currentUserId="user-1"
      handleDelete={jest.fn()}
      handleDeleteExerciseEntry={jest.fn()}
      handleEdit={jest.fn()}
      handleEditExerciseDatabase={jest.fn()}
      setExerciseToPlay={jest.fn()}
      setIsPlaybackModalOpen={jest.fn()}
      energyUnit="kcal"
      convertEnergy={(value) => value}
      getEnergyUnitString={() => 'kcal'}
    />
  );
};

describe('ExercisePresetEntryDisplay Speediance metrics', () => {
  it('keeps totals in the session header and hides them from child exercises', () => {
    renderPreset('Speediance');

    expect(screen.getByText('54m')).toBeInTheDocument();
    expect(screen.getByText('353')).toBeInTheDocument();
    expect(screen.getAllByText('21:39')).toHaveLength(1);

    fireEvent.click(
      screen.getByRole('button', { name: /Speediance Session/i })
    );

    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.queryByText('353 kcal')).not.toBeInTheDocument();
    expect(screen.getAllByText('21:39')).toHaveLength(1);
    expect(screen.getAllByText('1 sets')).toHaveLength(2);
  });

  it('continues to show child metrics for non-Speediance grouped sessions', () => {
    renderPreset('manual');

    fireEvent.click(
      screen.getByRole('button', { name: /Speediance Session/i })
    );

    expect(screen.getByText('353 kcal')).toBeInTheDocument();
    expect(screen.getAllByText('21:39')).toHaveLength(3);
  });
});
