import { useRef } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import useDocumentFiles from '../renderer/hooks/useDocumentFiles';
import useDocumentTransitions from '../renderer/hooks/useDocumentTransitions';
import useMcpWorkflows from '../renderer/hooks/useMcpWorkflows';
import { DocumentDrafts } from '../renderer/hooks/useDocumentDraft';
import type { RecursiveExportHandle } from '../renderer/components/RecursiveExport';
import { recursiveFixture } from './recursiveFixtures';
import { editObject } from '../shared/documentTransactions';
const source = {
  id: 'source',
  path: '/approved/diagram.json',
  fingerprint: 'a'.repeat(64),
};
const lease = { generation: 1, id: 'lease' };
const checkpoint = { saved: jest.fn(), leave: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  window.desktop = {
    mcpFiles: {
      onRevoked: jest.fn(() => () => {}),
      lease: jest.fn().mockResolvedValue(lease),
      release: jest.fn().mockResolvedValue(undefined),
      check: jest.fn().mockResolvedValue(undefined),
      inspect: jest
        .fn()
        .mockResolvedValue({ path: source.path, fingerprint: null }),
      read: jest.fn().mockResolvedValue({
        document: recursiveFixture(),
        source,
      }),
      write: jest.fn().mockResolvedValue({ source }),
      recovery: jest.fn().mockResolvedValue({
        document: recursiveFixture(),
        source,
        sessionId: 'recovered-session',
      }),
    },
    recovery: { release: jest.fn().mockResolvedValue(undefined) },
    transitions: { confirm: jest.fn() },
    fileSystem: {
      newDocument: jest
        .fn()
        .mockResolvedValue({ document: { ...recursiveFixture(), id: 'new' } }),
    },
  } as unknown as typeof window.desktop;
});
const setup = () =>
  renderHook(
    () => {
      const owner = useDocumentState(recursiveFixture(), 'app');
      const files = useDocumentFiles(owner, jest.fn(), checkpoint);
      const transitions = useDocumentTransitions(
        owner,
        files,
        jest.fn(),
        checkpoint.leave,
      );
      const exportRef = useRef<RecursiveExportHandle>(null);
      const work = useMcpWorkflows({
        owner,
        files,
        transitions,
        exportRef,
        hasDrafts: () => false,
        onStatus: jest.fn(),
      });
      return { owner, work, exportRef };
    },
    { wrapper: DocumentDrafts },
  );
type Harness = ReturnType<typeof setup>['result'];
let sequence = 0;
const args = (result: Harness) => {
  const s = result.current.owner.snapshot();
  return {
    handle: { appInstanceId: 'app', sessionId: s.sessionId },
    expectedRevision: s.revision,
    expectedViewRevision: s.viewRevision,
    requestId: `request-${++sequence}`,
  };
};
const start = (
  result: Harness,
  kind: 'files' | 'export' | 'recovery',
  extra: object,
) => {
  const input = { ...args(result), ...extra };
  let id = '';
  act(() => {
    const reply = result.current.work.start(kind, input);
    if (!reply.ok || typeof reply.data.operationId !== 'string')
      throw new Error(JSON.stringify(reply));
    id = reply.data.operationId;
  });
  return { id, input };
};
const read = (result: Harness, id: string) =>
  result.current.work.read({ appInstanceId: 'app', operationId: id });
const done = (result: Harness, id: string, status = 'completed') =>
  waitFor(() =>
    expect(read(result, id)).toMatchObject({ ok: true, data: { status } }),
  );
