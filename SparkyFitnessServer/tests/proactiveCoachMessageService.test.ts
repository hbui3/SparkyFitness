import { describe, expect, it } from 'vitest';
import type { CoachContextSnapshot } from '../services/coachContextService.js';
import { renderAdaptiveCoachFallback } from '../services/proactiveCoachMessageService.js';
import type { ProactiveCoachOpportunity } from '../types/proactiveCoach.js';

const opportunity: ProactiveCoachOpportunity = {
  topic: 'training',
  score: 88,
  tone: 'push',
  summaryDe: 'Dein passendes Training wartet noch auf dich.',
  summaryEn: 'Your best-fit workout is still waiting for you.',
  actionDe: 'Lege jetzt eine konkrete Startzeit fest.',
  actionEn: 'Set a concrete start time now.',
  stateSignature: 'training-state',
};

describe('proactiveCoachMessageService fallback', () => {
  it('uses varied, human wording without dashboard headings', () => {
    const messages = new Set(
      Array.from({ length: 12 }, (_, index) =>
        renderAdaptiveCoachFallback({
          userId: 'user-1',
          language: 'de',
          deliveryKey: `2026-08-24T${String(index + 7).padStart(2, '0')}:15`,
          snapshot: {} as CoachContextSnapshot,
          opportunity,
          recentMessages: [],
          coachingNotes: null,
          routines: [],
          memoryEnabled: true,
        })
      )
    );

    expect(messages.size).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message).not.toMatch(/^#+\s/);
      expect(message).toContain('Startzeit');
    }
  });

  it('chooses a different fallback when the seeded variant was used recently', () => {
    const input = {
      userId: 'user-1',
      language: 'de',
      deliveryKey: '2026-08-24T17:15',
      snapshot: {} as CoachContextSnapshot,
      opportunity,
      recentMessages: [],
      coachingNotes: null,
      routines: [],
      memoryEnabled: true,
    };
    const first = renderAdaptiveCoachFallback(input);
    const second = renderAdaptiveCoachFallback({
      ...input,
      recentMessages: [
        {
          content: first,
          topic: 'training',
          stateSignature: 'older-state',
          createdAt: '2026-08-24T12:00:00.000Z',
        },
      ],
    });

    expect(second).not.toBe(first);
  });
});
