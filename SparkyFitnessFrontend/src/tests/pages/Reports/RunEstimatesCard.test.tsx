import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { RunningEstimatesResponse } from '@workspace/shared';
import RunEstimatesCard from '@/pages/Reports/RunEstimatesCard';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?:
        string | { defaultValue?: string; count?: number; perKg?: string }
    ) => {
      if (typeof options === 'string') return options;
      return (options?.defaultValue ?? key)
        .replace('{{count}}', String(options?.count ?? ''))
        .replace('{{perKg}}', options?.perKg ?? '');
    },
  }),
}));

const DATA: RunningEstimatesResponse = {
  vo2Max: { value: 52.4, runs: 3, from: '2026-09-20', to: '2026-10-10' },
  power: {
    averageWatts: 243,
    wattsPerKg: 3.5,
    runs: [{ day: '2026-10-10', watts: 243 }],
  },
};

describe('RunEstimatesCard', () => {
  it.each([
    ['en-US', '52.4', '3.5'],
    ['de-DE', '52,4', '3,5'],
  ])(
    'shows both estimates in the browser locale %s, labelled as estimates',
    (locale, vo2, perKg) => {
      const NativeNumberFormat = Intl.NumberFormat;
      // Simulate the browser default without depending on the CI host's locale.
      const numberFormat = jest
        .spyOn(Intl, 'NumberFormat')
        .mockImplementation(
          (locales, options) =>
            new NativeNumberFormat(locales ?? locale, options)
        );
      try {
        render(<RunEstimatesCard data={DATA} />);
        expect(screen.getByText(`≈ ${vo2}`)).toBeInTheDocument();
        expect(screen.getByText('≈ 243 W')).toBeInTheDocument();
        expect(
          screen.getByText(`Running power (${perKg} W/kg)`)
        ).toBeInTheDocument();
        expect(screen.getByText(/Not a measurement/)).toBeInTheDocument();
      } finally {
        numberFormat.mockRestore();
      }
    }
  );

  it('shows only the estimate it has', () => {
    render(<RunEstimatesCard data={{ ...DATA, vo2Max: null }} />);
    expect(screen.queryByTestId('run-estimate-vo2')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-estimate-power')).toBeInTheDocument();
  });

  it('renders nothing without data or without any estimate', () => {
    const { container, rerender } = render(
      <RunEstimatesCard data={undefined} />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<RunEstimatesCard data={{ vo2Max: null, power: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
