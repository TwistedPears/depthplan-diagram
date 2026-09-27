import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '../renderer/desktop';

jest.mock('@tauri-apps/api/core', () => ({ invoke: jest.fn() }));
jest.mock('@tauri-apps/api/event', () => ({ listen: jest.fn() }));

test.each(['active', 'revoked', 'disposed'])(
  'initializes an existing automation session safely: %s',
  async (mode) => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    let resolveStatus!: (value: unknown) => void;
    (listen as jest.Mock).mockImplementation(async (channel, callback) => {
      listeners.set(channel, callback);
      return jest.fn();
    });
    (invoke as jest.Mock).mockImplementation((_command, { method }) =>
      method === 'automation:status'
        ? new Promise((resolve) => {
            resolveStatus = resolve;
          })
        : Promise.resolve(),
    );
    const handler = jest.fn().mockResolvedValue({ ok: true });
    const stop = window.desktop.automation.onRequest(handler);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (mode === 'revoked')
      listeners.get('automation:state')!({
        payload: { enabled: false, generation: 3 },
      });
    if (mode === 'disposed') stop();
    resolveStatus({ enabled: true, generation: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    listeners.get('automation:request')!({
      payload: { id: 'request', generation: 2 },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handler).toHaveBeenCalledTimes(mode === 'active' ? 1 : 0);
    stop();
  },
);

it('delivers startup and live OS requests once even when the startup snapshot arrives late', async () => {
  let receive!: (event: { payload: string }) => void;
  let snapshot!: (ids: string[]) => void;
  const unlisten = jest.fn();
  (listen as jest.Mock).mockImplementation(async (_channel, callback) => {
    receive = callback;
    return unlisten;
  });
  (invoke as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        snapshot = resolve;
      }),
  );
  const opened = jest.fn();
  const stop = window.desktop.fileSystem.onOpenRequested(opened);
  await Promise.resolve();
  receive({ payload: 'already-handled' });
  expect(opened).toHaveBeenCalledTimes(1);
  snapshot(['already-handled', 'startup-only']);
  // Flush the native promise and its snapshot delivery.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(opened.mock.calls).toEqual([['already-handled'], ['startup-only']]);
  stop();
  receive({ payload: 'after-unsubscribe' });
  await Promise.resolve();
  expect(unlisten).toHaveBeenCalledTimes(1);
  expect(opened).toHaveBeenCalledTimes(2);
});
