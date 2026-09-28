import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import useProjectWorkspace from '../renderer/hooks/useProjectWorkspace';
import BoardSearch from '../renderer/components/BoardSearch';
import ProjectObjectLink from '../renderer/components/ProjectObjectLink';
import { Workspace } from '../renderer/App';
import useDocumentSessions, {
  DocumentSessions,
} from '../renderer/hooks/useDocumentSessions';
import { createRecursiveDocument } from '../shared/recursiveDocument';
import {
  projectFilename,
  type ProjectAction,
  type ProjectSnapshot,
  type ProjectManifest,
} from '../shared/projectContract';
import type RecursiveCanvas from '../renderer/components/RecursiveCanvas';
import { recursiveFixture } from './recursiveFixtures';
import { editObject } from '../shared/documentTransactions';

jest.mock('../renderer/components/RecursiveCanvas', () => ({
  __esModule: true,
  default: MockCanvas,
}));
let mockWorkspace: NonNullable<ReturnType<typeof useProjectWorkspace>>;
function MockCanvas(props: React.ComponentProps<typeof RecursiveCanvas>) {
  mockWorkspace = useProjectWorkspace()!;
  const selected = props.canvas.selected[0];
  return props.active ? (
    <>
      <canvas data-testid="drawing-surface" />
      <BoardSearch />
      {selected?.startsWith('object-') && (
        <ProjectObjectLink
          object={props.document.objects[selected.slice(7)]}
          onEdit={props.onEdit}
          isBusy={props.isBusy}
        />
      )}
    </>
  ) : null;
}
let registry: ReturnType<typeof useDocumentSessions>;
function Capture() {
  registry = useDocumentSessions();
  return <Workspace />;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let project: ProjectSnapshot;
let documents: Record<string, ReturnType<typeof createRecursiveDocument>>;
const noop = () => () => {};
const key = (id: string) =>
  registry.snapshot().sessions.find((s) => s.project?.boardId === id)?.key ??
  `${project.sessionId}:${id}`;
const controller = (id: string) => registry.controllers.get(key(id))!;
const response = () => ({
  status: 'success' as const,
  project: clone(project),
});
const read = (id: string) => ({
  status: 'success' as const,
  board: {
    document: clone(documents[id]),
    fingerprint: id,
    source: project.location
      ? {
          id,
          path: `/project/${project.manifest.boards.find((b) => b.id === id)!.path}`,
          fingerprint: id,
        }
      : null,
  },
});
beforeEach(() => {
  localStorage.clear();
  documents = {};
  for (const id of ['a', 'b', 'c'])
    documents[id] = {
      ...recursiveFixture(),
      id,
      metadata: {
        ...recursiveFixture().metadata,
        title: id === 'a' ? 'Overview' : 'Same name',
      },
    };
  project = {
    sessionId: 'project-session',
    workspaceKey: 'project-location',
    fingerprint: 'manifest',
    location: '/project/project.depthproject',
    diagnostics: [],
    manifest: {
      projectVersion: 1,
      id: 'project',
      name: 'Architecture',
      description: '',
      autosave: true,
      homeBoardId: 'a',
      boards: Object.values(documents).map((d) => ({
        id: d.id,
        name: d.metadata.title,
        path: `${d.id}.depthplan`,
      })),
    },
  };
  window.desktop = {
    getAppInstanceId: async () => 'app',
    quit: jest.fn().mockResolvedValue(undefined),
    events: { on: noop },
    transitions: {
      onRequest: jest.fn().mockReturnValue(() => {}),
      keepAlive: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn(),
      confirm: jest.fn().mockResolvedValue('cancel'),
    },
    recovery: {
      discover: async () => ({ entries: [], warnings: [] }),
      write: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
    automation: { onRequest: noop, status: async () => ({ enabled: false }) },
    fileSystem: {
      onOpenRequested: noop,
      saveDocument: jest.fn().mockResolvedValue({
        status: 'success',
        source: { id: 'copy', path: '/copy.depthplan', fingerprint: 'copy' },
      }),
      openDocument: jest.fn().mockResolvedValue({ status: 'canceled' }),
    },
    projects: {
      recents: jest.fn().mockResolvedValue({ status: 'success', entries: [] }),
      openRecent: jest.fn(async () => response()),
      workspace: jest.fn().mockResolvedValue({ status: 'success', view: null }),
      remember: jest.fn().mockResolvedValue({ status: 'success', view: null }),
      open: jest.fn(async () => response()),
      close: jest.fn().mockResolvedValue({ status: 'success' }),
      inspect: jest.fn(async () => response()),
      new: jest.fn(
        async (document = createRecursiveDocument('new', 'Untitled Board')) => {
          project.location = null;
          project.sessionId = 'new-project-session';
          project.manifest = {
            ...project.manifest,
            id: 'new-project',
            name: 'Untitled Project',
            homeBoardId: document.id,
            boards: [
              {
                id: document.id,
                name: document.metadata.title,
                path: projectFilename(document.metadata.title, []),
              },
            ],
          };
          documents = { [document.id]: clone(document) };
          return response();
        },
      ),
      save: jest.fn(
        async (
          _session: string,
          _expected: string,
          manifest: ProjectManifest,
          snapshots: (typeof documents.a)[] = [],
        ) => {
          project.manifest = clone(manifest);
          project.location = '/project/saved.depthproject';
          for (const document of snapshots)
            documents[document.id] = clone(document);
          for (const board of manifest.boards)
            documents[board.id].metadata.title = board.name;
          return response();
        },
      ),
      readBoard: jest.fn(async (_session: string, id: string) => read(id)),
      writeBoard: jest.fn(
        async (
          _session: string,
          id: string,
          _expected: string,
          document: typeof documents.a,
        ) => {
          documents[id] = clone(document);
          return { status: 'success', source: read(id).board.source };
        },
      ),
      apply: jest.fn(
        async (_session: string, _expected: string, action: ProjectAction) => {
          const members = project.manifest.boards;
          if (action.kind === 'settings') {
            const { kind: _kind, ...settings } = action;
            Object.assign(project.manifest, settings);
          }
          if (action.kind === 'removeBoard') {
            project.manifest.boards = members.filter(
              (b) => b.id !== action.boardId,
            );
            if (project.manifest.homeBoardId === action.boardId)
              project.manifest.homeBoardId = null;
          }
          if (action.kind === 'renameBoard') {
            Object.assign(
              members.find((b) => b.id === action.boardId)!,
              { name: action.name, path: action.path },
            );
            documents[action.boardId].metadata.title = action.name;
          }
          if (action.kind === 'reorderBoards')
            project.manifest.boards = action.ids.map((id) =>
              members.find((b) => b.id === id)!,
            );
          if (
            action.kind === 'createBoard' ||
            action.kind === 'duplicateBoard'
          ) {
            const id = `created-${members.length}`;
            documents[id] =
              action.kind === 'duplicateBoard'
                ? {
                    ...clone(action.document ?? documents[action.boardId]),
                    id,
                  }
                : createRecursiveDocument(id, action.name);
            documents[id].metadata.title = action.name;
            members.push({ id, name: action.name, path: action.path });
          }
          return response();
        },
      ),
    },
  } as unknown as typeof window.desktop;
});
async function setup() {
  render(
    <DocumentSessions>
      <Capture />
    </DocumentSessions>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open Project…' }));
  });
}
async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}
function drawer() {
  if (!screen.queryByRole('complementary', { name: 'Project boards' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Toggle project boards' }),
    );
  return screen.getByRole('complementary', { name: 'Project boards' });
}
async function action(id: string, label: string) {
  const board = project.manifest.boards.find((b) => b.id === id)!;
  fireEvent.contextMenu(
    within(drawer()).getByRole('button', {
      name: `Open ${board.name}, ${board.path}`,
    }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: label }));
  });
}

test('loads only selected boards, supports keyboard navigation, preserves dirty/history state and keeps membership when boards close', async () => {
  project.manifest.autosave = false;
  await setup();
  expect(window.desktop.projects.readBoard).toHaveBeenCalledTimes(1);
  expect(registry.sessions).toHaveLength(1);
  drawer();
  await click('Open Same name, b.depthplan');
  act(() =>
    controller('b').owner.transact(editObject('api', { name: 'Accepted B' })),
  );
  await click('Open Same name, c.depthplan');
  expect(screen.getAllByTestId('drawing-surface')).toHaveLength(1);
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  const boards = [
    ...drawer().querySelectorAll<HTMLButtonElement>('.project-board-open'),
  ];
  boards[2].focus();
  fireEvent.keyDown(boards[2], { key: 'Home' });
  expect(boards[0]).toHaveFocus();
  expect(registry.activeKey).toBe(key('c'));
  fireEvent.keyDown(boards[0], { key: 'ArrowDown' });
  expect(boards[1]).toHaveFocus();
  await click('Open Same name, b.depthplan');
  expect(controller('b').owner.document!.objects.api.name).toBe('Accepted B');
  expect(controller('b').owner.canUndo).toBe(true);
  await action('b', 'Close board');
  expect(documents.b.objects.api.name).toBe('Accepted B');
  expect(registry.controllers.has(key('b'))).toBe(false);
  expect(window.desktop.transitions.confirm).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('dialog', { name: 'Review open boards' }),
  ).not.toBeInTheDocument();
  expect(registry.activeKey).toBe(key('c'));
  expect(project.manifest.boards).toHaveLength(3);
  expect(window.desktop.projects.apply).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: 'Find a board' })).toBeNull();
  expect(drawer().querySelectorAll('.project-board-open')).toHaveLength(3);
  fireEvent.keyDown(boards[0], { key: 'End' });
  expect(boards[2]).toHaveFocus();
  fireEvent.keyDown(boards[2], { key: 'Escape' });
  expect(
    screen.queryByRole('complementary', { name: 'Project boards' }),
  ).toBeNull();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Toggle project boards' }),
    ).toHaveFocus(),
  );
});

