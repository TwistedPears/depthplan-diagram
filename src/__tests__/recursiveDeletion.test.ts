import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import { transactDocument } from '../shared/documentTransactions';
import { deleteSelection, deletionTargets } from '../shared/recursiveDeletion';
import { moveSubtree } from '../shared/recursiveMovement';
import { endpointWorld } from '../shared/recursiveConnectionRepair';
import {
  validateRecursiveDocument,
  type RecursiveDocument,
} from '../shared/recursiveDocument';
it('deletes overlapping hidden subtrees and mixed routes once with exact undo/redo', () => {
  const d = recursiveFixture();
  d.rootDepths.app = 0;
  d.objects.api.boundaryPoints = { p: { side: 'left', offset: 0.5 } };
  d.connections.external = {
    id: 'external',
    ownerId: null,
    kind: 'line',
    z: 4,
    start: { kind: 'object', objectId: 'payments', side: 'left', offset: 0.5 },
    end: { kind: 'boundary', objectId: 'api', pointId: 'p' },
  };
  d.connections.internal = {
    ...d.connections.external,
    id: 'internal',
    ownerId: 'api',
    start: { kind: 'object', objectId: 'endpoint', side: 'left', offset: 0.5 },
  };
  d.connections.selected = { ...d.connections.external, id: 'selected' };
  const expected = endpointWorld(
    d,
    d.connections.external,
    d.connections.external.end,
  );
  expect(deletionTargets(d, ['app', 'api', 'endpoint'])).toMatchObject({
    descendants: 2,
    hidden: 2,
  });
  const { result } = renderHook(() => useDocumentState(d));
  act(() =>
    result.current.transact(
      deleteSelection(['app', 'api', 'endpoint'], ['selected']),
    ),
  );
  expect(result.current.result!.status).toBe('accepted');
  const after = result.current.document as RecursiveDocument;
  expect(Object.keys(after.objects)).toEqual(['payments']);
  expect(Object.keys(after.rootDepths)).toEqual(['payments']);
  expect(Object.keys(after.layouts)).toEqual(['payments']);
  expect(Object.keys(after.connections)).toEqual(['external']);
  expect(after.connections.external.end).toMatchObject({
    kind: 'free',
    x: expected.x,
    y: expected.y,
  });
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(d);
  act(() => result.current.redo());
  expect(result.current.document).toEqual(after);
});
it('clamps depth and removes all deleted geometry while keeping surviving inactive layouts and provenance safe', () => {
  const initial = recursiveFixture();
  initial.rootDepths.app = 2;
  const d = transactDocument(
    initial,
    moveSubtree('api', 'payments', { x: 880, y: 50 }),
  ).document;
  d.extensions!.custom = { keep: true, original: initial } as any;
  d.rootDepths.payments = 2;
  const result = transactDocument(d, deleteSelection(['endpoint']));
  expect(result.status).toBe('accepted');
  const after = result.document;
  expect(after.rootDepths.payments).toBe(1);
  for (const root of Object.values(after.layouts))
    for (const layout of Object.values(root))
      expect(layout.endpoint).toBeUndefined();
  expect(after.layouts.payments[2].api).toEqual(d.layouts.payments[2].api);
  expect(after.extensions!.custom).toEqual(d.extensions!.custom);
  expect(JSON.stringify(after.extensions!.layoutArchive)).not.toContain(
    'endpoint',
  );
  const inverse = transactDocument(
    after,
    moveSubtree('api', 'app', { x: 400, y: 50 }),
  );
  expect(inverse.status).toBe('accepted');
  expect(inverse.document.objects.endpoint).toBeUndefined();
  for (const root of Object.values(inverse.document.layouts))
    for (const layout of Object.values(root))
      expect(layout.endpoint).toBeUndefined();
});
it('allows connector-only and final empty deletion, preserves pending repair data, and makes stale selection a no-op', () => {
  const d = recursiveFixture();
  d.connections.c = {
    id: 'c',
    ownerId: null,
    kind: 'line',
    z: 0,
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'free', x: 50, y: 50 },
  };
  d.connectionRepairs = {
    archived: {
      connection: { ...d.connections.c, id: 'archived' },
      ownerGeometry: null,
      start: { x: 0, y: 0 },
      end: { x: 50, y: 50 },
      reason: 'Pending explicit repair',
    },
  };
  const only = transactDocument(d, deleteSelection([], ['c']));
  expect(only.status).toBe('accepted');
  expect(only.document.objects).toEqual(d.objects);
  const empty = transactDocument(
    d,
    deleteSelection(['app', 'payments'], ['c']),
  );
  expect(empty.status).toBe('accepted');
  expect(empty.document.connectionRepairs).toEqual(d.connectionRepairs);
  for (const field of [
    'objects',
    'connections',
    'rootDepths',
    'layouts',
  ] as const)
    expect(empty.document[field]).toEqual({});
  expect(() =>
    validateRecursiveDocument(JSON.parse(JSON.stringify(empty.document))),
  ).not.toThrow();
  expect(
    transactDocument(empty.document, deleteSelection(['app'], ['c'])).status,
  ).toBe('noop');
});
