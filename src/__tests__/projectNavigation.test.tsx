import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import useProjectWorkspace from '../renderer/hooks/useProjectWorkspace';
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
const key = (id: string) => `project-session:${id}`;
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
    source: {
      id,
      path: `/project/${project.manifest.boards.find((b) => b.id === id)!.path}`,
      fingerprint: id,
    },
  },
});
beforeEach(() => {
  HTMLElement.prototype.showPopover = jest.fn();
  HTMLElement.prototype.hidePopover = jest.fn();
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
    events: { on: noop },
    transitions: {
      onRequest: noop,
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
      workspace: jest.fn().mockResolvedValue({ status: 'success', view: null }),
      remember: jest.fn().mockResolvedValue({ status: 'success', view: null }),
      open: jest.fn(async () => response()),
      close: jest.fn().mockResolvedValue({ status: 'success' }),
      inspect: jest.fn(async () => response()),
      reveal: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(async () => response()),
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
  fireEvent.change(screen.getByRole('textbox', { name: 'Find a board' }), {
    target: { value: 'Overview' },
  });
  const search = screen.getByRole('textbox', { name: 'Find a board' });
  search.focus();
  expect(fireEvent.keyDown(search, { key: 'Home' })).toBe(true);
  expect(fireEvent.keyDown(search, { key: 'End' })).toBe(true);
  expect(search).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Find a board' }), {
    key: 'ArrowDown',
  });
  expect(
    screen.getByRole('button', { name: 'Open Overview, a.depthplan' }),
  ).toHaveFocus();
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'Open Overview, a.depthplan' }),
    { key: 'Escape' },
  );
  expect(screen.getByRole('textbox', { name: 'Find a board' })).toHaveValue('');
});

test('settings apply shared policy without touching boards; cancel, validation and failed persistence retain the correct values', async () => {
  Element.prototype.scrollIntoView = jest.fn();
  await setup();
  act(() =>
    controller('a').owner.transact(editObject('api', { name: 'Local edit' })),
  );
  const before = controller('a').owner.snapshot();
  const settings = async () => {
    await click('Menu');
    await click('Project Settings…');
  };
  await settings();
  fireEvent.change(screen.getByLabelText('Project name'), {
    target: { value: 'Canceled' },
  });
  await click('Cancel');
  expect(project.manifest.name).toBe('Architecture');
  expect(window.desktop.projects.apply).not.toHaveBeenCalled();
  await settings();
  fireEvent.change(screen.getByLabelText('Project name'), {
    target: { value: '../invalid' },
  });
  await click('Apply');
  expect(screen.getByLabelText('Project name')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(window.desktop.projects.apply).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Project name'), {
    target: { value: 'Shared settings' },
  });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Portable description' },
  });
  fireEvent.change(screen.getByLabelText('Home board'), {
    target: { value: 'b' },
  });
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByText(/Boards save automatically/)).toBeVisible();
  await click('Reveal in File Manager');
  expect(window.desktop.projects.reveal).toHaveBeenCalledWith(
    'project-session',
  );
  for (const error of ['Permission denied', 'Project manifest changed']) {
    jest
      .mocked(window.desktop.projects.apply)
      .mockResolvedValueOnce({ status: 'error', error });
    await click('Apply');
    expect(screen.getByRole('alert')).toHaveTextContent(error);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
    });
    expect(screen.getByLabelText('Project name')).toHaveValue(
      'Shared settings',
    );
    expect(project.manifest.name).toBe('Architecture');
  }
  await click('Apply');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(project.manifest).toMatchObject({
    name: 'Shared settings',
    description: 'Portable description',
    homeBoardId: 'b',
    autosave: true,
  });
  expect(controller('a').owner.snapshot()).toEqual(before);
  expect(controller('a').owner.canUndo).toBe(true);
  expect(window.desktop.projects.writeBoard).not.toHaveBeenCalled();
  await settings();
  expect(screen.getByLabelText('Project name')).toHaveValue('Shared settings');
  expect(screen.getByLabelText('Home board')).toHaveValue('b');
  expect(screen.getByLabelText('Project location')).toHaveValue(
    '/project/project.depthproject',
  );
  await click('Cancel');
  jest.mocked(window.desktop.transitions.confirm).mockResolvedValue('discard');
  await click('Menu');
  await click('Close Project');
  await click('Menu');
  await click('Open Project…');
  expect(registry.activeKey).toBe(key('b'));
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
  await action('a', 'Rename…');
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: '設計 API' },
  });
  await click('Rename board');
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
  await click('Open 設計 API, API.depthplan');
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
  await click('Close Project');
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
  await click('Open standalone board…');
  expect(registry.sessions).toBe(before);
});

