import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ContextEventSummary,
  ModelCallPurpose,
  ModelCallSummary,
  ModelCallUsageSource,
} from '../../../../packages/workspace-store/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import {
  ContextUsageSourceBadge,
  formatTokenCount,
  type ContextCompositionSegmentKey,
} from './ContextCompositionBar.js';
import './context-inspector.css';

export type ModelCallTimelineMode = 'cumulative' | 'delta';

export type TimelineDeltaSign = 'positive' | 'negative' | 'zero';

type TimelineStackKey = Exclude<ContextCompositionSegmentKey, 'remaining'>;

const TIMELINE_STACK_KEYS: readonly TimelineStackKey[] = [
  'system_prompt',
  'tool_definitions',
  'business_context',
  'messages',
  'tool_results',
  'thinking',
] as const;

export interface TimelineStackSlice {
  readonly key: TimelineStackKey;
  readonly weight: number;
}

export interface TimelineBarModel {
  readonly call: ModelCallSummary;
  readonly cumulativeRatio: number;
  readonly deltaTokens: number;
  readonly deltaRatio: number;
  readonly deltaSign: TimelineDeltaSign;
  readonly stackSlices: readonly TimelineStackSlice[];
  readonly hasPrecedingCompactOrTrim: boolean;
}

export interface ComputedTimelineViewModel {
  readonly bars: readonly TimelineBarModel[];
  readonly selectedBar: TimelineBarModel | null;
  readonly maxPromptTokens: number;
  readonly maxAbsDelta: number;
}

export function formatSignedTokenDelta(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return '0';
  const abs = formatTokenCount(Math.abs(rounded));
  return rounded > 0 ? `+${abs}` : `−${abs}`;
}

export function formatCompactSignedTokenDelta(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return '0';
  const abs = Math.abs(rounded);
  const body =
    abs >= 10_000
      ? `${Math.round(abs / 1000)}k`
      : abs >= 1000
        ? `${(abs / 1000).toFixed(1)}k`
        : String(abs);
  return rounded > 0 ? `+${body}` : `−${body}`;
}

export function formatModelCallDuration(durationMs: number): string {
  const safe = Math.max(0, Math.round(durationMs));
  if (safe < 1000) return `${safe}ms`;
  return `${(safe / 1000).toFixed(1)}s`;
}

export function formatModelCallPurposeLabel(
  purpose: ModelCallPurpose,
  laneLabel: { zh: string; en: string } | undefined,
  t: (zh: string, en: string) => string,
): string {
  if (purpose === 'SUBAGENT') {
    const lane = laneLabel ? t(laneLabel.zh, laneLabel.en) : '';
    return lane
      ? `${t('子智能体', 'Subagent')} · ${lane}`
      : t('子智能体', 'Subagent');
  }
  if (purpose === 'COMPACTION') {
    return t('压缩', 'Compaction');
  }
  return t('回复', 'Turn');
}

export function formatUsageSourceInlineLabel(
  source: ModelCallUsageSource,
  t: (zh: string, en: string) => string,
): string {
  if (source === 'PROVIDER') return t('服务商返回', 'Provider-reported');
  if (source === 'ESTIMATED') return t('估算', 'Estimated');
  return t('模拟', 'Simulated');
}

function buildStackSlices(call: ModelCallSummary): readonly TimelineStackSlice[] {
  const byKind = call.estimate.byKind;
  const raw: Record<TimelineStackKey, number> = {
    system_prompt: (byKind?.INSTRUCTIONS ?? 0) + (byKind?.TOOL_GUIDE ?? 0),
    tool_definitions: byKind?.TOOL_DEFINITION ?? 0,
    business_context: (byKind?.BUSINESS_CONTEXT ?? 0) + (byKind?.COMPACTED_SUMMARY ?? 0),
    messages: (byKind?.USER_MESSAGE ?? 0) + (byKind?.ASSISTANT_MESSAGE ?? 0),
    tool_results: (byKind?.TOOL_CALL ?? 0) + (byKind?.TOOL_RESULT ?? 0),
    thinking: byKind?.REASONING ?? 0,
  };
  const nonZero = TIMELINE_STACK_KEYS.filter((k) => raw[k] > 0).map((key) => ({
    key,
    weight: raw[key],
  }));
  if (nonZero.length > 0) return nonZero;
  if (call.usage.promptTokens > 0) {
    return [{ key: 'messages', weight: call.usage.promptTokens }];
  }
  return [];
}

