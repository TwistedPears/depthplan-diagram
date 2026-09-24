import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { recursiveFixture } from './recursiveFixtures';
import {
  moveSubtree,
  moveSelection,
  previewGeometry,
  topmostObjects,
  resizeGeometry,
} from '../shared/recursiveMovement';
import { transactDocument } from '../shared/documentTransactions';
import {
  activeWorldGeometry,
  toWorldGeometry,
} from '../shared/recursiveHierarchy';
import { setChildrenExpanded } from '../shared/recursiveLayouts';
import type { Geometry } from '../shared/recursiveDocument';

const handles = [-1, 0, 1].flatMap((x) =>
  [-1, 0, 1].filter((y) => x || y).map((y) => ({ x, y })),
);
const handlePoint = (g: Geometry, handle: { x: number; y: number }) =>
  toWorldGeometry(
    { ...g, x: (handle.x * g.width) / 2, y: (handle.y * g.height) / 2 },
    g,
  );

it.each(
  [0, 37, 90].flatMap((rotation) =>
    handles.map((handle) => ({ rotation, ...handle })),
  ),
)(
  'anchors the opposite handle for ($x, $y) at $rotation degrees, including minimum size',
  ({ x, y, rotation }) => {
    const g = { x: 300, y: 200, width: 100, height: 60, rotation, z: 4 };
    const opposite = { x: -x, y: -y };
    const anchor = handlePoint(g, opposite);
    for (const factor of [1, -100]) {
      const angle = (rotation * Math.PI) / 180;
      const dx = x * 20 * factor;
      const dy = y * 12 * factor;
      const delta = {
        x: dx * Math.cos(angle) - dy * Math.sin(angle),
        y: dx * Math.sin(angle) + dy * Math.cos(angle),
      };
      const resized = resizeGeometry(g, { x, y }, delta);
      const fixed = handlePoint(resized, opposite);
      expect(fixed.x).toBeCloseTo(anchor.x);
      expect(fixed.y).toBeCloseTo(anchor.y);
      expect(resized.width).toBeCloseTo(x ? (factor > 0 ? 120 : 0.01) : 100);
      expect(resized.height).toBeCloseTo(y ? (factor > 0 ? 72 : 0.01) : 60);
      expect(resized.rotation).toBe(rotation);
      expect(resized.z).toBe(4);
      if (factor > 0) {
        const before = handlePoint(g, { x, y });
        const after = handlePoint(resized, { x, y });
        expect(after.x).toBeCloseTo(before.x + delta.x);
        expect(after.y).toBeCloseTo(before.y + delta.y);
      }
    }
  },
);

it('previews and commits anchored resizing under rotated ancestors without moving descendants or inactive layouts', () => {
  const d = recursiveFixture();
  d.rootDepths.app = 2;
  d.layouts.app[2].app.rotation = 37;
  d.layouts.app[2].api.rotation = 23;
  const world = activeWorldGeometry(d);
  const original = JSON.stringify(d);
  const resized = resizeGeometry(
    world.get('api')!,
    { x: 1, y: 1 },
    { x: 40, y: 30 },
  );
  const patches = new Map([
    ['api', resized],
    ['endpoint', world.get('endpoint')!],
  ]);
  const preview = previewGeometry(d, patches);
  const after = activeWorldGeometry(preview);
  for (const id of ['app', 'endpoint', 'payments']) {
    expect(after.get(id)!.x).toBeCloseTo(world.get(id)!.x);
    expect(after.get(id)!.y).toBeCloseTo(world.get(id)!.y);
    expect(after.get(id)!.rotation).toBeCloseTo(world.get(id)!.rotation);
  }
  expect(after.get('api')!.x).toBeCloseTo(resized.x);
  expect(after.get('api')!.y).toBeCloseTo(resized.y);
  expect(preview.layouts.app[0]).toBe(d.layouts.app[0]);
  expect(preview.layouts.app[1]).toBe(d.layouts.app[1]);
  expect(preview.objects).toBe(d.objects);
  expect(JSON.stringify(d)).toBe(original);
  const { result } = renderHook(() => useDocumentState(d));
  act(() =>
    result.current.transact((draft) => {
      draft.layouts = previewGeometry(draft, patches).layouts;
    }),
  );
  expect(result.current.result!.status).toBe('accepted');
  expect(result.current.document).toMatchObject({ layouts: preview.layouts });
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(d);
  act(() => result.current.redo());
  expect(result.current.document).toMatchObject({ layouts: preview.layouts });
});

