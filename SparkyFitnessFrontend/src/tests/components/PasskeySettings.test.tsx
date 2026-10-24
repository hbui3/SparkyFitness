import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PasskeySettings from '@/pages/Settings/PasskeySettings';
import { useAuthSettings } from '@/hooks/Auth/useAuth';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ language: 'en' }),
}));
jest.mock('@/hooks/Settings/usePasskeys', () => ({
  usePasskeys: () => ({
    data: [{ id: 'pk-1', name: 'Work laptop', createdAt: '2026-09-01' }],
    isLoading: false,
  }),
  useAddPasskeyMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeletePasskeyMutation: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/hooks/Auth/useAuth', () => ({ useAuthSettings: jest.fn() }));

function withPasskeySetting(passkey?: { enabled: boolean }) {
  jest.mocked(useAuthSettings).mockReturnValue({
    data: { passkey },
  } as unknown as ReturnType<typeof useAuthSettings>);
}

describe('PasskeySettings', () => {
  it('offers adding a passkey when passkey login is enabled', () => {
    withPasskeySetting({ enabled: true });
    render(<PasskeySettings />);
    expect(
      screen.getByRole('button', { name: /Add Passkey/ })
    ).toBeInTheDocument();
  });

  it('offers adding a passkey on servers that do not report the setting', () => {
    withPasskeySetting(undefined);
    render(<PasskeySettings />);
    expect(
      screen.getByRole('button', { name: /Add Passkey/ })
    ).toBeInTheDocument();
  });

  it('hides adding a passkey but keeps existing passkeys when disabled', () => {
    withPasskeySetting({ enabled: false });
    render(<PasskeySettings />);
    expect(
      screen.queryByRole('button', { name: /Add Passkey/ })
    ).not.toBeInTheDocument();
    expect(screen.getByText('Work laptop')).toBeInTheDocument();
  });
});
