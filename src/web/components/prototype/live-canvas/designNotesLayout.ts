import {
  parsePrototypeNote,
  readPrototypeNotes,
  type PrototypeCanvasArtboard,
} from '../../../../packages/ontology-core/index.js';
import { ARTBOARD_H, ARTBOARD_LABEL_SPACE, ARTBOARD_W, type Rect } from './camera.js';

/** Full-row blocks (>= 85% of container width) skip the dashed target outline (#88 verdict). */
export const FULL_ROW_WIDTH_RATIO = 0.85;
/** Maximum callout width (px) when placed in blank space inside the page. */
export const DEFAULT_MAX_NOTE_W = 236;
/**
 * Maximum callout width (px) in the outer artboard gutter on the canvas.
 * With `OUTSIDE_GUTTER_GAP = 18`, `18 + 164 + 18 = 200`, fitting cleanly inside `GAP_X = 200`
 * between adjacent artboard columns.
 */
export const OUTSIDE_MAX_NOTE_W = 164;
export const OUTSIDE_GUTTER_GAP = 18;
export const WEB_EDGE_INSET = 16;

const PAGE_INSET = 14;
const OBSTACLE_GAP = 8;
const NOTE_GAP = 12;
const CANVAS_FONT_SIZE = 18;
const CANVAS_LINE_HEIGHT = 25;
const WEB_FONT_SIZE = 16;
const WEB_LINE_HEIGHT = 23;
const PAD_X = 8;
const PAD_Y = 4;

export interface DesignNoteTarget {
  /** Stable `data-element-id` of the annotated element. */
  id: string;
  /** Raw `data-note` value on the element. */
  note: string;
  /** Element bounding box in board/document coordinates. */
  rect: Rect;
  /**
   * Optional tighter focal rect (e.g. primary heading/text inside a full-width transparent
   * `<section>` wrapper) that the curved arrow aims at. Defaults to `rect`.
   */
  anchorRect?: Rect;
  /**
   * True when the element itself is an unbordered, unfilled layout container, allowing callouts
   * to land in blank space inside `rect` as long as they avoid `occupied` obstacles and `anchorRect`.
   */
  transparentContainer?: boolean;
}

export interface PlacedDesignNote {
  id: string;
  title?: string;
  body: string;
  text: string;
  box: Rect;
  targetRect: Rect;
  skipOutline: boolean;
  arrowPath: string;
  arrowHead: string;
  outside: boolean;
}

export interface PlaceDesignNotesOptions {
  width?: number;
  height?: number;
  /** True on the pan/zoom artboard canvas (outer gutter exists); false in full-width web mode. */
  allowOutside?: boolean;
  /**
   * Optional tighter obstacle list containing only text runs and interactive controls (excluding
   * large card background fills). In web mode (`allowOutside: false`), where responsive cards may
   * span the full pane width and no outer gutter exists, placement prefers avoiding all `occupied`
   * blocks first and then allows whitespace inside cards that avoids all `inkOccupied` text/controls.
   */
  inkOccupied?: readonly Rect[];
  fontSize?: number;
  lineHeight?: number;
  maxNoteWidth?: number;
  formatText?: (raw: string) => string;
}

export interface MeasuredScreenDesignNotes {
  targets: DesignNoteTarget[];
  occupied: Rect[];
  inkOccupied: Rect[];
  docWidth: number;
  docHeight: number;
  scrollLeft: number;
  scrollTop: number;
}

function hits(a: Rect, b: Rect, pad: number): boolean {
  return (
    a.x < b.x + b.w + pad &&
    a.x + a.w + pad > b.x &&
    a.y < b.y + b.h + pad &&
    a.y + a.h + pad > b.y
  );
}

function visualColumns(text: string): number {
  let cols = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    cols += code > 0x2e80 ? 1 : 0.56;
  }
  return cols;
}

