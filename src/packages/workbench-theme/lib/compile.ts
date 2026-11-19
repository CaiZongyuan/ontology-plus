import { DERIVED_VARIABLES, THEME_TOKENS, cssVarName } from './contract.js';
import { contrastRatio } from './color.js';
import { BUILT_IN_THEMES, DEFAULT_THEME_ID, findTheme, resolveThemeId } from './themes.js';
import type { ThemeMode, WorkbenchTheme } from './types.js';

const SPEC_BY_NAME = new Map(THEME_TOKENS.map((spec) => [spec.name, spec]));

/**
 * The value of every contract token for one mode. A token the theme leaves
 * unset takes the value of the token it follows; one with nothing to follow
 * is absent from the result.
 */
export function resolveThemeTokens(theme: WorkbenchTheme, mode: ThemeMode): Record<string, string> {
  const table = theme[mode];
  const resolved: Record<string, string> = {};
  const lookup = (name: string, seen: readonly string[]): string | undefined => {
    const own = table[name]?.trim();
    if (own) return own;
    const fallback = SPEC_BY_NAME.get(name)?.fallback;
    if (!fallback || seen.includes(fallback)) return undefined;
    return lookup(fallback, [...seen, name]);
  };
  for (const spec of THEME_TOKENS) {
    const value = lookup(spec.name, []);
    if (value !== undefined) resolved[spec.name] = value;
  }
  return resolved;
}

function block(selector: string, declarations: readonly string[], indent = ''): string {
  if (declarations.length === 0) return '';
  const body = declarations.map((line) => `${indent}  ${line}`).join('\n');
  return `${indent}${selector.split('\n').join(`\n${indent}`)} {\n${body}\n${indent}}\n`;
}

export interface CompileThemeOptions {
  /**
   * The default theme is written on bare `:root`, so the page is styled before
   * any attribute is set. Every other theme is scoped to its
   * `data-workbench-theme` attribute.
   */
  isDefault?: boolean;
}

/**
 * A theme as CSS custom properties: every token for light, then the dark
 * values (for the default theme only those that differ from light) under both
 * the system-preference query and the explicit `data-theme="dark"` choice.
 */
export function compileThemeCss(theme: WorkbenchTheme, options: CompileThemeOptions = {}): string {
  const light = resolveThemeTokens(theme, 'light');
  const dark = resolveThemeTokens(theme, 'dark');
  const declare = (tokens: Record<string, string>, only?: (name: string) => boolean) =>
    THEME_TOKENS.filter((spec) => spec.name in tokens && (!only || only(spec.name))).map(
      (spec) => `${cssVarName(spec.name)}: ${tokens[spec.name]};`,
    );
  // The default theme's explicit-dark selector outranks another theme's light
  // block, so any other theme restates its whole dark table; otherwise a token
  // it keeps the same in both modes would show the default's dark value.
  const darkOnly = options.isDefault ? declare(dark, (name) => dark[name] !== light[name]) : declare(dark);

  const root = options.isDefault ? ':root' : `:root[data-workbench-theme="${theme.id}"]`;
  const explicitDark = options.isDefault
    ? ':root:has(> head > meta[name="color-scheme"][content="dark"]),\n[data-theme="dark"]'
    : [
        `${root}:has(> head > meta[name="color-scheme"][content="dark"])`,
        `${root}[data-theme="dark"]`,
        `[data-workbench-theme="${theme.id}"] [data-theme="dark"]`,
      ].join(',\n');
  const systemDark = block(`${root}:not([data-theme="light"])`, darkOnly, '  ');

  return [
    `/* ${theme.name.en} (${theme.id}) */\n`,
    block(root, declare(light)),
    systemDark ? `@media (prefers-color-scheme: dark) {\n${systemDark}}\n` : '',
    block(explicitDark, darkOnly),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The shared derived variables, the same for every theme. They are declared again on
 * every element that sets a theme or a mode, because a custom property computed from
 * `var()` resolves where it is declared, not where it is read.
 */
function compileDerivedCss(): string {
  return [
    '/* Shared derived variables: computed from contract tokens, the same in every theme. */\n',
    block(
      ':root,\n[data-theme],\n[data-workbench-theme]',
      DERIVED_VARIABLES.map((variable) => `${cssVarName(variable.name)}: ${variable.value};`),
    ),
  ].join('');
}

/** The stylesheet for every built-in theme, default first, then the shared derived variables. */
export function compileBuiltInThemesCss(): string {
  const header = [
    '/* Generated from src/packages/workbench-theme by `pnpm themes:generate`. Do not edit by hand:',
    '   change the theme tables or the contract and regenerate. */',
    '',
  ].join('\n');
  const themes = BUILT_IN_THEMES.map((theme) =>
    compileThemeCss(theme, { isDefault: theme.id === DEFAULT_THEME_ID }),
  );
  return `${header}\n${themes.join('\n')}\n${compileDerivedCss()}`;
}

/**
 * The colour that marks a selection inside a prototype page: the theme's light `primary`.
 * A prototype is light or dark on its own terms, so the workbench mode does not change it.
 * An id that names no built-in theme gets the default theme's.
 */
export function themeSelectionColor(themeId: string): string {
  return resolveThemeTokens(findTheme(resolveThemeId(themeId))!, 'light').primary!;
}

/**
 * Picks a `>= 3:1` mark colour for overlays drawn over a prototype page (such as Design Notes
 * arrows and dashed element frames), choosing between the theme's light and dark `primary` tokens
 * according to the prototype surface's own ground colour rather than the workbench mode.
 */
export function themePrototypeMarkColor(
  themeId: string,
  prototypeSurfaceColor?: string | null,
): string {
  const theme = findTheme(resolveThemeId(themeId))!;
  const lightPrimary = resolveThemeTokens(theme, 'light').primary!;
  if (!prototypeSurfaceColor) return lightPrimary;
  const darkPrimary = resolveThemeTokens(theme, 'dark').primary!;
  const lightRatio = contrastRatio(lightPrimary, prototypeSurfaceColor);
  const darkRatio = contrastRatio(darkPrimary, prototypeSurfaceColor);
  if (lightRatio === null || darkRatio === null) return lightPrimary;
  return darkRatio > lightRatio ? darkPrimary : lightPrimary;
}
