import { act, renderHook } from '@testing-library/react';
import {
  createRecursiveDocument,
  type RecursiveDocument,
  type DiagramObject,
} from '../shared/recursiveDocument';
import {
  transactDocument,
  editActiveGeometry,
  editObject,
  type DocumentEdit,
} from '../shared/documentTransactions';
import {
  setChildrenExpanded,
  selectRootDepth,
  activeGeometry,
  revealObject,
} from '../shared/recursiveLayouts';
import { recursiveScene } from '../shared/recursiveScene';
import { geometryBounds } from '../shared/recursiveCamera';
import { containsShape } from '../shared/recursiveOwnership';
import { toWorldGeometry } from '../shared/recursiveHierarchy';
import { createShape } from '../shared/recursiveCreation';
import { deleteSelection } from '../shared/recursiveDeletion';
import { moveSelection } from '../shared/recursiveMovement';
import { editNamedView } from '../shared/namedViews';
import useDocumentState from '../renderer/hooks/useDocumentState';

function fixture() {
  const document = createRecursiveDocument(
    'arrangement',
    'Arrangement',
    '2026-09-23',
  );
  for (const [id, parentId, x, y] of [
    ['a', null, 0, 0],
    ['b', null, 150, 0],
    ['far', null, 3000, 0],
    ['a1', 'a', 0, 0],
    ['a2', 'a', 0, 0],
    ['b1', 'b', 0, 0],
    ['b2', 'b', 0, 0],
    ['deep', 'a1', 30, 0],
  ] as const) {
    const geometry = { x, y, width: 120, height: 80, z: 5, rotation: 0 };
    document.objects[id] = {
      id,
      parentId,
      geometry,
      type: 'rectangle',
      name: id,
      content: [],
    };
    if (parentId === null) {
      document.rootDepths[id] = 0;
      document.layouts[id] = {
        0: { [id]: { ...geometry } },
        1: { [id]: { ...geometry } },
        2: { [id]: { ...geometry } },
      };
    } else {
      const root = id === 'deep' ? 'a' : parentId;
      for (const depth of id === 'deep' ? [2] : [1, 2])
        document.layouts[root][depth][id] = { ...geometry };
    }
  }
  return document;
}
function edit(document: RecursiveDocument, change: DocumentEdit) {
  const result = transactDocument(document, change);
  if (result.status === 'rejected') throw new Error(result.error);
  return result.document;
}
function positions(document: RecursiveDocument) {
  return Object.fromEntries(
    [...recursiveScene(document).world].map(([id, { x, y, width, height }]) => [
      id,
      { x, y, width, height },
    ]),
  );
}
function separated(document: RecursiveDocument, a: string, b: string) {
  const world = recursiveScene(document).world;
  const left = geometryBounds(world.get(a)!);
  const right = geometryBounds(world.get(b)!);
  expect(
    left.x + left.width <= right.x ||
      right.x + right.width <= left.x ||
      left.y + left.height <= right.y ||
      right.y + right.height <= left.y,
  ).toBe(true);
}

it('grows physical parents, separates children and nearby roots, and restores without drift', () => {
  const original = fixture();
  let document = original;
  for (let i = 0; i < 5; i++) {
    document = edit(document, setChildrenExpanded('a', true));
    expect(activeGeometry(document, 'a').width).toBeGreaterThan(120);
    expect(activeGeometry(document, 'a').height).toBeGreaterThan(80);
    expect(activeGeometry(document, 'b').x).toBeGreaterThan(150);
    expect(activeGeometry(document, 'far')).toEqual(
      activeGeometry(original, 'far'),
    );
    separated(document, 'a1', 'a2');
    separated(document, 'a', 'b');
    expect(
      transactDocument(document, setChildrenExpanded('a', true)).status,
    ).toBe('noop');
    document = edit(document, setChildrenExpanded('a', false));
    expect(positions(document)).toEqual(positions(original));
  }
  expect(document.namedViews).toEqual(original.namedViews);
  expect(
    Object.keys((document.extensions!.expansionLayouts as any).states),
  ).toHaveLength(2);
});

