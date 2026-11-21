import type {
  DiagramConnection,
  Endpoint,
  Geometry,
  RecursiveDocument,
  Side,
} from './recursiveDocument';
import type { Point } from './recursiveCreation';
import { boundaryPlacement, boundaryPosition } from './recursiveBoundary';
import { toLocalGeometry } from './recursiveHierarchy';
import {
  flattenPoints,
  labelFraction,
  labelSize,
  localPoint,
  pointAlong,
  visibleEndpoint,
  worldPoint,
  type ConnectionRoute,
} from './connectionGeometry';
import { PILL_HEIGHT, entityTags, pillStyle, tagPillLayout } from './tags';
import { measureText } from './textMeasure';

/** Derived "avoid shapes" routing for elbow connectors. Nothing here is stored:
 * routes depend only on the document and are rebuilt for every scene. */
export type Box = { left: number; top: number; right: number; bottom: number };
const PAD = 8, // least obstacle clearance, used only where a corridor is narrow
  CLEAR = 16, // comfortable clearance kept from shapes wherever there is room
  CROWDED = 1, // extra cost per unit travelled inside the comfortable clearance
  STUB = 24, // straight exit from a shape before the first bend
  LANE = 12, // spacing of parallel tracks in a shared corridor
  MIN_JOG = 14, // shortest bend between two parallel segments
  MIN_END = 20, // shortest first or last segment: room for the arrowhead
  ARROW = 13, // shortest first or last segment in a narrow gap
  BEND = 30;

export const avoidsShapes = (connection: DiagramConnection) =>
  connection.style?.lineType === 'elbow' &&
  connection.style.avoidShapes === true &&
  !connection.points?.length;

export function boxOf(geometry: Geometry, owner?: Geometry, pad = 0): Box {
  const g = owner ? toLocalGeometry(geometry, owner) : geometry;
  const r = (g.rotation * Math.PI) / 180;
  const w = Math.abs(g.width * Math.cos(r)) + Math.abs(g.height * Math.sin(r));
  const h = Math.abs(g.width * Math.sin(r)) + Math.abs(g.height * Math.cos(r));
  return {
    left: g.x - w / 2 - pad,
    right: g.x + w / 2 + pad,
    top: g.y - h / 2 - pad,
    bottom: g.y + h / 2 + pad,
  };
}
const grow = (b: Box, pad: number): Box => ({
  left: b.left - pad,
  right: b.right + pad,
  top: b.top - pad,
  bottom: b.bottom + pad,
});
const strictlyInside = (p: Point, b: Box) =>
  p.x > b.left && p.x < b.right && p.y > b.top && p.y < b.bottom;
