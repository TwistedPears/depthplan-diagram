import type { Geometry, RecursiveDocument } from './recursiveDocument';
import { indexHierarchy, toWorldGeometry } from './recursiveHierarchy';
import { geometryBounds, unionBounds, type Bounds } from './recursiveCamera';
import { recursiveVisibility } from './recursiveVisibility';

const GAP = 24;
const TITLE_SPACE = 36;
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const overlaps = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.width + GAP &&
  a.x + a.width + GAP > b.x &&
  a.y < b.y + b.height + GAP &&
  a.y + a.height + GAP > b.y;

/** Place each group once, moving monotonically away from already placed groups.
 * Existing overlaps unrelated to the expansion are left alone. */
function separate(
  ids: string[],
  geometry: Map<string, Geometry>,
  boxes: Map<string, Bounds>,
  dirty: Set<string>,
  settled: Set<string>,
) {
  const anchors = ids.filter((id) => dirty.has(id));
  if (!anchors.length) return;
  const center = unionBounds(anchors.map((id) => boxes.get(id)!))!;
  const distance = (id: string) => {
    const g = geometry.get(id)!;
    return Math.hypot(
      g.x - center.x - center.width / 2,
      g.y - center.y - center.height / 2,
    );
  };
  const ordered = [...ids].sort(
    (a, b) =>
      Number(dirty.has(b)) - Number(dirty.has(a)) ||
      distance(a) - distance(b) ||
      compareIds(a, b),
  );
  const placed: string[] = [];
  for (const id of ordered) {
    const box = boxes.get(id)!;
    const conflict = placed.find(
      (other) =>
        (dirty.has(id) || dirty.has(other)) &&
        !(settled.has(id) && settled.has(other)) &&
        overlaps(box, boxes.get(other)!),
    );
    if (conflict !== undefined) {
      const obstacle = boxes.get(conflict)!;
      const moves = [
        { x: obstacle.x - GAP - box.x - box.width, y: 0 },
        { x: obstacle.x + obstacle.width + GAP - box.x, y: 0 },
        { x: 0, y: obstacle.y - GAP - box.y - box.height },
        { x: 0, y: obstacle.y + obstacle.height + GAP - box.y },
      ];
      moves.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
      const direction = moves[0];
      const horizontal = direction.x !== 0;
      const positive = (horizontal ? direction.x : direction.y) > 0;
      const moved = { ...box };
      // Each pass crosses at least one obstacle permanently; no oscillation.
      for (let pass = 0; pass <= placed.length; pass++) {
        const hits = placed
          .map((other) => boxes.get(other)!)
          .filter((b) => overlaps(moved, b));
        if (!hits.length) break;
        if (pass === placed.length)
          throw new Error('Unable to arrange children');
        if (horizontal)
          moved.x = positive
            ? Math.max(...hits.map((b) => b.x + b.width + GAP))
            : Math.min(...hits.map((b) => b.x - GAP - moved.width));
        else
          moved.y = positive
            ? Math.max(...hits.map((b) => b.y + b.height + GAP))
            : Math.min(...hits.map((b) => b.y - GAP - moved.height));
      }
      const g = geometry.get(id)!;
      g.x += moved.x - box.x;
      g.y += moved.y - box.y;
      boxes.set(id, moved);
      dirty.add(id);
      settled.delete(id);
    }
    placed.push(id);
  }
}

/** Fit changed branches from leaves to roots, then make room in each owner scope.
 * Dimensions are physical shape dimensions. Children keep their local size/pose. */
export function arrangeExpansion(
  document: RecursiveDocument,
  changed: Set<string>,
  fit = changed,
  restored: Set<string> = new Set(),
) {
  if (!changed.size) return;
  const hierarchy = indexHierarchy(document.objects);
  const { visible, expanded } = recursiveVisibility(document);
  const geometry = new Map<string, Geometry>();
  for (const id of visible) {
    const { root } = hierarchy.entries.get(id)!;
    geometry.set(id, document.layouts[root][document.rootDepths[root]][id]);
  }
  const affected = new Set(changed);
  const fitting = new Set(fit);
  for (const id of changed)
    for (
      let parent = document.objects[id]?.parentId;
      parent != null;
      parent = document.objects[parent].parentId
    ) {
      affected.add(parent);
      if (fit.has(id)) fitting.add(parent);
    }
  // Preserve deliberate overlaps in remembered layouts. Newly fitted branches
  // and objects absent from that layout still take part in collision checks.
  const settled = new Set([...restored].filter((id) => !fitting.has(id)));
  // Footprints include overflowing children of unchanged, manually edited groups.
  const boxes = new Map<string, Bounds>();
  for (const id of [...hierarchy.entries.keys()].reverse()) {
    if (!visible.has(id)) continue;
    const g = geometry.get(id)!;
    const children = (hierarchy.children.get(id) ?? []).filter((child) =>
      visible.has(child),
    );
    if (expanded.has(id) && affected.has(id)) {
      const dirty = new Set(
        children.filter((child) => fit.has(id) || affected.has(child)),
      );
      separate(children, geometry, boxes, dirty, settled);
    }
    if (expanded.has(id) && fitting.has(id)) {
      const contents = unionBounds(children.map((child) => boxes.get(child)!));
      if (contents) {
        const halfWidth =
          Math.max(
            Math.abs(contents.x),
            Math.abs(contents.x + contents.width),
          ) + GAP;
        const halfHeight = Math.max(
          Math.abs(contents.y) + TITLE_SPACE,
          Math.abs(contents.y + contents.height) + GAP,
        );
        const type = document.objects[id].type;
        // A rectangle inscribed in an ellipse/diamond needs extra corner room.
        const factor =
          type === 'ellipse' ? Math.SQRT2 : type === 'diamond' ? 2 : 1;
        const corner = document.objects[id].style?.cornerRadius;
        const padding = typeof corner === 'number' ? Math.max(0, corner) : 0;
        g.width = Math.max(g.width, 2 * halfWidth * factor + padding);
        g.height = Math.max(g.height, 2 * halfHeight * factor + padding);
      }
    }
    const stroke = document.objects[id].style?.strokeWidth;
    const own = geometryBounds(
      g,
      typeof stroke === 'number' ? Math.max(0, stroke) : 0,
    );
    const descendants = children.map((child) => {
      const b = boxes.get(child)!;
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
    });
    boxes.set(id, unionBounds([own, ...descendants])!);
  }
  separate(hierarchy.roots, geometry, boxes, affected, settled);
}
