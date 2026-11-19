import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { sanitizeBusinessText } from '../../../../packages/business-vocabulary/index.js';
import type { PrototypeDemoTour } from '../../../../packages/ontology-core/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../beautifui/index.js';
import type { ArtboardHandle, ArtboardRect } from './Artboard.js';
import { ARTBOARD_H, ARTBOARD_W, artboardRect, type Camera } from './camera.js';
import { computeCursorAim, padSpotlightRect, type DemoTourController } from './demoTourState.js';
import './demo-tour-player.css';

function cleanTourText(
  raw: string | undefined,
  locale: 'zh-CN' | 'en-US',
  isBusiness: boolean,
  fallback = '',
): string {
  if (!raw) return fallback;
  if (!isBusiness) return raw;
  return sanitizeBusinessText(raw, locale).trim() || fallback;
}

function clampArtboardRect(rect: ArtboardRect): ArtboardRect {
  const left = Math.max(0, Math.min(ARTBOARD_W - 8, rect.x));
  const top = Math.max(0, Math.min(ARTBOARD_H - 8, rect.y));
  const right = Math.max(left + 8, Math.min(ARTBOARD_W, rect.x + rect.w));
  const bottom = Math.max(top + 8, Math.min(ARTBOARD_H, rect.y + rect.h));
  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  };
}

function clampArtboardPoint(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(ARTBOARD_W, x)),
    y: Math.max(0, Math.min(ARTBOARD_H, y)),
  };
}

/**
 * Phase-bar trigger (`▶ 播放演示` / `▶ Play Demo`) that opens a Demo Tour picker menu portaled onto
 * `document.body` so no `overflow` or scrolling container can ever clip it (#88 review catch).
 */
