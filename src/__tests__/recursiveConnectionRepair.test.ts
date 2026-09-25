import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import { transactDocument } from '../shared/documentTransactions';
import { moveSelection, moveSubtree } from '../shared/recursiveMovement';
import {
  deleteBoundaryPoint,
  endpointWorld,
  repairConnections,
  resolveConnectionRepair,
  savedWorldGeometry,
} from '../shared/recursiveConnectionRepair';
import {
  validateRecursiveDocument,
  type DiagramConnection,
  type RecursiveDocument,
} from '../shared/recursiveDocument';
const route = (
  overrides: Partial<DiagramConnection> = {},
): DiagramConnection => ({
  id: 'route',
  ownerId: 'app',
  kind: 'arrow',
  z: 7,
  label: 'keep me',
  style: { stroke: 'red', lineStyle: 'dashed' },
  start: { kind: 'object', objectId: 'api', side: 'right', offset: 0.5 },
  end: { kind: 'free', x: 150, y: 70 },
  ...overrides,
});
it('promotes and adopts a connected subtree, preserving IDs/style and free world position through rotated owners', () => {
  const d = recursiveFixture();
  d.layouts.app[1].app.rotation = 40;
  d.layouts.payments[0].payments.rotation = 75;
  d.connections.route = route();
  const point = endpointWorld(d, d.connections.route, d.connections.route.end);
  const promoted = transactDocument(
    d,
    moveSubtree('api', null, { x: 200, y: 500 }),
  );
  expect(promoted.status).toBe('accepted');
  expect(promoted.document.connections.route).toMatchObject({
    id: 'route',
    ownerId: null,
    z: 7,
    label: 'keep me',
    style: d.connections.route.style,
  });
  const adopted = transactDocument(
    promoted.document,
    moveSubtree('api', 'payments', { x: 880, y: 40 }),
  );
  expect(adopted.status).toBe('accepted');
  const c = adopted.document.connections.route;
  expect(c.ownerId).toBe('payments');
  const after = endpointWorld(adopted.document, c, c.end);
  expect(after.x).toBeCloseTo(point.x);
  expect(after.y).toBeCloseTo(point.y);
  const inverse = transactDocument(
    adopted.document,
    moveSubtree('api', 'app', { x: 430, y: 50 }),
  );
  expect(inverse.status).toBe('accepted');
  expect(inverse.document.connections.route.start).toEqual(
    d.connections.route.start,
  );
  const restored = endpointWorld(
    inverse.document,
    inverse.document.connections.route,
    inverse.document.connections.route.end,
  );
  expect(restored.x).toBeCloseTo(point.x);
  expect(restored.y).toBeCloseTo(point.y);
});
it('preserves internal local coordinates and repairs a group only after both endpoints move', () => {
  const d = recursiveFixture();
  d.objects.other = { ...d.objects.api, id: 'other' };
  for (const depth of [1, 2])
    d.layouts.app[depth].other = { ...d.objects.other.geometry, x: -20, y: 25 };
  d.connections.route = route({
    end: { kind: 'object', objectId: 'other', side: 'left', offset: 0.5 },
  });
  d.connections.inside = route({
    id: 'inside',
    ownerId: 'api',
    start: { kind: 'object', objectId: 'endpoint', side: 'right', offset: 0.5 },
  });
  const moved = transactDocument(
    d,
    moveSelection(
      ['api', 'other'],
      { x: 500, y: 0 },
      new Map([
        ['api', 'payments'],
        ['other', 'payments'],
      ]),
    ),
  );
  expect(moved.status).toBe('accepted');
  expect(moved.document.connections.route.ownerId).toBe('payments');
  expect(moved.document.connections.inside).toEqual(d.connections.inside);
  expect(moved.document.connectionRepairs).toBeUndefined();
});
it('archives an invalid crossing, round trips, explicitly repairs it and restores exact history', () => {
  const d = recursiveFixture();
  d.connections.route = route({
    ownerId: null,
    end: { kind: 'object', objectId: 'app', side: 'left', offset: 0.5 },
  });
  const original = JSON.stringify(d);
  const { result } = renderHook(() => useDocumentState(d));
  act(() =>
    result.current.transact(moveSubtree('api', 'payments', { x: 880, y: 20 })),
  );
  expect(result.current.result!.status).toBe('accepted');
  const archived = result.current.document as RecursiveDocument;
  expect(archived.connections).toEqual({});
  expect(archived.connectionRepairs!.route.connection).toEqual(
    d.connections.route,
  );
  expect(() =>
    validateRecursiveDocument(JSON.parse(JSON.stringify(archived))),
  ).not.toThrow();
  expect(JSON.stringify(d)).toBe(original);
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(d);
  act(() => result.current.redo());
  expect(result.current.document).toEqual(archived);
  act(() =>
    result.current.transact((draft) => {
      draft.objects.payments.boundaryPoints = {
        port: { side: 'left', offset: 0.5 },
      };
      draft.connections.new = route({
        id: 'new',
        ownerId: 'payments',
        start: { kind: 'boundary', objectId: 'payments', pointId: 'port' },
        end: { kind: 'object', objectId: 'api', side: 'left', offset: 0.5 },
      });
    }),
  );
  const pending = result.current.document;
  act(() => result.current.transact(resolveConnectionRepair('route', 'new')));
  const repaired = result.current.document as RecursiveDocument;
  expect(repaired.connectionRepairs).toEqual({});
  expect(repaired.connections.route).toMatchObject({
    id: 'route',
    ownerId: 'payments',
    z: 7,
    label: 'keep me',
    style: d.connections.route.style,
  });
  expect(repaired.connections.new).toBeUndefined();
  act(() => result.current.undo());
  expect(result.current.document).toEqual(pending);
  expect(
    transactDocument(archived, resolveConnectionRepair('route', 'missing'))
      .document,
  ).toBe(archived);
  const corrupt = JSON.parse(JSON.stringify(archived));
  corrupt.connectionRepairs.route.connection.start.objectId = '';
  expect(() => validateRecursiveDocument(corrupt)).toThrow();
});
it('detaches all shared boundary attachments including hidden targets in rotated retained geometry', () => {
  const d = recursiveFixture();
  d.rootDepths.app = 0;
  d.layouts.app[0].app.rotation = 90;
  d.layouts.app[1].api.rotation = 35;
  d.objects.api.boundaryPoints = {
    port: { side: 'right', offset: 0.25 },
    keep: { side: 'left', offset: 0 },
  };
  const end = { kind: 'boundary', objectId: 'api', pointId: 'port' } as const;
  d.connections.route = route({ start: end });
  d.connections.inside = route({
    id: 'inside',
    ownerId: 'api',
    start: end,
    end: { kind: 'object', objectId: 'endpoint', side: 'left', offset: 0.5 },
  });
  d.connections.external = route({ id: 'external', ownerId: null, end });
  const { result } = renderHook(() => useDocumentState(d));
  act(() => result.current.transact(deleteBoundaryPoint('api', 'port')));
  expect(result.current.result!.status).toBe('accepted');
  const after = result.current.document as RecursiveDocument;
  expect(after.objects.api.boundaryPoints).toEqual({
    keep: { side: 'left', offset: 0 },
  });
  expect(Object.keys(after.connections)).toHaveLength(3);
  for (const [id, key] of [
    ['route', 'start'],
    ['inside', 'start'],
    ['external', 'end'],
  ] as const) {
    const before = endpointWorld(d, d.connections[id], d.connections[id][key]);
    const at = endpointWorld(
      after,
      after.connections[id],
      after.connections[id][key],
    );
    expect(after.connections[id][key].kind).toBe('free');
    expect(at.x).toBeCloseTo(before.x);
    expect(at.y).toBeCloseTo(before.y);
    expect(after.connections[id].style).toEqual(d.connections[id].style);
  }
  act(() => result.current.undo());
  expect(result.current.document).toEqual(d);
  act(() => result.current.redo());
  expect(result.current.document).toEqual(after);
  expect(savedWorldGeometry(d, 'api').rotation).toBe(125);
  expect(
    transactDocument(after, deleteBoundaryPoint('api', 'port')).document,
  ).toBe(after);
});
it('shared repair removes internally owned/both-deleted routes and detaches surviving external routes', () => {
  const d = recursiveFixture();
  d.connections.route = route({ ownerId: null });
  d.connections.inside = route({ id: 'inside', ownerId: 'api' });
  d.connections.both = route({
    id: 'both',
    ownerId: null,
    end: { kind: 'object', objectId: 'endpoint', side: 'left', offset: 0.5 },
  });
  const changed = transactDocument(d, (draft) => {
    delete draft.objects.api;
    delete draft.objects.endpoint;
    for (const layout of Object.values(draft.layouts.app)) {
      delete layout.api;
      delete layout.endpoint;
    }
    draft.rootDepths.app = 0;
    repairConnections(d, draft);
  });
  expect(changed.status).toBe('accepted');
  expect(Object.keys(changed.document.connections)).toEqual(['route']);
  expect(changed.document.connections.route.start.kind).toBe('free');
});

it('keeps an external boundary route external when its target is promoted', () => {
  const d = recursiveFixture();
  d.objects.api.boundaryPoints = { port: { side: 'right', offset: 0.5 } };
  d.connections.route = route({
    start: { kind: 'boundary', objectId: 'api', pointId: 'port' },
  });
  const moved = transactDocument(
    d,
    moveSubtree('api', null, { x: 100, y: 500 }),
  );
  expect(moved.status).toBe('accepted');
  expect(moved.document.connections.route.ownerId).toBeNull();
  expect(moved.document.connections.route.start).toEqual(
    d.connections.route.start,
  );
});
