import { useEffect, useState } from 'react';

/**
 * Index of the image to show when cycling through `count` images every
 * `intervalMs` — the start/end position photos most library exercises carry
 * read as a movement demo when flipped. One image (or a GIF) stays put.
 */
export function useImageSlideshow(count: number, intervalMs = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (count < 2) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [count, intervalMs]);
  return count > 0 ? tick % count : 0;
}
