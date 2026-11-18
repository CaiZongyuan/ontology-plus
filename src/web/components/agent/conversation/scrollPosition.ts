export const BOTTOM_STICKY_THRESHOLD_PX = 48;
export const CONVERSATION_SCROLL_STORAGE_KEY = 'onto_conversation_scroll_v1';
const MAX_PERSISTED_SESSIONS = 80;

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

export type ConversationScrollPosition =
  | { readonly atBottom: true }
  | { readonly atBottom: false; readonly scrollTop: number };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const memoryScrollBySession = new Map<string, ConversationScrollPosition>();

function resolveDefaultStorage(): StorageLike | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore restricted Web Storage environments
  }
  try {
    if (typeof globalThis !== 'undefined' && 'sessionStorage' in globalThis && globalThis.sessionStorage) {
      return globalThis.sessionStorage;
    }
  } catch {
    // Ignore restricted Web Storage environments
  }
  return null;
}

function isValidScrollPosition(value: unknown): value is ConversationScrollPosition {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.atBottom === true) return true;
  if (
    candidate.atBottom === false &&
    typeof candidate.scrollTop === 'number' &&
    Number.isFinite(candidate.scrollTop) &&
    candidate.scrollTop >= 0
  ) {
    return true;
  }
  return false;
}

function readStorageMap(storage: StorageLike | null): Record<string, ConversationScrollPosition> | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CONVERSATION_SCROLL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, ConversationScrollPosition> = {};
    for (const [sid, pos] of Object.entries(parsed as Record<string, unknown>)) {
      if (sid && isValidScrollPosition(pos)) {
        out[sid] = pos.atBottom
          ? { atBottom: true }
          : { atBottom: false, scrollTop: Math.max(0, Math.round(pos.scrollTop)) };
      }
    }
    return out;
  } catch {
    return null;
  }
}

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

export function resolveRestoredScrollMetrics(
  saved: ConversationScrollPosition | null | undefined,
  viewport: Pick<ScrollMetrics, 'clientHeight' | 'scrollHeight'>,
  thresholdPx: number = BOTTOM_STICKY_THRESHOLD_PX,
): { scrollTop: number; atBottom: boolean } {
  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  if (!saved || saved.atBottom) {
    return { scrollTop: maxScrollTop, atBottom: true };
  }
  const scrollTop = Math.min(maxScrollTop, Math.max(0, saved.scrollTop));
  const atBottom = isScrollNearBottom(
    {
      scrollTop,
      clientHeight: viewport.clientHeight,
      scrollHeight: viewport.scrollHeight,
    },
    thresholdPx,
  );
  return { scrollTop, atBottom };
}

export function readSessionScrollPosition(
  sessionId: string | undefined | null,
  storage?: StorageLike | null,
): ConversationScrollPosition | null {
  if (!sessionId) return null;
  const targetStorage = storage === undefined ? resolveDefaultStorage() : storage;
  const persisted = readStorageMap(targetStorage);
  if (persisted && Object.prototype.hasOwnProperty.call(persisted, sessionId)) {
    const entry = persisted[sessionId]!;
    memoryScrollBySession.set(sessionId, entry);
    return entry;
  }
  return memoryScrollBySession.get(sessionId) ?? null;
}

export function writeSessionScrollPosition(
  sessionId: string | undefined | null,
  position: ConversationScrollPosition,
  storage?: StorageLike | null,
): void {
  if (!sessionId) return;
  const normalized: ConversationScrollPosition = position.atBottom
    ? { atBottom: true }
    : { atBottom: false, scrollTop: Math.max(0, Math.round(position.scrollTop)) };

  memoryScrollBySession.delete(sessionId);
  memoryScrollBySession.set(sessionId, normalized);
  while (memoryScrollBySession.size > MAX_PERSISTED_SESSIONS) {
    const oldest = memoryScrollBySession.keys().next().value;
    if (!oldest) break;
    memoryScrollBySession.delete(oldest);
  }

  const targetStorage = storage === undefined ? resolveDefaultStorage() : storage;
  if (!targetStorage) return;
  try {
    const existing = readStorageMap(targetStorage) ?? {};
    delete existing[sessionId];
    existing[sessionId] = normalized;
    const keys = Object.keys(existing);
    if (keys.length > MAX_PERSISTED_SESSIONS) {
      for (const staleKey of keys.slice(0, keys.length - MAX_PERSISTED_SESSIONS)) {
        delete existing[staleKey];
      }
    }
    targetStorage.setItem(CONVERSATION_SCROLL_STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // Keep in-memory fallback when Web Storage throws
  }
}

export function clearConversationScrollMemoryForTests(): void {
  memoryScrollBySession.clear();
}
