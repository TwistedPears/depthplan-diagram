import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import useDocumentFiles from '../renderer/hooks/useDocumentFiles';
import { recursiveFixture } from './recursiveFixtures';
import { editObject } from '../shared/documentTransactions';
import type { FileResult, SourceFile } from '../shared/fileContract';
const source = {
  id: 'file-one',
  path: '/one.depthplan.json',
  fingerprint: 'one',
};
const initial = recursiveFixture();
function setup() {
  return renderHook(() => {
    const owner = useDocumentState(initial);
    return {
      owner,
      files: useDocumentFiles(owner, jest.fn()),
    };
  });
}
beforeEach(() => {
  window.desktop = {
    fileSystem: {
      newDocument: jest
        .fn()
        .mockResolvedValue({ document: initial, filePath: null }),
      openDocument: jest.fn().mockResolvedValue({
        status: 'success',
        document: initial,
        source,
      }),
      reloadDocument: jest.fn().mockResolvedValue({
        status: 'success',
        document: initial,
        source,
      }),
      saveDocument: jest.fn().mockResolvedValue({ status: 'success', source }),
    },
  } as unknown as typeof window.desktop;
});
it('keeps the legacy source for Save and requests native naming only for Save As', async () => {
  const { result } = setup();
  await act(async () => {
    await result.current.files.load('open');
    await result.current.files.save();
  });
  expect(window.desktop.fileSystem.saveDocument).toHaveBeenLastCalledWith(
    initial,
    source.id,
    false,
  );
  expect(result.current.owner.source?.path).toBe('/one.depthplan.json');
  const migrated = { ...source, id: 'native-file', path: '/one.depthplan' };
  (window.desktop.fileSystem.saveDocument as jest.Mock).mockResolvedValue({
    status: 'success',
    source: migrated,
  });
  await act(async () => {
    await result.current.files.save(true);
  });
  expect(window.desktop.fileSystem.saveDocument).toHaveBeenLastCalledWith(
    initial,
    source.id,
    true,
  );
  expect(result.current.owner.source).toEqual(migrated);
  await act(async () => {
    await result.current.files.save();
  });
  expect(window.desktop.fileSystem.saveDocument).toHaveBeenLastCalledWith(
    initial,
    migrated.id,
    false,
  );
});
it('replaces identical document IDs with fresh clean sessions and keeps canceled targets', async () => {
  const { result } = setup();
  const previous = result.current.owner.sessionId;
  await act(async () => {
    await result.current.files.load('open');
  });
  expect(result.current.owner.sessionId).not.toBe(previous);
  expect(result.current.owner.dirty).toBe(false);
  const oldSession = result.current.owner.sessionId;
  (window.desktop.fileSystem.openDocument as jest.Mock).mockResolvedValue({
    status: 'canceled',
  });
  await act(async () => {
    await result.current.files.load('open');
  });
  expect(result.current.owner.sessionId).toBe(oldSession);
  expect(result.current.owner.dirty).toBe(false);
  expect(result.current.owner.canUndo).toBe(false);
  expect(result.current.owner.source).toEqual(source);
});
it.each([undefined, 1, 3])(
  'rejects format %s without replacing dirty work, source or history',
  async (formatVersion) => {
    const { result } = setup();
    await act(async () => {
      await result.current.files.load('open');
    });
    act(() => {
      result.current.owner.transact(editObject('api', { name: 'Keep me' }));
    });
    const before = result.current.owner.snapshot();
    const invalid = { ...initial, formatVersion };
    (window.desktop.fileSystem.openDocument as jest.Mock).mockResolvedValue({
      status: 'success',
      document: invalid,
      source: { ...source, id: 'unsupported' },
    });
    const guard = jest.fn();
    await act(async () => {
      expect((await result.current.files.load('open', guard)).status).toBe(
        'error',
      );
    });
    expect(result.current.owner.snapshot()).toEqual(before);
    expect(result.current.owner.canUndo).toBe(true);
    expect(guard).not.toHaveBeenCalled();
  },
);
it('saves only the captured revision and cannot move a new session to an obsolete save target', async () => {
  const { result } = setup();
  let complete!: (value: FileResult<{ source: SourceFile }>) => void;
  (window.desktop.fileSystem.saveDocument as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  let pending: ReturnType<typeof result.current.files.save>;
  act(() => {
    pending = result.current.files.save();
  });
  act(() => {
    result.current.owner.transact(editObject('api', { name: 'Later edit' }));
  });
  await act(async () => {
    complete({ status: 'success', source });
    await pending;
  });
  expect(result.current.owner.dirty).toBe(true);
  expect(result.current.owner.canUndo).toBe(true);
  act(() => {
    result.current.owner.undo();
  });
  expect(result.current.owner.dirty).toBe(false);
  act(() => {
    pending = result.current.files.save(true);
  });
  act(() => {
    result.current.owner.replace(initial, {
      source: { ...source, id: 'file-two', path: '/two.json' },
    });
  });
  await act(async () => {
    complete({ status: 'success', source });
    expect((await pending).status).toBe('stale');
  });
  expect(result.current.owner.source?.path).toBe('/two.json');
});
it('rejects late read candidates after a newer edit and retains target on canceled Save As', async () => {
  const { result } = setup();
  await act(async () => {
    await result.current.files.load('open');
  });
  const id = result.current.owner.sessionId;
  let finish!: (value: unknown) => void;
  (window.desktop.fileSystem.openDocument as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let pending: ReturnType<typeof result.current.files.load>;
  act(() => {
    pending = result.current.files.load('open');
  });
  act(() => {
    result.current.owner.transact(editObject('api', { name: 'Keep me' }));
  });
  await act(async () => {
    finish({
      status: 'success',
      document: initial,
      source,
    });
    expect((await pending).status).toBe('stale');
  });
  expect(result.current.owner.sessionId).toBe(id);
  (window.desktop.fileSystem.saveDocument as jest.Mock).mockResolvedValue({
    status: 'canceled',
  });
  await act(async () => {
    await result.current.files.save(true);
  });
  expect(result.current.owner.source).toEqual(source);
  expect(result.current.owner.dirty).toBe(true);
});
