import type { RecursiveDocument } from './recursiveDocument';
import type { DocumentEdit } from './documentTransactions';
import { indexHierarchy } from './recursiveHierarchy';
import { recursiveVisibility } from './recursiveVisibility';
import { ensureDepthLayout } from './recursiveLayouts';
import { repairConnections } from './recursiveConnectionRepair';
import { pruneLayoutArchive } from './recursiveReparent';
import { reconcileExpansionLayouts } from './expansionLayouts';
export function deletionTargets(document: RecursiveDocument, ids: string[]) {
  const hierarchy = indexHierarchy(document.objects);
  const selected = new Set(ids.filter((id) => !!document.objects[id]));
  const objects = new Set(selected);
  for (const id of objects)
    for (const child of hierarchy.children.get(id) ?? []) objects.add(child);
  const { visible } = recursiveVisibility(document);
  const roots = [...selected].filter((id) => {
    for (
      let parent = document.objects[id].parentId;
      parent !== null;
      parent = document.objects[parent].parentId
    )
      if (selected.has(parent)) return false;
    return true;
  });
  return {
    objects,
    descendants: objects.size - roots.length,
    hidden: [...objects].filter((id) => !visible.has(id)).length,
  };
}
export function deleteSelection(
  ids: string[],
  connectionIds: string[] = [],
): DocumentEdit {
  return (draft) => {
    const { objects } = deletionTargets(draft, ids);
    const connections = connectionIds.filter((id) => !!draft.connections[id]);
    if (!objects.size && !connections.length) return;
    const before = JSON.parse(JSON.stringify(draft)) as RecursiveDocument;
    for (const id of objects) {
      delete draft.objects[id];
      delete draft.rootDepths[id];
      delete draft.layouts[id];
    }
    for (const layouts of Object.values(draft.layouts))
      for (const layout of Object.values(layouts))
        for (const id of objects) delete layout[id];
    const hierarchy = indexHierarchy(draft.objects);
    for (const root of hierarchy.roots) {
      draft.rootDepths[root] = Math.min(
        draft.rootDepths[root],
        hierarchy.maximum.get(root)!,
      );
      ensureDepthLayout(draft, root, draft.rootDepths[root]);
    }
    for (const id of connections) delete draft.connections[id];
    repairConnections(before, draft);
    pruneLayoutArchive(draft, objects);
    // Also prune objects created and deleted within one compound transaction.
    reconcileExpansionLayouts(before, draft);
  };
}
