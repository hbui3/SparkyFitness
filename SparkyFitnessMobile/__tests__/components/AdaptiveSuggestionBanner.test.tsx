import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import {
  NO_ADAPTIVE_ADJUSTMENT,
  decideAdaptiveAdjustment,
} from '@workspace/shared';
import AdaptiveSuggestionBanner from '../../src/components/AdaptiveSuggestionBanner';

jest.mock('uniwind', () => ({
  useCSSVariable: (keys: string | string[]) =>
    Array.isArray(keys) ? keys.map(() => '#111827') : '#111827',
}));
jest.mock('../../src/components/Icon', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: () => <View /> };
});

const pain = decideAdaptiveAdjustment({
  exercise_id: 'x',
  last_performed_date: '2026-09-24',
  days_since_last_performed: 2,
  last_difficulty: null,
  last_pain: 'exercise',
  too_easy_streak: 0,
  too_hard_streak: 0,
  pain_streak: 1,
  avg_rpe: null,
  avg_rir: null,
  sessions_in_variation_window: 1,
});

describe('AdaptiveSuggestionBanner', () => {
  it('explains the change and offers the usual suggestion and alternatives', () => {
    const onDecline = jest.fn();
    const onSeeAlternatives = jest.fn();
    const screen = render(
      <AdaptiveSuggestionBanner
        adjustment={pain}
        declined={false}
        suggestVariation={false}
        onDecline={onDecline}
        onRestore={jest.fn()}
        onSeeAlternatives={onSeeAlternatives}
      />
    );
    expect(
      screen.getByText('Lighter today: you reported pain here last time.')
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Use my usual'));
    fireEvent.press(screen.getByText('See alternatives'));
    expect(onDecline).toHaveBeenCalled();
    expect(onSeeAlternatives).toHaveBeenCalled();
  });

  it('offers to switch back once declined', () => {
    const onRestore = jest.fn();
    const screen = render(
      <AdaptiveSuggestionBanner
        adjustment={pain}
        declined
        suggestVariation={false}
        onDecline={jest.fn()}
        onRestore={onRestore}
      />
    );
    expect(screen.getByText('Using your usual suggestion.')).toBeTruthy();
    fireEvent.press(screen.getByText('Use the adjusted suggestion'));
    expect(onRestore).toHaveBeenCalled();
  });

  it('shows a variation hint, and nothing at all without a reason', () => {
    const hint = render(
      <AdaptiveSuggestionBanner
        adjustment={NO_ADAPTIVE_ADJUSTMENT}
        declined={false}
        suggestVariation
        onDecline={jest.fn()}
        onRestore={jest.fn()}
        onSeeAlternatives={jest.fn()}
      />
    );
    expect(
      hint.getByText(
        "You've done this in most recent workouts. Try a variation?"
      )
    ).toBeTruthy();
    expect(hint.queryByText('Use my usual')).toBeNull();

    const none = render(
      <AdaptiveSuggestionBanner
        adjustment={NO_ADAPTIVE_ADJUSTMENT}
        declined={false}
        suggestVariation={false}
        onDecline={jest.fn()}
        onRestore={jest.fn()}
      />
    );
    expect(none.queryByTestId('adaptive-suggestion-banner')).toBeNull();
  });
});
