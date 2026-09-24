import { recursiveFixture } from './recursiveFixtures';
import { resolveExportSelection } from '../shared/recursiveExportScope';
import type { DiagramConnection, Endpoint } from '../shared/recursiveDocument';
function fixture() {
  const d = recursiveFixture();
  d.objects.cache = { ...d.objects.api, id: 'cache', name: 'cache' };
  for (const depth of [1, 2])
    d.layouts.app[depth].cache = { ...d.objects.cache.geometry, x: 80 };
  d.objects.app.boundaryPoints = { port: { side: 'right', offset: 0.5 } };
  const object = (objectId: string): Endpoint => ({
    kind: 'object',
    objectId,
    side: 'left',
    offset: 0.5,
  });
  const add = (
    id: string,
    ownerId: string | null,
    start: Endpoint,
    end: Endpoint,
  ) => {
    d.connections[id] = {
      id,
      ownerId,
      kind: 'arrow',
      z: 0,
      start,
      end,
    } as DiagramConnection;
  };
  add('outside', null, object('app'), object('payments'));
  add('siblings', 'app', object('api'), object('cache'));
  add(
    'bridge',
    'app',
    { kind: 'boundary', objectId: 'app', pointId: 'port' },
    object('api'),
  );
  add('free', 'app', object('api'), { kind: 'free', x: 20, y: 30 });
  add('hidden', 'api', object('endpoint'), { kind: 'free', x: 0, y: 0 });
  return d;
}
it('includes selected visible descendants once and resolves endpoint/bridge membership without changing depths', () => {
  const d = fixture(),
    before = JSON.stringify(d);
  const scope = resolveExportSelection(d, [
    'object-app',
    'object-api',
    'object-payments',
  ]);
  expect(scope.objects).toEqual(new Set(['app', 'api', 'cache', 'payments']));
  expect(scope.connections).toEqual(new Set(['outside', 'siblings', 'bridge']));
  expect(JSON.stringify(d)).toBe(before);
});
it('does not infer a route from one selected endpoint, include free routes implicitly, or add ancestors/siblings to a leaf', () => {
  const d = fixture();
  const leaf = resolveExportSelection(d, ['object-api']);
  expect(leaf.objects).toEqual(new Set(['api']));
  expect(leaf.connections.size).toBe(0);
  expect(
    resolveExportSelection(d, ['object-api', 'object-cache']).connections,
  ).toEqual(new Set(['siblings']));
});
it.each(
  [[], ['object-app'], ['object-app', 'object-payments']].map((objects) => ({
    objects,
  })),
)('includes explicit connectors without adding targets (%j)', ({ objects }) => {
  const scope = resolveExportSelection(fixture(), [
    ...objects,
    'connection-outside',
    'connection-free',
  ]);
  expect(scope.connections.has('outside')).toBe(true);
  expect(scope.connections.has('free')).toBe(true);
  expect(scope.objects.has('payments')).toBe(
    objects.includes('object-payments'),
  );
  expect(scope.objects.has('app')).toBe(objects.includes('object-app'));
});
it('ignores stale/depth-hidden selections and reveals nothing, then includes deeper content only when already displayed', () => {
  const d = fixture();
  const scope = resolveExportSelection(d, [
    'object-missing',
    'object-endpoint',
    'connection-hidden',
    'connection-missing',
  ]);
  expect(scope.objects.size).toBe(0);
  expect(scope.connections.size).toBe(0);
  expect(d.rootDepths.app).toBe(1);
  d.rootDepths.app = 2;
  const revealed = resolveExportSelection(d, [
    'object-api',
    'connection-hidden',
  ]);
  expect(revealed.objects).toEqual(new Set(['api', 'endpoint']));
  expect(revealed.connections).toEqual(new Set(['hidden']));
});

it('captures membership independently of later selection or depth changes', () => {
  const d = fixture();
  const selected = ['object-app'];
  const scope = resolveExportSelection(d, selected);
  selected.push('object-payments');
  d.rootDepths.app = 2;
  expect(scope.objects).toEqual(new Set(['app', 'api', 'cache']));
  expect(scope.connections).toEqual(new Set(['siblings', 'bridge']));
});
