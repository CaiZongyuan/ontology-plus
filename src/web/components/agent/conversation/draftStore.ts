export const CONVERSATION_DRAFT_STORAGE_KEY = 'onto_conversation_draft_v1';
const MAX_PERSISTED_SESSIONS = 80;

export interface ConversationSessionDraft {
  readonly text: string;
  readonly quotes: readonly string[];
}

export const EMPTY_CONVERSATION_DRAFT: ConversationSessionDraft = {
  text: '',
  quotes: [],
};

export interface DraftStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const memoryDraftBySession = new Map<string, ConversationSessionDraft>();

function resolveDefaultStorage(): DraftStorageLike | null {
  try {
    if (
      typeof globalThis !== 'undefined' &&
      'localStorage' in globalThis &&
      globalThis.localStorage
    ) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore restricted Web Storage environments
  }
  try {
    if (
      typeof globalThis !== 'undefined' &&
      'sessionStorage' in globalThis &&
      globalThis.sessionStorage
    ) {
      return globalThis.sessionStorage;
    }
  } catch {
    // Ignore restricted Web Storage environments
  }
  return null;
}

function normalizeDraft(value: unknown): ConversationSessionDraft | null {
  if (typeof value === 'string') {
    return { text: value, quotes: [] };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const text = typeof candidate.text === 'string' ? candidate.text : '';
  const quotes = Array.isArray(candidate.quotes)
    ? candidate.quotes.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    : [];
  return { text, quotes };
}

export function isConversationDraftEmpty(draft: ConversationSessionDraft): boolean {
  return draft.text.length === 0 && draft.quotes.length === 0;
}

function readStorageMap(
  storage: DraftStorageLike | null,
): Record<string, ConversationSessionDraft> | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CONVERSATION_DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, ConversationSessionDraft> = {};
    for (const [sid, rawDraft] of Object.entries(parsed as Record<string, unknown>)) {
      if (!sid) continue;
      const normalized = normalizeDraft(rawDraft);
      if (normalized && !isConversationDraftEmpty(normalized)) {
        out[sid] = normalized;
      }
    }
    return out;
  } catch {
    return null;
  }
}

export function readSessionDraft(
  sessionId: string | undefined | null,
  storage?: DraftStorageLike | null,
): ConversationSessionDraft {
  if (!sessionId) return EMPTY_CONVERSATION_DRAFT;
  const targetStorage = storage === undefined ? resolveDefaultStorage() : storage;
  const persisted = readStorageMap(targetStorage);
  if (persisted && Object.prototype.hasOwnProperty.call(persisted, sessionId)) {
    const entry = persisted[sessionId]!;
    memoryDraftBySession.set(sessionId, entry);
    return { text: entry.text, quotes: [...entry.quotes] };
  }
  const mem = memoryDraftBySession.get(sessionId);
  if (mem && (!persisted || targetStorage === null)) {
    return { text: mem.text, quotes: [...mem.quotes] };
  }
  return EMPTY_CONVERSATION_DRAFT;
}

export function writeSessionDraft(
  sessionId: string | undefined | null,
  draft: ConversationSessionDraft,
  storage?: DraftStorageLike | null,
): void {
  if (!sessionId) return;
  const normalized: ConversationSessionDraft = {
    text: draft.text,
    quotes: draft.quotes.filter((q) => q.trim().length > 0),
  };

  if (isConversationDraftEmpty(normalized)) {
    clearSessionDraft(sessionId, storage);
    return;
  }

  memoryDraftBySession.delete(sessionId);
  memoryDraftBySession.set(sessionId, normalized);
  while (memoryDraftBySession.size > MAX_PERSISTED_SESSIONS) {
    const oldest = memoryDraftBySession.keys().next().value;
    if (!oldest) break;
    memoryDraftBySession.delete(oldest);
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
    targetStorage.setItem(CONVERSATION_DRAFT_STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // Keep in-memory fallback when Web Storage throws
  }
}

export function clearSessionDraft(
  sessionId: string | undefined | null,
  storage?: DraftStorageLike | null,
): void {
  if (!sessionId) return;
  memoryDraftBySession.delete(sessionId);
  const targetStorage = storage === undefined ? resolveDefaultStorage() : storage;
  if (!targetStorage) return;
  try {
    const existing = readStorageMap(targetStorage);
    if (!existing || !Object.prototype.hasOwnProperty.call(existing, sessionId)) return;
    delete existing[sessionId];
    if (Object.keys(existing).length === 0 && targetStorage.removeItem) {
      targetStorage.removeItem(CONVERSATION_DRAFT_STORAGE_KEY);
    } else {
      targetStorage.setItem(CONVERSATION_DRAFT_STORAGE_KEY, JSON.stringify(existing));
    }
  } catch {
    // Ignore storage errors
  }
}

export function clearConversationDraftMemoryForTests(): void {
  memoryDraftBySession.clear();
}
