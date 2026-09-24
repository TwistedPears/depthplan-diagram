import type { DocumentEdit } from './documentTransactions';
import type { RecursiveDocument } from './recursiveDocument';
import { activeWorldGeometry } from './recursiveHierarchy';
import {
  connectorEndpoint,
  targetObjectId,
  type ConnectionTarget,
  type Point,
} from './recursiveCreation';
export type BoundaryReference = { objectId: string; pointId: string };

export function inwardEndpoint(
  document: RecursiveDocument,
  source: BoundaryReference,
  target: ConnectionTarget,
  point: Point,
) {
  const world = activeWorldGeometry(document),
    childId = targetObjectId(target);
  if (
    !world.has(source.objectId) ||
    !document.objects[source.objectId]?.boundaryPoints?.[source.pointId]
  )
    throw new Error('The starting boundary point is unavailable.');
  if (
    !childId ||
    !world.has(childId) ||
    document.objects[childId].parentId !== source.objectId
  )
    throw new Error(
      'Choose a revealed immediate child or its boundary point. Reveal children with the root depth control first.',
    );
  if (
    typeof target === 'object' &&
    target &&
    !document.objects[childId].boundaryPoints?.[target.pointId]
  )
    throw new Error('The child boundary point is unavailable.');
  return connectorEndpoint(world, source.objectId, target, point);
}
export function createInwardBridge(
  id: string,
  kind: 'line' | 'arrow',
  source: BoundaryReference,
  target: ConnectionTarget,
  point: Point,
): DocumentEdit {
  return (draft) => {
    if (Object.hasOwn(draft.connections, id))
      throw new Error('Duplicate connector ID');
    const end = inwardEndpoint(draft, source, target, point);
    draft.connections[id] = {
      id,
      ownerId: source.objectId,
      kind,
      z: 0,
      start: { kind: 'boundary', ...source },
      end,
      style: { stroke: '#475569', strokeWidth: 2 },
    };
  };
}
export function reattachInwardBridge(
  id: string,
  target: ConnectionTarget,
  point: Point,
): DocumentEdit {
  return (draft) => {
    const connection = draft.connections[id];
    if (
      !connection ||
      connection.start.kind !== 'boundary' ||
      connection.start.objectId !== connection.ownerId
    )
      throw new Error('Select an inward bridge to reattach.');
    connection.end = inwardEndpoint(draft, connection.start, target, point);
  };
}