export function estimateNoteBoxSize(
  text: string,
  maxWidth: number,
  fontSize: number,
  lineHeight: number,
): { w: number; h: number } {
  const cols = visualColumns(text);
  const innerMax = Math.max(fontSize * 4, maxWidth - PAD_X * 2);
  const perLine = Math.max(4, innerMax / (fontSize * 1.02));
  const lines = Math.max(1, Math.ceil(cols / perLine));
  const singleLineW = Math.ceil(cols * fontSize * 1.02) + PAD_X * 2 + 4;
  const w = lines === 1 ? Math.min(maxWidth, Math.max(64, singleLineW)) : maxWidth;
  const h = lines * lineHeight + PAD_Y * 2;
  return { w, h };
}

function nearestPointOnRect(r: Rect, p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.max(r.x, Math.min(p.x, r.x + r.w)),
    y: Math.max(r.y, Math.min(p.y, r.y + r.h)),
  };
}

function buildCurvedArrow(box: Rect, target: Rect, index: number): { arrowPath: string; arrowHead: string } {
  const bc = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const tc = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  const rawEnd = nearestPointOnRect(target, bc);
  const aimPoint = rawEnd.x === bc.x && rawEnd.y === bc.y ? tc : rawEnd;
  const paddedBox: Rect = { x: box.x - 4, y: box.y - 3, w: box.w + 8, h: box.h + 6 };
  const start = nearestPointOnRect(paddedBox, aimPoint);

  let dx = rawEnd.x - start.x;
  let dy = rawEnd.y - start.y;
  let len = Math.hypot(dx, dy);

  // If fallback edge placement sits right next to or slightly over a wide target, aim cleanly at target center/edge.
  let end0 = rawEnd;
  if (len < 10) {
    end0 = tc;
    dx = end0.x - start.x;
    dy = end0.y - start.y;
    len = Math.hypot(dx, dy) || 1;
  }

  const pullback = Math.min(6, len * 0.25);
  const end = {
    x: end0.x - (dx / len) * pullback,
    y: end0.y - (dy / len) * pullback,
  };

  const bendSign = index % 2 === 0 ? -1 : 1;
  const bend = bendSign * Math.min(36, len * 0.24);
  const cx = (start.x + end.x) / 2 - (dy / len) * bend;
  const cy = (start.y + end.y) / 2 + (dx / len) * bend;

  const tx = end.x - cx;
  const ty = end.y - cy;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const headLen = 8.5;
  const wing = 0.55;
  const leftWing = {
    x: end.x - ux * headLen - uy * headLen * wing,
    y: end.y - uy * headLen + ux * headLen * wing,
  };
  const rightWing = {
    x: end.x - ux * headLen + uy * headLen * wing,
    y: end.y - uy * headLen - ux * headLen * wing,
  };

  return {
    arrowPath: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
    arrowHead: `M ${leftWing.x.toFixed(1)} ${leftWing.y.toFixed(1)} L ${end.x.toFixed(1)} ${end.y.toFixed(1)} L ${rightWing.x.toFixed(1)} ${rightWing.y.toFixed(1)}`,
  };
}

/**
 * Deterministically places handwritten Prototype Notes in blank space near each target element,
 * avoiding `occupied` ink/blocks/controls and previously placed notes, falling back to the outer
 * artboard gutter on the canvas (`allowOutside: true`) or inner page edge in web mode (`false`).
 */
