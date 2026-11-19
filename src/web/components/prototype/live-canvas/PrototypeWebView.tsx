import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, PenLine, RefreshCw } from 'lucide-react';
import type { PrototypeCanvasArtboard } from '../../../../packages/ontology-core/index.js';
import { usePreferences } from '../../../i18n.js';
import { Button } from '../../beautifui/index.js';
import { WebAgentCursor, useObservedElementSize } from './AgentCursor.js';
import { ArtboardFrame, type ArtboardHandle, type ArtboardRect } from './Artboard.js';
import { readAgentCursorPrefs, type AgentCursorPrefs, type AgentLiveActivity } from './agentCursor.js';

/** What design notes (#94) and demo tours (#95) use to draw over the web page. */
export interface PrototypeWebViewHandle {
  /** The page shown now. */
  screenId: () => string | undefined;
  /** Shows another page without recording it (a demo tour moving on, say). */
  show: (screenId: string) => void;
  /** Opens a page as the person would: recorded for back, and following stops. */
  open: (screenId: string) => void;
  /** An anchored element's box, relative to the page area (the overlay's coordinates). */
  rectOf: (elementId: string) => ArtboardRect | null;
  /** Scrolls an off-screen element into view and returns its box. */
  reveal: (elementId: string) => ArtboardRect | null;
}

export interface PrototypeWebViewProps {
  screens: readonly PrototypeCanvasArtboard[];
  /** The whole page body (the shell with every screen) and the styles of screens being written. */
  pageBodyHtml: string;
  pageCss: string;
  css: string;
  linksKey: string;
  headScriptsKey: string;
  nameOf: (board: PrototypeCanvasArtboard, index: number) => string;
  /** The page to open on (the screen being drawn, or the one the canvas last showed). */
  initialScreenId?: string | undefined;
  /** While following, the screen being drawn (already held for the dwell time by the canvas). */
  followScreenId?: string | undefined;
  /** The person navigated by hand: following stops. */
  onManualNavigate?: () => void;
  /** The page shown changed (the screen strip highlights it). */
  onPageChange?: (screenId: string | undefined) => void;
  busy?: boolean;
  onRetryScreen?: (screenId: string, screenName: string) => void;
  /** The whole document as it stands now, for 「新标签页打开」. */
  composeDocument: () => string;
  /** Opens it in a new tab; false when there was nothing to open. */
  onOpenStandalone: (documentHtml: string, screenId: string) => boolean;
  /** Live writing/fixing activities (#92, #93) for rendering the agent cursor and narration over the page. */
  liveActivities?: readonly AgentLiveActivity[];
  cursorPrefs?: AgentCursorPrefs;
}

interface History {
  back: string[];
  forward: string[];
}

/**
 * Web mode (#97): the prototype as a real page at its real width. One iframe loads the whole page
 * once (every screen, like the saved document) and a page change only moves the shell's
 * `is-active` to another screen, starting at the top; scripts, listeners and what was typed stay
 * with their screen. Links inside the prototype, back/forward and the page select move pages.
 */