it('saves manual edits in each state across reopening, while content, Z and rotation stay live', () => {
  let document = edit(fixture(), setChildrenExpanded('a', true));
  document = edit(document, (draft) => {
    editActiveGeometry('a', { x: -90, width: 560 })(draft);
    editActiveGeometry('a1', { y: 250 })(draft);
  });
  const expanded = positions(document);
  document = JSON.parse(JSON.stringify(document));
  document = edit(document, setChildrenExpanded('a', false));
  document = edit(document, (draft) => {
    editActiveGeometry('a', { x: -200, width: 180, z: 77, rotation: 15 })(
      draft,
    );
    editObject('a', { name: 'Edited name' })(draft);
  });
  const collapsed = positions(document);
  document = edit(document, setChildrenExpanded('a', true));
  expect(activeGeometry(document, 'a')).toMatchObject({
    ...expanded.a,
    z: 77,
    rotation: 15,
  });
  expect(activeGeometry(document, 'a1').y).toBe(250);
  expect(activeGeometry(document, 'b')).toMatchObject(expanded.b);
  expect(document.objects.a.name).toBe('Edited name');
  document = JSON.parse(JSON.stringify(document));
  document = edit(document, setChildrenExpanded('a', false));
  expect(positions(document)).toEqual(collapsed);
});

it('keeps distant shapes live through nested disclosure states without storing their geometry', () => {
  let document = fixture();
  document.objects.b.type = 'ellipse';
  document = edit(document, editActiveGeometry('b', { x: 3000, y: 500 }));
  document = edit(document, setChildrenExpanded('a', true));
  document = edit(document, setChildrenExpanded('a1', true));
  document = edit(document, setChildrenExpanded('a1', false));
  document = edit(
    document,
    editActiveGeometry('b', { width: 600, height: 180, x: 3500 }),
  );
  const ellipse = { ...activeGeometry(document, 'b') };
  for (const [id, open] of [
    ['a1', true],
    ['a', false],
    ['a', true],
    ['a1', false],
  ] as const) {
    document = JSON.parse(JSON.stringify(document));
    document = edit(document, setChildrenExpanded(id, open));
    expect(activeGeometry(document, 'b')).toEqual(ellipse);
  }
  for (const state of Object.values(
    (document.extensions!.expansionLayouts as any).states,
  ) as any[]) {
    expect(state.objects.b).toBeUndefined();
    expect(state.objects.far).toBeUndefined();
  }
});

it('preserves edits to an independently expanded branch, including one sharing an ancestor', () => {
  for (const independent of ['b', 'a2']) {
    let document = edit(
      fixture(),
      editActiveGeometry('b', { x: 3000, y: 500 }),
    );
    document = edit(document, setChildrenExpanded('a', true));
    if (independent === 'b')
      document = edit(document, setChildrenExpanded('b', true));
    document = edit(
      document,
      editActiveGeometry(independent, { x: 2500, y: 500 }),
    );
    document = edit(document, setChildrenExpanded('a1', true));
    document = edit(document, setChildrenExpanded('a1', false));
    document = edit(
      document,
      editActiveGeometry(independent, { width: 400, height: 300 }),
    );
    const current = { ...activeGeometry(document, independent) };
    document = edit(document, setChildrenExpanded('a1', true));
    expect(activeGeometry(document, independent)).toEqual(current);
    document = edit(document, setChildrenExpanded('a1', false));
    expect(activeGeometry(document, independent)).toEqual(current);
  }
});

it('remembers displaced neighbor positions without rolling back their resized shape', () => {
  let document = edit(fixture(), setChildrenExpanded('a', true));
  const displaced = activeGeometry(document, 'b').x;
  document = edit(
    document,
    editActiveGeometry('b', { width: 100, height: 65 }),
  );
  document = edit(document, setChildrenExpanded('a', false));
  expect(activeGeometry(document, 'b')).toMatchObject({
    x: 150,
    width: 100,
    height: 65,
  });
  document = JSON.parse(JSON.stringify(document));
  document = edit(document, setChildrenExpanded('a', true));
  expect(activeGeometry(document, 'b')).toMatchObject({
    x: displaced,
    width: 100,
    height: 65,
  });
  for (const state of Object.values(
    (document.extensions!.expansionLayouts as any).states,
  ) as any[]) {
    expect(state.objects.b.width).toBeUndefined();
    expect(state.objects.b.height).toBeUndefined();
  }
});

