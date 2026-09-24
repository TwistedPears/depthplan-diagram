import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import RecursiveProperties from '../renderer/components/RecursiveProperties';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import { activeGeometry, selectRootDepth } from '../shared/recursiveLayouts';
import { activeWorldGeometry } from '../shared/recursiveHierarchy';
import { validateRecursiveDocument } from '../shared/recursiveDocument';

it.each(['line', 'free-arrow', 'attached-arrow', 'boundary-arrow'] as const)(
  'edits independent Z for a %s with persistence and exact Undo/Redo',
  (kind) => {
    const original = recursiveFixture();
    original.objects.app.boundaryPoints = {
      out: { side: 'right', offset: 0.5 },
    };
    original.connections.path = {
      id: 'path',
      ownerId: null,
      kind: kind === 'line' ? 'line' : 'arrow',
      z: 3,
      start:
        kind === 'attached-arrow'
          ? { kind: 'object', objectId: 'app', side: 'right', offset: 0.5 }
          : kind === 'boundary-arrow'
            ? { kind: 'boundary', objectId: 'app', pointId: 'out' }
            : { kind: 'free', x: 0, y: 0 },
      end: { kind: 'free', x: 100, y: 100 },
      points: [{ x: 30, y: 60 }],
      label: 'Retain',
      style: { lineType: 'curved', stroke: '#123456' },
    };
    const { result } = renderHook(() => useDocumentState(original));
    const close = jest.fn();
    render(
      <RecursiveProperties
        document={original}
        target="connection-path"
        onEdit={result.current.transact}
        onClose={close}
      />,
    );
    expect(screen.getByLabelText('Z')).toHaveValue(3);
    fireEvent.input(screen.getByLabelText('Z'), { target: { value: '-4' } });
    fireEvent.click(screen.getByText('Apply'));
    const edited = result.current.document!;
    expect(edited.connections.path).toEqual({
      ...original.connections.path,
      z: -4,
    });
    expect(edited.objects).toEqual(original.objects);
    expect(edited.layouts).toEqual(original.layouts);
    const reopened = JSON.parse(JSON.stringify(edited));
    validateRecursiveDocument(reopened);
    expect(reopened.connections).toEqual(edited.connections);
    expect(result.current.past).toHaveLength(1);
    expect(close).toHaveBeenCalledTimes(1);
    act(() => result.current.undo());
    expect(result.current.document).toEqual(original);
    act(() => result.current.redo());
    expect(result.current.document).toEqual(edited);
  },
);

it.each(['', 'Infinity', '1.5'])(
  'retains invalid connection Z %j and leaves unchanged Apply/Cancel alone',
  (value) => {
    const document = recursiveFixture();
    document.connections.path = {
      id: 'path',
      ownerId: null,
      kind: 'line',
      z: 0,
      start: { kind: 'free', x: 0, y: 0 },
      end: { kind: 'free', x: 100, y: 100 },
    };
    const edit = jest.fn(),
      close = jest.fn();
    render(
      <RecursiveProperties
        document={document}
        target="connection-path"
        onEdit={edit}
        onClose={close}
      />,
    );
    fireEvent.click(screen.getByText('Apply'));
    expect(close).toHaveBeenCalledTimes(1);
    const input = screen.getByLabelText('Z') as HTMLInputElement;
    fireEvent.input(input, { target: { value } });
    fireEvent.submit(input.form!);
    expect(input.checkValidity()).toBe(false);
    expect(edit).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.input(input, { target: { value: '2' } });
    expect(input.checkValidity()).toBe(true);
    fireEvent.click(screen.getByText('Cancel'));
    expect(edit).not.toHaveBeenCalled();
  },
);

