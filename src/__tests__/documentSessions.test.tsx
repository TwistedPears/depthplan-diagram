import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { Workspace } from '../renderer/App';
import useDocumentSessions, {
  DocumentSessions,
} from '../renderer/hooks/useDocumentSessions';
import RecursiveProperties from '../renderer/components/RecursiveProperties';
import InlineObjectText from '../renderer/components/InlineObjectText';
import useCanvasClipboard from '../renderer/hooks/useCanvasClipboard';
import { recursiveFixture } from './recursiveFixtures';
import { editObject } from '../shared/documentTransactions';
import { copySelection } from '../shared/recursiveClipboard';
import type RecursiveCanvas from '../renderer/components/RecursiveCanvas';

// Real draft editors and clipboard; native smoke covers Konva painting.
jest.mock('../renderer/components/RecursiveCanvas', () => ({
  __esModule: true,
  default: function Canvas(
    props: React.ComponentProps<typeof RecursiveCanvas>,
  ) {
    const [draft, setDraft] = useState('');
    useCanvasClipboard({
      document: props.document,
      selection: props.canvas.selected,
      isBusy: props.isBusy,
      onEdit: props.onEdit,
      onSelect: (selected) =>
        props.setCanvas((canvas) => ({ ...canvas, selected })),
      onStatus: props.onStatus,
    });
    return (
      <div>
        {props.active && <canvas data-testid="drawing-surface" />}
        <button onClick={() => setDraft('properties')}>Properties draft</button>
        <button onClick={() => setDraft('inline')}>Inline draft</button>
        {draft === 'properties' && (
          <RecursiveProperties
            document={props.document}
            target="object-api"
            onEdit={props.onEdit}
            onClose={() => setDraft('')}
          />
        )}
        {draft === 'inline' && (
          <InlineObjectText
            document={props.document}
            objectId="api"
            hasChildren
            geometry={{
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              z: 0,
              rotation: 0,
            }}
            camera={props.camera}
            toolbarTarget={null}
            onEdit={props.onEdit}
            onClose={() => setDraft('')}
          />
        )}
      </div>
    );
  },
}));

