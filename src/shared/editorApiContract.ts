import { arrowheads, lineTypes } from './connectionGeometry';
import { z } from 'zod';
import { handleSchema, resultSchema } from './depthApiContract';
import { codeLanguages, validLink, type RichBlock } from './recursiveDocument';

export const editorId = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) => !['__proto__', 'constructor', 'prototype'].includes(value),
    'Reserved identifier',
  );
export const version = z.number().int().nonnegative().safe();
export const pointSchema = z.strictObject({ x: z.number(), y: z.number() });
export const cameraSchema = pointSchema.extend({
  scale: z.number().positive(),
});
export const canvasStateSchema = z.strictObject({
  selected: z.array(z.string()).max(10000),
  selectedPoint: z
    .strictObject({ objectId: editorId, pointId: editorId })
    .nullable(),
  tool: z.enum([
    'pointer',
    'hand',
    'square',
    'circle',
    'diamond',
    'frame',
    'line',
    'arrow',
  ]),
  minimap: z.boolean(),
  selectionCollapsed: z.boolean(),
  viewport: z.strictObject({
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  }),
});
export type CanvasState = z.infer<typeof canvasStateSchema>;
export const initialCanvasState = (): CanvasState => ({
  selected: [],
  selectedPoint: null,
  tool: 'pointer',
  minimap: false,
  selectionCollapsed: false,
  viewport: { width: 0, height: 0 },
});
export const collectionSchema = z.enum([
  'objects',
  'connections',
  'bookmarks',
  'layouts',
  'repairs',
]);
export const queryInput = z.strictObject({
  handle: handleSchema,
  collection: collectionSchema,
  ids: z.array(editorId).max(200).optional(),
  rootId: editorId.optional(),
  depth: version.optional(),
  pageSize: z.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});
export const searchInput = z.strictObject({
  handle: handleSchema,
  query: z.string().max(1024),
  collection: z.enum(['objects', 'connections', 'bookmarks']).optional(),
  rootId: editorId.optional(),
  subtreeId: editorId.optional(),
  pageSize: z.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});
export const chunkInput = z.strictObject({
  handle: handleSchema,
  collection: collectionSchema,
  id: editorId,
  rootId: editorId.optional(),
  depth: version.optional(),
  expectedRevision: version,
  offset: version.default(0),
  length: z.number().int().positive().max(16384).default(16384),
});
// Collection values contain the native JSON document structures, including retained extensions.
export const editorResult = resultSchema(z.record(z.string(), z.json()));
export const geometrySchema = pointSchema.extend({
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number(),
  z: z.number().int(),
});
export const targetSchema = z.union([
  editorId,
  z.strictObject({ objectId: editorId, pointId: editorId }),
  z.null(),
]);
export const endpointSchema = z.discriminatedUnion('kind', [
  pointSchema.extend({ kind: z.literal('free') }),
  z.strictObject({
    kind: z.literal('object'),
    objectId: editorId,
    side: z.enum(['top', 'right', 'bottom', 'left']),
    offset: z.number().min(0).max(1),
    binding: z.enum(['auto', 'fixed']).optional(),
  }),
  z.strictObject({
    kind: z.literal('boundary'),
    objectId: editorId,
    pointId: editorId,
  }),
]);
export const bookmarkAction = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('create'),
    id: editorId,
    name: z.string().trim().min(1).max(4096),
  }),
  z.strictObject({
    type: z.literal('rename'),
    id: editorId,
    name: z.string().trim().min(1).max(4096),
  }),
  z.strictObject({
    type: z.literal('duplicate'),
    id: editorId,
    newId: editorId,
  }),
  z.strictObject({ type: z.literal('apply'), id: editorId }),
  z.strictObject({ type: z.literal('reset'), id: editorId }),
  z.strictObject({ type: z.literal('delete'), id: editorId }),
]);
const color = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !globalThis.CSS?.supports || globalThis.CSS.supports('color', value),
    'Invalid CSS color',
  );
