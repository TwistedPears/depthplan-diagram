import { editActiveGeometry, type DocumentEdit } from './documentTransactions';
import { indexHierarchy, toWorldGeometry } from './recursiveHierarchy';
import { recursiveVisibility } from './recursiveVisibility';
import { geometryBounds, unionBounds, type Bounds } from './recursiveCamera';
import { arrangeExpansion } from './expansionArrangement';
import { CHILD_CONTROL_SPACE } from './objectContentBounds';

export type LayoutOptions = {
  algorithm: 'grid' | 'layered' | 'row' | 'column';
  gap: number;
  padding: number;
  direction?: 'down' | 'right';
  columns?: number;
};
/** Current footprint center and size; positions are footprint top-left corners. */
export type LayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
type Point = { x: number; y: number };
const TITLE_SPACE = CHILD_CONTROL_SPACE + 4;
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const reading = (major: 'x' | 'y') => (a: LayoutNode, b: LayoutNode) => {
  const minor = major === 'x' ? 'y' : 'x';
  return a[major] - b[major] || a[minor] - b[minor] || compareIds(a.id, b.id);
};

/** Strongly connected components; edges inside one are the cyclic connectors. */
export function cyclicComponents(ids: string[], edges: [string, string][]) {
  const next = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [from, to] of edges) next.get(from)?.push(to);
  const component = new Map<string, number>();
  const index = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [];
  let count = 0;
  const visit = (id: string) => {
    index.set(id, index.size);
    low.set(id, index.get(id)!);
    stack.push(id);
    for (const to of next.get(id)!) {
      if (!index.has(to)) {
        visit(to);
        low.set(id, Math.min(low.get(id)!, low.get(to)!));
      } else if (!component.has(to))
        low.set(id, Math.min(low.get(id)!, index.get(to)!));
    }
    if (low.get(id) === index.get(id)) {
      let member: string;
      do {
        member = stack.pop()!;
        component.set(member, count);
      } while (member !== id);
      count++;
    }
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return component;
}

/** Longest-path ranks over the component DAG, then one barycentre sweep each way. */
function layers(
  nodes: LayoutNode[],
  edges: [string, string][],
  cross: 'x' | 'y',
) {
  const ordered = [...nodes].sort(reading(cross));
  const ids = ordered.map((n) => n.id);
  const component = cyclicComponents(ids, edges);
  const rank = new Map(ids.map((id) => [id, 0]));
  // Kahn over components; ties keep the current reading order.
  const incoming = new Map<number, number>();
  const outgoing = new Map<number, [string, string][]>();
  for (const edge of edges) {
    const [a, b] = edge.map((id) => component.get(id)!);
    if (a === b) continue;
    incoming.set(b, (incoming.get(b) ?? 0) + 1);
    outgoing.set(a, [...(outgoing.get(a) ?? []), edge]);
  }
  const members = new Map<number, string[]>();
  for (const id of ids)
    members.set(component.get(id)!, [
      ...(members.get(component.get(id)!) ?? []),
      id,
    ]);
  const ready = [...members.keys()].filter((c) => !incoming.get(c));
  while (ready.length) {
    const c = ready.shift()!;
    const level = Math.max(...members.get(c)!.map((id) => rank.get(id)!));
    for (const id of members.get(c)!) rank.set(id, level);
    for (const [, to] of outgoing.get(c) ?? []) {
      rank.set(to, Math.max(rank.get(to)!, level + 1));
      const target = component.get(to)!;
      incoming.set(target, incoming.get(target)! - 1);
      if (!incoming.get(target)) ready.push(target);
    }
  }
  const result: string[][] = [];
  for (const id of ids) (result[rank.get(id)!] ??= []).push(id);
  const rows = result.filter(Boolean);
  const neighbors = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [a, b] of edges) {
    neighbors.get(a)!.push(b);
    neighbors.get(b)!.push(a);
  }
  const layerOf = new Map<string, number>();
  rows.forEach((row, r) => row.forEach((id) => layerOf.set(id, r)));
  const position = new Map<string, number>();
  const measure = () =>
    rows.forEach((row) =>
      row.forEach((id, at) => position.set(id, at - (row.length - 1) / 2)),
    );
  measure();
  const sweep = (r: number, above: boolean) => {
    const key = new Map(
      rows[r].map((id) => {
        const near = neighbors
          .get(id)!
          .filter((other) =>
            above ? layerOf.get(other)! < r : layerOf.get(other)! > r,
          );
        return [
          id,
          near.length
            ? near.reduce((sum, other) => sum + position.get(other)!, 0) /
              near.length
            : position.get(id)!,
        ];
      }),
    );
    rows[r].sort(
      (a, b) =>
        key.get(a)! - key.get(b)! || position.get(a)! - position.get(b)!,
    );
    measure();
  };
  for (let r = 1; r < rows.length; r++) sweep(r, true);
  for (let r = rows.length - 2; r >= 0; r--) sweep(r, false);
  return rows;
}

