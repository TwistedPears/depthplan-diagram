import { z } from 'zod';
import type { RecursiveDocument } from './recursiveDocument';
import { indexHierarchy } from './recursiveHierarchy';
import { recursiveVisibility } from './recursiveVisibility';
import {
  API_NAME_MAX,
  API_BYTES_MAX,
  contextInput,
  hierarchyInput,
  handleSchema,
  stateSchema,
  contextDataSchema,
  hierarchyDataSchema,
  type ApiErrorCode,
  type ApiResult,
  type ApiState,
  type ContextData,
  type HierarchyData,
} from './depthApiContract';

export type QuerySnapshot = {
  appInstanceId: string | null;
  sessionId: string;
  revision: number;
  dirty: boolean;
  document: RecursiveDocument | null;
};
class QueryError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}
const cursorSchema = z.strictObject({
  ...handleSchema.shape,
  revision: z.number().int().nonnegative(),
  kind: z.enum(['roots', 'hierarchy']),
  objectId: z.string().nullable(),
  lastId: z.string().min(1),
});
function shortName(name: string) {
  return {
    name: name.slice(0, API_NAME_MAX),
    nameTruncated: name.length > API_NAME_MAX,
  };
}
export function stateOf(snapshot: QuerySnapshot): ApiState | null {
  if (!snapshot.document || !snapshot.appInstanceId) return null;
  return {
    appInstanceId: snapshot.appInstanceId,
    sessionId: snapshot.sessionId,
    documentId: snapshot.document.id ?? null,
    revision: snapshot.revision,
    dirty: snapshot.dirty,
  };
}
function query<T>(
  snapshot: QuerySnapshot,
  schema: z.ZodType<T>,
  read: () => T,
): ApiResult<T> {
  const state = stateOf(snapshot);
  try {
    if (!snapshot.appInstanceId)
      throw new QueryError(
        'APP_UNAVAILABLE',
        'Application identity is not ready',
      );
    if (state && !stateSchema.safeParse(state).success)
      throw new QueryError(
        'RESPONSE_TOO_LARGE',
        'Document identity exceeds API bounds',
      );
    const result = { ok: true as const, state, data: read() };
    if (
      !schema.safeParse(result.data).success ||
      new TextEncoder().encode(JSON.stringify(result)).byteLength >
        API_BYTES_MAX
    )
      throw new QueryError(
        'RESPONSE_TOO_LARGE',
        'Query result exceeds API bounds',
      );
    return result;
  } catch (error) {
    return {
      ok: false,
      state: stateSchema.safeParse(state).success ? state : null,
      error: {
        code: error instanceof QueryError ? error.code : 'INTERNAL_ERROR',
        message:
          error instanceof QueryError
            ? error.message
            : 'Unable to read document metadata',
        retryable:
          error instanceof QueryError && error.code === 'APP_UNAVAILABLE',
      },
    };
  }
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new QueryError('INVALID_REQUEST', 'Invalid query arguments');
  return result.data;
}
function pageIds(
  snapshot: QuerySnapshot,
  ids: Iterable<string>,
  kind: 'roots' | 'hierarchy',
  objectId: string | null,
  cursor: string | undefined,
  limit = 100,
) {
  const scope = {
    appInstanceId: snapshot.appInstanceId!,
    sessionId: snapshot.sessionId,
    revision: snapshot.revision,
    kind,
    objectId,
  };
  let lastId: string | undefined;
  if (cursor !== undefined) {
    try {
      const parsed = cursorSchema.parse(JSON.parse(cursor));
      if (
        Object.entries(scope).some(
          ([key, value]) => parsed[key as keyof typeof parsed] !== value,
        )
      )
        throw new Error('Changed scope');
      lastId = parsed.lastId;
    } catch {
      throw new QueryError(
        'STALE_CURSOR',
        'Restart this query with a fresh cursor',
      );
    }
  }
  let seen = lastId === undefined;
  const selected: string[] = [];
  for (const id of ids) {
    if (!seen) {
      if (id === lastId) seen = true;
      continue;
    }
    selected.push(id);
    if (selected.length > limit) break;
  }
  if (!seen)
    throw new QueryError('STALE_CURSOR', 'Cursor target no longer exists');
  const hasMore = selected.length > limit;
  if (hasMore) selected.pop();
  return {
    ids: selected,
    hasMore,
    nextCursor: hasMore
      ? JSON.stringify({ ...scope, lastId: selected.at(-1) })
      : null,
  };
}
export function queryDocumentContext(
  snapshot: QuerySnapshot,
  request: unknown = {},
): ApiResult<ContextData> {
  return query(snapshot, contextDataSchema, () => {
    const args = input(contextInput, request);
    const document = snapshot.document;
    const hierarchy = document ? indexHierarchy(document.objects) : null;
    const page = pageIds(
      snapshot,
      [...(hierarchy?.roots ?? [])].sort(),
      'roots',
      null,
      args.cursor,
      args.pageSize,
    );
    const title = shortName(document?.metadata.title ?? '');
    return {
      appInstanceId: snapshot.appInstanceId!,
      document: document
        ? {
            title: title.name,
            titleTruncated: title.nameTruncated,
            formatVersion: 2,
            supported: true,
          }
        : null,
      roots: document
        ? page.ids.map((id) => ({
            id,
            ...shortName(document.objects[id].name),
            selectedDepth: document.rootDepths[id],
            maximumDepth: hierarchy!.maximum.get(id)!,
          }))
        : [],
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  });
}
export function queryDocumentHierarchy(
  snapshot: QuerySnapshot,
  request: unknown,
): ApiResult<HierarchyData> {
  return query(snapshot, hierarchyDataSchema, () => {
    const args = input(hierarchyInput, request);
    if (args.handle.appInstanceId !== snapshot.appInstanceId)
      throw new QueryError(
        'STALE_APP',
        'Refresh context for the intended application',
      );
    if (args.handle.sessionId !== snapshot.sessionId)
      throw new QueryError(
        'STALE_SESSION',
        'Refresh context for the current document',
      );
    const document = snapshot.document;
    if (!document) throw new QueryError('NO_DOCUMENT', 'No document is open');
    if (!Object.hasOwn(document.objects, args.objectId))
      throw new QueryError(
        'NOT_FOUND',
        'Object does not exist in this document',
      );
    const hierarchy = indexHierarchy(document.objects);
    for (const children of hierarchy.children.values()) children.sort();
    const origin = hierarchy.entries.get(args.objectId)!;
    const { visible } = recursiveVisibility(document);
    function* preorder() {
      const pending = [args.objectId];
      while (pending.length) {
        const id = pending.pop()!;
        yield id;
        const children = hierarchy.children.get(id) ?? [];
        for (let i = children.length - 1; i >= 0; i--)
          pending.push(children[i]);
      }
    }
    const page = pageIds(
      snapshot,
      preorder(),
      'hierarchy',
      args.objectId,
      args.cursor,
      args.pageSize,
    );
    return {
      objectId: args.objectId,
      rootId: origin.root,
      items: page.ids.map((id) => {
        const object = document.objects[id],
          entry = hierarchy.entries.get(id)!;
        return {
          id,
          parentId: object.parentId,
          rootId: entry.root,
          ...shortName(object.name),
          generation: entry.generation,
          relativeGeneration: entry.generation - origin.generation,
          childCount: hierarchy.children.get(id)?.length ?? 0,
          visible: visible.has(id),
        };
      }),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  });
}
