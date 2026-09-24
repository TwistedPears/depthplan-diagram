import { transactDocument } from '../shared/documentTransactions';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SelectionProperties from '../renderer/components/SelectionProperties';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import { connectionRoute } from '../shared/connectionGeometry';
import { activeWorldGeometry } from '../shared/recursiveHierarchy';
import { type RecursiveDocument } from '../shared/recursiveDocument';
import { recursiveScene } from '../shared/recursiveScene';

it.each([
  ['line', ['connection-path']],
  ['arrow', ['connection-path']],
  ['arrow', ['connection-path', 'object-payments']],
] as const)(
  'exposes all layer controls for %s selections %j',
  (kind, selection) => {
    const document = recursiveFixture();
    document.connections.path = {
      id: 'path',
      kind,
      ownerId: null,
      z: 0,
      start: { kind: 'free', x: 0, y: 0 },
      end: { kind: 'free', x: 100, y: 100 },
    };
    let state: ReturnType<typeof useDocumentState>;
    function Editor() {
      state = useDocumentState(document);
      return (
        <SelectionProperties
          document={state.document!}
          selection={[...selection]}
          textMode={false}
          onEdit={state.transact}
        />
      );
    }
    render(<Editor />);
    for (const name of [
      'Send to back',
      'Send backward',
      'Bring forward',
      'Bring to front',
    ])
      expect(screen.getByRole('button', { name })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Bring to front' }));
    const order = recursiveScene(state!.document!)
      .paintOrder.get(null)!
      .map((item) => `${item.kind}-${item.id}`);
    expect(order.slice(-selection.length)).toEqual(selection);
    act(() => state!.undo());
    expect(state!.document).toEqual(document);
  },
);

it('styles the selected object immediately, groups an opacity drag, and supports Undo', () => {
  const document = recursiveFixture();
  let state: ReturnType<typeof useDocumentState>;
  let current: RecursiveDocument;
  function Editor() {
    state = useDocumentState(document);
    if (!state.document) return null;
    current = state.document;
    return (
      <SelectionProperties
        document={current}
        selection={['object-api']}
        textMode={false}
        onEdit={state.transact}
      />
    );
  }
  render(<Editor />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Background: Yellow' }));
  expect(current!.objects.api.style?.fill).toBe('#ffec99');
  expect(current!.objects.app).toEqual(document.objects.app);
  expect(state!.past).toHaveLength(1);
  const opacity = screen.getByRole('slider', { name: 'Opacity' });
  fireEvent.change(opacity, { target: { value: '0.7' } });
  fireEvent.change(opacity, { target: { value: '0.5' } });
  expect(state!.past).toHaveLength(1);
  fireEvent.pointerUp(opacity);
  expect(current!.objects.api.style?.opacity).toBe(0.5);
  expect(state!.past).toHaveLength(2);
  act(() => state!.undo());
  expect(current!.objects.api.style?.opacity).toBeUndefined();
  expect(current!.objects.api.style?.fill).toBe('#ffec99');
});

it('uses icon-only fill/corner/marker choices with names, tooltips and selected states', () => {
  let document = recursiveFixture();
  const view = render(
    <SelectionProperties
      document={document}
      selection={['object-api']}
      textMode={false}
      onEdit={(edit) => {
        document = transactDocument(document, edit).document;
      }}
    />,
  );
  for (const [name, key, value] of [
    ['Hachure fill', 'fillType', 'hachure'],
    ['Cross hatch fill', 'fillType', 'cross-hatch'],
    ['No fill', 'fillType', 'none'],
    ['Solid fill', 'fillType', 'solid'],
    ['Rounded corners', 'cornerRadius', 12],
    ['Sharp corners', 'cornerRadius', 0],
  ] as const) {
    const button = screen.getByRole('button', { name });
    expect(button).toHaveAttribute('title', name);
    expect(button.textContent).toBe('');
    fireEvent.click(button);
    expect(document.objects.api.style?.[key]).toBe(value);
  }
  document.connections.arrow = {
    id: 'arrow',
    kind: 'arrow',
    ownerId: null,
    z: 0,
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'free', x: 100, y: 100 },
  };
  view.rerender(
    <SelectionProperties
      document={document}
      selection={['connection-arrow']}
      textMode={false}
      onEdit={(edit) => {
        document = transactDocument(document, edit).document;
      }}
    />,
  );
  const picker = screen.getByLabelText('Start marker');
  fireEvent.click(picker);
  fireEvent.click(
    screen.getByRole('button', { name: 'Start marker: Circle outline' }),
  );
  expect(document.connections.arrow.style?.arrowheadStart).toBe(
    'circle_outline',
  );
  expect(picker.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(picker);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Start marker: Bar' }), {
    key: 'Escape',
  });
  expect(picker.closest('details')).not.toHaveAttribute('open');
  expect(picker).toHaveFocus();
});

it('keeps shape paint controls out of text mode', () => {
  render(
    <SelectionProperties
      document={recursiveFixture()}
      selection={['object-api']}
      textMode
      onEdit={jest.fn()}
    />,
  );
  expect(
    screen.queryByRole('group', { name: 'Background' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('slider', { name: 'Opacity' })).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Bring to front' }),
  ).toBeInTheDocument();
});

it.each([
  ['line', 'curved'],
  ['line', 'elbow'],
  ['arrow', 'curved'],
  ['arrow', 'elbow'],
] as const)(
  'changes a %s from %s to Straight by removing bends, with exact Undo/Redo',
  (kind, lineType) => {
    const document = recursiveFixture();
    const original = (document.connections.path = {
      id: 'path',
      kind,
      ownerId: null,
      z: 0,
      start: { kind: 'free', x: -100, y: -100 },
      end: { kind: 'free', x: 200, y: 100 },
      points: [
        { x: 10, y: -200 },
        { x: 100, y: 50 },
      ],
      label: 'Keep this label',
      style: { lineType, stroke: '#123456' },
    });
    let state: ReturnType<typeof useDocumentState>;
    let current: RecursiveDocument;
    function Editor() {
      state = useDocumentState(document);
      if (!state.document) return null;
      current = state.document;
      return (
        <SelectionProperties
          document={current}
          selection={['connection-path']}
          textMode={false}
          onEdit={state.transact}
        />
      );
    }
    render(<Editor />);
    const straight = {
      ...original,
      points: [],
      style: { ...original.style, lineType: 'sharp' },
    };
    fireEvent.click(screen.getByRole('button', { name: 'Straight path' }));
    expect(current!.connections.path).toEqual(straight);
    expect(
      connectionRoute(
        current!,
        current!.connections.path,
        activeWorldGeometry(current!),
      )!.points,
    ).toEqual([-100, -100, 200, 100]);
    expect(state!.past).toHaveLength(1);
    act(() => state!.undo());
    expect(current!.connections.path).toEqual(original);
    act(() => state!.redo());
    expect(current!.connections.path).toEqual(straight);
    fireEvent.click(screen.getByRole('button', { name: 'Curved path' }));
    expect(current!.connections.path.points).toEqual([]);
  },
);
