import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_THEMES,
  CONTRAST_PAIRS,
  DEFAULT_THEME_ID,
  THEME_CONTRACT_VERSION,
  THEME_TOKENS,
  THEME_TOKEN_GROUPS,
  checkTheme,
  compileBuiltInThemesCss,
  compileThemeCss,
  contrastRatio,
  cssVarName,
  findTheme,
  renderContractDoc,
  resolveThemeId,
  resolveThemeTokens,
  type WorkbenchTheme,
} from '../index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const readRepoFile = (file: string) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const warmPaper = findTheme('warm-paper')!;

/** A copy of 暖纸 with some values replaced or removed (`undefined` removes). */
function variant(
  id: string,
  patch: { light?: Record<string, string | undefined>; dark?: Record<string, string | undefined> },
): WorkbenchTheme {
  const apply = (table: Readonly<Record<string, string>>, changes: Record<string, string | undefined> = {}) => {
    const next: Record<string, string> = { ...table };
    for (const [name, value] of Object.entries(changes)) {
      if (value === undefined) delete next[name];
      else next[name] = value;
    }
    return next;
  };
  return {
    id,
    name: { zh: id, en: id },
    light: apply(warmPaper.light, patch.light),
    dark: apply(warmPaper.dark, patch.dark),
  };
}

describe('the contract', () => {
  it('has a version, six groups, and uniquely named tokens', () => {
    expect(THEME_CONTRACT_VERSION).toBe(1);
    expect(Object.keys(THEME_TOKEN_GROUPS)).toEqual(['color', 'status', 'font', 'radius', 'shadow', 'backdrop']);
    const names = THEME_TOKENS.map((token) => token.name);
    expect(new Set(names).size).toBe(names.length);
    for (const token of THEME_TOKENS) {
      expect(Object.keys(THEME_TOKEN_GROUPS)).toContain(token.group);
      expect(token.description.length).toBeGreaterThan(0);
    }
  });

  it('only lets a token follow another contract token, and never in a circle', () => {
    const byName = new Map(THEME_TOKENS.map((token) => [token.name, token]));
    for (const token of THEME_TOKENS) {
      const seen = new Set([token.name]);
      let next = token.fallback;
      while (next) {
        expect(byName.has(next)).toBe(true);
        expect(seen.has(next)).toBe(false);
        seen.add(next);
        next = byName.get(next)?.fallback;
      }
    }
  });

  it('requires contrast only between tokens it defines', () => {
    const names = new Set(THEME_TOKENS.map((token) => token.name));
    for (const pair of CONTRAST_PAIRS) {
      expect(names.has(pair.text)).toBe(true);
      expect(names.has(pair.on)).toBe(true);
      if (pair.over) expect(names.has(pair.over)).toBe(true);
    }
  });

  it('holds back the two names the old stylesheets still use with another meaning', () => {
    expect(cssVarName('accent')).not.toBe('--accent');
    expect(cssVarName('muted')).not.toBe('--muted');
    expect(cssVarName('primary')).toBe('--primary');
  });
});

describe('built-in themes', () => {
  it('include 暖纸 and name every theme in both languages', () => {
    expect(warmPaper.name).toEqual({ zh: '暖纸', en: 'Warm Paper' });
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.name.zh.length).toBeGreaterThan(0);
      expect(theme.name.en.length).toBeGreaterThan(0);
    }
    expect(new Set(BUILT_IN_THEMES.map((theme) => theme.id)).size).toBe(BUILT_IN_THEMES.length);
  });

  it.each(BUILT_IN_THEMES.map((theme) => [theme.id, theme] as const))(
    '%s passes the theme check in light and dark',
    (_id, theme) => {
      expect(checkTheme(theme).map((problem) => problem.message)).toEqual([]);
    },
  );

  it('fall back to the default for an unknown, missing, or malformed stored id', () => {
    expect(findTheme(DEFAULT_THEME_ID)).toBeDefined();
    expect(resolveThemeId('warm-paper')).toBe('warm-paper');
    expect(resolveThemeId('no-such-theme')).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId(null)).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId(42)).toBe(DEFAULT_THEME_ID);
  });
});

