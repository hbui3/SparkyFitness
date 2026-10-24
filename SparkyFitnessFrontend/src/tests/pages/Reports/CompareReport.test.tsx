import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  compareWindow,
  SUGGESTED_QUESTIONS,
  todayInZone,
  type CompareQuery,
  type CompareQuestion,
  type CompareResponse,
  type CompareTimingChoice,
} from '@workspace/shared';
import { CompareReport } from '@/pages/Reports/Compare/CompareReport';
import { renderWithClient } from '@/tests/test-utils';

const mockGetCompare = jest.fn();
let mockActingOnBehalf = false;

// Every key the page asks for, so the last test can check en/translation.json
// says the same English.
const defaultsByKey = new Map<string, string>();

jest.mock('react-i18next', () => {
  const actual = jest.requireActual('@/tests/mocks/reactI18next');
  return {
    ...actual,
    useTranslation: () => ({
      ...actual.useTranslation(),
      t: (
        key: string,
        a?: string | Record<string, unknown>,
        b?: Record<string, unknown>
      ) => {
        const def = typeof a === 'string' ? a : a?.['defaultValue'];
        const plural = typeof a === 'object' && 'defaultValue_one' in a;
        if (typeof def === 'string' && !plural) defaultsByKey.set(key, def);
        return actual.translateForTest(key, a, b);
      },
    }),
  };
});

// The real hooks run; only the network call and the signed-in user are stubbed,
// so "no request fires" is read straight off getCompare.
jest.mock('@/api/Reports/compareApi', () => ({
  ...jest.requireActual('@/api/Reports/compareApi'),
  getCompare: (q: unknown) => mockGetCompare(q),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { activeUserId: 'user-1' } }),
}));

jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ isActingOnBehalf: mockActingOnBehalf }),
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'UTC',
    formatDateInUserTimezone: (d: string) => `fmt:${d}`,
  }),
}));

// The answer card shows which response it was given, so a test can tell the
// asked timing's answer from another's.
jest.mock('@/pages/Reports/Compare/CompareAnswerCard', () => ({
  CompareAnswerCard: ({ response }: { response: CompareResponse }) => (
    <div data-testid="answer-card">{response.through}</div>
  ),
}));
jest.mock('@/pages/Reports/Compare/CompareHowSure', () => ({
  CompareHowSure: () => <div data-testid="how-sure" />,
}));
jest.mock('@/pages/Reports/Compare/CompareChecks', () => ({
  CompareChecks: () => <div data-testid="checks" />,
}));
jest.mock('@/pages/Reports/Compare/CompareDotsChart', () => ({
  CompareDotsChart: () => <div data-testid="dots-chart" />,
}));
jest.mock('@/pages/Reports/Compare/CompareOverTimeChart', () => ({
  CompareOverTimeChart: () => <div data-testid="over-time-chart" />,
}));
jest.mock('@/pages/Reports/Compare/CompareTimingTable', () => ({
  CompareTimingTable: ({
    question,
    onPickTiming,
  }: {
    question: CompareQuestion;
    onPickTiming: (choice: CompareTimingChoice) => void;
  }) => (
    <div data-testid="timing-table" data-choice={question.choice}>
      <button type="button" onClick={() => onPickTiming('nextDay')}>
        pick the next day
      </button>
    </div>
  ),
}));
jest.mock('@/pages/Reports/Compare/CompareDaysTable', () => ({
  CompareDaysTable: () => <div data-testid="days-table" />,
}));

const RESPONSE = {
  through: '2026-10-21',
  result: { status: 'ok' },
} as unknown as CompareResponse;

/** A response that names the timing it answers, as "timing 1". */
const byTiming = (q: CompareQuery) =>
  Promise.resolve({ ...RESPONSE, through: `timing ${q.timing}` });

