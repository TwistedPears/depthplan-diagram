import AutomationControl from './AutomationControl';
import type useAutomation from '../hooks/useAutomation';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  projectFilename,
  projectNameSchema,
} from '../../shared/projectContract';
import useDocumentSessions from '../hooks/useDocumentSessions';
import useProjectWorkspace, {
  type ProjectDialog,
} from '../hooks/useProjectWorkspace';
import FormDialog from './FormDialog';
import ProjectSettings from './ProjectSettings';
import ProjectSaveIssue from './ProjectSaveIssue';
import ProjectDefinitionActions from './ProjectDefinitionActions';
import RecentProjects from './RecentProjects';
import ProjectSearch from './ProjectSearch';
import Icon from './Icon';
import './ProjectNavigation.css';

const boardNames = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function ProjectMenu({
  onAction = () => {},
}: {
  onAction?: () => void;
}) {
  const workspace = useProjectWorkspace();
  const registry = useDocumentSessions();
  if (!workspace) return null;
  const { project, busy, setDialog, openProject, standalone, quickSwitch } =
    workspace;
  return (
    <div className="project-menu">
      <div className="dropdown-label">Projects</div>
      <button
        disabled={busy}
        onClick={() => {
          setDialog({ kind: 'create' });
          onAction();
        }}
      >
        New Project…
      </button>
      <button
        disabled={busy}
        onClick={() => {
          void openProject();
          onAction();
        }}
      >
        Open Project…
      </button>
      {project && (
        <>
          {workspace.previousBoard && (
            <button
              disabled={busy}
              onClick={() => {
                void workspace.goBack();
                onAction();
              }}
            >
              Back to previous board
            </button>
          )}
          <button
            disabled={busy || registry.sessions.length === 0}
            onClick={() => {
              void workspace.run(() => registry.saveAll());
              onAction();
            }}
          >
            Save All
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setDialog({ kind: 'settings' });
              onAction();
            }}
          >
            Project Settings…
          </button>
          <button
            disabled={busy}
            onClick={() => {
              quickSwitch();
              onAction();
            }}
          >
            Open Board in Project…
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setDialog({ kind: 'search' });
              onAction();
            }}
          >
            Search Project…
          </button>
          <button
            disabled={busy}
            onClick={() => {
              void standalone();
              onAction();
            }}
          >
            Close Project
          </button>
        </>
      )}
      <button
        disabled={busy}
        onClick={() => {
          setDialog({ kind: 'recents' });
          onAction();
        }}
      >
        Recent Projects…
      </button>
    </div>
  );
}

