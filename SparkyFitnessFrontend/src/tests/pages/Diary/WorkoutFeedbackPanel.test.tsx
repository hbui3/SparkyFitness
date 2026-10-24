import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkoutFeedbackPanel from '@/pages/Diary/WorkoutFeedbackPanel';
import {
  getWorkoutSessionFeedback,
  saveWorkoutSessionFeedback,
} from '@/api/Exercises/workoutCoaching';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);
jest.mock('@/api/Exercises/workoutCoaching', () => ({
  getWorkoutSessionFeedback: jest.fn(),
  saveWorkoutSessionFeedback: jest.fn(),
}));

const mockGet = getWorkoutSessionFeedback as jest.MockedFunction<
  typeof getWorkoutSessionFeedback
>;
const mockSave = saveWorkoutSessionFeedback as jest.MockedFunction<
  typeof saveWorkoutSessionFeedback
>;
const empty = { exercise_preset_entry_id: 's1', session: null, exercises: [] };

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkoutFeedbackPanel
        presetEntryId="s1"
        exercises={[
          { id: 'e1', name: 'Bench Press' },
          { id: 'e2', name: 'Row' },
        ]}
      />
    </QueryClientProvider>
  );
}

describe('WorkoutFeedbackPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue(empty);
    mockSave.mockResolvedValue(empty);
  });

  it('saves the session rating immediately', async () => {
    renderPanel();
    await screen.findByText('How did it feel?');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Too easy' }));
    });
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith('s1', {
        session: { difficulty: 'too_easy', pain: false, pain_note: null },
        exercises: [],
      })
    );
  });

  it('records pain on the chosen exercise', async () => {
    renderPanel();
    await screen.findByText('How did it feel?');
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Row' }));
    });
    await waitFor(() =>
      expect(mockSave).toHaveBeenLastCalledWith('s1', {
        session: { difficulty: null, pain: true, pain_note: null },
        exercises: [
          {
            exercise_entry_id: 'e2',
            difficulty: null,
            pain: true,
            pain_note: null,
          },
        ],
      })
    );
  });

  it('rates a single exercise', async () => {
    renderPanel();
    await screen.findByText('How did it feel?');
    fireEvent.click(screen.getByRole('button', { name: 'Rate each exercise' }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Bench Press: Too hard' })
      );
    });
    await waitFor(() =>
      expect(mockSave).toHaveBeenLastCalledWith('s1', {
        session: null,
        exercises: [
          {
            exercise_entry_id: 'e1',
            difficulty: 'too_hard',
            pain: false,
            pain_note: null,
          },
        ],
      })
    );
  });

  it('shows a retry instead of the form when loading fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('offline'));
    renderPanel();
    expect(
      await screen.findByText(/Couldn't load your feedback/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Too easy' })).toBeNull();
    mockGet.mockResolvedValueOnce(empty);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(await screen.findByText('How did it feel?')).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });
});
