import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkWorkbenchSources, formatAppearanceProblems, type SourceFile } from '../index.js';

const css = (content: string, path = 'src/web/views/example.css'): SourceFile => ({ path, content });
const tsx = (content: string, path = 'src/web/views/Example.tsx'): SourceFile => ({ path, content });

const problemsIn = (...files: SourceFile[]) => checkWorkbenchSources(files);

describe('the appearance guard', () => {
  it('passes a stylesheet that reads only contract tokens', () => {
    expect(problemsIn(css('.card { background: var(--card); color: var(--muted-foreground); }'))).toEqual([]);
  });

  it('fails a retired token name and names the contract token to use instead', () => {
    const [problem, ...rest] = problemsIn(css('.a {\n  background: var(--surface);\n}'));
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({ file: 'src/web/views/example.css', line: 2, kind: 'retired-name' });
    expect(problem!.message).toContain('--surface');
    expect(problem!.hint).toContain('var(--card)');
  });

  it('fails a variable that is neither a contract token, a derived variable, nor declared, and says where to register one', () => {
    const [problem] = problemsIn(css('.a { color: var(--brand-blue); }'));
    expect(problem).toMatchObject({ kind: 'unknown-variable' });
    expect(problem!.hint).toContain('DERIVED_VARIABLES');
    expect(problem!.hint).toContain('docs/workbench-theme-contract.md');
  });

  it('passes the registered shared derived variables', () => {
    expect(problemsIn(css('.a { box-shadow: var(--shadow-card); border-color: var(--border-strong); }'))).toEqual([]);
  });

  it('passes size and motion variables the workbench declares, wherever they are read', () => {
    const scale = css(
      ':root {\n  --text-xs: 11.5px;\n  --dur-fast: 120ms;\n}\n@theme inline {\n  --ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);\n}',
      'src/web/tokens.css',
    );
    const reader = tsx('<p className="text-[length:var(--text-xs)] duration-(--dur-fast) ease-[var(--ease-out-strong)]" />');
    expect(problemsIn(scale, reader)).toEqual([]);

    const inlineStyle = tsx("<div style={{ '--panel-w': w, ['--pop-left' as string]: x }} />", 'src/web/App.tsx');
    const sheet = css('.panel { width: var(--panel-w); left: var(--pop-left); }', 'src/web/shell.css');
    expect(problemsIn(inlineStyle, sheet)).toEqual([]);
  });

  it('keeps a colour computed from tokens inside the file that declares it, unless it is registered', () => {
    const local = css('.spinner {\n  --spinner-color: var(--primary);\n  color: var(--spinner-color);\n}');
    expect(problemsIn(local)).toEqual([]);

    const shared = css(':root {\n  --brand-tint: color-mix(in srgb, var(--primary) 10%, transparent);\n}', 'src/web/tokens.css');
    const problems = problemsIn(shared, tsx('<div style={{ background: "var(--brand-tint)" }} />'));
    expect(problems).toEqual([
      expect.objectContaining({ kind: 'unregistered-derived', file: 'src/web/tokens.css', line: 2 }),
    ]);
    expect(problems[0]!.hint).toContain('DERIVED_VARIABLES');
  });

  it('fails a stylesheet that gives a contract token or a derived variable a value of its own', () => {
    const problems = problemsIn(css(':root {\n  --primary: var(--foreground);\n  --shadow-card: none;\n}'));
    expect(problems.map((problem) => [problem.kind, problem.line])).toEqual([
      ['redefined-token', 2],
      ['redefined-token', 3],
    ]);
  });

  it('fails a retired name brought back as an alias', () => {
    const [problem] = problemsIn(css(':root {\n  --ink: var(--foreground);\n}'));
    expect(problem).toMatchObject({ kind: 'retired-name', line: 2 });
    expect(problem!.hint).toContain('var(--foreground)');
  });

  it('fails a utility written with a retired name and names the utility to use', () => {
    const problems = problemsIn(
      tsx('<div className="bg-surface-2 border-line-soft font-serif rounded-control ring-inset hover:bg-accent" />'),
    );
    expect(problems.map((problem) => problem.hint)).toEqual([
      'Use bg-muted.',
      'Use border-border-subtle.',
      'Use font-title.',
      'Use rounded-md.',
    ]);
  });

  it('fails a retired name read through an arbitrary value or the variable shorthand', () => {
    const problems = problemsIn(tsx('<div className="border-[var(--line-2)] bg-(--surface)" />'));
    expect(problems.map((problem) => problem.hint)).toEqual(['Use var(--border-subtle) (contract token).', 'Use var(--card) (contract token).']);
  });

  it('fails a shadow or radius from the Tailwind default scale, which no theme sets', () => {
    const problems = problemsIn(tsx('<div className="shadow-2xs rounded-xl drop-shadow-md shadow-sm rounded-card rounded-full" />'));
    expect(problems.map((problem) => [problem.kind, problem.hint])).toEqual([
      ['outside-contract', expect.stringContaining('shadow-xs')],
      ['outside-contract', expect.stringContaining('rounded-lg')],
      ['outside-contract', expect.stringContaining('shadow-')],
    ]);
  });

  it('fails a literal corner radius in a stylesheet and names the radius token of the same size in 暖纸', () => {
    const sheet = css(
      [
        '.a {',
        '  border-radius: 6px;',
        '  border-radius: 10px 10px 0 0;',
        '  border-top-left-radius: 5px;',
        '  border-radius: 999px;',
        '  border-radius: 50%;',
        '  border-radius: 0;',
        '  border-radius: var(--radius-sm, 6px);',
        '  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;',
        '}',
      ].join('\n'),
    );
    const problems = problemsIn(sheet);
    expect(problems.map((problem) => [problem.kind, problem.line])).toEqual([
      ['literal-radius', 2],
      ['literal-radius', 3],
      ['literal-radius', 4],
    ]);
    expect(problems[0]!.hint).toContain('var(--radius-sm)');
    expect(problems[1]!.hint).toContain('var(--radius-card)');
    expect(problems[2]!.hint).toContain('RADIUS_EXCEPTIONS');
  });

  it('fails a literal corner radius in markup, as an arbitrary utility or an inline style', () => {
    const markup = tsx(
      '<div className="rounded-[4px] rounded-t-[14px] rounded-[5px] rounded-full rounded-[inherit]" style={{ borderRadius: 8, borderTopLeftRadius: "12px" }} />',
    );
    expect(problemsIn(markup).map((problem) => [problem.kind, problem.hint])).toEqual([
      ['literal-radius', expect.stringContaining('rounded-xs')],
      ['literal-radius', expect.stringContaining('rounded-t-window')],
      ['literal-radius', expect.stringContaining('RADIUS_EXCEPTIONS')],
      ['literal-radius', expect.stringContaining('var(--radius-md)')],
      ['literal-radius', expect.stringContaining('var(--radius-lg)')],
    ]);
    expect(problemsIn(tsx('<div style={{ borderRadius: radius, borderRadius: "var(--radius-md)" }} />'))).toEqual([]);
  });

  it('lets a literal corner radius through where it is registered for that file', () => {
    const path = 'src/web/components/prototype/VisualReferencePicker.tsx';
    const phone = tsx('// Colours of the designed app: not workbench appearance.\n<div className="rounded-[22px]" />', path);
    expect(problemsIn(phone)).toEqual([]);
    expect(problemsIn(tsx('<div className="rounded-[22px]" />'))).toEqual([
      expect.objectContaining({ kind: 'literal-radius' }),
    ]);
  });

  it('fails an @theme mapping that names a utility differently from the token it paints', () => {
    const sheet = css(
      '@theme inline {\n  --color-card: var(--card);\n  --color-page: var(--background);\n  --font-serif: var(--font-title);\n  --shadow-card: var(--shadow-card);\n}',
      'src/web/tokens.css',
    );
    expect(problemsIn(sheet).map((problem) => [problem.kind, problem.line])).toEqual([
      ['theme-mapping', 3],
      ['theme-mapping', 4],
    ]);
  });

  it('fails literal colours in workbench styles and markup, but not in masks', () => {
    const sheet = css(
      '.a {\n  color: #333;\n  border: 1px solid rgba(0, 0, 0, 0.1);\n  background: white;\n  mask-image: linear-gradient(#000, transparent);\n}',
    );
    expect(problemsIn(sheet).map((problem) => [problem.kind, problem.line])).toEqual([
      ['literal-colour', 2],
      ['literal-colour', 3],
      ['literal-colour', 4],
    ]);
    const markup = tsx('<span className="text-white bg-black/40 text-green-600" style={{ color: "#4c50c4" }} />');
    const problems = problemsIn(markup);
    expect(problems).toHaveLength(4);
    expect(problems.every((problem) => problem.kind === 'literal-colour')).toBe(true);
    expect(problems[0]!.hint).toContain('DESIGNED_APP_FILES');
  });

  it('lets a registered file that shows the designed app keep literal colours, as long as it says why', () => {
    const path = 'src/web/components/prototype/DesignBriefAndStyleTile.tsx';
    const explained = tsx('// Colours of the designed app: not workbench appearance.\nconst ink = "#1a1a18";', path);
    expect(problemsIn(explained)).toEqual([]);
    const unexplained = tsx('const ink = "#1a1a18";', path);
    expect(problemsIn(unexplained)).toEqual([expect.objectContaining({ kind: 'unexplained-exception' })]);
  });

  it('fails accent and muted used with their pre-contract meaning', () => {
    expect(problemsIn(tsx('<p className="text-muted" />'))[0]).toMatchObject({ kind: 'old-meaning' });
    expect(problemsIn(css('.a { color: var(--accent); }'))[0]).toMatchObject({ kind: 'old-meaning' });
    expect(problemsIn(css('.a { background: var(--accent); }'))).toEqual([]);
  });

  it('ignores tests, the generated theme stylesheet, and files outside src/web', () => {
    expect(
      problemsIn(
        tsx('const c = "#fff";', 'src/web/views/Example.test.tsx'),
        css(':root { --primary: #4c50c4; }', 'src/web/workbench-themes.generated.css'),
        tsx('const c = "#fff";', 'src/server/app.ts'),
      ),
    ).toEqual([]);
  });
});

describe('the workbench sources', () => {
  it('pass the appearance guard (`pnpm lint:theme` prints the same report)', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
    const collect = (dir: string): SourceFile[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return collect(full);
        return [{ path: path.relative(repoRoot, full).split(path.sep).join('/'), content: fs.readFileSync(full, 'utf8') }];
      });
    const files = collect(path.join(repoRoot, 'src/web'));
    expect(files.length).toBeGreaterThan(50);
    const problems = checkWorkbenchSources(files);
    expect(problems, formatAppearanceProblems(problems)).toEqual([]);
  });
});
