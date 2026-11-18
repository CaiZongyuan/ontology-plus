import React from 'react';
import type {
  ModelCallSummary,
  ModelCallUsageSource,
} from '../../../../packages/workspace-store/index.js';
import { usePreferences } from '../../../i18n.js';
import './context-inspector.css';

export type ContextCompositionSegmentKey =
  | 'system_prompt'
  | 'tool_definitions'
  | 'business_context'
  | 'messages'
  | 'tool_results'
  | 'thinking'
  | 'remaining';

export const CONTEXT_COMPOSITION_SEGMENT_KEYS: readonly ContextCompositionSegmentKey[] = [
  'system_prompt',
  'tool_definitions',
  'business_context',
  'messages',
  'tool_results',
  'thinking',
  'remaining',
] as const;

type UsedSegmentKey = Exclude<ContextCompositionSegmentKey, 'remaining'>;

const USED_SEGMENT_KEYS: readonly UsedSegmentKey[] = [
  'system_prompt',
  'tool_definitions',
  'business_context',
  'messages',
  'tool_results',
  'thinking',
] as const;

export interface ContextCompositionSegment {
  readonly key: ContextCompositionSegmentKey;
  readonly labelZh: string;
  readonly labelEn: string;
  readonly tokens: number;
  readonly ratio: number;
  readonly pctLabel: string;
}

export interface ComputedContextComposition {
  readonly usedTokens: number;
  readonly contextWindow: number;
  readonly pct: number;
  readonly source: ModelCallUsageSource | null;
  readonly cacheReadTokens: number;
  readonly segments: readonly ContextCompositionSegment[];
}

const SEGMENT_LABELS: Readonly<
  Record<ContextCompositionSegmentKey, { zh: string; en: string }>
> = {
  system_prompt: { zh: 'system prompt', en: 'system prompt' },
  tool_definitions: { zh: '工具定义', en: 'Tool definitions' },
  business_context: { zh: '注入的业务上下文', en: 'Injected business context' },
  messages: { zh: '对话消息', en: 'Messages' },
  tool_results: { zh: '工具结果', en: 'Tool results' },
  thinking: { zh: '思考', en: 'Thinking' },
  remaining: { zh: '剩余窗口', en: 'Remaining window' },
};

export function formatTokenCount(tokens: number): string {
  return Math.max(0, Math.round(tokens)).toLocaleString('en-US');
}

export function formatWindowPercentage(tokens: number, contextWindow: number): string {
  if (tokens <= 0 || contextWindow <= 0) return '0%';
  const rawPct = Math.min(100, (tokens / contextWindow) * 100);
  if (rawPct < 0.1) return '<0.1%';
  const roundedTenths = Math.round(rawPct * 10) / 10;
  return Number.isInteger(roundedTenths) ? `${roundedTenths}%` : `${roundedTenths.toFixed(1)}%`;
}

function scaleBucketsProportionally(
  rawBuckets: Readonly<Record<UsedSegmentKey, number>>,
  targetTotal: number,
): Record<UsedSegmentKey, number> {
  const zeroResult: Record<UsedSegmentKey, number> = {
    system_prompt: 0,
    tool_definitions: 0,
    business_context: 0,
    messages: 0,
    tool_results: 0,
    thinking: 0,
  };
  if (targetTotal <= 0) return zeroResult;

  const nonZeroKeys = USED_SEGMENT_KEYS.filter((k) => rawBuckets[k] > 0);
  const rawSum = nonZeroKeys.reduce((sum, k) => sum + rawBuckets[k], 0);
  if (rawSum <= 0) {
    // Fallback when detail estimates were dropped or empty while usage.promptTokens > 0
    return { ...zeroResult, messages: targetTotal };
  }

  const allocations = nonZeroKeys.map((key, orderIndex) => {
    const exact = (rawBuckets[key] * targetTotal) / rawSum;
    const floored = Math.floor(exact);
    return {
      key,
      floored,
      remainder: exact - floored,
      orderIndex,
    };
  });

  let remainingRemainder =
    targetTotal - allocations.reduce((sum, item) => sum + item.floored, 0);
  allocations.sort(
    (a, b) => b.remainder - a.remainder || a.orderIndex - b.orderIndex,
  );
  for (let i = 0; i < allocations.length && remainingRemainder > 0; i += 1) {
    allocations[i]!.floored += 1;
    remainingRemainder -= 1;
  }

  const result = { ...zeroResult };
  for (const item of allocations) {
    result[item.key] = item.floored;
  }
  return result;
}