it('adopts into a collapsed root, reveals the child and preserves its dropped world pose atomically', () => {
  const d = recursiveFixture();
  d.rootDepths.app = 2;
  d.layouts.payments[0].payments.rotation = 37;
  const { result } = renderHook(() => useDocumentState(d));
  act(() =>
    result.current.transact(moveSubtree('api', 'payments', { x: 875, y: 150 })),
  );
  const moved = result.current.result!;
  expect(moved.status).toBe('accepted');
  expect(moved.document.objects.api.parentId).toBe('payments');
  expect(moved.document.rootDepths.payments).toBe(1);
  const world = activeWorldGeometry(moved.document).get('api')!;
  expect(world.x).toBeCloseTo(875);
  expect(world.y).toBeCloseTo(150);
  expect(moved.document.layouts.payments[2].endpoint).toEqual(
    d.layouts.app[2].endpoint,
  );
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(d);
});
it('promotes a subtree and preserves the visible internal arrangement', () => {
  const d = recursiveFixture();
  d.rootDepths.app = 2;
  const result = transactDocument(
    d,
    moveSubtree('api', null, { x: -100, y: 700 }),
  );
  expect(result.status).toBe('accepted');
  expect(result.document.rootDepths.api).toBe(1);
  expect(result.document.layouts.api[1].endpoint).toEqual(
    d.layouts.app[2].endpoint,
  );
  expect(activeWorldGeometry(result.document).get('api')).toMatchObject({
    x: -100,
    y: 700,
  });
});
it('same-parent movement changes only current geometry and rejects cycles/hidden targets', () => {
  const d = recursiveFixture();
  const result = transactDocument(
    d,
    moveSubtree('api', 'app', { x: 300, y: 300 }),
  );
  expect(result.status).toBe('accepted');
  expect(result.document.layouts.app[2]).toEqual(d.layouts.app[2]);
  expect(result.document.extensions).toBeUndefined();
  for (const target of ['endpoint', 'missing'])
    expect(
      transactDocument(d, moveSubtree('api', target, { x: 0, y: 0 })).document,
    ).toBe(d);
  d.connections.link = {
    id: 'link',
    ownerId: null,
    kind: 'line',
    z: 0,
    start: { kind: 'object', objectId: 'endpoint', side: 'left', offset: 0 },
    end: { kind: 'free', x: 0, y: 0 },
  };
  const rejected = transactDocument(
    d,
    moveSubtree('api', null, { x: 100, y: 100 }),
  );
  expect(rejected.status).toBe('accepted');
  expect(rejected.document.connections.link.ownerId).toBe('api');
});

