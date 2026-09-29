import { afterEach, expect, test, vi } from 'vitest';
import { createPersistenceScheduler } from '../app/web/persistenceScheduler.js';

afterEach(() => vi.useRealTimers());

test('idle saves capture the latest position and continuous scroll has a bounded wait', async () => {
  vi.useFakeTimers();
  let position = 0;
  const saved: number[] = [];
  const scheduler = createPersistenceScheduler(async () => { saved.push(position); });
  for (let i = 1; i <= 10; i++) {
    position = i;
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(saved).toEqual([10]);
  position = 11; scheduler.schedule();
  await vi.advanceTimersByTimeAsync(250);
  expect(saved).toEqual([10, 11]);
});

test('explicit flush captures current state immediately and clears both timers', async () => {
  vi.useFakeTimers();
  let position = 1;
  const save = vi.fn(async () => position);
  const scheduler = createPersistenceScheduler(async () => { await save(); });
  scheduler.schedule();
  position = 2;
  await scheduler.flush();
  expect(save).toHaveBeenCalledTimes(1);
  expect(await save.mock.results[0].value).toBe(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(save).toHaveBeenCalledTimes(1);
});

test('failures are exposed to explicit callers and later saves still run', async () => {
  vi.useFakeTimers();
  const save = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined);
  const scheduler = createPersistenceScheduler(save);
  await expect(scheduler.flush()).rejects.toThrow('quota');
  scheduler.schedule();
  await vi.advanceTimersByTimeAsync(250);
  expect(save).toHaveBeenCalledTimes(2);
  scheduler.schedule(); scheduler.cancel();
  await vi.advanceTimersByTimeAsync(2000);
  expect(save).toHaveBeenCalledTimes(2);
});
