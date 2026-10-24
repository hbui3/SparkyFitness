import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MuscleGroupRecoveryTracker from '@/pages/Reports/MuscleGroupRecoveryTracker';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
  }),
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'America/New_York' }),
}));

jest.mock('@workspace/shared', () => {
  const actual = jest.requireActual('@workspace/shared');
  return {
    ...actual,
    todayInZone: () => '2026-09-22',
  };
});

describe('MuscleGroupRecoveryTracker', () => {
  it('says Today for a workout on the user calendar day', () => {
    render(
      <MuscleGroupRecoveryTracker
        recoveryData={{
          Biceps: '2026-09-22',
          Chest: '2026-09-21',
          Glutes: '2026-09-16',
        }}
      />
    );

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.getByText('6 days ago')).toBeInTheDocument();
    expect(screen.queryByText(/hours ago/)).not.toBeInTheDocument();
  });
});
