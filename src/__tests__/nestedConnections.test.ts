import { recursiveFixture } from './recursiveFixtures';
import { createConnector } from '../shared/recursiveCreation';
import { boundEndpoint, replaceEndpoint } from '../shared/connectionEditing';
import { connectionRoute, visibleEndpoint } from '../shared/connectionGeometry';
import { recursiveScene } from '../shared/recursiveScene';
import {
  validateRecursiveDocument,
  type Endpoint,
} from '../shared/recursiveDocument';
import { resolveExportSelection } from '../shared/recursiveExportScope';
import { deleteSelection } from '../shared/recursiveDeletion';
import { transactDocument } from '../shared/documentTransactions';
import { containsShape } from '../shared/recursiveOwnership';

function fixture() {
  const document = recursiveFixture();
  const parent = {
    x: 500,
    y: 300,
    width: 500,
    height: 400,
    rotation: 37,
    z: 5,
  };
  const inner = {
    ...parent,
    x: 0,
    y: 0,
    width: 240,
    height: 200,
    rotation: 0,
    z: 0,
  };
  const child = { ...inner, width: 80, height: 60 };
  document.rootDepths.app = 2;
  document.layouts.app = {
    0: { app: { ...parent, width: 300, height: 250 } },
    1: { app: parent, api: inner },
    2: { app: parent, api: inner, endpoint: child },
  };
  document.layouts.payments[0].payments = { ...child, x: 1000, y: 300 };
  const world = recursiveScene(document).world;
  createConnector(
    'arrow',
    'arrow',
    world.get('payments')!,
    world.get('endpoint')!,
    'payments',
    'endpoint',
  )(document);
  const connection = document.connections.arrow;
  connection.start = boundEndpoint(
    document,
    world,
    null,
    'payments',
    world.get('payments')!,
    1,
  );
  connection.end = {
    kind: 'object',
    objectId: 'endpoint',
    side: 'right',
    offset: 0.35,
    binding: 'fixed',
  };
  return document;
}

it.each(['rectangle', 'ellipse', 'diamond', 'frame'] as const)(
  'projects a hidden attachment onto the nearest rotated %s ancestor and restores it exactly',
  (type) => {
    const document = fixture();
    document.objects.app.type = type;
    document.objects.api.type = type;
    const connection = document.connections.arrow;
    const original = JSON.stringify(connection);
    const full = connectionRoute(
      document,
      connection,
      recursiveScene(document).world,
    )!;
    expect(connection.ownerId).toBeNull();
    for (const lineType of ['sharp', 'curved', 'elbow']) {
      connection.style = { lineType };
      for (const depth of [1, 0, 2]) {
        document.rootDepths.app = depth;
        const scene = recursiveScene(document);
        const target = depth === 0 ? 'app' : depth === 1 ? 'api' : 'endpoint';
        expect(
          visibleEndpoint(document, connection.end, scene.world),
        ).toMatchObject({ objectId: target });
        const route = scene.connections.get(null)![0];
        expect(route.points.every(Number.isFinite)).toBe(true);
        expect(
          containsShape(
            document.objects[target],
            scene.world.get(target)!,
            route.vertices.at(-1)!,
          ),
        ).toBe(false);
        if (depth === 2) expect(route.vertices).toEqual(full.vertices);
      }
    }
    connection.style = JSON.parse(original).style;
    expect(JSON.stringify(connection)).toBe(original);
    expect(() =>
      validateRecursiveDocument(JSON.parse(JSON.stringify(document))),
    ).not.toThrow();
  },
);

it('uses independent collapse at unchanged depth, and paints above entered containers', () => {
  const document = fixture();
  for (const [collapsed, target] of [
    [[], 'endpoint'],
    [['api'], 'api'],
    [['app'], 'app'],
    [[], 'endpoint'],
  ] as const) {
    document.extensions = { collapsedObjects: [...collapsed] };
    const scene = recursiveScene(document);
    expect(
      visibleEndpoint(document, document.connections.arrow.end, scene.world),
    ).toMatchObject({ objectId: target });
    const order = scene.paintOrder.get(null)!;
    if (target !== 'app')
      expect(order.findIndex((item) => item.id === 'arrow')).toBeGreaterThan(
        order.findIndex((item) => item.id === 'app'),
      );
    expect(document.connections.arrow.z).toBe(0);
    expect(document.rootDepths.app).toBe(2);
  }
});

