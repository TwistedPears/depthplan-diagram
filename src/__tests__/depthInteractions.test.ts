import { recursiveFixture, geometry } from './recursiveFixtures';
import {
  transactDocument,
  type DocumentEdit,
} from '../shared/documentTransactions';
import { containsShape, eligibleParent } from '../shared/recursiveOwnership';
import {
  setChildrenExpanded,
  selectRootDepth,
} from '../shared/recursiveLayouts';
import { recursiveScene } from '../shared/recursiveScene';
import { recursiveVisibility } from '../shared/recursiveVisibility';
import { toWorldGeometry } from '../shared/recursiveHierarchy';
import { moveSelection } from '../shared/recursiveMovement';
import { editNamedView } from '../shared/namedViews';
import { createShape } from '../shared/recursiveCreation';
import { resolveExportSelection } from '../shared/recursiveExportScope';
import type { RecursiveDocument } from '../shared/recursiveDocument';

function edit(document: RecursiveDocument, change: DocumentEdit) {
  const result = transactDocument(document, change);
  expect(result.status).not.toBe('rejected');
  return result.document;
}
function branches() {
  const document = recursiveFixture();
  document.objects.cache = {
    ...document.objects.api,
    id: 'cache',
    geometry: { ...geometry, x: -30 },
  };
  document.objects.entry = {
    ...document.objects.endpoint,
    id: 'entry',
    parentId: 'cache',
  };
  for (const depth of [1, 2])
    document.layouts.app[depth].cache = { ...document.objects.cache.geometry };
  document.layouts.app[2].entry = { ...geometry };
  return document;
}

it.each(['ellipse', 'diamond', 'rectangle', 'frame'] as const)(
  'uses the rotated %s silhouette for parenting',
  (type) => {
    const object = { ...recursiveFixture().objects.app, type };
    const world = { ...geometry, rotation: 37, width: 200, height: 100 };
    const inside = toWorldGeometry({ ...world, x: 20, y: 10 }, world);
    const corner = toWorldGeometry({ ...world, x: 90, y: 45 }, world);
    expect(containsShape(object, world, inside)).toBe(true);
    expect(containsShape(object, world, corner)).toBe(
      type === 'rectangle' || type === 'frame',
    );
    expect(
      containsShape(
        object,
        world,
        toWorldGeometry({ ...world, x: 104, y: 0 }, world),
      ),
    ).toBe(false);
    expect(
      containsShape(
        object,
        world,
        toWorldGeometry({ ...world, x: 104, y: 0 }, world),
        8,
      ),
    ).toBe(true);
  },
);

it('excludes rounded corners and folded descendants from drop candidates', () => {
  const document = recursiveFixture();
  document.objects.app.style = { cornerRadius: 20 };
  const world = document.layouts.app[1].app;
  expect(containsShape(document.objects.app, world, { x: 449, y: 49 })).toBe(
    false,
  );
  const collapsed = edit(document, setChildrenExpanded('app', false));
  expect(eligibleParent(collapsed, { x: 410, y: 40 })).toBe('app');
});

it('makes room for one branch while preserving other folds, and root depth resets local folds', () => {
  const document = branches();
  const before = recursiveScene(document);
  const expanded = edit(document, setChildrenExpanded('api', true));
  const scene = recursiveScene(expanded);
  expect([...scene.world.keys()].sort()).toEqual(
    ['app', 'api', 'endpoint', 'cache', 'payments'].sort(),
  );
  expect(scene.world.get('app')!.width).toBeGreaterThan(
    before.world.get('app')!.width,
  );
  expect(scene.world.get('payments')).toEqual(before.world.get('payments'));
  for (const [id, g] of before.world)
    expect(scene.world.get(id)).toMatchObject({ z: g.z, rotation: g.rotation });
  expect(scene.expanded.has('cache')).toBe(false);
  expect(
    eligibleParent(expanded, scene.world.get('cache')!, new Set(['app'])),
  ).toBeNull();
  const both = edit(expanded, setChildrenExpanded('cache', true));
  expect(recursiveScene(both).world.has('entry')).toBe(true);
  const hidden = edit(both, setChildrenExpanded('api', false));
  expect(recursiveScene(hidden).world.has('endpoint')).toBe(false);
  expect(recursiveScene(hidden).world.has('entry')).toBe(true);
  expect(
    resolveExportSelection(hidden, ['object-app']).objects.has('endpoint'),
  ).toBe(false);
  const global = edit(hidden, selectRootDepth('app', 'all'));
  expect(recursiveVisibility(global).expanded.has('api')).toBe(true);
  expect(recursiveVisibility(global).expanded.has('cache')).toBe(true);
});

