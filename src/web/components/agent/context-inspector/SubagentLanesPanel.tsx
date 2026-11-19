import React, { useEffect, useMemo, useRef } from 'react';
import { AlertCircle, Ban, Check, Loader2 } from 'lucide-react';
import type {
  AgentSubagentLaneTrace,
  ModelCallSummary,
} from '../../../../packages/workspace-store/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { formatTokenCount } from './ContextCompositionBar.js';
import type { ContextInspectorRunTrace } from './ContextEventsList.js';
import './context-inspector.css';

export type SubagentLaneDisplayStatus =
  | 'RUNNING'
  | 'COMPLETED'
  | 'ERROR'
  | 'ABORTED';

export interface SubagentLaneViewModel {
  readonly id: string;
  readonly label: { readonly zh: string; readonly en: string };
  readonly taskTitle?: { readonly zh: string; readonly en: string };
  readonly status: SubagentLaneDisplayStatus;
  readonly contextTokens: number;
  readonly contextRatio: number;
  readonly callCount: number;
  readonly calls: readonly ModelCallSummary[];
  readonly parentCallId?: string;
  readonly parentCallSeq?: number;
  readonly fallbackCallId: string | null;
}

export function formatSubagentLaneStatusLabel(
  status: SubagentLaneDisplayStatus,
  t: (zh: string, en: string) => string,
): string {
  switch (status) {
    case 'RUNNING':
      return t('运行中', 'Running');
    case 'COMPLETED':
      return t('已完成', 'Completed');
    case 'ERROR':
      return t('失败', 'Error');
    case 'ABORTED':
      return t('已中止', 'Aborted');
  }
}

export function resolveNextSubagentLaneCallId(
  lane: SubagentLaneViewModel,
  selectedCallId: string | null | undefined,
): string | null {
  if (lane.calls.length === 0) {
    return lane.fallbackCallId;
  }
  if (lane.calls.length === 1) {
    return lane.calls[0]!.id;
  }
  const activeIdx = selectedCallId
    ? lane.calls.findIndex((c) => c.id === selectedCallId)
    : -1;
  if (activeIdx >= 0) {
    return lane.calls[(activeIdx + 1) % lane.calls.length]!.id;
  }
  return lane.calls[0]!.id;
}

function resolveStatusFromCallsAndTrace(
  calls: readonly ModelCallSummary[],
  trace: AgentSubagentLaneTrace | undefined,
): SubagentLaneDisplayStatus {
  if (trace && (trace.status === 'RUNNING' || trace.status === 'QUEUED')) {
    return 'RUNNING';
  }
  const latestCall = calls[calls.length - 1];
  if (latestCall) {
    if (latestCall.status === 'ABORTED') return 'ABORTED';
    if (latestCall.status === 'ERROR' || trace?.status === 'FAILED') return 'ERROR';
    return 'COMPLETED';
  }
  if (trace) {
    if (trace.status === 'FAILED') return 'ERROR';
    if (trace.status === 'DONE') return 'COMPLETED';
  }
  return 'RUNNING';
}

interface DraftSubagentLane {
  id: string;
  runId?: string;
  label: { zh: string; en: string };
  taskTitle?: { zh: string; en: string };
  status: SubagentLaneDisplayStatus;
  contextTokens: number;
  callCount: number;
  calls: ModelCallSummary[];
  parentCallId?: string;
  parentCallSeq?: number;
  fallbackCallId: string | null;
}

