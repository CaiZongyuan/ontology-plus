/**
 * Prototype Notes (`data-note`) and real live-writing narration derivation (spec #87, #92, ADR 0005, ADR 0018).
 *
 * Every anchored element in `界面原型.html` may carry a business-language Prototype Note in `data-note`.
 * Pure TypeScript (no DOM) so the server, ontology extraction, and browser share one implementation.
 */

export const PROTOTYPE_NOTE_ATTR = 'data-note';

const MAX_NOTE_LENGTH = 280;

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

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4']);
const SECTION_BOUNDARY_TAGS = new Set(['section', 'article', 'header', 'aside']);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  middot: '·',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  yen: '¥',
};

export interface PrototypeNoteItem {
  elementId: string;
  screenId?: string;
  note: string;
  title?: string;
  body: string;
}

export interface PrototypeLiveWritingTarget {
  /** Innermost latest anchored element (`data-element-id`) written inside the screen so far. */
  elementId?: string;
  /** Business-language narration from `data-note` or enclosing section heading; omitted when neither exists. */
  narration?: string;
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : _m;
    })
    .replace(/&([a-zA-Z]+);/g, (full, name: string) => {
      const lower = name.toLowerCase();
      if (lower === 'amp') return full;
      return NAMED_ENTITIES[lower] ?? full;
    })
    .replace(/&amp;/gi, '&');
}

function escapeHtmlAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Strips stray markup, decodes HTML entities, normalizes whitespace, and bounds length so a
 * Prototype Note is always a clean plain-language sentence.
 */
export function sanitizePrototypeNote(raw: string | null | undefined): string {
  if (!raw) return '';
  const withoutTags = raw.replace(/<[A-Za-z!/][^>]*>/g, '');
  const decoded = decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim();
  if (!decoded) return '';
  return decoded.length > MAX_NOTE_LENGTH ? `${decoded.slice(0, MAX_NOTE_LENGTH - 1).trimEnd()}…` : decoded;
}

/**
 * Splits a Prototype Note into an optional short heading (`<what>：<why>` or `<what>: <why>`) and
 * its explanation body; null when the note is blank.
 */
export function parsePrototypeNote(
  raw: string | null | undefined,
): { title?: string; body: string } | null {
  const clean = sanitizePrototypeNote(raw);
  if (!clean) return null;
  const match = /^([^：:\n]{1,28}?)(?:：\s*|:\s+)(.+)$/.exec(clean);
  if (match) {
    const title = match[1]!.trim();
    const body = match[2]!.trim();
    if (title && body && !/[。！？.!?]/.test(title)) {
      return { title, body };
    }
  }
  return { body: clean };
}

interface NoteSpanNode {
  tag: string;
  attrs: Record<string, string>;
  openStart: number;
  openEnd: number;
  innerEnd: number;
  closeEnd: number;
  parent?: NoteSpanNode;
  children: NoteSpanNode[];
}

function findTagEnd(html: string, from: number): { end: number; selfClosing: boolean } {
  let quote: string | null = null;
  let lastSig = '';
  for (let i = from; i < html.length; i += 1) {
    const ch = html[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if ((ch === '"' || ch === "'") && lastSig === '=') {
      quote = ch;
    } else if (ch === '>') {
      let back = i - 1;
      while (back >= from && /\s/.test(html[back]!)) back -= 1;
      return { end: i + 1, selfClosing: html[back] === '/' };
    }
    if (!/\s/.test(ch)) lastSig = ch;
  }
  return { end: -1, selfClosing: false };
}

function parseAttributes(attrRegion: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:@][A-Za-z0-9_.:@-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrRegion)) !== null) {
    const rawVal = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[m[1]!.toLowerCase()] = decodeHtmlEntities(rawVal);
  }
  return attrs;
}

