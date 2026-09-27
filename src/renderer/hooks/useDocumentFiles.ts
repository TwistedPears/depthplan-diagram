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
  source?: SourceFile | null;
  copied?: boolean;
};
export type FileAccess = {
  background?: boolean;
  read?: () => Promise<
    FileResult<Omit<FileCandidate, 'source'> & { source: SourceFile | null }>
  >;
  write?: (
    document: RecursiveDocument,
    sourceId?: string,
  ) => Promise<FileResult<{ source: SourceFile | null; copied?: boolean }>>;
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
  project?: { sessionId: string; boardId: string },
) {
  const [loading, setLoading] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [failure, setFailure] = useState<{
    sessionId: string;
    message: string;
    conflict: boolean;
  } | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const running = useRef<Promise<FileActionResult> | null>(null);
  const locked = useRef(false);
  const busy = (value: boolean, background = false) => {
    locked.current = value;
    setLoading(value);
    setBlocking(value && !background);
    owner.setBusy('file-operation', value && !background);
  };
  const performSave = async (
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
    busy(true, access.background);
    const notify = (message: string) => {
      if (!access.background) onStatus(message);
    };
    notify('Saving...');
    try {
      const saved = await (access.write
        ? access.write(
            captured.document,
            saveAs ? undefined : captured.source?.id,
          )
        : project && !saveAs
          ? window.desktop.projects.writeBoard(
              project.sessionId,
              project.boardId,
              captured.source?.fingerprint ?? '',
              captured.document,
            )
          : window.desktop.fileSystem.saveDocument(
              project && saveAs
                ? { ...captured.document, id: crypto.randomUUID() }
                : captured.document,
              captured.source?.id,
              saveAs,
            ));
      if (saved.status === 'error') throw new Error(saved.error);
      if (saved.status === 'canceled') {
        notify('Save canceled');
        return result('canceled');
      }
      if (owner.snapshot().sessionId !== captured.sessionId)
        return result('stale');
      if (project && (saveAs || ('copied' in saved && saved.copied))) {
        notify(`Saved copy: ${saved.source?.path}`);
        return { ...result('success'), source: saved.source, copied: true };
      }
      owner.markSaved(
        captured.document,
        captured.sessionId,
        saved.source ?? undefined,
      );
      setFailure(null);
      setSavedAt(Date.now());
      if (saved.source)
        await recovery?.saved(captured.sessionId, captured.revision);
      notify(
        saved.source
          ? `Saved: ${saved.source.path.split(/[\\/]/).pop()}`
          : 'In memory',
      );
      return { ...result('success'), source: saved.source };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (owner.snapshot().sessionId === captured.sessionId)
        setFailure({
          sessionId: captured.sessionId,
          message,
          conflict:
            /source file changed|manifest changed|ownership changed/i.test(
              message,
            ),
        });
      notify(`Failed to save document: ${message}`);
      return {
        ...result('error'),
        error: message,
      };
    } finally {
      busy(false);
    }
  };
  const save = (saveAs = false, access: FileAccess = {}) => {
    const operation = performSave(saveAs, access);
    if (!running.current) {
      running.current = operation;
      void operation.finally(() => {
        if (running.current === operation) running.current = null;
      });
    }
    return operation;
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
          const candidate: FileResult<
            Omit<FileCandidate, 'source'> & { source: SourceFile | null }
          > = await (access.read
            ? access.read()
            : project && kind === 'reload'
              ? window.desktop.projects
                  .readBoard(project.sessionId, project.boardId)
                  .then((result) =>
                    result.status === 'success'
                      ? {
                          status: 'success' as const,
                          document: result.board.document,
                          source: result.board.source,
                        }
                      : result,
                  )
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
        setFailure(null);
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
  return {
    loading,
    blocking,
    isLoading: () => locked.current,
    save,
    load,
    savedAt,
    failure: failure?.sessionId === owner.sessionId ? failure : null,
    wait: () => running.current,
    clearFailure: () => setFailure(null),
  };
}
