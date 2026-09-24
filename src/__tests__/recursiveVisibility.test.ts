import { recursiveFixture, geometry } from './recursiveFixtures';
import {
  rootDepthBounds,
  requestedRootDepth,
  recursiveVisibility,
} from '../shared/recursiveVisibility';
import { transactDocument } from '../shared/documentTransactions';
import { insertSubtree } from '../shared/recursiveOwnership';
import { deleteSelection } from '../shared/recursiveDeletion';

function uneven() {
  const d = recursiveFixture();
  const extra = [
    { ...d.objects.api, id: 'cache', parentId: 'app' },
    { ...d.objects.endpoint, id: 'handler', parentId: 'endpoint' },
    { ...d.objects.api, id: 'ledger', parentId: 'payments' },
  ];
  const result = transactDocument(d, insertSubtree([extra[0]]));
  const deeper = transactDocument(result.document, insertSubtree([extra[1]]));
  return transactDocument(deeper.document, insertSubtree([extra[2]])).document;
}
it.each([0, 1, 2, 3])(
  'reveals every branch through D%i without placeholder generations',
  (depth) => {
    const d = uneven();
    d.rootDepths.app = depth;
    const { visible, expanded } = recursiveVisibility(d);
    const expected = [
      'app',
      'payments',
      ...(depth >= 1 ? ['api', 'cache'] : []),
      ...(depth >= 2 ? ['endpoint'] : []),
      ...(depth >= 3 ? ['handler'] : []),
    ];
    expect([...visible].sort()).toEqual(expected.sort());
    expect(expanded.has('cache')).toBe(false);
    expect(expanded.has('handler')).toBe(false);
    expect(expanded.has('api')).toBe(depth > 1);
  },
);
it('each root controls its own branches and reveal-all captures only the current maximum', () => {
  const d = uneven();
  d.rootDepths.app = requestedRootDepth(d, 'app', 'all');
  expect(d.rootDepths).toEqual({ app: 3, payments: 0 });
  expect(requestedRootDepth(d, 'payments', 'all')).toBe(1);
  expect(requestedRootDepth(d, 'app', 999)).toBe(3);
  expect(requestedRootDepth(d, 'app', -1)).toBe(0);
  expect(() => requestedRootDepth(d, 'api', 1)).toThrow('Not a root');
  expect(() => requestedRootDepth(d, 'app', 1.5)).toThrow('integer');
  d.objects.later = { ...d.objects.handler, id: 'later', parentId: 'handler' };
  expect(rootDepthBounds(d).find((r) => r.id === 'app')?.maximum).toBe(4);
  expect(d.rootDepths.app).toBe(3);
});
it('clamps after shrink and keeps inactive saved geometry', () => {
  const d = recursiveFixture();
  d.rootDepths.app = 2;
  const saved = { ...d.layouts.app['2'].api, z: 9 };
  d.layouts.app['2'].api = saved;
  const next = transactDocument(d, deleteSelection(['endpoint']));
  expect(next.status).toBe('accepted');
  expect(next.document.rootDepths.app).toBe(1);
  expect(next.document.layouts.app['2'].api).toEqual(saved);
});
it('empty and leaf roots have no fabricated generations; reparenting changes bounds', () => {
  const d = recursiveFixture();
  expect(rootDepthBounds(d).find((r) => r.id === 'payments')).toEqual({
    id: 'payments',
    selected: 0,
    maximum: 0,
  });
  d.objects.endpoint.parentId = 'payments';
  expect(rootDepthBounds(d)).toEqual([
    { id: 'app', selected: 1, maximum: 1 },
    { id: 'payments', selected: 0, maximum: 1 },
  ]);
  d.layouts.payments['1'] = { payments: geometry, endpoint: geometry };
  d.rootDepths.payments = 1;
  expect(recursiveVisibility(d).visible.has('endpoint')).toBe(true);
  expect(
    recursiveVisibility({ ...d, objects: {}, layouts: {}, rootDepths: {} })
      .visible.size,
  ).toBe(0);
});
