import { afterEach, describe, expect, it } from 'vitest';
import {
  BOTTOM_STICKY_THRESHOLD_PX,
  clearConversationScrollMemoryForTests,
  deriveScrollPositionFromMetrics,
  isScrollNearBottom,
  readSessionScrollPosition,
  resolveRestoredScrollMetrics,
  writeSessionScrollPosition,
  type StorageLike,
} from './scrollPosition.js';

function createFakeStorage(): StorageLike & { dump: () => Record<string, string> } {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    dump: () => Object.fromEntries(store.entries()),
  };
}

describe('conversation scrollPosition seam (#79)', () => {
  afterEach(() => {
    clearConversationScrollMemoryForTests();
  });

  it('treats viewports within threshold (or non-overflowing content) as sticky at-bottom, and scrolled-up offsets as non-sticky', () => {
    // Non-overflowing content is always at bottom
    expect(
      isScrollNearBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 320 }),
    ).toBe(true);

    // Exact threshold boundary stays sticky
    expect(
      isScrollNearBottom({
        scrollTop: 1000 - 400 - BOTTOM_STICKY_THRESHOLD_PX,
        clientHeight: 400,
        scrollHeight: 1000,
      }),
    ).toBe(true);

    // 1px further up disarms sticky auto-scroll and records scrollTop
    const scrolledUpMetrics = {
      scrollTop: 1000 - 400 - BOTTOM_STICKY_THRESHOLD_PX - 1,
      clientHeight: 400,
      scrollHeight: 1000,
    };
    expect(isScrollNearBottom(scrolledUpMetrics)).toBe(false);
    expect(deriveScrollPositionFromMetrics(scrolledUpMetrics)).toEqual({
      atBottom: false,
      scrollTop: 551,
    });
  });

  it('persists per-session scroll offsets independently across session switches and simulated browser reloads', () => {
    const storage = createFakeStorage();

    writeSessionScrollPosition('sess-req-a', { atBottom: false, scrollTop: 240 }, storage);
    writeSessionScrollPosition('sess-req-b', { atBottom: true }, storage);

    expect(readSessionScrollPosition('sess-req-a', storage)).toEqual({
      atBottom: false,
      scrollTop: 240,
    });
    expect(readSessionScrollPosition('sess-req-b', storage)).toEqual({
      atBottom: true,
    });
    expect(readSessionScrollPosition('sess-req-unvisited', storage)).toBeNull();

    // Simulate full browser reload: clear in-memory fallback while keeping persisted storage
    clearConversationScrollMemoryForTests();

    const restoredA = readSessionScrollPosition('sess-req-a', storage);
    expect(restoredA).toEqual({ atBottom: false, scrollTop: 240 });
    expect(
      resolveRestoredScrollMetrics(restoredA, { clientHeight: 400, scrollHeight: 1200 }),
    ).toEqual({
      scrollTop: 240,
      atBottom: false,
    });

    const restoredB = readSessionScrollPosition('sess-req-b', storage);
    expect(
      resolveRestoredScrollMetrics(restoredB, { clientHeight: 400, scrollHeight: 1200 }),
    ).toEqual({
      scrollTop: 800,
      atBottom: true,
    });
  });

  it('falls back cleanly to in-memory storage when Web Storage throws or is unavailable', () => {
    const brokenStorage: StorageLike = {
      getItem: () => {
        throw new Error('QuotaExceeded or SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded or SecurityError');
      },
    };

    writeSessionScrollPosition('sess-fallback', { atBottom: false, scrollTop: 185 }, brokenStorage);
    expect(readSessionScrollPosition('sess-fallback', brokenStorage)).toEqual({
      atBottom: false,
      scrollTop: 185,
    });
  });

  it('keeps atBottom=false when restoring a non-bottom scroll position before async Mermaid content expands scrollHeight (#85)', () => {
    // Before async Mermaid finishes rendering, scrollHeight (560) is only 60px taller than clientHeight (500).
    // Even though clamped scrollTop (60) is within BOTTOM_STICKY_THRESHOLD_PX of pre-async bottom,
    // saved.atBottom === false MUST stay false so ResizeObserver does not yank scroll to bottom on expansion!
    const preAsync = resolveRestoredScrollMetrics(
      { atBottom: false, scrollTop: 420 },
      { clientHeight: 500, scrollHeight: 560 },
    );
    expect(preAsync).toEqual({
      scrollTop: 60,
      atBottom: false,
    });
  });
});
