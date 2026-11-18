import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Loader2,
  Square,
  Wrench,
} from 'lucide-react';
import { usePreferences } from '../../../i18n.js';
import { Button } from '../../beautifui/index.js';
import {
  formatAnchorBadgeLabel,
  formatStepClock,
  selectVisibleProgressSteps,
  type AgentRunStep,
  type AgentRunStepStatus,
  type AgentRunView,
  type PrototypeTargetAnchor,
} from '../agentRun.js';

const expandedWorkBlocks = new Set<string>();
const expandedToolSteps = new Set<string>();

export function isWorkBlockExpanded(runId: string | undefined): boolean {
  return runId !== undefined && expandedWorkBlocks.has(runId);
}

export function setWorkBlockExpanded(runId: string | undefined, expanded: boolean): void {
  if (!runId) return;
  if (expanded) expandedWorkBlocks.add(runId);
  else expandedWorkBlocks.delete(runId);
}

export function isToolStepExpanded(stepId: string | undefined): boolean {
  return stepId !== undefined && expandedToolSteps.has(stepId);
}

export function setToolStepExpanded(stepId: string | undefined, expanded: boolean): void {
  if (!stepId) return;
  if (expanded) expandedToolSteps.add(stepId);
  else expandedToolSteps.delete(stepId);
}

export function clearWorkProcessExpansionForTests(): void {
  expandedWorkBlocks.clear();
  expandedToolSteps.clear();
}

function useLiveClock(running: boolean, fixedNow: number | undefined): number {
  const [now, setNow] = useState(() => fixedNow ?? Date.now());
  useEffect(() => {
    if (!running || fixedNow !== undefined || typeof window === 'undefined') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, fixedNow]);
  return fixedNow ?? now;
}

export function computeThinkingSeconds(run: AgentRunView): number {
  if (
    typeof run.thinkingDurationMs === 'number' &&
    Number.isFinite(run.thinkingDurationMs) &&
    run.thinkingDurationMs > 0
  ) {
    return Math.max(1, Math.round(run.thinkingDurationMs / 1000));
  }
  if (run.completedAt !== undefined && run.completedAt > run.startedAt) {
    const elapsedMs = run.completedAt - run.startedAt;
    const stepMs = run.steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    const netMs = stepMs > 0 && elapsedMs > stepMs ? elapsedMs - stepMs : elapsedMs;
    return Math.max(1, Math.round(netMs / 1000));
  }
  return 1;
}

function formatStepDurationOrClock(step: AgentRunStep): string {
  if (step.status === 'RUNNING') return '';
  if (
    typeof step.durationMs === 'number' &&
    Number.isFinite(step.durationMs) &&
    step.durationMs >= 0
  ) {
    return `${Math.max(0.1, step.durationMs / 1000).toFixed(1)}s`;
  }
  return formatStepClock(step.at);
}

function StepStatusIcon({ status }: { status: AgentRunStepStatus }) {
  if (status === 'RUNNING') {
    return (
      <Loader2
        size={13}
        className="agent-run-spin work-process-icon is-running"
        aria-hidden="true"
      />
    );
  }
  if (status === 'FAILED') {
    return <AlertTriangle size={13} className="work-process-icon is-failed" aria-hidden="true" />;
  }
  if (status === 'STOPPED') {
    return <CircleSlash size={13} className="work-process-icon is-cancelled" aria-hidden="true" />;
  }
  return <Check size={13} className="work-process-icon is-done" aria-hidden="true" />;
}

