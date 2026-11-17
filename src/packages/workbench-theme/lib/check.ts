import { contrastRatio, parseColor } from './color.js';
import { resolveThemeTokens } from './compile.js';
import { CONTRAST_PAIRS, THEME_TOKENS } from './contract.js';
import { THEME_ID_PATTERN, THEME_MODES, type ThemeMode, type WorkbenchTheme } from './types.js';

export type ThemeProblemKind = 'invalid-id' | 'missing-token' | 'unknown-token' | 'unreadable-color' | 'low-contrast';

export interface ThemeProblem {
  kind: ThemeProblemKind;
  /** Absent for problems that are not about one mode. */
  mode?: ThemeMode;
  token?: string;
  message: string;
}

const KNOWN = new Set(THEME_TOKENS.map((spec) => spec.name));

/**
 * What stops a theme from being usable: a token without a value in either
 * mode, a table entry the contract does not know, or text that does not reach
 * the contrast its surface requires. An empty result means the theme passes.
 */
export function checkTheme(theme: WorkbenchTheme): ThemeProblem[] {
  const problems: ThemeProblem[] = [];
  if (!THEME_ID_PATTERN.test(theme.id)) {
    problems.push({ kind: 'invalid-id', message: `Theme id "${theme.id}" must be lowercase letters, digits, and hyphens.` });
  }
  for (const mode of THEME_MODES) {
    for (const name of Object.keys(theme[mode])) {
      if (!KNOWN.has(name)) {
        problems.push({ kind: 'unknown-token', mode, token: name, message: `"${name}" (${mode}) is not a contract token.` });
      }
    }
    const tokens = resolveThemeTokens(theme, mode);
    for (const spec of THEME_TOKENS) {
      if (!(spec.name in tokens)) {
        problems.push({ kind: 'missing-token', mode, token: spec.name, message: `"${spec.name}" has no ${mode} value.` });
      }
    }
    for (const pair of CONTRAST_PAIRS) {
      const text = tokens[pair.text];
      const surface = tokens[pair.on];
      const under = pair.over ? tokens[pair.over] : undefined;
      if (text === undefined || surface === undefined || (pair.over && under === undefined)) continue;
      const where = pair.over ? `${pair.on} over ${pair.over}` : pair.on;
      const ratio = contrastRatio(text, surface, under);
      if (ratio === null) {
        const unreadable = [pair.text, pair.on, pair.over].find((name) => name && !parseColor(tokens[name]!));
        problems.push({
          kind: 'unreadable-color',
          mode,
          token: unreadable ?? pair.on,
          message: `Cannot measure ${pair.text} on ${where} (${mode}): ${unreadable ? `"${unreadable}" is not a hex or rgb colour` : `"${pair.on}" is translucent and needs an opaque surface under it`}.`,
        });
      } else if (ratio < pair.min) {
        problems.push({
          kind: 'low-contrast',
          mode,
          token: pair.text,
          message: `${pair.text} on ${where} (${mode}) is ${ratio.toFixed(2)}:1, below ${pair.min}:1.`,
        });
      }
    }
  }
  return problems;
}
