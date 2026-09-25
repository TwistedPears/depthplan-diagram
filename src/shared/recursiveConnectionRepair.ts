import type {
  DiagramConnection,
  Endpoint,
  Geometry,
  RecursiveDocument,
} from './recursiveDocument';
import type { DocumentEdit } from './documentTransactions';
import {
  activeWorldGeometry,
  indexHierarchy,
  toLocalGeometry,
} from './recursiveHierarchy';
import { worldAt } from './recursiveReparent';
import { connectionRoute, worldPoint, localPoint } from './connectionGeometry';
import { connectionOwner } from './recursiveOwnership';
import { recursiveVisibility } from './recursiveVisibility';

/** Resolve retained hidden geometry using the same deterministic policy as reparenting. */
export function savedWorldGeometry(
  document: RecursiveDocument,
  id: string,
): Geometry {
  const { root } = indexHierarchy(document.objects).entries.get(id)!;
  return worldAt(document, root, document.rootDepths[root], id);
}
export function endpointWorld(
  document: RecursiveDocument,
  connection: DiagramConnection,
  end: Endpoint,
) {
  const world = activeWorldGeometry(document);
  const { visible, expanded } = recursiveVisibility(document);
  for (const id of world.keys()) if (!visible.has(id)) world.delete(id);
  let route =
    connection.ownerId === null || expanded.has(connection.ownerId)
      ? connectionRoute(document, connection, world)
      : null;
  if (!route) {
    world.clear();
    for (const id of [
      connection.ownerId,
      ...[connection.start, connection.end].map((e) =>
        e.kind === 'free' ? null : e.objectId,
      ),
    ])
      if (id !== null) world.set(id, savedWorldGeometry(document, id));
    route = connectionRoute(document, connection, world)!;
  }
  return worldPoint(
    end === connection.start ? route.vertices[0] : route.vertices.at(-1)!,
    connection.ownerId === null ? undefined : world.get(connection.ownerId),
  );
}

function freeAt(
  document: RecursiveDocument,
  ownerId: string | null,
  point: { x: number; y: number },
): Endpoint {
  const owner = ownerId === null ? null : savedWorldGeometry(document, ownerId);
  const local = owner
    ? toLocalGeometry({ ...owner, ...point, rotation: 0 }, owner)
    : point;
  return { kind: 'free', x: local.x, y: local.y };
}
function ancestry(document: RecursiveDocument, id: string | null): string {
  const ids: string[] = [];
  for (
    let cursor = id;
    cursor !== null;
    cursor = document.objects[cursor].parentId
  )
    ids.push(cursor);
  return JSON.stringify(ids);
}
/** Run once AFTER the full structural edit, before transaction validation/publication. */
export function repairConnections(
  before: RecursiveDocument,
  draft: RecursiveDocument,
) {
  for (const old of Object.values(before.connections)) {
    const connection = draft.connections[old.id];
    if (!connection) continue;
    const deleted = (end: Endpoint) =>
      end.kind !== 'free' && !draft.objects[end.objectId];
    if (
      (old.ownerId !== null && !draft.objects[old.ownerId]) ||
      (deleted(old.start) && deleted(old.end))
    ) {
      delete draft.connections[old.id];
      continue;
    }
    let changed = false;
    for (const key of ['start', 'end'] as const) {
      const end = old[key];
      if (end.kind === 'free') continue;
      if (
        deleted(end) ||
        (end.kind === 'boundary' &&
          !draft.objects[end.objectId].boundaryPoints?.[end.pointId])
      ) {
        connection[key] = freeAt(
          draft,
          old.ownerId,
          endpointWorld(before, old, end),
        );
      } else if (
        ancestry(before, end.objectId) !== ancestry(draft, end.objectId)
      )
        changed = true;
    }
    if (!changed) continue;
    const ownerId = connectionOwner(
      draft,
      connection.start.kind === 'free' ? null : connection.start.objectId,
      connection.end.kind === 'free' ? null : connection.end.objectId,
      old.ownerId,
    );
    if (ownerId !== old.ownerId) {
      for (const key of ['start', 'end'] as const)
        if (connection[key].kind === 'free')
          connection[key] = freeAt(
            draft,
            ownerId,
            endpointWorld(before, old, old[key]),
          );
      if (connection.points) {
        const oldOwner =
          old.ownerId === null
            ? undefined
            : savedWorldGeometry(before, old.ownerId);
        const newOwner =
          ownerId === null ? undefined : savedWorldGeometry(draft, ownerId);
        connection.points = connection.points.map((p) =>
          localPoint(worldPoint(p, oldOwner), newOwner),
        );
      }
      connection.ownerId = ownerId;
    }
  }
}
export function deleteBoundaryPoint(
  objectId: string,
  pointId: string,
): DocumentEdit {
  return (draft) => {
    if (!draft.objects[objectId]?.boundaryPoints?.[pointId])
      throw new Error('The boundary point no longer exists.');
    const before = JSON.parse(JSON.stringify(draft)) as RecursiveDocument;
    delete draft.objects[objectId].boundaryPoints![pointId];
    repairConnections(before, draft);
  };
}
/** The user authors the replacement with normal connector/boundary tools, then explicitly accepts it. */
export function resolveConnectionRepair(
  id: string,
  replacementId: string,
): DocumentEdit {
  return (draft) => {
    const repair = draft.connectionRepairs?.[id],
      replacement = draft.connections[replacementId];
    if (!repair || !replacement)
      throw new Error('Select an authored replacement connection.');
    draft.connections[id] = {
      ...repair.connection,
      ownerId: replacement.ownerId,
      start: replacement.start,
      end: replacement.end,
      points:
        replacement.points ??
        (repair.connection.points ?? []).map((p) =>
          localPoint(
            worldPoint(p, repair.ownerGeometry ?? undefined),
            replacement.ownerId === null
              ? undefined
              : savedWorldGeometry(draft, replacement.ownerId),
          ),
        ),
    };
    delete draft.connections[replacementId];
    delete draft.connectionRepairs![id];
  };
}
