import { DEFAULT_NEUTRAL } from './themes/default.js';
import { WARM_PAPER } from './themes/warm-paper.js';
import type { WorkbenchTheme } from './types.js';

/** The first theme is the one a device gets when it has not chosen. */
export const BUILT_IN_THEMES: readonly WorkbenchTheme[] = [DEFAULT_NEUTRAL, WARM_PAPER];

export const DEFAULT_THEME_ID: string = BUILT_IN_THEMES[0]!.id;

export function findTheme(id: string): WorkbenchTheme | undefined {
  return BUILT_IN_THEMES.find((theme) => theme.id === id);
}

/** The id to apply for whatever was stored: itself when it names a built-in theme, the default otherwise. */
export function resolveThemeId(stored: unknown): string {
  return typeof stored === 'string' && findTheme(stored) ? stored : DEFAULT_THEME_ID;
}
