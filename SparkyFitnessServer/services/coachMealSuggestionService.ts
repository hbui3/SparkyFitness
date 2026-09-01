import { createHash } from 'node:crypto';
import type {
  CoachDietaryPattern,
  CoachProfileResponse,
} from '@workspace/shared';
import coachProfileService from './coachProfileService.js';

export type CoachMealIngredientUnit = 'g' | 'ml' | 'piece' | 'tbsp' | 'tsp';

export type CoachMealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type CoachShoppingCategory = 'chilled' | 'produce' | 'pantry' | 'frozen';

export const MIN_COACH_MEAL_CALORIES = 450;
const MAX_TARGET_CALORIE_OVERSHOOT_RATIO = 1.15;

export const COACH_MEAL_INGREDIENT_QUESTIONS = {
  de: 'Welches konkrete Gericht kannst du sicher essen? Nenne bitte die vollständige Zutatenliste, damit ich sie prüfen kann.',
  en: 'Which specific dish can you safely eat? Please provide its complete ingredient list so I can validate it.',
} as const;

export interface CoachMealIngredient {
  nameDe: string;
  nameEn: string;
  amount: number;
  unit: CoachMealIngredientUnit;
  category: CoachShoppingCategory;
  shoppingRequired?: boolean;
}

export interface CoachMealSuggestion {
  id: string;
  nameDe: string;
  nameEn: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  mealSlots: CoachMealSlot[];
  ingredients: CoachMealIngredient[];
  preparationDe: string;
  preparationEn: string;
  shoppingServings: number;
}

export interface CoachMealTargets {
  caloriesRemaining: number | null;
  proteinRemainingG: number | null;
}

export interface CoachShoppingListItem extends CoachMealIngredient {
  mealIds: string[];
}

export interface CoachMealSuggestionPayload {
  id: string;
  name_de: string;
  name_en: string;
  servings_to_prepare: number;
  estimated_calories_per_serving: number;
  estimated_protein_g_per_serving: number;
  estimated_carbs_g_per_serving: number;
  estimated_fat_g_per_serving: number;
  meal_slots: CoachMealSlot[];
  ingredients_per_serving: Array<{
    ingredient_key: string;
    name_de: string;
    name_en: string;
    amount: number;
    unit: CoachMealIngredientUnit;
    category: CoachShoppingCategory;
    shopping_required: boolean;
  }>;
  preparation_de: string;
  preparation_en: string;
}

export interface CoachShoppingListPayload {
  category: CoachShoppingCategory;
  name_de: string;
  name_en: string;
  amount: number;
  unit: CoachMealIngredientUnit;
  for_meals: string[];
}

interface CoachMealTemplateIngredient extends CoachMealIngredient {
  safetyTerms?: readonly string[];
}

interface CoachMealTemplate extends Omit<
  CoachMealSuggestion,
  'shoppingServings' | 'ingredients' | 'mealSlots'
> {
  dietaryPatterns: readonly CoachDietaryPattern[];
  mealSlots: readonly CoachMealSlot[];
  ingredients: readonly CoachMealTemplateIngredient[];
}

const ALL_PATTERNS: readonly CoachDietaryPattern[] = [
  'omnivore',
  'pescatarian',
  'vegetarian',
  'vegan',
  'other',
];

const VEGETARIAN_PATTERNS: readonly CoachDietaryPattern[] = [
  'omnivore',
  'pescatarian',
  'vegetarian',
];

const PESCATARIAN_PATTERNS: readonly CoachDietaryPattern[] = [
  'omnivore',
  'pescatarian',
];

