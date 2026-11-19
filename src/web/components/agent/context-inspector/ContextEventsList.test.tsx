import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusinessLocale } from '../../../../packages/business-vocabulary/index.js';
import type {
  ContextEventSummary,
  ModelCallSummary,
} from '../../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import {
  ContextEventsList,
  deriveContextEventItems,
  type ContextEventFilterKind,
  type ContextInspectorRunTrace,
} from './ContextEventsList.js';

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

function makeCall(overrides: Partial<ModelCallSummary> & { id: string; seq: number }): ModelCallSummary {
  const promptTokens = overrides.usage?.promptTokens ?? 4000;
  const outputTokens = overrides.usage?.outputTokens ?? 260;
  const excludedCount = overrides.excludedCount ?? 0;
  return {
    projectId: 'proj-contract',
    sessionId: 'sess-ev-84',
    runId: 'run-1',
    purpose: 'TURN',
    provider: 'Z.ai',
    model: 'glm-5.3-flash',
    contextWindow: 128_000,
    maxOutputTokens: 8192,
    startedAt: `2026-11-18T10:0${overrides.seq % 10}:00.000Z`,
    endedAt: `2026-11-18T10:0${overrides.seq % 10}:02.000Z`,
    durationMs: 1200,
    status: 'COMPLETED',
    usage: {
      promptTokens,
      inputTokens: promptTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: promptTokens + outputTokens,
      source: 'PROVIDER',
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
      inputTokens: promptTokens,
      outputTokens,
      excludedTokens: excludedCount * 180,
    },
    includedCount: 8,
    excludedCount,
    responseToolNames: [],
    hasDetail: true,
    ...overrides,
  };
}

function buildFourCategoryFixture(): {
  modelCalls: ModelCallSummary[];
  contextEvents: ContextEventSummary[];
  runs: ContextInspectorRunTrace[];
} {
  const call1 = makeCall({
    id: 'call-1',
    seq: 1,
    runId: 'run-1',
    excludedCount: 0,
  });
  const call2Trim = makeCall({
    id: 'call-2-trim',
    seq: 2,
    runId: 'run-2',
    excludedCount: 3,
  });
  // call-3 follows compaction (afterCallSeq = 2) and proposes a step hand-off
  const call3Handoff = makeCall({
    id: 'call-3-handoff',
    seq: 3,
    runId: 'run-3',
    excludedCount: 0,
    responseToolNames: ['propose_step_handoff'],
    usage: {
      promptTokens: 3200,
      inputTokens: 3200,
      outputTokens: 190,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 3390,
      source: 'PROVIDER',
    },
  });
  // call-4 coordinator spawns 2 parallel subagents (calls #5 and #6)
  const call4Spawn = makeCall({
    id: 'call-4-spawn',
    seq: 4,
    runId: 'run-4',
    responseToolNames: ['init_prototype_shell', 'spawn_subagents'],
  });
  const call5SubA = makeCall({
    id: 'call-5-sub-a',
    seq: 5,
    runId: 'run-4',
    purpose: 'SUBAGENT',
    parentCallId: 'call-4-spawn',
    laneLabel: { zh: '台账设计师', en: 'Ledger Designer' },
    usage: {
      promptTokens: 2100,
      inputTokens: 2100,
      outputTokens: 420,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2520,
      source: 'PROVIDER',
    },
  });
  const call6SubB = makeCall({
    id: 'call-6-sub-b',
    seq: 6,
    runId: 'run-4',
    purpose: 'SUBAGENT',
    parentCallId: 'call-4-spawn',
    laneLabel: { zh: '详情设计师', en: 'Detail Designer' },
    usage: {
      promptTokens: 1900,
      inputTokens: 1900,
      outputTokens: 380,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2280,
      source: 'PROVIDER',
    },
  });

  const contextEvents: ContextEventSummary[] = [
    {
      id: 'ctxevt-compact-1',
      projectId: 'proj-contract',
      sessionId: 'sess-ev-84',
      kind: 'COMPACT',
      createdAt: '2026-11-18T10:02:30.000Z',
      removedCount: 4,
      reclaimedTokens: 640,
      summarizedByModel: true,
      afterCallSeq: 2,
    },
  ];

  const runs: ContextInspectorRunTrace[] = [
    {
      id: 'run-3',
      status: 'SUCCEEDED',
      stepHandoff: {
        id: 'hoff-1',
        sourceStep: 'REQUIREMENTS',
        targetStep: 'PROTOTYPE',
        request: '在原型台账增加到期预警列',
        status: 'PENDING',
      },
    },
  ];

  return {
    modelCalls: [call1, call2Trim, call3Handoff, call4Spawn, call5SubA, call6SubB],
    contextEvents,
    runs,
  };
}