async function editInline(
  scope: HTMLElement,
  label: string,
  value: string,
  key = 'Enter',
) {
  const button = within(scope).getByRole('button', {
    name: `Edit ${label.toLowerCase()}`,
  });
  fireEvent.doubleClick(button);
  const input = within(scope).getByRole('textbox', { name: label });
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    if (key === 'Tab') fireEvent.blur(input);
    else fireEvent.keyDown(input, { key });
  });
}

test('project title edits inline; Enter and blur persist while Escape cancels, with no settings dialog', async () => {
  await setup();
  const panel = drawer();
  await editInline(panel, 'Project name', 'Canceled', 'Escape');
  expect(project.manifest.name).toBe('Architecture');
  expect(
    within(panel).getByRole('button', { name: 'Edit project name' }),
  ).toHaveFocus();
  await editInline(panel, 'Project name', 'Inline Project');
  expect(project.manifest.name).toBe('Inline Project');
  expect(
    within(panel).getByRole('button', { name: 'Edit project name' }),
  ).toHaveFocus();
  await editInline(panel, 'Project name', 'Tab Project', 'Tab');
  expect(project.manifest.name).toBe('Tab Project');
  await editInline(panel, 'Project name', '../bad');
  expect(project.manifest.name).toBe('Tab Project');
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a project name');
  fireEvent.keyDown(
    within(panel).getByRole('textbox', { name: 'Project name' }),
    { key: 'Escape' },
  );
  expect(panel).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await click('Menu');
  expect(
    screen.queryByRole('button', { name: 'Project Settings…' }),
  ).not.toBeInTheDocument();
});

test('rename saves the exact board and retains undo; duplicate copies current content; failed removal leaves the session intact', async () => {
  project.manifest.autosave = false;
  await setup();
  const sessionId = controller('a').owner.sessionId;
  act(() =>
    controller('a').owner.transact(
      editObject('api', { name: 'Preserved edit' }),
    ),
  );
  await action('a', 'Rename');
  fireEvent.change(screen.getByLabelText('Board name'), {
    target: { value: '設計 API' },
  });
  await act(async () => {
    fireEvent.keyDown(screen.getByLabelText('Board name'), { key: 'Enter' });
  });
  expect(window.desktop.projects.writeBoard).toHaveBeenCalledWith(
    'project-session',
    'a',
    'a',
    expect.objectContaining({ id: 'a' }),
  );
  expect(controller('a').owner.sessionId).toBe(sessionId);
  expect(controller('a').owner.canUndo).toBe(true);
  expect(controller('a').owner.document!.metadata.title).toBe('設計 API');
  act(() => controller('a').owner.undo());
  expect(controller('a').owner.document!.metadata.title).toBe('設計 API');
  act(() =>
    controller('a').owner.transact(
      editObject('api', { name: 'Unsaved copy content' }),
    ),
  );
  await action('a', 'Duplicate…');
  await click('Duplicate board');
  expect(documents['created-3'].objects.api.name).toBe('Unsaved copy content');
  expect(documents['created-3'].id).not.toBe('a');
  expect(controller('a').owner.dirty).toBe(true);
  await click('Open 設計 API, api.depthplan');
  jest
    .mocked(window.desktop.projects.apply)
    .mockResolvedValueOnce({ status: 'error', error: 'Manifest changed' });
  jest.mocked(window.desktop.transitions.confirm).mockResolvedValue('discard');
  await action('a', 'Remove from Project…');
  await click('Remove board');
  expect(screen.getByRole('alert')).toHaveTextContent('Manifest changed');
  expect(controller('a').owner.document!.objects.api.name).toBe(
    'Unsaved copy content',
  );
  expect(controller('a').owner.dirty).toBe(false);
  expect(documents.a.objects.api.name).toBe('Unsaved copy content');
  expect(window.desktop.recovery.remove).not.toHaveBeenCalledWith(
    sessionId,
    undefined,
  );
});

test.each([null, '/project/project.depthproject'])(
  'board-name edits retain their own filename and respect other boards (location: %s)',
  async (location) => {
    project.location = location;
    for (const [index, path] of [
      'api_details.depthplan',
      'api_details_2.depthplan',
    ].entries()) {
      const board = project.manifest.boards[index];
      board.name = 'API Details';
      board.path = path;
      documents[board.id].metadata.title = board.name;
    }
    await setup();
    for (const [id, name, path] of [
      ['a', 'API details', 'api_details.depthplan'],
      ['b', 'API DETAILS', 'api_details_2.depthplan'],
    ]) {
      await action(id, 'Rename');
      fireEvent.change(screen.getByLabelText('Board name'), {
        target: { value: name },
      });
      await act(async () => {
        fireEvent.keyDown(screen.getByLabelText('Board name'), {
          key: 'Enter',
        });
      });
      expect(project.manifest.boards.find((board) => board.id === id)).toEqual({
        id,
        name,
        path,
      });
      expect(documents[id].metadata.title).toBe(name);
    }
  },
);

test('canceled project/standalone replacement retains all sessions; Save Copy preserves membership and unsaved state', async () => {
  project.manifest.autosave = false;
  await setup();
  drawer();
  await click('Open Same name, b.depthplan');
  act(() =>
    controller('a').owner.transact(editObject('api', { name: 'Unsaved A' })),
  );
  act(() =>
    controller('b').owner.transact(editObject('api', { name: 'Unsaved B' })),
  );
  const before = registry.sessions;
  jest
    .mocked(window.desktop.projects.writeBoard)
    .mockResolvedValue({ status: 'error', error: 'Disk unavailable' });
  await click('Menu');
  await click('Close All');
  expect(registry.sessions).toBe(before);
  expect(registry.activeKey).toBe(key('b'));
  expect(window.desktop.projects.close).not.toHaveBeenCalled();
  await act(async () => {
    await controller('b').files.save(true);
  });
  expect(controller('b').owner.dirty).toBe(true);
  expect(controller('b').owner.source!.path).toBe('/project/b.depthplan');
  expect(
    jest.mocked(window.desktop.fileSystem.saveDocument).mock.calls.at(-1)![0]
      .id,
  ).not.toBe('b');
  await click('Menu');
  await click('Open Board…');
  await click('Standalone');
  expect(registry.sessions).toBe(before);
});

test('closing every board leaves an empty project with create/import actions and safe filenames', async () => {
  await setup();
  await action('a', 'Close board');
  expect(screen.queryByTestId('drawing-surface')).not.toBeInTheDocument();
  expect(screen.getByText('Choose a board to begin.')).toBeVisible();
  const emptyMenu = screen.getByLabelText('Project menu').closest('details')!;
  act(() => {
    emptyMenu.open = true;
  });
  const quit = screen.getByRole('button', { name: 'Quit DepthPlan' });
  expect(quit.parentElement!.lastElementChild).toBe(quit);
  expect(quit.previousElementSibling).toHaveClass('dropdown-separator');
  await click('Quit DepthPlan');
  expect(window.desktop.quit).toHaveBeenCalledTimes(1);
  expect(emptyMenu.open).toBe(false);
  expect(project.manifest.boards).toHaveLength(3);
  expect(projectFilename('CON', [])).toBe('board_con.depthplan');
  expect(
    projectFilename('設計', ['Board.depthplan', 'board_2.depthplan']),
  ).toBe('board_3.depthplan');
  expect(projectFilename('API', ['api.depthplan'])).toBe('api_2.depthplan');
  await click('Close board drawer');
  await click('Open a board');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Open Overview, a.depthplan' }),
    ).toHaveFocus(),
  );
  await searchProject('api');
  expect(
    screen.getByRole('dialog', { name: 'Search Project' }),
  ).toHaveTextContent('3 of 3 boards searched');
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Search Project' })).getByRole(
      'button',
      { name: 'Close' },
    ),
  );
  act(() => {
    screen.getByLabelText('Project menu').closest('details')!.open = true;
  });
  expect(screen.getByRole('button', { name: 'Save Board As…' })).toBeDisabled();
  await click('Save Project As…');
  expect(window.desktop.fileSystem.saveDocument).not.toHaveBeenCalled();
  act(() => {
    screen.getByLabelText('Project menu').closest('details')!.open = true;
  });
  await click('Open Board…');
  expect(screen.getByRole('dialog', { name: 'Open Board' })).toBeVisible();
});

