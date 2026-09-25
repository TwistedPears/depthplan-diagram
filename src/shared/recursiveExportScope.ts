import type { RecursiveDocument } from './recursiveDocument';
import { recursiveScene } from './recursiveScene';
import { visibleEndpoint } from './connectionGeometry';
export interface ExportSelection {
  objects: Set<string>;
  connections: Set<string>;
}
/** Depth-visible scope, independent of the viewport and without revealing hidden targets. */
export function resolveExportSelection(
  document: RecursiveDocument,
  selection: string[],
): ExportSelection {
  const scene = recursiveScene(document);
  const selected = new Set(selection);
  const objects = new Set(
    selection
      .filter((id) => id.startsWith('object-') && scene.world.has(id.slice(7)))
      .map((id) => id.slice(7)),
  );
  for (const id of objects)
    for (const child of scene.children.get(id) ?? []) objects.add(child);
  const connections = new Set<string>();
  for (const routes of scene.connections.values())
    for (const { id } of routes) {
      const connection = document.connections[id];
      if (
        selected.has(`connection-${id}`) ||
        [connection.start, connection.end].every((end) => {
          const target = visibleEndpoint(document, end, scene.world);
          return target.kind !== 'free' && objects.has(target.objectId);
        })
      )
        connections.add(id);
    }
  return { objects, connections };
}
