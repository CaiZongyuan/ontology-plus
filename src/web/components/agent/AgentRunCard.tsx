import React, { useEffect, useState } from 'react';
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
  Square,
} from 'lucide-react';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { ApprovalCard, Button } from '../beautifui/index.js';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import { LocalImageThumbnail } from './VisionAttachmentControls.js';
import {
  formatAnchorBadgeLabel,
  formatRunElapsed,
  formatStepClock,
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
  onOpenLlmCenter?: () => void;
  onHoverAnchor?: (anchor: PrototypeTargetAnchor | null) => void;
  onAnswerAskUser?: (promptId: string, selectedAnswers: string[], freeformText?: string) => void;
  onTriggerWriteback?: (writebackInterfaceId: string, actionTitle: string) => void;
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
 * The single presentation of an Agent Run across the workbench (ADR 0009):
 * live status, elapsed time and cancel on top; expandable steps; thinking
 * collapsed by default; then either the result with a link to the artifact,
 * or the real failure with retry.
 */
export function AgentRunCard({
  run,
  onCancel,
  onRetry,
  onOpenArtifact,
  onOpenLlmCenter,
  onHoverAnchor,
  onAnswerAskUser,
  onTriggerWriteback,
  now: fixedNow,
  className,
}: AgentRunCardProps) {
  const { t } = usePreferences();
  const running = run.status === 'RUNNING';
  const now = useRunClock(running, fixedNow);
  const elapsed = formatRunElapsed(run.startedAt, run.completedAt ?? now);
  const title = t(run.title.zh, run.title.en);

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

  const failedStepCount = run.steps.filter((step) => step.status === 'FAILED').length;
  const stepList = (
    <ol className="agent-run-steps" aria-label={t('步骤', 'Steps')}>
      {run.steps.map((step) => {
        const label = t(step.label.zh, step.label.en);
        const clock = formatStepClock(step.at);
        const anchorBadge = formatAnchorBadgeLabel(step.targetAnchor);
        const row = (
          <>
            <span className="agent-run-step-glyph">
              <StepGlyph status={step.status} />
            </span>
            <span className="agent-run-step-label">{label}</span>
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
            <span className="visually-hidden">{stepStatusLabel[step.status]}</span>
            {clock && <span className="agent-run-step-clock">{clock}</span>}
          </>
        );
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
            {step.detail ? (
              <details>
                <summary className="agent-run-step-row">
                  {row}
                  <ChevronRight size={12} className="agent-run-chevron" aria-hidden="true" />
                </summary>
                <pre className="agent-run-detail">{step.detail}</pre>
              </details>
            ) : (
              <div className="agent-run-step-row">{row}</div>
            )}
          </li>
        );
      })}
    </ol>
  );

  return (
    <article
      className={cn('agent-run-card', className)}
      data-testid="agent-run-card"
      data-run-status={run.status}
      aria-label={`${title} · ${statusLabel[run.status]}`}
    >
      {run.userPrompt ? (
        <div className="agent-turn-user" data-testid="agent-turn-user">
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
          <h3 className="visually-hidden">{title}</h3>
        ) : (
          <h3 className="agent-run-title" title={title}>
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

      {running && (
        <p className="agent-run-live" data-testid="agent-run-live" aria-live="polite">
          {t(run.liveStatus.zh, run.liveStatus.en)}
        </p>
      )}

      {run.steps.length > 0 &&
        (running ? (
          stepList
        ) : (
          <details className="agent-run-steps-fold" data-testid="agent-run-steps-fold">
            <summary>
              <ChevronRight size={12} className="agent-run-chevron" aria-hidden="true" />
              {t(`执行了 ${run.steps.length} 个步骤`, `${run.steps.length} step${run.steps.length === 1 ? '' : 's'}`)}
              {failedStepCount > 0 && (
                <span className="agent-run-steps-fold-bad">
                  {t(`${failedStepCount} 个失败`, `${failedStepCount} failed`)}
                </span>
              )}
            </summary>
            {stepList}
          </details>
        ))}

      {running && run.streamingText && (
        <MarkdownRenderer
          content={run.streamingText}
          isStreaming
          className="agent-run-reply"
          testId="agent-run-streaming-text"
        />
      )}

      {run.thinking && (
        <details className="agent-run-thinking" data-testid="agent-run-thinking">
          <summary>
            <ChevronRight size={12} className="agent-run-chevron" aria-hidden="true" />
            {t('思考过程', 'Thinking')}
          </summary>
          <pre className="agent-run-detail">{run.thinking}</pre>
        </details>
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

      {run.status === 'SUCCEEDED' && run.result && (
        <footer className="agent-run-outcome" data-testid="agent-run-result">
          <MarkdownRenderer
            content={t(run.result.summary.zh, run.result.summary.en)}
            className="agent-run-outcome-text agent-run-reply"
          />
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
                    `已萃取 ${run.artifact.candidateCount} 项本体候选`,
                    `${run.artifact.candidateCount} ontology candidates extracted`,
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

      {run.status === 'FAILED' && (
        <footer className="agent-run-outcome" data-testid="agent-run-failure" role="alert">
          <p className="agent-run-outcome-text">
            {run.failure?.message ?? t('运行失败，未返回原因。', 'The run failed without a reason.')}
          </p>
          {run.failure?.remediation && (
            <p className="agent-run-remediation">{run.failure.remediation}</p>
          )}
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
            {onOpenLlmCenter && (
              <Button
                variant="ghost"
                size="xs"
                data-testid="agent-run-llm-center-btn"
                onClick={onOpenLlmCenter}
              >
                {t('前往大模型中心', 'Open LLM Center')}
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
                {t('重新运行', 'Run again')}
              </Button>
            </div>
          )}
        </footer>
      )}

      {run.model && <p className="agent-run-model">{run.model}</p>}
    </article>
  );
}
