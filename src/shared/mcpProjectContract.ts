import { z } from 'zod';
import { editorId, editorResult, version } from './editorApiContract';
import { filePath } from './mcpFileContract';
import { projectNameSchema } from './projectContract';
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
export const projectCreate = z.strictObject({
  appInstanceId: editorId,
  requestId: editorId,
  name: projectNameSchema,
  path: filePath.regex(/\.depthproject$/i),
  replaceProjectSessionId: editorId.optional(),
});
export const projectCommand = z.strictObject({
  handle: projectHandle,
  requestId: editorId,
  action: z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('create_board'),
      name: projectNameSchema,
    }),
    z.strictObject({
      type: z.literal('rename_board'),
      boardId: editorId,
      name: projectNameSchema.optional(),
      filename: z
        .string()
        .min(1)
        .max(240)
        .regex(/^[^\\/]+$/)
        .optional(),
    }),
    z.strictObject({
      type: z.literal('rename_project'),
      name: projectNameSchema,
    }),
    z.strictObject({ type: z.literal('remove_board'), boardId: editorId }),
  ]),
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
  depthplan_create_project: {
    input: projectCreate,
    output: editorResult,
    readOnly: false,
    destructive: true,
    description:
      'Create a project like Menu → New Project (the active board travels with its content and history), name it and save it to a new .depthproject path inside an approved folder; all boards are written beside it. Replacing an open project requires its replaceProjectSessionId, and an unsaved one offers a discard/cancel decision. Returns an operationId. Existing files are never overwritten.',
  },
  depthplan_project: {
    input: projectCommand,
    output: editorResult,
    readOnly: false,
    destructive: true,
    description:
      'Manage members of the specified live project with the board drawer’s guards: create_board (creates and opens it), rename_board (name and/or filename; a name alone also regenerates the filename), rename_project and remove_board. A saved project requires an approved folder covering its location. Removal deletes membership only: a saved board file stays on disk and is reported as unlisted; an unsaved board is discarded. Resolve drafts first. Identical request IDs replay the original result.',
  },
};
