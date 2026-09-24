import { TextSelection } from 'prosemirror-state';
import { undo } from 'prosemirror-history';
import {
  richEditorState,
  richSchema,
  fromEditorContent,
} from '../renderer/utils/richTextEditor';
import Prism from 'prismjs';
import {
  codeRuns,
  editCodeText,
  replaceCodeRange,
} from '../shared/codePresentation';
import { codeLanguages } from '../shared/recursiveDocument';
import { layoutRichContent } from '../shared/richContentLayout';
const examples = {
  javascript: 'const x = "hello"; // comment',
  typescript: 'const x: string = "hello";',
  json: '{"x": true, "n": 42}',
  yaml: 'key: true\nitems:\n  - hello',
  python: 'def hello():\n    return "world"',
  sql: 'SELECT id FROM users WHERE id = 2;',
  bash: '#!/bin/bash\necho "$HOME"',
  csharp: 'public class Example { int x = 3; }',
  java: 'public class Example { int x = 3; }',
  html: '<div class="test">hello</div>',
  css: '.test { color: red; }',
  plaintext: '<script>literal</script>\r\n',
};
it.each(codeLanguages)(
  'highlights %s without changing source or interpreting HTML',
  (language) => {
    const source = examples[language] + '\t漢字\r\n\r\n';
    const runs = codeRuns(source, language);
    expect(runs.map((r) => r.text).join('')).toBe(source);
    expect(runs.some((r) => r.marks?.color)).toBe(language !== 'plaintext');
  },
);
it('falls back to exact plaintext on highlighter failure', () => {
  const tokenize = jest.spyOn(Prism, 'tokenize').mockImplementation(() => {
    throw new Error('failed');
  });
  expect(codeRuns('const x = "<tag>";\r\n', 'typescript')).toEqual([
    { text: 'const x = "<tag>";\r\n' },
  ]);
  tokenize.mockRestore();
});
it('maps edits and exact clipboard ranges through CRLF, LF, Unicode, tabs and final newlines', () => {
  const source = '\tconst x = "漢字";\r\n\nlast\r\n';
  const shown = source.replace(/\r\n/g, '\n');
  expect(editCodeText(source, shown)).toBe(source);
  expect(editCodeText(source, shown.replace('x', 'value'))).toBe(
    source.replace('x', 'value'),
  );
  expect(editCodeText(source, shown + 'added\n')).toBe(source + 'added\r\n');
  expect(
    replaceCodeRange(
      source,
      shown.indexOf('last'),
      shown.indexOf('last') + 4,
      'α\nβ\r\n',
    ),
  ).toBe(source.replace('last', 'α\nβ\r\n'));
  expect(editCodeText(source, '')).toBe('');
});
it('wraps only the presentation and uses four-column tabs across token boundaries', () => {
  const block = {
    type: 'code' as const,
    text: 'let\tvalue = "a long string";\r\n\r\n',
    language: 'typescript' as const,
  };
  const measure = (text: string) => text.length * 6;
  const clipped = layoutRichContent([block], 70, measure);
  const wrapped = layoutRichContent([{ ...block, wrap: true }], 70, measure);
  expect(wrapped.height).toBeGreaterThan(clipped.height);
  expect(clipped.pieces.map((p) => p.text).join('')).toContain('let value');
  expect(clipped.pieces.every((p) => p.style.font === 'monospace')).toBe(true);
  expect(block.text).toBe('let\tvalue = "a long string";\r\n\r\n');
});

it('inserts a code block between prose blocks with one draft Undo and unchanged neighbors', () => {
  const content = [
    { type: 'paragraph' as const, runs: [{ text: 'Before' }] },
    { type: 'paragraph' as const, runs: [{ text: 'After' }] },
  ];
  let state = richEditorState(content);
  const block = {
    type: 'code',
    text: '\tconst x = "漢字";\r\n',
    language: 'typescript',
    wrap: false,
  };
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 7)),
  );
  state = state.apply(
    state.tr.replaceSelectionWith(richSchema.nodes.code.create({ block })),
  );
  expect(fromEditorContent(state.doc)).toEqual([content[0], block, content[1]]);
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(fromEditorContent(state.doc)).toEqual(content);
});
