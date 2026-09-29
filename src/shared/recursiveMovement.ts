import type { Geometry, RecursiveDocument } from './recursiveDocument';
import type { DocumentEdit } from './documentTransactions';
import {
  activeWorldGeometry,
  indexHierarchy,
  toLocalGeometry,
  toWorldGeometry,
} from './recursiveHierarchy';
import { reparentLayouts } from './recursiveReparent';
import { editWorldGeometry, setChildrenExpanded } from './recursiveLayouts';
import { repairConnections } from './recursiveConnectionRepair';
import {
  collapsedObjects,
  setCollapsedObjects,
  recursiveVisibility,
} from './recursiveVisibility';

/** One gesture owns membership, layouts, reveal and final displayed placement. */
function placeSubtree(
  id: string,
  parentId: string | null,
  point: { x: number; y: number },
): DocumentEdit {
  const reparent = reparentLayouts(id, parentId);
  return (draft) => {
    const world = activeWorldGeometry(draft);
    const original = world.get(id);
    if (!original || (parentId !== null && !world.has(parentId)))
      throw new Error('Move requires visible objects');
    reparent(draft);
    editWorldGeometry(id, { ...original, ...point })(draft);
  };
}

export function moveSubtree(
  id: string,
  parentId: string | null,
  point: { x: number; y: number },
): DocumentEdit {
  const place = placeSubtree(id, parentId, point);
  return (draft) => {
    const before = JSON.parse(JSON.stringify(draft)) as RecursiveDocument;
    place(draft);
    repairConnections(before, draft);
  };
}

/** An ancestor carries selected descendants once. */
export function topmostObjects(document: RecursiveDocument, ids: string[]) {
  const selected = new Set(ids);
  return [...selected].filter((id) => {
    if (!document.objects[id]) throw new Error('Select shapes to move.');
    let parent = document.objects[id].parentId;
    while (parent !== null) {
      if (selected.has(parent)) return false;
      parent = document.objects[parent].parentId;
    }
    return true;
  });
}

export function moveSelection(
  ids: string[],
  delta: { x: number; y: number },
  parents: ReadonlyMap<string, string | null>,
  revealParents: string[] = [],
): DocumentEdit {
  return (draft) => {
    const before = JSON.parse(JSON.stringify(draft)) as RecursiveDocument;
    const movers = topmostObjects(draft, ids);
    const world = activeWorldGeometry(draft);
    const moves = movers.map((id) => {
      const g = world.get(id);
      if (!g) throw new Error('Move requires visible objects');
      const point = { ...g, x: g.x + delta.x, y: g.y + delta.y };
      const parent = parents.has(id)
        ? parents.get(id)!
        : draft.objects[id].parentId;
      return { id, parent, point };
    });
    for (const parent of revealParents)
      setChildrenExpanded(parent, true)(draft);
    const depths = { ...draft.rootDepths };
    const { expanded } = recursiveVisibility(draft);
    for (const { id, parent, point } of moves)
      placeSubtree(id, parent, point)(draft);
    // Existing parents retain their disclosure unless the drag opened them.
    const collapsed = collapsedObjects(draft);
    const children = indexHierarchy(before.objects).children;
    const firstParents = new Set<string>();
    for (const { id, parent } of moves) {
      if (
        parent !== null &&
        parent !== before.objects[id].parentId &&
        !expanded.has(parent)
      )
        collapsed.add(parent);
      if (parent !== null && !children.has(parent)) firstParents.add(parent);
    }
    setCollapsedObjects(draft, collapsed);
    for (const root of Object.keys(draft.rootDepths)) {
      if (Object.hasOwn(depths, root))
        draft.rootDepths[root] = Math.min(draft.rootDepths[root], depths[root]);
    }
    for (const parent of firstParents) setChildrenExpanded(parent, true)(draft);
    // Disclosure can arrange neighbors; the user's final drop positions win.
    if (firstParents.size) {
      const visible = recursiveVisibility(draft).visible;
      for (const { id, point } of moves)
        if (visible.has(id)) editWorldGeometry(id, point)(draft);
    }
    repairConnections(before, draft);
  };
}

/** Resize in the object's axes, anchoring the opposite handle or the center. */
export function resizeGeometry(
  geometry: Geometry,
  handle: { x: number; y: number },
  delta: { x: number; y: number },
  centered = false,
): Geometry {
  const local = toLocalGeometry(
    { ...geometry, x: geometry.x + delta.x, y: geometry.y + delta.y },
    geometry,
  );
  const width = handle.x
    ? Math.max(0.01, geometry.width + local.x * handle.x * (centered ? 2 : 1))
    : geometry.width;
  const height = handle.y
    ? Math.max(0.01, geometry.height + local.y * handle.y * (centered ? 2 : 1))
    : geometry.height;
  const center = centered
    ? geometry
    : toWorldGeometry(
        {
          ...geometry,
          x: ((width - geometry.width) * handle.x) / 2,
          y: ((height - geometry.height) * handle.y) / 2,
        },
        geometry,
      );
  return { ...geometry, x: center.x, y: center.y, width, height };
}

/** Preserve the grab angle; pulling 40 screen pixels outward enables 15° steps. */
export function rotationFromPointer(
  geometry: Geometry,
  start: { x: number; y: number },
  point: { x: number; y: number },
  scale: number,
) {
  const sx = start.x - geometry.x,
    sy = start.y - geometry.y,
    dx = point.x - geometry.x,
    dy = point.y - geometry.y;
  const snapped = (Math.hypot(dx, dy) - Math.hypot(sx, sy)) * scale >= 40;
  const step = snapped ? 15 : 1;
  const angle =
    geometry.rotation +
    ((Math.atan2(dy, dx) - Math.atan2(sy, sx)) * 180) / Math.PI;
  return {
    rotation: (((Math.round(angle / step) * step) % 360) + 360) % 360,
    snapped,
  };
}

/** Copy only touched layout maps; patches describe the resulting world geometry. */
export function previewGeometry(
  document: RecursiveDocument,
  patches: Map<string, Partial<Geometry>>,
) {
  const hierarchy = indexHierarchy(document.objects);
  const world = activeWorldGeometry(document);
  const layouts = { ...document.layouts };
  for (const [id, patch] of patches) {
    const g = world.get(id);
    if (!g) throw new Error('Geometry requires a visible object');
    const { root } = hierarchy.entries.get(id)!;
    const depth = document.rootDepths[root];
    const parent = document.objects[id].parentId;
    if (layouts[root] === document.layouts[root])
      layouts[root] = {
        ...layouts[root],
        [depth]: { ...layouts[root][depth] },
      };
    layouts[root][depth][id] =
      parent === null
        ? { ...g, ...patch }
        : toLocalGeometry(
            { ...g, ...patch },
            { ...world.get(parent)!, ...patches.get(parent) },
          );
  }
  return { ...document, layouts };
}