it.each(['app', 'api', 'endpoint'])(
  'edits exact active-local geometry for %s in one undoable Apply',
  (id) => {
    const original = recursiveFixture();
    original.rootDepths.app = 2;
    original.layouts.app[2].app.rotation = 90;
    const { result } = renderHook(() => useDocumentState(original));
    const close = jest.fn();
    render(
      <RecursiveProperties
        document={original}
        target={`object-${id}`}
        onEdit={result.current.transact}
        onClose={close}
      />,
    );
    expect(screen.getByText(/X\/Y locate the center/)).toHaveTextContent(
      id === 'app' ? 'World coordinates' : 'relative to parent',
    );
    for (const [label, value] of Object.entries({
      X: '-12.375',
      Y: '99.125',
      Z: '-4',
      Width: '105.625',
      Height: '72.25',
    }))
      fireEvent.input(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByText('Apply'));
    const edited = result.current.document!;
    validateRecursiveDocument(edited);
    expect(activeGeometry(edited, id)).toMatchObject({
      x: -12.375,
      y: 99.125,
      z: -4,
      width: 105.625,
      height: 72.25,
    });
    expect(edited.objects).toEqual(original.objects);
    expect(edited.layouts.app[0]).toEqual(original.layouts.app[0]);
    expect(edited.layouts.app[1]).toEqual(original.layouts.app[1]);
    expect(edited.layouts.payments).toEqual(original.layouts.payments);
    expect(result.current.past).toHaveLength(1);
    expect(result.current.dirty).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    if (id === 'api')
      expect(activeWorldGeometry(edited).get(id)!.x).toBeCloseTo(500 - 99.125);
    const reopened = JSON.parse(JSON.stringify(edited));
    validateRecursiveDocument(reopened);
    expect(activeGeometry(reopened, id)).toEqual(activeGeometry(edited, id));
    act(() => result.current.undo());
    expect(result.current.document).toEqual(original);
    expect(result.current.dirty).toBe(false);
    act(() => result.current.redo());
    expect(result.current.document).toEqual(edited);
    act(() => result.current.transact(selectRootDepth('app', 0)));
    act(() => result.current.transact(selectRootDepth('app', 2)));
    const restored = result.current.document;
    validateRecursiveDocument(restored);
    expect(restored.layouts.app[2]).toEqual(edited.layouts.app[2]);
  },
);

it.each([
  ['X', ''],
  ['Y', 'Infinity'],
  ['Z', '1.5'],
  ['Width', '0'],
  ['Height', '-2'],
])('retains an invalid %s draft without committing', (label, value) => {
  const onEdit = jest.fn(),
    onClose = jest.fn();
  render(
    <RecursiveProperties
      document={recursiveFixture()}
      target="object-api"
      onEdit={onEdit}
      onClose={onClose}
    />,
  );
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.input(input, { target: { value } });
  fireEvent.submit(input.form!);
  expect(input.checkValidity()).toBe(false);
  expect(onEdit).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.input(input, { target: { value: '3' } });
  expect(input.checkValidity()).toBe(true);
});

it('does not commit unchanged Apply, Cancel or Escape', () => {
  const edit = jest.fn(),
    close = jest.fn();
  render(
    <RecursiveProperties
      document={recursiveFixture()}
      target="object-api"
      onEdit={edit}
      onClose={close}
    />,
  );
  fireEvent.click(screen.getByText('Apply'));
  fireEvent.input(screen.getByLabelText('Width'), {
    target: { value: '5.25' },
  });
  fireEvent.click(screen.getByText('Cancel'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.keyDown(
    screen.getByRole('region', { name: 'Primitive properties' }),
    { key: 'Escape' },
  );
  expect(edit).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(3);
});

it('keeps an IME composition in the draft but cancels on a normal Escape', () => {
  const edit = jest.fn(),
    close = jest.fn();
  render(
    <RecursiveProperties
      document={recursiveFixture()}
      target="object-api"
      onEdit={edit}
      onClose={close}
    />,
  );
  const editor = screen.getByRole('textbox', { name: 'Text' });
  fireEvent.keyDown(editor, { key: 'Escape', isComposing: true });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(editor, { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(1);
  expect(edit).not.toHaveBeenCalled();
});
