import type { Geometry, RecursiveDocument } from './recursiveDocument';
import { type DocumentEdit, editActiveGeometry } from './documentTransactions';
import {
  activeWorldGeometry,
  toLocalGeometry,
  indexHierarchy,
} from './recursiveHierarchy';
import {
  requestedRootDepth,
  collapsedObjects,
  setCollapsedObjects,
  recursiveVisibility,
} from './recursiveVisibility';
import {
  rememberExpansionLayout,
  rememberExpansionTransition,
  restoreExpansionLayout,
  resetExpansionContext,
} from './expansionLayouts';
import { arrangeExpansion } from './expansionArrangement';

/** Materialize once; inactive arrangements may also need initialization on reparent. */
export function ensureDepthLayout(
  document: RecursiveDocument,
  rootId: string,
  depth: number,
) {
  const hierarchy = indexHierarchy(document.objects);
  const layouts = document.layouts[rootId];
  if (
    !hierarchy.roots.includes(rootId) ||
    !Number.isSafeInteger(depth) ||
    depth < 0
  )
    throw new Error('Invalid root arrangement');
  const depths = Object.keys(layouts)
    .map(Number)
    .sort((a, b) => a - b);
  const source = depths.filter((d) => d < depth).at(-1) ?? depths[0];
  const layout =
    layouts[depth] ??
    Object.fromEntries(
      Object.entries(layouts[source]).map(([id, g]) => [id, { ...g }]),
    );
  const nearest = [...depths].sort(
    (a, b) => Math.abs(a - depth) - Math.abs(b - depth) || a - b,
  );
  for (const id of hierarchy.byRoot.get(rootId)!) {
    if (
      hierarchy.entries.get(id)!.generation > depth ||
      Object.hasOwn(layout, id)
    )
      continue;
    const saved = nearest.find((d) => Object.hasOwn(layouts[d], id));
    layout[id] = {
      ...(saved === undefined
        ? document.objects[id].geometry
        : layouts[saved][id]),
    };
  }
  layouts[depth] = layout;
  return layout;
}

export function selectRootDepth(
  rootId: string,
  depth: number | 'all',
): DocumentEdit {
  return (draft) => {
    const target = requestedRootDepth(draft, rootId, depth);
    if (draft.extensions?.expansionLayouts) rememberExpansionLayout(draft);
    ensureDepthLayout(draft, rootId, target);
    draft.rootDepths[rootId] = target;
    const hierarchy = indexHierarchy(draft.objects);
    setCollapsedObjects(
      draft,
      new Set(
        [...collapsedObjects(draft)].filter(
          (id) => hierarchy.entries.get(id)?.root !== rootId,
        ),
      ),
    );
    resetExpansionContext(draft);
  };
}

/** Materialize a whole reveal path once, keeping unrelated branches folded. */
function revealBranches(draft: RecursiveDocument, ids: string[]) {
  const hierarchy = indexHierarchy(draft.objects);
  const before = recursiveVisibility(draft);
  const collapsed = collapsedObjects(draft);
  const targets = new Map<string, number>();
  for (const id of ids) {
    const { root, generation } = hierarchy.entries.get(id)!;
    targets.set(
      root,
      Math.max(targets.get(root) ?? draft.rootDepths[root], generation + 1),
    );
  }
  for (const [root, target] of targets) {
    const current = draft.layouts[root][draft.rootDepths[root]];
    const layout = ensureDepthLayout(draft, root, target);
    for (const member of hierarchy.byRoot.get(root)!) {
      if (before.visible.has(member)) layout[member] = { ...current[member] };
      // Only newly reachable levels start folded. Hidden branches retain their
      // own disclosure state when an ancestor is reopened.
      if (
        hierarchy.entries.get(member)!.generation >= draft.rootDepths[root] &&
        hierarchy.children.has(member)
      )
        collapsed.add(member);
    }
    draft.rootDepths[root] = target;
  }
  for (const id of ids) collapsed.delete(id);
  setCollapsedObjects(draft, collapsed);
}

/** Reopen a branch's retained disclosure, or explicitly fold its whole subtree. */
export function setChildrenExpanded(
  id: string,
  expanded: boolean,
  collapseAll = false,
): DocumentEdit {
  return (draft) => {
    const hierarchy = indexHierarchy(draft.objects);
    if (!hierarchy.children.has(id)) return;
    const before = recursiveVisibility(draft);
    if (
      !before.visible.has(id) ||
      (before.expanded.has(id) === expanded && !collapseAll)
    )
      return;
    const outgoing = rememberExpansionLayout(draft, [id]);
    if (expanded) revealBranches(draft, [id]);
    else {
      const collapsed = collapsedObjects(draft);
      const branches = [id];
      for (const branch of branches) {
        const children = hierarchy.children.get(branch);
        if (!children) continue;
        collapsed.add(branch);
        if (collapseAll) branches.push(...children);
      }
      setCollapsedObjects(draft, collapsed);
    }
    const { changed, fit, restored } = restoreExpansionLayout(draft, [id]);
    arrangeExpansion(draft, changed, fit, restored);
    rememberExpansionTransition(draft, outgoing, [id]);
  };
}

/** Search reveals its whole path as one layout transition and one undo step. */
export function revealObject(id: string): DocumentEdit {
  return (draft) => {
    if (!draft.objects[id]) throw new Error(`Missing object ${id}`);
    if (recursiveVisibility(draft).visible.has(id)) return;
    const ancestors: string[] = [];
    for (
      let parent = draft.objects[id].parentId;
      parent !== null;
      parent = draft.objects[parent].parentId
    )
      ancestors.push(parent);
    const outgoing = rememberExpansionLayout(draft, ancestors);
    revealBranches(draft, ancestors);
    const { changed, fit, restored } = restoreExpansionLayout(draft, ancestors);
    arrangeExpansion(draft, changed, fit, restored);
    rememberExpansionTransition(draft, outgoing, ancestors);
  };
}

export function activeGeometry(
  document: RecursiveDocument,
  id: string,
): Geometry {
  const entry = indexHierarchy(document.objects).entries.get(id);
  if (!entry) throw new Error(`Missing object ${id}`);
  const geometry =
    document.layouts[entry.root][document.rootDepths[entry.root]][id];
  if (!geometry) throw new Error(`Missing active geometry ${id}`);
  return geometry;
}
/** World-space authoring converts back into the current parent's local layout. */
export function editWorldGeometry(
  id: string,
  patch: Partial<Geometry>,
): DocumentEdit {
  return (draft) => {
    const world = activeWorldGeometry(draft);
    const current = world.get(id);
    if (!current) throw new Error(`Object ${id} is hidden`);
    const geometry = { ...current, ...patch };
    const parent = draft.objects[id].parentId;
    editActiveGeometry(
      id,
      parent === null
        ? geometry
        : toLocalGeometry(geometry, world.get(parent)!),
    )(draft);
  };
}
