import { useRef, useState, type KeyboardEvent } from 'react';
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
import Icon from './Icon';
import './ProjectNavigation.css';

export function ProjectMenu({
  onAction = () => {},
}: {
  onAction?: () => void;
}) {
  const workspace = useProjectWorkspace();
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
              void standalone();
              onAction();
            }}
          >
            Close Project
          </button>
        </>
      )}
    </div>
  );
}

function ProjectForm({
  action,
}: {
  action: Exclude<ProjectDialog, { kind: 'settings' }>;
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
          Remove <strong>{board?.name}</strong> from the board list and close
          its tab? Unsaved work will be resolved first.
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

export default function ProjectNavigation() {
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
  const tabs = useRef<HTMLDivElement>(null);
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
            tabs.current?.querySelector<HTMLElement>(
              '[aria-selected="true"]',
            ) ?? toggle.current
          )?.focus(),
        );
      return closed;
    });
  };
  const members =
    project?.manifest.boards.filter((b) =>
      b.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
    ) ?? [];
  return (
    <>
      {project && (
        <div className="project-navigation" data-session-navigation>
          {!registry.activeKey && (
            <div className="project-empty-identity document-switcher">
              <details>
                <summary aria-label="Project menu">
                  <Icon name="bars" />
                </summary>
                <div className="project-empty-menu">
                  <ProjectMenu />
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
              <button
                ref={toggle}
                aria-expanded={drawer}
                aria-controls="project-drawer"
                onClick={() => setDrawer(!drawer)}
              >
                {project.manifest.name}
                <Icon name="chevron-right" />
              </button>
            </div>
          )}
          {registry.sessions.length > 0 && (
            <div
              ref={tabs}
              role="tablist"
              tabIndex={-1}
              aria-label="Open project boards"
              className="project-tabs"
              onKeyDown={(e) =>
                moveFocus(
                  e,
                  [
                    ...tabs.current!.querySelectorAll<HTMLElement>(
                      '[role="tab"]',
                    ),
                  ].filter(
                    (tab) =>
                      getComputedStyle(tab.parentElement!).display !== 'none',
                  ),
                  'ArrowLeft',
                  'ArrowRight',
                )
              }
            >
              {registry.sessions.map((session) => {
                const member = project.manifest.boards.find(
                  (b) => b.id === session.project?.boardId,
                );
                if (!member) return null;
                const active = session.key === registry.activeKey;
                const status = registry.statuses[session.key] ?? 'Saved';
                return (
                  <div
                    key={session.key}
                    className="project-tab"
                    data-active={active}
                  >
                    <button
                      role="tab"
                      id={`tab-${member.id}`}
                      aria-selected={active}
                      aria-controls={`board-${member.id}`}
                      aria-label={`${member.name}, ${member.path}, ${status}`}
                      title={`${member.name} — ${member.path} — ${status}`}
                      tabIndex={active ? 0 : -1}
                      disabled={busy}
                      onClick={() => registry.activate(session.key)}
                    >
                      {member.name}
                      {status !== 'Saved' && (
                        <span className="project-tab-state"> · {status}</span>
                      )}
                    </button>
                    <button
                      aria-label={`Close ${member.name} tab`}
                      title={`Close ${member.name} tab`}
                      disabled={busy}
                      onClick={() => close(session.key)}
                    >
                      <Icon name="xmark" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <button className="project-overflow" onClick={workspace.quickSwitch}>
            Open boards ({registry.sessions.length})
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
                  const index = project.manifest.boards.indexOf(member);
                  return (
                    <li
                      key={member.id}
                      data-active={sessionKey === registry.activeKey}
                    >
                      <div className="project-board-row">
                        <button
                          className="project-board-open"
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
                        <details name="project-board-actions">
                          <summary
                            aria-label={`Actions for ${member.name}`}
                            title={`Actions for ${member.name}`}
                          >
                            <Icon name="sliders" />
                          </summary>
                          <div className="project-board-actions">
                            <button
                              disabled={busy}
                              onClick={() =>
                                workspace.setDialog({
                                  kind: 'renameBoard',
                                  boardId: member.id,
                                })
                              }
                            >
                              Rename…
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                workspace.setDialog({
                                  kind: 'duplicateBoard',
                                  boardId: member.id,
                                })
                              }
                            >
                              Duplicate…
                            </button>
                            <button
                              disabled={busy || index === 0}
                              onClick={() => {
                                void workspace.reorder(member.id, -1);
                              }}
                            >
                              Move up
                            </button>
                            <button
                              disabled={
                                busy ||
                                index === project.manifest.boards.length - 1
                              }
                              onClick={() => {
                                void workspace.reorder(member.id, 1);
                              }}
                            >
                              Move down
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                workspace.setDialog({
                                  kind: 'removeBoard',
                                  boardId: member.id,
                                })
                              }
                            >
                              Remove from Project…
                            </button>
                          </div>
                        </details>
                      </div>
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
          <button onClick={() => workspace.setError('')}>Dismiss</button>
        </div>
      )}
      {workspace.dialog?.kind === 'settings' ? (
        <ProjectSettings />
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
