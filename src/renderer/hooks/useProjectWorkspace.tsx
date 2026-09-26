import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createRecursiveDocument } from '../../shared/recursiveDocument';
import type { FileCandidate, FileResult } from '../../shared/fileContract';
import {
  projectFilename,
  type ProjectAction,
  type ProjectSnapshot,
} from '../../shared/projectContract';
import useDocumentSessions from './useDocumentSessions';

export type ProjectDialog =
  | { kind: 'settings' }
  | {
      kind:
        | 'create'
        | 'createBoard'
        | 'renameBoard'
        | 'duplicateBoard'
        | 'removeBoard';
      boardId?: string;
    };
function success<T>(result: FileResult<T>): T | null {
  if (result.status === 'error') throw new Error(result.error);
  return result.status === 'success' ? result : null;
}
function useProject() {
  const registry = useDocumentSessions();
  const [project, setProject] = useState<ProjectSnapshot | null>(null);
  const live = useRef(project);
  const [busy, setBusy] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState<string | null>(null);
  const locked = useRef(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<ProjectDialog | null>(null);
  const [drawer, setDrawer] = useState(() => window.innerWidth >= 1100);
  const [filter, setFilter] = useState('');
  const toggle = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const update = (next: ProjectSnapshot | null) => {
    live.current = next;
    setProject(next);
  };
  const key = (boardId: string) => `${live.current!.sessionId}:${boardId}`;
  const run = async (action: () => Promise<boolean | void>) => {
    if (locked.current || !registry.canSwitch()) return false;
    const previous = registry.activeKey;
    let completed = false;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      completed = (await action()) !== false;
      return completed;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      registry.release();
      if (!completed) registry.activate(previous);
      locked.current = false;
      setBusy(false);
    }
  };
  const openBoard = async (boardId: string) => {
    const current = live.current;
    if (!current) return false;
    const opened = await registry.open(
      key(boardId),
      async () => {
        setLoadingBoard(boardId);
        try {
          const result = success(
            await window.desktop.projects.readBoard(current.sessionId, boardId),
          );
          return result
            ? {
                status: 'success' as const,
                document: result.board.document,
                source: result.board.source,
              }
            : { status: 'canceled' as const };
        } catch (error) {
          const board = current.manifest.boards.find((b) => b.id === boardId);
          if (board && live.current?.sessionId === current.sessionId)
            update({
              ...live.current,
              diagnostics: [
                ...live.current.diagnostics.filter(
                  (d) => d.boardId !== boardId,
                ),
                { boardId, path: board.path, error: String(error) },
              ],
            });
          throw error;
        } finally {
          setLoadingBoard(null);
        }
      },
      { sessionId: current.sessionId, boardId },
    );
    if (opened && live.current?.diagnostics.some((d) => d.boardId === boardId))
      update({
        ...live.current,
        diagnostics: live.current.diagnostics.filter(
          (d) => d.boardId !== boardId,
        ),
      });
    return !!opened;
  };
  const install = async (next: ProjectSnapshot) => {
    const previous = live.current;
    await registry.retire();
    if (previous)
      success(await window.desktop.projects.close(previous.sessionId));
    registry.install([]);
    update(next);
    // A healthy home board wins; failed members never prevent the project opening.
    const ids = [
      ...new Set([
        next.manifest.homeBoardId,
        ...next.manifest.boards.map((b) => b.id),
      ]),
    ];
    for (const id of ids) {
      if (!id) continue;
      try {
        if (await openBoard(id)) break;
      } catch (e) {
        setError(String(e));
      }
    }
  };
  const openProject = () =>
    run(async () => {
      const candidate = success(await window.desktop.projects.open());
      if (!candidate) return false;
      let installed = false;
      try {
        if (!(await registry.prepare())) return false;
        await install(candidate.project);
        installed = true;
      } finally {
        if (!installed)
          await window.desktop.projects.close(candidate.project.sessionId);
      }
    });
  const createProject = (name: string, folder: string, copy: boolean) =>
    run(async () => {
      const active = registry.activeKey;
      if (!(await registry.prepare(undefined, copy ? active : undefined)))
        return false;
      const document = copy
        ? (registry.controllers.get(active)?.owner.snapshot().document ??
          undefined)
        : undefined;
      const created = success(
        await window.desktop.projects.create(name, folder, document),
      );
      if (!created) return false;
      await install(created.project);
      setDialog(null);
    });
  const standalone = (read?: () => Promise<FileResult<FileCandidate>>) =>
    run(async () => {
      const candidate = read ? success(await read()) : null;
      if (read && !candidate) return false;
      if (!(await registry.prepare())) return false;
      await registry.retire();
      if (live.current)
        success(await window.desktop.projects.close(live.current.sessionId));
      update(null);
      registry.install([
        {
          key: crypto.randomUUID(),
          document:
            candidate?.document ??
            createRecursiveDocument(crypto.randomUUID(), 'Untitled Document'),
          source: candidate?.source ?? null,
        },
      ]);
    });
  const apply = async (action: ProjectAction) => {
    const current = live.current!;
    const result = success(
      await window.desktop.projects.apply(
        current.sessionId,
        current.fingerprint,
        action,
      ),
    );
    if (!result) return null;
    update(result.project);
    return result.project;
  };
  const manage = (
    kind: Exclude<ProjectDialog['kind'], 'settings'>,
    name = '',
    path = '',
    boardId?: string,
  ) =>
    run(async () => {
      const sessionKey = boardId ? key(boardId) : '';
      const controller = registry.controllers.get(sessionKey);
      if (controller) {
        if (
          !(await registry.prepare(
            [sessionKey],
            kind === 'removeBoard' ? undefined : sessionKey,
          ))
        )
          return false;
        if (
          kind === 'renameBoard' &&
          controller.owner.snapshot().dirty &&
          (await controller.files.save()).status !== 'success'
        )
          throw new Error('Save the board successfully before renaming it.');
      }
      let action: ProjectAction;
      if (kind === 'removeBoard') action = { kind, boardId: boardId! };
      else if (kind === 'renameBoard') {
        const read = success(
          await window.desktop.projects.readBoard(
            live.current!.sessionId,
            boardId!,
          ),
        );
        if (!read) return false;
        const expected =
          controller?.owner.snapshot().source?.fingerprint ??
          read.board.fingerprint;
        action = { kind, boardId: boardId!, name, path, expected };
      } else if (kind === 'duplicateBoard')
        action = {
          kind,
          boardId: boardId!,
          name,
          path,
          document: controller?.owner.snapshot().document ?? undefined,
        };
      else action = { kind: 'createBoard', name, path };
      const next = await apply(action);
      if (!next) return false;
      if (kind === 'removeBoard' && controller) {
        await registry.retire([sessionKey]);
        registry.drop(sessionKey);
      }
      if (kind === 'renameBoard' && controller) {
        const read = success(
          await window.desktop.projects.readBoard(next.sessionId, boardId!),
        );
        if (read) controller.owner.relocate(name, read.board.source);
      }
      registry.release();
      if (kind === 'createBoard' || kind === 'duplicateBoard')
        await openBoard(next.manifest.boards.at(-1)!.id);
      setDialog(null);
    });
  const importBoards = () =>
    run(async () => {
      const current = live.current!;
      const result = success(
        await window.desktop.projects.importBoards(
          current.sessionId,
          current.fingerprint,
        ),
      );
      if (!result) return false;
      update(result.project);
      if (result.imported.length) await openBoard(result.imported[0]);
      setError(result.errors.join('\n'));
    });
  const reorder = (boardId: string, delta: number) =>
    run(async () => {
      const ids = live.current!.manifest.boards.map((b) => b.id);
      const from = ids.indexOf(boardId),
        to = from + delta;
      if (from < 0 || to < 0 || to >= ids.length) return false;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      await apply({ kind: 'reorderBoards', ids });
    });
  const quickSwitch = () => {
    setDrawer(true);
    requestAnimationFrame(() => search.current?.focus());
  };
  useEffect(() => {
    if (!window.desktop.projects) return;
    const stops = [
      window.desktop.events.on('menu:new-project', () => {
        if (!locked.current && !dialog) setDialog({ kind: 'create' });
      }),
      window.desktop.events.on('menu:open-project', () => {
        if (!dialog) void openProject();
      }),
      window.desktop.events.on('menu:close-project', () => {
        if (live.current && !dialog) void standalone();
      }),
      window.desktop.events.on('menu:project-board', quickSwitch),
      window.desktop.events.on('menu:project-settings', () => {
        if (live.current && !locked.current && !dialog)
          setDialog({ kind: 'settings' });
      }),
      window.desktop.events.on('menu:close-tab', () => {
        if (live.current && registry.activeKey && !dialog)
          void run(() => registry.close(registry.activeKey));
      }),
    ];
    if (!registry.activeKey && project) {
      stops.push(
        window.desktop.events.on('menu:new', () =>
          setDialog({ kind: 'createBoard' }),
        ),
      );
      stops.push(
        window.desktop.events.on('menu:open', () => {
          void standalone(() => window.desktop.fileSystem.openDocument());
        }),
      );
    }
    return () => stops.forEach((stop) => stop());
  });
  return {
    project,
    busy,
    loadingBoard,
    error,
    setError,
    dialog,
    setDialog,
    drawer,
    setDrawer,
    filter,
    setFilter,
    toggle,
    search,
    key,
    run,
    update,
    apply,
    openBoard,
    openProject,
    createProject,
    standalone,
    manage,
    importBoards,
    reorder,
    quickSwitch,
    filename: (name: string) =>
      projectFilename(name, [
        ...(project?.manifest.boards.map((b) => b.path) ?? []),
        ...(project?.diagnostics.filter((d) => !d.boardId).map((d) => d.path) ??
          []),
      ]),
  };
}
const ProjectContext = createContext<ReturnType<typeof useProject> | null>(
  null,
);
export function ProjectWorkspace({ children }: { children: ReactNode }) {
  return (
    <ProjectContext.Provider value={useProject()}>
      {children}
    </ProjectContext.Provider>
  );
}
export default function useProjectWorkspace() {
  return useContext(ProjectContext);
}
