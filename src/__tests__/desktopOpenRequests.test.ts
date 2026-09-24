import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '../renderer/desktop';

jest.mock('@tauri-apps/api/core', () => ({ invoke: jest.fn() }));
jest.mock('@tauri-apps/api/event', () => ({ listen: jest.fn() }));

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
