/**
 * The shared look of a generated prototype (spec #87 decision 2, #91): the design values and the
 * shared components every screen is built from, drawn first on the 「风格样张」 artboard.
 *
 * The values are the prototype's own (the application being designed), never the workbench's.
 * Values the user approved in the Design Brief's Style Tile are locked: whatever the lead
 * proposes, a locked value wins. The style lives in the single `界面原型.html` (ADR 0005): the
 * values and component CSS in `<style data-proto-style>`, the component samples in
 * `<template data-proto-style-tile>`, both in `<head>`, so no screen, anchor or MU extraction
 * ever sees the samples and the style survives save and reload.
 */

export interface PrototypeStyleValues {
  mode: 'light' | 'dark';
  /** Page ground. */
  background: string;
  /** Cards, panels, bars. */
  surface: string;
  /** Sunken areas: table heads, inputs on surface, segmented controls. */
  inset: string;
  /** The one strong accent: primary actions and current state. */
  accent: string;
  /** Text on the accent. */
  accentInk: string;
  border: string;
  ink: string;
  mutedInk: string;
  ok: string;
  warn: string;
  danger: string;
  fontFamily: string;
  radiusPx: number;
  density: 'compact' | 'comfortable';
}

export type PrototypeStyleValueKey = keyof PrototypeStyleValues;

export const PROTOTYPE_STYLE_VALUE_KEYS: readonly PrototypeStyleValueKey[] = [
  'mode',
  'background',
  'surface',
  'inset',
  'accent',
  'accentInk',
  'border',
  'ink',
  'mutedInk',
  'ok',
  'warn',
  'danger',
  'fontFamily',
  'radiusPx',
  'density',
];

const COLOR_KEYS: readonly PrototypeStyleValueKey[] = [
  'background',
  'surface',
  'inset',
  'accent',
  'accentInk',
  'border',
  'ink',
  'mutedInk',
  'ok',
  'warn',
  'danger',
];

/**
 * Only fills keys the lead left out (or wrote unusably). A sober neutral, not a look: the lead
 * is told to propose every value when no Style Tile was approved.
 */
const FALLBACK_LIGHT: PrototypeStyleValues = {
  mode: 'light',
  background: '#f5f6f8',
  surface: '#ffffff',
  inset: '#eceef2',
  accent: '#33507a',
  accentInk: '#ffffff',
  border: '#dde1e7',
  ink: '#1c2330',
  mutedInk: '#5d6675',
  ok: '#2f7d4f',
  warn: '#a8641a',
  danger: '#b03a32',
  fontFamily: "system-ui, -apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif",
  radiusPx: 8,
  density: 'comfortable',
};

const FALLBACK_DARK: PrototypeStyleValues = {
  ...FALLBACK_LIGHT,
  mode: 'dark',
  background: '#14171c',
  surface: '#1c2027',
  inset: '#252a33',
  accent: '#8fb0e0',
  accentInk: '#10141a',
  border: '#323844',
  ink: '#eef1f5',
  mutedInk: '#9aa3b2',
  ok: '#6cc28f',
  warn: '#e0a75a',
  danger: '#ec7a70',
};

const COLOR_RE =
  /^(?:#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9a-zA-Z.,%\s/+-]{1,80}\))$/;

function readColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return COLOR_RE.test(value) ? value : undefined;
}

function readFont(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.replace(/[;{}<>\\]/g, '').trim();
  return value.length > 0 && value.length <= 200 ? value : undefined;
}

function readRadius(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(32, Math.round(n)));
}

/** The usable values in `raw` (a partial, possibly still streaming object); unusable ones are left out. */
export function readPrototypeStyleValues(raw: unknown): Partial<PrototypeStyleValues> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const rec = raw as Record<string, unknown>;
  const out: Partial<PrototypeStyleValues> = {};
  if (rec.mode === 'light' || rec.mode === 'dark') out.mode = rec.mode;
  for (const key of COLOR_KEYS) {
    const color = readColor(rec[key]);
    if (color) (out as Record<string, unknown>)[key] = color;
  }
  const font = readFont(rec.fontFamily);
  if (font) out.fontFamily = font;
  const radius = readRadius(rec.radiusPx);
  if (radius !== undefined) out.radiusPx = radius;
  if (rec.density === 'compact' || rec.density === 'comfortable') out.density = rec.density;
  return out;
}

/** A complete value set from a partial one (missing keys take the neutral fallback of its mode). */
export function completePrototypeStyleValues(partial: Partial<PrototypeStyleValues>): PrototypeStyleValues {
  const base = partial.mode === 'dark' ? FALLBACK_DARK : FALLBACK_LIGHT;
  return { ...base, ...partial };
}

