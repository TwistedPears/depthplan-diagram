import { act, render, waitFor } from '@testing-library/react';
import { Workspace } from '../renderer/App';
import useDocumentSessions, {
  DocumentSessions,
} from '../renderer/hooks/useDocumentSessions';
import { createRecursiveDocument } from '../shared/recursiveDocument';
import {
  projectFilename,
  type ProjectAction,
  type ProjectManifest,
  type ProjectSnapshot,
} from '../shared/projectContract';
import { mcpTools } from '../shared/mcpRegistry';

jest.mock('../renderer/components/RecursiveCanvas', () => ({
  __esModule: true,
  default: () => null,
}));
let registry: ReturnType<typeof useDocumentSessions>;
function Capture() {
  registry = useDocumentSessions();
  return <Workspace />;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const noop = () => () => {};
const lease = { id: 'lease', generation: 1 };
let project: ProjectSnapshot;
let documents: Record<string, ReturnType<typeof createRecursiveDocument>>;
let granted: boolean;
let request!: (value: unknown) => unknown;
const response = () => ({
  status: 'success' as const,
  project: clone(project),
});
const inside = (path: string) => {
  if (!granted || !path.startsWith('/approved/'))
    throw new Error(
      'Path is outside approved folders. Approve its folder in the MCP Server controls.',
    );
};
beforeEach(() => {
  granted = true;
  documents = {};
  project = undefined as unknown as ProjectSnapshot;
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
    automation: {
      status: async () => ({ enabled: true, descriptor: '', executable: '' }),
      onRequest: (listener: (value: unknown) => unknown) => {
        request = listener;
        return () => {};
      },
    },
    fileSystem: { onOpenRequested: noop },
    mcpFiles: {
      onRevoked: noop,
      folders: jest.fn().mockResolvedValue([]),
      lease: jest.fn().mockResolvedValue(lease),
      check: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      inspect: jest.fn(async (path: string) => {
        inside(path);
        return { path, fingerprint: null };
      }),
    },
    projects: {
      recents: jest.fn().mockResolvedValue({ status: 'success', entries: [] }),
      workspace: jest.fn().mockResolvedValue({ status: 'success', view: null }),
      remember: jest.fn().mockResolvedValue({ status: 'success', view: null }),
      close: jest.fn().mockResolvedValue({ status: 'success' }),
      new: jest.fn(
        async (document: ReturnType<typeof createRecursiveDocument>) => {
          documents = { [document.id]: clone(document) };
          project = {
            sessionId: 'project-session',
            workspaceKey: 'project-session',
            fingerprint: 'manifest',
            location: null,
            diagnostics: [],
            manifest: {
              projectVersion: 1,
              id: 'project',
              name: 'Untitled Project',
              description: '',
              autosave: true,
              homeBoardId: document.id,
              boards: [
                {
                  id: document.id,
                  name: document.metadata.title,
                  path: projectFilename(document.metadata.title, []),
                },
              ],
            },
          };
          return response();
        },
      ),
      save: jest.fn(
        async (
          _session: string,
          _expected: string,
          manifest: ProjectManifest,
          snapshots: (typeof documents)[string][] = [],
          target?: { path: string },
        ) => {
          if (!target) throw new Error('MCP save must not open a dialog');
          inside(target.path);
          project.manifest = clone(manifest);
          project.location = target.path;
          for (const document of snapshots)
            documents[document.id] = clone(document);
          return response();
        },
      ),
      readBoard: jest.fn(async (_session: string, id: string) => ({
        status: 'success',
        board: {
          document: clone(documents[id]),
          fingerprint: id,
          source: project.location
            ? { id, path: `/approved/${id}.depthplan`, fingerprint: id }
            : null,
        },
      })),
      writeBoard: jest.fn(async () => ({ status: 'success', source: null })),
      apply: jest.fn(
        async (
          _session: string,
          _expected: string,
          action: ProjectAction,
          given?: unknown,
        ) => {
          // Native storage enforces grants for saved projects and vacant paths.
          if (project.location) {
            if (given !== lease) throw new Error('Missing MCP lease');
            inside(project.location);
          }
          const members = project.manifest.boards;
          if (
            'path' in action &&
            members.some(
              (b) =>
                b.path === action.path &&
                !('boardId' in action && b.id === action.boardId),
            )
          )
            throw new Error(`Destination exists: ${action.path}`);
          if (action.kind === 'settings') project.manifest.name = action.name;
          if (action.kind === 'removeBoard') {
            project.manifest.boards = members.filter(
              (b) => b.id !== action.boardId,
            );
            if (project.location)
              project.diagnostics.push({
                boardId: null,
                path: members.find((b) => b.id === action.boardId)!.path,
                error: 'Unlisted board retained on disk.',
              });
          }
          if (action.kind === 'renameBoard')
            Object.assign(
              members.find((b) => b.id === action.boardId)!,
              {
                name: action.name,
                path: action.path,
              },
            );
          if (action.kind === 'createBoard') {
            const id = `created-${Object.keys(documents).length}`;
            documents[id] = createRecursiveDocument(id, action.name);
            members.push({ id, name: action.name, path: action.path });
          }
          return response();
        },
      ),
    },
  } as unknown as typeof window.desktop;
});
async function call(tool: keyof typeof mcpTools, input: object = {}) {
  let result: any;
  await act(async () => {
    result = await request({ tool, input });
  });
  return result;
}
async function setup() {
  render(
    <DocumentSessions>
      <Capture />
    </DocumentSessions>,
  );
  await waitFor(async () =>
    expect((await call('depthplan_get_state')).ok).toBe(true),
  );
}
async function settle(operationId: string) {
  let receipt: any;
  await waitFor(async () => {
    receipt = await call('depthplan_get_operation', {
      appInstanceId: 'app',
      operationId,
    });
    expect(['running']).not.toContain(receipt.data.status);
  });
  return receipt.data;
}
const create = {
  appInstanceId: 'app',
  requestId: 'create',
  name: 'Service Map',
  path: '/approved/map/service_map.depthproject',
};

