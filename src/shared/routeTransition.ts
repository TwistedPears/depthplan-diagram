import { flattenPoints, type ConnectionRoute } from './connectionGeometry';
import type { Geometry } from './recursiveDocument';

type Point = { x: number; y: number };
type Box = Pick<Geometry, 'x' | 'y' | 'width' | 'height'>;

const bounds = (boxes: Box[]) => ({
  left: Math.min(...boxes.map((b) => b.x - b.width / 2)),
  right: Math.max(...boxes.map((b) => b.x + b.width / 2)),
  top: Math.min(...boxes.map((b) => b.y - b.height / 2)),
  bottom: Math.max(...boxes.map((b) => b.y + b.height / 2)),
});

/** Maps a point of the final layout to where the same container's shapes are now. */
export function boundsRemap(end: Box[], now: Box[]): (point: Point) => Point {
  if (!end.length || end.length !== now.length) return (point) => point;
  const a = bounds(end);
  const b = bounds(now);
  const axis = (
    value: number,
    from: number,
    size: number,
    to: number,
    scaled: number,
  ) => to + (size > 1e-6 ? ((value - from) * scaled) / size : value - from);
  return ({ x, y }) => ({
    x: axis(x, a.left, a.right - a.left, b.left, b.right - b.left),
    y: axis(y, a.top, a.bottom - a.top, b.top, b.bottom - b.top),
  });
}

/**
 * One animation frame of a shape-avoiding route. Routing every frame lets the
 * router pick a different path each time, so lines flicker; instead the painted
 * route glides to the route of the final layout. A route with no comparable
 * start (newly shown, or a different number of bends) follows its container.
 */
export function transitionRoute(
  from: ConnectionRoute | undefined,
  to: ConnectionRoute,
  amount: number,
  remap: (point: Point) => Point,
): ConnectionRoute {
  const blend =
    from &&
    !from.bezier &&
    !to.bezier &&
    from.route.length === to.route.length &&
    from.vertices.length === to.vertices.length
      ? (list: Point[], start: Point[]) =>
          list.map((point, i) => ({
            x: start[i].x + (point.x - start[i].x) * amount,
            y: start[i].y + (point.y - start[i].y) * amount,
          }))
      : (list: Point[]) => list.map(remap);
  const route = blend(to.route, from?.route ?? []);
  return {
    ...to,
    vertices: blend(to.vertices, from?.vertices ?? []),
    route,
    points: flattenPoints(route),
    label: blend([to.label], from ? [from.label] : [])[0],
    samples: to.bezier ? to.samples : route,
  };
}
