import Konva from 'konva';
import {
  type Bounds,
  intersectsBounds,
  viewportBounds,
} from '../../shared/recursiveCamera';
type Box = Bounds;
const intersect = (a: Box, b: Box): Box => ({
  x: Math.max(a.x, b.x),
  y: Math.max(a.y, b.y),
  width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
});
function transformBox(box: Box, transform: Konva.Transform): Box {
  const [a, b, c, d, e, f] = transform.getMatrix();
  const x = a * box.x + c * box.y + e;
  const y = b * box.x + d * box.y + f;
  const wx = a * box.width,
    hx = c * box.height,
    wy = b * box.width,
    hy = d * box.height;
  return {
    x: x + Math.min(0, wx) + Math.min(0, hx),
    y: y + Math.min(0, wy) + Math.min(0, hy),
    width: Math.abs(wx) + Math.abs(hx),
    height: Math.abs(wy) + Math.abs(hy),
  };
}
/** Conservative ink/hit bounds, using native text metrics and ancestor clip envelopes. */
export function paintedCandidateBounds(
  node: Konva.Shape,
  clips?: Map<Konva.Container, Box | null>,
): Box {
  const local = node.getClientRect({ skipTransform: true });
  const transform = node.getAbsoluteTransform();
  let box = transformBox(local, transform);
  const extra = Math.max(
    node.strokeEnabled() ? node.strokeWidth() * 10 : 0,
    typeof node.hitStrokeWidth() === 'number'
      ? Number(node.hitStrokeWidth()) / 2
      : 0,
    node instanceof Konva.Arrow
      ? Math.max(node.pointerLength(), node.pointerWidth())
      : 0,
    node instanceof Konva.Text ? node.fontSize() : 0,
  );
  const matrix = transform.getMatrix();
  const dx = extra * (Math.abs(matrix[0]) + Math.abs(matrix[2]));
  const dy = extra * (Math.abs(matrix[1]) + Math.abs(matrix[3]));
  box = {
    x: box.x - dx,
    y: box.y - dy,
    width: box.width + 2 * dx,
    height: box.height + 2 * dy,
  };
  let inherited = node.parent && clips?.get(node.parent);
  if (inherited === undefined) {
    const parents: Konva.Container[] = [];
    let parent = node.parent;
    while (parent && !clips?.has(parent)) {
      parents.push(parent);
      parent = parent.parent;
    }
    inherited = (parent && clips?.get(parent)) ?? null;
    for (const ancestor of parents.reverse()) {
      if (
        ancestor.clipWidth() !== undefined &&
        ancestor.clipHeight() !== undefined
      ) {
        const own = transformBox(
          {
            x: ancestor.clipX() ?? 0,
            y: ancestor.clipY() ?? 0,
            width: ancestor.clipWidth(),
            height: ancestor.clipHeight(),
          },
          ancestor.getAbsoluteTransform(),
        );
        inherited = inherited ? intersect(own, inherited) : own;
      }
      clips?.set(ancestor, inherited);
    }
  }
  return inherited ? intersect(box, inherited) : box;
}
/** Retain logical nodes and ancestor transforms; skip offscreen scene/hit drawing only. */
export function cullViewport(stage: Konva.Stage) {
  const layer = stage.getLayers()[0];
  if (!layer) return;
  // Screen coordinates use Konva's cached absolute transforms; relative-to-stage
  // queries recompute every ancestor transform for every shape and clip.
  const viewport = viewportBounds({ x: 0, y: 0, scale: 1 }, stage.size());
  // Siblings share clip chains only within this synchronous pass. A fresh map
  // on the next render keeps geometry, style, preview and camera changes current.
  const clips = new Map<Konva.Container, Box | null>();
  for (const node of layer.find<Konva.Shape>('Shape')) {
    if (!node.getAttr('viewportCulled') && !node.isVisible()) continue;
    const culled = !intersectsBounds(
      paintedCandidateBounds(node, clips),
      viewport,
    );
    node.setAttr('viewportCulled', culled);
    node.visible(!culled);
  }
  layer.batchDraw();
}
