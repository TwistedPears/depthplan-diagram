import type { Geometry, RecursiveDocument } from './recursiveDocument';
import { labelSize } from './connectionGeometry';
import { recursiveScene } from './recursiveScene';
import { toWorldGeometry } from './recursiveHierarchy';
export type Bounds = { x: number; y: number; width: number; height: number };
export type Camera = { x: number; y: number; scale: number };
export function geometryBounds(g: Geometry, stroke = 0): Bounds {
  const a = (g.rotation * Math.PI) / 180;
  const width =
    Math.abs(g.width * Math.cos(a)) + Math.abs(g.height * Math.sin(a)) + stroke;
  const height =
    Math.abs(g.width * Math.sin(a)) + Math.abs(g.height * Math.cos(a)) + stroke;
  return { x: g.x - width / 2, y: g.y - height / 2, width, height };
}
export function unionBounds(boxes: Bounds[]): Bounds | null {
  if (!boxes.length) return null;
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const b of boxes) {
    left = Math.min(left, b.x);
    top = Math.min(top, b.y);
    right = Math.max(right, b.x + b.width);
    bottom = Math.max(bottom, b.y + b.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
/** Conservative painted bounds: hidden depths never contribute; clipping intersects ancestor bounds. */
export function sceneBounds(
  document: RecursiveDocument,
  scene = recursiveScene(document),
) {
  const clip = (box: Bounds, parent: string | null): Bounds | null => {
    let b = box;
    for (let id = parent; id !== null; id = document.objects[id].parentId) {
      if (!document.objects[id].style?.clipToFrame) continue;
      const c = geometryBounds(scene.world.get(id)!);
      const x = Math.max(b.x, c.x),
        y = Math.max(b.y, c.y);
      const right = Math.min(b.x + b.width, c.x + c.width),
        bottom = Math.min(b.y + b.height, c.y + c.height);
      if (right < x || bottom < y) return null;
      b = { x, y, width: right - x, height: bottom - y };
    }
    return b;
  };
  const objects = new Map<string, Bounds>();
  for (const [id, geometry] of scene.world) {
    const style = document.objects[id].style;
    const box = clip(
      geometryBounds(
        geometry,
        typeof style?.strokeWidth === 'number'
          ? Math.max(0, style.strokeWidth)
          : 1.5,
      ),
      document.objects[id].parentId,
    );
    if (box) objects.set(id, box);
  }
  const connections = new Map<string, Bounds>();
  for (const [owner, values] of scene.connections)
    for (const { id, points, label: labelAt } of values) {
      const stroke = document.connections[id].style?.strokeWidth;
      const padding = Math.max(
        32,
        typeof stroke === 'number' ? stroke * 10 : 0,
      );
      const pointBoxes: Bounds[] = [];
      for (let i = 0; i < points.length; i += 2) {
        const local = {
          x: points[i],
          y: points[i + 1],
          rotation: 0,
          width: 0,
          height: 0,
          z: 0,
        };
        const p =
          owner === null
            ? local
            : toWorldGeometry(local, scene.world.get(owner)!);
        pointBoxes.push({
          x: p.x - padding,
          y: p.y - padding,
          width: padding * 2,
          height: padding * 2,
        });
      }
      const label = document.connections[id].label;
      if (label) {
        const { width, height } = labelSize(label);
        const local = {
          x: labelAt.x,
          y: labelAt.y,
          width,
          height,
          rotation: 0,
          z: 0,
        };
        pointBoxes.push(
          geometryBounds(
            owner === null
              ? local
              : toWorldGeometry(local, scene.world.get(owner)!),
          ),
        );
      }
      const b = clip(unionBounds(pointBoxes)!, owner);
      if (b) connections.set(id, b);
    }
  return {
    objects,
    connections,
    bounds: unionBounds([...objects.values(), ...connections.values()]),
  };
}
export function fitCamera(
  bounds: Bounds | null,
  size: { width: number; height: number },
  padding = 80,
): Camera {
  if (!bounds) return { x: size.width / 2, y: size.height / 2, scale: 1 };
  const scale = Math.min(
    2,
    Math.max(1, size.width - 2 * padding) / Math.max(1, bounds.width),
    Math.max(1, size.height - 2 * padding) / Math.max(1, bounds.height),
  );
  return {
    x: size.width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: size.height / 2 - (bounds.y + bounds.height / 2) * scale,
    scale,
  };
}
export function zoomCamera(
  camera: Camera,
  point: { x: number; y: number },
  scale: number,
): Camera {
  return {
    x: point.x - ((point.x - camera.x) * scale) / camera.scale,
    y: point.y - ((point.y - camera.y) * scale) / camera.scale,
    scale,
  };
}

/** The actual viewport in world coordinates, padded by two device-independent pixels for antialiasing. */
export function viewportBounds(
  camera: Camera,
  size: { width: number; height: number },
): Bounds {
  return {
    x: (-camera.x - 2) / camera.scale,
    y: (-camera.y - 2) / camera.scale,
    width: (size.width + 4) / camera.scale,
    height: (size.height + 4) / camera.scale,
  };
}
export function intersectsBounds(a: Bounds, b: Bounds): boolean {
  return (
    a.width >= 0 &&
    a.height >= 0 &&
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}