test('autosaves accepted edits even in legacy manual projects and inactive boards without moving their target or undo history', async () => {
  jest.useFakeTimers();
  try {
    project.manifest.autosave = false;
    await setup();
    act(() =>
      controller('a').owner.transact(
        editObject('api', { name: 'Autosaved A' }),
      ),
    );
    drawer();
    await click('Open Same name, b.depthplan');
    act(() =>
      controller('b').owner.transact(
        editObject('api', { name: 'Autosaved B' }),
      ),
    );
    await act(() => jest.advanceTimersByTimeAsync(1000));
    expect(registry.activeKey).toBe(key('b'));
    expect(documents.a.objects.api.name).toBe('Autosaved A');
    expect(documents.b.objects.api.name).toBe('Autosaved B');
    expect(document.querySelector('.workspace-notice')).toBeNull();
    expect(controller('a').owner.dirty).toBe(false);
    expect(controller('b').owner.dirty).toBe(false);
    expect(controller('a').owner.canUndo).toBe(true);
    expect(controller('b').owner.canUndo).toBe(true);
    expect(window.desktop.projects.readBoard).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test('failed multi-board flush keeps all sessions without a review dialog and Save All retries accepted work', async () => {
  await setup();
  drawer();
  await click('Open Same name, b.depthplan');
  act(() => {
    controller('a').owner.transact(editObject('api', { name: 'Keep A' }));
    controller('b').owner.transact(editObject('api', { name: 'Keep B' }));
  });
  const sessions = registry.sessions;
  const save = jest
    .mocked(window.desktop.projects.writeBoard)
    .getMockImplementation()!;
  jest
    .mocked(window.desktop.projects.writeBoard)
    .mockRejectedValue(new Error('Disk unavailable'));
  await click('Menu');
  await click('Close All');
  expect(
    screen.queryByRole('dialog', { name: 'Review open boards' }),
  ).not.toBeInTheDocument();
  expect(window.desktop.projects.close).not.toHaveBeenCalled();
  expect(window.desktop.transitions.confirm).not.toHaveBeenCalled();
  expect(controller('a').files.failure?.message).toBe('Disk unavailable');
  expect(registry.sessions).toBe(sessions);
  expect(controller('a').owner.document!.objects.api.name).toBe('Keep A');
  expect(controller('b').owner.document!.objects.api.name).toBe('Keep B');
  expect(window.desktop.recovery.remove).not.toHaveBeenCalledWith(
    controller('a').owner.sessionId,
    undefined,
  );
  jest.mocked(window.desktop.projects.writeBoard).mockImplementation(save);
  await click('Menu');
  await click('Save All');
  expect(controller('a').owner.dirty).toBe(false);
  expect(controller('b').owner.dirty).toBe(false);
  expect(controller('a').files.failure).toBeNull();
  expect(controller('b').files.failure).toBeNull();
  expect(controller('a').owner.canUndo).toBe(true);
});

test('reloading a repathed manifest guards dirty boards and keeps unaffected sessions and history', async () => {
  project.manifest.autosave = false;
  await setup();
  act(() =>
    controller('a').owner.transact(
      editObject('api', { name: 'Preserve before repath' }),
    ),
  );
  drawer();
  await click('Open Same name, b.depthplan');
  const aBefore = controller('a').owner.snapshot();
  const bBefore = controller('b').owner.snapshot();
  const changed = clone(project);
  changed.manifest.boards[0].path = 'repathed.depthplan';
  window.desktop.projects.definition = jest.fn().mockResolvedValue({
    status: 'success',
    manifest: changed.manifest,
    fingerprint: 'external',
  });
  window.desktop.projects.resolveDefinition = jest.fn(async () => {
    project = changed;
    return response();
  });
  jest
    .mocked(window.desktop.projects.apply)
    .mockResolvedValue({ status: 'error', error: 'Project manifest changed' });
  await editInline(drawer(), 'Project name', 'New name');
  jest.mocked(window.desktop.projects.writeBoard).mockResolvedValueOnce({
    status: 'error',
    error: 'Project manifest changed',
  });
  await click('Reload project definition…');
  expect(controller('a').owner.snapshot()).toEqual(aBefore);
  expect(window.desktop.projects.resolveDefinition).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Project name' }), {
    key: 'Escape',
  });
  await editInline(drawer(), 'Project name', 'New name');
  await click('Reload project definition…');
  jest.mocked(window.desktop.transitions.confirm).mockResolvedValue('discard');
  expect(registry.controllers.has(key('a'))).toBe(false);
  expect(controller('b').owner.snapshot()).toEqual(bBefore);
  expect(project.manifest.boards[0].path).toBe('repathed.depthplan');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a broken home board falls back without dropping its row, and a failed new project preserves accepted work', async () => {
  project.diagnostics = [
    {
      boardId: 'a',
      path: 'a.depthplan',
      error: 'Missing board. Restore the expected file or remove membership.',
    },
  ];
  jest
    .mocked(window.desktop.projects.readBoard)
    .mockResolvedValueOnce({ status: 'error', error: 'Missing board' });
  await setup();
  expect(registry.activeKey).toBe(key('b'));
  drawer();
  expect(within(drawer()).getByText(/Missing board/)).toBeVisible();
  act(() =>
    controller('b').owner.transact(
      editObject('api', { name: 'Preserve through canceled copy' }),
    ),
  );
  const before = controller('b').owner.snapshot();
  jest
    .mocked(window.desktop.projects.new)
    .mockResolvedValueOnce({ status: 'canceled' });
  await click('Menu');
  await click('New Project');
  expect(window.desktop.projects.new).toHaveBeenCalled();
  expect(controller('b').owner.snapshot().document).toEqual(before.document);
  expect(controller('b').owner.snapshot().canUndo).toEqual(before.canUndo);
  expect(window.desktop.transitions.confirm).not.toHaveBeenCalled();
  expect(window.desktop.projects.close).not.toHaveBeenCalled();
});

test('restores local tabs/order, active board and cameras without source writes; an intentionally empty workspace stays empty', async () => {
  const view = {
    tabs: ['c', 'b'].map((boardId, i) => ({
      boardId,
      camera: { x: i * 30, y: -12, scale: 2 },
    })),
    active: 'c',
    drawer: true,
    window: null,
  };
  jest
    .mocked(window.desktop.projects.workspace)
    .mockResolvedValue({ status: 'success', view });
  const original = clone(documents);
  await setup();
  expect(registry.sessions.map((session) => session.project?.boardId)).toEqual([
    'c',
    'b',
  ]);
  expect(registry.activeKey).toBe(key('c'));
  expect(controller('b').owner.camera).toEqual({ x: 30, y: -12, scale: 2 });
  expect(controller('b').owner.dirty).toBe(false);
  act(() => controller('c').owner.setCamera({ x: 50, y: 40, scale: 1.5 }));
  await waitFor(() =>
    expect(window.desktop.projects.remember).toHaveBeenCalledWith(
      'project-session',
      expect.objectContaining({
        active: 'c',
        tabs: [
          { boardId: 'c', camera: { x: 50, y: 40, scale: 1.5 } },
          { boardId: 'b', camera: { x: 30, y: -12, scale: 2 } },
        ],
      }),
    ),
  );
  await click('Menu');
  await click('Close All');
  jest.mocked(window.desktop.projects.workspace).mockResolvedValue({
    status: 'success',
    view: { ...view, tabs: [], active: null },
  });
  await click('Menu');
  await click('Open Project…');
  expect(registry.sessions).toHaveLength(0);
  expect(screen.getByText('Choose a board to begin.')).toBeInTheDocument();
  expect(window.desktop.projects.writeBoard).not.toHaveBeenCalled();
  expect(documents).toEqual(original);
});

test('skips removed local tabs and falls back to home; reopening the same native session preserves live work', async () => {
  jest.mocked(window.desktop.projects.workspace).mockResolvedValue({
    status: 'success',
    view: {
      tabs: [{ boardId: 'removed', camera: { x: 0, y: 0, scale: 1 } }],
      active: 'removed',
      drawer: false,
      window: null,
    },
  });
  await setup();
  const owner = controller('a').owner.sessionId;
  act(() =>
    controller('a').owner.transact(editObject('api', { name: 'Keep local' })),
  );
  await click('Menu');
  await click('Open Project…');
  expect(controller('a').owner.sessionId).toBe(owner);
  expect(controller('a').owner.document!.objects.api.name).toBe('Keep local');
  expect(window.desktop.projects.close).not.toHaveBeenCalled();
});

test('routes MCP edits, delayed saves and receipts to explicit owners across same-name tabs and closed sessions', async () => {
  project.manifest.autosave = false;
  let request!: (value: unknown) => unknown;
  window.desktop.automation = {
    ...window.desktop.automation,
    status: async () => ({ enabled: true, descriptor: '', executable: '' }),
    onRequest: (listener) => {
      request = listener;
      return () => {};
    },
  };
  const lease = { id: 'lease', generation: 1 };
  window.desktop.mcpFiles = {
    onRevoked: noop,
    lease: jest.fn().mockResolvedValue(lease),
    check: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    inspect: jest.fn().mockResolvedValue({
      path: '/project/b.depthplan',
      fingerprint: 'external',
    }),
  } as unknown as typeof window.desktop.mcpFiles;
  const call = async (tool: string, input = {}) => {
    let result: any;
    await act(async () => {
      result = await request({ tool, input });
    });
    return result;
  };
  await setup();
  const discovery = (await call('depthplan_get_project')).data.project;
  expect(discovery.boards.map((b: any) => b.id)).toEqual(['a', 'b', 'c']);
  const opened = await call('depthplan_open_board', {
    handle: discovery.handle,
    boardId: 'b',
    requestId: 'open-b',
  });
  expect(opened.ok).toBe(true);
  const b = opened.data.handle;
  await call('depthplan_open_board', {
    handle: discovery.handle,
    boardId: 'c',
    requestId: 'open-c',
  });
  expect(registry.activeKey).toBe(key('c'));
  const state = (await call('depthplan_get_state', { handle: b })).data;
  const edit = {
    handle: b,
    expectedRevision: state.revision,
    expectedViewRevision: state.viewRevision,
    requestId: 'edit-b',
    actions: [{ type: 'edit_object', id: 'api', name: 'B only' }],
  };
  expect((await call('depthplan_edit', edit)).ok).toBe(true);
  expect(controller('b').owner.document!.objects.api.name).toBe('B only');
  expect(controller('c').owner.document!.objects.api.name).not.toBe('B only');
  const next = (await call('depthplan_get_state', { handle: b })).data;
  const input = {
    handle: b,
    expectedRevision: next.revision,
    expectedViewRevision: next.viewRevision,
    requestId: 'save-b',
    action: { type: 'save' },
  };
  const started = await call('depthplan_files', input);
  const operationId = started.data.operationId;
  await waitFor(() =>
    expect(controller('b').work?.activeOperation?.status).toBe(
      'needs-decision',
    ),
  );
  await act(async () => {
    registry.activate(key('a'));
  });
  const receipt = await call('depthplan_get_operation', {
    appInstanceId: 'app',
    operationId,
  });
  expect(receipt.data.target.sessionId).toBe(b.sessionId);
  expect((await call('depthplan_files', input)).data).toMatchObject({
    operationId,
    replayed: true,
  });
  expect(window.desktop.projects.writeBoard).not.toHaveBeenCalled();
  const current = (await call('depthplan_get_state', { handle: b })).data;
  expect(
    (
      await call('depthplan_decide', {
        handle: b,
        operationId,
        decisionId: receipt.data.decision.id,
        expectedRevision: current.revision,
        expectedViewRevision: current.viewRevision,
        requestId: 'overwrite-b',
        choice: 'overwrite',
      })
    ).ok,
  ).toBe(true);
  await waitFor(() => expect(controller('b').work?.activeOperation).toBeNull());
  expect(window.desktop.projects.writeBoard).toHaveBeenCalledWith(
    'project-session',
    'b',
    'external',
    expect.objectContaining({ id: 'b' }),
    false,
    lease,
  );
  expect(documents.b.objects.api.name).toBe('B only');
  expect(documents.c.objects.api.name).not.toBe('B only');
  await act(async () => {
    expect(await registry.close(key('b'))).toBe(true);
  });
  expect((await call('depthplan_get_state', { handle: b })).error.code).toBe(
    'STALE_SESSION',
  );
  expect(
    (
      await call('depthplan_get_operation', {
        appInstanceId: 'app',
        operationId,
      })
    ).data.status,
  ).toBe('completed');
  expect((await call('depthplan_edit', edit)).data.replayed).toBe(true);
  expect(window.desktop.projects.writeBoard).toHaveBeenCalledTimes(1);
  const reopened = await call('depthplan_open_board', {
    handle: discovery.handle,
    boardId: 'b',
    requestId: 'reopen-b',
  });
  expect(reopened.data.handle.sessionId).not.toBe(b.sessionId);
  expect(
    (await call('depthplan_edit', { ...edit, requestId: 'stale-edit' })).error
      .code,
  ).toBe('STALE_SESSION');
  const snapshot = controller('b').owner.snapshot();
  act(() => {
    const reply = controller('b').work!.start('export', {
      handle: reopened.data.handle,
      expectedRevision: snapshot.revision,
      expectedViewRevision: snapshot.viewRevision,
      requestId: 'block-export',
      path: '/copy.json',
      format: 'json',
    });
    expect(reply.ok).toBe(true);
    expect(registry.activate(key('a'))).toBe(false);
    controller('b').work!.cancelActive();
  });
  await waitFor(() => expect(controller('b').work?.active()).toBeNull());
});

test('empty projects retain local MCP controls and project/access discovery without a document owner', async () => {
  project.manifest.boards = [];
  project.manifest.homeBoardId = null;
  let request!: (input: unknown) => unknown;
  window.desktop.automation = {
    ...window.desktop.automation,
    onRequest: (listener) => {
      request = listener;
      return () => {};
    },
    enable: jest.fn(async (enabled) => ({
      enabled,
      descriptor: '/private/descriptor',
      executable: '/app/mcp',
    })),
  };
  window.desktop.mcpFiles = {
    onRevoked: noop,
    folders: jest.fn().mockResolvedValue([]),
  } as unknown as typeof window.desktop.mcpFiles;
  await setup();
  expect(registry.sessions).toHaveLength(0);
  act(() => {
    screen.getByLabelText('Project menu').closest('details')!.open = true;
  });
  await click('Settings');
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'MCP Server' }));
  await waitFor(() =>
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'MCP Server' }),
    ).toBeChecked(),
  );
  expect(
    await request({ tool: 'depthplan_get_project', input: {} }),
  ).toMatchObject({
    ok: true,
    data: { project: { id: project.manifest.id, boards: [], active: null } },
  });
  expect(
    await request({ tool: 'depthplan_get_access', input: {} }),
  ).toMatchObject({ ok: true, data: { folders: [] } });
});