/** Pure placement inside a block whose top-left corner is the origin. */
export function autoLayout(
  nodes: LayoutNode[],
  edges: [string, string][],
  options: LayoutOptions,
) {
  const { gap } = options;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const positions = new Map<string, Point>();
  // Bands run along the main axis; members are centered across each band.
  const bands = (rows: string[][], main: 'x' | 'y') => {
    const cross = main === 'y' ? 'x' : 'y';
    const size = (id: string, axis: 'x' | 'y') =>
      byId.get(id)![axis === 'x' ? 'width' : 'height'];
    const lengths = rows.map(
      (row) =>
        row.reduce((sum, id) => sum + size(id, cross), 0) +
        gap * (row.length - 1),
    );
    const span = Math.max(...lengths);
    let along = 0;
    rows.forEach((row, r) => {
      const thickness = Math.max(...row.map((id) => size(id, main)));
      let at = (span - lengths[r]) / 2;
      for (const id of row) {
        positions.set(id, {
          [main]: along + (thickness - size(id, main)) / 2,
          [cross]: at,
        } as Point);
        at += size(id, cross) + gap;
      }
      along += thickness + gap;
    });
    const extent = along - gap;
    return main === 'y'
      ? { width: span, height: extent }
      : { width: extent, height: span };
  };
  let block: { width: number; height: number };
  if (options.algorithm === 'row')
    block = bands([[...nodes].sort(reading('x')).map((n) => n.id)], 'y');
  else if (options.algorithm === 'column')
    block = bands([[...nodes].sort(reading('y')).map((n) => n.id)], 'x');
  else if (options.algorithm === 'layered') {
    const main = options.direction === 'right' ? 'x' : 'y';
    block = bands(layers(nodes, edges, main === 'y' ? 'x' : 'y'), main);
  } else {
    const ordered = [...nodes].sort(reading('y'));
    let columns = Math.min(
      ordered.length,
      options.columns ?? Math.ceil(Math.sqrt(ordered.length)),
    );
    const rows = Math.ceil(ordered.length / columns);
    // Column-major filling can need fewer columns than requested.
    if (options.direction === 'down')
      columns = Math.ceil(ordered.length / rows);
    const cell = {
      width: Math.max(...nodes.map((n) => n.width)),
      height: Math.max(...nodes.map((n) => n.height)),
    };
    ordered.forEach((n, at) => {
      const [column, row] =
        options.direction === 'down'
          ? [Math.floor(at / rows), at % rows]
          : [at % columns, Math.floor(at / columns)];
      positions.set(n.id, {
        x: column * (cell.width + gap) + (cell.width - n.width) / 2,
        y: row * (cell.height + gap) + (cell.height - n.height) / 2,
      });
    });
    block = {
      width: columns * cell.width + (columns - 1) * gap,
      height: rows * cell.height + (rows - 1) * gap,
    };
  }
  return { positions, ...block };
}

/** Arrange a container's visible direct children in its active-depth layout.
 * Sizes are kept; the parent then grows to fit through ordinary expansion fitting. */
export function layoutChildren(
  id: string,
  options: LayoutOptions,
): DocumentEdit {
  return (draft) => {
    if (!Object.hasOwn(draft.objects, id))
      throw new Error(`Missing object ${id}`);
    const hierarchy = indexHierarchy(draft.objects);
    const { visible } = recursiveVisibility(draft, hierarchy);
    if (!visible.has(id)) throw new Error('Layout requires a visible object');
    const shown = (parent: string) =>
      (hierarchy.children.get(parent) ?? []).filter((c) => visible.has(c));
    const children = shown(id);
    if (!children.length) return;
    const { root } = hierarchy.entries.get(id)!;
    const layout = draft.layouts[root][draft.rootDepths[root]];
    // The same stroked, descendant-inclusive footprint expansion fitting uses.
    const footprint = (object: string): Bounds => {
      const g = layout[object];
      const stroke = draft.objects[object].style?.strokeWidth;
      return unionBounds([
        geometryBounds(g, typeof stroke === 'number' ? Math.max(0, stroke) : 0),
        ...shown(object).map((child) => {
          const b = footprint(child);
          return geometryBounds(
            toWorldGeometry(
              {
                x: b.x + b.width / 2,
                y: b.y + b.height / 2,
                width: b.width,
                height: b.height,
                rotation: 0,
                z: 0,
              },
              g,
            ),
          );
        }),
      ])!;
    };
    const boxes = new Map(children.map((child) => [child, footprint(child)]));
    const direct = (object: string) => {
      let current: string | null = object;
      while (current !== null && draft.objects[current]?.parentId !== id)
        current = draft.objects[current]?.parentId ?? null;
      return current;
    };
    const edges = new Map<string, [string, string]>();
    for (const { start, end } of Object.values(draft.connections)) {
      if (start.kind === 'free' || end.kind === 'free') continue;
      const [a, b] = [direct(start.objectId), direct(end.objectId)];
      if (a && b && a !== b && boxes.has(a) && boxes.has(b))
        edges.set(`${a}\n${b}`, [a, b]);
    }
    const { positions, width, height } = autoLayout(
      children.map((child) => ({
        id: child,
        x: layout[child].x,
        y: layout[child].y,
        width: boxes.get(child)!.width,
        height: boxes.get(child)!.height,
      })),
      [...edges.values()],
      options,
    );
    const top = Math.max(options.padding, TITLE_SPACE);
    const place = () => {
      const origin = { x: -width / 2, y: -layout[id].height / 2 + top };
      for (const child of children) {
        const at = positions.get(child)!,
          box = boxes.get(child)!;
        editActiveGeometry(child, {
          x: origin.x + at.x + layout[child].x - box.x,
          y: origin.y + at.y + layout[child].y - box.y,
        })(draft);
        boxes.set(child, {
          ...box,
          x: origin.x + at.x,
          y: origin.y + at.y,
        });
      }
    };
    editActiveGeometry(id, {
      width: Math.max(layout[id].width, width + 2 * options.padding),
      height: Math.max(layout[id].height, top + height + options.padding),
    })(draft);
    place();
    // Children are settled, so fitting only grows ancestors and moves neighbors.
    arrangeExpansion(draft, new Set([id]), new Set([id]), new Set(children));
    place();
  };
}
