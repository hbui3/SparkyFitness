import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkoutFeedbackCard from '../../src/components/WorkoutFeedbackCard';
import {
  fetchWorkoutSessionFeedback,
  saveWorkoutSessionFeedback,
} from '../../src/services/api/workoutCoachingApi';

jest.mock('../../src/services/api/workoutCoachingApi', () => ({
  fetchWorkoutSessionFeedback: jest.fn(),
  saveWorkoutSessionFeedback: jest.fn(),
}));
jest.mock('../../src/services/LogService', () => ({ addLog: jest.fn() }));
jest.mock('uniwind', () => ({
  useCSSVariable: (keys: string | string[]) =>
    Array.isArray(keys) ? keys.map(() => '#111827') : '#111827',
}));
jest.mock('../../src/components/Icon', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: () => <View /> };
});

const mockFetch = fetchWorkoutSessionFeedback as jest.MockedFunction<
  typeof fetchWorkoutSessionFeedback
>;
const mockSave = saveWorkoutSessionFeedback as jest.MockedFunction<
  typeof saveWorkoutSessionFeedback
>;

const empty = {
  exercise_preset_entry_id: 'session-1',
  session: null,
  exercises: [],
};

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkoutFeedbackCard
        presetEntryId="session-1"
        exercises={[
          { id: 'e1', name: 'Bench Press' },
          { id: 'e2', name: 'Row' },
        ]}
      />
    </QueryClientProvider>
  );
}

describe('WorkoutFeedbackCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue(empty);
    mockSave.mockImplementation(async (_id, request) => ({
      ...empty,
      session: request.session
        ? {
            difficulty: request.session.difficulty,
            pain: request.session.pain,
            pain_note: request.session.pain_note ?? null,
            updated_at: 'now',
          }
        : null,
    }));
  });

  it('saves the session rating as soon as it is picked', async () => {
    const screen = renderCard();
    await waitFor(() =>
      expect(screen.getByText('How did it feel?')).toBeTruthy()
    );
    await act(async () => {
      fireEvent.press(screen.getByText('Too hard'));
    });
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith('session-1', {
        session: { difficulty: 'too_hard', pain: false, pain_note: null },
        exercises: [],
      })
    );
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
  });

  it('records pain on the exercises named', async () => {
    const screen = renderCard();
    await waitFor(() =>
      expect(screen.getByText('How did it feel?')).toBeTruthy()
    );
    await act(async () => {
      fireEvent(
        screen.getByLabelText('Any pain or discomfort?'),
        'valueChange',
        true
      );
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Bench Press'));
    });
    await waitFor(() =>
      expect(mockSave).toHaveBeenLastCalledWith('session-1', {
        session: { difficulty: null, pain: true, pain_note: null },
        exercises: [
          {
            exercise_entry_id: 'e1',
            difficulty: null,
            pain: true,
            pain_note: null,
          },
        ],
      })
    );
    expect(
      screen.getByText(/Suggestions for these exercises get lighter/)
    ).toBeTruthy();
  });

  it('shows existing feedback and offers a retry when saving fails', async () => {
    mockFetch.mockResolvedValue({
      ...empty,
      session: {
        difficulty: 'too_easy',
        pain: false,
        pain_note: null,
        updated_at: 'x',
      },
    });
    mockSave.mockRejectedValueOnce(new Error('offline'));
    const screen = renderCard();
    await waitFor(() =>
      expect(
        screen.getByText('Too easy').parent?.parent?.props.accessibilityState
      ).toEqual({ selected: true })
    );
    await act(async () => {
      fireEvent.press(screen.getByText('Just right'));
    });
    await waitFor(() =>
      expect(
        screen.getByText("Couldn't save your feedback. Tap to retry.")
      ).toBeTruthy()
    );
  });

  it('shows a retry instead of an editable form when loading fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const screen = renderCard();
    await waitFor(() =>
      expect(
        screen.getByText("Couldn't load your feedback. Tap to try again.")
      ).toBeTruthy()
    );
    expect(screen.queryByText('Too hard')).toBeNull();
    mockFetch.mockResolvedValueOnce(empty);
    await act(async () => {
      fireEvent.press(
        screen.getByText("Couldn't load your feedback. Tap to try again.")
      );
    });
    await waitFor(() =>
      expect(screen.getByText('How did it feel?')).toBeTruthy()
    );
    expect(mockSave).not.toHaveBeenCalled();
  });
});
