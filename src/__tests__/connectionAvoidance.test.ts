import {
  createRecursiveDocument,
  validateRecursiveDocument,
  type DiagramConnection,
  type Geometry,
  type RecursiveDocument,
} from '../shared/recursiveDocument';
import { recursiveScene } from '../shared/recursiveScene';
import { connectionRoute, pointAlong } from '../shared/connectionGeometry';
import {
  boxOf,
  boxesIntersect,
  labelBox,
  type Box,
} from '../shared/connectionAvoidance';
import type { Point } from '../shared/recursiveCreation';

const g = (x: number, y: number, width: number, height: number): Geometry => ({
  x,
  y,
  z: 0,
  width,
  height,
  rotation: 0,
});
/** A frame of `rows` x `cols` cards with elbow arrows between rows. */
function grid(
  rows: number,
  cols: number,
  pairs: [number, number][],
  style: Record<string, string | number | boolean> = {},
): RecursiveDocument {
  const document = createRecursiveDocument('grid', 'Grid', '2026-11-20');
  const width = cols * 220 + 200,
    height = rows * 180 + 200;
  document.objects.frame = {
    id: 'frame',
    parentId: null,
    type: 'frame',
    name: 'Frame',
    content: [],
    geometry: g(0, 0, width, height),
  };
  document.rootDepths.frame = 1;
  document.layouts.frame = {
    0: { frame: g(0, 0, width, height) },
    1: { frame: g(0, 0, width, height) },
  };
  const id = (n: number) => `s${String(n).padStart(3, '0')}`;
  for (let n = 0; n < rows * cols; n++) {
    const geometry = g(
      (n % cols) * 220 - ((cols - 1) * 220) / 2,
      Math.floor(n / cols) * 180 - ((rows - 1) * 180) / 2,
      120,
      60,
    );
    document.objects[id(n)] = {
      id: id(n),
      parentId: 'frame',
      type: 'rectangle',
      name: id(n),
      content: [],
      geometry,
    };
    document.layouts.frame[1][id(n)] = geometry;
  }
  pairs.forEach(([from, to], n) => {
    const key = `c${String(n).padStart(3, '0')}`;
    document.connections[key] = {
      id: key,
      ownerId: 'frame',
      kind: 'arrow',
      z: 0,
      // As MCP creates them: centre-picked attachments without a binding mode.
      start: { kind: 'object', objectId: id(from), side: 'right', offset: 0.5 },
      end: { kind: 'object', objectId: id(to), side: 'right', offset: 0.5 },
      label: `L${n}`,
      style: { lineType: 'elbow', avoidShapes: true, ...style },
    };
  });
  validateRecursiveDocument(document);
  return document;
}
// 4 rows of 4: neighbours, diagonals, fan-out/fan-in and row-skipping arrows.
const pairs: [number, number][] = [
  [0, 4],
  [0, 5],
  [0, 6],
  [1, 4],
  [1, 7],
  [2, 5],
  [2, 6],
  [3, 4],
  [3, 7],
  [4, 8],
  [4, 11],
  [5, 9],
  [5, 10],
  [6, 8],
  [7, 11],
  [7, 9],
  [8, 12],
  [9, 13],
  [9, 15],
  [10, 12],
  [11, 14],
  [0, 9],
  [3, 10],
  [1, 14],
  [2, 13],
  [12, 15],
];
type Routes = Map<string, { route: Point[]; label: Point }>;
function routes(document: RecursiveDocument): Routes {
  const scene = recursiveScene(document);
  return new Map(
    scene.connections
      .get('frame')!
      .map(({ id, route, label }) => [id, { route, label }]),
  );
}
const shapes = (document: RecursiveDocument) =>
  new Map(
    Object.values(document.objects)
      .filter((o) => o.parentId === 'frame')
      .map((o) => [o.id, boxOf(document.layouts.frame[1][o.id])]),
  );
/** Does an axis-aligned segment pass through the open interior of a box? */
const crosses = (a: Point, b: Point, box: Box) =>
  Math.max(a.x, b.x) > box.left &&
  Math.min(a.x, b.x) < box.right &&
  Math.max(a.y, b.y) > box.top &&
  Math.min(a.y, b.y) < box.bottom;