async function searchProject(query: string) {
  if (!screen.queryByRole('dialog', { name: 'Search Project' })) {
    if (!screen.queryByRole('searchbox', { name: 'Search all boards' }))
      await click('Search boards');
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search all boards' }),
      {
        target: { value: query },
      },
    );
    await act(async () => {
      fireEvent.submit(screen.getByRole('search'));
    });
  } else {
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search content' }),
      {
        target: { value: query },
      },
    );
    fireEvent.submit(
      screen
        .getByRole('dialog', { name: 'Search Project' })
        .querySelector('form')!,
    );
  }
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Stop search' }),
    ).not.toBeInTheDocument(),
  );
}

test('project search uses accepted dirty owners and unopened hidden content, labels and bookmarks without mounting canvases or editing', async () => {
  project.manifest.autosave = false;
  documents.b.objects.endpoint.content = [
    { type: 'code', language: 'sql', text: 'needle query' },
  ];
  documents.c.objects.endpoint.content = [
    {
      type: 'paragraph',
      runs: [{ text: 'needle query', marks: { bold: true } }],
    },
  ];
  documents.b.connections.wire = {
    id: 'wire',
    ownerId: null,
    kind: 'line',
    z: 0,
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'free', x: 100, y: 100 },
    label: 'needle label',
  };
  documents.b.namedViews = {
    bookmark: {
      id: 'bookmark',
      name: 'needle bookmark',
      rootDepths: { app: 2, payments: 0 },
    },
  };
  await setup();
  act(() => {
    controller('a').owner.transact(
      editObject('api', { name: 'needle unsaved' }),
    );
  });
  const before = controller('a').owner.snapshot();
  await searchProject('needle');
  expect(
    screen.getByRole('dialog', { name: 'Search Project' }),
  ).toHaveTextContent('5 results · 3 of 3 boards searched');
  expect(controller('a').owner.snapshot()).toEqual(before);
  expect(registry.sessions).toHaveLength(1);
  expect(screen.getAllByTestId('drawing-surface')).toHaveLength(1);
  expect(window.desktop.projects.readBoard).toHaveBeenCalledTimes(3);
  const group = screen.getByRole('region', { name: 'Same name, b.depthplan' });
  expect(
    within(group).getByRole('button', { name: /Connection · needle label/ }),
  ).toBeInTheDocument();
  expect(
    within(group).getByRole('button', { name: /Bookmark · needle bookmark/ }),
  ).toBeInTheDocument();
  const target = within(group).getByRole('button', {
    name: /Object · endpoint/,
  });
  target.focus();
  expect(target).toHaveFocus();
  await act(async () => {
    fireEvent.click(target);
  });
  expect(registry.activeKey).toBe(key('b'));
  expect(controller('b').owner.snapshot().canvas.selected).toEqual([
    'object-endpoint',
  ]);
  expect(controller('b').owner.snapshot().document!.rootDepths.app).toBe(2);
  expect(controller('b').owner.snapshot().canUndo).toBe(true);
  expect(
    screen.queryByRole('dialog', { name: 'Search Project' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Same name' })).toHaveFocus();
  expect(controller('a').owner.snapshot()).toEqual(before);
});

test('project search rejects stale accepted revisions and changed unopened fingerprints without selecting another same-name result', async () => {
  project.manifest.autosave = false;
  await setup();
  await searchProject('endpoint');
  act(() => {
    controller('a').owner.transact(editObject('api', { name: 'later' }));
  });
  const a = screen.getByRole('region', { name: 'Overview, a.depthplan' });
  await act(async () => {
    fireEvent.click(within(a).getByRole('button'));
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Board changed since this search',
  );
  expect(controller('a').owner.snapshot().canvas.selected).toEqual([]);
  (window.desktop.projects.readBoard as jest.Mock).mockImplementation(
    async (_session, id) => {
      const value = read(id);
      value.board.source!.fingerprint = 'changed';
      value.board.fingerprint = 'changed';
      return value;
    },
  );
  const b = screen.getByRole('region', { name: 'Same name, b.depthplan' });
  await act(async () => {
    fireEvent.click(within(b).getByRole('button'));
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Board changed since this search',
  );
  expect(registry.activeKey).toBe(key('a'));
  expect(controller('b').owner.snapshot().canvas.selected).toEqual([]);
});

test('project search reports missing boards/nonmatches and ignores a canceled pending read', async () => {
  await setup();
  (window.desktop.projects.readBoard as jest.Mock).mockImplementation(
    async (_session, id) =>
      id === 'b' ? { status: 'error', error: 'Board unavailable' } : read(id),
  );
  await searchProject('no matches');
  expect(
    screen.getByRole('dialog', { name: 'Search Project' }),
  ).toHaveTextContent('0 results · 3 of 3 boards searched. Partial results');
  expect(
    screen.getByRole('region', { name: 'Unreadable boards' }),
  ).toHaveTextContent('Board unavailable');
  let release!: (value: ReturnType<typeof read>) => void;
  (window.desktop.projects.readBoard as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search content' }), {
    target: { value: 'endpoint' },
  });
  fireEvent.submit(
    screen
      .getByRole('dialog', { name: 'Search Project' })
      .querySelector('form')!,
  );
  await waitFor(() => expect(release).toBeDefined());
  await click('Stop search');
  await act(async () => {
    release(read('b'));
  });
  expect(
    screen.getByRole('dialog', { name: 'Search Project' }),
  ).toHaveTextContent('Search stopped. These are partial results');
  expect(
    screen.queryByRole('region', { name: 'Same name, b.depthplan' }),
  ).not.toBeInTheDocument();
  expect(registry.sessions).toHaveLength(1);
});

test('project search activates connection and bookmark identities with existing navigation semantics', async () => {
  documents.b.connections.wire = {
    id: 'wire',
    ownerId: null,
    kind: 'line',
    z: 0,
    start: { kind: 'free', x: 0, y: 0 },
    end: { kind: 'free', x: 100, y: 100 },
    label: 'unique needle',
  };
  documents.b.namedViews = {
    bookmark: {
      id: 'bookmark',
      name: 'unique view',
      rootDepths: { app: 2, payments: 0 },
    },
  };
  project.manifest.autosave = false;
  await setup();
  await searchProject('unique needle');
  await click('Connection · unique needle unique needle wire');
  expect(controller('b').owner.snapshot().canvas.selected).toEqual([
    'connection-wire',
  ]);
  expect(controller('b').owner.snapshot().dirty).toBe(false);
  await searchProject('unique view');
  await click('Bookmark · unique view unique view bookmark');
  expect(controller('b').owner.snapshot().document!.rootDepths.app).toBe(2);
  expect(controller('b').owner.snapshot().canUndo).toBe(true);
});

test('project search caps results and stops reading further boards', async () => {
  for (let i = 0; i < 501; i++) {
    const id = `bounded-${String(i).padStart(3, '0')}`;
    documents.b.objects[id] = {
      ...clone(documents.b.objects.payments),
      id,
      name: id,
    };
    documents.b.rootDepths[id] = 0;
    documents.b.layouts[id] = { 0: { [id]: documents.b.objects[id].geometry } };
  }
  await setup();
  await searchProject('bounded');
  expect(
    screen.getByRole('dialog', { name: 'Search Project' }),
  ).toHaveTextContent('Stopped at 500 results');
  expect(
    screen
      .getByRole('region', { name: 'Same name, b.depthplan' })
      .querySelectorAll('button'),
  ).toHaveLength(500);
  expect(window.desktop.projects.readBoard).toHaveBeenCalledTimes(2);
  expect(registry.sessions).toHaveLength(1);
});

test('project links pick accepted bookmarks, remain stable through rename/reorder and return to the origin view', async () => {
  project.manifest.autosave = false;
  await setup();
  drawer();
  await click('Open Same name, b.depthplan');
  act(() => {
    controller('b').owner.changeNamedView({
      type: 'create',
      id: 'detail',
      name: 'Unsaved detail',
    });
  });
  await act(async () => {
    registry.activate(key('a'));
  });
  const originCamera = { x: 81, y: -12, scale: 1.25 };
  act(() => {
    controller('a').owner.setCamera(originCamera);
    controller('a').owner.setCanvas((canvas) => ({
      ...canvas,
      selected: ['object-app'],
    }));
  });
  await click('Add project link');
  expect(screen.getByRole('combobox', { name: 'Target board' })).toHaveFocus();
  expect(registry.canSwitch()).toBe(false);
  fireEvent.change(screen.getByRole('combobox', { name: 'Target board' }), {
    target: { value: 'b' },
  });
  await screen.findByRole('option', { name: 'Unsaved detail — detail' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Target bookmark' }), {
    target: { value: 'detail' },
  });
  await click('Save link');
  const reference = {
    projectId: 'project',
    boardId: 'b',
    bookmarkId: 'detail',
  };
  expect(
    controller('a').owner.snapshot().document!.objects.app.projectLink,
  ).toEqual(reference);
  await act(async () => {
    await mockWorkspace.apply({
      kind: 'settings',
      name: 'Renamed project',
      description: '',
      homeBoardId: 'a',
      autosave: false,
    });
    await mockWorkspace.apply({ kind: 'reorderBoards', ids: ['a', 'c', 'b'] });
  });
  await act(async () => {
    await mockWorkspace.apply({
      kind: 'renameBoard',
      boardId: 'b',
      name: 'Renamed detail',
      path: 'renamed.depthplan',
      expected: 'b',
    });
  });
  await click('Open project link');
  expect(registry.activeKey).toBe(key('b'));
  await act(async () => {
    await mockWorkspace.goBack();
  });
  expect(registry.activeKey).toBe(key('a'));
  expect(controller('a').owner.snapshot().camera).toEqual(originCamera);
  expect(controller('a').owner.snapshot().canvas.selected).toEqual([
    'object-app',
  ]);
  expect(
    controller('a').owner.snapshot().document!.objects.app.projectLink,
  ).toEqual(reference);
});

test('missing bookmarks and members never navigate elsewhere; link picker repairs or removes the reference', async () => {
  project.manifest.autosave = false;
  documents.a.objects.app.projectLink = {
    projectId: 'project',
    boardId: 'b',
    bookmarkId: 'missing',
  };
  await setup();
  act(() => {
    controller('a').owner.setCanvas((canvas) => ({
      ...canvas,
      selected: ['object-app'],
    }));
  });
  await click('Open project link');
  expect(registry.activeKey).toBe(key('a'));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Bookmark is no longer available',
  );
  await click('Change project link');
  await screen.findByRole('option', { name: 'Unavailable bookmark (missing)' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Target bookmark' }), {
    target: { value: '' },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save link' }),
    ).not.toBeDisabled(),
  );
  await click('Save link');
  await act(async () => {
    await mockWorkspace.apply({ kind: 'removeBoard', boardId: 'b' });
  });
  expect(
    screen.getByRole('button', { name: 'Open project link' }),
  ).toBeDisabled();
  expect(
    screen.getByText('Project link unavailable. Change its target.'),
  ).toBeInTheDocument();
  await click('Change project link');
  await click('Remove link');
  expect(
    controller('a').owner.snapshot().document!.objects.app.projectLink,
  ).toBeUndefined();
  expect(registry.activeKey).toBe(key('a'));
});

test('standalone/foreign links remain unresolved and a whole-folder copy resolves within its current session', async () => {
  project.manifest.autosave = false;
  documents.a.objects.app.projectLink = {
    projectId: 'foreign-project',
    boardId: 'b',
  };
  await setup();
  act(() => {
    controller('a').owner.setCanvas((canvas) => ({
      ...canvas,
      selected: ['object-app'],
    }));
  });
  expect(
    screen.getByRole('button', { name: 'Open project link' }),
  ).toBeDisabled();
  await click('Change project link');
  expect(
    screen.getByText(/reference belongs to another project/),
  ).toBeInTheDocument();
  await click('Cancel');
  act(() => {
    controller('a').owner.transact((draft) => {
      draft.objects.app.projectLink = { projectId: 'project', boardId: 'b' };
    });
  });
  project.location = '/copied/project.depthproject';
  project.workspaceKey = 'copied-location';
  act(() => {
    mockWorkspace.update(clone(project));
  });
  await click('Open project link');
  expect(registry.activeKey).toBe(key('b'));
  expect(window.desktop.projects.readBoard).toHaveBeenLastCalledWith(
    'project-session',
    'b',
    undefined,
  );
  await act(async () => {
    await mockWorkspace.goBack();
  });
  // A restored standalone document carries the reference but no project authority.
  const document = clone(controller('a').owner.snapshot().document!);
  await act(async () => {
    mockWorkspace.update(null);
    registry.install([{ key: 'standalone-linked', document, source: null }]);
  });
  const standalone = registry.controllers.get('standalone-linked')!;
  act(() => {
    standalone.owner.setCanvas((canvas) => ({
      ...canvas,
      selected: ['object-app'],
    }));
  });
  expect(
    screen.getByRole('button', { name: 'Open project link' }),
  ).toBeDisabled();
  await click('Change project link');
  expect(screen.getByText(/This board is open standalone/)).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Target board' })).toBeDisabled();
  await click('Remove link');
  expect(
    standalone.owner.snapshot().document!.objects.app.projectLink,
  ).toBeUndefined();
});

test('board actions use a keyboard-accessible context menu and the drawer always sorts naturally', async () => {
  project.manifest.boards[0].name = 'Board 10';
  project.manifest.boards[1].name = 'board 2';
  project.manifest.boards[2].name = 'Board 1';
  await setup();
  const list = drawer();
  expect(
    [...list.querySelectorAll<HTMLElement>('.project-board-open')].map(
      (b) => b.dataset.boardId,
    ),
  ).toEqual(['c', 'b', 'a']);
  expect(list.querySelector('summary')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Toggle project boards' }),
  ).not.toBeInTheDocument();
  expect(
    screen
      .getByRole('button', { name: 'Close board drawer' })
      .querySelector('use'),
  ).toHaveAttribute('href', '#icon-arrow-down-to-line');
  const board = screen.getByRole('button', {
    name: 'Open board 2, b.depthplan',
  });
  board.focus();
  fireEvent.keyDown(board, { key: 'F10', shiftKey: true });
  const rename = screen.getByRole('menuitem', { name: 'Rename' });
  expect(rename).toHaveFocus();
  expect(
    screen.queryByRole('menuitem', { name: /Move/ }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(rename, { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: 'Duplicate…' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(board).toHaveFocus();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  await action('a', 'Rename');
  fireEvent.change(screen.getByLabelText('Board name'), {
    target: { value: 'Board 0' },
  });
  await act(async () => {
    fireEvent.keyDown(screen.getByLabelText('Board name'), { key: 'Enter' });
  });
  expect(
    [...drawer().querySelectorAll<HTMLElement>('.project-board-open')].map(
      (b) => b.dataset.boardId,
    ),
  ).toEqual(['a', 'c', 'b']);
});

test('closing a project board protects unapplied drafts then saves the applied content without a document prompt', async () => {
  await setup();
  const input = screen.getByRole('textbox', {
    name: 'New bookmark name',
    hidden: true,
  });
  fireEvent.change(input, { target: { value: 'Keep my draft' } });
  await action('a', 'Close board');
  expect(registry.controllers.has(key('a'))).toBe(true);
  expect(window.desktop.transitions.confirm).toHaveBeenLastCalledWith(
    'draft',
    'bookmark name',
    true,
  );
  jest.mocked(window.desktop.transitions.confirm).mockResolvedValue('save');
  await action('a', 'Close board');
  expect(registry.controllers.has(key('a'))).toBe(false);
  expect(
    Object.values(documents.a.namedViews ?? {}).map((v) => v.name),
  ).toContain('Keep my draft');
  expect(
    jest
      .mocked(window.desktop.transitions.confirm)
      .mock.calls.every(([kind]) => kind === 'draft'),
  ).toBe(true);
});

test.each([
  null,
  { id: 'source', path: '/original.depthplan', fingerprint: 'original' },
])(
  'New Project wraps the current standalone board without saving and retains history (source: %s)',
  async (source) => {
    localStorage.setItem('depthplan.autosave', 'off');
    render(
      <DocumentSessions>
        <Capture />
      </DocumentSessions>,
    );
    const activeKey = registry.activeKey;
    const owner = registry.controllers.get(activeKey)!.owner;
    act(() => {
      owner.replace(recursiveFixture(), { source });
      owner.transact(editObject('api', { name: 'Accepted before wrapping' }));
      owner.setCamera({ x: 120, y: -40, scale: 1.4 });
      owner.setCanvas((canvas) => ({ ...canvas, selected: ['object-api'] }));
    });
    const before = owner.snapshot();
    await click('Menu');
    await click('New Project');
    expect(window.desktop.transitions.confirm).not.toHaveBeenCalled();
    expect(window.desktop.fileSystem.saveDocument).not.toHaveBeenCalled();
    expect(window.desktop.projects.save).not.toHaveBeenCalled();
    expect(window.desktop.projects.writeBoard).not.toHaveBeenCalled();
    expect(window.desktop.projects.new).toHaveBeenCalledWith(before.document);
    expect(mockWorkspace.project?.location).toBeNull();
    expect(
      mockWorkspace.project?.manifest.boards.map((board) => board.id),
    ).toEqual([before.document!.id]);
    expect(mockWorkspace.project?.manifest.homeBoardId).toBe(
      before.document!.id,
    );
    expect(registry.activeKey).toBe(activeKey);
    expect(registry.controllers.get(activeKey)!.owner.snapshot()).toMatchObject(
      {
        document: before.document,
        sessionId: before.sessionId,
        camera: before.camera,
        canvas: before.canvas,
        canUndo: true,
        dirty: true,
        source: null,
      },
    );
    act(() => owner.transact(editObject('api', { name: 'Live wrapped edit' })));
    await searchProject('Live wrapped edit');
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Object · Live wrapped edit/ }),
      );
    });
    expect(registry.activeKey).toBe(activeKey);
    expect(registry.sessions).toHaveLength(1);
    jest
      .mocked(window.desktop.projects.save)
      .mockResolvedValueOnce({ status: 'canceled' });
    await click('Menu');
    await click('Save All');
    expect(mockWorkspace.project?.location).toBeNull();
    expect(
      registry.controllers.get(activeKey)!.owner.snapshot().document!.objects
        .api.name,
    ).toBe('Live wrapped edit');
    await click('Menu');
    await click('Save All');
    expect(registry.controllers.get(activeKey)!.owner.sessionId).toBe(
      before.sessionId,
    );
    act(() => owner.undo());
    expect(owner.snapshot().document!.objects.api.name).toBe(
      'Accepted before wrapping',
    );
  },
);

test('failed New Project leaves the standalone board and its source untouched', async () => {
  render(
    <DocumentSessions>
      <Capture />
    </DocumentSessions>,
  );
  const owner = registry.controllers.get(registry.activeKey)!.owner;
  await waitFor(() => expect(owner.snapshot().appInstanceId).toBe('app'));
  act(() => owner.replace(recursiveFixture(), { dirty: true }));
  const before = owner.snapshot();
  jest.mocked(window.desktop.projects.new).mockResolvedValueOnce({
    status: 'error',
    error: 'Could not create project',
  });
  jest.mocked(window.desktop.recovery.remove).mockClear();
  await click('Menu');
  await click('New Project');
  expect(owner.snapshot()).toEqual(before);
  expect(mockWorkspace.project).toBeNull();
  expect(window.desktop.transitions.confirm).not.toHaveBeenCalled();
  expect(window.desktop.recovery.remove).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Could not create project',
  );
});

