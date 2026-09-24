import { undo, redo } from 'prosemirror-history';
import type { Node } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { codeLanguages, type RichBlock } from '../../shared/recursiveDocument';
import {
  codeRuns,
  editCodeText,
  replaceCodeRange,
} from '../../shared/codePresentation';

/** Native textarea editing over a derived token layer; no HTML interpolation or language execution. */
export function codeNodeView(
  initial: Node,
  editor: EditorView,
  getPos: () => number | undefined,
): NodeView {
  let node = initial;
  const dom = document.createElement('div');
  dom.className = 'code-editor';
  dom.contentEditable = 'false';
  const toolbar = document.createElement('div');
  toolbar.className = 'rich-toolbar';
  const language = document.createElement('select');
  language.setAttribute('aria-label', 'Code language');
  for (const name of codeLanguages) language.add(new Option(name, name));
  const label = document.createElement('label');
  label.textContent = 'Wrap code ';
  const wrap = document.createElement('input');
  wrap.type = 'checkbox';
  wrap.setAttribute('aria-label', 'Wrap code');
  label.append(wrap);
  const pane = document.createElement('div');
  pane.className = 'code-pane';
  const pre = document.createElement('pre');
  pre.setAttribute('aria-hidden', 'true');
  const input = document.createElement('textarea');
  input.setAttribute('aria-label', 'Code source');
  input.spellcheck = false;
  input.dataset.codeSource = 'true';
  pane.append(pre, input);
  toolbar.append(language, label);
  dom.append(toolbar, pane);
  const update = () => {
    const block = node.attrs.block as Extract<RichBlock, { type: 'code' }>;
    language.value = block.language;
    wrap.checked = block.wrap ?? false;
    if (input.value !== block.text.replace(/\r\n?/g, '\n'))
      input.value = block.text;
    input.wrap = block.wrap ? 'soft' : 'off';
    pre.style.whiteSpace = block.wrap ? 'pre-wrap' : 'pre';
    pre.style.overflowWrap = block.wrap ? 'anywhere' : 'normal';
    pre.replaceChildren(
      ...codeRuns(block.text, block.language).map((run) => {
        const span = document.createElement('span');
        span.textContent = run.text;
        if (run.marks?.color) span.style.color = run.marks.color;
        return span;
      }),
      document.createTextNode('\n'),
    );
    pre.scrollTop = input.scrollTop;
    pre.scrollLeft = input.scrollLeft;
  };
  const change = (patch: Partial<Extract<RichBlock, { type: 'code' }>>) => {
    const pos = getPos();
    if (pos === undefined) return;
    editor.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        block: { ...node.attrs.block, ...patch },
      }),
    );
  };
  language.onchange = () =>
    change({ language: language.value as (typeof codeLanguages)[number] });
  wrap.onchange = () => change({ wrap: wrap.checked });
  input.oninput = () =>
    change({ text: editCodeText(node.attrs.block.text, input.value) });
  input.onscroll = () => {
    pre.scrollTop = input.scrollTop;
    pre.scrollLeft = input.scrollLeft;
  };
  // Paste carries exact clipboard line endings; native typing/Undo maps the normalized view back to source.
  input.onpaste = (event) => {
    if (!event.clipboardData) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    const source = replaceCodeRange(
      node.attrs.block.text,
      input.selectionStart,
      input.selectionEnd,
      text,
    );
    document.execCommand('insertText', false, text);
    change({ text: source });
  };
  input.onkeydown = (event) => {
    if (event.isComposing) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      ['z', 'y'].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      (event.shiftKey || event.key.toLowerCase() === 'y' ? redo : undo)(
        editor.state,
        editor.dispatch,
      );
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      document.execCommand('insertText', false, '\t');
    }
  };
  update();
  return {
    dom,
    stopEvent: () => true,
    ignoreMutation: () => true,
    update(next) {
      if (next.type !== node.type) return false;
      node = next;
      update();
      return true;
    },
  };
}
