/**
 * Prototype Notes (`data-note`) and real live-writing narration derivation (spec #87, #92, ADR 0005, ADR 0018).
 *
 * Every anchored element (and screen root `<section data-screen-id>`) in `界面原型.html` may carry
 * a business-language Prototype Note in `data-note`. Pure TypeScript (no DOM) so the server,
 * ontology extraction, and browser share one implementation.
 */

import {
  RAW_TEXT_HTML_TAGS,
  VOID_HTML_TAGS,
  findHtmlTagClose,
  parseHtmlAttributes,
  rewriteHtmlTagAttribute,
} from './html-scan.js';

export const PROTOTYPE_NOTE_ATTR = 'data-note';

const MAX_NOTE_LENGTH = 280;

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4']);
const SECTION_BOUNDARY_TAGS = new Set(['section', 'article', 'aside']);

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
  elementId?: string;
  screenId?: string;
  note: string;
  title?: string;
  body: string;
}

export interface PrototypeLiveWritingTarget {
  /** Innermost active anchored element (`data-element-id`) at the streaming frontier, if any. */
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

/**
 * Strips stray markup, decodes HTML entities, normalizes whitespace, and bounds length so a
 * Prototype Note is always a clean plain-language sentence.
 */
export function sanitizePrototypeNote(raw: string | null | undefined): string {
  if (!raw) return '';
  const withoutTags = raw.replace(/<[A-Za-z!/](?:[^>"']|"[^"]*"|'[^']*')*>/g, '');
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
  closed: boolean;
  parent?: NoteSpanNode;
  children: NoteSpanNode[];
}

function parseTree(html: string): { nodes: NoteSpanNode[]; roots: NoteSpanNode[] } {
  const nodes: NoteSpanNode[] = [];
  const roots: NoteSpanNode[] = [];
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
      const end = findHtmlTagClose(html, lt + 2);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (next === '/') {
      const closeMatch = /^<\/\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(lt, lt + 64));
      const end = findHtmlTagClose(html, lt + 2);
      if (end === -1) break;
      const closeTag = closeMatch?.[1]?.toLowerCase();
      if (closeTag) {
        for (let s = stack.length - 1; s >= 0; s -= 1) {
          if (stack[s]!.tag === closeTag) {
            for (let k = stack.length - 1; k >= s; k -= 1) {
              const popped = stack.pop()!;
              popped.innerEnd = lt;
              popped.closeEnd = k === s ? end : lt;
              popped.closed = true;
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
    const openEnd = findHtmlTagClose(html, afterName);
    if (openEnd === -1) break;
    const selfClosing = /\/\s*>$/.test(html.slice(Math.max(afterName, openEnd - 3), openEnd));
    const attrSlice = html.slice(afterName, selfClosing ? Math.max(afterName, openEnd - 2) : openEnd - 1);
    const attrs = parseHtmlAttributes(attrSlice, decodeHtmlEntities);

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
      closed: false,
      ...(parent ? { parent } : {}),
      children: [],
    };
    if (parent) parent.children.push(node);
    else roots.push(node);
    nodes.push(node);

    if (selfClosing || VOID_HTML_TAGS.has(tag)) {
      node.closed = true;
      i = openEnd;
      continue;
    }
    if (RAW_TEXT_HTML_TAGS.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
      closeRe.lastIndex = openEnd;
      const hit = closeRe.exec(html);
      node.innerEnd = hit ? hit.index : html.length;
      node.closeEnd = hit ? hit.index + hit[0].length : html.length;
      node.closed = Boolean(hit);
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
  return { nodes, roots };
}

function enclosingScreenOf(node: NoteSpanNode): NoteSpanNode | undefined {
  let cur: NoteSpanNode | undefined = node;
  while (cur) {
    if (cur.attrs['data-screen-id']) return cur;
    cur = cur.parent;
  }
  return undefined;
}

/**
 * Reads every screen-root and anchored element's Prototype Note (`data-note`) from a prototype
 * document or screen fragment.
 */
export function readPrototypeNotes(
  html: string,
  options?: { screenId?: string },
): PrototypeNoteItem[] {
  if (!html?.trim()) return [];
  const targetScreen = options?.screenId?.trim();
  const out: PrototypeNoteItem[] = [];
  for (const node of parseTree(html).nodes) {
    const elementId = node.attrs['data-element-id']?.trim();
    const ownScreenId = node.attrs['data-screen-id']?.trim();
    if (!elementId && !ownScreenId) continue;
    const screenId = ownScreenId || enclosingScreenOf(node)?.attrs['data-screen-id']?.trim();
    if (targetScreen && screenId !== targetScreen) continue;
    const parsed = parsePrototypeNote(node.attrs[PROTOTYPE_NOTE_ATTR]);
    if (!parsed) continue;
    const note = sanitizePrototypeNote(node.attrs[PROTOTYPE_NOTE_ATTR]);
    out.push({
      ...(elementId ? { elementId } : {}),
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
 * or screen-root `data-screen-id` opening tag, keeping every other character of `html` unchanged.
 */
export function writePrototypeNote(
  html: string,
  target: { elementId?: string; screenId?: string },
  note: string | null,
): string {
  const elementId = target.elementId?.trim();
  const targetScreen = target.screenId?.trim();
  if (!html || (!elementId && !targetScreen)) return html;
  const { nodes } = parseTree(html);
  const hit = elementId
    ? nodes.find((node) => {
        if (node.attrs['data-element-id']?.trim() !== elementId) return false;
        if (!targetScreen) return true;
        return enclosingScreenOf(node)?.attrs['data-screen-id']?.trim() === targetScreen;
      })
    : nodes.find((node) => node.attrs['data-screen-id']?.trim() === targetScreen);
  if (!hit) return html;
  const cleaned = note === null ? null : sanitizePrototypeNote(note) || null;
  const updatedOpen = rewriteHtmlTagAttribute(
    html.slice(hit.openStart, hit.openEnd),
    PROTOTYPE_NOTE_ATTR,
    cleaned,
  );
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
  return sanitizePrototypeNote(html.slice(node.openEnd, node.innerEnd));
}

/**
 * Finds the nearest preceding heading (`<h1>`–`<h4>`) inside `container` whose `openStart < beforeOffset`,
 * scanning right-to-left without crossing nested section boundaries.
 */
function findHeadingBefore(
  html: string,
  container: NoteSpanNode,
  beforeOffset: number,
): string | undefined {
  for (let i = container.children.length - 1; i >= 0; i -= 1) {
    const child = container.children[i]!;
    if (child.openStart >= beforeOffset) continue;
    if (SECTION_BOUNDARY_TAGS.has(child.tag)) continue;
    if (HEADING_TAGS.has(child.tag)) {
      const text = extractPlainText(html, child);
      if (text) return text;
      continue;
    }
    const nested = findHeadingBefore(html, child, beforeOffset);
    if (nested) return nested;
  }
  if (HEADING_TAGS.has(container.tag) && container.openStart < beforeOffset) {
    const text = extractPlainText(html, container);
    if (text) return text;
  }
  return undefined;
}

function findEnclosingSectionHeading(
  html: string,
  target: NoteSpanNode,
  screenRoot: NoteSpanNode | undefined,
): string | undefined {
  const ownHeading = findHeadingBefore(html, target, Number.MAX_SAFE_INTEGER);
  if (ownHeading) return ownHeading;

  let child = target;
  let cur = target.parent;
  while (cur) {
    const heading = findHeadingBefore(html, cur, child.openStart);
    if (heading) return heading;
    if (cur === screenRoot) break;
    if (SECTION_BOUNDARY_TAGS.has(cur.tag)) break;
    child = cur;
    cur = cur.parent;
  }
  return undefined;
}

function findFrontierNode(
  html: string,
  root: { innerEnd: number; children: NoteSpanNode[] },
): NoteSpanNode | undefined {
  let curChildren = root.children;
  let curInnerEnd = root.innerEnd;
  let frontier: NoteSpanNode | undefined;
  while (curChildren.length > 0) {
    const lastChild = curChildren[curChildren.length - 1]!;
    if (lastChild.closed && html.slice(lastChild.closeEnd, curInnerEnd).trim().length > 0) {
      break;
    }
    frontier = lastChild;
    curChildren = lastChild.children;
    curInnerEnd = lastChild.innerEnd;
  }
  return frontier;
}

/**
 * Finds the innermost active element at the streaming frontier of a screen and derives its
 * business narration strictly from `data-note` (on the active chain or screen root) or its
 * nearest enclosing section heading. When neither exists, `narration` is omitted — never guessed.
 */
export function derivePrototypeLiveWriting(
  html: string,
  options?: { screenId?: string; locale?: 'zh-CN' | 'en-US'; screenNote?: string },
): PrototypeLiveWritingTarget {
  const locale = options?.locale === 'en-US' ? 'en-US' : 'zh-CN';
  if (!html?.trim()) {
    const early = formatNoteSentence(options?.screenNote ?? '', locale);
    return early ? { narration: early } : {};
  }

  const { nodes, roots } = parseTree(html);
  const requestedScreenId = options?.screenId?.trim();
  const anyScreensInHtml = nodes.some((n) => Boolean(n.attrs['data-screen-id']));

  let screenRoot: NoteSpanNode | undefined;
  if (requestedScreenId) {
    screenRoot = nodes.find((n) => n.attrs['data-screen-id']?.trim() === requestedScreenId);
    if (!screenRoot && anyScreensInHtml) return {};
  } else if (anyScreensInHtml) {
    screenRoot = nodes.find((n) => Boolean(n.attrs['data-screen-id']));
  }

  const virtualRoot: NoteSpanNode = screenRoot ?? {
    tag: '__root',
    attrs: {},
    openStart: 0,
    openEnd: 0,
    innerEnd: html.length,
    closeEnd: html.length,
    closed: false,
    children: roots,
  };
  if (!screenRoot) {
    for (const r of roots) r.parent = virtualRoot;
  }

  const frontier = findFrontierNode(html, virtualRoot);

  if (!frontier) {
    const rootNote = formatNoteSentence(
      screenRoot?.attrs[PROTOTYPE_NOTE_ATTR] ?? options?.screenNote ?? '',
      locale,
    );
    if (rootNote) return { narration: rootNote };
    const rootHeading = findHeadingBefore(html, virtualRoot, virtualRoot.innerEnd);
    return rootHeading
      ? { narration: locale === 'en-US' ? `Drawing "${rootHeading}"` : `正在画「${rootHeading}」` }
      : {};
  }

  let activeAnchored: NoteSpanNode | undefined;
  let walk: NoteSpanNode | undefined = frontier;
  while (walk && walk !== virtualRoot) {
    if (walk.attrs['data-element-id']?.trim()) {
      activeAnchored = walk;
      break;
    }
    walk = walk.parent;
  }
  const elementId = activeAnchored?.attrs['data-element-id']?.trim();

  // Priority 1: `data-note` on the active frontier chain up to the screen root (or explicit screenNote).
  let cur: NoteSpanNode | undefined = frontier;
  while (cur) {
    const noteSentence = formatNoteSentence(cur.attrs[PROTOTYPE_NOTE_ATTR] ?? '', locale);
    if (noteSentence) {
      return { ...(elementId ? { elementId } : {}), narration: noteSentence };
    }
    if (cur === virtualRoot) break;
    cur = cur.parent;
  }
  const fallbackScreenNote = formatNoteSentence(options?.screenNote ?? '', locale);
  if (fallbackScreenNote) {
    return { ...(elementId ? { elementId } : {}), narration: fallbackScreenNote };
  }

  // Priority 2: Nearest enclosing section heading (`<h1>`–`<h4>`), including inside `screenRoot`.
  const heading = findEnclosingSectionHeading(html, frontier, virtualRoot);
  if (heading) {
    return {
      ...(elementId ? { elementId } : {}),
      narration: locale === 'en-US' ? `Drawing "${heading}"` : `正在画「${heading}」`,
    };
  }

  // Neither note nor section heading exists -> no narration!
  return elementId ? { elementId } : {};
}
