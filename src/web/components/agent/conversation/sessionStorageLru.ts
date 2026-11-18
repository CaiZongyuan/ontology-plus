export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function resolveBrowserStorage(): WebStorageLike | null {
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

/**
 * Shared per-session persisted LRU map backed by `localStorage`/`sessionStorage` with an
 * in-memory fallback when Web Storage is unavailable or throws (SSR, tests, or quota errors).
 */
export function createSessionStorageLru<T>(options: {
  readonly storageKey: string;
  readonly maxEntries?: number;
  readonly normalize: (raw: unknown) => T | null;
  readonly clone?: (entry: T) => T;
}) {
  const maxEntries = options.maxEntries ?? 80;
  const clone = options.clone ?? ((v: T) => v);
  const memory = new Map<string, T>();

  const readPersistedMap = (storage: WebStorageLike | null): Record<string, T> | null => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(options.storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, T> = {};
      for (const [sid, rawVal] of Object.entries(parsed as Record<string, unknown>)) {
        if (!sid) continue;
        const normalized = options.normalize(rawVal);
        if (normalized !== null) {
          out[sid] = normalized;
        }
      }
      return out;
    } catch {
      return null;
    }
  };

  return {
    read(sessionId: string | undefined | null, storage?: WebStorageLike | null): T | null {
      if (!sessionId) return null;
      const target = storage === undefined ? resolveBrowserStorage() : storage;
      const persisted = readPersistedMap(target);
      if (persisted && Object.prototype.hasOwnProperty.call(persisted, sessionId)) {
        const entry = persisted[sessionId]!;
        memory.set(sessionId, entry);
        return clone(entry);
      }
      const mem = memory.get(sessionId);
      if (mem !== undefined && (!persisted || target === null)) {
        return clone(mem);
      }
      return null;
    },

    write(sessionId: string | undefined | null, value: T, storage?: WebStorageLike | null): void {
      if (!sessionId) return;
      memory.delete(sessionId);
      memory.set(sessionId, value);
      while (memory.size > maxEntries) {
        const oldest = memory.keys().next().value;
        if (!oldest) break;
        memory.delete(oldest);
      }

      const target = storage === undefined ? resolveBrowserStorage() : storage;
      if (!target) return;
      try {
        const existing = readPersistedMap(target) ?? {};
        delete existing[sessionId];
        existing[sessionId] = value;
        const keys = Object.keys(existing);
        if (keys.length > maxEntries) {
          for (const staleKey of keys.slice(0, keys.length - maxEntries)) {
            delete existing[staleKey];
          }
        }
        target.setItem(options.storageKey, JSON.stringify(existing));
      } catch {
        // Keep in-memory fallback when Web Storage throws
      }
    },

    remove(sessionId: string | undefined | null, storage?: WebStorageLike | null): void {
      if (!sessionId) return;
      memory.delete(sessionId);
      const target = storage === undefined ? resolveBrowserStorage() : storage;
      if (!target) return;
      try {
        const existing = readPersistedMap(target);
        if (!existing || !Object.prototype.hasOwnProperty.call(existing, sessionId)) return;
        delete existing[sessionId];
        if (Object.keys(existing).length === 0 && target.removeItem) {
          target.removeItem(options.storageKey);
        } else {
          target.setItem(options.storageKey, JSON.stringify(existing));
        }
      } catch {
        // Ignore storage errors
      }
    },

    clearMemory(): void {
      memory.clear();
    },
  };
}
