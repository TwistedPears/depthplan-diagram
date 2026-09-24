import { useRef, useState } from 'react';
import type useDocumentState from './useDocumentState';
import type {
  FileCandidate,
  FileResult,
  SourceFile,
} from '../../shared/fileContract';
import type { RecursiveDocument } from '../../shared/recursiveDocument';
import { validateRecursiveDocument } from '../../shared/recursiveDocument';

type Owner = ReturnType<typeof useDocumentState>;
export type FileActionResult = {
  status: 'success' | 'canceled' | 'error' | 'stale';
  sessionId: string;
  revision: number;
  error?: string;
};
export type FileAccess = {
  read?: () => Promise<FileResult<FileCandidate>>;
  write?: (
    document: RecursiveDocument,
    sourceId?: string,
  ) => Promise<FileResult<{ source: SourceFile }>>;
  permit?: () => boolean;
};
/** Native file operations capture one session/revision; useDocumentTransitions owns prompts. */
export default function useDocumentFiles(
  owner: Owner,
  onStatus: (message: string) => void,
  recovery?: {
    saved: (sessionId: string, revision: number) => Promise<void>;
    leave: (sessionId: string) => Promise<void>;
  },
) {
  const [loading, setLoading] = useState(false);
  const locked = useRef(false);
  const busy = (value: boolean) => {
    locked.current = value;
    setLoading(value);
    owner.setBusy('file-operation', value);
  };
  const save = async (
    saveAs = false,
    access: FileAccess = {},
  ): Promise<FileActionResult> => {
    const captured = owner.snapshot();
    const result = (status: FileActionResult['status']) => ({
      status,
      sessionId: captured.sessionId,
      revision: captured.revision,
    });
    if (locked.current || !captured.document || access.permit?.() === false)
      return result('canceled');
    busy(true);
    onStatus('Saving...');
    try {
      const saved = await (
        access.write ?? window.desktop.fileSystem.saveDocument
      )(captured.document, saveAs ? undefined : captured.source?.id);
      if (saved.status === 'error') throw new Error(saved.error);
      if (saved.status === 'canceled') {
        onStatus('Save canceled');
        return result('canceled');
      }
      if (owner.snapshot().sessionId !== captured.sessionId)
        return result('stale');
      owner.markSaved(captured.document, captured.sessionId, saved.source);
      await recovery?.saved(captured.sessionId, captured.revision);
      onStatus(`Saved: ${saved.source.path.split(/[\\/]/).pop()}`);
      return result('success');
    } catch (error) {
      onStatus(
        `Failed to save document: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        ...result('error'),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      busy(false);
    }
  };
  const load = async (
    kind: 'new' | 'open' | 'reload',
    beforeReplace?: () => Promise<boolean>,
    access: FileAccess = {},
  ): Promise<FileActionResult> => {
    const captured = owner.snapshot();
    const result = (status: FileActionResult['status']) => ({
      status,
      sessionId: captured.sessionId,
      revision: captured.revision,
    });
    if (locked.current || access.permit?.() === false)
      return result('canceled');
    if (kind === 'reload' && !captured.source) {
      onStatus('No file available to reload');
      return result('canceled');
    }
    busy(true);
    try {
      let reread: string | null = null;
      for (;;) {
        let document: RecursiveDocument,
          source = null as FileCandidate['source'] | null;
        if (kind === 'new' && !reread) {
          document = (await window.desktop.fileSystem.newDocument()).document;
        } else {
          const candidate: FileResult<FileCandidate> = await (access.read
            ? access.read()
            : reread
              ? window.desktop.fileSystem.reloadDocument(reread)
              : kind === 'open'
                ? window.desktop.fileSystem.openDocument()
                : window.desktop.fileSystem.reloadDocument(
                    captured.source!.id,
                  ));
          if (candidate.status === 'error') throw new Error(candidate.error);
          if (candidate.status === 'canceled') return result('canceled');
          document = candidate.document;
          source = candidate.source;
        }
        validateRecursiveDocument(document);
        const beforeGuard = owner.snapshot();
        busy(false);
        if (access.permit?.() === false) return result('canceled');
        if (beforeReplace && !(await beforeReplace()))
          return result('canceled');
        const current = owner.snapshot();
        if (
          current.sessionId !== captured.sessionId ||
          (!beforeReplace && current.revision !== captured.revision)
        ) {
          onStatus(
            'Document changed while reading. Open or reload again to use the candidate.',
          );
          return result('stale');
        }
        if (
          source &&
          current.source?.id !== beforeGuard.source?.id &&
          current.source?.path === source.path &&
          current.source.fingerprint !== source.fingerprint
        ) {
          reread = current.source.id;
          busy(true);
          continue;
        }
        if (access.permit?.() === false) return result('canceled');
        // Once cleanup starts, finish this accepted replacement even if cancellation arrives.
        owner.setBusy('closing', true);
        await recovery?.leave(current.sessionId);
        owner.setBusy('closing', false);
        owner.replace(document, { source });
        onStatus(
          kind === 'new'
            ? 'New document created'
            : `Opened: ${source!.path.split(/[\\/]/).pop()}`,
        );
        return result('success');
      }
    } catch (error) {
      onStatus(
        `Failed to ${kind} document: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        ...result('error'),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      owner.setBusy('closing', false);
      busy(false);
    }
  };
  return { loading, save, load };
}
