import { recursiveFixture, geometry } from './recursiveFixtures';
import {
  type DiagramObject,
  validateRecursiveDocument,
} from '../shared/recursiveDocument';
import { transactDocument } from '../shared/documentTransactions';
import { eligibleParent, insertSubtree } from '../shared/recursiveOwnership';
import {
  activeWorldGeometry,
  indexHierarchy,
  toLocalGeometry,
  toWorldGeometry,
} from '../shared/recursiveHierarchy';
const object = (id: string, parentId: string | null): DiagramObject => ({
  id,
  parentId,
  name: id,
  type: 'rectangle',
  content: [],
  geometry: { ...geometry },
});

it('adds a nested subtree with stable IDs and completes every saved visible arrangement', () => {
  const d = recursiveFixture();
  const next = transactDocument(
    d,
    insertSubtree([object('new', 'api'), object('deep', 'new')]),
  );
  expect(next.status).toBe('accepted');
  validateRecursiveDocument(next.document);
  expect(next.document.objects.deep.parentId).toBe('new');
  expect(next.document.layouts.app['1'].new).toBeUndefined();
  expect(next.document.layouts.app['2'].new).toEqual(geometry);
  expect(
    indexHierarchy(next.document.objects).entries.get('deep'),
  ).toMatchObject({
    root: 'app',
    generation: 3,
  });
  expect(next.document.rootDepths).toEqual(d.rootDepths);
});
it('world placement composes rotation without moving a new child or scaling descendants', () => {
  const d = recursiveFixture();
  d.layouts.app['1'].app.rotation = 90;
  const world = { ...geometry, x: 450, y: 220, rotation: 105 };
  const next = transactDocument(
    d,
    insertSubtree([object('new', 'app')], world),
  );
  expect(next.status).toBe('accepted');
  const actual = activeWorldGeometry(next.document).get('new')!;
  expect(actual.x).toBeCloseTo(world.x);
  expect(actual.y).toBeCloseTo(world.y);
  expect(actual.rotation).toBe(world.rotation);
  expect(actual.width).toBe(world.width);
  expect(
    toWorldGeometry(
      toLocalGeometry(world, d.layouts.app['1'].app),
      d.layouts.app['1'].app,
    ),
  ).toMatchObject({ rotation: 105, width: 100 });
});
it('rejects duplicate identities, missing parents and cycles without partial insertion', () => {
  const d = recursiveFixture();
  for (const records of [
    [object('api', 'app')],
    [object('new', 'missing')],
    [object('new', 'new')],
    [object('a', 'b'), object('b', 'a')],
    [object('new', 'app'), object('new', 'app')],
    [object('__proto__', 'app')],
  ]) {
    const next = transactDocument(d, insertSubtree(records));
    expect(next.status).toBe('rejected');
    expect(next.document).toBe(d);
  }
});
it('creates an independent root with D0 and retains child ownership', () => {
  const next = transactDocument(
    recursiveFixture(),
    insertSubtree([object('new', null), object('child', 'new')]),
  );
  expect(next.status).toBe('accepted');
  expect(next.document.rootDepths.new).toBe(0);
  expect(next.document.layouts.new['0']).toEqual({ new: geometry });
  expect(
    indexHierarchy(next.document.objects).entries.get('child'),
  ).toMatchObject({
    root: 'new',
    generation: 1,
  });
});
it('targets deepest, then Z, area and ID; includes collapsed targets and excludes supplied subtree', () => {
  const d = recursiveFixture();
  d.layouts.app['1'].api = { ...geometry, x: 0, y: 0 };
  expect(eligibleParent(d, { x: 400, y: 20 })).toBe('api');
  expect(
    eligibleParent(d, { x: 400, y: 20 }, new Set(['api', 'endpoint'])),
  ).toBe('app');
  expect(eligibleParent(d, { x: 400, y: 20 }, new Set(['app']))).toBeNull();
  expect(eligibleParent(d, { x: 9999, y: 9999 })).toBeNull();
  d.rootDepths.app = 0;
  d.layouts.app['0'].app = { ...geometry, x: 900, z: 2 };
  expect(eligibleParent(d, { x: 900, y: 20 })).toBe('app');
  d.layouts.app['0'].app.z = 0;
  d.layouts.app['0'].app.width = 200;
  expect(eligibleParent(d, { x: 900, y: 20 })).toBe('payments');
  d.layouts.app['0'].app.width = 100;
  expect(eligibleParent(d, { x: 900, y: 20 })).toBe('app');
});
