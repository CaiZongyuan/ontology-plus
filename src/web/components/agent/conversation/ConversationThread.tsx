import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Sparkles } from 'lucide-react';
import type { ProjectStepId } from '../../../../packages/business-vocabulary/index.js';
import { usePreferences } from '../../../i18n.js';
import type { AgentRunView, LocalizedText, PrototypeTargetAnchor } from '../agentRun.js';
import { AssistantReplyItem } from './AssistantReplyItem.js';
import { ReplyActionsBar } from './ReplyActionsBar.js';
import { UserMessageItem } from './UserMessageItem.js';
import {
  deriveScrollPositionFromMetrics,
  readSessionScrollPosition,
  resolveRestoredScrollMetrics,
  writeSessionScrollPosition,
} from './scrollPosition.js';

const useIsomorphicLayoutEffect =
  typeof document !== 'undefined' ? useLayoutEffect : useEffect;

export interface ConversationThreadProps {
  runs: AgentRunView[];
  activeSessionId?: string;
  starterPrompts?: LocalizedText[];
  composerDisabled?: boolean;
  onSubmitStarterPrompt?: (prompt: string) => void | Promise<void>;
  onCancelRun?: (runId: string) => void;
  onRetryRun?: (runId: string) => void;
  onEditLatestTurn?: (run: AgentRunView, nextPrompt: string) => void | Promise<void>;
  onRetryLatestTurn?: (run: AgentRunView) => void | Promise<void>;
  onOpenRunArtifact?: (runId: string) => void;
  onOpenPlatformSettings?: () => void;
  onOpenLlmCenter?: () => void;
  onHoverAnchor?: (anchor: PrototypeTargetAnchor | null) => void;
  onAnswerAskUser?: (
    runId: string,
    promptId: string,
    selectedAnswers: string[],
    freeformText?: string,
  ) => void;
  onAcceptStepHandoff?: (runId: string, handoffId: string) => void | Promise<void>;
  onDeclineStepHandoff?: (runId: string, handoffId: string) => void | Promise<void>;
  onOpenHandoffTargetStep?: (targetStep: ProjectStepId, targetSessionId?: string) => void;
  handoffBusyById?: Readonly<Record<string, 'accept' | 'decline'>>;
  onTriggerWriteback?: (writebackInterfaceId: string, actionTitle: string) => void;
  renderRunFooter?: (run: AgentRunView) => React.ReactNode;
  renderUserActions?: (run: AgentRunView, opts: { isLatestTurn: boolean }) => React.ReactNode;
  renderReplyActions?: (run: AgentRunView) => React.ReactNode;
  /** Optional calm notice banner at the top of the message stream (e.g. #82 RemovedMessagesNotice). */
  topNoticeSlot?: React.ReactNode;
  /** Incremented when the user submits a prompt from the composer so sticky scroll re-arms. */
  scrollToBottomSignal?: number;
  /** Fixed clock passed through to WorkProcessBlock for deterministic rendering. */
  now?: number;
}

/**
 * Scrollable continuous conversation stream with sticky auto-scroll during streaming,
 * floating "跳到最新 / Jump to latest" button when scrolled away from bottom,
 * and per-session persisted scroll restoration across session switches and reloads.
 */