export function placeDesignNotes(
  targets: readonly DesignNoteTarget[],
  occupied: readonly Rect[],
  options: PlaceDesignNotesOptions = {},
): PlacedDesignNote[] {
  const width = options.width ?? ARTBOARD_W;
  const height = options.height ?? ARTBOARD_H;
  const allowOutside = options.allowOutside ?? true;
  const fontSize = options.fontSize ?? (allowOutside ? CANVAS_FONT_SIZE : WEB_FONT_SIZE);
  const lineHeight = options.lineHeight ?? (allowOutside ? CANVAS_LINE_HEIGHT : WEB_LINE_HEIGHT);
  const maxNoteWidth = options.maxNoteWidth ?? DEFAULT_MAX_NOTE_W;
  const format = options.formatText;

  const parsedTargets = targets.flatMap((t) => {
    const parsed = parsePrototypeNote(t.note);
    if (!parsed) return [];
    const title = parsed.title ? (format ? format(parsed.title) : parsed.title).trim() : undefined;
    const body = (format ? format(parsed.body) : parsed.body).trim();
    if (!body) return [];
    const text = title ? `${title}：${body}` : body;
    return [{ target: t, ...(title ? { title } : {}), body, text }];
  });

  const targetGuards: Rect[] = parsedTargets.map(({ target }) =>
    target.transparentContainer ? (target.anchorRect ?? target.rect) : target.rect,
  );

  const placed: PlacedDesignNote[] = [];
  const taken: Rect[] = [];
  const gutters = { left: 24, right: 24 };

  parsedTargets.forEach(({ target, title, body, text }, idx) => {
    const anchor = target.anchorRect ?? target.rect;
    const selfGuard = targetGuards[idx]!;
    const { w, h } = estimateNoteBoxSize(text, maxNoteWidth, fontSize, lineHeight);

    const preferLeftFirst = anchor.x + anchor.w / 2 > width * 0.58;
    const sides = preferLeftFirst ? (['left', 'right'] as const) : (['right', 'left'] as const);
    const candidates: Rect[] = [];

    for (const d of [18, 44, 84, 136, 204, 290]) {
      for (const dy of [0, -32, 32, -68, 68, -112, 112]) {
        const y = anchor.y + anchor.h / 2 - h / 2 + dy;
        for (const side of sides) {
          const x = side === 'right' ? anchor.x + anchor.w + d : anchor.x - d - w;
          candidates.push({ x, y, w, h });
        }
      }
      for (const dx of [0, 64, -64, 148, -148, 248, -248]) {
        const cx = anchor.x + anchor.w / 2 - w / 2 + dx;
        candidates.push({ x: cx, y: anchor.y + anchor.h + Math.round(d * 0.75), w, h });
        candidates.push({ x: cx, y: anchor.y - Math.round(d * 0.75) - h, w, h });
      }
    }

    const inBounds = (cand: Rect) =>
      cand.x >= PAGE_INSET &&
      cand.y >= PAGE_INSET &&
      cand.x + cand.w <= width - PAGE_INSET &&
      cand.y + cand.h <= height - PAGE_INSET &&
      !taken.some((prev) => hits(cand, prev, NOTE_GAP));

    let box = candidates.find(
      (cand) =>
        inBounds(cand) &&
        !hits(cand, selfGuard, OBSTACLE_GAP) &&
        !targetGuards.some((g) => hits(cand, g, OBSTACLE_GAP)) &&
        !occupied.some((obs) => hits(cand, obs, OBSTACLE_GAP)),
    );

    // In Web mode (no outer gutter), if responsive cards span the width, allow whitespace inside a card
    // as long as the note avoids every text run, interactive control, and previously placed note.
    if (!box && !allowOutside && options.inkOccupied) {
      const ink = options.inkOccupied;
      box = candidates.find(
        (cand) =>
          inBounds(cand) &&
          !ink.some((obs) => hits(cand, obs, OBSTACLE_GAP)),
      );
    }

    let outside = false;
    if (!box) {
      outside = true;
      const side: 'left' | 'right' = anchor.x + anchor.w / 2 > width / 2 ? 'right' : 'left';
      if (allowOutside) {
        const outSize = estimateNoteBoxSize(text, OUTSIDE_MAX_NOTE_W, fontSize, lineHeight);
        const x = side === 'right' ? width + OUTSIDE_GUTTER_GAP : -OUTSIDE_GUTTER_GAP - outSize.w;
        const y = Math.max(8, Math.round(anchor.y + anchor.h / 2 - outSize.h / 2), gutters[side]);
        gutters[side] = y + outSize.h + 16;
        box = { x, y, w: outSize.w, h: outSize.h };
      } else {
        const edgeMaxW = Math.min(maxNoteWidth, Math.max(140, Math.floor(width * 0.34)));
        const edgeSize = estimateNoteBoxSize(text, edgeMaxW, fontSize, lineHeight);
        const xRight = Math.max(WEB_EDGE_INSET, width - edgeSize.w - WEB_EDGE_INSET);
        const xLeft = WEB_EDGE_INSET;
        const ink = options.inkOccupied ?? occupied;

        // Try left and right inner edges near the anchor without hitting text/controls if possible
        const preferredX = side === 'right' ? [xRight, xLeft] : [xLeft, xRight];
        let chosen: Rect | undefined;
        for (const cx of preferredX) {
          for (const dy of [0, -44, 44, -88, 88, -136, 136]) {
            const cy = Math.max(PAGE_INSET, Math.round(anchor.y + anchor.h / 2 - edgeSize.h / 2 + dy));
            const cand = { x: cx, y: cy, w: edgeSize.w, h: edgeSize.h };
            if (
              cy + edgeSize.h <= height - PAGE_INSET &&
              !taken.some((prev) => hits(cand, prev, NOTE_GAP)) &&
              !ink.some((obs) => hits(cand, obs, 6))
            ) {
              chosen = cand;
              break;
            }
          }
          if (chosen) break;
        }

        if (chosen) {
          box = chosen;
        } else {
          const x = side === 'right' ? xRight : xLeft;
          let y = Math.max(
            PAGE_INSET,
            Math.round(anchor.y + anchor.h / 2 - edgeSize.h / 2),
            gutters[side],
          );
          while (taken.some((prev) => hits({ x, y, w: edgeSize.w, h: edgeSize.h }, prev, NOTE_GAP))) {
            y += 18;
          }
          gutters[side] = y + edgeSize.h + 14;
          box = { x, y, w: edgeSize.w, h: edgeSize.h };
        }
      }
    }

    taken.push(box);
    const { arrowPath, arrowHead } = buildCurvedArrow(box, anchor, idx);
    placed.push({
      id: target.id,
      ...(title ? { title } : {}),
      body,
      text,
      box,
      targetRect: target.rect,
      skipOutline: target.rect.w >= width * FULL_ROW_WIDTH_RATIO,
      arrowPath,
      arrowHead,
      outside,
    });
  });

  return placed;
}