it('moves connected roots and ancestors together once, preserving inactive geometry', () => {
  const d = recursiveFixture();
  d.rootDepths.app = 2;
  d.layouts.app[2].app.rotation = 90;
  d.connections.link = {
    id: 'link',
    ownerId: null,
    z: 0,
    kind: 'arrow',
    start: { kind: 'object', objectId: 'app', side: 'right', offset: 0.5 },
    end: { kind: 'object', objectId: 'payments', side: 'left', offset: 0.5 },
  };
  const before = activeWorldGeometry(d);
  expect(topmostObjects(d, ['endpoint', 'app', 'api', 'payments'])).toEqual([
    'app',
    'payments',
  ]);
  const { result } = renderHook(() => useDocumentState(d));
  act(() =>
    result.current.transact(
      moveSelection(
        ['endpoint', 'app', 'api', 'payments'],
        {
          x: 30.125,
          y: 40.75,
        },
        new Map(),
      ),
    ),
  );
  const moved = result.current.result!;
  expect(moved.status).toBe('accepted');
  const world = activeWorldGeometry(moved.document);
  for (const [id, g] of before) {
    expect(world.get(id)!.x).toBeCloseTo(g.x + 30.125);
    expect(world.get(id)!.y).toBeCloseTo(g.y + 40.75);
  }
  expect(moved.document.layouts.app[0]).toEqual(d.layouts.app[0]);
  expect(moved.document.layouts.app[1]).toEqual(d.layouts.app[1]);
  expect(moved.document.objects).toEqual(d.objects);
  expect(moved.document.connections).toEqual(d.connections);
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(d);
});
it('repairs a connected subtree when a group changes parent', () => {
  const d = recursiveFixture();
  d.connections.link = {
    id: 'link',
    ownerId: 'app',
    z: 0,
    kind: 'line',
    start: { kind: 'object', objectId: 'api', side: 'left', offset: 0.5 },
    end: { kind: 'free', x: 10, y: 10 },
  };
  const moved = transactDocument(
    d,
    moveSelection(
      ['payments', 'api'],
      { x: 1000, y: 500 },
      new Map([['api', null]]),
    ),
  );
  expect(moved.status).toBe('accepted');
  expect(moved.document.connections.link.ownerId).toBeNull();
  expect(moved.document.connections.link.end).toEqual({
    kind: 'free',
    x: 410,
    y: 30,
  });
});
it('previews connected nested movement and centered resize without mutating source content/layouts', () => {
  const d = recursiveFixture();
  d.rootDepths.app = 2;
  d.layouts.app[2].app.rotation = 90;
  const original = JSON.stringify(d),
    world = activeWorldGeometry(d),
    api = world.get('api')!;
  const preview = previewGeometry(
    d,
    new Map([
      ['api', { x: api.x + 20, y: api.y - 30, width: 200, height: 150 }],
    ]),
  );
  expect(JSON.stringify(d)).toBe(original);
  expect(preview.objects).toBe(d.objects);
  expect(preview.layouts.app[1]).toBe(d.layouts.app[1]);
  expect(preview.layouts.app[2].endpoint).toBe(d.layouts.app[2].endpoint);
  const moved = activeWorldGeometry(preview).get('api')!;
  expect(moved.x).toBeCloseTo(api.x + 20);
  expect(moved.y).toBeCloseTo(api.y - 30);
  expect(moved).toMatchObject({ width: 200, height: 150 });
  const resize = previewGeometry(
    d,
    new Map([['app', { width: 1200, height: 800 }]]),
  );
  expect(activeWorldGeometry(resize).get('api')).toEqual(world.get('api'));
  expect(activeWorldGeometry(resize).get('endpoint')).toEqual(
    world.get('endpoint'),
  );
});

it('adopts a group into a collapsed parent in one transaction without adopting its own movers', () => {
  const d = recursiveFixture();
  d.objects.other = { ...d.objects.api, id: 'other', name: 'Other' };
  for (const depth of [1, 2])
    d.layouts.app[depth].other = { ...d.objects.other.geometry, x: -20, y: 25 };
  const before = activeWorldGeometry(d);
  const { result } = renderHook(() => useDocumentState(d));
  act(() =>
    result.current.transact(
      moveSelection(
        ['api', 'other'],
        { x: 500, y: 0 },
        new Map([
          ['api', 'payments'],
          ['other', 'payments'],
        ]),
      ),
    ),
  );
  const moved = result.current.result!;
  expect(moved.status).toBe('accepted');
  // Inspect the saved destination layout before disclosure adds spacing.
  const destination = moved.document.layouts.payments[1];
  for (const id of ['api', 'other']) {
    const g = toWorldGeometry(destination[id], destination.payments);
    expect(g.x).toBeCloseTo(before.get(id)!.x + 500);
    expect(g.y).toBeCloseTo(before.get(id)!.y);
  }
  const world = activeWorldGeometry(
    transactDocument(moved.document, setChildrenExpanded('payments', true))
      .document,
  );
  for (const id of ['api', 'other']) {
    expect(moved.document.objects[id].parentId).toBe('payments');
    expect(world.get(id)!.x).toBeCloseTo(before.get(id)!.x + 500);
    expect(world.get(id)!.width).toBe(before.get(id)!.width);
  }
  expect(
    Math.abs(world.get('api')!.y - world.get('other')!.y),
  ).toBeGreaterThanOrEqual(60);
  expect(moved.document.rootDepths.payments).toBe(0);
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(d);
});
