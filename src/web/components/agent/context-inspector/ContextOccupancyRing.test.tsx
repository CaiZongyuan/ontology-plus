import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
  type BusinessLocale,
} from '../../../../packages/business-vocabulary/index.js';
import type { ModelCallSummary } from '../../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import { ConversationComposer } from '../conversation/ConversationComposer.js';
import {
  ContextOccupancyRing,
  computeContextOccupancy,
} from './ContextOccupancyRing.js';

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

function makeCallSummary(promptTokens: number, contextWindow = 100_000): ModelCallSummary {
  return {
    id: 'mcall-1',
    projectId: 'proj-contract',
    sessionId: 'sess-1',
    purpose: 'TURN',
    seq: 1,
    provider: 'Mock',
    model: 'mock-v1',
    contextWindow,
    maxOutputTokens: 4096,
    startedAt: '2026-11-18T10:00:00.000Z',
    endedAt: '2026-11-18T10:00:01.000Z',
    durationMs: 1000,
    status: 'COMPLETED',
    usage: {
      promptTokens,
      inputTokens: promptTokens,
      outputTokens: 320,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: promptTokens + 320,
      source: 'SIMULATED',
    },
    estimate: {
      byKind: {
        INSTRUCTIONS: 1200,
        BUSINESS_CONTEXT: 800,
        COMPACTED_SUMMARY: 0,
        TOOL_GUIDE: 0,
        TOOL_DEFINITION: 1000,
        USER_MESSAGE: 500,
        ASSISTANT_MESSAGE: 500,
        REASONING: 0,
        TOOL_CALL: 0,
        TOOL_RESULT: 0,
      },
      inputTokens: 4000,
      outputTokens: 320,
      excludedTokens: 0,
    },
    includedCount: 5,
    excludedCount: 0,
    hasDetail: true,
  };
}

describe('ContextOccupancyRing (#82)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('computes 0% when there are no calls yet and clamps ratio to 0..100%', () => {
    expect(computeContextOccupancy(null)).toEqual({
      promptTokens: 0,
      contextWindow: 0,
      ratio: 0,
      pct: 0,
      warn: false,
    });
    expect(computeContextOccupancy(makeCallSummary(42_000, 100_000))).toEqual({
      promptTokens: 42_000,
      contextWindow: 100_000,
      ratio: 0.42,
      pct: 42,
      warn: false,
    });
    expect(computeContextOccupancy(makeCallSummary(70_000, 100_000))).toEqual({
      promptTokens: 70_000,
      contextWindow: 100_000,
      ratio: 0.7,
      pct: 70,
      warn: true,
    });
    expect(computeContextOccupancy(makeCallSummary(135_000, 100_000))).toEqual({
      promptTokens: 135_000,
      contextWindow: 100_000,
      ratio: 1,
      pct: 100,
      warn: true,
    });
  });

  it('renders ONLY the circular SVG progress ring (no visible text label) at 0% and <70% with calm state and bilingual tooltip copy', () => {
    for (const [call, expectedPct] of [
      [null, 0],
      [makeCallSummary(42_000, 100_000), 42],
    ] as const) {
      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubLocale(locale);
        const html = renderToStaticMarkup(
          <PreferencesProvider>
            <ConversationComposer
              draft=""
              onDraftChange={noop}
              onSubmitPrompt={noop}
              runningCount={0}
              rightAccessorySlot={
                <ContextOccupancyRing latestCall={call} open={false} onToggle={noop} />
              }
            />
          </PreferencesProvider>,
        );

        expect(html).toContain('data-testid="context-occupancy-ring"');
        expect(html).toContain('data-occupancy-warn="false"');
        expect(html).toContain(`data-occupancy-pct="${expectedPct}"`);

        const expectedLabel =
          locale === 'en-US'
            ? `Conversation memory ${expectedPct}% used`
            : `对话记忆已用 ${expectedPct}%`;
        expect(html).toContain(`title="${expectedLabel}"`);
        expect(html).toContain(`aria-label="${expectedLabel}"`);

        // Extract inner markup of the ring button: must contain <svg> and ZERO visible text!
        const btnMatch = /<button[^>]*data-testid="context-occupancy-ring"[^>]*>([\s\S]*?)<\/button>/.exec(
          html,
        );
        expect(btnMatch).not.toBeNull();
        expect(btnMatch![1]).toContain('<svg');
        const strippedTags = btnMatch![1]!.replace(/<[^>]+>/g, '').trim();
        expect(strippedTags).toBe('');

        const violations = checkBusinessViewMarkup(html);
        expect(violations, formatBusinessViewViolations(violations)).toEqual([]);
      }
    }
  });

  it('switches to warning token state and long-conversation tooltip at >=70% without popups or Business View violations', () => {
    const highCall = makeCallSummary(78_000, 100_000);
    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const html = renderToStaticMarkup(
        <PreferencesProvider>
          <ContextOccupancyRing latestCall={highCall} open={true} onToggle={noop} />
        </PreferencesProvider>,
      );

      expect(html).toContain('data-testid="context-occupancy-ring"');
      expect(html).toContain('data-occupancy-warn="true"');
      expect(html).toContain('data-occupancy-pct="78"');
      expect(html).toContain('aria-expanded="true"');

      const expectedLabel =
        locale === 'en-US'
          ? 'Conversation memory 78% used — conversation is getting long; earlier messages may be summarized'
          : '对话记忆已用 78%：对话已较长，较早的内容可能被概括';
      expect(html).toContain(`title="${expectedLabel}"`);
      expect(html).toContain(`aria-label="${expectedLabel}"`);

      const violations = checkBusinessViewMarkup(html);
      expect(violations, formatBusinessViewViolations(violations)).toEqual([]);
    }
  });
});