export const boxesIntersect = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const normals: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** Binary min-heap keyed by cost, then state, so ties resolve deterministically. */
class Heap {
  items: [number, number][] = [];
  push(item: [number, number]) {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (less(a[p], a[i])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items,
      top = a[0],
      last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
const less = (a: [number, number], b: [number, number]) =>
  a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** Shortest orthogonal path on a visibility grid of obstacle edges, with a
 * bend penalty. `exitA` is the outward normal the path leaves `a` along, and
 * `exitB` the normal of the side it arrives at `b` through; neither end may
 * double back toward its shape. Travel inside a `soft` box (the comfortable
 * clearance around a shape) costs extra, so narrow gaps are used only when a
 * clear corridor is much longer. */
export function gridRoute(
  a: Point,
  b: Point,
  obstacles: Box[],
  exitA?: Point,
  exitB?: Point,
  lines: Box[] = [],
  soft: Box[] = [],
): Point[] | null {
  const boxes = obstacles.filter(
    (box) => !strictlyInside(a, box) && !strictlyInside(b, box),
  );
  const values = (keys: ('left' | 'right' | 'top' | 'bottom')[], p: number[]) =>
    [
      ...new Set([
        ...p,
        ...[...boxes, ...lines, ...soft].flatMap((box) =>
          keys.map((k) => box[k]),
        ),
      ]),
    ].sort((x, y) => x - y);
  const xs = values(['left', 'right'], [a.x, b.x]);
  const ys = values(['top', 'bottom'], [a.y, b.y]);
  const nx = xs.length,
    ny = ys.length;
  const xi = new Map(xs.map((x, i) => [x, i])),
    yi = new Map(ys.map((y, i) => [y, i]));
  // A cell is blocked inside any box; an edge is blocked between two blocked cells.
  const fill = (list: Box[]) => {
    const cells = new Uint8Array(Math.max(0, (nx - 1) * (ny - 1)));
    for (const box of list)
      for (let i = xi.get(box.left)!; i < xi.get(box.right)!; i++)
        for (let j = yi.get(box.top)!; j < yi.get(box.bottom)!; j++)
          cells[i * (ny - 1) + j] = 1;
    return cells;
  };
  const blocked = fill(boxes),
    crowded = fill(soft);
  const at = (cells: Uint8Array) => (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx - 1 && j < ny - 1 && cells[i * (ny - 1) + j];
  const between =
    (cell: (i: number, j: number) => number | boolean) =>
    (i: number, j: number, di: number, dj: number) =>
      di
        ? cell(Math.min(i, i + di), j - 1) && cell(Math.min(i, i + di), j)
        : cell(i - 1, Math.min(j, j + dj)) && cell(i, Math.min(j, j + dj));
  const walled = between(at(blocked)),
    tight = between(at(crowded));
  const free = (i: number, j: number, di: number, dj: number) =>
    !walled(i, j, di, dj);
  const axisA = exitA && (exitA.x ? 0 : 1),
    axisB = exitB && (exitB.x ? 0 : 1);
  const start = xi.get(a.x)! * ny + yi.get(a.y)!,
    end = xi.get(b.x)! * ny + yi.get(b.y)!;
  const costs = new Float64Array(nx * ny * 2).fill(Infinity);
  const previous = new Int32Array(nx * ny * 2).fill(-1);
  const heap = new Heap();
  // A*: every step costs at least its length, so the remaining Manhattan
  // distance never overestimates.
  const remaining = (node: number) =>
    Math.abs(xs[Math.floor(node / ny)] - b.x) + Math.abs(ys[node % ny] - b.y);
  for (const heading of [0, 1])
    if (axisA === undefined || axisA === heading) {
      costs[start * 2 + heading] = 0;
      heap.push([remaining(start), start * 2 + heading]);
    }
  let found = -1;
  while (heap.items.length) {
    const [estimate, state] = heap.pop();
    const node = state >> 1,
      heading = state & 1;
    const cost = costs[state];
    if (estimate > cost + remaining(node) + 1e-9) continue;
    if (node === end) {
      found = state;
      break;
    }
    const i = Math.floor(node / ny),
      j = node % ny;
    for (const [di, dj] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const ni = i + di,
        nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || !free(i, j, di, dj))
        continue;
      const next = ni * ny + nj,
        h = di ? 0 : 1;
      if (node === start && exitA && di === -exitA.x && dj === -exitA.y)
        continue;
      if (next === end && exitB && di === exitB.x && dj === exitB.y) continue;
      const length = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
      let step =
        cost +
        length * (tight(i, j, di, dj) ? 1 + CROWDED : 1) +
        (h === heading ? 0 : BEND);
      if (next === end && axisB !== undefined && h !== axisB) step += BEND;
      const key = next * 2 + h;
      if (step < costs[key]) {
        costs[key] = step;
        previous[key] = state;
        heap.push([step + remaining(next), key]);
      }
    }
  }
  if (found < 0) return null;
  const path: Point[] = [];
  for (let s = found; s >= 0; s = previous[s]) {
    const n = s >> 1;
    path.unshift({ x: xs[Math.floor(n / ny)], y: ys[n % ny] });
  }
  return orthogonalSimplify(path);
}
function orthogonalSimplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    const last = result.at(-1);
    if (last && last.x === p.x && last.y === p.y) continue;
    const before = result.at(-2);
    if (
      before &&
      last &&
      ((before.x === last.x && last.x === p.x) ||
        (before.y === last.y && last.y === p.y))
    )
      result.pop();
    result.push(p);
  }
  return result;
}

type End = {
  point: Point;
  pin: Point;
  exit?: Point;
  objectId?: string;
  /** Range the attachment may slide along its side, for router-chosen ports. */
  slide?: { min: number; max: number };
};
type Segment = {
  id: string;
  index: number;
  horizontal: boolean;
  at: number;
  lo: number;
  hi: number;
  /** Range `at` may move to, or null for a segment pinned by a fixed port. */
  range: [number, number] | null;
  /** The same with only the arrowhead itself kept clear, for narrow gaps. */
  tight: [number, number] | null;
};
const coordinate = (p: Point, horizontal: boolean) => (horizontal ? p.y : p.x);
/** Where segment `index` of a route may move sideways without turning a
 * neighbouring segment around or shortening it below a readable bend (or
 * below the arrowhead's room at a port). `skip` ignores one neighbour, which
 * the caller is about to remove. */
function limits(
  points: Point[],
  index: number,
  [start, end]: End[],
  skip?: 'before' | 'after',
  [arrow, jog] = [MIN_END, MIN_JOG],
): [number, number] | null {
  const n = points.length,
    a = points[index],
    b = points[index + 1];
  const horizontal = a.y === b.y;
  let min = -Infinity,
    max = Infinity;
  for (const [port, at] of [
    [start, 0],
    [end, n - 2],
  ] as const)
    if (index === at) {
      if (!port.slide) return null;
      min = Math.max(min, port.slide.min);
      max = Math.min(max, port.slide.max);
    }
  const c = (p: Point) => coordinate(p, horizontal);
  if (index > 0 && skip !== 'before') {
    const length = c(a) - c(points[index - 1]);
    const need = Math.min(index - 1 === 0 ? arrow : jog, Math.abs(length));
    if (length > 0) min = Math.max(min, c(points[index - 1]) + need);
    else max = Math.min(max, c(points[index - 1]) - need);
  }
  if (index + 2 < n && skip !== 'after') {
    const length = c(points[index + 2]) - c(b);
    const need = Math.min(index + 1 === n - 2 ? arrow : jog, Math.abs(length));
    if (length > 0) max = Math.min(max, c(points[index + 2]) - need);
    else min = Math.max(min, c(points[index + 2]) + need);
  }
  return [min, max];
}
function segments(
  routes: Map<string, Point[]>,
  ends: Map<string, End[]>,
): Segment[] {
  const result: Segment[] = [];
  for (const [id, points] of routes)
    for (let index = 0; index < points.length - 1; index++) {
      const a = points[index],
        b = points[index + 1];
      if (a.x === b.x && a.y === b.y) continue;
      const horizontal = a.y === b.y;
      result.push({
        id,
        index,
        horizontal,
        at: horizontal ? a.y : a.x,
        lo: horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
        hi: horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
        range: limits(points, index, ends.get(id)!),
        tight: limits(points, index, ends.get(id)!, undefined, [ARROW, ARROW]),
      });
    }
  return result;
}
/** Parallel segments whose spans overlap or touch, closer than `gap`. */
const near = (a: Segment, b: Segment, gap: number) =>
  Math.abs(a.at - b.at) < gap && a.lo <= b.hi && b.lo <= a.hi;
/** Shift one segment, dragging a router-chosen port along its side. */
function move(points: Point[], index: number, horizontal: boolean, to: number) {
  for (const p of [points[index], points[index + 1]])
    if (horizontal) p.y = to;
    else p.x = to;
}
/** Spread segments of different connectors that share, or nearly share, a
 * corridor (port segments included) onto parallel tracks a lane apart, kept a
 * comfortable distance from shapes where the corridor allows. Returns whether
 * anything moved. */
function nudge(
  routes: Map<string, Point[]>,
  ends: Map<string, End[]>,
  boxes: Box[],
  horizontal: boolean,
): boolean {
  const all = segments(routes, ends).filter((s) => s.horizontal === horizontal);
  const lanes = all
    .filter((s) => s.range)
    .sort((a, b) => a.at - b.at || a.lo - b.lo || (a.id < b.id ? -1 : 1));
  const exits = all.filter((s) => !s.range);
  // Union lanes of different connectors that run within one lane spacing.
  const parent = lanes.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < lanes.length; i++)
    for (
      let j = i + 1;
      j < lanes.length && lanes[j].at - lanes[i].at < LANE - 1e-6;
      j++
    )
      if (lanes[i].id !== lanes[j].id && near(lanes[i], lanes[j], LANE - 1e-6))
        parent[find(j)] = find(i);
  const clusters = new Map<number, Segment[]>();
  lanes.forEach((segment, i) => {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(segment);
  });
  let moved = false;
  for (const cluster of clusters.values()) {
    const crowded = (s: Segment) =>
      exits.some((e) => e.id !== s.id && near(s, e, LANE - 1e-6));
    // A lone segment moves only to regain comfortable clearance from a shape.
    const cramped = (s: Segment) =>
      boxes.some((box) => {
        const [from, to, a, b] = horizontal
          ? [box.left, box.right, box.top, box.bottom]
          : [box.top, box.bottom, box.left, box.right];
        return (
          from < s.hi &&
          to > s.lo &&
          ((s.at <= a && a - s.at < CLEAR - 1e-6) ||
            (s.at >= b && s.at - b < CLEAR - 1e-6))
        );
      });
    if (cluster.length < 2 && !crowded(cluster[0]) && !cramped(cluster[0]))
      continue;
    const members = new Set(cluster);
    const lo = Math.min(...cluster.map((s) => s.lo)),
      hi = Math.max(...cluster.map((s) => s.hi));
    const center = cluster.reduce((sum, s) => sum + s.at, 0) / cluster.length;
    const ids = new Set(cluster.map((s) => s.id));
    // Shapes keep a margin; other connectors' lines keep a lane.
    const bounds = (shape: number, line: number) => {
      let below = -Infinity,
        above = Infinity;
      const limit = (s: number, e: number, a: number, b: number, m: number) => {
        if (s > hi || e < lo || (a < center && b > center)) return;
        if (a >= center) above = Math.min(above, a - m);
        else below = Math.max(below, b + m);
      };
      for (const box of boxes)
        if (horizontal)
          limit(box.left + 1e-6, box.right - 1e-6, box.top, box.bottom, shape);
        else
          limit(box.top + 1e-6, box.bottom - 1e-6, box.left, box.right, shape);
      for (const other of [...exits, ...lanes])
        if (!members.has(other) && !ids.has(other.id))
          limit(other.lo, other.hi, other.at, other.at, line);
      return [below, above];
    };
    // Segments that do not overlap may share a track (interval colouring), when
    // the break between them is wide enough not to read as one line.
    const slot: number[] = [],
      reach: number[] = [];
    for (const s of cluster) {
      let t = reach.findIndex((end) => end + 3 * LANE <= s.lo);
      if (t < 0) t = reach.length;
      reach[t] = s.hi;
      slot.push(t);
    }
    const m = reach.length;
    let tracks: number[] | null = null;
    // Comfortable spacing first; narrow corridors give up clearance, then
    // segment length down to the arrowhead, then lane width.
    for (const [shape, line, space, narrow] of [
      [CLEAR, LANE, LANE, 0],
      [PAD, LANE, LANE, 0],
      [4, LANE, LANE, 0],
      [PAD, LANE, LANE, 1],
      [4, LANE, LANE, 1],
      [4, 8, 8, 1],
      [4, 6, 6, 1],
    ]) {
      const [below, above] = bounds(shape, line);
      let from = below,
        to = above - (m - 1) * space;
      cluster.forEach((s, k) => {
        const [min, max] = (narrow ? s.tight : s.range)!;
        from = Math.max(from, min - slot[k] * space);
        to = Math.min(to, max - slot[k] * space);
      });
      if (from > to + 1e-6) continue;
      const first = Math.min(
        Math.max(center - ((m - 1) * space) / 2, from),
        to,
      );
      tracks = slot.map((t) => first + t * space);
      break;
    }
    if (!tracks) continue;
    cluster.forEach((segment, k) => {
      if (Math.abs(tracks![k] - segment.at) < 1e-6) return;
      move(routes.get(segment.id)!, segment.index, horizontal, tracks![k]);
      moved = true;
    });
  }
  return moved;
}
/** Does an axis-aligned segment pass through the open interior of a box? */
const crosses = (a: Point, b: Point, box: Box) =>
  Math.max(a.x, b.x) > box.left &&
  Math.min(a.x, b.x) < box.right &&
  Math.max(a.y, b.y) > box.top &&
  Math.min(a.y, b.y) < box.bottom;
