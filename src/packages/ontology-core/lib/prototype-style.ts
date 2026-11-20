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

const STYLE_VALUE_PROPERTIES = {
  background: '--proto-bg',
  surface: '--proto-card',
  inset: '--proto-inset',
  accent: '--proto-accent',
  accentInk: '--proto-accent-ink',
  border: '--proto-border',
  ink: '--proto-text',
  mutedInk: '--proto-muted',
  ok: '--proto-ok',
  warn: '--proto-warn',
  danger: '--proto-danger',
  fontFamily: '--proto-font',
} as const;

/** The values as CSS custom properties on `:root` (the names every screen uses). */
export function prototypeStyleValuesCss(values: PrototypeStyleValues): string {
  const compact = values.density === 'compact';
  const decl: [string, string][] = [
    ...Object.entries(STYLE_VALUE_PROPERTIES).map(([key, property]): [string, string] => [
      property,
      values[key as keyof typeof STYLE_VALUE_PROPERTIES],
    ]),
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

function fromCodePointSafe(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

function decodeCssIdent(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\(?:\r\n|[\n\r\f])/g, '')
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => fromCodePointSafe(Number.parseInt(hex, 16)))
    .replace(/\\([\s\S])/g, '$1');
}

/**
 * Removes every redeclaration of a design value (`--proto-*: …`) from CSS that is not the values
 * block itself (including CSS comment/hex-escape tricks), so component, shell and screen CSS can
 * use the values but never override them.
 */
export function stripStyleValueOverrides(css: string): string {
  return css.replace(
    /(--(?:\/\*[\s\S]*?\*\/|\\[0-9a-fA-F]{1,6}\s?|\\[\s\S]|[A-Za-z0-9_-])*)\s*:[^;{}]*;?/g,
    (decl, name: string) => (decodeCssIdent(name).toLowerCase().startsWith('--proto-') ? '' : decl),
  );
}

function decodeHtmlAttrEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);?/g, (_m, hex: string) => fromCodePointSafe(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_m, dec: string) => fromCodePointSafe(Number.parseInt(dec, 10)))
    .replace(/&colon;?/gi, ':')
    .replace(/&(tab|newline);?/gi, '');
}

