import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
  type BusinessLocale,
} from '../../../../packages/business-vocabulary/index.js';
import type { ChangeSummaryView } from '../../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import {
  ChangeSummaryCard,
  clearChangeSummaryExpansionForTests,
} from '../../history/index.js';
import { PLATFORM_UNAVAILABLE_COPY, type AgentRunView } from '../agentRun.js';
import {
  AssistantReplyItem,
  clearWorkProcessExpansionForTests,
} from './AssistantReplyItem.js';

function stubLocale(locale: BusinessLocale) {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: () => undefined,
    removeItem: () => undefined,
  });
}

describe('AssistantReplyItem streaming Markdown, Work Process, Change Summary strip & ADR 0016 failures (#79, #80)', () => {
  afterEach(() => {
    clearWorkProcessExpansionForTests();
    clearChangeSummaryExpansionForTests();
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

  it('orders folded WorkProcessBlock above reply Markdown and renders ChangeSummaryCard as Variant B single-line strip at the end of the reply (#80)', () => {
    const summary: ChangeSummaryView = {
      entryId: 'ahist-reply-1',
      artifactKind: 'REQUIREMENTS_DOC',
      targetId: 'rdoc-1',
      reason: {
        zh: '按你的要求写入三级审批规则。',
        en: 'Added three-tier approval rules.',
      },
      canUndo: true,
      items: [
        {
          id: 'item-1',
          changeType: 'ADDED',
          label: { zh: '5 万以下部门经理审批', en: 'Under 50k approved by manager' },
        },
        {
          id: 'item-2',
          changeType: 'MODIFIED',
          label: { zh: '50 万以上总经理审批', en: 'Above 500k approved by GM' },
        },
      ],
    };

    const run: AgentRunView = {
      id: 'run-with-work-and-change',
      title: { zh: '补充审批规则', en: 'Add approval rules' },
      status: 'SUCCEEDED',
      liveStatus: { zh: '已完成', en: 'Completed' },
      startedAt: 1_000,
      completedAt: 8_000,
      thinking: '分析三级审批金额边界并更新需求文档第 2 节。',
      thinkingDurationMs: 4_000,
      steps: [
        {
          id: 'step-1',
          label: { zh: '读取需求规格书', en: 'Read requirements document' },
          status: 'DONE',
          toolName: 'inspect_requirement_doc',
          argsText: '{"docId":"rdoc-1"}',
          resultText: '{"sections":4}',
          durationMs: 320,
        },
        {
          id: 'step-2',
          label: { zh: '更新需求规格书', en: 'Update requirements document' },
          summary: { zh: '共 5 个章节', en: '5 sections' },
          status: 'DONE',
          toolName: 'save_synthesized_srs_doc',
          argsText: '{"modelRef":"M1","id":"AGG-01"}',
          resultText: '{"status":"OK"}',
          durationMs: 910,
        },
      ],
      text: '已把三级审批写进需求文档第 2 节。',
    };

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const html = renderToStaticMarkup(
        <PreferencesProvider>
          <AssistantReplyItem
            run={run}
            changeSummarySlot={<ChangeSummaryCard summary={summary} onUndo={() => undefined} />}
          />
        </PreferencesProvider>,
      );

      const violations = checkBusinessViewMarkup(html);
      expect(
        violations,
        `AssistantReplyItem with WorkProcess + Strip [${locale}]:\n${formatBusinessViewViolations(violations)}`,
      ).toEqual([]);

      expect(html).toContain('data-testid="conversation-work-process"');
      expect(html).toContain(
        locale === 'en-US' ? 'Thought for 4s · 2 steps' : '思考 4 秒 · 2 个步骤',
      );
      expect(html).toContain('data-testid="run-change-summary"');
      expect(html).toContain('data-variant="strip"');
      expect(html).toContain(
        locale === 'en-US' ? 'Requirements document · 2 changes' : '需求文档改了 2 处',
      );
      expect(html).toContain('data-testid="change-summary-toggle-btn"');
      expect(html).toContain('data-testid="change-summary-undo-btn"');
      expect(html).not.toContain('data-testid="change-summary-item"');

      // DOM order: WorkProcessBlock -> Reply Markdown -> Change Summary Strip
      const workIdx = html.indexOf('data-testid="conversation-work-process"');
      const mdIdx = html.indexOf('data-testid="conversation-assistant-markdown"');
      const changeIdx = html.indexOf('data-testid="run-change-summary"');
      expect(workIdx).toBeGreaterThan(-1);
      expect(mdIdx).toBeGreaterThan(workIdx);
      expect(changeIdx).toBeGreaterThan(mdIdx);
    }
  });

  it('marks failed runs clearly without fake results and renders ADR 0016 calm platform notices with tucked diagnostics across all 5 platform problem kinds (#80)', () => {
    const platformCases: Array<{ label: string; run: AgentRunView; expectedDiag: string }> = [
      {
        label: 'UNCONFIGURED',
        expectedDiag: 'LLM_NOT_CONFIGURED',
        run: {
          id: 'fail-unconfigured',
          title: { zh: '梳理需求', en: 'Requirements' },
          status: 'FAILED',
          liveStatus: { zh: '失败', en: 'Failed' },
          startedAt: 1_000,
          completedAt: 2_000,
          steps: [],
          failure: {
            code: 'LLM_NOT_CONFIGURED',
            providerName: '(未配置)',
            baseUrl: '(none)',
            message: 'Missing API key in LLM provider configuration',
            remediation: 'Configure an API key in Platform Settings.',
          },
        },
      },
      {
        label: 'UNREACHABLE',
        expectedDiag: 'ECONNREFUSED',
        run: {
          id: 'fail-unreachable',
          title: { zh: '梳理需求', en: 'Requirements' },
          status: 'FAILED',
          liveStatus: { zh: '失败', en: 'Failed' },
          startedAt: 1_000,
          completedAt: 2_000,
          steps: [],
          failure: {
            code: 'LLM_UNREACHABLE',
            providerName: 'Internal Gateway',
            baseUrl: 'http://127.0.0.1:9999/v1',
            message: 'connect ECONNREFUSED 127.0.0.1:9999',
            remediation: 'Verify gateway endpoint.',
          },
        },
      },
      {
        label: 'TIMEOUT',
        expectedDiag: 'LLM_TIMEOUT',
        run: {
          id: 'fail-timeout',
          title: { zh: '梳理需求', en: 'Requirements' },
          status: 'FAILED',
          liveStatus: { zh: '失败', en: 'Failed' },
          startedAt: 1_000,
          completedAt: 61_000,
          steps: [],
          failure: {
            code: 'LLM_TIMEOUT',
            providerName: 'Primary Gateway',
            baseUrl: 'https://llm.corp.example/v1',
            message: 'Request timed out after 60000ms',
          },
        },
      },
      {
        label: 'GATEWAY',
        expectedDiag: 'status=429',
        run: {
          id: 'fail-gateway',
          title: { zh: '梳理需求', en: 'Requirements' },
          status: 'FAILED',
          liveStatus: { zh: '失败', en: 'Failed' },
          startedAt: 1_000,
          completedAt: 2_000,
          steps: [],
          failure: {
            code: 'LLM_GATEWAY_ERROR',
            statusCode: 429,
            providerName: 'Cloud Gateway',
            baseUrl: 'https://api.example.com/v1',
            message: 'HTTP 429 rate limit exceeded',
          },
        },
      },
      {
        label: 'VISION_UNSUPPORTED',
        expectedDiag: 'VISION_UNSUPPORTED',
        run: {
          id: 'fail-vision',
          title: { zh: '参考图片', en: 'Image reference' },
          status: 'FAILED',
          liveStatus: { zh: '失败', en: 'Failed' },
          startedAt: 1_000,
          completedAt: 2_000,
          steps: [],
          failure: {
            code: 'VISION_UNSUPPORTED',
            providerName: 'Text-Only Provider',
            message: 'Model does not support image_url blocks',
          },
        },
      },
    ];

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const calmCopy =
        locale === 'en-US' ? PLATFORM_UNAVAILABLE_COPY.en : PLATFORM_UNAVAILABLE_COPY.zh;
      const settingsLabel = locale === 'en-US' ? 'Open platform settings' : '前往平台设置';

      for (const tc of platformCases) {
        const html = renderToStaticMarkup(
          <PreferencesProvider>
            <AssistantReplyItem
              run={tc.run}
              onRetry={() => undefined}
              onOpenPlatformSettings={() => undefined}
            />
          </PreferencesProvider>,
        );

        const violations = checkBusinessViewMarkup(html);
        expect(
          violations,
          `Platform failure ${tc.label} [${locale}]:\n${formatBusinessViewViolations(violations)}`,
        ).toEqual([]);

        expect(html).toContain('data-testid="agent-run-failure"');
        expect(html).toContain('role="alert"');
        expect(html).toContain(calmCopy);
        expect(html).toContain('data-testid="agent-run-open-platform-settings-btn"');
        expect(html).toContain(settingsLabel);
        expect(html).toContain('data-testid="agent-run-retry-btn"');
        // Diagnostics tucked inside closed <details>
        expect(html).toContain('data-testid="agent-run-diagnostic-details"');
        expect(html).toContain(tc.expectedDiag);
        expect(html).not.toMatch(/<details[^>]*\sopen/);
        expect(html).not.toContain('data-testid="conversation-assistant-markdown"');
      }

      // Non-failed vision fallback notice also tucks technical diagnostics inside closed <details>
      const visionFallbackHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AssistantReplyItem
            run={{
              id: 'ok-vision-fallback',
              title: { zh: '调整筛选栏', en: 'Adjust filter' },
              status: 'SUCCEEDED',
              liveStatus: { zh: '已完成', en: 'Completed' },
              startedAt: 1_000,
              completedAt: 3_000,
              steps: [],
              text: locale === 'en-US' ? 'Updated from text notes.' : '已按文字说明处理。',
              visionFallback: {
                used: true,
                providerName: 'Text-Only Gateway',
                notice: 'Multimodal image_url JSON blocks skipped',
              },
            }}
            onOpenPlatformSettings={() => undefined}
          />
        </PreferencesProvider>,
      );
      expect(checkBusinessViewMarkup(visionFallbackHtml)).toEqual([]);
      expect(visionFallbackHtml).toContain('data-testid="agent-run-platform-notice"');
      expect(visionFallbackHtml).toContain(calmCopy);
      expect(visionFallbackHtml).toContain('data-testid="agent-run-open-platform-settings-btn"');
      expect(visionFallbackHtml).toContain('data-testid="agent-run-diagnostic-details"');
      expect(visionFallbackHtml).toContain('Text-Only Gateway');

      // Generic non-platform runtime failure: plain-language summary + Retry, NO platform settings button, raw SQLite/model jargon tucked in closed <details>
      const nonPlatformHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AssistantReplyItem
            run={{
              id: 'fail-generic',
              title: { zh: '保存规则', en: 'Save rule' },
              status: 'FAILED',
              liveStatus: { zh: '失败', en: 'Failed' },
              startedAt: 1_000,
              completedAt: 2_000,
              steps: [],
              failure: {
                code: 'AGENT_RUNTIME_ERROR',
                message: 'SQLITE_CONSTRAINT: invalid JSON payload for M2 BHV-01',
                remediation: 'Retry the request.',
              },
            }}
            onRetry={() => undefined}
            onOpenPlatformSettings={() => undefined}
          />
        </PreferencesProvider>,
      );
      expect(checkBusinessViewMarkup(nonPlatformHtml)).toEqual([]);
      expect(nonPlatformHtml).toContain('data-testid="agent-run-failure"');
      expect(nonPlatformHtml).not.toContain(calmCopy);
      expect(nonPlatformHtml).not.toContain('data-testid="agent-run-open-platform-settings-btn"');
      expect(nonPlatformHtml).toContain('data-testid="agent-run-retry-btn"');
      expect(nonPlatformHtml).toContain('data-testid="agent-run-diagnostic-details"');
      expect(nonPlatformHtml).toContain('SQLITE_CONSTRAINT');
    }
  });
});
