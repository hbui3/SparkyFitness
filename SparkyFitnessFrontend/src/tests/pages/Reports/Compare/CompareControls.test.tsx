import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SUGGESTED_QUESTIONS, type CompareQuestion } from '@workspace/shared';
import { CompareSentence } from '@/pages/Reports/Compare/CompareSentence';
import { CompareSpanControl } from '@/pages/Reports/Compare/CompareSpanControl';
import { clampCustomRange } from '@/pages/Reports/Compare/compareCustomRange';
import { CompareStartState } from '@/pages/Reports/Compare/CompareStartState';

// Every key the controls ask for, so the last test can check en/translation.json
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
        if (typeof def === 'string') defaultsByKey.set(key, def);
        return actual.translateForTest(key, a, b);
      },
    }),
  };
});

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'UTC',
    formatDateInUserTimezone: (d: string) => `fmt:${d}`,
  }),
}));

beforeAll(() => {
  // Radix Select leans on these, which jsdom lacks.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

function open(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('CompareSentence', () => {
  test('reads "Does … go with … ?" for sleep and energy that day', () => {
    render(
      <CompareSentence
        question={{ a: 'timeAsleep', b: 'energy', choice: 'sameDay' }}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByText('Does')).toBeInTheDocument();
    expect(screen.getByText("last night's time asleep")).toBeInTheDocument();
    expect(screen.getByText('go with')).toBeInTheDocument();
    expect(screen.getByText('energy')).toBeInTheDocument();
    expect(screen.getByText('that day')).toBeInTheDocument();
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  test('the timing picker lists five choices and no "since"', () => {
    const onChange = jest.fn();
    render(
      <CompareSentence
        question={{ a: 'timeAsleep', b: 'energy', choice: 'sameDay' }}
        onChange={onChange}
      />
    );
    open(screen.getByRole('combobox', { name: /When/ }));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([
      'The same day',
      'The next day',
      'The day before',
      'The same week',
      'The next week',
    ]);
    expect(screen.queryByText(/since/i)).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'The next day' }));
    expect(onChange).toHaveBeenCalledWith({
      a: 'timeAsleep',
      b: 'energy',
      choice: 'nextDay',
    });
  });

  test('a week question with a day-only metric shows the day-only line', () => {
    render(
      <CompareSentence
        question={{
          a: 'meditationSessions7d',
          b: 'energy',
          choice: 'sameWeek',
        }}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByText(/can only be compared by day/)).toBeInTheDocument();
  });

  test('the metric picker is grouped and leaves out the other side', () => {
    render(
      <CompareSentence
        question={{ a: 'timeAsleep', b: 'energy', choice: 'sameDay' }}
        onChange={jest.fn()}
      />
    );
    open(screen.getByRole('combobox', { name: /Second thing/ }));
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Sleep')).toBeInTheDocument();
    expect(within(listbox).getByText('How you felt')).toBeInTheDocument();
    expect(
      within(listbox).queryByRole('option', { name: 'Time asleep' })
    ).toBeNull();
    expect(
      within(listbox).getByRole('option', { name: 'Mood' })
    ).toBeInTheDocument();
  });
});

describe('CompareStartState', () => {
  test('picking a suggested question calls onPick with it', () => {
    const onPick = jest.fn();
    render(<CompareStartState recent={[]} onPick={onPick} />);
    expect(screen.getByText('Try one of these')).toBeInTheDocument();
    expect(screen.queryByText('Your recent questions')).toBeNull();
    const first = SUGGESTED_QUESTIONS[0] as CompareQuestion;
    fireEvent.click(
      screen.getByRole('button', {
        name: "Does last night's time asleep go with energy that day?",
      })
    );
    expect(onPick).toHaveBeenCalledWith(first);
  });

  test('shows at most five recent questions', () => {
    const recent: CompareQuestion[] = (
      [
        'energy',
        'mood',
        'focus',
        'sleepScore',
        'overnightHrv',
        'bedtime',
      ] as const
    ).map((b) => ({ a: 'timeAsleep', b, choice: 'sameDay' }));
    render(<CompareStartState recent={recent} onPick={jest.fn()} />);
    expect(screen.getByText('Your recent questions')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^compare-recent-/)).toHaveLength(5);
  });
});

describe('CompareSpanControl', () => {
  const base = { today: '2026-10-22', custom: null };

  test('offers the day spans and Custom', () => {
    const onChange = jest.fn();
    render(
      <CompareSpanControl mode="day" span="90d" onChange={onChange} {...base} />
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '30 days',
      '60 days',
      '90 days',
      'Custom',
    ]);
    fireEvent.click(screen.getByRole('button', { name: '60 days' }));
    expect(onChange).toHaveBeenCalledWith('60d', null);
  });

  test('offers the week spans', () => {
    render(
      <CompareSpanControl
        mode="week"
        span="6m"
        onChange={jest.fn()}
        {...base}
      />
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '6 months',
      '1 year',
      'Custom',
    ]);
  });

  test('Custom starts from the current window and shows two date pickers', () => {
    const onChange = jest.fn();
    render(
      <CompareSpanControl mode="day" span="90d" onChange={onChange} {...base} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(onChange).toHaveBeenCalledWith('custom', {
      startDate: '2026-07-25',
      endDate: '2026-10-22',
    });
  });

  test('a custom range shows both dates', () => {
    render(
      <CompareSpanControl
        mode="day"
        span="custom"
        custom={{ startDate: '2026-09-01', endDate: '2026-10-01' }}
        today="2026-10-22"
        onChange={jest.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: /Start date/ })
    ).toHaveTextContent('fmt:2026-09-01');
    expect(screen.getByRole('button', { name: /End date/ })).toHaveTextContent(
      'fmt:2026-10-01'
    );
  });
});

