// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { restorePendingCancellation, useWorkbenchStore } from '../api.js';

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); vi.useRealTimers(); });

it('restores an offline stop before resending, and keeps it visible until the backend confirms', async () => {
  vi.useFakeTimers();
  const sessionId = 'interrupted-offline';
  const key = `onto_pending_cancel:${sessionId}`;
  sessionStorage.setItem(key, JSON.stringify({ submissionId: 'same-submission' }));
  const fetchImpl = vi.fn()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(Response.json({ acknowledged: true, aborted: true }));
  vi.stubGlobal('fetch', fetchImpl);
  expect(restorePendingCancellation(sessionId)).toBe(true);
  const done = useWorkbenchStore.getState().cancelSessionAgentRun(sessionId);
  await vi.advanceTimersByTimeAsync(1);
  expect(useWorkbenchStore.getState().liveSessionDrafts[sessionId]?.cancellationPending).toBe(true);
  expect(sessionStorage.getItem(key)).not.toBeNull();
  await vi.advanceTimersByTimeAsync(600);
  await done;
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls.map(call => [call[0], JSON.parse(call[1].body)])).toEqual(Array(2).fill([`/api/agent-sessions/${sessionId}/abort`, { submissionId: 'same-submission' }]));
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(useWorkbenchStore.getState().liveSessionDrafts[sessionId]).toBeUndefined();
});
