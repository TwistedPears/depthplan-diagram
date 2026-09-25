import type {
  DiagramConnection,
  Endpoint,
  Geometry,
  RecursiveDocument,
} from './recursiveDocument';
import type { Point } from './recursiveCreation';
import { boundaryPlacement, boundaryPosition } from './recursiveBoundary';
import { toLocalGeometry, toWorldGeometry } from './recursiveHierarchy';

export const arrowheads = [
  'none',
  'arrow',
  'bar',
  'circle',
  'circle_outline',
  'triangle',
  'triangle_outline',
  'diamond',
  'diamond_outline',
  'crowfoot_many',
  'crowfoot_one',
  'crowfoot_one_or_many',
  'cardinality_one',
  'cardinality_many',
  'cardinality_one_or_many',
  'cardinality_exactly_one',
  'cardinality_zero_or_one',
  'cardinality_zero_or_many',
] as const;
export const lineTypes = ['sharp', 'curved', 'elbow'] as const;
export const markerLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export function distanceToSegment(
  point: Point,
  start: Point,
  end: Point,
): number {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy || 1),
    ),
  );
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}
export const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
export const flattenPoints = (points: Point[]) =>
  points.flatMap(({ x, y }) => [x, y]);
export function worldPoint(point: Point, owner?: Geometry): Point {
  const { x, y } = owner
    ? toWorldGeometry({ ...owner, ...point, rotation: 0 }, owner)
    : point;
  return { x, y };
}
export function localPoint(point: Point, owner?: Geometry): Point {
  const { x, y } = owner
    ? toLocalGeometry({ ...owner, ...point, rotation: 0 }, owner)
    : point;
  return { x, y };
}
export function constrainPoint(
  origin: Point,
  point: Point,
  shift: boolean,
): Point {
  if (!shift) return point;
  const angle =
    (Math.round(
      Math.atan2(point.y - origin.y, point.x - origin.x) / (Math.PI / 4),
    ) *
      Math.PI) /
    4;
  const length = distance(origin, point);
  return {
    x: origin.x + Math.cos(angle) * length,
    y: origin.y + Math.sin(angle) * length,
  };
}

/** A preferred attachment slides along the outline when its next segment would enter the shape. */
export function resolveEndpoint(
  document: RecursiveDocument,
  end: Endpoint,
  world: Map<string, Geometry>,
  owner?: Geometry,
  toward?: Point,
): Point | null {
  if (end.kind === 'free') return { x: end.x, y: end.y };
  const target = world.get(end.objectId);
  if (!target) return null;
  const object = document.objects[end.objectId];
  const placement =
    end.kind === 'boundary'
      ? object.boundaryPoints![end.pointId]
      : end.binding === 'auto' && toward
        ? boundaryPlacement(worldPoint(toward, owner), target)
        : end;
  let at = boundaryPosition(placement, target, object);
  if (end.kind === 'object' && end.binding === 'fixed' && toward) {
    const next = localPoint(worldPoint(toward, owner), target);
    const a = target.width / 2,
      b = target.height / 2;
    const dx = (next.x - at.x) / a,
      dy = (next.y - at.y) / b;
    let facing: number;
    if (object.type === 'diamond')
      facing =
        (at.x === 0 ? Math.abs(dx) : Math.sign(at.x) * dx) +
        (at.y === 0 ? Math.abs(dy) : Math.sign(at.y) * dy);
    else if (object.type === 'ellipse')
      facing = (at.x / a) * dx + (at.y / b) * dy;
    else {
      const radius =
        typeof object.style?.cornerRadius === 'number'
          ? Math.max(0, Math.min(a, b, object.style.cornerRadius))
          : 0;
      facing = radius
        ? Math.sign(at.x) * Math.max(0, Math.abs(at.x) - a + radius) * dx * a +
          Math.sign(at.y) * Math.max(0, Math.abs(at.y) - b + radius) * dy * b
        : Math.max(
            Math.abs(at.x) === a ? Math.sign(at.x) * dx : -Infinity,
            Math.abs(at.y) === b ? Math.sign(at.y) * dy : -Infinity,
          );
    }
    if (facing < -1e-9) {
      at = boundaryPosition(
        boundaryPlacement(worldPoint(toward, owner), target),
        target,
        object,
      );
    }
  }
  if (end.kind === 'object' && end.binding) {
    const length = Math.hypot(at.x, at.y) || 1;
    at.x += (at.x / length) * 8;
    at.y += (at.y / length) * 8;
  }
  return localPoint(worldPoint(at, target), owner);
}

