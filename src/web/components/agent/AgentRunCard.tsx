import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Loader2,
  RotateCcw,
  Square,
} from 'lucide-react';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../beautifui/index.js';
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

  return (
    <article
      className={cn('agent-run-card', className)}
      data-testid="agent-run-card"
      data-run-status={run.status}
      aria-label={`${title} · ${statusLabel[run.status]}`}
    >
      <header className="agent-run-head">
        <span className="agent-run-glyph">
          <RunStatusGlyph status={run.status} />
        </span>
        <h3 className="agent-run-title">{title}</h3>
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

      {running && (
        <p className="agent-run-live" data-testid="agent-run-live" aria-live="polite">
          {t(run.liveStatus.zh, run.liveStatus.en)}
        </p>
      )}

      {run.steps.length > 0 && (
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

      {run.status === 'SUCCEEDED' && run.result && (
        <footer className="agent-run-outcome" data-testid="agent-run-result">
          <p className="agent-run-outcome-text">
            {t(run.result.summary.zh, run.result.summary.en)}
          </p>
          {run.result.artifactLabel && onOpenArtifact && (
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
