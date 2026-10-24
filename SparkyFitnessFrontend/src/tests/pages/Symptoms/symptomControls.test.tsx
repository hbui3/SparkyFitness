import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChipPicker from '@/pages/Symptoms/ChipPicker';
import SeverityControl from '@/pages/Symptoms/SeverityControl';
import SymptomLocationMap from '@/pages/Symptoms/SymptomLocationMap';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback?: string,
      options?: Record<string, string | number>
    ) =>
      (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        String(options?.[name] ?? '')
      ),
  }),
}));

describe('ChipPicker', () => {
  const items = [
    { label: 'Throbbing', isCustom: false },
    { label: 'Tingling', isCustom: true, optionId: 'opt-1' },
  ];

  it('shows which chips are selected', () => {
    render(
      <ChipPicker items={items} selected={['Throbbing']} onToggle={jest.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Throbbing' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Tingling' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('toggles a chip', () => {
    const onToggle = jest.fn();
    render(<ChipPicker items={items} selected={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Throbbing' }));
    expect(onToggle).toHaveBeenCalledWith('Throbbing');
  });

  it('still shows a selected value that is no longer in the list, so it can be cleared', () => {
    const onToggle = jest.fn();
    render(
      <ChipPicker items={items} selected={['Old option']} onToggle={onToggle} />
    );
    const chip = screen.getByRole('button', { name: 'Old option' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith('Old option');
  });

  it("removes only the user's own options", () => {
    const onRemove = jest.fn();
    render(
      <ChipPicker
        items={items}
        selected={[]}
        onToggle={jest.fn()}
        onRemoveCustom={onRemove}
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Remove Throbbing' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tingling' }));
    expect(onRemove).toHaveBeenCalledWith('opt-1', 'Tingling');
  });

  it('adds a new option with Enter and ignores blank input', () => {
    const onAdd = jest.fn();
    render(
      <ChipPicker
        items={items}
        selected={[]}
        onToggle={jest.fn()}
        onAddCustom={onAdd}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    const input = screen.getByLabelText('New option name');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '  Pins and needles ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith('Pins and needles');
  });

  it('offers no add control when adding is not allowed', () => {
    render(<ChipPicker items={items} selected={[]} onToggle={jest.fn()} />);
    expect(
      screen.queryByRole('button', { name: /^Add$/ })
    ).not.toBeInTheDocument();
  });
});

describe('SeverityControl', () => {
  it('renders nothing for a notes-only symptom', () => {
    const { container } = render(
      <SeverityControl scale="text" value={null} onChange={jest.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers three levels on the mild/moderate/severe scale', () => {
    const onChange = jest.fn();
    render(
      <SeverityControl scale="none-severe" value={2} onChange={onChange} />
    );
    expect(screen.getByRole('button', { name: 'Moderate' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Severe' }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('takes a plain number on a count scale, and allows it to be cleared', () => {
    const onChange = jest.fn();
    render(<SeverityControl scale="count" value={3} onChange={onChange} />);
    const input = screen.getByLabelText('How many times');
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith(5);
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('shows the value and a word for it on a slider scale', () => {
    render(<SeverityControl scale="1-10" value={8} onChange={jest.fn()} />);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Severe')).toBeInTheDocument();
  });

  it('reads a 1 to 5 scale relative to its own top', () => {
    render(<SeverityControl scale="1-5" value={4} onChange={jest.fn()} />);
    expect(screen.getByText('Severe')).toBeInTheDocument();
    expect(screen.getByText('5 worst')).toBeInTheDocument();
  });

  it('starts at the middle of the scale when nothing is chosen', () => {
    render(<SeverityControl scale="1-10" value={null} onChange={jest.fn()} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});

describe('SymptomLocationMap', () => {
  it('toggles the region label the chip list also uses', () => {
    const onToggle = jest.fn();
    render(
      <SymptomLocationMap kind="head" selected={[]} onToggle={onToggle} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Behind left eye' }));
    expect(onToggle).toHaveBeenCalledWith('Behind left eye');
  });

  it('marks selected regions', () => {
    render(
      <SymptomLocationMap
        kind="head"
        selected={['Left temple']}
        onToggle={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Left temple' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Forehead' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('is reachable from the keyboard', () => {
    const onToggle = jest.fn();
    render(
      <SymptomLocationMap kind="head" selected={[]} onToggle={onToggle} />
    );
    const region = screen.getByRole('button', { name: 'Forehead' });
    fireEvent.keyDown(region, { key: 'Enter' });
    fireEvent.keyDown(region, { key: ' ' });
    fireEvent.keyDown(region, { key: 'a' });
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('shows different regions on the back view', () => {
    render(
      <SymptomLocationMap kind="head" selected={[]} onToggle={jest.fn()} />
    );
    expect(
      screen.queryByRole('button', { name: 'Back of head' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('button', { name: 'Back of head' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Forehead' })
    ).not.toBeInTheDocument();
  });

  it('draws the body regions', () => {
    render(
      <SymptomLocationMap kind="body" selected={[]} onToggle={jest.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Chest' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('button', { name: 'Lower back' })
    ).toBeInTheDocument();
  });

  it('tells the user left and right are their own', () => {
    render(
      <SymptomLocationMap kind="head" selected={[]} onToggle={jest.fn()} />
    );
    expect(screen.getByText(/Left and right are yours/)).toBeInTheDocument();
  });
});