describe('the theme check', () => {
  it('reports a token that has no value in one mode', () => {
    const problems = checkTheme(variant('gap', { dark: { border: undefined } }));
    expect(problems).toContainEqual(
      expect.objectContaining({ kind: 'missing-token', mode: 'dark', token: 'border' }),
    );
    expect(problems.some((problem) => problem.mode === 'light' && problem.kind === 'missing-token')).toBe(false);
  });

  it('accepts a token left unset when the contract gives it one to follow', () => {
    const theme = variant('follows', { light: { ring: undefined }, dark: { ring: undefined } });
    expect(resolveThemeTokens(theme, 'light').ring).toBe(theme.light.primary);
    expect(checkTheme(theme).filter((problem) => problem.token === 'ring')).toEqual([]);
  });

  it('reports a table entry the contract does not know', () => {
    expect(checkTheme(variant('typo', { light: { backgroud: '#fff' } }))).toContainEqual(
      expect.objectContaining({ kind: 'unknown-token', mode: 'light', token: 'backgroud' }),
    );
  });

  it('reports text that does not reach 4.5:1 on a surface it is used on', () => {
    const problems = checkTheme(variant('faint', { light: { 'muted-foreground': '#9a9a9a' } }));
    const low = problems.filter((problem) => problem.kind === 'low-contrast');
    expect(low.length).toBeGreaterThan(0);
    expect(low.every((problem) => problem.token === 'muted-foreground' && problem.mode === 'light')).toBe(true);
    expect(low[0]!.message).toMatch(/below 4\.5:1/);
  });

  it('measures text on a translucent fill as painted over the surface beneath it', () => {
    // Opaque, this fill would fail against dark text; at 10% over a light card it passes.
    const translucent = variant('tint', { light: { 'primary-soft': 'rgba(76, 80, 196, 0.1)' } });
    expect(checkTheme(translucent).filter((problem) => problem.token === 'primary')).toEqual([]);
    const opaque = variant('solid', { light: { 'primary-soft': '#4c50c4' } });
    expect(checkTheme(opaque)).toContainEqual(
      expect.objectContaining({ kind: 'low-contrast', mode: 'light', token: 'primary' }),
    );
  });

  it('reports a colour it cannot read instead of passing it', () => {
    expect(checkTheme(variant('named', { light: { foreground: 'black' } }))).toContainEqual(
      expect.objectContaining({ kind: 'unreadable-color', mode: 'light', token: 'foreground' }),
    );
  });

  it('rejects an id that could not be written to an attribute', () => {
    expect(checkTheme(variant('Not Valid', {}))).toContainEqual(expect.objectContaining({ kind: 'invalid-id' }));
  });
});

describe('contrast', () => {
  it('follows the WCAG definition', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#fff', '#fff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('rgb(0 0 0)', 'rgba(255, 255, 255, 0.5)', '#000000')).toBeCloseTo(
      contrastRatio('#000000', '#808080')!,
      1,
    );
  });

  it('refuses to guess when a translucent surface has nothing opaque under it', () => {
    expect(contrastRatio('#000000', 'rgba(255, 255, 255, 0.5)')).toBeNull();
    expect(contrastRatio('#000000', 'not-a-colour')).toBeNull();
  });
});

