import { useCallback, useSyncExternalStore } from 'react';
import type { ProjectStepId } from '../../packages/business-vocabulary/index.js';

export type StepViewMode = 'business' | 'technical';

export const STEP_VIEW_MODE_STORAGE_PREFIX = 'onto_step_view_mode_';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getStorage(): StorageLike | undefined {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
  return undefined;
}

const listenersByStep = new Map<ProjectStepId, Set<() => void>>();

function notifyStepListeners(step: ProjectStepId): void {
  const set = listenersByStep.get(step);
  if (!set) return;
  for (const listener of [...set]) {
    listener();
  }
}

export function getStepViewModeStorageKey(step: ProjectStepId): string {
  return `${STEP_VIEW_MODE_STORAGE_PREFIX}${step}`;
}

export function parseStepViewMode(raw: string | null | undefined): StepViewMode {
  return raw === 'technical' ? 'technical' : 'business';
}

export function readStepViewMode(step: ProjectStepId): StepViewMode {
  const storage = getStorage();
  if (!storage) return 'business';
  try {
    return parseStepViewMode(storage.getItem(getStepViewModeStorageKey(step)));
  } catch {
    return 'business';
  }
}

export function writeStepViewMode(step: ProjectStepId, mode: StepViewMode): void {
  const normalized = parseStepViewMode(mode);
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(getStepViewModeStorageKey(step), normalized);
    } catch {
      // Ignore quota errors
    }
  }
  notifyStepListeners(step);
}

export function subscribeStepViewMode(step: ProjectStepId, listener: () => void): () => void {
  let set = listenersByStep.get(step);
  if (!set) {
    set = new Set();
    listenersByStep.set(step, set);
  }
  set.add(listener);

  const key = getStepViewModeStorageKey(step);
  const onStorage = (e: StorageEvent) => {
    if (e.key === key || e.key === null) {
      listener();
    }
  };
  const canListenWindow =
    typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (canListenWindow) {
    window.addEventListener('storage', onStorage);
  }

  return () => {
    set?.delete(listener);
    if (canListenWindow && typeof window.removeEventListener === 'function') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

/**
 * Per-step device-local preference between Business View (`'business'`, default)
 * and Technical Details (`'technical'`). Each step stores its own choice under
 * `onto_step_view_mode_<STEP>` with zero global switch (Spec #37 §9, User Story 63).
 */
export function useStepViewMode(
  step: ProjectStepId,
): readonly [StepViewMode, (next: StepViewMode) => void] {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeStepViewMode(step, onStoreChange),
    [step],
  );
  const getSnapshot = useCallback(() => readStepViewMode(step), [step]);
  const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setMode = useCallback(
    (next: StepViewMode) => {
      writeStepViewMode(step, next);
    },
    [step],
  );
  return [mode, setMode] as const;
}
