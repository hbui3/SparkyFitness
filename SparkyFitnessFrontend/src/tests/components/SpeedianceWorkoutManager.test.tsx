import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import SpeedianceWorkoutManager from '@/pages/Exercises/SpeedianceWorkoutManager';

const mockSaveWorkout = jest.fn().mockResolvedValue({ success: true });
const mockWorkoutDetail = {
  id: '501',
  code: 'sparky-code',
  name: 'Sparky Full Body A',
  exerciseCount: 1,
  nativeWorkoutPresetId: 44,
  exercises: [
    {
      groupId: '116',
      variantId: '2927',
      expectedTitle: 'Barbell Bench Press',
      category: 'Upper Body',
      primaryMuscle: 'Chest',
      accessoryNames: ['Barbell'],
      dataStatType: 0,
      presetId: 1,
      completionUnit: 'repetitions',
      sets: [
        {
          repetitions: 10,
          targetRm: 12,
          setType: 'working',
          mode: 'standard',
          restSeconds: 90,
        },
      ],
    },
  ],
};
const mockLoadWorkout = jest.fn();

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('@/hooks/Exercises/useSpeedianceWorkoutManager', () => ({
  useSpeedianceWorkouts: () => ({
    data: {
      workouts: [
        {
          id: '501',
          code: 'sparky-code',
          name: 'Sparky Full Body A',
          exerciseCount: 7,
          nativeWorkoutPresetId: 44,
        },
      ],
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  }),
  useLoadSpeedianceWorkout: () => ({
    isPending: false,
    mutate: mockLoadWorkout,
  }),
  useSearchSpeedianceExercises: () => ({
    data: undefined,
    isPending: false,
    mutate: jest.fn(),
    reset: jest.fn(),
  }),
  useSaveSpeedianceWorkout: () => ({
    isPending: false,
    mutateAsync: mockSaveWorkout,
  }),
  useSetSpeedianceReservation: () => ({
    isPending: false,
    mutateAsync: jest.fn(),
  }),
  useDeleteSpeedianceWorkout: () => ({
    isPending: false,
    mutateAsync: jest.fn(),
  }),
}));

describe('SpeedianceWorkoutManager', () => {
  beforeEach(() => {
    mockSaveWorkout.mockClear();
    mockLoadWorkout
      .mockReset()
      .mockImplementation(
        (
          _input: { code: string },
          options: { onSuccess: (detail: typeof mockWorkoutDetail) => void }
        ) => options.onSuccess(mockWorkoutDetail)
      );
  });

  it('ignores a late detail response after the user cancels and starts a new workout', () => {
    mockLoadWorkout.mockImplementation(() => undefined);
    render(<SpeedianceWorkoutManager />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    const callbacks = mockLoadWorkout.mock.calls[0]?.[1] as {
      onSuccess: (detail: typeof mockWorkoutDetail) => void;
    };
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    fireEvent.click(screen.getByRole('button', { name: /new workout/i }));
    const name = screen.getByRole('textbox', { name: /workout name/i });
    fireEvent.change(name, { target: { value: 'My new workout' } });

    act(() => callbacks.onSuccess(mockWorkoutDetail));

    expect(name).toHaveValue('My new workout');
    expect(
      screen.queryByRole('button', { name: /add warm-up/i })
    ).not.toBeInTheDocument();
  });

  it('shows remote workouts and their native Sparky linkage', () => {
    render(<SpeedianceWorkoutManager />);

    expect(screen.getByText('Speediance Workout Manager')).toBeInTheDocument();
    expect(screen.getByText('Sparky Full Body A')).toBeInTheDocument();
    expect(screen.getByText('7 exercises')).toBeInTheDocument();
    expect(screen.getByText('Linked to Sparky')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /schedule/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /edit/i })).toBeEnabled();
  });

  it('adds a separate warm-up block and saves the complete remote definition', async () => {
    render(<SpeedianceWorkoutManager />);

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.click(
      await screen.findByRole('button', { name: /add warm-up/i })
    );
    fireEvent.click(screen.getByRole('button', { name: /save and sync/i }));

    await waitFor(() => expect(mockSaveWorkout).toHaveBeenCalledTimes(1));
    expect(mockSaveWorkout).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteId: '501',
        remoteCode: 'sparky-code',
        name: 'Sparky Full Body A',
        exercises: [
          expect.objectContaining({
            expectedTitle: 'Barbell Bench Press',
            presetId: 0,
            sets: expect.arrayContaining([
              expect.objectContaining({ setType: 'warmup' }),
            ]),
          }),
          expect.objectContaining({
            expectedTitle: 'Barbell Bench Press',
            presetId: 1,
            sets: expect.arrayContaining([
              expect.objectContaining({ setType: 'working' }),
            ]),
          }),
        ],
      })
    );
  });
});
