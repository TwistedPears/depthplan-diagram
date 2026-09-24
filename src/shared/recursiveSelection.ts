import type { Bounds } from './recursiveCamera';
export function toggleSelection(
  selection: string[],
  id: string,
  additive: boolean,
) {
  return !additive
    ? [id]
    : selection.includes(id)
      ? selection.filter((item) => item !== id)
      : [...selection, id];
}
/** Left-to-right contains; right-to-left crosses, matching the existing desktop gesture. */
export function marqueeSelection(
  boxes: Map<string, Bounds>,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const left = Math.min(start.x, end.x),
    right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y),
    bottom = Math.max(start.y, end.y);
  return [...boxes]
    .filter(([, b]) =>
      end.x < start.x
        ? b.x <= right &&
          b.x + b.width >= left &&
          b.y <= bottom &&
          b.y + b.height >= top
        : b.x >= left &&
          b.x + b.width <= right &&
          b.y >= top &&
          b.y + b.height <= bottom,
    )
    .map(([id]) => id);
}
