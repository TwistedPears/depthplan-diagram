import { act, renderHook } from '@testing-library/react';
import { recursiveFixture, geometry } from './recursiveFixtures';
import {
  alignObjects,
  stackObjects,
  stackSelection,
  type AlignmentAction,
} from '../shared/recursiveArrangement';
import { activeWorldGeometry } from '../shared/recursiveHierarchy';
import { geometryBounds, unionBounds } from '../shared/recursiveCamera';
import { transactDocument } from '../shared/documentTransactions';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveScene } from '../shared/recursiveScene';

function fixture() {
  const d = recursiveFixture();
  d.rootDepths.app = 2;
  d.layouts.app[2].app.rotation = 37;
  d.layouts.app[2].app.width = 180;
  d.layouts.app[2].api.rotation = 29;
  d.layouts.app[2].api.width = 90;
  d.layouts.app[2].api.y = 180;
  d.objects.third = { ...d.objects.payments, id: 'third', name: 'Third' };
  d.rootDepths.third = 0;
  d.layouts.third = {
    0: { third: { ...geometry, x: 650, y: 300, width: 210, height: 45 } },
  };
  d.connections.link = {
    id: 'link',
    ownerId: null,
    z: 0,
    kind: 'arrow',
    start: { kind: 'object', objectId: 'app', side: 'right', offset: 0.5 },
    end: { kind: 'object', objectId: 'payments', side: 'left', offset: 0.5 },
  };
  return d;
}
const ids = ['api', 'payments', 'third'];
it.each<AlignmentAction>([
  'align-left',
  'align-center',
  'align-right',
  'align-top',
  'align-middle',
  'align-bottom',
])(
  '%s uses rotated world bounds across parents without changing ownership',
  (action) => {
    const d = fixture();
    const before = activeWorldGeometry(d);
    const union = unionBounds(
      ids.map((id) => geometryBounds(before.get(id)!)),
    )!;
    const changed = transactDocument(d, alignObjects(ids, action));
    expect(changed.status).toBe('accepted');
    const world = activeWorldGeometry(changed.document);
    const horizontal = ['align-left', 'align-center', 'align-right'].includes(
      action,
    );
    const axis = horizontal ? 'x' : 'y',
      dimension = horizontal ? 'width' : 'height';
    const ratio = ['align-left', 'align-top'].includes(action)
      ? 0
      : ['align-right', 'align-bottom'].includes(action)
        ? 1
        : 0.5;
    for (const id of ids) {
      const bounds = geometryBounds(world.get(id)!);
      expect(bounds[axis] + bounds[dimension] * ratio).toBeCloseTo(
        union[axis] + union[dimension] * ratio,
      );
      expect(world.get(id)!.rotation).toBe(before.get(id)!.rotation);
    }
    expect(changed.document.objects).toEqual(d.objects);
    expect(changed.document.connections).toEqual(d.connections);
    expect(changed.document.layouts.app[1]).toEqual(d.layouts.app[1]);
    expect(changed.document.layouts.app[2].endpoint).toEqual(
      d.layouts.app[2].endpoint,
    );
    expect(
      transactDocument(changed.document, alignObjects(ids, action)).status,
    ).toBe('noop');
  },
);
it.each<AlignmentAction>(['distribute-horizontal', 'distribute-vertical'])(
  '%s produces equal edge gaps including overlap',
  (action) => {
    const d = fixture();
    const changed = transactDocument(d, alignObjects(ids, action));
    expect(changed.status).toBe('accepted');
    const axis = action.endsWith('horizontal') ? 'x' : 'y',
      dimension = axis === 'x' ? 'width' : 'height';
    const before = ids.map((id) =>
      geometryBounds(activeWorldGeometry(d).get(id)!),
    );
    const boxes = ids
      .map((id) =>
        geometryBounds(activeWorldGeometry(changed.document).get(id)!),
      )
      .sort((a, b) => a[axis] - b[axis]);
    expect(boxes[1][axis] - boxes[0][axis] - boxes[0][dimension]).toBeCloseTo(
      boxes[2][axis] - boxes[1][axis] - boxes[1][dimension],
    );
    expect(unionBounds(boxes)![axis]).toBeCloseTo(unionBounds(before)![axis]);
    expect(unionBounds(boxes)![dimension]).toBeCloseTo(
      unionBounds(before)![dimension],
    );
  },
);
it('matches the first effective selection, carries descendants once, and has atomic history', () => {
  const d = fixture();
  const { result } = renderHook(() => useDocumentState(d));
  act(() =>
    result.current.transact(
      alignObjects(['endpoint', 'payments', 'app'], 'make-same-width'),
    ),
  );
  const changed = result.current.result!.document;
  expect(changed.layouts.app[2].app.width).toBe(
    d.layouts.payments[0].payments.width,
  );
  expect(changed.layouts.app[2].api).toEqual(d.layouts.app[2].api);
  expect(changed.layouts.app[2].endpoint).toEqual(d.layouts.app[2].endpoint);
  expect(changed.layouts.app[2].app.x).toBe(d.layouts.app[2].app.x);
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(d);
  act(() => result.current.redo());
  expect(result.current.document).toEqual(changed);
  expect(
    transactDocument(d, alignObjects(['api', 'endpoint'], 'align-left')).status,
  ).toBe('noop');
  expect(
    transactDocument(d, alignObjects(['api', 'link'], 'align-left')).status,
  ).toBe('rejected');
});
it.each([
  'bring-to-front',
  'bring-forward',
  'send-to-back',
  'send-backward',
] as const)(
  '%s stacks frames and groups within each scope with stable ties and no-op extremes',
  (action) => {
    const d = fixture();
    // This case isolates object-only ordering; mixed ordering is covered below.
    delete d.connections.link;
    d.objects.app.type = 'frame';
    d.layouts.app[2].app.z = -4;
    d.layouts.payments[0].payments.z = -4;
    d.layouts.third[0].third.z = -4;
    const front = action.startsWith('bring');
    const selected = front
      ? ['app', 'payments', 'api']
      : ['payments', 'third', 'api'];
    const changed = transactDocument(d, stackObjects(selected, action));
    expect(changed.status).toBe('accepted');
    const world = activeWorldGeometry(changed.document);
    const order = ['app', 'payments', 'third'].sort(
      (a, b) => world.get(a)!.z - world.get(b)!.z,
    );
    expect(order).toEqual(
      front ? ['third', 'app', 'payments'] : ['payments', 'third', 'app'],
    );
    expect(changed.document.layouts.app[2].api).toEqual(d.layouts.app[2].api);
    expect(changed.document.layouts.app[1]).toEqual(d.layouts.app[1]);
    expect(changed.document.objects).toEqual(d.objects);
    expect(
      transactDocument(changed.document, stackObjects(selected, action)).status,
    ).toBe('noop');
  },
);

