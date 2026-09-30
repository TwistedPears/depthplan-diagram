import { type TextRun, validLink } from './recursiveDocument';

const barePattern = /^(?:https?:\/\/|www\.|mailto:)/i;
function bareLink(text: string) {
  const url = /^www\./i.test(text) ? `https://${text}` : text;
  return barePattern.test(text) && validLink(url) ? url : undefined;
}
function trimURLPunctuation(text: string) {
  let url = text.replace(/[.,;:!?]+$/, '');
  const extra =
    (url.match(/\)/g)?.length ?? 0) - (url.match(/\(/g)?.length ?? 0);
  if (extra > 0)
    url = url.slice(
      0,
      url.length - Math.min(extra, url.match(/\)+$/)?.[0].length ?? 0),
    );
  return url;
}
export const escapeLinkText = (text: string) =>
  text.replace(/[\\[\]|]/g, '\\$&');

/** Links are source text while editing; adjacent styled runs share one wrapper. */
export function expandInlineLinks(runs: TextRun[]): TextRun[] {
  const result: TextRun[] = [];
  for (let at = 0; at < runs.length; at++) {
    const run = runs[at],
      url = run.marks?.link;
    if (!url) {
      result.push(run);
      continue;
    }
    const group = [run];
    while (runs[at + 1]?.marks?.link === url) group.push(runs[++at]);
    const label = group.map((part) => part.text).join('');
    const bare = trimURLPunctuation(label) === label && bareLink(label) === url;
    group.forEach((part, index) => {
      const { link: _link, ...marks } = part.marks!;
      result.push({
        text: bare
          ? part.text
          : `${index === 0 ? '[' : ''}${escapeLinkText(part.text)}${index === group.length - 1 ? ` | ${escapeLinkText(url)}]` : ''}`,
        ...(Object.keys(marks).length ? { marks } : {}),
      });
    });
  }
  return result;
}

/** Parse across style boundaries; invalid URLs remain literal text. */
export function parseInlineLinks(runs: TextRun[]): TextRun[] {
  const text = runs.map((run) => run.text).join('');
  const tokens =
    /\[((?:\\.|[^[\]\\|])+?) ?\|\s*((?:\\.|[^\]\\\r\n])+)\]|\b(?:https?:\/\/|www\.|mailto:)(?:\[[^\]\s]*\]|[^\s<>"[\]])+/gi;
  const result: TextRun[] = [];
  let runAt = 0,
    offset = 0,
    written = 0;
  const append = (from: number, to: number, link?: string, decode = false) => {
    let escaped = false;
    while (runAt < runs.length && offset < to) {
      const run = runs[runAt],
        end = offset + run.text.length;
      if (end > from) {
        const start = Math.max(from, offset),
          stop = Math.min(to, end);
        let part = text.slice(start, stop);
        if (decode) {
          part = '';
          for (let i = start; i < stop; i++) {
            if (
              !escaped &&
              text[i] === '\\' &&
              /[\\[\]|]/.test(text[i + 1] ?? '')
            ) {
              escaped = true;
              continue;
            }
            escaped = false;
            part += text[i];
          }
        }
        if (part)
          result.push({
            text: part,
            ...(run.marks || link
              ? { marks: { ...run.marks, ...(link ? { link } : {}) } }
              : {}),
          });
      }
      if (end > to) break;
      offset = end;
      runAt++;
    }
  };
  let linkedEnd = 0;
  const existing = runs.flatMap((run) => {
    const start = linkedEnd;
    linkedEnd += run.text.length;
    return run.marks?.link ? [[start, linkedEnd]] : [];
  });
  for (const match of text.matchAll(tokens)) {
    const start = match.index!;
    if (
      existing.some(
        ([from, to]) => start < to && start + match[0].length > from,
      )
    )
      continue;
    const url = match[2]
      ? match[2].trim().replace(/\\([\\[\]|])/g, '$1')
      : trimURLPunctuation(match[0]);
    const link = match[1] ? (validLink(url) ? url : undefined) : bareLink(url);
    if (!link) continue;
    append(written, start);
    if (match[1]) {
      append(start + 1, start + 1 + match[1].length, link, true);
      written = start + match[0].length;
    } else {
      append(start, start + url.length, link);
      written = start + url.length;
    }
  }
  append(written, text.length);
  return result;
}
