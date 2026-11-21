import type {
  DepthRoute,
  DiagramConnection,
  Endpoint,
  RecursiveDocument,
} from './recursiveDocument';

type RouteFields = Pick<DepthRoute, 'points' | 'start' | 'end'>;
const fields = ['points', 'start', 'end'] as const;

function rootOf(document: RecursiveDocument, id: string) {
  let cursor = id;
  while (document.objects[cursor].parentId !== null)
    cursor = document.objects[cursor].parentId!;
  return cursor;
}
function generation(document: RecursiveDocument, id: string) {
  let count = 0;
  for (let p = document.objects[id].parentId; p !== null; count++)
    p = document.objects[p].parentId;
  return count;
}
/** Overrides belong to the owner's root, else to the single root of the bound
 * endpoints. Free-free and cross-root canvas paths have no depth route. */
export function routeRoot(
  document: RecursiveDocument,
  connection: DiagramConnection,
): string | null {
  if (connection.ownerId !== null) return rootOf(document, connection.ownerId);
  const roots = new Set(
    [connection.start, connection.end].flatMap((end) =>
      end.kind === 'free' ? [] : [rootOf(document, end.objectId)],
    ),
  );
  return roots.size === 1 ? [...roots][0] : null;
}
/** The override key: the route root's active depth. */
export function routeKey(
  document: RecursiveDocument,
  connection: DiagramConnection,
): string | null {
  const root = routeRoot(document, connection);
  return root === null ? null : String(document.rootDepths[root]);
}
export function activeDepthRoute(
  document: RecursiveDocument,
  connection: DiagramConnection,
): DepthRoute | undefined {
  if (!connection.depthRoutes) return undefined;
  const key = routeKey(document, connection);
  return key !== null && Object.hasOwn(connection.depthRoutes, key)
    ? connection.depthRoutes[key]
    : undefined;
}
/** The route painted and edited at the current depth, without override data. */
export function displayedConnection(
  document: RecursiveDocument,
  connection: DiagramConnection,
): DiagramConnection {
  if (!connection.depthRoutes) return connection;
  const { depthRoutes: _routes, ...shared } = connection;
  return { ...shared, ...activeDepthRoute(document, connection) };
}
export const sameTarget = (a: Endpoint, b: Endpoint) =>
  a.kind === 'free'
    ? b.kind === 'free'
    : b.kind !== 'free' && a.objectId === b.objectId;
/** Drop override endpoints that no longer match the shared target or a stored
 * boundary point, and empty entries. */
function tidy(
  connection: DiagramConnection,
  document?: RecursiveDocument,
): DiagramConnection {
  if (!connection.depthRoutes) return connection;
  const routes: Record<string, DepthRoute> = {};
  for (const [key, route] of Object.entries(connection.depthRoutes)) {
    const next = { ...route };
    for (const end of ['start', 'end'] as const) {
      const value = next[end];
      if (
        value &&
        (!sameTarget(value, connection[end]) ||
          (document &&
            value.kind === 'boundary' &&
            !document.objects[value.objectId]?.boundaryPoints?.[value.pointId]))
      )
        delete next[end];
    }
    if (fields.some((field) => next[field] !== undefined)) routes[key] = next;
  }
  // Keep key order so unchanged connections serialize identically.
  const result: DiagramConnection = { ...connection, depthRoutes: routes };
  if (!Object.keys(routes).length) delete result.depthRoutes;
  return result;
}
/** Write route fields to the override at `key`, or to the shared route when
 * `key` is null. Retargeting an endpoint always changes the shared endpoint. */
export function withRoute(
  connection: DiagramConnection,
  key: string | null,
  patch: RouteFields,
): DiagramConnection {
  const next = { ...connection };
  const route: DepthRoute = {
    ...(key === null ? undefined : connection.depthRoutes?.[key]),
  };
  for (const field of fields) {
    const value = patch[field];
    if (value === undefined) continue;
    if (
      key === null ||
      (field !== 'points' && !sameTarget(connection[field], value as Endpoint))
    )
      Object.assign(next, { [field]: value });
    else Object.assign(route, { [field]: value });
  }
  if (key !== null)
    next.depthRoutes = { ...connection.depthRoutes, [key]: route };
  return tidy(next);
}
export function clearRoute(
  connection: DiagramConnection,
  key: string,
): DiagramConnection {
  const routes = { ...connection.depthRoutes };
  delete routes[key];
  return tidy({ ...connection, depthRoutes: routes });
}
/** Store an edited displayed route where it came from: the active override if
 * one exists, else the shared route. Overrides stay in their owner's space. */
export function storeDisplayed(
  document: RecursiveDocument,
  stored: DiagramConnection,
  displayed: DiagramConnection,
): DiagramConnection {
  const { depthRoutes: _routes, ...value } = displayed;
  const key = activeDepthRoute(document, stored)
    ? routeKey(document, stored)
    : null;
  const shown = displayedConnection(document, stored);
  if (key === null)
    return tidy({
      ...value,
      ...(stored.depthRoutes ? { depthRoutes: stored.depthRoutes } : {}),
    });
  if (value.ownerId !== stored.ownerId)
    throw new Error(
      'This arrow has its own route at this depth. Use the shared route to move it into another container.',
    );
  return withRoute(
    {
      ...value,
      points: stored.points,
      start: stored.start,
      end: stored.end,
      depthRoutes: stored.depthRoutes,
    },
    key,
    Object.fromEntries(
      fields
        .filter(
          (field) =>
            JSON.stringify(value[field]) !== JSON.stringify(shown[field]),
        )
        .map((field) => [field, value[field]]),
    ),
  );
}
/** Run after edits. Removes overrides whose endpoint targets, boundary points or
 * route root disappeared. With `shift`, owned overrides follow an owner's
 * generation change like its layouts (depth d becomes d - g + h); an owner or
 * unowned route-root change discards them, since their coordinates no longer apply. */
export function reconcileConnectionRoutes(
  before: RecursiveDocument,
  draft: RecursiveDocument,
  shift = false,
) {
  for (const [id, connection] of Object.entries(draft.connections)) {
    if (!connection.depthRoutes) continue;
    let next: DiagramConnection = connection;
    const old = before.connections[id];
    const root = routeRoot(draft, connection);
    if (
      root === null ||
      (old &&
        (old.ownerId !== connection.ownerId ||
          (connection.ownerId === null && routeRoot(before, old) !== root)))
    ) {
      const { depthRoutes: _routes, ...rest } = connection;
      next = rest;
    } else if (shift && old && connection.ownerId !== null) {
      const delta =
        generation(draft, connection.ownerId) -
        generation(before, connection.ownerId);
      if (delta)
        next = {
          ...connection,
          depthRoutes: Object.fromEntries(
            Object.entries(connection.depthRoutes).flatMap(([key, route]) =>
              Number(key) + delta < 0
                ? []
                : [[String(Number(key) + delta), route]],
            ),
          ),
        };
    }
    next = tidy(next, draft);
    if (JSON.stringify(next) !== JSON.stringify(connection))
      draft.connections[id] = next;
  }
}