export function deriveSubagentLanes(opts: {
  modelCalls: readonly ModelCallSummary[];
  runs?: readonly ContextInspectorRunTrace[];
}): SubagentLaneViewModel[] {
  const sortedCalls = [...opts.modelCalls].sort((a, b) => a.seq - b.seq);
  const runs = opts.runs ?? [];

  const callById = new Map<string, ModelCallSummary>();
  const callsByRunId = new Map<string, ModelCallSummary[]>();
  for (const call of sortedCalls) {
    callById.set(call.id, call);
    if (call.runId) {
      const bucket = callsByRunId.get(call.runId);
      if (bucket) bucket.push(call);
      else callsByRunId.set(call.runId, [call]);
    }
  }

  // Group SUBAGENT calls by (parentCallId || runId || 'root') + laneLabel
  const callGroups = new Map<string, ModelCallSummary[]>();
  for (const call of sortedCalls) {
    if (call.purpose !== 'SUBAGENT') continue;
    const scopeKey = call.parentCallId ?? call.runId ?? 'root';
    const labelKey =
      call.laneLabel && (call.laneLabel.zh.trim() || call.laneLabel.en.trim())
        ? `${call.laneLabel.zh.trim()}::${call.laneLabel.en.trim()}`
        : call.id;
    const key = `${scopeKey}::${labelKey}`;
    const bucket = callGroups.get(key);
    if (bucket) bucket.push(call);
    else callGroups.set(key, [call]);
  }

  // Index live / persisted subagent traces from runs so we can merge status & task titles
  const unmatchedTraces: Array<{
    runId: string;
    trace: AgentSubagentLaneTrace;
    consumed: boolean;
  }> = [];
  for (const run of runs) {
    for (const trace of run.subagentLanes ?? []) {
      unmatchedTraces.push({ runId: run.id, trace, consumed: false });
    }
  }

  const drafts: DraftSubagentLane[] = [];
  let autoIndex = 0;

  for (const [groupKey, groupCalls] of callGroups) {
    autoIndex += 1;
    const firstCall = groupCalls[0]!;
    const label = firstCall.laneLabel ?? {
      zh: `子智能体 #${autoIndex}`,
      en: `Subagent #${autoIndex}`,
    };
    const matchedEntry = unmatchedTraces.find(
      (entry) =>
        !entry.consumed &&
        (!firstCall.runId || entry.runId === firstCall.runId) &&
        (entry.trace.workerLabel.zh === label.zh ||
          entry.trace.workerLabel.en === label.en),
    );
    if (matchedEntry) {
      matchedEntry.consumed = true;
    }

    const parentCall = firstCall.parentCallId
      ? callById.get(firstCall.parentCallId)
      : undefined;
    const contextTokens = groupCalls.reduce(
      (max, c) => Math.max(max, Math.max(0, c.usage.promptTokens)),
      0,
    );

    drafts.push({
      id: `lane-${groupKey}`,
      ...(firstCall.runId ? { runId: firstCall.runId } : {}),
      label,
      ...(matchedEntry?.trace.taskTitle
        ? { taskTitle: matchedEntry.trace.taskTitle }
        : {}),
      status: resolveStatusFromCallsAndTrace(groupCalls, matchedEntry?.trace),
      contextTokens,
      callCount: groupCalls.length,
      calls: groupCalls,
      ...(firstCall.parentCallId ? { parentCallId: firstCall.parentCallId } : {}),
      ...(parentCall ? { parentCallSeq: parentCall.seq } : {}),
      fallbackCallId: firstCall.id,
    });
  }

  // Append any remaining active / unrecorded subagent lane traces from runs
  for (const entry of unmatchedTraces) {
    if (entry.consumed) continue;
    const runCalls = callsByRunId.get(entry.runId) ?? [];
    const coordCall =
      runCalls.find(
        (c) =>
          c.purpose !== 'SUBAGENT' &&
          (c.responseToolNames?.includes('spawn_subagents') ||
            c.responseToolNames?.includes('codemode')),
      ) ??
      runCalls.find((c) => c.purpose === 'TURN') ??
      runCalls[0] ??
      null;

    drafts.push({
      id: `lane-trace-${entry.runId}-${entry.trace.laneId}`,
      runId: entry.runId,
      label: entry.trace.workerLabel,
      taskTitle: entry.trace.taskTitle,
      status: resolveStatusFromCallsAndTrace([], entry.trace),
      contextTokens: 0,
      callCount: 0,
      calls: [],
      ...(coordCall ? { parentCallId: coordCall.id, parentCallSeq: coordCall.seq } : {}),
      fallbackCallId: coordCall?.id ?? null,
    });
  }

  const maxContextTokens = drafts.reduce(
    (max, d) => Math.max(max, d.contextTokens),
    0,
  );

  return drafts.map(({ runId: _r, ...draft }) => ({
    ...draft,
    contextRatio:
      maxContextTokens > 0
        ? Math.min(1, Math.max(0, draft.contextTokens / maxContextTokens))
        : 0,
  }));
}

function LaneStatusIcon({ status }: { status: SubagentLaneDisplayStatus }) {
  switch (status) {
    case 'RUNNING':
      return (
        <Loader2
          size={13}
          className="context-lane-status-icon is-running"
          aria-hidden="true"
        />
      );
    case 'COMPLETED':
      return (
        <Check
          size={13}
          className="context-lane-status-icon is-completed"
          aria-hidden="true"
        />
      );
    case 'ERROR':
      return (
        <AlertCircle
          size={13}
          className="context-lane-status-icon is-error"
          aria-hidden="true"
        />
      );
    case 'ABORTED':
      return (
        <Ban
          size={13}
          className="context-lane-status-icon is-aborted"
          aria-hidden="true"
        />
      );
  }
}

export interface SubagentLanesPanelProps {
  modelCalls: readonly ModelCallSummary[];
  runs?: readonly ContextInspectorRunTrace[];
  selectedCallId?: string | null;
  onSelectCall: (callId: string) => void;
  focused?: boolean;
}

/**
 * Subagent Lanes Panel (#84, User Story 29).
 * Renders one lane per parallel subagent with context size, call count, execution status,
 * parent call reference, and click-to-inspect synchronization into ContextBrowser.
 */
