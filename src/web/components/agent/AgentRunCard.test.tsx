import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundPipelineTask } from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import { AgentPanel } from './AgentPanel.js';
import { AgentRunCard, type AgentRunCardProps } from './AgentRunCard.js';
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  clampAgentPanelWidth,
  parseAgentPanelPrefs,
} from './agentPanelStore.js';
import { agentRunFromPipelineTask, formatRunElapsed, type AgentRunView } from './agentRun.js';

const STARTED_AT = Date.UTC(2026, 10, 12, 10, 0, 0);
const noop = () => {};

function makeRun(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    id: 'run-1',
    title: { zh: '生成界面原型', en: 'Generate prototype' },
    status: 'RUNNING',
    liveStatus: { zh: '正在流式生成 HTML…', en: 'Streaming HTML…' },
    startedAt: STARTED_AT,
    steps: [
      {
        id: 's1',
        label: { zh: '读取需求文档', en: 'Read the SRS' },
        status: 'DONE',
        at: '2026-11-12T10:00:01.000Z',
      },
      {
        id: 's2',
        label: { zh: '流式生成 HTML', en: 'Stream HTML' },
        status: 'RUNNING',
        detail: '<section data-screen-id="SCR-1">',
      },
    ],
    thinking: '先确定屏幕清单，再逐屏输出。',
    ...overrides,
  };
}

function useLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

function renderCard(props: Partial<AgentRunCardProps> & { run: AgentRunView }): string {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <AgentRunCard
        now={STARTED_AT + 84_000}
        onCancel={noop}
        onRetry={noop}
        onOpenArtifact={noop}
        onOpenLlmCenter={noop}
        {...props}
      />
    </PreferencesProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgentRunCard', () => {
  it('shows live status, elapsed time, cancel and steps while running', () => {
    const html = renderCard({ run: makeRun() });

    expect(html).toContain('data-run-status="RUNNING"');
    expect(html).toContain('data-testid="agent-run-live"');
    expect(html).toContain('正在流式生成 HTML…');
    expect(html).toContain('01:24');
    expect(html).toContain('data-testid="agent-run-cancel-btn"');
    expect(html).toContain('读取需求文档');
    expect(html).toContain('data-step-status="RUNNING"');
    expect(html).not.toContain('agent-run-result');
    expect(html).not.toContain('agent-run-failure');
    expect(html).not.toContain('agent-run-retry-btn');
  });

  it('keeps thinking and step detail collapsed by default', () => {
    const html = renderCard({ run: makeRun() });

    expect(html).toContain('data-testid="agent-run-thinking"');
    expect(html).toContain('先确定屏幕清单，再逐屏输出。');
    expect(html).toContain('SCR-1');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it('shows the result summary and a link to the artifact when it succeeded', () => {
    const html = renderCard({
      run: makeRun({
        status: 'SUCCEEDED',
        completedAt: STARTED_AT + 125_000,
        result: {
          summary: { zh: '已生成 6 个屏幕', en: 'Generated 6 screens' },
          artifactLabel: { zh: '查看原型', en: 'View prototype' },
        },
      }),
    });

    expect(html).toContain('data-run-status="SUCCEEDED"');
    expect(html).toContain('data-testid="agent-run-result"');
    expect(html).toContain('已生成 6 个屏幕');
    expect(html).toContain('data-testid="agent-run-open-artifact-btn"');
    expect(html).toContain('查看原型');
    expect(html).toContain('02:05');
    expect(html).not.toContain('agent-run-cancel-btn');
    expect(html).not.toContain('agent-run-live');
  });

  it('reports the real failure with retry and a way to the LLM Center', () => {
    const html = renderCard({
      run: makeRun({
        status: 'FAILED',
        completedAt: STARTED_AT + 9_000,
        failure: {
          message: 'LLM gateway timed out after 60s',
          remediation: '检查网关地址或更换模型',
        },
      }),
    });

    expect(html).toContain('data-run-status="FAILED"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('LLM gateway timed out after 60s');
    expect(html).toContain('检查网关地址或更换模型');
    expect(html).toContain('data-testid="agent-run-retry-btn"');
    expect(html).toContain('data-testid="agent-run-llm-center-btn"');
    expect(html).not.toContain('agent-run-result');
    expect(html).not.toContain('agent-run-cancel-btn');
  });

  it('says so when a failed run carries no reason instead of looking successful', () => {
    const html = renderCard({ run: makeRun({ status: 'FAILED', completedAt: STARTED_AT }) });

    expect(html).toContain('运行失败，未返回原因。');
    expect(html).not.toContain('agent-run-result');
  });

  it('marks a cancelled run as cancelled and offers to run it again', () => {
    const html = renderCard({
      run: makeRun({ status: 'CANCELLED', completedAt: STARTED_AT + 3_000 }),
    });

    expect(html).toContain('data-run-status="CANCELLED"');
    expect(html).toContain('data-testid="agent-run-cancelled"');
    expect(html).toContain('已在完成前取消。');
    expect(html).toContain('data-testid="agent-run-retry-btn"');
    expect(html).not.toContain('agent-run-cancel-btn');
    expect(html).not.toContain('agent-run-result');
    expect(html).not.toContain('agent-run-failure');
  });

  it('renders in English when the locale is en-US', () => {
    useLocale('en-US');
    const html = renderCard({ run: makeRun() });

    expect(html).toContain('Generate prototype');
    expect(html).toContain('Streaming HTML…');
    expect(html).toContain('Cancel');
    expect(html).toContain('Thinking');
    expect(html).not.toContain('生成界面原型');
  });
});

describe('AgentPanel', () => {
  const panelProps = {
    title: { zh: '原型共创', en: 'Prototype Co-Design' },
    width: AGENT_PANEL_DEFAULT_WIDTH,
    onClose: noop,
    onResize: noop,
    now: STARTED_AT + 1_000,
  };

  it('explains itself when the module has no runs yet', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <AgentPanel {...panelProps} runs={[]} />
      </PreferencesProvider>,
    );

    expect(html).toContain('原型共创');
    expect(html).toContain('data-testid="agent-panel-empty"');
    expect(html).toContain('data-testid="agent-panel-resizer"');
    expect(html).not.toContain('agent-panel-running');
  });

  it('lists runs with a running count and exposes the width to assistive tech', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <AgentPanel
          {...panelProps}
          runs={[
            makeRun({ id: 'a', status: 'SUCCEEDED', completedAt: STARTED_AT }),
            makeRun({ id: 'b' }),
          ]}
        />
      </PreferencesProvider>,
    );

    expect(html.match(/data-testid="agent-run-card"/g)).toHaveLength(2);
    expect(html).toContain('1 个运行中');
    expect(html).toContain(`aria-valuenow="${AGENT_PANEL_DEFAULT_WIDTH}"`);
  });

  it('becomes an overlay with a scrim and no resizer on narrow viewports', () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <AgentPanel {...panelProps} runs={[]} overlay />
      </PreferencesProvider>,
    );

    expect(html).toContain('data-testid="agent-panel-scrim"');
    expect(html).toContain('is-overlay');
    expect(html).not.toContain('agent-panel-resizer');
  });
});

