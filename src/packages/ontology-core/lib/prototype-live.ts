/**
 * Live prototype building, one screen at a time (spec #87, ADR 0018).
 *
 * The same code runs on the server (to turn tool-call argument streams and document mutations
 * into per-screen deltas) and in the browser (to fold those deltas over the saved document and
 * hand each artboard the body it should show). Nothing here touches the DOM.
 */

import {
  applyPrototypeBuildEvent,
  emptyPrototypeBuildState,
  isPrototypeBuildEvent,
  type PrototypeBuildEvent,
  type PrototypeBuildState,
} from './prototype-build.js';

export type PrototypeScreenStatus = 'queued' | 'streaming' | 'ready';

export interface PrototypeScreenStub {
  screenId: string;
  screenName: string;
  screenType: string;
  status: PrototypeScreenStatus;
}

export interface PrototypeScreenSlice extends PrototypeScreenStub {
  /** The screen's outer `<section data-screen-id>` HTML. */
  html: string;
}

/** Everything in a prototype document that is not a screen: the head and the shell. */
export interface PrototypeDocumentFrame {
  /** The raw attributes of `<html>` (e.g. ` lang="zh-CN"`). */
  htmlAttrs: string;
  /** The `<head>` inner HTML: shared styles, links and head scripts. */
  headHtml: string;
  /** The raw attributes of `<body>`. */
  bodyAttrs: string;
  /** The `<body>` inner HTML with each screen replaced by a `<!--onto-screen:ID-->` marker. */
  bodyHtml: string;
  screens: PrototypeScreenStub[];
}

export type PrototypeLiveEvent =
  | PrototypeBuildEvent
  | { kind: 'frame'; seq: number; frame: PrototypeDocumentFrame }
  | {
      kind: 'screen';
      seq: number;
      screenId: string;
      screenName: string;
      screenType: string;
      status: PrototypeScreenStatus;
      /** The healed outer section HTML of this one screen. */
      html: string;
      /** Screen-specific CSS still being written (cleared once the screen lands in the document). */
      css?: string;
    };

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

