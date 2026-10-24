import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CompareQuery, CompareResponse } from '@workspace/shared';
import { getCompare } from '@/api/Reports/compareApi';
import {
  useCompare,
  useCompareQuestion,
  useCompareTimings,
} from '@/hooks/Reports/useCompare';

// The request builder stays real, so useCompareQuestion builds real queries.
jest.mock('@/api/Reports/compareApi', () => ({
  ...jest.requireActual('@/api/Reports/compareApi'),
  getCompare: jest.fn(),
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { activeUserId: 'u1' } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const mockedGetCompare = getCompare as jest.MockedFunction<typeof getCompare>;

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const base: CompareQuery = {
  a: 'timeAsleep',
  b: 'mood',
  mode: 'day',
  timing: 0,
  start: '2026-07-24',
  end: '2026-10-21',
};

describe('useCompare', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetCompare.mockResolvedValue({} as never);
  });

  it('stays idle without a query', () => {
    renderHook(() => useCompare(null), { wrapper });
    expect(mockedGetCompare).not.toHaveBeenCalled();
  });

  it('fetches the query when given one', async () => {
    renderHook(() => useCompare(base), { wrapper });
    await waitFor(() => expect(mockedGetCompare).toHaveBeenCalledWith(base));
  });
});

describe('useCompareTimings asks only the other timings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetCompare.mockResolvedValue({} as never);
  });

  const askedTimings = () =>
    mockedGetCompare.mock.calls.map(([q]) => q.timing).sort();

  it('by day, skips the base timing', async () => {
    const { result } = renderHook(() => useCompareTimings(base, true), {
      wrapper,
    });
    expect(result.current.map((r) => r.timing)).toEqual([-1, 1]);
    await waitFor(() => expect(mockedGetCompare).toHaveBeenCalledTimes(2));
    expect(askedTimings()).toEqual([-1, 1]);
  });

  it('asks the other timings quietly, so a failed row does not toast', async () => {
    renderHook(() => useCompareTimings(base, true), { wrapper });
    await waitFor(() => expect(mockedGetCompare).toHaveBeenCalledTimes(2));
    for (const [, options] of mockedGetCompare.mock.calls) {
      expect(options).toEqual({ quiet: true });
    }
  });

  it('by week, asks only timing 1', async () => {
    const week = { ...base, mode: 'week', timing: 0 } as const;
    const { result } = renderHook(() => useCompareTimings(week, true), {
      wrapper,
    });
    expect(result.current.map((r) => r.timing)).toEqual([1]);
    await waitFor(() => expect(mockedGetCompare).toHaveBeenCalledTimes(1));
  });

  it('asks nothing without a base', () => {
    const { result } = renderHook(() => useCompareTimings(null, true), {
      wrapper,
    });
    expect(result.current.map((r) => r.timing)).toEqual([-1, 0, 1]);
    expect(mockedGetCompare).not.toHaveBeenCalled();
  });
});

describe('the other timings wait for the main answer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks nothing while the main answer is unsettled', () => {
    renderHook(() => useCompareTimings(base, false), { wrapper });
    expect(mockedGetCompare).not.toHaveBeenCalled();
  });

  const question = { a: 'timeAsleep', b: 'mood', choice: 'sameDay' } as const;
  const window = { startDate: base.start, endDate: base.end };

  it('asks the asked timing first and the others once it has an answer', async () => {
    let answer: (value: CompareResponse) => void = () => undefined;
    mockedGetCompare.mockImplementation((q) =>
      q.timing === 0
        ? new Promise<CompareResponse>((resolve) => {
            answer = resolve;
          })
        : Promise.resolve({} as CompareResponse)
    );
    renderHook(() => useCompareQuestion(question, window), { wrapper });
    await waitFor(() => expect(mockedGetCompare).toHaveBeenCalledTimes(1));
    expect(mockedGetCompare).toHaveBeenCalledWith(base);

    answer({} as CompareResponse);
    await waitFor(() => expect(mockedGetCompare).toHaveBeenCalledTimes(3));
    expect(mockedGetCompare.mock.calls.map(([q]) => q.timing).sort()).toEqual([
      -1, 0, 1,
    ]);
  });

  it('asks the others after a failed main answer too', async () => {
    mockedGetCompare.mockImplementation((q) =>
      q.timing === 0
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({} as CompareResponse)
    );
    renderHook(() => useCompareQuestion(question, window), { wrapper });
    await waitFor(() => expect(mockedGetCompare).toHaveBeenCalledTimes(3));
  });
});
