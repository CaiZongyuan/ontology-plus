import React, { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Crosshair, Loader2, Maximize, Minus, Plus, WifiOff } from 'lucide-react';
import { sanitizeBusinessText } from '../../../../packages/business-vocabulary/index.js';
import {
  PROTOTYPE_STYLE_BOARD_ID,
  activePrototypeBuildFixActivities,
  buildPrototypeCanvasModel,
  composePrototypeDocument,
  hasPrototypeBuildPlan,
  type PrototypeBuildState,
  type PrototypeCanvasArtboard,
  type PrototypeLiveState,
} from '../../../../packages/ontology-core/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../beautifui/index.js';
import { AgentCursorDockControl, CanvasAgentCursors, useObservedElementSize } from './AgentCursor.js';
import { ArtboardFrame, type ArtboardHandle } from './Artboard.js';
import { BuildLog, BuildLogLiveRows } from './BuildLog.js';
import { BuildPhaseBar } from './BuildPhaseBar.js';
import { CanvasDesignNotesOverlay, DesignNotesDockControl } from './DesignNotesOverlay.js';
import {
  readAgentCursorPrefs,
  resolveLiveActivities,
  writeAgentCursorPrefs,
  type AgentCursorPrefs,
  type AgentLiveActivity,
} from './agentCursor.js';
import { fixActivityText, screenBuildViews, screenOwnerName } from './buildView.js';
import { ScreenStatusIcon, ScreenStrip, screenStatusLabel } from './ScreenStrip.js';
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
import {
  hasScreenElementNotes,
  measureDesignNotesFrameBounds,
  pickDesignNotesScreenId,
} from './designNotesLayout.js';
import { openCleanPrototypeInNewTab } from '../PrototypeVisualInspector.js';
import { readPrototypeView, writePrototypeView, type PrototypeView } from './prototypeView.js';
import { PrototypeWebView, WebModeHint, type PrototypeWebViewHandle } from './PrototypeWebView.js';

/** How long the follow camera stays on a screen before moving to another one. */
export const FOLLOW_DWELL_MS = 1600;
const CAMERA_TWEEN_MS = 300;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  );
}

export interface PrototypeLiveCanvasProps {
  /** The saved document (current revision, or the revision being previewed). */
  documentHtml: string;
  /** Per-screen deltas of the running Agent Run, folded over the saved document. */
  live?: PrototypeLiveState | null;
  /**
   * The Build Plan to show (#90): the running build's, or the one persisted with the latest
   * build when nothing is running. Without a plan the bar, log and strip fall back to the
   * saved document's screens.
   */
  build?: PrototypeBuildState | null;
  busy?: boolean;
  /** A first build is running: an empty canvas says the assistant is planning the screens. */
  building?: boolean;
  reconnecting?: boolean;
  highlightedScreenId?: string | null;
  viewMode?: 'business' | 'technical';
  onRetryScreen?: (screenId: string, screenName: string) => void;
  /** Open one screen in the single-screen view (where box-select and inspection live). */
  onOpenSingleScreen?: (screenId: string) => void;
  /** Opens the composed document in a new tab (defaults to a blob URL; tests replace it). */
  onOpenStandalone?: (documentHtml: string, screenId: string) => boolean;
  /**
   * Explicit live agent activities (#92, #93 targeted fixes): merged with streaming screen
   * writing activities to drive the cursor, narration bubble, and build log "现在" rows.
   */
  liveActivities?: readonly AgentLiveActivity[];
}

interface Viewport {
  w: number;
  h: number;
}

/**
 * The prototype canvas (spec #87, layout D of #88): a phase bar on top, one pan/zoom canvas
 * with a follow camera in the middle, the build log on the right, and the screen strip at the
 * bottom. The same instance serves the running build and the saved prototype.
 */
