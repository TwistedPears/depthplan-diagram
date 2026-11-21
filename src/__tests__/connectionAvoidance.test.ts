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
  connectionLabelBox,
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
  dx = 220,
  dy = 180,
  card = { width: 120, height: 60 },
): RecursiveDocument {
  const document = createRecursiveDocument('grid', 'Grid', '2026-11-20');
  const width = cols * dx + 200,
    height = rows * dy + 200;
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
      (n % cols) * dx - ((cols - 1) * dx) / 2,
      Math.floor(n / cols) * dy - ((rows - 1) * dy) / 2,
      card.width,
      card.height,
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
/** Shortest distance between an axis-aligned segment and a box. */
const gap = (a: Point, b: Point, box: Box) =>
  Math.hypot(
    Math.max(0, box.left - Math.max(a.x, b.x), Math.min(a.x, b.x) - box.right),
    Math.max(0, box.top - Math.max(a.y, b.y), Math.min(a.y, b.y) - box.bottom),
  );
const length = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
/** Every geometric rule the router promises, as readable failures. `roomy`
 * adds the rules that hold wherever corridors are wide: comfortable shape
 * clearance, a visible lane gap, no short jogs, room for arrowheads and labels
 * clear of other connectors' lines. */
function problems(document: RecursiveDocument, result: Routes, roomy = false) {
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
      const end = i === 0 || i === route.length - 2;
      if (roomy && end && length(a, b) < 20)
        found.push(`${id} end segment ${length(a, b)}`);
      if (roomy && !end && length(a, b) < 12)
        found.push(`${id} jog ${length(a, b)}`);
      for (const [shape, box] of boxes) {
        if (own.includes(shape)) continue;
        if (crosses(a, b, box)) found.push(`${id} crosses ${shape}`);
        else if (roomy && gap(a, b, box) < 14)
          found.push(`${id} ${gap(a, b, box).toFixed(1)} from ${shape}`);
      }
    }
  }
  const lane = roomy ? 10 : 3;
  for (const s of segments)
    for (const t of segments) {
      if (s.id >= t.id) continue;
      const horizontal = s.a.y === s.b.y;
      if (horizontal !== (t.a.y === t.b.y)) continue;
      const at = (p: Point) => (horizontal ? p.y : p.x);
      const along = (p: Point) => (horizontal ? p.x : p.y);
      // Collinear, or parallel lanes squeezed closer than a lane gap.
      if (Math.abs(at(s.a) - at(t.a)) >= lane) continue;
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
    box: connectionLabelBox(document, document.connections[id], label),
  }));
  for (const { id, box } of labels) {
    for (const [shape, shapeBox] of boxes)
      if (boxesIntersect(box, shapeBox)) found.push(`${id} label on ${shape}`);
    for (const other of labels)
      if (other.id > id && boxesIntersect(box, other.box))
        found.push(`${id} label on ${other.id} label`);
    // Under another connector's line only when no spot on the path is clear
    // of shapes, labels and lines.
    const under = (box: Box) =>
      segments.filter((s) => s.id !== id && crosses(s.a, s.b, box));
    const route = result.get(id)!.route;
    if (
      roomy &&
      under(box).length &&
      Array.from({ length: 73 }, (_, k) =>
        connectionLabelBox(
          document,
          document.connections[id],
          pointAlong(route, 0.05 + k * 0.0125),
        ),
      ).some(
        (spot) =>
          !under(spot).length &&
          ![...boxes.values()].some((shape) => boxesIntersect(spot, shape)) &&
          !labels.some((o) => o.id !== id && boxesIntersect(spot, o.box)),
      )
    )
      found.push(`${id} label under ${under(box)[0].id}`);
  }
  return [...new Set(found)];
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

it('keeps clearance, lane gaps, arrowhead room and clear labels on a roomy map', () => {
  // 170 x 70 cards with 150 px gaps, as in a typical architecture map.
  const document = grid(4, 4, pairs, {}, 320, 220, { width: 170, height: 70 });
  // Every third connector carries tag pills under its label.
  document.tagDefinitions = {
    confirm: { id: 'confirm', name: 'To confirm', color: '#dc2626' },
    inferred: { id: 'inferred', name: 'Inferred', color: '#d97706' },
  };
  Object.values(document.connections).forEach((c, n) => {
    if (n % 3 === 0) c.tags = n % 2 ? ['confirm'] : ['confirm', 'inferred'];
  });
  const result = routes(document);
  expect(result.size).toBe(pairs.length);
  expect(problems(document, result, true)).toEqual([]);
});

it('counts the tag pill row under a label as part of the label', () => {
  const document = grid(2, 2, [[0, 3]], {}, 320, 220);
  const c = document.connections.c000;
  const bare = connectionLabelBox(document, c, { x: 0, y: 0 });
  expect(bare).toEqual(labelBox({ x: 0, y: 0 }, 'L0'));
  document.tagDefinitions = {
    confirm: { id: 'confirm', name: 'To confirm', color: '#dc2626' },
    inferred: { id: 'inferred', name: 'Inferred', color: '#d97706' },
  };
  c.tags = ['confirm', 'inferred'];
  const tagged = connectionLabelBox(document, c, { x: 0, y: 0 });
  // The pill row hangs 3 px below the label and is wider than "L0".
  expect(tagged.top).toBe(bare.top);
  expect(tagged.bottom).toBe(bare.bottom + 3 + 14);
  expect(tagged.right - tagged.left).toBeGreaterThan(bare.right - bare.left);
  // Pills without a label sit centred on the path.
  c.label = undefined;
  const pills = connectionLabelBox(document, c, { x: 0, y: 0 });
  expect([pills.top, pills.bottom]).toEqual([-7, 7]);
});

it('keeps port segments of neighbouring layers apart in a tight pipeline', () => {
  // Two columns with 40 px gaps, as a layered pipeline: a connector leaving
  // the bottom of one card must not run along the last segment of a connector
  // arriving at the card below it.
  const document = grid(
    5,
    2,
    [
      [0, 2],
      [1, 3],
      [3, 4],
      [3, 5],
      [2, 8],
      [4, 6],
      [5, 6],
      [6, 9],
    ],
    {},
    190,
    100,
    { width: 150, height: 60 },
  );
  const result = routes(document);
  const found = problems(document, result, true).filter((p) =>
    /shares|jog|end segment|crosses|diagonal/.test(p),
  );
  expect(found).toEqual([]);
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
  // Plus long arrows across the whole map: corners, row skips and column skips.
  for (let k = 0; k < 30; k++)
    many.push([k % 10, 99 - ((k * 7) % 10) - 10 * (k % 3)]);
  const document = grid(rows, cols, many);
  const started = performance.now();
  const result = routes(document);
  const elapsed = performance.now() - started;
  expect(result.size).toBe(many.length);
  expect(elapsed).toBeLessThan(3000);
  // A user-sized map: 85 shapes and 50 short and long arrows.
  const mixed: [number, number][] = [];
  for (let k = 0; k < 50; k++)
    mixed.push(k % 2 ? [k, k + 17] : [(k * 3) % 17, 84 - ((k * 5) % 17)]);
  const map = grid(5, 17, mixed);
  const t = performance.now();
  expect(routes(map).size).toBe(50);
  expect(performance.now() - t).toBeLessThan(1000);
});

it('never crosses unrelated shapes when cards are tightly packed', () => {
  const document = grid(4, 4, pairs, {}, 144, 84);
  expect(
    problems(document, routes(document)).filter((p) =>
      /crosses|diagonal/.test(p),
    ),
  ).toEqual([]);
});