export function SubagentLanesPanel({
  modelCalls,
  runs,
  selectedCallId,
  onSelectCall,
  focused = false,
}: SubagentLanesPanelProps) {
  const { t } = usePreferences();
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (focused) {
      sectionRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [focused]);

  const lanes = useMemo(
    () =>
      deriveSubagentLanes({
        modelCalls,
        ...(runs !== undefined ? { runs } : {}),
      }),
    [modelCalls, runs],
  );

  return (
    <section
      ref={sectionRef}
      className={cn(
        'context-inspector-section context-subagent-lanes-section',
        focused && 'is-focused',
      )}
      data-testid="context-subagent-lanes-section"
      data-focused={focused ? 'true' : 'false'}
    >
      <div className="context-inspector-section-head">
        <h3 className="context-inspector-section-title">
          {t('子智能体泳道', 'Subagent lanes')}
        </h3>
        <span className="context-inspector-section-meta">
          {t(
            `${lanes.length} 条`,
            `${lanes.length} ${lanes.length === 1 ? 'lane' : 'lanes'}`,
          )}
        </span>
      </div>

      {lanes.length === 0 ? (
        <p className="context-inspector-note" data-testid="context-subagent-lanes-empty">
          {t(
            '当前对话尚未派生并行子智能体。',
            'No parallel subagents have been spawned in this conversation yet.',
          )}
        </p>
      ) : (
        <div className="context-subagent-lanes-list">
          {lanes.map((lane) => {
            const isLaneSelected =
              lane.calls.length > 0
                ? lane.calls.some((c) => c.id === selectedCallId)
                : Boolean(lane.fallbackCallId && selectedCallId === lane.fallbackCallId);
            const nextTargetCallId = resolveNextSubagentLaneCallId(lane, selectedCallId);
            const barWidthPct =
              lane.contextTokens > 0
                ? Math.max(8, Math.round(lane.contextRatio * 100))
                : 0;
            const laneName = t(lane.label.zh, lane.label.en);
            const taskTitle = lane.taskTitle
              ? t(lane.taskTitle.zh, lane.taskTitle.en)
              : '';
            const showTaskSubtitle = Boolean(taskTitle && taskTitle !== laneName);

            return (
              <div
                key={lane.id}
                className={cn(
                  'context-subagent-lane-card',
                  `is-${lane.status.toLowerCase()}`,
                  isLaneSelected && 'is-selected',
                )}
              >
                <button
                  type="button"
                  className="context-subagent-lane"
                  data-testid="context-subagent-lane"
                  data-lane-id={lane.id}
                  data-lane-status={lane.status}
                  data-target-call-id={nextTargetCallId ?? ''}
                  data-selected={isLaneSelected ? 'true' : 'false'}
                  aria-pressed={isLaneSelected}
                  disabled={!nextTargetCallId}
                  onClick={() => {
                    if (nextTargetCallId) {
                      onSelectCall(nextTargetCallId);
                    }
                  }}
                >
                  <span className="context-subagent-lane-top">
                    <span className="context-subagent-lane-identity">
                      <LaneStatusIcon status={lane.status} />
                      <span className="context-subagent-lane-name">{laneName}</span>
                    </span>
                    <span
                      className={cn(
                        'context-subagent-lane-status',
                        `is-${lane.status.toLowerCase()}`,
                      )}
                    >
                      {formatSubagentLaneStatusLabel(lane.status, t)}
                    </span>
                  </span>

                  {showTaskSubtitle && (
                    <span className="context-subagent-lane-task">{taskTitle}</span>
                  )}

                  <span className="context-subagent-lane-meta">
                    <span>
                      {t(
                        `${lane.callCount} 次调用`,
                        `${lane.callCount} ${lane.callCount === 1 ? 'call' : 'calls'}`,
                      )}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {t('上下文', 'Context')} {formatTokenCount(lane.contextTokens)}
                    </span>
                    {lane.parentCallSeq !== undefined && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {t(`源自 #${lane.parentCallSeq}`, `From #${lane.parentCallSeq}`)}
                        </span>
                      </>
                    )}
                  </span>

                  <span className="context-subagent-lane-bar" aria-hidden="true">
                    <span
                      className={cn(
                        'context-subagent-lane-bar-fill',
                        `is-${lane.status.toLowerCase()}`,
                      )}
                      style={{ width: `${barWidthPct}%` }}
                    />
                  </span>
                </button>

                {lane.calls.length > 1 && (
                  <div
                    className="context-subagent-call-pills"
                    role="group"
                    aria-label={t('子智能体逐轮调用', 'Subagent calls')}
                  >
                    {lane.calls.map((c) => {
                      const pillSelected = selectedCallId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className={cn(
                            'context-subagent-call-pill',
                            pillSelected && 'is-selected',
                          )}
                          data-testid="context-subagent-call-pill"
                          data-call-id={c.id}
                          data-call-seq={String(c.seq)}
                          aria-pressed={pillSelected}
                          onClick={() => onSelectCall(c.id)}
                        >
                          #{c.seq}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
