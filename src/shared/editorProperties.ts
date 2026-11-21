import type { DocumentEdit } from './documentTransactions';
import { editObject } from './documentTransactions';
import type { DiagramConnection, DiagramObject } from './recursiveDocument';
import { connectionOwners } from './recursiveOwnership';
import { clearRoute, routeKey, withRoute } from './connectionRoutes';

/** Partial styles retain file extensions and untouched fields, for UI and MCP alike. */
export function patchObject(
  id: string,
  patch: Partial<Pick<DiagramObject, 'name' | 'content' | 'style'>>,
): DocumentEdit {
  return (draft) =>
    editObject(id, {
      ...patch,
      ...(patch.style
        ? { style: { ...draft.objects[id]?.style, ...patch.style } }
        : {}),
    })(draft);
}
/** `depthRoute: 'set'` writes points/start/end to the route root's active depth
 * override instead of the shared route; `'clear'` removes that override. */
export function patchConnection(
  id: string,
  {
    depthRoute,
    ...patch
  }: Partial<
    Pick<
      DiagramConnection,
      'label' | 'style' | 'points' | 'start' | 'end' | 'z'
    >
  > & { depthRoute?: 'set' | 'clear' },
): DocumentEdit {
  return (draft) => {
    const item = draft.connections[id];
    if (!item) throw new Error('Connection does not exist');
    const key = depthRoute ? routeKey(draft, item) : null;
    if (depthRoute && key === null)
      throw new Error(
        'Depth routes need an owner or endpoints in one root; free and cross-root canvas paths use the shared route.',
      );
    if (depthRoute === 'clear' && (patch.points || patch.start || patch.end))
      throw new Error('Clear a depth route without route fields.');
    for (const key of ['start', 'end'] as const) {
      const endpoint = patch[key];
      if (
        !endpoint ||
        endpoint.kind === 'free' ||
        JSON.stringify(endpoint) === JSON.stringify(item[key])
      )
        continue;
      if (item.kind === 'line')
        throw new Error('Only arrows can bind to shapes.');
      const target = draft.objects[endpoint.objectId];
      if (
        !target ||
        !connectionOwners(draft, endpoint.objectId).includes(item.ownerId)
      )
        throw new Error('Endpoint is outside the connection owner.');
    }
    const { points, start, end, ...rest } = patch;
    let next = { ...item, ...rest };
    // A bare 'set' forks the shared route for this depth.
    const route =
      depthRoute === 'set' &&
      !points &&
      !start &&
      !end &&
      !item.depthRoutes?.[key!]
        ? { start: item.start, end: item.end, points: item.points }
        : { points, start, end };
    if (patch.style) next.style = { ...item.style, ...patch.style };
    next =
      depthRoute === 'clear'
        ? clearRoute(next, key!)
        : withRoute(next, key, route);
    if (
      patch.style?.lineType === 'sharp' &&
      (item.style?.lineType ?? 'sharp') !== 'sharp'
    )
      next = {
        ...next,
        points: [],
        ...(next.depthRoutes && {
          depthRoutes: Object.fromEntries(
            Object.entries(next.depthRoutes).map(([depth, route]) => [
              depth,
              { ...route, ...(route.points && { points: [] }) },
            ]),
          ),
        }),
      };
    draft.connections[id] = next;
  };
}
export function patchSelectionStyle(
  selection: string[],
  style: NonNullable<DiagramObject['style']>,
): DocumentEdit {
  return (draft) => {
    for (const key of selection) {
      const edit = key.startsWith('object-')
        ? patchObject(key.slice(7), { style })
        : patchConnection(key.slice(11), { style });
      edit(draft);
    }
  };
}

/** Copy appearance only: links and containment behavior belong to the destination. */
export function copyStyle(item: DiagramObject | DiagramConnection) {
  const shape = 'type' in item;
  const defaults = {
    fill: '#ffffff',
    fillType: 'solid',
    stroke: shape ? '#64748b' : '#475569',
    strokeWidth: shape ? 1.5 : 2,
    opacity: 1,
    cornerRadius: 0,
    strokeStyle: 'solid',
    lineType: 'sharp',
    arrowheadStart: 'none',
    arrowheadEnd: !shape && item.kind === 'arrow' ? 'arrow' : 'none',
  };
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      item.style?.[key] ?? value,
    ]),
  );
}
