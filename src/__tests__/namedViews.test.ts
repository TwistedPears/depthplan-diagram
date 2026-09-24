import { act, renderHook } from '@testing-library/react';
import { recursiveFixture, geometry } from './recursiveFixtures';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { editNamedView, resolveNamedView } from '../shared/namedViews';
import {
  transactDocument,
  editActiveGeometry,
} from '../shared/documentTransactions';
import {
  type RecursiveDocument,
  validateRecursiveDocument,
} from '../shared/recursiveDocument';
import { deleteSelection } from '../shared/recursiveDeletion';
import { moveSubtree } from '../shared/recursiveMovement';

const withView = () => {
  const d = recursiveFixture();
  d.namedViews = {
    detail: {
      id: 'detail',
      name: 'Detail',
      rootDepths: { app: 2, payments: 0 },
      metadata: { author: 'author', extra: ['keep'] },
    },
  };
  return d;
};
it('accepts optional absent storage, duplicate names and stale snapshot entries while rejecting malformed records', () => {
  validateRecursiveDocument(recursiveFixture());
  const d = withView();
  d.namedViews!.sameName = {
    id: 'sameName',
    name: 'Detail',
    rootDepths: { deleted: 999 },
  };
  validateRecursiveDocument(d);
  for (const bad of [
    null,
    [],
    { v: { id: 'wrong', name: 'Name', rootDepths: {} } },
    { v: { id: 'v', name: '  ', rootDepths: {} } },
    { v: { id: 'v', name: 'Name', rootDepths: { app: -1 } } },
    { v: { id: 'v', name: 'Name', rootDepths: { app: 1.5 } } },
    {
      v: {
        id: 'v',
        name: 'Name',
        rootDepths: { app: Number.MAX_SAFE_INTEGER + 1 },
      },
    },
    JSON.parse(
      '{"__proto__":{"id":"__proto__","name":"Name","rootDepths":{}}}',
    ),
  ])
    expect(() =>
      validateRecursiveDocument({ ...d, namedViews: bad }),
    ).toThrow();
});
it('captures every root, trims names, uses stable IDs, and only explicitly updates or deletes', () => {
  const { result } = renderHook(() =>
    useDocumentState(recursiveFixture(), 'app'),
  );
  act(() => {
    result.current.changeNamedView({
      type: 'create',
      id: 'one',
      name: ' Overview ',
    });
    result.current.changeNamedView({
      type: 'create',
      id: 'two',
      name: 'Overview',
    });
  });
  const saved = (result.current.document as RecursiveDocument).namedViews!.one;
  expect(saved).toMatchObject({
    id: 'one',
    name: 'Overview',
    rootDepths: { app: 1, payments: 0 },
  });
  act(() => result.current.selectDepth('app', 0));
  act(() =>
    result.current.setDepth({
      handle: { appInstanceId: 'app', sessionId: result.current.sessionId },
      requestId: 'mcp',
      rootId: 'app',
      expectedRevision: result.current.revision,
      depth: 2,
    }),
  );
  expect(
    (result.current.document as RecursiveDocument).namedViews!.one,
  ).toEqual(saved);
  act(() =>
    result.current.changeNamedView({
      type: 'rename',
      id: 'one',
      name: 'Renamed',
    }),
  );
  act(() => result.current.changeNamedView({ type: 'update', id: 'one' }));
  const beforeDelete = result.current.document as RecursiveDocument;
  expect(beforeDelete.namedViews!.one.rootDepths.app).toBe(2);
  act(() => result.current.changeNamedView({ type: 'delete', id: 'one' }));
  expect((result.current.document as RecursiveDocument).rootDepths).toEqual(
    beforeDelete.rootDepths,
  );
  expect((result.current.document as RecursiveDocument).objects).toEqual(
    beforeDelete.objects,
  );
  expect(
    (result.current.document as RecursiveDocument).namedViews!.one,
  ).toBeUndefined();
  act(() => result.current.undo());
  expect(result.current.document).toEqual(beforeDelete);
});
it('applies all roots and first-use layouts in one dirty/history transaction without restoring geometry', () => {
  const d = withView();
  delete d.layouts.app[2];
  d.objects.child = {
    ...d.objects.api,
    id: 'child',
    parentId: 'payments',
    geometry: { ...geometry },
  };
  d.namedViews!.detail.rootDepths.payments = 1;
  const { result } = renderHook(() => useDocumentState(d));
  act(() => result.current.changeNamedView({ type: 'apply', id: 'detail' }));
  expect(result.current.past).toHaveLength(1);
  expect(result.current.dirty).toBe(true);
  const applied = result.current.document as RecursiveDocument;
  expect(applied.rootDepths).toEqual({ app: 2, payments: 1 });
  expect(applied.layouts.app[2].endpoint).toEqual(geometry);
  expect(applied.layouts.payments[1].child).toEqual(geometry);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(d);
  expect(result.current.dirty).toBe(false);
  act(() => result.current.redo());
  expect(result.current.document).toEqual(applied);
  act(() => result.current.transact(editActiveGeometry('api', { x: 321 })));
  act(() => result.current.selectDepth('app', 0));
  act(() => result.current.changeNamedView({ type: 'apply', id: 'detail' }));
  expect(
    (result.current.document as RecursiveDocument).layouts.app[2].api.x,
  ).toBe(321);
});
it('unchanged/rejected actions leave revisions, dirty state and redo intact; busy commands never queue', () => {
  let d = withView();
  d.namedViews!.detail.rootDepths.app = 1;
  d = transactDocument(
    d,
    editNamedView({ type: 'update', id: 'detail' }, { x: 0, y: 0, scale: 1 }),
  ).document;
  const { result } = renderHook(() => useDocumentState(d));
  act(() => {
    expect(
      result.current.changeNamedView({ type: 'apply', id: 'detail' }).status,
    ).toBe('noop');
    expect(
      result.current.changeNamedView({ type: 'update', id: 'detail' }).status,
    ).toBe('noop');
    expect(
      result.current.changeNamedView({
        type: 'rename',
        id: 'detail',
        name: ' Detail ',
      }).status,
    ).toBe('noop');
    expect(
      result.current.changeNamedView({
        type: 'create',
        id: '__proto__',
        name: 'X',
      }).status,
    ).toBe('rejected');
    expect(
      result.current.changeNamedView({
        type: 'rename',
        id: 'detail',
        name: ' ',
      }).status,
    ).toBe('rejected');
    expect(
      result.current.changeNamedView({
        type: 'create',
        id: 'detail',
        name: 'Duplicate',
      }).status,
    ).toBe('rejected');
  });
  expect(result.current.revision).toBe(0);
  expect(result.current.dirty).toBe(false);
  act(() => result.current.selectDepth('app', 2));
  act(() => result.current.undo());
  for (const source of [
    'canvas-gesture',
    'depth-draft:app',
    'bookmark-name',
    'document-transition',
  ]) {
    act(() => result.current.setBusy(source, true));
    act(() => {
      expect(
        result.current.changeNamedView({
          type: 'create',
          id: 'busy',
          name: 'Busy',
        }).status,
      ).toBe('rejected');
      expect(
        result.current.changeNamedView({
          type: 'rename',
          id: 'detail',
          name: 'Busy',
        }).status,
      ).toBe('rejected');
      for (const type of ['apply', 'update', 'delete'] as const)
        expect(
          result.current.changeNamedView({ type, id: 'detail' }).status,
        ).toBe('rejected');
    });
    act(() => result.current.setBusy(source, false));
  }
  expect(result.current.canRedo).toBe(true);
  expect(result.current.document).toEqual(d);
});
it('keeps snapshots through deletion, promotion, adoption and shorter maxima, explaining adjustments', () => {
  const { result } = renderHook(() => useDocumentState(withView()));
  act(() => result.current.transact(deleteSelection(['endpoint'])));
  expect(
    resolveNamedView(result.current.document as RecursiveDocument, 'detail')
      .adjustments,
  ).toContain('app: saved D2 clamped to D1.');
  act(() =>
    result.current.transact(moveSubtree('api', null, { ...geometry, x: 1800 })),
  );
  act(() =>
    result.current.transact(moveSubtree('payments', 'app', { ...geometry })),
  );
  const before = result.current.document as RecursiveDocument,
    snapshot = before.namedViews;
  const resolution = resolveNamedView(before, 'detail');
  expect(resolution.rootDepths).toEqual({ app: 1, api: 0 });
  expect(resolution.adjustments.join(' ')).toContain('api: new root set to D0');
  expect(resolution.adjustments.join(' ')).toContain(
    'payments: deleted or former root ignored',
  );
  act(() => result.current.changeNamedView({ type: 'apply', id: 'detail' }));
  expect((result.current.document as RecursiveDocument).namedViews).toEqual(
    snapshot,
  );
  act(() => result.current.transact(deleteSelection(['app', 'api'])));
  const empty = result.current.document as RecursiveDocument;
  expect(empty.objects).toEqual({});
  expect(empty.namedViews).toEqual(snapshot);
  expect(
    transactDocument(empty, editNamedView({ type: 'apply', id: 'detail' }))
      .status,
  ).toBe('noop');
  const reopened = JSON.parse(JSON.stringify(empty));
  validateRecursiveDocument(reopened);
  expect(reopened.namedViews).toEqual(snapshot);
});