/**
 * Expands a single artboard's world-space framing rect to include any outer-gutter callouts so
 * turning `设计说明` ON frames both the screen and its margin notes inside the canvas viewport.
 */
export function computeDesignNotesFrameBounds(
  boardWorldRect: Rect,
  placed: readonly PlacedDesignNote[],
): Rect {
  let minX = 0;
  let maxX = boardWorldRect.w;
  let minY = -60;
  let maxY = boardWorldRect.h;

  for (const note of placed) {
    minX = Math.min(minX, note.box.x - 12);
    maxX = Math.max(maxX, note.box.x + note.box.w + 12);
    minY = Math.min(minY, Math.max(-ARTBOARD_LABEL_SPACE, note.box.y - 12));
    maxY = Math.max(maxY, note.box.y + note.box.h + 12);
  }

  return {
    x: boardWorldRect.x + minX,
    y: boardWorldRect.y + minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

export function hasScreenElementNotes(board: PrototypeCanvasArtboard): boolean {
  return readPrototypeNotes(board.screenHtml ?? board.bodyHtml, {
    screenId: board.screenId,
  }).some((n) => Boolean(n.elementId));
}

export function pickDesignNotesScreenId(
  screens: readonly PrototypeCanvasArtboard[],
  options: {
    tryScreenId?: string | null | undefined;
    preferredIds?: readonly (string | null | undefined)[];
  } = {},
): { screenId: string | undefined; hasNotes: boolean } {
  const byId = new Map(screens.map((s) => [s.screenId, s] as const));
  if (options.tryScreenId && byId.has(options.tryScreenId)) {
    return {
      screenId: options.tryScreenId,
      hasNotes: hasScreenElementNotes(byId.get(options.tryScreenId)!),
    };
  }
  const preferred = options.preferredIds ?? [];
  for (const candidate of preferred) {
    if (!candidate) continue;
    const board = byId.get(candidate);
    if (board && hasScreenElementNotes(board)) {
      return { screenId: board.screenId, hasNotes: true };
    }
  }
  const firstWithNotes = screens.find((s) => hasScreenElementNotes(s));
  if (firstWithNotes) {
    return { screenId: firstWithNotes.screenId, hasNotes: true };
  }
  for (const candidate of preferred) {
    if (candidate && byId.has(candidate)) {
      return { screenId: candidate, hasNotes: false };
    }
  }
  return { screenId: screens[0]?.screenId, hasNotes: false };
}

export function measureDesignNotesFrameBounds(
  doc: Document | null,
  screenId: string,
  boardWorldRect: Rect,
): Rect {
  const measured = measureScreenDesignNotes(doc, screenId, {
    scrollMode: 'viewport',
    fallbackWidth: ARTBOARD_W,
    fallbackHeight: ARTBOARD_H,
  });
  const placed =
    measured.targets.length > 0
      ? placeDesignNotes(measured.targets, measured.occupied, {
          width: ARTBOARD_W,
          height: ARTBOARD_H,
          allowOutside: true,
        })
      : [];
  return computeDesignNotesFrameBounds(boardWorldRect, placed);
}

function cssAttrEscape(raw: string): string {
  return raw.replace(/["\\]/g, '\\$&');
}

function isTransparentFill(value: string): boolean {
  const trimmed = value.trim();
  return (
    !trimmed ||
    trimmed === 'transparent' ||
    trimmed.endsWith(', 0)') ||
    /\/\s*0(?:\.0+)?\s*\)$/.test(trimmed)
  );
}

function hasVisibleBorder(cs: CSSStyleDeclaration): boolean {
  return (
    (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') ||
    (parseFloat(cs.borderRightWidth) > 0 && cs.borderRightStyle !== 'none') ||
    (parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== 'none') ||
    (parseFloat(cs.borderLeftWidth) > 0 && cs.borderLeftStyle !== 'none')
  );
}

const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK']);
const CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'IMG', 'SVG', 'CANVAS', 'VIDEO']);

function rectInSpace(el: Element, ox: number, oy: number): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left + ox, y: r.top + oy, w: r.width, h: r.height };
}

