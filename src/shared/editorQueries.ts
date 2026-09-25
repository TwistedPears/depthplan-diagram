import type { z } from 'zod';
import {
  API_BYTES_MAX,
  type ApiErrorCode,
  type ApiResult,
} from './depthApiContract';
import { stateOf, type QuerySnapshot } from './depthQueries';
import { activeWorldGeometry, indexHierarchy } from './recursiveHierarchy';
import { recursiveVisibility } from './recursiveVisibility';
import {
  queryInput,
  searchInput,
  chunkInput,
  deletionPreviewInput,
  type CanvasState,
} from './editorApiContract';
import { deletionTargets } from './recursiveDeletion';
import { mcpTools } from './mcpRegistry';
import type { Camera } from './recursiveCamera';
import type { SourceFile } from './fileContract';
import type { RecursiveDocument } from './recursiveDocument';
import { contentText, objectLabel } from './recursiveScene';
import { matchesSearch, searchTerms } from './objectSearch';

export type EditorSnapshot = QuerySnapshot & {
  camera: Camera;
  canvas: CanvasState;
  viewRevision: number;
  canUndo: boolean;
  canRedo: boolean;
  source: SourceFile | null;
};
export const editorStamp = (
  snapshot: Pick<EditorSnapshot, 'sessionId' | 'revision' | 'viewRevision'>,
) =>
  JSON.stringify([
    snapshot.sessionId,
    snapshot.revision,
    snapshot.viewRevision,
  ]);
export class EditorError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export function editorFailure(
  snapshot: QuerySnapshot,
  error: unknown,
): ApiResult<never> {
  return {
    ok: false,
    state: stateOf(snapshot),
    error: {
      code: error instanceof EditorError ? error.code : 'INVALID_REQUEST',
      message: (error instanceof Error
        ? error.message
        : 'Could not complete request'
      ).slice(0, 512),
      retryable: error instanceof EditorError && error.code === 'BUSY',
    },
  };
}
export function checkHandle(
  snapshot: QuerySnapshot,
  handle: { appInstanceId: string; sessionId: string },
) {
  if (!snapshot.appInstanceId)
    throw new EditorError(
      'APP_UNAVAILABLE',
      'Application identity is not ready',
    );
  if (handle.appInstanceId !== snapshot.appInstanceId)
    throw new EditorError(
      'STALE_APP',
      'Refresh state for the intended application',
    );
  if (handle.sessionId !== snapshot.sessionId)
    throw new EditorError(
      'STALE_SESSION',
      'Refresh state for the current document',
    );
}
export function recursiveDocument(snapshot: QuerySnapshot) {
  if (!snapshot.document)
    throw new EditorError('NO_DOCUMENT', 'No document is open');
  return snapshot.document;
}
export function boundedResult<T>(
  snapshot: QuerySnapshot,
  data: T,
): ApiResult<T> {
  const result = { ok: true as const, state: stateOf(snapshot), data };
  if (new TextEncoder().encode(JSON.stringify(result)).length > API_BYTES_MAX)
    throw new EditorError(
      'RESPONSE_TOO_LARGE',
      'Use a smaller page or depthplan_read_chunk for a large entity',
    );
  return result;
}
export function entityCollection(
  snapshot: QuerySnapshot,
  args: Pick<z.infer<typeof queryInput>, 'collection' | 'rootId' | 'depth'>,
) {
  const doc = recursiveDocument(snapshot);
  switch (args.collection) {
    case 'objects':
      return doc.objects;
    case 'connections':
      return doc.connections;
    case 'bookmarks':
      return doc.namedViews ?? {};
    case 'repairs':
      return doc.connectionRepairs ?? {};
    case 'layouts': {
      if (args.rootId === undefined || args.depth === undefined)
        throw new EditorError(
          'INVALID_REQUEST',
          'Layout queries require rootId and depth',
        );
      const layout = doc.layouts[args.rootId]?.[args.depth];
      if (!layout)
        throw new EditorError('NOT_FOUND', 'Saved depth layout does not exist');
      return layout;
    }
  }
}

