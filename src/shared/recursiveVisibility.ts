import type { RecursiveDocument } from './recursiveDocument';
import { indexHierarchy } from './recursiveHierarchy';

export function collapsedObjects(document: RecursiveDocument): Set<string> {
  const ids = document.extensions?.collapsedObjects;
  return new Set(
    Array.isArray(ids)
      ? ids.filter(
          (id): id is string =>
            typeof id === 'string' && Object.hasOwn(document.objects, id),
        )
      : [],
  );
}

export function setCollapsedObjects(
  document: RecursiveDocument,
  ids: Set<string>,
) {
  if (ids.size)
    document.extensions = {
      ...document.extensions,
      collapsedObjects: [...ids],
    };
  else if (document.extensions) delete document.extensions.collapsedObjects;
}

export function rootDepthBounds(document: RecursiveDocument) {
  const hierarchy = indexHierarchy(document.objects);
  return hierarchy.roots.map((id) => ({
    id,
    maximum: hierarchy.maximum.get(id)!,
    selected: Math.min(
      document.rootDepths[id] ?? 0,
      hierarchy.maximum.get(id)!,
    ),
  }));
}

/** Reveal-all is a value computed now, never a persistent follow-new-children mode. */
export function requestedRootDepth(
  document: RecursiveDocument,
  rootId: string,
  depth: number | 'all',
): number {
  const root = rootDepthBounds(document).find((r) => r.id === rootId);
  if (!root) throw new Error(`Not a root: ${rootId}`);
  if (depth === 'all') return root.maximum;
  if (!Number.isSafeInteger(depth)) throw new Error('Depth must be an integer');
  return Math.max(0, Math.min(depth, root.maximum));
}

export function recursiveVisibility(
  document: RecursiveDocument,
  hierarchy = indexHierarchy(document.objects),
) {
  const collapsed = collapsedObjects(document);
  const visible = new Set<string>();
  const expanded = new Set<string>();
  for (const [id, { root, generation }] of hierarchy.entries) {
    if (generation > document.rootDepths[root]) continue;
    const parent = document.objects[id].parentId;
    if (parent !== null && !expanded.has(parent)) continue;
    visible.add(id);
    if (
      !collapsed.has(id) &&
      generation < document.rootDepths[root] &&
      (hierarchy.children.get(id)?.length ?? 0) > 0
    )
      expanded.add(id);
  }
  return { visible, expanded };
}
