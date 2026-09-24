import { z } from 'zod';
import {
  commandFields,
  editorId,
  editorResult,
  version,
} from './editorApiContract';

export const filePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'));
export const leaseSchema = z.strictObject({
  generation: version,
  id: editorId,
});
export type FileLease = z.infer<typeof leaseSchema>;
export type FolderGrant = { id: string; path: string };
export const fileInput = z.strictObject({
  ...commandFields,
  action: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('new') }),
    z.strictObject({ type: z.literal('open'), path: filePath }),
    z.strictObject({ type: z.literal('reload') }),
    z.strictObject({ type: z.literal('save'), path: filePath.optional() }),
    z.strictObject({ type: z.literal('save_as'), path: filePath }),
  ]),
});
export const exportInput = z.strictObject({
  ...commandFields,
  path: filePath,
  format: z.enum(['svg', 'png', 'json']),
  scope: z.enum(['whole', 'selection']).default('whole'),
});
export const operationReadInput = z.strictObject({
  appInstanceId: editorId,
  operationId: editorId,
  offset: version.optional(),
  length: z.number().int().positive().max(16384).default(16384),
});
export const operationCancelInput = z.strictObject({
  appInstanceId: editorId,
  operationId: editorId,
});
export const decisionInput = z.strictObject({
  ...commandFields,
  operationId: editorId,
  decisionId: editorId,
  choice: z.enum([
    'save',
    'discard',
    'cancel',
    'overwrite',
    'save-as',
    'accept',
  ]),
  path: filePath.optional(),
});
export const recoveryInput = z.strictObject({
  ...commandFields,
  id: editorId,
  action: z.enum(['restore', 'discard']),
});
export const fileTools = {
  depthplan_get_access: {
    input: z.strictObject({}),
    output: editorResult,
    readOnly: true,
    description:
      'Read approved folders for this app run. File access can only be granted or revoked through the local MCP Server controls.',
  },
  depthplan_files: {
    input: fileInput,
    output: editorResult,
    readOnly: false,
    destructive: true,
    description:
      'Start New/Open/Reload/Save/Save As through the normal document lifecycle. Paths must be in approved folders. Returns an operationId; inspect it for completion or decisions, including unsaved changes.',
  },
  depthplan_export: {
    input: exportInput,
    output: editorResult,
    readOnly: false,
    destructive: true,
    description:
      'Export SVG/PNG from the acknowledged rendered revision, or JSON from document state, to an approved path. Image scope includes offscreen visible content. Returns an operationId; existing targets require a fingerprint-bound overwrite decision.',
  },
  depthplan_get_operation: {
    input: operationReadInput,
    output: editorResult,
    readOnly: true,
    description:
      'Read an operation receipt, pending decision or outcome. For large recovery details, request offset/length and concatenate detailText chunks as JSON. Receipts survive document replacement for this app run; only the latest 64 are retained.',
  },
  depthplan_cancel_operation: {
    input: operationCancelInput,
    output: editorResult,
    readOnly: false,
    description:
      'Request cancellation. Running I/O may already have committed; query the final receipt to distinguish completed from canceled. Canceled is reported only after work stops.',
  },
  depthplan_decide: {
    input: decisionInput,
    output: editorResult,
    readOnly: false,
    destructive: true,
    description:
      'Resolve the exact pending decision. Use current document/view versions and decisionId. Offered choices cover unsaved work, file conflicts and recovery.',
  },
  depthplan_get_recovery: {
    input: z.strictObject({
      offset: version.default(0),
      pageSize: z.number().int().positive().max(200).default(50),
    }),
    output: editorResult,
    readOnly: false,
    description:
      'List recoverable work owned by the application. Use returned opaque IDs for restore or discard; arbitrary checkpoint paths are not accepted. Discovery quarantines invalid checkpoints using the normal recovery logic.',
  },
  depthplan_recovery: {
    input: recoveryInput,
    output: editorResult,
    readOnly: false,
    destructive: true,
    description:
      'Restore a recovery candidate after preview/accept and normal unsaved-work decisions, or explicitly discard it. Returns an operationId.',
  },
};
