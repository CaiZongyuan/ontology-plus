import {
  parsePrototypeNote,
  readPrototypeNotes,
  type PrototypeCanvasArtboard,
} from '../../../../packages/ontology-core/index.js';
import { ARTBOARD_H, ARTBOARD_LABEL_SPACE, ARTBOARD_W, artboardRect, type Rect } from './camera.js';

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

export const CANVAS_FONT_SIZE = 18;
export const CANVAS_LINE_HEIGHT = 25;
export const WEB_FONT_SIZE = 16;
export const WEB_LINE_HEIGHT = 23;

const PAGE_INSET = 14;
const OBSTACLE_GAP = 8;
const NOTE_GAP = 12;
const PAD_X = 8;
const PAD_Y = 4;
const MIN_VISIBLE_TARGET_PX = 4;

export interface Point {
  x: number;
  y: number;
}

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
   * Tighter obstacle list containing only text runs and interactive controls (excluding large card
   * fills). Used as a secondary pass in web mode when responsive cards span the full pane width.
   */
  inkOccupied?: readonly Rect[];
  /**
   * Additional obstacles in this board's local coordinate space (e.g. neighboring artboards and
   * outer-gutter notes already placed by adjacent screens).
   */
  externalObstacles?: readonly Rect[];
  locale?: 'zh-CN' | 'en-US';
  fontSize?: number;
  lineHeight?: number;
  maxNoteWidth?: number;
  formatText?: (raw: string) => string;
}

