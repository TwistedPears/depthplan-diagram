import { act, fireEvent, renderHook } from '@testing-library/react';
import { recursiveFixture } from './recursiveFixtures';
import useDocumentState from '../renderer/hooks/useDocumentState';
import useDocumentHistoryActions from '../renderer/hooks/useDocumentHistoryActions';
import { editObject, editActiveGeometry } from '../shared/documentTransactions';
import { selectRootDepth } from '../shared/recursiveLayouts';

it('restores whole compound snapshots, including hidden layouts/references, through undo and redo', () => {
  const original = recursiveFixture();
  const { result } = renderHook(() => useDocumentState(original));
  act(() =>
    result.current.transact((draft) => {
      editObject('api', {
        name: 'Edited',
        style: { fill: '#123456' },
        content: [{ type: 'code', text: 'x', language: 'sql' }],
      })(draft);
      editActiveGeometry('api', { x: 500, width: 300 })(draft);
      draft.extensions = { layoutArchive: [{ sourceDepth: 7 }] };
      draft.connections.link = {
        id: 'link',
        ownerId: null,
        z: 0,
        kind: 'arrow',
        start: { kind: 'object', objectId: 'app', side: 'right', offset: 0.5 },
        end: {
          kind: 'object',
          objectId: 'payments',
          side: 'left',
          offset: 0.5,
        },
      };
      delete draft.objects.endpoint;
      for (const layout of Object.values(draft.layouts.app))
        delete layout.endpoint;
    }),
  );
  const changed = result.current.document;
  expect(result.current.past).toHaveLength(1);
  expect(result.current.dirty).toBe(true);
  for (let i = 0; i < 3; i++) {
    act(() => result.current.undo());
    expect(result.current.document).toEqual(original);
    expect(result.current.dirty).toBe(false);
    act(() => result.current.redo());
    expect(result.current.document).toEqual(changed);
  }
});

it('depth initialization is one undo; rejected/noop edits preserve redo and new edits clear it', () => {
  const d = recursiveFixture();
  delete d.layouts.app[2];
  const { result } = renderHook(() => useDocumentState(d));
  act(() => result.current.transact(selectRootDepth('app', 2)));
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(d);
  act(() => result.current.transact(() => {}));
  act(() => result.current.transact(editActiveGeometry('api', { width: -1 })));
  expect(result.current.canRedo).toBe(true);
  act(() => result.current.transact(editObject('app', { name: 'New branch' })));
  expect(result.current.canRedo).toBe(false);
});

it('save marks only captured content clean and does not clear history', () => {
  const { result } = renderHook(() => useDocumentState(recursiveFixture()));
  act(() => result.current.transact(editObject('app', { name: 'Saved' })));
  const captured = result.current.document!;
  const session = result.current.sessionId;
  act(() =>
    result.current.transact(editObject('app', { name: 'During write' })),
  );
  act(() => result.current.markSaved(captured, session));
  expect(result.current.dirty).toBe(true);
  expect(result.current.past).toHaveLength(2);
  act(() => result.current.undo());
  expect(result.current.dirty).toBe(false);
  act(() => result.current.undo());
  expect(result.current.dirty).toBe(true);
  act(() => result.current.redo());
  expect(result.current.dirty).toBe(false);
});

it('replacement including identical document IDs starts a fresh session and ignores stale saves', () => {
  const d = recursiveFixture();
  const { result } = renderHook(() => useDocumentState(d));
  act(() =>
    result.current.transact(editObject('app', { name: 'Before open' })),
  );
  const oldSession = result.current.sessionId;
  const oldDocument = result.current.document!;
  act(() => result.current.replace(recursiveFixture()));
  expect(result.current.sessionId).not.toBe(oldSession);
  expect(result.current.canUndo).toBe(false);
  act(() => result.current.markSaved(oldDocument, oldSession));
  expect(result.current.dirty).toBe(false);
  act(() => result.current.replace(null));
  expect(result.current.document).toBeNull();
  expect(result.current.canRedo).toBe(false);
});

it('routes keyboard/menu actions to diagram history or the focused native editor', () => {
  const listeners = new Map<string, () => void>();
  const native = jest.fn();
  window.desktop = {
    editHistory: native,
    events: {
      on: (channel: string, callback: () => void) => {
        listeners.set(channel, callback);
        return () => listeners.delete(channel);
      },
    },
  } as unknown as typeof window.desktop;
  const undo = jest.fn(),
    redo = jest.fn();
  const { unmount } = renderHook(() =>
    useDocumentHistoryActions(true, undo, redo),
  );
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  fireEvent.keyDown(window, { key: 'Z', metaKey: true, shiftKey: true });
  expect(undo).toHaveBeenCalledTimes(1);
  expect(redo).toHaveBeenCalledTimes(1);
  const editor = document.createElement('textarea');
  document.body.append(editor);
  editor.focus();
  fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
  listeners.get('menu:undo')!();
  expect(native).toHaveBeenCalledWith('undo');
  expect(undo).toHaveBeenCalledTimes(1);
  editor.remove();
  listeners.get('menu:undo')!();
  expect(undo).toHaveBeenCalledTimes(2);
  unmount();
  expect(listeners.size).toBe(0);
});
