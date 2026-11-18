import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusinessLocale } from '../../../../packages/business-vocabulary/index.js';
import {
  createWorkspaceStore,
  type ModelCallSummary,
  type ModelCallUsageSource,
} from '../../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../../server/app.js';
import {
  apiGetContextEvent,
  apiGetModelCall,
  apiListSessionModelCalls,
} from '../../../api.js';
import { PreferencesProvider } from '../../../i18n.js';
import {
  CONTEXT_COMPOSITION_SEGMENT_KEYS,
  ContextCompositionBar,
  computeContextComposition,
} from './ContextCompositionBar.js';

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

function makeCallWithSource(
  source: ModelCallUsageSource,
  cacheReadTokens = 0,
): ModelCallSummary {
  // Raw estimates sum to 5,000:
  // system_prompt (INSTRUCTIONS 1200 + TOOL_GUIDE 300) = 1500 (30%)
  // tool_definitions (TOOL_DEFINITION 1000) = 1000 (20%)
  // business_context (BUSINESS_CONTEXT 700 + COMPACTED_SUMMARY 300) = 1000 (20%)
  // messages (USER_MESSAGE 400 + ASSISTANT_MESSAGE 600) = 1000 (20%)
  // tool_results (TOOL_CALL 200 + TOOL_RESULT 300) = 500 (10%)
  // thinking (REASONING 0) = 0 (0%)
  // Provider promptTokens = 10,000 out of contextWindow = 100,000 -> 2x scale!
  return {
    id: 'mcall-comp-1',
    projectId: 'proj-contract',
    sessionId: 'sess-comp-1',
    purpose: 'TURN',
    seq: 4,
    provider: 'Z.ai',
    model: 'glm-5',
    contextWindow: 100_000,
    maxOutputTokens: 8192,
    startedAt: '2026-11-18T10:10:00.000Z',
    endedAt: '2026-11-18T10:10:02.000Z',
    durationMs: 2000,
    status: 'COMPLETED',
    usage: {
      promptTokens: 10_000,
      inputTokens: 10_000 - cacheReadTokens,
      outputTokens: 600,
      cacheReadTokens,
      cacheWriteTokens: 0,
      totalTokens: 10_600,
      source,
    },
    estimate: {
      byKind: {
        INSTRUCTIONS: 1200,
        TOOL_GUIDE: 300,
        TOOL_DEFINITION: 1000,
        BUSINESS_CONTEXT: 700,
        COMPACTED_SUMMARY: 300,
        USER_MESSAGE: 400,
        ASSISTANT_MESSAGE: 600,
        TOOL_CALL: 200,
        TOOL_RESULT: 300,
        REASONING: 0,
      },
      inputTokens: 5000,
      outputTokens: 600,
      excludedTokens: 0,
    },
    includedCount: 12,
    excludedCount: 0,
    hasDetail: true,
  };
}

