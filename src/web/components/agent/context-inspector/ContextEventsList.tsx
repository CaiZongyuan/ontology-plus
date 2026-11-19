import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectStepId } from '../../../../packages/business-vocabulary/index.js';
import type {
  AgentSubagentLaneTrace,
  ContextEventSummary,
  ModelCallSummary,
  StepHandoffOrigin,
  StepHandoffProposal,
} from '../../../../packages/workspace-store/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { formatSignedTokenDelta } from './ModelCallTimeline.js';
import './context-inspector.css';

export type DerivedContextEventKind = 'COMPACT' | 'TRIM' | 'HANDOFF' | 'SUBAGENT';

export type ContextEventFilterKind = 'ALL' | DerivedContextEventKind;

export const CONTEXT_EVENT_FILTER_KINDS: readonly ContextEventFilterKind[] = [
  'ALL',
  'COMPACT',
  'TRIM',
  'HANDOFF',
  'SUBAGENT',
] as const;

export interface ContextInspectorRunTrace {
  id: string;
  status?: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  stepHandoff?: StepHandoffProposal;
  handoffFrom?: StepHandoffOrigin;
  subagentLanes?: readonly AgentSubagentLaneTrace[];
}

export interface DerivedContextEventItem {
  readonly id: string;
  readonly kind: DerivedContextEventKind;
  readonly title: { readonly zh: string; readonly en: string };
  readonly source: { readonly zh: string; readonly en: string };
  readonly tokenDelta: number;
  readonly callSeq: number;
  readonly targetCallId: string | null;
  readonly timestamp: string;
}

interface SortableDerivedEvent extends DerivedContextEventItem {
  readonly sortPosition: number;
  readonly kindPriority: number;
}

function formatStepShortLabel(step: ProjectStepId | null | undefined): { zh: string; en: string } | null {
  switch (step) {
    case 'REQUIREMENTS':
      return { zh: '需求', en: 'Requirements' };
    case 'PROTOTYPE':
      return { zh: '原型', en: 'Prototype' };
    case 'BUSINESS_MODEL':
      return { zh: '业务模型', en: 'Business Model' };
    case 'DELIVERY':
      return { zh: '交付', en: 'Delivery' };
    default:
      return null;
  }
}

export function formatContextEventFilterLabel(
  kind: ContextEventFilterKind,
  t: (zh: string, en: string) => string,
): string {
  switch (kind) {
    case 'ALL':
      return t('全部', 'All');
    case 'COMPACT':
      return t('压缩', 'Compact');
    case 'TRIM':
      return t('裁剪', 'Trim');
    case 'HANDOFF':
      return t('步骤转交', 'Hand-off');
    case 'SUBAGENT':
      return t('子智能体', 'Subagent');
  }
}

function countDistinctSubagentLanes(
  childCalls: readonly ModelCallSummary[],
  runTrace: ContextInspectorRunTrace | undefined,
): number {
  if (runTrace?.subagentLanes && runTrace.subagentLanes.length > 0) {
    return Math.max(
      runTrace.subagentLanes.length,
      new Set(
        childCalls.map(
          (c) => `${c.laneLabel?.zh ?? ''}::${c.laneLabel?.en ?? ''}` || c.id,
        ),
      ).size,
    );
  }
  if (childCalls.length > 0) {
    return new Set(
      childCalls.map(
        (c) => `${c.laneLabel?.zh ?? ''}::${c.laneLabel?.en ?? ''}` || c.id,
      ),
    ).size;
  }
  return 1;
}

