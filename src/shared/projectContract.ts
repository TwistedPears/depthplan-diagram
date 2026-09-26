import { z } from 'zod';
import type { RecursiveDocument } from './recursiveDocument';

export const PROJECT_MAX_BYTES = 1024 * 1024;
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const projectNameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[^\s\\/:*?"<>|\p{Cc}](?:[^\\/:*?"<>|\p{Cc}]*[^\s.\\/:*?"<>|\p{Cc}])?$/u,
  );
// Portable ASCII filenames; display names and the selected root support Unicode.
export const projectPathSchema = z
  .string()
  .max(240)
  .regex(/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_. -]*\.depthplan$/);
export const projectManifestSchema = z.strictObject({
  projectVersion: z.literal(1),
  id,
  name: projectNameSchema,
  description: z.string().max(4000),
  boards: z
    .array(
      z.strictObject({ id, name: projectNameSchema, path: projectPathSchema }),
    )
    .max(1000),
  homeBoardId: id.nullable(),
  autosave: z.boolean(),
  extensions: z.record(z.string(), z.json()).optional(),
});
export type ProjectManifest = z.infer<typeof projectManifestSchema>;
export function validateProjectManifest(
  value: unknown,
): asserts value is ProjectManifest {
  projectManifestSchema.parse(value);
  const manifest = value as ProjectManifest;
  if (
    new TextEncoder().encode(JSON.stringify(value)).length > PROJECT_MAX_BYTES
  )
    throw new Error('Project manifest exceeds 1 MiB');
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const board of manifest.boards) {
    if (
      ids.has(board.id) ||
      paths.has(board.path.toLowerCase()) ||
      board.path
        .split('/')
        .some((part) =>
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        )
    )
      throw new Error('Duplicate board identity/path or reserved filename');
    ids.add(board.id);
    paths.add(board.path.toLowerCase());
  }
  if (manifest.homeBoardId !== null && !ids.has(manifest.homeBoardId))
    throw new Error('Home board must be a project member');
}
export type ProjectAction =
  | { kind: 'createBoard'; name: string; path: string }
  | { kind: 'importBoard'; name: string; path: string }
  | {
      kind: 'duplicateBoard';
      boardId: string;
      name: string;
      path: string;
      document?: RecursiveDocument;
    }
  | {
      kind: 'renameBoard';
      boardId: string;
      name: string;
      path: string;
      expected: string;
    }
  | { kind: 'removeBoard'; boardId: string }
  | { kind: 'reorderBoards'; ids: string[] }
  | {
      kind: 'settings';
      name: string;
      description: string;
      homeBoardId: string | null;
      autosave: boolean;
    };
export interface ProjectSnapshot {
  sessionId: string;
  location: string;
  workspaceKey: string;
  fingerprint: string;
  manifest: ProjectManifest;
  diagnostics: { boardId: string | null; path: string; error: string }[];
}
export interface ProjectBoard {
  document: RecursiveDocument;
  fingerprint: string;
}