/** Yield compact matches without retaining document content or a search index. */
function* searchItems(
  doc: RecursiveDocument,
  args: z.infer<typeof searchInput>,
  offset: number,
) {
  const hierarchy = indexHierarchy(doc.objects);
  const { visible, expanded } = recursiveVisibility(doc, hierarchy);
  for (const id of [args.rootId, args.subtreeId])
    if (id !== undefined && !hierarchy.entries.has(id))
      throw new EditorError('NOT_FOUND', 'Search scope does not exist');
  if (args.rootId !== undefined && doc.objects[args.rootId].parentId !== null)
    throw new EditorError('NOT_ROOT', 'rootId must identify a root');
  if (
    args.rootId !== undefined &&
    args.subtreeId !== undefined &&
    hierarchy.entries.get(args.subtreeId)!.root !== args.rootId
  )
    throw new EditorError('INVALID_REQUEST', 'subtreeId must belong to rootId');
  const scopeId = args.subtreeId ?? args.rootId;
  const scope = new Set<string>();
  if (scopeId !== undefined) {
    if (args.collection === 'bookmarks')
      throw new EditorError(
        'INVALID_REQUEST',
        'Bookmarks have no object scope',
      );
    scope.add(scopeId);
    for (const id of scope)
      for (const child of hierarchy.children.get(id) ?? []) scope.add(child);
  }
  const included = (id: string | null) =>
    id !== null && (scopeId === undefined || scope.has(id));
  const terms = searchTerms(args.query);
  if (!terms.length) return;
  const collections = args.collection
    ? [args.collection]
    : (['objects', 'connections', 'bookmarks'] as const);
  let position = 0;
  for (const collection of collections) {
    if (collection === 'bookmarks' && scopeId !== undefined) continue;
    const entities =
      collection === 'bookmarks' ? (doc.namedViews ?? {}) : doc[collection];
    for (const id of Object.keys(entities).sort()) {
      if (position++ < offset) continue;
      const object = collection === 'objects' ? doc.objects[id] : undefined;
      const connection =
        collection === 'connections' ? doc.connections[id] : undefined;
      const endpoints = connection ? [connection.start, connection.end] : [];
      if (object && !included(id)) continue;
      if (
        connection &&
        scopeId !== undefined &&
        !included(connection.ownerId) &&
        !endpoints.some((end) => end.kind !== 'free' && included(end.objectId))
      )
        continue;
      const label = object
        ? objectLabel(object)
        : connection
          ? (connection.label ?? '')
          : doc.namedViews![id].name;
      const text = object
        ? contentText(object.content).replace(/\s+/g, ' ').trim()
        : '';
      if (!matchesSearch(`${object ? object.name : label} ${text}`, terms))
        continue;
      const lowerText = text.toLowerCase();
      const snippetText =
        text && terms.some((term) => lowerText.includes(term)) ? text : label;
      const normalized = snippetText.replace(/\s+/g, ' ').trim();
      const lower = normalized.toLowerCase();
      let firstMatch = Math.min(
        ...terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0),
      );
      // Lowercasing can expand characters (for example İ); map back to source offsets.
      if (Number.isFinite(firstMatch) && lower.length !== normalized.length) {
        let folded = 0,
          source = 0;
        while (folded < firstMatch)
          folded += normalized[source++].toLowerCase().length;
        firstMatch = source;
      }
      const start = Math.max(
        0,
        (Number.isFinite(firstMatch) ? firstMatch : 0) - 60,
      );
      const snippet = normalized.slice(start, start + 240);
      const ancestorIds: string[] = [];
      if (object)
        for (
          let parent = object.parentId;
          parent !== null;
          parent = doc.objects[parent].parentId
        )
          ancestorIds.push(parent);
      yield {
        position,
        item: {
          collection,
          id,
          label: label.slice(0, 512),
          labelTruncated: label.length > 512,
          snippet,
          snippetTruncated:
            start > 0 || start + snippet.length < normalized.length,
          ...(object
            ? {
                rootId: hierarchy.entries.get(id)!.root,
                ancestorIds: ancestorIds.reverse(),
                visible: visible.has(id),
              }
            : {}),
          ...(connection
            ? {
                ownerId: connection.ownerId,
                start: connection.start,
                end: connection.end,
                visible:
                  (connection.ownerId === null ||
                    expanded.has(connection.ownerId)) &&
                  endpoints.every(
                    (end) => end.kind === 'free' || visible.has(end.objectId),
                  ),
              }
            : {}),
        },
      };
    }
  }
}
export function createEditorQueries(owner: {
  snapshot: () => EditorSnapshot;
  busyReasons: () => string[];
}) {
  const cursors = new Map<string, { scope: string; offset: number }>();
  return {
    getState: () => {
      const s = owner.snapshot();
      try {
        if (!s.appInstanceId)
          throw new EditorError(
            'APP_UNAVAILABLE',
            'Application identity is not ready',
          );
        return boundedResult(s, {
          handle: { appInstanceId: s.appInstanceId, sessionId: s.sessionId },
          revision: s.revision,
          viewRevision: s.viewRevision,
          title: s.document?.metadata.title ?? null,
          tools: Object.keys(mcpTools),
          bookmarkFields: [
            'rootDepths',
            'collapsedObjects',
            'camera',
            'cameraFocus',
            'x',
            'y',
            'width',
            'height',
          ],
          supported: !!s.document,
          camera: s.camera,
          canvas: s.canvas,
          dirty: s.dirty,
          source: s.source,
          canUndo: s.canUndo,
          canRedo: s.canRedo,
          busyReasons: owner.busyReasons(),
          limits: {
            pageSize: 200,
            requestBytes: 65536,
            responseBytes: API_BYTES_MAX,
          },
        });
      } catch (error) {
        return editorFailure(s, error);
      }
    },
    deletePreview: (input: unknown) => {
      const s = owner.snapshot();
      try {
        const args = deletionPreviewInput.parse(input);
        checkHandle(s, args.handle);
        const doc = recursiveDocument(s);
        if (
          args.objects.some((id) => !Object.hasOwn(doc.objects, id)) ||
          args.connections.some((id) => !Object.hasOwn(doc.connections, id))
        )
          throw new EditorError('NOT_FOUND', 'Delete target no longer exists');
        const target = deletionTargets(doc, args.objects);
        return boundedResult(s, {
          objects: target.objects.size,
          descendants: target.descendants,
          hidden: target.hidden,
          selectedConnections: new Set(args.connections).size,
        });
      } catch (error) {
        return editorFailure(s, error);
      }
    },
    query: (input: unknown) => {
      const s = owner.snapshot();
      try {
        const args = queryInput.parse(input);
        checkHandle(s, args.handle);
        const collection = entityCollection(s, args);
        const { cursor, ...filter } = args;
        const scope = JSON.stringify({
          ...filter,
          revision: s.revision,
          viewRevision: s.viewRevision,
        });
        const previous = cursor ? cursors.get(cursor) : undefined;
        if (cursor && previous?.scope !== scope)
          throw new EditorError(
            'STALE_CURSOR',
            'Restart this query without a cursor',
          );
        const ids = args.ids ?? Object.keys(collection).sort();
        for (const id of ids)
          if (!Object.hasOwn(collection, id))
            throw new EditorError(
              'NOT_FOUND',
              `No ${args.collection} entry ${id}`,
            );
        const offset = previous?.offset ?? 0;
        const doc = recursiveDocument(s);
        const world =
          args.collection === 'objects' ? activeWorldGeometry(doc) : null;
        const hierarchy =
          args.collection === 'objects' ? indexHierarchy(doc.objects) : null;
        const visible =
          args.collection === 'objects'
            ? recursiveVisibility(doc).visible
            : null;
        const items = ids.slice(offset, offset + args.pageSize).map((id) => {
          const entry = hierarchy?.entries.get(id);
          return {
            id,
            value: collection[id as keyof typeof collection],
            ...(entry
              ? {
                  rootId: entry.root,
                  visible: visible!.has(id),
                  activeGeometry:
                    doc.layouts[entry.root][doc.rootDepths[entry.root]][id] ??
                    null,
                  worldGeometry: world!.get(id) ?? null,
                }
              : {}),
          };
        });
        const next = offset + items.length;
        const nextCursor = next < ids.length ? crypto.randomUUID() : null;
        const result = boundedResult(s, {
          viewRevision: s.viewRevision,
          items,
          nextCursor,
          hasMore: nextCursor !== null,
        });
        if (nextCursor) {
          cursors.set(nextCursor, { scope, offset: next });
          if (cursors.size > 256) cursors.delete(cursors.keys().next().value!);
        }
        return result;
      } catch (error) {
        return editorFailure(s, error);
      }
    },
    search: (input: unknown) => {
      const s = owner.snapshot();
      try {
        const args = searchInput.parse(input);
        checkHandle(s, args.handle);
        const doc = recursiveDocument(s);
        const { cursor, ...filter } = args;
        const scope = JSON.stringify({ search: filter, stamp: editorStamp(s) });
        const previous = cursor ? cursors.get(cursor) : undefined;
        if (cursor && previous?.scope !== scope)
          throw new EditorError(
            'STALE_CURSOR',
            'Restart this search without a cursor',
          );
        const offset = previous?.offset ?? 0;
        const items = [];
        let nextOffset = offset,
          hasMore = false;
        for (const { item, position } of searchItems(doc, args, offset)) {
          if (items.length === args.pageSize) {
            nextOffset = position - 1;
            hasMore = true;
            break;
          }
          items.push(item);
        }
        const nextCursor = hasMore ? crypto.randomUUID() : null;
        const result = boundedResult(s, {
          viewRevision: s.viewRevision,
          items,
          nextCursor,
          hasMore,
        });
        if (nextCursor) {
          cursors.set(nextCursor, { scope, offset: nextOffset });
          if (cursors.size > 256) cursors.delete(cursors.keys().next().value!);
        }
        return result;
      } catch (error) {
        return editorFailure(s, error);
      }
    },
    readChunk: (input: unknown) => {
      const s = owner.snapshot();
      try {
        const args = chunkInput.parse(input);
        checkHandle(s, args.handle);
        if (args.expectedRevision !== s.revision)
          throw new EditorError(
            'STALE_REVISION',
            'Restart the read at the current revision',
          );
        const collection = entityCollection(s, args);
        if (!Object.hasOwn(collection, args.id))
          throw new EditorError('NOT_FOUND', 'Entity does not exist');
        const text = JSON.stringify(
          collection[args.id as keyof typeof collection],
        );
        if (args.offset > text.length)
          throw new EditorError(
            'INVALID_REQUEST',
            'Offset exceeds entity length',
          );
        const chunk = text.slice(args.offset, args.offset + args.length);
        const next = args.offset + chunk.length;
        return boundedResult(s, {
          text: chunk,
          totalLength: text.length,
          nextOffset: next < text.length ? next : null,
        });
      } catch (error) {
        return editorFailure(s, error);
      }
    },
  };
}
