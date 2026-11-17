import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  CornerDownRight,
  Database,
  Loader2,
  RotateCcw,
  Send,
  Settings2,
  Square,
} from 'lucide-react';
import {
  PROJECT_STEP_NAMES,
  checkBusinessViewMarkup,
  type ProjectStepId,
} from '../../../packages/business-vocabulary/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { ApprovalCard, Button } from '../beautifui/index.js';
import { MarkdownRenderer } from '../markdown/index.js';
import { StepHandoffCard } from './StepHandoffCard.js';
import { LocalImageThumbnail } from './VisionAttachmentControls.js';
import {
  PLATFORM_UNAVAILABLE_COPY,
  formatAnchorBadgeLabel,
  formatRunElapsed,
  formatRunFailurePresentation,
  formatStepClock,
  selectVisibleProgressSteps,
  type AgentRunStatus,
  type AgentRunStepStatus,
  type AgentRunView,
  type PrototypeTargetAnchor,
} from './agentRun.js';

export interface AgentRunCardProps {
  run: AgentRunView;
  onCancel?: () => void;
  onRetry?: () => void;
  onOpenArtifact?: () => void;
  /** Navigates to platform settings (`llm-center` / `system-settings`). Falls back to `onOpenLlmCenter`. */
  onOpenPlatformSettings?: () => void;
  onOpenLlmCenter?: () => void;
  onHoverAnchor?: (anchor: PrototypeTargetAnchor | null) => void;
  onAnswerAskUser?: (promptId: string, selectedAnswers: string[], freeformText?: string) => void;
  onAcceptStepHandoff?: (handoffId: string) => void | Promise<void>;
  onDeclineStepHandoff?: (handoffId: string) => void | Promise<void>;
  onOpenHandoffTargetStep?: (targetStep: ProjectStepId, targetSessionId?: string) => void;
  handoffBusyAction?: 'accept' | 'decline' | null;
  onTriggerWriteback?: (writebackInterfaceId: string, actionTitle: string) => void;
  /** Hook slot for #65/#67/#70 computed Change Summary & run-level Undo footer. */
  changeSummarySlot?: React.ReactNode;
  /** Opens the "查看细节" / "View details" disclosure initially (useful for tests/inspection). */
  defaultDetailsOpen?: boolean;
  /** Fixed clock for deterministic rendering; defaults to a live one-second tick while running. */
  now?: number;
  className?: string;
}

