import { DERIVED_VARIABLES, THEME_TOKENS } from './contract.js';

/**
 * The appearance guard (ADR 0012): workbench styles and components take colours, fonts,
 * radii, shadows and texture only from contract tokens and the registered shared derived
 * variables. `pnpm lint:theme` runs it over `src/web` (and so does `pnpm check`); a
 * test runs it too.
 *
 * Every exception lives in this file or in `DERIVED_VARIABLES` (contract.ts), so a
 * failure can say where a legitimate new case is registered.
 */

export interface SourceFile {
  /** Relative to the repository root, with `/` separators. */
  path: string;
  content: string;
}

export type AppearanceProblemKind =
  | 'retired-name'
  | 'unknown-variable'
  | 'unregistered-derived'
  | 'redefined-token'
  | 'theme-mapping'
  | 'outside-contract'
  | 'literal-colour'
  | 'old-meaning'
  | 'unexplained-exception';

export interface AppearanceProblem {
  file: string;
  line: number;
  kind: AppearanceProblemKind;
  /** What is wrong, quoting the offending name or value. */
  message: string;
  /** What to write instead, or where to register a legitimate exception. */
  hint: string;
}

const GUARD_FILE = 'src/packages/workbench-theme/lib/guard.ts';
const DERIVED_HOME = '`DERIVED_VARIABLES` in src/packages/workbench-theme/lib/contract.ts';
const CONTRACT_DOC = 'docs/workbench-theme-contract.md';

/** The guard reads the workbench's stylesheets and components, not their tests. */
function isGuarded(path: string): boolean {
  return (
    /^src\/web\/.+\.(css|tsx?)$/.test(path) &&
    !/\.test\.tsx?$/.test(path) &&
    !path.includes('/__tests__/') &&
    // Written by `pnpm themes:generate`: the one place contract tokens get values.
    path !== 'src/web/workbench-themes.generated.css'
  );
}

/**
 * Files whose CSS styles a generated prototype, which defines its own `--surface`,
 * `--accent` and so on. The guard skips them entirely. Register a file here with the reason.
 */
const PROTOTYPE_STYLESHEETS: Readonly<Record<string, string>> = {
  'src/web/components/prototype/motionSchematicSpecs.ts': 'example CSS for generated prototypes',
};

/**
 * Files that paint the user's designed application rather than the workbench: their
 * colours belong to the prototype and stay literal whatever the workbench theme. Each must
 * say so in a comment matching `DESIGNED_APP_NOTE`. Register a file here with the reason.
 */
const DESIGNED_APP_FILES: Readonly<Record<string, string>> = {
  'src/web/components/prototype/MotionSchematicGallery.tsx': 'motion schematics drawn in the prototype palette',
  'src/web/components/prototype/DesignBriefAndStyleTile.tsx': 'the style tile of the designed app',
  'src/web/components/prototype/VisualReferencePicker.tsx': 'swatches of the reference styles a prototype can borrow',
  'src/web/components/prototype/PrototypeVisualInspector.tsx': 'script that runs inside the prototype document',
  'src/web/components/prototype/prototype-revision-history.css': 'the blank page behind a prototype revision',
};
const DESIGNED_APP_NOTE = /not (?:the )?workbench (?:appearance|colours)/i;

/** Custom-property prefixes owned by libraries, which the workbench may read. */
const LIBRARY_VARIABLE_PREFIXES = ['tw-'];

