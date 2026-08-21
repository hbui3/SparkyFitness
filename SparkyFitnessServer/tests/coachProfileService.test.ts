import { beforeEach, describe, expect, it, vi } from 'vitest';
import coachProfileService from '../services/coachProfileService.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import AllergenPreferenceService from '../services/allergenPreferenceService.js';
import coachContextService from '../services/coachContextService.js';
import coachMemoryService from '../services/coachMemoryService.js';
import trainingFeedbackService from '../services/trainingFeedbackService.js';

vi.mock('../models/coachProfileRepository.js', () => ({
  default: {
    getCoachProfile: vi.fn(),
    getCoachLanguage: vi.fn(),
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
vi.mock('../services/coachMemoryService.js', () => ({
  default: { listActiveMemories: vi.fn() },
}));
vi.mock('../services/trainingFeedbackService.js', () => ({
  default: {
    getTrainingLearningContext: vi.fn(),
    formatTrainingLearningContext: vi.fn(),
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
  memory_enabled: true,
  auto_memory_enabled: false,
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
    vi.mocked(coachProfileRepository.getCoachLanguage).mockResolvedValue('de');
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
    vi.mocked(coachMemoryService.listActiveMemories).mockResolvedValue([]);
    vi.mocked(
      trainingFeedbackService.getTrainingLearningContext
    ).mockResolvedValue({
      suggestedVolumeFactor: 1,
      suggestedRestSecondsDelta: 0,
      recentPainReported: false,
      preferredExercises: [],
      avoidedExercises: [],
      requiredEquipment: [],
      constraints: [],
      preferences: [],
      recentFeedback: [],
    });
    vi.mocked(
      trainingFeedbackService.formatTrainingLearningContext
    ).mockReturnValue([]);
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
      adaptiveStartTime: '07:00',
      adaptiveEndTime: '20:00',
      adaptiveIntervalMinutes: 120,
      proactiveCategories: ['nutrition', 'hydration', 'training', 'recovery'],
      memoryEnabled: true,
      autoMemoryEnabled: false,
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
    expect(context).toContain(
      'Long-term coach memory: enabled; automatic capture: disabled.'
    );
    expect(context).toContain('Automatic long-term memory is disabled.');
    expect(context).toContain('Tracked allergens');
    expect(context).toContain('sparky_validate_meal_suggestion');
  });

  it('injects active memories and automatic capture rules into every chat turn', async () => {
    vi.mocked(coachProfileRepository.getCoachProfile).mockResolvedValue({
      ...storedProfile,
      auto_memory_enabled: true,
    } as never);
    vi.mocked(coachMemoryService.listActiveMemories).mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        category: 'routine',
        content: 'Strength training is Tuesday and Thursday evening.',
        source: 'coach',
        active: true,
        pinned: true,
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
    ]);

    const context =
      await coachProfileService.getPersistentChatContext('user-1');

    expect(context).toContain('automatic capture: enabled');
    expect(context).toContain(
      '- [routine] Strength training is Tuesday and Thursday evening. (pinned)'
    );
    expect(context).toContain(
      'During this turn, call sparky_manage_coach_memory'
    );
  });

  it('injects learned workout feedback and training preferences into every chat turn', async () => {
    vi.mocked(
      trainingFeedbackService.formatTrainingLearningContext
    ).mockReturnValue([
      'Training feedback adaptation: suggested volume factor 0.90; add 15s rest where appropriate; recent pain/discomfort reported: no.',
      'Active training preferences:\n- preference-1: [exercise/prefer] Seated Barbell Row',
    ]);

    const context =
      await coachProfileService.getPersistentChatContext('user-1');

    expect(context).toContain('suggested volume factor 0.90');
    expect(context).toContain('[exercise/prefer] Seated Barbell Row');
    expect(context).toContain('sparky_manage_training_feedback');
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
