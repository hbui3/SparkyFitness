import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';

import { ReorderSwitchRow } from '../../src/components/ReorderSwitchRow';
import { initializeI18n } from '../../src/localization/i18n';

jest.mock('../../src/components/Icon', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <View testID={`icon-${name}`} />,
  };
});

const Harness: React.FC<{
  isEnabled: boolean;
  onToggle?: (val: boolean) => void;
  onMove?: (from: number, to: number) => void;
  onConfigure?: () => void;
  subtitle?: string;
}> = ({
  isEnabled,
  onToggle = jest.fn(),
  onMove = jest.fn(),
  onConfigure,
  subtitle,
}) => {
  const activeDragIndex = useSharedValue(-1);
  const panY = useSharedValue(0);
  const committingTranslate = useSharedValue(0);
  const targetIndex = useSharedValue(-1);

  return (
    <ReorderSwitchRow
      testID="test-row"
      dragHandleTestID="test-drag-handle"
      switchTestID="test-switch"
      index={1}
      lastIndex={3}
      title="Test Item"
      subtitle={subtitle}
      isEnabled={isEnabled}
      onToggle={onToggle}
      onMove={onMove}
      onConfigure={onConfigure}
      configureTestID="test-configure"
      configureA11yLabel="Configure Test Item"
      rowHeight={72}
      reorderA11yLabel="Reorder Test Item"
      reorderA11yHint="Reorder test hint"
      activeDragIndex={activeDragIndex}
      panY={panY}
      committingTranslate={committingTranslate}
      targetIndex={targetIndex}
      strides={[72, 72, 72, 72]}
    />
  );
};

describe('ReorderSwitchRow', () => {
  beforeAll(async () => {
    await initializeI18n('en');
  });

  test('renders title, subtitle, switch, and drag handle', () => {
    render(<Harness isEnabled subtitle="Test Subtitle" />);

    expect(screen.getByText('Test Item')).toBeTruthy();
    expect(screen.getByText('Test Subtitle')).toBeTruthy();
    expect(screen.getByTestId('test-switch')).toBeTruthy();
    expect(screen.getByTestId('test-drag-handle')).toBeTruthy();
  });

  test('toggling the switch fires onToggle callback', () => {
    const onToggle = jest.fn();
    render(<Harness isEnabled onToggle={onToggle} />);

    fireEvent(screen.getByTestId('test-switch'), 'valueChange', false);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  test('accessibility increment action moves down', () => {
    const onMove = jest.fn();
    render(<Harness isEnabled onMove={onMove} />);

    fireEvent(screen.getByTestId('test-drag-handle'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(onMove).toHaveBeenCalledWith(1, 2);
  });

  test('accessibility decrement action moves up', () => {
    const onMove = jest.fn();
    render(<Harness isEnabled onMove={onMove} />);

    fireEvent(screen.getByTestId('test-drag-handle'), 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    expect(onMove).toHaveBeenCalledWith(1, 0);
  });

  test('calls onConfigure when configure button is pressed', () => {
    const onConfigure = jest.fn();
    render(<Harness isEnabled onConfigure={onConfigure} />);

    const configBtn = screen.getByTestId('test-configure');
    expect(configBtn).toBeTruthy();

    fireEvent.press(configBtn);
    expect(onConfigure).toHaveBeenCalled();
  });
});