export function deriveContextEventItems(opts: {
  modelCalls: readonly ModelCallSummary[];
  contextEvents?: readonly ContextEventSummary[];
  runs?: readonly ContextInspectorRunTrace[];
}): DerivedContextEventItem[] {
  const sortedCalls = [...opts.modelCalls].sort((a, b) => a.seq - b.seq);
  const compactEvents = [...(opts.contextEvents ?? [])]
    .filter((ev) => ev.kind === 'COMPACT')
    .sort((a, b) => a.afterCallSeq - b.afterCallSeq || a.createdAt.localeCompare(b.createdAt));
  const runs = opts.runs ?? [];

  const callById = new Map<string, ModelCallSummary>();
  const callBySeq = new Map<number, ModelCallSummary>();
  const callsByRunId = new Map<string, ModelCallSummary[]>();
  const subagentCallsByParentId = new Map<string, ModelCallSummary[]>();
  const orphanSubagentCalls: ModelCallSummary[] = [];

  for (const call of sortedCalls) {
    callById.set(call.id, call);
    callBySeq.set(call.seq, call);
    if (call.runId) {
      const bucket = callsByRunId.get(call.runId);
      if (bucket) bucket.push(call);
      else callsByRunId.set(call.runId, [call]);
    }
  }

  for (const call of sortedCalls) {
    if (call.purpose !== 'SUBAGENT') continue;
    if (call.parentCallId && callById.has(call.parentCallId)) {
      const bucket = subagentCallsByParentId.get(call.parentCallId);
      if (bucket) bucket.push(call);
      else subagentCallsByParentId.set(call.parentCallId, [call]);
    } else {
      orphanSubagentCalls.push(call);
    }
  }

  const runById = new Map<string, ContextInspectorRunTrace>();
  for (const r of runs) {
    runById.set(r.id, r);
  }

  const derived: SortableDerivedEvent[] = [];

  // 1. COMPACT events (from persisted ContextEventSummary[])
  compactEvents.forEach((ev, idx) => {
    const followingTurnCall = sortedCalls.find(
      (c) => c.seq > ev.afterCallSeq && c.purpose === 'TURN',
    );
    const immediateNextCall = sortedCalls.find((c) => c.seq > ev.afterCallSeq);
    const targetCall =
      immediateNextCall ??
      followingTurnCall ??
      callBySeq.get(ev.afterCallSeq) ??
      sortedCalls[sortedCalls.length - 1] ??
      null;
    const callSeq = targetCall ? targetCall.seq : ev.afterCallSeq;
    const sortPosition = immediateNextCall
      ? immediateNextCall.seq - 0.25 + idx * 0.001
      : ev.afterCallSeq + 0.25 + idx * 0.001;

    derived.push({
      id: `evt-compact-${ev.id}`,
      kind: 'COMPACT',
      title:
        ev.removedCount > 0
          ? {
              zh: `压缩 · 概括了 ${ev.removedCount} 条早期消息`,
              en: `Compaction · Summarized ${ev.removedCount} ${
                ev.removedCount === 1 ? 'message' : 'messages'
              }`,
            }
          : {
              zh: '压缩 · 概括早期消息',
              en: 'Compaction · Summarized earlier messages',
            },
      source: ev.summarizedByModel
        ? { zh: '模型概括', en: 'Model summary' }
        : { zh: '结构化概括', en: 'Deterministic summary' },
      tokenDelta: -Math.abs(ev.reclaimedTokens),
      callSeq,
      targetCallId: targetCall?.id ?? null,
      timestamp: ev.createdAt,
      sortPosition,
      kindPriority: 1,
    });
  });

  // 2. TRIM events (sliding-window message exclusions on TURN calls)
  let prevTurnSeq = 0;
  let prevTurnExcludedCount = 0;
  let prevTurnExcludedTokens = 0;
  for (const call of sortedCalls) {
    if (call.purpose !== 'TURN') continue;
    const hadCompactionSincePrevTurn = compactEvents.some(
      (ev) => ev.afterCallSeq >= prevTurnSeq && ev.afterCallSeq < call.seq,
    );
    if (hadCompactionSincePrevTurn) {
      prevTurnExcludedCount = 0;
      prevTurnExcludedTokens = 0;
    }

    if (
      call.excludedCount > 0 &&
      (prevTurnExcludedCount === 0 || call.excludedCount > prevTurnExcludedCount)
    ) {
      const newlyTrimmed =
        prevTurnExcludedCount === 0
          ? call.excludedCount
          : call.excludedCount - prevTurnExcludedCount;
      const incrementalTokens =
        prevTurnExcludedCount === 0
          ? call.estimate.excludedTokens
          : call.estimate.excludedTokens - prevTurnExcludedTokens;
      const effectiveExcludedTokens =
        incrementalTokens > 0 ? incrementalTokens : call.estimate.excludedTokens;

      derived.push({
        id: `evt-trim-${call.id}`,
        kind: 'TRIM',
        title: {
          zh: `裁剪 · 移出 ${newlyTrimmed} 条早期消息`,
          en: `Window trim · Left out ${newlyTrimmed} ${
            newlyTrimmed === 1 ? 'message' : 'messages'
          }`,
        },
        source: { zh: '消息窗口裁剪', en: 'Sliding window' },
        tokenDelta: -Math.abs(effectiveExcludedTokens),
        callSeq: call.seq,
        targetCallId: call.id,
        timestamp: call.startedAt,
        sortPosition: call.seq - 0.1,
        kindPriority: 2,
      });
    }

    prevTurnSeq = call.seq;
    prevTurnExcludedCount = call.excludedCount;
    prevTurnExcludedTokens = call.estimate.excludedTokens;
  }

  // 3. HANDOFF events (propose_step_handoff tool call and/or run stepHandoff / handoffFrom)
  const coveredOutgoingHandoffRunIds = new Set<string>();
  const emittedHandoffCallIds = new Set<string>();

  for (const call of sortedCalls) {
    if (!call.responseToolNames?.includes('propose_step_handoff')) continue;
    const matchedRun = call.runId ? runById.get(call.runId) : undefined;
    if (call.runId) coveredOutgoingHandoffRunIds.add(call.runId);
    emittedHandoffCallIds.add(call.id);

    const targetLabel = formatStepShortLabel(matchedRun?.stepHandoff?.targetStep);
    const delta =
      call.estimate.byKind.TOOL_CALL > 0
        ? call.estimate.byKind.TOOL_CALL
        : call.usage.outputTokens;

    derived.push({
      id: `evt-handoff-${call.id}`,
      kind: 'HANDOFF',
      title: targetLabel
        ? {
            zh: `步骤转交 · 提议转交至「${targetLabel.zh}」`,
            en: `Step hand-off · Proposed to ${targetLabel.en}`,
          }
        : {
            zh: '步骤转交 · 发起跨步骤转交',
            en: 'Step hand-off · Proposed cross-step hand-off',
          },
      source: { zh: '跨步骤转交', en: 'Step hand-off' },
      tokenDelta: delta,
      callSeq: call.seq,
      targetCallId: call.id,
      timestamp: call.endedAt,
      sortPosition: call.seq + 0.05,
      kindPriority: 3,
    });
  }

  for (const run of runs) {
    const runCalls = callsByRunId.get(run.id) ?? [];
    if (run.stepHandoff && !coveredOutgoingHandoffRunIds.has(run.id)) {
      const targetCall =
        runCalls.find((c) => c.purpose === 'TURN') ?? runCalls[0] ?? null;
      if (targetCall && !emittedHandoffCallIds.has(targetCall.id)) {
        emittedHandoffCallIds.add(targetCall.id);
        const targetLabel = formatStepShortLabel(run.stepHandoff.targetStep);
        derived.push({
          id: `evt-handoff-run-${run.id}`,
          kind: 'HANDOFF',
          title: targetLabel
            ? {
                zh: `步骤转交 · 提议转交至「${targetLabel.zh}」`,
                en: `Step hand-off · Proposed to ${targetLabel.en}`,
              }
            : {
                zh: '步骤转交 · 发起跨步骤转交',
                en: 'Step hand-off · Proposed cross-step hand-off',
              },
          source: { zh: '跨步骤转交', en: 'Step hand-off' },
          tokenDelta: targetCall.usage.outputTokens,
          callSeq: targetCall.seq,
          targetCallId: targetCall.id,
          timestamp: targetCall.endedAt,
          sortPosition: targetCall.seq + 0.05,
          kindPriority: 3,
        });
      }
    }

    if (run.handoffFrom) {
      const firstTurnCall =
        runCalls.find((c) => c.purpose === 'TURN') ?? runCalls[0] ?? null;
      if (firstTurnCall && !emittedHandoffCallIds.has(firstTurnCall.id)) {
        emittedHandoffCallIds.add(firstTurnCall.id);
        const fromLabel = formatStepShortLabel(run.handoffFrom.sourceStep);
        derived.push({
          id: `evt-handoff-in-${run.id}`,
          kind: 'HANDOFF',
          title: fromLabel
            ? {
                zh: `步骤转交 · 承接自「${fromLabel.zh}」步骤`,
                en: `Step hand-off · Received from ${fromLabel.en}`,
              }
            : {
                zh: '步骤转交 · 接收上一步转交请求',
                en: 'Step hand-off · Received handed-off request',
              },
          source: { zh: '跨步骤转交', en: 'Step hand-off' },
          tokenDelta:
            firstTurnCall.estimate.byKind.USER_MESSAGE > 0
              ? firstTurnCall.estimate.byKind.USER_MESSAGE
              : firstTurnCall.usage.promptTokens,
          callSeq: firstTurnCall.seq,
          targetCallId: firstTurnCall.id,
          timestamp: firstTurnCall.startedAt,
          sortPosition: firstTurnCall.seq - 0.05,
          kindPriority: 3,
        });
      }
    }
  }

  // 4. SUBAGENT events (coordinator calls invoking spawn_subagents and/or parent calls of SUBAGENT children)
  const coveredSubagentRunIds = new Set<string>();
  const emittedSubagentParentIds = new Set<string>();

  for (const call of sortedCalls) {
    if (call.purpose === 'SUBAGENT') continue;
    const hasSpawnTool = Boolean(call.responseToolNames?.includes('spawn_subagents'));
    const childCalls = subagentCallsByParentId.get(call.id) ?? [];
    if (!hasSpawnTool && childCalls.length === 0) continue;

    emittedSubagentParentIds.add(call.id);
    if (call.runId) coveredSubagentRunIds.add(call.runId);
    const matchedRun = call.runId ? runById.get(call.runId) : undefined;
    const laneCount = countDistinctSubagentLanes(childCalls, matchedRun);
    const childPromptTokens = childCalls.reduce(
      (sum, ch) => sum + ch.usage.promptTokens,
      0,
    );
    const tokenDelta =
      childPromptTokens > 0 ? childPromptTokens : call.usage.outputTokens;

    derived.push({
      id: `evt-subagent-${call.id}`,
      kind: 'SUBAGENT',
      title: {
        zh: `子智能体派生 · 派生 ${laneCount} 路并行任务`,
        en: `Subagent spawn · Dispatched ${laneCount} parallel ${
          laneCount === 1 ? 'subagent' : 'subagents'
        }`,
      },
      source: { zh: '并行子智能体调度', en: 'Subagent dispatch' },
      tokenDelta,
      callSeq: call.seq,
      targetCallId: call.id,
      timestamp: call.endedAt,
      sortPosition: call.seq + 0.1,
      kindPriority: 4,
    });
  }

  for (const run of runs) {
    if (
      !run.subagentLanes ||
      run.subagentLanes.length === 0 ||
      coveredSubagentRunIds.has(run.id)
    ) {
      continue;
    }
    const runCalls = callsByRunId.get(run.id) ?? [];
    const coordCall =
      runCalls.find(
        (c) =>
          c.responseToolNames?.includes('spawn_subagents') ||
          c.responseToolNames?.includes('codemode'),
      ) ??
      runCalls.find((c) => c.purpose === 'TURN') ??
      runCalls[0] ??
      null;
    if (!coordCall || emittedSubagentParentIds.has(coordCall.id)) continue;

    emittedSubagentParentIds.add(coordCall.id);
    const laneCount = run.subagentLanes.length;
    derived.push({
      id: `evt-subagent-run-${run.id}`,
      kind: 'SUBAGENT',
      title: {
        zh: `子智能体派生 · 派生 ${laneCount} 路并行任务`,
        en: `Subagent spawn · Dispatched ${laneCount} parallel ${
          laneCount === 1 ? 'subagent' : 'subagents'
        }`,
      },
      source: { zh: '并行子智能体调度', en: 'Subagent dispatch' },
      tokenDelta: coordCall.usage.outputTokens,
      callSeq: coordCall.seq,
      targetCallId: coordCall.id,
      timestamp: coordCall.endedAt,
      sortPosition: coordCall.seq + 0.1,
      kindPriority: 4,
    });
  }

  if (orphanSubagentCalls.length > 0) {
    const byOrphanKey = new Map<string, ModelCallSummary[]>();
    for (const orphan of orphanSubagentCalls) {
      const key = orphan.parentCallId ?? orphan.runId ?? orphan.id;
      const bucket = byOrphanKey.get(key);
      if (bucket) bucket.push(orphan);
      else byOrphanKey.set(key, [orphan]);
    }
    for (const [key, children] of byOrphanKey) {
      const firstChild = children[0]!;
      const laneCount = countDistinctSubagentLanes(children, undefined);
      const childPromptTokens = children.reduce(
        (sum, ch) => sum + ch.usage.promptTokens,
        0,
      );
      derived.push({
        id: `evt-subagent-orphan-${key}`,
        kind: 'SUBAGENT',
        title: {
          zh: `子智能体派生 · ${laneCount} 路并行任务`,
          en: `Subagent spawn · ${laneCount} parallel ${
            laneCount === 1 ? 'subagent' : 'subagents'
          }`,
        },
        source: { zh: '并行子智能体调度', en: 'Subagent dispatch' },
        tokenDelta: childPromptTokens,
        callSeq: firstChild.seq,
        targetCallId: firstChild.id,
        timestamp: firstChild.startedAt,
        sortPosition: firstChild.seq,
        kindPriority: 4,
      });
    }
  }

  derived.sort(
    (a, b) =>
      a.sortPosition - b.sortPosition ||
      a.kindPriority - b.kindPriority ||
      a.timestamp.localeCompare(b.timestamp),
  );

  return derived.map(({ sortPosition: _sp, kindPriority: _kp, ...item }) => item);
}

