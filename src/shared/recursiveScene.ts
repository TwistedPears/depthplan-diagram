import type {
  Geometry,
  RecursiveDocument,
  RichBlock,
  DiagramObject,
} from './recursiveDocument';
import { activeWorldGeometry, indexHierarchy } from './recursiveHierarchy';
import { connectionRoute, type ConnectionRoute } from './connectionGeometry';
import { recursiveVisibility } from './recursiveVisibility';

export type SceneItem = { id: string; z: number } & (
  { kind: 'object' } | { kind: 'connection'; route: ConnectionRoute }
);

/** Controls can identify unnamed shapes without adding text to the drawing. */
export function objectLabel(object: DiagramObject): string {
  return object.name || object.type[0].toUpperCase() + object.type.slice(1);
}

export function contentText(blocks: RichBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'code') return block.text;
      if (block.type === 'quote') return contentText(block.blocks);
      if (block.type === 'list') return block.items.map(contentText).join('\n');
      return block.runs.map((run) => run.text).join('');
    })
    .join('\n');
}

export function recursiveScene(document: RecursiveDocument) {
  const hierarchy = indexHierarchy(document.objects);
  const { visible, expanded } = recursiveVisibility(document, hierarchy);
  const world = activeWorldGeometry(document, hierarchy);
  for (const id of world.keys()) if (!visible.has(id)) world.delete(id);
  const local = new Map<string, Geometry>();
  for (const id of visible) {
    const { root } = hierarchy.entries.get(id)!;
    local.set(id, document.layouts[root][document.rootDepths[root]][id]);
  }
  const compare = (a: string, b: string) =>
    local.get(a)!.z - local.get(b)!.z || (a < b ? -1 : a > b ? 1 : 0);
  const children = new Map(
    [...hierarchy.children].map(([id, ids]) => [
      id,
      ids.filter((child) => visible.has(child)).sort(compare),
    ]),
  );
  const paintOrder = new Map<string | null, SceneItem[]>(
    [...children].map(([owner, ids]) => [
      owner,
      ids.map((id) => ({ kind: 'object', id, z: local.get(id)!.z })),
    ]),
  );
  const connections = new Map<
    string | null,
    Array<{ id: string } & ConnectionRoute>
  >();
  for (const connection of Object.values(document.connections).sort(
    (a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )) {
    if (connection.ownerId !== null && !expanded.has(connection.ownerId))
      continue;
    const route = connectionRoute(document, connection, world);
    if (!route) continue;
    if (!connections.has(connection.ownerId))
      connections.set(connection.ownerId, []);
    connections.get(connection.ownerId)!.push({ id: connection.id, ...route });
    const items = paintOrder.get(connection.ownerId) ?? [];
    items.push({
      kind: 'connection',
      id: connection.id,
      z: connection.z,
      route,
    });
    paintOrder.set(connection.ownerId, items);
  }
  // Equal-Z connections stay behind shapes; IDs break ties within each kind.
  for (const items of paintOrder.values())
    items.sort(
      (a, b) =>
        a.z - b.z ||
        (a.kind === b.kind ? 0 : a.kind === 'connection' ? -1 : 1) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  return {
    hierarchy,
    children,
    expanded,
    local,
    world,
    connections,
    paintOrder,
  };
}