export const stylePatchSchema = z.strictObject({
  fill: color.optional(),
  fillType: z.enum(['none', 'solid', 'hachure', 'cross-hatch']).optional(),
  link: z.string().refine(validLink, 'Invalid link URL').nullable().optional(),
  stroke: color.optional(),
  strokeWidth: z.number().nonnegative().optional(),
  opacity: z.number().min(0).max(1).optional(),
  cornerRadius: z.number().nonnegative().optional(),
  clipToFrame: z.boolean().optional(),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  lineType: z.enum(lineTypes).optional(),
  arrowheadStart: z.enum(arrowheads).optional(),
  arrowheadEnd: z.enum(arrowheads).optional(),
});
export const richBlockSchema: z.ZodType<RichBlock> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('paragraph'),
      runs: z.array(textRunSchema),
      align: z.enum(['left', 'center', 'right', 'justify']).optional(),
    }),
    z.strictObject({
      type: z.literal('heading'),
      level: z.number().int().min(1).max(6),
      runs: z.array(textRunSchema),
      align: z.enum(['left', 'center', 'right', 'justify']).optional(),
    }),
    z.strictObject({
      type: z.literal('list'),
      ordered: z.boolean(),
      start: z.number().int().positive().optional(),
      items: z.array(z.array(richBlockSchema).min(1)),
    }),
    z.strictObject({
      type: z.literal('quote'),
      blocks: z.array(richBlockSchema).min(1),
    }),
    z.strictObject({
      type: z.literal('code'),
      text: z.string(),
      language: z.enum(codeLanguages),
      wrap: z.boolean().optional(),
    }),
  ]),
);
const textRunSchema = z.strictObject({
  text: z.string(),
  marks: z
    .strictObject({
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      underline: z.boolean().optional(),
      strike: z.boolean().optional(),
      font: z.string().optional(),
      size: z.number().positive().optional(),
      color: color.optional(),
      link: z.string().refine(validLink).optional(),
    })
    .optional(),
});
export const editAction = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('edit_object'),
    id: editorId,
    name: z.string().optional(),
    content: z.array(richBlockSchema).optional(),
    contentTransfer: editorId.optional(),
    style: stylePatchSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('edit_connection'),
    id: editorId,
    start: endpointSchema.optional(),
    end: endpointSchema.optional(),
    points: z.array(pointSchema).max(1000).optional(),
    label: z.string().optional(),
    style: stylePatchSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('move'),
    ids: z.array(editorId).min(1).max(1000),
    delta: pointSchema,
  }),
  z.strictObject({
    type: z.literal('reparent'),
    id: editorId,
    parentId: editorId.nullable(),
    position: pointSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('delete'),
    objects: z.array(editorId).max(1000).default([]),
    connections: z.array(editorId).max(1000).default([]),
  }),
  z.strictObject({
    type: z.literal('arrange'),
    ids: z.array(editorId).min(1).max(1000),
    action: z.enum([
      'align-left',
      'align-center',
      'align-right',
      'align-top',
      'align-middle',
      'align-bottom',
      'distribute-horizontal',
      'distribute-vertical',
      'make-same-width',
      'make-same-height',
      'bring-to-front',
      'bring-forward',
      'send-backward',
      'send-to-back',
    ]),
  }),
  z.strictObject({
    type: z.literal('boundary'),
    objectId: editorId,
    pointId: editorId,
    action: z.enum(['create', 'update', 'delete']),
    point: z
      .strictObject({
        side: z.enum(['top', 'right', 'bottom', 'left']),
        offset: z.number().min(0).max(1),
      })
      .optional(),
  }),
  z.strictObject({
    type: z.literal('bridge'),
    id: editorId,
    source: z.strictObject({ objectId: editorId, pointId: editorId }),
    target: targetSchema,
    point: pointSchema,
    kind: z.enum(['line', 'arrow']),
  }),
  z.strictObject({
    type: z.literal('reattach_bridge'),
    id: editorId,
    target: targetSchema,
    point: pointSchema,
  }),
  z.strictObject({
    type: z.literal('repair'),
    id: editorId,
    replacementId: editorId,
  }),
  z.strictObject({
    type: z.literal('create_object'),
    id: editorId,
    shape: z.enum(['rectangle', 'ellipse', 'diamond', 'frame']),
    parentId: editorId.nullable().default(null),
    geometry: geometrySchema.extend({
      rotation: z.number().default(0),
      z: z.number().int().default(0),
    }),
    name: z.string().max(32768).default(''),
  }),
  z.strictObject({
    type: z.literal('geometry'),
    id: editorId,
    space: z.enum(['local', 'world']).default('local'),
    patch: geometrySchema.partial(),
  }),
  z.strictObject({
    type: z.literal('create_connection'),
    id: editorId,
    kind: z.enum(['line', 'arrow']),
    start: pointSchema,
    end: pointSchema,
    startTarget: targetSchema.default(null),
    endTarget: targetSchema.default(null),
    points: z.array(pointSchema).max(1000).optional(),
  }),
  z.strictObject({
    type: z.literal('depth'),
    rootId: editorId,
    depth: z.union([version, z.literal('all')]),
  }),
  z.strictObject({
    type: z.literal('children'),
    id: editorId,
    expanded: z.boolean(),
  }),
  z.strictObject({ type: z.literal('bookmark'), action: bookmarkAction }),
]);
export const commandFields = {
  handle: handleSchema,
  expectedRevision: version,
  expectedViewRevision: version,
  requestId: editorId,
};
export const editInput = z.strictObject({
  ...commandFields,
  actions: z.array(editAction).min(1).max(100),
  camera: cameraSchema.optional(),
});
export const bookmarkInput = z.strictObject({
  ...commandFields,
  action: bookmarkAction,
});
export const cameraInput = z.strictObject({
  ...commandFields,
  action: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('set'), camera: cameraSchema }),
    z.strictObject({ type: z.literal('pan'), delta: pointSchema }),
    z.strictObject({
      type: z.literal('zoom'),
      scale: z.number().positive(),
      anchor: pointSchema.optional(),
    }),
    z.strictObject({ type: z.enum(['fit', 'reset']) }),
  ]),
});
export const selectionInput = z.strictObject({
  ...commandFields,
  action: z.enum(['set', 'add', 'remove', 'clear', 'all', 'parent']),
  objects: z.array(editorId).max(1000).default([]),
  connections: z.array(editorId).max(1000).default([]),
  point: z
    .strictObject({ objectId: editorId, pointId: editorId })
    .nullable()
    .optional(),
});
export const historyInput = z.strictObject({
  ...commandFields,
  direction: z.enum(['undo', 'redo']),
});
export const controlsInput = z.strictObject({
  ...commandFields,
  patch: canvasStateSchema
    .pick({ tool: true, minimap: true, selectionCollapsed: true })
    .partial(),
});
export const deletionPreviewInput = z.strictObject({
  handle: handleSchema,
  objects: z.array(editorId).max(1000),
  connections: z.array(editorId).max(1000).default([]),
});
export const contentTransferInput = z.strictObject({
  ...commandFields,
  action: z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('begin'),
      id: editorId,
      totalLength: version.max(8 * 1024 * 1024),
    }),
    z.strictObject({
      type: z.literal('append'),
      id: editorId,
      offset: version,
      text: z.string().max(8192),
    }),
    z.strictObject({ type: z.literal('discard'), id: editorId }),
  ]),
});
export const draftInput = z.strictObject({
  ...commandFields,
  id: editorId,
  draftVersion: version,
  action: z.enum(['apply', 'discard', 'cancel']),
});

