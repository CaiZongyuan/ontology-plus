export async function withStreamWatchdog<T>(parent: AbortSignal | undefined, work: (signal: AbortSignal, activity: () => void) => Promise<T>, idleMs = 30_000) {
  const attempt = new AbortController();
  const signal = parent ? AbortSignal.any([parent, attempt.signal]) : attempt.signal;
  let timer: ReturnType<typeof setTimeout>;
  const activity = () => {
    clearTimeout(timer);
    timer = setTimeout(() => attempt.abort(new Error('Stream heartbeat timeout')), idleMs);
  };
  activity();
  try { return await work(signal, activity); }
  finally { clearTimeout(timer!); }
}

export function waitForRecovery(signal: AbortSignal, attempt: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const wake = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', wake);
      globalThis.removeEventListener?.('online', wake);
      globalThis.removeEventListener?.('pageshow', wake);
      globalThis.document?.removeEventListener('visibilitychange', visible);
      resolve();
    };
    const visible = () => { if (!document.hidden) wake(); };
    const timer = setTimeout(wake, Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)));
    signal.addEventListener('abort', wake, { once: true });
    globalThis.addEventListener?.('online', wake);
    globalThis.addEventListener?.('pageshow', wake);
    globalThis.document?.addEventListener('visibilitychange', visible);
  });
}

export async function reconcileSessionStream(options: {
  signal: AbortSignal;
  ended: () => boolean;
  attach: () => Promise<'absent' | void>;
  resend?: () => Promise<void>;
  onAbsentAfterResend?: () => void;
  onWaiting: () => void;
}) {
  let resent = false;
  for (let attempt = 0; !options.signal.aborted && !options.ended(); attempt++) {
    if (attempt > 0) await waitForRecovery(options.signal, attempt - 1);
    if (options.signal.aborted || options.ended()) return;
    try {
      const result = await options.attach();
      if (result === 'absent' && options.resend && !options.signal.aborted) {
        if (resent) { options.onAbsentAfterResend?.(); return; }
        resent = true;
        await options.resend();
      }
    } catch {}
    if (!options.ended() && !options.signal.aborted) options.onWaiting();
  }
}
