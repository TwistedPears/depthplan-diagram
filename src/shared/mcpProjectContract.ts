import { z } from 'zod';
import { editorId, editorResult, version } from './editorApiContract';
export const projectHandle = z.strictObject({
  appInstanceId: editorId,
  projectSessionId: editorId,
});
export const projectQuery = z.strictObject({
  offset: version.default(0),
  pageSize: z.number().int().min(1).max(100).default(100),
});
export const projectOpen = z.strictObject({
  handle: projectHandle,
  boardId: editorId,
  requestId: editorId,
});
export const projectTools = {
  depthplan_get_project: {
    input: projectQuery,
    output: editorResult,
    readOnly: true,
    description:
      'List the active project identity, canonical location and paged member identities with live session handles. Metadata discovery grants no filesystem access. Empty input discovers the active workspace.',
  },
  depthplan_open_board: {
    input: projectOpen,
    output: editorResult,
    readOnly: false,
    description:
      'Open or activate an existing member of the specified live project and return its document session handle. Requires an approved folder for a board read. Does not create members or modify source files. Identical request IDs replay the original result.',
  },
};