export interface MeasuredScreenDesignNotes {
  targets: DesignNoteTarget[];
  occupied: Rect[];
  inkOccupied: Rect[];
  groundColor: string | null;
  docWidth: number;
  docHeight: number;
  scrollLeft: number;
  scrollTop: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hits(a: Rect, b: Rect, pad: number): boolean {
  return (
    a.x < b.x + b.w + pad &&
    a.x + a.w + pad > b.x &&
    a.y < b.y + b.h + pad &&
    a.y + a.h + pad > b.y
  );
}

function intersectRect(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 - x1 < MIN_VISIBLE_TARGET_PX || y2 - y1 < MIN_VISIBLE_TARGET_PX) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function ccw(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsProperlyOrCollinearlyIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = ccw(a, b, c);
  const d2 = ccw(a, b, d);
  const d3 = ccw(c, d, a);
  const d4 = ccw(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  const onSeg = (p: Point, q: Point, r: Point) =>
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y);
  if (d1 === 0 && onSeg(a, b, c)) return true;
  if (d2 === 0 && onSeg(a, b, d)) return true;
  if (d3 === 0 && onSeg(c, d, a)) return true;
  if (d4 === 0 && onSeg(c, d, b)) return true;
  return false;
}

/** True when line segment `p1 -> p2` enters or crosses `rect` (expanded by `pad`). */
export function segmentIntersectsRect(p1: Point, p2: Point, rect: Rect, pad = 0): boolean {
  const left = rect.x - pad;
  const right = rect.x + rect.w + pad;
  const top = rect.y - pad;
  const bottom = rect.y + rect.h + pad;
  if (
    (p1.x >= left && p1.x <= right && p1.y >= top && p1.y <= bottom) ||
    (p2.x >= left && p2.x <= right && p2.y >= top && p2.y <= bottom)
  ) {
    return true;
  }
  const tl = { x: left, y: top };
  const tr = { x: right, y: top };
  const br = { x: right, y: bottom };
  const bl = { x: left, y: bottom };
  return (
    segmentsProperlyOrCollinearlyIntersect(p1, p2, tl, tr) ||
    segmentsProperlyOrCollinearlyIntersect(p1, p2, tr, br) ||
    segmentsProperlyOrCollinearlyIntersect(p1, p2, br, bl) ||
    segmentsProperlyOrCollinearlyIntersect(p1, p2, bl, tl)
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

function nearestPointOnRect(r: Rect, p: Point): Point {
  return {
    x: Math.max(r.x, Math.min(p.x, r.x + r.w)),
    y: Math.max(r.y, Math.min(p.y, r.y + r.h)),
  };
}

function arrowEndpoints(box: Rect, target: Rect): { start: Point; end: Point; dx: number; dy: number; len: number } {
  const bc = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const tc = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  const rawEnd = nearestPointOnRect(target, bc);
  const aimPoint = rawEnd.x === bc.x && rawEnd.y === bc.y ? tc : rawEnd;
  const paddedBox: Rect = { x: box.x - 4, y: box.y - 3, w: box.w + 8, h: box.h + 6 };
  const start = nearestPointOnRect(paddedBox, aimPoint);

  let end0 = rawEnd;
  let dx = end0.x - start.x;
  let dy = end0.y - start.y;
  let len = Math.hypot(dx, dy);
  if (len < 2) {
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
  return { start, end, dx, dy, len };
}

function buildCurvedArrow(
  box: Rect,
  target: Rect,
  index: number,
): { arrowPath: string; arrowHead: string; start: Point; mid: Point; end: Point } {
  const { start, end, dx, dy, len } = arrowEndpoints(box, target);
  const bendSign = index % 2 === 0 ? -1 : 1;
  const bend = bendSign * Math.min(36, len * 0.24);
  const cx = (start.x + end.x) / 2 - (dy / len) * bend;
  const cy = (start.y + end.y) / 2 + (dx / len) * bend;
  const mid = {
    x: 0.25 * start.x + 0.5 * cx + 0.25 * end.x,
    y: 0.25 * start.y + 0.5 * cy + 0.25 * end.y,
  };

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
    start,
    mid,
    end,
  };
}

interface PlacedChord {
  box: Rect;
  start: Point;
  mid: Point;
  end: Point;
}

export function noteTitleSeparator(locale: 'zh-CN' | 'en-US' | undefined): string {
  return locale === 'en-US' ? ': ' : '：';
}

/**
 * Deterministically places handwritten Prototype Notes in blank space near each target element,
 * avoiding `occupied` ink/blocks/controls, previously placed notes, and arrow-box crossings,
 * falling back to the outer artboard gutter on the canvas (`allowOutside: true`) or inner page
 * edge in web mode (`false`).
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
  const sep = noteTitleSeparator(options.locale);
  const externalObstacles = options.externalObstacles ?? [];
  const viewportBox: Rect = { x: 0, y: 0, w: width, h: height };

  const parsedTargets = targets.flatMap((t) => {
    const parsed = parsePrototypeNote(t.note);
    if (!parsed) return [];
    const visibleRect = allowOutside ? intersectRect(t.rect, viewportBox) : t.rect;
    if (!visibleRect || visibleRect.w < 2 || visibleRect.h < 2) return [];
    const visibleAnchor = t.anchorRect
      ? (allowOutside ? intersectRect(t.anchorRect, viewportBox) ?? visibleRect : t.anchorRect)
      : visibleRect;
    const title = parsed.title ? (format ? format(parsed.title) : parsed.title).trim() : undefined;
    const body = (format ? format(parsed.body) : parsed.body).trim();
    if (!body) return [];
    const text = title ? `${title}${sep}${body}` : body;
    return [
      {
        target: {
          ...t,
          rect: visibleRect,
          anchorRect: visibleAnchor,
        },
        ...(title ? { title } : {}),
        body,
        text,
      },
    ];
  });

  const targetGuards: Rect[] = parsedTargets.map(({ target }) =>
    target.transparentContainer ? (target.anchorRect ?? target.rect) : target.rect,
  );

  const placed: PlacedDesignNote[] = [];
  const chords: PlacedChord[] = [];
  const gutters = { left: 16, right: 16 };

  const crossesPlaced = (cand: Rect, anchor: Rect, selfIdx: number): boolean => {
    const { start, mid, end } = buildCurvedArrow(cand, anchor, selfIdx);
    return chords.some(
      (prev) =>
        segmentIntersectsRect(start, mid, prev.box, 4) ||
        segmentIntersectsRect(mid, end, prev.box, 4) ||
        segmentIntersectsRect(start, end, prev.box, 4) ||
        segmentIntersectsRect(prev.start, prev.mid, cand, 4) ||
        segmentIntersectsRect(prev.mid, prev.end, cand, 4) ||
        segmentIntersectsRect(prev.start, prev.end, cand, 4),
    );
  };

  const scoreCandidate = (
    cand: Rect,
    anchor: Rect,
    selfIdx: number,
    orderIdx: number,
    vertical: boolean,
  ): number => {
    const { start, end } = arrowEndpoints(cand, anchor);
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const verticalBias = vertical ? 28 : 0;
    const arrowCrossPenalty = crossesPlaced(cand, anchor, selfIdx) ? 10_000 : 0;
    const otherTargetPenalty = targetGuards.some(
      (g, gi) => gi !== selfIdx && segmentIntersectsRect(start, end, g, 2),
    )
      ? 500
      : 0;
    return dist + verticalBias + arrowCrossPenalty + otherTargetPenalty + orderIdx * 0.001;
  };

  parsedTargets.forEach(({ target, title, body, text }, idx) => {
    const anchor = target.anchorRect ?? target.rect;
    const selfGuard = targetGuards[idx]!;
    const { w, h } = estimateNoteBoxSize(text, maxNoteWidth, fontSize, lineHeight);

    const preferLeftFirst = anchor.x + anchor.w / 2 > width * 0.58;
    const sides = preferLeftFirst ? (['left', 'right'] as const) : (['right', 'left'] as const);
    const candidates: Array<{ rect: Rect; vertical: boolean }> = [];
    const maxCandX = Math.max(PAGE_INSET, width - PAGE_INSET - w);
    const maxCandY = Math.max(PAGE_INSET, height - PAGE_INSET - h);

    for (const d of [14, 38, 76, 128, 196, 280]) {
      for (const dy of [0, -32, 32, -68, 68, -112, 112]) {
        const y = clamp(Math.round(anchor.y + anchor.h / 2 - h / 2 + dy), PAGE_INSET, maxCandY);
        for (const side of sides) {
          const x = side === 'right' ? anchor.x + anchor.w + d : anchor.x - d - w;
          candidates.push({ rect: { x, y, w, h }, vertical: false });
        }
      }
      for (const dx of [0, 64, -64, 148, -148, 248, -248]) {
        const cx = clamp(Math.round(anchor.x + anchor.w / 2 - w / 2 + dx), PAGE_INSET, maxCandX);
        candidates.push({ rect: { x: cx, y: anchor.y + anchor.h + Math.round(d * 0.75), w, h }, vertical: true });
        candidates.push({ rect: { x: cx, y: anchor.y - Math.round(d * 0.75) - h, w, h }, vertical: true });
      }
    }

    const inBoundsAndFree = (cand: Rect) =>
      cand.x >= PAGE_INSET &&
      cand.y >= PAGE_INSET &&
      cand.x + cand.w <= width - PAGE_INSET &&
      cand.y + cand.h <= height - PAGE_INSET &&
      !chords.some((prev) => hits(cand, prev.box, NOTE_GAP)) &&
      !externalObstacles.some((ext) => hits(cand, ext, NOTE_GAP));

    const pickBest = (filterFn: (cand: Rect) => boolean): Rect | undefined => {
      let best: Rect | undefined;
      let bestScore = Infinity;
      candidates.forEach(({ rect: cand, vertical }, orderIdx) => {
        if (!filterFn(cand)) return;
        const sc = scoreCandidate(cand, anchor, idx, orderIdx, vertical);
        if (sc < bestScore) {
          bestScore = sc;
          best = cand;
        }
      });
      return best;
    };

    let box = pickBest(
      (cand) =>
        inBoundsAndFree(cand) &&
        !hits(cand, selfGuard, OBSTACLE_GAP) &&
        !targetGuards.some((g) => hits(cand, g, OBSTACLE_GAP)) &&
        !occupied.some((obs) => hits(cand, obs, OBSTACLE_GAP)),
    );

    // In Web mode (no outer gutter), if responsive cards span the width, allow whitespace inside a card
    // as long as the note avoids every text run, interactive control, and previously placed note.
    if (!box && !allowOutside && options.inkOccupied) {
      const ink = options.inkOccupied;
      box = pickBest(
        (cand) =>
          inBoundsAndFree(cand) &&
          !hits(cand, selfGuard, OBSTACLE_GAP) &&
          !ink.some((obs) => hits(cand, obs, OBSTACLE_GAP)),
      );
    }

    let outside = false;
    if (!box) {
      outside = true;
      const preferredSide: 'left' | 'right' = anchor.x + anchor.w / 2 > width / 2 ? 'right' : 'left';
      const oppositeSide: 'left' | 'right' = preferredSide === 'right' ? 'left' : 'right';

      if (allowOutside) {
        const outSize = estimateNoteBoxSize(text, OUTSIDE_MAX_NOTE_W, fontSize, lineHeight);
        const maxY = Math.max(0, height - outSize.h);
        const minInsetY = Math.min(8, maxY);
        const maxInsetY = Math.max(minInsetY, height - outSize.h - 8);
        const idealY = clamp(Math.round(anchor.y + anchor.h / 2 - outSize.h / 2), minInsetY, maxInsetY);

        const tryGutterSide = (side: 'left' | 'right'): Rect | undefined => {
          const x = side === 'right' ? width + OUTSIDE_GUTTER_GAP : -OUTSIDE_GUTTER_GAP - outSize.w;
          const startY = clamp(Math.max(idealY, gutters[side]), minInsetY, maxInsetY);
          const yTries: number[] = [startY, idealY];
          for (let step = 20; step <= height; step += 20) {
            if (idealY + step <= maxY) yTries.push(idealY + step);
            if (idealY - step >= 0) yTries.push(idealY - step);
          }
          for (const cy of yTries) {
            const cand: Rect = { x, y: clamp(cy, 0, maxY), w: outSize.w, h: outSize.h };
            if (
              !chords.some((prev) => hits(cand, prev.box, NOTE_GAP)) &&
              !externalObstacles.some((ext) => hits(cand, ext, NOTE_GAP))
            ) {
              gutters[side] = Math.min(maxY, cand.y + outSize.h + 16);
              return cand;
            }
          }
          return undefined;
        };

        box = tryGutterSide(preferredSide) ?? tryGutterSide(oppositeSide);
        if (!box) {
          const fallbackX =
            preferredSide === 'right' ? width + OUTSIDE_GUTTER_GAP : -OUTSIDE_GUTTER_GAP - outSize.w;
          const fallbackY = clamp(gutters[preferredSide], 0, maxY);
          gutters[preferredSide] = clamp(fallbackY + outSize.h + 16, 0, maxY);
          box = { x: fallbackX, y: fallbackY, w: outSize.w, h: outSize.h };
        }
      } else {
        const edgeMaxW = Math.min(maxNoteWidth, Math.max(140, Math.floor(width * 0.34)));
        const edgeSize = estimateNoteBoxSize(text, edgeMaxW, fontSize, lineHeight);
        const xRight = Math.max(WEB_EDGE_INSET, width - edgeSize.w - WEB_EDGE_INSET);
        const xLeft = WEB_EDGE_INSET;
        const ink = options.inkOccupied ?? occupied;
        const preferredX = preferredSide === 'right' ? [xRight, xLeft] : [xLeft, xRight];

        let bestEdge: Rect | undefined;
        let bestEdgeScore = Infinity;
        preferredX.forEach((cx, sideIdx) => {
          for (const dy of [0, -44, 44, -88, 88, -136, 136, -184, 184]) {
            const cy = Math.max(PAGE_INSET, Math.round(anchor.y + anchor.h / 2 - edgeSize.h / 2 + dy));
            const cand = { x: cx, y: cy, w: edgeSize.w, h: edgeSize.h };
            if (
              cy + edgeSize.h <= height - PAGE_INSET &&
              !chords.some((prev) => hits(cand, prev.box, NOTE_GAP)) &&
              !ink.some((obs) => hits(cand, obs, 6))
            ) {
              const sc = scoreCandidate(cand, anchor, idx, sideIdx * 20, false) + sideIdx * 120;
              if (sc < bestEdgeScore) {
                bestEdgeScore = sc;
                bestEdge = cand;
              }
            }
          }
        });

        if (bestEdge) {
          box = bestEdge;
        } else {
          const x = preferredSide === 'right' ? xRight : xLeft;
          let y = Math.max(
            PAGE_INSET,
            Math.round(anchor.y + anchor.h / 2 - edgeSize.h / 2),
            gutters[preferredSide],
          );
          while (chords.some((prev) => hits({ x, y, w: edgeSize.w, h: edgeSize.h }, prev.box, NOTE_GAP))) {
            y += 18;
          }
          gutters[preferredSide] = y + edgeSize.h + 14;
          box = { x, y, w: edgeSize.w, h: edgeSize.h };
        }
      }
    }

    const { arrowPath, arrowHead, start, mid, end } = buildCurvedArrow(box, anchor, idx);
    chords.push({ box, start, mid, end });
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

export interface CanvasArtboardNotesInput {
  screenId: string;
  slotIndex: number;
  targets: readonly DesignNoteTarget[];
  occupied: readonly Rect[];
}

/**
 * Places Design Notes across all canvas artboards with a shared world-space obstacle set so
 * adjacent columns sharing a `200px` corridor never collide with each other or neighbor boards.
 */
export function placeCanvasArtboardsDesignNotes(
  inputs: readonly CanvasArtboardNotesInput[],
  options: {
    allSlotIndices?: readonly number[];
    locale?: 'zh-CN' | 'en-US';
    formatText?: (raw: string) => string;
  } = {},
): Map<string, PlacedDesignNote[]> {
  const slotSet = new Set<number>(options.allSlotIndices ?? inputs.map((i) => i.slotIndex));
  for (const inp of inputs) slotSet.add(inp.slotIndex);

  const worldBoards = Array.from(slotSet).map((slot) => ({ slot, rect: artboardRect(slot) }));
  const worldPlacedNotes: Rect[] = [];
  const result = new Map<string, PlacedDesignNote[]>();

  for (const inp of inputs) {
    const ownWorld = artboardRect(inp.slotIndex);
    const externalObstacles: Rect[] = [];
    for (const wb of worldBoards) {
      if (wb.slot === inp.slotIndex) continue;
      externalObstacles.push({
        x: wb.rect.x - ownWorld.x,
        y: wb.rect.y - ownWorld.y,
        w: wb.rect.w,
        h: wb.rect.h,
      });
    }
    for (const wn of worldPlacedNotes) {
      externalObstacles.push({
        x: wn.x - ownWorld.x,
        y: wn.y - ownWorld.y,
        w: wn.w,
        h: wn.h,
      });
    }

    const placed =
      inp.targets.length > 0
        ? placeDesignNotes(inp.targets, inp.occupied, {
            width: ARTBOARD_W,
            height: ARTBOARD_H,
            allowOutside: true,
            externalObstacles,
            ...(options.locale ? { locale: options.locale } : {}),
            ...(options.formatText ? { formatText: options.formatText } : {}),
          })
        : [];
    for (const p of placed) {
      worldPlacedNotes.push({
        x: ownWorld.x + p.box.x,
        y: ownWorld.y + p.box.y,
        w: p.box.w,
        h: p.box.h,
      });
    }
    result.set(inp.screenId, placed);
  }

  return result;
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

export function measureAndPlaceCanvasScreenNotes(
  doc: Document | null,
  screenId: string,
  options: {
    externalObstacles?: readonly Rect[];
    locale?: 'zh-CN' | 'en-US';
    formatText?: (raw: string) => string;
  } = {},
): { placed: PlacedDesignNote[]; groundColor: string | null } {
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
          ...(options.externalObstacles ? { externalObstacles: options.externalObstacles } : {}),
          ...(options.locale ? { locale: options.locale } : {}),
          ...(options.formatText ? { formatText: options.formatText } : {}),
        })
      : [];
  return { placed, groundColor: measured.groundColor };
}

export function measureDesignNotesFrameBounds(
  doc: Document | null,
  screenId: string,
  boardWorldRect: Rect,
): Rect {
  const { placed } = measureAndPlaceCanvasScreenNotes(doc, screenId);
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
const INTERACTIVE_ROLES = new Set(['button', 'tab', 'switch', 'menuitem', 'checkbox', 'radio']);

function isInteractiveElement(el: Element, isFullBleedWrapper: boolean, docWidth: number, w: number): boolean {
  if (CONTROL_TAGS.has(el.tagName)) return true;
  if (el.tagName === 'A' && el.hasAttribute('href')) return true;
  const role = (el.getAttribute('role') ?? '').trim().toLowerCase();
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  return (
    !isFullBleedWrapper &&
    w < docWidth * 0.7 &&
    (el.hasAttribute('data-navigate-to') || el.hasAttribute('data-nav-screen'))
  );
}

function rectInSpace(el: Element, ox: number, oy: number): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left + ox, y: r.top + oy, w: r.width, h: r.height };
}

function collectTextRunRects(
  doc: Document,
  root: Node,
  win: Window | null,
  ox: number,
  oy: number,
  docWidth: number,
  allowParent: (parent: HTMLElement) => boolean,
): Rect[] {
  const out: Rect[] = [];
  const walker = doc.createTreeWalker(root, /* NodeFilter.SHOW_TEXT */ 4);
  const range = doc.createRange();
  const hasRangeRects = typeof range.getClientRects === 'function';

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const parent = node.parentElement;
    if (!parent || IGNORED_TAGS.has(parent.tagName) || !allowParent(parent)) continue;
    if (win) {
      const cs = win.getComputedStyle(parent);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) {
        continue;
      }
    }
    if (hasRangeRects) {
      range.selectNodeContents(node);
      for (const cr of Array.from(range.getClientRects())) {
        if (cr.width >= 1 && cr.height >= 1) {
          out.push({ x: cr.left + ox, y: cr.top + oy, w: cr.width, h: cr.height });
        }
      }
    } else {
      const pr = rectInSpace(parent, ox, oy);
      if (pr.w >= 1 && pr.h >= 1 && pr.w < docWidth * FULL_ROW_WIDTH_RATIO) {
        out.push(pr);
      }
    }
  }
  return out;
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
      groundColor: null,
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
  const isViewportMode = options.scrollMode !== 'document';
  const ox = isViewportMode ? 0 : scrollLeft;
  const oy = isViewportMode ? 0 : scrollTop;
  const docWidth = isViewportMode
    ? fallbackW
    : (scroller?.clientWidth || 0) > 0
      ? scroller!.clientWidth
      : fallbackW;
  const docHeight = isViewportMode
    ? fallbackH
    : Math.max(fallbackH, scroller?.scrollHeight || 0, scroller?.clientHeight || 0);
  const viewportClip: Rect = { x: 0, y: 0, w: docWidth, h: docHeight };

  const hasScreens = doc.querySelector('[data-screen-id]') !== null;
  const screenRoot =
    screenId && !screenId.startsWith('__')
      ? doc.querySelector<HTMLElement>(`[data-screen-id="${cssAttrEscape(screenId)}"]`)
      : null;

  if (screenId && !screenId.startsWith('__') && hasScreens && !screenRoot) {
    return { targets: [], occupied: [], inkOccupied: [], groundColor: null, docWidth, docHeight, scrollLeft, scrollTop };
  }
  if (screenRoot) {
    if (screenRoot.hidden || screenRoot.style.display === 'none' || screenRoot.style.visibility === 'hidden') {
      return { targets: [], occupied: [], inkOccupied: [], groundColor: null, docWidth, docHeight, scrollLeft, scrollTop };
    }
    const multiScreen = doc.querySelectorAll('[data-screen-id]').length > 1;
    if (multiScreen && doc.querySelector('[data-screen-id].is-active') && !screenRoot.classList.contains('is-active')) {
      return { targets: [], occupied: [], inkOccupied: [], groundColor: null, docWidth, docHeight, scrollLeft, scrollTop };
    }
  }

  // Stop at the nearest opaque ancestor so an inner white card over a tinted screenRoot is detected as filled.
  let groundColor: string | null = null;
  if (win) {
    for (const groundEl of [screenRoot, screenRoot?.parentElement, doc.body, doc.documentElement]) {
      if (!groundEl) continue;
      const bg = win.getComputedStyle(groundEl).backgroundColor;
      if (!isTransparentFill(bg)) {
        groundColor = bg;
        break;
      }
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
      const rawRect = rectInSpace(el, ox, oy);
      if (rawRect.w < 2 || rawRect.h < 2) continue;
      const r = isViewportMode ? intersectRect(rawRect, viewportClip) : rawRect;
      if (!r) continue;

      const bordered = hasVisibleBorder(cs);
      const isFullBleedWrapper = rawRect.w >= docWidth * 0.92 && rawRect.h >= docHeight * 0.8 && !bordered;
      const bg = cs.backgroundColor;
      const filled =
        (!isFullBleedWrapper && !isTransparentFill(bg) && bg !== groundColor) ||
        cs.backgroundImage !== 'none';
      const shadowed = Boolean(!isFullBleedWrapper && cs.boxShadow && cs.boxShadow !== 'none');
      const control = isInteractiveElement(el, isFullBleedWrapper, docWidth, rawRect.w);

      if (control) {
        inkOccupied.push(r);
      }
      if (filled || bordered || shadowed || control) {
        occupied.push(r);
        solidElementSet.add(el);
      }
    }
  }

  const textRects = collectTextRunRects(
    doc,
    doc.body,
    win,
    ox,
    oy,
    docWidth,
    (parent) => !isInsideInactiveScreen(parent),
  );
  for (const tr of textRects) {
    const clipped = isViewportMode ? intersectRect(tr, viewportClip) : tr;
    if (clipped) {
      occupied.push(clipped);
      inkOccupied.push(clipped);
    }
  }

  const scopeRoot: ParentNode & Element = screenRoot ?? doc.body;
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
    const rawRect = rectInSpace(el, ox, oy);
    if (rawRect.w < 2 || rawRect.h < 2) continue;
    const r = isViewportMode ? intersectRect(rawRect, viewportClip) : rawRect;
    if (!r) continue;

    const isWideWrapper = rawRect.w >= docWidth * FULL_ROW_WIDTH_RATIO && !solidElementSet.has(el);
    let anchorRect: Rect | undefined;
    if (isWideWrapper) {
      const rawAnchor = findPrimaryChildAnchor(doc, el, rawTargets, solidElementSet, win, ox, oy, docWidth, rawRect);
      if (rawAnchor) {
        anchorRect = isViewportMode ? intersectRect(rawAnchor, viewportClip) ?? r : rawAnchor;
      }
    }

    targets.push({
      id,
      note: note!,
      rect: r,
      ...(anchorRect ? { anchorRect } : {}),
      ...(isWideWrapper ? { transparentContainer: true } : {}),
    });
  }

  return { targets, occupied, inkOccupied, groundColor, docWidth, docHeight, scrollLeft, scrollTop };
}

function findPrimaryChildAnchor(
  doc: Document,
  container: HTMLElement,
  annotatedEls: readonly HTMLElement[],
  solidElementSet: WeakSet<Element>,
  win: Window | null,
  ox: number,
  oy: number,
  docWidth: number,
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

  // 2. If block headings/paragraphs sit inside a flex-grow wrapper, measure the union of their text runs.
  const hasFullWidthSolidCard = Array.from(container.children).some((ch) => {
    const r = rectInSpace(ch, ox, oy);
    return solidElementSet.has(ch) && r.w >= containerRect.w * 0.78;
  });
  if (!hasFullWidthSolidCard) {
    const ownTextRects = collectTextRunRects(
      doc,
      container,
      win,
      ox,
      oy,
      docWidth,
      (parent) => !isInsideNestedAnnotated(parent),
    );
    if (ownTextRects.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const tr of ownTextRects) {
        minX = Math.min(minX, tr.x);
        minY = Math.min(minY, tr.y);
        maxX = Math.max(maxX, tr.x + tr.w);
        maxY = Math.max(maxY, tr.y + tr.h);
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
