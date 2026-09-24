export const hatchPath = (cross: boolean) =>
  `M-1 13L13 -1${cross ? 'M-1 -1L13 13' : ''}`;

/** One repeating tile; shape clipping and exports use the same hatch geometry. */
export function hatchTile(fillType: unknown, color: string) {
  if (fillType !== 'hachure' && fillType !== 'cross-hatch') return undefined;
  const tile = document.createElement('canvas');
  tile.width = tile.height = 12;
  const context = tile.getContext('2d')!;
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.stroke(new Path2D(hatchPath(fillType === 'cross-hatch')));
  return tile;
}