it('treats allowed prototype-like IDs as owned data, never inherited entries', () => {
  const d = withView();
  Object.assign(d.objects, {
    toString: { ...d.objects.payments, id: 'toString' },
  });
  Object.assign(d.rootDepths, { toString: 0 });
  Object.assign(d.layouts, { toString: { 0: { toString: { ...geometry } } } });
  validateRecursiveDocument(d);
  expect(resolveNamedView(d, 'detail').rootDepths.toString).toBe(0);
  const result = transactDocument(
    d,
    editNamedView({ type: 'create', id: 'toString', name: 'Allowed' }),
  );
  expect(result.status).toBe('accepted');
  expect(result.document.namedViews!.toString).toMatchObject({
    name: 'Allowed',
  });
});

it('duplicates the saved snapshot with independent metadata and undo, without capturing the current view', () => {
  const d = withView();
  d.namedViews!.detail.metadata!.collapsedObjects = ['api'];
  const { result } = renderHook(() => useDocumentState(d));
  act(() =>
    result.current.changeNamedView({
      type: 'duplicate',
      id: 'detail',
      newId: 'copy',
    }),
  );
  const duplicated = result.current.document as RecursiveDocument;
  expect(duplicated.namedViews!.copy).toEqual({
    ...d.namedViews!.detail,
    id: 'copy',
    name: 'Detail copy',
  });
  expect(duplicated.namedViews!.copy.rootDepths).not.toBe(
    duplicated.namedViews!.detail.rootDepths,
  );
  expect(duplicated.namedViews!.copy.metadata).not.toBe(
    duplicated.namedViews!.detail.metadata,
  );
  expect(duplicated.rootDepths).toEqual(d.rootDepths);
  expect(duplicated.layouts).toEqual(d.layouts);
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.changeNamedView({ type: 'update', id: 'copy' }));
  expect(
    (result.current.document as RecursiveDocument).namedViews!.detail,
  ).toEqual(d.namedViews!.detail);
  act(() => {
    result.current.undo();
    result.current.undo();
  });
  expect(result.current.document).toEqual(d);
  for (const action of [
    { type: 'duplicate' as const, id: 'missing', newId: 'copy' },
    { type: 'duplicate' as const, id: 'detail', newId: 'detail' },
    { type: 'duplicate' as const, id: 'detail', newId: '__proto__' },
  ]) {
    act(() =>
      expect(result.current.changeNamedView(action).status).toBe('rejected'),
    );
    expect(result.current.document).toEqual(d);
  }
});