describe('ContextEventsList (#84, User Story 28)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives all 4 event categories (TRIM, COMPACT, HANDOFF, SUBAGENT) in call order with source, token delta, and target call #seq', () => {
    const fixture = buildFourCategoryFixture();
    const items = deriveContextEventItems(fixture);

    expect(items.map((i) => i.kind)).toEqual(['TRIM', 'COMPACT', 'HANDOFF', 'SUBAGENT']);

    const [trimEvt, compactEvt, handoffEvt, subagentEvt] = items;

    expect(trimEvt).toMatchObject({
      kind: 'TRIM',
      source: { zh: '消息窗口裁剪', en: 'Sliding window' },
      tokenDelta: -540, // 3 * 180 excludedTokens
      callSeq: 2,
      targetCallId: 'call-2-trim',
    });

    expect(compactEvt).toMatchObject({
      kind: 'COMPACT',
      source: { zh: '模型概括', en: 'Model summary' },
      tokenDelta: -640,
      callSeq: 3, // call immediately following afterCallSeq=2
      targetCallId: 'call-3-handoff',
    });

    expect(handoffEvt).toMatchObject({
      kind: 'HANDOFF',
      source: { zh: '跨步骤转交', en: 'Step hand-off' },
      tokenDelta: 190,
      callSeq: 3,
      targetCallId: 'call-3-handoff',
    });

    expect(subagentEvt).toMatchObject({
      kind: 'SUBAGENT',
      source: { zh: '并行子智能体调度', en: 'Subagent dispatch' },
      tokenDelta: 4000, // 2100 + 1900 child promptTokens
      callSeq: 4,
      targetCallId: 'call-4-spawn',
    });
  });

  it('distinguishes deterministic compaction summary and codemode-dispatched subagent parent calls without N+1 fetches', () => {
    const parentCodemode = makeCall({
      id: 'call-cm-1',
      seq: 1,
      runId: 'run-cm',
      responseToolNames: ['codemode'],
    });
    const childSub = makeCall({
      id: 'call-cm-2',
      seq: 2,
      runId: 'run-cm',
      purpose: 'SUBAGENT',
      parentCallId: 'call-cm-1',
      laneLabel: { zh: '1 号智能体', en: 'Worker #1' },
      usage: {
        promptTokens: 1500,
        inputTokens: 1500,
        outputTokens: 300,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 1800,
        source: 'SIMULATED',
      },
    });
    const detCompact: ContextEventSummary = {
      id: 'ctxevt-det-1',
      projectId: 'proj-contract',
      sessionId: 'sess-ev-84',
      kind: 'COMPACT',
      createdAt: '2026-11-18T10:05:00.000Z',
      removedCount: 2,
      reclaimedTokens: 310,
      summarizedByModel: false,
      afterCallSeq: 2,
    };

    const items = deriveContextEventItems({
      modelCalls: [parentCodemode, childSub],
      contextEvents: [detCompact],
    });

    expect(items.map((i) => i.kind)).toEqual(['SUBAGENT', 'COMPACT']);
    expect(items[0]).toMatchObject({
      kind: 'SUBAGENT',
      targetCallId: 'call-cm-1',
      callSeq: 1,
      tokenDelta: 1500,
    });
    expect(items[1]).toMatchObject({
      kind: 'COMPACT',
      source: { zh: '结构化概括', en: 'Deterministic summary' },
      tokenDelta: -310,
      callSeq: 2,
      targetCallId: 'call-cm-2',
    });
  });

  it('renders type filter buttons with counts and filters accurately in both zh-CN and en-US', () => {
    const fixture = buildFourCategoryFixture();

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const allHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ContextEventsList
            {...fixture}
            selectedCallId="call-4-spawn"
            onSelectCall={() => undefined}
            focused
          />
        </PreferencesProvider>,
      );

      expect(allHtml).toContain('data-testid="context-events-section"');
      expect(allHtml).toContain('data-focused="true"');
      expect(allHtml.match(/data-testid="context-event-filter"/g)).toHaveLength(5);
      expect(allHtml.match(/data-testid="context-event-item"/g)).toHaveLength(4);

      if (locale === 'zh-CN') {
        expect(allHtml).toContain('上下文事件');
        expect(allHtml).toContain('全部');
        expect(allHtml).toContain('模型概括');
        expect(allHtml).toContain('消息窗口裁剪');
        expect(allHtml).toContain('跨步骤转交');
        expect(allHtml).toContain('并行子智能体调度');
        expect(allHtml).toContain('第 #2 次调用');
        expect(allHtml).toContain('第 #3 次调用');
        expect(allHtml).toContain('第 #4 次调用');
      } else {
        expect(allHtml).toContain('Context events');
        expect(allHtml).toContain('All');
        expect(allHtml).toContain('Model summary');
        expect(allHtml).toContain('Sliding window');
        expect(allHtml).toContain('Step hand-off');
        expect(allHtml).toContain('Subagent dispatch');
        expect(allHtml).toContain('Call #2');
        expect(allHtml).toContain('Call #3');
        expect(allHtml).toContain('Call #4');
      }
      expect(allHtml).toContain('−540');
      expect(allHtml).toContain('−640');
      expect(allHtml).toContain('+190');
      expect(allHtml).toContain('+4,000');

      const eachFilter: readonly [ContextEventFilterKind, string][] = [
        ['COMPACT', 'call-3-handoff'],
        ['TRIM', 'call-2-trim'],
        ['HANDOFF', 'call-3-handoff'],
        ['SUBAGENT', 'call-4-spawn'],
      ];
      for (const [filterKind, expectedTargetId] of eachFilter) {
        const filteredHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <ContextEventsList
              {...fixture}
              filter={filterKind}
              onSelectCall={() => undefined}
            />
          </PreferencesProvider>,
        );
        expect(filteredHtml.match(/data-testid="context-event-item"/g)).toHaveLength(1);
        expect(filteredHtml).toContain(`data-event-kind="${filterKind}"`);
        expect(filteredHtml).toContain(`data-target-call-id="${expectedTargetId}"`);
      }
    }
  });
});
