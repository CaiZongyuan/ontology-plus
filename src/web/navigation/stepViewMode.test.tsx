import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectStepId } from '../../packages/business-vocabulary/index.js';
import {
  STEP_VIEW_MODE_STORAGE_PREFIX,
  getStepViewModeStorageKey,
  parseStepViewMode,
  readStepViewMode,
  subscribeStepViewMode,
  useStepViewMode,
  writeStepViewMode,
} from './index.js';

function createMemoryStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    snapshot: () => Object.fromEntries(store.entries()),
  };
}

function StepProbe({ step }: { step: ProjectStepId }) {
  const [mode] = useStepViewMode(step);
  return <div data-step={step} data-mode={mode} />;
}

describe('stepViewMode per-step device-local preference (#68)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults every step to business view and isolates each step key without a global switch', () => {
    const storage = createMemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });

    expect(getStepViewModeStorageKey('BUSINESS_MODEL')).toBe(
      `${STEP_VIEW_MODE_STORAGE_PREFIX}BUSINESS_MODEL`,
    );
    expect(readStepViewMode('REQUIREMENTS')).toBe('business');
    expect(readStepViewMode('PROTOTYPE')).toBe('business');
    expect(readStepViewMode('BUSINESS_MODEL')).toBe('business');
    expect(readStepViewMode('DELIVERY')).toBe('business');

    writeStepViewMode('BUSINESS_MODEL', 'technical');

    expect(readStepViewMode('BUSINESS_MODEL')).toBe('technical');
    expect(readStepViewMode('REQUIREMENTS')).toBe('business');
    expect(readStepViewMode('PROTOTYPE')).toBe('business');
    expect(readStepViewMode('DELIVERY')).toBe('business');
    expect(storage.snapshot()).toEqual({
      onto_step_view_mode_BUSINESS_MODEL: 'technical',
    });
  });

  it('falls back safely to business on unknown stored values or missing window', () => {
    expect(parseStepViewMode(null)).toBe('business');
    expect(parseStepViewMode(undefined)).toBe('business');
    expect(parseStepViewMode('corrupted')).toBe('business');
    expect(parseStepViewMode('technical')).toBe('technical');
    expect(parseStepViewMode('business')).toBe('business');

    const storage = createMemoryStorage({
      onto_step_view_mode_BUSINESS_MODEL: 'unexpected-value',
    });
    vi.stubGlobal('window', { localStorage: storage });
    expect(readStepViewMode('BUSINESS_MODEL')).toBe('business');
  });

  it('notifies subscribers only for the mutated step and renders via useStepViewMode in SSR', () => {
    const storage = createMemoryStorage({
      onto_step_view_mode_BUSINESS_MODEL: 'technical',
    });
    vi.stubGlobal('window', { localStorage: storage });

    const bmListener = vi.fn();
    const deliveryListener = vi.fn();
    const unsubBm = subscribeStepViewMode('BUSINESS_MODEL', bmListener);
    const unsubDel = subscribeStepViewMode('DELIVERY', deliveryListener);

    writeStepViewMode('BUSINESS_MODEL', 'business');
    expect(bmListener).toHaveBeenCalledTimes(1);
    expect(deliveryListener).not.toHaveBeenCalled();

    writeStepViewMode('BUSINESS_MODEL', 'technical');
    const html = renderToStaticMarkup(
      <>
        <StepProbe step="BUSINESS_MODEL" />
        <StepProbe step="DELIVERY" />
      </>,
    );
    expect(html).toContain('data-step="BUSINESS_MODEL" data-mode="technical"');
    expect(html).toContain('data-step="DELIVERY" data-mode="business"');

    unsubBm();
    unsubDel();
  });
});
