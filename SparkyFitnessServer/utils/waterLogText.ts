const WATER_WORD_PATTERN = /\b(?:wasser|water)\b/i;

const BARE_WATER_VOLUME_PATTERN =
  /^\s*\d+(?:[.,]\d+)?\s*(?:ml|milliliter|millilitres?|l|liter|litre|litres?)\s*[.!;,]?\s*$/i;

/**
 * A named water statement or a message containing only one metric volume is
 * safe to route as water. A named drink such as "300 ml milk" is deliberately
 * excluded from the shorthand rule and stays in the food flow.
 */
export function isWaterLogText(text: string): boolean {
  return WATER_WORD_PATTERN.test(text) || BARE_WATER_VOLUME_PATTERN.test(text);
}
