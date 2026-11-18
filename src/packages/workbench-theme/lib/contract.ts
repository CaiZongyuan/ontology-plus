/**
 * The Workbench Theme contract (ADR 0015): the only appearance tokens a
 * component may read, and the only ones a theme may set.
 *
 * Renaming or removing a token breaks themes and bumps
 * `THEME_CONTRACT_VERSION`; so does renaming or removing a shared derived
 * variable, which components read as they read tokens. `docs/workbench-theme-contract.md` is generated
 * from this file; a test keeps the two in step.
 */

export const THEME_CONTRACT_VERSION = 1;

export type ThemeTokenGroup = 'color' | 'status' | 'model' | 'font' | 'radius' | 'shadow' | 'backdrop';

export const THEME_TOKEN_GROUPS: Readonly<Record<ThemeTokenGroup, string>> = {
  color: 'Colours and surfaces',
  status: 'Status colours',
  model: 'Ontology model colours',
  font: 'Fonts',
  radius: 'Corner radii',
  shadow: 'Shadows',
  backdrop: 'Background texture',
};

export interface ThemeTokenSpec {
  /** Without the leading `--`. */
  name: string;
  group: ThemeTokenGroup;
  description: string;
  /** The token this one follows when a theme leaves it unset. */
  fallback?: string;
}

type Entry = readonly [name: string, description: string, fallback?: string];

function group(name: ThemeTokenGroup, entries: readonly Entry[]): ThemeTokenSpec[] {
  return entries.map(([token, description, fallback]) => ({
    name: token,
    group: name,
    description,
    ...(fallback ? { fallback } : {}),
  }));
}

/** The knowledge graph's per-model colours, in the order of the ontology stages. */
const MODEL_COLOUR_TOKENS = [
  'model-m1',
  'model-m2',
  'model-m3',
  'model-me',
  'model-m4',
  'model-m5',
  'model-m6',
  'model-m7',
  'model-mu',
  'model-mm',
  'model-mi',
] as const;

export const THEME_TOKENS: readonly ThemeTokenSpec[] = [
  ...group('color', [
    ['background', 'The page ground everything sits on.'],
    ['canvas', 'A deeper ground: the navigation rail, wells, and the area behind panels.'],
    ['foreground', 'Body text and primary headings.'],
    ['foreground-soft', 'Text one step quieter than body text, such as secondary headings.'],
    ['card', 'Bounded surfaces: cards and panels.'],
    ['card-foreground', 'Text on a card.', 'foreground'],
    ['popover', 'Raised surfaces: menus, popovers, and dialogs.', 'card'],
    ['popover-foreground', 'Text on a raised surface.', 'foreground'],
    ['muted', 'Quiet fill for insets, fields, and table headers.'],
    ['muted-foreground', 'Secondary text.'],
    ['faint-foreground', 'Tertiary text: captions, meta, and placeholders.'],
    ['accent', 'Hover and pressed fill on rows and quiet controls; may be translucent.'],
    ['accent-foreground', 'Text on the hover fill.', 'foreground'],
    ['primary', 'The single primary action of a region, selection, and links.'],
    ['primary-foreground', 'Text on primary.'],
    ['primary-soft', 'Tinted fill behind selected or highlighted items; may be translucent.'],
    ['secondary', 'Fill of secondary buttons.', 'muted'],
    ['secondary-foreground', 'Text on a secondary button.', 'foreground'],
    ['border', 'Dividers and the outline of surfaces.'],
    ['border-subtle', 'Quieter dividers inside a surface.'],
    ['input', 'The outline of inputs.', 'border'],
    ['ring', 'Focus ring colour.', 'primary'],
    ['scrollbar-thumb', 'The scrollbar thumb; a mark, not text.'],
    ['overlay', 'The scrim behind modal dialogs and lightboxes, as an opaque colour; each caller sets its opacity.'],
  ]),
  ...group('status', [
    ['success', 'Pass and success, as text or a mark.'],
    ['success-soft', 'Tinted fill behind a success badge; may be translucent.'],
    ['warning', 'Warning, as text or a mark.'],
    ['warning-soft', 'Tinted fill behind a warning badge; may be translucent.'],
    ['destructive', 'Errors and destructive actions, as text or a mark.'],
    ['destructive-foreground', 'Text on a destructive fill, such as a confirm-delete button.', 'primary-foreground'],
    ['destructive-soft', 'Tinted fill behind an error badge; may be translucent.'],
  ]),
  ...group('model', [
    ...MODEL_COLOUR_TOKENS.map((token, index): Entry => {
      const model = token.slice('model-'.length).toUpperCase();
      return [
        token,
        index === 0
          ? `Marks model ${model} in the knowledge graph: lanes, nodes, chips, and the minimap.`
          : `Marks model ${model} in the knowledge graph.`,
      ];
    }),
    ['model-foreground', 'Text on a model colour, such as the model code on a badge.'],
  ]),
  ...group('font', [
    ['font-title', 'Page titles, card titles, and large metrics.'],
    ['font-sans', 'Everything in the interface that is not a title or an identifier.'],
    ['font-mono', 'Ontology identifiers, code, and paths.'],
  ]),
  ...group('radius', [
    ['radius-xs', 'The smallest corner: checkboxes and inline marks.'],
    ['radius-sm', 'Chips, badges, and compact controls.'],
    ['radius-md', 'Buttons, inputs, and menus items.'],
    ['radius-lg', 'Large insets and media.'],
    ['radius-card', 'Cards and panels.'],
    ['radius-window', 'Dialogs and the outermost frames.'],
  ]),
  ...group('shadow', [
    ['shadow-xs', 'A hairline lift under controls.'],
    ['shadow-sm', 'Cards at rest.'],
    ['shadow-md', 'Raised surfaces: menus and popovers.'],
    ['shadow-lg', 'Overlays: dialogs and drawers.'],
    [
      'shadow-color',
      'The colour of a one-off shadow that is none of the four elevations; mixed with transparent where it is used.',
    ],
  ]),
  ...group('backdrop', [
    ['backdrop-image', 'Texture laid over the page ground, as a CSS background-image; `none` for a flat ground.'],
    ['backdrop-size', 'The background-size of the texture.'],
  ]),
];

