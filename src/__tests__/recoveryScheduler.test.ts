import { RecoveryScheduler } from '../renderer/utils/recoveryScheduler';
import { recursiveFixture } from './recursiveFixtures';
const request = (revision: number, sessionId = 'session') => ({
  sessionId,
  revision,
  document: recursiveFixture(),
});
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it('checkpoints one second idle and at five seconds under continuous accepted edits; ignores duplicate revisions', async () => {
  const writer = {
    write: jest.fn(async (_value: ReturnType<typeof request>) => {}),
    remove: jest.fn(async () => {}),
  };
  const scheduler = new RecoveryScheduler(writer, jest.fn());
  scheduler.update(request(1));
  await jest.advanceTimersByTimeAsync(800);
  scheduler.update(request(2));
  await jest.advanceTimersByTimeAsync(999);
  expect(writer.write).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(writer.write.mock.calls[0][0]).toMatchObject({ revision: 2 });
  scheduler.update(request(2));
  await jest.advanceTimersByTimeAsync(1000);
  expect(writer.write).toHaveBeenCalledTimes(1);
  for (let i = 3; i < 13; i++) {
    scheduler.update(request(i));
    await jest.advanceTimersByTimeAsync(500);
  }
  expect(writer.write.mock.calls[1][0]).toMatchObject({ revision: 10 });
  scheduler.dispose();
});
it('serializes/coalesces slow writes, reports degradation, and preserves newer revisions during Save cleanup', async () => {
  let release!: () => void;
  const writer = {
    write: jest.fn(async (_value: ReturnType<typeof request>) => {}),
    remove: jest.fn(async (_id: string, _revision?: number) => {}),
  };
  writer.write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const status = jest.fn(),
    scheduler = new RecoveryScheduler(writer, status);
  scheduler.update(request(1));
  await jest.advanceTimersByTimeAsync(1000);
  scheduler.update(request(2));
  scheduler.update(request(3));
  await jest.advanceTimersByTimeAsync(5000);
  expect(writer.write).toHaveBeenCalledTimes(1);
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining('delayed'));
  const cleanup = scheduler.remove('session', 1);
  release();
  await cleanup;
  await jest.advanceTimersByTimeAsync(1000);
  expect(writer.write.mock.calls.map((call) => call[0].revision)).toEqual([
    1, 3,
  ]);
  expect(status).toHaveBeenLastCalledWith('');
  scheduler.update(request(4));
  await scheduler.remove('session');
  scheduler.update(request(5));
  await jest.advanceTimersByTimeAsync(6000);
  expect(writer.write).toHaveBeenCalledTimes(2);
  expect(writer.remove).toHaveBeenLastCalledWith('session', undefined);
  scheduler.dispose();
});
it('retries failed storage without busy looping, coalesces edits, and isolates session cleanup', async () => {
  const writer = {
    write: jest.fn(async (_value: ReturnType<typeof request>) => {}),
    remove: jest.fn(async () => {}),
  };
  writer.write.mockRejectedValueOnce(new Error('disk full'));
  const status = jest.fn(),
    scheduler = new RecoveryScheduler(writer, status);
  scheduler.update(request(1));
  await jest.advanceTimersByTimeAsync(1000);
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining('disk full'));
  scheduler.update(request(2));
  scheduler.update(request(1, 'other'));
  await scheduler.remove('session');
  await jest.advanceTimersByTimeAsync(1000);
  expect(writer.write.mock.calls.map((call) => call[0].sessionId)).toEqual([
    'session',
    'other',
  ]);
  scheduler.dispose();
});
