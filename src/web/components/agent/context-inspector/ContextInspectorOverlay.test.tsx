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
});