const MEAL_TEMPLATES: readonly CoachMealTemplate[] = [
  {
    id: 'chicken-rice-bowl',
    nameDe: 'Hähnchen-Reis-Gemüse-Bowl',
    nameEn: 'Chicken, rice, and vegetable bowl',
    calories: 680,
    proteinG: 53,
    carbsG: 76,
    fatG: 17,
    mealSlots: ['lunch', 'dinner'],
    dietaryPatterns: ['omnivore'],
    ingredients: [
      {
        nameDe: 'Hähnchenbrust',
        nameEn: 'chicken breast',
        amount: 180,
        unit: 'g',
        category: 'chilled',
        safetyTerms: ['Hähnchen', 'chicken'],
      },
      {
        nameDe: 'Reis, trocken',
        nameEn: 'dry rice',
        amount: 80,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'TK-Brokkoli',
        nameEn: 'frozen broccoli',
        amount: 150,
        unit: 'g',
        category: 'frozen',
      },
      {
        nameDe: 'Karotten',
        nameEn: 'carrots',
        amount: 100,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Rapsöl',
        nameEn: 'rapeseed oil',
        amount: 10,
        unit: 'ml',
        category: 'pantry',
      },
      {
        nameDe: 'Paprikapulver',
        nameEn: 'paprika',
        amount: 1,
        unit: 'tsp',
        category: 'pantry',
      },
    ],
    preparationDe:
      'Reis kochen. Hähnchen mit Paprika würzen und anbraten, Brokkoli und Karotten dazugeben und alles mit dem Reis in eine Schüssel geben.',
    preparationEn:
      'Cook the rice. Season the chicken with paprika and pan-fry it, add the broccoli and carrots, then serve everything in one bowl.',
  },
  {
    id: 'turkey-potato-pan',
    nameDe: 'Puten-Kartoffel-Pfanne',
    nameEn: 'Turkey and potato skillet',
    calories: 640,
    proteinG: 58,
    carbsG: 65,
    fatG: 16,
    mealSlots: ['lunch', 'dinner'],
    dietaryPatterns: ['omnivore'],
    ingredients: [
      {
        nameDe: 'Putenbrust',
        nameEn: 'turkey breast',
        amount: 200,
        unit: 'g',
        category: 'chilled',
        safetyTerms: ['Pute', 'turkey'],
      },
      {
        nameDe: 'Kartoffeln',
        nameEn: 'potatoes',
        amount: 350,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Paprika',
        nameEn: 'bell pepper',
        amount: 150,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Blattspinat',
        nameEn: 'spinach',
        amount: 100,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Olivenöl',
        nameEn: 'olive oil',
        amount: 10,
        unit: 'ml',
        category: 'pantry',
      },
    ],
    preparationDe:
      'Kartoffeln würfeln und gar braten. Pute und Paprika dazugeben, zum Schluss den Spinat kurz zusammenfallen lassen.',
    preparationEn:
      'Dice and cook the potatoes until tender. Add turkey and pepper, then wilt in the spinach at the end.',
  },
  {
    id: 'salmon-potato-tray',
    nameDe: 'Lachs-Kartoffel-Blech mit Brokkoli',
    nameEn: 'Salmon, potato, and broccoli tray bake',
    calories: 790,
    proteinG: 49,
    carbsG: 61,
    fatG: 38,
    mealSlots: ['lunch', 'dinner'],
    dietaryPatterns: PESCATARIAN_PATTERNS,
    ingredients: [
      {
        nameDe: 'Lachsfilet',
        nameEn: 'salmon fillet',
        amount: 180,
        unit: 'g',
        category: 'chilled',
        safetyTerms: ['Lachs', 'Fisch', 'salmon', 'fish'],
      },
      {
        nameDe: 'Kartoffeln',
        nameEn: 'potatoes',
        amount: 320,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Brokkoli',
        nameEn: 'broccoli',
        amount: 250,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Olivenöl',
        nameEn: 'olive oil',
        amount: 10,
        unit: 'ml',
        category: 'pantry',
      },
      {
        nameDe: 'Zitrone',
        nameEn: 'lemon',
        amount: 0.5,
        unit: 'piece',
        category: 'produce',
      },
    ],
    preparationDe:
      'Kartoffeln 20 Minuten vorbacken. Lachs und Brokkoli dazugeben, mit Öl und Zitrone würzen und weitere 15 Minuten garen.',
    preparationEn:
      'Roast the potatoes for 20 minutes. Add salmon and broccoli, season with oil and lemon, and cook for 15 more minutes.',
  },
  {
    id: 'skyr-oat-bowl',
    nameDe: 'Skyr-Hafer-Bowl mit Beeren',
    nameEn: 'Skyr oat bowl with berries',
    calories: 680,
    proteinG: 55,
    carbsG: 101,
    fatG: 7,
    mealSlots: ['breakfast', 'snack'],
    dietaryPatterns: VEGETARIAN_PATTERNS,
    ingredients: [
      {
        nameDe: 'Skyr natur',
        nameEn: 'plain skyr',
        amount: 400,
        unit: 'g',
        category: 'chilled',
        safetyTerms: ['Milch', 'milk', 'dairy'],
      },
      {
        nameDe: 'Haferflocken',
        nameEn: 'rolled oats',
        amount: 70,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'TK-Beeren',
        nameEn: 'frozen berries',
        amount: 150,
        unit: 'g',
        category: 'frozen',
      },
      {
        nameDe: 'Banane',
        nameEn: 'banana',
        amount: 1,
        unit: 'piece',
        category: 'produce',
      },
      {
        nameDe: 'Zimt',
        nameEn: 'cinnamon',
        amount: 0.5,
        unit: 'tsp',
        category: 'pantry',
      },
    ],
    preparationDe:
      'Skyr und Haferflocken verrühren. Beeren kurz auftauen, Banane schneiden und beides mit Zimt daraufgeben.',
    preparationEn:
      'Mix the skyr and oats. Briefly thaw the berries, slice the banana, and add both with cinnamon.',
  },
  {
    id: 'magerquark-oat-bowl',
    nameDe: 'Magerquark-Hafer-Bowl',
    nameEn: 'Low-fat quark oat bowl',
    calories: 650,
    proteinG: 51,
    carbsG: 96,
    fatG: 7,
    mealSlots: ['breakfast', 'snack'],
    dietaryPatterns: VEGETARIAN_PATTERNS,
    ingredients: [
      {
        nameDe: 'Magerquark',
        nameEn: 'low-fat quark',
        amount: 350,
        unit: 'g',
        category: 'chilled',
        safetyTerms: ['Magerquark', 'Quark', 'Milch', 'milk', 'dairy'],
      },
      {
        nameDe: 'Haferflocken',
        nameEn: 'rolled oats',
        amount: 60,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'TK-Beeren',
        nameEn: 'frozen berries',
        amount: 150,
        unit: 'g',
        category: 'frozen',
      },
      {
        nameDe: 'Banane',
        nameEn: 'banana',
        amount: 1,
        unit: 'piece',
        category: 'produce',
      },
    ],
    preparationDe:
      'Magerquark und Haferflocken verrühren. Beeren kurz auftauen, Banane schneiden und beides daraufgeben.',
    preparationEn:
      'Mix the low-fat quark and oats. Briefly thaw the berries, slice the banana, and add both on top.',
  },
  {
    id: 'egg-cottage-cheese-potatoes',
    nameDe: 'Kartoffel-Ei-Pfanne mit Hüttenkäse',
    nameEn: 'Potato and egg skillet with cottage cheese',
    calories: 730,
    proteinG: 52,
    carbsG: 65,
    fatG: 29,
    mealSlots: ['breakfast', 'lunch', 'dinner'],
    dietaryPatterns: VEGETARIAN_PATTERNS,
    ingredients: [
      {
        nameDe: 'Eier',
        nameEn: 'eggs',
        amount: 3,
        unit: 'piece',
        category: 'chilled',
        safetyTerms: ['Ei', 'egg'],
      },
      {
        nameDe: 'Hüttenkäse',
        nameEn: 'cottage cheese',
        amount: 200,
        unit: 'g',
        category: 'chilled',
        safetyTerms: ['Käse', 'cheese', 'Milch', 'milk', 'dairy'],
      },
      {
        nameDe: 'Kartoffeln',
        nameEn: 'potatoes',
        amount: 300,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Tomaten',
        nameEn: 'tomatoes',
        amount: 180,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Rapsöl',
        nameEn: 'rapeseed oil',
        amount: 5,
        unit: 'ml',
        category: 'pantry',
      },
    ],
    preparationDe:
      'Kartoffeln würfeln und anbraten. Eier und Tomaten dazugeben, stocken lassen und mit Hüttenkäse servieren.',
    preparationEn:
      'Dice and pan-fry the potatoes. Add eggs and tomatoes, cook until set, and serve with cottage cheese.',
  },
  {
    id: 'tofu-edamame-rice',
    nameDe: 'Tofu-Edamame-Reis-Bowl',
    nameEn: 'Tofu, edamame, and rice bowl',
    calories: 740,
    proteinG: 51,
    carbsG: 78,
    fatG: 24,
    mealSlots: ['lunch', 'dinner'],
    dietaryPatterns: ALL_PATTERNS,
    ingredients: [
      {
        nameDe: 'Naturtofu',
        nameEn: 'plain tofu',
        amount: 200,
        unit: 'g',
        category: 'chilled',
        safetyTerms: ['Soja', 'soy'],
      },
      {
        nameDe: 'Edamame, geschält',
        nameEn: 'shelled edamame',
        amount: 100,
        unit: 'g',
        category: 'frozen',
        safetyTerms: ['Soja', 'soy'],
      },
      {
        nameDe: 'Reis, trocken',
        nameEn: 'dry rice',
        amount: 60,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'TK-Brokkoli',
        nameEn: 'frozen broccoli',
        amount: 150,
        unit: 'g',
        category: 'frozen',
      },
      {
        nameDe: 'Karotten',
        nameEn: 'carrots',
        amount: 100,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Tamari',
        nameEn: 'tamari',
        amount: 15,
        unit: 'ml',
        category: 'pantry',
        safetyTerms: ['Soja', 'soy'],
      },
    ],
    preparationDe:
      'Reis kochen. Tofu knusprig anbraten, Edamame, Brokkoli und Karotten erhitzen und alles mit Tamari in einer Bowl anrichten.',
    preparationEn:
      'Cook the rice. Pan-fry the tofu until crisp, heat the edamame, broccoli, and carrots, then assemble with tamari.',
  },
  {
    id: 'lentil-tomato-soup',
    nameDe: 'Rote-Linsen-Tomaten-Suppe',
    nameEn: 'Red lentil and tomato soup',
    calories: 480,
    proteinG: 29,
    carbsG: 65,
    fatG: 12,
    mealSlots: ['lunch', 'dinner'],
    dietaryPatterns: ALL_PATTERNS,
    ingredients: [
      {
        nameDe: 'Rote Linsen, trocken',
        nameEn: 'dry red lentils',
        amount: 80,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'Passierte Tomaten',
        nameEn: 'tomato passata',
        amount: 250,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'Blattspinat',
        nameEn: 'spinach',
        amount: 150,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Karotten',
        nameEn: 'carrots',
        amount: 100,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Rapsöl',
        nameEn: 'rapeseed oil',
        amount: 5,
        unit: 'ml',
        category: 'pantry',
      },
      {
        nameDe: 'Kreuzkümmel',
        nameEn: 'cumin',
        amount: 1,
        unit: 'tsp',
        category: 'pantry',
      },
      {
        nameDe: 'Wasser',
        nameEn: 'water',
        amount: 400,
        unit: 'ml',
        category: 'pantry',
        shoppingRequired: false,
      },
    ],
    preparationDe:
      'Linsen, Tomaten und gewürfelte Karotten mit Wasser 15 Minuten köcheln. Spinat und Kreuzkümmel unterrühren und mit Rapsöl abschließen.',
    preparationEn:
      'Simmer the lentils, passata, and diced carrots with water for 15 minutes. Stir in spinach and cumin, then finish with rapeseed oil.',
  },
  {
    id: 'red-lentil-curry',
    nameDe: 'Rotes Linsen-Curry mit Reis',
    nameEn: 'Red lentil curry with rice',
    calories: 690,
    proteinG: 37,
    carbsG: 110,
    fatG: 11,
    mealSlots: ['lunch', 'dinner'],
    dietaryPatterns: ALL_PATTERNS,
    ingredients: [
      {
        nameDe: 'Rote Linsen, trocken',
        nameEn: 'dry red lentils',
        amount: 100,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'Reis, trocken',
        nameEn: 'dry rice',
        amount: 65,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'Passierte Tomaten',
        nameEn: 'tomato passata',
        amount: 250,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'Blattspinat',
        nameEn: 'spinach',
        amount: 150,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Kurkuma',
        nameEn: 'turmeric',
        amount: 1,
        unit: 'tsp',
        category: 'pantry',
      },
      {
        nameDe: 'Kreuzkümmel',
        nameEn: 'cumin',
        amount: 1,
        unit: 'tsp',
        category: 'pantry',
      },
      {
        nameDe: 'Wasser',
        nameEn: 'water',
        amount: 300,
        unit: 'ml',
        category: 'pantry',
        shoppingRequired: false,
      },
    ],
    preparationDe:
      'Reis separat kochen. Linsen mit Tomaten, Wasser, Kurkuma und Kreuzkümmel 15 Minuten köcheln, Spinat unterheben und mit Reis servieren.',
    preparationEn:
      'Cook the rice separately. Simmer lentils with passata, water, turmeric, and cumin for 15 minutes, fold in spinach, and serve with rice.',
  },
  {
    id: 'chickpea-quinoa-bowl',
    nameDe: 'Kichererbsen-Quinoa-Bowl',
    nameEn: 'Chickpea quinoa bowl',
    calories: 750,
    proteinG: 31,
    carbsG: 101,
    fatG: 23,
    mealSlots: ['lunch', 'dinner'],
    dietaryPatterns: ALL_PATTERNS,
    ingredients: [
      {
        nameDe: 'Kichererbsen, abgetropft',
        nameEn: 'drained chickpeas',
        amount: 220,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'Quinoa, trocken',
        nameEn: 'dry quinoa',
        amount: 75,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'Gurke',
        nameEn: 'cucumber',
        amount: 150,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Tomaten',
        nameEn: 'tomatoes',
        amount: 180,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Olivenöl',
        nameEn: 'olive oil',
        amount: 10,
        unit: 'ml',
        category: 'pantry',
      },
      {
        nameDe: 'Zitrone',
        nameEn: 'lemon',
        amount: 0.5,
        unit: 'piece',
        category: 'produce',
      },
    ],
    preparationDe:
      'Quinoa kochen. Mit Kichererbsen, Gurke und Tomaten mischen und mit Öl und Zitrone abschmecken.',
    preparationEn:
      'Cook the quinoa. Mix with chickpeas, cucumber, and tomatoes, then dress with oil and lemon.',
  },
  {
    id: 'white-bean-potato-skillet',
    nameDe: 'Weiße-Bohnen-Kartoffel-Pfanne',
    nameEn: 'White bean and potato skillet',
    calories: 710,
    proteinG: 29,
    carbsG: 105,
    fatG: 18,
    mealSlots: ['lunch', 'dinner'],
    dietaryPatterns: ALL_PATTERNS,
    ingredients: [
      {
        nameDe: 'Weiße Bohnen, abgetropft',
        nameEn: 'drained white beans',
        amount: 250,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'Kartoffeln',
        nameEn: 'potatoes',
        amount: 320,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Zucchini',
        nameEn: 'zucchini',
        amount: 200,
        unit: 'g',
        category: 'produce',
      },
      {
        nameDe: 'Passierte Tomaten',
        nameEn: 'tomato passata',
        amount: 200,
        unit: 'g',
        category: 'pantry',
      },
      {
        nameDe: 'Olivenöl',
        nameEn: 'olive oil',
        amount: 10,
        unit: 'ml',
        category: 'pantry',
      },
    ],
    preparationDe:
      'Kartoffeln würfeln und anbraten. Zucchini, Bohnen und Tomaten dazugeben und 10 Minuten gemeinsam köcheln lassen.',
    preparationEn:
      'Dice and pan-fry the potatoes. Add zucchini, beans, and passata, then simmer everything together for 10 minutes.',
  },
];

