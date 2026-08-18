import { beforeEach, describe, expect, it, vi } from 'vitest';
import coachProfileService from '../services/coachProfileService.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import AllergenPreferenceService from '../services/allergenPreferenceService.js';
import coachContextService from '../services/coachContextService.js';

vi.mock('../models/coachProfileRepository.js', () => ({
  default: {
    getCoachProfile: vi.fn(),
    upsertCoachProfile: vi.fn(),
  },
}));

vi.mock('../services/allergenPreferenceService.js', () => ({
  default: {
    getAllergenPreferences: vi.fn(),
  },
}));

vi.mock('../services/coachContextService.js', () => ({
  default: {
    getCanonicalCoachGoals: vi.fn(),
    getCoachContextSnapshot: vi.fn(),
    formatCoachContext: vi.fn(),
  },
}));

const storedProfile = {
  id: 'profile-1',
  user_id: 'user-1',
  enabled: true,
  dietary_pattern: 'vegetarian',
  excluded_ingredients: ['tofu'],
  preferred_ingredients: ['lentils'],
  disliked_ingredients: ['olives'],
  routines: ['meal prep sunday'],
  coaching_notes: 'Keep weekday recipes short.',
  adaptive_check_ins_enabled: true,
  adaptive_last_sent_slot: null,
  daily_check_in_enabled: true,
  daily_check_in_time: '20:00:00',
  weekly_review_enabled: true,
  weekly_review_day: 0,
  weekly_review_time: '18:00:00',
  daily_last_sent_on: null,
  weekly_last_sent_on: null,
  created_at: new Date('2026-08-18T10:00:00.000Z'),
  updated_at: new Date('2026-08-18T10:00:00.000Z'),
};

describe('coachProfileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue(
      storedProfile as never
    );
    vi.mocked(
      AllergenPreferenceService.getAllergenPreferences
    ).mockResolvedValue([
      { allergen_name: 'milk' },
      { allergen_name: 'tree nuts' },
    ] as never);
    vi.mocked(coachContextService.getCanonicalCoachGoals).mockResolvedValue({
      primaryGoal: 'gain_weight',
      calorieTarget: 3000,
      proteinTargetG: 160,
      waterTargetMl: 3000,
    });
    vi.mocked(coachContextService.getCoachContextSnapshot).mockResolvedValue(
      {} as never
    );
    vi.mocked(coachContextService.formatCoachContext).mockReturnValue([
      'Canonical primary goal: gain_weight',
      'Canonical targets for 2026-08-18: 3000 kcal, 160 g protein, 3000 ml water',
      'Today so far: 1800 kcal consumed',
      'Last 7 days: nutrition logged 7/7 days',
      'Last 30 days: weight development +0.8 kg',
    ]);
  });

  it('returns safe defaults before a profile has been saved', async () => {
    vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue(
      undefined
    );

    await expect(
      coachProfileService.getCoachProfile('user-1')
    ).resolves.toEqual(
      expect.objectContaining({
        enabled: true,
        dietaryPattern: 'omnivore',
        excludedIngredients: [],
        updatedAt: null,
      })
    );
  });

  it('normalizes and deduplicates list values before saving', async () => {
    vi.mocked(coachProfileRepository.upsertCoachProfile).mockResolvedValue(
      storedProfile as never
    );

    await coachProfileService.updateCoachProfile('user-1', {
      enabled: true,
      dietaryPattern: 'vegetarian',
      excludedIngredients: [' Tofu ', 'tofu'],
      preferredIngredients: ['Lentils'],
      dislikedIngredients: [],
      routines: ['Meal Prep Sunday'],
      coachingNotes: '',
      adaptiveCheckInsEnabled: true,
      dailyCheckInEnabled: true,
      dailyCheckInTime: '20:00',
      weeklyReviewEnabled: true,
      weeklyReviewDay: 0,
      weeklyReviewTime: '18:00',
    });

    expect(coachProfileRepository.upsertCoachProfile).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        excludedIngredients: ['tofu'],
        preferredIngredients: ['lentils'],
        routines: ['meal prep sunday'],
        coachingNotes: null,
      })
    );
  });

  it('blocks dietary conflicts, explicit exclusions, and allergen aliases', async () => {
    const result = await coachProfileService.validateMealSuggestion('user-1', [
      'Rib-eye steak',
      'smoked tofu',
      'Greek yogurt',
      'almond butter',
      'champignon mushrooms',
    ]);

    expect(result.allowed).toBe(false);
    expect(result.violations.map((violation) => violation.type)).toEqual([
      'dietary_pattern',
      'excluded_ingredient',
      'allergen',
      'allergen',
    ]);
  });

  it('builds compact application-controlled context for every chat turn', async () => {
    const context =
      await coachProfileService.getPersistentChatContext('user-1');

    expect(context).toContain('Dietary pattern: vegetarian');
    expect(context).toContain('Canonical primary goal: gain_weight');
    expect(context).toContain('Today so far: 1800 kcal consumed');
    expect(context).toContain('Last 30 days: weight development +0.8 kg');
    expect(context).toContain('Hard ingredient exclusions: tofu');
    expect(context).toContain('Tracked allergens');
    expect(context).toContain('sparky_validate_meal_suggestion');
  });

  it('skips nutrition and trend queries when the coach profile is disabled', async () => {
    vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue({
      ...storedProfile,
      enabled: false,
    } as never);

    const context =
      await coachProfileService.getPersistentChatContext('user-1');

    expect(coachContextService.getCoachContextSnapshot).not.toHaveBeenCalled();
    expect(context).toContain('Tracked allergens');
    expect(context).not.toContain('Today so far');
  });
});
