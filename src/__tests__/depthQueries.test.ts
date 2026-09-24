import { act, renderHook } from '@testing-library/react';
import { recursiveFixture, geometry } from './recursiveFixtures';
import { createRecursiveDocument } from '../shared/recursiveDocument';
import {
  queryDocumentContext,
  queryDocumentHierarchy,
  type QuerySnapshot,
} from '../shared/depthQueries';
import type { ApiResult } from '../shared/depthApiContract';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { editObject } from '../shared/documentTransactions';
import { selectRootDepth } from '../shared/recursiveLayouts';
import { reparentLayouts } from '../shared/recursiveReparent';

const handle = { appInstanceId: 'app-instance', sessionId: 'session' };
function snapshot(): QuerySnapshot {
  return { ...handle, document: recursiveFixture(), revision: 0, dirty: false };
}
function success<T>(result: ApiResult<T>) {
  if (!result.ok) throw new Error(result.error.code);
  return result;
}
function errorCode<T>(result: ApiResult<T>) {
  if (result.ok) throw new Error('Expected an error');
  return result.error.code;
}
it('returns independent root depths, stable IDs for duplicate names, and hidden descendants', () => {
  const s = snapshot(),
    d = s.document as ReturnType<typeof recursiveFixture>;
  d.objects.app.name = d.objects.payments.name = 'Duplicate';
  const before = JSON.stringify(d);
  const context = success(queryDocumentContext(s));
  expect(context.state).toEqual({
    ...handle,
    documentId: 'diagram',
    revision: 0,
    dirty: false,
  });
  expect(context.data.roots).toEqual([
    {
      id: 'app',
      name: 'Duplicate',
      nameTruncated: false,
      selectedDepth: 1,
      maximumDepth: 2,
    },
    {
      id: 'payments',
      name: 'Duplicate',
      nameTruncated: false,
      selectedDepth: 0,
      maximumDepth: 0,
    },
  ]);
  const nested = success(
    queryDocumentHierarchy(s, { handle, objectId: 'api' }),
  ).data;
  expect(nested.items).toEqual([
    {
      id: 'api',
      parentId: 'app',
      rootId: 'app',
      name: 'api',
      nameTruncated: false,
      generation: 1,
      relativeGeneration: 0,
      childCount: 1,
      visible: true,
    },
    {
      id: 'endpoint',
      parentId: 'api',
      rootId: 'app',
      name: 'endpoint',
      nameTruncated: false,
      generation: 2,
      relativeGeneration: 1,
      childCount: 0,
      visible: false,
    },
  ]);
  expect(
    success(queryDocumentHierarchy(s, { handle, objectId: 'payments' })).data
      .items[0],
  ).toMatchObject({
    generation: 0,
    relativeGeneration: 0,
    childCount: 0,
    visible: true,
  });
  expect(JSON.stringify(d)).toBe(before);
});
it('paginates root and subtree metadata deterministically without repeats', () => {
  const s = snapshot();
  const first = success(queryDocumentContext(s, { pageSize: 1 })).data;
  expect(first.hasMore).toBe(true);
  const last = success(
    queryDocumentContext(s, { cursor: first.nextCursor }),
  ).data;
  expect(last.roots.map((x) => x.id)).toEqual(['payments']);
  expect(last.nextCursor).toBeNull();
  let cursor: string | undefined;
  const ids: string[] = [];
  do {
    const page = success(
      queryDocumentHierarchy(s, {
        handle,
        objectId: 'app',
        pageSize: 1,
        cursor,
      }),
    ).data;
    ids.push(...page.items.map((x) => x.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids).toEqual(['app', 'api', 'endpoint']);
});
it('rejects malformed, wrong-scope, revision and session-stale cursors', () => {
  const s = snapshot();
  const cursor = success(queryDocumentContext(s, { pageSize: 1 })).data
    .nextCursor!;
  for (const changed of [
    { ...s, revision: 1 },
    { ...s, sessionId: 'replacement' },
    { ...s, appInstanceId: 'replacement' },
  ])
    expect(errorCode(queryDocumentContext(changed, { cursor }))).toBe(
      'STALE_CURSOR',
    );
  expect(
    errorCode(queryDocumentHierarchy(s, { handle, objectId: 'app', cursor })),
  ).toBe('STALE_CURSOR');
  expect(errorCode(queryDocumentContext(s, { cursor: 'invalid JSON' }))).toBe(
    'STALE_CURSOR',
  );
  expect(
    errorCode(
      queryDocumentContext(s, {
        cursor: JSON.stringify({ ...JSON.parse(cursor), lastId: 'missing' }),
      }),
    ),
  ).toBe('STALE_CURSOR');
});
it('handles no document, empty unsaved New and invalid/missing targets explicitly', () => {
  const s = snapshot();
  expect(success(queryDocumentContext({ ...s, document: null })).data).toEqual({
    appInstanceId: handle.appInstanceId,
    document: null,
    roots: [],
    nextCursor: null,
    hasMore: false,
  });
  expect(
    errorCode(
      queryDocumentHierarchy(
        { ...s, document: null },
        { handle, objectId: 'app' },
      ),
    ),
  ).toBe('NO_DOCUMENT');
  const empty = createRecursiveDocument('new', 'Unsaved');
  expect(
    success(queryDocumentContext({ ...s, document: empty })),
  ).toMatchObject({
    state: { documentId: 'new', dirty: false },
    data: { roots: [] },
  });
  expect(
    errorCode(
      queryDocumentHierarchy(s, {
        handle: { ...handle, appInstanceId: 'other' },
        objectId: 'app',
      }),
    ),
  ).toBe('STALE_APP');
  expect(
    errorCode(
      queryDocumentHierarchy(s, {
        handle: { ...handle, sessionId: 'other' },
        objectId: 'app',
      }),
    ),
  ).toBe('STALE_SESSION');
  expect(
    errorCode(queryDocumentHierarchy(s, { handle, objectId: 'missing' })),
  ).toBe('NOT_FOUND');
  expect(errorCode(queryDocumentContext(s, { pageSize: 0 }))).toBe(
    'INVALID_REQUEST',
  );
  expect(errorCode(queryDocumentContext({ ...s, appInstanceId: null }))).toBe(
    'APP_UNAVAILABLE',
  );
});
it('bounds output, marks truncated names and never reads text/code or serializes the document', () => {
  const d = createRecursiveDocument('large', 'x'.repeat(1000));
  d.objects.root = {
    id: 'root',
    parentId: null,
    name: 'x'.repeat(1000),
    type: 'rectangle',
    geometry,
    content: [],
  };
  d.rootDepths.root = 0;
  d.layouts.root = { 0: { root: geometry } };
  for (let i = 0; i < 2000; i++) {
    const id = `child-${String(i).padStart(4, '0')}`;
    d.objects[id] = {
      id,
      parentId: 'root',
      name: id,
      type: 'rectangle',
      geometry,
      content: [],
    };
    Object.defineProperty(d.objects[id], 'content', {
      get: () => {
        throw new Error('Do not read content');
      },
    });
  }
  Object.defineProperty(d, 'toJSON', {
    value: () => {
      throw new Error('Do not serialize document');
    },
  });
  const s = { ...snapshot(), document: d };
  const context = success(queryDocumentContext(s)).data;
  expect(context.document).toMatchObject({ titleTruncated: true });
  expect(context.roots[0]).toMatchObject({ nameTruncated: true });
  expect(context.roots[0].name).toHaveLength(512);
  const page = success(
    queryDocumentHierarchy(s, { handle, objectId: 'root', pageSize: 2 }),
  ).data;
  expect(page.items).toHaveLength(2);
  expect(page.items.map((x) => x.id)).toEqual(['root', 'child-0000']);
  expect(page.hasMore).toBe(true);
  expect(JSON.stringify(page).length).toBeLessThan(2000);
  expect(
    success(
      queryDocumentHierarchy(s, { handle, objectId: 'root', pageSize: 200 }),
    ).data.items,
  ).toHaveLength(200);
});
it('never truncates oversized stable document/object identities', () => {
  const s = snapshot(),
    d = s.document as ReturnType<typeof recursiveFixture>;
  d.id = 'x'.repeat(257);
  expect(errorCode(queryDocumentContext(s))).toBe('RESPONSE_TOO_LARGE');
  d.id = 'diagram';
  const id = 'z'.repeat(257);
  d.objects[id] = { ...d.objects.payments, id };
  d.rootDepths[id] = 0;
  d.layouts[id] = { 0: { [id]: geometry } };
  expect(errorCode(queryDocumentContext(s))).toBe('RESPONSE_TOO_LARGE');
});
it('stable owner callbacks read live commits, unsaved reparenting and Undo without modifying state', () => {
  const { result } = renderHook(() =>
    useDocumentState(recursiveFixture(), handle.appInstanceId),
  );
  const getContext = result.current.getContext,
    getHierarchy = result.current.getHierarchy;
  const target = { ...handle, sessionId: result.current.sessionId };
  const before = {
    doc: result.current.document,
    past: result.current.past,
    future: result.current.future,
    revision: result.current.revision,
  };
  success(getHierarchy({ handle: target, objectId: 'app' }));
  success(getContext());
  expect(result.current.document).toBe(before.doc);
  expect(result.current.past).toBe(before.past);
  expect(result.current.future).toBe(before.future);
  expect(result.current.revision).toBe(before.revision);
  expect(result.current.dirty).toBe(false);
  act(() => result.current.transact(editObject('app', { name: 'Live edit' })));
  expect(success(getContext()).data.roots[0].name).toBe('Live edit');
  act(() => result.current.transact(reparentLayouts('api', 'payments')));
  expect(
    success(getHierarchy({ handle: target, objectId: 'endpoint' })).data
      .items[0],
  ).toMatchObject({ rootId: 'payments', generation: 2, visible: false });
  const changed = result.current.document;
  expect(success(getContext()).state?.dirty).toBe(true);
  expect(result.current.document).toBe(changed);
  act(() => result.current.undo());
  expect(
    success(getHierarchy({ handle: target, objectId: 'endpoint' })).data.rootId,
  ).toBe('app');
  expect(result.current.getContext).toBe(getContext);
});
it('owner replacement rejects old handles/cursors even for the same file ID, while Save preserves pagination', () => {
  const { result } = renderHook(() =>
    useDocumentState(recursiveFixture(), handle.appInstanceId),
  );
  const target = { ...handle, sessionId: result.current.sessionId };
  const getContext = result.current.getContext,
    getHierarchy = result.current.getHierarchy;
  const cursor = success(getContext({ pageSize: 1 })).data.nextCursor;
  act(() =>
    result.current.markSaved(
      result.current.document!,
      result.current.sessionId,
    ),
  );
  expect(success(getContext({ cursor })).data.roots[0].id).toBe('payments');
  act(() => result.current.transact(selectRootDepth('app', 2)));
  expect(errorCode(getContext({ cursor }))).toBe('STALE_CURSOR');
  act(() => result.current.replace(recursiveFixture()));
  expect(errorCode(getHierarchy({ handle: target, objectId: 'app' }))).toBe(
    'STALE_SESSION',
  );
  expect(errorCode(getContext({ cursor }))).toBe('STALE_CURSOR');
  expect(success(getContext()).state?.sessionId).not.toBe(target.sessionId);
});

it('caps encoded response bytes even for heavily escaped metadata', () => {
  const d = createRecursiveDocument('escaped', 'Escaped');
  const rootId = '\u0000'.repeat(250);
  d.objects[rootId] = {
    id: rootId,
    parentId: null,
    name: '\u0000'.repeat(512),
    type: 'rectangle',
    geometry,
    content: [],
  };
  d.rootDepths[rootId] = 0;
  d.layouts[rootId] = { 0: { [rootId]: geometry } };
  for (let i = 0; i < 199; i++) {
    const id = rootId + String(i);
    d.objects[id] = {
      id,
      parentId: rootId,
      name: '\u0000'.repeat(512),
      type: 'rectangle',
      geometry,
      content: [],
    };
  }
  const s = { ...snapshot(), document: d };
  expect(
    errorCode(
      queryDocumentHierarchy(s, { handle, objectId: rootId, pageSize: 200 }),
    ),
  ).toBe('RESPONSE_TOO_LARGE');
  expect(
    success(
      queryDocumentHierarchy(s, { handle, objectId: rootId, pageSize: 10 }),
    ).data.items,
  ).toHaveLength(10);
});

it('reports local folds in hierarchy visibility without hiding their metadata', () => {
  const document = recursiveFixture();
  document.rootDepths.app = 2;
  document.extensions = { collapsedObjects: ['api'] };
  const items = success(
    queryDocumentHierarchy(
      { ...snapshot(), document },
      { handle, objectId: 'api' },
    ),
  ).data.items;
  expect(items.find((item) => item.id === 'api')?.visible).toBe(true);
  expect(items.find((item) => item.id === 'endpoint')?.visible).toBe(false);
});
