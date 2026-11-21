import { act, renderHook } from '@testing-library/react';
import useDocumentState from '../renderer/hooks/useDocumentState';
import { createRecursiveDocument } from '../shared/recursiveDocument';
import type { ApiResult } from '../shared/depthApiContract';
import { autoLayout, cyclicComponents } from '../shared/autoLayout';
import { activeWorldGeometry } from '../shared/recursiveHierarchy';
import { geometryBounds } from '../shared/recursiveCamera';

function setup() {
  const hook = renderHook(() =>
    useDocumentState(createRecursiveDocument('test', 'Test'), 'app'),
  );
  let sequence = 0;
  const request = (extra: Record<string, unknown>) => {
    const s = hook.result.current.snapshot();
    return {
      handle: { appInstanceId: s.appInstanceId, sessionId: s.sessionId },
      expectedRevision: s.revision,
      expectedViewRevision: s.viewRevision,
      requestId: `request-${++sequence}`,
      ...extra,
    };
  };
  const send = (actions: unknown[]) => {
    let result!: ApiResult<any>;
    act(() => {
      result = hook.result.current.editorCommand('edit', request({ actions }));
    });
    return result;
  };
  const doc = () => hook.result.current.snapshot().document!;
  return { ...hook, request, send, doc };
}
const box = (
  id: string,
  parentId: string | null,
  x: number,
  y: number,
  width = 120,
  height = 70,
  shape = 'rectangle',
) => ({
  type: 'create_object',
  id,
  shape,
  parentId,
  geometry: { x, y, width, height },
  name: id,
});
const ids = 'abcdefghijkl'.split('');
// Includes a d→e→f→d cycle, a grandchild endpoint and a duplicate edge.
const links: [string, string][] = [
  ['a', 'b'],
  ['a', 'c'],
  ['b', 'd'],
  ['c', 'd'],
  ['d', 'e'],
  ['e', 'f'],
  ['f', 'd'],
  ['c', 'g'],
  ['g', 'h'],
  ['i', 'j'],
  ['l', 'a'],
  ['l', 'a'],
  ['h-inner', 'b'],
];
function build() {
  const t = setup();
  const created = t.send([
    box('map', null, 0, 0, 1600, 1200, 'frame'),
    ...ids.map((id, at) =>
      box(
        id,
        'map',
        -600 + ((at * 337) % 1100),
        -400 + ((at * 211) % 800),
        100 + ((at * 37) % 90),
        60 + ((at * 13) % 40),
      ),
    ),
    box('other', null, 5000, 0, 400, 300),
    box('other-child', 'other', 5000, 0),
  ]);
  expect(created.ok).toBe(true);
  // A grandchild endpoint attributes the connector to its direct child h.
  expect(t.send([box('h-inner', 'h', 0, 0, 20, 20)]).ok).toBe(true);
  expect(
    t.send(
      links.map(([from, to], at) => ({
        type: 'create_connection',
        id: `link-${at}`,
        kind: 'arrow',
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        startTarget: from,
        endTarget: to,
      })),
    ).ok,
  ).toBe(true);
  return t;
}
const worldBoxes = (doc: ReturnType<ReturnType<typeof setup>['doc']>) => {
  const world = activeWorldGeometry(doc);
  return new Map(ids.map((id) => [id, geometryBounds(world.get(id)!, 2)]));
};