export function computeTimelineViewModel(
  modelCalls: readonly ModelCallSummary[],
  selectedCallId?: string | null,
  contextEvents?: readonly ContextEventSummary[],
): ComputedTimelineViewModel {
  if (modelCalls.length === 0) {
    return {
      bars: [],
      selectedBar: null,
      maxPromptTokens: 0,
      maxAbsDelta: 0,
    };
  }

  const compactAfterSeqSet = new Set(
    (contextEvents ?? [])
      .filter((e) => e.kind === 'COMPACT')
      .map((e) => e.afterCallSeq),
  );

  const maxPromptTokens = modelCalls.reduce(
    (max, call) => Math.max(max, Math.max(0, call.usage.promptTokens)),
    0,
  );

  const deltas = modelCalls.map((call, idx) => {
    const prevPrompt = idx > 0 ? modelCalls[idx - 1]!.usage.promptTokens : 0;
    return call.usage.promptTokens - prevPrompt;
  });

  const maxAbsDelta = deltas.reduce((max, d) => Math.max(max, Math.abs(d)), 0);

  const bars: TimelineBarModel[] = modelCalls.map((call, idx) => {
    const promptTokens = Math.max(0, call.usage.promptTokens);
    const prevCall = idx > 0 ? modelCalls[idx - 1] : undefined;
    const deltaTokens = deltas[idx]!;
    const deltaSign: TimelineDeltaSign =
      deltaTokens > 0 ? 'positive' : deltaTokens < 0 ? 'negative' : 'zero';
    const cumulativeRatio =
      maxPromptTokens > 0 ? Math.min(1, Math.max(0, promptTokens / maxPromptTokens)) : 0;
    const deltaRatio =
      maxAbsDelta > 0 ? Math.min(1, Math.max(0, Math.abs(deltaTokens) / maxAbsDelta)) : 0;
    const hasPrecedingCompactOrTrim = Boolean(
      (prevCall && compactAfterSeqSet.has(prevCall.seq)) ||
        call.excludedCount > (prevCall?.excludedCount ?? 0),
    );

    return {
      call,
      cumulativeRatio,
      deltaTokens,
      deltaRatio,
      deltaSign,
      stackSlices: buildStackSlices(call),
      hasPrecedingCompactOrTrim,
    };
  });

  const selectedBar =
    (selectedCallId ? bars.find((b) => b.call.id === selectedCallId) : undefined) ??
    bars[bars.length - 1] ??
    null;

  return {
    bars,
    selectedBar,
    maxPromptTokens,
    maxAbsDelta,
  };
}

export interface ModelCallTimelineProps {
  modelCalls: readonly ModelCallSummary[];
  selectedCallId?: string | null;
  onSelectCall: (callId: string) => void;
  contextEvents?: readonly ContextEventSummary[];
  mode?: ModelCallTimelineMode;
  defaultMode?: ModelCallTimelineMode;
  onModeChange?: (mode: ModelCallTimelineMode) => void;
}

/**
 * Per-call vertical bar timeline (#83, User Stories 26–27, ADR 0017).
 * Supports Cumulative ("累计") and Delta ("增量") modes, bounded horizontal scrolling
 * for long 60–220+ call sessions, and explicit distinction between PROVIDER vs ESTIMATED / SIMULATED usage.
 */