describe('ContextCompositionBar & Client Snapshot API (#82)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('scales non-zero estimate.byKind buckets proportionally so the 6 used segments sum to promptTokens and remaining fills contextWindow', () => {
    const call = makeCallWithSource('PROVIDER', 4200);
    const comp = computeContextComposition(call);

    expect(comp.usedTokens).toBe(10_000);
    expect(comp.contextWindow).toBe(100_000);
    expect(comp.pct).toBe(10);
    expect(comp.segments.map((s) => [s.key, s.tokens, s.pctLabel])).toEqual([
      ['system_prompt', 3000, '3%'],
      ['tool_definitions', 2000, '2%'],
      ['business_context', 2000, '2%'],
      ['messages', 2000, '2%'],
      ['tool_results', 1000, '1%'],
      ['thinking', 0, '0%'],
      ['remaining', 90_000, '90%'],
    ]);

    // Also test non-divisible remainder distribution (sum of 6 used segments MUST still equal promptTokens = 1001)
    const indivisibleCall: ModelCallSummary = {
      ...call,
      usage: { ...call.usage, promptTokens: 1001 },
      estimate: {
        ...call.estimate,
        byKind: {
          INSTRUCTIONS: 100,
          TOOL_GUIDE: 0,
          TOOL_DEFINITION: 100,
          BUSINESS_CONTEXT: 100,
          COMPACTED_SUMMARY: 0,
          USER_MESSAGE: 0,
          ASSISTANT_MESSAGE: 0,
          TOOL_CALL: 0,
          TOOL_RESULT: 0,
          REASONING: 0,
        },
        inputTokens: 300,
      },
    };
    const indivComp = computeContextComposition(indivisibleCall);
    const usedSegmentSum = indivComp.segments
      .filter((s) => s.key !== 'remaining')
      .reduce((sum, s) => sum + s.tokens, 0);
    expect(usedSegmentSum).toBe(1001);
    expect(indivComp.segments.find((s) => s.key === 'thinking')?.tokens).toBe(0);
    expect(indivComp.segments.find((s) => s.key === 'remaining')?.tokens).toBe(98_999);
  });

  it('renders all 7 segments with token counts & percentages, PROVIDER/ESTIMATED/SIMULATED source badges, and cacheReadTokens note in zh-CN and en-US', () => {
    const sourceCases: ReadonlyArray<{
      source: ModelCallUsageSource;
      cacheRead: number;
      zhBadge: string;
      enBadge: string;
    }> = [
      { source: 'PROVIDER', cacheRead: 4200, zhBadge: '服务商返回', enBadge: 'Provider-reported' },
      { source: 'ESTIMATED', cacheRead: 0, zhBadge: '估算', enBadge: 'Estimated' },
      { source: 'SIMULATED', cacheRead: 0, zhBadge: '模拟', enBadge: 'Simulated' },
    ];

    for (const sc of sourceCases) {
      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubLocale(locale);
        const html = renderToStaticMarkup(
          <PreferencesProvider>
            <ContextCompositionBar latestCall={makeCallWithSource(sc.source, sc.cacheRead)} />
          </PreferencesProvider>,
        );

        expect(html).toContain('data-testid="context-composition-bar"');
        expect(html.match(/data-testid="context-composition-segment"/g)).toHaveLength(7);
        for (const key of CONTEXT_COMPOSITION_SEGMENT_KEYS) {
          expect(html).toContain(`data-segment-key="${key}"`);
        }

        // Segment labels
        expect(html).toContain('system prompt');
        expect(html).toContain(locale === 'en-US' ? 'Tool definitions' : '工具定义');
        expect(html).toContain(locale === 'en-US' ? 'Injected business context' : '注入的业务上下文');
        expect(html).toContain(locale === 'en-US' ? 'Messages' : '对话消息');
        expect(html).toContain(locale === 'en-US' ? 'Tool results' : '工具结果');
        expect(html).toContain(locale === 'en-US' ? 'Thinking' : '思考');
        expect(html).toContain(locale === 'en-US' ? 'Remaining window' : '剩余窗口');

        // Token counts & percentages
        expect(html).toContain('3,000');
        expect(html).toContain('90,000');
        expect(html).toContain('90%');

        // Usage source badge
        expect(html).toContain('data-testid="context-usage-source"');
        expect(html).toContain(`data-source="${sc.source}"`);
        expect(html).toContain(locale === 'en-US' ? sc.enBadge : sc.zhBadge);

        // Cache read note
        if (sc.cacheRead > 0) {
          expect(html).toContain('data-testid="context-cache-read-note"');
          expect(html).toContain('4,200');
        } else {
          expect(html).not.toContain('data-testid="context-cache-read-note"');
        }
      }
    }
  });

  it('handles empty 0-call session gracefully with all 7 segments and empty-session note', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const html = renderToStaticMarkup(
        <PreferencesProvider>
          <ContextCompositionBar latestCall={null} defaultContextWindow={128_000} />
        </PreferencesProvider>,
      );

      expect(html).toContain('data-testid="context-composition-bar"');
      expect(html.match(/data-testid="context-composition-segment"/g)).toHaveLength(7);
      expect(html).toContain('128,000');
      expect(html).toContain('100%');
      expect(html).toContain('data-testid="context-composition-empty-note"');
      expect(html).not.toContain('data-testid="context-usage-source"');
    }
  });

  it('fetches session model calls, call detail, and compaction event detail via typed client helpers', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      const project = store.createProject({
        name: '合同归档中心',
        code: 'CTX-API-82',
        domain: '合同管理',
        template: 'EMPTY',
      });
      const session = store.createAgentSession({
        projectId: project.id,
        agentKind: 'REQUIREMENT',
      });

      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
        app.request(typeof input === 'string' ? input : input.toString(), init),
      );

      for (const prompt of ['管理采购合同', '增加法务会签', '归档后不可涂改']) {
        const res = await app.request(`/api/agent-sessions/${session.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, mockMode: true }),
        });
        expect(res.status).toBe(200);
        await res.text();
      }
      const compactRes = await app.request(`/api/agent-sessions/${session.id}/compact`, {
        method: 'POST',
      });
      expect(compactRes.status).toBe(200);

      const listed = await apiListSessionModelCalls(project.id, session.id);
      expect(listed.modelCalls.length).toBeGreaterThanOrEqual(3);
      expect(listed.contextEvents).toHaveLength(1);
      expect(listed.contextEvents[0]!.kind).toBe('COMPACT');

      const { modelCall } = await apiGetModelCall(project.id, listed.modelCalls.at(-1)!.id);
      expect(modelCall.included.length).toBeGreaterThan(0);

      const { contextEvent } = await apiGetContextEvent(project.id, listed.contextEvents[0]!.id);
      expect(contextEvent.removed.some((item) => item.content.includes('管理采购合同'))).toBe(true);
    } finally {
      store.close();
    }
  });
});
