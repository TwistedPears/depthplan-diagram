import { codeRuns } from './codePresentation';
import type { RichBlock, TextRun } from './recursiveDocument';
export type TextStyle = Required<
  Pick<NonNullable<TextRun['marks']>, 'font' | 'size' | 'color'>
> &
  NonNullable<TextRun['marks']>;
export type TextPiece = {
  text: string;
  x: number;
  y: number;
  width: number;
  style: TextStyle;
};
export type ContentRule = { x: number; y: number; height: number };
export const defaultTextStyle: TextStyle = {
  font: 'Arial',
  size: 12,
  color: '#334155',
};
export const textFont = (s: TextStyle) =>
  `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.size}px ${s.font}`;

/** Derived text geometry shared by the canvas and flattened export. Never changes source or object size. */
export function layoutRichContent(
  blocks: RichBlock[],
  width: number,
  measure: (text: string, style: TextStyle) => number,
  height = Infinity,
) {
  const pieces: TextPiece[] = [],
    rules: ContentRule[] = [];
  let y = 0;
  const paragraph = (
    runs: TextRun[],
    left: number,
    style: TextStyle,
    align = 'left',
    wrap = true,
  ) => {
    const available = Math.max(1, width - left);
    let line: TextPiece[] = [],
      x = 0,
      lineHeight = style.size * 1.3;
    const flush = (last: boolean) => {
      const offset =
        align === 'center'
          ? (available - x) / 2
          : align === 'right'
            ? available - x
            : 0;
      const spaces = line.filter((p) => /^ +$/.test(p.text)).length;
      const extra =
        align === 'justify' && !last && spaces
          ? Math.max(0, available - x) / spaces
          : 0;
      let shift = 0;
      for (const p of line) {
        pieces.push({
          ...p,
          x: p.x + offset + shift,
          y: y + lineHeight - p.style.size * 1.3,
        });
        if (/^ +$/.test(p.text)) shift += extra;
      }
      y += lineHeight;
      line = [];
      x = 0;
      lineHeight = style.size * 1.3;
    };
    for (const run of runs) {
      const s = { ...style, ...run.marks };
      for (const token of run.text.match(/\r\n|\r|\n|[^\S\r\n]+|[^\s]+/gu) ??
        []) {
        if (y >= height) return;
        if (/^[\r\n]+$/.test(token)) {
          flush(true);
          continue;
        }
        const tokenWidth = measure(token, s);
        // Break a single overlong word at grapheme boundaries, retaining Unicode sequences.
        const parts =
          wrap && tokenWidth > available
            ? Array.from(
                new Intl.Segmenter(undefined, {
                  granularity: 'grapheme',
                }).segment(token),
                (segment) => segment.segment,
              )
            : [token];
        for (const text of parts) {
          if (y >= height) return;
          const w = parts.length === 1 ? tokenWidth : measure(text, s);
          if (wrap && x > 0 && x + w > available) flush(false);
          line.push({ text, x: left + x, y, width: w, style: s });
          x += w;
          lineHeight = Math.max(lineHeight, s.size * 1.3);
        }
      }
    }
    flush(true);
    y += 6;
  };
  const visit = (values: RichBlock[], left: number) => {
    for (const block of values) {
      if (y >= height) return;
      if (block.type === 'list') {
        block.items.forEach((item, at) => {
          const text = block.ordered ? `${(block.start ?? 1) + at}.` : '•';
          pieces.push({
            text,
            x: left,
            y,
            width: measure(text, defaultTextStyle),
            style: defaultTextStyle,
          });
          visit(item, left + 24);
        });
      } else if (block.type === 'quote') {
        const start = y;
        visit(block.blocks, left + 16);
        rules.push({
          x: left + 3,
          y: start,
          height: Math.max(0, y - start - 6),
        });
      } else if (block.type === 'code') {
        let column = 0;
        const runs = codeRuns(block.text, block.language).map((run) => ({
          ...run,
          text: run.text.replace(/\r\n|\r|\n|\t|[^\r\n\t]/gu, (c) => {
            if (/^[\r\n]/.test(c)) {
              column = 0;
              return '\n';
            }
            if (c === '\t') {
              const spaces = 4 - (column % 4);
              column += spaces;
              return ' '.repeat(spaces);
            }
            column++;
            return c;
          }),
        }));
        paragraph(
          runs,
          left,
          { ...defaultTextStyle, font: 'monospace' },
          'left',
          block.wrap ?? false,
        );
      } else
        paragraph(
          block.runs,
          left,
          block.type === 'heading'
            ? {
                ...defaultTextStyle,
                bold: true,
                size: [24, 20, 18, 16, 14, 12][block.level - 1],
              }
            : defaultTextStyle,
          block.align,
        );
    }
  };
  visit(blocks, 0);
  // A word is a layout unit, not a required canvas node. Keep wrapping and
  // justification positions, but paint adjacent ASCII words in one text run.
  // Other scripts retain their original shaping boundaries.
  const painted: TextPiece[] = [];
  for (const piece of pieces) {
    const previous = painted.at(-1);
    if (
      previous &&
      previous.style === piece.style &&
      previous.y === piece.y &&
      Math.abs(previous.x + previous.width - piece.x) < 0.001 &&
      /^[\x20-\x7e]*$/.test(previous.text + piece.text)
    ) {
      previous.text += piece.text;
      previous.width += piece.width;
    } else painted.push(piece);
  }
  return { pieces: painted, rules, height: y };
}
