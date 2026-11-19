import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusinessLocale } from '../../../../packages/business-vocabulary/index.js';
import type {
  ContextEventSummary,
  ModelCallSummary,
  ModelCallUsageSource,
} from '../../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import {
  ModelCallTimeline,
  computeTimelineViewModel,
  formatModelCallPurposeLabel,
  formatSignedTokenDelta,
} from './ModelCallTimeline.js';

function stubLocale(locale: BusinessLocale) {
  const entries = new Map<string, string>([['onto_locale', locale]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, val: string) => {
      entries.set(key, val);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  });
}

function makeCall(opts: {
  id: string;
  seq: number;
  purpose?: ModelCallSummary['purpose'];
  parentCallId?: string;
  laneLabel?: { zh: string; en: string };
  model?: string;
  promptTokens: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
  source: ModelCallUsageSource;
  excludedCount?: number;
}): ModelCallSummary {
  const outputTokens = opts.outputTokens ?? 300;
  const cacheReadTokens = opts.cacheReadTokens ?? 0;
  const cacheWriteTokens = opts.cacheWriteTokens ?? 0;
  return {
    id: opts.id,
    projectId: 'proj-contract',
    sessionId: 'sess-tl-1',
    purpose: opts.purpose ?? 'TURN',
    ...(opts.parentCallId ? { parentCallId: opts.parentCallId } : {}),
    ...(opts.laneLabel ? { laneLabel: opts.laneLabel } : {}),
    seq: opts.seq,
    provider: 'Z.ai',
    model: opts.model ?? 'glm-5',
    contextWindow: 128_000,
    maxOutputTokens: 8192,
    startedAt: `2026-11-18T10:0${opts.seq % 10}:00.000Z`,
    endedAt: `2026-11-18T10:0${opts.seq % 10}:02.000Z`,
    durationMs: opts.durationMs ?? 1200,
    status: 'COMPLETED',
    usage: {
      promptTokens: opts.promptTokens,
      inputTokens: Math.max(0, opts.promptTokens - cacheReadTokens - cacheWriteTokens),
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: opts.promptTokens + outputTokens,
      source: opts.source,
    },
    estimate: {
      byKind: {
        INSTRUCTIONS: 1200,
        TOOL_GUIDE: 0,
        TOOL_DEFINITION: 800,
        BUSINESS_CONTEXT: 1000,
        COMPACTED_SUMMARY: 0,
        USER_MESSAGE: 600,
        ASSISTANT_MESSAGE: 400,
        TOOL_CALL: 0,
        TOOL_RESULT: 0,
        REASONING: 0,
      },
      inputTokens: 4000,
      outputTokens,
      excludedTokens: (opts.excludedCount ?? 0) * 150,
    },
    includedCount: 8,
    excludedCount: opts.excludedCount ?? 0,
    hasDetail: true,
  };
}

