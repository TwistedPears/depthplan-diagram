import type { RecursiveDocument } from './recursiveDocument';
import type { SourceFile } from './fileContract';
export interface CheckpointRequest {
  sessionId: string;
  revision: number;
  document: RecursiveDocument;
  sourceId?: string;
  project?: { sessionId: string; boardId: string };
}
export interface RecoveryWriter {
  write(request: CheckpointRequest): Promise<void>;
  remove(sessionId: string, throughRevision?: number): Promise<void>;
}
export interface RecoveryEntry {
  id: string;
  title: string;
  sourcePath: string | null;
  capturedAt: string;
  sessionId: string;
  instanceId: string;
  revision: number;
  project?: {
    id: string;
    name: string;
    location: string;
    boardId: string;
  } | null;
}
export interface RecoveryCandidate {
  document: RecursiveDocument;
  source: SourceFile | null;
  sessionId: string;
}