const SHOPPING_CATEGORY_LABELS: Record<
  CoachShoppingCategory,
  { de: string; en: string }
> = {
  chilled: { de: 'Kühlregal', en: 'Chilled' },
  produce: { de: 'Obst & Gemüse', en: 'Produce' },
  pantry: { de: 'Vorrat', en: 'Pantry' },
  frozen: { de: 'Tiefkühl', en: 'Frozen' },
};

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const COACH_INGREDIENT_QUALIFIERS = new Set([
  'abgetropft',
  'drained',
  'dry',
  'frozen',
  'gefroren',
  'geschaelt',
  'geschalt',
  'natur',
  'plain',
  'shelled',
  'tiefgekuehlt',
  'tiefgekuhlt',
  'tiefkuhl',
  'tk',
  'trocken',
]);

const COACH_INGREDIENT_KEY_ALIASES: Readonly<Record<string, string>> = {
  'chicken-breast': 'hahnchenbrust',
  'low-fat-quark': 'magerquark',
  broccoli: 'brokkoli',
  egg: 'eier',
  eggs: 'eier',
  gemusemix: 'gemusemischung',
  'gemuse-mischung': 'gemusemischung',
  'mixed-vegetables': 'gemusemischung',
  oats: 'haferflocken',
  pouletbrust: 'hahnchenbrust',
  rice: 'reis',
  'rolled-oats': 'haferflocken',
  tofu: 'naturtofu',
  'tofu-nature': 'naturtofu',
};