it('moves only with the parent changes explicitly armed by the gesture', () => {
  const document = recursiveFixture();
  const delta = { x: 490, y: -20 };
  const crossing = edit(document, moveSelection(['api'], delta, new Map()));
  expect(crossing.objects.api.parentId).toBe('app');
  expect(recursiveScene(crossing).world.get('api')).toMatchObject({
    x: 900,
    y: 20,
  });
  const dropped = edit(
    document,
    moveSelection(['api'], delta, new Map([['api', 'payments']])),
  );
  expect(dropped.objects.api.parentId).toBe('payments');
  expect(dropped.rootDepths.payments).toBe(0);
  expect(recursiveScene(dropped).world.has('api')).toBe(false);
  const revealed = edit(dropped, setChildrenExpanded('payments', true));
  expect(recursiveScene(revealed).world.get('api')).toMatchObject({
    x: 900,
    y: 20,
  });
  expect(recursiveScene(revealed).world.has('endpoint')).toBe(false);
  const detached = edit(
    document,
    moveSelection(['api'], { x: -300, y: 300 }, new Map([['api', null]])),
  );
  expect(detached.objects.api.parentId).toBeNull();
  expect(recursiveScene(detached).world.get('api')).toMatchObject({
    x: 110,
    y: 340,
  });
});

it('preserves an already expanded destination while adopting a group', () => {
  const document = branches();
  const moved = edit(
    document,
    moveSelection(
      ['api', 'cache'],
      { x: 490, y: 0 },
      new Map([
        ['api', 'payments'],
        ['cache', 'payments'],
      ]),
    ),
  );
  const open = edit(moved, setChildrenExpanded('payments', true));
  const dropped = edit(
    open,
    moveSelection(['app'], { x: 490, y: 0 }, new Map([['app', 'payments']])),
  );
  expect(recursiveScene(dropped).world.has('app')).toBe(true);
  expect(recursiveScene(dropped).world.has('api')).toBe(true);
  expect(recursiveScene(dropped).world.has('cache')).toBe(true);
});

it('saves local disclosure in bookmarks and restores it, including old depth-only bookmarks', () => {
  let document = edit(branches(), selectRootDepth('app', 'all'));
  document = edit(
    document,
    editNamedView({ type: 'create', id: 'all', name: 'All' }),
  );
  document = edit(document, setChildrenExpanded('api', false));
  document = edit(
    document,
    editNamedView({ type: 'create', id: 'local', name: 'Local' }),
  );
  document = edit(document, editNamedView({ type: 'apply', id: 'all' }));
  expect(recursiveScene(document).world.has('endpoint')).toBe(true);
  document = edit(document, editNamedView({ type: 'apply', id: 'local' }));
  expect(recursiveScene(document).world.has('endpoint')).toBe(false);
  expect(recursiveScene(document).world.has('entry')).toBe(true);
  document = edit(document, setChildrenExpanded('cache', false));
  document = edit(document, editNamedView({ type: 'update', id: 'local' }));
  document = edit(document, editNamedView({ type: 'apply', id: 'all' }));
  document = edit(document, editNamedView({ type: 'apply', id: 'local' }));
  expect(recursiveScene(document).world.has('entry')).toBe(false);
});

it('creating a child reveals its own branch and preserves unrelated folds', () => {
  let document = edit(branches(), selectRootDepth('app', 'all'));
  document = edit(document, setChildrenExpanded('cache', false));
  document = edit(
    document,
    createShape('new', 'ellipse', { ...geometry, x: 500, y: 60 }, 'api'),
  );
  expect(recursiveScene(document).world.has('new')).toBe(true);
  expect(recursiveScene(document).world.has('entry')).toBe(false);
});

it.each(['ellipse', 'diamond'] as const)(
  'keeps %s attachments on the same outline when its children are revealed',
  (type) => {
    const document = recursiveFixture();
    document.objects.app.type = type;
    document.connections.link = {
      id: 'link',
      kind: 'line',
      z: 0,
      ownerId: null,
      start: { kind: 'object', objectId: 'app', side: 'top', offset: 0 },
      end: { kind: 'object', objectId: 'payments', side: 'left', offset: 0.5 },
    };
    const open = recursiveScene(document).connections.get(null)![0].points;
    const closed = recursiveScene(
      edit(document, setChildrenExpanded('app', false)),
    ).connections.get(null)![0].points;
    expect(closed).toEqual(open);
  },
);
