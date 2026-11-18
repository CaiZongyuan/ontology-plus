import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusinessLocale } from '../../../../packages/business-vocabulary/index.js';
import type {
  ContextEventDetail,
  ContextEventSummary,
  ModelCallDetail,
  ModelCallSummary,
} from '../../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import {
  ContextBrowser,
  createModelCallDetailCache,
  formatToolDefinitionSourceLabel,
  groupContextBrowserItems,
} from './ContextBrowser.js';

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

function makeRichCallSummary(overrides: Partial<ModelCallSummary> = {}): ModelCallSummary {
  return {
    id: 'mcall-cb-2',
    projectId: 'proj-contract',
    sessionId: 'sess-cb-1',
    purpose: 'TURN',
    seq: 2,
    provider: 'Z.ai',
    model: 'glm-5',
    contextWindow: 128_000,
    maxOutputTokens: 8192,
    startedAt: '2026-11-18T10:15:00.000Z',
    endedAt: '2026-11-18T10:15:01.600Z',
    durationMs: 1600,
    status: 'COMPLETED',
    usage: {
      promptTokens: 6400,
      inputTokens: 4400,
      outputTokens: 520,
      cacheReadTokens: 2000,
      cacheWriteTokens: 0,
      totalTokens: 6920,
      source: 'PROVIDER',
    },
    estimate: {
      byKind: {
        INSTRUCTIONS: 900,
        TOOL_GUIDE: 300,
        TOOL_DEFINITION: 1800,
        BUSINESS_CONTEXT: 1100,
        COMPACTED_SUMMARY: 250,
        USER_MESSAGE: 420,
        ASSISTANT_MESSAGE: 380,
        REASONING: 210,
        TOOL_CALL: 190,
        TOOL_RESULT: 450,
      },
      inputTokens: 6000,
      outputTokens: 520,
      excludedTokens: 310,
    },
    includedCount: 12,
    excludedCount: 1,
    hasDetail: true,
    ...overrides,
  };
}

function makeRichCallDetail(summary: ModelCallSummary = makeRichCallSummary()): ModelCallDetail {
  return {
    ...summary,
    included: [
      {
        blobId: 'blob-inst-1',
        kind: 'INSTRUCTIONS',
        tokens: 900,
        content: '你是采购合同领域的业务需求助手，请保持表达清晰。',
      },
      {
        blobId: 'blob-guide-1',
        kind: 'TOOL_GUIDE',
        tokens: 300,
        content: '优先使用批量工具更新需求章节。',
      },
      {
        blobId: 'blob-tool-builtin',
        kind: 'TOOL_DEFINITION',
        label: 'save_requirement_section',
        source: 'BUILTIN',
        tokens: 600,
        content: '{"name":"save_requirement_section","parameters":{"type":"object"}}',
      },
      {
        blobId: 'blob-tool-mcp',
        kind: 'TOOL_DEFINITION',
        label: 'invoke_mcp_tool',
        source: 'MCP',
        tokens: 500,
        content: '{"name":"invoke_mcp_tool","description":"Invoke external MCP tool"}',
      },
      {
        blobId: 'blob-tool-codemode',
        kind: 'TOOL_DEFINITION',
        label: 'codemode',
        source: 'CODEMODE',
        tokens: 700,
        content: '{"name":"codemode","description":"Run TypeScript orchestration script"}',
      },
      {
        blobId: 'blob-biz-1',
        kind: 'BUSINESS_CONTEXT',
        tokens: 1100,
        content: '项目领域：采购与合同管理；当前步骤：需求。',
      },
      {
        blobId: 'blob-sum-1',
        kind: 'COMPACTED_SUMMARY',
        tokens: 250,
        content: '早期已确认供应商年度资信复评制度。',
      },
      {
        blobId: 'blob-user-1',
        kind: 'USER_MESSAGE',
        tokens: 420,
        content: '超过 100 万元的采购合同需要法务与财务双签。',
      },
      {
        blobId: 'blob-asst-1',
        kind: 'ASSISTANT_MESSAGE',
        tokens: 380,
        content: '好的，正在为您写入双签审批条款。',
      },
      {
        blobId: 'blob-reason-1',
        kind: 'REASONING',
        tokens: 210,
        content: '检查金额阈值与会签角色约束是否冲突。',
      },
      {
        blobId: 'blob-tcall-1',
        kind: 'TOOL_CALL',
        label: 'save_requirement_section',
        tokens: 190,
        content: '{"section":"审批规则","threshold":1000000}',
      },
      {
        blobId: 'blob-tres-1',
        kind: 'TOOL_RESULT',
        label: 'save_requirement_section',
        tokens: 450,
        content: '{"ok":true,"updatedHeading":"审批规则"}',
      },
    ],
    excluded: [
      {
        blobId: 'blob-excl-1',
        kind: 'USER_MESSAGE',
        tokens: 310,
        content: '更早一轮未带入窗口的消息：支持按季度统计归档率。',
      },
    ],
    response: [
      {
        blobId: 'blob-resp-1',
        kind: 'ASSISTANT_MESSAGE',
        tokens: 520,
        content: '已将「超过 100 万元需法务与财务双签」写入需求文档第 3 节。',
      },
    ],
  };
}