export function coachIngredientKey(name: string): string {
  const key = normalizeText(name)
    .split(' ')
    .filter((part) => part.length > 0 && !COACH_INGREDIENT_QUALIFIERS.has(part))
    .join('-');
  return COACH_INGREDIENT_KEY_ALIASES[key] ?? key;
}

function ingredientText(template: CoachMealTemplate): string {
  return normalizeText(
    template.ingredients
      .flatMap((ingredient) => [ingredient.nameDe, ingredient.nameEn])
      .join(' ')
  );
}

function containsProfileTerm(
  template: CoachMealTemplate,
  term: string
): boolean {
  const normalizedTerm = normalizeText(term);
  return (
    normalizedTerm.length > 0 &&
    ingredientText(template).includes(normalizedTerm)
  );
}

function seededValue(seed: string, templateId: string): number {
  return createHash('sha256')
    .update(`${seed}:${templateId}`)
    .digest()
    .readUInt32BE(0);
}

function targetProtein(targets: CoachMealTargets): number {
  const remaining = targets.proteinRemainingG;
  if (remaining === null || remaining <= 0) return 35;
  return Math.min(55, Math.max(28, remaining));
}

function targetCalories(targets: CoachMealTargets): number {
  const remaining = targets.caloriesRemaining;
  if (remaining === null) return 650;
  return Math.min(750, Math.max(MIN_COACH_MEAL_CALORIES, remaining));
}