function parseTree(html: string): NoteSpanNode[] {
  const nodes: NoteSpanNode[] = [];
  const stack: NoteSpanNode[] = [];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    const next = html[lt + 1];
    if (!next) break;
    if (next === '!' || next === '?') {
      const { end } = findTagEnd(html, lt + 2);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (next === '/') {
      const closeMatch = /^<\/\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(lt, lt + 64));
      const { end } = findTagEnd(html, lt + 2);
      if (end === -1) break;
      const closeTag = closeMatch?.[1]?.toLowerCase();
      if (closeTag) {
        for (let s = stack.length - 1; s >= 0; s -= 1) {
          if (stack[s]!.tag === closeTag) {
            for (let k = stack.length - 1; k >= s; k -= 1) {
              const popped = stack.pop()!;
              popped.innerEnd = lt;
              popped.closeEnd = k === s ? end : lt;
            }
            break;
          }
        }
      }
      i = end;
      continue;
    }

    const openMatch = /^<([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>]|$)/.exec(html.slice(lt, lt + 64));
    if (!openMatch) {
      i = lt + 1;
      continue;
    }
    const tag = openMatch[1]!.toLowerCase();
    const afterName = lt + openMatch[0].length;
    const { end: openEnd, selfClosing } = findTagEnd(html, afterName);
    if (openEnd === -1) break;
    const attrSlice = html.slice(afterName, selfClosing ? Math.max(afterName, openEnd - 2) : openEnd - 1);
    const attrs = parseAttributes(attrSlice);

    // Skip embedded Style Tile templates (not part of any screen's notes).
    if (tag === 'template' && 'data-proto-style-tile' in attrs) {
      const closeRe = /<\/template\s*>/gi;
      closeRe.lastIndex = openEnd;
      const hit = closeRe.exec(html);
      i = hit ? hit.index + hit[0].length : html.length;
      continue;
    }

    const parent = stack[stack.length - 1];
    const node: NoteSpanNode = {
      tag,
      attrs,
      openStart: lt,
      openEnd,
      innerEnd: openEnd,
      closeEnd: openEnd,
      ...(parent ? { parent } : {}),
      children: [],
    };
    if (parent) parent.children.push(node);
    nodes.push(node);

    if (selfClosing || VOID_TAGS.has(tag)) {
      i = openEnd;
      continue;
    }
    if (RAW_TEXT_TAGS.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
      closeRe.lastIndex = openEnd;
      const hit = closeRe.exec(html);
      node.innerEnd = hit ? hit.index : html.length;
      node.closeEnd = hit ? hit.index + hit[0].length : html.length;
      i = node.closeEnd;
      continue;
    }
    stack.push(node);
    i = openEnd;
  }

  while (stack.length > 0) {
    const open = stack.pop()!;
    open.innerEnd = html.length;
    open.closeEnd = html.length;
  }
  return nodes;
}

function enclosingScreenOf(node: NoteSpanNode): NoteSpanNode | undefined {
  let cur: NoteSpanNode | undefined = node;
  while (cur) {
    if (cur.attrs['data-screen-id']) return cur;
    cur = cur.parent;
  }
  return undefined;
}

