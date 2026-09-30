import { expandInlineLinks, parseInlineLinks } from '../shared/inlineLinks';
import { layoutRichContent } from '../shared/richContentLayout';
import {
  fromEditorContent,
  toEditorContent,
} from '../renderer/utils/richTextEditor';
import { pastedContent } from '../renderer/components/RichTextEditor';
import { richSchema } from '../renderer/utils/richTextEditor';
import type { RichBlock, TextRun } from '../shared/recursiveDocument';

it('links bare URLs and labeled syntax across text formatting boundaries', () => {
  const runs = parseInlineLinks([
    { text: 'See [our ' },
    { text: 'docs', marks: { bold: true } },
    { text: ' | https://example.com/docs] and https://exam' },
    {
      text: 'ple.com/path(foo)). Next: www.example.com!',
      marks: { italic: true },
    },
  ]);
  expect(runs.map((run) => run.text).join('')).toBe(
    'See our docs and https://example.com/path(foo)). Next: www.example.com!',
  );
  expect(runs.find((run) => run.text === 'docs')?.marks).toEqual({
    bold: true,
    link: 'https://example.com/docs',
  });
  expect(runs.find((run) => run.text === 'https://exam')?.marks?.link).toBe(
    'https://example.com/path(foo)',
  );
  expect(runs.find((run) => run.text === 'www.example.com')?.marks?.link).toBe(
    'https://www.example.com',
  );
});

it.each([
  'javascript:alert(1)',
  'data:text/html,bad',
  'file:///secret',
  'https://user:pass@example.com',
  'https://',
])('keeps an unsafe or invalid destination literal: %s', (url) => {
  const runs = [{ text: `[label | ${url}]` }];
  expect(parseInlineLinks(runs)).toEqual(runs);
});

it.each([
  'label',
  ' leading and trailing ',
  'a [b] | c',
  'a\\[b]\\c',
  '日本語',
  'two\nlines',
  'https://example.com/end.',
])('round-trips a linked label without losing its text: %s', (text) => {
  const runs = [
    { text, marks: { bold: true, link: 'https://example.com/a?q=[1]' } },
  ];
  expect(parseInlineLinks(expandInlineLinks(runs))).toEqual(runs);
});

it('expands one wrapper for styled labels and keeps bare links editable as URLs', () => {
  const runs: TextRun[] = [
    { text: 'our ', marks: { link: 'https://example.com' } },
    { text: 'docs', marks: { bold: true, link: 'https://example.com' } },
    { text: ' ' },
    { text: 'https://example.org', marks: { link: 'https://example.org' } },
  ];
  const expanded = expandInlineLinks(runs);
  expect(expanded.map((run) => run.text).join('')).toBe(
    '[our docs | https://example.com] https://example.org',
  );
  expect(parseInlineLinks(expanded)).toEqual(runs);
});

it('edits labeled links as source and renders only the label in canvas/export layout', () => {
  const blocks: RichBlock[] = [
    { type: 'paragraph', runs: [{ text: '[Docs | https://example.com]' }] },
  ];
  const saved = fromEditorContent(toEditorContent(blocks));
  expect(saved).toEqual([
    {
      type: 'paragraph',
      runs: [{ text: 'Docs', marks: { link: 'https://example.com' } }],
    },
  ]);
  expect(toEditorContent(saved).textContent).toBe(
    '[Docs | https://example.com]',
  );
  const pieces = layoutRichContent(
    blocks,
    400,
    (text) => text.length * 7,
  ).pieces;
  expect(pieces.map((piece) => piece.text).join('')).toBe('Docs');
  expect(pieces[0].style.link).toBe('https://example.com');
});

it('pastes HTML links as editable syntax while keeping styled labels', () => {
  const slice = pastedContent(
    '<p><a href="https://example.com/a?q=[1]">our <b>[docs]</b></a></p>',
    '',
  );
  expect(slice.content.textBetween(0, slice.content.size)).toBe(
    '[our \\[docs\\] | https://example.com/a?q=\\[1\\]]',
  );
  const saved = fromEditorContent(richSchema.node('doc', null, slice.content));
  expect(saved).toEqual([
    {
      type: 'paragraph',
      runs: [
        { text: 'our ', marks: { link: 'https://example.com/a?q=[1]' } },
        {
          text: '[docs]',
          marks: { bold: true, link: 'https://example.com/a?q=[1]' },
        },
      ],
    },
  ]);
});
