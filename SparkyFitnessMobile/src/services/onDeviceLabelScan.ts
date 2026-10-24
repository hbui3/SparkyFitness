import OnDeviceNutritionModule, {
  type OnDeviceLabelExtraction,
} from '../../modules/on-device-nutrition';
import type { LabelScanResult } from './api/externalFoodSearchApi';
import { addLog } from './LogService';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';

const MAX_CALORIES = 3000;
const MAX_GRAMS = 500;
const MAX_MG = 20000;
// Atwater energy from macros may differ from the printed value (rounding,
// fiber, sugar alcohols), so allow a generous band before distrusting it.
const ENERGY_TOLERANCE = 0.35;

export function isOnDeviceLabelScanAvailable(): boolean {
  try {
    return OnDeviceNutritionModule?.isAvailable() === true;
  } catch {
    return false;
  }
}

function inRange(value: number | null, max: number): boolean {
  return (
    value === null || (Number.isFinite(value) && value >= 0 && value <= max)
  );
}

/**
 * Rejects a model extraction that cannot be a real label so the caller falls
 * back to the server instead of pre-filling invented numbers.
 */
export function isPlausibleLabel(r: OnDeviceLabelExtraction): boolean {
  const { calories, protein, carbs, fat, sugars, fiber } = r;
  if (calories === null || protein === null || carbs === null || fat === null) {
    return false;
  }
  if (!inRange(calories, MAX_CALORIES)) return false;
  for (const g of [
    protein,
    carbs,
    fat,
    sugars,
    fiber,
    r.saturated_fat,
    r.trans_fat,
  ]) {
    if (!inRange(g, MAX_GRAMS)) return false;
  }
  for (const mg of [r.sodium, r.cholesterol, r.potassium, r.calcium, r.iron]) {
    if (!inRange(mg, MAX_MG)) return false;
  }
  if (sugars !== null && sugars > carbs + 0.5) return false;
  if (fiber !== null && fiber > carbs + 0.5) return false;
  if (r.saturated_fat !== null && r.saturated_fat > fat + 0.5) return false;
  const atwater = protein * 4 + carbs * 4 + fat * 9;
  if (calories > 20 && atwater > 0) {
    if (
      Math.abs(calories - atwater) / Math.max(calories, atwater) >
      ENERGY_TOLERANCE
    ) {
      return false;
    }
  }
  return true;
}

// Units a per-100 basis can be read in when the label counts liquids by volume.
const VOLUME_UNITS = new Set(['ml', 'l', 'cl', 'dl', 'oz', 'fl oz', 'cup']);

