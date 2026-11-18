import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Database,
  Loader2,
  RotateCcw,
  Send,
  Settings2,
  Square,
} from 'lucide-react';
import type { ProjectStepId } from '../../../../packages/business-vocabulary/index.js';
import { usePreferences } from '../../../i18n.js';
import { ApprovalCard, Button } from '../../beautifui/index.js';
import { MarkdownRenderer } from '../../markdown/index.js';
import { StepHandoffCard } from '../StepHandoffCard.js';
import {
  PLATFORM_UNAVAILABLE_COPY,
  formatAnchorBadgeLabel,
  formatRunFailurePresentation,
  formatStepClock,
  selectVisibleProgressSteps,
  type AgentRunStepStatus,
  type AgentRunView,
  type PrototypeTargetAnchor,
} from '../agentRun.js';

function StepStatusGlyph({ status }: { status: AgentRunStepStatus }) {
  if (status === 'RUNNING') {
    return <Loader2 size={12} className="agent-run-spin" aria-hidden="true" />;
  }
  if (status === 'DONE') return <CheckCircle2 size={12} aria-hidden="true" />;
  if (status === 'FAILED') return <AlertTriangle size={12} aria-hidden="true" />;
  return <CircleSlash size={12} aria-hidden="true" />;
}

export interface AssistantReplyItemProps {
  run: AgentRunView;
  onCancel?: () => void;
  onRetry?: () => void;
  onOpenArtifact?: () => void;
  onOpenPlatformSettings?: () => void;
  onOpenLlmCenter?: () => void;
  onHoverAnchor?: (anchor: PrototypeTargetAnchor | null) => void;
  onAnswerAskUser?: (promptId: string, selectedAnswers: string[], freeformText?: string) => void;
  onAcceptStepHandoff?: (handoffId: string) => void | Promise<void>;
  onDeclineStepHandoff?: (handoffId: string) => void | Promise<void>;
  onOpenHandoffTargetStep?: (targetStep: ProjectStepId, targetSessionId?: string) => void;
  handoffBusyAction?: 'accept' | 'decline' | null;
  onTriggerWriteback?: (writebackInterfaceId: string, actionTitle: string) => void;
  /** Slot for Change Summary & Undo (upgraded to inline strip by #80 in Wave 2). */
  changeSummarySlot?: React.ReactNode;
  /** Optional reply-level action bar slot (for #81 copy reply action). */
  replyActionsSlot?: React.ReactNode;
}

/**
 * Renders the assistant's side of a turn as continuous desktop chat prose without
 * task-card borders or status pills (ADR 0009, 2026-11-18 amendment).
 * Owned by Wave 2 #80 for folded Work Process block, inline Change Summary strip, and failure notice polish.
 */
