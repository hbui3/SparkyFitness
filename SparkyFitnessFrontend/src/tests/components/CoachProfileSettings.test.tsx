import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CoachProfileSettings from '@/pages/Settings/CoachProfileSettings';
import {
  useCoachProfile,
  useUpdateCoachProfile,
} from '@/hooks/Settings/useCoachProfile';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

jest.mock('@/hooks/Settings/useCoachProfile', () => ({
  useCoachProfile: jest.fn(),
  useUpdateCoachProfile: jest.fn(),
}));

const mutate = jest.fn();

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
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
      isLoading: false,
    } as ReturnType<typeof useCoachProfile>);
    jest.mocked(useUpdateCoachProfile).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateCoachProfile>);
  });

  it('renders stored profile values and saves the complete private profile', () => {
    render(<CoachProfileSettings />);

    expect(screen.getByDisplayValue('Build strength')).toBeInTheDocument();
    expect(screen.getByDisplayValue('tofu')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2200')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save coach profile' }));

    expect(mutate).toHaveBeenCalledWith({
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
    });
  });
});
