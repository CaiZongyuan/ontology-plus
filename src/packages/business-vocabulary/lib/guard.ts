import { MODEL_CODES, type ModelCode } from '../../ontology-core/index.js';
import {
  BUSINESS_VOCABULARY,
  getModelBusinessName,
  pickBusinessText,
  type BilingualText,
  type BusinessLocale,
} from './vocabulary.js';

export type BusinessViewViolationCategory =
  | 'MODEL_CODE'
  | 'IDENTIFIER'
  | 'FILE_FORMAT'
  | 'PROTOCOL'
  | 'INTERNAL_TERM';

export interface BusinessViewViolation {
  readonly category: BusinessViewViolationCategory;
  readonly match: string;
  readonly context: string;
}

export interface BusinessViewGuardOptions {
  /** Treat input as raw visible text rather than HTML markup. */
  readonly plainText?: boolean;
  /** Skip DOM subtrees whose root element carries one of these `data-testid` values. */
  readonly ignoreTestIds?: readonly string[];
  /** Restrict check to a subset of violation categories; defaults to all five. */
  readonly categories?: readonly BusinessViewViolationCategory[];
}

interface TextSegment {
  readonly text: string;
  readonly attrName?: string;
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const SKIPPED_RAW_TAGS = new Set(['script', 'style', 'template', 'noscript']);

const VISIBLE_ATTR_ORDER = ['aria-label', 'title', 'placeholder', 'alt'] as const;

const NON_TEXT_INPUT_TYPES = new Set(['hidden', 'checkbox', 'radio']);

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeHtmlEntities(raw: string): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g, (full, dec, hex, named) => {
    if (dec) {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    if (hex) {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    if (named && Object.prototype.hasOwnProperty.call(HTML_ENTITIES, named)) {
      return HTML_ENTITIES[named]!;
    }
    return full;
  });
}

function findTagEnd(html: string, startAfterTagName: number): { end: number; selfClosing: boolean } {
  let i = startAfterTagName;
  let quote: '"' | "'" | null = null;
  while (i < html.length) {
    const ch = html[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '>') {
      let back = i - 1;
      while (back >= startAfterTagName && /\s/.test(html[back]!)) back -= 1;
      return { end: i + 1, selfClosing: html[back] === '/' };
    }
    i += 1;
  }
  return { end: html.length, selfClosing: false };
}

function parseAttributes(attrRegion: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrRe = /([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(attrRegion)) !== null) {
    const name = match[1]!.toLowerCase();
    const rawVal = match[2] ?? match[3] ?? match[4] ?? '';
    attrs.set(name, decodeHtmlEntities(rawVal));
  }
  return attrs;
}

function extractVisibleSegmentsFromHtml(
  html: string,
  ignoreTestIds: ReadonlySet<string>,
): TextSegment[] {
  const segments: TextSegment[] = [];
  const stack: {
    tag: string;
    skipped: boolean;
    closedDetails: boolean;
    summarySeen: boolean;
  }[] = [];
  const isSkipped = () =>
    stack.some((item) => item.skipped) ||
    Boolean(stack[stack.length - 1]?.closedDetails);

  let i = 0;
  let textStart = 0;

  const flushText = (end: number) => {
    if (end <= textStart) return;
    if (!isSkipped()) {
      const decoded = decodeHtmlEntities(html.slice(textStart, end)).replace(/\s+/g, ' ').trim();
      if (decoded.length > 0) {
        segments.push({ text: decoded });
      }
    }
  };

  while (i < html.length) {
    if (html[i] !== '<') {
      i += 1;
      continue;
    }

    // HTML comment <!-- ... -->
    if (html.startsWith('<!--', i)) {
      flushText(i);
      const closeIdx = html.indexOf('-->', i + 4);
      i = closeIdx >= 0 ? closeIdx + 3 : html.length;
      textStart = i;
      continue;
    }

    // Closing tag </tag>
    const closeMatch = /^<\/([A-Za-z][A-Za-z0-9:-]*)\s*>/.exec(html.slice(i));
    if (closeMatch) {
      flushText(i);
      const closeTag = closeMatch[1]!.toLowerCase();
      for (let s = stack.length - 1; s >= 0; s -= 1) {
        if (stack[s]!.tag === closeTag) {
          stack.length = s;
          break;
        }
      }
      i += closeMatch[0].length;
      textStart = i;
      continue;
    }

    // Opening tag <tag ...>
    const openMatch = /^<([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>]|$)/.exec(html.slice(i));
    if (!openMatch) {
      // Plain '<' character in text (e.g. "金额 < 100 万")
      i += 1;
      continue;
    }

    flushText(i);
    const tag = openMatch[1]!.toLowerCase();
    const afterName = i + openMatch[0].length;
    const { end, selfClosing } = findTagEnd(html, afterName);
    const rawAttrRegion = html.slice(afterName, selfClosing ? end - 2 : end - 1);

    if (SKIPPED_RAW_TAGS.has(tag)) {
      if (!selfClosing) {
        const closeRe = new RegExp(`<\\/${tag}\\s*>`, 'i');
        const closeTagMatch = closeRe.exec(html.slice(end));
        i = closeTagMatch ? end + closeTagMatch.index + closeTagMatch[0].length : html.length;
      } else {
        i = end;
      }
      textStart = i;
      continue;
    }

    const attrs = parseAttributes(rawAttrRegion);
    const hasHiddenAttr = attrs.has('hidden');
    const testId = attrs.get('data-testid');
    const parent = stack[stack.length - 1];
    const isDirectSummaryOfClosedDetails =
      tag === 'summary' &&
      parent?.tag === 'details' &&
      parent.closedDetails &&
      !parent.summarySeen;
    if (isDirectSummaryOfClosedDetails) {
      parent.summarySeen = true;
    }
    const hiddenByAncestor =
      stack.some((item) => item.skipped) ||
      (Boolean(parent?.closedDetails) && !isDirectSummaryOfClosedDetails);
    const skipThisNode =
      hiddenByAncestor || hasHiddenAttr || (testId !== undefined && ignoreTestIds.has(testId));

    if (!skipThisNode) {
      for (const attrName of VISIBLE_ATTR_ORDER) {
        const val = attrs.get(attrName)?.replace(/\s+/g, ' ').trim();
        if (val) {
          segments.push({ text: val, attrName });
        }
      }
      if (tag === 'input') {
        const inputType = (attrs.get('type') ?? 'text').toLowerCase();
        if (!NON_TEXT_INPUT_TYPES.has(inputType)) {
          const val = attrs.get('value')?.replace(/\s+/g, ' ').trim();
          if (val) {
            segments.push({ text: val, attrName: 'value' });
          }
        }
      }
    }

    if (!selfClosing && !VOID_TAGS.has(tag)) {
      stack.push({
        tag,
        skipped: skipThisNode,
        closedDetails: tag === 'details' && !attrs.has('open'),
        summarySeen: false,
      });
    }

    i = end;
    textStart = i;
  }

  flushText(html.length);
  return segments;
}

export const TECHNICAL_IDENTIFIER_PREFIXES = [
  'AGG',
  'ENT',
  'VO',
  'DIC',
  'DICT',
  'ASSOC',
  'BHV',
  'BEH',
  'RUL',
  'RULE',
  'EVT',
  'SCN',
  'ACT',
  'ROL',
  'ROLE',
  'PERM',
  'PG',
  'PGRP',
  'FLW',
  'FLOW',
  'ACTV',
  'QRY',
  'RPT',
  'SCR',
  'EL',
  'UIE',
  'NAV',
  'CC',
  'MAP',
  'INT',
  'IF',
  'MET',
  'ASCN',
  'WB',
  'PROF',
  'SNAP',
] as const;

export type TechnicalIdentifierPrefix = (typeof TECHNICAL_IDENTIFIER_PREFIXES)[number];

const TECHNICAL_IDENTIFIER_PREFIX_SET: ReadonlySet<string> = new Set(TECHNICAL_IDENTIFIER_PREFIXES);

export function isReservedIdentifierPrefix(token: string): boolean {
  return TECHNICAL_IDENTIFIER_PREFIX_SET.has(token.trim().toUpperCase());
}

type GuardReplacementKind =
  | 'MODEL_CODE'
  | 'ELEMENT_ID'
  | 'DIAGNOSTIC_CODE'
  | 'SQL_TABLE'
  | 'FILE_EXTENSION'
  | 'FILE_FORMAT'
  | 'PROTOCOL'
  | 'INTERNAL_TERM';

interface GuardRule {
  readonly category: BusinessViewViolationCategory;
  readonly replacementKind: GuardReplacementKind;
  readonly pattern: RegExp;
}

const ELEMENT_ID_PATTERN = new RegExp(
  `(?<![A-Za-z0-9_-])(?:${TECHNICAL_IDENTIFIER_PREFIXES.join('|')})-[A-Z0-9]+(?:-[A-Z0-9]+)*(?![A-Za-z0-9_-])`,
  'g',
);

const GUARD_RULES: readonly GuardRule[] = [
  // 1. 11 Canonical Model Codes (case-sensitive uppercase so English "me"/"mm"/"mi" never false-positive)
  {
    category: 'MODEL_CODE',
    replacementKind: 'MODEL_CODE',
    pattern: /(?<![A-Za-z0-9_])(?:M[1-7]|ME|MU|MM|MI)(?![A-Za-z0-9_])/g,
  },
  // 2. Identifiers: element/artifact IDs, validator diagnostic codes, and physical SQL table names
  {
    category: 'IDENTIFIER',
    replacementKind: 'ELEMENT_ID',
    pattern: ELEMENT_ID_PATTERN,
  },
  {
    category: 'IDENTIFIER',
    replacementKind: 'DIAGNOSTIC_CODE',
    pattern: /(?<![A-Za-z0-9_])(?:M[1-7]|ME|MU|MM|MI|STAGE)_[A-Z0-9_]+(?![A-Za-z0-9_])/g,
  },
  {
    category: 'IDENTIFIER',
    replacementKind: 'SQL_TABLE',
    pattern: /(?<![A-Za-z0-9_])t_[a-z][a-z0-9_]+(?![A-Za-z0-9_])/g,
  },
  // 3. File formats & extensions (ZIP uppercase or .zip extension so English "zip code" stays valid)
  {
    category: 'FILE_FORMAT',
    replacementKind: 'FILE_EXTENSION',
    pattern: /\.(?:yaml|yml|json|owl|ddl|sql|md|html|css|zip)(?![A-Za-z0-9_])/gi,
  },
  {
    category: 'FILE_FORMAT',
    replacementKind: 'FILE_FORMAT',
    pattern: /(?<![A-Za-z0-9_])(?:YAML|YML|JSON|OWL|DDL|SQLite|SQL|Markdown|HTML5?|CSS)(?![A-Za-z0-9_])/gi,
  },
  {
    category: 'FILE_FORMAT',
    replacementKind: 'FILE_FORMAT',
    pattern: /(?<![A-Za-z0-9_])ZIP(?![A-Za-z0-9_])/g,
  },
  // 4. Protocols (REST/RPC/MCP/SSE uppercase so English "the rest" never false-positives)
  {
    category: 'PROTOCOL',
    replacementKind: 'PROTOCOL',
    pattern: /(?<![A-Za-z0-9_])(?:gRPC|RPC|MCP|SSE|REST)(?![A-Za-z0-9_])/g,
  },
  {
    category: 'PROTOCOL',
    replacementKind: 'PROTOCOL',
    pattern: /(?<![A-Za-z0-9_])(?:HTTPS?|RESTful|GraphQL|OpenAPI)(?![A-Za-z0-9_])/gi,
  },
  // 5. Internal agent & engineering terms forbidden on the Business View surface
  {
    category: 'INTERNAL_TERM',
    replacementKind: 'INTERNAL_TERM',
    pattern:
      /(?<![A-Za-z0-9_])(?:Agent\s+Sessions?|Agent\s+Runs?|Agent\s+Panels?|Architecture\s+Asset\s+Agent|Application\s+Development\s+Agent|Application\s+Coding\s+Agent|Copilot|PROTOTYPE_CO_DESIGN)(?![A-Za-z0-9_])|智能体会话|智能体运行|智能体面板|Agent\s*面板|Agent\s*运行|架构资产智能体|应用开发智能体/gi,
  },
];

function buildContextSnippet(segment: TextSegment, start: number, end: number): string {
  const radius = 32;
  const from = Math.max(0, start - radius);
  const to = Math.min(segment.text.length, end + radius);
  const prefix = from > 0 ? '…' : '';
  const suffix = to < segment.text.length ? '…' : '';
  const snippet = `${prefix}${segment.text.slice(from, to)}${suffix}`;
  return segment.attrName ? `[${segment.attrName}] ${snippet}` : snippet;
}

export function checkBusinessViewMarkup(
  htmlOrText: string,
  options?: BusinessViewGuardOptions,
): BusinessViewViolation[] {
  if (!htmlOrText) return [];

  const ignoreTestIds = new Set(options?.ignoreTestIds ?? []);
  const enabledCategories = options?.categories ? new Set(options.categories) : null;
  const activeRules = enabledCategories
    ? GUARD_RULES.filter((rule) => enabledCategories.has(rule.category))
    : GUARD_RULES;

  const segments: TextSegment[] = options?.plainText
    ? [{ text: htmlOrText.replace(/\s+/g, ' ').trim() }].filter((s) => s.text.length > 0)
    : extractVisibleSegmentsFromHtml(htmlOrText, ignoreTestIds);

  const violations: BusinessViewViolation[] = [];

  for (const segment of segments) {
    const rawHits: {
      start: number;
      end: number;
      category: BusinessViewViolationCategory;
      match: string;
    }[] = [];

    for (const rule of activeRules) {
      const re = new RegExp(rule.pattern.source, rule.pattern.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(segment.text)) !== null) {
        rawHits.push({
          start: m.index,
          end: m.index + m[0].length,
          category: rule.category,
          match: m[0],
        });
      }
    }

    rawHits.sort((a, b) => a.start - b.start || b.end - a.end);

    let cursor = -1;
    for (const hit of rawHits) {
      if (hit.start < cursor) continue;
      cursor = hit.end;
      violations.push({
        category: hit.category,
        match: hit.match,
        context: buildContextSnippet(segment, hit.start, hit.end),
      });
    }
  }