/** Strips `--proto-*` custom property overrides from inline `style="…"` attributes on HTML tags. */
export function stripInlineStyleValueOverrides(html: string): string {
  return html.replace(
    /<([A-Za-z][A-Za-z0-9:-]*)(\s(?:[^>"']|"[^"]*"|'[^']*')*)?>/g,
    (tag, name: string, attrs?: string) => {
      if (!attrs || !/\bstyle\s*=/i.test(attrs)) return tag;
      const lower = name.toLowerCase();
      if (lower === 'script' || lower === 'style') return tag;
      const nextAttrs = attrs.replace(
        /(\bstyle\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
        (_m, prefix: string, dq?: string, sq?: string, uq?: string) => {
          const decoded = decodeHtmlAttrEntities(dq ?? sq ?? uq ?? '');
          const cleaned = stripStyleValueOverrides(decoded).trim();
          return cleaned ? `${prefix}"${cleaned.replace(/"/g, '&quot;')}"` : '';
        },
      );
      return `<${name}${nextAttrs}>`;
    },
  );
}

/** Keeps component CSS inside its own `<style>` element, without imports or script URLs. */
export function sanitizeStyleCss(css: string): string {
  return css
    .replace(/<\/?(?:style|template|script)[^>]*>?/gi, '')
    .replace(/@import\b[^;{}]*;?/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .replace(/url\(([^)]*)\)/gi, (full, inner: string) => {
      const normalized = decodeCssIdent(inner)
        .replace(/['"\u0000-\u0020]+/g, '')
        .toLowerCase();
      return /^(?:javascript|vbscript):|^data:text\/html/i.test(normalized) ? 'none' : full;
    });
}

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data']);
const ANCHOR_OR_DANGEROUS_ATTRS = new Set([
  'data-screen-id',
  'data-element-id',
  'data-event-id',
  'data-binding',
  'srcdoc',
]);

/**
 * Keeps sample HTML inside its `<template>`: no anchors (it is not a screen), no scripts, event
 * handlers or script URLs, no `--proto-*` inline overrides, and no `<style>`/`<link>`/`<iframe>`
 * (which would leak into every artboard).
 */
export function sanitizeStyleSampleHtml(html: string): string {
  const withoutDangerousElements = html
    .replace(/<\/?template(?:[^>"']|"[^"]*"|'[^']*')*>?/gi, '')
    .replace(/<(script|style|iframe|object|noscript|foreignobject)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:script|style)\b[\s\S]*$/gi, '')
    .replace(/<\/?(?:iframe|object|noscript|foreignobject|link|meta|base|embed)\b(?:[^>"']|"[^"]*"|'[^']*')*>?/gi, '');

  return withoutDangerousElements.replace(
    /<([A-Za-z][A-Za-z0-9:-]*)([\s/"'](?:[^>"']|"[^"]*"|'[^']*')*)?>/g,
    (_tag, tagName: string, attrRegion = '') => {
      const trimmedAttrs = attrRegion.trimEnd();
      const selfClose = trimmedAttrs.endsWith('/');
      const rawAttrs = selfClose ? trimmedAttrs.slice(0, -1) : attrRegion;
      if (!rawAttrs.trim()) return `<${tagName}${selfClose ? ' /' : ''}>`;
      const kept: string[] = [];
      const attrRe = /([A-Za-z_:@][A-Za-z0-9_.:@-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(rawAttrs)) !== null) {
        const attrName = m[1]!;
        const lower = attrName.toLowerCase();
        if (lower.startsWith('on') || ANCHOR_OR_DANGEROUS_ATTRS.has(lower)) continue;
        const hasValue = m[2] !== undefined || m[3] !== undefined || m[4] !== undefined;
        const rawVal = m[2] ?? m[3] ?? m[4] ?? '';
        if (!hasValue) {
          kept.push(attrName);
          continue;
        }
        if (URL_ATTRS.has(lower)) {
          const normalized = decodeHtmlAttrEntities(rawVal)
            .replace(/[\u0000-\u0020]+/g, '')
            .toLowerCase();
          if (/^(?:javascript|vbscript):|^data:text\/html/.test(normalized)) {
            kept.push(`${attrName}="#"`);
            continue;
          }
        }
        if (lower === 'style') {
          const cleaned = stripStyleValueOverrides(sanitizeStyleCss(decodeHtmlAttrEntities(rawVal))).trim();
          if (cleaned) kept.push(`style="${escapeAttr(cleaned)}"`);
          continue;
        }
        kept.push(`${attrName}="${escapeAttr(rawVal)}"`);
      }
      return `<${tagName}${kept.length > 0 ? ` ${kept.join(' ')}` : ''}${selfClose ? ' /' : ''}>`;
    },
  );
}

function escapeAttr(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeAttr(raw: string): string {
  return raw.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The full stylesheet of a style: values first, then the shared components. */
export function prototypeStyleCss(style: Pick<PrototypeStyle, 'values' | 'componentCss'>): string {
  const components = stripStyleValueOverrides(sanitizeStyleCss(style.componentCss)).trim();
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
 * Zero-specificity skeleton CSS for `initPrototypeShell`: every colour, font and radius comes
 * from `--proto-*`, and pages are width-adaptive.
 */
export const PROTOTYPE_SHELL_SKELETON_CSS = [
  '*, *::before, *::after { box-sizing: border-box; }',
  ':where(body) {',
  '  margin: 0;',
  '  font-family: var(--proto-font);',
  '  background: var(--proto-bg);',
  '  color: var(--proto-text);',
  '  line-height: 1.5;',
  '  font-variant-numeric: tabular-nums;',
  '}',
  ':where(.proto-app-shell) { min-height: 100vh; display: flex; flex-direction: column; }',
  ':where(.proto-app-bar) {',
  '  display: flex;',
  '  flex-wrap: wrap;',
  '  align-items: center;',
  '  gap: 8px 28px;',
  '  padding: 12px clamp(16px, 3vw, 32px);',
  '  background: var(--proto-card);',
  '  border-bottom: 1px solid var(--proto-border);',
  '}',
  ':where(.proto-app-title) { margin: 0; font-size: 16px; font-weight: 600; }',
  ':where(.proto-app-subtitle) { font-size: 12px; color: var(--proto-muted); }',
  ':where(.proto-app-nav) { display: flex; flex-wrap: wrap; gap: 4px 20px; }',
  ':where(.proto-app-nav-link) {',
  '  appearance: none;',
  '  border: 0;',
  '  border-bottom: 2px solid transparent;',
  '  background: none;',
  '  padding: 4px 0;',
  '  font: inherit;',
  '  color: var(--proto-muted);',
  '  cursor: pointer;',
  '}',
  ':where(.proto-app-nav-link.is-active) { color: var(--proto-text); border-bottom-color: var(--proto-accent); }',
  ':where(.proto-screens-stage) { flex: 1; width: 100%; min-width: 0; padding: clamp(16px, 2.5vw, 32px); }',
  '.proto-screen { display: none; }',
  '.proto-screen.is-active { display: block; }',
].join('\n    ');

const LEGACY_UPGRADED_SHELL_CSS = PROTOTYPE_SHELL_SKELETON_CSS
  .replace(':where(.proto-app-bar)', ':where(.proto-app-bar, .proto-topbar)')
  .replace(':where(.proto-app-title)', ':where(.proto-app-brand, .proto-brand) { display: flex; align-items: baseline; gap: 10px; }\n    :where(.proto-app-title, .proto-brand h1)')
  .replace(':where(.proto-app-subtitle)', ':where(.proto-app-subtitle, .proto-brand span)')
  .replace(':where(.proto-app-nav)', ':where(.proto-app-nav, .proto-nav)')
  .replace(':where(.proto-app-nav-link)', ':where(.proto-app-nav-link, .proto-nav-tab)')
  .replace(':where(.proto-app-nav-link.is-active)', ':where(.proto-app-nav-link.is-active, .proto-nav-tab.is-active)');

const LEGACY_SHELL_PREAMBLE_RE =
  /^\s*:root\s*\{[\s\S]*?@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*\{[\s\S]*?\.proto-screens-stage\s*\{[^}]*\}\s*\}/i;

function upgradeShellOrStyleBlock(open: string, body: string): string {
  if (/\bid\s*=\s*["']proto-shell-styles["']/i.test(open) && !body.includes(':where(')) {
    const upgraded = body.replace(LEGACY_SHELL_PREAMBLE_RE, `\n    ${LEGACY_UPGRADED_SHELL_CSS}`);
    return stripStyleValueOverrides(upgraded);
  }
  return stripStyleValueOverrides(body);
}

/**
 * The document with this style as its shared look: an existing style is replaced in place,
 * otherwise the style goes first in `<head>` (so screen CSS added later stays after it).
 */
export function applyPrototypeStyleToDocument(html: string, style: PrototypeStyle): string {
  const blocks = prototypeStyleHeadHtml(style);
  // Older shells (and any other stylesheet or inline attribute) declared their own --proto-*
  // values; those declarations go and legacy shell rules upgrade to zero-specificity skeleton CSS.
  const withoutOld = stripInlineStyleValueOverrides(
    html
      .replace(TILE_BLOCK_RE, '')
      .replace(STYLE_BLOCK_RE, '')
      .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open: string, body: string, close: string) =>
        `${open}${upgradeShellOrStyleBlock(open, body)}${close}`,
      ),
  );
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

export function readLockedPrototypeStyleValues(html: string): PrototypeStyleValues | null {
  const style = readPrototypeDocumentStyle(html);
  if (!style?.locked) return null;
  const root = /^:root\s*\{([^}]+)\}/.exec(style.css)?.[1];
  if (!root) return null;
  const properties = new Map(
    Array.from(root.matchAll(/^\s*([\w-]+)\s*:\s*([^;]+);/gm), ([, name, value]) => [name, value!.trim()]),
  );
  const gap = properties.get('--proto-gap');
  const values = readPrototypeStyleValues({
    ...Object.fromEntries(Object.entries(STYLE_VALUE_PROPERTIES).map(([key, property]) => [key, properties.get(property)])),
    mode: properties.get('color-scheme'),
    radiusPx: properties.get('--proto-radius'),
    density: gap === '12px' ? 'compact' : gap === '18px' ? 'comfortable' : undefined,
  });
  return PROTOTYPE_STYLE_VALUE_KEYS.every((key) => values[key] !== undefined)
    ? completePrototypeStyleValues(values)
    : null;
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
