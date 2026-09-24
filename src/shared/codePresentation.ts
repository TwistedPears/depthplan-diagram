import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-java';
import type { TextRun } from './recursiveDocument';
Prism.manual = true;
const colors: Record<string, string> = {
  comment: '#64748b',
  prolog: '#64748b',
  keyword: '#7c3aed',
  boolean: '#7c3aed',
  string: '#047857',
  char: '#047857',
  'attr-value': '#047857',
  number: '#b45309',
  function: '#1d4ed8',
  'class-name': '#1d4ed8',
  tag: '#be123c',
  'attr-name': '#b45309',
  property: '#be123c',
  selector: '#be123c',
  operator: '#475569',
  punctuation: '#475569',
  builtin: '#7c3aed',
};
/** Token text, never generated HTML. Every failure returns the unmodified source. */
export function codeRuns(text: string, language: string): TextRun[] {
  try {
    const grammar = Prism.languages[language];
    if (language === 'plaintext' || !grammar) return [{ text }];
    const runs: TextRun[] = [];
    const visit = (
      tokens: string | Prism.Token | (string | Prism.Token)[],
      color?: string,
    ) => {
      if (typeof tokens === 'string')
        runs.push({ text: tokens, ...(color ? { marks: { color } } : {}) });
      else if (Array.isArray(tokens))
        tokens.forEach((token) => visit(token, color));
      else visit(tokens.content, colors[tokens.type] ?? color);
    };
    visit(Prism.tokenize(text, grammar));
    return runs;
  } catch {
    return [{ text }];
  }
}

const displayed = (text: string) => text.replace(/\r\n?/g, '\n');
/** Map textarea offsets back to exact source offsets so untouched CRLF/LF sequences survive. */
export function replaceCodeRange(
  source: string,
  from: number,
  to: number,
  inserted: string,
) {
  const offset = (position: number) => {
    let at = 0,
      count = 0;
    while (at < source.length && count < position) {
      if (source[at] === '\r' && source[at + 1] === '\n') at++;
      at++;
      count++;
    }
    return at;
  };
  return source.slice(0, offset(from)) + inserted + source.slice(offset(to));
}
export function editCodeText(source: string, next: string) {
  const before = displayed(source);
  if (before === next) return source;
  let start = 0,
    suffix = 0;
  while (
    start < before.length &&
    start < next.length &&
    before[start] === next[start]
  )
    start++;
  while (
    suffix < before.length - start &&
    suffix < next.length - start &&
    before[before.length - suffix - 1] === next[next.length - suffix - 1]
  )
    suffix++;
  const newline = source.match(/\r\n|\r|\n/)?.[0] ?? '\n';
  return replaceCodeRange(
    source,
    start,
    before.length - suffix,
    next.slice(start, next.length - suffix).replace(/\n/g, newline),
  );
}