export const editorTools = {
  depthplan_controls: {
    input: controlsInput,
    output: editorResult,
    readOnly: false,
    description:
      'Set the shared drawing tool, minimap visibility or selection controls. Does not edit the document.',
  },
  depthplan_delete_preview: {
    input: deletionPreviewInput,
    output: editorResult,
    readOnly: true,
    description:
      'Inspect how many objects, descendants, hidden objects and selected connections a delete action affects before issuing it.',
  },
  depthplan_content_transfer: {
    input: contentTransferInput,
    output: editorResult,
    readOnly: false,
    description:
      'Assemble a rich-content JSON array larger than one request: begin with totalLength, append at UTF-16 offsets in chunks of at most 8192 characters, then reference contentTransfer in an edit_object action. Maximum 8 Mi characters, four transfers, five-minute expiry. Nothing changes until the atomic edit commits.',
  },
  depthplan_get_drafts: {
    input: z.strictObject({}),
    output: editorResult,
    readOnly: true,
    description:
      'List active unfinished UI edits and their identity/version. Ordinary MCP edits are blocked until the user finishes them or you explicitly resolve one.',
  },
  depthplan_resolve_draft: {
    input: draftInput,
    output: editorResult,
    readOnly: false,
    destructive: true,
    description:
      'Explicitly apply, discard or cancel resolution of an observed UI draft. Requires its current identity, draft version and document/view versions; never silently discards another edit.',
  },
  depthplan_edit: {
    input: editInput,
    output: editorResult,
    readOnly: false,
    destructive: true,
    description:
      'Apply up to 100 typed diagram actions atomically as one Undo entry. IDs are client-chosen stable identifiers. Creation coordinates are world-space centers; geometry patches specify local/world. Optional camera is captured by bookmark actions in the same batch. Reuse requestId only for an identical retry.',
  },
  depthplan_bookmarks: {
    input: bookmarkInput,
    output: editorResult,
    readOnly: false,
    destructive: true,
    description:
      'Create/apply/rename/reset/duplicate/delete a bookmark. Reset replaces its snapshot with the current depths, layout sizes/positions, collapsed branches and camera focus/zoom. Apply preserves world focus across viewport sizes and is one Undo step. Older bookmarks without cameraFocus restore raw camera offsets until reset. Query collection bookmarks to read saved views.',
  },
  depthplan_camera: {
    input: cameraInput,
    output: editorResult,
    readOnly: false,
    description:
      'Set, pan, zoom, fit or reset the shared canvas camera. x/y are pixel offsets and scale is zoom. Ordinary navigation changes viewRevision without dirtying the document or entering Undo history.',
  },
  depthplan_selection: {
    input: selectionInput,
    output: editorResult,
    readOnly: false,
    description:
      'Select visible objects, connections or a boundary point; add/remove/clear/select all visible, or select the parent of one object. Changes the shared UI selection without editing the document.',
  },
  depthplan_history: {
    input: historyInput,
    output: editorResult,
    readOnly: false,
    destructive: true,
    description:
      'Undo or Redo one document history entry. Refresh document/view revisions first. Identical request retries do not repeat the history action.',
  },
  depthplan_get_state: {
    input: z.strictObject({}),
    output: editorResult,
    readOnly: true,
    description:
      'Inspect current document/session, view revision, camera, selection, busy reasons and Undo/Redo availability. Refresh before editing.',
  },
  depthplan_query: {
    input: queryInput,
    output: editorResult,
    readOnly: true,
    description:
      'Read paged objects (including hidden children), connections, bookmarks, layouts or pending repairs. Layout queries require rootId and depth. Cursors expire when document or view changes.',
  },
  depthplan_search: {
    input: searchInput,
    output: editorResult,
    readOnly: true,
    description:
      'Find objects by name/content, connections by label, or bookmarks by name. Literal case-insensitive all-term matching; whitespace-only queries return no results. Optional collection, rootId (a root) and subtreeId (inclusive descendants) filters include hidden objects. Scoped connections touch an included owner or endpoint; bookmarks are document-wide and excluded from scoped searches. Results sort by objects/connections/bookmarks then ID, with bounded labels/snippets and object ancestor/visibility context. Repeat identical filters and pageSize with nextCursor; document/view/session changes invalidate cursors. Read full entities with query/read_chunk; search never navigates or edits.',
  },
  depthplan_read_chunk: {
    input: chunkInput,
    output: editorResult,
    readOnly: true,
    description:
      'Read a large entity as JSON string chunks at UTF-16 offsets, bound to expectedRevision. Concatenate chunks before parsing; nothing is silently truncated.',
  },
};