export function DemoTourPlayButton({
  tours,
  activeTourId,
  onSelectTour,
  viewMode = 'business',
}: {
  tours: readonly PrototypeDemoTour[];
  activeTourId?: string | null;
  onSelectTour: (tour: PrototypeDemoTour) => void;
  viewMode?: 'business' | 'technical';
}) {
  const { locale, t } = usePreferences();
  const normLocale: 'zh-CN' | 'en-US' = locale === 'en-US' ? 'en-US' : 'zh-CN';
  const isBusiness = viewMode === 'business';
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 16, top: 48 });

  const updatePosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn || typeof window === 'undefined') return;
    const r = btn.getBoundingClientRect();
    const menuWidth = 264;
    const maxLeft = Math.max(8, (window.innerWidth || 1024) - menuWidth - 8);
    const left = Math.max(8, Math.min(r.left, maxLeft));
    const maxBottomSpace = (window.innerHeight || 768) - r.bottom;
    const top = maxBottomSpace < 180 ? Math.max(8, r.top - 180) : r.bottom + 6;
    setPos({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  if (tours.length === 0) return null;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        size="xs"
        className="text-xs"
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="demo-tour-play-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true" className="text-primary">
          ▶
        </span>
        <span>{t('播放演示', 'Play Demo')}</span>
      </Button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={t('选择演示路线', 'Choose a Demo Tour')}
            data-testid="demo-tour-menu"
            className="fixed z-50 flex w-[264px] flex-col gap-1 rounded-md border border-border bg-popover p-1.5 text-xs text-popover-foreground shadow-lg"
            style={{ left: pos.left, top: pos.top }}
          >
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {t('选择一条演示路线播放', 'Pick a Demo Tour to play')}
            </div>
            {tours.map((tour) => {
              const goal = cleanTourText(tour.goal, normLocale, isBusiness, t('演示路线', 'Demo Tour'));
              const audience = cleanTourText(tour.audience, normLocale, isBusiness);
              const isActive = activeTourId === tour.id;
              return (
                <button
                  key={tour.id}
                  type="button"
                  role="menuitem"
                  data-testid={`demo-tour-option-${tour.id}`}
                  onClick={() => {
                    setOpen(false);
                    onSelectTour(tour);
                  }}
                  className={cn(
                    'flex w-full cursor-pointer flex-col gap-0.5 rounded-sm border-0 px-2.5 py-2 text-left text-xs',
                    isActive
                      ? 'bg-primary-soft text-foreground'
                      : 'bg-transparent text-popover-foreground hover:bg-accent',
                  )}
                >
                  <span className="font-semibold">{goal}</span>
                  <span className={cn('text-xs tabular-nums', isActive ? 'text-primary' : 'text-muted-foreground')}>
                    {audience ? `${audience} · ` : ''}
                    {t(`${tour.steps.length} 步`, `${tour.steps.length} steps`)}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Right sidebar Demo Tour steps panel (#88 verdict B): replaces `BuildLog` while a Demo Tour is
 * active, highlights the current step, and lets the user click any step to jump straight to it.
 */
export function DemoTourScriptPanel({
  controller,
  screenNameOf,
  viewMode = 'business',
}: {
  controller: DemoTourController;
  screenNameOf: (screenId: string) => string;
  viewMode?: 'business' | 'technical';
}) {
  const { locale, t } = usePreferences();
  const normLocale: 'zh-CN' | 'en-US' = locale === 'en-US' ? 'en-US' : 'zh-CN';
  const isBusiness = viewMode === 'business';
  const { tour, stepIndex } = controller.state;
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [stepIndex, tour?.id]);

  if (!tour) return null;

  const goal = cleanTourText(tour.goal, normLocale, isBusiness, t('演示路线', 'Demo Tour'));
  const audience = cleanTourText(tour.audience, normLocale, isBusiness);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-muted-foreground">
            {t('演示路线', 'Demo Tour')}
            {audience ? ` · ${audience}` : ''}
          </div>
          <div className="truncate text-xs font-semibold text-foreground">{goal}</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-xs"
          aria-label={t('结束演示', 'Exit Demo Tour')}
          data-testid="demo-tour-script-close"
          onClick={controller.stop}
        >
          <X size={13} aria-hidden="true" />
        </Button>
      </div>
      <ol
        className="m-0 min-h-0 flex-1 list-none space-y-1 overflow-auto px-2 py-2"
        data-testid="demo-tour-steps"
      >
        {tour.steps.map((step, idx) => {
          const isCurrent = idx === stepIndex;
          const isPast = idx < stepIndex;
          const caption = cleanTourText(step.caption, normLocale, isBusiness, t('查看当前步骤', 'Inspect this step'));
          const screenName = screenNameOf(step.screenId);
          return (
            <li key={`${tour.id}-step-${idx}`}>
              <button
                ref={isCurrent ? activeItemRef : undefined}
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                data-testid={`demo-tour-step-${idx}`}
                data-step-state={isCurrent ? 'current' : isPast ? 'past' : 'upcoming'}
                onClick={() => controller.goToStep(idx)}
                className={cn(
                  'flex w-full cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs',
                  isCurrent
                    ? 'border-primary/40 bg-primary-soft text-foreground'
                    : 'border-transparent bg-transparent text-foreground-soft hover:bg-accent',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                    isCurrent
                      ? 'bg-primary text-primary-foreground'
                      : isPast
                        ? 'bg-success-soft text-success'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {idx + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block leading-snug', isCurrent ? 'font-medium text-foreground' : 'text-foreground-soft')}>
                    {caption}
                  </span>
                  <span className={cn('mt-0.5 block truncate text-xs', isCurrent ? 'text-primary' : 'text-muted-foreground')}>
                    {screenName}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DemoCursorGlyph({ x, y, clickCount }: { x: number; y: number; clickCount: number }) {
  return (
    <div
      className="onto-demo-cursor"
      data-testid="demo-tour-cursor"
      style={{ transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)` }}
      aria-hidden="true"
    >
      <svg width="22" height="22" viewBox="0 0 22 22" className="onto-demo-cursor-svg">
        <path d="M3 2 L3 18 L7.5 13.8 L10.6 20 L13.4 18.7 L10.4 12.6 L16.5 12.4 Z" />
      </svg>
      {clickCount > 0 && <span key={clickCount} className="onto-demo-ripple" data-testid="demo-tour-ripple" />}
    </div>
  );
}

/**
 * Spotlight cutout + demo cursor in Canvas (`artboards`) mode, re-measuring live element positions
 * on `layoutVersion` (scroll/resize/morph) and clamping within `[0, ARTBOARD_W] × [0, ARTBOARD_H]`.
 */
export function CanvasDemoTourOverlay({
  controller,
  indexById,
  getHandle,
  cam,
  layoutVersion,
}: {
  controller: DemoTourController;
  indexById: ReadonlyMap<string, number>;
  getHandle: (screenId: string) => ArtboardHandle | null;
  cam: Camera;
  layoutVersion: number;
}) {
  void layoutVersion;
  const { tour, spotlight, cursor } = controller.state;
  if (!tour) return null;

  const spotSlot = spotlight ? indexById.get(spotlight.screenId) : undefined;
  const spotBoard = spotSlot !== undefined ? artboardRect(spotSlot) : null;
  let spotBox: { x: number; y: number; w: number; h: number } | null = null;
  if (spotlight && spotBoard) {
    const liveElRect = spotlight.elementId
      ? getHandle(spotlight.screenId)?.rectOf(spotlight.elementId) ?? null
      : null;
    const rawRect = liveElRect ? padSpotlightRect(liveElRect) : spotlight.rect;
    const clamped = clampArtboardRect(rawRect);
    spotBox = {
      x: cam.x + (spotBoard.x + clamped.x) * cam.k,
      y: cam.y + (spotBoard.y + clamped.y) * cam.k,
      w: Math.max(8, clamped.w * cam.k),
      h: Math.max(8, clamped.h * cam.k),
    };
  }

  const curSlot = cursor ? indexById.get(cursor.screenId) : undefined;
  const curBoard = curSlot !== undefined ? artboardRect(curSlot) : null;
  let curScreen: { x: number; y: number; clickCount: number } | null = null;
  if (cursor && curBoard) {
    const liveCurRect =
      !cursor.gliding && cursor.elementId
        ? getHandle(cursor.screenId)?.rectOf(cursor.elementId) ?? null
        : null;
    const rawPoint = liveCurRect ? computeCursorAim(liveCurRect) : { x: cursor.x, y: cursor.y };
    const clampedPoint = clampArtboardPoint(rawPoint.x, rawPoint.y);
    curScreen = {
      x: cam.x + (curBoard.x + clampedPoint.x) * cam.k,
      y: cam.y + (curBoard.y + clampedPoint.y) * cam.k,
      clickCount: cursor.clickCount,
    };
  }

  return (
    <>
      {spotBox && spotlight && (
        <div
          className="onto-demo-spotlight"
          data-testid="demo-tour-spotlight"
          data-screen-id={spotlight.screenId}
          style={{
            width: Math.round(spotBox.w),
            height: Math.round(spotBox.h),
            transform: `translate3d(${Math.round(spotBox.x)}px, ${Math.round(spotBox.y)}px, 0)`,
          }}
          aria-hidden="true"
        />
      )}
      {curScreen && <DemoCursorGlyph x={curScreen.x} y={curScreen.y} clickCount={curScreen.clickCount} />}
    </>
  );
}

/**
 * Spotlight cutout + demo cursor in Web mode (`#97`), re-measuring live element positions on
 * scroll/resize (`layoutVersion`) and guarding `screenId === activeScreenId` so source-screen
 * spotlights never bleed onto newly navigated screens.
 */
export function WebDemoTourOverlay({
  controller,
  activeScreenId,
  getHandle,
  pageWidth,
  pageHeight,
  layoutVersion,
}: {
  controller: DemoTourController;
  activeScreenId: string | undefined;
  getHandle: () => ArtboardHandle | null;
  pageWidth: number;
  pageHeight: number;
  layoutVersion: number;
}) {
  void layoutVersion;
  const { tour, spotlight, cursor } = controller.state;
  if (!tour) return null;

  let resolvedSpot: ArtboardRect | null = null;
  if (spotlight && (!activeScreenId || spotlight.screenId === activeScreenId)) {
    if (spotlight.elementId) {
      const liveRect = getHandle()?.rectOf(spotlight.elementId) ?? null;
      resolvedSpot = liveRect ? padSpotlightRect(liveRect) : spotlight.rect;
    } else {
      resolvedSpot =
        pageWidth > 0 && pageHeight > 0
          ? { x: 8, y: 8, w: Math.max(120, pageWidth - 16), h: Math.max(120, pageHeight - 112) }
          : spotlight.rect;
    }
  }

  let resolvedCursor: { x: number; y: number; clickCount: number } | null = null;
  if (cursor && (!activeScreenId || cursor.screenId === activeScreenId)) {
    const liveCurRect =
      !cursor.gliding && cursor.elementId ? getHandle()?.rectOf(cursor.elementId) ?? null : null;
    const pt = liveCurRect ? computeCursorAim(liveCurRect) : { x: cursor.x, y: cursor.y };
    resolvedCursor = { x: pt.x, y: pt.y, clickCount: cursor.clickCount };
  }

  return (
    <>
      {resolvedSpot && spotlight && (
        <div
          className="onto-demo-spotlight onto-demo-spotlight-web"
          data-testid="demo-tour-spotlight"
          data-screen-id={spotlight.screenId}
          style={{
            width: Math.round(resolvedSpot.w),
            height: Math.round(resolvedSpot.h),
            transform: `translate3d(${Math.round(resolvedSpot.x)}px, ${Math.round(resolvedSpot.y)}px, 0)`,
          }}
          aria-hidden="true"
        />
      )}
      {resolvedCursor && (
        <DemoCursorGlyph x={resolvedCursor.x} y={resolvedCursor.y} clickCount={resolvedCursor.clickCount} />
      )}
    </>
  );
}

/**
 * Bottom playback bar + business-language subtitle caption directly above it (#88 verdict A).
 */
export function DemoTourPlaybackBar({
  controller,
  viewMode = 'business',
}: {
  controller: DemoTourController;
  viewMode?: 'business' | 'technical';
}) {
  const { locale, t } = usePreferences();
  const normLocale: 'zh-CN' | 'en-US' = locale === 'en-US' ? 'en-US' : 'zh-CN';
  const isBusiness = viewMode === 'business';
  const { tour, stepIndex, paused, completed } = controller.state;
  if (!tour) return null;

  const safeIndex = Math.max(0, Math.min(tour.steps.length - 1, stepIndex));
  const step = tour.steps[safeIndex];
  const goal = cleanTourText(tour.goal, normLocale, isBusiness, t('演示路线', 'Demo Tour'));
  const caption = cleanTourText(step?.caption, normLocale, isBusiness);

  return (
    <div
      data-canvas-ui
      className="pointer-events-none absolute inset-x-3 bottom-3 z-20 mx-auto flex max-w-2xl flex-col items-center gap-2"
    >
      {caption && (
        <div
          role="status"
          aria-live="polite"
          data-testid="demo-tour-caption"
          className="pointer-events-auto max-w-xl rounded-md border border-border bg-popover px-4 py-2 text-center text-xs font-medium leading-relaxed text-popover-foreground shadow-md"
        >
          {caption}
        </div>
      )}
      <div
        data-testid="demo-tour-player-bar"
        data-tour-id={tour.id}
        data-tour-step={String(safeIndex)}
        data-tour-paused={paused ? 'true' : 'false'}
        data-tour-completed={completed ? 'true' : 'false'}
        className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-card-foreground shadow-md"
      >
        <span className="mr-1 max-w-[200px] truncate font-semibold text-foreground">{goal}</span>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className="text-xs"
          disabled={safeIndex <= 0}
          data-testid="demo-tour-prev"
          onClick={() => controller.goToStep(safeIndex - 1)}
        >
          {t('‹ 上一步', '‹ Previous')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className="text-xs"
          data-testid="demo-tour-pause-toggle"
          onClick={controller.togglePause}
        >
          {completed
            ? t('↻ 重播', '↻ Replay')
            : paused
              ? t('▶ 继续', '▶ Resume')
              : t('❚❚ 暂停', '❚❚ Pause')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className="text-xs"
          disabled={safeIndex >= tour.steps.length - 1}
          data-testid="demo-tour-next"
          onClick={() => controller.goToStep(safeIndex + 1)}
        >
          {t('下一步 ›', 'Next ›')}
        </Button>
        <span
          className="px-1.5 text-xs text-muted-foreground tabular-nums"
          data-testid="demo-tour-progress"
        >
          {safeIndex + 1} / {tour.steps.length}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-xs"
          data-testid="demo-tour-exit"
          onClick={controller.stop}
        >
          {t('结束', 'Exit')}
        </Button>
      </div>
    </div>
  );
}