/** Every geometric rule the router promises, as readable failures. */
function problems(document: RecursiveDocument, result: Routes) {
  const boxes = shapes(document);
  const found: string[] = [];
  const segments: { id: string; a: Point; b: Point }[] = [];
  for (const [id, { route }] of result) {
    const c = document.connections[id];
    const own = [c.start, c.end].map((e) =>
      e.kind === 'free' ? '' : e.objectId,
    );
    for (let i = 0; i < route.length - 1; i++) {
      const [a, b] = [route[i], route[i + 1]];
      if (a.x !== b.x && a.y !== b.y) found.push(`${id} diagonal`);
      segments.push({ id, a, b });
      for (const [shape, box] of boxes)
        if (!own.includes(shape) && crosses(a, b, box))
          found.push(`${id} crosses ${shape}`);
    }
  }
  for (const s of segments)
    for (const t of segments) {
      if (s.id >= t.id) continue;
      const horizontal = s.a.y === s.b.y;
      if (horizontal !== (t.a.y === t.b.y)) continue;
      const at = (p: Point) => (horizontal ? p.y : p.x);
      const along = (p: Point) => (horizontal ? p.x : p.y);
      if (Math.abs(at(s.a) - at(t.a)) > 1e-6) continue;
      const overlap =
        Math.min(
          Math.max(along(s.a), along(s.b)),
          Math.max(along(t.a), along(t.b)),
        ) -
        Math.max(
          Math.min(along(s.a), along(s.b)),
          Math.min(along(t.a), along(t.b)),
        );
      if (overlap > 1e-6) found.push(`${s.id} shares a lane with ${t.id}`);
    }
  const labels = [...result].map(([id, { label }]) => ({
    id,
    box: labelBox(label, document.connections[id].label!),
  }));
  for (const { id, box } of labels) {
    for (const [shape, shapeBox] of boxes)
      if (boxesIntersect(box, shapeBox)) found.push(`${id} label on ${shape}`);
    for (const other of labels)
      if (other.id > id && boxesIntersect(box, other.box))
        found.push(`${id} label on ${other.id} label`);
  }
  return found;
}

it('routes 26 arrows between 4 rows around unrelated shapes, on separate lanes, with clear labels', () => {
  const document = grid(4, 4, pairs);
  const result = routes(document);
  expect(result.size).toBe(pairs.length);
  expect(problems(document, result)).toEqual([]);
  // Derived only: the document is untouched, and routing ignores insertion order.
  const shuffled = {
    ...document,
    connections: Object.fromEntries(
      Object.entries(document.connections).reverse(),
    ),
    objects: Object.fromEntries(Object.entries(document.objects).reverse()),
  };
  expect(routes(shuffled)).toEqual(result);
  expect(document.connections.c000.points).toBeUndefined();
});

it('also keeps a wide three-row layout clean', () => {
  const wide: [number, number][] = [];
  for (let n = 0; n < 12; n++)
    for (const d of n % 2 ? [6, 7] : [5, 6])
      if (n + d < 18) wide.push([n, n + d]);
  wide.push([0, 17], [5, 12]);
  const document = grid(3, 6, wide);
  const result = routes(document);
  expect(result.size).toBeGreaterThanOrEqual(20);
  expect(problems(document, result)).toEqual([]);
});

it('keeps authored bends and the ordinary route when the mode is off', () => {
  const off = grid(4, 4, pairs, { avoidShapes: false });
  // The checks above do catch the ordinary routes of this layout.
  expect(problems(off, routes(off)).length).toBeGreaterThan(0);
  const scene = recursiveScene(off);
  for (const { id, ...route } of scene.connections.get('frame')!)
    expect(route).toEqual(
      connectionRoute(off, off.connections[id], scene.world),
    );
  const authored = grid(2, 2, [[0, 3]]);
  authored.connections.c000.points = [{ x: 0, y: 0 }];
  const world = recursiveScene(authored).world;
  const [{ id: _id, ...route }] =
    recursiveScene(authored).connections.get('frame')!;
  expect(route).toEqual(
    connectionRoute(authored, authored.connections.c000, world),
  );
});

it('places labels at a manual labelPosition fraction', () => {
  for (const avoidShapes of [true, false]) {
    const document = grid(2, 2, [[0, 3]], { avoidShapes, labelPosition: 0.25 });
    const [{ route, label }] =
      recursiveScene(document).connections.get('frame')!;
    expect(label).toEqual(pointAlong(route, 0.25));
  }
  const plain: DiagramConnection = grid(2, 2, [[0, 3]], { avoidShapes: false })
    .connections.c000;
  const document = grid(2, 2, [[0, 3]], { avoidShapes: false });
  const [{ route, label }] = recursiveScene(document).connections.get('frame')!;
  expect(plain.style?.labelPosition).toBeUndefined();
  expect(label).toEqual(pointAlong(route, 0.5));
});

it('routes a few hundred connectors quickly', () => {
  const rows = 10,
    cols = 10;
  const many: [number, number][] = [];
  for (let n = 0; n < (rows - 1) * cols; n++)
    for (const d of [cols - 1, cols, cols + 1])
      if (n + d < rows * cols) many.push([n, n + d]);
  const document = grid(rows, cols, many.slice(0, 260));
  const started = performance.now();
  const result = routes(document);
  const elapsed = performance.now() - started;
  expect(result.size).toBe(260);
  console.log('ELAPSED', elapsed);
  expect(elapsed).toBeLessThan(3000);
});
