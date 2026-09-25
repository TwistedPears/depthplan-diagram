import {
  type DiagramObject,
  type Geometry,
  type RecursiveDocument,
} from './recursiveDocument';
import { type DocumentEdit } from './documentTransactions';
import {
  indexHierarchy,
  activeWorldGeometry,
  toLocalGeometry,
} from './recursiveHierarchy';
import { recursiveVisibility } from './recursiveVisibility';

/** A shape's border can connect outside in its parent or inside to its children. */
export function connectionOwners(
  document: RecursiveDocument,
  objectId: string,
) {
  return [document.objects[objectId].parentId, objectId];
}

/** Hit the visible silhouette, including rotation, rather than its bounding box. */
export function containsShape(
  object: DiagramObject,
  geometry: Geometry,
  point: { x: number; y: number },
  padding = 0,
) {
  const local = toLocalGeometry({ ...geometry, ...point }, geometry);
  const x = Math.abs(local.x) / (geometry.width / 2 + padding);
  const y = Math.abs(local.y) / (geometry.height / 2 + padding);
  if (object.type === 'ellipse') return x * x + y * y <= 1;
  if (object.type === 'diamond') return x + y <= 1;
  const radius =
    typeof object.style?.cornerRadius === 'number'
      ? Math.max(
          0,
          Math.min(
            geometry.width / 2,
            geometry.height / 2,
            object.style.cornerRadius,
          ),
        )
      : 0;
  const dx = Math.max(
    0,
    Math.abs(local.x) - geometry.width / 2 + radius - padding,
  );
  const dy = Math.max(
    0,
    Math.abs(local.y) - geometry.height / 2 + radius - padding,
  );
  return x <= 1 && y <= 1 && (!radius || dx * dx + dy * dy <= radius * radius);
}

/** Existing objects cannot be moved by this command; subtree moves own preservation rules. */
export function insertSubtree(
  objects: DiagramObject[],
  worldGeometry?: Geometry,
): DocumentEdit {
  return (draft) => {
    if (!objects.length) return;
    const ids = new Set<string>();
    for (const object of objects) {
      if (
        !object.id ||
        ['__proto__', 'constructor', 'prototype'].includes(object.id) ||
        ids.has(object.id) ||
        Object.hasOwn(draft.objects, object.id)
      )
        throw new Error(`Duplicate or invalid new object ID ${object.id}`);
      ids.add(object.id);
    }
    const tops = objects.filter(
      (o) => o.parentId === null || !ids.has(o.parentId),
    );
    if (tops.length !== 1) throw new Error('Expected one new subtree');
    const top = tops[0];
    let seed = worldGeometry;
    if (worldGeometry && top.parentId !== null) {
      const parent = activeWorldGeometry(draft).get(top.parentId);
      if (!parent) throw new Error('World placement requires a visible parent');
      seed = toLocalGeometry(worldGeometry, parent);
    }
    for (const object of objects)
      draft.objects[object.id] = {
        ...object,
        geometry:
          object.id === top.id && seed ? { ...seed } : { ...object.geometry },
      };
    const hierarchy = indexHierarchy(draft.objects);
    for (const object of objects) {
      const { root, generation } = hierarchy.entries.get(object.id)!;
      if (!draft.layouts[root]) {
        draft.layouts[root] = { 0: {} };
        draft.rootDepths[root] = 0;
      }
      for (const [depth, layout] of Object.entries(draft.layouts[root]))
        if (generation <= Number(depth))
          layout[object.id] = { ...draft.objects[object.id].geometry };
    }
  };
}

/** Center hit-test; collapsed visible shapes qualify. Excluded IDs include the moving subtree. */
export function eligibleParent(
  document: RecursiveDocument,
  point: { x: number; y: number },
  excluded: ReadonlySet<string> = new Set(),
): string | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new Error('Invalid drop center');
  const hierarchy = indexHierarchy(document.objects);
  const ignored = new Set(excluded);
  for (const id of ignored)
    for (const child of hierarchy.children.get(id) ?? []) ignored.add(child);
  const { visible } = recursiveVisibility(document);
  const targets = [...activeWorldGeometry(document)].filter(
    ([id, g]) =>
      !ignored.has(id) &&
      visible.has(id) &&
      containsShape(document.objects[id], g, point),
  );
  targets.sort(
    ([a, ga], [b, gb]) =>
      hierarchy.entries.get(b)!.generation -
        hierarchy.entries.get(a)!.generation ||
      gb.z - ga.z ||
      ga.width * ga.height - gb.width * gb.height ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  return targets[0]?.[0] ?? null;
}
