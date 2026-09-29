import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TextSelection, type EditorState } from 'prosemirror-state';
import PropertyColorPalette from './PropertyColorPalette';
import Icon from './Icon';
import { defaultTextStyle } from '../../shared/richContentLayout';
import { genericFonts } from '../../shared/textFont';
import type { VerticalAlignment } from '../../shared/objectContentBounds';
import { EditorView } from 'prosemirror-view';
import { DOMParser as EditorParser, Slice, Fragment } from 'prosemirror-model';
import { type Command } from 'prosemirror-state';
import { toggleMark, wrapIn, lift } from 'prosemirror-commands';
import {
  wrapInList,
  sinkListItem,
  liftListItem,
} from 'prosemirror-schema-list';
import { undo, redo } from 'prosemirror-history';
import { type RichBlock, validLink } from '../../shared/recursiveDocument';
import {
  richSchema,
  richEditorState,
  fromEditorContent,
  setAlignment,
} from '../utils/richTextEditor';
import 'prosemirror-view/style/prosemirror.css';
import './RichTextEditor.css';
import { codeNodeView } from '../utils/codeNodeView';

export function pastedContent(html: string, text: string): Slice {
  if (!html)
    return new Slice(
      Fragment.from(
        richSchema.node(
          'paragraph',
          null,
          text ? richSchema.text(text) : undefined,
        ),
      ),
      1,
      1,
    );
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content
    .querySelectorAll(
      'script,style,iframe,object,embed,img,svg,math,link,meta,base',
    )
    .forEach((node) => node.remove());
  template.content
    .querySelectorAll('br')
    .forEach((node) => node.replaceWith('\n'));
  return EditorParser.fromSchema(richSchema).parseSlice(template.content, {
    preserveWhitespace: 'full',
  });
}
export default function RichTextEditor({
  content,
  onChange,
  toolbarTarget,
  compact = false,
  focusOnMount = false,
  verticalAlign = 'middle',
  onVerticalAlignChange,
}: {
  content: RichBlock[];
  onChange: (value: RichBlock[]) => void;
  toolbarTarget?: HTMLElement | null;
  compact?: boolean;
  focusOnMount?: boolean;
  verticalAlign?: VerticalAlignment;
  onVerticalAlignChange?: (value: VerticalAlignment) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initial = useRef(content);
  const retained = useRef<EditorState | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const [error, setError] = useState('');
  const [fonts, setFonts] = useState<string[]>(genericFonts);
  const [fontError, setFontError] = useState(false);
  useEffect(() => {
    let active = true;
    window.desktop
      ?.fonts?.()
      .then((names) => {
        if (active)
          setFonts(
            [...new Set([...names, ...genericFonts])].sort((a, b) =>
              a.localeCompare(b),
            ),
          );
      })
      .catch(() => {
        if (active) setFontError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const [link, setLink] = useState('');
  const [format, setFormat] = useState({
    ...defaultTextStyle,
    align: 'center',
  });
  useLayoutEffect(() => {
    const state = richEditorState(initial.current);
    const editor = new EditorView(host.current!, {
      state: retained.current ?? state,
      nodeViews: { code: codeNodeView },
      attributes: {
        role: 'textbox',
        'aria-label': 'Text',
        'aria-multiline': 'true',
        spellcheck: 'true',
      },
      dispatchTransaction(transaction) {
        editor.updateState(editor.state.apply(transaction));
        reflectSelection();
        if (transaction.docChanged)
          change.current(
            editor.state.doc.eq(state.doc)
              ? initial.current
              : fromEditorContent(editor.state.doc),
          );
      },
      handlePaste(editorView, event) {
        if (!event.clipboardData) return false;
        editorView.dispatch(
          editorView.state.tr
            .replaceSelection(
              pastedContent(
                event.clipboardData.getData('text/html'),
                event.clipboardData.getData('text/plain'),
              ),
            )
            .scrollIntoView(),
        );
        return true;
      },
      handleDOMEvents: {
        click: (_editor, event) => {
          if ((event.target as Element).closest('a')) {
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
    });
    const reflectSelection = () => {
      const marks =
        editor.state.storedMarks ?? editor.state.selection.$from.marks();
      setFormat({
        font:
          marks.find((mark) => mark.type.name === 'font')?.attrs.value ??
          defaultTextStyle.font,
        size:
          marks.find((mark) => mark.type.name === 'size')?.attrs.value ??
          defaultTextStyle.size,
        color:
          marks.find((mark) => mark.type.name === 'color')?.attrs.value ??
          defaultTextStyle.color,
        align: editor.state.selection.$from.parent.attrs.align ?? 'center',
      });
    };
    view.current = editor;
    reflectSelection();
    if (focusOnMount) {
      if (!retained.current)
        editor.dispatch(
          editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)),
        );
      editor.focus();
    }
    const history = (event: Event) => {
      ((event as CustomEvent).detail === 'undo' ? undo : redo)(
        editor.state,
        editor.dispatch,
      );
      if (!document.activeElement?.hasAttribute('data-code-source'))
        editor.focus();
    };
    host.current!.addEventListener('editor-history', history);
    const node = host.current!;
    return () => {
      retained.current = editor.state;
      node.removeEventListener('editor-history', history);
      view.current = null;
      editor.destroy();
    };
  }, [focusOnMount]);
  const run = (command: Command) => {
    const editor = view.current!;
    command(editor.state, editor.dispatch, editor);
    editor.focus();
  };
  const mark = (name: string, value: string | number | null) => {
    const type = richSchema.marks[name];
    run((state, dispatch) => {
      const { from, to, empty } = state.selection;
      const tr = state.tr;
      if (empty) {
        if (value === null) tr.removeStoredMark(type);
        else tr.addStoredMark(type.create({ value }));
      } else {
        tr.removeMark(from, to, type);
        if (value !== null) tr.addMark(from, to, type.create({ value }));
      }
      dispatch?.(tr);
      return true;
    });
  };
  const fontControl = (
    <label>
      Font{' '}
      <select
        aria-label="Text font"
        value={format.font}
        onChange={(event) => mark('font', event.target.value)}
      >
        {!fonts.includes(format.font) && (
          <option value={format.font}>{format.font} (fallback)</option>
        )}
        {fonts.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {fontError && (
        <small role="status">
          System fonts unavailable. Using standard fonts.
        </small>
      )}
    </label>
  );
  const verticalControl = (
    <fieldset className="property-group">
      <legend>Vertical alignment</legend>
      <div className="property-choices">
        {(['top', 'middle', 'bottom'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`Align text ${value}`}
            title={`Align ${value}`}
            aria-pressed={verticalAlign === value}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onVerticalAlignChange?.(value)}
          >
            <Icon
              name={`objects-align-${value === 'middle' ? 'center-vertical' : value}`}
              className="property-icon"
            />
          </button>
        ))}
      </div>
    </fieldset>
  );
  const advancedToolbar = (
    <div
      role="toolbar"
      aria-label="Advanced text formatting"
      className="rich-toolbar"
    >
      {(['bold', 'italic', 'underline', 'strike'] as const).map((name) => (
        <button
          type="button"
          key={name}
          aria-label={
            name === 'strike'
              ? 'Strikethrough'
              : name[0].toUpperCase() + name.slice(1)
          }
          title={
            name === 'strike'
              ? 'Strikethrough'
              : name[0].toUpperCase() + name.slice(1)
          }
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run(toggleMark(richSchema.marks[name]))}
        >
          <Icon name={name === 'strike' ? 'strikethrough' : name} />
        </button>
      ))}
      {(
        [
          [
            'Bullet list',
            'list-bullet',
            wrapInList(richSchema.nodes.bullet_list),
          ],
          [
            'Numbered list',
            'list-numbered',
            wrapInList(richSchema.nodes.ordered_list),
          ],
          ['Indent', 'indent', sinkListItem(richSchema.nodes.list_item)],
          ['Outdent', 'outdent', liftListItem(richSchema.nodes.list_item)],
          ['Blockquote', 'blockquote', wrapIn(richSchema.nodes.quote)],
          ['Unwrap block', 'unwrap-block', lift],
        ] as const
      ).map(([label, icon, command]) => (
        <button
          key={icon}
          type="button"
          aria-label={label}
          title={label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => run(command)}
        >
          <Icon name={icon} />
        </button>
      ))}
      <label>
        Link{' '}
        <input
          aria-label="Link URL"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
      </label>
      <button
        type="button"
        aria-label="Set link"
        title="Set link"
        onClick={() => {
          if (validLink(link)) {
            mark('link', link);
            setError('');
          } else
            setError(
              'Use an absolute http, https or mailto URL without credentials or control characters.',
            );
        }}
      >
        <Icon name="link" />
      </button>
      <button
        type="button"
        aria-label="Remove link"
        title="Remove link"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => mark('link', null)}
      >
        <Icon name="link-remove" />
      </button>
      <button
        type="button"
        aria-label="Insert code"
        title="Insert code"
        onClick={() =>
          run((state, dispatch) => {
            dispatch?.(
              state.tr.replaceSelectionWith(
                richSchema.nodes.code.create({
                  block: {
                    type: 'code',
                    text: '',
                    language: 'plaintext',
                    wrap: false,
                  },
                }),
              ),
            );
            return true;
          })
        }
      >
        <Icon name="file-code" />
      </button>
    </div>
  );
  const toolbar = (
    <div
      className="inline-text-controls"
      data-inline-text-controls
      data-document-editor
    >
      <div role="toolbar" aria-label="Text formatting">
        <PropertyColorPalette
          label="Text color"
          value={format.color}
          onChange={(value) => mark('color', value)}
        />
        <div className="property-group">{fontControl}</div>
        <fieldset className="property-group">
          <legend>Font size</legend>
          <div className="property-choices">
            {(
              [
                ['S', 12],
                ['M', 16],
                ['L', 20],
                ['XL', 28],
              ] as const
            ).map(([label, value]) => (
              <button
                key={label}
                type="button"
                aria-label={`Font size ${label}`}
                title={`${value} px`}
                aria-pressed={format.size === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => mark('size', value)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="property-group">
          <legend>Text align</legend>
          <div className="property-choices">
            {['left', 'center', 'right', 'justify'].map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`Align text ${value}`}
                title={`Align ${value}`}
                aria-pressed={format.align === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(setAlignment(value))}
              >
                <Icon name={`align-${value}`} className="property-icon" />
              </button>
            ))}
          </div>
        </fieldset>
        {verticalControl}
      </div>
      {compact ? (
        <details className="advanced-text-options">
          <summary>More text options</summary>
          {advancedToolbar}
        </details>
      ) : (
        advancedToolbar
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
  return (
    <section
      className={`rich-editor${compact ? ' rich-editor-inline' : ''}`}
      data-vertical-align={verticalAlign}
    >
      {compact
        ? toolbarTarget && createPortal(toolbar, toolbarTarget)
        : toolbar}
      <div ref={host} data-rich-editor />
      {!compact && (
        <small>
          Tab / Shift+Tab indent lists. Shift+Enter adds a line break. Apply
          saves the draft.
        </small>
      )}
    </section>
  );
}