test('New Project carries the active project board while saving other open boards before leaving', async () => {
  localStorage.setItem('depthplan.autosave', 'off');
  await setup();
  await act(async () => {
    await mockWorkspace.openBoard('b');
  });
  act(() =>
    controller('b').owner.transact(
      editObject('api', { name: 'Keep other board' }),
    ),
  );
  await act(async () => {
    await mockWorkspace.openBoard('a');
  });
  const owner = controller('a').owner;
  act(() => owner.transact(editObject('api', { name: 'Carry active board' })));
  const before = owner.snapshot();
  await click('Menu');
  await click('New Project');
  expect(project.manifest.boards.map((board) => board.id)).toEqual(['a']);
  expect(controller('a').owner.snapshot()).toMatchObject({
    document: before.document,
    sessionId: before.sessionId,
    source: null,
    dirty: true,
  });
  expect(window.desktop.projects.writeBoard).toHaveBeenCalledTimes(1);
  expect(jest.mocked(window.desktop.projects.writeBoard).mock.calls[0][1]).toBe(
    'b',
  );
  expect(window.desktop.projects.close).toHaveBeenCalledWith('project-session');
  expect(window.desktop.transitions.confirm).not.toHaveBeenCalled();
});

test('first Save uses inline names, survives cancellation and preserves undo', async () => {
  project.location = null;
  await setup();
  expect(mockWorkspace.project?.location).toBeNull();
  expect(controller('a').owner.source).toBeNull();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  act(() =>
    controller('a').owner.transact(editObject('api', { name: 'Memory edit' })),
  );
  const ownerId = controller('a').owner.sessionId;
  drawer();
  await click('New Board');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(registry.sessions).toHaveLength(2);
  await act(async () => {
    await mockWorkspace.openBoard('b');
  });
  act(() =>
    controller('b').owner.transact(
      editObject('api', { name: 'Closed memory edit' }),
    ),
  );
  await action('b', 'Close board');
  expect(documents.b.objects.api.name).toBe('Closed memory edit');
  await searchProject('Closed memory edit');
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: /Object · Closed memory edit/ }),
    );
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(registry.activeKey).toBe(key('b'));
  await action('b', 'Close board');
  await act(async () => {
    await mockWorkspace.openBoard('a');
  });
  expect(window.desktop.projects.save).not.toHaveBeenCalled();
  await editInline(drawer(), 'Project name', 'My Project');
  await act(async () => {
    await mockWorkspace.renameBoard('a', 'API Details');
    await mockWorkspace.renameBoard('b', 'API Details');
  });
  jest
    .mocked(window.desktop.projects.save)
    .mockResolvedValueOnce({ status: 'canceled' });
  await click('Menu');
  await click('Save All');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mockWorkspace.project?.location).toBeNull();
  expect(controller('a').owner.document?.objects.api.name).toBe('Memory edit');
  await click('Menu');
  await click('Save All');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(project.manifest.name).toBe('My Project');
  expect(project.manifest.boards.slice(0, 2).map((b) => b.path)).toEqual([
    'api_details.depthplan',
    'api_details_2.depthplan',
  ]);
  expect(documents.b.objects.api.name).toBe('Closed memory edit');
  expect(controller('a').owner.sessionId).toBe(ownerId);
  expect(controller('a').owner.source?.path).toBe(
    '/project/api_details.depthplan',
  );
  expect(controller('a').owner.dirty).toBe(false);
  act(() => controller('a').owner.undo());
  expect(controller('a').owner.document?.objects.api.name).not.toBe(
    'Memory edit',
  );
  expect(controller('a').owner.document?.metadata.title).toBe('API Details');
});

