import { flushSync } from 'react-dom';
import type { FileLease } from '../../shared/mcpFileContract';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createRecursiveDocument,
  validProjectLink,
  type ProjectLink,
} from '../../shared/recursiveDocument';
import type { Camera } from '../../shared/recursiveCamera';
import { recursiveScene } from '../../shared/recursiveScene';
import type { FileCandidate, FileResult } from '../../shared/fileContract';
import {
  projectFilename,
  projectNameSchema,
  projectPathSchema,
  type ProjectAction,
  type ProjectSnapshot,
} from '../../shared/projectContract';
import useDocumentSessions from './useDocumentSessions';

export type ProjectDialog =
  | { kind: 'search'; query?: string }
  | { kind: 'openBoard' }
  | { kind: 'saveIssue'; boardId: string }
  | {
      kind: 'createBoard' | 'duplicateBoard' | 'removeBoard';
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
  const [backStack, setBackStack] = useState<
    { boardId: string; camera: Camera; selected: string[] }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<ProjectDialog | null>(null);
  const [drawer, setDrawer] = useState(() => window.innerWidth >= 1100);
  const [filter, setFilter] = useState('');
  const [recoveryReady, setRecoveryReady] = useState(false);
  const writes = useRef(Promise.resolve());
  const remember = async (activeKey = registry.snapshot().activeKey) => {
    const current = live.current;
    if (!current?.location) return;
    const tabs = registry.snapshot().sessions.flatMap((session) => {
      const owner = registry.controllers.get(session.key)?.owner;
      return session.project && owner
        ? [
            {
              boardId: session.project.boardId,
              camera: owner.snapshot().camera,
            },
          ]
        : [];
    });
    const active =
      registry.snapshot().sessions.find((session) => session.key === activeKey)
        ?.project?.boardId ?? null;
    const view = {
      tabs,
      active,
      drawer,
      window: [
        Math.max(900, window.innerWidth),
        Math.max(640, window.innerHeight),
      ] as [number, number],
    };
    const pending = writes.current
      .catch(() => {})
      .then(async () => {
        success(
          await window.desktop.projects.remember(current.sessionId, view),
        );
      });
    writes.current = pending;
    await pending;
  };
  const writer = useRef(remember);
  writer.current = remember;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleRemember = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!locked.current)
        void writer
          .current()
          .catch((e) =>
            setError(`Could not save local workspace: ${String(e)}`),
          );
    }, 500);
  }, []);
  useEffect(() => {
    scheduleRemember();
  }, [
    project,
    registry.sessions,
    registry.activeKey,
    drawer,
    scheduleRemember,
  ]);
  useEffect(() => {
    window.addEventListener('resize', scheduleRemember);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('resize', scheduleRemember);
    };
  }, [scheduleRemember]);
  const toggle = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const update = (next: ProjectSnapshot | null) => {
    if (next?.sessionId !== live.current?.sessionId) setBackStack([]);
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
      await remember(previous).catch((e) =>
        setError(`Could not save local workspace: ${String(e)}`),
      );
      completed = (await action()) !== false;
      return completed;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      registry.release();
      if (!completed) registry.activate(previous);
      locked.current = false;
      flushSync(() => setBusy(false));
      scheduleRemember();
    }
  };
  const openBoard = async (boardId: string, lease?: FileLease) => {
    const current = live.current;
    if (!current) return false;
    const opened = await registry.open(
      key(boardId),
      async () => {
        try {
          const result = success(
            await window.desktop.projects.readBoard(
              current.sessionId,
              boardId,
              lease,
            ),
          );
          return result
            ? {
                status: 'success' as const,
                document: result.board.document,
                source: result.board.source,
                fingerprint: result.board.fingerprint,
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
  const boardDocument = async (boardId: string) => {
    const current = live.current;
    if (!current?.manifest.boards.some((board) => board.id === boardId))
      throw new Error(
        'Board is no longer in this project. Change the link target.',
      );
    const snapshot = registry.controllers.get(key(boardId))?.owner.snapshot();
    if (snapshot?.document) return snapshot.document;
    const result = success(
      await window.desktop.projects.readBoard(current.sessionId, boardId),
    );
    if (!result) throw new Error('Board read canceled.');
    if (live.current?.sessionId !== current.sessionId)
      throw new Error('Project changed. Try again.');
    return result.board.document;
  };
  const focusBoard = (moved: boolean) => {
    if (moved)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(
            '[data-board-session][data-active="true"]',
          )
          ?.focus(),
      );
    return moved;
  };
  const followLink = (link: ProjectLink) =>
    run(async () => {
      if (!validProjectLink(link))
        throw new Error('Invalid project link. Change the link target.');
      const project = live.current;
      if (!project || project.manifest.id !== link.projectId)
        throw new Error(
          'This link belongs to another project. Open its complete project folder or change the target.',
        );
      const origin = registry
        .snapshot()
        .sessions.find(
          (session) => session.key === registry.snapshot().activeKey,
        )?.project?.boardId;
      const snapshot = registry.controllers
        .get(registry.snapshot().activeKey)
        ?.owner.snapshot();
      const document = await boardDocument(link.boardId);
      if (
        link.bookmarkId &&
        !Object.hasOwn(document.namedViews ?? {}, link.bookmarkId)
      )
        throw new Error(
          'Bookmark is no longer available. Change the link target.',
        );
      if (!(await openBoard(link.boardId))) return false;
      const owner = registry.controllers.get(key(link.boardId))!.owner;
      if (link.bookmarkId) owner.focusEntity('bookmarks', link.bookmarkId);
      if (origin && snapshot) {
        // ponytail: retain 32 local back contexts; a durable navigation history is unnecessary.
        setBackStack((stack) => [
          ...stack.slice(-31),
          {
            boardId: origin,
            camera: snapshot.camera,
            selected: snapshot.canvas.selected,
          },
        ]);
      }
      return true;
    }).then(focusBoard);
  const goBack = () =>
    run(async () => {
      const origin = backStack.at(-1);
      if (!origin) return false;
      if (
        !live.current?.manifest.boards.some(
          (board) => board.id === origin.boardId,
        )
      ) {
        setBackStack((stack) => stack.slice(0, -1));
        throw new Error('The previous board is no longer in this project.');
      }
      if (!(await openBoard(origin.boardId))) return false;
      const owner = registry.controllers.get(key(origin.boardId))!.owner;
      if (owner.isBusy())
        throw new Error('Finish the current edit or gesture before returning.');
      const document = owner.snapshot().document!;
      const scene = recursiveScene(document);
      const visible = new Set([
        ...[...scene.world.keys()].map((id) => `object-${id}`),
        ...[...scene.connections.values()]
          .flat()
          .map((item) => `connection-${item.id}`),
      ]);
      owner.setCamera(origin.camera);
      owner.setCanvas((canvas) => ({
        ...canvas,
        selected: origin.selected.filter((id) => visible.has(id)),
        selectedPoint: null,
      }));
      setBackStack((stack) => stack.slice(0, -1));
      return true;
    }).then(focusBoard);
  const openHome = async (next: ProjectSnapshot) => {
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
  const install = async (next: ProjectSnapshot) => {
    let saved = null;
    try {
      saved = success(
        await window.desktop.projects.workspace(next.sessionId),
      )?.view;
    } catch (e) {
      setError(`Could not restore local workspace: ${String(e)}`);
    }
    const previous = live.current;
    await registry.retire();
    if (previous)
      success(await window.desktop.projects.close(previous.sessionId));
    registry.install([]);
    update(next);
    if (saved) {
      setDrawer(saved.drawer);
      for (const tab of saved.tabs) {
        if (!next.manifest.boards.some((board) => board.id === tab.boardId)) {
          setError('Some previous tabs are no longer project members.');
          continue;
        }
        try {
          if (await openBoard(tab.boardId))
            registry.controllers
              .get(key(tab.boardId))
              ?.owner.setCamera(tab.camera);
        } catch (e) {
          setError(`Could not restore board: ${String(e)}`);
        }
      }
      if (saved.active) registry.activate(key(saved.active));
      if (!saved.tabs.length || registry.snapshot().sessions.length) return;
    }
    await openHome(next);
  };
  const guardProject = async () => {
    const current = live.current;
    if (!current || current.location) return true;
    const choice = await window.desktop.transitions.confirm(
      'document',
      current.manifest.name,
      true,
    );
    if (choice === 'save') return locked.current ? saveDraft() : run(saveDraft);
    return choice === 'discard';
  };
  const saveDraft = async () => {
    const current = live.current!;
    const active = registry.snapshot().activeKey;
    setError('');
    try {
      if (!(await registry.prepare())) return false;
      const saved = success(
        await window.desktop.projects.save(
          current.sessionId,
          current.fingerprint,
          current.manifest,
        ),
      );
      if (!saved) return false;
      update(saved.project);
      // Keep the owners, histories and navigation handles; only their sources change.
      for (const board of saved.project.manifest.boards) {
        const controller = registry.controllers.get(key(board.id));
        if (!controller) continue;
        const read = success(
          await window.desktop.projects.readBoard(current.sessionId, board.id),
        );
        if (!read) throw new Error('Could not read the saved board');
        controller.owner.relocate(board.name, read.board.source);
      }
      return true;
    } catch (e) {
      if (live.current?.location) {
        setError(
          `Project saved, but a board could not reopen: ${String(e)}. Close and reopen the affected board before editing.`,
        );
      } else setError(String(e));
      return false;
    } finally {
      registry.release();
      registry.activate(active);
    }
  };
  const saveAll = () =>
    run(() =>
      live.current && !live.current.location ? saveDraft() : registry.saveAll(),
    );
  const acceptProject = async (candidate: ProjectSnapshot) => {
    if (candidate.sessionId === live.current?.sessionId) return true;
    let installed = false;
    try {
      if (!(await guardProject()) || !(await registry.prepare())) return false;
      await install(candidate);
      installed = true;
    } finally {
      if (!installed) await window.desktop.projects.close(candidate.sessionId);
    }
  };
  const openProject = (read = () => window.desktop.projects.open()) =>
    run(async () => {
      const candidate = success(await read());
      return candidate ? acceptProject(candidate.project) : false;
    });
  const createProject = () =>
    run(async () => {
      if (!(await guardProject()) || !(await registry.prepare())) return false;
      const created = success(await window.desktop.projects.new());
      if (!created) return false;
      await install(created.project);
    });
  const acceptStandalone = async (candidate: FileCandidate | null) => {
    if (!(await guardProject()) || !(await registry.prepare())) return false;
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
  };
  const standalone = (read?: () => Promise<FileResult<FileCandidate>>) =>
    run(async () => {
      const candidate = read ? success(await read()) : null;
      return read && !candidate ? false : acceptStandalone(candidate);
    });
  const openRequest = (id: string) =>
    run(async () => {
      const candidate = success(
        await window.desktop.fileSystem.readOpenRequest(id),
      );
      if (!candidate) return false;
      return 'project' in candidate
        ? acceptProject(candidate.project)
        : acceptStandalone(candidate);
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
    kind: 'createBoard' | 'renameBoard' | 'duplicateBoard' | 'removeBoard',
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
  const renameBoard = (boardId: string, name: string) => {
    const board = live.current!.manifest.boards.find((b) => b.id === boardId)!;
    if (name === board.name) return Promise.resolve(true);
    if (!projectNameSchema.safeParse(name).success) {
      setError(
        'Enter a board name without path separators, control characters or a trailing period.',
      );
      return Promise.resolve(false);
    }
    return manage(
      'renameBoard',
      name,
      projectFilename(
        name,
        live
          .current!.manifest.boards.filter((b) => b.id !== boardId)
          .map((b) => b.path),
      ),
      boardId,
    );
  };
  const renameFilename = (boardId: string, value: string) => {
    const board = live.current!.manifest.boards.find((b) => b.id === boardId)!;
    const filename =
      value.replace(/\.depthplan(?:\.json)?$/i, '') + '.depthplan';
    const path =
      board.path.slice(0, board.path.lastIndexOf('/') + 1) + filename;
    if (
      !value ||
      value.includes('/') ||
      !projectPathSchema.safeParse(path).success
    ) {
      setError(
        'Enter a filename without folder separators or reserved characters.',
      );
      return Promise.resolve(false);
    }
    if (path === board.path) return Promise.resolve(true);
    return manage('renameBoard', board.name, path, boardId);
  };
  const newBoard = () => {
    if (live.current?.location) setDialog({ kind: 'createBoard' });
    else {
      const names = new Set(live.current?.manifest.boards.map((b) => b.name));
      let name = 'Untitled Board';
      for (let n = 2; names.has(name); n++) name = `Untitled Board ${n}`;
      void manage(
        'createBoard',
        name,
        projectFilename(
          name,
          live.current?.manifest.boards.map((b) => b.path) ?? [],
        ),
      );
    }
  };
  const resolveDefinition = (overwrite: boolean) =>
    run(async () => {
      const current = live.current!;
      const observed = success(
        await window.desktop.projects.definition(current.sessionId),
      );
      if (!observed) return false;
      const affected = overwrite
        ? []
        : registry.sessions
            .filter((session) => {
              const original = current.manifest.boards.find(
                (b) => b.id === session.project?.boardId,
              );
              return !observed.manifest.boards.some(
                (b) => b.id === original?.id && b.path === original.path,
              );
            })
            .map((session) => session.key);
      if (affected.length && !(await registry.prepare(affected))) return false;
      const result = success(
        await window.desktop.projects.resolveDefinition(
          current.sessionId,
          observed.fingerprint,
          overwrite,
        ),
      );
      if (!result) return false;
      await registry.retire(affected);
      const remaining = registry.sessions.filter(
        (session) => !affected.includes(session.key),
      );
      registry.install(
        remaining,
        remaining.some((session) => session.key === registry.activeKey)
          ? registry.activeKey
          : (remaining[0]?.key ?? ''),
      );
      update(result.project);
      for (const controller of registry.controllers.values())
        if (/manifest changed/i.test(controller.files.failure?.message ?? ''))
          controller.files.clearFailure();
      if (!remaining.length) await openHome(result.project);
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
      if (!result.project.location) {
        for (const id of result.imported) {
          const board = live.current!.manifest.boards.find((b) => b.id === id)!;
          const read = success(
            await window.desktop.projects.readBoard(current.sessionId, id),
          );
          if (!read) return false;
          await apply({
            kind: 'renameBoard',
            boardId: id,
            name: board.name,
            path: projectFilename(
              board.name,
              live.current!.manifest.boards.map((b) => b.path),
            ),
            expected: read.board.fingerprint,
          });
        }
      }
      if (result.imported.length) await openBoard(result.imported[0]);
      setError(result.errors.join('\n'));
    });
  const quickSwitch = () => {
    setDrawer(true);
    requestAnimationFrame(() => search.current?.focus());
  };
  useEffect(() => {
    if (!window.desktop.projects) return;
    const stops = [
      window.desktop.events.on('menu:new-project', () => {
        if (!dialog) void createProject();
      }),
      window.desktop.events.on('menu:open-project', () => {
        if (!dialog) void openProject();
      }),
      window.desktop.events.on('menu:close', () => {
        if (!dialog) void standalone();
      }),
    ];
    if (!registry.activeKey && project) {
      for (const event of ['menu:save', 'menu:save-as'] as const)
        stops.push(
          window.desktop.events.on(event, () => {
            if (!dialog) void saveAll();
          }),
        );
      stops.push(window.desktop.events.on('menu:new', () => newBoard()));
      stops.push(
        window.desktop.events.on('menu:open', () => {
          if (!dialog) setDialog({ kind: 'openBoard' });
        }),
      );
    }
    return () => stops.forEach((stop) => stop());
  });
  return {
    project,
    recoveryReady,
    setRecoveryReady,
    remember,
    scheduleRemember,
    busy,
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
    resolveDefinition,
    openBoard,
    boardDocument,
    followLink,
    goBack,
    previousBoard: backStack.at(-1)?.boardId ?? null,
    openProject,
    openRequest,
    createProject,
    newBoard,
    renameBoard,
    renameFilename,
    saveAll,
    guardProject,
    renameProject: (name: string) =>
      run(async () => {
        if (!projectNameSchema.safeParse(name).success)
          throw new Error(
            'Enter a project name without path separators, control characters or a trailing period.',
          );
        const { description, homeBoardId } = live.current!.manifest;
        return !!(await apply({
          kind: 'settings',
          name,
          description,
          homeBoardId,
          autosave: true,
        }));
      }),
    standalone,
    manage,
    importBoards,
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
