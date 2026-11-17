import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The views and components outside the shell and base stylesheets (#43): their own
// stylesheets, the variables their inline styles read, and the colours they paint.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const webRoot = path.join(repoRoot, 'src/web');

/** Stylesheets with their own migration: the shell and base sheets, and the generated theme sheet. */
const SHEETS_ELSEWHERE = new Set(['shell.css', 'tokens.css', 'workbench-themes.generated.css']);

/**
 * Pre-contract appearance names, including the bridge names that only restate one of
 * them (`--page` is `--ground`, `--green` is `--ok`, and so on).
 */
const OLD_NAMES = [
  'ground',
  'ground-2',
  'page',
  'surface',
  'surface-2',
  'inset',
  'field',
  'line',
  'line-2',
  'line-soft',
  'ghost',
  'hover',
  'ink',
  'ink-2',
  'ink-3',
  'faint',
  'ok',
  'ok-soft',
  'green',
  'green-tint',
  'warn',
  'warn-soft',
  'orange',
  'orange-tint',
  'bad',
  'bad-soft',
  'red',
  'red-tint',
  'tooltip-bg',
  'tooltip-fg',
  'tooltip-muted',
  'tooltip-border',
  'serif',
  'sans',
  'mono',
  'paper-grain-url',
  'paper-grain-size',
  'shadow-card',
];
const oldNameRef = new RegExp(`var\\(--(${OLD_NAMES.join('|')})(?![\\w-])`, 'g');

function files(dir: string, pattern: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full, pattern);
    return pattern.test(entry.name) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(webRoot, file).split(path.sep).join('/');

function findLines(file: string, test: (line: string) => string[]): string[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, index) => test(line).map((what) => `src/web/${relative(file)}:${index + 1}: ${what}\n    ${line.trim()}`));
}

describe('view and component stylesheets', () => {
  it('read appearance only through contract token names', () => {
    const sheets = files(webRoot, /\.css$/).filter((file) => !SHEETS_ELSEWHERE.has(relative(file)));
    expect(sheets.length).toBeGreaterThan(0);
    const found = sheets.flatMap((file) =>
      findLines(file, (line) => [...line.matchAll(oldNameRef)].map((m) => `--${m[1]} is a pre-contract name`)),
    );
    expect(found, found.join('\n')).toEqual([]);
  });
});

describe('colours painted by views and components', () => {
  /**
   * Files that paint the user's designed application rather than the workbench. Their
   * colours belong to the prototype, so they stay literal whatever the workbench theme.
   */
  const SHOWS_THE_USERS_APP: Readonly<Record<string, string>> = {
    'components/prototype/MotionSchematicGallery.tsx': 'motion schematics drawn in the prototype palette',
    'components/prototype/motionSchematicSpecs.ts': 'example CSS for generated prototypes',
    'components/prototype/DesignBriefAndStyleTile.tsx': 'the style tile of the designed app',
    'components/prototype/VisualReferencePicker.tsx': 'swatches of the reference styles a prototype can borrow',
    'components/prototype/PrototypeVisualInspector.tsx': 'script that runs inside the prototype document',
    'components/prototype/prototype-revision-history.css': 'the blank page behind a prototype revision',
  };
  const literalColour = /#[0-9a-fA-F]{3,8}(?![\w-])|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/g;

  it('come from contract tokens, except where they show the user’s designed app', () => {
    const sources = files(webRoot, /\.(css|tsx?)$/).filter((file) => {
      const name = relative(file);
      return (
        !SHEETS_ELSEWHERE.has(name) &&
        !(name in SHOWS_THE_USERS_APP) &&
        !/\.test\.tsx?$/.test(name) &&
        !name.includes('__tests__/')
      );
    });
    const found = sources.flatMap((file) =>
      findLines(file, (line) => [...line.matchAll(literalColour)].map((m) => `literal colour ${m[0]}`)),
    );
    expect(found, found.join('\n')).toEqual([]);
  });

  it('are left literal only in files that say why', () => {
    for (const name of Object.keys(SHOWS_THE_USERS_APP)) {
      const source = fs.readFileSync(path.join(webRoot, name), 'utf8');
      expect(source, `${name} should note that its colours belong to the designed app`).toMatch(
        /not (?:the )?workbench (?:appearance|colours)/i,
      );
    }
  });
});

describe('view and component code', () => {
  /** Files whose CSS styles a generated prototype, which defines its own `--surface`, `--accent` and so on. */
  const PROTOTYPE_CSS = new Set(['components/prototype/motionSchematicSpecs.ts']);
  const sources = files(webRoot, /\.tsx?$/).filter(
    (file) => !PROTOTYPE_CSS.has(relative(file)) && !/\.test\.tsx?$/.test(file) && !relative(file).includes('__tests__/'),
  );

  it('reads contract token names in inline styles and style props', () => {
    // A `[…var(--…)…]` arbitrary value belongs to a className utility, migrated with the other utilities.
    const inlineRef = new RegExp(`(?<!\\[[^\\]\\s'"\`]*)${oldNameRef.source}`, 'g');
    const found = sources.flatMap((file) =>
      findLines(file, (line) => [...line.matchAll(inlineRef)].map((m) => `--${m[1]} is a pre-contract name`)),
    );
    expect(found, found.join('\n')).toEqual([]);
  });
});
