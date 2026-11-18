export type ThemeMode = 'light' | 'dark';
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark'];

/** Contract token name (without `--`) to CSS value. */
export type ThemeTokenTable = Readonly<Record<string, string>>;

/** A Workbench Theme: a name and one table of contract values per mode. */
export interface WorkbenchTheme {
  /** Lowercase letters, digits, and hyphens; written to `data-workbench-theme`. */
  id: string;
  name: { zh: string; en: string };
  light: ThemeTokenTable;
  dark: ThemeTokenTable;
}

export const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
