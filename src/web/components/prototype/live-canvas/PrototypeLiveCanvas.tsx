import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Crosshair,
  Loader2,
  Maximize,
  Minus,
  PenLine,
  Plus,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { sanitizeBusinessText } from '../../../../packages/business-vocabulary/index.js';
import {
  buildPrototypeCanvasModel,
  type PrototypeCanvasArtboard,
  type PrototypeLiveState,
  type PrototypeScreenStatus,
} from '../../../../packages/ontology-core/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../beautifui/index.js';
import { ArtboardFrame } from './Artboard.js';
import {
  ARTBOARD_H,
  ARTBOARD_W,
  artboardRect,
  artboardsBounds,
  decideFollow,
  fitRect,
  zoomAt,
  type Camera,
  type FollowState,
  type Rect,
} from './camera.js';

/** How long the follow camera stays on a screen before moving to another one. */
export const FOLLOW_DWELL_MS = 1600;
const CAMERA_TWEEN_MS = 420;

export interface PrototypeLiveCanvasProps {
  /** The saved document (current revision, or the revision being previewed). */
  documentHtml: string;
  /** Per-screen deltas of the running Agent Run, folded over the saved document. */
  live?: PrototypeLiveState | null;
  busy?: boolean;
  reconnecting?: boolean;
  highlightedScreenId?: string | null;
  viewMode?: 'business' | 'technical';
  onRetryScreen?: (screenId: string, screenName: string) => void;
  /** Open one screen in the single-screen view (where box-select and inspection live). */
  onOpenSingleScreen?: (screenId: string) => void;
}

interface Viewport {
  w: number;
  h: number;
}

function statusLabel(status: PrototypeScreenStatus, t: (zh: string, en: string) => string): string {
  if (status === 'streaming') return t('正在画', 'Drawing');
  if (status === 'queued') return t('排队中', 'Queued');
  return t('已画好', 'Drawn');
}

function StatusIcon({ status }: { status: PrototypeScreenStatus }) {
  if (status === 'streaming') return <PenLine size={12} className="text-primary" aria-hidden="true" />;
  if (status === 'queued') return <Loader2 size={12} className="text-muted-foreground" aria-hidden="true" />;
  return <CheckCircle2 size={12} className="text-success" aria-hidden="true" />;
}

/**
 * The prototype canvas (spec #87, layout D of #88): a phase bar on top, one pan/zoom canvas
 * with a follow camera in the middle, the build log on the right, and the screen strip at the
 * bottom. The same instance serves the running build and the saved prototype.
 */
