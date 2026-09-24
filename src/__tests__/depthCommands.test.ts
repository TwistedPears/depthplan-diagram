import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import {
  depthTools,
  type ApiResult,
  type CommandData,
} from '../shared/depthApiContract';
import { createDepthCommands } from '../shared/depthCommands';
import { editObject } from '../shared/documentTransactions';

const success = <T>(result: ApiResult<T>) => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result;
};
const error = (result: ApiResult<unknown>) => {
  expect(result.ok).toBe(false);
  return !result.ok && result.error.code;
};
function setup() {
  const hook = renderHook(() =>
    useDocumentState(recursiveFixture(), 'app-run'),
  );
  const handle = {
    appInstanceId: 'app-run',
    sessionId: hook.result.current.sessionId,
  };
  const request = (
    requestId = 'one',
    depth = 0,
    expectedRevision = 0,
    rootId = 'app',
  ) => ({ handle, requestId, rootId, depth, expectedRevision });
  return { ...hook, handle, request };
}
it('serializes API/manual commands in one event turn and returns the authoritative state immediately', () => {
  const { result, request } = setup();
  const context = result.current.getContext;
  const setDepth = result.current.setDepth;
  act(() => {
    const first = success(setDepth(request()));
    expect(first.state).toMatchObject({ revision: 1, dirty: true });
    expect(first.data).toMatchObject({
      selectedDepth: 0,
      changed: true,
      appliedRevision: 1,
    });
    expect(
      success(context()).data.roots.find((r) => r.id === 'app')!.selectedDepth,
    ).toBe(0);
    result.current.selectDepth('app', 2);
    expect(success(context()).state!.revision).toBe(2);
    expect(error(setDepth(request('stale', 1, 1)))).toBe('STALE_REVISION');
    const replay = success(setDepth(request()));
    expect(replay.data).toEqual({
      rootId: 'app',
      maximumDepth: 2,
      selectedDepth: 2,
      changed: false,
      replayed: true,
      appliedRevision: 1,
    });
    expect(replay.state!.revision).toBe(2);
  });
  expect(result.current.past).toHaveLength(2);
  act(() => result.current.undo());
  expect(success(context()).state!.revision).toBe(3);
  expect(success(setDepth(request())).data.appliedRevision).toBe(1);
  expect(result.current.past).toHaveLength(1);
});
it('UI/API depth choices produce identical layouts/history and leaf/repeated choices are no-ops', () => {
  const { result, request, handle } = setup();
  const ui = renderHook(() => useDocumentState(recursiveFixture(), 'app-run'));
  for (const depth of [0, 2, 1]) {
    const revision = result.current.revision;
    act(() => {
      result.current.setDepth(request(`depth-${depth}`, depth, revision));
      ui.result.current.selectDepth('app', depth);
    });
    expect(result.current.result!.document.layouts).toEqual(
      ui.result.current.result!.document.layouts,
    );
    expect(result.current.result!.document.rootDepths).toEqual(
      ui.result.current.result!.document.rootDepths,
    );
    expect(result.current.past).toHaveLength(ui.result.current.past.length);
  }
  const count = result.current.past.length,
    revision = result.current.revision;
  act(() => {
    expect(
      success(result.current.setDepth(request('noop', 1, revision))).data
        .changed,
    ).toBe(false);
    expect(
      success(
        result.current.revealAll({
          handle,
          rootId: 'payments',
          requestId: 'leaf',
          expectedRevision: revision,
        }),
      ).data.changed,
    ).toBe(false);
  });
  expect(result.current.past).toHaveLength(count);
  expect(result.current.revision).toBe(revision);
  depthTools.depthplan_set_depth.output.parse(
    result.current.setDepth(request('noop', 1, revision)),
  );
});
it.each([
  'canvas-gesture',
  'canvas-draft',
  'depth-draft:app',
  'document-transition',
])(
  'rejects %s without queuing or caching and queries still see committed state',
  (source) => {
    const { result, request } = setup();
    act(() => result.current.setBusy(source, true));
    const before = result.current.document;
    expect(error(result.current.setDepth(request()))).toBe('BUSY');
    expect(
      success(result.current.getContext()).data.roots.find(
        (r) => r.id === 'app',
      )!.selectedDepth,
    ).toBe(1);
    expect(result.current.document).toBe(before);
    expect(result.current.past).toHaveLength(0);
    act(() => result.current.setBusy(source, false));
    expect(result.current.document).toBe(before);
    act(() => {
      expect(success(result.current.setDepth(request())).data.changed).toBe(
        true,
      );
    });
  },
);
it('rejects malformed inputs, stale handles, invalid roots/ranges and reused identities without publishing', () => {
  const { result, request, handle } = setup();
  const cases: [unknown, string][] = [
    [{ ...request(), extra: true }, 'INVALID_REQUEST'],
    [{ ...request(), depth: -1 }, 'INVALID_REQUEST'],
    [{ ...request(), depth: 1.5 }, 'INVALID_REQUEST'],
    [
      { ...request(), handle: { ...handle, appInstanceId: 'other' } },
      'STALE_APP',
    ],
    [
      { ...request(), handle: { ...handle, sessionId: 'other' } },
      'STALE_SESSION',
    ],
    [request('x', 0, 0, 'missing'), 'NOT_FOUND'],
    [request('x', 0, 0, 'api'), 'NOT_ROOT'],
    [request('x', 3), 'INVALID_DEPTH'],
  ];
  for (const [args, code] of cases)
    expect(error(result.current.setDepth(args))).toBe(code);
  expect(result.current.past).toHaveLength(0);
  expect(result.current.dirty).toBe(false);
  act(() => {
    result.current.setDepth(request());
  });
  expect(error(result.current.setDepth(request('one', 2, 1)))).toBe(
    'REQUEST_ID_REUSED',
  );
  expect(
    error(
      result.current.revealAll({
        handle,
        rootId: 'app',
        expectedRevision: 0,
        requestId: 'one',
      }),
    ),
  ).toBe('REQUEST_ID_REUSED');
  expect(result.current.past).toHaveLength(1);
});
it('retains only the latest 256 identities, rejects evicted stale intent and clears on replacement', () => {
  const { result, request, handle } = setup();
  act(() => {
    success(result.current.setDepth(request()));
    for (let i = 0; i < 256; i++)
      success(result.current.setDepth(request(`noop-${i}`, 0, 1)));
  });
  expect(error(result.current.setDepth(request()))).toBe('STALE_REVISION');
  expect(
    success(result.current.setDepth(request('noop-255', 0, 1))).data.replayed,
  ).toBe(true);
  act(() => {
    result.current.setBusy('canvas-draft', true);
    result.current.replace(recursiveFixture());
  });
  expect(error(result.current.setDepth(request()))).toBe('STALE_SESSION');
  const fresh = {
    ...request(),
    handle: { ...handle, sessionId: result.current.sessionId },
  };
  act(() => {
    expect(success(result.current.setDepth(fresh)).data.replayed).toBe(false);
  });
  expect(result.current.past).toHaveLength(1);
});
it('Reveal all resolves the current tree height and applies first-use layouts in one transaction', () => {
  const { result, handle } = setup();
  act(() =>
    result.current.transact((draft) => {
      delete draft.layouts.app[2];
      editObject('endpoint', { name: 'Newest' })(draft);
    }),
  );
  act(() => {
    const response = success(
      result.current.revealAll({
        handle,
        rootId: 'app',
        expectedRevision: 1,
        requestId: 'all',
      }),
    );
    expect(response.data).toMatchObject({
      maximumDepth: 2,
      selectedDepth: 2,
      appliedRevision: 2,
    });
  });
  expect(result.current.result!.document.layouts.app[2].endpoint).toEqual(
    result.current.result!.document.objects.endpoint.geometry,
  );
  expect(result.current.past).toHaveLength(2);
});
it('does not leak failures, cache rejections, or serialize source content for read queries', () => {
  const d = recursiveFixture();
  const owner = {
    snapshot: () => ({
      appInstanceId: 'app-run',
      sessionId: 'session',
      revision: 0,
      dirty: false,
      document: d,
    }),
    selectDepth: jest.fn(() => {
      throw new Error('private content');
    }),
    busy: () => false,
  };
  const command = createDepthCommands(owner);
  const args = {
    handle: { appInstanceId: 'app-run', sessionId: 'session' },
    requestId: 'retry',
    rootId: 'app',
    expectedRevision: 0,
    depth: 0,
  };
  for (let i = 0; i < 2; i++) {
    const response: ApiResult<CommandData> = command('set', args);
    expect(error(response)).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response)).not.toContain('private');
  }
  expect(owner.selectDepth).toHaveBeenCalledTimes(2);
  const { result } = setup();
  const stringify = jest.spyOn(JSON, 'stringify');
  stringify.mockClear();
  result.current.getContext();
  expect(
    stringify.mock.calls.some(
      ([value]) =>
        value === result.current.document ||
        (typeof value === 'object' && value !== null && 'objects' in value),
    ),
  ).toBe(false);
  stringify.mockRestore();
});

it('rejects absent documents and unavailable or oversized app state before mutation', () => {
  const { result } = renderHook(() => useDocumentState(null, 'app-run'));
  const response = result.current.setDepth({
    handle: { appInstanceId: 'app-run', sessionId: result.current.sessionId },
    rootId: 'app',
    depth: 0,
    expectedRevision: 0,
    requestId: 'one',
  });
  expect(error(response)).toBe('NO_DOCUMENT');
  expect(result.current.past).toHaveLength(0);
  const unavailable = renderHook(() => useDocumentState(recursiveFixture()));
  expect(error(unavailable.result.current.setDepth({}))).toBe(
    'APP_UNAVAILABLE',
  );
  const oversized = recursiveFixture();
  oversized.id = 'x'.repeat(257);
  const huge = renderHook(() => useDocumentState(oversized, 'app-run'));
  expect(error(huge.result.current.setDepth({}))).toBe('RESPONSE_TOO_LARGE');
  expect(huge.result.current.revision).toBe(0);
});
