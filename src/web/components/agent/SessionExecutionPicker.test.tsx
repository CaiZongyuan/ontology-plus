// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { LlmProviderConfig } from '../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../i18n.js';
import { SessionExecutionPicker } from './SessionExecutionPicker.js';

it('offers only enabled catalogs, groups duplicate model IDs by provider, and lets an empty session change concurrency', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  const provider: LlmProviderConfig = { id: 'a', name: 'A', providerType: 'OPENAI_COMPATIBLE', baseUrl: '', apiKey: '',
    enabled: true, defaultModel: 'shared', availableModels: ['shared'] };
  const render = (providers: LlmProviderConfig[]) => act(() => root.render(<PreferencesProvider>
    <SessionExecutionPicker providers={providers} saving={false} onChange={change} />
  </PreferencesProvider>));
  try {
    render([provider, { ...provider, id: 'b', name: 'B' }, { ...provider, enabled: false, id: 'off', name: 'OFF' }]);
    const trigger = host.querySelector('button')!;
    act(() => trigger.click());
    const [models, count] = host.querySelectorAll('select');
    expect([...models.querySelectorAll('optgroup')].map((group) => group.label)).toEqual(['A', 'B']);
    expect(models.options.length).toBe(3);
    models.value = models.options[2].value;
    act(() => models.dispatchEvent(new Event('change', { bubbles: true })));
    expect(change).toHaveBeenCalledWith({ providerId: 'b', modelOverride: 'shared' });
    render([]);
    expect(models.disabled).toBe(true);
    expect(count.value).toBe('3');
    expect([...count.options].map((option) => Number(option.value))).toEqual([1, 2, 3, 4, 5, 6]);
    count.value = '6';
    act(() => count.dispatchEvent(new Event('change', { bubbles: true })));
    expect(change).toHaveBeenCalledWith({ multiAgentConcurrency: 6 });
    act(() => count.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('select')).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
