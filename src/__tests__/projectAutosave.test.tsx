import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import useDocumentFiles from '../renderer/hooks/useDocumentFiles';
import useProjectAutosave from '../renderer/hooks/useProjectAutosave';
import { recursiveFixture } from './recursiveFixtures';
import { editObject } from '../shared/documentTransactions';

function setup() {
  return renderHook(() => {
    const [enabled, setEnabled] = useState(true);
    const owner = useDocumentState(recursiveFixture(), null, {
      source: {
        id: 'source',
        path: '/project/a.depthplan',
        fingerprint: 'original',
      },
    });
    const files = useDocumentFiles(owner, () => {}, undefined, {
      sessionId: 'project',
      boardId: owner.document!.id,
    });
    useProjectAutosave(owner, files, enabled);
    return { owner, files, setEnabled };
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  window.desktop = {
    projects: {
      writeBoard: jest.fn().mockResolvedValue({
        status: 'success',
        source: {
          id: 'saved',
          path: '/project/a.depthplan',
          fingerprint: 'saved',
        },
      }),
    },
  } as unknown as typeof window.desktop;
});
afterEach(() => jest.useRealTimers());
const tick = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

test('idle and sustained edits coalesce with a five-second ceiling and preserve history', async () => {
  const { result } = setup();
  for (let index = 0; index < 6; index++) {
    act(() =>
      result.current.owner.transact(
        editObject('api', { name: `Edit ${index}` }),
      ),
    );
    await tick(900);
  }
  expect(window.desktop.projects.writeBoard).toHaveBeenCalledTimes(1);
  expect(result.current.owner.dirty).toBe(false);
  expect(result.current.owner.past).toHaveLength(6);
  act(() =>
    result.current.owner.transact(editObject('api', { name: 'Idle save' })),
  );
  await tick(999);
  expect(window.desktop.projects.writeBoard).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(window.desktop.projects.writeBoard).toHaveBeenCalledTimes(2);
  expect(result.current.owner.canUndo).toBe(true);
});

test('a slow acknowledgment saves its captured revision and queues the newer edit', async () => {
  const { result } = setup();
  let finish!: (
    value: Awaited<ReturnType<typeof window.desktop.projects.writeBoard>>,
  ) => void;
  jest.mocked(window.desktop.projects.writeBoard).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() =>
    result.current.owner.transact(editObject('api', { name: 'First' })),
  );
  await tick(1000);
  expect(result.current.files.loading).toBe(true);
  expect(result.current.files.blocking).toBe(false);
  expect(result.current.owner.isBusy()).toBe(false);
  act(() =>
    result.current.owner.transact(editObject('api', { name: 'Second' })),
  );
  await tick(6000);
  expect(window.desktop.projects.writeBoard).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({
      status: 'success',
      source: {
        id: 'saved',
        path: '/project/a.depthplan',
        fingerprint: 'first',
      },
    });
    await result.current.files.wait();
  });
  expect(result.current.owner.dirty).toBe(true);
  await tick(1000);
  expect(window.desktop.projects.writeBoard).toHaveBeenCalledTimes(2);
  expect(jest.mocked(window.desktop.projects.writeBoard).mock.calls[1][2]).toBe(
    'first',
  );
  expect(result.current.owner.dirty).toBe(false);
  expect(result.current.owner.past).toHaveLength(2);
});

test('disabling stops new writes; failures pause scheduling across edits and toggles until explicit retry succeeds', async () => {
  const { result } = setup();
  act(() => {
    result.current.setEnabled(false);
    result.current.owner.transact(editObject('api', { name: 'Manual' }));
  });
  await tick(6000);
  expect(window.desktop.projects.writeBoard).not.toHaveBeenCalled();
  jest
    .mocked(window.desktop.projects.writeBoard)
    .mockRejectedValueOnce(
      new Error('The source file changed before it could be replaced.'),
    );
  act(() => result.current.setEnabled(true));
  await tick(1000);
  expect(result.current.files.failure?.conflict).toBe(true);
  act(() =>
    result.current.owner.transact(editObject('api', { name: 'Still local' })),
  );
  act(() => result.current.setEnabled(false));
  act(() => result.current.setEnabled(true));
  await tick(6000);
  expect(window.desktop.projects.writeBoard).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.files.save();
  });
  expect(result.current.files.failure).toBeNull();
  expect(result.current.owner.dirty).toBe(false);
  act(() =>
    result.current.owner.transact(editObject('api', { name: 'Resumed' })),
  );
  await tick(1000);
  expect(window.desktop.projects.writeBoard).toHaveBeenCalledTimes(3);
});
