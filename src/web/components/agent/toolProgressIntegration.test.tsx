import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession, AgentToolCallTrace } from '../../../packages/workspace-store/index.js';
import { checkBusinessViewMarkup } from '../../../packages/business-vocabulary/index.js';
import { formatToolStepLabel } from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import { ToolChips } from '../beautifui/ToolChips.js';
import { AgentRunCard } from './AgentRunCard.js';
import { agentRunsFromSession } from './agentRun.js';

const noop = () => {};

function useLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('consolidated business-vocabulary tool labels in web components (#56)', () => {
  it('adapts session toolCalls into business-language step labels in AgentRunCard for zh-CN and en-US', () => {
    const traces: AgentToolCallTrace[] = [
      {
        id: 'tc-1',
        toolName: 'inspect_ontology_model',
        arguments: { modelCode: 'M1' },
        output: 'OK',
      },
      {
        id: 'tc-2',
        toolName: 'upsert_aggregate',
        arguments: { id: 'AGG-01', name: 'Contract', alias: '合同' },
        output: 'Saved Contract',
      },
      {
        id: 'tc-3',
        toolName: 'upsert_behavior',
        arguments: { id: 'BHV-02', name: 'submitForApproval', alias: '提交审批' },
        output: 'Saved submitForApproval',
      },
    ];

    const session: AgentSession = {
      id: 'sess-1',
      projectId: 'proj-contract',
      agentKind: 'COPILOT',
      title: '对话',
      status: 'IDLE',
      pinned: false,
      createdAt: '2026-11-17T08:00:00.000Z',
      updatedAt: '2026-11-17T08:00:05.000Z',
      messages: [
        {
          id: 'u-1',
          role: 'user',
          content: '给合同新增提交审批操作',
          timestamp: '2026-11-17T08:00:00.000Z',
        },
        {
          id: 'a-1',
          role: 'assistant',
          content: '已完成更新。',
          toolCalls: traces,
          timestamp: '2026-11-17T08:00:05.000Z',
        },
      ],
    };

    const [run] = agentRunsFromSession(session);
    expect(run?.steps.map((s) => s.label)).toEqual([
      { zh: '检查业务对象', en: 'Check Business Objects' },
      { zh: '更新业务对象「合同」', en: "Update Business Object 'Contract'" },
      { zh: '更新业务操作「提交审批」', en: "Update Action 'submitForApproval'" },
    ]);

    const zhHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <AgentRunCard run={run!} now={Date.parse('2026-11-17T08:00:10.000Z')} />
      </PreferencesProvider>,
    );
    expect(zhHtml).toContain('检查业务对象');
    expect(zhHtml).toContain('更新业务对象「合同」');
    expect(zhHtml).toContain('更新业务操作「提交审批」');

    useLocale('en-US');
    const enHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <AgentRunCard run={run!} now={Date.parse('2026-11-17T08:00:10.000Z')} />
      </PreferencesProvider>,
    );
    expect(enHtml).toContain('Check Business Objects');
    expect(enHtml).toContain('Update Business Object &#x27;Contract&#x27;');

    // Step labels themselves pass the Business View vocabulary guard
    for (const step of run!.steps) {
      expect(checkBusinessViewMarkup(`<span>${step.label.zh}</span>`)).toEqual([]);
      expect(checkBusinessViewMarkup(`<span>${step.label.en}</span>`)).toEqual([]);
    }
  });

  it('delegates formatToolStepLabel and ToolChips to the single business-vocabulary mapping', () => {
    expect(formatToolStepLabel('upsert_scenario')).toEqual({
      zh: '更新自动联动',
      en: 'Update Automations',
    });

    const chipHtmlZh = renderToStaticMarkup(
      <PreferencesProvider>
        <ToolChips
          traces={[
            {
              id: 't-1',
              toolName: 'upsert_scenario',
              arguments: { id: 'SCN-01', name: '逾期自动冻结' },
              output: 'done',
              durationMs: 25,
            },
          ]}
        />
      </PreferencesProvider>,
    );
    expect(chipHtmlZh).toContain('更新自动联动「逾期自动冻结」');
  });
});
