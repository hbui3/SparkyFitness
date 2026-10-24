import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ReactNode } from 'react';
import type {
  CompareQuestion,
  CompareResponse,
  CompareResult,
} from '@workspace/shared';
import { CompareDotsChart } from '@/pages/Reports/Compare/CompareDotsChart';
import { CompareOverTimeChart } from '@/pages/Reports/Compare/CompareOverTimeChart';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);

let mockTimeFormat: string | undefined;

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'UTC',
    timeFormat: mockTimeFormat,
    formatDateInUserTimezone: (d: string) => d,
  }),
}));

jest.mock('@/components/ZoomableChart', () => ({
  __esModule: true,
  default: ({
    children,
  }: {
    children: (maximized: boolean, zoom: number) => ReactNode;
  }) => <div>{children(false, 1)}</div>,
}));

interface Dot {
  x: number;
  y: number;
}
type Format = (value: number) => string;
interface AxisProps {
  tickFormatter?: Format;
  allowDecimals?: boolean;
}
type TooltipFormat = (value: number, name: string) => [string, string];

let scatterData: Dot[] = [];
let lineKeys: string[] = [];
let xAxis: AxisProps = {};
let yAxis: AxisProps = {};
let tooltipFormat: TooltipFormat | undefined;

jest.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ResponsiveContainer: Passthrough,
    ScatterChart: Passthrough,
    LineChart: Passthrough,
    Scatter: ({ data }: { data: Dot[] }) => {
      scatterData = data;
      return <div data-testid="scatter" />;
    },
    Line: ({ dataKey }: { dataKey: string }) => {
      lineKeys.push(dataKey);
      return null;
    },
    ReferenceLine: () => <div data-testid="trend" />,
    XAxis: (props: AxisProps) => {
      xAxis = props;
      return null;
    },
    YAxis: (props: AxisProps) => {
      yAxis = props;
      return null;
    },
    CartesianGrid: () => null,
    Tooltip: ({ formatter }: { formatter?: TooltipFormat }) => {
      tooltipFormat = formatter;
      return null;
    },
  };
});

const Q: CompareQuestion = { a: 'timeAsleep', b: 'energy', choice: 'sameDay' };
const YES_NO_Q: CompareQuestion = {
  a: 'meditated',
  b: 'energy',
  choice: 'sameDay',
};

function response(
  result: Partial<CompareResult>,
  q: CompareQuestion,
  dev: { a: Record<string, number>; b: Record<string, number> } = {
    a: {},
    b: {},
  }
): CompareResponse {
  return {
    a: { key: q.a, values: { '2026-10-01': 400, '2026-10-02': 480 } },
    b: { key: q.b, values: { '2026-10-01': 3, '2026-10-02': 4 } },
    through: '2026-10-21',
    deviations: dev,
    result: {
      status: 'ok',
      n: 62,
      needed: 14,
      checks: { ownNormal: true },
      ...result,
    },
  };
}

const DEV = {
  a: { '2026-10-01': -1, '2026-10-02': 1, '2026-10-03': 0.5 },
  b: { '2026-10-01': -0.5, '2026-10-02': 0.8, '2026-10-03': 0.2 },
};

beforeEach(() => {
  scatterData = [];
  lineKeys = [];
  xAxis = {};
  yAxis = {};
  tooltipFormat = undefined;
  mockTimeFormat = undefined;
});

