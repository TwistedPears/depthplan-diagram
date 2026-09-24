import type { RecursiveDocument } from './recursiveDocument';
/** Opaque main-owned record. The renderer cannot grant access by supplying a path. */
export interface SourceFile {
  id: string;
  path: string;
  fingerprint: string | null;
}
export type FileResult<T> =
  | ({ status: 'success' } & T)
  | { status: 'canceled' }
  | { status: 'error'; error: string };
export type FileCandidate = {
  document: RecursiveDocument;
  source: SourceFile;
};
