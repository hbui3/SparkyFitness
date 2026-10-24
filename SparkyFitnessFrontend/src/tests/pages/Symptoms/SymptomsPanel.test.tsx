import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SymptomsPanel from '@/pages/Symptoms/SymptomsPanel';

const useMedications = jest.fn();
const hasPermission = jest.fn();

jest.mock('@/hooks/useMedications', () => ({
  useMedications: (...args: unknown[]) => useMedications(...args),
}));

jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ hasPermission }),
}));

// Only the hand-off matters here; the hub has its own tests.
jest.mock('@/pages/Symptoms/SymptomsHub', () => ({
  __esModule: true,
  default: (props: { meds: { id: string }[]; selectedDate: string }) => (
    <div data-testid="hub">
      {props.selectedDate}:{props.meds.map((m) => m.id).join(',')}
    </div>
  ),
}));

beforeEach(() => {
  useMedications.mockReset();
  hasPermission.mockReset();
});

describe('SymptomsPanel', () => {
  it('loads medications for someone who may see them', () => {
    hasPermission.mockReturnValue(true);
    useMedications.mockReturnValue({ data: [{ id: 'm1' }] });
    render(
      <SymptomsPanel selectedDate="2026-09-29" onDateChange={jest.fn()} />
    );
    expect(hasPermission).toHaveBeenCalledWith('can_manage_medications');
    expect(useMedications).toHaveBeenCalledWith(
      { activeOnly: true },
      { enabled: true }
    );
    expect(screen.getByTestId('hub')).toHaveTextContent('2026-09-29:m1');
  });

  it('does not request medications for a delegate who has only the symptoms permission', () => {
    hasPermission.mockReturnValue(false);
    useMedications.mockReturnValue({ data: undefined });
    render(
      <SymptomsPanel selectedDate="2026-09-29" onDateChange={jest.fn()} />
    );
    expect(useMedications).toHaveBeenCalledWith(
      { activeOnly: true },
      { enabled: false }
    );
    expect(screen.getByTestId('hub')).toHaveTextContent('2026-09-29:');
  });
});
