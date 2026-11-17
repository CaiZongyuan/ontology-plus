import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, THEME_ID_PATTERN } from '../packages/workbench-theme/index.js';
import { THEME_MODE_STORAGE_KEY, WORKBENCH_THEME_STORAGE_KEY } from './i18n.js';

/**
 * index.html sets the mode and the Workbench Theme before the app loads, so the first paint
 * is already right. Its inline script cannot import, so it repeats the storage keys and the
 * theme id pattern; these tests keep the copies in step with the app's.
 */
const indexHtml = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../index.html'),
  'utf8',
);
const firstPaintScript = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)![1]!;

/** Runs the first-paint script against the given stored values; returns the root dataset. */
function firstPaint(stored: Record<string, string>): Record<string, string | undefined> {
  const dataset: Record<string, string | undefined> = {};
  const localStorage = { getItem: (key: string) => (key in stored ? stored[key]! : null) };
  const document = { documentElement: { dataset }, querySelector: () => null };
  const window = { matchMedia: () => ({ matches: false }) };
  new Function('localStorage', 'document', 'window', firstPaintScript)(localStorage, document, window);
  return dataset;
}

describe('the first-paint script in index.html', () => {
  it('reads the mode from the key the app stores it under', () => {
    expect(firstPaint({ [THEME_MODE_STORAGE_KEY]: 'dark' }).theme).toBe('dark');
    expect(firstPaint({ [THEME_MODE_STORAGE_KEY]: 'light' }).theme).toBe('light');
  });

  it('reads the Workbench Theme from the key the app stores it under, for every built-in theme', () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(firstPaint({ [WORKBENCH_THEME_STORAGE_KEY]: theme.id }).workbenchTheme).toBe(theme.id);
    }
  });

  it('accepts exactly the theme ids the theme module accepts', () => {
    const pattern = /\/(\^[^/]+\$)\/\.test\(workbenchTheme\)/.exec(firstPaintScript)?.[1];
    expect(pattern).toBe(THEME_ID_PATTERN.source);
    expect(firstPaint({ [WORKBENCH_THEME_STORAGE_KEY]: 'Not Valid' }).workbenchTheme).toBeUndefined();
  });
});
