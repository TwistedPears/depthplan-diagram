import type { RecursiveDocument } from './recursiveDocument';
import type { SourceFile } from './fileContract';
export interface CheckpointRequest {
  sessionId: string;
  revision: number;
  document: RecursiveDocument;
  sourceId?: string;
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
}
export interface RecoveryCandidate {
  document: RecursiveDocument;
  source: SourceFile | null;
  sessionId: string;
}