export function AssistantReplyItem({
  run,
  onCancel,
  onRetry,
  onOpenArtifact,
  onOpenPlatformSettings,
  onOpenLlmCenter,
  onHoverAnchor,
  onAnswerAskUser,
  onAcceptStepHandoff,
  onDeclineStepHandoff,
  onOpenHandoffTargetStep,
  handoffBusyAction,
  onTriggerWriteback,
  changeSummarySlot,
  replyActionsSlot,
}: AssistantReplyItemProps) {
  const { t } = usePreferences();
  const running = run.status === 'RUNNING';
  const handleOpenSettings = onOpenPlatformSettings ?? onOpenLlmCenter;

  const { visibleSteps } = selectVisibleProgressSteps(run.steps, run.status);
  const activeVisibleStep = visibleSteps.find((s) => s.status === 'RUNNING');
  const liveLabel = activeVisibleStep
    ? t(activeVisibleStep.label.zh, activeVisibleStep.label.en)
    : t(run.liveStatus.zh, run.liveStatus.en);

  const hasWorkTrace =
    run.steps.length > 0 || Boolean(run.thinking) || Boolean(run.failure);

  const failurePresentation =
    run.status === 'FAILED'
      ? formatRunFailurePresentation(run.failure, run.visionFallback)
      : null;

  const markdownBody =
    run.text ??
    (run.status === 'SUCCEEDED' && run.result && !run.stepHandoff
      ? t(run.result.summary.zh, run.result.summary.en)
      : '');

  return (
    <div
      className="conversation-assistant-reply"
      data-testid="conversation-assistant-reply"
      data-run-status={run.status}
    >
      {running && (
        <div
          className="conversation-live-bar"
          data-testid="conversation-live-status"
          aria-live="polite"
        >
          <Loader2 size={13} className="agent-run-spin conversation-live-icon" aria-hidden="true" />
          <span className="conversation-live-text">{liveLabel}</span>
          {run.reconnecting && (
            <span
              className="conversation-reconnecting-badge"
              data-testid="agent-run-reconnecting-badge"
            >
              {t('自动重连中', 'Reconnecting')}
            </span>
          )}
          {onCancel && (
            <Button
              variant="ghost"
              size="xs"
              data-testid="agent-run-cancel-btn"
              onClick={onCancel}
            >
              <Square size={10} aria-hidden="true" />
              {t('取消', 'Cancel')}
            </Button>
          )}
        </div>
      )}

      {hasWorkTrace && (
        <details className="conversation-work-details" data-testid="conversation-work-details">
          <summary
            className="conversation-work-summary"
            data-testid="conversation-work-toggle"
          >
            <ChevronRight size={12} className="agent-run-chevron" aria-hidden="true" />
            <span>{t('查看处理过程', 'View work process')}</span>
          </summary>
          <div className="agent-run-details-body" data-testid="conversation-work-body">
            {run.thinking && (
              <section className="agent-run-details-section" data-testid="agent-run-thinking">
                <div className="agent-run-details-label">{t('思考过程', 'Thinking')}</div>
                <pre className="agent-run-detail">{run.thinking}</pre>
              </section>
            )}
            {run.steps.length > 0 && (
              <section className="agent-run-details-section" data-testid="agent-run-tool-details">
                <div className="agent-run-details-label">
                  {t(`工具调用 (${run.steps.length})`, `Tool calls (${run.steps.length})`)}
                </div>
                <ol className="agent-run-trace-list">
                  {run.steps.map((step) => {
                    const label = t(step.label.zh, step.label.en);
                    const clock = formatStepClock(step.at);
                    const anchorBadge = formatAnchorBadgeLabel(step.targetAnchor);
                    return (
                      <li
                        key={step.id}
                        className="agent-run-trace-item"
                        data-step-status={step.status}
                        {...(step.toolName ? { 'data-tool-name': step.toolName } : {})}
                        {...(onHoverAnchor && step.targetAnchor
                          ? {
                              onMouseEnter: () => onHoverAnchor(step.targetAnchor ?? null),
                              onMouseLeave: () => onHoverAnchor(null),
                            }
                          : {})}
                      >
                        <div className="agent-run-trace-head">
                          <span className="agent-run-step-glyph">
                            <StepStatusGlyph status={step.status} />
                          </span>
                          <span className="agent-run-step-label">{label}</span>
                          {step.toolName && (
                            <code className="agent-run-trace-code">{step.toolName}</code>
                          )}
                          {anchorBadge && (
                            <span className="agent-run-step-anchor" title={anchorBadge}>
                              {anchorBadge}
                            </span>
                          )}
                          {clock && <span className="agent-run-step-clock">{clock}</span>}
                        </div>
                        {step.detail && <pre className="agent-run-detail">{step.detail}</pre>}
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
            {run.failure && (
              <section
                className="agent-run-details-section"
                data-testid="agent-run-diagnostic-details"
              >
                <div className="agent-run-details-label">{t('诊断信息', 'Diagnostics')}</div>
                <div className="agent-run-diagnostic-box">
                  <p className="agent-run-details-meta">
                    {[
                      run.failure.code ? `code=${run.failure.code}` : '',
                      run.failure.statusCode !== undefined
                        ? `status=${run.failure.statusCode}`
                        : '',
                      run.failure.providerName ? `provider=${run.failure.providerName}` : '',
                      run.failure.baseUrl ? `baseUrl=${run.failure.baseUrl}` : '',
                      run.failure.model ? `model=${run.failure.model}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <pre className="agent-run-detail">{run.failure.message}</pre>
                </div>
              </section>
            )}
          </div>
        </details>
      )}

      {run.status !== 'FAILED' && run.visionFallback?.used && (
        <div
          className="agent-run-platform-notice"
          data-testid="agent-run-platform-notice"
          role="status"
        >
          <p className="agent-run-outcome-text">
            {t(
              `${PLATFORM_UNAVAILABLE_COPY.zh}（当前模型不支持查看图片，本次仅按文字说明处理）。`,
              `${PLATFORM_UNAVAILABLE_COPY.en} (the current model cannot view images; only text notes were used).`,
            )}
          </p>
          {handleOpenSettings && (
            <div className="agent-run-actions">
              <Button
                variant="ghost"
                size="xs"
                data-testid="agent-run-open-platform-settings-btn"
                onClick={handleOpenSettings}
              >
                <Settings2 size={11} aria-hidden="true" />
                {t('前往平台设置', 'Open platform settings')}
              </Button>
            </div>
          )}
        </div>
      )}

      {markdownBody.trim().length > 0 && (
        <MarkdownRenderer
          content={markdownBody}
          isStreaming={running}
          className="conversation-markdown agent-run-reply"
          testId="conversation-assistant-markdown"
        />
      )}

      {run.askUser && (
        <div className="agent-run-hitl">
          <ApprovalCard
            prompt={run.askUser}
            disabled={running && Boolean(run.askUser.answered)}
            {...(onAnswerAskUser
              ? {
                  onSubmit: (selectedOptions, customNote) =>
                    onAnswerAskUser(run.askUser!.id, selectedOptions, customNote),
                }
              : {})}
          />
        </div>
      )}

      {run.stepHandoff && (
        <div className="agent-run-hitl">
          <StepHandoffCard
            handoff={run.stepHandoff}
            disabled={running}
            {...(handoffBusyAction !== undefined ? { busyAction: handoffBusyAction } : {})}
            {...(onAcceptStepHandoff ? { onAccept: onAcceptStepHandoff } : {})}
            {...(onDeclineStepHandoff ? { onDecline: onDeclineStepHandoff } : {})}
            {...(onOpenHandoffTargetStep ? { onOpenTargetStep: onOpenHandoffTargetStep } : {})}
          />
        </div>
      )}

      {run.status === 'SUCCEEDED' && run.result && (
        <>
          {run.artifact?.kind === 'REASONING_POLICY' &&
            run.artifact.policyRecommendations.length > 0 && (
              <div className="agent-run-policy-list" data-testid="agent-run-policy-list">
                {run.artifact.policyRecommendations.map((rec, idx) => (
                  <div key={`${rec.writebackInterfaceId}-${idx}`} className="agent-run-policy-item">
                    <div className="agent-run-policy-info">
                      <strong>{rec.actionTitle}</strong>
                      <span>
                        {rec.targetObject} · {rec.expectedImpact}
                      </span>
                    </div>
                    {onTriggerWriteback && (
                      <Button
                        variant="accent"
                        size="xs"
                        data-testid="trigger-policy-writeback-btn"
                        onClick={() =>
                          onTriggerWriteback(rec.writebackInterfaceId, rec.actionTitle)
                        }
                      >
                        <Send size={10} aria-hidden="true" />
                        {t('回写业务动作', 'Write Back')}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

          {run.artifact?.kind === 'EXTRACTION_JOB' && (
            <div className="agent-run-policy-item" data-testid="agent-run-extraction-chip">
              <div className="agent-run-policy-info">
                <strong>
                  <Database
                    size={12}
                    aria-hidden="true"
                    style={{ display: 'inline', marginRight: 5, verticalAlign: '-1px' }}
                  />
                  {run.artifact.systemName}
                </strong>
                <span>
                  {t(
                    `已萃取 ${run.artifact.candidateCount} 项候选`,
                    `${run.artifact.candidateCount} candidates extracted`,
                  )}
                </span>
              </div>
              {onOpenArtifact && (
                <Button
                  variant="accent"
                  size="xs"
                  data-testid="agent-run-open-artifact-btn"
                  onClick={onOpenArtifact}
                >
                  {t('前往候选审查', 'Review Candidates')}
                  <ArrowRight size={11} aria-hidden="true" />
                </Button>
              )}
            </div>
          )}

          {run.artifact?.kind !== 'EXTRACTION_JOB' &&
            run.result.artifactLabel &&
            onOpenArtifact && (
              <div className="conversation-artifact-actions">
                <Button
                  variant="secondary"
                  size="xs"
                  data-testid="agent-run-open-artifact-btn"
                  onClick={onOpenArtifact}
                >
                  {t(run.result.artifactLabel.zh, run.result.artifactLabel.en)}
                  <ArrowRight size={11} aria-hidden="true" />
                </Button>
              </div>
            )}
        </>
      )}

      {!running && changeSummarySlot && (
        <div className="agent-run-change-slot" data-testid="conversation-change-slot">
          {changeSummarySlot}
        </div>
      )}

      {run.status === 'FAILED' && failurePresentation && (
        <div
          className="conversation-status-notice is-failed"
          data-testid="agent-run-failure"
          role="alert"
        >
          <p className="conversation-status-notice-text">
            {t(failurePresentation.summary.zh, failurePresentation.summary.en)}
          </p>
          <div className="agent-run-actions">
            {onRetry && (
              <Button
                variant="secondary"
                size="xs"
                data-testid="agent-run-retry-btn"
                onClick={onRetry}
              >
                <RotateCcw size={11} aria-hidden="true" />
                {t('重试', 'Retry')}
              </Button>
            )}
            {failurePresentation.isPlatformProblem && handleOpenSettings && (
              <Button
                variant="ghost"
                size="xs"
                data-testid="agent-run-open-platform-settings-btn"
                onClick={handleOpenSettings}
              >
                <Settings2 size={11} aria-hidden="true" />
                {t('前往平台设置', 'Open platform settings')}
              </Button>
            )}
          </div>
        </div>
      )}

      {run.status === 'CANCELLED' && (
        <div className="conversation-status-notice is-cancelled" data-testid="agent-run-cancelled">
          <p className="conversation-status-notice-text">
            {t('已在完成前取消。', 'Cancelled before it finished.')}
          </p>
          {onRetry && (
            <div className="agent-run-actions">
              <Button
                variant="secondary"
                size="xs"
                data-testid="agent-run-retry-btn"
                onClick={onRetry}
              >
                <RotateCcw size={11} aria-hidden="true" />
                {t('重试', 'Retry')}
              </Button>
            </div>
          )}
        </div>
      )}

      {!running && replyActionsSlot && (
        <div className="conversation-reply-actions" data-testid="conversation-reply-actions">
          {replyActionsSlot}
        </div>
      )}
    </div>
  );
}