describe('CompareDotsChart', () => {
  test('draws a dot per paired day and the trend only when linked', () => {
    const { unmount } = render(
      <CompareDotsChart
        response={response({ linked: true }, Q, DEV)}
        question={Q}
      />
    );
    expect(scatterData).toHaveLength(3);
    expect(screen.getByTestId('trend')).toBeInTheDocument();
    expect(screen.getByText('Each day as a dot')).toBeInTheDocument();
    unmount();
    render(
      <CompareDotsChart
        response={response({ linked: false }, Q, DEV)}
        question={Q}
      />
    );
    expect(screen.queryByTestId('trend')).not.toBeInTheDocument();
  });

  test('axes and tooltip read the dots as signed amounts on the display scale', () => {
    const q: CompareQuestion = { a: 'steps', b: 'mood', choice: 'sameDay' };
    render(
      <CompareDotsChart
        response={response(
          { linked: false },
          q,
          // Mood deviations are stored ×10; the dots show them on 1-10.
          { a: { '2026-10-01': 1234 }, b: { '2026-10-01': 8 } }
        )}
        question={q}
      />
    );
    expect(scatterData).toEqual([{ key: '2026-10-01', x: 1234, y: 0.8 }]);
    // Steps are whole, and the ticks say so instead of "1234.0".
    expect(xAxis.tickFormatter?.(1234)).toBe('+1,234');
    expect(xAxis.tickFormatter?.(0)).toBe('0');
    expect(xAxis.allowDecimals).toBe(false);
    // Mood is already on the display scale: 0.8 stays 0.8, never 0.1.
    expect(yAxis.tickFormatter?.(0.8)).toBe('+0.8');
    expect(yAxis.tickFormatter?.(-1.5)).toBe('-1.5');
    expect(yAxis.allowDecimals).toBe(true);
    expect(tooltipFormat?.(1234, 'Steps')).toEqual(['+1,234', 'Steps']);
    expect(tooltipFormat?.(-0.5, 'Mood')).toEqual(['-0.5', 'Mood']);
  });

  test('a yes/no side by day is a 0/1 flag, not a signed deviation', () => {
    render(
      <CompareDotsChart
        response={response({ status: 'not_enough' }, YES_NO_Q, {
          a: { '2026-10-01': 1 },
          b: { '2026-10-01': 0.5 },
        })}
        question={YES_NO_Q}
      />
    );
    expect(xAxis.tickFormatter?.(1)).toBe('1');
    expect(yAxis.tickFormatter?.(0.5)).toBe('+0.5');
  });

  test('shows the empty state with no dots', () => {
    render(
      <CompareDotsChart
        response={response({ status: 'not_enough' }, Q)}
        question={Q}
      />
    );
    expect(screen.getByText('No days with both yet')).toBeInTheDocument();
    expect(screen.queryByTestId('scatter')).not.toBeInTheDocument();
  });

  test('a yes/no question by day renders bars, not the scatter', () => {
    render(
      <CompareDotsChart
        response={response(
          {
            linked: true,
            binary: {
              yesKey: 'meditated',
              yesMean: 1,
              noMean: 0.5,
              diff: 0.5,
              yesCount: 10,
              noCount: 1,
            },
          },
          YES_NO_Q,
          DEV
        )}
        question={YES_NO_Q}
      />
    );
    expect(screen.getByTestId('compare-bar-yes')).toBeInTheDocument();
    expect(screen.getByTestId('compare-bar-no')).toBeInTheDocument();
    expect(screen.queryByTestId('scatter')).not.toBeInTheDocument();
    expect(screen.getByText(/· 1 day$/)).toBeInTheDocument();
  });

  test('bars show a bedtime as a clock time in the 12/24-hour setting', () => {
    const q: CompareQuestion = {
      a: 'meditated',
      b: 'bedtime',
      choice: 'sameDay',
    };
    const binaryResponse = response(
      {
        linked: true,
        binary: {
          yesKey: 'meditated',
          yesMean: 240,
          noMean: 300,
          diff: -60,
          yesCount: 10,
          noCount: 12,
        },
      },
      q,
      DEV
    );
    mockTimeFormat = 'HH:mm';
    const { unmount } = render(
      <CompareDotsChart response={binaryResponse} question={q} />
    );
    expect(screen.getByText('22:00 · 10 nights')).toBeInTheDocument();
    expect(screen.getByText('23:00 · 12 nights')).toBeInTheDocument();
    unmount();
    mockTimeFormat = 'h:mm A';
    render(<CompareDotsChart response={binaryResponse} question={q} />);
    expect(screen.getByText('10:00 PM · 10 nights')).toBeInTheDocument();
  });
});

describe('CompareOverTimeChart', () => {
  test('draws both series and names each metric in the legend', () => {
    render(
      <CompareOverTimeChart response={response({}, Q, DEV)} question={Q} />
    );
    expect(lineKeys).toEqual(['a', 'b']);
    expect(screen.getByText(/^Energy/)).toBeInTheDocument();
    expect(screen.getByText(/Time asleep/)).toBeInTheDocument();
  });

  test('the legend shows a bedtime range in the 12/24-hour setting', () => {
    const q: CompareQuestion = { a: 'bedtime', b: 'energy', choice: 'sameDay' };
    const bedtimes = response({}, q, DEV);
    bedtimes.a.values = { '2026-10-01': 240, '2026-10-02': 300 };
    mockTimeFormat = 'HH:mm';
    render(<CompareOverTimeChart response={bedtimes} question={q} />);
    expect(screen.getByText('Bedtime 22:00–23:00')).toBeInTheDocument();
  });

  test('shows the empty state when nothing is logged', () => {
    const empty = response({}, Q);
    empty.a.values = {};
    empty.b.values = {};
    render(<CompareOverTimeChart response={empty} question={Q} />);
    expect(
      screen.getByText('Nothing logged in this range')
    ).toBeInTheDocument();
  });
});