export function ConversationThread({
  runs,
  activeSessionId,
  starterPrompts,
  composerDisabled = false,
  onSubmitStarterPrompt,
  onCancelRun,
  onRetryRun,
  onEditLatestTurn,
  onRetryLatestTurn,
  onOpenRunArtifact,
  onOpenPlatformSettings,
  onOpenLlmCenter,
  onHoverAnchor,
  onAnswerAskUser,
  onAcceptStepHandoff,
  onDeclineStepHandoff,
  onOpenHandoffTargetStep,
  handoffBusyById,
  onTriggerWriteback,
  renderRunFooter,
  renderUserActions,
  renderReplyActions,
  topNoticeSlot,
  scrollToBottomSignal = 0,
  now,
}: ConversationThreadProps) {
  const { t } = usePreferences();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastProgrammaticTargetRef = useRef<number | null>(null);
  const pendingRestoreScrollTopRef = useRef<number | null>(null);

  const readInitialAtBottom = (sessionId: string | undefined): boolean => {
    const saved = readSessionScrollPosition(sessionId);
    return saved ? saved.atBottom : true;
  };

  const [atBottom, setAtBottom] = useState<boolean>(() => readInitialAtBottom(activeSessionId));
  const atBottomRef = useRef<boolean>(atBottom);
  atBottomRef.current = atBottom;

  const applyProgrammaticScrollTop = useCallback((el: HTMLDivElement, nextScrollTop: number) => {
    el.scrollTop = nextScrollTop;
    lastProgrammaticTargetRef.current = el.scrollTop;
  }, []);

  // Restore saved scroll offset whenever the active conversation changes or mounts.
  const restoredSessionKeyRef = useRef<string | undefined>(undefined);
  const restoredWithNonEmptyRunsRef = useRef<boolean>(false);

  useIsomorphicLayoutEffect(() => {
    const el = scrollRef.current;
    const sessionChanged = restoredSessionKeyRef.current !== activeSessionId;
    const becamePopulated = !restoredWithNonEmptyRunsRef.current && runs.length > 0;
    if (!sessionChanged && !becamePopulated) return;

    restoredSessionKeyRef.current = activeSessionId;
    restoredWithNonEmptyRunsRef.current = runs.length > 0;

    const saved = readSessionScrollPosition(activeSessionId);
    if (!el) {
      const nextBottom = saved ? saved.atBottom : true;
      atBottomRef.current = nextBottom;
      setAtBottom(nextBottom);
      return;
    }

    const resolved = resolveRestoredScrollMetrics(saved, {
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    });
    pendingRestoreScrollTopRef.current =
      saved && !saved.atBottom && saved.scrollTop > resolved.scrollTop ? saved.scrollTop : null;
    atBottomRef.current = resolved.atBottom;
    setAtBottom(resolved.atBottom);
    applyProgrammaticScrollTop(el, resolved.scrollTop);
  }, [activeSessionId, runs.length, applyProgrammaticScrollTop]);

  // Re-arm sticky scroll explicitly when the user submits a prompt from the composer.
  const prevSignalRef = useRef(scrollToBottomSignal);
  useIsomorphicLayoutEffect(() => {
    if (prevSignalRef.current === scrollToBottomSignal) return;
    prevSignalRef.current = scrollToBottomSignal;
    pendingRestoreScrollTopRef.current = null;
    atBottomRef.current = true;
    setAtBottom(true);
    writeSessionScrollPosition(activeSessionId, { atBottom: true });
    const el = scrollRef.current;
    if (el) {
      applyProgrammaticScrollTop(el, el.scrollHeight);
    }
  }, [scrollToBottomSignal, activeSessionId, applyProgrammaticScrollTop]);

  // Keep pinned to the bottom during streaming / run updates ONLY when sticky auto-scroll is armed.
  const latestRun = runs[runs.length - 1];
  const streamTickKey = latestRun
    ? `${runs.length}:${latestRun.id}:${latestRun.status}:${latestRun.text?.length ?? 0}:${latestRun.thinking?.length ?? 0}:${latestRun.steps.length}:${ Boolean(latestRun.askUser)}:${Boolean(latestRun.stepHandoff)}`
    : 'empty';

  useIsomorphicLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !atBottomRef.current) return;
    applyProgrammaticScrollTop(el, el.scrollHeight);
  }, [streamTickKey, applyProgrammaticScrollTop]);

  // Also keep pinned if async rendered content (such as Mermaid diagrams or tables) resizes while at bottom,
  // or finish restoring a mid-thread scroll offset that was clamped before async content expanded.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const content = contentRef.current;
    const el = scrollRef.current;
    if (!content || !el) return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) {
        applyProgrammaticScrollTop(el, el.scrollHeight);
        return;
      }
      if (pendingRestoreScrollTopRef.current !== null) {
        const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        const nextTop = Math.min(maxScrollTop, pendingRestoreScrollTopRef.current);
        applyProgrammaticScrollTop(el, nextTop);
        if (maxScrollTop >= pendingRestoreScrollTopRef.current) {
          pendingRestoreScrollTopRef.current = null;
        }
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [applyProgrammaticScrollTop, runs.length]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (
      lastProgrammaticTargetRef.current !== null &&
      Math.abs(el.scrollTop - lastProgrammaticTargetRef.current) <= 1
    ) {
      lastProgrammaticTargetRef.current = null;
      return;
    }
    lastProgrammaticTargetRef.current = null;
    pendingRestoreScrollTopRef.current = null;
    const position = deriveScrollPositionFromMetrics({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    });
    atBottomRef.current = position.atBottom;
    setAtBottom(position.atBottom);
    writeSessionScrollPosition(activeSessionId, position);
  }, [activeSessionId]);

  const handleJumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    pendingRestoreScrollTopRef.current = null;
    atBottomRef.current = true;
    setAtBottom(true);
    writeSessionScrollPosition(activeSessionId, { atBottom: true });
    if (el) {
      applyProgrammaticScrollTop(el, el.scrollHeight);
    }
  }, [activeSessionId, applyProgrammaticScrollTop]);

  const showJumpToLatest = runs.length > 0 && !atBottom;
  const sessionRunning = runs.some((r) => r.status === 'RUNNING');
  const turnEditingSupported = Boolean(onEditLatestTurn || onRetryLatestTurn);

  const resolveDefaultReplyActions = (run: AgentRunView): React.ReactNode => {
    if (run.status === 'RUNNING') return null;
    const copyText =
      run.text ??
      (run.status === 'SUCCEEDED' && run.result && !run.stepHandoff
        ? t(run.result.summary.zh, run.result.summary.en)
        : '');
    if (!copyText.trim()) return null;
    return <ReplyActionsBar text={copyText} />;
  };

  return (
    <div className="conversation-thread-wrap" data-testid="conversation-thread-wrap">
      <div
        ref={scrollRef}
        className="agent-panel-body conversation-thread"
        data-testid="conversation-thread"
        onScroll={handleScroll}
      >
        {topNoticeSlot}
        {runs.length === 0 ? (
          <div className="agent-panel-empty" data-testid="agent-panel-empty">
            <span className="agent-panel-empty-mark" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <p className="agent-panel-empty-text">
              {onSubmitStarterPrompt
                ? t(
                    '这是一段新的对话。直接描述你的目标，进展和结果都会显示在这里。',
                    'A fresh conversation. Describe what you need; progress and results show up here.',
                  )
                : t(
                    'AI 助手在这里展示当前步骤的进展与结果。',
                    'The AI Assistant shows progress and results for this step here.',
                  )}
            </p>
            {onSubmitStarterPrompt && starterPrompts && starterPrompts.length > 0 && (
              <div className="agent-panel-starters" data-testid="agent-panel-starters">
                {starterPrompts.map((starter, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="agent-panel-starter"
                    disabled={composerDisabled}
                    onClick={() => void onSubmitStarterPrompt(t(starter.zh, starter.en))}
                  >
                    {t(starter.zh, starter.en)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div ref={contentRef} className="conversation-turn-list">
            {runs.map((run, index) => {
              const isLatestTurn = index === runs.length - 1;
              return (
                <div
                  key={run.id}
                  className="conversation-turn"
                  data-testid="conversation-turn"
                  data-run-id={run.id}
                  data-run-status={run.status}
                >
                  <UserMessageItem
                    run={run}
                    isLatestTurn={isLatestTurn}
                    sessionRunning={sessionRunning}
                    turnEditingSupported={turnEditingSupported}
                    {...(isLatestTurn && onEditLatestTurn
                      ? { onEditLatestTurn: (nextPrompt) => onEditLatestTurn(run, nextPrompt) }
                      : {})}
                    {...(isLatestTurn && onRetryLatestTurn
                      ? { onRetryLatestTurn: () => onRetryLatestTurn(run) }
                      : {})}
                    {...(renderUserActions
                      ? { actionsSlot: renderUserActions(run, { isLatestTurn }) }
                      : {})}
                  />
                  <AssistantReplyItem
                    run={run}
                    {...(now !== undefined ? { now } : {})}
                    {...(onCancelRun ? { onCancel: () => onCancelRun(run.id) } : {})}
                    {...(isLatestTurn && !sessionRunning && (onRetryLatestTurn || onRetryRun)
                      ? {
                          onRetry: () =>
                            onRetryLatestTurn
                              ? void onRetryLatestTurn(run)
                              : onRetryRun?.(run.id),
                        }
                      : {})}
                    {...(onOpenRunArtifact
                      ? { onOpenArtifact: () => onOpenRunArtifact(run.id) }
                      : {})}
                    {...(onOpenPlatformSettings ? { onOpenPlatformSettings } : {})}
                    {...(onOpenLlmCenter ? { onOpenLlmCenter } : {})}
                    {...(onHoverAnchor ? { onHoverAnchor } : {})}
                    {...(onAnswerAskUser
                      ? {
                          onAnswerAskUser: (promptId, selectedAnswers, freeformText) =>
                            onAnswerAskUser(run.id, promptId, selectedAnswers, freeformText),
                        }
                      : {})}
                    {...(onAcceptStepHandoff
                      ? {
                          onAcceptStepHandoff: (handoffId) =>
                            onAcceptStepHandoff(run.id, handoffId),
                        }
                      : {})}
                    {...(onDeclineStepHandoff
                      ? {
                          onDeclineStepHandoff: (handoffId) =>
                            onDeclineStepHandoff(run.id, handoffId),
                        }
                      : {})}
                    {...(onOpenHandoffTargetStep ? { onOpenHandoffTargetStep } : {})}
                    {...(run.stepHandoff && handoffBusyById?.[run.stepHandoff.id]
                      ? { handoffBusyAction: handoffBusyById[run.stepHandoff.id] }
                      : {})}
                    {...(onTriggerWriteback ? { onTriggerWriteback } : {})}
                    {...(renderRunFooter ? { changeSummarySlot: renderRunFooter(run) } : {})}
                    replyActionsSlot={
                      renderReplyActions ? renderReplyActions(run) : resolveDefaultReplyActions(run)
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showJumpToLatest && (
        <button
          type="button"
          className="conversation-jump-latest"
          data-testid="conversation-jump-to-latest"
          aria-label={t('跳到最新', 'Jump to latest')}
          onClick={handleJumpToLatest}
        >
          <ArrowDown size={13} aria-hidden="true" />
          <span>{t('跳到最新', 'Jump to latest')}</span>
        </button>
      )}
    </div>
  );
}
