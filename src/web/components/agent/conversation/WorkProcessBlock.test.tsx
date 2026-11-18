import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
  type BusinessLocale,
} from '../../../../packages/business-vocabulary/index.js';
import type { AgentSession } from '../../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import { agentRunsFromSession, type AgentRunView } from '../agentRun.js';
import {
  WorkProcessBlock,
  clearWorkProcessExpansionForTests,
  setToolStepExpanded,
  setWorkBlockExpanded,
} from './WorkProcessBlock.js';

function stubLocale(locale: BusinessLocale) {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: () => undefined,
    removeItem: () => undefined,
  });
}

describe('WorkProcessBlock (#80)', () => {
  afterEach(() => {
    clearWorkProcessExpansionForTests();
    vi.unstubAllGlobals();
  });

  it('adapts structured tool argsText, resultText, durationMs, and thinkingDurationMs in agentRunsFromSession and renders default-collapsed summary lines across completed and running states', () => {
    const session: AgentSession = {
      id: 'sess-wp-1',
      projectId: 'proj-contract',
      agentKind: 'REQUIREMENT',
      title: '采购合同需求梳理',
      status: 'IDLE',
      createdAt: '2026-11-18T10:00:00.000Z',
      updatedAt: '2026-11-18T10:00:07.000Z',
      messages: [
        {
          id: 'u-wp-1',
          role: 'user',
          content: '帮我梳理采购合同三级审批规则',
          timestamp: '2026-11-18T10:00:00.000Z',
        },
        {
          id: 'a-wp-1',
          role: 'assistant',
          content: '已写入三级审批规则。',
          thinking: '先读取现有需求草稿，再记录三级审批要点。',
          thinkingDurationMs: 6_200,
          timestamp: '2026-11-18T10:00:08.000Z',
          toolCalls: [
            {
              id: 'tc-wp-1',
              toolName: 'read_ontology_model',
              arguments: { modelCode: 'M1', targetId: 'AGG-01' },
              output: '{"aggregates":["AGG-01"]}',
              durationMs: 420,
            },
            {
              id: 'tc-wp-2',
              toolName: 'record_requirement_insights',
              arguments: {
                aggregates: ['采购合同', '供应商'],
                rules: ['金额分级审批'],
              },
              output: '{"status":"OK","recorded":3}',
              durationMs: 880,
            },
          ],
        },
      ],
    };

    const [run] = agentRunsFromSession(session);
    expect(run).toBeDefined();
    expect(run!.thinkingDurationMs).toBe(6_200);
    expect(run!.steps[0]!.durationMs).toBe(420);
    expect(run!.steps[0]!.argsText).toContain('"modelCode": "M1"');
    expect(run!.steps[0]!.resultText).toBe('{"aggregates":["AGG-01"]}');
    // Backward compatibility: legacy `detail` remains intact for AgentRunCard
    expect(run!.steps[0]!.detail).toContain('"modelCode": "M1"');
    expect(run!.steps[0]!.detail).toContain('{"aggregates":["AGG-01"]}');

    // 1. Completed run with BOTH thinking and steps -> "思考 6 秒 · 2 个步骤" / "Thought for 6s · 2 steps"
    stubLocale('zh-CN');
    const zhDoneHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkProcessBlock run={run!} />
      </PreferencesProvider>,
    );
    expect(zhDoneHtml).toContain('data-testid="conversation-work-process"');
    expect(zhDoneHtml).toContain('data-expanded="false"');
    expect(zhDoneHtml).toContain('工作过程');
    expect(zhDoneHtml).toContain('思考 6 秒 · 2 个步骤');
    expect(zhDoneHtml).not.toContain('data-testid="conversation-work-body"');
    expect(
      checkBusinessViewMarkup(zhDoneHtml),
      formatBusinessViewViolations(checkBusinessViewMarkup(zhDoneHtml)),
    ).toEqual([]);

    stubLocale('en-US');
    const enDoneHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkProcessBlock run={run!} />
      </PreferencesProvider>,
    );
    expect(enDoneHtml).toContain('Work process');
    expect(enDoneHtml).toContain('Thought for 6s · 2 steps');
    expect(
      checkBusinessViewMarkup(enDoneHtml),
      formatBusinessViewViolations(checkBusinessViewMarkup(enDoneHtml)),
    ).toEqual([]);

    // 2. Completed run with ONLY thinking (timestamp fallback when thinkingDurationMs is absent)
    const thinkingOnlyRun: AgentRunView = {
      id: 'run-think-only',
      title: { zh: '梳理范围', en: 'Scope' },
      status: 'SUCCEEDED',
      liveStatus: { zh: '已完成', en: 'Completed' },
      startedAt: 10_000,
      completedAt: 14_000,
      thinking: '分析用户提出的三条付款节点。',
      steps: [],
    };
    stubLocale('zh-CN');
    const zhThinkOnly = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkProcessBlock run={thinkingOnlyRun} />
      </PreferencesProvider>,
    );
    expect(zhThinkOnly).toContain('思考 4 秒');
    expect(zhThinkOnly).not.toContain('个步骤');

    stubLocale('en-US');
    const enThinkOnly = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkProcessBlock run={thinkingOnlyRun} />
      </PreferencesProvider>,
    );
    expect(enThinkOnly).toContain('Thought for 4s');
    expect(enThinkOnly).not.toContain('step');

    // 3. Completed run with ONLY steps (no thinking)
    const stepsOnlyRun: AgentRunView = {
      id: 'run-steps-only',
      title: { zh: '保存草稿', en: 'Save draft' },
      status: 'SUCCEEDED',
      liveStatus: { zh: '已完成', en: 'Completed' },
      startedAt: 10_000,
      completedAt: 12_000,
      steps: [run!.steps[0]!],
    };
    stubLocale('zh-CN');
    const zhStepsOnly = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkProcessBlock run={stepsOnlyRun} />
      </PreferencesProvider>,
    );
    expect(zhStepsOnly).toContain('工作过程');
    expect(zhStepsOnly).toContain('1 个步骤');
    expect(zhStepsOnly).not.toContain('思考');

    stubLocale('en-US');
    const enStepsOnly = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkProcessBlock run={stepsOnlyRun} />
      </PreferencesProvider>,
    );
    expect(enStepsOnly).toContain('Work process');
    expect(enStepsOnly).toContain('1 step');
    expect(enStepsOnly).not.toContain('1 steps');

    // 4. Running state -> spinner + live business step + step count/elapsed + Cancel button
    const runningRun: AgentRunView = {
      id: 'run-live-1',
      title: { zh: '整理审批', en: 'Organize approval' },
      status: 'RUNNING',
      liveStatus: { zh: '正在思考…', en: 'Thinking…' },
      startedAt: 1_000,
      steps: [
        run!.steps[0]!,
        {
          id: 'tc-live-2',
          label: { zh: '正在记录需求要点', en: 'Recording requirements points' },
          status: 'RUNNING',
          toolName: 'record_requirement_insights',
        },
      ],
    };
    stubLocale('zh-CN');
    const zhRunningHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkProcessBlock run={runningRun} now={6_000} onCancel={() => undefined} />
      </PreferencesProvider>,
    );
    expect(zhRunningHtml).toContain('data-testid="conversation-live-status"');
    expect(zhRunningHtml).toContain('正在记录需求要点');
    expect(zhRunningHtml).toContain('2 个步骤');
    expect(zhRunningHtml).toContain('data-testid="agent-run-cancel-btn"');
    expect(
      checkBusinessViewMarkup(zhRunningHtml),
      formatBusinessViewViolations(checkBusinessViewMarkup(zhRunningHtml)),
    ).toEqual([]);
  });

  it('passes checkBusinessViewMarkup in collapsed state even with raw tool names, JSON args, model codes, and element IDs, then reveals Level-1 business rows and Level-2 developer details on expansion', () => {
    const session: AgentSession = {
      id: 'sess-wp-levels',
      projectId: 'proj-contract',
      agentKind: 'COPILOT',
      title: '更新合同模型',
      status: 'IDLE',
      createdAt: '2026-11-18T10:05:00.000Z',
      updatedAt: '2026-11-18T10:05:09.000Z',
      messages: [
        {
          id: 'u-lvl-1',
          role: 'user',
          content: '在合同上补充分级审批规则并更新新建按钮',
          timestamp: '2026-11-18T10:05:00.000Z',
        },
        {
          id: 'a-lvl-1',
          role: 'assistant',
          content: '已完成更新。',
          thinking: '先检查当前业务对象，再写入合同字段并调整界面按钮。',
          thinkingDurationMs: 5_000,
          timestamp: '2026-11-18T10:05:09.000Z',
          toolCalls: [
            {
              id: 'tc-lvl-1',
              toolName: 'inspect_ontology_model',
              arguments: { modelCode: 'M1', format: 'YAML' },
              output: 'aggregates: [AGG-01]',
              durationMs: 380,
            },
            {
              id: 'tc-lvl-2',
              toolName: 'upsert_aggregate',
              arguments: {
                id: 'AGG-01',
                name: 'Contract',
                alias: '合同',
                fields: ['contractNo', 'amount', 'counterparty', 'status'],
              },
              output: 'Saved AGG-01 into M1.yaml',
              durationMs: 1_260,
            },
            {
              id: 'tc-lvl-3',
              toolName: 'edit_prototype_anchor',
              arguments: {
                screenId: 'SCR-CONTRACT-LIST',
                elementId: 'EL-ACT-NEW',
                html: '<button>立即新建合同</button>',
              },
              output: 'Updated EL-ACT-NEW in 界面原型.html',
              durationMs: 640,
              targetAnchor: {
                screenId: 'SCR-CONTRACT-LIST',
                elementId: 'EL-ACT-NEW',
                label: '新建合同按钮',
              },
            },
          ],
        },
      ],
    };

    const [run] = agentRunsFromSession(session);
    expect(run).toBeDefined();

    // Level 0 (Collapsed): 0 Business View violations in both zh-CN and en-US, zero tool names or IDs
    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const collapsedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <WorkProcessBlock run={run!} />
        </PreferencesProvider>,
      );
      const violations = checkBusinessViewMarkup(collapsedHtml);
      expect(
        violations,
        `Collapsed WorkProcessBlock [${locale}]:\n${formatBusinessViewViolations(violations)}`,
      ).toEqual([]);
      expect(collapsedHtml).not.toContain('inspect_ontology_model');
      expect(collapsedHtml).not.toContain('upsert_aggregate');
      expect(collapsedHtml).not.toContain('AGG-01');
      expect(collapsedHtml).not.toContain('SCR-CONTRACT-LIST');
    }

    // Level 1 (Work Process expanded, tool rows still collapsed):
    // Thinking comes first, followed by 3 chronological 1-row-per-tool business labels + summary + duration; still NO raw toolName/args/output!
    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const level1Html = renderToStaticMarkup(
        <PreferencesProvider>
          <WorkProcessBlock run={run!} defaultExpanded onHoverAnchor={() => undefined} />
        </PreferencesProvider>,
      );
      expect(level1Html).toContain('data-testid="conversation-work-body"');
      expect(level1Html).toContain('data-testid="conversation-thinking-block"');
      expect(level1Html).toContain(locale === 'en-US' ? 'Thought for 5s' : '思考了 5 秒');
      expect(level1Html.match(/data-testid="conversation-tool-step"/g)).toHaveLength(3);

      // Thinking appears before the first tool step in DOM order
      expect(level1Html.indexOf('data-testid="conversation-thinking-block"')).toBeLessThan(
        level1Html.indexOf('data-testid="conversation-tool-list"'),
      );

      if (locale === 'zh-CN') {
        expect(level1Html).toContain('检查业务对象');
        expect(level1Html).toContain('更新业务对象「合同」');
        expect(level1Html).toContain('包含 4 个字段');
        expect(level1Html).toContain('修改原型中的「新建合同按钮」');
        // Chronological order preserved
        expect(level1Html.indexOf('检查业务对象')).toBeLessThan(
          level1Html.indexOf('更新业务对象「合同」'),
        );
        expect(level1Html.indexOf('更新业务对象「合同」')).toBeLessThan(
          level1Html.indexOf('修改原型中的「新建合同按钮」'),
        );
      } else {
        expect(level1Html).toContain('Check Business Objects');
        expect(level1Html).toContain('Update Business Object &#x27;Contract&#x27;');
        expect(level1Html).toContain('4 fields');
      }

      // Per-step durations rendered cleanly
      expect(level1Html).toContain('0.4s');
      expect(level1Html).toContain('1.3s');
      expect(level1Html).toContain('0.6s');

      // Level 2 developer details remain unmounted until a tool row is expanded
      expect(level1Html).not.toContain('data-testid="conversation-tool-detail"');
      expect(level1Html).not.toContain('upsert_aggregate');
      expect(level1Html).not.toContain('Saved AGG-01');
      const level1Violations = checkBusinessViewMarkup(level1Html);
      expect(
        level1Violations,
        `Level-1 WorkProcessBlock [${locale}]:\n${formatBusinessViewViolations(level1Violations)}`,
      ).toEqual([]);
    }

    // Level 2 (Specific tool row expanded + expansion memory across remounts):
    setWorkBlockExpanded(run!.id, true);
    setToolStepExpanded('tc-lvl-3', true);
    stubLocale('zh-CN');
    const level2Html = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkProcessBlock run={run!} />
      </PreferencesProvider>,
    );
    expect(level2Html.match(/data-testid="conversation-tool-detail"/g)).toHaveLength(1);
    expect(level2Html).toContain('data-testid="conversation-tool-name"');
    expect(level2Html).toContain('edit_prototype_anchor');
    expect(level2Html).toContain('SCR-CONTRACT-LIST · EL-ACT-NEW');
    expect(level2Html).toContain('data-testid="conversation-tool-args"');
    expect(level2Html).toContain('&quot;elementId&quot;: &quot;EL-ACT-NEW&quot;');
    expect(level2Html).toContain('data-testid="conversation-tool-result"');
    expect(level2Html).toContain('Updated EL-ACT-NEW in 界面原型.html');
  });
});
