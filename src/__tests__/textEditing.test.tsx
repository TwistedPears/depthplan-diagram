import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react';
import RichTextEditor from '../renderer/components/RichTextEditor';
import InlineObjectText from '../renderer/components/InlineObjectText';
import RecursiveProperties from '../renderer/components/RecursiveProperties';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import { validateRecursiveDocument } from '../shared/recursiveDocument';

beforeEach(() => {
  localStorage.clear();
  window.desktop = {
    fonts: jest.fn().mockResolvedValue(['Arial', 'Test Font']),
  } as unknown as typeof window.desktop;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

it.each([true, false])(
  'uses system fonts and one set of icon controls (compact: %s)',
  async (compact) => {
    const change = jest.fn();
    const toolbar = document.createElement('div');
    document.body.append(toolbar);
    const editor = render(
      <RichTextEditor
        content={[
          {
            type: 'paragraph',
            runs: [{ text: 'Hello', marks: { font: 'RandomFontName' } }],
          },
        ]}
        onChange={change}
        compact={compact}
        toolbarTarget={toolbar}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Text font' }));
    expect(
      await screen.findByRole('menuitemradio', { name: 'Test Font' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Text font' })).toHaveTextContent(
      'RandomFontName',
    );
    expect(
      screen.getByText('RandomFontName is unavailable. Using a fallback font.'),
    ).toBeInTheDocument();
    const middle = screen.getByRole('button', { name: 'Align text middle' });
    expect(middle).toHaveAttribute('aria-pressed', 'true');
    expect(middle.closest('details')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Align text center' }),
    ).toHaveAttribute('aria-pressed', 'true');
    const prose = screen.getByRole('textbox', { name: 'Text' });
    expect(prose.querySelector('p')).toHaveStyle({ textAlign: 'center' });
    await act(async () => {
      prose.focus();
      window.getSelection()!.selectAllChildren(prose);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Test Font' }));
    expect(change).toHaveBeenLastCalledWith([
      {
        type: 'paragraph',
        runs: [{ text: 'Hello', marks: { font: 'Test Font' } }],
      },
    ]);
    const details = toolbar.querySelector('details');
    if (details) details.open = true;
    for (const [name, icon] of [
      ['Bold', 'bold'],
      ['Italic', 'italic'],
      ['Underline', 'underline'],
      ['Strikethrough', 'strikethrough'],
      ['Align text justify', 'align-justify'],
      ['Bullet list', 'list-bullet'],
      ['Numbered list', 'list-numbered'],
      ['Indent', 'indent'],
      ['Outdent', 'outdent'],
    ]) {
      expect(
        screen.getByRole('button', { name }).querySelector('use'),
      ).toHaveAttribute('href', `#icon-${icon}`);
    }
    for (const name of ['Text block', 'Text size', 'Text color', 'List start'])
      expect(screen.queryByLabelText(name)).not.toBeInTheDocument();
    for (const name of [
      'Set size',
      'Set color',
      'Undo text',
      'Redo text',
      'Blockquote',
      'Unwrap block',
      'Set link',
      'Remove link',
      'Insert code',
    ])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Font size L' }));
    fireEvent.click(screen.getByRole('button', { name: 'Text color: Red' }));
    fireEvent.click(screen.getByRole('button', { name: 'Strikethrough' }));
    expect(change).toHaveBeenLastCalledWith([
      {
        type: 'paragraph',
        runs: [
          {
            text: 'Hello',
            marks: {
              font: 'Test Font',
              size: 20,
              color: '#e03131',
              strike: true,
            },
          },
        ],
      },
    ]);
    editor.unmount();
    toolbar.remove();
  },
);

it('retains standard font choices when enumeration fails', async () => {
  window.desktop.fonts = jest.fn().mockRejectedValue(new Error('unavailable'));
  render(<RichTextEditor content={[]} onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Text font' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'System fonts unavailable',
  );
  expect(
    screen.getByRole('menuitemradio', { name: 'sans-serif' }),
  ).toBeInTheDocument();
});

it.each(['inline', 'properties'])(
  'persists %s alignment with unrelated style intact and one undoable edit',
  async (mode) => {
    const original = recursiveFixture();
    original.objects.api.style = { fill: 'red' };
    const { result } = renderHook(() => useDocumentState(original));
    const toolbar = document.createElement('div');
    toolbar.id = 'selection-controls';
    document.body.append(toolbar);
    const close = jest.fn();
    const editor = render(
      mode === 'inline' ? (
        <InlineObjectText
          document={original}
          objectId="api"
          hasChildren
          geometry={original.objects.api.geometry}
          camera={{ x: 0, y: 0, scale: 1 }}
          toolbarTarget={toolbar}
          onEdit={result.current.transact}
          onClose={close}
        />
      ) : (
        <RecursiveProperties
          document={original}
          target="object-api"
          onEdit={result.current.transact}
          onClose={close}
        />
      ),
    );
    await screen.findByRole('button', { name: 'Text font' });
    fireEvent.click(screen.getByRole('button', { name: 'Align text bottom' }));
    expect(
      screen.getByRole('button', { name: 'Align text bottom' }),
    ).toHaveAttribute('aria-pressed', 'true');
    if (mode === 'inline') fireEvent.keyDown(window, { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(result.current.document!.objects.api.style).toEqual({
      fill: 'red',
      textVerticalAlign: 'bottom',
    });
    const saved = JSON.parse(JSON.stringify(result.current.document));
    validateRecursiveDocument(saved);
    expect(saved.objects.api.style!.textVerticalAlign).toBe('bottom');
    expect(result.current.past).toHaveLength(1);
    act(() => result.current.undo());
    expect(result.current.document).toEqual(original);
    act(() => result.current.redo());
    expect(result.current.document).toEqual(saved);
    expect(close).toHaveBeenCalledTimes(1);
    editor.unmount();
    toolbar.remove();
  },
);

it('keeps five initial favorites including monospace, persists stars, and allows an empty favorites list', async () => {
  window.desktop.fonts = jest
    .fn()
    .mockResolvedValue([
      'Arial',
      'Verdana',
      'Georgia',
      'Times New Roman',
      'Menlo',
      'Test Font',
    ]);
  const editor = render(<RichTextEditor content={[]} onChange={() => {}} />);
  const open = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Text font' }));
  open();
  await screen.findByRole('menuitemradio', { name: 'Arial' });
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(5);
  expect(
    screen.getByRole('menuitemcheckbox', { name: 'Favorite monospace' }),
  ).toHaveAttribute('aria-checked', 'true');
  expect(
    screen.queryByRole('menuitemradio', { name: 'Test Font' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem', { name: 'See all fonts' }));
  fireEvent.click(
    screen.getByRole('menuitemcheckbox', { name: 'Favorite Test Font' }),
  );
  for (const name of [
    'Arial',
    'Verdana',
    'Georgia',
    'Times New Roman',
    'monospace',
  ])
    fireEvent.click(
      screen.getByRole('menuitemcheckbox', { name: `Favorite ${name}` }),
    );
  expect(JSON.parse(localStorage.getItem('depthplan.favoriteFonts')!)).toEqual([
    'Test Font',
  ]);
  editor.unmount();
  render(<RichTextEditor content={[]} onChange={() => {}} />);
  open();
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(1);
  fireEvent.click(
    screen.getByRole('menuitemcheckbox', { name: 'Favorite Test Font' }),
  );
  expect(
    screen.getByText('No favorites. Star fonts from the full list.'),
  ).toBeVisible();
  fireEvent.keyDown(screen.getByRole('menu', { name: 'Text font' }), {
    key: 'Escape',
  });
  open();
  expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
  expect(JSON.parse(localStorage.getItem('depthplan.favoriteFonts')!)).toEqual(
    [],
  );
});

it('groups the remaining controls and removes the code widget while retaining existing code text', async () => {
  render(
    <RichTextEditor
      content={[
        {
          type: 'code',
          text: 'const value = 1;',
          language: 'javascript',
          wrap: true,
        },
      ]}
      onChange={() => {}}
    />,
  );
  await screen.findByRole('button', { name: 'Text font' });
  expect(
    within(screen.getByRole('group', { name: 'Font format' })).getAllByRole(
      'button',
    ),
  ).toHaveLength(4);
  expect(
    within(screen.getByRole('group', { name: 'List' })).getAllByRole('button'),
  ).toHaveLength(4);
  expect(screen.getByLabelText('Code block')).toHaveTextContent(
    'const value = 1;',
  );
  for (const label of ['Code source', 'Code language', 'Wrap code', 'Link URL'])
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
});