/** Remove short stair-steps: line up the two parallel segments around a short
 * bend when one of them can move there without entering a shape or running on
 * top of another connector. A fixed port keeps its segment; the other moves. */
function straighten(
  routes: Map<string, Point[]>,
  ends: Map<string, End[]>,
  blocking: Map<string, Box[]>,
) {
  let all = segments(routes, ends);
  for (const [id, points] of routes)
    for (let i = 1; i + 2 < points.length; i++) {
      const [p, a, b, q] = points.slice(i - 1, i + 3);
      const horizontal = a.y === b.y;
      if (Math.abs(horizontal ? b.x - a.x : b.y - a.y) >= MIN_JOG) continue;
      // Only stairs: both neighbours run the same way.
      const along = (from: Point, to: Point) =>
        horizontal ? Math.sign(to.y - from.y) : Math.sign(to.x - from.x);
      if (!along(p, a) || along(p, a) !== along(b, q)) continue;
      const c = (point: Point) => coordinate(point, !horizontal);
      for (const [index, to, skip] of [
        [i + 1, c(a), 'before'],
        [i - 1, c(b), 'after'],
      ] as const) {
        const range = limits(points, index, ends.get(id)!, skip);
        if (!range || to < range[0] - 1e-6 || to > range[1] + 1e-6) continue;
        const trial = points.map((point) => ({ ...point }));
        move(trial, index, !horizontal, to);
        const [s, e] = [trial[index], trial[index + 1]];
        if (blocking.get(id)!.some((box) => crosses(s, e, box))) continue;
        const lo = horizontal ? Math.min(s.y, e.y) : Math.min(s.x, e.x),
          hi = horizontal ? Math.max(s.y, e.y) : Math.max(s.x, e.x);
        if (
          all.some(
            (o) =>
              o.id !== id &&
              o.horizontal !== horizontal &&
              Math.abs(o.at - to) < LANE - 1e-6 &&
              o.lo <= hi &&
              lo <= o.hi,
          )
        )
          continue;
        points.splice(0, points.length, ...orthogonalSimplify(trial));
        all = segments(routes, ends);
        i = 0;
        break;
      }
    }
}

