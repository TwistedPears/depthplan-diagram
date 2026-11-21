import type { z } from 'zod';
import {
  boundedResult,
  editorFailure,
  EditorError,
} from '../../shared/editorQueries';
import {
  decisionInput,
  operationCancelInput,
  operationReadInput,
  type FileLease,
} from '../../shared/mcpFileContract';
import { projectCommand, projectCreate } from '../../shared/mcpProjectContract';
import {
  projectFilename,
  type ProjectSnapshot,
} from '../../shared/projectContract';
import type useDocumentSessions from './useDocumentSessions';
import type useProjectWorkspace from './useProjectWorkspace';
import { boardFilePath } from './useProjectWorkspace';

type Context = {
  appInstanceId: string | null;
  registry: ReturnType<typeof useDocumentSessions>;
  workspace: NonNullable<ReturnType<typeof useProjectWorkspace>>;
};
type Snapshot = Parameters<typeof boundedResult>[0] & { viewRevision?: number };
type Reply = z.infer<typeof decisionInput>;
type Operation = {
  id: string;
  kind: 'create_project';
  status: 'running' | 'needs-decision' | 'completed' | 'canceled' | 'failed';
  cancelRequested: boolean;
  target: {
    appInstanceId: string | null;
    sessionId: string;
    documentId: string | null;
    revision: number;
    viewRevision: number;
  };
  decision?: {
    id: string;
    kind: string;
    label: string;
    choices: string[];
    state: { sessionId: string; revision: number; viewRevision: number };
  };
  reply?: (value: Reply | null) => void;
  result?: unknown;
  error?: string;
};
const summary = ({ reply: _reply, ...operation }: Operation) => operation;

