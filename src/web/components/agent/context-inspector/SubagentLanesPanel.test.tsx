import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusinessLocale } from '../../../../packages/business-vocabulary/index.js';
import type { ModelCallSummary } from '../../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import type { ContextInspectorRunTrace } from './ContextEventsList.js';
import {
  SubagentLanesPanel,
  deriveSubagentLanes,
  resolveNextSubagentLaneCallId,
} from './SubagentLanesPanel.js';

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

function makeCall(overrides: Partial<ModelCallSummary> & { id: string; seq: number }): ModelCallSummary {
  const promptTokens = overrides.usage?.promptTokens ?? 2400;
  const outputTokens = overrides.usage?.outputTokens ?? 320;
  return {
    projectId: 'proj-contract',
    sessionId: 'sess-lanes-84',
    runId: 'run-proto-1',
    purpose: 'TURN',
    provider: 'Z.ai',
    model: 'glm-5.3-flash',
    contextWindow: 128_000,
    maxOutputTokens: 8192,
    startedAt: `2026-11-18T11:0${overrides.seq % 10}:00.000Z`,
    endedAt: `2026-11-18T11:0${overrides.seq % 10}:03.000Z`,
    durationMs: 1800,
    status: 'COMPLETED',
    usage: {
      promptTokens,
      inputTokens: promptTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: promptTokens + outputTokens,
      source: 'PROVIDER',
    },
    estimate: {
      byKind: {
        INSTRUCTIONS: 900,
        TOOL_GUIDE: 0,
        TOOL_DEFINITION: 600,
        BUSINESS_CONTEXT: 500,
        COMPACTED_SUMMARY: 0,
        USER_MESSAGE: 400,
        ASSISTANT_MESSAGE: 0,
        TOOL_CALL: 0,
        TOOL_RESULT: 0,
        REASONING: 0,
      },
      inputTokens: promptTokens,
      outputTokens,
      excludedTokens: 0,
    },
    includedCount: 5,
    excludedCount: 0,
    responseToolNames: [],
    hasDetail: true,
    ...overrides,
  };
}

function buildMultiStatusLanesFixture(): {
  modelCalls: ModelCallSummary[];
  runs: ContextInspectorRunTrace[];
} {
  const parentCoord = makeCall({
    id: 'call-parent-1',
    seq: 1,
    runId: 'run-proto-1',
    purpose: 'TURN',
    responseToolNames: ['spawn_subagents'],
    usage: {
      promptTokens: 4800,
      inputTokens: 4800,
      outputTokens: 280,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 5080,
      source: 'PROVIDER',
    },
  });

  // Lane 1: COMPLETED with 2 rounds (validator repair round #2 -> #4)
  const subLedgerRound1 = makeCall({
    id: 'call-sub-ledger-1',
    seq: 2,
    runId: 'run-proto-1',
    purpose: 'SUBAGENT',
    parentCallId: 'call-parent-1',
    laneLabel: { zh: '台账列表设计师', en: 'Ledger Screen Designer' },
    usage: {
      promptTokens: 2200,
      inputTokens: 2200,
      outputTokens: 410,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2610,
      source: 'PROVIDER',
    },
  });
  const subLedgerRound2 = makeCall({
    id: 'call-sub-ledger-2',
    seq: 4,
    runId: 'run-proto-1',
    purpose: 'SUBAGENT',
    parentCallId: 'call-parent-1',
    laneLabel: { zh: '台账列表设计师', en: 'Ledger Screen Designer' },
    usage: {
      promptTokens: 3600,
      inputTokens: 3600,
      outputTokens: 390,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 3990,
      source: 'PROVIDER',
    },
  });

  // Lane 2: ERROR status
  const subApprovalErr = makeCall({
    id: 'call-sub-approval-err',
    seq: 3,
    runId: 'run-proto-1',
    purpose: 'SUBAGENT',
    parentCallId: 'call-parent-1',
    laneLabel: { zh: '审批详情设计师', en: 'Approval Screen Designer' },
    status: 'ERROR',
    errorMessage: 'Gateway timeout',
    usage: {
      promptTokens: 1800,
      inputTokens: 1800,
      outputTokens: 90,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 1890,
      source: 'PROVIDER',
    },
  });

  // Lane 3: Live RUNNING subagent from runs.subagentLanes (before its first stream settles)
  const runs: ContextInspectorRunTrace[] = [
    {
      id: 'run-proto-1',
      status: 'RUNNING',
      subagentLanes: [
        {
          laneId: 'sublane-1',
          workerIndex: 1,
          workerLabel: { zh: '台账列表设计师', en: 'Ledger Screen Designer' },
          taskTitle: { zh: '绘制合同台账列表页', en: 'Build Contract Ledger Screen' },
          status: 'DONE',
          startedAt: '2026-11-18T11:02:00.000Z',
          completedAt: '2026-11-18T11:04:03.000Z',
        },
        {
          laneId: 'sublane-2',
          workerIndex: 2,
          workerLabel: { zh: '审批详情设计师', en: 'Approval Screen Designer' },
          taskTitle: { zh: '绘制合同审批详情页', en: 'Build Contract Approval Screen' },
          status: 'FAILED',
          error: 'Gateway timeout',
          startedAt: '2026-11-18T11:03:00.000Z',
          completedAt: '2026-11-18T11:03:03.000Z',
        },
        {
          laneId: 'sublane-3',
          workerIndex: 3,
          workerLabel: { zh: '统计看板设计师', en: 'Dashboard Designer' },
          taskTitle: { zh: '绘制履约指标看板', en: 'Build Fulfillment Dashboard' },
          status: 'RUNNING',
          startedAt: '2026-11-18T11:04:05.000Z',
        },
      ],
    },
  ];

  return {
    modelCalls: [parentCoord, subLedgerRound1, subApprovalErr, subLedgerRound2],
    runs,
  };
}

