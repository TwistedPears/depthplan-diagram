import { useRef, type ReactNode } from 'react';
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import useDocumentFiles from '../renderer/hooks/useDocumentFiles';
import useDocumentTransitions from '../renderer/hooks/useDocumentTransitions';
import useDocumentDraft, {
  DocumentDrafts,
} from '../renderer/hooks/useDocumentDraft';
import { editObject } from '../shared/documentTransactions';
import { recursiveFixture } from './recursiveFixtures';
const file = { id: 'original', path: '/diagram.json', fingerprint: 'A' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <DocumentDrafts>{children}</DocumentDrafts>
);
const setup = (draft = false) =>
  renderHook(
    () => {
      const owner = useDocumentState(recursiveFixture(), 'instance');
      const draftActive = useRef(draft);
      useDocumentDraft({
        label: 'Test text',
        active: () => draftActive.current,
        apply: () => {
          owner.transact(editObject('api', { name: 'Applied draft' }));
          draftActive.current = false;
        },
        discard: () => {
          draftActive.current = false;
        },
      });
      const status = jest.fn();
      const files = useDocumentFiles(owner, status);
      const transitions = useDocumentTransitions(owner, files, status);
      return { owner, files, transitions, draftActive, status };
    },
    { wrapper },
  );
beforeEach(() => {
  window.desktop = {
    transitions: { confirm: jest.fn().mockResolvedValue('cancel') },
    fileSystem: {
      newDocument: jest.fn().mockResolvedValue({
        document: { ...recursiveFixture(), id: 'new' },
        filePath: null,
      }),
      openDocument: jest.fn().mockResolvedValue({
        status: 'success',
        document: { ...recursiveFixture(), id: 'opened' },
        source: { ...file, path: '/other.json' },
      }),
      reloadDocument: jest.fn().mockResolvedValue({
        status: 'success',
        document: recursiveFixture(),
        source: file,
      }),
      saveDocument: jest.fn().mockResolvedValue({
        status: 'success',
        source: { ...file, id: 'saved' },
      }),
    },
  } as unknown as typeof window.desktop;
});
it.each(['new', 'open', 'reload', 'close'] as const)(
  'guards %s with Save/Discard/Cancel for unnamed, saved-source and recovered work',
  async (kind) => {
    for (const baseline of ['unnamed', 'source', 'recovered'])
      for (const choice of ['save', 'discard', 'cancel']) {
        const { result, unmount } = setup();
        act(() => {
          result.current.owner.replace(recursiveFixture(), {
            source: baseline === 'unnamed' && kind !== 'reload' ? null : file,
            dirty: baseline === 'recovered',
          });
          result.current.owner.transact(editObject('api', { name: 'Dirty' }));
        });
        const before = result.current.owner.snapshot();
        (window.desktop.transitions.confirm as jest.Mock).mockResolvedValue(
          choice,
        );
        let accepted = false;
        await act(async () => {
          accepted = await result.current.transitions.request(kind);
        });
        expect(accepted).toBe(choice !== 'cancel');
        if (kind === 'close' && choice !== 'cancel') {
          expect(result.current.transitions.isPending()).toBe(true);
          expect(result.current.owner.isBusy()).toBe(true);
        }
        if (kind !== 'close' && choice !== 'cancel')
          expect(result.current.owner.sessionId).not.toBe(before.sessionId);
        else expect(result.current.owner.sessionId).toBe(before.sessionId);
        if (choice === 'cancel')
          expect(result.current.owner.document).toBe(before.document);
        if (choice === 'save')
          expect(
            window.desktop.fileSystem.saveDocument,
          ).toHaveBeenLastCalledWith(before.document, before.source?.id);
        unmount();
      }
  },
);
it('does not prompt for empty/clean work or Undo back to saved content', async () => {
  const { result } = setup();
  act(() => {
    result.current.owner.transact(editObject('api', { name: 'Temporary' }));
    result.current.owner.undo();
  });
  await act(async () => {
    expect(await result.current.transitions.request('new')).toBe(true);
  });
  expect(window.desktop.transitions.confirm).not.toHaveBeenCalled();
});
it.each(['canceled', 'error'] as const)(
  'vetoes exit after a %s save',
  async (status) => {
    const { result } = setup();
    act(() => {
      result.current.owner.transact(editObject('api', { name: 'Dirty' }));
    });
    (window.desktop.transitions.confirm as jest.Mock).mockResolvedValue('save');
    (window.desktop.fileSystem.saveDocument as jest.Mock).mockResolvedValue({
      status,
      error: 'Disk full',
    });
    await act(async () => {
      expect(await result.current.transitions.request('close')).toBe(false);
    });
    expect(result.current.owner.dirty).toBe(true);
    expect(result.current.transitions.isPending()).toBe(false);
  },
);
it('resolves drafts before dirty work, retains Cancel drafts, and rejects reentrant requests/MCP while waiting', async () => {
  const { result } = setup(true);
  let answer!: (choice: string) => void;
  (window.desktop.transitions.confirm as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  let pending!: Promise<boolean>;
  act(() => {
    pending = result.current.transitions.request('new');
  });
  await waitFor(() =>
    expect(window.desktop.transitions.confirm).toHaveBeenCalledWith(
      'draft',
      'Test text',
      true,
    ),
  );
  await act(async () => {
    expect(await result.current.transitions.request('close')).toBe(false);
  });
  const snapshot = result.current.owner.snapshot();
  act(() => {
    expect(
      result.current.owner.setDepth({
        handle: { appInstanceId: 'instance', sessionId: snapshot.sessionId },
        rootId: 'app',
        expectedRevision: snapshot.revision,
        depth: 0,
        requestId: 'busy',
      }),
    ).toMatchObject({ ok: false, error: { code: 'BUSY' } });
  });
  await act(async () => {
    answer('cancel');
    expect(await pending).toBe(false);
  });
  expect(result.current.draftActive.current).toBe(true);
  expect(result.current.owner.document).toBe(snapshot.document);
  (window.desktop.transitions.confirm as jest.Mock)
    .mockResolvedValueOnce('save')
    .mockResolvedValueOnce('cancel');
  await act(async () => {
    expect(await result.current.transitions.request('new')).toBe(false);
  });
  expect(result.current.draftActive.current).toBe(false);
  expect(result.current.owner.dirty).toBe(true);
});
it('guards a newer edit after Save and rereads the same source after a successful guarded Save', async () => {
  const { result } = setup();
  act(() => {
    result.current.owner.replace(recursiveFixture(), { source: file });
    result.current.owner.transact(editObject('api', { name: 'A' }));
  });
  let finish!: (value: unknown) => void;
  (window.desktop.transitions.confirm as jest.Mock)
    .mockResolvedValueOnce('save')
    .mockResolvedValueOnce('cancel');
  (window.desktop.fileSystem.saveDocument as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let pending!: Promise<boolean>;
  act(() => {
    pending = result.current.transitions.request('reload');
  });
  await waitFor(() =>
    expect(window.desktop.fileSystem.saveDocument).toHaveBeenCalled(),
  );
  act(() => {
    result.current.owner.transact(editObject('api', { name: 'B' }));
  });
  await act(async () => {
    finish({
      status: 'success',
      source: { ...file, id: 'saved-A', fingerprint: 'A-new' },
    });
    expect(await pending).toBe(false);
  });
  expect(result.current.owner.dirty).toBe(true);
  const saved = result.current.owner.document;
  (window.desktop.transitions.confirm as jest.Mock).mockResolvedValue('save');
  (window.desktop.fileSystem.saveDocument as jest.Mock).mockResolvedValue({
    status: 'success',
    source: { ...file, id: 'saved-B', fingerprint: 'B' },
  });
  (window.desktop.fileSystem.reloadDocument as jest.Mock)
    .mockResolvedValueOnce({
      status: 'success',
      document: recursiveFixture(),
      source: file,
    })
    .mockResolvedValueOnce({
      status: 'success',
      document: saved,
      source: { ...file, id: 'reloaded-B', fingerprint: 'B' },
    });
  await act(async () => {
    expect(await result.current.transitions.request('reload')).toBe(true);
  });
  expect(result.current.owner.document).toEqual(saved);
  expect(result.current.owner.dirty).toBe(false);
  expect(result.current.owner.canUndo).toBe(false);
  expect(window.desktop.fileSystem.reloadDocument).toHaveBeenLastCalledWith(
    'saved-B',
  );
});
it('requires a held canvas gesture to finish before any native file action', async () => {
  const { result } = setup();
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  fireEvent.pointerDown(canvas);
  await act(async () => {
    expect(await result.current.transitions.request('open')).toBe(false);
  });
  expect(window.desktop.fileSystem.openDocument).not.toHaveBeenCalled();
  fireEvent.pointerUp(canvas);
  canvas.remove();
});

it('freezes accepted work after close approval until main closes or the handshake fails', async () => {
  const { result } = setup();
  const before = result.current.owner.snapshot();
  await act(async () => {
    expect(await result.current.transitions.request('close')).toBe(true);
  });
  act(() => {
    result.current.owner.transact(editObject('api', { name: 'Too late' }));
    result.current.owner.replace(recursiveFixture());
  });
  expect(result.current.owner.snapshot()).toEqual(before);
  act(() => {
    result.current.transitions.release();
    result.current.owner.transact(
      editObject('api', { name: 'Retry after failure' }),
    );
  });
  expect(result.current.owner.dirty).toBe(true);
});
it('guards Restore and installs a fresh dirty session with empty history only after cleanup succeeds', async () => {
  const leave = jest.fn(async (_id: string) => {});
  const { result } = renderHook(
    () => {
      const owner = useDocumentState(recursiveFixture(), 'instance');
      const files = useDocumentFiles(owner, jest.fn());
      const transitions = useDocumentTransitions(
        owner,
        files,
        jest.fn(),
        leave,
      );
      return { owner, transitions };
    },
    { wrapper },
  );
  act(() => {
    result.current.owner.transact(
      editObject('api', { name: 'Unsaved current' }),
    );
  });
  const before = result.current.owner.snapshot();
  const recovered = recursiveFixture();
  recovered.extensions = { opaque: true };
  const install = () => {
    result.current.owner.replace(recovered, {
      dirty: true,
      sessionId: 'restored',
    });
  };
  await act(async () => {
    expect(await result.current.transitions.request('restore', install)).toBe(
      false,
    );
  });
  expect(result.current.owner.snapshot()).toEqual(before);
  expect(leave).not.toHaveBeenCalled();
  (window.desktop.transitions.confirm as jest.Mock).mockResolvedValue(
    'discard',
  );
  leave.mockRejectedValueOnce(new Error('cleanup failed'));
  await act(async () => {
    expect(await result.current.transitions.request('restore', install)).toBe(
      false,
    );
  });
  expect(result.current.owner.snapshot()).toEqual(before);
  expect(result.current.owner.isBusy()).toBe(false);
  await act(async () => {
    expect(await result.current.transitions.request('restore', install)).toBe(
      true,
    );
  });
  expect(result.current.owner.document).toEqual(recovered);
  expect(result.current.owner.sessionId).toBe('restored');
  expect(result.current.owner.dirty).toBe(true);
  expect(result.current.owner.canUndo).toBe(false);
  expect(result.current.owner.canRedo).toBe(false);
  expect(result.current.owner.source).toBeNull();
  expect(
    result.current.owner.getHierarchy({
      handle: { appInstanceId: 'instance', sessionId: before.sessionId },
    }),
  ).toMatchObject({ ok: false });
});
