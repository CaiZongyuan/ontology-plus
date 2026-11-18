import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
  type BusinessLocale,
} from '../../../../packages/business-vocabulary/index.js';
import type {
  ContextEventSummary,
  ModelCallSummary,
} from '../../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import type { AgentRunView } from '../agentRun.js';
import { ConversationThread } from '../conversation/ConversationThread.js';
import {
  RemovedMessagesNotice,
  resolveRemovedMessagesNoticeState,
} from './RemovedMessagesNotice.js';

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

function makeCall(excludedCount: number): Pick<ModelCallSummary, 'excludedCount'> {
  return { excludedCount };
}

function makeCompactEvent(id: string, removedCount: number): ContextEventSummary {
  return {
    id,
    projectId: 'proj-contract',
    sessionId: 'sess-1',
    kind: 'COMPACT',
    createdAt: '2026-11-18T10:05:00.000Z',
    removedCount,
    reclaimedTokens: removedCount * 120,
    summarizedByModel: false,
    afterCallSeq: 3,
  };
}

describe('RemovedMessagesNotice (#82)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when excludedCount === 0 and there are no COMPACT events', () => {
    expect(resolveRemovedMessagesNoticeState(null, [])).toEqual({
      visible: false,
      compactedCount: 0,
      excludedCount: 0,
    });

    stubLocale('zh-CN');
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <RemovedMessagesNotice latestCall={makeCall(0)} contextEvents={[]} onOpenInspector={() => undefined} />
      </PreferencesProvider>,
    );
    expect(html).toBe('');
  });

  it('renders calm bilingual notice when compacted, trimmed, or both, and passes checkBusinessViewMarkup without exemption', () => {
    const sampleRun: AgentRunView = {
      id: 'run-1',
      userPrompt: '补充合同到期提醒条款',
      title: { zh: '到期提醒', en: 'Expiry reminder' },
      status: 'SUCCEEDED',
      liveStatus: { zh: '已完成', en: 'Completed' },
      startedAt: Date.UTC(2026, 10, 18, 10, 0, 0),
      completedAt: Date.UTC(2026, 10, 18, 10, 0, 3),
      steps: [],
      text: '已记录合同到期前 30 天自动提醒规则。',
    };

    const cases = [
      {
        label: 'compacted only',
        latestCall: makeCall(0),
        events: [makeCompactEvent('evt-1', 6), makeCompactEvent('evt-2', 4)],
        expectedZh: '较早的 10 条消息已概括 · 查看已移出内容',
        expectedEn: 'Earlier 10 messages summarized · View removed messages',
      },
      {
        label: 'trimmed only',
        latestCall: makeCall(4),
        events: [],
        expectedZh: '较早的 4 条消息未带入当前回答 · 查看已移出内容',
        expectedEn: 'Earlier 4 messages left out of current reply · View removed messages',
      },
      {
        label: 'both compacted and trimmed',
        latestCall: makeCall(3),
        events: [makeCompactEvent('evt-1', 8)],
        expectedZh: '较早的 8 条消息已概括，另有 3 条未带入当前回答 · 查看已移出内容',
        expectedEn: 'Earlier 8 messages summarized and 3 left out of current reply · View removed messages',
      },
    ] as const;

    for (const testCase of cases) {
      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubLocale(locale);
        const html = renderToStaticMarkup(
          <PreferencesProvider>
            <ConversationThread
              runs={[sampleRun]}
              topNoticeSlot={
                <RemovedMessagesNotice
                  latestCall={testCase.latestCall}
                  contextEvents={testCase.events}
                  onOpenInspector={() => undefined}
                />
              }
            />
          </PreferencesProvider>,
        );

        expect(html).toContain('data-testid="conversation-removed-notice"');
        expect(html).toContain(locale === 'en-US' ? testCase.expectedEn : testCase.expectedZh);

        const violations = checkBusinessViewMarkup(html);
        expect(
          violations,
          `[${testCase.label} ${locale}]\n${formatBusinessViewViolations(violations)}`,
        ).toEqual([]);
      }
    }
  });

  it('invokes onOpenInspector("removed") when clicked', () => {
    stubLocale('zh-CN');
    const onOpenInspector = vi.fn();
    let renderedButton: React.ReactElement<{ onClick?: () => void }> | null = null;

    function Probe() {
      renderedButton = RemovedMessagesNotice({
        latestCall: makeCall(2),
        contextEvents: [],
        onOpenInspector,
      }) as React.ReactElement<{ onClick?: () => void }> | null;
      return renderedButton;
    }

    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    expect(html).toContain('data-testid="conversation-removed-notice"');
    expect(renderedButton).not.toBeNull();
    renderedButton!.props.onClick?.();
    expect(onOpenInspector).toHaveBeenCalledTimes(1);
    expect(onOpenInspector).toHaveBeenCalledWith('removed');
  });
});