test('boards imported into memory receive snake_case filenames before the first save', async () => {
  project.location = null;
  window.desktop.projects.importBoards = jest.fn(async () => {
    const document = createRecursiveDocument('imported', 'API Details');
    documents.imported = document;
    project.manifest.boards.push({
      id: document.id,
      name: document.metadata.title,
      path: 'Board-1.depthplan',
    });
    return { ...response(), imported: [document.id], errors: [] };
  });
  await setup();
  await act(async () => {
    await mockWorkspace.importBoards();
  });
  expect(project.manifest.boards.at(-1)?.path).toBe('api_details.depthplan');
  expect(window.desktop.projects.save).not.toHaveBeenCalled();
});

test('closing a clean memory project requires a decision and resumes after its first save', async () => {
  project.location = null;
  await setup();
  await click('Menu');
  await click('Close All');
  expect(window.desktop.transitions.confirm).toHaveBeenCalledWith(
    'document',
    'Architecture',
    true,
  );
  expect(window.desktop.projects.close).not.toHaveBeenCalled();
  jest.mocked(window.desktop.transitions.confirm).mockResolvedValue('save');
  jest
    .mocked(window.desktop.projects.save)
    .mockResolvedValueOnce({ status: 'canceled' });
  await click('Menu');
  await click('Close All');
  expect(mockWorkspace.project?.location).toBeNull();
  expect(mockWorkspace.busy).toBe(false);
  await click('Menu');
  await click('Close All');
  await waitFor(() =>
    expect(window.desktop.projects.close).toHaveBeenCalledWith(
      'project-session',
    ),
  );
  expect(registry.sessions[0].project).toBeUndefined();
});

