import type {
  BoundaryPoint,
  DiagramObject,
  Geometry,
  RecursiveDocument,
} from './recursiveDocument';
import type { DocumentEdit } from './documentTransactions';
import { toLocalGeometry } from './recursiveHierarchy';
import type { Point } from './recursiveCreation';

/** A normalized rectangle ray is projected onto the displayed outline. */
export function boundaryPosition(
  point: BoundaryPoint,
  geometry: Geometry,
  object: DiagramObject,
): Point {
  const a = geometry.width / 2,
    b = geometry.height / 2;
  let x =
    point.side === 'left'
      ? -a
      : point.side === 'right'
        ? a
        : (point.offset * 2 - 1) * a;
  let y =
    point.side === 'top'
      ? -b
      : point.side === 'bottom'
        ? b
        : (point.offset * 2 - 1) * b;
  if (object.type === 'ellipse' || object.type === 'diamond') {
    const distance =
      object.type === 'ellipse'
        ? Math.hypot(x / a, y / b)
        : Math.abs(x / a) + Math.abs(y / b);
    x /= distance;
    y /= distance;
  } else {
    const radius =
      typeof object.style?.cornerRadius === 'number'
        ? Math.max(0, Math.min(a, b, object.style.cornerRadius))
        : 0;
    if (radius && Math.abs(x) > a - radius && Math.abs(y) > b - radius) {
      const cx = Math.sign(x) * (a - radius),
        cy = Math.sign(y) * (b - radius);
      const aa = x * x + y * y,
        bb = -2 * (x * cx + y * cy),
        cc = cx * cx + cy * cy - radius * radius;
      const scale =
        (-bb + Math.sqrt(Math.max(0, bb * bb - 4 * aa * cc))) / (2 * aa);
      x *= scale;
      y *= scale;
    }
  }
  return { x, y };
}
export function boundaryPlacement(
  pointer: Point,
  world: Geometry,
): BoundaryPoint {
  const p = toLocalGeometry({ ...world, ...pointer }, world);
  const x = p.x / (world.width / 2),
    y = p.y / (world.height / 2);
  if (x === 0 && y === 0) return { side: 'right', offset: 0.5 };
  const horizontal = Math.abs(x) >= Math.abs(y);
  return {
    side: horizontal ? (x < 0 ? 'left' : 'right') : y < 0 ? 'top' : 'bottom',
    offset: Math.max(
      0,
      Math.min(1, ((horizontal ? y / Math.abs(x) : x / Math.abs(y)) + 1) / 2),
    ),
  };
}
export function editBoundaryPoint(
  objectId: string,
  pointId: string,
  point: BoundaryPoint,
  create = false,
): DocumentEdit {
  return (draft) => {
    const object = draft.objects[objectId];
    if (!object) throw new Error('The shape no longer exists.');
    const exists = Object.hasOwn(object.boundaryPoints ?? {}, pointId);
    if (create ? exists : !exists)
      throw new Error('The boundary point no longer matches this edit.');
    object.boundaryPoints = { ...object.boundaryPoints, [pointId]: point };
  };
}
export function previewBoundaryPoint(
  document: RecursiveDocument,
  objectId: string,
  pointId: string,
  point: BoundaryPoint,
): RecursiveDocument {
  const object = document.objects[objectId];
  return {
    ...document,
    objects: {
      ...document.objects,
      [objectId]: {
        ...object,
        boundaryPoints: { ...object.boundaryPoints, [pointId]: point },
      },
    },
  };
}
