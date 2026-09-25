import Konva from 'konva';
import { paintedCandidateBounds } from './recursivePaintBounds';
import type { ExportSelection } from '../../shared/recursiveExportScope';
import { captureKonvaStage } from './konvaExportManager';
import { intersectsBounds, unionBounds } from '../../shared/recursiveCamera';
type Box = { x: number; y: number; width: number; height: number };
/** Candidate boxes only bound the search; raster ink determines the result. */
function candidates(scene: Konva.Group) {
  return scene
    .find<Konva.Shape>('Shape')
    .filter((node) => node.isVisible() && node.getAbsoluteOpacity() !== 0)
    .map((node) => ({ node, box: paintedCandidateBounds(node) }))
    .filter(({ box }) => box.width > 0 && box.height > 0);
}
/** Native painted pixel envelope; bounded tiles also support sparse, very large SVG extents. */
function paintedBounds(scene: Konva.Group): Box | null {
  const entries = candidates(scene);
  const boxes = entries.map(({ box }) => box);
  const edge = (horizontal: boolean, reverse: boolean) => {
    const start = (b: Box) => Math.floor(horizontal ? b.x : b.y);
    const end = (b: Box) =>
      Math.ceil(horizontal ? b.x + b.width : b.y + b.height);
    const bestStart = reverse ? -Infinity : Infinity;
    let best = bestStart;
    const sorted = [...boxes].sort((a, b) =>
      reverse ? end(b) - end(a) : start(a) - start(b),
    );
    for (const box of sorted) {
      const low = start(box),
        high = end(box);
      if (reverse ? high <= best : low >= best) continue;
      const crossLow = Math.floor(horizontal ? box.y : box.x),
        crossHigh = Math.ceil(
          horizontal ? box.y + box.height : box.x + box.width,
        );
      for (
        let at = reverse ? high : low;
        reverse ? at > low : at < high;
        at += reverse ? -32 : 32
      ) {
        const from = reverse ? Math.max(low, at - 32) : at,
          to = reverse ? at : Math.min(high, at + 32);
        if (reverse ? to <= best : from >= best) break;
        let found = bestStart;
        for (let cross = crossLow; cross < crossHigh; cross += 512) {
          const length = Math.min(512, crossHigh - cross);
          const tile = horizontal
            ? { x: from, y: cross, width: to - from, height: length }
            : { x: cross, y: from, width: length, height: to - from };
          // Draw a halo so clipping at the tile edge cannot drop antialiased ink.
          const halo = {
            x: tile.x - 2,
            y: tile.y - 2,
            width: tile.width + 4,
            height: tile.height + 4,
          };
          // The detached scene has no camera. Reuse conservative painted bounds
          // to skip shapes outside this measurement tile, preserving clip/ink edges.
          for (const { node, box } of entries)
            node.visible(intersectsBounds(box, halo));
          const canvas = scene.toCanvas({ ...halo, pixelRatio: 1 });
          const pixels = canvas
            .getContext('2d')!
            .getImageData(2, 2, tile.width, tile.height).data;
          for (let y = 0; y < tile.height; y++)
            for (let x = 0; x < tile.width; x++)
              if (pixels[(y * tile.width + x) * 4 + 3]) {
                const coordinate =
                  from + (horizontal ? x : y) + (reverse ? 1 : 0);
                found = reverse
                  ? Math.max(found, coordinate)
                  : Math.min(found, coordinate);
              }
          canvas.width = 0;
          canvas.height = 0;
          if (found === (reverse ? to : from)) break;
        }
        if (found !== bestStart) {
          best = reverse ? Math.max(best, found) : Math.min(best, found);
          break;
        }
      }
    }
    return best;
  };
  try {
    const x = edge(true, false);
    if (!Number.isFinite(x)) return null;
    const y = edge(false, false),
      right = edge(true, true),
      bottom = edge(false, true);
    return { x, y, width: right - x, height: bottom - y };
  } finally {
    // SVG emission and any later raster must see all originally painted shapes.
    for (const { node } of entries) node.visible(true);
  }
}
/** Clone only the committed drawing layer. No camera, selection layers, handles, events or document mutations. */
export function captureRecursiveScene(stage: Konva.Stage) {
  const scene = new Konva.Group({ listening: false });
  for (const child of stage.getLayers()[0].getChildren())
    scene.add(child.clone());
  for (const node of scene.find('Shape'))
    if (node.getAttr('viewportCulled')) {
      node.visible(true);
      node.setAttr('viewportCulled', false);
    }
  for (const control of scene.find('.boundary-point, .child-stack-toggle'))
    control.destroy();
  return scene;
}
/** Keep ancestor groups only for their transforms, opacity and clipping. */
export function restrictExportScene(
  scene: Konva.Group,
  scope: ExportSelection,
) {
  const prune = (container: Konva.Container) => {
    for (const node of [...container.getChildren()]) {
      if (node.hasName('recursive-connection')) {
        if (!scope.connections.has(node.id().slice(11))) node.destroy();
        continue;
      }
      if (!(node instanceof Konva.Group)) continue;
      if (
        node.hasName('recursive-object') &&
        !scope.objects.has(node.id().slice(7))
      )
        for (const child of [...node.getChildren()])
          if (
            !(child instanceof Konva.Group) ||
            child.hasName('object-content')
          )
            child.destroy();
      prune(node);
      if (!node.getChildren().length) node.destroy();
    }
  };
  prune(scene);
}
const canRaster = (box: Box) =>
  box.width + 36 <= 32767 &&
  box.height + 36 <= 32767 &&
  (box.width + 36) * (box.height + 36) * 12 <= 32 * 1024 * 1024;

