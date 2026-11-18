import React from 'react';
import {
  ArrowRight,
  ChevronRight,
  Database,
  RotateCcw,
  Send,
  Settings2,
} from 'lucide-react';
import type { ProjectStepId } from '../../../../packages/business-vocabulary/index.js';
import { usePreferences } from '../../../i18n.js';
import { ApprovalCard, Button } from '../../beautifui/index.js';
import { ChangeSummaryDisplayVariantContext } from '../../history/index.js';
import { MarkdownRenderer } from '../../markdown/index.js';
import { StepHandoffCard } from '../StepHandoffCard.js';
import {
  PLATFORM_UNAVAILABLE_COPY,
  formatRunFailurePresentation,
  type AgentRunFailure,
  type AgentRunView,
  type AgentRunVisionFallback,
  type PrototypeTargetAnchor,
} from '../agentRun.js';
import { WorkProcessBlock } from './WorkProcessBlock.js';
import './work-process.css';

export {
  WorkProcessBlock,
  clearWorkProcessExpansionForTests,
  computeThinkingSeconds,
  isToolStepExpanded,
  isWorkBlockExpanded,
  setToolStepExpanded,
  setWorkBlockExpanded,
  type WorkProcessBlockProps,
} from './WorkProcessBlock.js';

function TuckedDiagnosticsDetails({
  failure,
  visionFallback,
  model,
}: {
  failure?: AgentRunFailure;
  visionFallback?: AgentRunVisionFallback;
  model?: string;
}) {
  const { t } = usePreferences();

  if (!failure && !visionFallback?.used) {
    return null;
  }

  return (
    <details
      className="conversation-diagnostic-details"
      data-testid="conversation-diagnostic-details"
    >
      <summary
        className="conversation-diagnostic-summary"
        data-testid="conversation-diagnostic-toggle"
      >
        <ChevronRight size={12} className="agent-run-chevron" aria-hidden="true" />
        <span>{t('查看详情', 'View details')}</span>
      </summary>
      <div
        className="conversation-diagnostic-body agent-run-diagnostic-box"
        data-testid="agent-run-diagnostic-details"
      >
        {failure ? (
          <>
            <p className="agent-run-details-meta">
              {[
                failure.code ? `code=${failure.code}` : '',
                failure.statusCode !== undefined ? `status=${failure.statusCode}` : '',
                failure.providerName ? `provider=${failure.providerName}` : '',
                failure.baseUrl ? `baseUrl=${failure.baseUrl}` : '',
                failure.model ? `model=${failure.model}` : model ? `model=${model}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {failure.message && (
              <pre className="work-process-tool-pre">{failure.message}</pre>
            )}
            {failure.remediation && (
              <p className="agent-run-details-meta">{failure.remediation}</p>
            )}
          </>
        ) : visionFallback?.used ? (
          <p className="agent-run-details-meta">
            {[
              'code=VISION_UNSUPPORTED',
              visionFallback.providerName ? `provider=${visionFallback.providerName}` : '',
              model ? `model=${model}` : '',
              visionFallback.notice || '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
      </div>
    </details>
  );
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
  /** Slot for Change Summary & Undo (rendered as Variant B inline strip via context). */
  changeSummarySlot?: React.ReactNode;
  /** Optional reply-level action bar slot (for #81 copy reply action). */
  replyActionsSlot?: React.ReactNode;
}

/**
 * Renders the assistant's side of a turn as continuous desktop chat prose without
 * task-card borders or status pills (ADR 0009, 2026-11-18 amendment), combining
 * thinking + tool calls into a default-collapsed Work Process block and anchoring
 * the Change Summary as an inline strip at the end of the reply (#80).
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
      <WorkProcessBlock
        run={run}
        {...(onCancel ? { onCancel } : {})}
        {...(onHoverAnchor ? { onHoverAnchor } : {})}
      />

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
          <TuckedDiagnosticsDetails
            visionFallback={run.visionFallback}
            {...(run.model ? { model: run.model } : {})}
          />
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
          <ChangeSummaryDisplayVariantContext.Provider value="strip">
            {changeSummarySlot}
          </ChangeSummaryDisplayVariantContext.Provider>
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
          <TuckedDiagnosticsDetails
            {...(run.failure ? { failure: run.failure } : {})}
            {...(run.visionFallback ? { visionFallback: run.visionFallback } : {})}
            {...(run.model ? { model: run.model } : {})}
          />
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
