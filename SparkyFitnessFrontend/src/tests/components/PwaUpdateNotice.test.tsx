import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PwaUpdateNotice from '@/components/PwaUpdateNotice';

jest.mock('@/utils/pwaReleaseRefresh', () => ({
  isPwaUpdateAvailable: () => true,
  subscribeToPwaUpdate: () => () => undefined,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

it('keeps an update pending until the user explicitly confirms and allows returning to unsaved work', () => {
  render(<PwaUpdateNotice />);
  expect(screen.getByRole('status')).toHaveTextContent('Save your work');
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent(
    'Unsaved changes will be lost'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toBeInTheDocument();
});
