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

/** Derived "avoid shapes" routing for elbow connectors. Nothing here is stored:
 * routes depend only on the document and are rebuilt for every scene. */
export type Box = { left: number; top: number; right: number; bottom: number };
const PAD = 8, // obstacle clearance used by the search
  STUB = 20, // straight exit from a shape before the first bend
  LANE = 10, // spacing of parallel tracks in a shared corridor
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
 * bend penalty. `axis` 0/1 is the required horizontal/vertical exit or arrival. */
export function gridRoute(
  a: Point,
  b: Point,
  obstacles: Box[],
  axisA?: 0 | 1,
  axisB?: 0 | 1,
  lines: Box[] = [],
): Point[] | null {
  const boxes = obstacles.filter(
    (box) => !strictlyInside(a, box) && !strictlyInside(b, box),
  );
  const values = (keys: ('left' | 'right' | 'top' | 'bottom')[], p: number[]) =>
    [
      ...new Set([
        ...p,
        ...[...boxes, ...lines].flatMap((box) => keys.map((k) => box[k])),
      ]),
    ].sort((x, y) => x - y);
  const xs = values(['left', 'right'], [a.x, b.x]);
  const ys = values(['top', 'bottom'], [a.y, b.y]);
  const nx = xs.length,
    ny = ys.length;
  const xi = new Map(xs.map((x, i) => [x, i])),
    yi = new Map(ys.map((y, i) => [y, i]));
  // A cell is blocked inside any box; an edge is blocked between two blocked cells.
  const blocked = new Uint8Array(Math.max(0, (nx - 1) * (ny - 1)));
  for (const box of boxes)
    for (let i = xi.get(box.left)!; i < xi.get(box.right)!; i++)
      for (let j = yi.get(box.top)!; j < yi.get(box.bottom)!; j++)
        blocked[i * (ny - 1) + j] = 1;
  const cell = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx - 1 && j < ny - 1 && blocked[i * (ny - 1) + j];
  const free = (i: number, j: number, di: number, dj: number) =>
    di
      ? !(cell(Math.min(i, i + di), j - 1) && cell(Math.min(i, i + di), j))
      : !(cell(i - 1, Math.min(j, j + dj)) && cell(i, Math.min(j, j + dj)));
  const start = xi.get(a.x)! * ny + yi.get(a.y)!,
    end = xi.get(b.x)! * ny + yi.get(b.y)!;
  const costs = new Float64Array(nx * ny * 2).fill(Infinity);
  const previous = new Int32Array(nx * ny * 2).fill(-1);
  const heap = new Heap();
  for (const heading of [0, 1])
    if (axisA === undefined || axisA === heading) {
      costs[start * 2 + heading] = 0;
      heap.push([0, start * 2 + heading]);
    }
  let found = -1;
  while (heap.items.length) {
    const [cost, state] = heap.pop();
    if (cost > costs[state]) continue;
    const node = state >> 1,
      heading = state & 1;
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
      let step =
        cost +
        Math.abs(xs[ni] - xs[i]) +
        Math.abs(ys[nj] - ys[j]) +
        (h === heading ? 0 : BEND);
      if (next === end && axisB !== undefined && h !== axisB) step += BEND;
      const key = next * 2 + h;
      if (step < costs[key]) {
        costs[key] = step;
        previous[key] = state;
        heap.push([step, key]);
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

type Segment = {
  id: string;
  index: number;
  horizontal: boolean;
  at: number;
  lo: number;
  hi: number;
  fixed: boolean;
};
function segments(routes: Map<string, Point[]>): Segment[] {
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
        // Exit stubs and the jogs after them keep each port's pin in place.
        fixed: index <= 1 || index >= points.length - 3,
      });
    }
  return result;
}
/** Spread collinear overlapping segments of different connectors onto parallel
 * tracks inside the free corridor around them. Returns whether anything moved. */
function nudge(
  routes: Map<string, Point[]>,
  boxes: Box[],
  horizontal: boolean,
): boolean {
  const all = segments(routes).filter((s) => s.horizontal === horizontal);
  all.sort((a, b) => a.at - b.at || a.lo - b.lo || (a.id < b.id ? -1 : 1));
  let moved = false;
  for (let i = 0; i < all.length;) {
    // One cluster: same line, transitively overlapping spans.
    const cluster = [all[i]];
    let hi = all[i].hi;
    for (
      i++;
      i < all.length && all[i].at === cluster[0].at && all[i].lo < hi - 1e-6;
      i++
    ) {
      cluster.push(all[i]);
      hi = Math.max(hi, all[i].hi);
    }
    if (new Set(cluster.map((s) => s.id)).size < 2) continue;
    const at = cluster[0].at,
      lo = Math.min(...cluster.map((s) => s.lo));
    let below = -Infinity,
      above = Infinity;
    for (const box of boxes) {
      const [s, e, a, b] = horizontal
        ? [box.left, box.right, box.top, box.bottom]
        : [box.top, box.bottom, box.left, box.right];
      if (s >= hi || e <= lo || (a < at && b > at)) continue;
      if (a >= at) above = Math.min(above, a - 4);
      else below = Math.max(below, b + 4);
    }
    const movable = cluster.filter((s) => !s.fixed);
    const fixed = cluster.length - movable.length;
    const n = movable.length + (fixed ? 1 : 0);
    // Centered tracks, compressed to the corridor when it is too narrow.
    const space = Math.min(LANE, (above - below) / (n + 1));
    let first = at - ((n - 1) * space) / 2;
    first = Math.min(Math.max(first, below + space), above - (n - 1) * space);
    const tracks = Array.from({ length: n }, (_, k) => first + k * space);
    if (fixed) {
      // Fixed exits stay put; movable segments take the tracks farthest from them.
      tracks.sort((a, b) => Math.abs(a - at) - Math.abs(b - at));
      tracks.shift();
    }
    movable.forEach((segment, k) => {
      const track = tracks[k];
      if (track === undefined || track === at) return;
      const points = routes.get(segment.id)!;
      for (const p of [points[segment.index], points[segment.index + 1]])
        if (horizontal) p.y = track;
        else p.x = track;
      moved = true;
    });
  }
  return moved;
}

