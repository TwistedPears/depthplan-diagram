import { act, renderHook } from '@testing-library/react';
import { recursiveFixture } from './recursiveFixtures';
import {
  createInwardBridge,
  reattachInwardBridge,
} from '../shared/recursiveBridges';
import { createConnector } from '../shared/recursiveCreation';
import {
  editActiveGeometry,
  transactDocument,
} from '../shared/documentTransactions';
import { selectRootDepth } from '../shared/recursiveLayouts';
import { recursiveScene } from '../shared/recursiveScene';
import { validateRecursiveDocument } from '../shared/recursiveDocument';
import useDocumentState from '../renderer/hooks/useDocumentState';
const p = { x: 415, y: 40 };
function fixture() {
  const d = recursiveFixture();
  d.rootDepths.app = 2;
  // Existing documents may still contain named ports and inward bridges.
  d.objects.app.boundaryPoints = { outer: { side: 'left', offset: 0.3 } };
  d.objects.api.boundaryPoints = { inner: { side: 'right', offset: 0.5 } };
  return d;
}
const source = { objectId: 'app', pointId: 'outer' };
it('supports bridges between legacy named points and hides/restores routes by depth', () => {
  const d = fixture();
  createConnector(
    'outside',
    'arrow',
    { x: 900, y: 20 },
    p,
    'payments',
    source,
  )(d);
  createInwardBridge(
    'first',
    'arrow',
    source,
    { objectId: 'api', pointId: 'inner' },
    p,
  )(d);
  createInwardBridge(
    'second',
    'line',
    { objectId: 'api', pointId: 'inner' },
    'endpoint',
    p,
  )(d);
  createInwardBridge('parallel', 'line', source, 'api', p)(d);
  validateRecursiveDocument(d);
  expect(Object.keys(d.objects)).toHaveLength(4);
  expect(d.connections.first).toMatchObject({
    ownerId: 'app',
    start: { kind: 'boundary', ...source },
    end: { kind: 'boundary', objectId: 'api', pointId: 'inner' },
  });
  expect(d.connections.second.ownerId).toBe('api');
  expect(recursiveScene(d).connections.get('app')).toHaveLength(2);
  expect(recursiveScene(d).connections.get('api')).toHaveLength(1);
  const exact = JSON.stringify(d.connections);
  selectRootDepth('app', 0)(d);
  expect(recursiveScene(d).connections.has('app')).toBe(false);
  expect(recursiveScene(d).connections.get(null)).toHaveLength(1);
  selectRootDepth('app', 1)(d);
  expect(recursiveScene(d).connections.get('app')).toHaveLength(2);
  expect(recursiveScene(d).connections.has('api')).toBe(false);
  selectRootDepth('app', 2)(d);
  expect(JSON.stringify(d.connections)).toBe(exact);
  const reloaded = JSON.parse(JSON.stringify(d));
  validateRecursiveDocument(reloaded);
  expect(recursiveScene(reloaded).connections).toEqual(
    recursiveScene(d).connections,
  );
});
it.each([
  'payments',
  'endpoint',
  null,
  { objectId: 'api', pointId: 'missing' },
])('rejects an invalid or cross-scope target %p atomically', (target) => {
  const d = fixture(),
    before = JSON.stringify(d);
  expect(
    transactDocument(d, createInwardBridge('bad', 'line', source, target, p))
      .status,
  ).toBe('rejected');
  expect(JSON.stringify(d)).toBe(before);
});
it('requires revealed children, keeps root depth unchanged and rejects missing starting points', () => {
  const d = fixture();
  selectRootDepth('app', 0)(d);
  expect(
    transactDocument(d, createInwardBridge('hidden', 'arrow', source, 'api', p))
      .status,
  ).toBe('rejected');
  expect(d.rootDepths.app).toBe(0);
  selectRootDepth('app', 1)(d);
  expect(
    transactDocument(
      d,
      createInwardBridge(
        'missing',
        'arrow',
        { ...source, pointId: 'missing' },
        'api',
        p,
      ),
    ).status,
  ).toBe('rejected');
});
it('reattaches a legacy bridge with Undo/Redo and follows its moving parent', () => {
  const d = fixture();
  createConnector(
    'outside',
    'arrow',
    { x: 900, y: 20 },
    p,
    'payments',
    source,
  )(d);
  const outside = JSON.stringify(d.connections.outside),
    objects = Object.keys(d.objects);
  const hook = renderHook(() => useDocumentState(d));
  const apply = (edit: Parameters<typeof transactDocument>[1]) =>
    act(() => {
      hook.result.current.transact(edit);
    });
  apply(createInwardBridge('bridge', 'line', source, 'api', p));
  apply((draft) => {
    draft.connections.bridge.label = 'Inside';
    draft.connections.bridge.style = { stroke: '#00aabb', lineType: 'curved' };
  });
  apply(
    reattachInwardBridge('bridge', { objectId: 'api', pointId: 'inner' }, p),
  );
  const updated = hook.result.current.result!.document;
  expect(hook.result.current.past).toHaveLength(3);
  expect(updated.connections.bridge).toMatchObject({
    id: 'bridge',
    label: 'Inside',
    style: { stroke: '#00aabb', lineType: 'curved' },
    end: { kind: 'boundary', pointId: 'inner' },
  });
  expect(JSON.stringify(updated.connections.outside)).toBe(outside);
  act(() => hook.result.current.undo());
  expect(hook.result.current.document).toMatchObject({
    connections: { bridge: { end: { kind: 'object', objectId: 'api' } } },
  });
  act(() => hook.result.current.redo());
  const before = recursiveScene(updated);
  apply(editActiveGeometry('app', { width: 500, rotation: 30 }));
  const moved = hook.result.current.result!.document,
    after = recursiveScene(moved);
  expect(after.connections.get(null)).not.toEqual(before.connections.get(null));
  expect(after.connections.get('app')).not.toEqual(
    before.connections.get('app'),
  );
  expect(moved.connections).toEqual(updated.connections);
  expect(Object.keys(moved.objects)).toEqual(objects);
  expect(
    transactDocument(moved, reattachInwardBridge('bridge', 'payments', p))
      .status,
  ).toBe('rejected');
});