export function ModelCallTimeline({
  modelCalls,
  selectedCallId,
  onSelectCall,
  contextEvents,
  mode: controlledMode,
  defaultMode = 'cumulative',
  onModeChange,
}: ModelCallTimelineProps) {
  const { t } = usePreferences();
  const [uncontrolledMode, setUncontrolledMode] = useState<ModelCallTimelineMode>(defaultMode);
  const mode = controlledMode ?? uncontrolledMode;

  const selectedBarRef = useRef<HTMLButtonElement | null>(null);

  const vm = useMemo(
    () => computeTimelineViewModel(modelCalls, selectedCallId, contextEvents),
    [modelCalls, selectedCallId, contextEvents],
  );

  useEffect(() => {
    selectedBarRef.current?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [vm.selectedBar?.call.id]);

  const handleSetMode = (nextMode: ModelCallTimelineMode) => {
    if (controlledMode === undefined) {
      setUncontrolledMode(nextMode);
    }
    onModeChange?.(nextMode);
  };

  const selectedCall = vm.selectedBar?.call ?? null;

  return (
    <section
      className="context-inspector-section context-call-timeline"
      data-testid="context-call-timeline"
      data-timeline-mode={mode}
    >
      <div className="context-inspector-section-head">
        <h3 className="context-inspector-section-title">
          {t('逐次调用', 'Call timeline')}
        </h3>

        <div
          className="context-timeline-mode-toggle"
          role="group"
          aria-label={t('时间线视图模式', 'Timeline display mode')}
        >
          <button
            type="button"
            className={cn(
              'context-timeline-mode-btn',
              mode === 'cumulative' && 'is-active',
            )}
            data-testid="context-timeline-mode-cumulative"
            aria-pressed={mode === 'cumulative'}
            onClick={() => handleSetMode('cumulative')}
          >
            {t('累计', 'Cumulative')}
          </button>
          <button
            type="button"
            className={cn(
              'context-timeline-mode-btn',
              mode === 'delta' && 'is-active',
            )}
            data-testid="context-timeline-mode-delta"
            aria-pressed={mode === 'delta'}
            onClick={() => handleSetMode('delta')}
          >
            {t('增量', 'Delta')}
          </button>
        </div>
      </div>

      {vm.bars.length === 0 ? (
        <p className="context-inspector-note" data-testid="context-timeline-empty">
          {t('暂无调用记录。', 'No model calls recorded yet.')}
        </p>
      ) : (
        <>
          <div
            className="context-timeline-scroll"
            data-testid="context-timeline-scroll"
          >
            <div className={cn('context-timeline-track', `is-${mode}`)}>
              {mode === 'delta' && (
                <div className="context-timeline-zero-line" aria-hidden="true" />
              )}
              {vm.bars.map((bar) => {
                const { call } = bar;
                const isSelected = vm.selectedBar?.call.id === call.id;
                const isNonProvider = call.usage.source !== 'PROVIDER';
                const purposeLabel = formatModelCallPurposeLabel(
                  call.purpose,
                  call.laneLabel,
                  t,
                );
                const sourceLabel = formatUsageSourceInlineLabel(
                  call.usage.source,
                  t,
                );
                const signedDelta = formatSignedTokenDelta(bar.deltaTokens);
                const compactDelta = formatCompactSignedTokenDelta(bar.deltaTokens);
                const barTitle = `${
                  `#${call.seq} ${purposeLabel} · ${call.model} · ` +
                  `${t('输入', 'Input')} ${formatTokenCount(call.usage.promptTokens)} (${t('增量', 'Delta')} ${signedDelta}) · ` +
                  sourceLabel
                }`;

                const cumulativeHeightPct =
                  call.usage.promptTokens > 0
                    ? Math.max(8, Math.round(bar.cumulativeRatio * 100))
                    : 0;
                const deltaHalfHeightPct =
                  bar.deltaTokens !== 0
                    ? Math.max(10, Math.round(bar.deltaRatio * 46))
                    : 4;

                return (
                  <button
                    key={call.id}
                    ref={isSelected ? selectedBarRef : undefined}
                    type="button"
                    className={cn(
                      'context-timeline-bar',
                      isSelected && 'is-selected',
                      `is-purpose-${call.purpose.toLowerCase()}`,
                      `is-source-${call.usage.source.toLowerCase()}`,
                      isNonProvider && 'is-non-provider',
                    )}
                    data-testid="context-timeline-bar"
                    data-call-id={call.id}
                    data-call-seq={String(call.seq)}
                    data-selected={isSelected ? 'true' : 'false'}
                    data-usage-source={call.usage.source}
                    data-purpose={call.purpose}
                    data-delta={String(bar.deltaTokens)}
                    data-delta-sign={bar.deltaSign}
                    aria-pressed={isSelected}
                    title={barTitle}
                    onClick={() => onSelectCall(call.id)}
                  >
                    {bar.hasPrecedingCompactOrTrim && (
                      <span
                        className="context-timeline-event-flag"
                        data-testid="context-timeline-event-flag"
                        aria-hidden="true"
                      />
                    )}

                    <span className="context-timeline-bar-plot">
                      {mode === 'cumulative' ? (
                        <span
                          className="context-timeline-bar-stack"
                          style={{ height: `${cumulativeHeightPct}%` }}
                        >
                          {bar.stackSlices.map((slice) => (
                            <span
                              key={slice.key}
                              className={`context-seg-fill is-${slice.key}`}
                              style={{ flex: slice.weight }}
                            />
                          ))}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'context-timeline-bar-delta',
                            `is-${bar.deltaSign}`,
                          )}
                          style={{ height: `${deltaHalfHeightPct}%` }}
                        />
                      )}
                    </span>

                    <span className="context-timeline-bar-caption">
                      {mode === 'delta'
                        ? compactDelta
                        : call.purpose === 'SUBAGENT'
                          ? `${t('子', 'S')}${call.seq}`
                          : `#${call.seq}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedCall && vm.selectedBar && (
            <div
              className="context-timeline-selected-summary"
              data-testid="context-timeline-selected-summary"
            >
              <span className="context-timeline-summary-primary">
                #{selectedCall.seq}{' '}
                {formatModelCallPurposeLabel(
                  selectedCall.purpose,
                  selectedCall.laneLabel,
                  t,
                )}
              </span>
              <span className="context-timeline-summary-model">
                {selectedCall.model}
              </span>
              <span>
                {t('输入', 'Input')} {formatTokenCount(selectedCall.usage.promptTokens)}
                {(selectedCall.usage.cacheReadTokens > 0 ||
                  selectedCall.usage.cacheWriteTokens > 0) && (
                  <>
                    {' '}
                    ({[
                      selectedCall.usage.cacheReadTokens > 0
                        ? t(
                            `缓存命中 ${formatTokenCount(selectedCall.usage.cacheReadTokens)}`,
                            `cache read ${formatTokenCount(selectedCall.usage.cacheReadTokens)}`,
                          )
                        : null,
                      selectedCall.usage.cacheWriteTokens > 0
                        ? t(
                            `缓存写入 ${formatTokenCount(selectedCall.usage.cacheWriteTokens)}`,
                            `cache write ${formatTokenCount(selectedCall.usage.cacheWriteTokens)}`,
                          )
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')})
                  </>
                )}
              </span>
              {mode === 'delta' && (
                <span
                  className={cn(
                    'context-timeline-summary-delta',
                    `is-${vm.selectedBar.deltaSign}`,
                  )}
                >
                  {t('增量', 'Delta')} {formatSignedTokenDelta(vm.selectedBar.deltaTokens)}
                </span>
              )}
              <span>
                {t('输出', 'Output')} {formatTokenCount(selectedCall.usage.outputTokens)}
              </span>
              <span>{formatModelCallDuration(selectedCall.durationMs)}</span>
              <ContextUsageSourceBadge source={selectedCall.usage.source} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
