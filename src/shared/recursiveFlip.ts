import type { DocumentEdit } from './documentTransactions';
import { editActiveGeometry } from './documentTransactions';
import type { BoundaryPoint, RecursiveDocument } from './recursiveDocument';
import { activeWorldGeometry, toLocalGeometry } from './recursiveHierarchy';
import { copyScope } from './recursiveDuplication';
import { recursiveScene } from './recursiveScene';
import { sceneBounds, unionBounds } from './recursiveCamera';
import { localPoint, worldPoint } from './connectionGeometry';
import { endpointWorld } from './recursiveConnectionRepair';
import type { Point } from './recursiveCreation';

/** Mirror the active arrangement, keeping text readable and bindings attached. */
export function flipSelection(
  document: RecursiveDocument,
  selection: string[],
  axis: 'x' | 'y',
): DocumentEdit {
  return (draft) => {
    const bounds = sceneBounds(document, recursiveScene(document));
    const box = unionBounds(
      selection.flatMap((key) => {
        const b = key.startsWith('object-')
          ? bounds.objects.get(key.slice(7))
          : bounds.connections.get(key.slice(11));
        return b ? [b] : [];
      }),
    );
    if (!box) return;
    const center = box[axis] + box[axis === 'x' ? 'width' : 'height'] / 2;
    const reflect = (p: Point): Point => ({
      ...p,
      [axis]: 2 * center - p[axis],
    });
    const placement = (p: BoundaryPoint): BoundaryPoint => {
      const sides = axis === 'x' ? ['left', 'right'] : ['top', 'bottom'];
      return sides.includes(p.side)
        ? {
            side: sides[1 - sides.indexOf(p.side)] as BoundaryPoint['side'],
            offset: p.offset,
          }
        : { side: p.side, offset: 1 - p.offset };
    };
    const scope = copyScope(document, selection);
    const world = activeWorldGeometry(document);
    const mirrored = new Set([...scope.members].filter((id) => world.has(id)));
    const nextWorld = new Map(world);
    for (const id of mirrored) {
      const g = world.get(id)!;
      nextWorld.set(id, {
        ...g,
        ...reflect(g),
        rotation: (360 - g.rotation) % 360,
      });
    }
    for (const id of mirrored) {
      const parent = document.objects[id].parentId;
      const g = nextWorld.get(id)!;
      editActiveGeometry(
        id,
        parent === null ? g : toLocalGeometry(g, nextWorld.get(parent)!),
      )(draft);
      for (const [pointId, point] of Object.entries(
        document.objects[id].boundaryPoints ?? {},
      ))
        draft.objects[id].boundaryPoints![pointId] = placement(point);
    }
    for (const connection of Object.values(document.connections)) {
      const copy = draft.connections[connection.id];
      const flipPath =
        scope.connections.has(connection.id) &&
        (connection.ownerId === null || world.has(connection.ownerId));
      const oldOwner =
        connection.ownerId === null ? undefined : world.get(connection.ownerId);
      const newOwner =
        connection.ownerId === null
          ? undefined
          : nextWorld.get(connection.ownerId);
      for (const key of ['start', 'end'] as const) {
        const end = connection[key];
        if (end.kind !== 'free' && mirrored.has(end.objectId)) {
          if (end.kind === 'object') copy[key] = { ...end, ...placement(end) };
        } else if (
          flipPath &&
          (end.kind === 'free' || !scope.members.has(end.objectId))
        ) {
          copy[key] = {
            kind: 'free',
            ...localPoint(
              reflect(endpointWorld(document, connection, end)),
              newOwner,
            ),
          };
        }
      }
      if (flipPath && connection.points)
        copy.points = connection.points.map((p) =>
          localPoint(reflect(worldPoint(p, oldOwner)), newOwner),
        );
    }
  };
}
