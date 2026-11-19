import React, { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { describePrototypeBuildLogEntry } from '../../../../packages/business-vocabulary/index.js';
import type { PrototypeBuildState } from '../../../../packages/ontology-core/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../beautifui/index.js';
import { agentThemePalette, type AgentLiveActivity } from './agentCursor.js';
import { agentName, type ScreenBuildView } from './buildView.js';

function clock(at: string, locale: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(locale === 'en-US' ? 'en-US' : 'zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function BuildLogLiveRows({
  activities,
  onFocusScreen,
}: {
  activities: readonly AgentLiveActivity[];
  onFocusScreen: (screenId: string) => void;
}) {
  const { locale, t } = usePreferences();
  const narrated = activities.filter((a) => Boolean(a.sentence));
  if (narrated.length === 0) return null;

  return (
    <>
      {narrated.map((activity) => {
        const palette = agentThemePalette(activity.agent);
        const dotColor = activity.state === 'fixing' ? 'var(--warning)' : palette.color;
        return (
          <li
            key={`live-${activity.screenId}`}
            className="mt-1 rounded-md bg-muted px-1.5 py-1 hover:bg-accent"
            data-testid="prototype-build-log-live"
            data-screen-id={activity.screenId}
            data-activity-state={activity.state}
          >
            <button
              type="button"
              className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left"
              title={t('在画布上定位这一屏', 'Show this screen on the canvas')}
              onClick={() => onFocusScreen(activity.screenId)}
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground-soft">{t('现在', 'Now')}</span>
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: dotColor }}
                  aria-hidden="true"
                />
                <span className="font-semibold text-foreground">
                  {agentName(activity.agent, locale)}
                </span>
              </span>
              <span className="block text-xs leading-snug text-foreground italic">
                {activity.sentence}
              </span>
            </button>
          </li>
        );
      })}
    </>
  );
}

/**
 * The build log (#90, #88 layout D): one line per real engine event — time, who, which screen,
 * and a business sentence. A line about a screen focuses it; a failure line carries
 * 「继续这一屏」 while that screen is still failed; active narrations appear as "现在" / "Now" rows.
 */
export function BuildLog({
  build,
  screens,
  busy,
  onFocusScreen,
  onResumeScreen,
  liveActivities = [],
  endEntry,
}: {
  build: PrototypeBuildState;
  screens: readonly ScreenBuildView[];
  busy: boolean;
  onFocusScreen: (screenId: string) => void;
  onResumeScreen?: ((screenId: string, screenName: string) => void) | undefined;
  liveActivities?: readonly AgentLiveActivity[];
  /** A closing entry after the last line (#97's suggestion to try web mode). */
  endEntry?: React.ReactNode;
}) {
  const { locale, t } = usePreferences();
  const byId = new Map(screens.map((s) => [s.screenId, s]));
  const nameOf = (id: string) => byId.get(id)?.name ?? t('这一屏', 'this screen');
  const listRef = useRef<HTMLOListElement | null>(null);
  const stickToEnd = useRef(true);
  const count = build.log.length;
  const liveNarrationKey = liveActivities.map((a) => `${a.screenId}:${a.sentence ?? ''}`).join('|');
  // Only a screen's latest failure line offers to continue it.
  const lastFailure = new Map<string, number>();
  for (const e of build.log) if (e.kind === 'screen_failed' && e.screenId) lastFailure.set(e.screenId, e.id);

  // Follow new live entries when a build or single-screen continuation starts, unless scrolled up.
  useEffect(() => {
    if (busy) stickToEnd.current = true;
  }, [busy]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToEnd.current) el.scrollTop = el.scrollHeight;
  }, [busy, count, liveNarrationKey, Boolean(endEntry)]);

  return (
    <ol
      ref={listRef}
      className="m-0 min-h-0 flex-1 list-none overflow-auto px-2 py-2"
      data-testid="prototype-build-log-entries"
      onScroll={(event) => {
        const el = event.currentTarget;
        stickToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {build.log.map((entry) => {
        const screen = entry.screenId ? byId.get(entry.screenId) : undefined;
        const canResume =
          entry.kind === 'screen_failed' &&
          screen?.status === 'failed' &&
          lastFailure.get(screen.screenId) === entry.id &&
          !busy &&
          Boolean(onResumeScreen);
        const sentence = describePrototypeBuildLogEntry(entry, nameOf, locale === 'en-US' ? 'en-US' : 'zh-CN');
        const body = (
          <>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="font-mono">{clock(entry.at, locale)}</span>
              <span>{agentName(entry.agent, locale)}</span>
            </span>
            <span className={cn('block text-[12px] leading-snug', entry.kind === 'screen_failed' ? 'text-destructive' : 'text-foreground')}>
              {sentence}
            </span>
          </>
        );
        return (
          <li
            key={entry.id}
            className="rounded-md px-1.5 py-1 hover:bg-muted/45"
            data-testid="prototype-build-log-entry"
            data-kind={entry.kind}
            data-screen-id={entry.screenId ?? ''}
          >
            {screen ? (
              <button
                type="button"
                className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left"
                title={t('在画布上定位这一屏', 'Show this screen on the canvas')}
                onClick={() => onFocusScreen(screen.screenId)}
              >
                {body}
              </button>
            ) : (
              body
            )}
            {canResume && (
              <Button
                type="button"
                variant="accent"
                size="xs"
                className="mt-1"
                data-testid={`prototype-build-log-resume-${screen.screenId}`}
                onClick={() => onResumeScreen?.(screen.screenId, screen.name)}
              >
                <RefreshCw size={11} aria-hidden="true" />
                {t('继续这一屏', 'Continue this screen')}
              </Button>
            )}
          </li>
        );
      })}
      <BuildLogLiveRows activities={liveActivities} onFocusScreen={onFocusScreen} />
      {endEntry && <li data-testid="prototype-build-log-end">{endEntry}</li>}
    </ol>
  );
}
