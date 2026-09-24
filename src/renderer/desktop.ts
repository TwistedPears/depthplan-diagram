import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createRecursiveDocument } from '../shared/recursiveDocument';
import type { RecursiveDocument } from '../shared/recursiveDocument';
import type { FileLease, FolderGrant } from '../shared/mcpFileContract';
import type {
  FileCandidate,
  FileResult,
  SourceFile,
} from '../shared/fileContract';

async function native<T = any>(method: string, ...args: unknown[]): Promise<T> {
  try {
    return await invoke<T>('desktop', { method, args });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
async function binary<T>(
  method: string,
  args: unknown[],
  data: Uint8Array,
): Promise<T> {
  try {
    return await invoke<T>('desktop_binary', data, {
      headers: {
        'x-depthplan-request': btoa(
          String.fromCharCode(
            ...new TextEncoder().encode(JSON.stringify([method, args])),
          ),
        ),
      },
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
function subscribe<T>(channel: string, callback: (payload: T) => void) {
  let active = true;
  const ready = listen<T>(channel, ({ payload }) => {
    if (active) callback(payload);
  });
  return () => {
    active = false;
    void ready.then((stop) => stop()).catch(console.error);
  };
}

const menuChannels = [
  'menu:undo',
  'menu:redo',
  'menu:new',
  'menu:open',
  'menu:reload-document',
  'menu:save',
  'menu:save-as',
  'menu:export-svg',
  'menu:export-json',
] as const;
export type Channels = (typeof menuChannels)[number];

const desktopHandler = {
  clipboard: {
    readText: (): Promise<string> => native('clipboard:read-text'),
    writeText: (text: string): Promise<void> =>
      native('clipboard:write-text', text),
  },
  mcpFiles: {
    folders: (): Promise<FolderGrant[]> => native('mcp:folders'),
    approveFolder: (): Promise<
      import('../shared/automationContract').AutomationStatus
    > => native('mcp:approve-folder'),
    revokeFolder: (
      id: string,
    ): Promise<import('../shared/automationContract').AutomationStatus> =>
      native('mcp:revoke-folder', id),
    release: (lease: FileLease): Promise<void> => native('mcp:release', lease),
    lease: (): Promise<FileLease> => native('mcp:lease'),
    check: (lease: FileLease): Promise<void> => native('mcp:check', lease),
    inspect: (
      path: string,
      lease: FileLease,
    ): Promise<{ path: string; fingerprint: string | null }> =>
      native('mcp:inspect', path, lease),
    read: (path: string, lease: FileLease): Promise<FileCandidate> =>
      native('mcp:read', path, lease),
    write: (request: {
      path: string;
      lease: FileLease;
      kind: 'save' | 'json' | 'svg' | 'png';
      expected: string | null;
      data: unknown;
    }): Promise<{
      source?: SourceFile;
      path?: string;
      bytes?: number;
      fingerprint?: string;
    }> =>
      request.data instanceof Uint8Array
        ? binary('mcp:write', [{ ...request, data: null }], request.data)
        : native('mcp:write', request),
    recovery: (
      action: 'list' | 'prepare' | 'discard',
      id: string | null,
      lease: FileLease,
    ): Promise<unknown> => native('mcp:recovery', action, id, lease),
    onRevoked: (callback: () => void) => {
      const state = (value: { enabled: boolean }) => {
        if (!value.enabled) callback();
      };
      const stopState = subscribe('automation:state', state);
      const stopRevoked = subscribe('mcp:revoked', callback);
      return () => {
        stopState();
        stopRevoked();
      };
    },
  },
  recovery: {
    discover: (): Promise<{
      entries: import('../shared/recoveryContract').RecoveryEntry[];
      warnings: string[];
    }> => native('recovery:discover'),
    prepare: (
      id: string,
    ): Promise<import('../shared/recoveryContract').RecoveryCandidate> =>
      native('recovery:prepare', id),
    release: (id: string): Promise<void> => native('recovery:release', id),
    discard: (id: string): Promise<void> => native('recovery:discard', id),
    write: (
      request: import('../shared/recoveryContract').CheckpointRequest,
    ): Promise<void> => native('recovery:write', request),
    remove: (sessionId: string, revision?: number): Promise<void> =>
      native('recovery:remove', sessionId, revision),
  },
  automation: {
    status: (): Promise<
      import('../shared/automationContract').AutomationStatus
    > => native('automation:status'),
    enable: (
      enabled: boolean,
    ): Promise<import('../shared/automationContract').AutomationStatus> =>
      native('automation:enable', enabled),
    onRequest: (callback: (request: unknown) => unknown) => {
      let enabled = false;
      let generation = 0;
      const state = (value: { enabled: boolean; generation: number }) => {
        enabled = value.enabled;
        generation = value.generation;
      };
      const receive = (value: { id: string; generation: number }) => {
        if (!enabled || generation !== value.generation) return;
        void Promise.resolve()
          .then(() => callback(value))
          .then((result) => {
            if (enabled && generation === value.generation)
              return native('automation:reply', value.id, result);
          })
          .catch(() =>
            native('automation:reply', value.id, {
              ok: false,
              state: null,
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Tool handler failed',
                retryable: false,
              },
            }),
          )
          .catch(() => {});
      };
      const stopState = subscribe('automation:state', state);
      const stopRequest = subscribe('automation:request', receive);
      return () => {
        stopState();
        stopRequest();
      };
    },
  },
  openLink: (url: string): Promise<void> => native('link:open', url),
  getAppInstanceId: (): Promise<string> => native('app:instance-id'),
  editHistory: (direction: 'undo' | 'redo'): Promise<void> => {
    if (direction !== 'undo' && direction !== 'redo')
      throw new Error('Invalid edit action');
    document.execCommand(direction);
    return Promise.resolve();
  },
  events: {
    on(channel: Channels, callback: () => void) {
      if (!menuChannels.includes(channel))
        throw new Error('Unsupported menu channel');
      return subscribe(channel, callback);
    },
  },
  transitions: {
    confirm: (
      kind: 'draft' | 'document',
      label: string,
      canApply: boolean,
    ): Promise<'save' | 'discard' | 'cancel'> =>
      native('transition:confirm', kind, label, canApply),
    onRequest: (callback: (id: string) => void) => {
      return subscribe('transition:request', callback);
    },
    reply: (id: string, approved: boolean): Promise<void> =>
      native('transition:reply', id, approved),
  },
  fileSystem: {
    onOpenRequested: (callback: (id: string) => void) => {
      let active = true;
      const delivered = new Set<string>();
      const receive = (id: string) => {
        if (active && !delivered.has(id)) {
          delivered.add(id);
          callback(id);
        }
      };
      const ready = listen<string>('file:open-request', ({ payload }) => {
        receive(payload);
      });
      // Listen before enumerating so startup events cannot fall into a gap.
      void ready
        .then(() => native<string[]>('file:open-requests'))
        .then((ids) => {
          ids.forEach(receive);
        })
        .catch(console.error);
      return () => {
        active = false;
        void ready.then((stop) => stop()).catch(console.error);
      };
    },
    readOpenRequest: (id: string): Promise<FileResult<FileCandidate>> =>
      native('file:open-request', id),
    releaseOpenRequest: (id: string): Promise<void> =>
      native('file:release-open-request', id),
    newDocument: (): Promise<{ document: RecursiveDocument; filePath: null }> =>
      Promise.resolve({
        document: createRecursiveDocument(
          crypto.randomUUID(),
          'Untitled Document',
        ),
        filePath: null,
      }),
    openDocument: (): Promise<FileResult<FileCandidate>> => native('file:open'),
    saveDocument: (
      document: RecursiveDocument,
      fileId?: string,
      saveAs = false,
    ): Promise<FileResult<{ source: SourceFile }>> =>
      native('file:save', document, fileId, saveAs),
    reloadDocument: (fileId: string): Promise<FileResult<FileCandidate>> =>
      native('file:reload-document', fileId),
  },
  export: {
    startPng: (width: number, height: number): Promise<string> =>
      native('png:start', width, height),
    writePng: (id: string, pixels: Uint8Array): Promise<void> =>
      binary('png:write', [id], pixels),
    finishPng: async (id: string): Promise<Uint8Array> =>
      new Uint8Array(
        await binary<ArrayBuffer>('png:finish', [id], new Uint8Array()),
      ),
    abortPng: (id: string): Promise<void> => native('png:abort', id),
    exportImage: (
      format: 'svg' | 'png',
      data: string | Uint8Array,
      fileName: string,
    ): Promise<string | null> =>
      data instanceof Uint8Array
        ? binary('export:image', [format, null, fileName], data)
        : native('export:image', format, data, fileName),
    exportJSON: (
      document: RecursiveDocument,
      suggestedFileName?: string,
    ): Promise<string | null> =>
      native('export:json', document, suggestedFileName),
  },
};
window.desktop = desktopHandler;
export type DesktopApi = typeof desktopHandler;