test('contracts expose two destructive project tools with validated names and paths', () => {
  expect(mcpTools.depthplan_create_project.destructive).toBe(true);
  expect(mcpTools.depthplan_project.destructive).toBe(true);
  const command = mcpTools.depthplan_project.input;
  const handle = { appInstanceId: 'app', projectSessionId: 'p' };
  expect(
    command.safeParse({
      handle,
      requestId: 'r',
      action: { type: 'create_board', name: 'API' },
    }).success,
  ).toBe(true);
  for (const action of [
    { type: 'create_board', name: 'a/b' },
    { type: 'create_board', name: ' padded' },
    { type: 'rename_board', boardId: 'b', filename: 'nested/file' },
    { type: 'rename_project', name: 'trailing.' },
    { type: 'remove_board' },
    { type: 'delete_file', boardId: 'b' },
  ])
    expect(command.safeParse({ handle, requestId: 'r', action }).success).toBe(
      false,
    );
  expect(
    mcpTools.depthplan_create_project.input.safeParse(create).success,
  ).toBe(true);
  expect(
    mcpTools.depthplan_create_project.input.safeParse({
      ...create,
      path: '/approved/plan.json',
    }).success,
  ).toBe(false);
});

test('an agent goes from no project to a saved, named project and manages boards through guards', async () => {
  await setup();
  granted = false;
  const denied = await call('depthplan_create_project', create);
  expect(denied.error.message).toMatch(/outside approved folders/);
  expect(window.desktop.projects.new).not.toHaveBeenCalled();
  granted = true;
  expect(
    (
      await call('depthplan_create_project', {
        ...create,
        path: '/elsewhere/plan.depthproject',
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await call('depthplan_create_project', {
        ...create,
        replaceProjectSessionId: 'none',
      })
    ).error.code,
  ).toBe('STALE_SESSION');

  const started = await call('depthplan_create_project', create);
  expect(started.ok).toBe(true);
  const receipt = await settle(started.data.operationId);
  expect(receipt.status).toBe('completed');
  expect(window.desktop.projects.save).toHaveBeenCalledWith(
    'project-session',
    expect.any(String),
    expect.objectContaining({ name: 'Service Map' }),
    expect.any(Array),
    { path: create.path, lease },
  );
  expect(receipt.result.project).toMatchObject({
    name: 'Service Map',
    location: create.path,
    total: 1,
  });
  const replay = await call('depthplan_create_project', create);
  expect(replay.data).toMatchObject({
    operationId: started.data.operationId,
    replayed: true,
  });
  expect(
    (await call('depthplan_create_project', { ...create, name: 'Other' })).error
      .code,
  ).toBe('REQUEST_ID_REUSED');
  expect(window.desktop.projects.new).toHaveBeenCalledTimes(1);

  const handle = receipt.result.project.handle;
  const command = (requestId: string, action: object, h = handle) =>
    call('depthplan_project', { handle: h, requestId, action });
  const api = await command('api', { type: 'create_board', name: 'API' });
  expect(api.data.board).toMatchObject({ name: 'API', path: 'api.depthplan' });
  expect(api.data.board.handle.sessionId).toBeTruthy();
  const data = await command('data', { type: 'create_board', name: 'Data' });
  expect(data.data.project.total).toBe(3);
  expect(
    (await command('api', { type: 'create_board', name: 'API' })).data.replayed,
  ).toBe(true);
  expect(project.manifest.boards).toHaveLength(3);
  expect(
    (await command('api', { type: 'create_board', name: 'Changed' })).error
      .code,
  ).toBe('REQUEST_ID_REUSED');
  // Names may repeat; filenames are made unique.
  const same = await command('same', { type: 'create_board', name: 'API' });
  expect(same.data.board.path).toBe('api_2.depthplan');

  const renamed = await command('rename', {
    type: 'rename_board',
    boardId: api.data.board.id,
    name: 'Public API',
  });
  expect(renamed.data.board).toMatchObject({
    name: 'Public API',
    path: 'public_api.depthplan',
  });
  const collision = await command('collide', {
    type: 'rename_board',
    boardId: same.data.board.id,
    filename: 'public_api',
  });
  expect(collision.error.message).toMatch(/Destination exists/);
  expect(
    project.manifest.boards.find((b) => b.id === same.data.board.id)!.path,
  ).toBe('api_2.depthplan');
  const file = await command('file', {
    type: 'rename_board',
    boardId: same.data.board.id,
    filename: 'gateway.depthplan',
  });
  expect(file.data.board).toMatchObject({
    name: 'API',
    path: 'gateway.depthplan',
  });
  expect(
    (
      await command('bad-file', {
        type: 'rename_board',
        boardId: same.data.board.id,
        filename: '..',
      })
    ).error.code,
  ).toBe('INVALID_REQUEST');
  expect(
    (await command('bad-name', { type: 'rename_project', name: 'a:b' })).error
      .code,
  ).toBe('INVALID_REQUEST');
  const title = await command('title', {
    type: 'rename_project',
    name: 'Platform Map',
  });
  expect(title.data.project.name).toBe('Platform Map');

  const removed = await command('remove', {
    type: 'remove_board',
    boardId: data.data.board.id,
  });
  expect(removed.data).toMatchObject({
    boardId: data.data.board.id,
    file: 'retained-unlisted',
  });
  expect(
    registry.sessions.some((s) => s.project?.boardId === data.data.board.id),
  ).toBe(false);
  // A retained file still occupies its default filename.
  const again = await command('data-again', {
    type: 'create_board',
    name: 'Data',
  });
  expect(again.data.board.path).toBe('data_2.depthplan');

  expect(
    (
      await command(
        'stale',
        { type: 'create_board', name: 'X' },
        { ...handle, projectSessionId: 'replaced' },
      )
    ).error.code,
  ).toBe('STALE_SESSION');
  expect(
    (await command('missing', { type: 'remove_board', boardId: 'nope' })).error
      .code,
  ).toBe('NOT_FOUND');
  granted = false;
  const blocked = await command('no-grant', {
    type: 'create_board',
    name: 'X',
  });
  expect(blocked.error.message).toMatch(/outside approved folders/);
  expect(project.manifest.boards.some((b) => b.name === 'X')).toBe(false);
  // Only the in-memory rename before the first save runs without a lease.
  const applied = (window.desktop.projects.apply as jest.Mock).mock.calls;
  expect(applied[0][3]).toBeUndefined();
  for (const call of applied.slice(1)) expect(call[3]).toBe(lease);
});

test('replacing an unsaved project offers a discard decision bound to fresh state', async () => {
  await setup();
  const started = await call('depthplan_create_project', create);
  await settle(started.data.operationId);
  // Model a project that has never been saved; the next response carries it.
  project.location = null;
  const { data } = await call('depthplan_get_project');
  const handle = data.project.handle;
  await call('depthplan_project', {
    handle,
    requestId: 'extra',
    action: { type: 'create_board', name: 'Extra' },
  });
  const next = await call('depthplan_create_project', {
    ...create,
    requestId: 'replace',
    path: '/approved/second.depthproject',
  });
  expect(next.error.code).toBe('STALE_SESSION');
  const replacing = await call('depthplan_create_project', {
    ...create,
    requestId: 'replace',
    path: '/approved/second.depthproject',
    replaceProjectSessionId: handle.projectSessionId,
  });
  const operationId = replacing.data.operationId;
  const pending = await settle(operationId);
  expect(pending.status).toBe('needs-decision');
  expect(pending.decision.choices).toEqual(['discard', 'cancel']);
  expect(window.desktop.transitions.confirm).not.toHaveBeenCalled();
  const state = pending.decision.state;
  const stale = await call('depthplan_decide', {
    handle: { appInstanceId: 'app', sessionId: state.sessionId },
    operationId,
    decisionId: pending.decision.id,
    expectedRevision: state.revision + 1,
    expectedViewRevision: state.viewRevision,
    requestId: 'stale-decision',
    choice: 'discard',
  });
  expect(stale.error.code).toBe('STALE_REVISION');
  expect((await settle(operationId)).status).toBe('canceled');
  expect(window.desktop.projects.new).toHaveBeenCalledTimes(1);

  const retry = await call('depthplan_create_project', {
    ...create,
    requestId: 'replace-again',
    path: '/approved/second.depthproject',
    replaceProjectSessionId: handle.projectSessionId,
  });
  const ask = await settle(retry.data.operationId);
  expect(
    (
      await call('depthplan_decide', {
        handle: {
          appInstanceId: 'app',
          sessionId: ask.decision.state.sessionId,
        },
        operationId: retry.data.operationId,
        decisionId: ask.decision.id,
        expectedRevision: ask.decision.state.revision,
        expectedViewRevision: ask.decision.state.viewRevision,
        requestId: 'discard',
        choice: 'discard',
      })
    ).ok,
  ).toBe(true);
  expect((await settle(retry.data.operationId)).status).toBe('completed');
  expect(window.desktop.projects.new).toHaveBeenCalledTimes(2);
  expect(project.location).toBe('/approved/second.depthproject');
});
