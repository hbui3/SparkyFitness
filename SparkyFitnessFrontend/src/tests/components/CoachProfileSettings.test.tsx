import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CoachProfileSettings from '@/pages/Settings/CoachProfileSettings';
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

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timeFormat: 'HH:mm' }),
}));

jest.mock('@/hooks/Settings/useCoachProfile', () => ({
  useCoachProfile: jest.fn(),
  useCoachMemories: jest.fn(),
  useCreateCoachMemory: jest.fn(),
  useDeleteCoachMemory: jest.fn(),
  useCoachTelegram: jest.fn(),
  useCreateCoachTelegramLink: jest.fn(),
  useDisconnectCoachTelegram: jest.fn(),
  useUpdateCoachProfile: jest.fn(),
  useUpdateCoachMemory: jest.fn(),
}));

const mutate = jest.fn();
const createMemoryMutate = jest.fn();

describe('CoachProfileSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useCoachProfile).mockReturnValue({
      data: {
        enabled: true,
        dietaryPattern: 'vegetarian',
        primaryGoal: 'Build strength',
        calorieTarget: 2200,
        proteinTargetG: 140,
        waterTargetMl: 2500,
        excludedIngredients: ['tofu'],
        preferredIngredients: ['lentils'],
        dislikedIngredients: ['olives'],
        routines: ['meal prep sunday'],
        coachingNotes: 'Keep weekday recipes short.',
        adaptiveCheckInsEnabled: true,
        adaptiveStartTime: '07:00',
        adaptiveEndTime: '20:00',
        adaptiveIntervalMinutes: 120,
        proactiveCategories: ['nutrition', 'hydration', 'training', 'recovery'],
        memoryEnabled: true,
        autoMemoryEnabled: false,
        dailyCheckInEnabled: true,
        dailyCheckInTime: '20:00',
        weeklyReviewEnabled: true,
        weeklyReviewDay: 0,
        weeklyReviewTime: '18:00',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
      isLoading: false,
    } as ReturnType<typeof useCoachProfile>);
    jest.mocked(useUpdateCoachProfile).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateCoachProfile>);
    jest.mocked(useCoachMemories).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useCoachMemories>);
    jest.mocked(useCreateCoachMemory).mockReturnValue({
      mutate: createMemoryMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateCoachMemory>);
    jest.mocked(useUpdateCoachMemory).mockReturnValue({
      mutate: jest.fn(),
    } as unknown as ReturnType<typeof useUpdateCoachMemory>);
    jest.mocked(useDeleteCoachMemory).mockReturnValue({
      mutate: jest.fn(),
    } as unknown as ReturnType<typeof useDeleteCoachMemory>);
    jest.mocked(useCoachTelegram).mockReturnValue({
      data: {
        available: false,
        connected: false,
        botUsername: null,
        telegramUsername: null,
      },
      isLoading: false,
    } as ReturnType<typeof useCoachTelegram>);
    jest.mocked(useCreateCoachTelegramLink).mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useCreateCoachTelegramLink>);
    jest.mocked(useDisconnectCoachTelegram).mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useDisconnectCoachTelegram>);
  });

  it('renders inherited goals and saves only coach-owned settings', () => {
    render(<CoachProfileSettings />);

    expect(screen.getByDisplayValue('Build strength')).toBeInTheDocument();
    expect(screen.getByDisplayValue('tofu')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2200')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save coach profile' }));

    expect(mutate).toHaveBeenCalledWith(
      {
        enabled: true,
        dietaryPattern: 'vegetarian',
        excludedIngredients: ['tofu'],
        preferredIngredients: ['lentils'],
        dislikedIngredients: ['olives'],
        routines: ['meal prep sunday'],
        coachingNotes: 'Keep weekday recipes short.',
        adaptiveCheckInsEnabled: true,
        adaptiveStartTime: '07:00',
        adaptiveEndTime: '20:00',
        adaptiveIntervalMinutes: 120,
        proactiveCategories: ['nutrition', 'hydration', 'training', 'recovery'],
        memoryEnabled: true,
        autoMemoryEnabled: false,
        dailyCheckInEnabled: true,
        dailyCheckInTime: '20:00',
        weeklyReviewEnabled: true,
        weeklyReviewDay: 0,
        weeklyReviewTime: '18:00',
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('lets the owner add a private long-term memory', () => {
    render(<CoachProfileSettings />);

    fireEvent.change(
      screen.getByPlaceholderText('e.g. I train on Tuesdays and Thursdays'),
      { target: { value: 'I train Tuesdays and Thursdays' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remember' }));

    expect(createMemoryMutate).toHaveBeenCalledWith(
      {
        category: 'preference',
        content: 'I train Tuesdays and Thursdays',
        pinned: false,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('makes long-term memory status and automatic learning visible', () => {
    render(<CoachProfileSettings />);

    expect(screen.getByText('Long-term coach memory')).toBeInTheDocument();
    expect(screen.getByText('Saved memories: 0')).toBeInTheDocument();
    expect(
      screen.getByText('Automatically learn stable facts')
    ).toBeInTheDocument();
    expect(
      screen.getByText('You can also tell the coach: “Remember that …”')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Automatically learn stable facts',
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Save memory settings' })
    );

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ memoryEnabled: true, autoMemoryEnabled: true }),
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('blocks editing when the saved profile could not be loaded and offers retry', () => {
    const refetch = jest.fn();
    jest.mocked(useCoachProfile).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useCoachProfile>);

    render(<CoachProfileSettings />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your saved coach settings could not be loaded.'
    );
    expect(
      screen.queryByRole('button', { name: 'Save coach profile' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Hard ingredient exclusions')
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('keeps unsaved edits and refreshes unchanged settings after a cross-channel update', () => {
    const { rerender } = render(<CoachProfileSettings />);
    const originalQuery = jest.mocked(useCoachProfile).mock.results[0]!
      .value as ReturnType<typeof useCoachProfile>;
    fireEvent.change(screen.getByLabelText('Hard ingredient exclusions'), {
      target: { value: 'tofu, mushrooms' },
    });
    jest.mocked(useCoachProfile).mockReturnValue({
      ...originalQuery,
      data: {
        ...originalQuery.data!,
        updatedAt: '2026-11-03T10:00:00.000Z',
        coachingNotes: 'A new note saved in Telegram.',
        preferredIngredients: ['beans'],
        calorieTarget: 2400,
      },
    } as ReturnType<typeof useCoachProfile>);

    rerender(<CoachProfileSettings />);

    expect(screen.getByLabelText('Hard ingredient exclusions')).toHaveValue(
      'tofu, mushrooms'
    );
    expect(screen.getByLabelText('Coaching notes')).toHaveValue(
      'A new note saved in Telegram.'
    );
    expect(screen.getByDisplayValue('2400')).toBeInTheDocument();
    expect(screen.getByLabelText('Preferred ingredients')).toHaveValue('beans');
    fireEvent.click(screen.getByRole('button', { name: 'Save coach profile' }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        excludedIngredients: ['tofu', 'mushrooms'],
        coachingNotes: 'A new note saved in Telegram.',
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('shows a retry state instead of claiming that saved memories are empty', () => {
    const refetch = jest.fn();
    jest.mocked(useCoachMemories).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useCoachMemories>);

    render(<CoachProfileSettings />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Saved memories could not be loaded.'
    );
    expect(screen.queryByText('Saved memories: 0')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No additional memories saved yet.')
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not mistake a failed Telegram status request for a missing bot configuration', () => {
    const refetch = jest.fn();
    jest.mocked(useCoachTelegram).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useCoachTelegram>);

    render(<CoachProfileSettings />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The Telegram connection status could not be loaded.'
    );
    expect(
      screen.queryByText(
        'Telegram is not configured on this SparkyFitness server yet.'
      )
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
