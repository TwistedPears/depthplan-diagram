import {
  Schema,
  type Node as EditorNode,
  type MarkSpec,
  type DOMOutputSpec,
} from 'prosemirror-model';
import { EditorState, type Command } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { baseKeymap, chainCommands, toggleMark } from 'prosemirror-commands';
import {
  splitListItem,
  sinkListItem,
  liftListItem,
} from 'prosemirror-schema-list';
import {
  type RichBlock,
  type TextRun,
  validLink,
} from '../../shared/recursiveDocument';

const align = (element: HTMLElement) => ({
  align: ['left', 'center', 'right', 'justify'].includes(
    element.style.textAlign,
  )
    ? element.style.textAlign
    : null,
});
function styled(
  tag: string,
  styles: Partial<CSSStyleDeclaration>,
  attrs: Record<string, string> = {},
): DOMOutputSpec {
  const dom = document.createElement(tag);
  Object.assign(dom.style, styles);
  for (const [name, value] of Object.entries(attrs))
    dom.setAttribute(name, value);
  return { dom, contentDOM: dom };
}
const marks: Record<string, MarkSpec> = {};
for (const [name, tag, property, enabled, disabled] of [
  ['bold', 'strong', 'fontWeight', 'bold', 'normal'],
  ['italic', 'em', 'fontStyle', 'italic', 'normal'],
  ['underline', 'u', 'textDecoration', 'underline', 'none'],
  ['strike', 's', 'textDecoration', 'line-through', 'none'],
]) {
  marks[name] = {
    attrs: { value: { default: true } },
    parseDOM: [
      { tag },
      ...(name === 'underline' || name === 'strike'
        ? [
            {
              style: 'text-decoration',
              getAttrs: (value: string) =>
                value.includes(enabled) ? null : (false as const),
            },
          ]
        : []),
      ...(name === 'bold'
        ? [
            { tag: 'b' },
            {
              style: 'font-weight',
              getAttrs: (v: string) =>
                /^(bold|[6-9]00)$/.test(v) ? null : (false as const),
            },
          ]
        : name === 'italic'
          ? [{ tag: 'i' }, { style: 'font-style=italic' }]
          : name === 'strike'
            ? [{ tag: 'del' }]
            : []),
    ],
    toDOM: (mark) =>
      styled(tag, { [property]: mark.attrs.value ? enabled : disabled }),
  };
}
for (const [name, property, css] of [
  ['font', 'fontFamily', 'font-family'],
  ['size', 'fontSize', 'font-size'],
  ['color', 'color', 'color'],
]) {
  marks[name] = {
    attrs: { value: {} },
    parseDOM: [
      {
        style: css,
        getAttrs: (value) =>
          name === 'size'
            ? /^\d+(\.\d+)?px$/.test(value) && parseFloat(value) > 0
              ? { value: parseFloat(value) }
              : false
            : { value },
      },
    ],
    toDOM: (mark) =>
      styled('span', {
        [property]:
          name === 'size' ? `${mark.attrs.value}px` : mark.attrs.value,
      }),
  };
}
marks.link = {
  attrs: { value: {} },
  inclusive: false,
  parseDOM: [
    {
      tag: 'a[href]',
      getAttrs: (element) =>
        validLink(element.getAttribute('href'))
          ? { value: element.getAttribute('href') }
          : false,
    },
  ],
  toDOM: (mark) => styled('a', {}, { href: mark.attrs.value }),
};
export const richSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'text*',
      whitespace: 'pre',
      attrs: { align: { default: null } },
      parseDOM: [
        { tag: 'p', getAttrs: align },
        { tag: 'div', getAttrs: align },
      ],
      toDOM: (node) => styled('p', { textAlign: node.attrs.align ?? '' }),
    },
    heading: {
      group: 'block',
      content: 'text*',
      whitespace: 'pre',
      attrs: { level: { default: 1 }, align: { default: null } },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`,
        getAttrs: (element) => ({ ...align(element), level }),
      })),
      toDOM: (node) =>
        styled(`h${node.attrs.level}`, { textAlign: node.attrs.align ?? '' }),
    },
    bullet_list: {
      group: 'block',
      content: 'list_item*',
      parseDOM: [{ tag: 'ul' }],
      toDOM: () => ['ul', 0],
    },
    ordered_list: {
      group: 'block',
      content: 'list_item*',
      attrs: { start: { default: null } },
      parseDOM: [
        {
          tag: 'ol',
          getAttrs: (element) => ({
            start: Math.max(
              1,
              parseInt(element.getAttribute('start') ?? '1', 10) || 1,
            ),
          }),
        },
      ],
      toDOM: (node) => ['ol', { start: node.attrs.start ?? 1 }, 0],
    },
    list_item: {
      content: 'block+',
      defining: true,
      parseDOM: [{ tag: 'li' }],
      toDOM: () => ['li', 0],
    },
    quote: {
      group: 'block',
      content: 'block+',
      defining: true,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM: () => ['blockquote', 0],
    },
    code: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { block: {} },
      parseDOM: [
        {
          tag: 'pre',
          getAttrs: (element) => ({
            block: {
              type: 'code',
              text: element.textContent ?? '',
              language: 'plaintext',
            },
          }),
        },
      ],
      toDOM: (node) => [
        'pre',
        { contenteditable: 'false', 'aria-label': 'Code block' },
        node.attrs.block.text,
      ],
    },
    text: { group: 'inline' },
  },
  marks,
});

export function toEditorContent(blocks: RichBlock[]): EditorNode {
  const block = (b: RichBlock): EditorNode => {
    if (b.type === 'code') return richSchema.nodes.code.create({ block: b });
    if (b.type === 'list')
      return richSchema.node(
        b.ordered ? 'ordered_list' : 'bullet_list',
        { start: b.start ?? null },
        b.items.map((item) =>
          richSchema.node('list_item', null, item.map(block)),
        ),
      );
    if (b.type === 'quote')
      return richSchema.node('quote', null, b.blocks.map(block));
    return richSchema.node(
      b.type,
      {
        align: b.align ?? null,
        level: b.type === 'heading' ? b.level : undefined,
      },
      b.runs
        .filter((r) => r.text)
        .map((r) =>
          richSchema.text(
            r.text,
            Object.entries(r.marks ?? {}).map(([name, value]) =>
              richSchema.mark(name, { value }),
            ),
          ),
        ),
    );
  };
  return richSchema.node(
    'doc',
    null,
    blocks.length ? blocks.map(block) : richSchema.nodes.paragraph.create(),
  );
}
export function fromEditorContent(doc: EditorNode): RichBlock[] {
  const children = (node: EditorNode): RichBlock[] => {
    const result: RichBlock[] = [];
    node.forEach((n) => result.push(block(n)));
    return result;
  };
  const block = (node: EditorNode): RichBlock => {
    const type = node.type.name;
    if (type === 'code') return node.attrs.block;
    if (type === 'quote') return { type, blocks: children(node) };
    if (type === 'ordered_list' || type === 'bullet_list') {
      const items: RichBlock[][] = [];
      node.forEach((n) => items.push(children(n)));
      return {
        type: 'list',
        ordered: type === 'ordered_list',
        ...(node.attrs.start !== null && node.attrs.start !== undefined
          ? { start: node.attrs.start }
          : {}),
        items,
      };
    }
    const runs: TextRun[] = [];
    node.forEach((n) => {
      const marks = Object.fromEntries(
        n.marks.map((m) => [m.type.name, m.attrs.value]),
      );
      runs.push({ text: n.text!, ...(n.marks.length ? { marks } : {}) });
    });
    return {
      type: type as 'paragraph',
      ...(type === 'heading' ? { level: node.attrs.level } : {}),
      ...(node.attrs.align ? { align: node.attrs.align } : {}),
      runs,
    };
  };
  return children(doc);
}
export const setAlignment =
  (align: string): Command =>
  (state, dispatch) => {
    const tr = state.tr;
    state.doc.nodesBetween(
      state.selection.from,
      state.selection.to,
      (node, pos) => {
        if (
          node.type === richSchema.nodes.paragraph ||
          node.type === richSchema.nodes.heading
        )
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
      },
    );
    if (dispatch) dispatch(tr);
    return true;
  };
export function richEditorState(content: RichBlock[]) {
  const item = richSchema.nodes.list_item;
  return EditorState.create({
    doc: toEditorContent(content),
    plugins: [
      history(),
      keymap({
        'Mod-z': undo,
        'Mod-Shift-z': redo,
        'Mod-y': redo,
        'Mod-b': toggleMark(richSchema.marks.bold),
        'Mod-i': toggleMark(richSchema.marks.italic),
        'Mod-u': toggleMark(richSchema.marks.underline),
        Enter: chainCommands(splitListItem(item), baseKeymap.Enter),
        'Shift-Enter': (state, dispatch) => {
          dispatch?.(state.tr.insertText('\n'));
          return true;
        },
        Tab: chainCommands(sinkListItem(item), () => true),
        'Shift-Tab': chainCommands(liftListItem(item), () => true),
      }),
      keymap(baseKeymap),
    ],
  });
}