export const PrototypeWebView = forwardRef<PrototypeWebViewHandle, PrototypeWebViewProps>(function PrototypeWebView(
  {
    screens,
    pageBodyHtml,
    pageCss,
    css,
    linksKey,
    headScriptsKey,
    nameOf,
    initialScreenId,
    followScreenId,
    onManualNavigate,
    onPageChange,
    busy = false,
    onRetryScreen,
    composeDocument,
    onOpenStandalone,
    liveActivities = [],
    cursorPrefs,
  },
  ref,
) {
  const { t } = usePreferences();
  const [requested, setRequested] = useState<string | undefined>(initialScreenId);
  const [history, setHistory] = useState<History>({ back: [], forward: [] });
  const has = (id: string | undefined): id is string => Boolean(id && screens.some((s) => s.screenId === id));
  const currentId = has(requested) ? requested : screens[0]?.screenId;
  const index = screens.findIndex((s) => s.screenId === currentId);
  const board = index >= 0 ? screens[index] : undefined;
  const currentRef = useRef(currentId);
  currentRef.current = currentId;
  const frameHandle = useRef<ArtboardHandle | null>(null);
  const pageContainerRef = useRef<HTMLDivElement | null>(null);
  const pageSize = useObservedElementSize(pageContainerRef);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const bumpLayout = useCallback(() => setLayoutVersion((v) => v + 1), []);
  const effectiveCursorPrefs = cursorPrefs ?? readAgentCursorPrefs();
  const activeWebActivity = board ? liveActivities.find((a) => a.screenId === board.screenId) : undefined;
  const [openFailed, setOpenFailed] = useState(false);

  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  useEffect(() => {
    onPageChangeRef.current?.(currentId);
  }, [currentId]);
  useEffect(() => () => onPageChangeRef.current?.(undefined), []);

  /** A page change the person made: recorded for back, and following stops. */
  const go = useCallback(
    (to: string) => {
      const from = currentRef.current;
      if (!to || to === from || !screens.some((s) => s.screenId === to)) return;
      // Updated now, so a second report of the same click (a tab's inline onclick and the
      // frame's link handler) is a no-op, not a second history entry.
      currentRef.current = to;
      setHistory((h) => ({
        back: from ? [...h.back, from] : h.back,
        forward: [],
      }));
      setRequested(to);
      onManualNavigate?.();
    },
    [onManualNavigate, screens],
  );

  // Following: show the page being drawn (the canvas already applies the dwell time).
  useEffect(() => {
    if (followScreenId && followScreenId !== currentRef.current) {
      currentRef.current = followScreenId;
      setRequested(followScreenId);
    }
  }, [followScreenId]);

  const back = () => {
    const prev = history.back[history.back.length - 1];
    if (!prev || !currentId) return;
    setHistory((h) => ({
      back: h.back.slice(0, -1),
      forward: [currentId, ...h.forward],
    }));
    currentRef.current = prev;
    setRequested(prev);
    onManualNavigate?.();
  };
  const forward = () => {
    const next = history.forward[0];
    if (!next || !currentId) return;
    setHistory((h) => ({
      back: [...h.back, currentId],
      forward: h.forward.slice(1),
    }));
    currentRef.current = next;
    setRequested(next);
    onManualNavigate?.();
  };

  useImperativeHandle(ref, () => {
    // The frame fills the page area, so frame-viewport boxes are already overlay boxes.
    return {
      screenId: () => currentRef.current,
      show: (screenId: string) => {
        if (screens.some((s) => s.screenId === screenId)) setRequested(screenId);
      },
      open: go,
      rectOf: (elementId: string) => frameHandle.current?.rectOf(elementId) ?? null,
      reveal: (elementId: string) => frameHandle.current?.reveal(elementId) ?? null,
    };
  }, [go, screens]);

  const statusText = (s: PrototypeCanvasArtboard) =>
    s.status === 'streaming' ? t('正在画', 'Drawing') : s.status === 'queued' ? t('还没画', 'Not drawn yet') : '';
  const canResume = Boolean(board && !busy && board.status === 'queued' && onRetryScreen);

  return (
    <div
      className="absolute inset-0 flex flex-col bg-canvas pb-14"
      data-canvas-ui
      data-testid="prototype-web-view"
      data-web-screen={currentId ?? ''}
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card px-3 py-1.5 text-[12px]">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={t('后退', 'Back')}
          disabled={history.back.length === 0}
          data-testid="prototype-web-back"
          onClick={back}
        >
          <ArrowLeft size={13} aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={t('前进', 'Forward')}
          disabled={history.forward.length === 0}
          data-testid="prototype-web-forward"
          onClick={forward}
        >
          <ArrowRight size={13} aria-hidden="true" />
        </Button>
        <label className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-0.5">
          <span className="shrink-0 text-muted-foreground">{t('页面', 'Page')}</span>
          <select
            className="min-w-0 max-w-[280px] cursor-pointer truncate border-0 bg-transparent py-0.5 text-[12px] text-foreground outline-none"
            value={currentId ?? ''}
            data-testid="prototype-web-page-select"
            onChange={(event) => go(event.target.value)}
          >
            {screens.map((s, i) => {
              const state = statusText(s);
              return (
                <option key={s.screenId} value={s.screenId}>
                  {nameOf(s, i)}
                  {state ? ` · ${state}` : ''}
                </option>
              );
            })}
          </select>
        </label>
        {board?.status === 'streaming' && (
          <span className="inline-flex items-center gap-1 text-primary" data-testid="prototype-web-drawing">
            <PenLine size={12} aria-hidden="true" />
            {t('助手正在画这一页', 'The assistant is drawing this page')}
          </span>
        )}
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={screens.length === 0}
          data-testid="prototype-web-open-standalone"
          title={t('把原型作为独立网页在新标签页打开', 'Open the prototype as its own page in a new tab')}
          onClick={() => {
            if (currentId) setOpenFailed(!onOpenStandalone(composeDocument(), currentId));
          }}
        >
          <ExternalLink size={12} aria-hidden="true" />
          {t('新标签页打开', 'Open in new tab')}
        </Button>
        {openFailed && (
          <span role="status" className="text-warning" data-testid="prototype-web-open-failed">
            {t('还没有可以打开的页面', 'There is nothing to open yet')}
          </span>
        )}
      </div>

      <div ref={pageContainerRef} className="relative min-h-0 flex-1 overflow-hidden bg-background" data-testid="prototype-web-page">
        {board ? (
          <ArtboardFrame
            screenId={board.screenId}
            title={nameOf(board, index)}
            bodyHtml={pageBodyHtml}
            css={css}
            {...(pageCss ? { extraCss: pageCss } : {})}
            linksKey={linksKey}
            headScriptsKey={headScriptsKey}
            landed
            interactive
            fill
            page
            testId="prototype-web-frame"
            handleRef={frameHandle}
            onLayout={bumpLayout}
            onNavigate={go}
            onEscape={noop}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {busy
                ? t('画好的页面会出现在这里', 'Pages appear here as they are drawn')
                : t('这个原型还没有页面', 'This prototype has no pages yet')}
            </span>
          </div>
        )}
        <WebAgentCursor
          activity={activeWebActivity}
          getHandle={() => frameHandle.current}
          pageWidth={pageSize.w || pageContainerRef.current?.clientWidth || 0}
          pageHeight={pageSize.h || pageContainerRef.current?.clientHeight || 0}
          prefs={effectiveCursorPrefs}
          layoutVersion={layoutVersion}
        />
        {board && canResume && (
          <div className="absolute inset-x-0 top-4 flex justify-center px-4">
            <div
              className="flex max-w-md flex-wrap items-center gap-3 rounded-md border border-border bg-card px-4 py-3 text-[12.5px] text-foreground shadow-md"
              data-testid={`prototype-web-unfinished-${board.screenId}`}
            >
              <span>{t('这一页还没画完。', 'This page is not finished yet.')}</span>
              <Button
                type="button"
                variant="accent"
                size="xs"
                data-testid={`prototype-web-retry-${board.screenId}`}
                onClick={() => onRetryScreen?.(board.screenId, nameOf(board, index))}
              >
                <RefreshCw size={11} aria-hidden="true" />
                {t('继续这一屏', 'Continue this screen')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

function noop(): void {}

/** At the end of a build, the log suggests trying the prototype as a real page (#97). */
export function WebModeHint({ onTry, onDismiss }: { onTry: () => void; onDismiss: () => void }) {
  const { t } = usePreferences();
  return (
    <div
      role="status"
      className="m-2 flex flex-col gap-2 rounded-md border border-border bg-primary-soft px-3 py-2 text-[12px] text-foreground"
      data-testid="prototype-web-mode-hint"
    >
      <span>
        {t(
          '原型画好了。切到「网页」可以按真实宽度像网站一样点着看。',
          'The prototype is drawn. Switch to Web to click through it like a real website.',
        )}
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="accent" size="xs" data-testid="prototype-web-mode-hint-try" onClick={onTry}>
          {t('切到网页', 'Switch to Web')}
        </Button>
        <Button type="button" variant="ghost" size="xs" onClick={onDismiss}>
          {t('知道了', 'Got it')}
        </Button>
      </div>
    </div>
  );
}
