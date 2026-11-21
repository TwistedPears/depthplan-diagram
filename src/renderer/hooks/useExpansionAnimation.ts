import { useLayoutEffect, useRef, useState } from 'react';
import Konva from 'konva';
import type { RecursiveDocument } from '../../shared/recursiveDocument';
import { recursiveScene } from '../../shared/recursiveScene';
import { recursiveVisibility } from '../../shared/recursiveVisibility';
import { avoidsShapes } from '../../shared/connectionAvoidance';
import type { ConnectionRoute } from '../../shared/connectionGeometry';
import { boundsRemap, transitionRoute } from '../../shared/routeTransition';

const geometryFields = ['x', 'y', 'width', 'height'] as const;

/** Transient geometry only: history, saving and export keep the committed layout. */
export default function useExpansionAnimation(
  document: RecursiveDocument,
  previewing: boolean,
) {
  const previous = useRef(document);
  const painted = useRef(document);
  // Shape-avoiding routes shown for the painted frame, when one is animating.
  const paintedRoutes = useRef<Map<string, ConnectionRoute> | undefined>(
    undefined,
  );
  const finishAnimation = useRef(() => {});
  const [frame, setFrame] = useState<{
    target: RecursiveDocument;
    value: RecursiveDocument;
    routes?: Map<string, ConnectionRoute>;
  } | null>(null);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = document;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let request = 0;
    const finish = () => {
      cancelAnimationFrame(request);
      painted.current = document;
      paintedRoutes.current = undefined;
      setFrame(null);
    };
    finishAnimation.current = finish;
    if (
      before === document ||
      before.id !== document.id ||
      previewing ||
      motion.matches
    ) {
      finish();
      return;
    }
    const expanded = recursiveVisibility(document).expanded;
    const wasExpanded = recursiveVisibility(before).expanded;
    const sameObjects =
      before.objects === document.objects ||
      (Object.keys(before.objects).length ===
        Object.keys(document.objects).length &&
        Object.values(document.objects).every(
          (object) => before.objects[object.id]?.parentId === object.parentId,
        ));
    if (
      !sameObjects ||
      (expanded.size === wasExpanded.size &&
        [...expanded].every((id) => wasExpanded.has(id)))
    ) {
      finish();
      return;
    }

    const fromScene = recursiveScene(painted.current, paintedRoutes.current);
    const from = fromScene.local;
    const to = recursiveScene(document);
    // Route once for the final layout; frames glide there from what is painted.
    const startRoutes = new Map(
      [...fromScene.connections.values()].flat().map((r) => [r.id, r]),
    );
    const targetRoutes = [...to.connections].flatMap(([ownerId, list]) =>
      list
        .filter((route) => avoidsShapes(document.connections[route.id]))
        .map((route) => ({ ownerId, route })),
    );
    const moving = [...to.local].flatMap(([id, end]) => {
      const start = from.get(id) ?? {
        ...end,
        x: end.x * 0.8,
        y: end.y * 0.8,
        width: end.width * 0.8,
        height: end.height * 0.8,
      };
      if (
        geometryFields.every((field) => start[field] === end[field]) &&
        end.width >= 1 &&
        end.height >= 1
      )
        return [];
      return [{ id, start, end, root: to.hierarchy.entries.get(id)!.root }];
    });
    const opening = [...expanded].some((id) => !wasExpanded.has(id));
    const started = performance.now();
    const paint = (time: number) => {
      const progress = Math.min(1, (time - started) / 340);
      if (progress === 1) {
        finish();
        return;
      }
      const easing = opening
        ? Konva.Easings.BackEaseOut
        : Konva.Easings.EaseOut;
      const amount = easing(progress, 0, 1, 1);
      const layouts = { ...document.layouts };
      for (const { id, start, end, root } of moving) {
        const geometry = { ...end };
        for (const field of geometryFields)
          geometry[field] = start[field] + (end[field] - start[field]) * amount;
        // A restored layout may shrink sharply even while another branch opens.
        geometry.width = Math.max(1, geometry.width);
        geometry.height = Math.max(1, geometry.height);
        const depth = document.rootDepths[root];
        if (layouts[root] === document.layouts[root])
          layouts[root] = {
            ...layouts[root],
            [depth]: { ...layouts[root][depth] },
          };
        layouts[root][depth][id] = geometry;
      }
      painted.current = { ...document, layouts };
      let routes: Map<string, ConnectionRoute> | undefined;
      if (targetRoutes.length) {
        routes = new Map();
        const remaps = new Map<string | null, ReturnType<typeof boundsRemap>>();
        for (const { ownerId, route } of targetRoutes) {
          let remap = remaps.get(ownerId);
          if (!remap) {
            const ids = to.children.get(ownerId) ?? [];
            remap = boundsRemap(
              ids.map((id) => to.local.get(id)!),
              ids.map((id) => {
                const root = to.hierarchy.entries.get(id)!.root;
                return layouts[root][document.rootDepths[root]][id];
              }),
            );
            remaps.set(ownerId, remap);
          }
          routes.set(
            route.id,
            transitionRoute(startRoutes.get(route.id), route, amount, remap),
          );
        }
      }
      paintedRoutes.current = routes;
      setFrame({ target: document, value: painted.current, routes });
      request = requestAnimationFrame(paint);
    };
    const reduceMotion = () => {
      if (motion.matches) finish();
    };
    motion.addEventListener('change', reduceMotion);
    paint(started);
    return () => {
      cancelAnimationFrame(request);
      motion.removeEventListener('change', reduceMotion);
    };
  }, [document, previewing]);

  return {
    document:
      !previewing && frame?.target === document ? frame.value : document,
    routes:
      !previewing && frame?.target === document ? frame.routes : undefined,
    finish: () => finishAnimation.current(),
  };
}