export interface ResolvedPrototypeStyleValues {
  values: PrototypeStyleValues;
  /** True when approved Style Tile values were applied. */
  locked: boolean;
  /** Keys the lead proposed differently from the approved values (the approved ones were kept). */
  overridden: PrototypeStyleValueKey[];
}

/**
 * The values a build uses: approved Style Tile values win over whatever the lead proposed;
 * without them, the lead's proposal (completed where it left keys out).
 */
export function resolvePrototypeStyleValues(
  proposed: unknown,
  locked?: Partial<PrototypeStyleValues> | null,
): ResolvedPrototypeStyleValues {
  const fromLead = readPrototypeStyleValues(proposed);
  const approved = locked ? readPrototypeStyleValues(locked) : {};
  const hasLock = Object.keys(approved).length > 0;
  const overridden = hasLock
    ? PROTOTYPE_STYLE_VALUE_KEYS.filter(
        (k) => k in approved && k in fromLead && fromLead[k] !== approved[k],
      )
    : [];
  return {
    values: completePrototypeStyleValues({ ...fromLead, ...approved }),
    locked: hasLock,
    overridden,
  };
}

/** The values as CSS custom properties on `:root` (the names every screen uses). */
export function prototypeStyleValuesCss(values: PrototypeStyleValues): string {
  const compact = values.density === 'compact';
  const decl: [string, string][] = [
    ['--proto-bg', values.background],
    ['--proto-card', values.surface],
    ['--proto-inset', values.inset],
    ['--proto-accent', values.accent],
    ['--proto-accent-ink', values.accentInk],
    ['--proto-border', values.border],
    ['--proto-text', values.ink],
    ['--proto-muted', values.mutedInk],
    ['--proto-ok', values.ok],
    ['--proto-warn', values.warn],
    ['--proto-danger', values.danger],
    ['--proto-font', values.fontFamily],
    ['--proto-radius', `${values.radiusPx}px`],
    ['--proto-radius-sm', `${Math.max(2, Math.round(values.radiusPx * 0.6))}px`],
    ['--proto-gap', compact ? '12px' : '18px'],
    ['--proto-pad', compact ? '12px' : '18px'],
    ['--proto-control-h', compact ? '32px' : '38px'],
  ];
  return `:root {\n  color-scheme: ${values.mode};\n${decl.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;
}

/** Every CSS variable the values define, for prompts (name → what it is for). */
export const PROTOTYPE_STYLE_VARIABLES: readonly { name: string; role: string }[] = [
  { name: '--proto-bg', role: 'page ground' },
  { name: '--proto-card', role: 'cards, panels, bars' },
  { name: '--proto-inset', role: 'sunken areas, table heads' },
  { name: '--proto-accent', role: 'the one accent: primary action, current state' },
  { name: '--proto-accent-ink', role: 'text on the accent' },
  { name: '--proto-border', role: 'hairlines and borders' },
  { name: '--proto-text', role: 'body text' },
  { name: '--proto-muted', role: 'secondary text' },
  { name: '--proto-ok', role: 'success status' },
  { name: '--proto-warn', role: 'needs attention' },
  { name: '--proto-danger', role: 'error, destructive' },
  { name: '--proto-font', role: 'font family' },
  { name: '--proto-radius', role: 'card radius' },
  { name: '--proto-radius-sm', role: 'control radius' },
  { name: '--proto-gap', role: 'gap between blocks (density)' },
  { name: '--proto-pad', role: 'padding inside cards (density)' },
  { name: '--proto-control-h', role: 'button and input height (density)' },
];

export interface PrototypeStyle {
  /** One sentence naming the visual direction, in business language. */
  direction: string;
  values: PrototypeStyleValues;
  /** CSS of the shared components, written on the variables above. */
  componentCss: string;
  /** The 「风格样张」: the shared components drawn with sample content. */
  sampleHtml: string;
  /** The values came from an approved Style Tile. */
  locked: boolean;
}

export const PROTOTYPE_STYLE_ATTR = 'data-proto-style';
export const PROTOTYPE_STYLE_TILE_ATTR = 'data-proto-style-tile';

/** Keeps component CSS inside its own `<style>` element. */
export function sanitizeStyleCss(css: string): string {
  return css.replace(/<\/?style[^>]*>?/gi, '').replace(/<\/?template[^>]*>?/gi, '');
}

/** Keeps sample HTML inside its `<template>` and free of anchors (it is not a screen). */
export function sanitizeStyleSampleHtml(html: string): string {
  return html
    .replace(/<\/?template[^>]*>?/gi, '')
    .replace(/<script\b[\s\S]*?(?:<\/script>|$)/gi, '')
    .replace(/\sdata-(?:screen-id|element-id|event-id|binding)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function escapeAttr(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeAttr(raw: string): string {
  return raw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The full stylesheet of a style: values first, then the shared components. */
export function prototypeStyleCss(style: Pick<PrototypeStyle, 'values' | 'componentCss'>): string {
  const components = sanitizeStyleCss(style.componentCss).trim();
  return `${prototypeStyleValuesCss(style.values)}${components ? `\n${components}` : ''}`;
}

/** The `<head>` blocks that carry a style in the document. */
export function prototypeStyleHeadHtml(style: PrototypeStyle): string {
  const sample = sanitizeStyleSampleHtml(style.sampleHtml).trim();
  const direction = style.direction.trim();
  return [
    `<style ${PROTOTYPE_STYLE_ATTR}${style.locked ? ' data-proto-style-locked' : ''}>\n${prototypeStyleCss(style)}\n</style>`,
    sample
      ? `<template ${PROTOTYPE_STYLE_TILE_ATTR}${direction ? ` data-direction="${escapeAttr(direction)}"` : ''}>\n${sample}\n</template>`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const STYLE_BLOCK_RE = new RegExp(`\\s*<style\\b[^>]*\\s${PROTOTYPE_STYLE_ATTR}\\b[^>]*>[\\s\\S]*?<\\/style>`, 'i');
const TILE_BLOCK_RE = new RegExp(
  `\\s*<template\\b([^>]*\\s${PROTOTYPE_STYLE_TILE_ATTR}\\b[^>]*)>([\\s\\S]*?)<\\/template>`,
  'i',
);

/**
 * The document with this style as its shared look: an existing style is replaced in place,
 * otherwise the style goes first in `<head>` (so screen CSS added later stays after it).
 */
export function applyPrototypeStyleToDocument(html: string, style: PrototypeStyle): string {
  const blocks = prototypeStyleHeadHtml(style);
  const withoutOld = html.replace(TILE_BLOCK_RE, '').replace(STYLE_BLOCK_RE, '');
  const headOpen = /<head\b[^>]*>/i.exec(withoutOld);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    // After the charset/viewport metas and the title, before any other style.
    const rest = withoutOld.slice(at);
    const firstStyle = rest.search(/<style\b|<link\b|<script\b/i);
    const insertAt = firstStyle >= 0 ? at + firstStyle : at + rest.search(/<\/head>/i);
    return `${withoutOld.slice(0, insertAt)}${blocks}\n  ${withoutOld.slice(insertAt)}`;
  }
  return `${blocks}\n${withoutOld}`;
}

export interface PrototypeDocumentStyle {
  css: string;
  sampleHtml: string;
  direction: string;
  locked: boolean;
}

/** The style a document (or its `<head>` HTML) carries; null when it has none. */
export function readPrototypeDocumentStyle(html: string): PrototypeDocumentStyle | null {
  const styleMatch = STYLE_BLOCK_RE.exec(html ?? '');
  if (!styleMatch) return null;
  const openTag = /<style\b[^>]*>/i.exec(styleMatch[0])?.[0] ?? '';
  const css = styleMatch[0].trim().replace(/^<style\b[^>]*>/i, '').replace(/<\/style>$/i, '').trim();
  const tile = TILE_BLOCK_RE.exec(html);
  const direction = tile ? /\sdata-direction\s*=\s*"([^"]*)"/i.exec(tile[1] ?? '')?.[1] : undefined;
  return {
    css,
    sampleHtml: tile ? (tile[2] ?? '').trim() : '',
    direction: direction ? unescapeAttr(direction) : '',
    locked: /\sdata-proto-style-locked\b/i.test(openTag),
  };
}

/**
 * Layout of the 「风格样张」 artboard around the lead's samples: it only uses the style's own
 * variables, so the artboard shows the prototype's look, not the workbench's.
 */
export const PROTOTYPE_STYLE_TILE_CSS = `body { margin: 0; background: var(--proto-bg); color: var(--proto-text); font-family: var(--proto-font); line-height: 1.5; }
.proto-style-tile { display: grid; gap: var(--proto-gap, 18px); padding: clamp(16px, 3vw, 40px); }`;

/** The `<body>` inner HTML of the 「风格样张」 artboard. */
export function prototypeStyleTileBody(sampleHtml: string): string {
  return sampleHtml.trim() ? `<main class="proto-style-tile">\n${sampleHtml}\n</main>` : '';
}