it('lays out twelve connected children in readable, uniformly spaced layers as one undo step', () => {
  const { send, doc, result, request } = build();
  const depth = doc().rootDepths.map;
  expect(depth).toBe(2);
  const before = JSON.parse(JSON.stringify(doc()));
  const history = result.current.past.length;
  const response = send([
    { type: 'layout', id: 'map', algorithm: 'layered', gap: 30 },
  ]);
  expect(response.ok).toBe(true);
  expect(result.current.past).toHaveLength(history + 1);
  const after = doc();
  // Other depths and unrelated parents are byte-identical.
  for (const other of [0, 1])
    expect(JSON.stringify(after.layouts.map[other])).toBe(
      JSON.stringify(before.layouts.map[other]),
    );
  expect(JSON.stringify(after.layouts.other)).toBe(
    JSON.stringify(before.layouts.other),
  );
  for (const id of ids)
    expect(after.layouts.map[depth][id]).toMatchObject({
      width: before.layouts.map[depth][id].width,
      height: before.layouts.map[depth][id].height,
    });
  const boxes = worldBoxes(after);
  // Rows are horizontal bands with members centered on one line.
  const rows = [
    ...new Set(ids.map((id) => boxes.get(id)!.y + boxes.get(id)!.height / 2)),
  ]
    .sort((a, b) => a - b)
    .map((center) =>
      ids
        .filter(
          (id) =>
            Math.abs(boxes.get(id)!.y + boxes.get(id)!.height / 2 - center) <
            1e-6,
        )
        .sort((a, b) => boxes.get(a)!.x - boxes.get(b)!.x),
    );
  const rank = new Map(rows.flatMap((row, r) => row.map((id) => [id, r])));
  for (const row of rows)
    for (let at = 1; at < row.length; at++) {
      const left = boxes.get(row[at - 1])!,
        right = boxes.get(row[at])!;
      expect(right.x - left.x - left.width).toBeCloseTo(30);
    }
  for (let r = 1; r < rows.length; r++) {
    const bottom = Math.max(
      ...rows[r - 1].map((id) => boxes.get(id)!.y + boxes.get(id)!.height),
    );
    const top = Math.min(...rows[r].map((id) => boxes.get(id)!.y));
    expect(top - bottom).toBeCloseTo(30);
  }
  for (const a of ids)
    for (const b of ids) {
      if (a >= b) continue;
      const p = boxes.get(a)!,
        q = boxes.get(b)!;
      const separated =
        p.x + p.width + 30 - 1e-6 <= q.x ||
        q.x + q.width + 30 - 1e-6 <= p.x ||
        p.y + p.height + 30 - 1e-6 <= q.y ||
        q.y + q.height + 30 - 1e-6 <= p.y;
      expect(separated).toBe(true);
    }
  const edges = links.map(
    ([from, to]) => [from === 'h-inner' ? 'h' : from, to] as [string, string],
  );
  const component = cyclicComponents(ids, edges);
  for (const [from, to] of edges)
    if (component.get(from) !== component.get(to))
      expect(rank.get(from)!).toBeLessThan(rank.get(to)!);
  expect(rows[0]).toEqual(expect.arrayContaining(['l']));
  // The parent grows to contain the block below its title region.
  const map = activeWorldGeometry(after).get('map')!;
  const content = [...boxes.values()];
  expect(Math.min(...content.map((b) => b.y))).toBeGreaterThanOrEqual(
    map.y - map.height / 2 + 44 - 1e-6,
  );
  expect(Math.max(...content.map((b) => b.x + b.width))).toBeLessThanOrEqual(
    map.x + map.width / 2,
  );
  act(() => {
    result.current.editorCommand('history', request({ direction: 'undo' }));
  });
  expect(JSON.stringify(doc())).toBe(JSON.stringify(before));
});

it('produces identical output for identical input', () => {
  const first = build(),
    second = build();
  for (const t of [first, second])
    expect(
      t.send([{ type: 'layout', id: 'map', algorithm: 'layered' }]).ok,
    ).toBe(true);
  expect(JSON.stringify(first.doc().layouts)).toBe(
    JSON.stringify(second.doc().layouts),
  );
});

it('grows the parent and pushes overlapping neighbors through the existing fitting', () => {
  const { send, doc } = setup();
  expect(
    send([
      box('frame', null, 0, 0, 200, 150),
      ...ids.map((id, at) => box(id, 'frame', at * 3 - 15, 0, 40, 30)),
      box('neighbor', null, 0, 260, 100, 60),
    ]).ok,
  ).toBe(true);
  expect(
    send([{ type: 'layout', id: 'frame', algorithm: 'row', gap: 10 }]).ok,
  ).toBe(true);
  const world = activeWorldGeometry(doc());
  const frame = world.get('frame')!;
  expect(frame.width).toBeGreaterThanOrEqual(12 * 42 + 11 * 10 + 48);
  const neighbor = geometryBounds(world.get('neighbor')!);
  const outline = geometryBounds(frame);
  expect(
    neighbor.y >= outline.y + outline.height ||
      neighbor.x >= outline.x + outline.width ||
      neighbor.x + neighbor.width <= outline.x,
  ).toBe(true);
});

