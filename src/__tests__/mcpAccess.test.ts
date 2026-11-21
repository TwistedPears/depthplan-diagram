import { workspaceRouter } from '../renderer/hooks/useWorkspaceAutomation';
import { mcpTools } from '../shared/mcpRegistry';
import { describeAccess } from '../shared/mcpAccess';

let folders: { id: string; path: string }[];
let location: string | null;
const route = workspaceRouter(
  () =>
    ({
      appInstanceId: 'app',
      registry: {
        controllers: new Map(),
        snapshot: () => ({ activeKey: '' }),
      },
      workspace: { project: location === null ? null : { location } },
    }) as never,
);
beforeEach(() => {
  folders = [];
  location = null;
  Object.assign(window, {
    desktop: { mcpFiles: { folders: jest.fn(async () => folders) } },
  });
});
const access = async () => {
  const result = await route('depthplan_get_access', {});
  expect(mcpTools.depthplan_get_access.output.safeParse(result).success).toBe(
    true,
  );
  return (result as { data: Record<string, any> }).data;
};

it('reads the live grant list on every request', async () => {
  expect(await access()).toMatchObject({
    appInstanceId: 'app',
    folders: [],
    note: expect.stringContaining('No folders are approved'),
  });
  folders = [{ id: 'g', path: '/Volumes/External/Work' }];
  const data = await access();
  expect(data.folders).toEqual([
    { id: 'g', path: '/Volumes/External/Work', writable: true },
  ]);
  expect(data).not.toHaveProperty('note');
});

it('explains grants that an open project folder locks against writes', async () => {
  folders = [
    { id: 'inside', path: '/Volumes/External/Work/Map' },
    { id: 'project', path: '/Volumes/External/Work/Map/boards' },
    { id: 'parent', path: '/Volumes/External/Work' },
    { id: 'lookalike', path: '/Volumes/External/Work/Map copy' },
  ];
  location = '/Volumes/External/Work/Map/Map.depthproject';
  const { folders: grants } = await access();
  expect(grants).toEqual([
    expect.objectContaining({
      id: 'inside',
      writable: false,
      reason: expect.stringContaining('writer lock'),
    }),
    expect.objectContaining({ id: 'project', writable: false }),
    expect.objectContaining({
      id: 'parent',
      writable: true,
      reason: expect.stringContaining('Contains the open project folder'),
    }),
    {
      id: 'lookalike',
      path: '/Volumes/External/Work/Map copy',
      writable: true,
    },
  ]);
  // An in-memory project has no folder to lock.
  expect(
    describeAccess(folders, 'app', null).folders.every((f) => f.writable),
  ).toBe(true);
});

it('compares Windows paths at separator boundaries', () => {
  const { folders: grants } = describeAccess(
    [
      { id: 'a', path: 'D:\\Work\\Map' },
      { id: 'b', path: 'D:\\Work\\Mapping' },
    ],
    'app',
    'D:\\Work\\Map\\Map.depthproject',
  );
  expect(grants.map((g) => g.writable)).toEqual([false, true]);
});
