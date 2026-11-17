import { DERIVED_VARIABLES, THEME_TOKENS, type ThemeTokenGroup } from './contract.js';
import { WARM_PAPER } from './themes/warm-paper.js';

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
  | 'literal-radius'
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
const THEME_TABLES = 'the theme tables (src/packages/workbench-theme/lib/themes/)';
const CONTRACT_DOC = 'docs/workbench-theme-contract.md';

// ---------------------------------------------------------------------------
// Registered exceptions
// ---------------------------------------------------------------------------

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

/**
 * Literal corner radii that are shapes rather than one of the contract's radii, by file and
 * by the value as written (`22px` for `rounded-[22px]`, the whole declaration value for a
 * stylesheet). Register a value here with the reason. A pill (`999px`) or a circle (`50%`)
 * is a shape and needs no registration.
 */
const RADIUS_EXCEPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'src/web/components/prototype/VisualReferencePicker.tsx': {
    '22px': 'the bezel of the phone mock-up that frames a mobile reference, not a workbench surface',
  },
  'src/web/shell.css': {
    '0 3px 3px 0': 'the active navigation marker: a 3px bar rounded fully on its open side',
  },
};

/** Custom-property prefixes owned by libraries, which the workbench may read. */
const LIBRARY_VARIABLE_PREFIXES = ['tw-'];

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

type RetiredKind = 'colour' | 'font' | 'backdrop' | 'radius';

interface RetiredName {
  /** The contract token or derived variable that replaced it. */
  replacement: string;
  kind: RetiredKind;
}

function retired(kind: RetiredKind, names: Readonly<Record<string, string>>): Record<string, RetiredName> {
  return Object.fromEntries(Object.entries(names).map(([name, replacement]) => [name, { replacement, kind }]));
}

/** Pre-contract names, each with what it was and what replaced it. */
const RETIRED: Readonly<Record<string, RetiredName>> = {
  ...retired('colour', {
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
  }),
  ...retired('font', {
    serif: 'font-title',
    sans: 'font-sans',
    mono: 'font-mono',
  }),
  ...retired('backdrop', {
    'paper-grain-url': 'backdrop-image',
    'paper-grain-size': 'backdrop-size',
  }),
  ...retired('radius', {
    'radius-chip': 'radius-sm',
    'radius-control': 'radius-md',
  }),
};
const RETIRED_UTILITIES: Readonly<Record<string, string>> = {
  'font-serif': 'font-title',
  'rounded-chip': 'rounded-sm',
  'rounded-control': 'rounded-md',
};

const CONTRACT = new Set(THEME_TOKENS.map((token) => token.name));
const DERIVED = new Set(DERIVED_VARIABLES.map((variable) => variable.name));
const isAppearanceName = (name: string) => CONTRACT.has(name) || DERIVED.has(name);

const tokensIn = (group: ThemeTokenGroup) => THEME_TOKENS.filter((token) => token.group === group).map((token) => token.name);
/** The four elevations; `shadow-color` is a colour, not a shadow. */
const CONTRACT_SHADOWS = tokensIn('shadow').filter((name) => name !== 'shadow-color');
const DERIVED_SHADOWS = DERIVED_VARIABLES.map((variable) => variable.name).filter((name) => name.startsWith('shadow-'));
const RADIUS_TOKENS = tokensIn('radius');
const radiusUtility = (token: string, prefix = 'rounded') => `${prefix}-${token.slice('radius-'.length)}`;
/** The radius token of each size, as 暖纸 sets it, so moving a literal onto it keeps 暖纸 unchanged. */
const RADIUS_TOKEN_BY_SIZE = new Map(RADIUS_TOKENS.map((token) => [WARM_PAPER.light[token]!, token]));
const RADIUS_SIZES = RADIUS_TOKENS.map((token) => `${WARM_PAPER.light[token]} (${token})`).join(', ');

const COLOUR_UTILITY_PREFIXES =
  'bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|decoration|placeholder|caret|accent|shadow';
const TAILWIND_PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const alternation = (names: readonly string[]) =>
  [...names]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