function templateScore(
  template: CoachMealTemplate,
  profile: CoachProfileResponse,
  targets: CoachMealTargets,
  seed: string
): number {
  const proteinDistance = Math.abs(template.proteinG - targetProtein(targets));
  const calorieDistance = Math.abs(template.calories - targetCalories(targets));
  const preferredMatches = profile.preferredIngredients.filter((term) =>
    containsProfileTerm(template, term)
  ).length;
  const varietyBoost = seededValue(seed, template.id) % 46;
  return (
    preferredMatches * 80 -
    proteinDistance * 3 -
    calorieDistance / 25 +
    varietyBoost
  );
}

function templateMatchesProfile(
  template: CoachMealTemplate,
  profile: CoachProfileResponse
): boolean {
  return (
    template.dietaryPatterns.includes(profile.dietaryPattern) &&
    !profile.dislikedIngredients.some((term) =>
      containsProfileTerm(template, term)
    )
  );
}

function candidateTemplates(
  profile: CoachProfileResponse,
  targets: CoachMealTargets,
  seed: string
): CoachMealTemplate[] {
  const calorieCeiling =
    targets.caloriesRemaining === null
      ? null
      : targets.caloriesRemaining * MAX_TARGET_CALORIE_OVERSHOOT_RATIO;
  return MEAL_TEMPLATES.filter(
    (template) =>
      templateMatchesProfile(template, profile) &&
      (calorieCeiling === null || template.calories <= calorieCeiling)
  ).sort((left, right) => {
    const scoreDifference =
      templateScore(right, profile, targets, seed) -
      templateScore(left, profile, targets, seed);
    return scoreDifference === 0
      ? seededValue(seed, left.id) - seededValue(seed, right.id)
      : scoreDifference;
  });
}

