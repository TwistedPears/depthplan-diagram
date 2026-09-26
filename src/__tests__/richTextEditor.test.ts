import { TextSelection } from 'prosemirror-state';
import { toggleMark } from 'prosemirror-commands';
import { undo, redo } from 'prosemirror-history';
import { DOMParser as EditorParser } from 'prosemirror-model';
import {
  richEditorState,
  richSchema,
  toEditorContent,
  fromEditorContent,
  setAlignment,
} from '../renderer/utils/richTextEditor';
import { pastedContent } from '../renderer/components/RichTextEditor';
import { layoutRichContent } from '../shared/richContentLayout';
import {
  validateContent,
  validLink,
  type RichBlock,
} from '../shared/recursiveDocument';

const content: RichBlock[] = [
  {
    type: 'paragraph',
    runs: [
      { text: 'Hello ' },
      { text: 'world', marks: { bold: true } },
      { text: '! e\u0301 👨‍👩‍👧‍👦\n漢字', marks: { italic: true } },
    ],
  },
  {
    type: 'heading',
    level: 2,
    align: 'center',
    runs: [{ text: 'Title', marks: { color: 'blue' } }],
  },
  {
    type: 'list',
    ordered: true,
    start: 3,
    items: [
      [
        { type: 'paragraph', runs: [{ text: 'Item' }] },
        {
          type: 'list',
          ordered: false,
          items: [[{ type: 'paragraph', runs: [{ text: 'Nested' }] }]],
        },
      ],
    ],
  },
  {
    type: 'quote',
    blocks: [
      {
        type: 'paragraph',
        runs: [{ text: 'A < B & C', marks: { link: 'https://example.com/a' } }],
      },
    ],
  },
  {
    type: 'code',
    text: '\tconst x = "<tag>";\r\n\r\n',
    language: 'typescript',
    wrap: false,
  },
];
it('round-trips the canonical tree without interpreting or normalizing source', () => {
  const result = fromEditorContent(toEditorContent(content));
  expect(result).toEqual(content);
  validateContent(result);
  expect(JSON.parse(JSON.stringify(result))).toEqual(content);
});
it('splits a selected run, preserves surrounding marks/code, and keeps Undo within the draft', () => {
  let state = richEditorState(content);
  const dispatch = (tr: typeof state.tr) => {
    state = state.apply(tr);
  };
  dispatch(state.tr.setSelection(TextSelection.create(state.doc, 8, 10)));
  dispatch(
    state.tr.addMark(8, 10, richSchema.marks.color.create({ value: 'red' })),
  );
  expect(fromEditorContent(state.doc)[0]).toEqual({
    type: 'paragraph',
    runs: [
      { text: 'Hello ' },
      { text: 'w', marks: { bold: true } },
      { text: 'or', marks: { bold: true, color: 'red' } },
      { text: 'ld', marks: { bold: true } },
      content[0].type === 'paragraph' ? content[0].runs[2] : null,
    ],
  });
  toggleMark(richSchema.marks.bold)(state, dispatch);
  expect(
    (fromEditorContent(state.doc)[0] as { runs: unknown[] }).runs[2],
  ).toEqual({ text: 'or', marks: { color: 'red' } });
  expect(fromEditorContent(state.doc).at(-1)).toEqual(content.at(-1));
  undo(state, dispatch);
  undo(state, dispatch);
  expect(fromEditorContent(state.doc)).toEqual(content);
  redo(state, dispatch);
  expect(state.doc.eq(toEditorContent(content))).toBe(false);
  setAlignment('right')(state, dispatch);
  expect(fromEditorContent(state.doc)[0]).toMatchObject({ align: 'right' });
});
it('sanitizes HTML to supported nodes and rejects hostile links while preserving literal Unicode/plain newlines', () => {
  const slice = pastedContent(
    '<h2 style="text-align:center">A <b>B</b></h2><script>alert(1)</script><img src="https://example.com/x" onerror="alert(1)"><p><a href="javascript:alert(1)">bad</a><a href="https://example.com">safe</a><br>漢字</p><blockquote>quote</blockquote>',
    '',
  );
  const parsed = richSchema.node('doc', null, slice.content);
  const result = fromEditorContent(parsed);
  validateContent(result);
  expect(JSON.stringify(result)).not.toMatch(
    /javascript|alert|onerror|https:\/\/example.com\/x/,
  );
  expect(result[0]).toMatchObject({
    type: 'heading',
    level: 2,
    align: 'center',
    runs: [{ text: 'A ' }, { text: 'B', marks: { bold: true } }],
  });
  const plain = pastedContent('', 'a\n\nb\t e\u0301').content;
  expect(plain.textBetween(0, plain.size)).toBe('a\n\nb\t e\u0301');
  for (const link of [
    'javascript:alert(1)',
    'data:text/html,a',
    'file:///a',
    'https://user:pass@example.com',
    'https://example.com/\u007f',
    'https://example.com/\n',
  ])
    expect(validLink(link)).toBe(false);
  for (const link of [
    'https://example.com',
    'http://example.com',
    'mailto:hello@example.com',
  ])
    expect(validLink(link)).toBe(true);
  const template = document.createElement('template');
  template.innerHTML = '<p>one\n two</p>';
  expect(
    EditorParser.fromSchema(richSchema).parse(template.content).textContent,
  ).toBe('one\n two');
});
it('lays out mixed styles, headings, nested numbering, quotes, links and clipped long prose without changing content', () => {
  const original = JSON.stringify(content);
  const layout = layoutRichContent(
    content,
    180,
    (text, style) => Array.from(text).length * style.size * 0.5,
  );
  expect(layout.pieces.find((p) => p.text === 'world')!.style.bold).toBe(true);
  expect(layout.pieces.find((p) => p.text === 'Title')!.style).toMatchObject({
    size: 20,
    color: 'blue',
    bold: true,
  });
  expect(layout.pieces.some((p) => p.text === '3.')).toBe(true);
  expect(layout.pieces.some((p) => p.text === '•' && p.x === 24)).toBe(true);
  expect(layout.rules).toHaveLength(1);
  expect(
    layout.pieces.some((p) => p.style.link === 'https://example.com/a'),
  ).toBe(true);
  expect(
    layout.pieces
      .filter((p) => p.style.font === 'monospace')
      .map((p) => p.text)
      .join(''),
  ).toContain('    const');
  const clipped = layoutRichContent(content, 70, (text) => text.length * 7, 30);
  expect(clipped.pieces.length).toBeLessThan(layout.pieces.length);
  expect(JSON.stringify(content)).toBe(original);
});