/** Workspace-level MCP project management through the drawer's own operations. */
export function projectAutomation(
  current: () => Context,
  snapshot: () => Snapshot,
) {
  const operations = new Map<string, Operation>();
  let active: Operation | null = null;
  const describe = (project: ProjectSnapshot) => ({
    handle: {
      appInstanceId: current().appInstanceId,
      projectSessionId: project.sessionId,
    },
    id: project.manifest.id,
    name: project.manifest.name,
    location: project.location,
    total: project.manifest.boards.length,
  });
  const board = (id: string) => {
    const { workspace, registry } = current();
    const member = workspace.project?.manifest.boards.find((b) => b.id === id);
    const s = registry.controllers.get(workspace.key(id))?.owner.snapshot();
    return member
      ? {
          ...member,
          handle: s
            ? { appInstanceId: s.appInstanceId, sessionId: s.sessionId }
            : null,
        }
      : null;
  };
  // Drafts and gestures would raise UI prompts; MCP resolves them explicitly first.
  const idle = (keys?: string[]) => {
    const { registry } = current();
    for (const session of registry.snapshot().sessions) {
      if (keys && !keys.includes(session.key)) continue;
      const c = registry.controllers.get(session.key);
      if (c && (c.hasDrafts || c.owner.isBusy() || c.work?.active()))
        throw new EditorError(
          'BUSY',
          'Resolve drafts, gestures and MCP operations on affected boards first',
        );
    }
  };
  /** Hold the workspace transition lock with a live MCP lease for its duration. */
  const guarded = async (action: (lease: FileLease) => Promise<boolean>) => {
    const lease = await window.desktop.mcpFiles.lease();
    try {
      let failure: unknown;
      const done = await current().workspace.run(async () => {
        try {
          await window.desktop.mcpFiles.check(lease);
          return await action(lease);
        } catch (error) {
          failure = error;
          throw error;
        }
      });
      if (failure) throw failure;
      return done;
    } finally {
      await window.desktop.mcpFiles.release(lease).catch(() => {});
    }
  };
  const command = async (raw: unknown) => {
    const { handle, action } = projectCommand.parse(raw);
    const workspace = current().workspace,
      project = workspace.project;
    if (!project || handle.projectSessionId !== project.sessionId)
      throw new EditorError('STALE_SESSION', 'Refresh the project workspace');
    const member =
      'boardId' in action
        ? project.manifest.boards.find((b) => b.id === action.boardId)
        : undefined;
    if ('boardId' in action) {
      if (!member)
        throw new EditorError('NOT_FOUND', 'Board is not a project member');
      idle([workspace.key(member.id)]);
    }
    const w = () => current().workspace;
    let boardId = member?.id;
    let run: ((lease: FileLease) => Promise<boolean | void>) | null = null;
    if (action.type === 'create_board') {
      const before = new Set(project.manifest.boards.map((b) => b.id));
      run = async (lease) => {
        const done = await w().manageBoard(
          'createBoard',
          action.name,
          w().filename(action.name),
          undefined,
          lease,
        );
        boardId = w().project?.manifest.boards.find(
          (b) => !before.has(b.id),
        )?.id;
        return done;
      };
    } else if (action.type === 'rename_board') {
      const name = action.name ?? member!.name;
      const path =
        action.filename !== undefined
          ? boardFilePath(member!.path, action.filename)
          : name === member!.name
            ? member!.path
            : projectFilename(
                name,
                project.manifest.boards
                  .filter((b) => b.id !== member!.id)
                  .map((b) => b.path),
              );
      if (!path)
        throw new EditorError(
          'INVALID_REQUEST',
          'Use a filename without folder separators or reserved characters',
        );
      if (action.name === undefined && action.filename === undefined)
        throw new EditorError('INVALID_REQUEST', 'Provide name or filename');
      if (name !== member!.name || path !== member!.path)
        run = (lease) =>
          w().manageBoard('renameBoard', name, path, member!.id, lease);
    } else if (action.type === 'rename_project') {
      if (action.name !== project.manifest.name)
        run = (lease) => w().renameProjectNow(action.name, lease);
    } else
      run = (lease) =>
        w().manageBoard('removeBoard', '', '', member!.id, lease);
    if (run) {
      const call = run;
      if (!(await guarded(async (lease) => (await call(lease)) !== false)))
        throw new EditorError(
          'BUSY',
          'The project is busy or the change was canceled; refresh and retry',
        );
    }
    const next = current().workspace.project!;
    return boundedResult(snapshot(), {
      action: action.type,
      changed: !!run,
      project: describe(next),
      ...(action.type === 'remove_board'
        ? {
            boardId,
            file: project.location ? 'retained-unlisted' : 'discarded',
          }
        : { board: boardId ? board(boardId) : null }),
    });
  };
  const decisionState = () => {
    const s = snapshot();
    return s.sessionId
      ? {
          sessionId: s.sessionId,
          revision: s.revision,
          viewRevision: s.viewRevision ?? 0,
        }
      : {
          sessionId: current().workspace.project?.sessionId ?? '',
          revision: 0,
          viewRevision: 0,
        };
  };
  const confirm =
    (op: Operation) =>
    async (_kind: string, label: string): Promise<'discard' | 'cancel'> => {
      if (op.cancelRequested) return 'cancel';
      op.status = 'needs-decision';
      op.decision = {
        id: crypto.randomUUID(),
        kind: 'unsaved project',
        label: `${label} has never been saved. Discard it to create the new project?`,
        choices: ['discard', 'cancel'],
        state: decisionState(),
      };
      const reply = await new Promise<Reply | null>((resolve) => {
        op.reply = resolve;
      });
      delete op.reply;
      delete op.decision;
      op.status = 'running';
      if (reply?.choice === 'discard') return 'discard';
      op.cancelRequested = true;
      return 'cancel';
    };
  const create = async (raw: unknown) => {
    const args = projectCreate.parse(raw);
    const { workspace, registry } = current();
    if (
      (workspace.project?.sessionId ?? undefined) !==
      args.replaceProjectSessionId
    )
      throw new EditorError(
        'STALE_SESSION',
        workspace.project
          ? 'Pass the open project’s handle.projectSessionId as replaceProjectSessionId to replace it'
          : 'No project is open; omit replaceProjectSessionId',
      );
    if (active)
      throw new EditorError('BUSY', 'Another project operation is running');
    idle();
    const { sessions, activeKey } = registry.snapshot();
    if (
      sessions.some(
        (s) =>
          s.key !== activeKey &&
          !s.project &&
          registry.controllers.get(s.key)?.owner.snapshot().dirty,
      )
    )
      throw new EditorError('BUSY', 'Save or close other documents first');
    // Validate the grant and a vacant destination before changing the workspace.
    const lease = await window.desktop.mcpFiles.lease();
    try {
      const observed = await window.desktop.mcpFiles.inspect(args.path, lease);
      if (observed.fingerprint !== null)
        throw new Error('A file already exists at the project path');
    } finally {
      await window.desktop.mcpFiles.release(lease).catch(() => {});
    }
    const s = snapshot();
    const op: Operation = {
      id: crypto.randomUUID(),
      kind: 'create_project',
      status: 'running',
      cancelRequested: false,
      target: {
        appInstanceId: s.appInstanceId,
        sessionId: s.sessionId,
        documentId: s.document?.id ?? null,
        revision: s.revision,
        viewRevision: s.viewRevision ?? 0,
      },
    };
    active = op;
    operations.set(op.id, op);
    if (operations.size > 64)
      operations.delete(operations.keys().next().value!);
    const w = () => current().workspace;
    void guarded(async (lease) => {
      if ((await w().newProject(confirm(op))) === false) return false;
      if (op.cancelRequested) return false;
      if (
        w().project!.manifest.name !== args.name &&
        !(await w().renameProjectNow(args.name))
      )
        return false;
      if (op.cancelRequested) return false;
      return w().saveProject({ path: args.path, lease });
    })
      .then((done) => {
        op.status = done ? 'completed' : 'canceled';
        const project = w().project;
        if (done && project)
          op.result = {
            project: describe(project),
            boards: project.manifest.boards.map((b) => board(b.id)),
          };
      })
      .catch((error) => {
        op.status = op.cancelRequested ? 'canceled' : 'failed';
        op.error = (
          error instanceof Error ? error.message : String(error)
        ).slice(0, 512);
      })
      .finally(() => {
        delete op.reply;
        delete op.decision;
        active = null;
      });
    return boundedResult(s, { operationId: op.id, replayed: false });
  };
  const find = (appInstanceId: string, id: string) => {
    if (appInstanceId !== current().appInstanceId)
      throw new EditorError('STALE_APP', 'Refresh current app state');
    const op = operations.get(id);
    if (!op)
      throw new EditorError(
        'NOT_FOUND',
        'Operation receipt is unavailable or expired',
      );
    return op;
  };
  const work = {
    read: (input: unknown) => {
      try {
        const args = operationReadInput.parse(input);
        return boundedResult(
          snapshot(),
          summary(find(args.appInstanceId, args.operationId)),
        );
      } catch (error) {
        return editorFailure(snapshot(), error);
      }
    },
    cancel: (input: unknown) => {
      try {
        const args = operationCancelInput.parse(input),
          op = find(args.appInstanceId, args.operationId);
        if (['running', 'needs-decision'].includes(op.status)) {
          op.cancelRequested = true;
          op.reply?.(null);
        }
        return boundedResult(snapshot(), summary(op));
      } catch (error) {
        return editorFailure(snapshot(), error);
      }
    },
    decide: (input: unknown) => {
      try {
        const args = decisionInput.parse(input),
          op = find(args.handle.appInstanceId, args.operationId),
          d = op.decision;
        if (!d || d.id !== args.decisionId)
          throw new EditorError(
            'STALE_REVISION',
            'Decision changed; inspect the operation',
          );
        const now = decisionState();
        if (
          args.handle.sessionId !== d.state.sessionId ||
          args.expectedRevision !== d.state.revision ||
          args.expectedViewRevision !== d.state.viewRevision ||
          JSON.stringify(now) !== JSON.stringify(d.state)
        ) {
          op.cancelRequested = true;
          op.reply?.(null);
          throw new EditorError(
            'STALE_REVISION',
            'State changed; this operation was canceled without replacing the project',
          );
        }
        if (!d.choices.includes(args.choice))
          throw new Error('Choose one of the offered decisions');
        op.reply?.(args);
        return boundedResult(snapshot(), {
          operationId: op.id,
          accepted: true,
        });
      } catch (error) {
        return editorFailure(snapshot(), error);
      }
    },
  };
  return { command, create, work };
}