function completeSuggestion(template: CoachMealTemplate): CoachMealSuggestion {
  return {
    id: template.id,
    nameDe: template.nameDe,
    nameEn: template.nameEn,
    calories: template.calories,
    proteinG: template.proteinG,
    carbsG: template.carbsG,
    fatG: template.fatG,
    mealSlots: [...template.mealSlots],
    ingredients: template.ingredients.map((ingredient) => ({
      nameDe: ingredient.nameDe,
      nameEn: ingredient.nameEn,
      amount: ingredient.amount,
      unit: ingredient.unit,
      category: ingredient.category,
      shoppingRequired: ingredient.shoppingRequired,
    })),
    preparationDe: template.preparationDe,
    preparationEn: template.preparationEn,
    shoppingServings: 2,
  };
}

async function isCoachMealTemplateSafe(
  userId: string,
  template: CoachMealTemplate
): Promise<boolean> {
  const validation = await coachProfileService.validateMealSuggestion(
    userId,
    template.ingredients.map((ingredient) =>
      [
        ingredient.nameDe,
        ingredient.nameEn,
        ...(ingredient.safetyTerms ?? []),
      ].join(' / ')
    )
  );
  return validation.allowed;
}

export async function getCoachMealSuggestions(
  userId: string,
  targets: CoachMealTargets,
  seed: string,
  limit = 1
): Promise<CoachMealSuggestion[]> {
  if (
    targets.caloriesRemaining !== null &&
    targets.caloriesRemaining < MIN_COACH_MEAL_CALORIES
  ) {
    return [];
  }
  const profile = await coachProfileService.getCoachProfile(userId);
  const suggestions: CoachMealSuggestion[] = [];
  for (const template of candidateTemplates(profile, targets, seed)) {
    if (!(await isCoachMealTemplateSafe(userId, template))) continue;
    suggestions.push(completeSuggestion(template));
    if (suggestions.length >= Math.max(1, limit)) break;
  }
  return suggestions;
}