it('makes room for a newly nearby object when revisiting an existing expanded state', () => {
  let document = edit(fixture(), setChildrenExpanded('a', true));
  document = edit(document, setChildrenExpanded('a', false));
  document = edit(document, editActiveGeometry('far', { x: -130 }));
  const before = { ...activeGeometry(document, 'far') };
  document = edit(document, setChildrenExpanded('a', true));
  separated(document, 'a', 'far');
  expect(activeGeometry(document, 'far').x).not.toBe(before.x);
  document = edit(document, setChildrenExpanded('a', false));
  expect(activeGeometry(document, 'far')).toEqual(before);
});

it('restores neighbors first displaced by a nested expansion when its top parent closes', () => {
  const original = fixture();
  original.layouts.b[0].b.x = 500;
  original.layouts.a[2].deep.x = 600;
  let document = edit(original, setChildrenExpanded('a', true));
  expect(activeGeometry(document, 'b').x).toBe(500);
  document = edit(document, setChildrenExpanded('a1', true));
  expect(activeGeometry(document, 'b')).not.toEqual(
    activeGeometry(original, 'b'),
  );
  const open = positions(document);
  document = JSON.parse(JSON.stringify(document));
  document = edit(document, setChildrenExpanded('a', false));
  expect(positions(document)).toEqual(positions(original));
  document = edit(document, setChildrenExpanded('a', true));
  expect(positions(document)).toEqual(open);
});

it('upgrades old whole-document snapshots without replaying unrelated shape sizes', () => {
  let document = edit(fixture(), setChildrenExpanded('a', true));
  const open = { ...activeGeometry(document, 'a') };
  document = edit(document, setChildrenExpanded('a', false));
  const cache = document.extensions!.expansionLayouts as any;
  cache.version = 1;
  delete cache.displaced;
  for (const state of Object.values(cache.states) as any[]) {
    state.objects.b = { ...fixture().objects.b.geometry, parentId: null };
    state.objects.far = { ...fixture().objects.far.geometry, parentId: null };
  }
  document = edit(
    document,
    editActiveGeometry('far', { width: 900, height: 250 }),
  );
  document = edit(document, setChildrenExpanded('a', true));
  expect(activeGeometry(document, 'a')).toEqual(open);
  expect(activeGeometry(document, 'far')).toMatchObject({
    width: 900,
    height: 250,
  });
  expect((document.extensions!.expansionLayouts as any).version).toBe(2);
  for (const state of Object.values(
    (document.extensions!.expansionLayouts as any).states,
  ) as any[])
    expect(state.objects.far).toBeUndefined();
});

it('handles arbitrary independent collapse order and preserves every visited combination', () => {
  const original = fixture();
  let document = edit(original, setChildrenExpanded('a', true));
  const onlyA = positions(document);
  document = edit(document, setChildrenExpanded('b', true));
  document = edit(document, editActiveGeometry('b1', { y: 180 }));
  const both = positions(document);
  document = edit(document, setChildrenExpanded('a', false));
  const onlyB = positions(document);
  expect(Object.keys(onlyB).sort()).toEqual(['a', 'b', 'b1', 'b2', 'far']);
  expect(activeGeometry(document, 'a').width).toBe(120);
  separated(document, 'a', 'b');
  document = edit(document, setChildrenExpanded('a', true));
  expect(positions(document)).toEqual(both);
  document = edit(document, setChildrenExpanded('b', false));
  expect(positions(document)).toEqual(onlyA);
  document = edit(document, setChildrenExpanded('a', false));
  expect(positions(document)).toEqual(positions(original));
  document = edit(document, setChildrenExpanded('b', true));
  expect(positions(document)).toEqual(onlyB);
});

