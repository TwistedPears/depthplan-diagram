import { textFont, type TextStyle } from './richContentLayout';

let context: CanvasRenderingContext2D | null | undefined;
/** The canvas metric the renderer paints with. Without a canvas (jsdom, Node), a
 * deterministic average glyph width keeps layout, overflow and growth testable. */
export function measureText(text: string, style: TextStyle) {
  if (context === undefined)
    context =
      typeof document === 'undefined' ||
      globalThis.navigator?.userAgent.includes('jsdom')
        ? null
        : document.createElement('canvas').getContext('2d');
  if (!context) return text.length * style.size * 0.6;
  context.font = textFont(style);
  return context.measureText(text).width;
}