const RETIRED_COLOUR_NAMES = alternation(Object.keys(RETIRED).filter((name) => RETIRED[name]!.kind === 'colour'));

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

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
const RETIRED_UTILITY = new RegExp(`(?<![\\w$.-])(${alternation(Object.keys(RETIRED_UTILITIES))})(?![\\w-])`, 'g');
/** A length in a radius value. */
const LENGTH = /(?<![\w.-])\d*\.?\d+(?:px|r?em)\b/g;
const CSS_RADIUS = /(?<![\w-])(border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius)\s*:\s*([^;{}]+)/g;
const RADIUS_UTILITY = /(?<![\w$.-])(rounded(?:-[trblse]{1,2})?)-\[([^\]\s]+)\]/g;
/** `borderRadius: 6` or `borderTopLeftRadius: '6px'` in a style object. */
const STYLE_RADIUS =
  /(?<![\w$.-])(border(?:Top|Bottom|Start|End)?(?:Left|Right|Start|End)?Radius)\s*:\s*(?:(\d+(?:\.\d+)?)(?![\w.$])|(['"`])([^'"`$]*)\3)/g;

/**
 * `accent` and `muted` before the contract meant the brand colour and secondary text; in
 * the contract they are the hover fill and the quiet fill (#41).
 */
interface OldMeaning {
  what: string;
  hint: string;
  /** Matched in every guarded file. */
  pattern: RegExp;
  /** Also matched, in stylesheets only. */
  cssPattern?: RegExp;
}

const OLD_MEANINGS: readonly OldMeaning[] = [
  {
    what: 'the text-muted utility paints text in the quiet fill',
    hint: 'Secondary text is text-muted-foreground.',
    pattern: /(?<![\w-])text-muted(?![\w-])/g,
  },
  {
    what: 'accent as a text, border, or ring colour utility is the hover fill, not the brand colour',
    hint: 'The brand colour is primary (text-primary, border-primary, ring-ring).',
    pattern:
      /(?<![\w-])(?:text|border(?:-[xytrblse])?|ring|outline|decoration|fill|stroke|caret|divide|placeholder)-accent(?![\w-])/g,
  },
  // SVG `fill` is left out below: it paints shapes such as graph cards and label
  // backgrounds, which is what the quiet fill and the hover fill are for.
  {
    what: 'var(--accent) or var(--muted) as a text, border, or outline colour reads a fill',
    hint: 'Use var(--primary) for the brand colour or var(--muted-foreground) for secondary text.',
    // In an inline style object.
    pattern:
      /(?<![\w-])(?:color|border\w*|outline\w*|stroke|caretColor|accentColor|textDecoration\w*|boxShadow)\s*:\s*(?:[^'"`\n]*\?\s*)?['"`][^'"`]*var\(--(?:accent|muted)[\s,)]/g,
    cssPattern:
      /(?<![\w-])(?:color|border[\w-]*|outline[\w-]*|stroke|caret-color|accent-color|text-decoration[\w-]*|box-shadow)\s*:[^;{}]*?var\(--(?:accent|muted)[\s,)]/g,
  },
];

// ---------------------------------------------------------------------------
// Reading the sources
// ---------------------------------------------------------------------------

interface GuardedFile {
  path: string;
  /** The source with CSS comments blanked, keeping every character's position. */
  text: string;
  /** The source as written, comments included. */
  content: string;
  isCss: boolean;
  designedApp: boolean;
}

interface Declaration {
  file: string;
  /** Offset in the file's text. */
  index: number;
  name: string;
  value: string;
  /** Declared inside an `@theme` block, where it names a Tailwind utility. */
  inThemeBlock: boolean;
}

/** What one file's check needs to know about all the others. */
interface Sources {
  declarations: readonly Declaration[];
  declared: ReadonlySet<string>;
  /** Variable name to the files that read it. */
  readers: ReadonlyMap<string, ReadonlySet<string>>;
}

type Report = (index: number, kind: AppearanceProblemKind, message: string, hint: string) => void;
type Check = (file: GuardedFile, sources: Sources, report: Report) => void;

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

function readSources(files: readonly GuardedFile[]): Sources {
  const declarations: Declaration[] = [];
  const readers = new Map<string, Set<string>>();
  for (const file of files) {
    const blocks = file.isCss ? themeBlocks(file.text) : [];
    for (const match of file.text.matchAll(CSS_DECLARATION)) {
      const index = match.index!;
      const inThemeBlock = blocks.some(([start, end]) => index >= start && index < end);
      declarations.push({ file: file.path, index, name: match[1]!, value: match[2]!, inThemeBlock });
    }
    if (!file.isCss) {
      for (const match of file.text.matchAll(SCRIPT_DECLARATION)) {
        declarations.push({ file: file.path, index: match.index!, name: match[1]!, value: '', inThemeBlock: false });
      }
    }
    for (const match of file.text.matchAll(VARIABLE_REFERENCE)) {
      const name = (match[1] ?? match[2])!;
      if (!readers.has(name)) readers.set(name, new Set());
      readers.get(name)!.add(file.path);
    }
  }
  return { declarations, declared: new Set(declarations.map((declaration) => declaration.name)), readers };
}

const readsAppearance = (value: string) =>
  [...value.matchAll(VARIABLE_REFERENCE)].some((match) => isAppearanceName((match[1] ?? match[2])!)) ||
  CSS_LITERAL_COLOUR.test(value) ||
  /color-mix\(/.test(value);

function useInstead(name: string): string {
  const { replacement } = RETIRED[name]!;
  return `Use var(--${replacement}) (${CONTRACT.has(replacement) ? 'contract token' : 'shared derived variable'}).`;
}

/** The non-zero lengths a radius value writes outside `var()`, except a pill's 999px. */
function literalRadii(value: string): string[] {
  let rest = value;
  for (let previous = ''; previous !== rest; ) {
    previous = rest;
    rest = rest.replace(/var\([^()]*\)/g, ' ');
  }
  return [...rest.matchAll(LENGTH)]
    .map((match) => match[0])
    .filter((length) => parseFloat(length) !== 0 && !/^9{3,}px$/.test(length));
}

/** The value with each length that a radius token has in 暖纸 written as that token. */
const tokenised = (value: string) =>
  value.replace(LENGTH, (length) => {
    const token = RADIUS_TOKEN_BY_SIZE.get(length);
    return token ? `var(--${token})` : length;
  });

/** What a literal radius should be written as, or where to register it. */
function radiusHint(path: string, value: string, lengths: readonly string[], instead: string): string {
  const missing = lengths.filter((length) => !RADIUS_TOKEN_BY_SIZE.has(length));
  if (missing.length === 0) return `Use ${instead} (the same size in 暖纸).`;
  return `No radius token is ${[...new Set(missing)].join(', ')}; the radius tokens are ${RADIUS_SIZES} in 暖纸. Use the nearest, or register "${value}" for ${path} with its reason in RADIUS_EXCEPTIONS in ${GUARD_FILE}.`;
}

// ---------------------------------------------------------------------------
// Checks: each reads one file and reports what it finds through `report`
// ---------------------------------------------------------------------------

/** `@theme` names Tailwind utilities; one named differently from the token it paints is an alias (`bg-page`). */
const checkThemeMappings: Check = (file, sources, report) => {
  for (const { name, value, index, inThemeBlock, file: path } of sources.declarations) {
    if (path !== file.path || !inThemeBlock) continue;
    const target = /^var\(--([\w-]+)\)$/.exec(value.trim())?.[1];
    if (target && isAppearanceName(target) && name !== target && name !== `color-${target}`) {
      report(
        index,
        'theme-mapping',
        `@theme maps --${name} to --${target}, which makes a utility named differently from the token it paints.`,
        `Write the utility with the token's own name (\`--color-${target}: var(--${target})\` for colours, \`--${target}: var(--${target})\` otherwise).`,
      );
    }
  }
};

/** No retired names, no contract tokens outside the theme stylesheet, and no colour shared between files without registering it. */
const checkDeclarations: Check = (file, sources, report) => {
  if (file.designedApp) return;
  for (const { name, value, index, inThemeBlock, file: path } of sources.declarations) {
    if (path !== file.path || inThemeBlock) continue;
    if (name in RETIRED) {
      report(index, 'retired-name', `--${name} is a retired pre-contract name and may not be defined again.`, useInstead(name));
    } else if (isAppearanceName(name)) {
      const token = CONTRACT.has(name);
      report(
        index,
        'redefined-token',
        token
          ? `--${name} is a contract token; only a Workbench Theme gives it a value.`
          : `--${name} is a shared derived variable; the generated theme stylesheet defines it.`,
        `Change it in ${token ? THEME_TABLES : DERIVED_HOME} and run \`pnpm themes:generate\`.`,
      );
    } else if (readsAppearance(value)) {
      const declaringFiles = new Set(sources.declarations.filter((other) => other.name === name).map((other) => other.file));
      const sharedWith = [...(sources.readers.get(name) ?? [])].filter((reader) => !declaringFiles.has(reader));
      if (sharedWith.length > 0) {
        report(
          index,
          'unregistered-derived',
          `--${name} is computed from theme colours and read in other files (${sharedWith.join(', ')}).`,
          `Register a colour or shadow shared between files in ${DERIVED_HOME}, or keep the variable inside the one file that reads it.`,
        );
      }
    }
  }
};

/** References: contract tokens, derived variables, or variables the workbench declares. */
const checkReferences: Check = (file, sources, report) => {
  for (const match of file.text.matchAll(VARIABLE_REFERENCE)) {
    const name = (match[1] ?? match[2])!;
    if (isAppearanceName(name) || LIBRARY_VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    if (name in RETIRED && !(file.designedApp && sources.declared.has(name))) {
      report(match.index!, 'retired-name', `--${name} is a retired pre-contract name.`, useInstead(name));
    } else if (!sources.declared.has(name)) {
      report(
        match.index!,
        'unknown-variable',
        `--${name} is not a contract token, not a shared derived variable, and not declared anywhere in src/web.`,
        `Use a contract token (${CONTRACT_DOC}); register a new shared colour or shadow in ${DERIVED_HOME}.`,
      );
    }
  }
};

/** Utilities written with a retired name. */
const checkRetiredUtilities: Check = (file, _sources, report) => {
  if (file.isCss) return;
  for (const match of file.text.matchAll(RETIRED_COLOUR_UTILITY)) {
    if (match[1] === 'ring' && match[2] === 'inset') continue; // Tailwind's inset ring, not a colour.
    report(
      match.index!,
      'retired-name',
      `${match[0]} is written with a retired pre-contract name.`,
      `Use ${match[1]}-${RETIRED[match[2]!]!.replacement}.`,
    );
  }
  for (const match of file.text.matchAll(RETIRED_UTILITY)) {
    report(match.index!, 'retired-name', `${match[0]} is a retired utility name.`, `Use ${RETIRED_UTILITIES[match[1]!]}.`);
  }
};

/** Shadows and radii from the Tailwind default scale, which no theme sets. */
const checkScaleUtilities: Check = (file, _sources, report) => {
  if (file.isCss) return;
  const shadows = `a contract shadow (${CONTRACT_SHADOWS.join(', ')})`;
  for (const match of file.text.matchAll(TAILWIND_SCALE_UTILITY)) {
    const hint = match[1]
      ? `Use ${shadows} or a shared derived shadow (${DERIVED_SHADOWS.join(', ')}).`
      : match[2]
        ? `Use a contract radius: ${RADIUS_TOKENS.map((token) => radiusUtility(token)).join(', ')}.`
        : `Use ${shadows} or register a shared derived shadow.`;
    report(
      match.index!,
      'outside-contract',
      `${match[0]} reads the Tailwind default scale, which no Workbench Theme sets.`,
      `${hint} See ${CONTRACT_DOC}.`,
    );
  }
};

/** `accent` and `muted` used with their pre-contract meaning. */
const checkOldMeanings: Check = (file, _sources, report) => {
  for (const { what, hint, pattern, cssPattern } of OLD_MEANINGS) {
    for (const regex of file.isCss && cssPattern ? [pattern, cssPattern] : [pattern]) {
      for (const match of file.text.matchAll(regex)) report(match.index!, 'old-meaning', what, hint);
    }
  }
};

/** Corner radii come from the radius tokens, except shapes registered in `RADIUS_EXCEPTIONS`. */
const checkLiteralRadii: Check = (file, _sources, report) => {
  const registered = RADIUS_EXCEPTIONS[file.path] ?? {};
  const check = (index: number, written: string, value: string, instead: string) => {
    const lengths = literalRadii(value);
    if (lengths.length === 0 || value in registered) return;
    report(index, 'literal-radius', `literal corner radius in "${written}"`, radiusHint(file.path, value, lengths, instead));
  };
  if (file.isCss) {
    for (const match of file.text.matchAll(CSS_RADIUS)) {
      const [, property, raw] = match;
      const value = raw!.trim().replace(/\s+/g, ' ');
      check(match.index!, `${property}: ${value}`, value, `${property}: ${tokenised(value)}`);
    }
    return;
  }
  for (const match of file.text.matchAll(RADIUS_UTILITY)) {
    const [written, prefix, value] = match;
    const token = RADIUS_TOKEN_BY_SIZE.get(value!);
    check(match.index!, written, value!, token ? radiusUtility(token, prefix) : `${prefix}-[${tokenised(value!)}]`);
  }
  for (const match of file.text.matchAll(STYLE_RADIUS)) {
    const [written, property, number, , text] = match;
    const value = number !== undefined ? `${number}px` : text!;
    check(match.index!, written, value, `${property}: '${tokenised(value)}'`);
  }
};

/** Literal colours: only in the generated theme stylesheet and the registered designed-app files. */
const checkLiteralColours: Check = (file, _sources, report) => {
  if (file.designedApp) {
    if (!DESIGNED_APP_NOTE.test(file.content)) {
      report(
        0,
        'unexplained-exception',
        `${file.path} may paint literal colours because it shows the designed app (${DESIGNED_APP_FILES[file.path]}), but it does not say so.`,
        'Add a comment saying its colours belong to the designed app, "not workbench appearance".',
      );
    }
    return;
  }
  const hint = `Use a contract token (${CONTRACT_DOC}) or a shared derived variable. A file that paints the user's designed app is registered in DESIGNED_APP_FILES in ${GUARD_FILE}.`;
  if (file.isCss) {
    for (const match of file.text.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
      const [, property, value] = match;
      // Masks only use the alpha channel, so the colour they name is not appearance.
      if (/^(?:-webkit-)?mask/.test(property!) || !CSS_LITERAL_COLOUR.test(value!)) continue;
      report(match.index!, 'literal-colour', `literal colour in "${match[0].trim().replace(/\s+/g, ' ')}"`, hint);
    }
    return;
  }
  for (const match of file.text.matchAll(SCRIPT_LITERAL_COLOUR)) {
    report(match.index!, 'literal-colour', `literal colour ${match[0]}`, hint);
  }
  for (const match of file.text.matchAll(PALETTE_UTILITY)) {
    report(match.index!, 'literal-colour', `${match[0]} paints a fixed Tailwind palette colour`, hint);
  }
};

const CHECKS: readonly Check[] = [
  checkThemeMappings,
  checkDeclarations,
  checkReferences,
  checkRetiredUtilities,
  checkScaleUtilities,
  checkOldMeanings,
  checkLiteralRadii,
  checkLiteralColours,
];

/**
 * Every place the given workbench sources take appearance from anything other than a
 * contract token or a registered shared derived variable. Files outside `src/web`, tests,
 * and the generated theme stylesheet are ignored, so a caller may pass more than that.
 * Problems come in file order, then in the order they appear in the file.
 */
export function checkWorkbenchSources(files: readonly SourceFile[]): AppearanceProblem[] {
  const guarded: GuardedFile[] = files
    .filter((file) => isGuarded(file.path) && !(file.path in PROTOTYPE_STYLESHEETS))
    .map((file) => {
      const isCss = file.path.endsWith('.css');
      return {
        path: file.path,
        content: file.content,
        text: isCss ? withoutCssComments(file.content) : file.content,
        isCss,
        designedApp: file.path in DESIGNED_APP_FILES,
      };
    });
  const sources = readSources(guarded);
  const found: Array<{ index: number; problem: AppearanceProblem }> = [];
  for (const file of guarded) {
    const report: Report = (index, kind, message, hint) =>
      found.push({ index, problem: { file: file.path, line: lineAt(file.text, index), kind, message, hint } });
    for (const check of CHECKS) check(file, sources, report);
  }
  return found
    .sort((a, b) => a.problem.file.localeCompare(b.problem.file) || a.index - b.index)
    .map(({ problem }) => problem);
}

/** One problem per line, for a terminal. */
export function formatAppearanceProblems(problems: readonly AppearanceProblem[]): string {
  return problems.map((problem) => `${problem.file}:${problem.line}: ${problem.message}\n    -> ${problem.hint}`).join('\n');
}