it('restores nested stages and reveals a search path in one transaction', () => {
  const original = fixture();
  const one = edit(original, setChildrenExpanded('a', true));
  const two = edit(one, setChildrenExpanded('a1', true));
  expect(activeGeometry(two, 'a1').width).toBeGreaterThan(
    activeGeometry(one, 'a1').width,
  );
  expect(activeGeometry(two, 'a').width).toBeGreaterThan(
    activeGeometry(one, 'a').width,
  );
  expect(positions(edit(two, setChildrenExpanded('a1', false)))).toEqual(
    positions(one),
  );
  const { result } = renderHook(() => useDocumentState(original));
  act(() => result.current.transact(revealObject('deep')));
  expect(recursiveScene(result.current.document!).world.has('deep')).toBe(true);
  expect(result.current.past).toHaveLength(1);
  const revealed = result.current.document;
  act(() => result.current.undo());
  expect(result.current.document).toEqual(original);
  act(() => result.current.redo());
  expect(result.current.document).toEqual(revealed);
});

it('keeps live siblings inside shrinking ancestors after a diamond collapses', () => {
  const original = fixture();
  original.objects.a1.type = 'diamond';
  original.objects.a.parentId = 'outer';
  const outer = { x: 0, y: 0, width: 200, height: 160, rotation: 0, z: 0 };
  original.objects.outer = {
    ...original.objects.a,
    id: 'outer',
    parentId: null,
    geometry: outer,
  };
  original.rootDepths.outer = 0;
  delete original.rootDepths.a;
  original.layouts.outer = { 0: { outer } };
  for (const [depth, layout] of Object.entries(original.layouts.a)) {
    if (layout.a2) Object.assign(layout.a2, { x: -350, y: 0 });
    original.layouts.outer[Number(depth) + 1] = {
      ...layout,
      outer: { ...outer },
    };
  }
  delete original.layouts.a;
  let document = edit(original, setChildrenExpanded('outer', true));
  document = edit(document, setChildrenExpanded('a', true));
  document = edit(document, setChildrenExpanded('a1', true));
  document = edit(document, (draft) => {
    editActiveGeometry('a2', { x: -650, width: 160, height: 100 })(draft);
    editActiveGeometry('a', { width: 1600, height: 800 })(draft);
    editActiveGeometry('outer', { width: 1800, height: 1000 })(draft);
  });
  const sibling = { ...activeGeometry(document, 'a2') };
  const far = { ...activeGeometry(document, 'far') };
  const { result } = renderHook(() => useDocumentState(document));
  act(() => result.current.transact(setChildrenExpanded('a1', false)));
  const collapsed = result.current.document!;
  expect(activeGeometry(collapsed, 'a2')).toEqual(sibling);
  const scene = recursiveScene(collapsed);
  for (const [child, parent] of [
    ['a2', 'a'],
    ['a1', 'a'],
    ['a', 'outer'],
  ]) {
    const g = scene.world.get(child)!;
    for (const x of [-g.width / 2, g.width / 2])
      for (const y of [-g.height / 2, g.height / 2])
        expect(
          containsShape(
            collapsed.objects[parent],
            scene.world.get(parent)!,
            toWorldGeometry({ ...g, x, y }, g),
          ),
        ).toBe(true);
  }
  expect(activeGeometry(collapsed, 'far')).toEqual(far);
  expect(result.current.past).toHaveLength(1);
  act(() => result.current.undo());
  expect(result.current.document).toEqual(document);
  act(() => result.current.redo());
  expect(result.current.document).toEqual(collapsed);
  document = JSON.parse(JSON.stringify(collapsed));
  document = edit(document, setChildrenExpanded('a1', true));
  document = edit(document, setChildrenExpanded('a1', false));
  expect(positions(document)).toEqual(positions(collapsed));
});

