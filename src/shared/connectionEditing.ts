import { indexHierarchy } from './recursiveHierarchy';
import type {
  DiagramConnection,
  Endpoint,
  Geometry,
  RecursiveDocument,
} from './recursiveDocument';
import {
  connectorEndpoint,
  type ConnectionTarget,
  type Point,
} from './recursiveCreation';
import { boundaryPlacement, boundaryPosition } from './recursiveBoundary';
import { distance, localPoint, worldPoint } from './connectionGeometry';
import { containsShape } from './recursiveOwnership';

export type BindingModifiers = {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};
export function bindingTarget(
  document: RecursiveDocument,
  world: Map<string, Geometry>,
  point: Point,
  scale: number,
  modifiers: BindingModifiers,
  ownerId?: string | null,
): ConnectionTarget {
  if (modifiers.ctrlKey || modifiers.metaKey) return null;
  const candidates = [...world].filter(([id, geometry]) => {
    if (id === ownerId) return false;
    const outline = worldPoint(
      boundaryPosition(
        boundaryPlacement(point, geometry),
        geometry,
        document.objects[id],
      ),
      geometry,
    );
    return (
      containsShape(document.objects[id], geometry, point) ||
      distance(point, outline) <= 14 / scale
    );
  });
  if (candidates.length > 1) {
    const hierarchy = indexHierarchy(document.objects);
    candidates.sort(
      ([a, ga], [b, gb]) =>
        hierarchy.entries.get(b)!.generation -
          hierarchy.entries.get(a)!.generation ||
        gb.z - ga.z ||
        ga.width * ga.height - gb.width * gb.height,
    );
  }
  return candidates[0]?.[0] ?? null;
}
export function boundEndpoint(
  world: Map<string, Geometry>,
  ownerId: string | null,
  target: ConnectionTarget,
  point: Point,
  precise: boolean,
): Endpoint {
  const endpoint = connectorEndpoint(world, ownerId, target, point);
  if (endpoint.kind === 'object') {
    endpoint.binding = precise ? 'fixed' : 'auto';
    if (!precise && Math.abs(endpoint.offset - 0.5) < 0.12)
      endpoint.offset = 0.5;
  }
  return endpoint;
}
/** Endpoints and all authored vertices change coordinate space together when a free path is first bound. */
export function replaceEndpoint(
  document: RecursiveDocument,
  world: Map<string, Geometry>,
  connection: DiagramConnection,
  key: 'start' | 'end',
  point: Point,
  target: ConnectionTarget,
  precise: boolean,
): DiagramConnection {
  const otherKey = key === 'start' ? 'end' : 'start';
  const other = connection[otherKey];
  const targetId = typeof target === 'string' ? target : target?.objectId;
  let ownerId = connection.ownerId;
  if (targetId) {
    const targetOwners =
      typeof target === 'string'
        ? [document.objects[targetId].parentId]
        : [document.objects[targetId].parentId, targetId];
    if (!targetOwners.includes(ownerId)) {
      const otherOwners =
        other.kind === 'free'
          ? targetOwners
          : other.kind === 'boundary'
            ? [document.objects[other.objectId].parentId, other.objectId]
            : [document.objects[other.objectId].parentId];
      const legal = targetOwners.filter((id) => otherOwners.includes(id));
      if (!legal.length)
        throw new Error('Connect across containers through boundary points.');
      ownerId = legal[0];
    }
  }
  const result = {
    ...connection,
    ownerId,
    [key]: boundEndpoint(world, ownerId, target, point, precise),
  };
  if (ownerId !== connection.ownerId) {
    const oldOwner =
      connection.ownerId === null ? undefined : world.get(connection.ownerId);
    const newOwner = ownerId === null ? undefined : world.get(ownerId);
    const convert = (p: Point) => localPoint(worldPoint(p, oldOwner), newOwner);
    if (other.kind === 'free')
      result[otherKey] = { kind: 'free', ...convert(other) };
    if (connection.points) result.points = connection.points.map(convert);
  }
  return result;
}