// A comma between groups of three ("1,000", "12,345.5") is a thousands
// separator; any other comma ("1,5", "0,500") is a decimal comma.
const NUMBER_PATTERN = /[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?/g;

function parsePrintedNumber(printed: string): number {
  return Number(
    /^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/.test(printed)
      ? printed.replace(/,/g, '')
      : printed.replace(',', '.')
  );
}

const NUTRIENT_LABELS: { key: string; pattern: RegExp }[] = [
  { key: 'serving_size', pattern: /\b(?:serving|portion)\s+size\b/gi },
  { key: 'calories', pattern: /\b(?:calories?|energy)\b/gi },
  { key: 'protein', pattern: /\bproteins?\b/gi },
  { key: 'carbs', pattern: /\b(?:carbohydrates?|carbs?)\b/gi },
  { key: 'fat', pattern: /\bfat\b/gi },
  { key: 'fiber', pattern: /\b(?:dietary\s+)?fiber\b/gi },
  { key: 'saturated_fat', pattern: /\bsaturated\s+fat\b/gi },
  { key: 'trans_fat', pattern: /\btrans\s+fat\b/gi },
  { key: 'sodium', pattern: /\bsodium\b/gi },
  { key: 'added_sugars', pattern: /\badded\s+sugars?\b/gi },
  { key: 'sugars', pattern: /\b(?:total\s+)?sugars?\b/gi },
  { key: 'cholesterol', pattern: /\bcholesterol\b/gi },
  { key: 'potassium', pattern: /\bpotassium\b/gi },
  { key: 'calcium', pattern: /\bcalcium\b/gi },
  { key: 'iron', pattern: /\biron\b/gi },
];

function nutrientHits(text: string): { key: string; index: number }[] {
  const hits: { key: string; index: number }[] = [];
  for (const { key, pattern } of NUTRIENT_LABELS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (
        key === 'sugars' &&
        /\badded\s+$/.test(
          text.slice(Math.max(0, index - 16), index).toLowerCase()
        )
      ) {
        continue;
      }
      if (key === 'fat') {
        const before = text.slice(Math.max(0, index - 16), index).toLowerCase();
        if (/(?:saturated|trans)\s*$/.test(before)) continue;
      }
      hits.push({ key, index });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

function printedNumbers(text: string): number[] {
  return (text.match(NUMBER_PATTERN) ?? [])
    .map(parsePrintedNumber)
    .filter((value) => Number.isFinite(value));
}

/** Numbers printed beside this nutrient, up to the next nutrient or line end. */
function numbersBeside(text: string, key: string): number[] {
  const hits = nutrientHits(text);
  const hit = hits.find((item) => item.key === key);
  if (!hit) return [];
  const next = hits.find((item) => item.index > hit.index);
  let end = next?.index ?? text.length;
  const newline = text.indexOf('\n', hit.index);
  if (newline >= 0 && newline < end) end = newline;
  return printedNumbers(text.slice(hit.index, end));
}

/**
 * Which column is per 100 g/ml when the label prints both. Null when the
 * header does not say, so a one-column label is left alone.
 */
function per100ColumnIsFirst(text: string): boolean | null {
  const lower = text.toLowerCase();
  const per100 = lower.search(/\b100\s*(?:g|ml)\b/);
  const serving = lower.search(/\b(?:serving|portion)\b/);
  if (per100 < 0 || serving < 0) return null;
  return per100 < serving;
}

/**
 * True when every macro the model returned is the number printed beside that
 * nutrient, and every one of them comes from the same column. A per-serving
 * size, and any optional nutrient the model filled in, must be printed too.
 * With no text read there is nothing to check, so the server scan takes over.
 */
export function isGroundedInLabelText(r: OnDeviceLabelExtraction): boolean {
  const text = r.ocr_text?.trim();
  if (!text) return false;
  if (
    !r.values_are_per_100 &&
    typeof r.serving_size === 'number' &&
    r.serving_size > 0 &&
    !numbersBeside(text, 'serving_size').includes(r.serving_size)
  ) {
    return false;
  }
  const optionalFields: [string, number | null][] = [
    ['fiber', r.fiber],
    ['saturated_fat', r.saturated_fat],
    ['trans_fat', r.trans_fat],
    ['sodium', r.sodium],
    ['sugars', r.sugars],
    ['cholesterol', r.cholesterol],
    ['potassium', r.potassium],
    ['calcium', r.calcium],
    ['iron', r.iron],
  ];
  for (const [key, value] of optionalFields) {
    if (value !== null && !numbersBeside(text, key).includes(value)) {
      return false;
    }
  }
  const per100First = per100ColumnIsFirst(text);
  const fields: [string, number | null][] = [
    ['calories', r.calories],
    ['protein', r.protein],
    ['carbs', r.carbs],
    ['fat', r.fat],
  ];
  const columnIndexes: number[] = [];
  for (const [key, value] of fields) {
    if (value === null) continue;
    const numbers = numbersBeside(text, key);
    if (numbers.length === 0) return false;
    if (per100First !== null && numbers.length >= 2) {
      const index = r.values_are_per_100 === per100First ? 0 : 1;
      if (numbers[index] !== value) return false;
    } else {
      const index = numbers.indexOf(value);
      if (index < 0) return false;
      if (numbers.length >= 2) columnIndexes.push(index);
    }
  }
  return (
    columnIndexes.length === 0 ||
    columnIndexes.every((index) => index === columnIndexes[0])
  );
}

export function toLabelScanResult(r: OnDeviceLabelExtraction): LabelScanResult {
  const unit = (r.serving_unit ?? '').trim().toLowerCase();
  // Per-100 labels: the printed numbers are for 100 of the unit.
  const per100 = r.values_are_per_100;
  return {
    name: r.name,
    brand: r.brand,
    serving_size: per100 ? 100 : (r.serving_size ?? 0),
    serving_unit: per100 ? (VOLUME_UNITS.has(unit) ? 'ml' : 'g') : unit || 'g',
    calories: r.calories ?? 0,
    protein: r.protein ?? 0,
    carbs: r.carbs ?? 0,
    fat: r.fat ?? 0,
    fiber: r.fiber,
    saturated_fat: r.saturated_fat,
    trans_fat: r.trans_fat,
    sodium: r.sodium,
    sugars: r.sugars,
    cholesterol: r.cholesterol,
    potassium: r.potassium,
    calcium: r.calcium,
    iron: r.iron,
    caffeine_mg: null,
    water_ml: null,
    alcohol_g: null,
    vitamin_a: null,
    vitamin_c: null,
  };
}

/**
 * Reads a nutrition label with Apple's on-device model. Returns null whenever
 * the on-device path is unavailable, fails, or returns implausible numbers;
 * the caller then uses the server-side scan.
 */
export async function scanLabelOnDevice(
  base64Image: string
): Promise<LabelScanResult | null> {
  if (!useAppPreferencesStore.getState().onDeviceLabelScanEnabled) return null;
  if (!OnDeviceNutritionModule || !isOnDeviceLabelScanAvailable()) return null;
  try {
    const extraction = await OnDeviceNutritionModule.scanLabel(base64Image);
    if (!isGroundedInLabelText(extraction)) {
      addLog(
        '[Label Scan] On-device values not found in the label text; falling back',
        'INFO'
      );
      return null;
    }
    if (!isPlausibleLabel(extraction)) {
      addLog('[Label Scan] On-device result implausible; falling back', 'INFO');
      return null;
    }
    if (
      !extraction.values_are_per_100 &&
      !(
        typeof extraction.serving_size === 'number' &&
        extraction.serving_size > 0
      )
    ) {
      addLog(
        '[Label Scan] On-device result has no serving size; falling back',
        'INFO'
      );
      return null;
    }
    return toLabelScanResult(extraction);
  } catch (error) {
    addLog(
      `[Label Scan] On-device scan failed: ${error instanceof Error ? error.message : String(error)}`,
      'WARNING'
    );
    return null;
  }
}