export interface DerivedVariableSpec {
  /** Without the leading `--`. */
  name: string;
  /** The CSS value, computed from contract tokens. */
  value: string;
  description: string;
}

/**
 * Shared derived variables: computed from contract tokens and the same for every theme,
 * so a theme sets the tokens they are made of, not these. Components may read them as
 * they read contract tokens, so their names are part of the contract: renaming or removing
 * one bumps `THEME_CONTRACT_VERSION`. They are written to the generated theme stylesheet; a new
 * shared colour or shadow is registered here, not declared in a component stylesheet.
 */
export const DERIVED_VARIABLES: readonly DerivedVariableSpec[] = [
  {
    name: 'accent-strong',
    value: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
    description: 'A stronger hover fill, for controls that already sit on the quiet fill.',
  },
  {
    name: 'border-strong',
    value: 'color-mix(in srgb, var(--muted-foreground) 42%, var(--border))',
    description: 'A stronger outline: control outlines and hovered borders.',
  },
  {
    name: 'focus-ring',
    value: '0 0 0 3px color-mix(in srgb, var(--ring) 28%, transparent)',
    description: 'A soft focus halo, as a box-shadow, for fields that show focus without an outline.',
  },
  {
    name: 'shadow-hairline',
    value: '0 0 0 1px var(--border)',
    description: 'A hairline outline, as a box-shadow.',
  },
  {
    name: 'shadow-btn',
    value: '0 0 0 1px var(--border-strong), var(--shadow-xs)',
    description: '`shadow-xs` with a control outline: buttons and segmented controls.',
  },
  {
    name: 'shadow-card',
    value: '0 0 0 1px var(--border), var(--shadow-sm)',
    description: '`shadow-sm` with a hairline outline, so cards read on any ground.',
  },
  {
    name: 'shadow-raised',
    value: '0 0 0 1px var(--border), var(--shadow-md)',
    description: '`shadow-md` with a hairline outline: menus and popovers.',
  },
  {
    name: 'shadow-overlay',
    value: '0 0 0 1px var(--border), var(--shadow-lg)',
    description: '`shadow-lg` with a hairline outline: dialogs and drawers.',
  },
];

/** The CSS custom property a contract token is emitted as. */
export function cssVarName(token: string): string {
  return `--${token}`;
}

export interface ContrastPair {
  /** The token read as text or as a mark. */
  text: string;
  /** The surface it sits on. */
  on: string;
  /** The opaque surface under `on`, when `on` may be translucent. */
  over?: string;
  /** WCAG contrast ratio the pair has to reach. */
  min: number;
}

const TEXT = 4.5;
const MARK = 3;

function pairs(text: string, min: number, surfaces: readonly (string | readonly [string, string])[]): ContrastPair[] {
  return surfaces.map((surface) =>
    typeof surface === 'string'
      ? { text, on: surface, min }
      : { text, on: surface[0], over: surface[1], min },
  );
}

/** Where each text and mark token is actually used, and the contrast it must reach there. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...pairs('foreground', TEXT, ['background', 'canvas', 'card', 'muted']),
  ...pairs('foreground-soft', TEXT, ['background', 'canvas', 'card', 'muted']),
  ...pairs('muted-foreground', TEXT, ['background', 'canvas', 'card', 'muted']),
  ...pairs('faint-foreground', TEXT, ['background', 'canvas', 'card', 'muted']),
  ...pairs('card-foreground', TEXT, ['card']),
  ...pairs('popover-foreground', TEXT, ['popover']),
  ...pairs('secondary-foreground', TEXT, ['secondary']),
  ...pairs('accent-foreground', TEXT, [
    ['accent', 'card'],
    ['accent', 'background'],
    ['accent', 'canvas'],
  ]),
  ...pairs('primary-foreground', TEXT, ['primary']),
  ...pairs('primary', TEXT, ['background', 'card', ['primary-soft', 'card']]),
  ...pairs('success', TEXT, ['card', ['success-soft', 'card']]),
  ...pairs('warning', TEXT, ['card', ['warning-soft', 'card']]),
  ...pairs('destructive', TEXT, ['card', ['destructive-soft', 'card']]),
  ...pairs('destructive-foreground', TEXT, ['destructive']),
  ...pairs('model-foreground', TEXT, MODEL_COLOUR_TOKENS),
  // Model colours are marks too: lane markers and node stripes on cards, filter dots on the page.
  ...MODEL_COLOUR_TOKENS.flatMap((token) => pairs(token, MARK, ['card', 'background'])),
  ...pairs('ring', MARK, ['background', 'card']),
  ...pairs('scrollbar-thumb', MARK, ['background', 'card']),
];