type Box = { left: number; top: number; right: number; bottom: number };
const inside = (p: Point, b: Box) =>
  p.x > b.left + 0.001 &&
  p.x < b.right - 0.001 &&
  p.y > b.top + 0.001 &&
  p.y < b.bottom - 0.001;
function crosses(a: Point, b: Point, box: Box) {
  return a.x === b.x
    ? a.x > box.left &&
        a.x < box.right &&
        Math.max(a.y, b.y) > box.top &&
        Math.min(a.y, b.y) < box.bottom
    : a.y > box.top &&
        a.y < box.bottom &&
        Math.max(a.x, b.x) > box.left &&
        Math.min(a.x, b.x) < box.right;
}
function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    if (result.length && distance(result[result.length - 1], p) < 0.001)
      continue;
    const a = result.at(-2),
      b = result.at(-1);
    if (
      a &&
      b &&
      ((a.x === b.x && b.x === p.x && (b.y - a.y) * (p.y - b.y) >= 0) ||
        (a.y === b.y && b.y === p.y && (b.x - a.x) * (p.x - b.x) >= 0))
    )
      result.pop();
    result.push(p);
  }
  return result;
}
/** A small orthogonal visibility grid around the two bound shapes. Each state retains its heading so bends have a cost. */
function orthogonal(a: Point, b: Point, obstacles: Box[]): Point[] {
  const boxes = obstacles.filter((box) => !inside(a, box) && !inside(b, box));
  const xs = [
    ...new Set([
      a.x,
      b.x,
      (a.x + b.x) / 2,
      ...boxes.flatMap((box) => [box.left, box.right]),
    ]),
  ].sort((x, y) => x - y);
  const ys = [
    ...new Set([
      a.y,
      b.y,
      (a.y + b.y) / 2,
      ...boxes.flatMap((box) => [box.top, box.bottom]),
    ]),
  ].sort((x, y) => x - y);
  const nodes = xs.flatMap((x) => ys.map((y) => ({ x, y })));
  const start = nodes.findIndex((p) => p.x === a.x && p.y === a.y);
  const end = nodes.findIndex((p) => p.x === b.x && p.y === b.y);
  const costs = new Map<number, number>([
    [start * 2, 0],
    [start * 2 + 1, 0],
  ]);
  const previous = new Map<number, number>();
  const pending = new Set(costs.keys());
  while (pending.size) {
    const state = [...pending].reduce((best, key) =>
      costs.get(key)! < costs.get(best)! ? key : best,
    );
    pending.delete(state);
    const index = Math.floor(state / 2),
      p = nodes[index];
    if (index === end) {
      const route = [p];
      for (let cursor = state; previous.has(cursor);) {
        cursor = previous.get(cursor)!;
        route.unshift(nodes[Math.floor(cursor / 2)]);
      }
      return simplify(route);
    }
    const xi = Math.floor(index / ys.length),
      yi = index % ys.length;
    for (const [nx, ny, heading] of [
      [xi - 1, yi, 0],
      [xi + 1, yi, 0],
      [xi, yi - 1, 1],
      [xi, yi + 1, 1],
    ]) {
      if (nx < 0 || nx >= xs.length || ny < 0 || ny >= ys.length) continue;
      const next = nx * ys.length + ny,
        q = nodes[next];
      if (boxes.some((box) => crosses(p, q, box))) continue;
      const key = next * 2 + heading;
      const cost =
        costs.get(state)! + distance(p, q) + (state % 2 === heading ? 0 : 20);
      if (cost >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, cost);
      previous.set(key, state);
      pending.add(key);
    }
  }
  return simplify([a, { x: b.x, y: a.y }, b]);
}
function cubicPoints(vertices: Point[]): Point[] {
  const result = [vertices[0]];
  for (let i = 0; i < vertices.length - 1; i++) {
    const p0 = vertices[Math.max(0, i - 1)],
      p1 = vertices[i],
      p2 = vertices[i + 1],
      p3 = vertices[Math.min(vertices.length - 1, i + 2)];
    result.push(
      { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2,
    );
  }
  return result;
}
export function sampleCurve(points: Point[]): Point[] {
  const samples = [points[0]];
  for (let i = 1; i < points.length; i += 3) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1],
      d = points[i + 2];
    for (let step = 1; step <= 20; step++) {
      const t = step / 20,
        u = 1 - t;
      samples.push({
        x:
          u ** 3 * a.x +
          3 * u ** 2 * t * b.x +
          3 * u * t ** 2 * c.x +
          t ** 3 * d.x,
        y:
          u ** 3 * a.y +
          3 * u ** 2 * t * b.y +
          3 * u * t ** 2 * c.y +
          t ** 3 * d.y,
      });
    }
  }
  return samples;
}
function halfway(points: Point[]): Point {
  const lengths = points.slice(1).map((p, i) => distance(points[i], p));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] ? remaining / lengths[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    remaining -= lengths[i];
  }
  return points[0];
}
export function connectionRoute(
  document: RecursiveDocument,
  connection: DiagramConnection,
  world: Map<string, Geometry>,
) {
  const owner =
    connection.ownerId === null ? undefined : world.get(connection.ownerId);
  let start = resolveEndpoint(document, connection.start, world, owner),
    end = resolveEndpoint(document, connection.end, world, owner);
  if (!start || !end) return null;
  const authored = connection.points ?? [];
  // Sliding either endpoint can hide the other's preferred point. Recheck both
  // against the resolved segment, rather than the original far-side anchor.
  for (let pass = 0; pass < 2; pass++) {
    start = resolveEndpoint(
      document,
      connection.start,
      world,
      owner,
      authored[0] ?? end,
    )!;
    end = resolveEndpoint(
      document,
      connection.end,
      world,
      owner,
      authored.at(-1) ?? start,
    )!;
  }
  const vertices = [start, ...authored, end];
  const bezier = connection.style?.lineType === 'curved';
  let route = vertices;
  if (connection.style?.lineType === 'elbow') {
    const boxes = [connection.start, connection.end].flatMap((endpoint) => {
      if (endpoint.kind !== 'object') return [];
      const g = world.get(endpoint.objectId)!;
      const local = owner ? toLocalGeometry(g, owner) : g;
      const radians = (local.rotation * Math.PI) / 180;
      const w =
        Math.abs(local.width * Math.cos(radians)) +
        Math.abs(local.height * Math.sin(radians));
      const h =
        Math.abs(local.width * Math.sin(radians)) +
        Math.abs(local.height * Math.cos(radians));
      return [
        {
          left: local.x - w / 2 - 4,
          right: local.x + w / 2 + 4,
          top: local.y - h / 2 - 4,
          bottom: local.y + h / 2 + 4,
        },
      ];
    });
    const exit = (point: Point, endpoint: Endpoint): Point => {
      if (endpoint.kind !== 'object') return point;
      const g = world.get(endpoint.objectId)!;
      const center = localPoint(g, owner);
      const box =
        boxes[
          [connection.start, connection.end]
            .filter((e) => e.kind === 'object')
            .indexOf(endpoint)
        ];
      const dx = point.x - center.x,
        dy = point.y - center.y;
      return Math.abs(dx) / (box.right - box.left) >=
        Math.abs(dy) / (box.bottom - box.top)
        ? {
            x:
              dx >= 0
                ? Math.max(point.x + 16, box.right)
                : Math.min(point.x - 16, box.left),
            y: point.y,
          }
        : {
            x: point.x,
            y:
              dy >= 0
                ? Math.max(point.y + 16, box.bottom)
                : Math.min(point.y - 16, box.top),
          };
    };
    const pins = [
      exit(start, connection.start),
      ...authored,
      exit(end, connection.end),
    ];
    route = simplify([
      start,
      ...pins.slice(1).flatMap((p, i) => orthogonal(pins[i], p, boxes)),
      end,
    ]);
  } else if (bezier)
    route =
      authored.length === 0 && connection.points === undefined
        ? [
            start,
            { x: (start.x + end.x) / 2, y: start.y },
            { x: (start.x + end.x) / 2, y: end.y },
            end,
          ]
        : cubicPoints(vertices);
  const samples = bezier ? sampleCurve(route) : route;
  return {
    vertices,
    route,
    points: flattenPoints(route),
    bezier,
    label: halfway(samples),
    samples,
  };
}
export type ConnectionRoute = NonNullable<ReturnType<typeof connectionRoute>>;
export function labelSize(label: string) {
  const lines = label.split('\n');
  return {
    width: Math.max(40, ...lines.map((line) => line.length * 14)) + 12,
    height: Math.max(1, lines.length) * 18 + 8,
  };
}
