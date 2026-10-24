import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TagInput } from '@/components/ui/TagInput';

describe('TagInput', () => {
  it('renders existing tags as badges with remove buttons', () => {
    const onChange = jest.fn();
    render(<TagInput value={['chest', 'triceps']} onChange={onChange} />);

    expect(screen.getByText('chest')).toBeInTheDocument();
    expect(screen.getByText('triceps')).toBeInTheDocument();

    const removeButtons = screen.getAllByRole('button');
    expect(removeButtons).toHaveLength(2);

    const firstButton = removeButtons[0];
    expect(firstButton).toBeDefined();
    if (firstButton) {
      fireEvent.click(firstButton);
    }
    expect(onChange).toHaveBeenCalledWith(['triceps']);
  });

  it('adds a tag on enter and resolves canonical casing', () => {
    const onChange = jest.fn();
    const resolveValue = (input: string) =>
      input.toLowerCase() === 'quads' ? 'quadriceps' : input.trim();

    render(
      <TagInput
        value={['chest']}
        onChange={onChange}
        resolveValue={resolveValue}
        suggestions={['quadriceps', 'hamstrings']}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Quads' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['chest', 'quadriceps']);
  });

  it('shows body map hint when non-canonical tag is present', () => {
    render(
      <TagInput
        value={['chest', 'upper chest area']}
        onChange={jest.fn()}
        isCanonical={(val) => val === 'chest'}
        showBodyMapHint
      />
    );

    expect(
      screen.getByText("Custom muscles won't appear on the body map.")
    ).toBeInTheDocument();
  });

  it('does not show body map hint when all tags are canonical', () => {
    render(
      <TagInput
        value={['chest', 'triceps']}
        onChange={jest.fn()}
        isCanonical={() => true}
        showBodyMapHint
      />
    );

    expect(
      screen.queryByText("Custom muscles won't appear on the body map.")
    ).not.toBeInTheDocument();
  });

  it('splits comma-separated input into multiple resolved tags', () => {
    const onChange = jest.fn();
    const resolveValue = (input: string) => input.trim().toLowerCase();

    render(
      <TagInput
        value={['chest']}
        onChange={onChange}
        resolveValue={resolveValue}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'triceps, shoulders, chest' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['chest', 'triceps', 'shoulders']);
  });
});