/** Index just past the `>` that ends a tag starting at `from`, honouring quotes; -1 if unfinished. */
function findTagClose(html: string, from: number): number {
  let quote: string | null = null;
  let lastSignificant = '';
  for (let i = from; i < html.length; i += 1) {
    const ch = html[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    // A quote only opens an attribute value right after `=`; in `title=it's` it is text.
    if ((ch === '"' || ch === "'") && lastSignificant === '=') {
      quote = ch;
    } else if (ch === '>') {
      return i + 1;
    }
    if (!/\s/.test(ch)) lastSignificant = ch;
  }
  return -1;
}

/** Entity names a stream is likely to be in the middle of; `R&D` is not one of them. */
const COMMON_ENTITY_NAMES = [
  'amp', 'lt', 'gt', 'quot', 'apos', 'nbsp', 'copy', 'reg', 'trade', 'yen', 'euro', 'pound', 'cent',
  'times', 'divide', 'middot', 'hellip', 'mdash', 'ndash', 'laquo', 'raquo', 'ldquo', 'rdquo',
  'lsquo', 'rsquo', 'bull', 'rarr', 'larr', 'uarr', 'darr', 'deg', 'plusmn', 'sect', 'para', 'ensp',
  'emsp', 'thinsp', 'check', 'star',
];

/** Drops a trailing half-written entity (`&am`, `&#12`, a bare `&`), keeping text such as `R&D`. */
function dropHalfEntity(text: string): string {
  const m = /&(#[0-9]*|#x[0-9a-fA-F]*|[A-Za-z0-9]*)$/.exec(text);
  if (!m) return text;
  const name = m[1]!;
  const half = name === '' || name.startsWith('#') || COMMON_ENTITY_NAMES.some((e) => e.startsWith(name));
  return half ? text.slice(0, m.index) : text;
}

function parseAttributes(region: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:@][A-Za-z0-9_.:@-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region)) !== null) {
    attrs[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

interface ScannedElement {
  tag: string;
  attrs: Record<string, string>;
  start: number;
  openEnd: number;
  /** Index just past the closing tag; -1 while unclosed. */
  end: number;
  depth: number;
}

interface ScanResult {
  elements: ScannedElement[];
  /** Elements still open at the end, outermost first. */
  open: ScannedElement[];
  /** Where a half-written trailing construct starts (tag, comment, unfinished script); else length. */
  safeEnd: number;
  /** Set when the input ends inside an unclosed raw-text element such as `<style>`. */
  openRawTag?: string;
}

/** A forgiving single-pass scan of an HTML string with source offsets. */
function scanHtml(html: string): ScanResult {
  const elements: ScannedElement[] = [];
  const stack: ScannedElement[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    const next = html[lt + 1];
    if (next === undefined) return { elements, open: stack, safeEnd: lt };
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      if (close === -1) return { elements, open: stack, safeEnd: lt };
      i = close + 3;
      continue;
    }
    if (html.startsWith('<!-', lt) && lt + 3 >= html.length) return { elements, open: stack, safeEnd: lt };
    if (next === '!' || next === '?') {
      const close = findTagClose(html, lt + 2);
      if (close === -1) return { elements, open: stack, safeEnd: lt };
      i = close;
      continue;
    }
    if (next === '/') {
      const m = /^<\/\s*([A-Za-z][A-Za-z0-9:-]*)?/.exec(html.slice(lt, lt + 64));
      const close = findTagClose(html, lt + 2);
      if (close === -1) return { elements, open: stack, safeEnd: lt };
      const tag = m?.[1]?.toLowerCase();
      if (tag) {
        for (let s = stack.length - 1; s >= 0; s -= 1) {
          if (stack[s]!.tag === tag) {
            for (let k = stack.length - 1; k >= s; k -= 1) stack[k]!.end = close;
            stack.length = s;
            break;
          }
        }
      }
      i = close;
      continue;
    }
    const open = /^<([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (!open) {
      i = lt + 1;
      continue;
    }
    const tag = open[1]!.toLowerCase();
    const afterName = lt + open[0].length;
    const close = findTagClose(html, afterName);
    if (close === -1) return { elements, open: stack, safeEnd: lt };
    const selfClosing = /\/\s*>$/.test(html.slice(Math.max(afterName, close - 3), close));
    const attrRegion = html.slice(afterName, selfClosing ? close - 2 : close - 1);
    const el: ScannedElement = {
      tag,
      attrs: parseAttributes(attrRegion),
      start: lt,
      openEnd: close,
      end: -1,
      depth: stack.length,
    };
    elements.push(el);
    if (VOID_TAGS.has(tag) || selfClosing) {
      el.end = close;
      i = close;
      continue;
    }
    if (RAW_TEXT_TAGS.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, 'ig');
      closeRe.lastIndex = close;
      const hit = closeRe.exec(html);
      if (!hit) {
        if (tag === 'script') return { elements: elements.slice(0, -1), open: stack, safeEnd: lt };
        stack.push(el);
        return { elements, open: stack, safeEnd: html.length, openRawTag: tag };
      }
      el.end = hit.index + hit[0].length;
      i = el.end;
      continue;
    }
    stack.push(el);
    i = close;
  }
  return { elements, open: stack, safeEnd: html.length };
}

/**
 * Turns a half-written HTML stream into HTML that is safe to show: a half-written trailing tag
 * or comment is dropped, an unfinished `<script>` is dropped, an unclosed `<style>` is closed,
 * a trailing half entity is dropped, and elements left open are closed in order.
 */
export function healPartialHtml(raw: string): string {
  const unfenced = raw.replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const scan = scanHtml(unfenced);
  let body = unfenced.slice(0, scan.safeEnd);
  if (scan.openRawTag) {
    // `.a{}</sty` — a half-written end tag of the raw-text element itself.
    const half = /<\/?[A-Za-z]*$/.exec(body);
    if (half && `</${scan.openRawTag}`.startsWith(half[0].toLowerCase())) body = body.slice(0, half.index);
  } else {
    body = dropHalfEntity(body);
  }
  const closers = scan.open
    .slice()
    .reverse()
    .map((el) => `</${el.tag}>`)
    .join('');
  return `${body}${closers}`;
}

function normaliseStatus(raw: string | undefined): PrototypeScreenStatus {
  const lower = (raw ?? '').toLowerCase();
  return lower === 'queued' || lower === 'streaming' ? lower : 'ready';
}

function stubOf(el: ScannedElement): PrototypeScreenStub {
  const screenId = el.attrs['data-screen-id']!;
  return {
    screenId,
    screenName: el.attrs['data-screen-name'] || screenId,
    screenType: el.attrs['data-screen-type'] || 'LIST',
    status: normaliseStatus(el.attrs['data-screen-status']),
  };
}

export const ARTBOARD_SCREEN_MARKER_PREFIX = 'onto-screen:';

function markerFor(screenId: string): string {
  return `<!--${ARTBOARD_SCREEN_MARKER_PREFIX}${screenId.replace(/--/g, '- -')}-->`;
}

/** Splits a prototype document into its shared frame and its screens (outermost sections). */
export function splitPrototypeDocument(html: string): {
  frame: PrototypeDocumentFrame;
  screens: PrototypeScreenSlice[];
} {
  const source = html ?? '';
  const scan = scanHtml(source);
  const head = scan.elements.find((el) => el.tag === 'head');
  const body = scan.elements.find((el) => el.tag === 'body');
  const headEnd = head ? (head.end === -1 ? source.length : head.end) : -1;

  const htmlEl = scan.elements.find((el) => el.tag === 'html');
  const rawAttrs = (el: ScannedElement | undefined) =>
    el ? source.slice(el.start + 1 + el.tag.length, el.openEnd - 1).replace(/\/\s*$/, '') : '';
  const headHtml = head
    ? source.slice(head.openEnd, head.end === -1 ? source.length : source.lastIndexOf('</', head.end))
    : '';

  const bodyStart = body ? body.openEnd : head ? headEnd : 0;
  const bodyEnd = body
    ? body.end === -1
      ? source.length
      : source.lastIndexOf('</', body.end)
    : source.length;

  const screens: PrototypeScreenSlice[] = [];
  let cursor = bodyStart;
  let bodyHtml = '';
  for (const el of scan.elements) {
    if (!el.attrs['data-screen-id'] || el.start < cursor || el.start >= bodyEnd) continue;
    const end = el.end === -1 ? bodyEnd : el.end;
    const stub = stubOf(el);
    screens.push({ ...stub, html: source.slice(el.start, end) });
    bodyHtml += source.slice(cursor, el.start) + markerFor(stub.screenId);
    cursor = end;
  }
  bodyHtml += source.slice(cursor, Math.max(cursor, bodyEnd));

  return {
    frame: {
      htmlAttrs: rawAttrs(htmlEl),
      headHtml,
      bodyAttrs: rawAttrs(body),
      bodyHtml: bodyHtml.trim() ? bodyHtml : '',
      screens: screens.map(({ html: _html, ...stub }) => stub),
    },
    screens,
  };
}

/** The `<body>` inner HTML for one artboard: the shared shell with exactly this one screen. */
export function composeArtboardBody(
  frame: PrototypeDocumentFrame | undefined,
  screenId: string,
  screenHtml: string,
): string {
  if (!frame || !frame.bodyHtml.trim()) return screenHtml;
  const own = markerFor(screenId);
  let placed = false;
  const markerRe = new RegExp(`<!--${ARTBOARD_SCREEN_MARKER_PREFIX}[\\s\\S]*?-->`, 'g');
  const composed = frame.bodyHtml.replace(markerRe, (marker) => {
    if (marker === own && !placed) {
      placed = true;
      return screenHtml;
    }
    return '';
  });
  if (placed) return composed;
  // A screen the shell does not know yet goes where the screens live (or at the end).
  const mainClose = composed.search(/<\/main>/i);
  return mainClose >= 0
    ? `${composed.slice(0, mainClose)}${screenHtml}${composed.slice(mainClose)}`
    : `${composed}${screenHtml}`;
}

/** Shared styles, stylesheet links and head scripts of a frame, for artboards. */
export function prototypeFrameAssets(frame: PrototypeDocumentFrame | undefined): {
  css: string;
  links: string[];
  scripts: string[];
} {
  const headHtml = frame?.headHtml ?? '';
  const css: string[] = [];
  const links: string[] = [];
  const scripts: string[] = [];
  for (const el of scanHtml(headHtml).elements) {
    if (el.tag === 'style') {
      const closeAt = el.end === -1 ? headHtml.length : headHtml.lastIndexOf('</', el.end);
      css.push(headHtml.slice(el.openEnd, Math.max(el.openEnd, closeAt)));
    } else if (el.tag === 'link' && /stylesheet/i.test(el.attrs.rel ?? '') && el.attrs.href) {
      links.push(el.attrs.href);
    } else if (el.tag === 'script' && el.end !== -1) {
      scripts.push(headHtml.slice(el.start, el.end));
    }
  }
  return { css: css.join('\n'), links, scripts };
}

function escapeAttr(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface PartialPrototypeScreenStream {
  screenId: string;
  screenName?: string;
  screenType?: string;
  /** The screen HTML written so far (already JSON-decoded tool-call arguments). */
  partialHtml: string;
  /** Screen-specific CSS written so far. */
  css?: string;
}

/** The healed `<section>` for a screen that is still being written. */
export function healPartialScreenSection(
  input: PartialPrototypeScreenStream,
  known?: Pick<PrototypeScreenStub, 'screenName' | 'screenType'>,
): { html: string; screenName: string; screenType: string } {
  const screenId = input.screenId.trim();
  const screenName = input.screenName?.trim() || known?.screenName || screenId;
  const screenType = input.screenType?.trim() || known?.screenType || 'LIST';
  // Same shape as upsert_prototype_screen's landed section (`>\n${fragment}\n</section>`, or the
  // model's own section kept as-is), so streamed nodes keep their positions when the screen lands.
  let inner = healPartialHtml(input.partialHtml).trimStart();
  const opened = /^<section\b[^>]*data-screen-id\s*=\s*["']?([^"'\s>]+)[^>]*>/i.exec(inner);
  if (opened && opened[1] === screenId) {
    inner = inner.slice(opened[0].length).replace(/<\/section>$/i, '');
  } else {
    inner = `\n${inner.trimEnd()}\n`;
  }
  const html = `<section id="screen-${escapeAttr(screenId)}" class="proto-screen is-active" data-screen-id="${escapeAttr(screenId)}" data-screen-name="${escapeAttr(screenName)}" data-screen-type="${escapeAttr(screenType)}" data-screen-status="streaming">${inner}</section>`;
  return { html, screenName, screenType };
}

function healPartialCss(css: string | undefined): string | undefined {
  if (!css?.trim()) return undefined;
  // Drop a trailing unfinished rule and anything that would close the style element early.
  const cleaned = css.replace(/<\/?style[^>]*>?/gi, '');
  const lastClose = cleaned.lastIndexOf('}');
  const complete = lastClose >= 0 ? cleaned.slice(0, lastClose + 1) : '';
  return complete.trim() || undefined;
}

/** Screen status changes travel in screen events, so they do not make the frame "changed". */
function frameKey(frame: PrototypeDocumentFrame): string {
  return JSON.stringify({
    htmlAttrs: frame.htmlAttrs,
    headHtml: frame.headHtml,
    bodyAttrs: frame.bodyAttrs,
    bodyHtml: frame.bodyHtml,
    screens: frame.screens.map((s) => [s.screenId, s.screenName, s.screenType]),
  });
}

function screenKey(ev: { status: string; html: string; css?: string; screenName: string; screenType: string }): string {
  return `${ev.status}\u0000${ev.screenName}\u0000${ev.screenType}\u0000${ev.css ?? ''}\u0000${ev.html}`;
}

export interface PrototypeLiveTracker {
  /** Sets what the client already shows (the saved revision) without emitting anything. */
  reset(documentHtml: string): void;
  /** Deltas between what was last sent and this document; screens still streaming are skipped. */
  observeDocument(
    documentHtml: string,
    options?: { streamingScreenIds?: Iterable<string> },
  ): PrototypeLiveEvent[];
  /** A delta for one screen whose HTML is still being written; null when nothing changed. */
  observePartialScreen(input: PartialPrototypeScreenStream): PrototypeLiveEvent | null;
  /**
   * A screen's write was rejected: if the document does not have that screen, what was streamed
   * for it is taken back (an empty queued screen); null when there is nothing to take back.
   */
  withdrawScreen(screenId: string, documentHtml: string): PrototypeLiveEvent | null;
}

/**
 * Remembers what has been sent for each screen and for the frame, and produces only the
 * deltas. Sequence numbers increase monotonically across all events of one tracker.
 */
export function createPrototypeLiveTracker(): PrototypeLiveTracker {
  let seq = 0;
  let sentFrame = '';
  const sentScreens = new Map<string, string>();
  const knownStubs = new Map<string, PrototypeScreenStub>();

  const remember = (documentHtml: string) => {
    const { frame, screens } = splitPrototypeDocument(documentHtml);
    sentFrame = frameKey(frame);
    for (const s of screens) {
      knownStubs.set(s.screenId, s);
      sentScreens.set(s.screenId, screenKey(s));
    }
  };

  return {
    reset(documentHtml) {
      sentScreens.clear();
      knownStubs.clear();
      sentFrame = '';
      if (documentHtml.trim()) remember(documentHtml);
    },
    observeDocument(documentHtml, options) {
      if (!documentHtml.trim()) return [];
      const skip = new Set(options?.streamingScreenIds ?? []);
      const { frame, screens } = splitPrototypeDocument(documentHtml);
      const events: PrototypeLiveEvent[] = [];
      const fKey = frameKey(frame);
      if (fKey !== sentFrame) {
        sentFrame = fKey;
        seq += 1;
        events.push({ kind: 'frame', seq, frame });
      }
      for (const s of screens) {
        knownStubs.set(s.screenId, s);
        if (skip.has(s.screenId)) continue;
        const key = screenKey(s);
        if (sentScreens.get(s.screenId) === key) continue;
        sentScreens.set(s.screenId, key);
        seq += 1;
        events.push({
          kind: 'screen',
          seq,
          screenId: s.screenId,
          screenName: s.screenName,
          screenType: s.screenType,
          status: s.status,
          html: s.html,
        });
      }
      return events;
    },
    observePartialScreen(input) {
      const screenId = input.screenId?.trim();
      if (!screenId) return null;
      const known = knownStubs.get(screenId);
      const healed = healPartialScreenSection(input, known);
      if (!known) {
        knownStubs.set(screenId, {
          screenId,
          screenName: healed.screenName,
          screenType: healed.screenType,
          status: 'streaming',
        });
      }
      const css = healPartialCss(input.css);
      const candidate = {
        status: 'streaming' as const,
        html: healed.html,
        screenName: healed.screenName,
        screenType: healed.screenType,
        ...(css ? { css } : {}),
      };
      const key = screenKey(candidate);
      if (sentScreens.get(screenId) === key) return null;
      sentScreens.set(screenId, key);
      seq += 1;
      return { kind: 'screen', seq, screenId, ...candidate };
    },
    withdrawScreen(screenId, documentHtml) {
      const sid = screenId.trim();
      const sent = sentScreens.get(sid);
      if (!sent || !sent.startsWith('streaming\u0000')) return null;
      if (splitPrototypeDocument(documentHtml).screens.some((s) => s.screenId === sid)) return null;
      const known = knownStubs.get(sid);
      const candidate = {
        status: 'queued' as const,
        html: '',
        screenName: known?.screenName ?? sid,
        screenType: known?.screenType ?? 'LIST',
      };
      sentScreens.set(sid, screenKey(candidate));
      seq += 1;
      return { kind: 'screen', seq, screenId: sid, ...candidate };
    },
  };
}

// ─── Client side ─────────────────────────────────────────────────────────────

export interface PrototypeLiveScreenState {
  seq: number;
  screenId: string;
  screenName: string;
  screenType: string;
  status: PrototypeScreenStatus;
  html: string;
  css?: string;
}

export interface PrototypeLiveState {
  frame?: PrototypeDocumentFrame;
  frameSeq: number;
  screens: Record<string, PrototypeLiveScreenState>;
  /** Screens in the order their first event arrived (for screens the frame does not list). */
  arrival: string[];
  /** The screen the latest real event touched; the follow camera aims here. */
  focusScreenId?: string;
  focusSeq: number;
  /** The run's Build Plan and per-screen build states (#90), once the run has a plan. */
  build?: PrototypeBuildState;
}

export function emptyPrototypeLiveState(): PrototypeLiveState {
  return { frameSeq: 0, screens: {}, arrival: [], focusSeq: 0 };
}

export function applyPrototypeLiveEvent(
  state: PrototypeLiveState,
  event: PrototypeLiveEvent,
): PrototypeLiveState {
  if (isPrototypeBuildEvent(event)) {
    const prevBuild = state.build ?? emptyPrototypeBuildState();
    const build = applyPrototypeBuildEvent(prevBuild, event);
    return build === state.build ? state : { ...state, build };
  }
  if (event.kind === 'frame') {
    if (event.seq <= state.frameSeq) return state;
    return { ...state, frame: event.frame, frameSeq: event.seq };
  }
  const prev = state.screens[event.screenId];
  if (prev && prev.seq >= event.seq) return state;
  const next: PrototypeLiveScreenState = {
    seq: event.seq,
    screenId: event.screenId,
    screenName: event.screenName,
    screenType: event.screenType,
    status: event.status,
    html: event.html,
    ...(event.css ? { css: event.css } : {}),
  };
  // The follow camera aims only at screens being written; a screen that lands releases it.
  const focus =
    event.status === 'streaming'
      ? { focusScreenId: event.screenId, focusSeq: state.focusSeq + 1 }
      : state.focusScreenId === event.screenId
        ? { focusScreenId: undefined, focusSeq: state.focusSeq + 1 }
        : {};
  const nextState: PrototypeLiveState = {
    ...state,
    screens: { ...state.screens, [event.screenId]: next },
    arrival: prev ? state.arrival : [...state.arrival, event.screenId],
    ...focus,
  };
  if (nextState.focusScreenId === undefined) delete nextState.focusScreenId;
  return nextState;
}

export interface PrototypeCanvasArtboard extends PrototypeScreenStub {
  /** The `<body>` inner HTML this artboard shows: the shell plus this one screen. */
  bodyHtml: string;
  /** Extra CSS that only this artboard needs (a screen's styles still being written). */
  css?: string;
}

export interface PrototypeCanvasModel {
  css: string;
  links: string[];
  /** Head scripts, run in each artboard once its screen has landed. */
  headScripts: string[];
  screens: PrototypeCanvasArtboard[];
  /** The whole `<body>` inner HTML: the shell with every screen (web mode shows one at a time). */
  pageBodyHtml: string;
  /** Screen styles still being written, for every screen (web mode). */
  pageCss: string;
}

/** The shell's body with each screen marker replaced by that screen's HTML (plus screens still being written). */
function composeDocumentBody(
  frame: PrototypeDocumentFrame,
  htmlById: ReadonlyMap<string, string>,
  live: PrototypeLiveState | null | undefined,
): string {
  const markerRe = new RegExp(`<!--${ARTBOARD_SCREEN_MARKER_PREFIX}([\\s\\S]*?)-->`, 'g');
  const placed = new Set<string>();
  let body = frame.bodyHtml.replace(markerRe, (_marker, rawId: string) => {
    const id = rawId.replace(/- -/g, '--');
    placed.add(id);
    return htmlById.get(id) ?? '';
  });
  const extra = (live?.arrival ?? [])
    .filter((id) => !placed.has(id) && live!.screens[id]?.status === 'streaming')
    .map((id) => htmlById.get(id) ?? '')
    .join('');
  if (extra) {
    const mainClose = body.search(/<\/main>/i);
    body = mainClose >= 0 ? `${body.slice(0, mainClose)}${extra}${body.slice(mainClose)}` : `${body}${extra}`;
  }
  return body;
}

/**
 * Folds live per-screen state over a saved document into one artboard per screen. With a Build
 * Plan, the planned screens come first in plan order, and a planned screen nothing has been
 * written for yet is a blank artboard.
 */
export function buildPrototypeCanvasModel(
  documentHtml: string,
  live?: PrototypeLiveState | null,
  build?: PrototypeBuildState | null,
): PrototypeCanvasModel {
  const saved = splitPrototypeDocument(documentHtml ?? '');
  const frame = live?.frame ?? saved.frame;
  const savedById = new Map(saved.screens.map((s) => [s.screenId, s]));

  const order: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  };
  // The frame lists the document's screens; beyond those, only screens still being written show
  // (a screen the latest frame dropped is gone, not a ghost).
  const plan = build?.plan ?? [];
  for (const item of plan) push(item.screenId);
  for (const stub of frame.screens) push(stub.screenId);
  for (const id of live?.arrival ?? []) {
    if (live?.screens[id]?.status === 'streaming') push(id);
  }

  const stubById = new Map(frame.screens.map((s) => [s.screenId, s]));
  const planById = new Map(plan.map((p) => [p.screenId, p]));
  const screens: PrototypeCanvasArtboard[] = [];
  for (const id of order) {
    const liveScreen = live?.screens[id];
    const savedScreen = savedById.get(id);
    const stub = stubById.get(id);
    const planned = planById.get(id);
    const html = liveScreen?.html ?? savedScreen?.html;
    if (html === undefined && !stub && !planned) continue;
    const base = liveScreen ?? savedScreen ?? stub;
    screens.push({
      screenId: id,
      screenName: planned?.screenName || base?.screenName || id,
      screenType: base?.screenType ?? planned?.screenType ?? 'LIST',
      status: liveScreen?.status ?? savedScreen?.status ?? stub?.status ?? 'queued',
      // Nothing written yet (or a failed write was taken back): a blank artboard.
      bodyHtml: html ? composeArtboardBody(frame, id, html) : '',
      ...(liveScreen?.css ? { css: liveScreen.css } : {}),
    });
  }
  const assets = prototypeFrameAssets(frame);
  const htmlById = new Map(saved.screens.map((s) => [s.screenId, s.html]));
  for (const [id, screen] of Object.entries(live?.screens ?? {})) htmlById.set(id, screen.html);
  return {
    css: assets.css,
    links: assets.links,
    headScripts: assets.scripts,
    screens,
    pageBodyHtml: composeDocumentBody(frame, htmlById, live),
    pageCss: screens.map((s) => s.css ?? '').filter(Boolean).join('\n'),
  };
}

/**
 * The whole document as it stands during a run: the live frame (or the saved one) with every
 * screen's latest HTML, for views that show the prototype as one page. Without live state it
 * returns the saved document unchanged.
 */
export function composePrototypeDocument(
  documentHtml: string,
  live?: PrototypeLiveState | null,
): string {
  const hasLive = Boolean(live && (live.frame || Object.keys(live.screens).length > 0));
  if (!hasLive) return documentHtml;
  const saved = splitPrototypeDocument(documentHtml ?? '');
  const frame = live!.frame ?? saved.frame;
  const htmlById = new Map(saved.screens.map((s) => [s.screenId, s.html]));
  for (const [id, screen] of Object.entries(live!.screens)) htmlById.set(id, screen.html);
  const body = composeDocumentBody(frame, htmlById, live);
  return `<!DOCTYPE html>\n<html${frame.htmlAttrs}>\n<head>${frame.headHtml}</head>\n<body${frame.bodyAttrs}>${body}</body>\n</html>`;
}

/**
 * About one update per screen per interval: the first update goes out at once, later ones are
 * held and the latest is flushed when the interval has passed, so the last update before the
 * model pauses still arrives. `end` drops what is pending for a screen whose write ended.
 */
export function createPartialScreenThrottle<T>(options: {
  intervalMs: number;
  onFlush: (screenId: string, value: T) => void;
}): { push(screenId: string, value: T): void; end(screenId: string): void; dispose(): void } {
  const lastSent = new Map<string, number>();
  const pending = new Map<string, T>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const flush = (screenId: string) => {
    timers.delete(screenId);
    if (!pending.has(screenId)) return;
    const value = pending.get(screenId) as T;
    pending.delete(screenId);
    lastSent.set(screenId, Date.now());
    options.onFlush(screenId, value);
  };
  return {
    push(screenId, value) {
      const since = Date.now() - (lastSent.get(screenId) ?? -Infinity);
      pending.set(screenId, value);
      if (since >= options.intervalMs) {
        const timer = timers.get(screenId);
        if (timer) clearTimeout(timer);
        flush(screenId);
        return;
      }
      if (!timers.has(screenId)) {
        timers.set(screenId, setTimeout(() => flush(screenId), options.intervalMs - since));
      }
    },
    end(screenId) {
      const timer = timers.get(screenId);
      if (timer) clearTimeout(timer);
      timers.delete(screenId);
      pending.delete(screenId);
      lastSent.delete(screenId);
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      pending.clear();
    },
  };
}