/**
 * Measures annotated `[data-element-id][data-note]` targets and occupied page ink/blocks/controls
 * for `screenId` inside an artboard or web-mode iframe document.
 */
export function measureScreenDesignNotes(
  doc: Document | null,
  screenId: string | undefined,
  options: {
    scrollMode?: 'viewport' | 'document';
    fallbackWidth?: number;
    fallbackHeight?: number;
  } = {},
): MeasuredScreenDesignNotes {
  const fallbackW = options.fallbackWidth ?? ARTBOARD_W;
  const fallbackH = options.fallbackHeight ?? ARTBOARD_H;
  if (!doc || !doc.body) {
    return {
      targets: [],
      occupied: [],
      inkOccupied: [],
      docWidth: fallbackW,
      docHeight: fallbackH,
      scrollLeft: 0,
      scrollTop: 0,
    };
  }

  const win = doc.defaultView ?? (typeof window !== 'undefined' ? window : null);
  const scroller = doc.scrollingElement ?? doc.documentElement;
  const scrollLeft = scroller?.scrollLeft ?? 0;
  const scrollTop = scroller?.scrollTop ?? 0;
  const ox = options.scrollMode === 'document' ? scrollLeft : 0;
  const oy = options.scrollMode === 'document' ? scrollTop : 0;
  const docWidth = (scroller?.clientWidth || win?.innerWidth || 0) > 0
    ? (scroller?.clientWidth || win?.innerWidth || fallbackW)
    : fallbackW;
  const docHeight =
    options.scrollMode === 'document'
      ? Math.max(fallbackH, scroller?.scrollHeight || 0, scroller?.clientHeight || 0)
      : fallbackH;

  const hasScreens = doc.querySelector('[data-screen-id]') !== null;
  const screenRoot =
    screenId && !screenId.startsWith('__')
      ? doc.querySelector<HTMLElement>(`[data-screen-id="${cssAttrEscape(screenId)}"]`)
      : null;

  if (screenId && !screenId.startsWith('__') && hasScreens && !screenRoot) {
    return { targets: [], occupied: [], inkOccupied: [], docWidth, docHeight, scrollLeft, scrollTop };
  }
  if (screenRoot) {
    if (screenRoot.hidden || screenRoot.style.display === 'none' || screenRoot.style.visibility === 'hidden') {
      return { targets: [], occupied: [], inkOccupied: [], docWidth, docHeight, scrollLeft, scrollTop };
    }
    const multiScreen = doc.querySelectorAll('[data-screen-id]').length > 1;
    if (multiScreen && doc.querySelector('[data-screen-id].is-active') && !screenRoot.classList.contains('is-active')) {
      return { targets: [], occupied: [], inkOccupied: [], docWidth, docHeight, scrollLeft, scrollTop };
    }
  }

  const scopeRoot: ParentNode & Element = screenRoot ?? doc.body;
  const groundColors = new Set<string>();
  if (win) {
    for (const groundEl of [screenRoot, screenRoot?.parentElement, doc.body, doc.documentElement]) {
      if (!groundEl) continue;
      const bg = win.getComputedStyle(groundEl).backgroundColor;
      if (!isTransparentFill(bg)) groundColors.add(bg);
    }
  }

  const isInsideInactiveScreen = (node: Element | null): boolean => {
    if (!screenRoot || !node) return false;
    const enclosing = node.closest('[data-screen-id]');
    return enclosing !== null && enclosing !== screenRoot;
  };

  const occupied: Rect[] = [];
  const inkOccupied: Rect[] = [];
  const solidElementSet = new WeakSet<Element>();

  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (IGNORED_TAGS.has(el.tagName) || el === screenRoot) continue;
    if (isInsideInactiveScreen(el)) continue;
    if (win) {
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) {
        continue;
      }
      const r = rectInSpace(el, ox, oy);
      if (r.w < 2 || r.h < 2) continue;

      const bordered = hasVisibleBorder(cs);
      const isFullBleedWrapper = r.w >= docWidth * 0.92 && r.h >= docHeight * 0.8 && !bordered;
      const bg = cs.backgroundColor;
      const filled =
        (!isFullBleedWrapper && !isTransparentFill(bg) && !groundColors.has(bg)) ||
        cs.backgroundImage !== 'none';
      const control =
        CONTROL_TAGS.has(el.tagName) ||
        (!isFullBleedWrapper &&
          r.w < docWidth * 0.7 &&
          (el.hasAttribute('data-navigate-to') || el.hasAttribute('data-nav-screen')));

      if (control) {
        inkOccupied.push(r);
      }
      if (filled || bordered || control) {
        occupied.push(r);
        solidElementSet.add(el);
      }
    }
  }

  // Measure real text runs via Range.getClientRects() so wide flex rows only mark actual text ink as occupied.
  const walker = doc.createTreeWalker(doc.body, /* NodeFilter.SHOW_TEXT */ 4);
  const range = doc.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const parent = node.parentElement;
    if (!parent || IGNORED_TAGS.has(parent.tagName) || isInsideInactiveScreen(parent)) continue;
    if (win) {
      const cs = win.getComputedStyle(parent);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) {
        continue;
      }
    }
    if (typeof range.getClientRects === 'function') {
      range.selectNodeContents(node);
      const clientRects = Array.from(range.getClientRects());
      for (const cr of clientRects) {
        if (cr.width >= 1 && cr.height >= 1) {
          const tr = { x: cr.left + ox, y: cr.top + oy, w: cr.width, h: cr.height };
          occupied.push(tr);
          inkOccupied.push(tr);
        }
      }
    } else {
      const pr = rectInSpace(parent, ox, oy);
      if (pr.w >= 1 && pr.h >= 1 && pr.w < docWidth * FULL_ROW_WIDTH_RATIO) {
        occupied.push(pr);
        inkOccupied.push(pr);
      }
    }
  }

  const rawTargets = Array.from(scopeRoot.querySelectorAll<HTMLElement>('[data-element-id][data-note]'));
  const targets: DesignNoteTarget[] = [];

  for (const el of rawTargets) {
    if (el === screenRoot) continue;
    const id = el.getAttribute('data-element-id')?.trim();
    const note = el.getAttribute('data-note');
    if (!id || !parsePrototypeNote(note)) continue;
    if (win) {
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) {
        continue;
      }
    }
    const r = rectInSpace(el, ox, oy);
    if (r.w < 2 || r.h < 2) continue;

    const isWideWrapper = r.w >= docWidth * FULL_ROW_WIDTH_RATIO && !solidElementSet.has(el);
    let anchorRect: Rect | undefined;
    if (isWideWrapper) {
      anchorRect = findPrimaryChildAnchor(doc, el, rawTargets, solidElementSet, ox, oy, r);
    }

    targets.push({
      id,
      note: note!,
      rect: r,
      ...(anchorRect ? { anchorRect } : {}),
      ...(isWideWrapper ? { transparentContainer: true } : {}),
    });
  }

  return { targets, occupied, inkOccupied, docWidth, docHeight, scrollLeft, scrollTop };
}