it('restores independent branches sharing a root without shrinking the branch left open', () => {
  const original = fixture();
  original.objects.otherDeep = {
    ...original.objects.deep,
    id: 'otherDeep',
    parentId: 'a2',
  };
  original.layouts.a[2].otherDeep = { ...original.objects.otherDeep.geometry };
  let document = edit(original, setChildrenExpanded('a', true));
  const shallow = positions(document);
  document = edit(document, setChildrenExpanded('a1', true));
  const first = positions(document);
  document = edit(document, setChildrenExpanded('a2', true));
  const both = positions(document);
  document = edit(document, setChildrenExpanded('a1', false));
  expect(recursiveScene(document).world.has('otherDeep')).toBe(true);
  expect(recursiveScene(document).world.has('deep')).toBe(false);
  expect(activeGeometry(document, 'a1').width).toBe(120);
  expect(activeGeometry(document, 'a2').width).toBeGreaterThan(120);
  document = edit(document, setChildrenExpanded('a1', true));
  expect(positions(document)).toEqual(both);
  document = edit(document, setChildrenExpanded('a2', false));
  expect(positions(document)).toEqual(first);
  document = edit(document, setChildrenExpanded('a1', false));
  expect(positions(document)).toEqual(shallow);
});

it('retains nested open and closed branches, manual layouts and other roots across collapse and save/reopen', () => {
  const original = fixture();
  original.objects.tip = {
    ...original.objects.deep,
    id: 'tip',
    parentId: 'deep',
  };
  original.objects.otherDeep = {
    ...original.objects.deep,
    id: 'otherDeep',
    parentId: 'a2',
  };
  original.layouts.a[2].otherDeep = { ...original.objects.otherDeep.geometry };
  let document = edit(original, revealObject('tip'));
  document = edit(document, setChildrenExpanded('a2', true));
  document = edit(document, setChildrenExpanded('a2', false));
  document = edit(document, setChildrenExpanded('b', true));
  document = edit(
    document,
    editActiveGeometry('deep', { x: -100, width: 300 }),
  );
  const open = positions(document);
  expect(recursiveScene(document).expanded).toEqual(
    new Set(['a', 'b', 'a1', 'deep']),
  );
  for (let i = 0; i < 3; i++) {
    document = edit(document, setChildrenExpanded('a', false));
    expect(recursiveScene(document).world.has('a1')).toBe(false);
    expect(recursiveScene(document).expanded).toEqual(new Set(['b']));
    document = JSON.parse(JSON.stringify(document));
    document = edit(document, setChildrenExpanded('a', true));
    expect(positions(document)).toEqual(open);
    expect(recursiveScene(document).world.has('otherDeep')).toBe(false);
  }
  document = edit(document, setChildrenExpanded('a1', false));
  document = edit(document, setChildrenExpanded('a1', true));
  expect(positions(document)).toEqual(open);
});

it.each([false, true])(
  'collapse-all clears every descendant, including hidden memory (already collapsed: %s), in one undo step',
  (alreadyCollapsed) => {
    const original = fixture();
    original.objects.tip = {
      ...original.objects.deep,
      id: 'tip',
      parentId: 'deep',
    };
    let document = edit(original, revealObject('tip'));
    document = edit(document, setChildrenExpanded('b', true));
    if (alreadyCollapsed)
      document = edit(document, setChildrenExpanded('a', false));
    const { result } = renderHook(() => useDocumentState(document));
    act(() => result.current.transact(setChildrenExpanded('a', false, true)));
    const collapsed = result.current.document!;
    expect(recursiveScene(collapsed).expanded).toEqual(new Set(['b']));
    expect(result.current.past).toHaveLength(1);
    act(() => result.current.undo());
    expect(result.current.document).toEqual(document);
    act(() => result.current.redo());
    expect(result.current.document).toEqual(collapsed);
    expect(
      transactDocument(collapsed, setChildrenExpanded('a', false, true)).status,
    ).toBe('noop');
    let reopened = edit(
      JSON.parse(JSON.stringify(collapsed)),
      setChildrenExpanded('a', true),
    );
    expect(recursiveScene(reopened).expanded).toEqual(new Set(['a', 'b']));
    expect(recursiveScene(reopened).world.has('deep')).toBe(false);
    reopened = edit(reopened, setChildrenExpanded('a1', true));
    expect(recursiveScene(reopened).world.has('deep')).toBe(true);
    expect(recursiveScene(reopened).world.has('tip')).toBe(false);
  },
);