describe('custom range bounds', () => {
  const today = '2026-10-22';

  test('an end that makes the span too long moves the start', () => {
    // 180 days is the day limit: 2026-04-25 .. 2026-10-21 is exactly 180.
    expect(
      clampCustomRange(
        { startDate: '2026-04-25', endDate: '2026-10-22' },
        today,
        180
      )
    ).toEqual({ startDate: '2026-04-26', endDate: '2026-10-22' });
    expect(
      clampCustomRange(
        { startDate: '2026-04-25', endDate: '2026-10-21' },
        today,
        180
      )
    ).toEqual({ startDate: '2026-04-25', endDate: '2026-10-21' });
  });

  test('the end never passes today and the start never passes the end', () => {
    expect(
      clampCustomRange(
        { startDate: '2026-10-01', endDate: '2026-11-30' },
        today,
        180
      )
    ).toEqual({ startDate: '2026-10-01', endDate: today });
    expect(
      clampCustomRange(
        { startDate: '2026-10-30', endDate: '2026-10-22' },
        today,
        180
      )
    ).toEqual({ startDate: today, endDate: today });
  });

  test('picking a later end in the calendar sends the clamped range', () => {
    const onChange = jest.fn();
    render(
      <CompareSpanControl
        mode="day"
        span="custom"
        custom={{ startDate: '2026-04-20', endDate: '2026-10-01' }}
        today={today}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /End date/ }));
    // Today is the last pickable end; dates after it are disabled.
    const day = (n: string) =>
      screen
        .getAllByRole('gridcell')
        .map((c) => c.querySelector('button'))
        .find((b) => b?.textContent === n && !b.closest('[data-outside]'));
    expect(day('23')?.hasAttribute('disabled')).toBe(true);
    fireEvent.click(day('21') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('custom', {
      startDate: '2026-04-25',
      endDate: '2026-10-21',
    });
  });

  test('the start picker disables days past the limit', () => {
    render(
      <CompareSpanControl
        mode="day"
        span="custom"
        custom={{ startDate: '2026-04-25', endDate: '2026-10-21' }}
        today={today}
        onChange={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Start date/ }));
    const cells = screen.getAllByRole('gridcell');
    const btn = (n: string) =>
      cells
        .map((c) => c.querySelector('button'))
        .find((b) => b?.textContent === n && !b.closest('[data-outside]'));
    // April 24 is 181 days back from Oct 21; April 25 is the earliest.
    expect(btn('24')?.hasAttribute('disabled')).toBe(true);
    expect(btn('25')?.hasAttribute('disabled')).toBe(false);
  });
});

// Runs last, so it sees every key the tests above asked for.
describe('en/translation.json', () => {
  test('says the same English as every default the controls pass', () => {
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
    const keys = [...defaultsByKey].filter(([k]) =>
      k.startsWith('compareReport.')
    );
    expect(keys.length).toBeGreaterThan(15);
    const mismatches = keys
      .filter(([key, def]) => leaf(key) !== def)
      .map(([key, def]) => `${key}: ${String(leaf(key))} != ${def}`);
    expect(mismatches).toEqual([]);
  });
});
