import { z } from 'zod';

// API limits bound responses, not document capacity. Never shorten stable IDs.
export const API_PAGE_MAX = 200;
export const API_NAME_MAX = 512;
export const API_BYTES_MAX = 1024 * 1024;
const id = z.string().min(1).max(256);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const handleSchema = z.strictObject({
  appInstanceId: id,
  sessionId: id,
});
export const stateSchema = z.strictObject({
  ...handleSchema.shape,
  documentId: id.nullable(),
  revision: integer,
  dirty: z.boolean(),
});
const page = {
  pageSize: z.number().int().min(1).max(API_PAGE_MAX).optional(),
  cursor: z.string().max(4096).optional(),
};
export const contextInput = z.strictObject(page);
export const hierarchyInput = z.strictObject({
  handle: handleSchema,
  objectId: id,
  ...page,
});
const command = {
  handle: handleSchema,
  rootId: id,
  expectedRevision: integer,
  requestId: id,
};
export const setDepthInput = z.strictObject({ ...command, depth: integer });
export const revealAllInput = z.strictObject(command);
export const errorSchema = z.strictObject({
  code: z.enum([
    'INVALID_REQUEST',
    'NO_DOCUMENT',
    'STALE_APP',
    'STALE_SESSION',
    'STALE_REVISION',
    'STALE_VIEW',
    'STALE_CURSOR',
    'NOT_FOUND',
    'NOT_ROOT',
    'INVALID_DEPTH',
    'BUSY',
    'REQUEST_ID_REUSED',
    'RESPONSE_TOO_LARGE',
    'DISABLED',
    'APP_UNAVAILABLE',
    'INTERNAL_ERROR',
  ]),
  message: z.string().max(512),
  retryable: z.boolean(),
});
const name = { name: z.string().max(API_NAME_MAX), nameTruncated: z.boolean() };
export const rootSummarySchema = z.strictObject({
  id,
  ...name,
  selectedDepth: integer,
  maximumDepth: integer,
});
export const hierarchySummarySchema = z.strictObject({
  id,
  parentId: id.nullable(),
  rootId: id,
  ...name,
  generation: integer,
  relativeGeneration: integer,
  childCount: integer,
  visible: z.boolean(),
});
const pagination = {
  nextCursor: z.string().max(4096).nullable(),
  hasMore: z.boolean(),
};
export const contextDataSchema = z.strictObject({
  appInstanceId: id,
  document: z
    .strictObject({
      title: z.string().max(API_NAME_MAX),
      titleTruncated: z.boolean(),
      formatVersion: z.number().int(),
      supported: z.boolean(),
    })
    .nullable(),
  roots: z.array(rootSummarySchema).max(API_PAGE_MAX),
  ...pagination,
});
export const hierarchyDataSchema = z.strictObject({
  objectId: id,
  rootId: id,
  items: z.array(hierarchySummarySchema).max(API_PAGE_MAX),
  ...pagination,
});
export const commandDataSchema = z.strictObject({
  rootId: id,
  selectedDepth: integer,
  maximumDepth: integer,
  changed: z.boolean(),
  replayed: z.boolean(),
  appliedRevision: integer,
});
export const resultSchema = <T extends z.ZodType>(data: T) =>
  z.union([
    z.strictObject({
      ok: z.literal(true),
      state: stateSchema.nullable(),
      data,
    }),
    z.strictObject({
      ok: z.literal(false),
      state: stateSchema.nullable(),
      error: errorSchema,
    }),
  ]);
export const depthTools = {
  depthplan_get_context: {
    input: contextInput,
    output: resultSchema(contextDataSchema),
    readOnly: true,
  },
  depthplan_get_hierarchy: {
    input: hierarchyInput,
    output: resultSchema(hierarchyDataSchema),
    readOnly: true,
  },
  depthplan_set_depth: {
    input: setDepthInput,
    output: resultSchema(commandDataSchema),
    readOnly: false,
  },
  depthplan_reveal_all: {
    input: revealAllInput,
    output: resultSchema(commandDataSchema),
    readOnly: false,
  },
};
export type ApiState = z.infer<typeof stateSchema>;
export type ApiErrorCode = z.infer<typeof errorSchema>['code'];
export type ApiResult<T> =
  | { ok: true; state: ApiState | null; data: T }
  | { ok: false; state: ApiState | null; error: z.infer<typeof errorSchema> };
export type ContextData = z.infer<typeof contextDataSchema>;
export type HierarchyData = z.infer<typeof hierarchyDataSchema>;

export type CommandData = z.infer<typeof commandDataSchema>;