/** Pre-contract names and the contract token or derived variable that replaced each. */
const RETIRED: Readonly<Record<string, string>> = {
  ground: 'background',
  'ground-2': 'canvas',
  page: 'background',
  surface: 'card',
  'surface-2': 'muted',
  inset: 'muted',
  field: 'muted',
  line: 'border',
  'line-2': 'border-subtle',
  'line-soft': 'border-subtle',
  'line-strong': 'border-strong',
  ghost: 'accent',
  hover: 'accent',
  'hover-2': 'accent-strong',
  ink: 'foreground',
  'ink-2': 'foreground-soft',
  'ink-3': 'faint-foreground',
  faint: 'faint-foreground',
  ok: 'success',
  green: 'success',
  'ok-soft': 'success-soft',
  'green-tint': 'success-soft',
  warn: 'warning',
  orange: 'warning',
  'warn-soft': 'warning-soft',
  'orange-tint': 'warning-soft',
  bad: 'destructive',
  red: 'destructive',
  'bad-soft': 'destructive-soft',
  'red-tint': 'destructive-soft',
  'accent-ink': 'primary-foreground',
  'accent-soft': 'primary-soft',
  'accent-tint': 'primary-soft',
  serif: 'font-title',
  sans: 'font-sans',
  mono: 'font-mono',
  'paper-grain-url': 'backdrop-image',
  'paper-grain-size': 'backdrop-size',
  'radius-chip': 'radius-sm',
  'radius-control': 'radius-md',
};
const RETIRED_UTILITIES: Readonly<Record<string, string>> = {
  'font-serif': 'font-title',
  'rounded-chip': 'rounded-sm',
  'rounded-control': 'rounded-md',
};

const CONTRACT = new Set(THEME_TOKENS.map((token) => token.name));
const DERIVED = new Set(DERIVED_VARIABLES.map((variable) => variable.name));
const isAppearanceName = (name: string) => CONTRACT.has(name) || DERIVED.has(name);

const COLOUR_UTILITY_PREFIXES =
  'bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|decoration|placeholder|caret|accent|shadow';
const TAILWIND_PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const RETIRED_COLOUR_NAMES = Object.keys(RETIRED)
  .filter((name) => !/^(?:serif|sans|mono|paper-grain|radius)/.test(name))
  .sort((a, b) => b.length - a.length)
  .join('|');

