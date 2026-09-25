import { act, renderHook } from '@testing-library/react';
import {
  boundaryPlacement,
  boundaryPosition,
  editBoundaryPoint,
} from '../shared/recursiveBoundary';
import { recursiveFixture, geometry } from './recursiveFixtures';
import { createConnector } from '../shared/recursiveCreation';
import { recursiveScene } from '../shared/recursiveScene';
import {
  activeWorldGeometry,
  toWorldGeometry,
} from '../shared/recursiveHierarchy';
import {
  transactDocument,
  editActiveGeometry,
} from '../shared/documentTransactions';
import { selectRootDepth } from '../shared/recursiveLayouts';
import { validateRecursiveDocument } from '../shared/recursiveDocument';
import useDocumentState from '../renderer/hooks/useDocumentState';

it.each(['rectangle', 'ellipse', 'diamond', 'frame'] as const)(
  'projects normalized points onto %s outlines and reverses rotated pointer placement',
  (type) => {
    const object = { ...recursiveFixture().objects.app, type };
    const world = {
      ...geometry,
      x: 130,
      y: 180,
      width: 200,
      height: 100,
      rotation: 67,
    };
    for (const side of ['left', 'right', 'top', 'bottom'] as const)
      for (const offset of [0, 0.2, 0.5, 0.8, 1]) {
        const point = { side, offset };
        const at = boundaryPosition(point, world, object);
        const x = Math.abs(at.x) / 100,
          y = Math.abs(at.y) / 50;
        expect(
          type === 'ellipse'
            ? x * x + y * y
            : type === 'diamond'
              ? x + y
              : Math.max(x, y),
        ).toBeCloseTo(1);
        const pointer = toWorldGeometry({ ...world, ...at }, world);
        const actual = boundaryPosition(
          boundaryPlacement(pointer, world),
          world,
          object,
        );
        expect(actual.x).toBeCloseTo(at.x);
        expect(actual.y).toBeCloseTo(at.y);
      }
  },
);
it('uses rounded rectangle corners for both handles and attachments', () => {
  const object = {
    ...recursiveFixture().objects.app,
    style: { cornerRadius: 10 },
  };
  const point = boundaryPosition(
    { side: 'right', offset: 1 },
    geometry,
    object,
  );
  expect(Math.hypot(point.x - 40, point.y - 20)).toBeCloseTo(10);
});
it('shares individually identified, unbridged points across layouts without semantic children', () => {
  const original = recursiveFixture();
  const layouts = JSON.stringify(original.layouts);
  const state = renderHook(() => useDocumentState(original));
  act(() =>
    state.result.current.transact(
      editBoundaryPoint('app', 'one', { side: 'right', offset: 0.25 }, true),
    ),
  );
  act(() =>
    state.result.current.transact(
      editBoundaryPoint('app', 'two', { side: 'left', offset: 0.8 }, true),
    ),
  );
  const document = state.result.current.result!.document;
  expect(Object.keys(document.objects)).toEqual(Object.keys(original.objects));
  expect(JSON.stringify(document.layouts)).toBe(layouts);
  act(() =>
    state.result.current.transact(
      editBoundaryPoint('app', 'one', { side: 'top', offset: 0.6 }),
    ),
  );
  expect(state.result.current.past).toHaveLength(3);
  act(() => state.result.current.undo());
  expect(state.result.current.document).toMatchObject({
    objects: { app: { boundaryPoints: { one: { side: 'right' } } } },
  });
  act(() => state.result.current.redo());
  expect(state.result.current.document).toMatchObject({
    objects: { app: { boundaryPoints: { one: { side: 'top' } } } },
  });
  expect(
    transactDocument(
      document,
      editBoundaryPoint('app', 'one', { side: 'top', offset: 2 }),
    ).status,
  ).toBe('rejected');
  expect(
    transactDocument(
      document,
      editBoundaryPoint('app', 'one', { side: 'top', offset: 0 }, true),
    ).status,
  ).toBe('rejected');
});
it('keeps shared external attachments in either direction, updates all routes and round-trips', () => {
  let d = recursiveFixture();
  const apply = (edit: Parameters<typeof transactDocument>[1]) => {
    const result = transactDocument(d, edit);
    if (result.status === 'rejected') throw new Error(result.error);
    d = result.document;
  };
  apply(editBoundaryPoint('app', 'port', { side: 'right', offset: 0.5 }, true));
  apply(
    createConnector(
      'out',
      'arrow',
      { x: 450, y: 20 },
      { x: 900, y: 20 },
      { objectId: 'app', pointId: 'port' },
      'payments',
    ),
  );
  apply(
    createConnector(
      'in',
      'arrow',
      { x: 900, y: 20 },
      { x: 450, y: 20 },
      'payments',
      { objectId: 'app', pointId: 'port' },
    ),
  );
  // A saved attached Line remains supported; new ordinary Lines are free.
  d.connections.in.kind = 'line';
  d.connections.out.label = 'Outside';
  d.connections.in.style = { stroke: '#abcdef' };
  const layouts = JSON.stringify(d.layouts),
    before = recursiveScene(d).connections.get(null)!;
  apply(editBoundaryPoint('app', 'port', { side: 'bottom', offset: 0.1 }));
  expect(recursiveScene(d).connections.get(null)).not.toEqual(before);
  expect(JSON.stringify(d.layouts)).toBe(layouts);
  const points = () => recursiveScene(d).connections.get(null)!;
  expect(points()[0].points.slice(2)).toEqual(points()[1].points.slice(0, 2));
  apply(
    editActiveGeometry('app', {
      x: 600,
      width: 260,
      height: 150,
      rotation: 30,
    }),
  );
  expect(points()).not.toEqual(before);
  const connections = JSON.stringify(d.connections);
  apply(selectRootDepth('app', 0));
  apply(selectRootDepth('app', 1));
  expect(JSON.stringify(d.connections)).toBe(connections);
  const reloaded = JSON.parse(JSON.stringify(d));
  validateRecursiveDocument(reloaded);
  expect(reloaded.objects.app.boundaryPoints).toEqual(
    d.objects.app.boundaryPoints,
  );
  expect(recursiveScene(reloaded).connections).toEqual(
    recursiveScene(d).connections,
  );
  expect(
    transactDocument(
      d,
      createConnector(
        'invalid',
        'line',
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { objectId: 'app', pointId: 'port' },
        'api',
      ),
    ).status,
  ).toBe('rejected');
});
it('resolves point placement through rotated ancestors and active depth arrangements', () => {
  const d = recursiveFixture();
  d.layouts.app[1].app.rotation = 63;
  d.layouts.app[1].api.rotation = -21;
  const world = activeWorldGeometry(d).get('api')!;
  const at = toWorldGeometry({ ...world, x: world.width / 2, y: 0 }, world);
  expect(boundaryPlacement(at, world)).toEqual({ side: 'right', offset: 0.5 });
});