export interface ContextEventsListProps {
  modelCalls: readonly ModelCallSummary[];
  contextEvents?: readonly ContextEventSummary[];
  runs?: readonly ContextInspectorRunTrace[];
  selectedCallId?: string | null;
  onSelectCall: (callId: string) => void;
  focused?: boolean;
  filter?: ContextEventFilterKind;
  defaultFilter?: ContextEventFilterKind;
  onFilterChange?: (filter: ContextEventFilterKind) => void;
}

/**
 * Context Events List (#84, User Story 28).
 * Surfaces COMPACT, TRIM, HANDOFF, and SUBAGENT events with source, token delta,
 * type filters, and click-to-jump synchronization to ModelCallTimeline & ContextBrowser.
 */
export function ContextEventsList({
  modelCalls,
  contextEvents,
  runs,
  selectedCallId,
  onSelectCall,
  focused = false,
  filter: controlledFilter,
  defaultFilter = 'ALL',
  onFilterChange,
}: ContextEventsListProps) {
  const { t } = usePreferences();
  const sectionRef = useRef<HTMLElement | null>(null);
  const [uncontrolledFilter, setUncontrolledFilter] =
    useState<ContextEventFilterKind>(defaultFilter);
  const activeFilter = controlledFilter ?? uncontrolledFilter;

  useEffect(() => {
    if (focused) {
      sectionRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [focused]);

  const allItems = useMemo(
    () =>
      deriveContextEventItems({
        modelCalls,
        ...(contextEvents !== undefined ? { contextEvents } : {}),
        ...(runs !== undefined ? { runs } : {}),
      }),
    [modelCalls, contextEvents, runs],
  );

  const countsByKind = useMemo(() => {
    const counts: Record<ContextEventFilterKind, number> = {
      ALL: allItems.length,
      COMPACT: 0,
      TRIM: 0,
      HANDOFF: 0,
      SUBAGENT: 0,
    };
    for (const item of allItems) {
      counts[item.kind] += 1;
    }
    return counts;
  }, [allItems]);

  const visibleItems = useMemo(
    () =>
      activeFilter === 'ALL'
        ? allItems
        : allItems.filter((item) => item.kind === activeFilter),
    [allItems, activeFilter],
  );

  const handleSelectFilter = (next: ContextEventFilterKind) => {
    if (controlledFilter === undefined) {
      setUncontrolledFilter(next);
    }
    onFilterChange?.(next);
  };

  return (
    <section
      ref={sectionRef}
      className={cn(
        'context-inspector-section context-events-section',
        focused && 'is-focused',
      )}
      data-testid="context-events-section"
      data-focused={focused ? 'true' : 'false'}
      data-active-filter={activeFilter}
    >
      <div className="context-inspector-section-head">
        <h3 className="context-inspector-section-title">
          {t('上下文事件', 'Context events')}
        </h3>
        <span className="context-inspector-section-meta">
          {t(
            `${allItems.length} 条`,
            `${allItems.length} ${allItems.length === 1 ? 'event' : 'events'}`,
          )}
        </span>
      </div>

      <div
        className="context-event-filter-bar"
        role="group"
        aria-label={t('按事件类型筛选', 'Filter events by type')}
      >
        {CONTEXT_EVENT_FILTER_KINDS.map((kind) => {
          const isActive = activeFilter === kind;
          return (
            <button
              key={kind}
              type="button"
              className={cn('context-event-filter-btn', isActive && 'is-active')}
              data-testid="context-event-filter"
              data-filter-kind={kind}
              aria-pressed={isActive}
              onClick={() => handleSelectFilter(kind)}
            >
              <span>{formatContextEventFilterLabel(kind, t)}</span>
              <span className="context-event-filter-count">{countsByKind[kind]}</span>
            </button>
          );
        })}
      </div>

      {visibleItems.length === 0 ? (
        <p className="context-inspector-note" data-testid="context-events-empty">
          {allItems.length === 0
            ? t(
                '暂无压缩、裁剪、步骤转交或子智能体派生事件。',
                'No compaction, trim, step hand-off, or subagent events recorded yet.',
              )
            : t(
                '当前筛选条件下暂无匹配的上下文事件。',
                'No context events match the selected filter.',
              )}
        </p>
      ) : (
        <div className="context-events-list">
          {visibleItems.map((item) => {
            const isSelected = Boolean(
              item.targetCallId && selectedCallId === item.targetCallId,
            );
            const deltaSign =
              item.tokenDelta > 0
                ? 'positive'
                : item.tokenDelta < 0
                  ? 'negative'
                  : 'zero';
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'context-event-item',
                  `is-${item.kind.toLowerCase()}`,
                  isSelected && 'is-selected',
                )}
                data-testid="context-event-item"
                data-event-kind={item.kind}
                data-target-call-id={item.targetCallId ?? ''}
                data-call-seq={String(item.callSeq)}
                data-selected={isSelected ? 'true' : 'false'}
                aria-pressed={isSelected}
                disabled={!item.targetCallId}
                onClick={() => {
                  if (item.targetCallId) {
                    onSelectCall(item.targetCallId);
                  }
                }}
              >
                <span
                  className={cn('context-event-dot', `is-${item.kind.toLowerCase()}`)}
                  aria-hidden="true"
                />
                <span className="context-event-body">
                  <span className="context-event-top">
                    <span className="context-event-title">
                      {t(item.title.zh, item.title.en)}
                    </span>
                    <span
                      className={cn('context-event-delta', `is-${deltaSign}`)}
                      data-testid="context-event-delta"
                    >
                      {formatSignedTokenDelta(item.tokenDelta)}
                    </span>
                  </span>
                  <span className="context-event-meta">
                    <span data-testid="context-event-source">
                      {t('来源', 'Source')}: {t(item.source.zh, item.source.en)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span data-testid="context-event-call-ref">
                      {item.callSeq > 0
                        ? t(`第 #${item.callSeq} 次调用`, `Call #${item.callSeq}`)
                        : t('首次调用前', 'Before call #1')}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