function ProjectForm({
  action,
}: {
  action: Exclude<
    ProjectDialog,
    { kind: 'settings' | 'saveIssue' | 'recents' | 'search' }
  >;
}) {
  const workspace = useProjectWorkspace()!;
  const registry = useDocumentSessions();
  const board = workspace.project?.manifest.boards.find(
    (b) => b.id === action.boardId,
  );
  const [name, setName] = useState(
    action.kind === 'duplicateBoard'
      ? `${board?.name} Copy`
      : (board?.name ?? ''),
  );
  const [copy, setCopy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const trimmed = name.trim();
  const valid = projectNameSchema.safeParse(trimmed).success;
  const creating = action.kind === 'create',
    removing = action.kind === 'removeBoard';
  const path = creating
    ? projectFilename(trimmed, [], '')
    : workspace.filename(trimmed);
  const title = {
    create: 'New Project',
    createBoard: 'New Board',
    renameBoard: 'Rename Board',
    duplicateBoard: 'Duplicate Board',
    removeBoard: 'Remove from Project',
  }[action.kind];
  return (
    <FormDialog
      title={title}
      description={
        removing
          ? 'The board file will remain in the project folder.'
          : creating
            ? 'Choose a name and first board, then select a parent folder. A new project folder will be created there.'
            : 'Each board is an independent document in your project folder.'
      }
      initialFocus={removing ? undefined : input}
      submitLabel={
        workspace.busy
          ? 'Working…'
          : removing
            ? 'Remove board'
            : creating
              ? 'Choose folder and create'
              : action.kind === 'renameBoard'
                ? 'Rename board'
                : action.kind === 'duplicateBoard'
                  ? 'Duplicate board'
                  : 'Create board'
      }
      destructive={removing}
      submitDisabled={workspace.busy}
      cancelDisabled={workspace.busy}
      onCancel={() => {
        workspace.setDialog(null);
        workspace.setError('');
      }}
      onSubmit={() => {
        setSubmitted(true);
        if (!removing && !valid) return;
        if (creating) void workspace.createProject(trimmed, path, copy);
        else void workspace.manage(action.kind, trimmed, path, action.boardId);
      }}
    >
      {removing ? (
        <p>
          Remove <strong>{board?.name}</strong> from the board list? Accepted
          changes will be saved before closing it.
        </p>
      ) : (
        <>
          <label>
            Name
            <input
              ref={input}
              value={name}
              maxLength={120}
              aria-invalid={submitted && !valid}
              aria-describedby="project-name-help"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p
            id="project-name-help"
            className={submitted && !valid ? 'project-error' : 'field-hint'}
          >
            {submitted && !valid
              ? 'Enter a name without path separators, control characters or a trailing period.'
              : `${creating ? 'New folder' : 'Filename'}: ${path}`}
          </p>
          {creating && (
            <label>
              First board
              <select
                value={copy ? 'copy' : 'blank'}
                onChange={(e) => setCopy(e.target.value === 'copy')}
              >
                <option value="blank">Blank Overview board</option>
                <option value="copy" disabled={!registry.activeKey}>
                  Copy current board
                </option>
              </select>
            </label>
          )}
        </>
      )}
      {workspace.error && (
        <p role="alert" className="project-error">
          {workspace.error}
        </p>
      )}
    </FormDialog>
  );
}

export default function ProjectNavigation({
  automation,
}: {
  automation: ReturnType<typeof useAutomation>;
}) {
  const emptyMenu = useRef<HTMLDetailsElement>(null);
  const workspace = useProjectWorkspace()!;
  const registry = useDocumentSessions();
  const {
    project,
    busy,
    drawer,
    setDrawer,
    filter,
    setFilter,
    toggle,
    search,
  } = workspace;
  const list = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState<{
    id: string;
    x: number;
    y: number;
    trigger: HTMLButtonElement;
  } | null>(null);
  const openMenu = (
    id: string,
    trigger: HTMLButtonElement,
    x = trigger.getBoundingClientRect().left,
    y = trigger.getBoundingClientRect().bottom,
  ) => {
    if (busy) return;
    trigger.focus();
    setContext({ id, x, y, trigger });
  };
  const closeMenu = () => {
    menu.current?.hidePopover();
    context?.trigger.focus();
    setContext(null);
  };
  useLayoutEffect(() => {
    const node = menu.current;
    if (!context || !node) return;
    node.showPopover({ source: context.trigger });
    node.style.left = `${Math.max(8, Math.min(context.x, window.innerWidth - node.offsetWidth - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(context.y, window.innerHeight - node.offsetHeight - 8))}px`;
    node.querySelector('button')?.focus();
  }, [context]);
  const moveFocus = (
    event: KeyboardEvent,
    elements: HTMLElement[],
    backwards: string,
    forwards: string,
  ) => {
    const index = elements.indexOf(event.target as HTMLElement);
    let next: number;
    if (event.key === backwards)
      next = (index - 1 + elements.length) % elements.length;
    else if (event.key === forwards) next = (index + 1) % elements.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = elements.length - 1;
    else return;
    event.preventDefault();
    elements[next]?.focus();
  };
  const open = (id: string) => {
    void workspace.run(() => workspace.openBoard(id));
  };
  const close = (key: string) => {
    void workspace.run(async () => {
      const closed = await registry.close(key);
      if (closed)
        requestAnimationFrame(() =>
          (
            list.current?.querySelector<HTMLElement>('[aria-current="true"]') ??
            toggle.current
          )?.focus(),
        );
      return closed;
    });
  };
  const members =
    project?.manifest.boards
      .filter((b) =>
        b.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
      )
      .sort(
        (a, b) =>
          boardNames.compare(a.name, b.name) ||
          boardNames.compare(a.path, b.path),
      ) ?? [];
  const contextBoard = project?.manifest.boards.find(
    (board) => board.id === context?.id,
  );
  return (
    <>
      {project && (
        <div className="project-navigation" data-session-navigation>
          {!registry.activeKey && (
            <div className="project-empty-identity document-switcher">
              <details ref={emptyMenu}>
                <summary aria-label="Project menu">
                  <Icon name="bars" />
                </summary>
                <div className="project-empty-menu dropdown-menu">
                  <ProjectMenu
                    onAction={() => {
                      emptyMenu.current?.removeAttribute('open');
                      emptyMenu.current?.querySelector('summary')?.focus();
                    }}
                  />
                  <AutomationControl
                    automation={automation}
                    onShowDetails={() => {
                      emptyMenu.current?.removeAttribute('open');
                      emptyMenu.current?.querySelector('summary')?.focus();
                    }}
                  />
                  <button
                    onClick={() => {
                      void workspace.standalone(() =>
                        window.desktop.fileSystem.openDocument(),
                      );
                    }}
                  >
                    Open standalone board…
                  </button>
                </div>
              </details>
              <span>{project.manifest.name}</span>
            </div>
          )}
          <button
            className="project-drawer-toggle"
            ref={toggle}
            aria-label="Toggle project boards"
            aria-expanded={drawer}
            aria-controls="project-drawer"
            onClick={() => setDrawer(!drawer)}
          >
            Boards / Project
          </button>
          {drawer && (
            <aside
              ref={list}
              id="project-drawer"
              aria-label="Project boards"
              className="project-drawer"
              onKeyDownCapture={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  if (filter) setFilter('');
                  else {
                    setDrawer(false);
                    toggle.current?.focus();
                  }
                } else if (
                  e.target === search.current &&
                  e.key === 'Enter' &&
                  members[0]
                ) {
                  e.preventDefault();
                  open(members[0].id);
                } else if (
                  e.target !== search.current ||
                  e.key === 'ArrowUp' ||
                  e.key === 'ArrowDown'
                )
                  moveFocus(
                    e,
                    [
                      ...list.current!.querySelectorAll<HTMLElement>(
                        '.project-board-open',
                      ),
                    ],
                    'ArrowUp',
                    'ArrowDown',
                  );
              }}
            >
              <header>
                <h2>
                  Boards <span>{project.manifest.boards.length}</span>
                </h2>
                <button
                  aria-label="Close board drawer"
                  title="Close board drawer"
                  onClick={() => {
                    setDrawer(false);
                    toggle.current?.focus();
                  }}
                >
                  <Icon name="xmark" />
                </button>
              </header>
              <label className="project-filter">
                <Icon name="magnifying-glass" />
                <input
                  ref={search}
                  aria-label="Find a board"
                  placeholder="Find a board…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
              <ul className="project-board-list" aria-label="Project members">
                {members.map((member) => {
                  const sessionKey = workspace.key(member.id);
                  const diagnostic = project.diagnostics.find(
                    (d) => d.boardId === member.id,
                  );
                  const failure =
                    registry.controllers.get(sessionKey)?.files.failure;
                  return (
                    <li
                      key={member.id}
                      data-active={sessionKey === registry.activeKey}
                    >
                      <button
                        className="project-board-open"
                        id={`board-link-${member.id}`}
                        aria-current={
                          sessionKey === registry.activeKey ? 'true' : undefined
                        }
                        aria-haspopup="menu"
                        data-board-id={member.id}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          if (!event.buttons)
                            openMenu(
                              member.id,
                              event.currentTarget,
                              event.clientX,
                              event.clientY,
                            );
                        }}
                        onPointerUp={(event) => {
                          // macOS contextmenu precedes pointerup, which dismisses popovers.
                          if (
                            event.button === 2 ||
                            (event.button === 0 && event.ctrlKey)
                          )
                            openMenu(
                              member.id,
                              event.currentTarget,
                              event.clientX,
                              event.clientY,
                            );
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === 'ContextMenu' ||
                            (event.shiftKey && event.key === 'F10')
                          ) {
                            event.preventDefault();
                            openMenu(member.id, event.currentTarget);
                          }
                        }}
                        aria-label={`Open ${member.name}, ${member.path}`}
                        title={`${member.name} — ${member.path}`}
                        disabled={busy}
                        onClick={() => open(member.id)}
                      >
                        <Icon name="file" />
                        <span>
                          {member.name}
                          <small>
                            {workspace.loadingBoard === member.id
                              ? 'Loading…'
                              : diagnostic
                                ? 'Unavailable — retry opening'
                                : (registry.statuses[sessionKey] ??
                                  (member.id === project.manifest.homeBoardId
                                    ? 'Home board'
                                    : member.path))}
                          </small>
                        </span>
                      </button>
                      {failure && (
                        <button
                          className="project-error"
                          onClick={() =>
                            workspace.setDialog({
                              kind: 'saveIssue',
                              boardId: member.id,
                            })
                          }
                        >
                          Resolve{' '}
                          {failure.conflict ? 'conflict' : 'save failure'} for{' '}
                          {member.name}…
                        </button>
                      )}
                      {diagnostic && (
                        <p className="project-error">
                          {diagnostic.error} Expected: {member.path}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!members.length && (
                <p className="project-empty-copy">
                  {filter
                    ? 'No matching boards.'
                    : 'No boards yet. Create or import a board to begin.'}
                </p>
              )}
              <footer>
                <button
                  disabled={busy}
                  onClick={() => workspace.setDialog({ kind: 'createBoard' })}
                >
                  <Icon name="plus" />
                  New Board
                </button>
                {workspace.previousBoard && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      void workspace.goBack();
                    }}
                  >
                    Back to previous board
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => {
                    void workspace.importBoards();
                  }}
                >
                  <Icon name="folder-open" />
                  Import Boards…
                </button>
              </footer>
              {project.diagnostics
                .filter((d) => !d.boardId)
                .map((d) => (
                  <p key={d.path} className="project-error">
                    {d.path}: {d.error}
                  </p>
                ))}
            </aside>
          )}
          {drawer && context && contextBoard && (
            <div
              ref={menu}
              popover="auto"
              className="project-board-menu"
              role="menu"
              aria-label={`Actions for ${contextBoard.name}`}
              tabIndex={-1}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape' || event.key === 'Tab') {
                  if (event.key === 'Escape') event.preventDefault();
                  closeMenu();
                } else
                  moveFocus(
                    event,
                    [
                      ...event.currentTarget.querySelectorAll<HTMLElement>(
                        'button:not(:disabled)',
                      ),
                    ],
                    'ArrowUp',
                    'ArrowDown',
                  );
              }}
            >
              {(
                [
                  ['renameBoard', 'Rename…'],
                  ['duplicateBoard', 'Duplicate…'],
                  ['removeBoard', 'Remove from Project…'],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  role="menuitem"
                  tabIndex={-1}
                  disabled={busy}
                  onClick={() => {
                    closeMenu();
                    workspace.setDialog({ kind, boardId: context.id });
                  }}
                >
                  {label}
                </button>
              ))}
              {registry.controllers.has(workspace.key(context.id)) && (
                <button
                  role="menuitem"
                  tabIndex={-1}
                  disabled={busy}
                  onClick={() => {
                    closeMenu();
                    close(workspace.key(context.id));
                  }}
                >
                  Close board
                </button>
              )}
            </div>
          )}
          {!registry.activeKey && (
            <div className="project-empty">
              <h1>Choose a board to begin.</h1>
              <p>
                Your project is open. Open a board from the drawer, or add one.
              </p>
              <button onClick={workspace.quickSwitch}>Open a board</button>
              <button
                onClick={() => workspace.setDialog({ kind: 'createBoard' })}
              >
                New Board
              </button>
              <button
                onClick={() => {
                  void workspace.importBoards();
                }}
              >
                Import Boards…
              </button>
            </div>
          )}
        </div>
      )}
      {workspace.error && !workspace.dialog && (
        <div role="alert" className="project-notice">
          <p>{workspace.error}</p>
          <ProjectDefinitionActions message={workspace.error} />
          <button onClick={() => workspace.setError('')}>Dismiss</button>
        </div>
      )}
      {workspace.dialog?.kind === 'search' ? (
        <ProjectSearch />
      ) : workspace.dialog?.kind === 'saveIssue' ? (
        <ProjectSaveIssue boardId={workspace.dialog.boardId} />
      ) : workspace.dialog?.kind === 'settings' ? (
        <ProjectSettings />
      ) : workspace.dialog?.kind === 'recents' ? (
        <RecentProjects />
      ) : (
        workspace.dialog && (
          <ProjectForm
            key={`${workspace.dialog.kind}:${workspace.dialog.boardId}`}
            action={workspace.dialog}
          />
        )
      )}
    </>
  );
}
