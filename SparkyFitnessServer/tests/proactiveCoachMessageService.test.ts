import { describe, expect, it } from 'vitest';
import type { CoachContextSnapshot } from '../services/coachContextService.js';
import { renderAdaptiveCoachFallback } from '../services/proactiveCoachMessageService.js';
import type { ProactiveCoachOpportunity } from '../types/proactiveCoach.js';
import type { CoachMealSuggestion } from '../services/coachMealSuggestionService.js';

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

const mealSuggestion: CoachMealSuggestion = {
  id: 'chicken-rice-bowl',
  nameDe: 'Hähnchen-Reis-Gemüse-Bowl',
  nameEn: 'Chicken, rice, and vegetable bowl',
  calories: 670,
  proteinG: 56,
  carbsG: 74,
  fatG: 17,
  mealSlots: ['lunch', 'dinner'],
  ingredients: [
    {
      nameDe: 'Hähnchenbrust',
      nameEn: 'chicken breast',
      amount: 180,
      unit: 'g',
      category: 'chilled',
    },
    {
      nameDe: 'Reis, trocken',
      nameEn: 'dry rice',
      amount: 80,
      unit: 'g',
      category: 'pantry',
    },
  ],
  preparationDe: 'Reis kochen und das Hähnchen anbraten.',
  preparationEn: 'Cook the rice and pan-fry the chicken.',
  shoppingServings: 2,
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

  it('turns a nutrition opportunity into an exact meal and shopping instruction', () => {
    const message = renderAdaptiveCoachFallback({
      userId: 'user-1',
      language: 'de',
      deliveryKey: '2026-08-24T17:15',
      snapshot: {} as CoachContextSnapshot,
      opportunity: {
        ...opportunity,
        topic: 'nutrition',
        summaryDe: 'Beim Protein fehlen noch 50 g.',
      },
      recentMessages: [],
      coachingNotes: null,
      routines: [],
      memoryEnabled: true,
      mealSuggestion,
    });

    expect(message).toContain('Hähnchen-Reis-Gemüse-Bowl');
    expect(message).toContain('180 g Hähnchenbrust');
    expect(message).toContain('Zubereitung:');
    expect(message).toContain('Einkauf für 2 Portionen:');
    expect(message).not.toContain('trage es jetzt ein');
  });

  it('asks one safe constraint question instead of inventing an unvalidated meal', () => {
    const message = renderAdaptiveCoachFallback({
      userId: 'user-1',
      language: 'de',
      deliveryKey: '2026-08-24T17:15',
      snapshot: {} as CoachContextSnapshot,
      opportunity: { ...opportunity, topic: 'nutrition' },
      recentMessages: [],
      coachingNotes: null,
      routines: [],
      memoryEnabled: true,
      mealSuggestion: null,
    });

    expect(message).toContain('keine Mahlzeit vorschlagen');
    expect(message).toContain('vollständige Zutatenliste');
    expect(message).not.toContain('Hähnchen');
  });

  it('renders an explicit restock reminder without replacing it with a recipe', () => {
    const message = renderAdaptiveCoachFallback({
      userId: 'user-1',
      language: 'de',
      deliveryKey: '2026-08-24T18:15',
      snapshot: {} as CoachContextSnapshot,
      opportunity: {
        ...opportunity,
        topic: 'nutrition',
        messageDe:
          'Für deine geplanten Mahlzeiten fehlen noch 500 g Reis. Kaufe das heute ein.',
        messageEn: '500 g rice is still missing. Buy it today.',
      },
      recentMessages: [],
      coachingNotes: null,
      routines: [],
      memoryEnabled: true,
      mealSuggestion,
    });

    expect(message).toBe(
      'Für deine geplanten Mahlzeiten fehlen noch 500 g Reis. Kaufe das heute ein.'
    );
  });
});
