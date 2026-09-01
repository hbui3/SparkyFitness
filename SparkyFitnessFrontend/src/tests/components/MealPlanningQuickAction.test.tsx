import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ReactNode } from 'react';
import { MealPlanningQuickAction } from '@/components/ai/MealPlanningQuickAction';

const mockSuggestionDispatch = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

jest.mock('@assistant-ui/react', () => ({
  ThreadPrimitive: {
    Suggestion: ({
      children,
      prompt,
    }: {
      children: ReactNode;
      prompt: string;
    }) => <div onClick={() => mockSuggestionDispatch(prompt)}>{children}</div>,
  },
}));

describe('MealPlanningQuickAction', () => {
  beforeEach(() => {
    mockSuggestionDispatch.mockClear();
  });

  it('renders the localized action label', () => {
    render(<MealPlanningQuickAction />);

    expect(
      screen.getByRole('button', { name: 'Plan next meal & shopping' })
    ).toBeInTheDocument();
  });

  it('passes the complete planning request to the chat suggestion', () => {
    render(<MealPlanningQuickAction />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Plan next meal & shopping' })
    );

    expect(mockSuggestionDispatch).toHaveBeenCalledWith(
      'Decide my next meal based on my remaining goals and food preferences. Give exact portions, brief preparation steps, and one shopping list grouped by grocery section for two servings. Ask at most one question, and only if it is essential; otherwise make sensible assumptions. Reply in my language.'
    );
  });
});
