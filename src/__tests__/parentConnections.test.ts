import { recursiveFixture } from './recursiveFixtures';
import { activeWorldGeometry } from '../shared/recursiveHierarchy';
import { createConnector } from '../shared/recursiveCreation';
import {
  bindingTarget,
  boundEndpoint,
  connectionAnchors,
  replaceEndpoint,
} from '../shared/connectionEditing';
import { connectionRoute, worldPoint } from '../shared/connectionGeometry';
import { transactDocument } from '../shared/documentTransactions';
import { patchConnection } from '../shared/editorProperties';
import { moveSubtree } from '../shared/recursiveMovement';
import { recursiveScene } from '../shared/recursiveScene';
import {
  validateRecursiveDocument,
  type DiagramConnection,
  type RecursiveDocument,
} from '../shared/recursiveDocument';

const modifiers = {
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
};
function fixture() {
  const document = recursiveFixture();
  document.layouts.app[1].app = {
    x: 550,
    y: 350,
    width: 500,
    height: 360,
    rotation: 37,
    z: 0,
  };
  document.layouts.app[1].api = {
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    z: 0,
  };
  return document;
}
function connect(document: RecursiveDocument, from: string, to: string) {
  const world = activeWorldGeometry(document);
  const start = connectionAnchors(world.get(from)!)[3];
  const end = connectionAnchors(world.get(to)!)[3];
  createConnector('inside', 'arrow', start, end, from, to)(document);
  const connection = document.connections.inside;
  connection.start = boundEndpoint(
    document,
    world,
    connection.ownerId,
    from,
    start,
    1,
  );
  connection.end = boundEndpoint(
    document,
    world,
    connection.ownerId,
    to,
    end,
    1,
  );
  return connection;
}

it.each(['rectangle', 'frame', 'diamond', 'ellipse'] as const)(
  'connects both directions at a rotated %s parent border without crossing its far side',
  (type) => {
    for (const reverse of [false, true]) {
      const document = fixture();
      document.objects.app.type = type;
      const connection = connect(
        document,
        reverse ? 'api' : 'app',
        reverse ? 'app' : 'api',
      );
      const world = activeWorldGeometry(document);
      expect(connection.ownerId).toBe('app');
      expect(document.objects.app.boundaryPoints).toBeUndefined();
      for (const lineType of ['sharp', 'curved', 'elbow']) {
        connection.style = { lineType };
        const route = connectionRoute(document, connection, world)!;
        const [parent, child] = reverse
          ? [...route.vertices].reverse()
          : route.vertices;
        expect(parent.x).toBeCloseTo(-242);
        expect(parent.y).toBeCloseTo(0);
        expect(child.x).toBeCloseTo(-58);
        expect(child.y).toBeCloseTo(0);
        for (const point of route.samples) {
          expect(point.x).toBeGreaterThanOrEqual(-242.000001);
          expect(point.x).toBeLessThanOrEqual(-57.999999);
          expect(point.y).toBeCloseTo(0);
        }
      }
      expect(() =>
        validateRecursiveDocument(JSON.parse(JSON.stringify(document))),
      ).not.toThrow();
    }
  },
);

it('uses arbitrary parent border positions and automatic attachments inside the parent', () => {
  const document = fixture();
  const connection = connect(document, 'app', 'api');
  const world = activeWorldGeometry(document),
    owner = world.get('app')!;
  const point = worldPoint({ x: -250, y: -90 }, owner);
  connection.start = boundEndpoint(document, world, 'app', 'app', point, 1);
  expect(connection.start).toMatchObject({
    binding: 'fixed',
    side: 'left',
    offset: 0.25,
  });
  let route = connectionRoute(document, connection, world)!;
  expect(route.vertices[0].x).toBeCloseTo(-250 + 2000 / Math.hypot(250, 90));
  expect(route.vertices[0].y).toBeCloseTo(-90 + 720 / Math.hypot(250, 90));
  connection.start = {
    kind: 'object',
    objectId: 'app',
    binding: 'auto',
    side: 'top',
    offset: 0.5,
  };
  connection.end = { kind: 'free', x: 150, y: 0 };
  route = connectionRoute(document, connection, world)!;
  expect(route.vertices[0].x).toBeCloseTo(242);
  expect(route.vertices[0].y).toBeCloseTo(0);
});