let registry: ReturnType<typeof useDocumentSessions>;
function Navigation() {
  registry = useDocumentSessions();
  return (
    <nav data-session-navigation>
      {registry.sessions.map(({ key }) => (
        <button key={key} onClick={() => registry.activate(key)}>
          Board {key}
        </button>
      ))}
    </nav>
  );
}
function candidate(key: string) {
  const document = recursiveFixture();
  document.metadata.title = key;
  // Deliberately reuse persistent document identity: sessions must remain independent.
  return {
    status: 'success' as const,
    document,
    source: { id: key, path: `/${key}.depthplan`, fingerprint: key },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const controller = (key: string) => registry.controllers.get(key)!;
const board = () =>
  within(
    document.querySelector<HTMLElement>(
      `[data-board-session="${registry.activeKey}"]`,
    )!,
  );
const switchTo = async (key: string) => {
  await act(async () => {
    expect(registry.activate(key)).toBe(true);
  });
};
const open = async (key: string) => {
  await act(async () => {
    expect(await registry.open(key, async () => candidate(key))).toBe(key);
  });
};
const listeners = new Map<string, Set<() => void>>();

beforeEach(() => {
  listeners.clear();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const on = (name: string, fn: () => void) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(fn);
    return () => {
      listeners.get(name)!.delete(fn);
    };
  };
  window.desktop = {
    getAppInstanceId: async () => 'instance',
    events: { on },
    transitions: {
      onRequest: (fn: () => void) => on('close', fn),
      reply: jest.fn(),
      confirm: jest.fn().mockResolvedValue('cancel'),
    },
    recovery: {
      discover: async () => ({ entries: [], warnings: [] }),
      write: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
    automation: {
      status: async () => ({ enabled: false }),
      onRequest: (fn: () => void) => on('automation', fn),
    },
    fileSystem: {
      onOpenRequested: (fn: () => void) => on('os-open', fn),
      saveDocument: jest.fn(),
      openDocument: jest.fn(),
    },
    clipboard: { readText: jest.fn(), writeText: jest.fn() },
    export: { exportJSON: jest.fn() },
  } as unknown as typeof window.desktop;
});

async function setup() {
  const rendered = render(
    <DocumentSessions>
      <Navigation />
      <Workspace />
    </DocumentSessions>,
  );
  await open('A');
  await open('B');
  return rendered;
}

it('preserves exact state/history, saves only the captured board, and cleans listeners after repeated switches', async () => {
  const { unmount } = await setup();
  await switchTo('A');
  act(() => {
    const a = controller('A').owner;
    a.transact(editObject('api', { name: 'A one' }));
    a.transact(editObject('api', { name: 'A two' }));
    a.undo();
    a.setCamera({ x: 73, y: -19, scale: 2 });
    a.setCanvas((canvas) => ({ ...canvas, selected: ['object-api'] }));
  });
  const a = controller('A').owner.snapshot();
  const history = controller('A').owner.past;
  const saved = deferred<any>();
  let saving!: Promise<unknown>;
  act(() => {
    saving = controller('A').files.save(false, { write: () => saved.promise });
  });
  await switchTo('B');
  act(() => {
    controller('B').owner.transact(editObject('api', { name: 'B edit' }));
  });
  const b = controller('B').owner.snapshot();
  await act(async () => {
    saved.resolve({ status: 'success', source: candidate('A').source });
    await saving;
  });
  expect(controller('A').owner.dirty).toBe(false);
  expect(controller('B').owner.snapshot()).toEqual(b);
  expect(window.desktop.recovery.remove).toHaveBeenCalledWith(
    a.sessionId,
    a.revision,
  );
  for (let i = 0; i < 12; i++) {
    await switchTo(i % 2 ? 'B' : 'A');
    expect(screen.getAllByTestId('drawing-surface')).toHaveLength(1);
    for (const subscriptions of listeners.values())
      expect(subscriptions.size).toBe(1);
  }
  await switchTo('A');
  expect(controller('A').owner.snapshot()).toEqual({ ...a, dirty: false });
  expect(controller('A').owner.past).toBe(history);
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
  expect(controller('A').owner.document!.objects.api.name).toBe('A two');
  expect(controller('B').owner.snapshot()).toEqual(b);
  unmount();
  for (const subscriptions of listeners.values())
    expect(subscriptions.size).toBe(0);
});

it('loads on demand, deduplicates reads and paths, and keeps failures and late reads from replacing the active board', async () => {
  await setup();
  const read = deferred<ReturnType<typeof candidate>>();
  const loader = jest.fn(() => read.promise);
  let pending!: Promise<string | null>;
  act(() => {
    pending = registry.open('C', loader);
    expect(registry.open('C', loader)).toBe(pending);
  });
  expect(loader).toHaveBeenCalledTimes(1);
  expect(registry.sessions).toHaveLength(3);
  await switchTo('A');
  await switchTo('B');
  await act(async () => {
    read.resolve(candidate('C'));
    await pending;
  });
  expect(registry.activeKey).toBe('B');
  expect(controller('B').owner.document?.metadata.title).toBe('B');
  await act(async () => {
    expect(await registry.open('alias', async () => candidate('A'))).toBe('A');
    await expect(
      registry.open('bad', async () => ({
        status: 'error',
        error: 'unreadable',
      })),
    ).rejects.toThrow('unreadable');
    await expect(
      registry.open('invalid', async () => ({
        ...candidate('invalid'),
        document: {} as any,
      })),
    ).rejects.toThrow();
  });
  expect(registry.activeKey).toBe('A');
  expect(registry.sessions).toHaveLength(4);
  expect(registry.controllers.size).toBe(4);
  expect(screen.getAllByTestId('drawing-surface')).toHaveLength(1);
});

it('preserves unapplied form and rich-text drafts, focus, and text undo through switches', async () => {
  await setup();
  await switchTo('A');
  fireEvent.click(board().getByText('Properties draft'));
  const input = board().getByLabelText('Name');
  fireEvent.input(input, { target: { value: 'Unapplied A' } });
  input.focus();
  expect(screen.getByText('Draft not saved')).toBeVisible();
  const original = controller('A').owner.snapshot();
  fireEvent.paste(board().getByRole('textbox', { name: 'Text' }), {
    clipboardData: {
      getData: (type: string) =>
        type === 'text/plain' ? 'retained draft text' : '',
    },
  });
  await switchTo('B');
  expect(controller('A').owner.snapshot()).toEqual(original);
  fireEvent.click(board().getByText('Properties draft'));
  fireEvent.input(board().getByLabelText('Name'), {
    target: { value: 'Unapplied B' },
  });
  await switchTo('A');
  expect(board().getByLabelText('Name')).toHaveValue('Unapplied A');
  expect(board().getByLabelText('Name')).toHaveFocus();
  expect(board().getByRole('textbox', { name: 'Text' })).toHaveTextContent(
    'retained draft text',
  );
  fireEvent.click(board().getByText('Undo text'));
  expect(board().getByRole('textbox', { name: 'Text' })).not.toHaveTextContent(
    'retained draft text',
  );
  fireEvent.click(board().getByText('Apply'));
  expect(controller('A').owner.document!.objects.api.name).toBe('Unapplied A');
  expect(controller('A').owner.past).toHaveLength(1);
  await switchTo('B');
  expect(board().getByLabelText('Name')).toHaveValue('Unapplied B');
  expect(controller('B').owner.dirty).toBe(false);
});

it('navigation does not accept inline text, and close resolves only the selected board draft', async () => {
  await setup();
  await switchTo('A');
  fireEvent.click(board().getByText('Inline draft'));
  fireEvent.paste(board().getByRole('textbox', { name: 'Text' }), {
    clipboardData: { getData: () => 'draft A' },
  });
  const before = controller('A').owner.snapshot();
  const button = screen.getByText('Board B');
  fireEvent.pointerDown(button);
  fireEvent.focusIn(button);
  fireEvent.click(button);
  expect(controller('A').owner.snapshot()).toEqual(before);
  await switchTo('A');
  expect(board().getByRole('textbox', { name: 'Text' })).toHaveTextContent(
    'draft A',
  );
  await act(async () => {
    expect(await registry.close('A')).toBe(false);
  });
  expect(window.desktop.transitions.confirm).toHaveBeenLastCalledWith(
    'draft',
    'object text',
    true,
  );
  expect(registry.controllers.has('A')).toBe(true);
  jest.mocked(window.desktop.transitions.confirm).mockResolvedValue('discard');
  await act(async () => {
    expect(await registry.close('A')).toBe(true);
  });
  expect(registry.controllers.has('A')).toBe(false);
  expect(controller('B').owner.dirty).toBe(false);
  await open('A');
  expect(controller('A').owner.sessionId).not.toBe(before.sessionId);
  expect(controller('A').owner.canUndo).toBe(false);
});

it('keeps pending read/export completions on A and cancels a stale clipboard paste on switch', async () => {
  await setup();
  await switchTo('A');
  const read = deferred<ReturnType<typeof candidate>>();
  let loading!: Promise<unknown>;
  act(() => {
    loading = controller('A').files.load('open', undefined, {
      read: () => read.promise,
    });
  });
  await switchTo('B');
  const b = controller('B').owner.snapshot();
  await act(async () => {
    read.resolve(candidate('replacement'));
    await loading;
  });
  expect(controller('A').owner.document!.metadata.title).toBe('replacement');
  expect(controller('B').owner.snapshot()).toEqual(b);
  await switchTo('A');
  const exported = deferred<string>();
  jest
    .mocked(window.desktop.export.exportJSON)
    .mockReturnValue(exported.promise);
  act(() => {
    for (const fn of listeners.get('menu:export-json')!) fn();
  });
  await switchTo('B');
  await act(async () => {
    exported.resolve('/A.depthplan');
  });
  expect(window.desktop.export.exportJSON).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: expect.objectContaining({ title: 'replacement' }),
    }),
    expect.any(String),
  );
  expect(controller('B').owner.snapshot()).toEqual(b);
  const clipboard = deferred<string>();
  jest
    .mocked(window.desktop.clipboard.readText)
    .mockReturnValue(clipboard.promise);
  await act(async () => {
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
  });
  await switchTo('A');
  await act(async () => {
    clipboard.resolve(copySelection(candidate('B').document, ['object-api']));
  });
  expect(controller('B').owner.snapshot()).toEqual(b);
  expect(controller('A').owner.document!.objects).toEqual(
    candidate('replacement').document.objects,
  );
});