it.each([
  'rectangle',
  'frame',
  'ellipse',
  'diamond',
] as DiagramObject['type'][])(
  'fits rotated children inside the physical %s outline, without scaling or reparenting',
  (type) => {
    const original = fixture();
    original.objects.a.type = type;
    original.layouts.a[0].a.rotation = 35;
    original.layouts.a[1].a1.rotation = 27;
    const document = edit(original, setChildrenExpanded('a', true));
    const scene = recursiveScene(document);
    const parent = scene.world.get('a')!;
    for (const id of ['a1', 'a2']) {
      const g = scene.world.get(id)!;
      expect([g.width, g.height]).toEqual([120, 80]);
      expect(document.objects[id].parentId).toBe('a');
      for (const x of [-g.width / 2, g.width / 2])
        for (const y of [-g.height / 2, g.height / 2])
          expect(
            containsShape(
              document.objects.a,
              parent,
              toWorldGeometry({ ...g, x, y }, g),
            ),
          ).toBe(true);
    }
  },
);

it('keeps attached and boundary arrows bound and transports owner-local free paths', () => {
  const original = fixture();
  original.objects.a.boundaryPoints = {
    port: { side: 'right', offset: 0.5 },
  };
  original.connections.link = {
    id: 'link',
    kind: 'arrow',
    z: 91,
    ownerId: null,
    start: { kind: 'boundary', objectId: 'a', pointId: 'port' },
    end: { kind: 'object', objectId: 'b', side: 'left', offset: 0.5 },
  };
  original.connections.inner = {
    id: 'inner',
    kind: 'line',
    z: -8,
    ownerId: 'a',
    start: { kind: 'free', x: 10, y: 20 },
    end: { kind: 'free', x: 60, y: 20 },
  };
  const expanded = edit(original, setChildrenExpanded('a', true));
  expect(expanded.connections).toEqual(original.connections);
  expect(recursiveScene(expanded).connections.get(null)![0].points[0]).toBe(
    activeGeometry(expanded, 'a').width / 2,
  );
  const restored = edit(expanded, setChildrenExpanded('a', false));
  expect(recursiveScene(restored).connections.get(null)).toEqual(
    recursiveScene(original).connections.get(null),
  );
});

it('honors real bookmarks and explicit depth layouts as authoritative arrangements', () => {
  let document = edit(fixture(), setChildrenExpanded('a', true));
  document = edit(
    document,
    editNamedView({ type: 'create', id: 'open', name: 'Open' }),
  );
  const bookmarked = positions(document);
  document = edit(document, editActiveGeometry('a', { x: -500 }));
  document = edit(document, setChildrenExpanded('a', false));
  document = edit(document, editNamedView({ type: 'apply', id: 'open' }));
  expect(positions(document)).toEqual(bookmarked);
  document = edit(document, setChildrenExpanded('a', false));
  document = edit(document, setChildrenExpanded('a', true));
  expect(positions(document)).toEqual(bookmarked);
  document = edit(document, selectRootDepth('a', 0));
  expect(activeGeometry(document, 'a')).toEqual(fixture().layouts.a[0].a);
  const depthZero = positions(document);
  document = edit(document, setChildrenExpanded('a', true));
  document = edit(document, setChildrenExpanded('a', false));
  expect(positions(document)).toEqual(depthZero);
  expect(Object.keys(document.namedViews!)).toEqual(['open']);
});