const VARIABLE_REFERENCE = /var\(\s*--([A-Za-z_][\w-]*)|(?<=[a-z]-\()--([A-Za-z_][\w-]*)(?=\))/g;
const CSS_DECLARATION = /(?<![\w-])--([A-Za-z_][\w-]*)\s*:\s*([^;{}]*)/g;
/** `'--x': …` and `['--x' as string]: …` in a style object, or `setProperty('--x', …)`. */
const SCRIPT_DECLARATION = /['"`]--([A-Za-z_][\w-]*)['"`](?:\s+as\s+\w+)?\]?\s*[:,]/g;
const SCRIPT_LITERAL_COLOUR = /#[0-9a-fA-F]{3,8}(?![\w-])|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(/g;
const CSS_LITERAL_COLOUR = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.]|\b(?:white|black)\b/i;
const RETIRED_COLOUR_UTILITY = new RegExp(
  `(?<![\\w$.-])(${COLOUR_UTILITY_PREFIXES})-(${RETIRED_COLOUR_NAMES})(?![\\w-])`,
  'g',
);
const PALETTE_UTILITY = new RegExp(
  `(?<![\\w$.-])(?:${COLOUR_UTILITY_PREFIXES})-(?:white|black|(?:${TAILWIND_PALETTE})-\\d{2,3})(?![\\w-])`,
  'g',
);
/**
 * Shadows and radii from the Tailwind default scale that the contract does not define, so
 * no theme gives them a value (`rounded-full` and `rounded-none` are shapes, not radii).
 */
const TAILWIND_SCALE_UTILITY =
  /(?<![\w$.-])(?:(shadow)-(?:2xs|xl|2xl|inner)|(rounded)(?:-[trblse]{1,2})?-(?:xl|2xl|3xl|4xl)|(?:drop|inset|text)-shadow(?:-[\w]+)?)(?![\w-])/g;
const RETIRED_UTILITY = /(?<![\w$.-])(font-serif|rounded-chip|rounded-control)(?![\w-])/g;

/**
 * `accent` and `muted` before the contract meant the brand colour and secondary text; in
 * the contract they are the hover fill and the quiet fill (#41).
 */
const OLD_MEANINGS: ReadonlyArray<readonly [what: string, pattern: RegExp, hint: string, cssOnly?: boolean]> = [
  [
    'the text-muted utility paints text in the quiet fill',
    /(?<![\w-])text-muted(?![\w-])/g,
    'Secondary text is text-muted-foreground.',
  ],
  [
    'accent as a text, border, or ring colour utility is the hover fill, not the brand colour',
    /(?<![\w-])(?:text|border(?:-[xytrblse])?|ring|outline|decoration|fill|stroke|caret|divide|placeholder)-accent(?![\w-])/g,
    'The brand colour is primary (text-primary, border-primary, ring-ring).',
  ],
  // SVG `fill` is left out of the two below: it paints shapes such as graph cards and
  // label backgrounds, which is what the quiet fill and the hover fill are for.
  [
    'var(--accent) or var(--muted) as a text, border, or outline colour reads a fill',
    /(?<![\w-])(?:color|border[\w-]*|outline[\w-]*|stroke|caret-color|accent-color|text-decoration[\w-]*|box-shadow)\s*:[^;{}]*?var\(--(?:accent|muted)[\s,)]/g,
    'Use var(--primary) for the brand colour or var(--muted-foreground) for secondary text.',
    true,
  ],
  [
    'var(--accent) or var(--muted) as a text, border, or outline colour in an inline style reads a fill',
    /(?<![\w-])(?:color|border\w*|outline\w*|stroke|caretColor|accentColor|textDecoration\w*|boxShadow)\s*:\s*(?:[^'"`\n]*\?\s*)?['"`][^'"`]*var\(--(?:accent|muted)[\s,)]/g,
    'Use var(--primary) for the brand colour or var(--muted-foreground) for secondary text.',
  ],
];

interface Declaration {
  file: string;
  line: number;
  name: string;
  value: string;
}

function lineAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/** CSS comments blanked out, keeping every character's position. */
function withoutCssComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/** The `{ … }` bodies of `@theme` blocks, as [start, end) offsets. */
function themeBlocks(content: string): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  for (const match of content.matchAll(/@theme\b[^{]*\{/g)) {
    let depth = 1;
    let index = match.index! + match[0].length;
    while (index < content.length && depth > 0) {
      if (content[index] === '{') depth++;
      else if (content[index] === '}') depth--;
      index++;
    }
    blocks.push([match.index!, index]);
  }
  return blocks;
}

const readsAppearance = (value: string) =>
  [...value.matchAll(VARIABLE_REFERENCE)].some((match) => isAppearanceName((match[1] ?? match[2])!)) ||
  CSS_LITERAL_COLOUR.test(value) ||
  /color-mix\(/.test(value);

function useInstead(name: string): string {
  const replacement = RETIRED[name]!;
  return `Use var(--${replacement}) (${CONTRACT.has(replacement) ? 'contract token' : 'shared derived variable'}).`;
}

/**
 * Every place the given workbench sources take appearance from anything other than a
 * contract token or a registered shared derived variable. Files outside `src/web`, tests,
 * and the generated theme stylesheet are ignored, so a caller may pass more than that.
 */
export function checkWorkbenchSources(files: readonly SourceFile[]): AppearanceProblem[] {
  const guarded = files
    .filter((file) => isGuarded(file.path) && !(file.path in PROTOTYPE_STYLESHEETS))
    .map((file) => ({
      ...file,
      isCss: file.path.endsWith('.css'),
      text: file.path.endsWith('.css') ? withoutCssComments(file.content) : file.content,
      designedApp: file.path in DESIGNED_APP_FILES,
    }));
  const problems: AppearanceProblem[] = [];
  const report = (file: string, text: string, index: number, kind: AppearanceProblemKind, message: string, hint: string) =>
    problems.push({ file, line: lineAt(text, index), kind, message, hint });

  // Declarations, and the files that read each variable.
  const declarations: Declaration[] = [];
  const themeDeclared = new Set<string>();
  const readers = new Map<string, Set<string>>();
  for (const file of guarded) {
    const blocks = file.isCss ? themeBlocks(file.text) : [];
    const inThemeBlock = (index: number) => blocks.some(([start, end]) => index >= start && index < end);
    for (const match of file.text.matchAll(CSS_DECLARATION)) {
      const [, name, value] = match;
      if (inThemeBlock(match.index!)) {
        // `@theme` names Tailwind utilities. A utility named differently from the token it
        // paints is an alias (`bg-page` for `--background`).
        const target = /^var\(--([\w-]+)\)$/.exec(value!.trim())?.[1];
        if (target && isAppearanceName(target) && name !== target && name !== `color-${target}`) {
          report(
            file.path,
            file.text,
            match.index!,
            'theme-mapping',
            `@theme maps --${name} to --${target}, which makes a utility named differently from the token it paints.`,
            `Write the utility with the token's own name (\`--color-${target}: var(--${target})\` for colours, \`--${target}: var(--${target})\` otherwise).`,
          );
        }
        themeDeclared.add(name!);
        continue;
      }
      declarations.push({ file: file.path, line: lineAt(file.text, match.index!), name: name!, value: value! });
    }
    if (!file.isCss) {
      for (const match of file.text.matchAll(SCRIPT_DECLARATION)) {
        declarations.push({ file: file.path, line: lineAt(file.text, match.index!), name: match[1]!, value: '' });
      }
    }
    for (const match of file.text.matchAll(VARIABLE_REFERENCE)) {
      const name = (match[1] ?? match[2])!;
      if (!readers.has(name)) readers.set(name, new Set());
      readers.get(name)!.add(file.path);
    }
  }
  const declared = new Set([...declarations.map((declaration) => declaration.name), ...themeDeclared]);

  // Declarations: no retired names, no contract tokens outside the theme stylesheet, and
  // no colour shared between files without registering it.
  for (const declaration of declarations) {
    const { name, value, file, line } = declaration;
    if (DESIGNED_APP_FILES[file]) continue;
    if (name in RETIRED) {
      problems.push({
        file,
        line,
        kind: 'retired-name',
        message: `--${name} is a retired pre-contract name and may not be defined again.`,
        hint: useInstead(name),
      });
    } else if (CONTRACT.has(name)) {
      problems.push({
        file,
        line,
        kind: 'redefined-token',
        message: `--${name} is a contract token; only a Workbench Theme gives it a value.`,
        hint: 'Change its value in the theme tables (src/packages/workbench-theme/lib/themes/) and run `pnpm themes:generate`.',
      });
    } else if (DERIVED.has(name)) {
      problems.push({
        file,
        line,
        kind: 'redefined-token',
        message: `--${name} is a shared derived variable; the generated theme stylesheet defines it.`,
        hint: `Change it in ${DERIVED_HOME} and run \`pnpm themes:generate\`.`,
      });
    } else if (readsAppearance(value)) {
      const declaringFiles = new Set(declarations.filter((other) => other.name === name).map((other) => other.file));
      const sharedWith = [...(readers.get(name) ?? [])].filter((reader) => !declaringFiles.has(reader));
      if (sharedWith.length > 0) {
        problems.push({
          file,
          line,
          kind: 'unregistered-derived',
          message: `--${name} is computed from theme colours and read in other files (${sharedWith.join(', ')}).`,
          hint: `Register a colour or shadow shared between files in ${DERIVED_HOME}, or keep the variable inside the one file that reads it.`,
        });
      }
    }
  }

  for (const file of guarded) {
    const { path, text } = file;

    // References: contract tokens, derived variables, or variables the workbench declares.
    for (const match of text.matchAll(VARIABLE_REFERENCE)) {
      const name = (match[1] ?? match[2])!;
      if (isAppearanceName(name) || LIBRARY_VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
      if (name in RETIRED && !(file.designedApp && declared.has(name))) {
        report(path, text, match.index!, 'retired-name', `--${name} is a retired pre-contract name.`, useInstead(name));
      } else if (!declared.has(name)) {
        report(
          path,
          text,
          match.index!,
          'unknown-variable',
          `--${name} is not a contract token, not a shared derived variable, and not declared anywhere in src/web.`,
          `Use a contract token (${CONTRACT_DOC}); register a new shared colour or shadow in ${DERIVED_HOME}.`,
        );
      }
    }

    if (!file.isCss) {
      for (const match of text.matchAll(RETIRED_COLOUR_UTILITY)) {
        if (match[1] === 'ring' && match[2] === 'inset') continue; // Tailwind's inset ring, not a colour.
        report(
          path,
          text,
          match.index!,
          'retired-name',
          `${match[0]} is written with a retired pre-contract name.`,
          `Use ${match[1]}-${RETIRED[match[2]!]}.`,
        );
      }
      for (const match of text.matchAll(TAILWIND_SCALE_UTILITY)) {
        const hint = match[1]
          ? 'Use a contract shadow: shadow-xs, shadow-sm, shadow-md, shadow-lg, or a shared derived shadow (shadow-card, shadow-raised, shadow-overlay).'
          : match[2]
            ? 'Use a contract radius: rounded-xs, rounded-sm, rounded-md, rounded-lg, rounded-card, or rounded-window.'
            : 'Use a contract shadow (shadow-xs, shadow-sm, shadow-md, shadow-lg) or register a shared derived shadow.';
        report(
          path,
          text,
          match.index!,
          'outside-contract',
          `${match[0]} reads the Tailwind default scale, which no Workbench Theme sets.`,
          `${hint} See ${CONTRACT_DOC}.`,
        );
      }
      for (const match of text.matchAll(RETIRED_UTILITY)) {
        report(
          path,
          text,
          match.index!,
          'retired-name',
          `${match[0]} is a retired utility name.`,
          `Use ${RETIRED_UTILITIES[match[1]!]}.`,
        );
      }
    }

    for (const [what, pattern, hint, cssOnly] of OLD_MEANINGS) {
      if (cssOnly && !file.isCss) continue;
      for (const match of text.matchAll(pattern)) report(path, text, match.index!, 'old-meaning', what, hint);
    }

    // Literal colours: only in the generated theme stylesheet and the registered designed-app files.
    if (file.designedApp) {
      if (!DESIGNED_APP_NOTE.test(file.content)) {
        problems.push({
          file: path,
          line: 1,
          kind: 'unexplained-exception',
          message: `${path} may paint literal colours because it shows the designed app (${DESIGNED_APP_FILES[path]}), but it does not say so.`,
          hint: 'Add a comment saying its colours belong to the designed app, "not workbench appearance".',
        });
      }
      continue;
    }
    const literalHint = `Use a contract token (${CONTRACT_DOC}) or a shared derived variable. A file that paints the user's designed app is registered in DESIGNED_APP_FILES in ${GUARD_FILE}.`;
    if (file.isCss) {
      for (const match of text.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
        const [, property, value] = match;
        // Masks only use the alpha channel, so the colour they name is not appearance.
        if (/^(?:-webkit-)?mask/.test(property!) || !CSS_LITERAL_COLOUR.test(value!)) continue;
        report(path, text, match.index!, 'literal-colour', `literal colour in "${match[0].trim().replace(/\s+/g, ' ')}"`, literalHint);
      }
    } else {
      for (const match of text.matchAll(SCRIPT_LITERAL_COLOUR)) {
        report(path, text, match.index!, 'literal-colour', `literal colour ${match[0]}`, literalHint);
      }
      for (const match of text.matchAll(PALETTE_UTILITY)) {
        report(path, text, match.index!, 'literal-colour', `${match[0]} paints a fixed Tailwind palette colour`, literalHint);
      }
    }
  }

  return problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** One problem per line, for a terminal. */
export function formatAppearanceProblems(problems: readonly AppearanceProblem[]): string {
  return problems.map((problem) => `${problem.file}:${problem.line}: ${problem.message}\n    -> ${problem.hint}`).join('\n');
}
