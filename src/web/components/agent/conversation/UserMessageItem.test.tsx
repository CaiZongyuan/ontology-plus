import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
  type BusinessLocale,
} from '../../../../packages/business-vocabulary/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import type { AgentRunView } from '../agentRun.js';
import { ReplyActionsBar } from './ReplyActionsBar.js';
import { UserMessageItem } from './UserMessageItem.js';

const noop = () => undefined;
const FIXED_NOW = Date.UTC(2026, 10, 18, 10, 0, 0);

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

function makeTurn(id: string, prompt: string, status: AgentRunView['status'] = 'SUCCEEDED'): AgentRunView {
  return {
    id,
    userPrompt: prompt,
    title: { zh: prompt, en: prompt },
    status,
    liveStatus: { zh: '已完成', en: 'Completed' },
    startedAt: FIXED_NOW - 5_000,
    completedAt: FIXED_NOW - 1_000,
    steps: [],
    text: '已记录业务规则。',
  };
}

describe('UserMessageItem & ReplyActionsBar (#81)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders Edit and Retry ONLY on the latest user message when idle, hides them while running, and shows calm restore-history guidance on earlier user messages in zh-CN and en-US', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);

      // 1. Latest idle user message -> has Edit & Retry, no earlier-msg-locked-hint
      const latestHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <UserMessageItem
            run={makeTurn('u-2', locale === 'en-US' ? 'Require dual sign-off above 1M' : '超 100 万需要法务财务双签')}
            isLatestTurn={true}
            sessionRunning={false}
            onEditLatestTurn={noop}
            onRetryLatestTurn={noop}
          />
        </PreferencesProvider>,
      );
      expect(latestHtml).toContain('data-testid="user-msg-edit-btn"');
      expect(latestHtml).toContain('data-testid="user-msg-retry-btn"');
      expect(latestHtml).toContain(locale === 'en-US' ? 'Edit' : '编辑');
      expect(latestHtml).toContain(locale === 'en-US' ? 'Retry' : '重试');
      expect(latestHtml).not.toContain('data-testid="earlier-msg-locked-hint"');
      const latestViolations = checkBusinessViewMarkup(latestHtml);
      expect(latestViolations, formatBusinessViewViolations(latestViolations)).toEqual([]);

      // 2. Latest user message in inline-edit state -> renders textarea + Save & resend + Cancel
      const editingHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <UserMessageItem
            run={makeTurn('u-2', locale === 'en-US' ? 'Require dual sign-off above 1M' : '超 100 万需要法务财务双签')}
            isLatestTurn={true}
            sessionRunning={false}
            defaultEditing={true}
            onEditLatestTurn={noop}
            onRetryLatestTurn={noop}
          />
        </PreferencesProvider>,
      );
      expect(editingHtml).toContain('data-testid="user-msg-edit-input"');
      expect(editingHtml).toContain('data-testid="user-msg-edit-submit"');
      expect(editingHtml).toContain('data-testid="user-msg-edit-cancel"');
      expect(editingHtml).toContain(locale === 'en-US' ? 'Save &amp; resend' : '重新发送');
      const editingViolations = checkBusinessViewMarkup(editingHtml);
      expect(editingViolations, formatBusinessViewViolations(editingViolations)).toEqual([]);

      // 3. Latest user message while session is RUNNING -> hides Edit & Retry
      const runningHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <UserMessageItem
            run={makeTurn('u-2', locale === 'en-US' ? 'Updating...' : '正在处理中', 'RUNNING')}
            isLatestTurn={true}
            sessionRunning={true}
            onEditLatestTurn={noop}
            onRetryLatestTurn={noop}
          />
        </PreferencesProvider>,
      );
      expect(runningHtml).not.toContain('data-testid="user-msg-edit-btn"');
      expect(runningHtml).not.toContain('data-testid="user-msg-retry-btn"');

      // 4. Earlier user message (isLatestTurn === false) -> NEVER renders Edit or Retry; renders restore-history explanation
      const earlierHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <UserMessageItem
            run={makeTurn('u-1', locale === 'en-US' ? 'Supplier onboarding check' : '梳理供应商准入核验')}
            isLatestTurn={false}
            sessionRunning={false}
            onEditLatestTurn={noop}
            onRetryLatestTurn={noop}
          />
        </PreferencesProvider>,
      );
      expect(earlierHtml).not.toContain('data-testid="user-msg-edit-btn"');
      expect(earlierHtml).not.toContain('data-testid="user-msg-retry-btn"');
      expect(earlierHtml).toContain('data-testid="earlier-msg-locked-hint"');
      expect(earlierHtml).toContain(
        locale === 'en-US'
          ? "Only the latest message can be edited; to return to an earlier state, use &#x27;Restore to before this change&#x27; in history"
          : '仅支持编辑最后一条消息；如需回到更早的状态，请在历史记录中使用「恢复到这次变更之前」',
      );
      const earlierViolations = checkBusinessViewMarkup(earlierHtml);
      expect(earlierViolations, formatBusinessViewViolations(earlierViolations)).toEqual([]);

      // 5. ReplyActionsBar renders Copy button cleanly in both locales
      const replyBarHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ReplyActionsBar text="已记录双签规则。" />
        </PreferencesProvider>,
      );
      expect(replyBarHtml).toContain('data-testid="reply-copy-btn"');
      expect(replyBarHtml).toContain(locale === 'en-US' ? 'Copy' : '复制');
      const replyViolations = checkBusinessViewMarkup(replyBarHtml);
      expect(replyViolations, formatBusinessViewViolations(replyViolations)).toEqual([]);
    }
  });

  it('keeps Retry visible on structured-action turns (!run.userPrompt) while hiding Edit so [ACTION:...] payloads are never overwritten by display titles', () => {
    const structuredRun: AgentRunView = {
      id: 'u-action-1',
      title: { zh: '合成 9 章节需求规格书', en: 'Synthesize 9-Chapter SRS' },
      retryPrompt: '[ACTION:SYNTHESIZE_SRS]',
      status: 'SUCCEEDED',
      liveStatus: { zh: '已完成', en: 'Completed' },
      startedAt: FIXED_NOW - 5_000,
      completedAt: FIXED_NOW - 1_000,
      steps: [],
      text: '已生成 9 章节需求规格书。',
    };

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const html = renderToStaticMarkup(
        <PreferencesProvider>
          <UserMessageItem
            run={structuredRun}
            isLatestTurn={true}
            sessionRunning={false}
            defaultEditing={true}
            onEditLatestTurn={noop}
            onRetryLatestTurn={noop}
          />
        </PreferencesProvider>,
      );

      expect(html).toContain('data-testid="user-msg-retry-btn"');
      expect(html).not.toContain('data-testid="user-msg-edit-btn"');
      expect(html).not.toContain('data-testid="user-msg-edit-input"');
      const violations = checkBusinessViewMarkup(html);
      expect(violations, formatBusinessViewViolations(violations)).toEqual([]);
    }
  });
});