export function PrototypeLiveCanvas({
  documentHtml,
  live,
  busy = false,
  reconnecting = false,
  highlightedScreenId = null,
  viewMode = 'business',
  onRetryScreen,
  onOpenSingleScreen,
}: PrototypeLiveCanvasProps) {
  const { locale, t } = usePreferences();
  const isBusiness = viewMode === 'business';
  const model = useMemo(() => buildPrototypeCanvasModel(documentHtml, live), [documentHtml, live]);
  const linksKey = model.links.join('\n');
  const screens = model.screens;
  const indexById = useMemo(
    () => new Map(screens.map((s, i) => [s.screenId, i] as const)),
    [screens],
  );

  const cleanName = useCallback(
    (board: PrototypeCanvasArtboard, idx: number) => {
      const raw = board.screenName || board.screenId;
      const cleaned = isBusiness
        ? sanitizeBusinessText(raw, locale === 'en-US' ? 'en-US' : 'zh-CN').trim()
        : raw;
      return cleaned || t(`第 ${idx + 1} 屏`, `Screen ${idx + 1}`);
    },
    [isBusiness, locale, t],
  );

  // ─── Camera ────────────────────────────────────────────────────────────────
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ w: 0, h: 0 });
  const [cam, setCam] = useState<Camera>({ x: 24, y: 24, k: 0.2 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const tween = useRef<number | null>(null);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(following);
  followingRef.current = following;
  const userMoved = useRef(false);
  const followState = useRef<FollowState>({ since: 0 });
  const [followTick, setFollowTick] = useState(0);
  const [followedScreenId, setFollowedScreenId] = useState<string | undefined>(undefined);
  const [tryScreenId, setTryScreenId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setViewport({ w: host.clientWidth, h: host.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const stopTween = () => {
    if (tween.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(tween.current);
    }
    tween.current = null;
  };

  const moveCamera = useCallback((target: Camera, animate = true) => {
    stopTween();
    if (!animate || typeof requestAnimationFrame !== 'function') {
      setCam(target);
      return;
    }
    const from = camRef.current;
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - started) / CAMERA_TWEEN_MS);
      const e = 1 - Math.pow(1 - p, 3);
      setCam({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        k: from.k + (target.k - from.k) * e,
      });
      tween.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    tween.current = requestAnimationFrame(step);
  }, []);

  const frameRect = useCallback(
    (rect: Rect, maxK = 1) => {
      if (viewport.w === 0 || viewport.h === 0) return;
      moveCamera(fitRect(rect, viewport, { padding: 48, maxK }));
    },
    [moveCamera, viewport],
  );

  const fitAll = useCallback(() => {
    frameRect(artboardsBounds(screens.length), 1);
  }, [frameRect, screens.length]);

  const frameScreen = useCallback(
    (screenId: string) => {
      const idx = indexById.get(screenId);
      if (idx === undefined) return;
      const rect = artboardRect(idx);
      frameRect({ x: rect.x, y: rect.y - 60, w: rect.w, h: rect.h + 60 }, 1);
    },
    [frameRect, indexById],
  );

  /** Any manual camera move stops following. */
  const takeManualControl = useCallback(() => {
    stopTween();
    userMoved.current = true;
    if (followingRef.current) setFollowing(false);
  }, []);

  // Before anyone moves the camera, keep every artboard in view.
  useEffect(() => {
    if (userMoved.current || followState.current.target) return;
    if (screens.length > 0) fitAll();
  }, [fitAll, screens.length]);

  // Follow: aim at the screen the latest real event touched, with a dwell.
  const focusScreenId = live?.focusScreenId;
  useEffect(() => {
    if (!following || tryScreenId) return;
    const now = Date.now();
    const decision = decideFollow(followState.current, focusScreenId, now, FOLLOW_DWELL_MS);
    followState.current = { ...(decision.target ? { target: decision.target } : {}), since: decision.since };
    if (decision.changed && decision.target) {
      setFollowedScreenId(decision.target);
      frameScreen(decision.target);
    }
    if (decision.retryInMs !== undefined) {
      const timer = setTimeout(() => setFollowTick((n) => n + 1), decision.retryInMs + 10);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [focusScreenId, following, frameScreen, followTick, tryScreenId]);

  const resumeFollowing = () => {
    setTryScreenId(null);
    followState.current = { since: 0 };
    setFollowedScreenId(undefined);
    userMoved.current = false;
    setFollowing(true);
    if (!focusScreenId) fitAll();
  };

  // Wheel: pan, or zoom around the cursor with Ctrl/⌘.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      takeManualControl();
      const c = camRef.current;
      if (event.ctrlKey || event.metaKey) {
        const r = host.getBoundingClientRect();
        setCam(zoomAt(c, Math.exp(-event.deltaY * 0.01), { x: event.clientX - r.left, y: event.clientY - r.top }));
      } else {
        setCam({ ...c, x: c.x - event.deltaX, y: c.y - event.deltaY });
      }
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [takeManualControl]);

  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);

  const zoomBy = (factor: number) => {
    takeManualControl();
    moveCamera(zoomAt(camRef.current, factor, { x: viewport.w / 2, y: viewport.h / 2 }));
  };

  // ─── Try-out ───────────────────────────────────────────────────────────────
  const tryRef = useRef(tryScreenId);
  tryRef.current = tryScreenId;
  const enterTry = useCallback(
    (screenId: string) => {
      takeManualControl();
      setTryScreenId(screenId);
      frameScreen(screenId);
    },
    [frameScreen, takeManualControl],
  );
  const enterTryRef = useRef(enterTry);
  enterTryRef.current = enterTry;
  const exitTry = useCallback(() => setTryScreenId(null), []);
  const navigateFromPrototype = useCallback((screenId: string) => {
    if (tryRef.current) enterTryRef.current(screenId);
  }, []);

  useEffect(() => {
    if (!tryScreenId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTryScreenId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tryScreenId]);

  useEffect(() => stopTween, []);

  // ─── Render ────────────────────────────────────────────────────────────────
  const counts = {
    total: screens.length,
    drawn: screens.filter((s) => s.status === 'ready').length,
    drawing: screens.filter((s) => s.status === 'streaming').length,
  };
  const followTarget = following ? followedScreenId : undefined;

  return (
    <div
      className="grid h-full min-h-[560px] flex-1 grid-rows-[auto_minmax(0,1fr)_auto] bg-canvas"
      data-testid="prototype-live-canvas"
    >
      {/* Phase bar: the build plan's phases arrive with #90; for now it reports real counts. */}
      <div
        className="flex min-h-9 flex-wrap items-center gap-3 border-b border-border bg-card px-3 py-1.5 text-[12px]"
        data-testid="prototype-phase-bar"
      >
        <div className="flex min-w-0 items-center gap-2" data-slot="build-phases" />
        <span className="text-muted-foreground" data-testid="prototype-build-counts">
          {counts.total === 0
            ? busy
              ? t('正在准备画布…', 'Preparing the canvas…')
              : t('还没有屏幕', 'No screens yet')
            : t(
                `共 ${counts.total} 屏 · 已画好 ${counts.drawn} 屏${counts.drawing > 0 ? ` · ${counts.drawing} 屏正在画` : ''}`,
                `${counts.total} screens · ${counts.drawn} drawn${counts.drawing > 0 ? ` · ${counts.drawing} drawing` : ''}`,
              )}
        </span>
        {reconnecting && (
          <span className="inline-flex items-center gap-1 text-warning">
            <WifiOff size={12} aria-hidden="true" />
            {t('连接波动，正在接回进度…', 'Reconnecting…')}
          </span>
        )}
      </div>

      <div className="grid min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px]">
        {/* Canvas */}
        <div
          ref={hostRef}
          className={cn(
            'relative min-h-[420px] overflow-hidden touch-none select-none',
            drag.current ? 'cursor-grabbing' : 'cursor-grab',
          )}
          data-testid="prototype-canvas-viewport"
          data-following={following ? 'true' : 'false'}
          data-follow-target={followTarget ?? ''}
          data-trying={tryScreenId ?? ''}
          data-zoom={cam.k.toFixed(3)}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('[data-canvas-ui]')) return;
            drag.current = { x: event.clientX, y: event.clientY, cx: camRef.current.x, cy: camRef.current.y, moved: false };
          }}
          onPointerMove={(event) => {
            const d = drag.current;
            if (!d) return;
            if (!d.moved && Math.abs(event.clientX - d.x) + Math.abs(event.clientY - d.y) > 3) {
              d.moved = true;
              takeManualControl();
              // Capture only once it is a drag, so a double-click still reaches the artboard.
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }
            if (d.moved) setCam((c) => ({ ...c, x: d.cx + event.clientX - d.x, y: d.cy + event.clientY - d.y }));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            data-testid="prototype-canvas-world"
            style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})` }}
          >
            {screens.map((board, idx) => {
              const rect = artboardRect(idx);
              const isTrying = tryScreenId === board.screenId;
              const isHighlighted =
                isTrying || highlightedScreenId === board.screenId || followTarget === board.screenId;
              return (
                <div
                  key={board.screenId}
                  className={cn(
                    'absolute overflow-hidden rounded-md border bg-background shadow-sm',
                    isHighlighted ? 'border-primary ring-4 ring-primary/30' : 'border-border',
                  )}
                  style={{ left: rect.x, top: rect.y, width: ARTBOARD_W, height: ARTBOARD_H }}
                  data-testid={`prototype-artboard-${board.screenId}`}
                  data-screen-status={board.status}
                  title={isTrying ? undefined : t('双击试用这一屏', 'Double-click to try this screen')}
                  onDoubleClick={() => enterTry(board.screenId)}
                >
                  <ArtboardFrame
                    screenId={board.screenId}
                    title={cleanName(board, idx)}
                    bodyHtml={board.bodyHtml}
                    css={model.css}
                    {...(board.css ? { extraCss: board.css } : {})}
                    linksKey={linksKey}
                    interactive={isTrying}
                    onNavigate={navigateFromPrototype}
                    onEscape={exitTry}
                  />
                </div>
              );
            })}
          </div>

          {/* Artboard names, in screen space so they stay readable at any zoom. */}
          {screens.map((board, idx) => {
            const rect = artboardRect(idx);
            return (
              <div
                key={`label-${board.screenId}`}
                className="pointer-events-none absolute flex max-w-[60%] items-center gap-1.5 truncate text-[12px] text-foreground"
                style={{ left: cam.x + rect.x * cam.k, top: cam.y + rect.y * cam.k - 22 }}
                data-testid={`prototype-artboard-label-${board.screenId}`}
              >
                <StatusIcon status={board.status} />
                <span className="truncate font-medium">{cleanName(board, idx)}</span>
                {!isBusiness && <span className="font-mono text-[11px] text-muted-foreground">{board.screenId}</span>}
              </div>
            );
          })}

          {screens.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-muted-foreground">
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  {t('助手正在规划要画哪几屏…', 'The assistant is planning the screens…')}
                </span>
              ) : (
                t('这个原型还没有分屏', 'This prototype has no screens yet')
              )}
            </div>
          )}

          {tryScreenId && (
            <div
              data-canvas-ui
              className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-border bg-card px-3 py-1 text-[12px] text-foreground shadow-sm"
              data-testid="prototype-try-hint"
            >
              {t('试用中：可以直接点击原型 · 按 Esc 退出', 'Trying it out: click inside the prototype · Esc to exit')}
            </div>
          )}

          {/* Dock */}
          <div
            data-canvas-ui
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-card p-1 shadow-md"
            data-testid="prototype-canvas-dock"
          >
            <div className="flex items-center gap-0.5" role="group" aria-label={t('查看方式', 'View')}>
              <Button type="button" variant="toggle" size="xs" aria-pressed="true" data-testid="prototype-dock-view-artboards">
                {t('画板', 'Artboards')}
              </Button>
              <Button
                type="button"
                variant="toggle"
                size="xs"
                aria-pressed="false"
                disabled
                title={t('网页模式即将提供', 'Web view is coming')}
                data-testid="prototype-dock-view-web"
              >
                {t('网页', 'Web')}
              </Button>
            </div>
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={following}
              data-testid="prototype-dock-follow"
              title={t('镜头跟随正在画的屏', 'Follow the screen being drawn')}
              onClick={() => (following ? setFollowing(false) : resumeFollowing())}
            >
              <Crosshair size={12} aria-hidden="true" />
              {t('跟随', 'Follow')}
            </Button>
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
            <Button type="button" variant="ghost" size="xs" aria-label={t('缩小', 'Zoom out')} data-testid="prototype-dock-zoom-out" onClick={() => zoomBy(1 / 1.25)}>
              <Minus size={12} aria-hidden="true" />
            </Button>
            <span className="w-11 text-center font-mono text-[11.5px] text-foreground-soft" data-testid="prototype-dock-zoom-level">
              {Math.round(cam.k * 100)}%
            </span>
            <Button type="button" variant="ghost" size="xs" aria-label={t('放大', 'Zoom in')} data-testid="prototype-dock-zoom-in" onClick={() => zoomBy(1.25)}>
              <Plus size={12} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="prototype-dock-fit-all"
              onClick={() => {
                takeManualControl();
                setTryScreenId(null);
                fitAll();
              }}
            >
              <Maximize size={12} aria-hidden="true" />
              {t('全部', 'All')}
            </Button>
            {/* Cursor and design-notes controls arrive with #92 and #94. */}
            <span data-slot="dock-cursor" />
            <span data-slot="dock-design-notes" />
          </div>
        </div>

        {/* Build log: entries arrive with #90. */}
        <aside
          className="hidden min-h-0 flex-col border-l border-border bg-card md:flex"
          data-testid="prototype-build-log"
          aria-label={t('施工日志', 'Build log')}
        >
          <div className="border-b border-border px-3 py-2 text-[12px] font-medium text-foreground">
            {t('施工日志', 'Build log')}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[12px] text-muted-foreground" data-slot="build-log-entries" />
        </aside>
      </div>

      {/* Screen strip */}
      <div
        className="flex min-h-14 items-stretch gap-2 overflow-x-auto border-t border-border bg-card px-3 py-2"
        data-testid="prototype-screen-strip"
      >
        {screens.map((board, idx) => {
          const name = cleanName(board, idx);
          const canResume = !busy && board.status === 'queued' && Boolean(onRetryScreen);
          return (
            <div
              key={board.screenId}
              className={cn(
                'flex min-w-[150px] shrink-0 flex-col gap-1 rounded-md border px-2.5 py-1.5 text-left text-[12px]',
                tryScreenId === board.screenId || followTarget === board.screenId
                  ? 'border-primary bg-primary-soft'
                  : 'border-border bg-background',
              )}
              data-testid={`prototype-strip-card-${board.screenId}`}
              data-screen-status={board.status}
            >
              <button
                type="button"
                className="flex min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-foreground"
                onClick={() => {
                  takeManualControl();
                  frameScreen(board.screenId);
                }}
              >
                <span className="font-mono text-[11px] text-muted-foreground">{String(idx + 1).padStart(2, '0')}</span>
                <span className="truncate font-medium">{name}</span>
              </button>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <StatusIcon status={board.status} />
                  {statusLabel(board.status, t)}
                </span>
                {canResume && (
                  <Button
                    type="button"
                    variant="accent"
                    size="xs"
                    data-testid={`artboard-retry-btn-${board.screenId}`}
                    onClick={() => onRetryScreen?.(board.screenId, name)}
                  >
                    <RefreshCw size={11} aria-hidden="true" />
                    {t('继续这一屏', 'Continue this screen')}
                  </Button>
                )}
                {!canResume && onOpenSingleScreen && board.status === 'ready' && !busy && (
                  <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-primary"
                    data-testid={`artboard-focus-btn-${board.screenId}`}
                    onClick={() => onOpenSingleScreen(board.screenId)}
                  >
                    {t('单屏查看', 'Single view')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
