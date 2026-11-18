import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_VOCABULARY,
  type BusinessLocale,
} from '../../../../packages/business-vocabulary/index.js';
import type {
  ContextEventDetail,
  ContextEventSummary,
  ModelCallDetail,
  ModelCallSummary,
} from '../../../../packages/workspace-store/index.js';
import { AGENT_PANEL_WIDE_CSS_WIDTH } from '../agentPanelStore.js';
import { PreferencesProvider } from '../../../i18n.js';
import {
  CONTEXT_INSPECTOR_DRAWER_TEST_ID,
  ContextInspectorOverlay,
  resolveLatestTurnModelCall,
  resolveOverlayOffsetStyle,
  shouldDismissContextInspectorKey,
} from './ContextInspectorOverlay.js';

const noop = () => undefined;

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

function makeSampleCallSummary(overrides: Partial<ModelCallSummary> = {}): ModelCallSummary {
  return {
    id: 'mcall-ov-1',
    projectId: 'proj-contract',
    sessionId: 'sess-ov-1',
    purpose: 'TURN',
    seq: 2,
    provider: 'Mock',
    model: 'mock-v1',
    contextWindow: 100_000,
    maxOutputTokens: 4096,
    startedAt: '2026-11-18T10:20:00.000Z',
    endedAt: '2026-11-18T10:20:01.000Z',
    durationMs: 1000,
    status: 'COMPLETED',
    usage: {
      promptTokens: 8000,
      inputTokens: 8000,
      outputTokens: 450,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 8450,
      source: 'SIMULATED',
    },
    estimate: {
      byKind: {
        INSTRUCTIONS: 2000,
        TOOL_GUIDE: 0,
        TOOL_DEFINITION: 2000,
        BUSINESS_CONTEXT: 2000,
        COMPACTED_SUMMARY: 0,
        USER_MESSAGE: 1000,
        ASSISTANT_MESSAGE: 1000,
        TOOL_CALL: 0,
        TOOL_RESULT: 0,
        REASONING: 0,
      },
      inputTokens: 8000,
      outputTokens: 450,
      excludedTokens: 320,
    },
    includedCount: 6,
    excludedCount: 2,
    hasDetail: true,
    ...overrides,
  };
}

