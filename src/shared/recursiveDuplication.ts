import type { DocumentEdit } from './documentTransactions';
import type {
  Endpoint,
  Geometry,
  RecursiveDocument,
} from './recursiveDocument';
import { indexHierarchy } from './recursiveHierarchy';
import { topmostObjects } from './recursiveMovement';
import { collapsedObjects, setCollapsedObjects } from './recursiveVisibility';
import { stackSelection } from './recursiveArrangement';

/** The complete selected subtrees and wiring shared by Duplicate and Copy. */
export function copyScope(document: RecursiveDocument, selection: string[]) {
  const tops = new Set(
    topmostObjects(
      document,
      selection
        .filter((key) => key.startsWith('object-'))
        .map((key) => key.slice(7)),
    ),
  );
  const hierarchy = indexHierarchy(document.objects);
  const members = new Set(tops);
  for (const id of members)
    for (const child of hierarchy.children.get(id) ?? []) members.add(child);
  const connections = new Set(
    Object.values(document.connections)
      .filter(
        (c) =>
          selection.includes(`connection-${c.id}`) ||
          (c.ownerId !== null && members.has(c.ownerId)) ||
          [c.start, c.end].every(
            (end) => end.kind !== 'free' && members.has(end.objectId),
          ),
      )
      .map((c) => c.id),
  );
  return { tops, members, hierarchy, connections };
}

/** Copy complete subtrees and their internal wiring; retain every authored depth. */
export function duplicateSelection(
  document: RecursiveDocument,
  selection: string[],
  offset = 24,
) {
  const scope = copyScope(document, selection);
  const { tops, members, hierarchy } = scope;
  const objects = new Map([...members].map((id) => [id, crypto.randomUUID()]));
  const connections = new Map(
    [...scope.connections].map((id) => [id, crypto.randomUUID()]),
  );
  const selected = [
    ...[...tops].map((id) => `object-${objects.get(id)}`),
    ...[...connections.keys()]
      .filter((id) => !members.has(document.connections[id].ownerId ?? ''))
      .map((id) => `connection-${connections.get(id)}`),
  ];
  const geometry = (id: string, g: Geometry) => ({
    ...g,
    x: g.x + (tops.has(id) ? offset : 0),
    y: g.y + (tops.has(id) ? offset : 0),
  });
  const edit: DocumentEdit = (draft) => {
    for (const [id, copyId] of objects) {
      if (draft.objects[copyId]) throw new Error('Duplicate object ID');
      const source = document.objects[id];
      draft.objects[copyId] = {
        ...JSON.parse(JSON.stringify(source)),
        id: copyId,
        parentId:
          source.parentId === null
            ? null
            : (objects.get(source.parentId) ?? source.parentId),
        geometry: geometry(id, source.geometry),
      };
      if (source.parentId === null) {
        draft.rootDepths[copyId] = document.rootDepths[id];
        draft.layouts[copyId] = Object.fromEntries(
          Object.entries(document.layouts[id]).map(([depth, layout]) => [
            depth,
            Object.fromEntries(
              Object.entries(layout).map(([member, g]) => [
                objects.get(member)!,
                geometry(member, g),
              ]),
            ),
          ]),
        );
      } else {
        const root = hierarchy.entries.get(id)!.root;
        if (objects.has(root)) continue; // The root copy already includes these layouts.
        for (const [depth, layout] of Object.entries(document.layouts[root]))
          if (layout[id])
            draft.layouts[root][depth][copyId] = geometry(id, layout[id]);
      }
    }
    const collapsed = collapsedObjects(draft);
    const sourceCollapsed = collapsedObjects(document);
    for (const [id, copyId] of objects)
      if (sourceCollapsed.has(id)) collapsed.add(copyId);
    setCollapsedObjects(draft, collapsed);
    for (const [id, copyId] of connections) {
      if (draft.connections[copyId]) throw new Error('Duplicate connection ID');
      const source = document.connections[id];
      const connectionOffset =
        source.ownerId !== null && objects.has(source.ownerId) ? 0 : offset;
      const endpoint = (end: Endpoint): Endpoint =>
        end.kind === 'free'
          ? { ...end, x: end.x + connectionOffset, y: end.y + connectionOffset }
          : { ...end, objectId: objects.get(end.objectId) ?? end.objectId };
      draft.connections[copyId] = {
        ...JSON.parse(JSON.stringify(source)),
        id: copyId,
        ownerId:
          source.ownerId === null
            ? null
            : (objects.get(source.ownerId) ?? source.ownerId),
        start: endpoint(source.start),
        end: endpoint(source.end),
        ...(source.points
          ? {
              points: source.points.map((p) => ({
                x: p.x + connectionOffset,
                y: p.y + connectionOffset,
              })),
            }
          : {}),
      };
    }
    stackSelection(selected, 'bring-to-front')(draft);
  };
  return { edit, selection: selected };
}
