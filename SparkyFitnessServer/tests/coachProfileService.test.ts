import { beforeEach, describe, expect, it, vi } from 'vitest';
import coachProfileService from '../services/coachProfileService.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import AllergenPreferenceService from '../services/allergenPreferenceService.js';

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

const storedProfile = {
  id: 'profile-1',
  user_id: 'user-1',
  enabled: true,
  dietary_pattern: 'vegetarian',
  primary_goal: 'Build strength',
  calorie_target: 2200,
  protein_target_g: 140,
  water_target_ml: 2500,
  excluded_ingredients: ['tofu'],
  preferred_ingredients: ['lentils'],
  disliked_ingredients: ['olives'],
  routines: ['meal prep sunday'],
  coaching_notes: 'Keep weekday recipes short.',
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
      primaryGoal: 'Build strength',
      calorieTarget: 2200,
      proteinTargetG: 140,
      waterTargetMl: 2500,
      excludedIngredients: [' Tofu ', 'tofu'],
      preferredIngredients: ['Lentils'],
      dislikedIngredients: [],
      routines: ['Meal Prep Sunday'],
      coachingNotes: '',
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
    expect(context).toContain('Primary goal: Build strength');
    expect(context).toContain('Hard ingredient exclusions: tofu');
    expect(context).toContain('Tracked allergens');
    expect(context).toContain('sparky_validate_meal_suggestion');
  });
});
