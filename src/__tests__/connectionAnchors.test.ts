import {
  connectionAnchors,
  boundEndpoint,
  bindingTarget,
  replaceEndpoint,
} from '../shared/connectionEditing';
import {
  connectionRoute,
  localPoint,
  resolveEndpoint,
  worldPoint,
} from '../shared/connectionGeometry';
import { activeWorldGeometry } from '../shared/recursiveHierarchy';
import { recursiveFixture } from './recursiveFixtures';
import type {
  DiagramConnection,
  Endpoint,
  Geometry,
} from '../shared/recursiveDocument';
import { boundaryPosition } from '../shared/recursiveBoundary';
import { containsShape } from '../shared/recursiveOwnership';

const modifiers = {
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
};
const geometry: Geometry = {
  x: 900,
  y: 100,
  width: 400,
  height: 300,
  rotation: 37,
  z: 0,
};
const fixed: Endpoint = {
  kind: 'object',
  objectId: 'payments',
  side: 'right',
  offset: 0.5,
  binding: 'fixed',
};

it('keeps a visible attachment on a rounded corner using the curve tangent', () => {
  const document = recursiveFixture();
  document.objects.payments.type = 'rectangle';
  document.objects.payments.style = { cornerRadius: 50 };
  const g = { ...geometry, x: 0, y: 0, rotation: 0, width: 200, height: 100 };
  const world = new Map([['payments', g]]);
  const endpoint: Endpoint = { ...fixed, offset: 0 };
  const raw = boundaryPosition(endpoint, g, document.objects.payments);
  const length = Math.hypot(raw.x, raw.y);
  const at = resolveEndpoint(document, endpoint, world, undefined, {
    x: 80,
    y: -100,
  })!;
  expect(at.x).toBeCloseTo(raw.x + (raw.x / length) * 8);
  expect(at.y).toBeCloseTo(raw.y + (raw.y / length) * 8);
});

it.each(['rectangle', 'diamond', 'ellipse', 'frame'] as const)(
  'snaps to four rotated %s anchors within a screen-space radius and releases beyond it',
  (type) => {
    const document = recursiveFixture();
    document.objects.payments.type = type;
    document.layouts.payments[0].payments = geometry;
    const world = activeWorldGeometry(document);
    const anchors = connectionAnchors(geometry);
    expect(anchors.map((anchor) => anchor.side)).toEqual([
      'top',
      'right',
      'bottom',
      'left',
    ]);
    for (const scale of [0.25, 0.5, 1, 2]) {
      for (const anchor of anchors) {
        const near = { x: anchor.x + 11 / scale, y: anchor.y };
        const outside = { x: anchor.x + 13 / scale, y: anchor.y };
        expect(
          boundEndpoint(document, world, null, 'payments', near, scale),
        ).toMatchObject({
          ...fixed,
          side: anchor.side,
        });
        expect(
          boundEndpoint(document, world, null, 'payments', outside, scale),
        ).not.toMatchObject({
          binding: 'fixed',
          side: anchor.side,
          offset: 0.5,
        });
        expect(bindingTarget(document, world, near, scale, modifiers)).toBe(
          'payments',
        );
        expect(
          bindingTarget(document, world, near, scale, {
            ...modifiers,
            ctrlKey: true,
          }),
        ).toBeNull();
      }
    }
    expect(localPoint(anchors[0], geometry).y).toBeCloseTo(-150);
    expect(localPoint(anchors[1], geometry).x).toBeCloseTo(200);
  },
);

it.each(['rectangle', 'diamond', 'ellipse', 'frame'] as const)(
  'keeps a visible %s attachment, slides off the hidden side, and restores its preferred point',
  (type) => {
    const document = recursiveFixture();
    document.objects.payments.type = type;
    document.layouts.payments[0].payments = geometry;
    const world = activeWorldGeometry(document);
    const owner = { ...geometry, x: -200, y: 130, rotation: -28 };
    const toward = (x: number, y: number) =>
      localPoint(worldPoint({ x, y }, geometry), owner);
    const at = (x: number, y: number) =>
      localPoint(
        worldPoint(
          resolveEndpoint(document, fixed, world, owner, toward(x, y))!,
          owner,
        ),
        geometry,
      );
    const serialized = JSON.stringify(fixed);
    expect(at(600, 80).x).toBeCloseTo(208);
    expect(at(600, 80).y).toBeCloseTo(0);
    expect(at(-600, 0).x).toBeCloseTo(-208);
    expect(at(-600, 0).y).toBeCloseTo(0);
    expect(at(600, 80).x).toBeCloseTo(208);
    expect(JSON.stringify(fixed)).toBe(serialized);
  },
);

