import { afterEach, expect, it, vi } from 'vitest';
import { withStreamWatchdog } from './sessionRecovery.js';

afterEach(() => vi.useRealTimers());

it('detects a half-open stream from its last heartbeat without stopping the parent run', async () => {
  vi.useFakeTimers();
  const run = new AbortController();
  let received = () => {};
  const observed = withStreamWatchdog(run.signal, (signal, activity) => {
    received = activity;
    return new Promise(resolve => signal.addEventListener('abort', () => resolve('disconnected')));
  }, 1000);
  await vi.advanceTimersByTimeAsync(850);
  received();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(observed).resolves.toBe('disconnected');
  expect(run.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
