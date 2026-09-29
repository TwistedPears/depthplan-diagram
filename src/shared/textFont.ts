export const genericFonts = ['sans-serif', 'serif', 'monospace'];
const fallback = 'Arial, Helvetica, "Liberation Sans", sans-serif';

/** Keep authored names/stacks; CSS chooses an installed family on each OS. */
export function fontFamily(font: string) {
  if (font.endsWith(fallback)) return font;
  const family =
    font.includes(',') || /^['"]/.test(font) || genericFonts.includes(font)
      ? font
      : JSON.stringify(font);
  return `${family}, ${fallback}`;
}
