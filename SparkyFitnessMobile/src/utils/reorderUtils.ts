/**
 * Moves one item in an array using remove-then-insert semantics.
 *
 * The destination index is clamped within bounds, and out-of-bounds source
 * lookups return a shallow copy unchanged.
 */
export function moveItem<T>(
  array: readonly T[],
  fromIndex: number,
  toIndex: number
): T[] {
  const item = array[fromIndex];
  if (item === undefined) return [...array];

  const remaining = array.filter((_, idx) => idx !== fromIndex);
  const insertIndex = Math.max(0, Math.min(toIndex, remaining.length));

  return [
    ...remaining.slice(0, insertIndex),
    item,
    ...remaining.slice(insertIndex),
  ];
}

/**
 * A saved order of keys, reconciled against the registry it was saved from.
 *
 * Keys the saved order does not know about (added to the registry after it was
 * written) are appended in registry order, so registering a new key never needs
 * a store migration. Keys that no longer exist, and duplicates from a corrupted
 * write, are dropped.
 */
export function resolveKeyOrder<K extends string>(
  savedOrder: readonly string[],
  registry: readonly K[]
): K[] {
  const isKey = (value: string): value is K =>
    (registry as readonly string[]).includes(value);
  const resolvedOrder: K[] = [];
  const seenKeys = new Set<K>();

  for (const key of savedOrder) {
    if (!isKey(key) || seenKeys.has(key)) continue;
    seenKeys.add(key);
    resolvedOrder.push(key);
  }

  for (const key of registry) {
    if (seenKeys.has(key)) continue;
    resolvedOrder.push(key);
  }

  return resolvedOrder;
}