describe('ModelCallTimeline (#83)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('computes Cumulative heights and Delta positive/negative changes (including genuine TURN-to-TURN negative drop after compaction/trim)', () => {
    const calls: ModelCallSummary[] = [
      makeCall({
        id: 'call-1',
        seq: 1,
        purpose: 'TURN',
        promptTokens: 10_000,
        cacheReadTokens: 1200,
        cacheWriteTokens: 300,
        outputTokens: 350,
        durationMs: 1400,
        source: 'PROVIDER',
      }),
      makeCall({
        id: 'call-2',
        seq: 2,
        purpose: 'SUBAGENT',
        parentCallId: 'call-1',
        laneLabel: { zh: '法务条款核对', en: 'Legal Clause Check' },
        promptTokens: 3200,
        outputTokens: 500,
        durationMs: 2500,
        source: 'ESTIMATED',
      }),
      makeCall({
        id: 'call-3',
        seq: 3,
        purpose: 'TURN',
        promptTokens: 6200,
        outputTokens: 280,
        durationMs: 850,
        source: 'SIMULATED',
        excludedCount: 4,
      }),
    ];

    const compactEvents: ContextEventSummary[] = [
      {
        id: 'evt-compact-1',
        projectId: 'proj-contract',
        sessionId: 'sess-tl-1',
        kind: 'COMPACT',
        createdAt: '2026-11-18T10:02:30.000Z',
        removedCount: 4,
        reclaimedTokens: 3800,
        summarizedByModel: false,
        afterCallSeq: 2,
      },
    ];

    const vm = computeTimelineViewModel(calls, 'call-3', compactEvents);

    expect(vm.maxPromptTokens).toBe(10_000);
    expect(vm.maxAbsDelta).toBe(10_000);
    expect(vm.selectedBar?.call.id).toBe('call-3');

    expect(vm.bars.map((b) => [b.call.id, b.cumulativeRatio, b.deltaTokens, b.deltaSign])).toEqual([
      ['call-1', 1, 10_000, 'positive'],
      ['call-2', 0.32, 3200, 'positive'],
      ['call-3', 0.62, -3800, 'negative'],
    ]);
    expect(vm.bars[2]!.hasPrecedingCompactOrTrim).toBe(true);

    expect(formatSignedTokenDelta(4000)).toBe('+4,000');
    expect(formatSignedTokenDelta(-3800)).toBe('−3,800');
    expect(formatSignedTokenDelta(0)).toBe('0');
  });

  it('computes accurate TURN-to-TURN and per-lane SUBAGENT deltas across interleaved TURN + SUBAGENT + COMPACTION calls without false negative drops or positive spikes', () => {
    const calls: ModelCallSummary[] = [
      makeCall({
        id: 't-1',
        seq: 1,
        purpose: 'TURN',
        promptTokens: 8000,
        source: 'PROVIDER',
      }),
      makeCall({
        id: 'sub-a-1',
        seq: 2,
        purpose: 'SUBAGENT',
        parentCallId: 't-1',
        laneLabel: { zh: '界面 1 子智能体', en: 'Screen 1 Subagent' },
        promptTokens: 2000,
        source: 'PROVIDER',
      }),
      makeCall({
        id: 'sub-b-1',
        seq: 3,
        purpose: 'SUBAGENT',
        parentCallId: 't-1',
        laneLabel: { zh: '界面 2 子智能体', en: 'Screen 2 Subagent' },
        promptTokens: 2400,
        source: 'PROVIDER',
      }),
      makeCall({
        id: 'sub-a-2',
        seq: 4,
        purpose: 'SUBAGENT',
        parentCallId: 't-1',
        laneLabel: { zh: '界面 1 子智能体', en: 'Screen 1 Subagent' },
        promptTokens: 2900,
        source: 'PROVIDER',
      }),
      makeCall({
        id: 't-2',
        seq: 5,
        purpose: 'TURN',
        promptTokens: 9500,
        source: 'PROVIDER',
      }),
      makeCall({
        id: 'comp-1',
        seq: 6,
        purpose: 'COMPACTION',
        promptTokens: 4100,
        source: 'PROVIDER',
      }),
      makeCall({
        id: 't-3',
        seq: 7,
        purpose: 'TURN',
        promptTokens: 9900,
        source: 'PROVIDER',
      }),
    ];

    const vm = computeTimelineViewModel(calls, 't-2');
    expect(vm.bars.map((b) => [b.call.id, b.deltaTokens, b.deltaSign])).toEqual([
      ['t-1', 8000, 'positive'],
      // First call in lane A diffs against 0 (+2000), NOT against t-1 (-6000)
      ['sub-a-1', 2000, 'positive'],
      // First call in lane B diffs against 0 (+2400), NOT against sub-a-1 (+400)
      ['sub-b-1', 2400, 'positive'],
      // Second call in lane A diffs against sub-a-1 (2900 - 2000 = +900)
      ['sub-a-2', 900, 'positive'],
      // Next TURN call diffs against previous TURN t-1 (9500 - 8000 = +1500), NOT sub-a-2 (+6600)
      ['t-2', 1500, 'positive'],
      // Isolated COMPACTION call diffs against 0 (+4100), NOT t-2 (-5400)
      ['comp-1', 4100, 'positive'],
      // Next TURN call diffs against previous TURN t-2 (9900 - 9500 = +400), NOT comp-1 (+5800)
      ['t-3', 400, 'positive'],
    ]);

    expect(formatModelCallPurposeLabel('TURN', undefined, (zh, _en) => zh)).toBe('回复');
    expect(formatModelCallPurposeLabel('TURN', undefined, (_zh, en) => en)).toBe('Reply');
  });

  it('renders Cumulative and Delta modes, distinguishes PROVIDER (with cacheRead/cacheWrite) vs ESTIMATED vs SIMULATED in zh-CN & en-US, and styles non-provider bars distinctly', () => {
    const calls: ModelCallSummary[] = [
      makeCall({
        id: 'call-1',
        seq: 1,
        purpose: 'TURN',
        model: 'glm-5-pro',
        promptTokens: 10_000,
        cacheReadTokens: 1200,
        cacheWriteTokens: 300,
        outputTokens: 350,
        durationMs: 1400,
        source: 'PROVIDER',
      }),
      makeCall({
        id: 'call-2',
        seq: 2,
        purpose: 'SUBAGENT',
        parentCallId: 'call-1',
        laneLabel: { zh: '法务条款核对', en: 'Legal Clause Check' },
        model: 'glm-5-flash',
        promptTokens: 6000,
        outputTokens: 500,
        durationMs: 2500,
        source: 'ESTIMATED',
      }),
      makeCall({
        id: 'call-3',
        seq: 3,
        purpose: 'COMPACTION',
        model: 'mock-v1',
        promptTokens: 4200,
        outputTokens: 280,
        durationMs: 850,
        source: 'SIMULATED',
      }),
      makeCall({
        id: 'call-4',
        seq: 4,
        purpose: 'TURN',
        model: 'glm-5-pro',
        promptTokens: 6200,
        outputTokens: 310,
        durationMs: 920,
        source: 'PROVIDER',
        excludedCount: 4,
      }),
    ];

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);

      // 1. Cumulative mode with PROVIDER call #1 selected (shows Reply label, cacheRead & cacheWrite)
      const cumHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ModelCallTimeline
            modelCalls={calls}
            selectedCallId="call-1"
            mode="cumulative"
            onSelectCall={() => undefined}
          />
        </PreferencesProvider>,
      );

      expect(cumHtml).toContain('data-testid="context-call-timeline"');
      expect(cumHtml).toContain('data-testid="context-timeline-mode-cumulative"');
      expect(cumHtml).toContain('data-testid="context-timeline-mode-delta"');
      expect(cumHtml.match(/data-testid="context-timeline-bar"/g)).toHaveLength(4);
      expect(cumHtml).toContain('data-call-id="call-1"');
      expect(cumHtml).toContain('data-call-seq="1"');
      expect(cumHtml).toContain('data-selected="true"');
      expect(cumHtml).toContain('data-usage-source="PROVIDER"');
      expect(cumHtml).toContain('data-usage-source="ESTIMATED"');
      expect(cumHtml).toContain('data-usage-source="SIMULATED"');
      expect(cumHtml).toContain('is-non-provider');

      // Selected summary for call #1: Reply + PROVIDER + cacheRead 1,200 + cacheWrite 300 + output 350 + 1.4s
      expect(cumHtml).toContain('data-testid="context-timeline-selected-summary"');
      expect(cumHtml).toContain(locale === 'en-US' ? '#1 Reply' : '#1 回复');
      expect(cumHtml).not.toContain('#1 Turn');
      expect(cumHtml).toContain('glm-5-pro');
      expect(cumHtml).toContain('10,000');
      expect(cumHtml).toContain('1,200');
      expect(cumHtml).toContain('300');
      expect(cumHtml).toContain('350');
      expect(cumHtml).toContain('1.4s');
      expect(cumHtml).toContain(locale === 'en-US' ? 'Provider-reported' : '服务商返回');

      // 2. Delta mode with SUBAGENT ESTIMATED call #2 selected
      const estHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ModelCallTimeline
            modelCalls={calls}
            selectedCallId="call-2"
            mode="delta"
            onSelectCall={() => undefined}
          />
        </PreferencesProvider>,
      );
      expect(estHtml).toContain('#2');
      expect(estHtml).toContain(locale === 'en-US' ? 'Legal Clause Check' : '法务条款核对');
      expect(estHtml).toContain(locale === 'en-US' ? 'Estimated' : '估算');
      expect(estHtml).toContain('+6,000');
      // Delta mode renders negative TURN-to-TURN drop on call #4 (6,200 - 10,000 = -3,800)
      expect(estHtml).toContain('data-delta="-3800"');
      expect(estHtml).toContain('data-delta-sign="negative"');
      expect(estHtml).toContain('−3,800');

      // 3. SIMULATED COMPACTION call #3 selected
      const simHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ModelCallTimeline
            modelCalls={calls}
            selectedCallId="call-3"
            mode="delta"
            onSelectCall={() => undefined}
          />
        </PreferencesProvider>,
      );
      expect(simHtml).toContain('#3');
      expect(simHtml).toContain(locale === 'en-US' ? 'Compaction' : '压缩');
      expect(simHtml).toContain(locale === 'en-US' ? 'Simulated' : '模拟');
      expect(simHtml).toContain('+4,200');
      expect(simHtml).toContain('850ms');
    }
  });

  it('renders 90+ calls inside a bounded horizontal scroll container without dropping bars', () => {
    stubLocale('zh-CN');
    const manyCalls = Array.from({ length: 95 }, (_, idx) =>
      makeCall({
        id: `call-long-${idx + 1}`,
        seq: idx + 1,
        promptTokens: 2000 + (idx % 12) * 800,
        source: idx % 3 === 0 ? 'PROVIDER' : 'SIMULATED',
      }),
    );

    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <ModelCallTimeline
          modelCalls={manyCalls}
          selectedCallId="call-long-95"
          onSelectCall={() => undefined}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('data-testid="context-timeline-scroll"');
    expect(html.match(/data-testid="context-timeline-bar"/g)).toHaveLength(95);
    expect(html).toContain('data-call-seq="95"');
  });
});