it('arranges grid, row and column blocks with consistent gaps', () => {
  const nodes = [
    { id: 'c', x: 300, y: 0, width: 40, height: 20 },
    { id: 'a', x: 0, y: 0, width: 20, height: 40 },
    { id: 'b', x: 100, y: 0, width: 30, height: 30 },
    { id: 'd', x: 0, y: 100, width: 10, height: 10 },
  ];
  const grid = autoLayout(nodes, [], {
    algorithm: 'grid',
    gap: 10,
    padding: 0,
  });
  // Uniform 40×40 cells in reading order, two columns.
  expect(grid).toMatchObject({ width: 90, height: 90 });
  expect(grid.positions.get('a')).toEqual({ x: 10, y: 0 });
  expect(grid.positions.get('b')).toEqual({ x: 55, y: 5 });
  expect(grid.positions.get('c')).toEqual({ x: 0, y: 60 });
  expect(grid.positions.get('d')).toEqual({ x: 65, y: 65 });
  const down = autoLayout(nodes, [], {
    algorithm: 'grid',
    gap: 10,
    padding: 0,
    direction: 'down',
    columns: 1,
  });
  expect(down).toMatchObject({ width: 40, height: 190 });
  // Two rows hold four nodes in two of the three requested columns.
  expect(
    autoLayout(nodes, [], {
      algorithm: 'grid',
      gap: 10,
      padding: 0,
      direction: 'down',
      columns: 3,
    }),
  ).toMatchObject({ width: 90, height: 90 });
  const row = autoLayout(nodes, [], { algorithm: 'row', gap: 5, padding: 0 });
  expect(row).toMatchObject({ width: 115, height: 40 });
  expect(row.positions.get('a')).toEqual({ x: 0, y: 0 });
  expect(row.positions.get('d')).toEqual({ x: 25, y: 15 });
  expect(row.positions.get('b')).toEqual({ x: 40, y: 5 });
  expect(row.positions.get('c')).toEqual({ x: 75, y: 10 });
  const column = autoLayout(nodes, [], {
    algorithm: 'column',
    gap: 5,
    padding: 0,
  });
  expect(column).toMatchObject({ width: 40, height: 115 });
  expect(column.positions.get('a')).toEqual({ x: 10, y: 0 });
  expect(column.positions.get('d')).toEqual({ x: 15, y: 105 });
  const right = autoLayout(nodes, [['a', 'b']], {
    algorithm: 'layered',
    gap: 5,
    padding: 0,
    direction: 'right',
  });
  expect(right.positions.get('b')!.x).toBeGreaterThan(
    right.positions.get('a')!.x,
  );
});

it('rejects missing or hidden containers and leaves childless ones unchanged', () => {
  const { send, doc } = setup();
  expect(
    send([
      box('root', null, 0, 0, 300, 200),
      box('leaf', 'root', 0, 0),
      box('grandchild', 'leaf', 0, 0, 20, 20),
    ]).ok,
  ).toBe(true);
  const missing = send([{ type: 'layout', id: 'nope', algorithm: 'grid' }]);
  expect(missing.ok).toBe(false);
  expect(send([{ type: 'depth', rootId: 'root', depth: 0 }]).ok).toBe(true);
  const before = JSON.stringify(doc());
  const hidden = send([{ type: 'layout', id: 'leaf', algorithm: 'grid' }]);
  expect(hidden).toMatchObject({
    ok: false,
    error: { code: 'INVALID_REQUEST' },
  });
  // A visible container whose children are beyond the active depth is a no-op.
  const empty = send([{ type: 'layout', id: 'root', algorithm: 'grid' }]);
  expect(empty).toMatchObject({ ok: true, data: { changed: false } });
  expect(JSON.stringify(doc())).toBe(before);
  expect(
    send([{ type: 'layout', id: 'root', algorithm: 'grid', gap: -1 }]).ok,
  ).toBe(false);
});
