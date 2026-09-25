import { recursiveVisibility } from './recursiveVisibility';
import type { DiagramObject, Endpoint, Geometry } from './recursiveDocument';
import type { DocumentEdit } from './documentTransactions';
import {
  insertSubtree,
  eligibleParent,
  connectionOwners,
} from './recursiveOwnership';
import { setChildrenExpanded } from './recursiveLayouts';
import { activeWorldGeometry, toLocalGeometry } from './recursiveHierarchy';
import { localPoint } from './connectionGeometry';
import { boundaryPlacement } from './recursiveBoundary';
import { arrangeExpansion } from './expansionArrangement';
import {
  rememberExpansionLayout,
  rememberExpansionTransition,
} from './expansionLayouts';
export type ConnectionTarget =
  string | { objectId: string; pointId: string } | null;
export const targetObjectId = (target: ConnectionTarget) =>
  typeof target === 'string' ? target : (target?.objectId ?? null);
export type Point = { x: number; y: number };
export function drawnGeometry(
  start: Point,
  end: Point,
  square: boolean,
  click = false,
): Geometry {
  if (click)
    return {
      ...start,
      width: square ? 100 : 140,
      height: square ? 100 : 90,
      z: 0,
      rotation: 0,
    };
  const width = Math.max(
    1,
    Math.abs(end.x - start.x),
    square ? Math.abs(end.y - start.y) : 0,
  );
  const height = square ? width : Math.max(1, Math.abs(end.y - start.y));
  return {
    x: start.x + (Math.sign(end.x - start.x || 1) * width) / 2,
    y: start.y + (Math.sign(end.y - start.y || 1) * height) / 2,
    width,
    height,
    z: 0,
    rotation: 0,
  };
}
export function createShape(
  id: string,
  type: DiagramObject['type'],
  geometry: Geometry,
  parentId: string | null,
): DocumentEdit {
  return (draft) => {
    const outgoing =
      parentId === null
        ? undefined
        : rememberExpansionLayout(draft, [parentId]);
    insertSubtree(
      [
        {
          id,
          parentId,
          type,
          name: '',
          content: [],
          geometry,
          style: { fill: '#ffffff', stroke: '#64748b', strokeWidth: 2 },
        },
      ],
      geometry,
    )(draft);
    if (parentId !== null) {
      // A first child can become visible immediately at the selected root depth.
      if (recursiveVisibility(draft).expanded.has(parentId)) {
        arrangeExpansion(draft, new Set([parentId]));
        rememberExpansionTransition(draft, outgoing!, [parentId]);
      } else setChildrenExpanded(parentId, true)(draft);
    }
  };
}
export function createConnector(
  id: string,
  kind: 'line' | 'arrow',
  start: Point,
  end: Point,
  startTarget: ConnectionTarget,
  endTarget: ConnectionTarget,
  points?: Point[],
): DocumentEdit {
  return (draft) => {
    if (kind === 'line' && (startTarget !== null || endTarget !== null))
      throw new Error(
        'Only arrows can bind to shapes. Use an arrow for this connection.',
      );
    if (Object.hasOwn(draft.connections, id))
      throw new Error('Duplicate connector ID');
    const world = activeWorldGeometry(draft);
    const startId = targetObjectId(startTarget),
      endId = targetObjectId(endTarget);
    for (const target of [startId, endId])
      if (target !== null && !world.has(target))
        throw new Error('Connector target is hidden or missing');
    const scopes = [startId, endId]
      .filter((target): target is string => target !== null)
      .map((target) => connectionOwners(draft, target));
    const owners = scopes.reduce(
      (common, scope) => common.filter((id) => scope.includes(id)),
      scopes[0] ?? [],
    );
    if (scopes.length && !owners.length)
      throw new Error('Connect across containers through boundary points.');
    const { expanded } = recursiveVisibility(draft);
    const closed = new Set([...world.keys()].filter((id) => !expanded.has(id)));
    const startContainer = eligibleParent(draft, start, closed),
      endContainer = eligibleParent(draft, end, closed);
    const ownerId = owners.length
      ? owners[0]
      : startContainer === endContainer
        ? startContainer
        : null;
    draft.connections[id] = {
      id,
      ownerId,
      kind,
      z: 0,
      start: connectorEndpoint(world, ownerId, startTarget, start),
      end: connectorEndpoint(world, ownerId, endTarget, end),
      ...(points
        ? {
            points: points.map((p) =>
              localPoint(p, ownerId === null ? undefined : world.get(ownerId)),
            ),
          }
        : {}),
      style: { stroke: '#475569', strokeWidth: 2 },
    };
  };
}

export function connectorEndpoint(
  world: Map<string, Geometry>,
  ownerId: string | null,
  target: ConnectionTarget,
  point: Point,
): Endpoint {
  if (target === null) {
    const p =
      ownerId === null
        ? point
        : toLocalGeometry(
            { ...world.get(ownerId)!, ...point, rotation: 0 },
            world.get(ownerId)!,
          );
    return { kind: 'free', x: p.x, y: p.y };
  }
  const objectId = targetObjectId(target)!;
  if (!world.has(objectId))
    throw new Error('Connector target is hidden or missing');
  if (typeof target !== 'string') return { kind: 'boundary', ...target };
  return {
    kind: 'object',
    objectId,
    ...boundaryPlacement(point, world.get(objectId)!),
  };
}