it.each([
  [
    'bring-to-front',
    ['connection-link', 'object-payments'],
    ['object-app', 'object-third', 'connection-link', 'object-payments'],
  ],
  [
    'bring-forward',
    ['connection-link', 'object-payments'],
    ['object-app', 'connection-link', 'object-third', 'object-payments'],
  ],
  [
    'send-to-back',
    ['object-app', 'object-third'],
    ['object-app', 'object-third', 'connection-link', 'object-payments'],
  ],
  [
    'send-backward',
    ['object-app', 'object-third'],
    ['object-app', 'connection-link', 'object-third', 'object-payments'],
  ],
] as const)(
  '%s moves a mixed selection through the shared sibling stack',
  (action, selection, expected) => {
    const d = fixture();
    const { result } = renderHook(() => useDocumentState(d));
    act(() => result.current.transact(stackSelection([...selection], action)));
    const changed = result.current.document!;
    expect(
      recursiveScene(changed)
        .paintOrder.get(null)!
        .map((item) => `${item.kind}-${item.id}`),
    ).toEqual(expected);
    expect(changed.connections.link).toEqual({
      ...d.connections.link,
      z: expected.indexOf('connection-link'),
    });
    expect(changed.objects).toEqual(d.objects);
    expect(changed.layouts.app[1]).toEqual(d.layouts.app[1]);
    expect(changed.layouts.app[2].api).toEqual(d.layouts.app[2].api);
    expect(result.current.past).toHaveLength(1);
    act(() => result.current.undo());
    expect(result.current.document).toEqual(d);
    act(() => result.current.redo());
    expect(result.current.document).toEqual(changed);
  },
);

it('stacks connections in independent scopes, keeps attachments, and rejects hidden or stale selections atomically', () => {
  const d = fixture();
  d.connections.internal = {
    ...d.connections.link,
    id: 'internal',
    ownerId: 'app',
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'object', objectId: 'api', side: 'left', offset: 0.5 },
  };
  const selected = ['connection-link', 'connection-internal'];
  const changed = transactDocument(
    d,
    stackSelection(selected, 'bring-to-front'),
  );
  expect(changed.status).toBe('accepted');
  for (const scope of [null, 'app'])
    expect(
      recursiveScene(changed.document).paintOrder.get(scope)!.at(-1)!.kind,
    ).toBe('connection');
  expect(changed.document.connections.internal).toEqual({
    ...d.connections.internal,
    z: 1,
  });
  expect(changed.document.layouts.app[1]).toEqual(d.layouts.app[1]);
  expect(
    transactDocument(
      changed.document,
      stackSelection(selected, 'bring-to-front'),
    ).status,
  ).toBe('noop');
  expect(
    transactDocument(
      d,
      stackSelection(
        ['connection-link', 'connection-missing'],
        'bring-to-front',
      ),
    ).document,
  ).toBe(d);
  d.rootDepths.app = 0;
  for (const id of ['object-api', 'connection-internal'])
    expect(
      transactDocument(d, stackSelection([id], 'bring-to-front')).status,
    ).toBe('rejected');
});

it('lets an object-only automation action cross a connection, with no history at the back boundary', () => {
  const d = fixture();
  const changed = transactDocument(d, stackObjects(['app'], 'send-to-back'));
  expect(changed.status).toBe('accepted');
  expect(
    recursiveScene(changed.document)
      .paintOrder.get(null)!
      .map(({ id }) => id),
  ).toEqual(['app', 'link', 'payments', 'third']);
  expect(
    transactDocument(changed.document, stackObjects(['app'], 'send-backward'))
      .status,
  ).toBe('noop');
});