function rewriteNoteAttribute(openTag: string, cleanNote: string | null): string {
  const existingRe = /(\s+)data-note(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/i;
  if (!cleanNote) {
    return openTag.replace(existingRe, '');
  }
  const encoded = escapeHtmlAttr(cleanNote);
  if (existingRe.test(openTag)) {
    return openTag.replace(existingRe, `$1${PROTOTYPE_NOTE_ATTR}="${encoded}"`);
  }
  const insertAt = openTag.endsWith('/>') ? openTag.length - 2 : openTag.length - 1;
  return `${openTag.slice(0, insertAt)} ${PROTOTYPE_NOTE_ATTR}="${encoded}"${openTag.slice(insertAt)}`;
}

/** Reads every anchored element's Prototype Note (`data-note`) from a prototype document or screen fragment. */
export function readPrototypeNotes(
  html: string,
  options?: { screenId?: string },
): PrototypeNoteItem[] {
  if (!html?.trim()) return [];
  const targetScreen = options?.screenId?.trim();
  const out: PrototypeNoteItem[] = [];
  for (const node of parseTree(html)) {
    const elementId = node.attrs['data-element-id']?.trim();
    if (!elementId) continue;
    const screenNode = enclosingScreenOf(node);
    const screenId = screenNode?.attrs['data-screen-id']?.trim();
    if (targetScreen && screenId !== targetScreen) continue;
    const parsed = parsePrototypeNote(node.attrs[PROTOTYPE_NOTE_ATTR]);
    if (!parsed) continue;
    const note = sanitizePrototypeNote(node.attrs[PROTOTYPE_NOTE_ATTR]);
    out.push({
      elementId,
      ...(screenId ? { screenId } : {}),
      note,
      ...(parsed.title ? { title: parsed.title } : {}),
      body: parsed.body,
    });
  }
  return out;
}

/**
 * Sets, updates, or removes (`note === null`) `data-note` on the targeted `data-element-id`
 * opening tag, keeping every other character of `html` unchanged.
 */
export function writePrototypeNote(
  html: string,
  target: { elementId: string; screenId?: string },
  note: string | null,
): string {
  const elementId = target.elementId?.trim();
  if (!html || !elementId) return html;
  const targetScreen = target.screenId?.trim();
  const nodes = parseTree(html);
  const hit = nodes.find((node) => {
    if (node.attrs['data-element-id']?.trim() !== elementId) return false;
    if (!targetScreen) return true;
    return enclosingScreenOf(node)?.attrs['data-screen-id']?.trim() === targetScreen;
  });
  if (!hit) return html;
  const cleaned = note === null ? null : sanitizePrototypeNote(note) || null;
  const updatedOpen = rewriteNoteAttribute(html.slice(hit.openStart, hit.openEnd), cleaned);
  return `${html.slice(0, hit.openStart)}${updatedOpen}${html.slice(hit.openEnd)}`;
}

function formatNoteSentence(rawNote: string, locale: 'zh-CN' | 'en-US'): string | undefined {
  const parsed = parsePrototypeNote(rawNote);
  if (!parsed) return undefined;
  if (parsed.title) {
    return locale === 'en-US'
      ? `Drawing "${parsed.title}": ${parsed.body}`
      : `正在画「${parsed.title}」：${parsed.body}`;
  }
  return locale === 'en-US' ? `Drawing: ${parsed.body}` : `正在画：${parsed.body}`;
}

function extractPlainText(html: string, node: NoteSpanNode): string {
  const slice = html.slice(node.openEnd, node.innerEnd);
  return sanitizePrototypeNote(slice);
}

function findHeadingBefore(
  html: string,
  container: NoteSpanNode,
  beforeOffset: number,
): string | undefined {
  const visit = (node: NoteSpanNode): string | undefined => {
    if (node.openStart > beforeOffset) return undefined;
    if (HEADING_TAGS.has(node.tag)) {
      const text = extractPlainText(html, node);
      if (text) return text;
    }
    for (const child of node.children) {
      if (SECTION_BOUNDARY_TAGS.has(child.tag)) continue;
      const found = visit(child);
      if (found) return found;
    }
    return undefined;
  };
  return visit(container);
}

function findEnclosingSectionHeading(
  html: string,
  target: NoteSpanNode,
  screenRoot: NoteSpanNode | undefined,
): string | undefined {
  // 1. Check if the target itself contains a heading (e.g. an opening <section data-element-id><h1>标题</h1>)
  const ownHeading = findHeadingBefore(html, target, Number.MAX_SAFE_INTEGER);
  if (ownHeading) return ownHeading;

  // 2. Walk up enclosing containers inside the screen, stopping at the first section boundary.
  let cur = target.parent;
  while (cur && cur !== screenRoot) {
    const heading = findHeadingBefore(html, cur, target.openStart);
    if (heading) return heading;
    if (SECTION_BOUNDARY_TAGS.has(cur.tag)) break;
    cur = cur.parent;
  }
  return undefined;
}

/**
 * Finds the innermost latest anchored element (`data-element-id`) written inside a screen so far
 * and derives its business narration strictly from its `data-note` (or an ancestor's `data-note`)
 * or its enclosing section heading. When neither exists, `narration` is omitted — never guessed.
 */
export function derivePrototypeLiveWriting(
  html: string,
  options?: { screenId?: string; locale?: 'zh-CN' | 'en-US' },
): PrototypeLiveWritingTarget {
  if (!html?.trim()) return {};
  const locale = options?.locale === 'en-US' ? 'en-US' : 'zh-CN';
  const nodes = parseTree(html);
  const requestedScreenId = options?.screenId?.trim();
  const anyScreensInHtml = nodes.some((n) => Boolean(n.attrs['data-screen-id']));

  let screenRoot: NoteSpanNode | undefined;
  if (requestedScreenId) {
    screenRoot = nodes.find((n) => n.attrs['data-screen-id']?.trim() === requestedScreenId);
    if (!screenRoot && anyScreensInHtml) return {};
  } else if (anyScreensInHtml) {
    screenRoot = nodes.find((n) => Boolean(n.attrs['data-screen-id']));
  }

  const scopedNodes = screenRoot
    ? nodes.filter((n) => n !== screenRoot && enclosingScreenOf(n) === screenRoot)
    : nodes;

  let latestAnchored: NoteSpanNode | undefined;
  for (const node of scopedNodes) {
    if (node.attrs['data-element-id']?.trim()) {
      latestAnchored = node;
    }
  }

  if (!latestAnchored) {
    const screenNote = screenRoot?.attrs[PROTOTYPE_NOTE_ATTR];
    const sentence = formatNoteSentence(screenNote ?? '', locale);
    return sentence ? { narration: sentence } : {};
  }

  const elementId = latestAnchored.attrs['data-element-id']!.trim();

  // Priority 1: `data-note` on the element itself or an enclosing container up to the screen root.
  let cur: NoteSpanNode | undefined = latestAnchored;
  while (cur) {
    const noteSentence = formatNoteSentence(cur.attrs[PROTOTYPE_NOTE_ATTR] ?? '', locale);
    if (noteSentence) {
      return { elementId, narration: noteSentence };
    }
    if (cur === screenRoot) break;
    cur = cur.parent;
  }

  // Priority 2: Enclosing section heading (`<h1>`–`<h4>`).
  const heading = findEnclosingSectionHeading(html, latestAnchored, screenRoot);
  if (heading) {
    return {
      elementId,
      narration: locale === 'en-US' ? `Drawing "${heading}"` : `正在画「${heading}」`,
    };
  }

  // Neither note nor section heading exists -> no narration bubble!
  return { elementId };
}