test('a failed board read after first-save publication retains the saved project location', async () => {
  project.location = null;
  await setup();
  jest
    .mocked(window.desktop.projects.readBoard)
    .mockResolvedValueOnce({ status: 'error', error: 'Board unavailable' });
  await click('Menu');
  await click('Save All');
  expect(mockWorkspace.project?.location).toBe('/project/saved.depthproject');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Project saved, but a board could not reopen',
  );
  expect(controller('a').owner.document).toEqual(documents.a);
});

test('filename editing preserves exact spelling, appends the extension, commits on blur and cancels on Escape', async () => {
  await setup();
  const caption = document.querySelector('.document-caption') as HTMLElement;
  await editInline(caption, 'Board filename', 'Custom Board', 'Tab');
  expect(project.manifest.boards[0]).toMatchObject({
    name: 'Overview',
    path: 'Custom Board.depthplan',
  });
  expect(controller('a').owner.source?.path).toBe(
    '/project/Custom Board.depthplan',
  );
  await editInline(caption, 'Board filename', 'discarded.depthplan', 'Escape');
  expect(project.manifest.boards[0].path).toBe('Custom Board.depthplan');
  act(() =>
    controller('a').owner.transact(editObject('api', { name: 'unsaved' })),
  );
  expect(within(caption).getByLabelText('Unsaved').tagName).toBe('SUP');
  expect(
    within(caption).getByRole('button', { name: 'Edit board name' }),
  ).toHaveAttribute('title', 'Overview — Unsaved');
  expect(
    within(caption).getByRole('button', { name: 'Edit board filename' }),
  ).toHaveTextContent('Custom Board.depthplan');
  expect(caption).not.toHaveTextContent('Saving');
});

test('recent projects are a submenu of at most five native recent entries', async () => {
  const entries = Array.from({ length: 7 }, (_, n) => ({
    id: `${n}`,
    key: `${n}`,
    name: `Project ${n}`,
    location: `/project${n}/project.depthproject`,
    available: true,
  }));
  jest
    .mocked(window.desktop.projects.recents)
    .mockResolvedValue({ status: 'success', entries });
  await setup();
  await click('Menu');
  await click('Open Recent');
  const recent = screen.getByRole('menu', { name: 'Open Recent' });
  expect(within(recent).getAllByRole('menuitem')).toHaveLength(5);
  expect(recent).not.toHaveTextContent('Project 5');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const first = within(recent).getAllByRole('menuitem')[0];
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(within(recent).getAllByRole('menuitem')[1]).toHaveFocus();
  fireEvent.keyDown(recent, { key: 'ArrowLeft' });
  expect(screen.getByRole('button', { name: 'Open Recent' })).toHaveFocus();
  expect(
    screen.queryByRole('menu', { name: 'Open Recent' }),
  ).not.toBeInTheDocument();
  await click('Open Recent');
  await act(async () => {
    fireEvent.click(first);
  });
  expect(window.desktop.projects.openRecent).toHaveBeenCalledWith('0', false);
});

test.each([
  ['Save All', null],
  ['Save Project As…', null],
  ['Save All', '/project/project.depthproject'],
  ['Save Project As…', '/project/project.depthproject'],
])('%s saves every project board (location: %s)', async (label, location) => {
  project.location = location;
  await setup();
  drawer();
  await click('Open Same name, b.depthplan');
  act(() => {
    controller('a').owner.transact(editObject('api', { name: 'Keep A' }));
    controller('b').owner.transact(editObject('api', { name: 'Keep B' }));
  });
  await click('Menu');
  await click(label!);
  expect(controller('a').owner.dirty).toBe(false);
  expect(controller('b').owner.dirty).toBe(false);
  expect(documents.a.objects.api.name).toBe('Keep A');
  expect(documents.b.objects.api.name).toBe('Keep B');
  expect(window.desktop.fileSystem.saveDocument).not.toHaveBeenCalled();
  expect(registry.sessions).toHaveLength(2);
});

test('Save Project As cancellation preserves unsaved boards; retry saves snapshots and retains undo', async () => {
  localStorage.setItem('depthplan.autosave', 'off');
  await setup();
  drawer();
  await click('Open Same name, b.depthplan');
  for (const id of ['a', 'b'])
    act(() =>
      controller(id).owner.transact(editObject('api', { name: `Copy ${id}` })),
    );
  const original = clone(documents);
  jest
    .mocked(window.desktop.projects.save)
    .mockResolvedValueOnce({ status: 'canceled' });
  await click('Menu');
  await click('Save Project As…');
  expect(documents).toEqual(original);
  expect(window.desktop.projects.writeBoard).not.toHaveBeenCalled();
  expect(controller('a').owner.dirty).toBe(true);
  expect(controller('b').owner.dirty).toBe(true);
  expect(registry.activeKey).toBe(key('b'));
  await click('Menu');
  await click('Save Project As…');
  expect(controller('a').owner.dirty).toBe(false);
  expect(controller('b').owner.dirty).toBe(false);
  expect(window.desktop.projects.writeBoard).not.toHaveBeenCalled();
  act(() => controller('a').owner.undo());
  expect(controller('a').owner.document?.objects.api.name).toBe(
    original.a.objects.api.name,
  );
});

