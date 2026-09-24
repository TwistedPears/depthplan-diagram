import { patchConnection } from '../shared/editorProperties';
import {
  connectionRoute,
  worldPoint,
  localPoint,
  arrowheads,
  constrainPoint,
  distanceToSegment,
} from '../shared/connectionGeometry';
import { bindingTarget, replaceEndpoint } from '../shared/connectionEditing';
import { activeWorldGeometry } from '../shared/recursiveHierarchy';
import { recursiveFixture } from './recursiveFixtures';
import { transactDocument } from '../shared/documentTransactions';
import { createConnector } from '../shared/recursiveCreation';
import { moveSubtree } from '../shared/recursiveMovement';
import { deleteSelection } from '../shared/recursiveDeletion';
import { endpointWorld } from '../shared/recursiveConnectionRepair';
import {
  validateRecursiveDocument,
  type DiagramConnection,
} from '../shared/recursiveDocument';
import { editAction } from '../shared/editorApiContract';

const free = (): DiagramConnection => ({
  id: 'route',
  kind: 'arrow',
  ownerId: null,
  z: 0,
  start: { kind: 'free', x: -100, y: -100 },
  end: { kind: 'free', x: 200, y: 100 },
  points: [
    { x: 10, y: -200 },
    { x: 100, y: 50 },
  ],
});
it('retains authored vertices through straight, curved and elbow routing with finite path-centered labels', () => {
  const d = recursiveFixture(),
    c = free(),
    world = activeWorldGeometry(d);
  for (const lineType of ['sharp', 'curved', 'elbow']) {
    c.style = { lineType };
    const r = connectionRoute(d, c, world)!;
    expect(r.vertices.slice(1, -1)).toEqual(c.points);
    expect(r.points.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(r.label.x + r.label.y)).toBe(true);
    expect(r.route[0]).toEqual(
      c.start.kind === 'free' ? { x: c.start.x, y: c.start.y } : null,
    );
    expect(r.route.at(-1)).toEqual({ x: 200, y: 100 });
    if (lineType === 'elbow')
      r.route
        .slice(1)
        .forEach((p, i) =>
          expect(p.x === r.route[i].x || p.y === r.route[i].y).toBe(true),
        );
    if (lineType === 'curved') {
      expect(r.route.length).toBe(10);
      expect(r.samples).toHaveLength(61);
    }
  }
});
it('validates path points and bindings in native documents and the complete marker palette in MCP', () => {
  const d = recursiveFixture();
  d.connections.route = free();
  expect(() =>
    validateRecursiveDocument(JSON.parse(JSON.stringify(d))),
  ).not.toThrow();
  d.connections.route.points = [{ x: NaN, y: 4 }];
  expect(() => validateRecursiveDocument(d)).toThrow();
  for (const marker of arrowheads)
    expect(
      editAction.safeParse({
        type: 'edit_connection',
        id: 'route',
        points: [{ x: 2, y: 3 }],
        style: { arrowheadStart: marker, arrowheadEnd: marker },
      }).success,
    ).toBe(true);
});
it.each([undefined, 'sharp'])(
  'preserves bends when editing other properties of an already straight path (%s)',
  (lineType) => {
    const d = recursiveFixture();
    d.connections.route = free();
    if (lineType) d.connections.route.style = { lineType };
    const result = transactDocument(
      d,
      patchConnection('route', {
        style: { lineType: 'sharp', stroke: '#123456' },
      }),
    );
    expect(result.status).toBe('accepted');
    expect(result.document.connections.route.points).toEqual(
      d.connections.route.points,
    );
  },
);
it('converts authored world points into a rotated owner and preserves them when an attached child changes owner', () => {
  const d = recursiveFixture();
  d.layouts.app[1].app.rotation = 37;
  const world = activeWorldGeometry(d),
    owner = world.get('app')!;
  const start = worldPoint({ x: 30, y: 40 }, owner),
    end = worldPoint({ x: 100, y: 80 }, owner),
    pin = worldPoint({ x: 90, y: -30 }, owner);
  const created = transactDocument(
    d,
    createConnector('route', 'arrow', start, end, 'api', null, [pin]),
  );
  expect(created.status).toBe('accepted');
  const c = created.document.connections.route;
  expect(c.points![0].x).toBeCloseTo(90);
  expect(c.points![0].y).toBeCloseTo(-30);
  const moved = transactDocument(
    created.document,
    moveSubtree('api', null, { x: 0, y: 400 }),
  );
  expect(moved.status).toBe('accepted');
  expect(moved.document.connections.route.ownerId).toBeNull();
  expect(moved.document.connections.route.points![0].x).toBeCloseTo(pin.x);
  expect(moved.document.connections.route.points![0].y).toBeCloseTo(pin.y);
});
it.each(['rectangle', 'ellipse', 'diamond', 'frame'] as const)(
  'binds near rotated %s outlines, honors disabling, and detaches deleted targets at the painted endpoint',
  (type) => {
    const d = recursiveFixture();
    d.objects.payments.type = type;
    d.layouts.payments[0].payments.rotation = 37;
    const world = activeWorldGeometry(d),
      g = world.get('payments')!;
    const modifiers = {
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(bindingTarget(d, world, g, 1, modifiers)).toBe('payments');
    expect(
      bindingTarget(d, world, g, 1, { ...modifiers, ctrlKey: true }),
    ).toBeNull();
    const c = replaceEndpoint(d, world, free(), 'end', g, 'payments', false);
    expect(c.end).toMatchObject({
      kind: 'object',
      objectId: 'payments',
      binding: 'auto',
    });
    d.connections.route = c;
    const at = endpointWorld(d, c, c.end);
    const deleted = transactDocument(d, deleteSelection(['payments'], []));
    expect(deleted.status).toBe('accepted');
    expect(deleted.document.connections.route.end).toMatchObject({
      kind: 'free',
      x: at.x,
      y: at.y,
    });
  },
);
it('rejects incompatible nested bindings while accepting explicit owner boundary bridges', () => {
  const d = recursiveFixture(),
    world = activeWorldGeometry(d);
  const c = replaceEndpoint(
    d,
    world,
    free(),
    'start',
    world.get('api')!,
    'api',
    false,
  );
  expect(c.ownerId).toBe('app');
  expect(() =>
    replaceEndpoint(
      d,
      world,
      c,
      'end',
      world.get('payments')!,
      'payments',
      false,
    ),
  ).toThrow('boundary points');
  d.objects.app.boundaryPoints = { port: { side: 'left', offset: 0.5 } };
  expect(
    replaceEndpoint(
      d,
      world,
      c,
      'end',
      world.get('app')!,
      { objectId: 'app', pointId: 'port' },
      false,
    ).end,
  ).toEqual({ kind: 'boundary', objectId: 'app', pointId: 'port' });
});
it('routes bound elbows orthogonally around targets across relative positions', () => {
  const d = recursiveFixture();
  for (const rotation of [0, 37, 90])
    for (const x of [250, 500, 900])
      for (const y of [-200, 20, 300]) {
        d.layouts.payments[0].payments = {
          ...d.layouts.payments[0].payments,
          x,
          y,
          rotation,
        };
        const world = activeWorldGeometry(d);
        const c = {
          ...free(),
          points: [],
          start: {
            kind: 'object',
            objectId: 'app',
            side: 'right',
            offset: 0.5,
            binding: 'auto',
          },
          end: {
            kind: 'object',
            objectId: 'payments',
            side: 'left',
            offset: 0.5,
            binding: 'auto',
          },
          style: { lineType: 'elbow' },
        } as DiagramConnection;
        const r = connectionRoute(d, c, world)!;
        r.route
          .slice(1)
          .forEach((p, i) =>
            expect(p.x === r.route[i].x || p.y === r.route[i].y).toBe(true),
          );
      }
});
it('angle locking and point transforms are stable at arbitrary rotations', () => {
  expect(constrainPoint({ x: 0, y: 0 }, { x: 90, y: 10 }, true).y).toBe(0);
  const owner = { x: 400, y: -80, rotation: 47, width: 300, height: 200, z: 0 };
  const p = localPoint(worldPoint({ x: 10, y: 20 }, owner), owner);
  expect(p.x).toBeCloseTo(10);
  expect(p.y).toBeCloseTo(20);
  expect(Object.keys(p)).toEqual(['x', 'y']);
});

it('keeps free lines drawn over collapsed leaf shapes in the visible containing scope', () => {
  const d = recursiveFixture();
  const result = transactDocument(
    d,
    createConnector(
      'route',
      'line',
      { x: 880, y: 10 },
      { x: 920, y: 30 },
      null,
      null,
    ),
  );
  expect(result.status).toBe('accepted');
  expect(result.document.connections.route.ownerId).toBeNull();
});

it('finds the clicked segment near its endpoint instead of choosing a nearby segment midpoint', () => {
  expect(
    distanceToSegment({ x: 2, y: 1 }, { x: 0, y: 0 }, { x: 1000, y: 0 }),
  ).toBe(1);
  expect(
    distanceToSegment({ x: 2, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 }),
  ).toBeCloseTo(Math.sqrt(5));
});
it('rejects new attached ordinary Lines while accepting stored Line documents unchanged', () => {
  const d = recursiveFixture();
  const result = transactDocument(
    d,
    createConnector(
      'route',
      'line',
      { x: 450, y: 20 },
      { x: 850, y: 20 },
      'app',
      'payments',
    ),
  );
  expect(result.status).toBe('rejected');
  d.connections.route = {
    ...free(),
    kind: 'line',
    start: { kind: 'object', objectId: 'app', side: 'right', offset: 0.5 },
  };
  const serialized = JSON.stringify(d);
  validateRecursiveDocument(d);
  expect(JSON.stringify(d)).toBe(serialized);
});

it('applies the same ordinary-Line and explicit-boundary rules to MCP endpoint patches', () => {
  const d = recursiveFixture();
  d.connections.route = free();
  expect(
    transactDocument(
      d,
      patchConnection('route', {
        end: { kind: 'object', objectId: 'api', side: 'left', offset: 0.5 },
      }),
    ).status,
  ).toBe('rejected');
  expect(
    transactDocument(
      d,
      patchConnection('route', {
        end: {
          kind: 'object',
          objectId: 'payments',
          side: 'left',
          offset: 0.5,
          binding: 'auto',
        },
      }),
    ).status,
  ).toBe('accepted');
  d.connections.route.kind = 'line';
  expect(
    transactDocument(
      d,
      patchConnection('route', {
        end: {
          kind: 'object',
          objectId: 'payments',
          side: 'left',
          offset: 0.5,
        },
      }),
    ).status,
  ).toBe('rejected');
  d.connections.route.end = {
    kind: 'object',
    objectId: 'api',
    side: 'left',
    offset: 0.5,
  };
  expect(
    transactDocument(
      d,
      patchConnection('route', { end: d.connections.route.end, points: [] }),
    ).status,
  ).toBe('accepted');
});