type End = {
  point: Point;
  pin: Point;
  axis?: 0 | 1;
  objectId?: string;
};
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
  for (const c of [...connections].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!avoidsShapes(c) || !routes.has(c.id)) continue;
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
    const ends: End[][] = members.map((c, n) => {
      const route = routes.get(c.id)!;
      return targets[n].map((end, k) => {
        const side = sides[n][k];
        let point = k ? route.vertices.at(-1)! : route.vertices[0];
        if (end.kind === 'free' || end.objectId === ownerId)
          return { point, pin: point };
        const target = world.get(end.objectId)!;
        const box = boxOf(target, owner);
        let normal: Point;
        if (side) {
          normal = normals[side];
          const at = boundaryPosition(
            { side, offset: offsets.get(`${c.id}/${k}`)! },
            target,
            document.objects[end.objectId],
          );
          point = localPoint(worldPoint(at, target), owner);
          if (end.kind === 'object' && end.binding)
            point = { x: point.x + normal.x * 8, y: point.y + normal.y * 8 };
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
        const reach = Math.max(along, edge) + STUB - along;
        return {
          point,
          pin: { x: point.x + normal.x * reach, y: point.y + normal.y * reach },
          axis: normal.x ? 0 : 1,
          objectId: end.objectId,
        };
      });
    });
    const paths = new Map<string, Point[]>();
    // Containers around a connector's own endpoints are not its obstacles.
    const skips = ends.map(
      (pair) =>
        new Set(
          pair.flatMap((end) =>
            end.objectId ? [...ancestors(end.objectId)] : [],
          ),
        ),
    );
    members.forEach((c, n) => {
      const [a, b] = ends[n];
      const skip = skips[n];
      const own = obstacles
        .filter((o) => !skip.has(o.id))
        .map((o) => grow(o.box, PAD));
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
      const near = own.filter((box) => boxesIntersect(box, window));
      const path = gridRoute(a.pin, b.pin, near, a.axis, b.axis, [window]) ??
        gridRoute(a.pin, b.pin, own, a.axis, b.axis) ?? [
          a.pin,
          { x: b.pin.x, y: a.pin.y },
          b.pin,
        ];
      // Pins stay doubled until nudging, so moving a lane adds a jog after the
      // exit stub instead of dragging the stub sideways.
      paths.set(
        c.id,
        [a.point, a.pin, ...path, b.pin, b.point].map((p) => ({ ...p })),
      );
    });
    for (let round = 0; round < 4; round++) {
      const h = nudge(paths, boxes, true);
      const v = nudge(paths, boxes, false);
      if (!h && !v) break;
    }
    // Labels slide along their path, away from shapes and earlier labels.
    const placed: Box[] = [];
    for (const [id, route] of routes)
      if (
        !paths.has(id) &&
        document.connections[id].ownerId === ownerId &&
        document.connections[id].label
      )
        placed.push(labelBox(route.label, document.connections[id].label!));
    members.forEach((c, n) => {
      const route = orthogonalSimplify(paths.get(c.id)!);
      const shapes = obstacles
        .filter((o) => !skips[n].has(o.id))
        .map((o) => o.box);
      let label = pointAlong(route, labelFraction(c));
      if (c.label && typeof c.style?.labelPosition !== 'number') {
        let best = Infinity;
        for (let k = 0; k <= 36; k++) {
          const t = 0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.0125;
          const p = pointAlong(route, t);
          const box = labelBox(p, c.label);
          let penalty = 0;
          for (const other of [...shapes, ...placed])
            penalty += overlap(box, other);
          if (penalty < best) {
            best = penalty;
            label = p;
          }
          if (!penalty) break;
        }
      }
      if (c.label) placed.push(labelBox(label, c.label));
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
export function labelBox(at: Point, label: string): Box {
  const { width, height } = labelSize(label);
  return {
    left: at.x - width / 2,
    right: at.x + width / 2,
    top: at.y - height / 2,
    bottom: at.y + height / 2,
  };
}
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