export function computeContextComposition(
  latestCall?: ModelCallSummary | null,
  defaultContextWindow = 128_000,
): ComputedContextComposition {
  const contextWindow =
    latestCall && latestCall.contextWindow > 0
      ? latestCall.contextWindow
      : Math.max(1, defaultContextWindow);
  const usedTokens = latestCall ? Math.max(0, latestCall.usage.promptTokens) : 0;
  const pct =
    usedTokens > 0
      ? Math.min(100, Math.max(0, Math.round((usedTokens / contextWindow) * 100)))
      : 0;

  const byKind = latestCall?.estimate.byKind;
  const rawBuckets: Record<UsedSegmentKey, number> = {
    system_prompt: (byKind?.INSTRUCTIONS ?? 0) + (byKind?.TOOL_GUIDE ?? 0),
    tool_definitions: byKind?.TOOL_DEFINITION ?? 0,
    business_context: (byKind?.BUSINESS_CONTEXT ?? 0) + (byKind?.COMPACTED_SUMMARY ?? 0),
    messages: (byKind?.USER_MESSAGE ?? 0) + (byKind?.ASSISTANT_MESSAGE ?? 0),
    tool_results: (byKind?.TOOL_CALL ?? 0) + (byKind?.TOOL_RESULT ?? 0),
    thinking: byKind?.REASONING ?? 0,
  };

  const scaled = scaleBucketsProportionally(rawBuckets, usedTokens);
  const remainingTokens = Math.max(0, contextWindow - usedTokens);

  const segments: ContextCompositionSegment[] = CONTEXT_COMPOSITION_SEGMENT_KEYS.map((key) => {
    const tokens = key === 'remaining' ? remainingTokens : scaled[key];
    const ratio = contextWindow > 0 ? Math.min(1, Math.max(0, tokens / contextWindow)) : 0;
    const label = SEGMENT_LABELS[key];
    return {
      key,
      labelZh: label.zh,
      labelEn: label.en,
      tokens,
      ratio,
      pctLabel: formatWindowPercentage(tokens, contextWindow),
    };
  });

  return {
    usedTokens,
    contextWindow,
    pct,
    source: latestCall?.usage.source ?? null,
    cacheReadTokens: latestCall ? Math.max(0, latestCall.usage.cacheReadTokens) : 0,
    segments,
  };
}

export function ContextUsageSourceBadge({ source }: { source: ModelCallUsageSource }) {
  const { t } = usePreferences();
  const label =
    source === 'PROVIDER'
      ? t('服务商返回', 'Provider-reported')
      : source === 'ESTIMATED'
        ? t('估算', 'Estimated')
        : t('模拟', 'Simulated');
  return (
    <span
      className={`context-usage-source is-${source.toLowerCase()}`}
      data-testid="context-usage-source"
      data-source={source}
    >
      {label}
    </span>
  );
}

export interface ContextCompositionBarProps {
  latestCall?: ModelCallSummary | null;
  defaultContextWindow?: number;
}

/**
 * Displays the 7-segment context composition bar and legend for the active session's
 * latest Model Call (#82, ADR 0017), including token counts, percentages of contextWindow,
 * usage source badge (PROVIDER / ESTIMATED / SIMULATED), and cacheReadTokens note.
 */
export function ContextCompositionBar({
  latestCall,
  defaultContextWindow = 128_000,
}: ContextCompositionBarProps) {
  const { t } = usePreferences();
  const comp = computeContextComposition(latestCall, defaultContextWindow);

  return (
    <section
      className="context-inspector-section"
      data-testid="context-composition-bar"
    >
      <div className="context-inspector-section-head">
        <h3 className="context-inspector-section-title">
          {t('当前上下文构成', 'Current context breakdown')}
        </h3>
        <div className="context-inspector-section-meta">
          <span>
            {formatTokenCount(comp.usedTokens)} / {formatTokenCount(comp.contextWindow)} ·{' '}
            {comp.pct}%
          </span>
          {comp.source && <ContextUsageSourceBadge source={comp.source} />}
        </div>
      </div>

      <div
        className="context-composition-stackbar"
        role="img"
        aria-label={t(
          `当前上下文已用 ${comp.pct}%`,
          `Current context ${comp.pct}% used`,
        )}
      >
        {comp.segments.map((seg) => {
          if (seg.key === 'remaining') {
            return (
              <span
                key={seg.key}
                className={`context-seg-fill is-${seg.key}`}
                style={{ flex: 1 }}
                title={`${t(seg.labelZh, seg.labelEn)}: ${formatTokenCount(seg.tokens)} (${seg.pctLabel})`}
              />
            );
          }
          if (seg.tokens <= 0) return null;
          return (
            <span
              key={seg.key}
              className={`context-seg-fill is-${seg.key}`}
              style={{ width: `${Math.min(100, seg.ratio * 100)}%` }}
              title={`${t(seg.labelZh, seg.labelEn)}: ${formatTokenCount(seg.tokens)} (${seg.pctLabel})`}
            />
          );
        })}
      </div>

      <ul className="context-composition-legend">
        {comp.segments.map((seg) => (
          <li
            key={seg.key}
            className="context-composition-legend-row"
            data-testid="context-composition-segment"
            data-segment-key={seg.key}
            data-tokens={String(seg.tokens)}
            data-pct={seg.pctLabel}
          >
            <span
              className={`context-seg-swatch is-${seg.key}`}
              aria-hidden="true"
            />
            <span className="context-composition-seg-label">
              {t(seg.labelZh, seg.labelEn)}
            </span>
            <span className="context-composition-seg-num">
              {formatTokenCount(seg.tokens)} · {seg.pctLabel}
            </span>
          </li>
        ))}
      </ul>

      {!latestCall ? (
        <p
          className="context-inspector-note"
          data-testid="context-composition-empty-note"
        >
          {t(
            '尚未发起模型调用，发送第一条消息后将记录实际发送的上下文构成。',
            'No model calls yet. Send a message to record the actual context breakdown.',
          )}
        </p>
      ) : comp.cacheReadTokens > 0 ? (
        <p
          className="context-inspector-note"
          data-testid="context-cache-read-note"
        >
          {t(
            `分类数值按字数估算比例分配到总输入；本次缓存命中 ${formatTokenCount(comp.cacheReadTokens)} tokens。`,
            `Category figures are scaled proportionally to total prompt tokens; cache hit ${formatTokenCount(comp.cacheReadTokens)} tokens.`,
          )}
        </p>
      ) : (
        <p className="context-inspector-note">
          {t(
            '分类数值按各部分长度比例分配到本次实际读取的总输入。',
            'Category figures are scaled proportionally to total prompt tokens read on this call.',
          )}
        </p>
      )}
    </section>
  );
}
