import React from 'react';
import { CheckCircle2, Clock, PenLine, RefreshCw, ScanSearch, TriangleAlert, Wrench } from 'lucide-react';
import { describePrototypeBuildFailure } from '../../../../packages/business-vocabulary/index.js';
import type { PrototypeBuildScreenStatus } from '../../../../packages/ontology-core/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../beautifui/index.js';
import { businessText, screenOwnerName, type ScreenBuildView } from './buildView.js';

type T = (zh: string, en: string) => string;

export function screenStatusLabel(status: PrototypeBuildScreenStatus, t: T): string {
  switch (status) {
    case 'queued':
      return t('排队中', 'Queued');
    case 'writing':
      return t('施工中', 'Building');
    case 'reviewing':
      return t('检查中', 'Checking');
    case 'fixing':
      return t('修正中', 'Fixing');
    case 'done':
      return t('完成', 'Done');
    case 'failed':
      return t('没画完', 'Not finished');
  }
}

export function ScreenStatusIcon({ status }: { status: PrototypeBuildScreenStatus }) {
  if (status === 'writing') return <PenLine size={12} className="text-primary" aria-hidden="true" />;
  if (status === 'reviewing') return <ScanSearch size={12} className="text-warning" aria-hidden="true" />;
  if (status === 'fixing') return <Wrench size={12} className="text-warning" aria-hidden="true" />;
  if (status === 'done') return <CheckCircle2 size={12} className="text-success" aria-hidden="true" />;
  if (status === 'failed') return <TriangleAlert size={12} className="text-destructive" aria-hidden="true" />;
  return <Clock size={12} className="text-muted-foreground" aria-hidden="true" />;
}

/**
 * The progress bar of one screen. Nobody knows in advance how long a screen will be, so a
 * screen being written shows an empty track and the elements actually written, never a fill
 * that would read as a percentage.
 */
function ScreenProgress({ screen }: { screen: ScreenBuildView }) {
  const { t } = usePreferences();
  const fill =
    screen.status === 'done'
      ? 'w-full bg-success'
      : screen.status === 'failed'
        ? 'w-full bg-destructive/60'
        : null;
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={screenStatusLabel(screen.status, t)}
        {...(screen.status === 'done' ? { 'aria-valuenow': 100 } : {})}
        data-testid={`prototype-strip-progress-${screen.screenId}`}
      >
        {fill && <div className={cn('h-full rounded-full', fill)} data-testid={`prototype-strip-fill-${screen.screenId}`} />}
      </div>
      {screen.status === 'writing' && (
        <span className="shrink-0 text-[11px] text-muted-foreground" data-testid={`prototype-strip-written-${screen.screenId}`}>
          {screen.writtenElements > 0
            ? t(`已写 ${screen.writtenElements} 处`, `${screen.writtenElements} written`)
            : t('正在写', 'Writing')}
        </span>
      )}
    </div>
  );
}

/**
 * The screen strip (#90, #88 layout D): one card per planned screen with its status, progress
 * and owning assistant. Click focuses the screen, double-click tries it; a failed screen says
 * why in one sentence and offers 「继续这一屏」.
 */
export function ScreenStrip({
  screens,
  highlightedScreenId,
  busy,
  onFocusScreen,
  onTryScreen,
  onResumeScreen,
  onOpenSingleScreen,
}: {
  screens: readonly ScreenBuildView[];
  highlightedScreenId?: string | undefined;
  busy: boolean;
  onFocusScreen: (screenId: string) => void;
  onTryScreen: (screenId: string) => void;
  onResumeScreen?: ((screenId: string, screenName: string) => void) | undefined;
  onOpenSingleScreen?: ((screenId: string) => void) | undefined;
}) {
  const { locale, t } = usePreferences();
  return (
    <div
      className="flex min-h-14 items-stretch gap-2 overflow-x-auto border-t border-border bg-card px-3 py-2"
      data-testid="prototype-screen-strip"
    >
      {screens.map((screen, idx) => {
        const owner = screenOwnerName(screen, locale);
        const canResume = screen.resumable && !busy && Boolean(onResumeScreen);
        const failure =
          screen.status === 'failed'
            ? describePrototypeBuildFailure(screen.failure, locale === 'en-US' ? 'en-US' : 'zh-CN')
            : undefined;
        return (
          <div
            key={screen.screenId}
            className={cn(
              'flex w-[210px] shrink-0 cursor-pointer flex-col gap-1 rounded-md border px-2.5 py-1.5 text-left text-[12px]',
              highlightedScreenId === screen.screenId
                ? 'border-primary bg-primary-soft'
                : screen.status === 'failed'
                  ? 'border-destructive/40 bg-background'
                  : 'border-border bg-background',
            )}
            data-testid={`prototype-strip-card-${screen.screenId}`}
            data-build-status={screen.status}
            {...(screen.reviewed ? { 'data-review-outcome': screen.reviewed } : {})}
            title={screen.purpose ? businessText(screen.purpose, locale) || undefined : undefined}
            tabIndex={0}
            aria-label={screen.name}
            onClick={() => onFocusScreen(screen.screenId)}
            onDoubleClick={() => onTryScreen(screen.screenId)}
            onKeyDown={(event) => {
              // Keyboard on the card itself: Enter tries the screen, Space focuses it.
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                onTryScreen(screen.screenId);
              } else if (event.key === ' ') {
                event.preventDefault();
                onFocusScreen(screen.screenId);
              }
            }}
          >
            {/* The name is the card's button; its click reaches the card (focus, or open the page). */}
            <button
              type="button"
              className="flex min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-foreground"
              data-testid={`prototype-strip-open-${screen.screenId}`}
            >
              <span className="font-mono text-[11px] text-muted-foreground">{String(idx + 1).padStart(2, '0')}</span>
              <span className="truncate font-medium">{screen.name}</span>
            </button>
            <ScreenProgress screen={screen} />
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground" data-testid={`prototype-strip-status-${screen.screenId}`}>
                <ScreenStatusIcon status={screen.status} />
                <span className="truncate">
                  {screenStatusLabel(screen.status, t)}
                  {owner ? ` · ${owner}` : ''}
                </span>
              </span>
              {!canResume && onOpenSingleScreen && screen.status === 'done' && !busy && (
                <button
                  type="button"
                  className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-primary"
                  data-testid={`artboard-focus-btn-${screen.screenId}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenSingleScreen(screen.screenId);
                  }}
                >
                  {t('单屏查看', 'Single view')}
                </button>
              )}
            </div>
            {failure && (
              <p className="m-0 text-[11px] leading-snug text-destructive" data-testid={`prototype-strip-failure-${screen.screenId}`}>
                {failure}
              </p>
            )}
            {canResume && (
              <Button
                type="button"
                variant="accent"
                size="xs"
                className="self-start"
                data-testid={`artboard-retry-btn-${screen.screenId}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onResumeScreen?.(screen.screenId, screen.name);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <RefreshCw size={11} aria-hidden="true" />
                {t('继续这一屏', 'Continue this screen')}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