describe('agentRunFromPipelineTask', () => {
  function makeTask(overrides: Partial<BackgroundPipelineTask> = {}): BackgroundPipelineTask {
    return {
      id: 'task-1',
      kind: 'PROTOTYPE_GEN',
      projectId: 'p1',
      projectName: 'Demo',
      status: 'RUNNING',
      phase: 'GENERATING',
      step: 2,
      totalSteps: 4,
      titleZh: '生成界面原型',
      titleEn: 'Generate prototype',
      messageZh: '正在生成…',
      messageEn: 'Generating…',
      completedChapters: 0,
      thinkingChars: 0,
      thinkingText: '',
      streamedChars: 0,
      streamedText: '',
      previewTail: '<main>',
      stageLogs: [
        {
          id: 'l1',
          step: 1,
          phase: 'CONTEXT',
          messageZh: '读取需求',
          messageEn: 'Read SRS',
          timestamp: '2026-11-12T10:00:00.000Z',
        },
        {
          id: 'l2',
          step: 2,
          phase: 'GENERATING',
          messageZh: '生成 HTML',
          messageEn: 'Generate HTML',
          timestamp: '2026-11-12T10:00:02.000Z',
        },
      ],
      startedAt: STARTED_AT,
      originNav: 'app-prototype',
      targetNav: 'app-prototype',
      unreadCompletion: false,
      ...overrides,
    };
  }
  it('maps a running task to a running run whose last step carries the stream tail', () => {
    const run = agentRunFromPipelineTask(makeTask());

    expect(run.status).toBe('RUNNING');
    expect(run.steps.map((s) => s.status)).toEqual(['DONE', 'RUNNING']);
    expect(run.steps[1]?.detail).toBe('<main>');
    expect(run.result).toBeUndefined();
    expect(run.failure).toBeUndefined();
  });

  it('maps a completed task to a succeeded run with its artifact label', () => {
    const run = agentRunFromPipelineTask(
      makeTask({
        status: 'COMPLETED',
        completedAt: STARTED_AT + 5_000,
        messageZh: '原型已生成',
        messageEn: 'Prototype generated',
        resultLabelZh: '查看原型',
        resultLabelEn: 'View prototype',
      }),
    );

    expect(run.status).toBe('SUCCEEDED');
    expect(run.steps.every((s) => s.status === 'DONE')).toBe(true);
    expect(run.steps.some((s) => s.detail)).toBe(false);
    expect(run.result).toEqual({
      summary: { zh: '原型已生成', en: 'Prototype generated' },
      artifactLabel: { zh: '查看原型', en: 'View prototype' },
    });
  });

  it('does not repeat the closing message of a completed task as a step', () => {
    const task = makeTask({ status: 'COMPLETED', messageZh: '生成 HTML', messageEn: 'Generate HTML' });
    const run = agentRunFromPipelineTask(task);

    expect(run.steps.map((s) => s.id)).toEqual(['l1']);
    expect(run.result?.summary).toEqual({ zh: '生成 HTML', en: 'Generate HTML' });
    // Tasks that name no artifact still link to their result.
    expect(run.result?.artifactLabel).toEqual({ zh: '查看结果', en: 'View result' });
  });

  it('maps an errored task to a failed run that keeps the real diagnostic', () => {
    const run = agentRunFromPipelineTask(
      makeTask({
        status: 'ERROR',
        errorDiagnostic: { code: 'GATEWAY_TIMEOUT', message: 'timed out', remediation: 'retry' },
      }),
    );

    expect(run.status).toBe('FAILED');
    expect(run.steps.map((s) => s.status)).toEqual(['DONE', 'FAILED']);
    expect(run.failure).toEqual({
      code: 'GATEWAY_TIMEOUT',
      message: 'timed out',
      remediation: 'retry',
    });
    expect(run.result).toBeUndefined();
  });

  it('maps a cancelled task to a cancelled run with no result or failure', () => {
    const run = agentRunFromPipelineTask(makeTask({ status: 'CANCELLED' }));

    expect(run.status).toBe('CANCELLED');
    expect(run.steps.map((s) => s.status)).toEqual(['DONE', 'STOPPED']);
    expect(run.result).toBeUndefined();
    expect(run.failure).toBeUndefined();
  });
});