test.each([null, '/project/project.depthproject'])(
  'Save Board As copies only the active project board (location: %s)',
  async (location) => {
    localStorage.setItem('depthplan.autosave', 'off');
    project.location = location;
    await setup();
    act(() =>
      controller('a').owner.transact(editObject('api', { name: 'Board copy' })),
    );
    const source = controller('a').owner.source;
    await click('Menu');
    await click('Save Board As…');
    const [document, sourceId, saveAs] = jest.mocked(
      window.desktop.fileSystem.saveDocument,
    ).mock.calls[0];
    expect(document.id).not.toBe('a');
    expect(document.objects.api.name).toBe('Board copy');
    expect(sourceId).toBe(source?.id);
    expect(saveAs).toBe(true);
    expect(window.desktop.projects.save).not.toHaveBeenCalled();
    expect(window.desktop.projects.writeBoard).not.toHaveBeenCalled();
    expect(controller('a').owner.source).toBe(source);
    expect(controller('a').owner.dirty).toBe(true);
    expect(project.manifest.boards).toHaveLength(3);
  },
);

test('the board menu has contextual actions in order and closes a standalone board safely', async () => {
  await setup();
  await click('Menu');
  const menu = document.getElementById('document-menu')!;
  expect(within(menu).getByText('Boards')).toBeVisible();
  for (const name of [
    'Save Project',
    'Open Board in Project…',
    'Search Project…',
    'Recent Projects',
    'Save Copy…',
  ])
    expect(
      within(menu).queryByRole('button', { name }),
    ).not.toBeInTheDocument();
  const labels = [...menu.querySelectorAll('button')].map((button) =>
    button.textContent!.trim(),
  );
  expect(labels[0]).toBe('Open Recent');
  expect(labels.indexOf('Open Board…')).toBeLessThan(
    labels.indexOf('New Project'),
  );
  expect(labels.indexOf('Save Board As…')).toBe(
    labels.indexOf('Open Board…') + 1,
  );
  expect(labels.indexOf('Save Project As…')).toBe(
    labels.indexOf('Open Project…') + 1,
  );
  expect(
    [...menu.querySelectorAll('.dropdown-label')].map(
      (item) => item.textContent,
    ),
  ).toEqual(['Boards', 'Projects']);
  expect(menu.querySelector('svg')).toBeNull();
  expect(within(menu).queryByRole('button', { name: 'Reload' })).toBeNull();
  expect(
    labels.slice(labels.indexOf('Save All'), labels.indexOf('Save All') + 2),
  ).toEqual(['Save All', 'Close All']);
  expect(labels).not.toContain('Save As…');
  const quit = within(menu).getByRole('button', { name: 'Quit DepthPlan' });
  expect(menu.lastElementChild).toBe(quit);
  expect(quit.previousElementSibling).toHaveClass('dropdown-separator');
  const settings = within(menu)
    .getByRole('button', { name: 'Settings' })
    .closest('.menu-flyout')!;
  expect(settings.previousElementSibling!.lastElementChild).toHaveTextContent(
    'Export',
  );
  await click('Quit DepthPlan');
  expect(window.desktop.quit).toHaveBeenCalledTimes(1);
  expect(menu).not.toBeVisible();
  await click('Menu');
  await click('Close All');
  expect(mockWorkspace.project).toBeNull();
  const standaloneKey = registry.activeKey;
  const owner = registry.controllers.get(standaloneKey)!.owner;
  act(() =>
    owner.transact((draft) => {
      draft.metadata.title = 'Unsaved standalone';
    }),
  );
  await click('Menu');
  await click('Close All');
  expect(registry.activeKey).toBe(standaloneKey);
  expect(owner.snapshot().document!.metadata.title).toBe('Unsaved standalone');
  jest.mocked(window.desktop.transitions.confirm).mockResolvedValue('discard');
  await click('Menu');
  await click('Close All');
  expect(registry.activeKey).not.toBe(standaloneKey);
  expect(registry.sessions[0].source).toBeNull();
  await click('Menu');
  expect(
    screen.getByRole('button', { name: 'Save Project As…' }),
  ).toBeDisabled();
  await click('Save All');
  expect(window.desktop.fileSystem.saveDocument).toHaveBeenCalled();
});

test.each(['Open Recent', 'Settings'])(
  '%s hover stays open across its submenu and dismisses over another menu row',
  async (label) => {
    jest.useFakeTimers();
    try {
      await setup();
      await click('Menu');
      const trigger = screen.getByRole('button', { name: label });
      const root = trigger.closest('.menu-flyout')!;
      fireEvent.mouseEnter(trigger);
      const panel = screen.getByRole('menu', { name: label });
      fireEvent.mouseLeave(root);
      await act(() => jest.advanceTimersByTimeAsync(50));
      fireEvent.mouseEnter(panel);
      await act(() => jest.advanceTimersByTimeAsync(150));
      expect(screen.getByRole('menu', { name: label })).toBeVisible();
      fireEvent.mouseLeave(root, {
        relatedTarget: screen.getByRole('button', { name: 'New Board' }),
      });
      await act(() => jest.advanceTimersByTimeAsync(150));
      expect(screen.queryByRole('menu', { name: label })).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  },
);

test('Settings restores a saved Autosave preference', async () => {
  localStorage.setItem('depthplan.autosave', 'off');
  await setup();
  expect(screen.getByRole('button', { name: 'Save document' })).toBeVisible();
  await click('Menu');
  await click('Settings');
  expect(
    screen.getByRole('menuitemcheckbox', { name: 'Autosave' }),
  ).not.toBeChecked();
});

test('Settings Autosave defaults on, pauses every project board, permits manual Save, and resumes accepted edits', async () => {
  jest.useFakeTimers();
  try {
    await setup();
    drawer();
    await click('Open Same name, b.depthplan');
    await click('Menu');
    await click('Settings');
    const toggle = () =>
      screen.getByRole('menuitemcheckbox', { name: 'Autosave' });
    expect(toggle()).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Save document' })).toBeNull();
    fireEvent.click(toggle());
    expect(toggle()).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save document' })).toBeVisible();
    expect(localStorage.getItem('depthplan.autosave')).toBe('off');
    act(() => {
      controller('a').owner.transact(editObject('api', { name: 'Manual A' }));
      controller('b').owner.transact(editObject('api', { name: 'Manual B' }));
    });
    await act(() => jest.advanceTimersByTimeAsync(6000));
    expect(window.desktop.projects.writeBoard).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Settings' }), {
      key: 'Escape',
    });
    await click('Save All');
    expect(documents.a.objects.api.name).toBe('Manual A');
    expect(documents.b.objects.api.name).toBe('Manual B');
    await click('Menu');
    await click('Settings');
    fireEvent.click(toggle());
    expect(localStorage.getItem('depthplan.autosave')).toBe('on');
    expect(screen.queryByRole('button', { name: 'Save document' })).toBeNull();
    act(() =>
      controller('a').owner.transact(
        editObject('api', { name: 'Automatic A' }),
      ),
    );
    await act(() => jest.advanceTimersByTimeAsync(1000));
    expect(documents.a.objects.api.name).toBe('Automatic A');
    expect(controller('a').owner.canUndo).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test('Open Board offers Import or Standalone in a project and respects cancellation', async () => {
  window.desktop.projects.importBoards = jest.fn(async () => ({
    ...response(),
    imported: [],
    errors: [],
  }));
  await setup();
  await click('Menu');
  await click('Open Board…');
  expect(screen.getByRole('dialog', { name: 'Open Board' })).toHaveTextContent(
    'Import into the current Project',
  );
  expect(window.desktop.fileSystem.openDocument).not.toHaveBeenCalled();
  await click('Import');
  expect(window.desktop.projects.importBoards).toHaveBeenCalled();
  expect(mockWorkspace.project).not.toBeNull();
  const sessions = registry.sessions;
  await click('Menu');
  await click('Open Board…');
  fireEvent(
    screen.getByRole('dialog', { name: 'Open Board' }),
    new Event('cancel', { bubbles: true, cancelable: true }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(window.desktop.fileSystem.openDocument).not.toHaveBeenCalled();
  await click('Menu');
  await click('Open Board…');
  await click('Standalone');
  expect(registry.sessions).toBe(sessions);
  jest.mocked(window.desktop.fileSystem.openDocument).mockResolvedValue({
    status: 'success',
    document: clone(documents.b),
    source: {
      id: 'external',
      path: '/standalone.depthplan',
      fingerprint: 'external',
    },
  });
  await click('Menu');
  await click('Open Board…');
  await click('Standalone');
  expect(mockWorkspace.project).toBeNull();
  expect(registry.sessions).toHaveLength(1);
  expect(registry.sessions[0].source?.path).toBe('/standalone.depthplan');
  await click('Menu');
  await click('Save Board As…');
  expect(window.desktop.fileSystem.saveDocument).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'b' }),
    'external',
    true,
  );
  await click('Menu');
  await click('Open Board…');
  expect(
    screen.queryByRole('dialog', { name: 'Open Board' }),
  ).not.toBeInTheDocument();
});