/** Route every avoid-mode connector of one owner scope. `routes` holds the
 * ordinary routes, used for endpoints that keep their authored attachment. */
export function avoidingRoutes(
  document: RecursiveDocument,
  world: Map<string, Geometry>,
  connections: DiagramConnection[],
  routes: Map<string, ConnectionRoute>,
): Map<string, ConnectionRoute> {
  const result = new Map<string, ConnectionRoute>();
  const scopes = new Map<string | null, DiagramConnection[]>();
  for (const c of connections
    .filter((c) => avoidsShapes(c) && routes.has(c.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!scopes.has(c.ownerId)) scopes.set(c.ownerId, []);
    scopes.get(c.ownerId)!.push(c);
  }
  for (const [ownerId, members] of scopes) {
    const owner = ownerId === null ? undefined : world.get(ownerId);
    const ancestors = (id: string) => {
      const ids = new Set<string>();
      for (
        let p = document.objects[id].parentId;
        p !== null && p !== ownerId;
        p = document.objects[p].parentId
      )
        ids.add(p);
      return ids;
    };
    const targets = members.map((c) =>
      [c.start, c.end].map((end) => visibleEndpoint(document, end, world)),
    );
    // Obstacles: visible siblings along every endpoint's ancestry inside the owner.
    const parents = new Set<string | null>([ownerId]);
    for (const ends of targets)
      for (const end of ends)
        if (end.kind !== 'free' && end.objectId !== ownerId)
          for (const id of ancestors(end.objectId)) parents.add(id);
    const obstacles = [...world.keys()]
      .filter((id) => parents.has(document.objects[id].parentId))
      .sort()
      .map((id) => ({ id, box: boxOf(world.get(id)!, owner) }));
    const boxes = obstacles.map((o) => o.box);
    const center = (end: Endpoint, fallback: Point) =>
      end.kind === 'free' || end.objectId === ownerId
        ? fallback
        : localPoint(world.get(end.objectId)!, owner);
    // Ports: router-chosen sides, spread along a side shared by several connectors.
    const ports = new Map<string, { key: string; along: number }[]>();
    const sides = members.map((c, n) => {
      const route = routes.get(c.id)!;
      const points = [route.vertices[0], route.vertices.at(-1)!];
      return targets[n].map((end, k) => {
        if (
          end.kind !== 'object' ||
          end.objectId === ownerId ||
          end.binding === 'fixed' ||
          (owner
            ? toLocalGeometry(world.get(end.objectId)!, owner)
            : world.get(end.objectId)!
          ).rotation %
            360 !==
            0
        )
          return null;
        const other = center(targets[n][1 - k], points[1 - k]);
        const side = boundaryPlacement(
          worldPoint(other, owner),
          world.get(end.objectId)!,
        ).side;
        const slot = `${end.objectId}/${side}`;
        if (!ports.has(slot)) ports.set(slot, []);
        ports.get(slot)!.push({
          key: `${c.id}/${k}`,
          along: side === 'top' || side === 'bottom' ? other.x : other.y,
        });
        return side;
      });
    });
    const offsets = new Map<string, number>();
    for (const slot of ports.values()) {
      slot.sort((a, b) => a.along - b.along || (a.key < b.key ? -1 : 1));
      slot.forEach(({ key }, i) =>
        offsets.set(key, (i + 1) / (slot.length + 1)),
      );
    }
    // Containers around a connector's own endpoints are not its obstacles.
    const skips = targets.map(
      (pair) =>
        new Set(
          pair.flatMap((end) =>
            end.kind === 'free' || end.objectId === ownerId
              ? []
              : [...ancestors(end.objectId)],
          ),
        ),
    );
    const ends: End[][] = members.map((c, n) => {
      const route = routes.get(c.id)!;
      return targets[n].map((end, k) => {
        const side = sides[n][k];
        let point = k ? route.vertices.at(-1)! : route.vertices[0];
        if (end.kind === 'free' || end.objectId === ownerId)
          return { point, pin: point };
        const target = world.get(end.objectId)!;
        const object = document.objects[end.objectId];
        const box = boxOf(target, owner);
        let normal: Point;
        let slide: End['slide'];
        if (side) {
          normal = normals[side];
          const at = boundaryPosition(
            { side, offset: offsets.get(`${c.id}/${k}`)! },
            target,
            object,
          );
          point = localPoint(worldPoint(at, target), owner);
          if (end.kind === 'object' && end.binding)
            point = { x: point.x + normal.x * 8, y: point.y + normal.y * 8 };
          // Straight sides let a lane drag the attachment along them.
          if (object.type !== 'ellipse' && object.type !== 'diamond') {
            const [from, to] = normal.x
              ? [box.top, box.bottom]
              : [box.left, box.right];
            const radius =
              typeof object.style?.cornerRadius === 'number'
                ? Math.max(0, object.style.cornerRadius)
                : 0;
            const margin = Math.min(Math.max(12, radius + 4), (to - from) / 2);
            const now = normal.x ? point.y : point.x;
            slide = {
              min: Math.min(from + margin, now),
              max: Math.max(to - margin, now),
            };
          }
        } else {
          const dx =
              (point.x - (box.left + box.right) / 2) / (box.right - box.left),
            dy =
              (point.y - (box.top + box.bottom) / 2) / (box.bottom - box.top);
          normal =
            Math.abs(dx) >= Math.abs(dy)
              ? { x: Math.sign(dx) || 1, y: 0 }
              : { x: 0, y: Math.sign(dy) || 1 };
        }
        const edge =
          normal.x > 0
            ? box.right
            : normal.x < 0
              ? -box.left
              : normal.y > 0
                ? box.bottom
                : -box.top;
        const along = normal.x ? point.x * normal.x : point.y * normal.y;
        const pinAt = (extra: number) => {
          const reach = Math.max(along, edge) + extra - along;
          return {
            x: point.x + normal.x * reach,
            y: point.y + normal.y * reach,
          };
        };
        // Shorten the exit stub only when a neighbour is closer than a full stub.
        let extra = STUB;
        for (extra of [STUB, 18, 14, 10, 6])
          if (
            !obstacles.some(
              (o) =>
                o.id !== end.objectId &&
                !skips[n].has(o.id) &&
                strictlyInside(pinAt(extra), grow(o.box, 2)),
            )
          )
            break;
        return {
          point,
          pin: pinAt(extra),
          exit: normal,
          objectId: end.objectId,
          slide,
        };
      });
    });
    // Facing ports closer than two stubs share the gap between them evenly.
    for (const [a, b] of ends)
      if (
        a.exit &&
        b.exit &&
        a.exit.x === -b.exit.x &&
        a.exit.y === -b.exit.y
      ) {
        const reach = (end: End) =>
          (end.pin.x - end.point.x) * end.exit!.x +
          (end.pin.y - end.point.y) * end.exit!.y;
        const gap =
          (b.point.x - a.point.x) * a.exit.x +
          (b.point.y - a.point.y) * a.exit.y;
        if (gap > 0 && reach(a) + reach(b) > gap + 1e-6)
          for (const end of [a, b])
            end.pin = {
              x: end.point.x + (end.exit!.x * gap) / 2,
              y: end.point.y + (end.exit!.y * gap) / 2,
            };
      }
    const paths = new Map<string, Point[]>();
    const endsById = new Map<string, End[]>();
    const blocking = new Map<string, Box[]>();
    members.forEach((c, n) => {
      const [a, b] = ends[n];
      const skip = skips[n];
      const free = obstacles.filter((o) => !skip.has(o.id));
      // Clearance shrinks to the bare shape where a pin sits inside it.
      const hard = free.map((o) => {
        const padded = grow(o.box, PAD);
        return strictlyInside(a.pin, padded) || strictlyInside(b.pin, padded)
          ? o.box
          : padded;
      });
      const soft = free.map((o) => grow(o.box, CLEAR));
      // Search a window around the pins first; fall back to every obstacle.
      const span = Math.max(
        Math.abs(a.pin.x - b.pin.x),
        Math.abs(a.pin.y - b.pin.y),
      );
      const window = grow(
        {
          left: Math.min(a.pin.x, b.pin.x),
          right: Math.max(a.pin.x, b.pin.x),
          top: Math.min(a.pin.y, b.pin.y),
          bottom: Math.max(a.pin.y, b.pin.y),
        },
        Math.max(200, span / 2),
      );
      const inside = soft.map((box) => boxesIntersect(box, window));
      const path = gridRoute(
        a.pin,
        b.pin,
        hard.filter((_, i) => inside[i]),
        a.exit,
        b.exit,
        [window],
        soft.filter((_, i) => inside[i]),
      ) ??
        gridRoute(a.pin, b.pin, hard, a.exit, b.exit, [], soft) ?? [
          a.pin,
          { x: b.pin.x, y: a.pin.y },
          b.pin,
        ];
      paths.set(
        c.id,
        orthogonalSimplify([a.point, ...path, b.point].map((p) => ({ ...p }))),
      );
      endsById.set(c.id, ends[n]);
      const own = new Set(
        [a.objectId, b.objectId].filter((id) => id !== undefined),
      );
      blocking.set(
        c.id,
        free.map((o) => (own.has(o.id) ? o.box : grow(o.box, 4))),
      );
    });
    for (let round = 0; round < 6; round++) {
      const h = nudge(paths, endsById, boxes, true);
      const v = nudge(paths, endsById, boxes, false);
      if (!h && !v) break;
    }
    straighten(paths, endsById, blocking);
    // Labels slide along their path, away from shapes, earlier labels, other
    // connectors' lines and every arrowhead. Covering a shape or a label is
    // worse than covering a line.
    const hazards = new Buckets();
    for (const o of obstacles)
      hazards.add({ box: o.box, weight: 100, shape: o.id });
    const scope = [...routes.keys()]
      .filter((id) => document.connections[id]?.ownerId === ownerId)
      .sort();
    for (const id of scope) {
      const line = paths.get(id) ?? routes.get(id)!.samples;
      for (let i = 0; i < line.length - 1; i++)
        hazards.add({
          box: grow(span(line[i], line[i + 1]), STROKE),
          weight: 1,
          line: id,
        });
      for (const tip of [line[0], line.at(-1)!])
        hazards.add({ box: grow(span(tip, tip), TIP), weight: 1 });
      const c = document.connections[id];
      if (!paths.has(id) && (c.label || c.tags?.length))
        hazards.add({
          box: connectionLabelBox(document, c, routes.get(id)!.label),
          weight: 100,
        });
    }
    members.forEach((c, n) => {
      const route = orthogonalSimplify(paths.get(c.id)!);
      let label = pointAlong(route, labelFraction(c));
      const box = (at: Point) => connectionLabelBox(document, c, at);
      const labelled =
        !!c.label || entityTags(document.tagDefinitions, c).length > 0;
      if (labelled && typeof c.style?.labelPosition !== 'number') {
        let best = Infinity;
        for (let k = 0; k <= 72; k++) {
          const t = 0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.0125;
          const p = pointAlong(route, t);
          const area = grow(box(p), 2);
          let penalty = 0;
          hazards.visit(area, (hazard) => {
            if (hazard.line === c.id || skips[n].has(hazard.shape!)) return;
            penalty += hazard.weight * overlap(area, hazard.box);
          });
          if (penalty < best - 1e-9) {
            best = penalty;
            label = p;
          }
          if (!penalty) break;
        }
      }
      if (labelled) hazards.add({ box: box(label), weight: 100 });
      result.set(c.id, {
        vertices: [route[0], route.at(-1)!],
        route,
        points: flattenPoints(route),
        bezier: false,
        label,
        samples: route,
      });
    });
  }
  return result;
}
type Hazard = { box: Box; weight: number; line?: string; shape?: string };
/** A uniform grid of hazard boxes, so each label candidate only looks nearby. */
class Buckets {
  cells = new Map<number, Hazard[]>();
  marks = new Map<Hazard, number>();
  stamp = 0;
  range(box: Box, each: (key: number) => void) {
    for (
      let i = Math.floor(box.left / CELL);
      i <= Math.floor(box.right / CELL);
      i++
    )
      for (
        let j = Math.floor(box.top / CELL);
        j <= Math.floor(box.bottom / CELL);
        j++
      )
        each(i * 1048576 + j);
  }
  add(hazard: Hazard) {
    this.range(hazard.box, (key) => {
      const cell = this.cells.get(key);
      if (cell) cell.push(hazard);
      else this.cells.set(key, [hazard]);
    });
  }
  /** Each hazard overlapping `box` once, in insertion order per cell. */
  visit(box: Box, each: (hazard: Hazard) => void) {
    const stamp = ++this.stamp;
    this.range(box, (key) => {
      for (const hazard of this.cells.get(key) ?? [])
        if (
          this.marks.get(hazard) !== stamp &&
          boxesIntersect(hazard.box, box)
        ) {
          this.marks.set(hazard, stamp);
          each(hazard);
        }
    });
  }
}
const CELL = 64;
const STROKE = 3, // half-width of a line a label should not cover
  TIP = 9; // half-size of an arrowhead or end marker
const span = (a: Point, b: Point): Box => ({
  left: Math.min(a.x, b.x),
  right: Math.max(a.x, b.x),
  top: Math.min(a.y, b.y),
  bottom: Math.max(a.y, b.y),
});
const labelText = { font: 'Arial', size: 14, color: '#000000' };
/** The painted label (canvas width, as ConnectionPaint measures it) plus the
 * row of tag pills drawn under it, or the pill row alone without a label.
 * `pills` is the pill row's width. */
export function labelBox(at: Point, label: string, pills = 0): Box {
  const width = label
      ? Math.max(
          40,
          ...label.split('\n').map((line) => measureText(line, labelText)),
        ) + 12
      : 0,
    height = label ? labelSize(label).height : 0;
  if (!pills)
    return {
      left: at.x - width / 2,
      right: at.x + width / 2,
      top: at.y - height / 2,
      bottom: at.y + height / 2,
    };
  const half = Math.max(width, pills) / 2;
  return label
    ? {
        left: at.x - half,
        right: at.x + half,
        top: at.y - height / 2,
        bottom: at.y + height / 2 + 3 + PILL_HEIGHT,
      }
    : {
        left: at.x - half,
        right: at.x + half,
        top: at.y - PILL_HEIGHT / 2,
        bottom: at.y + PILL_HEIGHT / 2,
      };
}
/** Width of the pill row ConnectionTagPills draws for a connector. */
function pillRow(document: RecursiveDocument, c: DiagramConnection) {
  const pills = tagPillLayout(
    entityTags(document.tagDefinitions, c),
    240,
    (text) => measureText(text, pillStyle),
  );
  return pills.length ? pills.at(-1)!.x + pills.at(-1)!.width : 0;
}
export const connectionLabelBox = (
  document: RecursiveDocument,
  c: DiagramConnection,
  at: Point,
) => labelBox(at, c.label ?? '', pillRow(document, c));
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
