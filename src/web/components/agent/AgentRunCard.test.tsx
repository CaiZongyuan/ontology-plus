import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceStore,
  type AgentSession,
} from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { useWorkbenchStore, type BackgroundPipelineTask } from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import { AgentPanel, shouldSubmitComposerKey } from './AgentPanel.js';
import { AgentRunCard, type AgentRunCardProps } from './AgentRunCard.js';
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  clampAgentPanelWidth,
  parseAgentPanelPrefs,
} from './agentPanelStore.js';
import {
  agentRunFromPipelineTask,
  agentRunsFromSession,
  formatRunElapsed,
  type AgentRunView,
  type SessionLiveDraft,
} from './agentRun.js';
import { ShellAgentPanel, agentPanelSurfaceFor } from './ShellAgentPanel.js';

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
  const cleanPatch = {
    data: null,
    backgroundTasks: [],
    liveSessionDrafts: {},
    sessionQueues: {},
    activePrototypeIdByProject: {},
  };
  useWorkbenchStore.setState(cleanPatch);
  Object.assign(useWorkbenchStore.getInitialState(), cleanPatch);
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

describe('agentRunsFromSession & targetAnchor rendering (#24)', () => {
  function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
    return {
      id: 'sess-proto-1',
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      targetId: 'proto-1',
      title: '原型共创',
      status: 'IDLE',
      pinned: false,
      messages: [
        {
          id: 'u-1',
          role: 'user',
          content: '将新建按钮文案改为「立即创建合同」',
          timestamp: '2026-11-12T10:00:00.000Z',
        },
        {
          id: 'a-1',
          role: 'assistant',
          content: '已局部更新新建按钮文案并保留原有锚点。',
          thinking: '先读取 EL-ACT-NEW，再局部替换按钮。',
          modelUsed: 'auto/glm-5.3-flash',
          toolCalls: [
            {
              id: 'tc-1',
              toolName: 'read_prototype_anchor',
              arguments: { elementId: 'EL-ACT-NEW' },
              isError: false,
              output: '<button data-element-id="EL-ACT-NEW">新建</button>',
              targetAnchor: {
                screenId: 'SCR-CONTRACT-LIST',
                elementId: 'EL-ACT-NEW',
                label: '新建合同按钮',
              },
            },
            {
              id: 'tc-2',
              toolName: 'edit_prototype_anchor',
              arguments: {
                elementId: 'EL-ACT-NEW',
                operation: 'replace_element',
              },
              isError: false,
              output: 'Updated EL-ACT-NEW in SCR-CONTRACT-LIST',
              targetAnchor: {
                screenId: 'SCR-CONTRACT-LIST',
                elementId: 'EL-ACT-NEW',
                label: '新建合同按钮',
              },
            },
          ],
          artifacts: [
            {
              kind: 'PROTOTYPE_REVISION',
              prototypeId: 'proto-1',
              revisionId: 'rev-2',
              revisionNumber: 2,
              modifiedAnchors: [
                {
                  screenId: 'SCR-CONTRACT-LIST',
                  elementId: 'EL-ACT-NEW',
                  label: '新建合同按钮',
                },
              ],
            },
          ],
          timestamp: '2026-11-12T10:00:05.000Z',
        },
      ],
      createdAt: '2026-11-12T10:00:00.000Z',
      updatedAt: '2026-11-12T10:00:05.000Z',
      ...overrides,
    };
  }

  it('adapts completed, failed, cancelled, and live streaming session turns with targetAnchor badges', () => {
    const baseSession = makeSession({
      messages: [
        ...makeSession().messages,
        {
          id: 'u-2',
          role: 'user',
          content: '调整审批筛选栏',
          timestamp: '2026-11-12T10:01:00.000Z',
        },
        {
          id: 'a-2',
          role: 'assistant',
          content: '',
          cancelled: true,
          timestamp: '2026-11-12T10:01:03.000Z',
        },
        {
          id: 'u-3',
          role: 'user',
          content: '重做合同状态列',
          timestamp: '2026-11-12T10:02:00.000Z',
        },
        {
          id: 'a-3',
          role: 'assistant',
          content: '',
          errorDiagnostic: {
            code: 'LLM_EMPTY_RESPONSE',
            message: 'Model returned empty response without tool edits',
            remediation: 'Check LLM Center gateway configuration.',
          },
          timestamp: '2026-11-12T10:02:04.000Z',
        },
        {
          id: 'u-4',
          role: 'user',
          content: '给列表顶部补一个按部门筛选下拉框',
          timestamp: '2026-11-12T10:03:00.000Z',
        },
      ],
      status: 'RUNNING',
    });

    const liveDraft: SessionLiveDraft = {
      runId: 'live-4',
      sessionId: baseSession.id,
      userPrompt: '给列表顶部补一个按部门筛选下拉框',
      startedAt: Date.parse('2026-11-12T10:03:00.000Z'),
      liveStatus: { zh: '正在修改锚点 SCR-CONTRACT-LIST…', en: 'Editing anchor SCR-CONTRACT-LIST…' },
      thinking: '准备在 SCR-CONTRACT-LIST 内插入带锚点的 select。',
      text: '',
      steps: [
        {
          id: 'live-tc-1',
          label: { zh: '局部修改锚点片段', en: 'Edit anchor fragment' },
          status: 'RUNNING',
          targetAnchor: { screenId: 'SCR-CONTRACT-LIST', elementId: 'EL-FILTER-DEPT' },
        },
      ],
    };

    const runs = agentRunsFromSession(baseSession, liveDraft);
    expect(runs).toHaveLength(4);

    // 1) Succeeded run with targetAnchor steps & PROTOTYPE_REVISION artifact
    expect(runs[0]?.status).toBe('SUCCEEDED');
    expect(runs[0]?.steps).toHaveLength(2);
    expect(runs[0]?.steps[0]?.targetAnchor).toEqual({
      screenId: 'SCR-CONTRACT-LIST',
      elementId: 'EL-ACT-NEW',
      label: '新建合同按钮',
    });
    expect(runs[0]?.prototypeRevision).toEqual({
      prototypeId: 'proto-1',
      revisionId: 'rev-2',
      revisionNumber: 2,
    });
    expect(runs[0]?.result?.artifactLabel).toEqual({
      zh: '查看修订 v2',
      en: 'Open revision v2',
    });

    // 2) Cancelled run
    expect(runs[1]?.status).toBe('CANCELLED');
    expect(runs[1]?.retryPrompt).toBe('调整审批筛选栏');

    // 3) Failed run with real errorDiagnostic (never fake success)
    expect(runs[2]?.status).toBe('FAILED');
    expect(runs[2]?.failure).toEqual({
      code: 'LLM_EMPTY_RESPONSE',
      message: 'Model returned empty response without tool edits',
      remediation: 'Check LLM Center gateway configuration.',
    });
    expect(runs[2]?.result).toBeUndefined();

    // 4) Live running turn merged with trailing unanswered user message (not duplicated)
    expect(runs[3]?.status).toBe('RUNNING');
    expect(runs[3]?.steps[0]?.targetAnchor?.elementId).toBe('EL-FILTER-DEPT');

    // Render card with anchored steps and verify badge markup
    const cardHtml = renderCard({ run: runs[0]! });
    expect(cardHtml).toContain('data-testid="agent-run-step-anchor"');
    expect(cardHtml).toContain('SCR-CONTRACT-LIST · EL-ACT-NEW');
    expect(cardHtml).toContain('查看修订 v2');
  });

  it('renders interactive composer, header slot, queued prompts strip, and Enter key behavior in AgentPanel', () => {
    expect(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(
      true,
    );
    expect(shouldSubmitComposerKey({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(
      false,
    );
    expect(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(
      false,
    );

    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <AgentPanel
          title={{ zh: '原型共创', en: 'Prototype Co-Design' }}
          runs={[makeRun({ id: 'active-1', status: 'RUNNING' })]}
          width={AGENT_PANEL_DEFAULT_WIDTH}
          onClose={noop}
          onResize={noop}
          onSubmitPrompt={noop}
          composerValue="把表格行距调紧凑一点"
          composerHeaderSlot={<div data-testid="mock-selection-chip">EL-TBL-CONTRACTS</div>}
          queuedPrompts={[
            { id: 'q-1', label: '增加导出 CSV 按钮' },
            { id: 'q-2', label: '高亮逾期状态标签' },
          ]}
          onRemoveQueuedPrompt={noop}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('data-testid="agent-panel-composer"');
    expect(html).toContain('data-testid="agent-panel-composer-input"');
    expect(html).toContain('data-testid="agent-panel-send-btn"');
    expect(html).toContain('把表格行距调紧凑一点');
    expect(html).toContain('data-testid="mock-selection-chip"');
    expect(html).toContain('data-testid="agent-panel-queue"');
    expect(html).toContain('排队中 (2)');
    expect(html).toContain('增加导出 CSV 按钮');
  });

  it('streams PROTOTYPE_CO_DESIGN runs through useWorkbenchStore & ShellAgentPanel, queues concurrent prompts, and supports cancel & retry', async () => {
    vi.stubEnv('ONTO_MOCK_LLM', '1');
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost${urlStr}`;
      return app.request(fullUrl, init);
    });

    const createdProto = store.createPrototype('proj-contract', {
      name: '合同工作台原型.html',
      htmlContent: [
        '<main data-prototype-root="true">',
        '  <section data-screen-id="SCR-CONTRACT-LIST" data-screen-name="合同台账" data-screen-type="LIST">',
        '    <button data-element-id="EL-ACT-NEW" data-element-type="BUTTON" data-element-label="新建合同">新建合同</button>',
        '  </section>',
        '</main>',
      ].join('\n'),
    });

    await useWorkbenchStore.getState().bootstrap('proj-contract');
    useWorkbenchStore.getState().setActivePrototypeId('proj-contract', createdProto.prototype.id);

    const { sessionId } = await useWorkbenchStore.getState().startPrototypeRefinementRun({
      projectId: 'proj-contract',
      prototypeId: createdProto.prototype.id,
      instruction: '将新建按钮改为「立即新建合同」',
      selections: [
        {
          kind: 'ELEMENT',
          cssSelector: '[data-element-id="EL-ACT-NEW"]',
          note: '按钮文案更明确',
          screenId: 'SCR-CONTRACT-LIST',
          elementId: 'EL-ACT-NEW',
          label: '新建合同',
        },
      ],
    });

    // Wait for stream completion
    await vi.waitFor(() => {
      expect(useWorkbenchStore.getState().liveSessionDrafts[sessionId]).toBeUndefined();
      const s = useWorkbenchStore
        .getState()
        .data?.agentSessions.find((item) => item.id === sessionId);
      expect(s?.messages.filter((m) => m.role === 'assistant').length).toBe(1);
    });

    // Prototype revision v2 was created and synced into client store
    const updatedProto = useWorkbenchStore
      .getState()
      .data?.prototypes.find((p) => p.id === createdProto.prototype.id);
    expect(updatedProto?.revisions.length).toBe(2);

    // ShellAgentPanel renders the completed PROTOTYPE_CO_DESIGN run card with targetAnchor badges & composer
    const surface = agentPanelSurfaceFor('app-prototype')!;
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
    const shellHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ShellAgentPanel surface={surface} overlay={false} onClose={noop} onNavigate={noop} />
      </PreferencesProvider>,
    );
    expect(shellHtml).toContain('data-testid="agent-run-card"');
    expect(shellHtml).toContain('data-run-status="SUCCEEDED"');
    expect(shellHtml).toContain('data-testid="agent-run-step-anchor"');
    expect(shellHtml).toContain('EL-ACT-NEW');
    expect(shellHtml).toContain('查看修订 v2');
    expect(shellHtml).toContain('data-testid="agent-panel-composer-input"');

    // Queueing while a run is active: simulate an active live draft, enqueue a prompt, and verify queue state
    useWorkbenchStore.setState((prev) => ({
      liveSessionDrafts: {
        ...prev.liveSessionDrafts,
        [sessionId]: {
          runId: 'sim-active',
          sessionId,
          userPrompt: '正在执行的精修任务',
          startedAt: Date.now(),
          liveStatus: { zh: '正在执行…', en: 'Running…' },
          thinking: '',
          text: '',
          steps: [],
        },
      },
    }));

    await useWorkbenchStore.getState().startSessionAgentRun({
      sessionId,
      prompt: '排队中的第二条精修指令 [ anchor: EL-ACT-NEW ]',
    });
    expect(useWorkbenchStore.getState().sessionQueues[sessionId]).toHaveLength(1);

    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
    const queuedShellHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ShellAgentPanel surface={surface} overlay={false} onClose={noop} onNavigate={noop} />
      </PreferencesProvider>,
    );
    expect(queuedShellHtml).toContain('data-testid="agent-panel-queue"');
    expect(queuedShellHtml).toContain('排队中 (1)');

    // Cancel clears the queue and live draft
    await useWorkbenchStore.getState().cancelSessionAgentRun(sessionId);
    expect(useWorkbenchStore.getState().sessionQueues[sessionId] ?? []).toHaveLength(0);
    expect(useWorkbenchStore.getState().liveSessionDrafts[sessionId]).toBeUndefined();

    // Retry re-dispatches the prompt and completes cleanly
    await useWorkbenchStore.getState().retrySessionAgentRun(sessionId);
    const retriedSess = useWorkbenchStore
      .getState()
      .data?.agentSessions.find((item) => item.id === sessionId);
    expect(retriedSess?.messages.filter((m) => m.role === 'assistant').length).toBe(2);
  });

  it('executes SRS synthesis, 11-model ontology synthesis, copilot, tech arch, metric insight, and scenario attribution as ShellAgentPanel runs', async () => {
    vi.stubEnv('ONTO_MOCK_LLM', '1');
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const app = createApiApp(store);
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost${urlStr}`;
      return app.request(fullUrl, init);
    });

    await useWorkbenchStore.getState().bootstrap('proj-contract');

    // Verify all 6 surfaces are registered in AGENT_PANEL_SURFACES
    expect(agentPanelSurfaceFor('app-req-explore')?.sessionKind).toBe('REQUIREMENT');
    expect(agentPanelSurfaceFor('app-req-docs')?.sessionKind).toBe('REQUIREMENT');
    expect(agentPanelSurfaceFor('app-ontology')?.sessionKind).toBe('COPILOT');
    expect(agentPanelSurfaceFor('app-four-layer-assets')?.sessionKind).toBe('CODING');
    expect(agentPanelSurfaceFor('app-assembly-dev')?.sessionKind).toBe('CODING');
    expect(agentPanelSurfaceFor('data-metrics-reports')?.sessionKind).toBe('REASONING');

    // 1. SRS Synthesis Run in REQUIREMENT session
    const docsBefore = useWorkbenchStore.getState().data?.requirementDocs.length ?? 0;
    await useWorkbenchStore.getState().startSrsSynthesisRun({
      requirementSessionId: 'req-sess-contract-01',
    });
    expect(useWorkbenchStore.getState().data?.requirementDocs.length).toBeGreaterThanOrEqual(
      docsBefore,
    );

    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
    const reqPanelHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ShellAgentPanel
          surface={agentPanelSurfaceFor('app-req-explore')!}
          overlay={false}
          onClose={noop}
          onNavigate={noop}
        />
      </PreferencesProvider>,
    );
    expect(reqPanelHtml).toContain('合成 9 章节需求规格书');
    expect(reqPanelHtml).toContain('打开需求规格书');
    expect(reqPanelHtml).toContain('data-run-status="SUCCEEDED"');

    // 2. 11-Model Ontology Synthesis + Copilot Rule Run in COPILOT session
    await useWorkbenchStore.getState().startOntologySynthesisRun();
    await useWorkbenchStore
      .getState()
      .startOntologyCopilotRun('请新增一条合同履约里程碑逾期冻结规则', { activeModel: 'M3' });

    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
    const copilotPanelHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ShellAgentPanel
          surface={agentPanelSurfaceFor('app-ontology')!}
          overlay={false}
          onClose={noop}
          onNavigate={noop}
        />
      </PreferencesProvider>,
    );
    expect(copilotPanelHtml).toContain('合成 11 元模型本体');
    expect(copilotPanelHtml).toContain('查看 11 元模型 (11/11)');
    expect(copilotPanelHtml).toContain('查看 M3 模型变更');

    // 3. Tech Arch Generation Run in CODING session
    const assetsBefore = useWorkbenchStore.getState().data?.fourLayerAssets.length ?? 0;
    await useWorkbenchStore.getState().startTechArchGenerationRun({
      name: '合同中心云原生技术架构规范',
      stackTags: ['TypeScript', 'Hono', 'D1'],
    });
    expect(useWorkbenchStore.getState().data?.fourLayerAssets.length).toBe(assetsBefore + 1);

    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
    const codingPanelHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ShellAgentPanel
          surface={agentPanelSurfaceFor('app-four-layer-assets')!}
          overlay={false}
          onClose={noop}
          onNavigate={noop}
        />
      </PreferencesProvider>,
    );
    expect(codingPanelHtml).toContain('生成技术架构：合同中心云原生技术架构规范');
    expect(codingPanelHtml).toContain('查看技术架构');

    // 4. Metric Insight + Scenario Attribution Runs in REASONING session
    const reportsBefore = useWorkbenchStore.getState().data?.analyticsReports.length ?? 0;
    await useWorkbenchStore.getState().startMetricInsightRun('MET-02');
    await useWorkbenchStore
      .getState()
      .startScenarioAttributionRun('ascn-01', { saveAsReport: true });
    expect(useWorkbenchStore.getState().data?.analyticsReports.length).toBe(reportsBefore + 1);

    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
    const reasoningPanelHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ShellAgentPanel
          surface={agentPanelSurfaceFor('data-metrics-reports')!}
          overlay={false}
          onClose={noop}
          onNavigate={noop}
        />
      </PreferencesProvider>,
    );
    expect(reasoningPanelHtml).toContain('AI 指标洞察：');
    expect(reasoningPanelHtml).toContain('查看指标洞察');
    expect(reasoningPanelHtml).toContain('AI 场景归因：');
    expect(reasoningPanelHtml).toContain('打开归因分析报告');
  });
});
