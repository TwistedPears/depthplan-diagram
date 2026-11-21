import { z } from 'zod';
import { editorId, version } from './editorApiContract';
import { handleSchema, resultSchema } from './depthApiContract';

export const SNAPSHOT_MAX_PIXELS = 4_000_000;
export const SNAPSHOT_DEFAULT_PIXELS = 1_500_000;
export const SNAPSHOT_MAX_SIDE = 4096;
/** Base64 PNG budget; the native transport allows this tool 8 MiB in total. */
export const SNAPSHOT_MAX_BASE64 = 7 * 1024 * 1024;
export const snapshotInput = z.strictObject({
  handle: handleSchema,
  scope: z.enum(['viewport', 'whole', 'objects']).default('viewport'),
  ids: z.array(editorId).min(1).max(200).optional(),
  bookmarkId: editorId.optional(),
  maxPixels: z
    .number()
    .int()
    .min(10_000)
    .max(SNAPSHOT_MAX_PIXELS)
    .default(SNAPSHOT_DEFAULT_PIXELS),
});
const rect = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
/** Metadata only: the adapter moves `png` into an MCP image content block. */
export const snapshotData = z.strictObject({
  scope: z.enum(['viewport', 'whole', 'objects', 'bookmark']),
  width: z.number().int().positive().max(SNAPSHOT_MAX_SIDE),
  height: z.number().int().positive().max(SNAPSHOT_MAX_SIDE),
  scale: z.number().positive(),
  region: rect,
  revision: version,
  viewRevision: version,
  bytes: z.number().int().positive(),
});
export const snapshotTools = {
  depthplan_snapshot: {
    input: snapshotInput,
    output: resultSchema(snapshotData),
    readOnly: true,
    description:
      'Return a PNG of the rendered canvas as image content plus metadata (pixel size, scale, world region, revisions). scope viewport = what the board shows now; whole = all revealed content at the active depths and folds; objects = the region around visible ids with everything drawn there. bookmarkId renders that bookmark’s camera view only when its depths, folds and layout already match the live board; otherwise apply it first. Drawing layer only: no selection handles, minimap or drafts. Scaled down to maxPixels (default 1.5 MP, max 4 MP, 4096 px per side). Needs no folder grant, writes nothing and changes no document, history, selection, camera or revision. The board must be active and idle.',
  },
};
