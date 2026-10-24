import { moveItem, resolveKeyOrder } from '../../src/utils/reorderUtils';

describe('moveItem', () => {
  test('moves an item forward in the array', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  test('moves an item backward in the array', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(moveItem(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  test('clamps out-of-bounds destination index', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 99)).toEqual(['b', 'c', 'a']);
    expect(moveItem(list, 2, -5)).toEqual(['c', 'a', 'b']);
  });

  test('returns shallow copy unchanged if fromIndex is invalid', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 10, 0)).toEqual(['a', 'b', 'c']);
  });
});

describe('resolveKeyOrder', () => {
  const registry = ['a', 'b', 'c'] as const;

  test('keeps the saved order and appends keys it does not know yet', () => {
    expect(resolveKeyOrder(['c', 'a'], registry)).toEqual(['c', 'a', 'b']);
  });

  test('drops unknown keys and duplicates', () => {
    expect(resolveKeyOrder(['b', 'zzz', 'b', 'a'], registry)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  test('an empty saved order is the registry order', () => {
    expect(resolveKeyOrder([], registry)).toEqual(['a', 'b', 'c']);
  });
});