describe('Agent Panel preferences', () => {
  it('formats elapsed time and rolls over to hours', () => {
    expect(formatRunElapsed(0, 84_000)).toBe('01:24');
    expect(formatRunElapsed(0, 3_725_000)).toBe('1:02:05');
    expect(formatRunElapsed(5_000, 0)).toBe('00:00');
  });

  it('clamps the width to its limits', () => {
    expect(clampAgentPanelWidth(10)).toBe(AGENT_PANEL_MIN_WIDTH);
    expect(clampAgentPanelWidth(5_000)).toBe(AGENT_PANEL_MAX_WIDTH);
    expect(clampAgentPanelWidth(Number.NaN)).toBe(AGENT_PANEL_DEFAULT_WIDTH);
    expect(clampAgentPanelWidth(412.6)).toBe(413);
  });

  it('restores stored state and falls back on missing or corrupt data', () => {
    expect(parseAgentPanelPrefs('{"open":false,"width":500}')).toEqual({
      open: false,
      width: 500,
    });
    expect(parseAgentPanelPrefs('{"open":false,"width":9999}')).toEqual({
      open: false,
      width: AGENT_PANEL_MAX_WIDTH,
    });
    expect(parseAgentPanelPrefs(null)).toEqual({ open: true, width: AGENT_PANEL_DEFAULT_WIDTH });
    expect(parseAgentPanelPrefs('not json')).toEqual({
      open: true,
      width: AGENT_PANEL_DEFAULT_WIDTH,
    });
  });
});