export async function getCoachMealSuggestion(
  userId: string,
  targets: CoachMealTargets,
  seed: string
): Promise<CoachMealSuggestion | null> {
  return (await getCoachMealSuggestions(userId, targets, seed, 1))[0] ?? null;
}

export async function getCoachMealCatalog(
  userId: string,
  mealSlot?: CoachMealSlot
): Promise<CoachMealSuggestion[]> {
  const profile = await coachProfileService.getCoachProfile(userId);
  const suggestions: CoachMealSuggestion[] = [];
  for (const template of MEAL_TEMPLATES) {
    if (!templateMatchesProfile(template, profile)) continue;
    if (mealSlot !== undefined && !template.mealSlots.includes(mealSlot)) {
      continue;
    }
    if (!(await isCoachMealTemplateSafe(userId, template))) continue;
    suggestions.push(completeSuggestion(template));
  }
  return suggestions;
}

export async function getCoachMealSuggestionById(
  userId: string,
  recipeKey: string
): Promise<CoachMealSuggestion | null> {
  const template = MEAL_TEMPLATES.find(({ id }) => id === recipeKey);
  if (!template) return null;

  const profile = await coachProfileService.getCoachProfile(userId);
  if (!templateMatchesProfile(template, profile)) return null;
  if (!(await isCoachMealTemplateSafe(userId, template))) return null;
  return completeSuggestion(template);
}

export function buildCoachShoppingList(
  suggestions: readonly CoachMealSuggestion[],
  servingsByMealId: Readonly<Record<string, number>> = {}
): CoachShoppingListItem[] {
  const items = new Map<string, CoachShoppingListItem>();
  for (const suggestion of suggestions) {
    const servings =
      servingsByMealId[suggestion.id] ?? suggestion.shoppingServings;
    for (const ingredient of suggestion.ingredients) {
      if (ingredient.shoppingRequired === false) continue;
      const key = [
        coachIngredientKey(ingredient.nameDe),
        ingredient.unit,
        ingredient.category,
      ].join(':');
      const existing = items.get(key);
      if (existing) {
        existing.amount += ingredient.amount * servings;
        if (!existing.mealIds.includes(suggestion.id)) {
          existing.mealIds.push(suggestion.id);
        }
        continue;
      }
      items.set(key, {
        ...ingredient,
        amount: ingredient.amount * servings,
        mealIds: [suggestion.id],
      });
    }
  }
  return [...items.values()].sort((left, right) => {
    const categoryDifference = left.category.localeCompare(right.category);
    return categoryDifference || left.nameDe.localeCompare(right.nameDe, 'de');
  });
}

function localizedUnit(
  unit: CoachMealIngredientUnit,
  language: string
): string {
  const de = language.toLowerCase().startsWith('de');
  switch (unit) {
    case 'piece':
      return de ? 'Stück' : 'pc';
    case 'tbsp':
      return de ? 'EL' : 'tbsp';
    case 'tsp':
      return de ? 'TL' : 'tsp';
    default:
      return unit;
  }
}

function formattedAmount(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(1)));
}

function renderIngredient(
  ingredient: CoachMealIngredient,
  language: string,
  multiplier = 1
): string {
  const de = language.toLowerCase().startsWith('de');
  return `${formattedAmount(ingredient.amount * multiplier)} ${localizedUnit(ingredient.unit, language)} ${de ? ingredient.nameDe : ingredient.nameEn}`;
}