describe('SubagentLanesPanel (#84, User Story 29)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('groups SUBAGENT calls per lane, merges live RUNNING traces, computes peak context size & call count, and cycles multi-call targets', () => {
    const fixture = buildMultiStatusLanesFixture();
    const lanes = deriveSubagentLanes(fixture);

    expect(lanes).toHaveLength(3);

    const [ledgerLane, approvalLane, runningLane] = lanes;

    expect(ledgerLane).toMatchObject({
      label: { zh: '台账列表设计师', en: 'Ledger Screen Designer' },
      status: 'COMPLETED',
      contextTokens: 3600,
      contextRatio: 1,
      callCount: 2,
      parentCallId: 'call-parent-1',
      parentCallSeq: 1,
    });
    expect(ledgerLane!.calls.map((c) => c.id)).toEqual([
      'call-sub-ledger-1',
      'call-sub-ledger-2',
    ]);

    // Multi-call cycling: unselected -> round 1 -> round 2 -> round 1
    expect(resolveNextSubagentLaneCallId(ledgerLane!, 'call-parent-1')).toBe('call-sub-ledger-1');
    expect(resolveNextSubagentLaneCallId(ledgerLane!, 'call-sub-ledger-1')).toBe('call-sub-ledger-2');
    expect(resolveNextSubagentLaneCallId(ledgerLane!, 'call-sub-ledger-2')).toBe('call-sub-ledger-1');

    expect(approvalLane).toMatchObject({
      label: { zh: '审批详情设计师', en: 'Approval Screen Designer' },
      status: 'ERROR',
      contextTokens: 1800,
      contextRatio: 0.5,
      callCount: 1,
      parentCallId: 'call-parent-1',
      parentCallSeq: 1,
    });
    expect(resolveNextSubagentLaneCallId(approvalLane!, null)).toBe('call-sub-approval-err');

    expect(runningLane).toMatchObject({
      label: { zh: '统计看板设计师', en: 'Dashboard Designer' },
      status: 'RUNNING',
      contextTokens: 0,
      callCount: 0,
      parentCallSeq: 1,
      fallbackCallId: 'call-parent-1',
    });
    expect(resolveNextSubagentLaneCallId(runningLane!, null)).toBe('call-parent-1');
  });

  it('renders COMPLETED, ERROR, and RUNNING lanes with context size, call count, parent #seq, and multi-call #seq pills in zh-CN and en-US', () => {
    const fixture = buildMultiStatusLanesFixture();

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const html = renderToStaticMarkup(
        <PreferencesProvider>
          <SubagentLanesPanel
            {...fixture}
            selectedCallId="call-sub-ledger-1"
            onSelectCall={() => undefined}
            focused
          />
        </PreferencesProvider>,
      );

      expect(html).toContain('data-testid="context-subagent-lanes-section"');
      expect(html).toContain('data-focused="true"');
      expect(html.match(/data-testid="context-subagent-lane"/g)).toHaveLength(3);
      expect(html).toContain('data-lane-status="COMPLETED"');
      expect(html).toContain('data-lane-status="ERROR"');
      expect(html).toContain('data-lane-status="RUNNING"');

      // Multi-call lane exposes clickable #2 and #4 pills so every subagent call is inspectable
      expect(html.match(/data-testid="context-subagent-call-pill"/g)).toHaveLength(2);
      expect(html).toContain('data-call-seq="2"');
      expect(html).toContain('data-call-seq="4"');

      // Context sizes
      expect(html).toContain('3,600');
      expect(html).toContain('1,800');

      if (locale === 'zh-CN') {
        expect(html).toContain('子智能体泳道');
        expect(html).toContain('台账列表设计师');
        expect(html).toContain('审批详情设计师');
        expect(html).toContain('统计看板设计师');
        expect(html).toContain('2 次调用');
        expect(html).toContain('1 次调用');
        expect(html).toContain('0 次调用');
        expect(html).toContain('已完成');
        expect(html).toContain('失败');
        expect(html).toContain('运行中');
        expect(html).toContain('源自 #1');
      } else {
        expect(html).toContain('Subagent lanes');
        expect(html).toContain('Ledger Screen Designer');
        expect(html).toContain('Approval Screen Designer');
        expect(html).toContain('Dashboard Designer');
        expect(html).toContain('2 calls');
        expect(html).toContain('1 call');
        expect(html).toContain('0 calls');
        expect(html).toContain('Completed');
        expect(html).toContain('Error');
        expect(html).toContain('Running');
        expect(html).toContain('From #1');
      }
    }
  });
});
