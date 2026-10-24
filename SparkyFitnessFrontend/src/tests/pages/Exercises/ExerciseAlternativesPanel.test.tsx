import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ExerciseAlternative } from '@workspace/shared';
import ExerciseAlternativesPanel from '@/pages/Exercises/ExerciseAlternativesPanel';
import { useExerciseAlternatives } from '@/hooks/Exercises/useExerciseAlternatives';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);

jest.mock('@/hooks/Exercises/useExerciseAlternatives', () => ({
  useExerciseAlternatives: jest.fn(),
}));

const mockImport = jest.fn();
jest.mock('@/hooks/Exercises/useExerciseSearch', () => ({
  useAddExerciseMutation: () => ({ mutateAsync: mockImport }),
}));

const mockUseExerciseAlternatives =
  useExerciseAlternatives as jest.MockedFunction<
    typeof useExerciseAlternatives
  >;

const base: Omit<ExerciseAlternative, 'origin' | 'id' | 'name'> = {
  source: 'custom',
  category: 'strength',
  modality: 'weight_reps',
  level: null,
  mechanic: null,
  force: null,
  equipment: ['dumbbell'],
  primary_muscles: ['chest'],
  secondary_muscles: [],
  images: [],
  instructions: [],
  description: null,
  calories_per_hour: 300,
  score: 70,
  reasons: ['same_primary_muscles', 'recently_performed'],
  last_performed_date: null,
};

const library: ExerciseAlternative = {
  ...base,
  origin: 'library',
  id: 'lib-1',
  name: 'Dumbbell Press',
};
const catalog: ExerciseAlternative = {
  ...base,
  origin: 'catalog',
  id: 'Cable_Crossover',
  name: 'Cable Crossover',
  source: 'free-exercise-db',
  reasons: ['same_primary_muscles'],
};

const replaceFor = {
  exerciseId: 'bench',
  exerciseName: 'Bench Press',
  excludeIds: ['row'],
};

function mockAlternatives(
  overrides: Partial<{
    alternatives: ExerciseAlternative[];
    rankable: boolean;
  }> = {}
) {
  mockUseExerciseAlternatives.mockReturnValue({
    data: {
      source: {
        id: 'bench',
        name: 'Bench Press',
        primary_muscles: ['chest'],
        equipment: ['barbell'],
      },
      alternatives: [library, catalog],
      rankable: true,
      catalog_available: true,
      ...overrides,
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useExerciseAlternatives>);
}

describe('ExerciseAlternativesPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAlternatives();
  });

  it('lists ranked alternatives with their reasons', () => {
    render(
      <ExerciseAlternativesPanel
        replaceFor={replaceFor}
        onSelect={jest.fn()}
        onSearchAll={jest.fn()}
      />
    );
    expect(screen.getByText('Instead of Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Dumbbell Press')).toBeInTheDocument();
    expect(screen.getByText('Done recently')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(mockUseExerciseAlternatives).toHaveBeenCalledWith(
      'bench',
      'similar',
      ['row']
    );
  });

  it('switches to the different-equipment ranking', () => {
    render(
      <ExerciseAlternativesPanel
        replaceFor={replaceFor}
        onSelect={jest.fn()}
        onSearchAll={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Other equipment' }));
    expect(mockUseExerciseAlternatives).toHaveBeenLastCalledWith(
      'bench',
      'different_equipment',
      ['row']
    );
  });

  it('selects a library alternative directly', () => {
    const onSelect = jest.fn();
    render(
      <ExerciseAlternativesPanel
        replaceFor={replaceFor}
        onSelect={onSelect}
        onSearchAll={jest.fn()}
      />
    );
    fireEvent.click(screen.getByText('Dumbbell Press'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'lib-1', calories_per_hour: 300 }),
      'internal'
    );
    expect(mockImport).not.toHaveBeenCalled();
  });

  it('imports a catalog alternative before selecting it', async () => {
    const onSelect = jest.fn();
    mockImport.mockResolvedValue({ id: 'imported', name: 'Cable Crossover' });
    render(
      <ExerciseAlternativesPanel
        replaceFor={replaceFor}
        onSelect={onSelect}
        onSearchAll={jest.fn()}
      />
    );
    fireEvent.click(screen.getByText('Cable Crossover'));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'imported', name: 'Cable Crossover' }),
        'external'
      )
    );
    expect(mockImport).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'free-exercise-db',
        exercise: expect.objectContaining({ id: 'Cable_Crossover' }),
      })
    );
  });

  it('points to free search when nothing can be ranked', () => {
    const onSearchAll = jest.fn();
    mockAlternatives({ rankable: false, alternatives: [] });
    render(
      <ExerciseAlternativesPanel
        replaceFor={replaceFor}
        onSelect={jest.fn()}
        onSearchAll={onSearchAll}
      />
    );
    expect(
      screen.getByText('No muscles recorded for Bench Press')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Search all exercises'));
    expect(onSearchAll).toHaveBeenCalled();
  });
});