export function renderCoachMealSuggestion(
  suggestion: CoachMealSuggestion,
  language: string,
  mode: 'next' | 'meal-prep' = 'next'
): string[] {
  const de = language.toLowerCase().startsWith('de');
  const name = de ? suggestion.nameDe : suggestion.nameEn;
  const ingredients = suggestion.ingredients
    .map((ingredient) => renderIngredient(ingredient, language))
    .join(', ');
  const shopping = (
    Object.keys(SHOPPING_CATEGORY_LABELS) as CoachShoppingCategory[]
  )
    .map((category) => {
      const entries = suggestion.ingredients
        .filter(
          (ingredient) =>
            ingredient.category === category &&
            ingredient.shoppingRequired !== false
        )
        .map((ingredient) =>
          renderIngredient(ingredient, language, suggestion.shoppingServings)
        );
      if (entries.length === 0) return null;
      const label = de
        ? SHOPPING_CATEGORY_LABELS[category].de
        : SHOPPING_CATEGORY_LABELS[category].en;
      return `${label}: ${entries.join(', ')}`;
    })
    .filter((entry): entry is string => entry !== null)
    .join('; ');

  return de
    ? [
        mode === 'meal-prep'
          ? `Plane **${name}** als Meal-Prep ein (ca. ${suggestion.calories} kcal, ${suggestion.proteinG} g Protein, ${suggestion.carbsG} g Kohlenhydrate und ${suggestion.fatG} g Fett pro Portion).`
          : `Iss als Nächstes **${name}** (ca. ${suggestion.calories} kcal, ${suggestion.proteinG} g Protein, ${suggestion.carbsG} g Kohlenhydrate, ${suggestion.fatG} g Fett).`,
        `Für eine Portion: ${ingredients}.`,
        `Zubereitung: ${suggestion.preparationDe}`,
        `Einkauf für ${suggestion.shoppingServings} Portionen: ${shopping}.`,
      ]
    : [
        mode === 'meal-prep'
          ? `Plan **${name}** for meal prep (about ${suggestion.calories} kcal, ${suggestion.proteinG} g protein, ${suggestion.carbsG} g carbs, and ${suggestion.fatG} g fat per serving).`
          : `Eat **${name}** next (about ${suggestion.calories} kcal, ${suggestion.proteinG} g protein, ${suggestion.carbsG} g carbs, and ${suggestion.fatG} g fat).`,
        `For one serving: ${ingredients}.`,
        `Preparation: ${suggestion.preparationEn}`,
        `Shopping for ${suggestion.shoppingServings} servings: ${shopping}.`,
      ];
}

export function toCoachMealSuggestionPayload(
  suggestion: CoachMealSuggestion
): CoachMealSuggestionPayload {
  return {
    id: suggestion.id,
    name_de: suggestion.nameDe,
    name_en: suggestion.nameEn,
    servings_to_prepare: suggestion.shoppingServings,
    estimated_calories_per_serving: suggestion.calories,
    estimated_protein_g_per_serving: suggestion.proteinG,
    estimated_carbs_g_per_serving: suggestion.carbsG,
    estimated_fat_g_per_serving: suggestion.fatG,
    meal_slots: [...suggestion.mealSlots],
    ingredients_per_serving: suggestion.ingredients.map((ingredient) => ({
      ingredient_key: coachIngredientKey(ingredient.nameDe),
      name_de: ingredient.nameDe,
      name_en: ingredient.nameEn,
      amount: ingredient.amount,
      unit: ingredient.unit,
      category: ingredient.category,
      shopping_required: ingredient.shoppingRequired !== false,
    })),
    preparation_de: suggestion.preparationDe,
    preparation_en: suggestion.preparationEn,
  };
}

export function toCoachShoppingListPayload(
  items: readonly CoachShoppingListItem[]
): CoachShoppingListPayload[] {
  return items.map((item) => ({
    category: item.category,
    name_de: item.nameDe,
    name_en: item.nameEn,
    amount: item.amount,
    unit: item.unit,
    for_meals: item.mealIds,
  }));
}

export default {
  coachIngredientKey,
  getCoachMealCatalog,
  getCoachMealSuggestion,
  getCoachMealSuggestionById,
  getCoachMealSuggestions,
  buildCoachShoppingList,
  renderCoachMealSuggestion,
  toCoachMealSuggestionPayload,
  toCoachShoppingListPayload,
};
