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
import { containsShape, connectionOwner } from './recursiveOwnership';

export type BindingModifiers = {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};
export function connectionAnchors(geometry: Geometry) {
  return (
    [
      ['top', 0, -geometry.height / 2],
      ['right', geometry.width / 2, 0],
      ['bottom', 0, geometry.height / 2],
      ['left', -geometry.width / 2, 0],
    ] as const
  ).map(([side, x, y]) => ({ side, ...worldPoint({ x, y }, geometry) }));
}

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
    const outline = worldPoint(
      boundaryPosition(
        boundaryPlacement(point, geometry),
        geometry,
        document.objects[id],
      ),
      geometry,
    );
    return (
      (id !== ownerId &&
        containsShape(document.objects[id], geometry, point)) ||
      connectionAnchors(geometry).some(
        (anchor) => distance(point, anchor) <= 12 / scale,
      ) ||
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
  document: RecursiveDocument,
  world: Map<string, Geometry>,
  ownerId: string | null,
  target: ConnectionTarget,
  point: Point,
  scale: number,
): Endpoint {
  const endpoint = connectorEndpoint(world, ownerId, target, point);
  if (endpoint.kind === 'object') {
    const geometry = world.get(endpoint.objectId)!;
    const anchor = connectionAnchors(geometry).sort(
      (a, b) => distance(point, a) - distance(point, b),
    )[0];
    const outline = worldPoint(
      boundaryPosition(endpoint, geometry, document.objects[endpoint.objectId]),
      geometry,
    );
    endpoint.binding =
      distance(point, outline) <= 14 / scale ? 'fixed' : 'auto';
    if (distance(point, anchor) <= 12 / scale) {
      endpoint.binding = 'fixed';
      endpoint.side = anchor.side;
      endpoint.offset = 0.5;
    }
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
  scale: number,
): DiagramConnection {
  const otherKey = key === 'start' ? 'end' : 'start';
  const other = connection[otherKey];
  const targetId = typeof target === 'string' ? target : target?.objectId;
  let ownerId = connection.ownerId;
  if (targetId) {
    ownerId = connectionOwner(
      document,
      targetId,
      other.kind === 'free' ? null : other.objectId,
      ownerId,
    );
  }
  const result = {
    ...connection,
    ownerId,
    [key]: boundEndpoint(document, world, ownerId, target, point, scale),
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