  return violations;
}

export function formatBusinessViewViolations(
  violations: readonly BusinessViewViolation[],
): string {
  if (violations.length === 0) return '';
  const lines = violations.map(
    (v) => `  - [${v.category}] "${v.match}" in: ${v.context}`,
  );
  return `Business View vocabulary violations (${violations.length}):\n${lines.join('\n')}`;
}

/** Convenience check returning `true` when markup contains any Business View violation. */
export function isTechnicalIdentifierOrJargon(value: string): boolean {
  return checkBusinessViewMarkup(value, { plainText: true }).length > 0;
}

export interface SanitizeBusinessTextOptions {
  /** Optional map of known element IDs / physical table names to localized business labels. */
  readonly elementDisplayMap?: ReadonlyMap<string, string>;
  /** Custom fallback label for unmatched technical element IDs (`AGG-01`, `BHV-02`, etc.). */
  readonly elementIdFallback?: BilingualText;
}

/**
 * Sanitizes raw model text into clean Business View prose using the exact `GUARD_RULES`
 * shared with `checkBusinessViewMarkup`, so detection and sanitization never drift.
 */
export function sanitizeBusinessText(
  raw: string | undefined,
  locale: BusinessLocale = 'zh-CN',
  options?: SanitizeBusinessTextOptions,
): string {
  if (!raw) return '';
  let text = raw.trim();
  if (!text) return '';

  if (checkBusinessViewMarkup(text, { plainText: true }).length === 0) {
    return text;
  }

  if (options?.elementDisplayMap) {
    for (const [id, businessLabel] of options.elementDisplayMap.entries()) {
      if (text.includes(id)) {
        text = text.split(id).join(businessLabel);
      }
    }
    if (checkBusinessViewMarkup(text, { plainText: true }).length === 0) {
      return text.replace(/\s+/g, ' ').trim();
    }
  }

  const validModelCodes = new Set<string>(MODEL_CODES);
  const elementFallback = options?.elementIdFallback
    ? pickBusinessText(options.elementIdFallback, locale)
    : locale === 'en-US'
      ? 'related item'
      : '关联项';

  for (const rule of GUARD_RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    switch (rule.replacementKind) {
      case 'MODEL_CODE':
        text = text.replace(re, (match) =>
          validModelCodes.has(match)
            ? getModelBusinessName(match as ModelCode, locale, { singular: true })
            : match,
        );
        break;
      case 'ELEMENT_ID':
        text = text.replace(re, elementFallback);
        break;
      case 'DIAGNOSTIC_CODE':
        text = text.replace(re, locale === 'en-US' ? 'check item' : '检查项');
        break;
      case 'SQL_TABLE':
        text = text.replace(re, locale === 'en-US' ? 'data record' : '数据记录');
        break;
      case 'FILE_EXTENSION':
        text = text.replace(re, locale === 'en-US' ? ' file' : '文件');
        break;
      case 'FILE_FORMAT':
        text = text.replace(re, locale === 'en-US' ? 'document' : '模型内容');
        break;
      case 'PROTOCOL':
        text = text.replace(re, locale === 'en-US' ? 'external service' : '外部服务');
        break;
      case 'INTERNAL_TERM':
        text = text.replace(re, pickBusinessText(BUSINESS_VOCABULARY.AI_ASSISTANT, locale));
        break;
    }
  }

  return text.replace(/\s+/g, ' ').trim();
}