function findPrimaryChildAnchor(
  doc: Document,
  container: HTMLElement,
  annotatedEls: readonly HTMLElement[],
  solidElementSet: WeakSet<Element>,
  ox: number,
  oy: number,
  containerRect: Rect,
): Rect | undefined {
  const nestedAnnotated = annotatedEls.filter((other) => other !== container && container.contains(other));
  const isInsideNestedAnnotated = (el: Element) => nestedAnnotated.some((ann) => ann.contains(el));

  // 1. Prefer compact non-annotated UI groups (tabs, badges, controls) that don't span the full width.
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, .tabs, .steps, button, input, .card, table, p, div'),
  );
  for (const child of candidates) {
    if (isInsideNestedAnnotated(child)) continue;
    const r = rectInSpace(child, ox, oy);
    if (r.w >= 16 && r.h >= 12 && r.w < containerRect.w * 0.78) {
      return r;
    }
  }

  // 2. If block headings/paragraphs sit inside a flex-grow wrapper (CSS box is wide, but text ink is narrow),
  // measure the union of their real text client rects unless wrapped inside a full-width solid card.
  const hasFullWidthSolidCard = Array.from(container.children).some((ch) => {
    const r = rectInSpace(ch, ox, oy);
    return solidElementSet.has(ch) && r.w >= containerRect.w * 0.78;
  });
  if (!hasFullWidthSolidCard) {
    const walker = doc.createTreeWalker(container, /* NodeFilter.SHOW_TEXT */ 4);
    const range = doc.createRange();
    if (typeof range.getClientRects === 'function') {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const parent = node.parentElement;
        if (!parent || IGNORED_TAGS.has(parent.tagName) || isInsideNestedAnnotated(parent)) continue;
        range.selectNodeContents(node);
        for (const cr of Array.from(range.getClientRects())) {
          if (cr.width >= 1 && cr.height >= 1) {
            minX = Math.min(minX, cr.left + ox);
            minY = Math.min(minY, cr.top + oy);
            maxX = Math.max(maxX, cr.left + ox + cr.width);
            maxY = Math.max(maxY, cr.top + oy + cr.height);
          }
        }
      }
      if (minX < maxX && maxX - minX < containerRect.w * 0.78) {
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      }
    }
  }

  // 3. Otherwise, if the wide `<section class="page">` wraps an inner card/grid, aim at that inner child's border.
  const firstInner = Array.from(container.children).find((ch) => !isInsideNestedAnnotated(ch));
  if (firstInner) {
    const r = rectInSpace(firstInner, ox, oy);
    if (r.w >= 16 && r.h >= 12) return r;
  }

  return undefined;
}