describe('compiling a theme to CSS', () => {
  it('writes the default theme on bare :root so the page is styled before any attribute is set', () => {
    const css = compileThemeCss(warmPaper, { isDefault: true });
    expect(css).toMatch(/^:root \{$/m);
    expect(css).toContain(`--background: ${warmPaper.light.background};`);
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).not.toContain('data-workbench-theme');
  });

  it('scopes any other theme to its data-workbench-theme attribute in both modes', () => {
    const css = compileThemeCss(variant('other', {}));
    expect(css).toContain(':root[data-workbench-theme="other"] {');
    expect(css).toContain(':root[data-workbench-theme="other"]:not([data-theme="light"]) {');
    expect(css).toContain(':root[data-workbench-theme="other"][data-theme="dark"]');
    expect(css).not.toMatch(/^:root \{$/m);
  });

  it('repeats in the dark blocks only the tokens whose value differs from light', () => {
    const css = compileThemeCss(warmPaper, { isDefault: true });
    const [lightBlock, ...darkBlocks] = css.split(/\n(?=@media|:root:has)/);
    expect(lightBlock).toContain('--font-sans:');
    expect(lightBlock).toContain('--radius-card:');
    expect(darkBlocks).toHaveLength(2);
    for (const dark of darkBlocks) {
      expect(dark).toContain(`--background: ${warmPaper.dark.background};`);
      expect(dark).not.toContain('--font-sans:');
      expect(dark).not.toContain('--radius-card:');
    }
  });

  it('emits tokens a theme leaves unset with the value of the token they follow', () => {
    const css = compileThemeCss(warmPaper, { isDefault: true });
    expect(css).toContain(`--card-foreground: ${warmPaper.light.foreground};`);
    expect(css).toContain(`--ring: ${warmPaper.light.primary};`);
  });

  it('never emits the two held-back names', () => {
    const css = compileBuiltInThemesCss();
    expect(css).not.toMatch(/^\s*--accent:/m);
    expect(css).not.toMatch(/^\s*--muted:/m);
    expect(css).toContain(`${cssVarName('accent')}:`);
    expect(css).toContain(`${cssVarName('muted')}:`);
  });
});

describe('files generated from the contract and the theme tables', () => {
  it('the stylesheet the app loads is up to date (run `pnpm themes:generate`)', () => {
    expect(readRepoFile('src/web/workbench-themes.generated.css')).toBe(compileBuiltInThemesCss());
  });

  it('the contract reference is up to date and lists every token (run `pnpm themes:generate`)', () => {
    const doc = readRepoFile('docs/workbench-theme-contract.md');
    expect(doc).toBe(renderContractDoc());
    for (const token of THEME_TOKENS) {
      expect(doc).toContain(`| \`${token.name}\` | \`${cssVarName(token.name)}\` | ${token.description} |`);
    }
    expect(doc).toContain(`Contract version: ${THEME_CONTRACT_VERSION}`);
  });
});

describe('the stylesheets that still use pre-contract names', () => {
  it('resolve every old colour, font, and texture name to a contract token', () => {
    const tokensCss = readRepoFile('src/web/tokens.css');
    const aliases: Record<string, string> = {
      ground: 'background',
      'ground-2': 'canvas',
      surface: 'card',
      'surface-2': 'muted',
      line: 'border',
      'line-2': 'border-subtle',
      ghost: 'accent',
      ink: 'foreground',
      'ink-2': 'foreground-soft',
      muted: 'muted-foreground',
      faint: 'faint-foreground',
      accent: 'primary',
      'accent-ink': 'primary-foreground',
      'accent-soft': 'primary-soft',
      ok: 'success',
      'ok-soft': 'success-soft',
      warn: 'warning',
      'warn-soft': 'warning-soft',
      bad: 'destructive',
      'bad-soft': 'destructive-soft',
      serif: 'font-title',
      sans: 'font-sans',
      mono: 'font-mono',
      'paper-grain-url': 'backdrop-image',
      'paper-grain-size': 'backdrop-size',
    };
    for (const [oldName, token] of Object.entries(aliases)) {
      expect(tokensCss).toContain(`--${oldName}: var(${cssVarName(token)});`);
    }
  });

  it('no longer carry literal values for anything the theme owns', () => {
    const tokensCss = readRepoFile('src/web/tokens.css');
    for (const token of THEME_TOKENS) {
      const literal = new RegExp(`^\\s*${cssVarName(token.name)}:(?!\\s*var\\()`, 'm');
      expect(tokensCss, `${token.name} should come from the theme`).not.toMatch(literal);
    }
  });
});