const decide = async (result: Harness, id: string, choice: string) => {
  await waitFor(() =>
    expect(result.current.work.activeOperation?.decision).toBeDefined(),
  );
  const request = {
    ...args(result),
    operationId: id,
    decisionId: result.current.work.activeOperation!.decision!.id,
    choice,
  };
  await act(async () =>
    expect(result.current.work.decide(request)).toMatchObject({ ok: true }),
  );
  return request;
};
it('replays a completed New receipt after replacing the session and drains recovery once', async () => {
  const { result } = setup();
  act(() => {
    result.current.owner.transact(editObject('api', { name: 'Unsaved' }));
  });
  const prior = result.current.owner.sessionId;
  const op = start(result, 'files', { action: { type: 'new' } });
  const decision = await decide(result, op.id, 'discard');
  await done(result, op.id);
  expect(result.current.owner.sessionId).not.toBe(prior);
  expect(checkpoint.leave).toHaveBeenCalledTimes(1);
  expect(result.current.work.decide(decision)).toMatchObject({
    ok: true,
    data: { accepted: true, replayed: true },
  });
  expect(result.current.work.start('files', op.input)).toMatchObject({
    ok: true,
    data: { operationId: op.id, replayed: true },
  });
  expect(window.desktop.fileSystem.newDocument).toHaveBeenCalledTimes(1);
  expect(window.desktop.mcpFiles.release).toHaveBeenCalledWith(lease);
});
it('rejects a stale decision and preserves current dirty work', async () => {
  const { result } = setup();
  act(() => {
    result.current.owner.transact(editObject('api', { name: 'Unsaved' }));
  });
  const op = start(result, 'files', { action: { type: 'new' } });
  await waitFor(() =>
    expect(result.current.work.activeOperation?.decision).toBeDefined(),
  );
  const reply = {
    ...args(result),
    operationId: op.id,
    decisionId: result.current.work.activeOperation!.decision!.id,
    choice: 'discard',
  };
  act(() => result.current.owner.setCamera({ x: 5, y: 0, scale: 1 }));
  act(() =>
    expect(result.current.work.decide(reply)).toMatchObject({
      ok: false,
      error: { code: 'STALE_REVISION' },
    }),
  );
  await done(result, op.id, 'canceled');
  expect(result.current.owner.dirty).toBe(true);
  expect(checkpoint.leave).not.toHaveBeenCalled();
});
it('binds overwrite consent to observed bytes and preserves normal save bookkeeping', async () => {
  const { result } = setup();
  act(() =>
    result.current.owner.transact(
      editObject('api', { name: 'Saved through MCP' }),
    ),
  );
  (window.desktop.mcpFiles.inspect as jest.Mock).mockResolvedValue({
    path: source.path,
    fingerprint: 'b'.repeat(64),
  });
  const op = start(result, 'files', {
    action: { type: 'save_as', path: source.path },
  });
  await decide(result, op.id, 'overwrite');
  await done(result, op.id);
  expect(window.desktop.mcpFiles.write).toHaveBeenCalledWith(
    expect.objectContaining({ expected: 'b'.repeat(64), lease }),
  );
  expect(result.current.owner.dirty).toBe(false);
  expect(result.current.owner.source).toEqual(source);
  expect(checkpoint.saved).toHaveBeenCalledTimes(1);
});
it('cancels an in-flight read before clearing recovery or replacing the session', async () => {
  const { result } = setup();
  let finish!: (value: unknown) => void;
  (window.desktop.mcpFiles.read as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const before = result.current.owner.sessionId;
  const op = start(result, 'files', {
    action: { type: 'open', path: source.path },
  });
  await waitFor(() => expect(finish).toBeDefined());
  act(() => result.current.work.cancelActive());
  await act(async () => finish({ document: recursiveFixture(), source }));
  await done(result, op.id, 'canceled');
  expect(result.current.owner.sessionId).toBe(before);
  expect(checkpoint.leave).not.toHaveBeenCalled();
});
it('releases canceled recovery claims and accepts a restored document through the same transition', async () => {
  const { result } = setup();
  const first = start(result, 'recovery', { id: 'entry', action: 'restore' });
  await decide(result, first.id, 'cancel');
  await done(result, first.id, 'canceled');
  expect(window.desktop.recovery.release).toHaveBeenCalledWith('entry');
  const second = start(result, 'recovery', { id: 'entry', action: 'restore' });
  await decide(result, second.id, 'accept');
  await done(result, second.id);
  expect(result.current.owner.sessionId).toBe('recovered-session');
  expect(result.current.owner.dirty).toBe(true);
  expect(checkpoint.leave).toHaveBeenCalledTimes(1);
});
it('rejects a superseded rendered export before writing a file', async () => {
  const { result } = setup();
  let finish!: (value: string) => void;
  const capture = jest.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  result.current.exportRef.current = Object.assign(() => {}, { capture });
  const op = start(result, 'export', {
    path: '/approved/scene.svg',
    format: 'svg',
  });
  await waitFor(() => expect(finish).toBeDefined());
  act(() => result.current.owner.setCamera({ x: 8, y: 0, scale: 1 }));
  await act(async () => finish('<svg/>'));
  await done(result, op.id, 'failed');
  expect(window.desktop.mcpFiles.write).not.toHaveBeenCalled();
});
it('reports recovery cleanup failures and retains the current document', async () => {
  const { result } = setup();
  checkpoint.leave.mockRejectedValueOnce(
    new Error('Recovery disk is unavailable'),
  );
  const before = result.current.owner.sessionId;
  const op = start(result, 'recovery', { id: 'entry', action: 'restore' });
  await decide(result, op.id, 'accept');
  await done(result, op.id, 'failed');
  expect(read(result, op.id)).toMatchObject({
    data: { error: 'Recovery disk is unavailable' },
  });
  expect(result.current.owner.sessionId).toBe(before);
  expect(window.desktop.recovery.release).toHaveBeenCalledWith('entry');
});