it('snaps endpoint drags to the owning border and leaves empty interior space free', () => {
  const document = fixture();
  const connection = connect(document, 'app', 'api');
  const world = activeWorldGeometry(document),
    owner = world.get('app')!;
  const near = worldPoint({ x: -247, y: 7 }, owner);
  expect(bindingTarget(document, world, near, 1, modifiers, 'app')).toBe('app');
  const dragged = replaceEndpoint(
    document,
    world,
    connection,
    'end',
    near,
    'app',
    1,
  );
  expect(dragged.end).toMatchObject({
    objectId: 'app',
    binding: 'fixed',
    side: 'left',
    offset: 0.5,
  });
  const interior = worldPoint({ x: -100, y: -90 }, owner);
  expect(
    bindingTarget(document, world, interior, 1, modifiers, 'app'),
  ).toBeNull();
  expect(
    bindingTarget(
      document,
      world,
      near,
      1,
      { ...modifiers, ctrlKey: true },
      'app',
    ),
  ).toBeNull();
  const detached = replaceEndpoint(
    document,
    world,
    dragged,
    'end',
    interior,
    null,
    1,
  );
  expect(detached.end).toMatchObject({ kind: 'free' });
  if (detached.end.kind === 'free') {
    expect(detached.end.x).toBeCloseTo(-100);
    expect(detached.end.y).toBeCloseTo(-90);
  }
});

it('converts external routes to internal ones during reattachment and keeps bends in world space', () => {
  const document = fixture();
  const connection = connect(document, 'app', 'payments');
  connection.points = [{ x: 600, y: 250 }];
  const world = activeWorldGeometry(document);
  const inside = replaceEndpoint(
    document,
    world,
    connection,
    'end',
    world.get('api')!,
    'api',
    1,
  );
  expect(inside.ownerId).toBe('app');
  expect(inside.start).toEqual(connection.start);
  const bend = worldPoint(inside.points![0], world.get('app'));
  expect(bend.x).toBeCloseTo(600);
  expect(bend.y).toBeCloseTo(250);
  const outside = replaceEndpoint(
    document,
    world,
    inside,
    'end',
    world.get('payments')!,
    'payments',
    1,
  );
  expect(outside.ownerId).toBeNull();
  expect(outside.points![0].x).toBeCloseTo(600);
  expect(outside.points![0].y).toBeCloseTo(250);
  const free: DiagramConnection = {
    ...connection,
    start: { kind: 'free', x: 600, y: 260 },
  };
  const moved = replaceEndpoint(
    document,
    world,
    free,
    'end',
    world.get('api')!,
    'api',
    1,
  );
  expect(moved.ownerId).toBe('app');
  if (moved.start.kind !== 'free') throw new Error('Expected a free endpoint');
  const preserved = worldPoint(moved.start, world.get('app'));
  expect(preserved.x).toBeCloseTo(600);
  expect(preserved.y).toBeCloseTo(260);
});

it('accepts parent endpoint property edits but still rejects crossings through other containers', () => {
  const document = fixture();
  const connection = connect(document, 'app', 'api');
  const world = activeWorldGeometry(document);
  const start = { ...connection.start, side: 'top', offset: 0.2 } as const;
  expect(
    transactDocument(document, patchConnection('inside', { start })).status,
  ).toBe('accepted');
  const end = {
    kind: 'object',
    objectId: 'payments',
    side: 'left',
    offset: 0.5,
  } as const;
  expect(
    transactDocument(document, patchConnection('inside', { end })).status,
  ).toBe('rejected');
  expect(() =>
    replaceEndpoint(
      document,
      world,
      connection,
      'start',
      world.get('payments')!,
      'payments',
      1,
    ),
  ).toThrow('boundary points');
  expect(() =>
    createConnector(
      'invalid',
      'arrow',
      world.get('api')!,
      world.get('payments')!,
      'api',
      'payments',
    )(document),
  ).toThrow('boundary points');
});

it('keeps outside arrows when collapsed and restores internal arrows on expansion', () => {
  const document = fixture();
  const inside = connect(document, 'app', 'api');
  const outside = { ...connect(fixture(), 'payments', 'app'), id: 'outside' };
  document.connections = { inside, outside };
  expect(recursiveScene(document).connections.get('app')).toHaveLength(1);
  document.rootDepths.app = 0;
  expect(recursiveScene(document).connections.has('app')).toBe(false);
  expect(recursiveScene(document).connections.get(null)).toHaveLength(1);
  document.rootDepths.app = 1;
  expect(recursiveScene(document).connections.get('app')).toHaveLength(1);
});

it('retains parent attachments when a connected subtree moves and repairs incompatible moves', () => {
  const document = fixture();
  const original = connect(document, 'app', 'api');
  const moved = transactDocument(
    document,
    moveSubtree('app', 'payments', { x: 880, y: 20 }),
  );
  expect(moved.status).toBe('accepted');
  expect(moved.document.connections.inside).toEqual(original);
  expect(moved.document.connectionRepairs).toBeUndefined();
  const promoted = transactDocument(
    document,
    moveSubtree('api', null, { x: 800, y: 350 }),
  );
  expect(promoted.status).toBe('accepted');
  expect(promoted.document.connections.inside.ownerId).toBeNull();
  const crossed = transactDocument(
    document,
    moveSubtree('api', 'payments', { x: 880, y: 20 }),
  );
  expect(crossed.status).toBe('accepted');
  expect(crossed.document.connections.inside).toBeUndefined();
  expect(crossed.document.connectionRepairs!.inside.connection).toEqual(
    original,
  );
});