function WorkProcessToolRow({
  step,
  defaultExpanded,
  onHoverAnchor,
}: {
  step: AgentRunStep;
  defaultExpanded: boolean;
  onHoverAnchor?: (anchor: PrototypeTargetAnchor | null) => void;
}) {
  const { t } = usePreferences();
  const [stepOpen, setStepOpen] = useState<boolean>(
    () => defaultExpanded || isToolStepExpanded(step.id),
  );

  const label = t(step.label.zh, step.label.en);
  const summary = step.summary ? t(step.summary.zh, step.summary.en) : '';
  const timeLabel = formatStepDurationOrClock(step);
  const anchorBadge = formatAnchorBadgeLabel(step.targetAnchor);
  const resultContent = step.resultText ?? (!step.argsText ? step.detail : undefined);

  const handleToggleStep = () => {
    const next = !stepOpen;
    setStepOpen(next);
    setToolStepExpanded(step.id, next);
  };

  return (
    <li
      className="work-process-step-item"
      data-testid="conversation-tool-step"
      data-step-id={step.id}
      data-step-status={step.status}
      data-expanded={stepOpen ? 'true' : 'false'}
      {...(onHoverAnchor && step.targetAnchor
        ? {
            onMouseEnter: () => onHoverAnchor(step.targetAnchor ?? null),
            onMouseLeave: () => onHoverAnchor(null),
          }
        : {})}
    >
      <button
        type="button"
        className="work-process-tool-row"
        data-testid="conversation-tool-toggle"
        aria-expanded={stepOpen}
        onClick={handleToggleStep}
      >
        <StepStatusIcon status={step.status} />
        <span className="work-process-tool-name">{label}</span>
        {summary ? (
          <span className="work-process-tool-summary">{summary}</span>
        ) : (
          <span className="work-process-tool-spacer" aria-hidden="true" />
        )}
        {timeLabel && <span className="work-process-tool-time">{timeLabel}</span>}
        {stepOpen ? (
          <ChevronDown size={13} className="work-process-chevron" aria-hidden="true" />
        ) : (
          <ChevronRight size={13} className="work-process-chevron" aria-hidden="true" />
        )}
      </button>

      {stepOpen && (
        <div className="work-process-tool-detail" data-testid="conversation-tool-detail">
          <div className="work-process-tool-detail-head">
            {step.toolName && (
              <span
                className="inline-flex items-center gap-1"
                data-testid="conversation-tool-name"
              >
                <Wrench size={11} aria-hidden="true" />
                <code>{step.toolName}</code>
              </span>
            )}
            {anchorBadge && (
              <span
                className="work-process-tool-anchor"
                data-testid="agent-run-step-anchor"
              >
                {anchorBadge}
              </span>
            )}
          </div>

          {step.argsText && (
            <div className="work-process-tool-section" data-testid="conversation-tool-args">
              <span className="work-process-tool-section-label">
                {t('参数', 'Arguments')}
              </span>
              <pre className="work-process-tool-pre">{step.argsText}</pre>
            </div>
          )}

          {resultContent && (
            <div className="work-process-tool-section" data-testid="conversation-tool-result">
              <span className="work-process-tool-section-label">
                {t('结果', 'Result')}
              </span>
              <pre className="work-process-tool-pre">{resultContent}</pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export interface WorkProcessBlockProps {
  run: AgentRunView;
  onCancel?: () => void;
  onHoverAnchor?: (anchor: PrototypeTargetAnchor | null) => void;
  defaultExpanded?: boolean;
  defaultExpandedStepIds?: readonly string[];
  now?: number;
}

export function WorkProcessBlock({
  run,
  onCancel,
  onHoverAnchor,
  defaultExpanded = false,
  defaultExpandedStepIds,
  now: fixedNow,
}: WorkProcessBlockProps) {
  const { t } = usePreferences();
  const running = run.status === 'RUNNING';
  const now = useLiveClock(running, fixedNow);
  const thinkingText = run.thinking?.trim() ?? '';
  const hasThinking = thinkingText.length > 0;
  const stepCount = run.steps.length;

  const [open, setOpen] = useState<boolean>(
    () => defaultExpanded || isWorkBlockExpanded(run.id),
  );

  if (!running && !hasThinking && stepCount === 0) {
    return null;
  }

  const defaultStepSet = new Set(defaultExpandedStepIds ?? []);

  const { visibleSteps } = selectVisibleProgressSteps(run.steps, run.status);
  const activeVisibleStep = visibleSteps.find((s) => s.status === 'RUNNING');
  const liveLabel = activeVisibleStep
    ? t(activeVisibleStep.label.zh, activeVisibleStep.label.en)
    : t(run.liveStatus.zh, run.liveStatus.en);

  const thinkingSeconds = hasThinking ? computeThinkingSeconds(run) : 0;

  let metaLabel = '';
  if (running) {
    const elapsedSec = Math.max(0, Math.floor((now - run.startedAt) / 1000));
    const stepPartZh = stepCount > 0 ? `${stepCount} 个步骤` : '';
    const stepPartEn =
      stepCount > 0 ? (stepCount === 1 ? '1 step' : `${stepCount} steps`) : '';
    const timePartZh = elapsedSec > 0 ? `${elapsedSec} 秒` : '';
    const timePartEn = elapsedSec > 0 ? `${elapsedSec}s` : '';
    metaLabel = t(
      [timePartZh, stepPartZh].filter(Boolean).join(' · '),
      [timePartEn, stepPartEn].filter(Boolean).join(' · '),
    );
  } else if (hasThinking && stepCount > 0) {
    metaLabel = t(
      `思考 ${thinkingSeconds} 秒 · ${stepCount} 个步骤`,
      `Thought for ${thinkingSeconds}s · ${stepCount === 1 ? '1 step' : `${stepCount} steps`}`,
    );
  } else if (hasThinking) {
    metaLabel = t(`思考 ${thinkingSeconds} 秒`, `Thought for ${thinkingSeconds}s`);
  } else if (stepCount > 0) {
    metaLabel = t(
      `${stepCount} 个步骤`,
      stepCount === 1 ? '1 step' : `${stepCount} steps`,
    );
  }

  const hasFailedStep = run.steps.some((s) => s.status === 'FAILED');

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    setWorkBlockExpanded(run.id, next);
  };

  return (
    <div
      className="work-process-block"
      data-testid="conversation-work-process"
      data-expanded={open ? 'true' : 'false'}
      data-run-status={run.status}
    >
      <div className="work-process-header-row">
        <button
          type="button"
          className="work-process-toggle"
          data-testid="conversation-work-toggle"
          aria-expanded={open}
          onClick={handleToggle}
        >
          {running ? (
            <Loader2
              size={13}
              className="agent-run-spin work-process-icon is-running"
              aria-hidden="true"
            />
          ) : run.status === 'FAILED' || hasFailedStep ? (
            <AlertTriangle size={13} className="work-process-icon is-failed" aria-hidden="true" />
          ) : run.status === 'CANCELLED' ? (
            <CircleSlash size={13} className="work-process-icon is-cancelled" aria-hidden="true" />
          ) : (
            <Check size={13} className="work-process-icon is-done" aria-hidden="true" />
          )}

          {running ? (
            <span
              className="work-process-title"
              data-testid="conversation-live-status"
              aria-live="polite"
            >
              {liveLabel}
            </span>
          ) : (
            <span className="work-process-title">{t('工作过程', 'Work process')}</span>
          )}

          {metaLabel && (
            <span className="work-process-meta" data-testid="conversation-work-meta">
              {metaLabel}
            </span>
          )}

          {running && run.reconnecting && (
            <span
              className="conversation-reconnecting-badge"
              data-testid="agent-run-reconnecting-badge"
            >
              {t('自动重连中', 'Reconnecting')}
            </span>
          )}

          {open ? (
            <ChevronDown size={13} className="work-process-chevron" aria-hidden="true" />
          ) : (
            <ChevronRight size={13} className="work-process-chevron" aria-hidden="true" />
          )}
        </button>

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
      </div>

      {open && (hasThinking || stepCount > 0) && (
        <div className="work-process-body" data-testid="conversation-work-body">
          {hasThinking && (
            <div className="work-process-thinking" data-testid="conversation-thinking-block">
              <div className="work-process-thinking-label">
                {running
                  ? t('思考过程', 'Thinking')
                  : t(`思考了 ${thinkingSeconds} 秒`, `Thought for ${thinkingSeconds}s`)}
              </div>
              <p className="work-process-thinking-text" data-testid="agent-run-thinking">
                {thinkingText}
              </p>
            </div>
          )}

          {stepCount > 0 && (
            <ol className="work-process-step-list" data-testid="conversation-tool-list">
              {run.steps.map((step) => (
                <WorkProcessToolRow
                  key={step.id}
                  step={step}
                  defaultExpanded={defaultStepSet.has(step.id)}
                  {...(onHoverAnchor ? { onHoverAnchor } : {})}
                />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