it('aborts aggregate close without retiring earlier boards and blocks switching during held gestures', async () => {
  await setup();
  fireEvent.pointerDown(screen.getByTestId('drawing-surface'));
  expect(registry.activate('A')).toBe(false);
  fireEvent.pointerUp(screen.getByTestId('drawing-surface'));
  act(() => {
    controller('A').owner.transact(editObject('api', { name: 'A dirty' }));
    controller('B').owner.transact(editObject('api', { name: 'B dirty' }));
  });
  jest.mocked(window.desktop.recovery.remove).mockClear();
  jest
    .mocked(window.desktop.transitions.confirm)
    .mockResolvedValueOnce('discard')
    .mockResolvedValueOnce('cancel');
  await act(async () => {
    expect(await registry.closeAll()).toBe(false);
  });
  expect(registry.sessions).toHaveLength(3);
  expect(controller('A').owner.dirty).toBe(true);
  expect(controller('B').owner.dirty).toBe(true);
  expect(window.desktop.recovery.remove).not.toHaveBeenCalled();
  expect(controller('A').owner.isBusy()).toBe(false);
});

it('copies accepted content between boards without sharing identity or history', async () => {
  await setup();
  const a = controller('A').owner.snapshot();
  const transfer = copySelection(a.document!, ['object-api']);
  jest.mocked(window.desktop.clipboard.readText).mockResolvedValue(transfer);
  const before = Object.keys(controller('B').owner.document!.objects).length;
  await act(async () => {
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });
  });
  expect(
    Object.keys(controller('B').owner.document!.objects).length,
  ).toBeGreaterThan(before);
  expect(controller('B').owner.canUndo).toBe(true);
  expect(controller('A').owner.snapshot()).toEqual(a);
  act(() => {
    controller('B').owner.undo();
  });
  expect(Object.keys(controller('B').owner.document!.objects)).toHaveLength(
    before,
  );
});