test('closing every board leaves an empty project with create/import actions and safe filenames', async () => {
  await setup();
  await action('a', 'Close board');
  expect(screen.queryByTestId('drawing-surface')).not.toBeInTheDocument();
  expect(screen.getByText('Choose a board to begin.')).toBeVisible();
  expect(project.manifest.boards).toHaveLength(3);
  expect(projectFilename('CON', [])).toBe('Board-CON.depthplan');
  expect(
    projectFilename('設計', ['Board.depthplan', 'board-2.depthplan']),
  ).toBe('Board-3.depthplan');
  expect(projectFilename('API', ['api.depthplan'])).toBe('API-2.depthplan');
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
  await click('Close Project');
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
  await click('Menu');
  await click('Project Settings…');
  await click('Apply');
  jest.mocked(window.desktop.projects.writeBoard).mockResolvedValueOnce({
    status: 'error',
    error: 'Project manifest changed',
  });
  await click('Reload project definition…');
  expect(controller('a').owner.snapshot()).toEqual(aBefore);
  expect(window.desktop.projects.resolveDefinition).not.toHaveBeenCalled();
  await click('Apply');
  await click('Reload project definition…');
  jest.mocked(window.desktop.transitions.confirm).mockResolvedValue('discard');
  expect(registry.controllers.has(key('a'))).toBe(false);
  expect(controller('b').owner.snapshot()).toEqual(bBefore);
  expect(project.manifest.boards[0].path).toBe('repathed.depthplan');
  expect(
    screen.getByRole('dialog', { name: 'Project Settings' }),
  ).toBeVisible();
});

test('a broken home board falls back without dropping its row, and a canceled copy creation preserves accepted work', async () => {
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
  expect(screen.getByText('Unavailable — retry opening')).toBeVisible();
  act(() =>
    controller('b').owner.transact(
      editObject('api', { name: 'Preserve through canceled copy' }),
    ),
  );
  const before = controller('b').owner.snapshot();
  jest
    .mocked(window.desktop.projects.create)
    .mockResolvedValueOnce({ status: 'canceled' });
  await click('Menu');
  await click('New Project…');
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Copied Project' },
  });
  fireEvent.change(screen.getByLabelText('First board'), {
    target: { value: 'copy' },
  });
  await click('Choose folder and create');
  expect(window.desktop.projects.create).toHaveBeenCalledWith(
    'Copied Project',
    'Copied-Project',
    before.document,
  );
  expect(controller('b').owner.snapshot()).toEqual(before);
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
  await click('Close Project');
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
  fireEvent.click(screen.getByRole('switch', { name: 'MCP Server' }));
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: 'MCP Server' })).toBeChecked(),
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
    await click('Menu');
    await click('Search Project…');
  }
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search content' }), {
    target: { value: query },
  });
  fireEvent.submit(
    screen
      .getByRole('dialog', { name: 'Search Project' })
      .querySelector('form')!,
  );
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
      value.board.source.fingerprint = 'changed';
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
    screen.getByRole('button', { name: 'Toggle project boards' }),
  ).toHaveTextContent('Boards / Project');
  const board = screen.getByRole('button', {
    name: 'Open board 2, b.depthplan',
  });
  board.focus();
  fireEvent.keyDown(board, { key: 'F10', shiftKey: true });
  const rename = screen.getByRole('menuitem', { name: 'Rename…' });
  expect(rename).toHaveFocus();
  expect(
    screen.queryByRole('menuitem', { name: /Move/ }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(rename, { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: 'Duplicate…' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(board).toHaveFocus();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  await action('a', 'Rename…');
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Board 0' },
  });
  await click('Rename board');
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