/** Send complete scanline bands to the native encoder, never allocate the whole image. */
export async function streamPng(scene: Konva.Group, bounds: Box) {
  const width = Math.ceil(bounds.width),
    height = Math.ceil(bounds.height);
  const entries = candidates(scene);
  const rows = Math.max(
    1,
    Math.min(256, Math.floor((8 * 1024 * 1024) / (width * 4))),
  );
  let visible = entries.map(({ node }) => node);
  const id = await window.desktop.export.startPng(width, height);
  try {
    const buffer = new Uint8Array(width * Math.min(rows, height) * 4);
    for (let y = 0; y < height; y += rows) {
      const bandHeight = Math.min(rows, height - y);
      const band = buffer.subarray(0, width * bandHeight * 4).fill(255);
      const bandEntries = entries.filter(({ box }) =>
        intersectsBounds(box, {
          x: bounds.x - 32,
          y: bounds.y + y - 32,
          width: width + 64,
          height: bandHeight + 64,
        }),
      );
      for (let x = 0; x < width; x += 1024) {
        const tileWidth = Math.min(1024, width - x);
        const halo = {
          x: bounds.x + x - 32,
          y: bounds.y + y - 32,
          width: tileWidth + 64,
          height: bandHeight + 64,
        };
        for (const node of visible) node.visible(false);
        visible = bandEntries
          .filter(({ box }) => intersectsBounds(box, halo))
          .map(({ node }) => node);
        for (const node of visible) node.visible(true);
        if (!visible.length) continue;
        const canvas = scene.toCanvas({ ...halo, pixelRatio: 1 });
        try {
          const context = canvas.getContext('2d')!;
          context.globalCompositeOperation = 'destination-over';
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(
            32,
            32,
            tileWidth,
            bandHeight,
          ).data;
          for (let row = 0; row < bandHeight; row++)
            band.set(
              pixels.subarray(row * tileWidth * 4, (row + 1) * tileWidth * 4),
              (row * width + x) * 4,
            );
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
      await window.desktop.export.writePng(id, band);
    }
    return await window.desktop.export.finishPng(id);
  } catch (error) {
    throw new Error(
      `PNG encoding failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    await window.desktop.export.abortPng(id);
  }
}
export async function encodeRecursiveExport(
  scene: Konva.Group,
  format: 'svg' | 'png',
) {
  let raster: HTMLCanvasElement | null = null;
  try {
    const candidate = unionBounds(candidates(scene).map(({ box }) => box));
    if (!candidate) throw new Error('Nothing to export.');
    const x = Math.floor(candidate.x),
      y = Math.floor(candidate.y);
    let painted: Box | null = {
      x,
      y,
      width: Math.ceil(candidate.x + candidate.width) - x,
      height: Math.ceil(candidate.y + candidate.height) - y,
    };
    if (!canRaster(painted)) painted = paintedBounds(scene);
    if (!painted) throw new Error('Nothing to export.');
    // Use one raster for measurement and PNG output. Repainting can change
    // subpixel coverage between the small-tile and large-canvas Skia paths.
    let crop: Box | null = null;
    if (canRaster(painted)) {
      const origin = { x: painted.x - 2, y: painted.y - 2 };
      raster = scene.toCanvas({
        ...origin,
        width: painted.width + 4,
        height: painted.height + 4,
        pixelRatio: 1,
      });
      const pixels = raster
        .getContext('2d')!
        .getImageData(0, 0, raster.width, raster.height).data;
      let left = raster.width,
        top = raster.height,
        right = 0,
        bottom = 0;
      for (let y = 0; y < raster.height; y++)
        for (let x = 0; x < raster.width; x++)
          if (pixels[(y * raster.width + x) * 4 + 3]) {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x + 1);
            bottom = Math.max(bottom, y + 1);
          }
      if (right <= left || bottom <= top) throw new Error('Nothing to export.');
      crop = { x: left, y: top, width: right - left, height: bottom - top };
      painted = { ...crop, x: origin.x + left, y: origin.y + top };
    }
    const bounds = {
      x: painted.x - 16,
      y: painted.y - 16,
      width: painted.width + 32,
      height: painted.height + 32,
    };
    if (format === 'svg') {
      const root = new Konva.Group({
        width: bounds.width,
        height: bounds.height,
      });
      root.add(
        new Konva.Rect({
          width: bounds.width,
          height: bounds.height,
          fill: 'white',
        }),
      );
      scene.position({ x: -bounds.x, y: -bounds.y });
      root.add(scene);
      try {
        return captureKonvaStage(root);
      } finally {
        root.destroy();
      }
    }
    if (!raster || !crop) return await streamPng(scene, bounds);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(bounds.width);
    canvas.height = Math.ceil(bounds.height);
    try {
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        raster,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        16,
        16,
        crop.width,
        crop.height,
      );
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(
                  new Error(
                    'PNG encoding failed. Choose SVG or a smaller selection.',
                  ),
                ),
          'image/png',
        ),
      );
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    if (raster) {
      raster.width = 0;
      raster.height = 0;
    }
    scene.destroy();
  }
}