export function PrototypeLiveCanvas({
  documentHtml,
  live,
  build = null,
  busy = false,
  building = false,
  reconnecting = false,
  highlightedScreenId = null,
  viewMode = 'business',
  onRetryScreen,
  onOpenSingleScreen,
  onOpenStandalone = openStandalone,
  liveActivities,
}: PrototypeLiveCanvasProps) {
  const { locale, t } = usePreferences();
  const isBusiness = viewMode === 'business';
  const plan = hasPrototypeBuildPlan(build) ? build : null;
  const model = useMemo(() => buildPrototypeCanvasModel(documentHtml, live, plan), [documentHtml, live, plan]);
  const linksKey = model.links.join('\n');
  const headScriptsKey = model.headScripts.join('\n\u0000\n');
  const screens = model.screens;
  // Artboards stay in the DOM in the order they first appeared: moving an iframe in the DOM
  // reloads it, so a reordered model only changes positions (style), never DOM order.
  const mountOrder = useRef<string[]>([]);
  const screenById = new Map(screens.map((s) => [s.screenId, s] as const));
  for (const s of screens) if (!mountOrder.current.includes(s.screenId)) mountOrder.current.push(s.screenId);
  mountOrder.current = mountOrder.current.filter((id) => screenById.has(id));
  const mountedScreens = mountOrder.current.map((id) => screenById.get(id)!);
  // The 「风格样张」 (#91) is the first artboard; the screens follow it.
  const styleBoard = model.style;
  const slotOffset = styleBoard ? 1 : 0;
  const indexById = useMemo(() => {
    const map = new Map(screens.map((s, i) => [s.screenId, i + slotOffset] as const));
    if (slotOffset) map.set(PROTOTYPE_STYLE_BOARD_ID, 0);
    return map;
  }, [screens, slotOffset]);

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

  const views = useMemo(() => screenBuildViews(screens, plan, cleanName), [screens, plan, cleanName]);
  const viewById = new Map(views.map((v) => [v.screenId, v] as const));

  // ─── Agent cursor preferences & artboard frame handles (#92 + #93 fix narration) ───
  const [cursorPrefs, setCursorPrefs] = useState<AgentCursorPrefs>(readAgentCursorPrefs);
  const updateCursorPrefs = useCallback((next: AgentCursorPrefs) => {
    setCursorPrefs(next);
    writeAgentCursorPrefs(next);
  }, []);
  const frameHandles = useRef(new Map<string, MutableRefObject<ArtboardHandle | null>>());
  const handleRefFor = useCallback((screenId: string): MutableRefObject<ArtboardHandle | null> => {
    let entry = frameHandles.current.get(screenId);
    if (!entry) {
      entry = { current: null };
      frameHandles.current.set(screenId, entry);
    }
    return entry;
  }, []);
  const getFrameHandle = useCallback(
    (screenId: string): ArtboardHandle | null => frameHandles.current.get(screenId)?.current ?? null,
    [],
  );
  const [layoutVersion, setLayoutVersion] = useState(0);
  const bumpLayout = useCallback(() => setLayoutVersion((n) => n + 1), []);
  const fixLiveActivities = useMemo<AgentLiveActivity[]>(() => {
    if (!plan) return [];
    return activePrototypeBuildFixActivities(plan)
      .filter((act) => act.state === 'fixing')
      .map((act) => {
        const sentence = fixActivityText(act, locale);
        return {
          agent: 0,
          screenId: act.screenId,
          ...(act.elementId ? { elementId: act.elementId } : {}),
          ...(sentence ? { sentence } : {}),
          state: 'fixing' as const,
        };
      });
  }, [plan, locale]);
  const mergedExternalActivities = useMemo(
    () => [...fixLiveActivities, ...(liveActivities ?? [])],
    [fixLiveActivities, liveActivities],
  );
  const activities = useMemo(
    () =>
      resolveLiveActivities({
        screens,
        views,
        locale: locale === 'en-US' ? 'en-US' : 'zh-CN',
        isBusiness,
        externalActivities: mergedExternalActivities,
      }),
    [screens, views, locale, isBusiness, mergedExternalActivities],
  );

  // ─── Camera ────────────────────────────────────────────────────────────────
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewport: Viewport = useObservedElementSize(hostRef);
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
  const manualFocusScreenRef = useRef<string | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [designNotesOn, setDesignNotesOn] = useState(false);
  const pendingNotesFrame = useRef(false);

  // ─── View: artboards or web page (#97), remembered per device ──────────────
  const [view, setViewState] = useState<PrototypeView>(readPrototypeView);
  const [webHint, setWebHint] = useState(false);
  const webRef = useRef<PrototypeWebViewHandle | null>(null);
  /** The page web mode shows (the screen strip highlights it). */
  const [webScreenId, setWebScreenId] = useState<string | undefined>(undefined);
  /** The page web mode opens on: the screen being tried out, else the one being drawn. */
  const [webStart, setWebStart] = useState<string | undefined>(undefined);
  const setView = (next: PrototypeView) => {
    if (next === 'web') {
      setWebStart(
        tryScreenId ?? manualFocusScreenRef.current ?? followTarget ?? focusScreenId ?? followedScreenId,
      );
    }
    setTryScreenId(null);
    setWebHint(false);
    setViewState(next);
    writePrototypeView(next);
  };
  // A build that finishes with every screen drawn suggests web mode once (in the build log).
  // A run that fails or is cancelled partway does not: it waits until every screen is drawn.
  const sawLiveBuild = useRef(false);
  const allDrawn = screens.length > 0 && screens.every((s) => s.status === 'ready');
  useEffect(() => {
    if (busy) {
      if (live && Object.keys(live.screens).length > 0) sawLiveBuild.current = true;
      return;
    }
    if (sawLiveBuild.current && allDrawn) {
      sawLiveBuild.current = false;
      setWebHint(true);
    }
  }, [allDrawn, busy, live]);

  const stopTween = () => {
    if (tween.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(tween.current);
    }
    tween.current = null;
  };

  const moveCamera = useCallback((target: Camera, animate = true) => {
    stopTween();
    if (!animate || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      setCam(target);
      return;
    }
    const from = camRef.current;
    let started: number | null = null;
    const step = (now: number) => {
      if (started === null) started = now;
      const p = Math.max(0, Math.min(1, (now - started) / CAMERA_TWEEN_MS));
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

  const boardCount = screens.length + slotOffset;
  const fitAll = useCallback(() => {
    frameRect(artboardsBounds(boardCount), 1);
  }, [frameRect, boardCount]);

  const frameScreen = useCallback(
    (screenId: string) => {
      const idx = indexById.get(screenId);
      if (idx === undefined) return;
      const rect = artboardRect(idx);
      frameRect({ x: rect.x, y: rect.y - 60, w: rect.w, h: rect.h + 60 }, 1);
    },
    [frameRect, indexById],
  );

  const frameScreenWithNotes = useCallback(
    (screenId: string) => {
      const idx = indexById.get(screenId);
      if (idx === undefined) return;
      const doc = getFrameHandle(screenId)?.document() ?? null;
      frameRect(measureDesignNotesFrameBounds(doc, screenId, artboardRect(idx)), 1);
    },
    [frameRect, getFrameHandle, indexById],
  );

  /** Any manual camera move stops following. */
  const takeManualControl = useCallback(() => {
    stopTween();
    pendingNotesFrame.current = false;
    userMoved.current = true;
    if (followingRef.current) setFollowing(false);
  }, []);

  /** Bring one screen into view (a strip card or a log line was clicked). */
  const focusScreen = useCallback(
    (screenId: string) => {
      takeManualControl();
      manualFocusScreenRef.current = screenId;
      if (designNotesOn) frameScreenWithNotes(screenId);
      else frameScreen(screenId);
    },
    [designNotesOn, frameScreen, frameScreenWithNotes, takeManualControl],
  );

  // Before anyone moves the camera, keep every artboard in view.
  useEffect(() => {
    if (userMoved.current || followState.current.target) return;
    if (boardCount > 0) fitAll();
  }, [fitAll, boardCount]);

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

  const toggleDesignNotes = useCallback(
    (next: boolean) => {
      setDesignNotesOn(next);
      if (!next) {
        pendingNotesFrame.current = false;
        return;
      }
      if (view === 'artboards') {
        takeManualControl();
        const { screenId, hasNotes } = pickDesignNotesScreenId(screens, {
          tryScreenId,
          preferredIds: [
            manualFocusScreenRef.current,
            highlightedScreenId,
            focusScreenId,
            followedScreenId,
          ],
        });
        if (screenId) {
          frameScreenWithNotes(screenId);
        }
        if (!hasNotes) {
          pendingNotesFrame.current = true;
        }
      }
    },
    [
      focusScreenId,
      followedScreenId,
      frameScreenWithNotes,
      highlightedScreenId,
      screens,
      takeManualControl,
      tryScreenId,
      view,
    ],
  );

  // If Design Notes was turned ON early in a live build before any screen had emitted notes,
  // frame the first screen with notes as soon as it arrives.
  useEffect(() => {
    if (!designNotesOn || view !== 'artboards' || !pendingNotesFrame.current) return;
    const firstWithNotes = screens.find((s) => hasScreenElementNotes(s));
    if (!firstWithNotes) return;
    pendingNotesFrame.current = false;
    frameScreenWithNotes(firstWithNotes.screenId);
  }, [designNotesOn, frameScreenWithNotes, layoutVersion, screens, view]);

  const resumeFollowing = () => {
    setTryScreenId(null);
    manualFocusScreenRef.current = undefined;
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
      if ((event.target as Element | null)?.closest?.('[data-canvas-ui]')) return;
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
      manualFocusScreenRef.current = screenId;
      setTryScreenId(screenId);
      if (designNotesOn) frameScreenWithNotes(screenId);
      else frameScreen(screenId);
    },
    [designNotesOn, frameScreen, frameScreenWithNotes, takeManualControl],
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

  // A strip card or a log line shows its screen: web mode (#97) opens that page, the canvas
  // frames the artboard. Trying a screen opens the page in web mode, try-out on the canvas.
  const showScreen = (screenId: string) => {
    if (view === 'web') webRef.current?.open(screenId);
    else focusScreen(screenId);
  };
  const tryScreen = (screenId: string) => {
    if (view === 'web') webRef.current?.open(screenId);
    else enterTry(screenId);
  };

  // #97's end-of-build suggestion, shown as the last entry of the build log.
  const webModeHint =
    webHint && view === 'artboards' ? (
      <WebModeHint onTry={() => setView('web')} onDismiss={() => setWebHint(false)} />
    ) : null;

  // ─── Render ────────────────────────────────────────────────────────────────
  const counts = {
    total: screens.length,
    drawn: screens.filter((s) => s.status === 'ready').length,
    drawing: screens.filter((s) => s.status === 'streaming').length,
  };
  // The follow ring marks a screen while it is being written, reviewed or fixed.
  const followedBuildStatus = followedScreenId ? viewById.get(followedScreenId)?.status : undefined;
  const followedStatus =
    followedScreenId === PROTOTYPE_STYLE_BOARD_ID
      ? styleBoard?.status
      : screens.find((s) => s.screenId === followedScreenId)?.status;
  const followedActive =
    followedStatus === 'streaming' || followedBuildStatus === 'reviewing' || followedBuildStatus === 'fixing';
  const followTarget = following && followedScreenId && followedActive ? followedScreenId : undefined;

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
        <div className="flex min-w-0 items-center gap-2" data-slot="build-phases">
          {plan && <BuildPhaseBar build={plan} screens={views} />}
        </div>
        {!plan && (
        <span className="text-muted-foreground" data-testid="prototype-build-counts">
          {counts.total === 0
            ? building
              ? t('正在准备画布…', 'Preparing the canvas…')
              : t('还没有屏幕', 'No screens yet')
            : t(
                `共 ${counts.total} 屏 · 已画好 ${counts.drawn} 屏${counts.drawing > 0 ? ` · ${counts.drawing} 屏正在画` : ''}`,
                `${counts.total} screens · ${counts.drawn} drawn${counts.drawing > 0 ? ` · ${counts.drawing} drawing` : ''}`,
              )}
        </span>
        )}
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
            dragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          data-testid="prototype-canvas-viewport"
          data-following={following ? 'true' : 'false'}
          data-follow-target={followTarget ?? ''}
          data-trying={tryScreenId ?? ''}
          data-zoom={cam.k.toFixed(3)}
          data-view={view}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('[data-canvas-ui]')) return;
            drag.current = { x: event.clientX, y: event.clientY, cx: camRef.current.x, cy: camRef.current.y, moved: false };
          }}
          onPointerMove={(event) => {
            const d = drag.current;
            if (!d) return;
            if (!d.moved && Math.abs(event.clientX - d.x) + Math.abs(event.clientY - d.y) > 3) {
              d.moved = true;
              setDragging(true);
              takeManualControl();
              // Capture only once it is a drag, so a double-click still reaches the artboard.
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }
            if (d.moved) setCam((c) => ({ ...c, x: d.cx + event.clientX - d.x, y: d.cy + event.clientY - d.y }));
          }}
          onPointerUp={() => {
            drag.current = null;
            setDragging(false);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
          }}
        >
          {/* Hidden, not unmounted, in web mode: the artboards keep their loaded iframes. */}
          <div
            className="absolute left-0 top-0 origin-top-left"
            data-testid="prototype-canvas-world"
            style={{
              transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`,
              ...(view === 'web' ? { visibility: 'hidden' as const } : {}),
            }}
          >
            {styleBoard && (
              <div
                className={cn(
                  'absolute overflow-hidden rounded-md border bg-background shadow-sm',
                  followTarget === PROTOTYPE_STYLE_BOARD_ID ? 'border-primary ring-4 ring-primary/30' : 'border-border',
                )}
                style={{ left: artboardRect(0).x, top: artboardRect(0).y, width: ARTBOARD_W, height: ARTBOARD_H }}
                data-testid="prototype-style-artboard"
                data-style-status={styleBoard.status}
                data-style-locked={styleBoard.locked ? 'true' : 'false'}
              >
                <ArtboardFrame
                  screenId={PROTOTYPE_STYLE_BOARD_ID}
                  title={t('风格样张', 'Style Tile')}
                  bodyHtml={styleBoard.bodyHtml}
                  css={styleBoard.css}
                  linksKey=""
                  headScriptsKey=""
                  landed={styleBoard.status === 'ready'}
                  interactive={false}
                  paused={view === 'web'}
                  onNavigate={navigateFromPrototype}
                  onEscape={exitTry}
                  testId="prototype-style-frame"
                />
              </div>
            )}
            {mountedScreens.map((board) => {
              const idx = indexById.get(board.screenId) ?? 0;
              const rect = artboardRect(idx);
              const boardView = viewById.get(board.screenId);
              const isReviewing = boardView?.status === 'reviewing';
              const isFixing = boardView?.status === 'fixing';
              const isTrying = tryScreenId === board.screenId;
              const isHighlighted =
                isTrying || highlightedScreenId === board.screenId || followTarget === board.screenId;
              return (
                <div
                  key={board.screenId}
                  className={cn(
                    'absolute overflow-hidden rounded-md border bg-background shadow-sm',
                    isReviewing || isFixing
                      ? 'border-warning ring-4 ring-warning/25'
                      : isHighlighted
                        ? 'border-primary ring-4 ring-primary/30'
                        : 'border-border',
                  )}
                  style={{ left: rect.x, top: rect.y, width: ARTBOARD_W, height: ARTBOARD_H }}
                  data-testid={`prototype-artboard-${board.screenId}`}
                  data-screen-status={board.status}
                  data-review-status={boardView?.status ?? board.status}
                  title={isTrying ? undefined : t('双击试用这一屏', 'Double-click to try this screen')}
                  onDoubleClick={() => enterTry(board.screenId)}
                >
                  <ArtboardFrame
                    screenId={board.screenId}
                    title={cleanName(board, idx - slotOffset)}
                    bodyHtml={board.bodyHtml}
                    css={model.css}
                    {...(board.css ? { extraCss: board.css } : {})}
                    linksKey={linksKey}
                    headScriptsKey={headScriptsKey}
                    landed={board.status === 'ready'}
                    interactive={isTrying}
                    paused={view === 'web'}
                    onNavigate={navigateFromPrototype}
                    onEscape={exitTry}
                    handleRef={handleRefFor(board.screenId)}
                    onLayout={bumpLayout}
                  />
                  {isReviewing && (
                    <div
                      className="onto-artboard-scan"
                      data-testid={`prototype-artboard-scan-${board.screenId}`}
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
            <CanvasDesignNotesOverlay
              enabled={designNotesOn && view === 'artboards'}
              screens={screens}
              indexById={indexById}
              getHandle={getFrameHandle}
              isBusiness={isBusiness}
              locale={locale === 'en-US' ? 'en-US' : 'zh-CN'}
              layoutVersion={layoutVersion}
            />
          </div>

          {/* Artboard names, in screen space so they stay readable at any zoom. */}
          {view === 'artboards' && styleBoard && (
            <div
              className="pointer-events-none absolute flex max-w-[60%] items-center gap-1.5 truncate text-[12px] text-foreground"
              style={{ left: cam.x + artboardRect(0).x * cam.k, top: cam.y + artboardRect(0).y * cam.k - 22 }}
              data-testid="prototype-style-artboard-label"
            >
              <ScreenStatusIcon status={styleBoard.status === 'streaming' ? 'writing' : 'done'} />
              <span className="truncate font-medium">{t('风格样张', 'Style Tile')}</span>
              <span className="truncate text-muted-foreground">
                {styleBoard.status === 'streaming'
                  ? t('正在画 · 主助手', 'Drawing · Lead assistant')
                  : styleBoard.locked
                    ? t('用你确认的设计值', 'Your approved design values')
                    : t('设计值由助手提出', 'Design values proposed by the assistant')}
              </span>
            </div>
          )}
          {view === 'artboards' && screens.map((board, i) => {
            const idx = i + slotOffset;
            const rect = artboardRect(idx);
            const screenView = viewById.get(board.screenId)!;
            const owner = screenOwnerName(screenView, locale);
            return (
              <div
                key={`label-${board.screenId}`}
                className="pointer-events-none absolute flex max-w-[60%] items-center gap-1.5 truncate text-[12px] text-foreground"
                style={{ left: cam.x + rect.x * cam.k, top: cam.y + rect.y * cam.k - 22 }}
                data-testid={`prototype-artboard-label-${board.screenId}`}
                data-build-status={screenView.status}
              >
                <ScreenStatusIcon status={screenView.status} />
                <span className="truncate font-medium">{cleanName(board, i)}</span>
                {plan && (
                  <span className="truncate text-muted-foreground" data-testid={`prototype-artboard-owner-${board.screenId}`}>
                    {screenStatusLabel(screenView.status, t)}
                    {owner ? ` · ${owner}` : ''}
                  </span>
                )}
                {!isBusiness && <span className="font-mono text-[11px] text-muted-foreground">{board.screenId}</span>}
              </div>
            );
          })}

          {view === 'artboards' && (
            <CanvasAgentCursors
              activities={tryScreenId ? activities.filter((a) => a.screenId !== tryScreenId) : activities}
              indexById={indexById}
              getHandle={getFrameHandle}
              cam={cam}
              viewportWidth={viewport.w || hostRef.current?.clientWidth || 0}
              prefs={cursorPrefs}
              layoutVersion={layoutVersion}
            />
          )}

          {view === 'web' && (
            <PrototypeWebView
              ref={webRef}
              screens={screens}
              pageBodyHtml={model.pageBodyHtml}
              pageCss={model.pageCss}
              css={model.css}
              linksKey={linksKey}
              headScriptsKey={headScriptsKey}
              nameOf={cleanName}
              initialScreenId={webStart ?? followTarget ?? focusScreenId ?? followedScreenId}
              followScreenId={following ? followedScreenId : undefined}
              onManualNavigate={takeManualControl}
              onPageChange={setWebScreenId}
              busy={busy}
              {...(onRetryScreen ? { onRetryScreen } : {})}
              composeDocument={() => composePrototypeDocument(documentHtml, live)}
              onOpenStandalone={onOpenStandalone}
              viewsById={viewById}
              liveActivities={activities}
              cursorPrefs={cursorPrefs}
              designNotesOn={designNotesOn}
              isBusiness={isBusiness}
            />
          )}

          {view === 'artboards' && screens.length === 0 && !styleBoard && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-muted-foreground">
              {building ? (
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
              <Button
                type="button"
                variant="toggle"
                size="xs"
                aria-pressed={view === 'artboards'}
                data-testid="prototype-dock-view-artboards"
                title={t('所有屏摆在一块画布上', 'Every screen on one canvas')}
                onClick={() => setView('artboards')}
              >
                {t('画板', 'Artboards')}
              </Button>
              <Button
                type="button"
                variant="toggle"
                size="xs"
                aria-pressed={view === 'web'}
                data-testid="prototype-dock-view-web"
                title={t('按真实宽度像网站一样浏览', 'Browse it like a website, at its real width')}
                onClick={() => setView('web')}
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
            {view === 'artboards' && (
              <>
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
              </>
            )}
            {/* Cursor preferences (#92) and design-notes slot (#94). */}
            <span className="inline-flex items-center gap-1" data-slot="dock-cursor">
              <AgentCursorDockControl prefs={cursorPrefs} onChange={updateCursorPrefs} />
            </span>
            <span className="inline-flex items-center gap-1" data-slot="dock-design-notes">
              <DesignNotesDockControl enabled={designNotesOn} onToggle={toggleDesignNotes} />
            </span>
          </div>
        </div>

        {/* Build log: entries arrive with #90; live "现在" narrations (#92) appear at the bottom. */}
        <aside
          className="hidden min-h-0 flex-col border-l border-border bg-card md:flex"
          data-testid="prototype-build-log"
          aria-label={t('施工日志', 'Build log')}
        >
          <div className="border-b border-border px-3 py-2 text-[12px] font-medium text-foreground">
            {t('施工日志', 'Build log')}
          </div>
          {plan ? (
            <BuildLog
              build={plan}
              screens={views}
              busy={busy}
              onFocusScreen={showScreen}
              onResumeScreen={onRetryScreen}
              liveActivities={activities}
              endEntry={webModeHint}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[12px] text-muted-foreground" data-slot="build-log-entries">
              {activities.some((a) => Boolean(a.sentence)) ? (
                <ol className="m-0 list-none p-0">
                  <BuildLogLiveRows activities={activities} onFocusScreen={showScreen} />
                </ol>
              ) : (
                webModeHint ?? t('生成原型时，这里会逐条记下每一屏的进展。', 'While a prototype is built, each screen’s progress is logged here.')
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Screen strip */}
      <ScreenStrip
        screens={views}
        highlightedScreenId={view === 'web' ? webScreenId : (tryScreenId ?? followTarget)}
        busy={busy}
        onFocusScreen={showScreen}
        onTryScreen={tryScreen}
        onResumeScreen={onRetryScreen}
        onOpenSingleScreen={onOpenSingleScreen}
      />
    </div>
  );
}

function openStandalone(documentHtml: string, screenId: string): boolean {
  return openCleanPrototypeInNewTab(documentHtml, screenId) !== null;
}
