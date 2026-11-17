import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_THEMES,
  CONTRAST_PAIRS,
  DEFAULT_THEME_ID,
  DERIVED_VARIABLES,
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
  themeSelectionColor,
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
  it('has a version, seven groups, and uniquely named tokens', () => {
    expect(THEME_CONTRACT_VERSION).toBe(1);
    expect(Object.keys(THEME_TOKEN_GROUPS)).toEqual(['color', 'status', 'model', 'font', 'radius', 'shadow', 'backdrop']);
    const names = THEME_TOKENS.map((token) => token.name);
    expect(new Set(names).size).toBe(names.length);
    for (const token of THEME_TOKENS) {
      expect(Object.keys(THEME_TOKEN_GROUPS)).toContain(token.group);
      expect(token.description.length).toBeGreaterThan(0);
    }
  });

  it('keeps every shared derived variable name of its version, since components read them as they read tokens', () => {
    // Renaming or removing one of these breaks components: bump THEME_CONTRACT_VERSION and update this list.
    const version1 = [
      'accent-strong',
      'border-strong',
      'focus-ring',
      'shadow-hairline',
      'shadow-btn',
      'shadow-card',
      'shadow-raised',
      'shadow-overlay',
    ];
    expect(THEME_CONTRACT_VERSION).toBe(1);
    expect(DERIVED_VARIABLES.map((variable) => variable.name)).toEqual(expect.arrayContaining(version1));
    const names = [...THEME_TOKENS, ...DERIVED_VARIABLES].map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
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

  it('emits every token under its own name, including the hover fill and the quiet fill', () => {
    expect(cssVarName('accent')).toBe('--accent');
    expect(cssVarName('muted')).toBe('--muted');
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

  it('give a device that has not chosen the neutral 默认 theme, with 暖纸 still selectable', () => {
    expect(DEFAULT_THEME_ID).toBe('default');
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual(['default', 'warm-paper']);
    expect(findTheme('default')!.name).toEqual({ zh: '默认', en: 'Default' });
  });

  it('give 默认 the same sans-serif family for titles and interface, and no background texture', () => {
    const theme = findTheme('default')!;
    for (const mode of ['light', 'dark'] as const) {
      const tokens = resolveThemeTokens(theme, mode);
      expect(tokens['font-title']).toBe(tokens['font-sans']);
      expect(tokens['font-title']).toMatch(/^"Inter", .*, sans-serif$/);
      expect(tokens['font-title']).not.toMatch(/Serif|Georgia/);
      expect(tokens['backdrop-image']).toBe('none');
    }
  });

  it('give a prototype selection the light primary of the chosen theme, whatever the workbench mode', () => {
    expect(themeSelectionColor('warm-paper')).toBe('#4c50c4');
    expect(themeSelectionColor('default')).toBe('#2466de');
    expect(themeSelectionColor('no-such-theme')).toBe(themeSelectionColor(DEFAULT_THEME_ID));
  });

  it('fall back to the default for an unknown, missing, or malformed stored id', () => {
    expect(findTheme(DEFAULT_THEME_ID)).toBeDefined();
    expect(resolveThemeId('default')).toBe('default');
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

  it('reports a model colour that does not reach 3:1 as a mark on the card it is drawn on', () => {
    // #2f2f2f is about 1.4:1 on the dark card, yet white text on it is well above 4.5:1.
    const problems = checkTheme(variant('dim-model', { dark: { 'model-mm': '#2f2f2f' } }));
    expect(problems).toContainEqual(
      expect.objectContaining({ kind: 'low-contrast', mode: 'dark', token: 'model-mm', message: expect.stringMatching(/on card \(dark\).*below 3:1/) }),
    );
    expect(problems.some((problem) => problem.mode === 'light')).toBe(false);
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

  it('states every token in the dark blocks of any other theme, so no dark value of the default shows through', () => {
    // The default's explicit-dark selector outranks another theme's plain light block,
    // so a token that theme keeps the same in both modes must still be restated for dark.
    const css = compileThemeCss(warmPaper);
    const [lightBlock, ...darkBlocks] = css.split(/\n(?=@media|:root\[data-workbench-theme="warm-paper"\]:has)/);
    expect(darkBlocks).toHaveLength(2);
    const declared = (block: string) => block.match(/^\s*--[\w-]+:/gm)?.length ?? 0;
    for (const dark of darkBlocks) {
      expect(dark).toContain(`--font-sans: ${warmPaper.light['font-sans']};`);
      expect(dark).toContain('--radius-card:');
      expect(declared(dark)).toBe(declared(lightBlock!));
    }
  });

  it('repeats in the dark blocks of the default theme only the tokens whose value differs from light', () => {
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

  it('emits the hover fill as --accent and the quiet fill as --muted', () => {
    const css = compileBuiltInThemesCss();
    expect(css).toContain(`--accent: ${warmPaper.light.accent};`);
    expect(css).toContain(`--muted: ${warmPaper.light.muted};`);
    expect(css).not.toContain('--contract-');
  });

  it('writes the shared derived variables once, from contract tokens, wherever a theme or mode is set', () => {
    const css = compileBuiltInThemesCss();
    const block = /^:root,\n\[data-theme\],\n\[data-workbench-theme\] \{\n([\s\S]*?)^\}/m.exec(css)?.[1] ?? '';
    expect(block).toContain('--border-strong: color-mix(in srgb, var(--muted-foreground) 42%, var(--border));');
    expect(block).toContain('--shadow-card: 0 0 0 1px var(--border), var(--shadow-sm);');
    expect(block.match(/^\s*--[\w-]+:/gm)).toHaveLength(DERIVED_VARIABLES.length);
    for (const theme of BUILT_IN_THEMES) {
      for (const mode of ['light', 'dark'] as const) {
        for (const variable of DERIVED_VARIABLES) expect(theme[mode]).not.toHaveProperty(variable.name);
      }
    }
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

  it('the contract reference lists the shared derived variables, which a theme does not fill', () => {
    const doc = renderContractDoc();
    expect(doc).toContain('## Shared derived variables');
    const section = doc.slice(doc.indexOf('## Shared derived variables'), doc.indexOf('## Adding a built-in theme'));
    expect(section).toMatch(/names are part of the contract: renaming or removing one .*bumps the contract version/);
    for (const variable of DERIVED_VARIABLES) {
      expect(doc).toContain(`| \`${cssVarName(variable.name)}\` | ${variable.description} | \`${variable.value}\` |`);
    }
  });

  it('the contract reference says how to add a built-in theme and how the theme check is run', () => {
    const doc = renderContractDoc();
    const section = doc.slice(doc.indexOf('## Adding a built-in theme'));
    expect(section).toMatch(/^## Adding a built-in theme/);
    expect(section).toContain('src/packages/workbench-theme/lib/themes/');
    expect(section).toContain('BUILT_IN_THEMES');
    expect(section).toContain('checkTheme');
    expect(section).toContain('pnpm themes:generate');
    expect(section).toContain('pnpm lint:theme');
  });
});
