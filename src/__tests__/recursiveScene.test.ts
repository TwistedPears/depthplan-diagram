import { recursiveFixture, geometry } from './recursiveFixtures';
import { recursiveScene, contentText } from '../shared/recursiveScene';
import { transactDocument } from '../shared/documentTransactions';
import { insertSubtree } from '../shared/recursiveOwnership';

it('interleaves shapes and connections by Z with stable kind/ID ties and separate owner scopes', () => {
  const d = recursiveFixture();
  for (const [id, z] of [
    ['above', 1],
    ['below', -1],
    ['app', 0],
    ['tie', 0],
  ] as const)
    d.connections[id] = {
      id,
      z,
      ownerId: null,
      kind: 'line',
      start: { kind: 'free', x: 0, y: 0 },
      end: { kind: 'free', x: 100, y: 100 },
    };
  d.connections.inside = {
    ...d.connections.above,
    id: 'inside',
    ownerId: 'app',
    z: 999,
  };
  const keys = (scope: string | null) =>
    recursiveScene(d)
      .paintOrder.get(scope)
      ?.map((item) => `${item.kind}-${item.id}`);
  expect(keys(null)).toEqual([
    'connection-below',
    'connection-app',
    'connection-tie',
    'object-app',
    'object-payments',
    'connection-above',
  ]);
  expect(keys('app')).toEqual(['object-api', 'connection-inside']);
  d.rootDepths.app = 0;
  expect(keys('app')).toEqual([]);
  expect(keys(null)).not.toContain('connection-inside');
});

it('orders siblings within parents and retains saved geometry for expanded and collapsed identities', () => {
  let d = recursiveFixture();
  const result = transactDocument(
    d,
    insertSubtree([
      { ...d.objects.api, id: 'cache', parentId: 'app', type: 'ellipse' },
    ]),
  );
  d = result.document;
  d.rootDepths.app = 2;
  d.layouts.app['2'].app.rotation = 90;
  d.layouts.app['2'].cache.z = -1;
  const scene = recursiveScene(d);
  expect(scene.children.get('app')).toEqual(['cache', 'api']);
  expect([...scene.expanded]).toEqual(['app', 'api']);
  expect(scene.local.get('api')).toEqual(d.layouts.app['2'].api);
  expect(scene.world.get('endpoint')).toMatchObject({
    x: 460,
    y: 40,
    rotation: 90,
  });
  expect(scene.world.get('payments')).toMatchObject({ x: 900, y: 20 });
  d.rootDepths.app = 0;
  const collapsed = recursiveScene(d);
  expect(collapsed.expanded.size).toBe(0);
  expect(collapsed.children.get(null)).toEqual(['app', 'payments']);
  expect(collapsed.children.get('app')).toEqual([]);
  expect(collapsed.local.get('app')).toEqual(d.layouts.app['0'].app);
});
it('resolves attached and boundary endpoints in owner coordinates and hides hidden-child links', () => {
  const d = recursiveFixture();
  d.objects.app.boundaryPoints = { out: { side: 'right', offset: 0.5 } };
  d.connections.outside = {
    id: 'outside',
    ownerId: null,
    kind: 'arrow',
    z: 0,
    start: { kind: 'boundary', objectId: 'app', pointId: 'out' },
    end: { kind: 'object', objectId: 'payments', side: 'left', offset: 0.5 },
  };
  d.connections.inside = {
    id: 'inside',
    ownerId: 'app',
    kind: 'line',
    z: 0,
    start: { kind: 'boundary', objectId: 'app', pointId: 'out' },
    end: { kind: 'object', objectId: 'api', side: 'left', offset: 0.5 },
  };
  const expanded = recursiveScene(d);
  expect(expanded.connections.get(null)).toMatchObject([
    { id: 'outside', points: [450, 20, 850, 20] },
  ]);
  expect(expanded.connections.get('app')).toMatchObject([
    { id: 'inside', points: [50, 0, -40, 20] },
  ]);
  d.rootDepths.app = 0;
  const collapsed = recursiveScene(d);
  expect(collapsed.connections.get('app')).toBeUndefined();
  expect(collapsed.connections.get(null)?.[0].points).toEqual([
    60, 20, 850, 20,
  ]);
  expect(d.connections.inside.end).toMatchObject({ objectId: 'api' });
});
it('moves a three-generation scene through parent transforms without altering local child sizes', () => {
  const d = recursiveFixture();
  d.rootDepths.app = 2;
  const before = recursiveScene(d);
  d.layouts.app['2'].app.x += 120;
  d.layouts.app['2'].app.width = 999;
  const after = recursiveScene(d);
  expect(after.world.get('endpoint')!.x - before.world.get('endpoint')!.x).toBe(
    120,
  );
  expect(after.local.get('api')).toEqual(geometry);
  expect(after.local.get('endpoint')).toEqual(geometry);
});
it('reads nested content without modifying canonical rich structure', () => {
  expect(
    contentText([
      { type: 'heading', level: 1, runs: [{ text: 'Title' }] },
      {
        type: 'quote',
        blocks: [
          {
            type: 'list',
            ordered: false,
            items: [
              [{ type: 'code', language: 'typescript', text: 'const x = 1;' }],
            ],
          },
        ],
      },
    ]),
  ).toBe('Title\nconst x = 1;');
});

it('hides every collapsed drawing scope, even owner-boundary and free-end routes, without changing stored data', () => {
  const d = recursiveFixture();
  for (const id of ['app', 'api']) {
    d.objects[id].boundaryPoints = { port: { side: 'right', offset: 0.3 } };
    d.connections[id] = {
      id,
      ownerId: id,
      kind: 'arrow',
      z: 0,
      label: `Inside ${id}`,
      start: { kind: 'boundary', objectId: id, pointId: 'port' },
      end: { kind: 'free', x: 30, y: 50 },
      style: { lineType: 'curved', arrowheadStart: 'circle' },
    };
  }
  d.connections.boundaries = {
    ...d.connections.app,
    id: 'boundaries',
    end: { kind: 'boundary', objectId: 'app', pointId: 'port' },
  };
  d.connections.hiddenTarget = {
    ...d.connections.app,
    id: 'hiddenTarget',
    ownerId: null,
    end: { kind: 'object', objectId: 'endpoint', side: 'left', offset: 0.5 },
  };
  for (const depth of [0, 1, 2, 1, 0, 2]) {
    d.rootDepths.app = depth;
    const before = JSON.stringify(d);
    const scene = recursiveScene(d);
    expect(scene.connections.has('app')).toBe(depth > 0);
    expect(scene.connections.has('api')).toBe(depth > 1);
    expect(scene.connections.has(null)).toBe(depth > 0);
    expect(scene.world.get('payments')).toMatchObject({ x: 900, y: 20 });
    expect(JSON.stringify(d)).toBe(before);
  }
});