it('works in both directions and does not show loops for two targets hidden in one container', () => {
  const document = fixture();
  const connection = document.connections.arrow;
  [connection.start, connection.end] = [connection.end, connection.start];
  document.rootDepths.app = 0;
  const scene = recursiveScene(document);
  expect(scene.connections.get(null)).toHaveLength(1);
  expect(
    visibleEndpoint(document, connection.start, scene.world),
  ).toMatchObject({ objectId: 'app' });
  connection.end = {
    kind: 'object',
    objectId: 'api',
    side: 'right',
    offset: 0.5,
  };
  expect(recursiveScene(document).connections.size).toBe(0);
  document.rootDepths.app = 2;
  expect(recursiveScene(document).connections.get(null)).toHaveLength(1);
});

it('keeps the hidden child attachment when editing the other endpoint and detaches the projected endpoint when dragged', () => {
  const document = fixture();
  document.rootDepths.app = 0;
  const world = recursiveScene(document).world;
  const original = document.connections.arrow;
  const moved = replaceEndpoint(
    document,
    world,
    original,
    'start',
    { x: 1100, y: 400 },
    null,
    1,
  );
  expect(moved.end).toEqual(original.end);
  expect(moved.start).toEqual({ kind: 'free', x: 1100, y: 400 });
  expect(connectionRoute(document, moved, world)).not.toBeNull();
  const detached = replaceEndpoint(
    document,
    world,
    original,
    'end',
    { x: 800, y: 500 },
    null,
    1,
  );
  expect(detached.end).toEqual({ kind: 'free', x: 800, y: 500 });
  document.rootDepths.app = 2;
  expect(
    connectionRoute(
      document,
      detached,
      recursiveScene(document).world,
    )!.vertices.at(-1),
  ).toEqual({ x: 800, y: 500 });
});

it('includes projected routes in selection exports and detaches deleted hidden targets at their painted position', () => {
  const document = fixture();
  document.rootDepths.app = 0;
  const before = recursiveScene(document)
    .connections.get(null)![0]
    .vertices.at(-1)!;
  const selected = resolveExportSelection(document, [
    'object-app',
    'object-payments',
  ]);
  expect(selected.connections).toEqual(new Set(['arrow']));
  expect(selected.objects.has('endpoint')).toBe(false);
  const deleted = transactDocument(document, deleteSelection(['app']));
  expect(deleted.status).toBe('accepted');
  expect(deleted.document.connections.arrow.end).toEqual({
    kind: 'free',
    ...before,
  });
});

it('chooses the nearest common owner for nested targets in the same tree', () => {
  const document = fixture();
  document.objects.peer = {
    ...document.objects.api,
    id: 'peer',
    parentId: 'app',
  };
  for (const depth of [1, 2])
    document.layouts.app[depth].peer = {
      ...document.layouts.app[depth].api,
      x: 180,
      width: 60,
      height: 60,
    };
  const world = recursiveScene(document).world;
  createConnector(
    'internal',
    'arrow',
    world.get('endpoint')!,
    world.get('peer')!,
    'endpoint',
    'peer',
  )(document);
  expect(document.connections.internal.ownerId).toBe('app');
  document.extensions = { collapsedObjects: ['api'] };
  const scene = recursiveScene(document);
  expect(scene.connections.get('app')).toHaveLength(1);
  expect(
    visibleEndpoint(document, document.connections.internal.start, scene.world),
  ).toMatchObject({ objectId: 'api' });
  document.extensions.collapsedObjects = ['app'];
  expect(recursiveScene(document).connections.has('app')).toBe(false);
});

it('projects both endpoints independently across collapsed roots without altering saved bindings', () => {
  const document = fixture();
  document.objects.consumer = {
    ...document.objects.endpoint,
    id: 'consumer',
    parentId: 'payments',
  };
  document.layouts.payments[1] = {
    payments: {
      ...document.layouts.payments[0].payments,
      width: 240,
      height: 200,
    },
    consumer: { ...document.layouts.app[2].endpoint },
  };
  document.rootDepths.payments = 1;
  const start: Endpoint = {
    kind: 'object',
    objectId: 'consumer',
    side: 'left',
    offset: 0.5,
    binding: 'fixed',
  };
  document.connections.arrow.start = start;
  for (const depths of [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
  ]) {
    [document.rootDepths.app, document.rootDepths.payments] = depths;
    const scene = recursiveScene(document);
    expect(scene.connections.get(null)).toHaveLength(1);
    expect(visibleEndpoint(document, start, scene.world)).toMatchObject({
      objectId: depths[1] ? 'consumer' : 'payments',
    });
    expect(
      visibleEndpoint(document, document.connections.arrow.end, scene.world),
    ).toMatchObject({ objectId: depths[0] ? 'endpoint' : 'app' });
  }
  expect(document.connections.arrow.start).toEqual(start);
});