it('repairs visits after add/delete/reparent without reviving stale geometry or losing new objects', () => {
  let document = edit(fixture(), setChildrenExpanded('a', true));
  document = edit(document, editActiveGeometry('a2', { x: -200 }));
  document = edit(document, setChildrenExpanded('a', false));
  document = edit(document, deleteSelection(['a1']));
  document = edit(
    document,
    createShape(
      'new',
      'rectangle',
      { ...activeGeometry(document, 'a'), x: 600, y: 0, width: 70, height: 50 },
      'a',
    ),
  );
  expect(document.objects.a1).toBeUndefined();
  expect(activeGeometry(document, 'a2').x).toBe(-200);
  expect(recursiveScene(document).world.has('new')).toBe(true);
  document = edit(document, setChildrenExpanded('b', true));
  document = edit(
    document,
    moveSelection(['new'], { x: 30, y: 40 }, new Map([['new', 'b']])),
  );
  const moved = { ...activeGeometry(document, 'new') };
  document = edit(document, setChildrenExpanded('a', false));
  document = edit(document, setChildrenExpanded('a', true));
  expect(document.objects.new.parentId).toBe('b');
  expect(activeGeometry(document, 'new')).toEqual(moved);
  expect(document.objects.a1).toBeUndefined();
  expect(document.objects.deep).toBeUndefined();
});

it('is deterministic across object insertion order and rejects malformed memory atomically', () => {
  const original = fixture();
  const reordered = {
    ...original,
    objects: Object.fromEntries(Object.entries(original.objects).reverse()),
  };
  expect(positions(edit(original, setChildrenExpanded('a', true)))).toEqual(
    positions(edit(reordered, setChildrenExpanded('a', true))),
  );
  original.extensions = {
    expansionLayouts: { version: 1, states: { broken: {} }, depths: {} },
  };
  const before = JSON.stringify(original);
  const result = transactDocument(original, setChildrenExpanded('a', true));
  expect(result.status).toBe('rejected');
  expect(result.document).toBe(original);
  expect(JSON.stringify(original)).toBe(before);
});

it('keeps unrelated state memory after deleting a root and rejects overflowing layout atomically', () => {
  let document = edit(fixture(), setChildrenExpanded('a', true));
  document = edit(document, editActiveGeometry('a1', { y: 190 }));
  document = edit(document, setChildrenExpanded('a', false));
  document = edit(document, deleteSelection(['far']));
  document = edit(document, setChildrenExpanded('a', true));
  expect(activeGeometry(document, 'a1').y).toBe(190);
  expect(document.objects.far).toBeUndefined();
  const huge = fixture();
  huge.layouts.a[1].a1.x = Number.MAX_VALUE;
  const before = JSON.stringify(huge);
  const failed = transactDocument(huge, setChildrenExpanded('a', true));
  expect(failed.status).toBe('rejected');
  expect(failed.document).toBe(huge);
  expect(JSON.stringify(huge)).toBe(before);
});

it('fits a first child that is immediately visible at an already deeper root depth', () => {
  let document = edit(fixture(), revealObject('deep'));
  const before = positions(document);
  const parent = recursiveScene(document).world.get('a2')!;
  document = edit(
    document,
    createShape('new', 'rectangle', { ...parent }, 'a2'),
  );
  expect(recursiveScene(document).world.has('new')).toBe(true);
  expect(activeGeometry(document, 'a2').width).toBeGreaterThan(parent.width);
  document = edit(document, setChildrenExpanded('a2', false));
  expect(positions(document)).toEqual(before);
  document = edit(document, setChildrenExpanded('a2', true));
  expect(activeGeometry(document, 'a2').width).toBeGreaterThan(parent.width);
});

it('prunes a child created and deleted in one compound edit before its ID is reused', () => {
  let document = fixture();
  document = edit(document, (draft) => {
    createShape(
      'temporary',
      'rectangle',
      { ...draft.objects.a.geometry, x: 700 },
      'a',
    )(draft);
    deleteSelection(['temporary'])(draft);
  });
  const memory = document.extensions!.expansionLayouts as any;
  for (const state of Object.values(memory.states) as any[])
    expect(state.objects.temporary).toBeUndefined();
  document = edit(
    document,
    createShape(
      'temporary',
      'rectangle',
      { ...document.objects.a.geometry, x: 20 },
      'a',
    ),
  );
  const placement = { ...activeGeometry(document, 'temporary') };
  document = edit(document, setChildrenExpanded('a', false));
  document = edit(document, setChildrenExpanded('a', true));
  expect(activeGeometry(document, 'temporary')).toEqual(placement);
});