it('uses the visible wedge at a diamond vertex and the tangent at an ellipse cardinal point', () => {
  const document = recursiveFixture();
  const world = new Map([['payments', { ...geometry, rotation: 0 }]]);
  const endpoint: Endpoint = { ...fixed, side: 'top' };
  const toward = worldPoint({ x: 800, y: 0 }, world.get('payments'));
  document.objects.payments.type = 'diamond';
  expect(resolveEndpoint(document, endpoint, world, undefined, toward)).toEqual(
    { x: 900, y: -58 },
  );
  document.objects.payments.type = 'ellipse';
  expect(resolveEndpoint(document, endpoint, world, undefined, toward)).toEqual(
    { x: 1108, y: 100 },
  );
});

it('uses the adjacent authored bend when deciding whether an attachment is visible', () => {
  const document = recursiveFixture();
  document.objects.payments.type = 'rectangle';
  const world = new Map([['payments', { ...geometry, rotation: 0 }]]);
  const connection: DiagramConnection = {
    id: 'arrow',
    ownerId: null,
    z: 0,
    kind: 'arrow',
    start: fixed,
    points: [{ x: 1300, y: 160 }],
    end: { kind: 'free', x: 300, y: 100 },
  };
  expect(connectionRoute(document, connection, world)!.vertices[0]).toEqual({
    x: 1108,
    y: 100,
  });
  expect(
    connectionRoute(document, { ...connection, points: [] }, world)!
      .vertices[0],
  ).toEqual({ x: 692, y: 100 });
});

it.each(['rectangle', 'diamond', 'ellipse'] as const)(
  'rechecks both %s attachments after either one slides off a hidden side',
  (type) => {
    const document = recursiveFixture();
    document.objects.app.type = type;
    document.objects.payments.type = type;
    const a = { ...geometry, x: 0, y: 0, width: 100, height: 100, rotation: 0 };
    for (const rotation of [0, 37, 90]) {
      const b = {
        ...geometry,
        x: 250,
        y: 70,
        width: 200,
        height: 200,
        rotation,
      };
      const world = new Map([
        ['app', a],
        ['payments', b],
      ]);
      for (const start of connectionAnchors(a))
        for (const end of connectionAnchors(b)) {
          const route = connectionRoute(
            document,
            {
              id: 'arrow',
              ownerId: null,
              kind: 'arrow',
              z: 0,
              start: { ...fixed, objectId: 'app', side: start.side },
              end: { ...fixed, side: end.side },
            },
            world,
          )!;
          const [from, to] = route.vertices;
          for (let i = 1; i < 20; i++) {
            const point = {
              x: from.x + ((to.x - from.x) * i) / 20,
              y: from.y + ((to.y - from.y) * i) / 20,
            };
            expect(containsShape(document.objects.app, a, point)).toBe(false);
            expect(containsShape(document.objects.payments, b, point)).toBe(
              false,
            );
          }
        }
    }
  },
);

it('reattaches a saved boundary endpoint without moving the boundary point or other endpoint', () => {
  const document = recursiveFixture();
  document.objects.payments.boundaryPoints = {
    port: { side: 'left', offset: 0.5 },
  };
  const world = activeWorldGeometry(document);
  const connection: DiagramConnection = {
    id: 'arrow',
    kind: 'arrow',
    ownerId: null,
    z: 0,
    start: { kind: 'free', x: 600, y: 20 },
    end: { kind: 'boundary', objectId: 'payments', pointId: 'port' },
  };
  const original = JSON.stringify(document);
  const anchor = connectionAnchors(world.get('payments')!)[0];
  const rebound = replaceEndpoint(
    document,
    world,
    connection,
    'end',
    anchor,
    'payments',
    1,
  );
  expect(rebound.end).toEqual({ ...fixed, side: 'top' });
  expect(rebound.start).toEqual(connection.start);
  expect(JSON.stringify(document)).toBe(original);
  expect(
    replaceEndpoint(
      document,
      world,
      rebound,
      'end',
      { x: 1500, y: 100 },
      null,
      1,
    ).end,
  ).toEqual({ kind: 'free', x: 1500, y: 100 });
});