function useRunClock(running: boolean, fixedNow: number | undefined): number {
  const [now, setNow] = useState(() => fixedNow ?? Date.now());
  useEffect(() => {
    if (!running || fixedNow !== undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, fixedNow]);
  return fixedNow ?? now;
}

function RunStatusGlyph({ status }: { status: AgentRunStatus }) {
  if (status === 'RUNNING') return <Loader2 size={15} className="agent-run-spin" aria-hidden="true" />;
  if (status === 'SUCCEEDED') return <CheckCircle2 size={15} aria-hidden="true" />;
  if (status === 'FAILED') return <AlertTriangle size={15} aria-hidden="true" />;
  return <CircleSlash size={15} aria-hidden="true" />;
}

function StepGlyph({ status }: { status: AgentRunStepStatus }) {
  if (status === 'RUNNING') return <Loader2 size={12} className="agent-run-spin" aria-hidden="true" />;
  if (status === 'DONE') return <CheckCircle2 size={12} aria-hidden="true" />;
  if (status === 'FAILED') return <AlertTriangle size={12} aria-hidden="true" />;
  return <CircleSlash size={12} aria-hidden="true" />;
}

const USER_PROMPT_CLAMP_CHARS = 280;

/** The user's side of a turn. Long prompts fold so the agent's reply stays in view. */
function UserPromptBubble({ text }: { text: string }) {
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > USER_PROMPT_CLAMP_CHARS || text.split('\n').length > 6;
  return (
    <div className={cn('agent-turn-bubble', isLong && !expanded && 'is-clamped')}>
      <p className="agent-turn-bubble-text">{text}</p>
      {isLong && (
        <button
          type="button"
          className="agent-turn-bubble-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('收起', 'Show less') : t('展开全文', 'Show more')}
        </button>
      )}
    </div>
  );
}

/**
 * The single presentation of an AI Assistant turn across the workbench (ADR 0009, Spec #37 §11):
 * Business View shows only a few concise deterministic business-language progress lines;
 * tool call arguments/outputs, thinking, character/token usage, and ADR 0007 diagnostics
 * sit inside "查看细节" / "View details" by default.
 */
export function AgentRunCard({
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
  defaultDetailsOpen = false,
  now: fixedNow,
  className,
}: AgentRunCardProps) {
  const { t } = usePreferences();
  const running = run.status === 'RUNNING';
  const now = useRunClock(running, fixedNow);
  const elapsed = formatRunElapsed(run.startedAt, run.completedAt ?? now);
  const title = t(run.title.zh, run.title.en);
  const safeAriaTitle =
    checkBusinessViewMarkup(title, { plainText: true }).length === 0
      ? title
      : t('AI 助手处理', 'AI Assistant request');
  const handleOpenSettings = onOpenPlatformSettings ?? onOpenLlmCenter;

  const statusLabel: Record<AgentRunStatus, string> = {
    RUNNING: t('进行中', 'Running'),
    SUCCEEDED: t('已完成', 'Done'),
    FAILED: t('失败', 'Failed'),
    CANCELLED: t('已取消', 'Cancelled'),
  };
  const stepStatusLabel: Record<AgentRunStepStatus, string> = {
    RUNNING: t('进行中', 'Running'),
    DONE: t('已完成', 'Done'),
    FAILED: t('失败', 'Failed'),
    STOPPED: t('已停止', 'Stopped'),
  };

  const { visibleSteps, hiddenStepCount } = selectVisibleProgressSteps(run.steps, run.status);
  const visibleStepIds = new Set(visibleSteps.map((s) => s.id));
  const activeVisibleStep = visibleSteps.find((s) => s.status === 'RUNNING');

  const replyChars = (run.text ?? (!run.text && run.result ? t(run.result.summary.zh, run.result.summary.en) : '')).trim().length;
  const thinkingChars = (run.thinking ?? '').trim().length;
  const hasUsageMeta = Boolean(
    run.usage || run.model || run.providerName || replyChars > 0 || thinkingChars > 0,
  );
  const hasDiagnostics = Boolean(run.failure || run.visionFallback?.used);
  const hasDetails =
    run.steps.length > 0 || Boolean(run.thinking) || hasUsageMeta || hasDiagnostics;

  const failurePresentation =
    run.status === 'FAILED'
      ? formatRunFailurePresentation(run.failure, run.visionFallback)
      : null;

  return (
    <article
      className={cn('agent-run-card', className)}
      data-testid="agent-run-card"
      data-run-status={run.status}
      aria-label={`${safeAriaTitle} · ${statusLabel[run.status]}`}
    >
      {run.userPrompt ? (
        <div className="agent-turn-user" data-testid="agent-turn-user">
          {run.handoffFrom && (
            <div
              className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground"
              data-testid="agent-turn-handoff-origin"
            >
              <CornerDownRight size={12} aria-hidden="true" />
              <span>
                {run.handoffFrom.sourceStep
                  ? t(
                      `来自「${PROJECT_STEP_NAMES[run.handoffFrom.sourceStep].zh}」步骤的转交请求`,
                      `Handed off from ${PROJECT_STEP_NAMES[run.handoffFrom.sourceStep].en}`,
                    )
                  : t('跨步骤转交请求', 'Handed-off request')}
              </span>
            </div>
          )}
          {run.images && run.images.length > 0 && (
            <div
              className="vision-attachment-strip agent-run-images"
              data-testid="agent-run-images"
              aria-label={t('参考图附件', 'Attached reference images')}
            >
              {run.images.map((img) => (
                <LocalImageThumbnail key={img.id} attachment={img} compact />
              ))}
            </div>
          )}
          <UserPromptBubble text={run.userPrompt} />
        </div>
      ) : null}

      <header className="agent-run-head">
        <span className="agent-run-glyph">
          <RunStatusGlyph status={run.status} />
        </span>
        {run.userPrompt ? (
          <h3 className="visually-hidden">{safeAriaTitle}</h3>
        ) : (
          <h3 className="agent-run-title" title={safeAriaTitle}>
            {title}
          </h3>
        )}
        <span className="agent-run-meta">
          <span className="agent-run-state">{statusLabel[run.status]}</span>
          <time
            className="agent-run-elapsed"
            aria-label={t(`已用时 ${elapsed}`, `Elapsed ${elapsed}`)}
          >
            {elapsed}
          </time>
        </span>
        {running && onCancel && (
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
      </header>

      {!run.userPrompt && run.images && run.images.length > 0 && (
        <div
          className="vision-attachment-strip agent-run-images"
          data-testid="agent-run-images"
          aria-label={t('参考图附件', 'Attached reference images')}
        >
          {run.images.map((img) => (
            <LocalImageThumbnail key={img.id} attachment={img} compact />
          ))}
        </div>
      )}

      {running && !activeVisibleStep && (
        <p className="agent-run-live" data-testid="agent-run-live" aria-live="polite">
          {t(run.liveStatus.zh, run.liveStatus.en)}
        </p>
      )}

      {visibleSteps.length > 0 && (
        <ol
          className="agent-run-steps"
          data-testid="agent-run-progress"
          aria-label={t('处理进展', 'Progress')}
        >
          {visibleSteps.map((step) => {
            const label = t(step.label.zh, step.label.en);
            const isActiveLine = running && activeVisibleStep?.id === step.id;
            return (
              <li
                key={step.id}
                className="agent-run-step"
                data-step-status={step.status}
                {...(step.toolName ? { 'data-tool-name': step.toolName } : {})}
                {...(onHoverAnchor && step.targetAnchor
                  ? {
                      onMouseEnter: () => onHoverAnchor(step.targetAnchor ?? null),
                      onMouseLeave: () => onHoverAnchor(null),
                    }
                  : {})}
              >
                <div className="agent-run-step-row">
                  <span className="agent-run-step-glyph">
                    <StepGlyph status={step.status} />
                  </span>
                  <span
                    className="agent-run-step-label"
                    {...(isActiveLine
                      ? { 'data-testid': 'agent-run-live', 'aria-live': 'polite' as const }
                      : {})}
                  >
                    {label}
                  </span>
                  <span className="visually-hidden">{stepStatusLabel[step.status]}</span>
                </div>
              </li>
            );
          })}
          {hiddenStepCount > 0 && (
            <li className="agent-run-steps-more">
              {t(
                `其余 ${hiddenStepCount} 项进展见「查看细节」`,
                `${hiddenStepCount} more in View details`,
              )}
            </li>
          )}
        </ol>
      )}

      {hasDetails && (
        <details
          className="agent-run-details"
          data-testid="agent-run-details"
          open={defaultDetailsOpen ? true : undefined}
        >
          <summary className="agent-run-details-summary" data-testid="agent-run-details-toggle">
            <ChevronRight size={12} className="agent-run-chevron" aria-hidden="true" />
            <span>{t('查看细节', 'View details')}</span>
          </summary>

          <div className="agent-run-details-body" data-testid="agent-run-details-body">
            {run.steps.length > 0 && (
              <section
                className="agent-run-details-section"
                data-testid="agent-run-tool-details"
              >
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
                        {...(!visibleStepIds.has(step.id) && step.toolName
                          ? { 'data-tool-name': step.toolName }
                          : {})}
                        {...(step.toolName ? { 'data-trace-tool-name': step.toolName } : {})}
                        {...(onHoverAnchor && step.targetAnchor
                          ? {
                              onMouseEnter: () => onHoverAnchor(step.targetAnchor ?? null),
                              onMouseLeave: () => onHoverAnchor(null),
                            }
                          : {})}
                      >
                        <div className="agent-run-trace-head">
                          <span className="agent-run-step-glyph">
                            <StepGlyph status={step.status} />
                          </span>
                          <span className="agent-run-step-label">{label}</span>
                          {step.toolName && (
                            <code className="agent-run-trace-code">{step.toolName}</code>
                          )}
                          {anchorBadge && (
                            <span
                              className="agent-run-step-anchor"
                              data-testid="agent-run-step-anchor"
                              {...(step.targetAnchor?.screenId
                                ? { 'data-anchor-screen-id': step.targetAnchor.screenId }
                                : {})}
                              {...(step.targetAnchor?.elementId
                                ? { 'data-anchor-element-id': step.targetAnchor.elementId }
                                : {})}
                              title={step.targetAnchor?.label || anchorBadge}
                            >
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

            {run.thinking && (
              <section className="agent-run-details-section" data-testid="agent-run-thinking">
                <div className="agent-run-details-label">{t('思考过程', 'Thinking')}</div>
                <pre className="agent-run-detail">{run.thinking}</pre>
              </section>
            )}

            {hasUsageMeta && (
              <section className="agent-run-details-section" data-testid="agent-run-usage">
                <div className="agent-run-details-label">{t('用量', 'Usage')}</div>
                <p className="agent-run-details-meta">
                  {[
                    run.usage
                      ? t(
                          `输入 ${run.usage.inputTokens} · 输出 ${run.usage.outputTokens} · 共 ${run.usage.totalTokens} tokens`,
                          `Input ${run.usage.inputTokens} · Output ${run.usage.outputTokens} · Total ${run.usage.totalTokens} tokens`,
                        )
                      : '',
                    replyChars > 0 ? t(`回复 ${replyChars} 字`, `Reply ${replyChars} chars`) : '',
                    thinkingChars > 0
                      ? t(`思考 ${thinkingChars} 字`, `Thinking ${thinkingChars} chars`)
                      : '',
                    run.providerName || '',
                    run.model || '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </section>
            )}

            {hasDiagnostics && (
              <section
                className="agent-run-details-section"
                data-testid="agent-run-diagnostic-details"
              >
                <div className="agent-run-details-label">{t('诊断信息', 'Diagnostics')}</div>
                <div className="agent-run-diagnostic-box">
                  {run.failure ? (
                    <>
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
                      {run.failure.remediation && (
                        <p className="agent-run-details-meta">{run.failure.remediation}</p>
                      )}
                    </>
                  ) : run.visionFallback?.used ? (
                    <p className="agent-run-details-meta">
                      {[
                        'code=VISION_UNSUPPORTED',
                        run.visionFallback.providerName
                          ? `provider=${run.visionFallback.providerName}`
                          : '',
                        run.model ? `model=${run.model}` : '',
                        run.visionFallback.notice || '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ) : null}
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

      {run.text && (
        <MarkdownRenderer
          content={run.text}
          isStreaming={running}
          className="agent-run-text agent-run-reply"
          testId="agent-run-text"
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
        <footer className="agent-run-outcome" data-testid="agent-run-result">
          {!run.text && (
            <MarkdownRenderer
              content={t(run.result.summary.zh, run.result.summary.en)}
              className="agent-run-outcome-text agent-run-reply"
            />
          )}
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
                        onClick={() => onTriggerWriteback(rec.writebackInterfaceId, rec.actionTitle)}
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
            <div
              className="agent-run-policy-item"
              data-testid="agent-run-extraction-chip"
            >
              <div className="agent-run-policy-info">
                <strong>
                  <Database size={12} aria-hidden="true" style={{ display: 'inline', marginRight: 5, verticalAlign: '-1px' }} />
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
              <Button
                variant="secondary"
                size="xs"
                data-testid="agent-run-open-artifact-btn"
                onClick={onOpenArtifact}
              >
                {t(run.result.artifactLabel.zh, run.result.artifactLabel.en)}
                <ArrowRight size={11} aria-hidden="true" />
              </Button>
            )}
        </footer>
      )}

      {!running && changeSummarySlot && (
        <div className="agent-run-change-slot" data-testid="agent-run-change-slot">
          {changeSummarySlot}
        </div>
      )}

      {run.status === 'FAILED' && failurePresentation && (
        <footer className="agent-run-outcome" data-testid="agent-run-failure" role="alert">
          <p className="agent-run-outcome-text">
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
        </footer>
      )}

      {run.status === 'CANCELLED' && (
        <footer className="agent-run-outcome" data-testid="agent-run-cancelled">
          <p className="agent-run-outcome-text">
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
        </footer>
      )}
    </article>
  );
}
