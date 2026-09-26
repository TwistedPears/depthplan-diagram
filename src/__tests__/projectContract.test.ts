import {
  validateProjectManifest,
  ProjectManifest,
} from '../shared/projectContract';
import { createRecursiveDocument } from '../shared/recursiveDocument';

jest.mock('@tauri-apps/api/core', () => ({ invoke: jest.fn() }));
jest.mock('@tauri-apps/api/event', () => ({ listen: jest.fn() }));
import { invoke } from '@tauri-apps/api/core';
import '../renderer/desktop';

const manifest: ProjectManifest = {
  projectVersion: 1,
  id: 'project',
  name: 'Project',
  description: '',
  boards: [{ id: 'board', name: 'Overview', path: 'Overview.depthplan' }],
  homeBoardId: 'board',
  autosave: true,
  extensions: { vendor: { keep: [1, true] } },
};
test('manifest round trip preserves supported extensions and validates all boundaries', () => {
  const roundTrip = JSON.parse(JSON.stringify(manifest));
  validateProjectManifest(roundTrip);
  expect(roundTrip).toEqual(manifest);
  for (const patch of [
    { projectVersion: 2 },
    { projectVersion: '1' },
    { extra: true },
    { name: ' ' },
    { name: 'unsafe/name' },
    { name: 'x'.repeat(121) },
    { description: 'x'.repeat(4001) },
    { id: 'x'.repeat(129) },
    { homeBoardId: 'absent' },
    { extensions: { big: 'x'.repeat(1024 * 1024) } },
    { boards: [manifest.boards[0], manifest.boards[0]] },
    {
      boards: [
        manifest.boards[0],
        { ...manifest.boards[0], id: 'second', path: 'overview.depthplan' },
      ],
    },
    { boards: Array(1001).fill(manifest.boards[0]) },
  ])
    expect(() => validateProjectManifest({ ...manifest, ...patch })).toThrow();
  for (const path of [
    '/abs.depthplan',
    '../escape.depthplan',
    'C:\\x.depthplan',
    'a/../x.depthplan',
    'a//x.depthplan',
    'CON.depthplan',
    'nul.extra.depthplan',
    'file.json',
  ]) {
    expect(() =>
      validateProjectManifest({
        ...manifest,
        boards: [{ ...manifest.boards[0], path }],
      }),
    ).toThrow();
  }
  validateProjectManifest({
    ...manifest,
    name: '設計',
    boards: [],
    homeBoardId: null,
  });
});
test('project bridge uses opaque sessions, validates responses and preserves cancel/error results', async () => {
  const project = {
    manifest,
    sessionId: 'session',
    fingerprint: 'hash',
    location: '/project',
    workspaceKey: 'local',
    diagnostics: [],
  };
  const result = { status: 'success', project };
  jest.mocked(invoke).mockResolvedValue(result);
  expect(await window.desktop.projects.create(' Project ', 'project')).toEqual(
    result,
  );
  expect(invoke).toHaveBeenLastCalledWith('desktop', {
    method: 'project:create',
    args: ['Project', 'project', undefined],
  });
  await window.desktop.projects.apply('session', 'hash', {
    kind: 'removeBoard',
    boardId: 'board',
  });
  expect(invoke).toHaveBeenLastCalledWith('desktop', {
    method: 'project:apply',
    args: ['session', 'hash', { kind: 'removeBoard', boardId: 'board' }],
  });
  jest.mocked(invoke).mockResolvedValue({
    status: 'success',
    project: { ...project, manifest: { ...manifest, projectVersion: 9 } },
  });
  await expect(window.desktop.projects.open()).rejects.toThrow();
  for (const response of [
    { status: 'canceled' },
    { status: 'error', error: 'Project is in use' },
  ]) {
    jest.mocked(invoke).mockResolvedValue(response);
    expect(await window.desktop.projects.open()).toEqual(response);
  }
  const board = {
    document: createRecursiveDocument('board', 'Overview'),
    fingerprint: 'board-hash',
  };
  jest.mocked(invoke).mockResolvedValue({ status: 'success', board });
  expect(await window.desktop.projects.readBoard('session', 'board')).toEqual({
    status: 'success',
    board,
  });
  jest.mocked(invoke).mockResolvedValue({
    status: 'success',
    board: { ...board, document: {} },
  });
  await expect(
    window.desktop.projects.readBoard('session', 'board'),
  ).rejects.toThrow();
});
