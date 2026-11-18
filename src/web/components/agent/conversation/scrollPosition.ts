import { createSessionStorageLru, type WebStorageLike } from './sessionStorageLru.js';

export const BOTTOM_STICKY_THRESHOLD_PX = 48;
export const CONVERSATION_SCROLL_STORAGE_KEY = 'onto_conversation_scroll_v1';

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

export type ConversationScrollPosition =
  | { readonly atBottom: true }
  | { readonly atBottom: false; readonly scrollTop: number };

export type StorageLike = WebStorageLike;

function normalizeScrollPosition(value: unknown): ConversationScrollPosition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.atBottom === true) return { atBottom: true };
  if (
    candidate.atBottom === false &&
    typeof candidate.scrollTop === 'number' &&
    Number.isFinite(candidate.scrollTop) &&
    candidate.scrollTop >= 0
  ) {
    return { atBottom: false, scrollTop: Math.max(0, Math.round(candidate.scrollTop)) };
  }
  return null;
}

const scrollLru = createSessionStorageLru<ConversationScrollPosition>({
  storageKey: CONVERSATION_SCROLL_STORAGE_KEY,
  normalize: normalizeScrollPosition,
  clone: (pos) => (pos.atBottom ? { atBottom: true } : { atBottom: false, scrollTop: pos.scrollTop }),
});

export function isScrollNearBottom(
  metrics: ScrollMetrics,
  thresholdPx: number = BOTTOM_STICKY_THRESHOLD_PX,
): boolean {
  if (metrics.scrollHeight <= metrics.clientHeight) return true;
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= thresholdPx;
}

export function deriveScrollPositionFromMetrics(
  metrics: ScrollMetrics,
  thresholdPx: number = BOTTOM_STICKY_THRESHOLD_PX,
): ConversationScrollPosition {
  if (isScrollNearBottom(metrics, thresholdPx)) {
    return { atBottom: true };
  }
  return {
    atBottom: false,
    scrollTop: Math.max(0, Math.round(metrics.scrollTop)),
  };
}

/**
 * Resolves the initial `scrollTop` and `atBottom` state when restoring a conversation.
 * When `saved.atBottom === false`, keeps `atBottom: false` even if `saved.scrollTop` is
 * temporarily clamped to a smaller pre-async `maxScrollTop` (e.g. before async Mermaid diagrams expand).
 */
export function resolveRestoredScrollMetrics(
  saved: ConversationScrollPosition | null | undefined,
  viewport: Pick<ScrollMetrics, 'clientHeight' | 'scrollHeight'>,
  _thresholdPx: number = BOTTOM_STICKY_THRESHOLD_PX,
): { scrollTop: number; atBottom: boolean } {
  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  if (!saved || saved.atBottom) {
    return { scrollTop: maxScrollTop, atBottom: true };
  }
  const scrollTop = Math.min(maxScrollTop, Math.max(0, saved.scrollTop));
  return { scrollTop, atBottom: false };
}

export function readSessionScrollPosition(
  sessionId: string | undefined | null,
  storage?: StorageLike | null,
): ConversationScrollPosition | null {
  return scrollLru.read(sessionId, storage);
}

export function writeSessionScrollPosition(
  sessionId: string | undefined | null,
  position: ConversationScrollPosition,
  storage?: StorageLike | null,
): void {
  const normalized = normalizeScrollPosition(position);
  if (!normalized) return;
  scrollLru.write(sessionId, normalized, storage);
}

export function clearConversationScrollMemoryForTests(): void {
  scrollLru.clearMemory();
}
