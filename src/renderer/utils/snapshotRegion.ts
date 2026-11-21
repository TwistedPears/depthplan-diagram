import type { z } from 'zod';
import type { RecursiveDocument } from '../../shared/recursiveDocument';
import {
  sceneBounds,
  unionBounds,
  type Bounds,
  type Camera,
} from '../../shared/recursiveCamera';
import { recursiveScene } from '../../shared/recursiveScene';
import { editNamedView, resolveNamedViewCamera } from '../../shared/namedViews';
import { EditorError } from '../../shared/editorQueries';
import {
  SNAPSHOT_MAX_SIDE,
  type snapshotInput,
} from '../../shared/mcpSnapshotContract';

type Request = z.infer<typeof snapshotInput>;
type View = {
  document: RecursiveDocument;
  camera: Camera;
  viewport: { width: number; height: number };
};
export type SnapshotPlan = {
  scope: 'viewport' | 'whole' | 'objects' | 'bookmark';
  region: Bounds;
  scale: number;
  width: number;
  height: number;
};
const PADDING = 16;
const pad = (b: Bounds): Bounds => ({
  x: b.x - PADDING,
  y: b.y - PADDING,
  width: b.width + 2 * PADDING,
  height: b.height + 2 * PADDING,
});
const cameraRegion = (camera: Camera, viewport: View['viewport']) => {
  if (viewport.width <= 0 || viewport.height <= 0)
    throw new EditorError('BUSY', 'The canvas viewport has not been measured');
  return {
    x: -camera.x / camera.scale,
    y: -camera.y / camera.scale,
    width: viewport.width / camera.scale,
    height: viewport.height / camera.scale,
  };
};
/** Visible geometry and routes, the inputs that determine what the canvas draws. */
const drawn = (document: RecursiveDocument) => {
  const scene = recursiveScene(document);
  return JSON.stringify([
    [...scene.world].sort(([a], [b]) => (a < b ? -1 : 1)),
    [...scene.connections.values()]
      .flat()
      .map(({ id, route }) => [id, route])
      .sort(([a], [b]) => (String(a) < String(b) ? -1 : 1)),
  ]);
};
/** World region and natural pixel scale for a request, before the size cap. */
export function snapshotRegion(
  request: Request,
  { document, camera, viewport }: View,
): { scope: SnapshotPlan['scope']; region: Bounds; natural: number } {
  if (request.bookmarkId !== undefined) {
    const view = Object.hasOwn(document.namedViews ?? {}, request.bookmarkId)
      ? document.namedViews![request.bookmarkId]
      : undefined;
    if (!view) throw new EditorError('NOT_FOUND', 'Bookmark not found');
    // Offscreen rendering of another depth state is not available: be exact or refuse.
    const applied = JSON.parse(JSON.stringify(document)) as RecursiveDocument;
    editNamedView({ type: 'apply', id: request.bookmarkId })(applied);
    if (drawn(applied) !== drawn(document))
      throw new EditorError(
        'INVALID_REQUEST',
        'This bookmark shows different depths, folds or layout than the live board. Apply it with depthplan_bookmarks first, then snapshot the viewport.',
      );
    const target = resolveNamedViewCamera(view, viewport);
    if (target)
      return {
        scope: 'bookmark',
        region: cameraRegion(target, viewport),
        natural: target.scale,
      };
  }
  if (request.bookmarkId === undefined && request.scope === 'viewport')
    return {
      scope: 'viewport',
      region: cameraRegion(camera, viewport),
      natural: camera.scale,
    };
  const bounds = sceneBounds(document);
  if (request.bookmarkId === undefined && request.scope === 'objects') {
    if (!request.ids)
      throw new EditorError('INVALID_REQUEST', 'scope objects requires ids');
    const boxes = request.ids.map((id) => {
      const box = bounds.objects.get(id);
      if (!box)
        throw new EditorError(
          'NOT_FOUND',
          `Object ${id.slice(0, 64)} is not visible at the active depth`,
        );
      return box;
    });
    return { scope: 'objects', region: pad(unionBounds(boxes)!), natural: 1 };
  }
  if (!bounds.bounds)
    throw new EditorError('INVALID_REQUEST', 'Nothing is visible to render');
  return {
    scope: request.bookmarkId === undefined ? 'whole' : 'bookmark',
    region: pad(bounds.bounds),
    natural: 1,
  };
}
/** Largest scale at or below the natural one that fits the pixel and side caps. */
export function snapshotScale(
  region: Bounds,
  natural: number,
  maxPixels: number,
) {
  const scale = Math.min(
    natural,
    Math.sqrt(maxPixels / (region.width * region.height)),
    SNAPSHOT_MAX_SIDE / region.width,
    SNAPSHOT_MAX_SIDE / region.height,
  );
  const fit = (size: number) => Math.max(1, Math.floor(size * scale));
  return { scale, width: fit(region.width), height: fit(region.height) };
}
export function planSnapshot(request: Request, view: View): SnapshotPlan {
  const { scope, region, natural } = snapshotRegion(request, view);
  return {
    scope,
    region,
    ...snapshotScale(region, natural, request.maxPixels),
  };
}