describe('ContextBrowser (#83)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('groups included items by category in reading order with accurate item counts & token sums, plus model response', () => {
    const detail = makeRichCallDetail();
    const groups = groupContextBrowserItems(detail);

    expect(groups.map((g) => [g.kind, g.items.length, g.totalTokens])).toEqual([
      ['INSTRUCTIONS', 1, 900],
      ['TOOL_GUIDE', 1, 300],
      ['TOOL_DEFINITION', 3, 1800],
      ['BUSINESS_CONTEXT', 1, 1100],
      ['COMPACTED_SUMMARY', 1, 250],
      ['USER_MESSAGE', 1, 420],
      ['ASSISTANT_MESSAGE', 1, 380],
      ['REASONING', 1, 210],
      ['TOOL_CALL', 1, 190],
      ['TOOL_RESULT', 1, 450],
      ['RESPONSE', 1, 520],
    ]);

    expect(formatToolDefinitionSourceLabel('BUILTIN', (zh) => zh)).toBe('内置');
    expect(formatToolDefinitionSourceLabel('BUILTIN', (_zh, en) => en)).toBe('Built-in');
    expect(formatToolDefinitionSourceLabel('MCP', (zh) => zh)).toBe('MCP');
    expect(formatToolDefinitionSourceLabel('CODEMODE', (_zh, en) => en)).toBe('codemode');
  });

  it('renders categories, collapsed vs expanded raw item content, TOOL_DEFINITION source badges (BUILTIN / MCP / CODEMODE), and separate Removed section in zh-CN & en-US', () => {
    const summary = makeRichCallSummary();
    const detail = makeRichCallDetail(summary);
    const compactSummary: ContextEventSummary = {
      id: 'evt-cb-1',
      projectId: 'proj-contract',
      sessionId: 'sess-cb-1',
      kind: 'COMPACT',
      createdAt: '2026-11-18T10:12:00.000Z',
      removedCount: 1,
      reclaimedTokens: 200,
      summarizedByModel: true,
      afterCallSeq: 1,
    };
    const compactDetail: ContextEventDetail = {
      ...compactSummary,
      removed: [
        {
          blobId: 'blob-arch-1',
          kind: 'USER_MESSAGE',
          tokens: 200,
          content: '已归档消息：供应商黑名单联动校验。',
        },
      ],
    };

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);

      // 1. Default collapsed items: shows item previews & tool source badges, hides raw <pre>
      const collapsedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ContextBrowser
            projectId="proj-contract"
            selectedCall={summary}
            isLatestSelected
            callDetailsById={{ [summary.id]: detail }}
            contextEvents={[compactSummary]}
            compactedEventDetails={[compactDetail]}
          />
        </PreferencesProvider>,
      );

      expect(collapsedHtml).toContain('data-testid="context-browser"');
      expect(collapsedHtml.match(/data-testid="context-browser-category"/g)).toHaveLength(11);
      expect(collapsedHtml).toContain('data-category-kind="INSTRUCTIONS"');
      expect(collapsedHtml).toContain('data-category-kind="TOOL_DEFINITION"');
      expect(collapsedHtml).toContain('data-category-kind="BUSINESS_CONTEXT"');
      expect(collapsedHtml).toContain('data-category-kind="RESPONSE"');
      expect(collapsedHtml.match(/data-testid="context-browser-item"/g)).toHaveLength(13);
      expect(collapsedHtml).not.toContain('data-testid="context-browser-item-content"');

      // Tool definition source badges: BUILTIN, MCP, CODEMODE
      expect(collapsedHtml).toContain('data-tool-source="BUILTIN"');
      expect(collapsedHtml).toContain('data-tool-source="MCP"');
      expect(collapsedHtml).toContain('data-tool-source="CODEMODE"');
      expect(collapsedHtml).toContain(locale === 'en-US' ? 'Built-in' : '内置');
      expect(collapsedHtml).toContain('MCP');
      expect(collapsedHtml).toContain('codemode');

      // Separate Removed section with trimmed + compacted counts
      expect(collapsedHtml).toContain('data-testid="context-inspector-removed-section"');
      expect(collapsedHtml.match(/data-testid="context-removed-item"/g)).toHaveLength(2);

      // 2. Expanded items (simulating user clicking an item to inspect raw content) + focus="removed"
      const expandedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ContextBrowser
            projectId="proj-contract"
            selectedCall={summary}
            isLatestSelected
            focus="removed"
            defaultExpandedItemKeys={['blob-inst-1', 'blob-tool-codemode']}
            callDetailsById={{ [summary.id]: detail }}
            contextEvents={[compactSummary]}
            compactedEventDetails={[compactDetail]}
          />
        </PreferencesProvider>,
      );

      expect(expandedHtml.match(/data-testid="context-browser-item-content"/g)).toHaveLength(2);
      expect(expandedHtml).toContain('你是采购合同领域的业务需求助手，请保持表达清晰。');
      expect(expandedHtml).toContain('Run TypeScript orchestration script');
      expect(expandedHtml).toContain('更早一轮未带入窗口的消息：支持按季度统计归档率。');
      expect(expandedHtml).toContain('已归档消息：供应商黑名单联动校验。');
    }
  });

  it('renders calm pruned notice ("详情已不保留" / "Details no longer retained") alongside preserved usage figures when hasDetail === false, and never fetches apiGetModelCall', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const prunedCall = makeRichCallSummary({
      id: 'mcall-old-1',
      seq: 1,
      model: 'glm-4.5',
      durationMs: 2100,
      hasDetail: false,
      usage: {
        promptTokens: 3200,
        inputTokens: 3200,
        outputTokens: 410,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 3610,
        source: 'PROVIDER',
      },
    });

    const cache = createModelCallDetailCache();
    const shouldStayNull = await cache.loadIfNeeded('proj-contract', prunedCall);
    expect(shouldStayNull).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const html = renderToStaticMarkup(
        <PreferencesProvider>
          <ContextBrowser
            projectId="proj-contract"
            selectedCall={prunedCall}
            isLatestSelected={false}
          />
        </PreferencesProvider>,
      );

      expect(html).toContain('data-testid="context-browser-pruned-notice"');
      expect(html).toContain(
        locale === 'en-US' ? 'Details no longer retained' : '详情已不保留',
      );
      // Preserved usage figures, model, and duration remain visible!
      expect(html).toContain('#1');
      expect(html).toContain('glm-4.5');
      expect(html).toContain('3,200');
      expect(html).toContain('410');
      expect(html).toContain('2.1s');
      expect(html).toContain(locale === 'en-US' ? 'Provider-reported' : '服务商返回');
      expect(html).not.toContain('data-testid="context-browser-category"');
    }
  });

  it('caches apiGetModelCall responses per callId in memory so revisiting a call does not re-fetch', async () => {
    const summary = makeRichCallSummary({ id: 'mcall-cached-1' });
    const detail = makeRichCallDetail(summary);
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ modelCall: detail }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const cache = createModelCallDetailCache();
    const first = await cache.loadIfNeeded('proj-contract', summary);
    const second = await cache.loadIfNeeded('proj-contract', summary);

    expect(first?.id).toBe('mcall-cached-1');
    expect(second).toBe(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