describe('ContextInspectorOverlay (#82)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is closed by default (renders nothing when open=false) and prefers latest TURN call over COMPACTION/SUBAGENT calls', () => {
    stubLocale('zh-CN');
    const closedHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ContextInspectorOverlay
          open={false}
          onClose={noop}
          latestCall={makeSampleCallSummary()}
        />
      </PreferencesProvider>,
    );
    expect(closedHtml).toBe('');

    const turnCall = makeSampleCallSummary({ id: 'call-turn', seq: 2, purpose: 'TURN' });
    const compactCall = makeSampleCallSummary({ id: 'call-compact', seq: 3, purpose: 'COMPACTION' });
    expect(resolveLatestTurnModelCall([turnCall, compactCall])?.id).toBe('call-turn');
    expect(resolveLatestTurnModelCall([compactCall])?.id).toBe('call-compact');
    expect(resolveLatestTurnModelCall([])).toBeNull();
  });

  it('computes canvas-only overlay offsets for left/right/wide/overlay modes and Escape key dismissal', () => {
    expect(
      resolveOverlayOffsetStyle({ side: 'left', panelWidth: 384, wideMode: false, overlay: false }),
    ).toEqual({ left: '384px', right: '0px' });
    expect(
      resolveOverlayOffsetStyle({ side: 'left', panelWidth: 384, wideMode: true, overlay: false }),
    ).toEqual({ left: AGENT_PANEL_WIDE_CSS_WIDTH, right: '0px' });
    expect(
      resolveOverlayOffsetStyle({ side: 'right', panelWidth: 420, wideMode: false, overlay: false }),
    ).toEqual({ left: '0px', right: '420px' });
    expect(
      resolveOverlayOffsetStyle({ side: 'left', panelWidth: 384, wideMode: true, overlay: true }),
    ).toEqual({ left: '0px', right: '0px' });

    expect(shouldDismissContextInspectorKey({ key: 'Escape' })).toBe(true);
    expect(shouldDismissContextInspectorKey({ key: 'Enter' })).toBe(false);
  });

  it('renders wide two-column overlay with header, backdrop, close button, composition bar, and inspectable removed items when focus="removed"', () => {
    const callSummary = makeSampleCallSummary();
    const callDetail: ModelCallDetail = {
      ...callSummary,
      included: [],
      response: [],
      excluded: [
        {
          blobId: 'blob-ex-1',
          kind: 'USER_MESSAGE',
          tokens: 140,
          content: '第一轮：需要支持多币种采购合同结算',
        },
      ],
    };
    const compactSummary: ContextEventSummary = {
      id: 'evt-c-1',
      projectId: 'proj-contract',
      sessionId: 'sess-ov-1',
      kind: 'COMPACT',
      createdAt: '2026-11-18T10:18:00.000Z',
      removedCount: 2,
      reclaimedTokens: 280,
      summarizedByModel: false,
      afterCallSeq: 1,
    };
    const compactDetail: ContextEventDetail = {
      ...compactSummary,
      summary: {
        blobId: 'blob-sum-1',
        kind: 'COMPACTED_SUMMARY',
        tokens: 60,
        content: '已确认供应商年度资信复评与三级会签要点。',
      },
      removed: [
        {
          blobId: 'blob-rm-1',
          kind: 'USER_MESSAGE',
          tokens: 180,
          content: '早期消息：供应商准入每年复评一次',
        },
      ],
    };

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const html = renderToStaticMarkup(
        <PreferencesProvider>
          <ContextInspectorOverlay
            open={true}
            onClose={noop}
            focus="removed"
            side="left"
            panelWidth={384}
            latestCall={callSummary}
            modelCalls={[callSummary]}
            contextEvents={[compactSummary]}
            latestCallDetail={callDetail}
            compactedEventDetails={[compactDetail]}
          />
        </PreferencesProvider>,
      );

      expect(html).toContain(`data-testid="${CONTEXT_INSPECTOR_DRAWER_TEST_ID}"`);
      expect(html).toContain('data-testid="context-inspector-backdrop"');
      expect(html).toContain('data-testid="context-inspector-close-btn"');
      expect(html).toContain('data-testid="context-inspector-left-col"');
      expect(html).toContain('data-testid="context-inspector-right-col"');
      expect(html).toContain('data-testid="context-composition-bar"');
      expect(html).toContain('data-testid="context-inspector-removed-section"');
      expect(html).toContain('data-focused="true"');

      // Header title & subtitle
      expect(html).toContain(
        locale === 'en-US'
          ? BUSINESS_VOCABULARY.CONTEXT_INSPECTOR.en
          : BUSINESS_VOCABULARY.CONTEXT_INSPECTOR.zh,
      );
      expect(html).toContain(
        locale === 'en-US'
          ? 'What the AI Assistant actually saw on each model call'
          : 'AI 助手每次回答时实际看到的内容',
      );

      // Both trimmed excluded item AND compacted archived item + summary are inspectable!
      expect(html).toContain('第一轮：需要支持多币种采购合同结算');
      expect(html).toContain('早期消息：供应商准入每年复评一次');
      expect(html).toContain('已确认供应商年度资信复评与三级会签要点。');
      expect(html.match(/data-testid="context-removed-item"/g)).toHaveLength(2);
    }
  });

  it('mounts ModelCallTimeline in left column (above eventsSlot & lanesSlot) and syncs ContextBrowser in right column when selectedCallId changes (#83)', () => {
    const call1 = makeSampleCallSummary({
      id: 'call-sync-1',
      seq: 1,
      model: 'glm-5-flash',
      usage: {
        promptTokens: 3500,
        inputTokens: 3500,
        outputTokens: 240,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 3740,
        source: 'PROVIDER',
      },
      excludedCount: 0,
    });
    const call2 = makeSampleCallSummary({
      id: 'call-sync-2',
      seq: 2,
      model: 'glm-5-pro',
      usage: {
        promptTokens: 7200,
        inputTokens: 5200,
        outputTokens: 480,
        cacheReadTokens: 2000,
        cacheWriteTokens: 0,
        totalTokens: 7680,
        source: 'PROVIDER',
      },
      excludedCount: 0,
    });

    const detailsById: Record<string, ModelCallDetail> = {
      'call-sync-1': {
        ...call1,
        included: [
          {
            blobId: 'b-c1-user',
            kind: 'USER_MESSAGE',
            tokens: 180,
            content: '第一轮独有提示：定义供应商准入流程',
          },
        ],
        excluded: [],
        response: [],
      },
      'call-sync-2': {
        ...call2,
        included: [
          {
            blobId: 'b-c2-user',
            kind: 'USER_MESSAGE',
            tokens: 260,
            content: '第二轮独有提示：补充违约金计算公式',
          },
        ],
        excluded: [],
        response: [],
      },
    };

    stubLocale('zh-CN');
    const htmlCall2 = renderToStaticMarkup(
      <PreferencesProvider>
        <ContextInspectorOverlay
          open={true}
          onClose={noop}
          modelCalls={[call1, call2]}
          callDetailsById={detailsById}
          defaultExpandedItemKeys={['*']}
          eventsSlot={<div data-testid="wave5-events-slot">Events Slot</div>}
          lanesSlot={<div data-testid="wave5-lanes-slot">Lanes Slot</div>}
        />
      </PreferencesProvider>,
    );

    // Left column order: composition -> timeline -> eventsSlot -> lanesSlot
    const compIdx = htmlCall2.indexOf('data-testid="context-composition-bar"');
    const tlIdx = htmlCall2.indexOf('data-testid="context-call-timeline"');
    const evIdx = htmlCall2.indexOf('data-testid="wave5-events-slot"');
    const lnIdx = htmlCall2.indexOf('data-testid="wave5-lanes-slot"');
    const rightIdx = htmlCall2.indexOf('data-testid="context-inspector-right-col"');
    const browserIdx = htmlCall2.indexOf('data-testid="context-browser"');

    expect(compIdx).toBeGreaterThan(-1);
    expect(tlIdx).toBeGreaterThan(compIdx);
    expect(evIdx).toBeGreaterThan(tlIdx);
    expect(lnIdx).toBeGreaterThan(evIdx);
    expect(rightIdx).toBeGreaterThan(lnIdx);
    expect(browserIdx).toBeGreaterThan(rightIdx);

    // Defaults to latest TURN call (#2)
    expect(htmlCall2).toContain('data-selected-call-id="call-sync-2"');
    expect(htmlCall2).toContain('第二轮独有提示：补充违约金计算公式');
    expect(htmlCall2).not.toContain('第一轮独有提示：定义供应商准入流程');

    // Selecting call #1 syncs ContextBrowser to call #1
    const htmlCall1 = renderToStaticMarkup(
      <PreferencesProvider>
        <ContextInspectorOverlay
          open={true}
          onClose={noop}
          modelCalls={[call1, call2]}
          selectedCallId="call-sync-1"
          callDetailsById={detailsById}
          defaultExpandedItemKeys={['*']}
        />
      </PreferencesProvider>,
    );

    expect(htmlCall1).toContain('data-selected-call-id="call-sync-1"');
    expect(htmlCall1).toContain('第 #1 次调用发送的内容');
    expect(htmlCall1).toContain('第一轮独有提示：定义供应商准入流程');
    expect(htmlCall1).not.toContain('第二轮独有提示：补充违约金计算公式');
  });

  it('mounts ContextEventsList and SubagentLanesPanel by default in left column, highlights focus="events"/"lanes", and jumps ContextBrowser to event or subagent call (#84)', () => {
    const call1Trim = makeSampleCallSummary({
      id: 'call-84-1',
      seq: 1,
      runId: 'run-84-1',
      purpose: 'TURN',
      excludedCount: 2,
    });
    const call2Spawn = makeSampleCallSummary({
      id: 'call-84-2',
      seq: 2,
      runId: 'run-84-2',
      purpose: 'TURN',
      excludedCount: 2,
      responseToolNames: ['spawn_subagents'],
    });
    const call3Subagent = makeSampleCallSummary({
      id: 'call-84-3',
      seq: 3,
      runId: 'run-84-2',
      purpose: 'SUBAGENT',
      parentCallId: 'call-84-2',
      laneLabel: { zh: '合同台账子智能体', en: 'Contract Ledger Subagent' },
      excludedCount: 0,
      usage: {
        promptTokens: 2900,
        inputTokens: 2900,
        outputTokens: 360,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 3260,
        source: 'PROVIDER',
      },
    });

    const detailsById: Record<string, ModelCallDetail> = {
      'call-84-1': {
        ...call1Trim,
        included: [
          {
            blobId: 'b-84-1',
            kind: 'USER_MESSAGE',
            tokens: 150,
            content: '裁剪发生时的第一轮调用快照内容',
          },
        ],
        excluded: [],
        response: [],
      },
      'call-84-2': {
        ...call2Spawn,
        included: [
          {
            blobId: 'b-84-2',
            kind: 'USER_MESSAGE',
            tokens: 180,
            content: '主协调器发起并行派生的第二轮调用快照内容',
          },
        ],
        excluded: [],
        response: [],
      },
      'call-84-3': {
        ...call3Subagent,
        included: [
          {
            blobId: 'b-84-3',
            kind: 'USER_MESSAGE',
            tokens: 220,
            content: '子智能体独立构建合同台账页面的专属上下文快照',
          },
        ],
        excluded: [],
        response: [],
      },
    };

    stubLocale('zh-CN');
    const htmlEventsFocused = renderToStaticMarkup(
      <PreferencesProvider>
        <ContextInspectorOverlay
          open={true}
          onClose={noop}
          focus="events"
          modelCalls={[call1Trim, call2Spawn, call3Subagent]}
          callDetailsById={detailsById}
          defaultExpandedItemKeys={['*']}
        />
      </PreferencesProvider>,
    );

    const compIdx = htmlEventsFocused.indexOf('data-testid="context-composition-bar"');
    const tlIdx = htmlEventsFocused.indexOf('data-testid="context-call-timeline"');
    const evIdx = htmlEventsFocused.indexOf('data-testid="context-events-section"');
    const lnIdx = htmlEventsFocused.indexOf('data-testid="context-subagent-lanes-section"');
    const rightIdx = htmlEventsFocused.indexOf('data-testid="context-inspector-right-col"');

    expect(compIdx).toBeGreaterThan(-1);
    expect(tlIdx).toBeGreaterThan(compIdx);
    expect(evIdx).toBeGreaterThan(tlIdx);
    expect(lnIdx).toBeGreaterThan(evIdx);
    expect(rightIdx).toBeGreaterThan(lnIdx);

    expect(htmlEventsFocused).toContain('data-testid="context-events-section" data-focused="true"');
    expect(htmlEventsFocused).toContain('data-event-kind="TRIM" data-target-call-id="call-84-1"');
    expect(htmlEventsFocused).toContain('data-event-kind="SUBAGENT" data-target-call-id="call-84-2"');
    expect(htmlEventsFocused).toContain('data-testid="context-subagent-lane"');
    expect(htmlEventsFocused).toContain('data-target-call-id="call-84-3"');

    // Selecting the subagent lane's target call ("call-84-3") loads the subagent's snapshot into ContextBrowser
    const htmlSubagentSelected = renderToStaticMarkup(
      <PreferencesProvider>
        <ContextInspectorOverlay
          open={true}
          onClose={noop}
          focus="lanes"
          modelCalls={[call1Trim, call2Spawn, call3Subagent]}
          selectedCallId="call-84-3"
          callDetailsById={detailsById}
          defaultExpandedItemKeys={['*']}
        />
      </PreferencesProvider>,
    );

    expect(htmlSubagentSelected).toContain(
      'data-testid="context-subagent-lanes-section" data-focused="true"',
    );
    expect(htmlSubagentSelected).toContain('data-selected-call-id="call-84-3"');
    expect(htmlSubagentSelected).toContain('第 #3 次调用发送的内容');
    expect(htmlSubagentSelected).toContain('子智能体 · 合同台账子智能体');
    expect(htmlSubagentSelected).toContain('子智能体独立构建合同台账页面的专属上下文快照');
  });
});
