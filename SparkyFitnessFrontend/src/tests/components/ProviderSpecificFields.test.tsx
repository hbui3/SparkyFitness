import { useState, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProviderSpecificFields } from '@/pages/Settings/ProviderSpecificFields';
import type { ExternalDataProvider } from '@/pages/Settings/ExternalProviderSettings';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
  Trans: ({ children }: { children?: ReactNode }) => children,
}));

const IGPSportFieldsHarness = () => {
  const [provider, setProvider] = useState<Partial<ExternalDataProvider>>({
    provider_type: 'igpsport',
    app_id: '',
    app_key: '',
    base_url: 'https://prod.en.igpsport.com',
    sync_frequency: 'manual',
  });

  return (
    <ProviderSpecificFields
      provider={provider}
      setProvider={setProvider}
      fullSyncOnConnect={false}
      setFullSyncOnConnect={() => undefined}
      onCopy={() => undefined}
    />
  );
};

describe('ProviderSpecificFields', () => {
  it('renders editable iGPSPORT account, password, and region fields', () => {
    render(<IGPSportFieldsHarness />);

    const account = screen.getByLabelText('iGPSPORT Email or Phone');
    const password = screen.getByLabelText('iGPSPORT Password');
    const region = screen.getByLabelText('Account Region');

    expect((account as HTMLInputElement).type).toBe('text');
    expect((password as HTMLInputElement).type).toBe('password');
    expect(region.textContent).toContain('Global');

    fireEvent.change(account, { target: { value: 'rider@example.com' } });
    fireEvent.change(password, { target: { value: 'secret' } });

    expect((account as HTMLInputElement).value).toBe('rider@example.com');
    expect((password as HTMLInputElement).value).toBe('secret');
  });
});
