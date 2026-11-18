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
import { AssistantReplyItem } from './AssistantReplyItem.js';

function stubLocale(locale: BusinessLocale) {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: () => undefined,
    removeItem: () => undefined,
  });
}

describe('AssistantReplyItem streaming Markdown & Business View guard (#79)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders headings, lists, GFM tables, syntax-highlighted code blocks, and Mermaid diagrams during streaming and after completion with 0 Business View violations in zh-CN and en-US', () => {
    const richMarkdownZh = [
      '## 采购合同审批规则梳理',
      '',
      '- **普通采购合同**：部门负责人审批后生效',
      '- **大额采购合同**：金额超过 100 万元时需法务与财务双签',
      '',
      '| 合同类型 | 审批层级 | 时效要求 |',
      '| --- | --- | --- |',
      '| 日常耗材 | 单级审批 | 1 个工作日 |',
      '| 大额设备 | 双签会审 | 3 个工作日 |',
      '',
      '```ts',
      'const thresholdAmount = 1_000_000;',
      'export function requiresDualApproval(total: number): boolean {',
      '  return total >= thresholdAmount;',
      '}',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  Start["发起起草"] --> Review["法务财务会签"]',
      '  Review --> Seal["归档生效"]',
      '```',
    ].join('\n');

    const richMarkdownEn = [
      '## Contract Approval Rules',
      '',
      '- **Standard contracts**: approved by department lead',
      '- **High-value contracts**: joint review above 1,000,000 CNY',
      '',
      '| Category | Review Level | Turnaround |',
      '| --- | --- | --- |',
      '| Office Supplies | Single lead | 1 business day |',
      '| Major Equipment | Joint review | 3 business days |',
      '',
      '```ts',
      'const thresholdAmount = 1_000_000;',
      'export function requiresDualApproval(total: number): boolean {',
      '  return total >= thresholdAmount;',
      '}',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  Start["Draft"] --> Review["Joint Review"]',
      '  Review --> Seal["Archived"]',
      '```',
    ].join('\n');

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const md = locale === 'en-US' ? richMarkdownEn : richMarkdownZh;

      const streamingRun: AgentRunView = {
        id: 'run-stream-md',
        userPrompt: locale === 'en-US' ? 'Summarize approval rules' : '整理合同审批规则',
        title: { zh: '整理合同审批规则', en: 'Summarize approval rules' },
        status: 'RUNNING',
        liveStatus: { zh: '正在整理需求要点…', en: 'Organizing requirements…' },
        startedAt: 1_000,
        steps: [],
        text: md,
      };

      const streamingHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AssistantReplyItem run={streamingRun} onCancel={() => undefined} />
        </PreferencesProvider>,
      );

      expect(streamingHtml).toContain('data-testid="conversation-live-status"');
      expect(streamingHtml).toContain('data-testid="conversation-assistant-markdown"');
      expect(streamingHtml).toContain('stream-caret is-streaming');
      expect(streamingHtml).toContain('<h2');
      expect(streamingHtml).toContain('<ul');
      expect(streamingHtml).toContain('<table');
      expect(streamingHtml).toContain('requiresDualApproval');
      expect(streamingHtml).toContain(locale === 'en-US' ? 'Data table' : '数据表格');
      expect(streamingHtml).toContain(
        locale === 'en-US' ? 'Rendering diagram…' : '正在渲染图表…',
      );

      const streamViolations = checkBusinessViewMarkup(streamingHtml);
      expect(
        streamViolations,
        `Streaming AssistantReplyItem [${locale}]:\n${formatBusinessViewViolations(streamViolations)}`,
      ).toEqual([]);

      const completedRun: AgentRunView = {
        ...streamingRun,
        status: 'SUCCEEDED',
        completedAt: 4_000,
      };

      const completedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AssistantReplyItem run={completedRun} />
        </PreferencesProvider>,
      );

      expect(completedHtml).not.toContain('data-testid="conversation-live-status"');
      expect(completedHtml).not.toContain('stream-caret is-streaming');
      expect(completedHtml).toContain('<h2');
      expect(completedHtml).toContain('<table');
      expect(completedHtml).toContain('requiresDualApproval');

      const completedViolations = checkBusinessViewMarkup(completedHtml);
      expect(
        completedViolations,
        `Completed AssistantReplyItem [${locale}]:\n${formatBusinessViewViolations(completedViolations)}`,
      ).toEqual([]);
    }
  });
});