it('paints adjacent words together without crossing wraps, marks, links or shaping boundaries', () => {
  const blocks = [
    {
      type: 'paragraph' as const,
      runs: [
        { text: 'one two three four' },
        { text: ' bold', marks: { bold: true } },
        { text: ' link', marks: { link: 'https://example.com' } },
        { text: ' 日本語 words' },
      ],
    },
  ];
  const before = JSON.stringify(blocks);
  const layout = layoutRichContent(blocks, 70, (text) => text.length * 5);
  expect(layout.pieces[0].text).toBe('one two three ');
  expect(layout.pieces.find((p) => p.text === 'four')!.y).toBeGreaterThan(0);
  expect(
    layout.pieces
      .filter((p) => p.style.bold)
      .map((p) => p.text)
      .join(''),
  ).toBe(' bold');
  expect(
    layout.pieces
      .filter((p) => p.style.link)
      .map((p) => p.text)
      .join(''),
  ).toBe(' link');
  expect(layout.pieces.some((p) => p.text === '日本語')).toBe(true);
  expect(JSON.stringify(blocks)).toBe(before);
});

it('wraps beside an icon and returns to full width below it without shifting the first line', () => {
  const blocks: RichBlock[] = [
    {
      type: 'paragraph',
      runs: [
        {
          text: 'one two three four five six seven eight nine ten eleven twelve',
        },
      ],
    },
  ];
  const original = JSON.stringify(blocks);
  for (const side of ['left', 'right'] as const) {
    const layout = layoutRichContent(
      blocks,
      100,
      (text) => text.length * 5,
      Infinity,
      { side, width: 40, top: 0, bottom: 20 },
    );
    expect(layout.pieces[0].y).toBe(0);
    for (const piece of layout.pieces.filter((p) => p.y < 20)) {
      if (side === 'left') expect(piece.x).toBeGreaterThanOrEqual(40);
      else expect(piece.x + piece.width).toBeLessThanOrEqual(60);
    }
    expect(
      layout.pieces.some((p) => p.y >= 20 && p.x === 0 && p.width > 60),
    ).toBe(true);
  }
  expect(JSON.stringify(blocks)).toBe(original);
});

it('keeps styled prose, list markers, quote rules and unwrapped code clear of the icon', () => {
  const blocks: RichBlock[] = [
    {
      type: 'paragraph',
      align: 'right',
      runs: [{ text: 'small ' }, { text: 'large text', marks: { size: 24 } }],
    },
    {
      type: 'quote',
      blocks: [
        {
          type: 'list',
          ordered: false,
          items: [
            [
              {
                type: 'paragraph',
                runs: [
                  { text: 'one two three four five six seven eight nine ten' },
                ],
              },
            ],
          ],
        },
      ],
    },
    {
      type: 'code',
      language: 'plaintext',
      wrap: false,
      text: 'long unwrapped source line',
    },
  ];
  for (const side of ['left', 'right'] as const) {
    const exclusion = { side, width: 70, top: 20, bottom: 95 };
    const layout = layoutRichContent(
      blocks,
      180,
      (text, style) => (Array.from(text).length * style.size) / 2,
      Infinity,
      exclusion,
    );
    for (const piece of layout.pieces) {
      if (piece.y < 95 && piece.y + piece.style.size > 20) {
        if (side === 'left') expect(piece.x).toBeGreaterThanOrEqual(70);
        else expect(piece.x + piece.width).toBeLessThanOrEqual(110);
      }
    }
    for (const rule of layout.rules)
      if (side === 'left' && rule.y < 95 && rule.y + rule.height > 20)
        expect(rule.x).toBeGreaterThan(70);
    expect(layout.pieces.map((p) => p.text).join('')).toContain(
      'one two three four five six seven eight nine ten',
    );
  }
  const shortCode = layoutRichContent(
    [
      { type: 'code', language: 'plaintext', text: 'x' },
      { type: 'paragraph', runs: [{ text: 'next' }] },
    ],
    100,
    (text) => text.length * 5,
    Infinity,
    { side: 'right', width: 40, top: 20, bottom: 80 },
  );
  expect(shortCode.pieces.find((p) => p.text === 'next')!.y).toBeCloseTo(21.6);
  const narrowList = layoutRichContent(
    [
      {
        type: 'list',
        ordered: false,
        items: [[{ type: 'paragraph', runs: [{ text: 'item' }] }]],
      },
    ],
    64,
    (text) => text.length * 5,
    Infinity,
    { side: 'right', width: 40, top: 0, bottom: 40 },
  );
  expect(narrowList.pieces[0].y).toBe(40);
  expect(narrowList.pieces[1].y).toBe(40);
});
