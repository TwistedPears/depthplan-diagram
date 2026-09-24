import { recursiveFixture, geometry } from './recursiveFixtures';
import {
  transactDocument,
  editActiveGeometry,
  editObject,
  type DocumentEdit,
} from '../shared/documentTransactions';
import {
  selectRootDepth,
  activeGeometry,
  editWorldGeometry,
} from '../shared/recursiveLayouts';
import { activeWorldGeometry } from '../shared/recursiveHierarchy';
import { type RecursiveDocument } from '../shared/recursiveDocument';

const apply = (d: RecursiveDocument, edit: DocumentEdit) => {
  const result = transactDocument(d, edit);
  if (result.status === 'rejected') throw new Error(result.error);
  return result.document;
};
it('repeated D0/D1/D2 switches restore all six fields and keep other roots independent', () => {
  let d = recursiveFixture();
  for (const depth of [0, 1, 2]) {
    d = apply(d, selectRootDepth('app', depth));
    d = apply(
      d,
      editActiveGeometry('app', {
        x: 100 + depth * 300,
        y: 200 + depth * 200,
        z: depth,
        width: 120 + depth * 250,
        height: 80 + depth * 200,
        rotation: depth * 15,
      }),
    );
  }
  const saved = JSON.parse(JSON.stringify(d.layouts));
  for (const depth of [0, 2, 1, 0, 1, 2, 0]) {
    d = apply(d, selectRootDepth('app', depth));
    expect(activeGeometry(d, 'app')).toEqual(saved.app[depth].app);
    expect(d.layouts).toEqual(saved);
    expect(d.rootDepths.payments).toBe(0);
  }
  expect(transactDocument(d, selectRootDepth('app', 0)).status).toBe('noop');
});
it('persists child/grandchild arrangements and shared content across JSON serialization', async () => {
  let d = apply(recursiveFixture(), selectRootDepth('app', 2));
  d = apply(d, (draft) => {
    editActiveGeometry('api', {
      x: -80,
      y: 45,
      z: 3,
      width: 260,
      height: 140,
      rotation: 30,
    })(draft);
    editActiveGeometry('endpoint', {
      x: 30,
      y: -20,
      z: 4,
      width: 70,
      height: 30,
      rotation: 15,
    })(draft);
    editObject('api', {
      name: 'Shared API',
      content: [{ type: 'paragraph', runs: [{ text: 'Every depth' }] }],
    })(draft);
  });
  d.layouts.app['9'] = {
    ...d.layouts.app['2'],
    api: { ...geometry, x: 999, z: 8 },
  };
  const reopened = JSON.parse(JSON.stringify(d));
  expect(reopened.formatVersion).toBe(2);
  expect(reopened.layouts).toEqual(d.layouts);
  expect(reopened.objects).toEqual(d.objects);
  const restored = apply(
    apply(reopened, selectRootDepth('app', 0)),
    selectRootDepth('app', 2),
  );
  expect(restored.layouts).toEqual(d.layouts);
  expect(activeGeometry(restored, 'endpoint')).toMatchObject({
    x: 30,
    y: -20,
    z: 4,
    rotation: 15,
  });
});
it('world edits respect rotated parents; resizing a parent neither scales nor adopts children', () => {
  let d = recursiveFixture();
  d.layouts.app['1'].app.rotation = 90;
  const localBefore = { ...activeGeometry(d, 'api') };
  const inactive = JSON.stringify(d.layouts.app['2']);
  d = apply(d, editWorldGeometry('app', { x: 500, width: 1000 }));
  expect(activeGeometry(d, 'api')).toEqual(localBefore);
  d = apply(d, editWorldGeometry('api', { x: 570, y: 130, rotation: 120 }));
  const world = activeWorldGeometry(d).get('api')!;
  expect(world.x).toBeCloseTo(570);
  expect(world.y).toBeCloseTo(130);
  expect(world.rotation).toBe(120);
  expect(JSON.stringify(d.layouts.app['2'])).toBe(inactive);
  expect(d.objects.api.parentId).toBe('app');
});
it('initializes missing first-use layouts atomically and rejects edits to hidden objects', () => {
  const d = recursiveFixture();
  delete d.layouts.app['2'];
  const next = transactDocument(d, selectRootDepth('app', 2));
  expect(next.status).toBe('accepted');
  expect(next.document.rootDepths.app).toBe(2);
  expect(next.document.layouts.app['2']).toEqual({
    ...d.layouts.app['1'],
    endpoint: d.objects.endpoint.geometry,
  });
  expect(d.layouts.app['2']).toBeUndefined();
  expect(
    transactDocument(d, editWorldGeometry('endpoint', { x: 0 })).status,
  ).toBe('rejected');
});

it('rejects an invalid compound hierarchy before resolving a geometry edit', () => {
  const d = recursiveFixture();
  const result = transactDocument(d, (draft) => {
    draft.objects.app.parentId = 'api';
    editActiveGeometry('api', { x: 0 })(draft);
  });
  expect(result.status).toBe('rejected');
  expect(result.document).toBe(d);
});
