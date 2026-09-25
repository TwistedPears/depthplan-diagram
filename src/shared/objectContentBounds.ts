import type { DiagramObject } from './recursiveDocument';

export const CHILD_CONTROL_SPACE = 40;

/** Object-local text bounds, independent of the camera and editor controls. */
export function objectContentBounds(
  object: DiagramObject,
  width: number,
  height: number,
  hasChildren: boolean,
) {
  const inset =
    object.type === 'ellipse' ? 0.15 : object.type === 'diamond' ? 0.25 : 0;
  const textX = Math.max(6, width * inset);
  const textY = Math.max(4, height * inset);
  const titleHeight = hasChildren ? CHILD_CONTROL_SPACE : object.name ? 24 : 0;
  const textWidth = Math.max(0, width - 2 * textX);
  const textHeight = Math.max(0, height - 2 * textY);
  return {
    title: {
      x: -width / 2 + textX,
      y: -height / 2 + textY,
      width: Math.max(0, textWidth - (hasChildren ? CHILD_CONTROL_SPACE : 0)),
      height: Math.min(20, textHeight),
    },
    body: {
      x: -width / 2 + textX,
      y: -height / 2 + textY + titleHeight,
      width: textWidth,
      height: Math.max(0, textHeight - titleHeight),
    },
  };
}