beforeAll(() => {
  // Radix Select leans on these, which jsdom lacks.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

describe('CompareReport', () => {
  beforeEach(() => {
    mockActingOnBehalf = false;
    window.localStorage.clear();
    mockGetCompare.mockReset();
    mockGetCompare.mockResolvedValue(RESPONSE);
  });

  const first = SUGGESTED_QUESTIONS[0]!;
  const suggestionId = `compare-suggestion-${first.a}-${first.b}-${first.choice}`;

  const asked = (): CompareQuery[] =>
    mockGetCompare.mock.calls.map(([q]) => q as CompareQuery);

  const pickTiming = (name: string) => {
    fireEvent.keyDown(screen.getByRole('combobox', { name: /When/ }), {
      key: 'Enter',
    });
    fireEvent.click(screen.getByRole('option', { name }));
  };

  const pressed = (name: string) =>
    screen.getByRole('button', { name }).getAttribute('aria-pressed');

  it('shows suggested questions and asks nothing before a question is picked', () => {
    renderWithClient(<CompareReport />);
    expect(screen.getByTestId(suggestionId)).toBeInTheDocument();
    expect(mockGetCompare).not.toHaveBeenCalled();
    expect(screen.queryByTestId('answer-card')).not.toBeInTheDocument();
  });

  it('renders the answer column, both charts and both tables for a picked question', async () => {
    renderWithClient(<CompareReport />);
    fireEvent.click(screen.getByTestId(suggestionId));
    for (const id of [
      'answer-card',
      'how-sure',
      'checks',
      'dots-chart',
      'over-time-chart',
      'timing-table',
      'days-table',
    ]) {
      expect(await screen.findByTestId(id)).toBeInTheDocument();
    }
    expect(mockGetCompare).toHaveBeenCalledWith(
      expect.objectContaining({ a: first.a, b: first.b })
    );
    // The first answer is kept as a recent question, under this account.
    expect(
      window.localStorage.getItem('sparky.compareRecentQuestions.v1.user-1')
    ).toContain(first.choice);
  });

  it('shows only-your-own-data and sends no request when acting on behalf', () => {
    mockActingOnBehalf = true;
    renderWithClient(<CompareReport />);
    expect(
      screen.getByText('Compare shows only your own data')
    ).toBeInTheDocument();
    expect(mockGetCompare).not.toHaveBeenCalled();
  });

  it('a day/week change starts the span over at the default and drops a custom range', async () => {
    const today = todayInZone('UTC');
    renderWithClient(<CompareReport />);
    fireEvent.click(screen.getByTestId(suggestionId));
    await screen.findByTestId('answer-card');
    expect(pressed('90 days')).toBe('true');

    // By day: 30 days, then a custom range.
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(pressed('Custom')).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Start date' })
    ).toBeInTheDocument();

    // By week: the week default, no custom range, and the query asks for it.
    pickTiming('The same week');
    expect(pressed('6 months')).toBe('true');
    expect(pressed('Custom')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Start date' })).toBeNull();
    await screen.findByTestId('answer-card');
    const week = compareWindow('6m', 'week', today);
    expect(asked()).toContainEqual(
      expect.objectContaining({
        mode: 'week',
        timing: 0,
        start: week.startDate,
        end: week.endDate,
      })
    );

    // Back to day: the day default again, never a 6-month span by day.
    pickTiming('The next day');
    expect(pressed('90 days')).toBe('true');
    await screen.findByTestId('answer-card');
    const day = compareWindow('90d', 'day', today);
    expect(asked()).toContainEqual(
      expect.objectContaining({
        mode: 'day',
        timing: 1,
        start: day.startDate,
        end: day.endDate,
      })
    );
    // No week was ever asked over a day span, and no day over a week span.
    expect(
      asked().filter((q) => q.mode === 'week' && q.start !== week.startDate)
    ).toEqual([]);
    expect(
      asked().filter((q) => q.mode === 'day' && q.start === week.startDate)
    ).toEqual([]);
  });

  it('a timing-row pick switches the question and shows the answer for that timing', async () => {
    mockGetCompare.mockImplementation(byTiming);
    renderWithClient(<CompareReport />);
    fireEvent.click(screen.getByTestId(suggestionId));
    expect(await screen.findByText('timing 0')).toBeInTheDocument();
    expect(screen.getByTestId('timing-table')).toHaveAttribute(
      'data-choice',
      'sameDay'
    );

    fireEvent.click(screen.getByRole('button', { name: 'pick the next day' }));
    expect(screen.getByTestId('timing-table')).toHaveAttribute(
      'data-choice',
      'nextDay'
    );
    expect(await screen.findByText('timing 1')).toBeInTheDocument();
    expect(mockGetCompare).toHaveBeenCalledWith(
      expect.objectContaining({ a: first.a, b: first.b, timing: 1 })
    );
  });

  it('a failed refresh keeps the answer on screen with no error line', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(<CompareReport />, { wrapper });
    fireEvent.click(screen.getByTestId(suggestionId));
    await screen.findByTestId('answer-card');

    mockGetCompare.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await client.refetchQueries();
    });
    expect(screen.getByTestId('answer-card')).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't load this comparison")
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a failed first load says so and Retry asks again', async () => {
    mockGetCompare.mockRejectedValue(new Error('offline'));
    renderWithClient(<CompareReport />);
    fireEvent.click(screen.getByTestId(suggestionId));
    expect(
      await screen.findByText("Couldn't load this comparison")
    ).toBeInTheDocument();
    expect(screen.queryByTestId('answer-card')).not.toBeInTheDocument();

    const callsBefore = mockGetCompare.mock.calls.length;
    mockGetCompare.mockResolvedValue(RESPONSE);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('answer-card')).toBeInTheDocument();
    expect(mockGetCompare.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(
      screen.queryByText("Couldn't load this comparison")
    ).not.toBeInTheDocument();
  });
});

// Runs last, so it sees every key the tests above asked for.
describe('en/translation.json', () => {
  it('says the same English as every default the page passes', () => {
    const json: unknown = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'public/locales/en/translation.json'),
        'utf-8'
      )
    );
    const leaf = (key: string): unknown =>
      key
        .split('.')
        .reduce<unknown>(
          (node, part) =>
            typeof node === 'object' && node !== null
              ? (node as Record<string, unknown>)[part]
              : undefined,
          json
        );
    expect(defaultsByKey.get('compareReport.screen.retry')).toBe('Retry');
    const mismatches = [...defaultsByKey]
      .filter(([key]) => key.startsWith('compareReport.'))
      .filter(([key, def]) => leaf(key) !== def)
      .map(([key, def]) => `${key}: ${String(leaf(key))} != ${def}`);
    expect(mismatches).toEqual([]);
  });
});
