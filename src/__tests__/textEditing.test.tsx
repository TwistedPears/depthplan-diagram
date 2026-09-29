import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import RichTextEditor from '../renderer/components/RichTextEditor';
import InlineObjectText from '../renderer/components/InlineObjectText';
import RecursiveProperties from '../renderer/components/RecursiveProperties';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import { validateRecursiveDocument } from '../shared/recursiveDocument';

beforeEach(() => {
  window.desktop = {
    fonts: jest.fn().mockResolvedValue(['Arial', 'Test Font']),
  } as unknown as typeof window.desktop;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

it('lists installed fonts, preserves missing names, applies selection marks, and uses existing icons', async () => {
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
      compact
      toolbarTarget={toolbar}
    />,
  );
  expect(
    await screen.findByRole('option', { name: 'Test Font' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Text font' })).toHaveValue(
    'RandomFontName',
  );
  expect(
    screen.getByRole('option', { name: 'RandomFontName (fallback)' }),
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
  fireEvent.change(screen.getByRole('combobox', { name: 'Text font' }), {
    target: { value: 'Test Font' },
  });
  expect(change).toHaveBeenLastCalledWith([
    {
      type: 'paragraph',
      runs: [{ text: 'Hello', marks: { font: 'Test Font' } }],
    },
  ]);
  toolbar.querySelector('details')!.open = true;
  for (const [name, icon] of [
    ['Bold', 'bold'],
    ['Italic', 'italic'],
    ['Underline', 'underline'],
    ['Set link', 'link'],
    ['Insert code', 'file-code'],
    ['Undo text', 'rotate-left'],
    ['Redo text', 'rotate-right'],
  ]) {
    expect(
      screen.getByRole('button', { name }).querySelector('use'),
    ).toHaveAttribute('href', `#icon-${icon}`);
  }
  expect(
    screen.getByRole('button', { name: 'Strikethrough' }),
  ).toHaveTextContent('Strikethrough');
  editor.unmount();
  toolbar.remove();
});

it('retains standard font choices when enumeration fails', async () => {
  window.desktop.fonts = jest.fn().mockRejectedValue(new Error('unavailable'));
  render(<RichTextEditor content={[]} onChange={() => {}} />);
  expect(await screen.findByRole('status')).toHaveTextContent(
    'System fonts unavailable',
  );
  expect(
    screen.getByRole('option', { name: 'sans-serif' }),
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
    await screen.findByRole('option', { name: 'Test Font' });
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
