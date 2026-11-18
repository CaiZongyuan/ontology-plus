/** Geometry of the prototype canvas: artboard layout, the pan/zoom camera, and follow dwell. */

export const ARTBOARD_W = 1280;
export const ARTBOARD_H = 860;
const GAP_X = 200;
const GAP_Y = 260;
const COLUMNS = 3;
/** World-space room above each artboard for its name label. */
export const ARTBOARD_LABEL_SPACE = 80;

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 2;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Camera {
  x: number;
  y: number;
  k: number;
}

export function artboardRect(index: number): Rect {
  return {
    x: (index % COLUMNS) * (ARTBOARD_W + GAP_X),
    y: Math.floor(index / COLUMNS) * (ARTBOARD_H + GAP_Y),
    w: ARTBOARD_W,
    h: ARTBOARD_H,
  };
}

export function artboardsBounds(count: number): Rect {
  const n = Math.max(1, count);
  const cols = Math.min(COLUMNS, n);
  const rows = Math.ceil(n / COLUMNS);
  return {
    x: 0,
    y: -ARTBOARD_LABEL_SPACE,
    w: cols * ARTBOARD_W + (cols - 1) * GAP_X,
    h: rows * ARTBOARD_H + (rows - 1) * GAP_Y + ARTBOARD_LABEL_SPACE,
  };
}

export function clampZoom(k: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));
}

export function fitRect(
  rect: Rect,
  viewport: { w: number; h: number },
  options: { padding?: number; maxK?: number } = {},
): Camera {
  const pad = options.padding ?? 40;
  const availW = Math.max(1, viewport.w - pad * 2);
  const availH = Math.max(1, viewport.h - pad * 2);
  const k = clampZoom(Math.min(availW / rect.w, availH / rect.h, options.maxK ?? 1));
  return {
    k,
    x: (viewport.w - rect.w * k) / 2 - rect.x * k,
    y: (viewport.h - rect.h * k) / 2 - rect.y * k,
  };
}

/** Zoom by `factor` keeping the screen-space `point` over the same world point. */
export function zoomAt(cam: Camera, factor: number, point: { x: number; y: number }): Camera {
  const k = clampZoom(cam.k * factor);
  return {
    k,
    x: point.x - ((point.x - cam.x) / cam.k) * k,
    y: point.y - ((point.y - cam.y) / cam.k) * k,
  };
}

export interface FollowState {
  target?: string;
  since: number;
}

/**
 * Where the follow camera should aim: the screen the latest real event touched, but never
 * leaving a screen sooner than `dwellMs` after arriving, so parallel lanes do not make it jitter.
 */
export function decideFollow(
  state: FollowState,
  focus: string | undefined,
  now: number,
  dwellMs: number,
): FollowState & { changed: boolean; retryInMs?: number } {
  if (!focus || focus === state.target) return { ...state, changed: false };
  if (!state.target) return { target: focus, since: now, changed: true };
  const waited = now - state.since;
  if (waited < dwellMs) return { ...state, changed: false, retryInMs: dwellMs - waited };
  return { target: focus, since: now, changed: true };
}
