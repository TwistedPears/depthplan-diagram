import {
  type NamedView,
  type RecursiveDocument,
  validId,
} from './recursiveDocument';
import type { Camera } from './recursiveCamera';
import { type DocumentEdit } from './documentTransactions';
import { indexHierarchy } from './recursiveHierarchy';
import { ensureDepthLayout } from './recursiveLayouts';
import { collapsedObjects, setCollapsedObjects } from './recursiveVisibility';
import {
  rememberExpansionLayout,
  resetExpansionContext,
} from './expansionLayouts';
export type NamedViewAction =
  | { type: 'create' | 'rename'; id: string; name: string }
  | { type: 'apply' | 'update' | 'delete'; id: string }
  | { type: 'duplicate'; id: string; newId: string };
export interface NamedViewResult {
  status: 'accepted' | 'noop' | 'rejected';
  error?: string;
  adjustments: string[];
}
export function resolveNamedView(document: RecursiveDocument, id: string) {
  const view =
    document.namedViews && Object.hasOwn(document.namedViews, id)
      ? document.namedViews[id]
      : undefined;
  if (!view) throw new Error(`Missing bookmark ${id}`);
  const hierarchy = indexHierarchy(document.objects),
    adjustments: string[] = [];
  const rootDepths: Record<string, number> = {};
  for (const root of hierarchy.roots) {
    const saved = Object.hasOwn(view.rootDepths, root)
      ? view.rootDepths[root]
      : undefined;
    rootDepths[root] = Math.min(saved ?? 0, hierarchy.maximum.get(root)!);
    if (saved === undefined) adjustments.push(`${root}: new root set to D0.`);
    else if (saved !== rootDepths[root])
      adjustments.push(
        `${root}: saved D${saved} clamped to D${rootDepths[root]}.`,
      );
  }
  for (const root of Object.keys(view.rootDepths))
    if (!Object.hasOwn(rootDepths, root))
      adjustments.push(
        `${root}: deleted or former root ignored; bookmark retained.`,
      );
  return { rootDepths, adjustments };
}
export function resolveNamedViewCamera(
  view: NamedView | undefined,
  viewport: { width: number; height: number },
): Camera | undefined {
  if (!view?.camera) return undefined;
  const { camera, cameraFocus } = view;
  if (!cameraFocus || viewport.width <= 0 || viewport.height <= 0)
    return camera;
  return {
    x: viewport.width / 2 - cameraFocus.x * camera.scale,
    y: viewport.height / 2 - cameraFocus.y * camera.scale,
    scale: camera.scale,
  };
}

function captureView(
  document: RecursiveDocument,
  camera?: Camera,
  viewport?: { width: number; height: number },
) {
  return {
    rootDepths: { ...document.rootDepths },
    layouts: Object.fromEntries(
      Object.entries(document.rootDepths).map(([root, depth]) => [
        root,
        Object.fromEntries(
          Object.entries(document.layouts[root][depth]).map(
            ([id, { x, y, width, height }]) => [
              id,
              { x, y, width, height, parentId: document.objects[id].parentId },
            ],
          ),
        ),
      ]),
    ),
    ...(camera ? { camera: { ...camera } } : {}),
    ...(camera && viewport && viewport.width > 0 && viewport.height > 0
      ? {
          cameraFocus: {
            x: (viewport.width / 2 - camera.x) / camera.scale,
            y: (viewport.height / 2 - camera.y) / camera.scale,
          },
        }
      : {}),
  };
}
export function editNamedView(
  action: NamedViewAction,
  camera?: Camera,
  viewport?: { width: number; height: number },
): DocumentEdit {
  return (draft) => {
    if (!validId(action.id)) throw new Error('Invalid bookmark ID.');
    const current =
      draft.namedViews && Object.hasOwn(draft.namedViews, action.id)
        ? draft.namedViews[action.id]
        : undefined;
    if (action.type === 'create' || action.type === 'rename') {
      const name = action.name.trim();
      if (!name) throw new Error('Enter a bookmark name.');
      if (action.type === 'create') {
        if (current) throw new Error('Bookmark ID already exists.');
        draft.namedViews ??= {};
        draft.namedViews[action.id] = {
          id: action.id,
          name,
          ...captureView(draft, camera, viewport),
          ...(collapsedObjects(draft).size
            ? { metadata: { collapsedObjects: [...collapsedObjects(draft)] } }
            : {}),
        };
        return;
      }
      if (!current) throw new Error('Bookmark no longer exists.');
      current.name = name;
    } else if (action.type === 'duplicate') {
      if (!current) throw new Error('Bookmark no longer exists.');
      if (!validId(action.newId)) throw new Error('Invalid bookmark ID.');
      if (Object.hasOwn(draft.namedViews!, action.newId))
        throw new Error('Bookmark ID already exists.');
      draft.namedViews![action.newId] = {
        ...current,
        id: action.newId,
        name: `${current.name} copy`,
      };
    } else if (action.type === 'delete') {
      if (draft.namedViews) delete draft.namedViews[action.id];
    } else {
      if (!current) throw new Error('Bookmark no longer exists.');
      if (action.type === 'update') {
        if (collapsedObjects(draft).size)
          current.metadata = {
            ...current.metadata,
            collapsedObjects: [...collapsedObjects(draft)],
          };
        else if (current.metadata) delete current.metadata.collapsedObjects;
        delete current.cameraFocus;
        Object.assign(current, captureView(draft, camera, viewport));
      } else {
        if (draft.extensions?.expansionLayouts) rememberExpansionLayout(draft);
        const { rootDepths } = resolveNamedView(draft, action.id);
        for (const [root, depth] of Object.entries(rootDepths)) {
          const layout = ensureDepthLayout(draft, root, depth);
          for (const [id, saved] of Object.entries(
            current.layouts?.[root] ?? {},
          )) {
            if (
              Object.hasOwn(layout, id) &&
              draft.objects[id]?.parentId === saved.parentId
            ) {
              const { x, y, width, height } = saved;
              Object.assign(layout[id], { x, y, width, height });
            }
          }
          draft.rootDepths[root] = depth;
        }
        const saved = current.metadata?.collapsedObjects;
        setCollapsedObjects(
          draft,
          new Set(
            Array.isArray(saved)
              ? saved.filter(
                  (id): id is string =>
                    typeof id === 'string' && Object.hasOwn(draft.objects, id),
                )
              : [],
          ),
        );
        resetExpansionContext(draft);
      }
    }
  };
}
