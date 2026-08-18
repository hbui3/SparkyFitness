import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TelegramCoachSettings from '@/pages/Admin/TelegramCoachSettings';
import {
  useRemoveTelegramCoachSettings,
  useTelegramCoachSettings,
  useUpdateTelegramCoachSettings,
} from '@/hooks/Admin/useTelegramCoachSettings';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

jest.mock('@/hooks/Admin/useTelegramCoachSettings', () => ({
  useRemoveTelegramCoachSettings: jest.fn(),
  useTelegramCoachSettings: jest.fn(),
  useUpdateTelegramCoachSettings: jest.fn(),
}));

const updateMutate = jest.fn();
const removeMutate = jest.fn();

describe('TelegramCoachSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useTelegramCoachSettings).mockReturnValue({
      data: {
        configured: true,
        source: 'database',
        botUsername: 'sparky_bot',
        webhookUrl: 'https://sparky.example.test/api/telegram/webhook',
        databaseTokenStored: true,
      },
      isLoading: false,
    } as ReturnType<typeof useTelegramCoachSettings>);
    jest.mocked(useUpdateTelegramCoachSettings).mockReturnValue({
      mutate: updateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateTelegramCoachSettings>);
    jest.mocked(useRemoveTelegramCoachSettings).mockReturnValue({
      mutate: removeMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useRemoveTelegramCoachSettings>);
  });

  it('shows redacted configuration and submits a replacement token', () => {
    render(<TelegramCoachSettings />);
    fireEvent.click(screen.getByRole('button', { name: /Telegram Coach/i }));

    expect(screen.getByText('@sparky_bot')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/AA-/)).not.toBeInTheDocument();

    const tokenInput = screen.getByLabelText('BotFather token');
    expect(tokenInput).toHaveAttribute('type', 'password');
    fireEvent.change(tokenInput, {
      target: { value: '123456789:AA-replacement-secret-token' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Validate and save token' })
    );

    expect(updateMutate).toHaveBeenCalledWith(
      '123456789:AA-replacement-secret-token',
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('can remove the database token without displaying it', () => {
    render(<TelegramCoachSettings />);
    fireEvent.click(screen.getByRole('button', { name: /Telegram Coach/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved token' }));

    expect(removeMutate).toHaveBeenCalledTimes(1);
  });
});
