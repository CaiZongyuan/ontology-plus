import React from 'react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../../../packages/business-vocabulary/index.js';
import {
  createWorkspaceStore,
  type AgentSession,
} from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { useWorkbenchStore } from '../../api.js';
import { NAV_ITEMS, PreferencesProvider } from '../../i18n.js';
import { resetLocalImageStoreForTests } from '../../lib/localImageStore.js';
import { AgentPanel, shouldSubmitComposerKey } from './AgentPanel.js';
import { AgentRunCard, type AgentRunCardProps } from './AgentRunCard.js';
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  AGENT_PANEL_WIDE_CSS_WIDTH,
  clampAgentPanelWidth,
  parseAgentPanelPrefs,
  useAgentPanelStore,
} from './agentPanelStore.js';
import {
  PLATFORM_UNAVAILABLE_COPY,
  agentRunsFromSession,
  classifyRunPlatformProblem,
  formatRunElapsed,
  formatRunFailurePresentation,
  formatRunToolProgress,
  type AgentRunView,
  type SessionLiveDraft,
} from './agentRun.js';
import {
  ShellAgentPanel,
  agentPanelSurfaceFor,
  resolveActiveWorkspaceRuns,
} from './ShellAgentPanel.js';

const STARTED_AT = Date.UTC(2026, 10, 12, 10, 0, 0);
const noop = () => {};
const architectureDirectories: string[] = [];

function makeRun(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    id: 'run-1',
    title: { zh: '生成界面原型', en: 'Generate prototype' },
    status: 'RUNNING',
    liveStatus: { zh: '正在生成原型页面', en: 'Generating prototype page' },
    startedAt: STARTED_AT,
    steps: [
      {
        id: 's1',
        label: { zh: '保存需求文档', en: 'Save requirements document' },
        status: 'DONE',
        toolName: 'save_synthesized_srs_doc',
        at: '2026-11-12T10:00:01.000Z',
      },
      {
        id: 's2',
        label: { zh: '正在生成原型页面', en: 'Generating prototype page' },
        status: 'RUNNING',
        toolName: 'rewrite_prototype_page',
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
  for (const directory of architectureDirectories.splice(0)) {
    if (path.dirname(directory) !== os.tmpdir()) throw new Error('Unexpected test catalog directory');
    fs.rmSync(directory, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
  const cleanPatch = {
    data: null,
    liveSessionDrafts: {},
    sessionQueues: {},
    activePrototypeIdByProject: {},
  };
  useWorkbenchStore.setState(cleanPatch);
  Object.assign(useWorkbenchStore.getInitialState(), cleanPatch);
  const cleanPanel = {
    open: true,
    overlayOpen: false,
    width: AGENT_PANEL_DEFAULT_WIDTH,
    wideMode: false,
    hoveredAnchor: null,
  };
  useAgentPanelStore.setState(cleanPanel);
  Object.assign(useAgentPanelStore.getInitialState(), cleanPanel);
});

describe('AgentRunCard', () => {
  it('shows live status, elapsed time, cancel and steps while running', () => {
    const html = renderCard({ run: makeRun() });

    expect(html).toContain('data-run-status="RUNNING"');
    expect(html).toContain('data-testid="agent-run-live"');
    expect(html).toContain('正在生成原型页面');
    expect(html).toContain('01:24');
    expect(html).toContain('data-testid="agent-run-cancel-btn"');
    expect(html).toContain('保存需求文档');
    expect(html).toContain('data-step-status="RUNNING"');
    expect(html).not.toContain('agent-run-result');
    expect(html).not.toContain('agent-run-failure');
    expect(html).not.toContain('agent-run-retry-btn');
    expect(checkBusinessViewMarkup(html)).toEqual([]);
  });

  it('keeps thinking and step detail collapsed inside "查看细节" by default', () => {
    const html = renderCard({ run: makeRun() });

    expect(html).toContain('data-testid="agent-run-details"');
    expect(html).toContain('查看细节');
    expect(html).toContain('data-testid="agent-run-thinking"');
    expect(html).toContain('先确定屏幕清单，再逐屏输出。');
    expect(html).toContain('SCR-1');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(checkBusinessViewMarkup(html)).toEqual([]);
  });

  it('shows the result summary and a link to the artifact when it succeeded', () => {
    const html = renderCard({
      run: makeRun({
        status: 'SUCCEEDED',
        completedAt: STARTED_AT + 125_000,
        result: {
          summary: { zh: '已生成 6 个页面', en: 'Generated 6 screens' },
          artifactLabel: { zh: '查看原型', en: 'View prototype' },
        },
      }),
    });

    expect(html).toContain('data-run-status="SUCCEEDED"');
    expect(html).toContain('data-testid="agent-run-result"');
    expect(html).toContain('已生成 6 个页面');
    expect(html).toContain('data-testid="agent-run-open-artifact-btn"');
    expect(html).toContain('查看原型');
    expect(html).toContain('02:05');
    expect(html).not.toContain('agent-run-cancel-btn');
    expect(html).not.toContain('agent-run-live');
    expect(checkBusinessViewMarkup(html)).toEqual([]);
  });

  it('reports a platform timeout failure with unified copy, retry, platform settings link, and diagnostics tucked in details', () => {
    const html = renderCard({
      run: makeRun({
        status: 'FAILED',
        completedAt: STARTED_AT + 9_000,
        failure: {
          code: 'LLM_TIMEOUT',
          providerName: 'Primary Gateway',
          baseUrl: 'http://127.0.0.1:3425/v1',
          message: 'LLM gateway timed out after 60s',
          remediation: '检查网关地址或更换模型',
        },
      }),
    });

    expect(html).toContain('data-run-status="FAILED"');
    expect(html).toContain('role="alert"');
    expect(html).toContain(PLATFORM_UNAVAILABLE_COPY.zh);
    expect(html).toContain('data-testid="agent-run-open-platform-settings-btn"');
    expect(html).toContain('前往平台设置');
    expect(html).toContain('data-testid="agent-run-retry-btn"');
    expect(html).toContain('data-testid="agent-run-diagnostic-details"');
    expect(html).toContain('LLM gateway timed out after 60s');
    expect(html).toContain('检查网关地址或更换模型');
    expect(html).not.toContain('agent-run-result');
    expect(html).not.toContain('agent-run-cancel-btn');
    expect(checkBusinessViewMarkup(html)).toEqual([]);
  });

  it('says so when a failed run carries no reason instead of looking successful', () => {
    const html = renderCard({ run: makeRun({ status: 'FAILED', completedAt: STARTED_AT }) });

    expect(html).toContain('运行失败，未返回原因。');
    expect(html).not.toContain('agent-run-result');
    expect(checkBusinessViewMarkup(html)).toEqual([]);
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
    expect(checkBusinessViewMarkup(html)).toEqual([]);
  });

  it('renders in English when the locale is en-US', () => {
    useLocale('en-US');
    const html = renderCard({ run: makeRun() });

    expect(html).toContain('Generate prototype');
    expect(html).toContain('Generating prototype page');
    expect(html).toContain('Cancel');
    expect(html).toContain('View details');
    expect(html).toContain('Thinking');
    expect(html).not.toContain('生成界面原型');
    expect(checkBusinessViewMarkup(html)).toEqual([]);
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

describe('Agent Panel preferences & Wide Mode (#35)', () => {
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

  it('restores stored state including wideMode and falls back on missing or corrupt data', () => {
    expect(parseAgentPanelPrefs('{"open":false,"width":500}')).toEqual({
      open: false,
      width: 500,
      wideMode: false,
    });
    expect(parseAgentPanelPrefs('{"open":true,"width":420,"wideMode":true}')).toEqual({
      open: true,
      width: 420,
      wideMode: true,
    });
    expect(parseAgentPanelPrefs('{"open":false,"width":9999}')).toEqual({
      open: false,
      width: AGENT_PANEL_MAX_WIDTH,
      wideMode: false,
    });
    expect(parseAgentPanelPrefs(null)).toEqual({
      open: true,
      width: AGENT_PANEL_DEFAULT_WIDTH,
      wideMode: false,
    });
    expect(parseAgentPanelPrefs('not json')).toEqual({
      open: true,
      width: AGENT_PANEL_DEFAULT_WIDTH,
      wideMode: false,
    });
  });

  it('toggles Wide Mode in useAgentPanelStore and renders agent-panel-wide-toggle & data-wide-mode in AgentPanel', () => {
    expect(useAgentPanelStore.getState().wideMode).toBe(false);
    useAgentPanelStore.getState().toggleWideMode();
    expect(useAgentPanelStore.getState().wideMode).toBe(true);
    expect(useAgentPanelStore.getState().open).toBe(true);

    // Drag-resizing explicitly exits Wide Mode
    useAgentPanelStore.getState().setWidth(440);
    expect(useAgentPanelStore.getState().wideMode).toBe(false);
    expect(useAgentPanelStore.getState().width).toBe(440);

    const wideHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <AgentPanel
          title={{ zh: '原型共创', en: 'Prototype Co-Design' }}
          runs={[]}
          width={AGENT_PANEL_DEFAULT_WIDTH}
          wideMode
          onToggleWideMode={noop}
          isForkSession
          sessions={[
            { id: 's-1', title: '原型共创 #1' },
            { id: 's-2', title: '原型共创 #2 [分支]', isFork: true },
          ]}
          activeSessionId="s-2"
          onSelectSession={noop}
          onClose={noop}
          onResize={noop}
        />
      </PreferencesProvider>,
    );
    expect(AGENT_PANEL_WIDE_CSS_WIDTH).toBe('clamp(400px, 38vw, 600px)');
    expect(wideHtml).toContain('data-wide-mode="true"');
    expect(wideHtml).toContain('data-testid="agent-panel-wide-toggle"');
    expect(wideHtml).not.toContain('agent-new-session-btn');
    expect(wideHtml).not.toContain('agent-panel-session-select');
    expect(wideHtml).toContain('data-testid="agent-panel-fork-badge"');
    expect(wideHtml).toContain('data-testid="assistant-history-menu-btn"');
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
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-panel-architecture-'));
    architectureDirectories.push(directory);
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false, architectureAssetsRoot: path.join(directory, 'catalog') });
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
    expect(agentPanelSurfaceFor('app-four-layer-assets')?.sessionKind).toBe('ARCHITECTURE');
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
    expect(copilotPanelHtml).toContain('生成业务模型');
    expect(copilotPanelHtml).toContain('查看业务模型');
    expect(copilotPanelHtml).toContain('查看业务规则变更');

    // 3. Tech Arch Generation Run in ARCHITECTURE session
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

  it('covers all 24 NavViewId surfaces, askUser ApprovalCard, REASONING policy write-back, session cardinality, missing local image placeholder, and EXTRACTION_JOB chip (#35)', async () => {
    await resetLocalImageStoreForTests();
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

    // Verify ALL 24 NavViewIds resolve to a valid AgentPanelSurface
    expect(NAV_ITEMS).toHaveLength(24);
    for (const navItem of NAV_ITEMS) {
      const surface = agentPanelSurfaceFor(navItem.id);
      expect(surface, `Expected AgentPanelSurface for ${navItem.id}`).not.toBeNull();
      expect(surface?.sessionKind).toBeTruthy();
      expect(surface?.title.zh.length).toBeGreaterThan(0);
      expect(surface?.title.en.length).toBeGreaterThan(0);
    }

    expect(agentPanelSurfaceFor('overview')?.sessionKind).toBe('COPILOT');
    expect(agentPanelSurfaceFor('app-req-explore')?.conversationPrimary).toBe(true);
    expect(agentPanelSurfaceFor('app-publish')?.sessionKind).toBe('CODING');
    expect(agentPanelSurfaceFor('cap-agents')?.sessionKind).toBe('CAPABILITY');
    expect(agentPanelSurfaceFor('cap-agents')?.conversationPrimary).toBe(true);
    expect(agentPanelSurfaceFor('cap-extraction')?.sessionKind).toBe('CAPABILITY');
    expect(agentPanelSurfaceFor('cap-systems')?.sessionKind).toBe('CAPABILITY');
    expect(agentPanelSurfaceFor('data-reasoning')?.sessionKind).toBe('REASONING');
    expect(agentPanelSurfaceFor('data-reasoning')?.conversationPrimary).toBe(true);
    expect(agentPanelSurfaceFor('data-writeback')?.sessionKind).toBe('REASONING');
    expect(agentPanelSurfaceFor('llm-center')?.sessionKind).toBe('COPILOT');
    expect(agentPanelSurfaceFor('system-settings')?.sessionKind).toBe('COPILOT');

    // Render data-reasoning ShellAgentPanel and verify 3-stage mode selector pills
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
    const dataReasoningHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ShellAgentPanel
          surface={agentPanelSurfaceFor('data-reasoning')!}
          overlay={false}
          defaultHistoryOpen
          onClose={noop}
          onNavigate={noop}
        />
      </PreferencesProvider>,
    );
    expect(dataReasoningHtml).toContain('data-testid="reasoning-mode-ASK_DATA"');
    expect(dataReasoningHtml).toContain('data-testid="reasoning-mode-ASK_WHY"');
    expect(dataReasoningHtml).toContain('data-testid="reasoning-mode-ASK_POLICY"');
    // Every specialised agent except Prototype Co-Design can hold several conversations in the History Menu (ADR 0009, amended).
    expect(dataReasoningHtml).toContain('data-testid="assistant-history-menu-btn"');
    expect(dataReasoningHtml).toContain('data-testid="assistant-new-session-btn"');
    const prototypePanelHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ShellAgentPanel
          surface={agentPanelSurfaceFor('app-prototype')!}
          overlay={false}
          defaultHistoryOpen
          onClose={noop}
          onNavigate={noop}
        />
      </PreferencesProvider>,
    );
    expect(prototypePanelHtml).not.toContain('assistant-new-session-btn');

    // AgentRunView preserves user message images & renders "图片已不在本机" when missing from localImageStore, plus EXTRACTION_JOB chip
    const extractionSession: AgentSession = {
      id: 'sess-cap-ext-1',
      projectId: 'proj-contract',
      agentKind: 'CAPABILITY',
      title: '能力与存量萃取助手',
      status: 'IDLE',
      messages: [
        {
          id: 'u-ext-1',
          role: 'user',
          content: '[ACTION:RUN_ONTOLOGY_EXTRACTION {"systemId":"sys-erp","title":"采购表本体萃取"}]',
          images: [
            {
              id: 'missing-device-img-01',
              name: 'legacy-schema-sketch.png',
              mimeType: 'image/png',
              source: 'local',
              role: 'user_upload',
            },
          ],
          timestamp: '2026-11-12T11:00:00.000Z',
        },
        {
          id: 'a-ext-1',
          role: 'assistant',
          content: '已完成两轮存量系统本体萃取，生成 6 项候选定义。',
          artifacts: [
            {
              kind: 'EXTRACTION_JOB',
              jobId: 'ext-job-99',
              systemName: '存量ERP系统',
              candidateCount: 6,
            },
          ],
          timestamp: '2026-11-12T11:00:04.000Z',
        },
      ],
      createdAt: '2026-11-12T11:00:00.000Z',
      updatedAt: '2026-11-12T11:00:04.000Z',
    };
    const extRuns = agentRunsFromSession(extractionSession);
    expect(extRuns).toHaveLength(1);
    expect(extRuns[0]?.images).toEqual([
      {
        id: 'missing-device-img-01',
        name: 'legacy-schema-sketch.png',
        mimeType: 'image/png',
        source: 'local',
        role: 'user_upload',
      },
    ]);
    const extCardHtml = renderCard({ run: extRuns[0]! });
    expect(extCardHtml).toContain('data-testid="agent-run-images"');
    expect(extCardHtml).toContain('图片已不在本机');
    expect(extCardHtml).toContain('legacy-schema-sketch.png');
    expect(extCardHtml).toContain('data-testid="agent-run-extraction-chip"');
    expect(extCardHtml).toContain('存量ERP系统');
    expect(extCardHtml).toContain('6');
    expect(extCardHtml).toContain('前往候选审查');

    // Render AgentRunCard with askUser prompt & REASONING_POLICY write-back button (no generic fork button)
    const interactiveCardHtml = renderCard({
      run: makeRun({
        status: 'SUCCEEDED',
        completedAt: STARTED_AT + 4_000,
        sourceAssistantMessageId: 'msg-assist-01',
        result: {
          summary: { zh: '已完成 ASK_POLICY 决策推理', en: 'Completed ASK_POLICY reasoning' },
        },
        askUser: {
          id: 'ask-01',
          question: '超额采购合同是否强制要求法务总监会签？',
          options: ['强制法务总监会签', '仅财务总监审批'],
          answered: false,
        },
        artifact: {
          kind: 'REASONING_POLICY',
          mode: 'ASK_POLICY',
          dataSummary: [],
          causalAnalysis: [],
          policyRecommendations: [
            {
              actionTitle: '对资信低于 BBB 的供应商触发 WB-01 冻结策略',
              targetObject: 'Contract',
              expectedImpact: '风险降低 40%',
              writebackInterfaceId: 'WB-01',
            },
          ],
        },
      }),
      onAnswerAskUser: noop,
      onTriggerWriteback: noop,
    });
    expect(interactiveCardHtml).not.toContain('agent-fork-msg-btn');
    expect(interactiveCardHtml).toContain('data-testid="agent-hitl-card"');
    expect(interactiveCardHtml).toContain('强制法务总监会签');
    expect(interactiveCardHtml).toContain('data-testid="trigger-policy-writeback-btn"');
    expect(interactiveCardHtml).toContain('WB-01');

    // Verify resolveActiveWorkspaceRuns maps live drafts & running sessions to exact NavViewId jump targets
    const capAgent = useWorkbenchStore.getState().data!.capabilityAgents[0]!;
    const capSession = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'CAPABILITY',
      targetId: capAgent.id,
      title: '能力对话',
    });
    useWorkbenchStore.setState((prev) => ({
      data: prev.data
        ? { ...prev.data, agentSessions: [...prev.data.agentSessions, capSession] }
        : prev.data,
      liveSessionDrafts: {
        ...prev.liveSessionDrafts,
        [capSession.id]: {
          runId: 'live-cap-1',
          sessionId: capSession.id,
          userPrompt: '查询合同台账',
          startedAt: Date.now(),
          liveStatus: { zh: '正在调用 MCP…', en: 'Calling MCP…' },
          thinking: '',
          text: '',
          steps: [],
        },
      },
    }));

    const activeTargets = resolveActiveWorkspaceRuns(
      useWorkbenchStore.getState().data,
      useWorkbenchStore.getState().liveSessionDrafts,
    );
    expect(activeTargets).toHaveLength(1);
    expect(activeTargets[0]).toMatchObject({
      sessionId: capSession.id,
      projectId: 'proj-contract',
      targetNav: 'cap-agents',
      targetId: capAgent.id,
    });
  });

  it('enforces the Concurrency Contract: strict FIFO serialization within the same session and parallel execution across different sessions (#35)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);

    const protoA = store.createPrototype('proj-contract', {
      name: '原型A.html',
      htmlContent:
        '<main data-prototype-root="true"><section data-screen-id="SCR-A" data-screen-name="A" data-screen-type="LIST"><button data-element-id="EL-A">A</button></section></main>',
    });
    const protoB = store.createPrototype('proj-contract', {
      name: '原型B.html',
      htmlContent:
        '<main data-prototype-root="true"><section data-screen-id="SCR-B" data-screen-name="B" data-screen-type="LIST"><button data-element-id="EL-B">B</button></section></main>',
    });

    const sameSession = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'REQUIREMENT',
      title: '单会话串行队列测试',
    });
    const reqParallel = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'REQUIREMENT',
      title: '并行需求会话',
    });
    const codingParallel = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'CODING',
      targetId: 'app-contract-clm',
      title: '并行研发会话',
    });
    const protoSessionA = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      targetId: protoA.prototype.id,
      title: '原型A会话',
    });
    const protoSessionB = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      targetId: protoB.prototype.id,
      title: '原型B会话',
    });

    interface GateEntry {
      sessionId: string;
      content: string;
      release: () => void;
    }
    const pendingGates: GateEntry[] = [];
    const activeBySession = new Map<string, number>();
    let maxSameSessionConcurrency = 0;
    let totalActiveStreams = 0;
    let peakCrossSessionConcurrency = 0;
    const executionOrderBySession = new Map<string, string[]>();

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const fullUrl = urlStr.startsWith('http') ? urlStr : `http://localhost${urlStr}`;
      const match = fullUrl.match(/\/api\/agent-sessions\/([^/]+)\/stream$/);
      if (!match) {
        return app.request(fullUrl, init);
      }

      const targetSessionId = decodeURIComponent(match[1]!);
      const bodyJson = init?.body
        ? (JSON.parse(String(init.body)) as { prompt?: string; content?: string })
        : {};
      const promptContent = bodyJson.prompt ?? bodyJson.content ?? '';

      const curForSess = (activeBySession.get(targetSessionId) ?? 0) + 1;
      activeBySession.set(targetSessionId, curForSess);
      if (targetSessionId === sameSession.id && curForSess > maxSameSessionConcurrency) {
        maxSameSessionConcurrency = curForSess;
      }

      totalActiveStreams += 1;
      if (totalActiveStreams > peakCrossSessionConcurrency) {
        peakCrossSessionConcurrency = totalActiveStreams;
      }

      const prevOrder = executionOrderBySession.get(targetSessionId) ?? [];
      prevOrder.push(promptContent);
      executionOrderBySession.set(targetSessionId, prevOrder);

      let releaseFn!: () => void;
      const gatePromise = new Promise<void>((resolve) => {
        releaseFn = resolve;
      });
      pendingGates.push({
        sessionId: targetSessionId,
        content: promptContent,
        release: releaseFn,
      });

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'text_delta', delta: `Ack: ${promptContent}` })}\n\n`,
            ),
          );
          await gatePromise;
          const currentSession = store.getAgentSession(targetSessionId)!;
          const updatedSession = store.saveAgentSession({
            ...currentSession,
            messages: [
              ...currentSession.messages,
              {
                id: `u-${Date.now()}-${Math.random()}`,
                role: 'user',
                content: promptContent,
                timestamp: new Date().toISOString(),
              },
              {
                id: `a-${Date.now()}-${Math.random()}`,
                role: 'assistant',
                content: `Done: ${promptContent}`,
                timestamp: new Date().toISOString(),
              },
            ],
            updatedAt: new Date().toISOString(),
          });
          activeBySession.set(
            targetSessionId,
            Math.max(0, (activeBySession.get(targetSessionId) ?? 1) - 1),
          );
          totalActiveStreams = Math.max(0, totalActiveStreams - 1);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'done', session: updatedSession })}\n\n`,
            ),
          );
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    await useWorkbenchStore.getState().bootstrap('proj-contract');

    // Part A: Same-session FIFO queueing (R1 runs immediately; R2 and R3 queue in order)
    const p1 = useWorkbenchStore.getState().startSessionAgentRun({
      sessionId: sameSession.id,
      prompt: 'R1',
    });
    await vi.waitFor(() => {
      expect(pendingGates.filter((g) => g.sessionId === sameSession.id)).toHaveLength(1);
    });

    const p2 = useWorkbenchStore.getState().startSessionAgentRun({
      sessionId: sameSession.id,
      prompt: 'R2',
    });
    const p3 = useWorkbenchStore.getState().startSessionAgentRun({
      sessionId: sameSession.id,
      prompt: 'R3',
    });

    expect(useWorkbenchStore.getState().sessionQueues[sameSession.id]?.map((q) => q.prompt)).toEqual(
      ['R2', 'R3'],
    );
    expect(maxSameSessionConcurrency).toBe(1);

    // Release R1 -> R2 starts automatically while R3 stays queued
    pendingGates.find((g) => g.sessionId === sameSession.id && g.content === 'R1')!.release();
    await vi.waitFor(() => {
      expect(pendingGates.filter((g) => g.sessionId === sameSession.id)).toHaveLength(2);
    });
    expect(useWorkbenchStore.getState().sessionQueues[sameSession.id]?.map((q) => q.prompt)).toEqual(
      ['R3'],
    );
    expect(maxSameSessionConcurrency).toBe(1);

    // Release R2 -> R3 starts automatically
    pendingGates.find((g) => g.sessionId === sameSession.id && g.content === 'R2')!.release();
    await vi.waitFor(() => {
      expect(pendingGates.filter((g) => g.sessionId === sameSession.id)).toHaveLength(3);
    });
    expect(useWorkbenchStore.getState().sessionQueues[sameSession.id] ?? []).toHaveLength(0);
    expect(maxSameSessionConcurrency).toBe(1);

    // Release R3 -> all 3 drained in strict FIFO order
    pendingGates.find((g) => g.sessionId === sameSession.id && g.content === 'R3')!.release();
    await Promise.all([p1, p2, p3]);
    expect(executionOrderBySession.get(sameSession.id)).toEqual(['R1', 'R2', 'R3']);
    expect(maxSameSessionConcurrency).toBe(1);

    // Part B: Cross-session parallel execution (REQUIREMENT + CODING simultaneously)
    peakCrossSessionConcurrency = 0;
    const parReq = useWorkbenchStore.getState().startSessionAgentRun({
      sessionId: reqParallel.id,
      prompt: 'REQ-PARALLEL',
    });
    const parCoding = useWorkbenchStore.getState().startSessionAgentRun({
      sessionId: codingParallel.id,
      prompt: 'CODING-PARALLEL',
    });

    await vi.waitFor(() => {
      expect(
        pendingGates.filter(
          (g) => g.sessionId === reqParallel.id || g.sessionId === codingParallel.id,
        ),
      ).toHaveLength(2);
    });
    expect(peakCrossSessionConcurrency).toBe(2);

    pendingGates
      .filter((g) => g.sessionId === reqParallel.id || g.sessionId === codingParallel.id)
      .forEach((g) => g.release());
    await Promise.all([parReq, parCoding]);

    // Part C: Cross-session parallel execution across two different PROTOTYPE_CO_DESIGN prototypes
    peakCrossSessionConcurrency = 0;
    const parProtoA = useWorkbenchStore.getState().startSessionAgentRun({
      sessionId: protoSessionA.id,
      prompt: 'PROTO-A-PARALLEL',
    });
    const parProtoB = useWorkbenchStore.getState().startSessionAgentRun({
      sessionId: protoSessionB.id,
      prompt: 'PROTO-B-PARALLEL',
    });

    await vi.waitFor(() => {
      expect(
        pendingGates.filter(
          (g) => g.sessionId === protoSessionA.id || g.sessionId === protoSessionB.id,
        ),
      ).toHaveLength(2);
    });
    expect(peakCrossSessionConcurrency).toBe(2);

    pendingGates
      .filter((g) => g.sessionId === protoSessionA.id || g.sessionId === protoSessionB.id)
      .forEach((g) => g.release());
    await Promise.all([parProtoA, parProtoB]);
  });
});

describe('Business-language run progress, suite target resolution & platform problem classification (#63)', () => {
  it('resolves suite business names for raw IDs and formats progressive vs completed tool labels deterministically across ontology, prototype, SRS, and delivery tools', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const contractProject = store.getProject('proj-contract')!;
    const suite = contractProject.suite;
    const firstAggregate = suite.M1!.aggregates[0]!;
    const firstBehavior = suite.M2!.behaviors[0]!;
    const firstRule = suite.M3!.rules[0]!;

    // 1. Raw IDs resolved from active project suite -> zero AGG-01 / BHV-01 / M2 leaked
    const runningAgg = formatRunToolProgress(
      'upsert_aggregate',
      { id: firstAggregate.id },
      { active: true, suite },
    );
    expect(runningAgg).toEqual({
      zh: `正在更新业务对象「${firstAggregate.alias ?? firstAggregate.name}」`,
      en: `Updating Business Object '${firstAggregate.name}'`,
    });

    const doneBhv = formatRunToolProgress(
      'upsert_behavior',
      { id: firstBehavior.id },
      { active: false, suite },
    );
    expect(doneBhv).toEqual({
      zh: `更新业务操作「${firstBehavior.alias ?? firstBehavior.name}」`,
      en: `Update Action '${firstBehavior.name}'`,
    });

    const deletedRule = formatRunToolProgress(
      'delete_element',
      { modelCode: 'M3', elementId: firstRule.id },
      { active: false, suite },
    );
    expect(deletedRule.zh).toBe(`移除业务规则「${firstRule.alias ?? firstRule.name}」`);
    expect(checkBusinessViewMarkup(deletedRule.zh, { plainText: true })).toEqual([]);
    expect(checkBusinessViewMarkup(deletedRule.en, { plainText: true })).toEqual([]);

    // 2. Prototype, SRS, and Delivery tools produce clean business language in both locales
    const protoEdit = formatRunToolProgress(
      'edit_prototype_anchor',
      { elementId: 'EL-ACT-NEW' },
      {
        active: true,
        targetAnchor: { screenId: 'SCR-CONTRACT-LIST', elementId: 'EL-ACT-NEW', label: '新建合同按钮' },
      },
    );
    expect(protoEdit).toEqual({
      zh: '正在修改原型中的「新建合同按钮」',
      en: "Updating '新建合同按钮' in prototype",
    });

    const srsSave = formatRunToolProgress(
      'save_synthesized_srs_doc',
      { title: '合同管理系统需求说明' },
      { active: false },
    );
    expect(srsSave).toEqual({
      zh: '保存需求文档「合同管理系统需求说明」',
      en: "Save requirements document '合同管理系统需求说明'",
    });

    const deliveryCompile = formatRunToolProgress('compile_dev_package', {}, { active: true });
    expect(deliveryCompile).toEqual({
      zh: '正在生成开发包',
      en: 'Generating development package',
    });

    // 3. agentRunsFromSession preserves full ADR 0007 diagnostics, token usage, and vision fallback
    const session: AgentSession = {
      id: 'sess-diag-1',
      projectId: 'proj-contract',
      agentKind: 'COPILOT',
      title: '测试会话',
      status: 'ERROR',
      tokenUsage: { inputTokens: 412, outputTokens: 188, totalTokens: 600 },
      messages: [
        {
          id: 'u-diag-1',
          role: 'user',
          content: '更新合同审批操作',
          timestamp: '2026-11-17T10:00:00.000Z',
        },
        {
          id: 'a-diag-1',
          role: 'assistant',
          content: '',
          modelUsed: 'auto/glm-5.3-flash',
          providerName: 'Primary Gateway',
          visionFallbackUsed: true,
          visionFallbackNotice: '当前模型看不了图，将只使用文字设计说明',
          toolCalls: [
            {
              id: 'tc-bhv-1',
              toolName: 'upsert_behavior',
              arguments: { id: firstBehavior.id },
              output: 'OK',
            },
          ],
          errorDiagnostic: {
            code: 'LLM_GATEWAY_ERROR',
            providerName: 'Primary Gateway',
            baseUrl: 'http://127.0.0.1:3425/v1',
            message: 'HTTP 502 Bad Gateway from upstream provider',
            remediation: 'Check LLM Center gateway configuration.',
          },
          timestamp: '2026-11-17T10:00:04.000Z',
        },
      ],
      createdAt: '2026-11-17T10:00:00.000Z',
      updatedAt: '2026-11-17T10:00:04.000Z',
    };

    const [adapted] = agentRunsFromSession(session, undefined, { suite });
    expect(adapted?.steps[0]?.label).toEqual({
      zh: `更新业务操作「${firstBehavior.alias ?? firstBehavior.name}」`,
      en: `Update Action '${firstBehavior.name}'`,
    });
    expect(adapted?.usage).toEqual({ inputTokens: 412, outputTokens: 188, totalTokens: 600 });
    expect(adapted?.visionFallback).toEqual({
      used: true,
      notice: '当前模型看不了图，将只使用文字设计说明',
      providerName: 'Primary Gateway',
    });
    expect(adapted?.failure).toEqual({
      code: 'LLM_GATEWAY_ERROR',
      providerName: 'Primary Gateway',
      baseUrl: 'http://127.0.0.1:3425/v1',
      message: 'HTTP 502 Bad Gateway from upstream provider',
      remediation: 'Check LLM Center gateway configuration.',
    });

    // 4. Platform problem classification covers unconfigured, unreachable/HTTP, timeout, vision-unsupported vs non-platform
    expect(
      classifyRunPlatformProblem({
        code: 'LLM_NOT_CONFIGURED',
        message: 'No enabled LLM gateway provider is configured.',
      }),
    ).toBe('UNCONFIGURED');
    expect(
      classifyRunPlatformProblem({
        code: 'LLM_GATEWAY_ERROR',
        statusCode: 502,
        message: 'Connection refused',
      }),
    ).toBe('UNREACHABLE');
    expect(
      classifyRunPlatformProblem({
        code: 'LLM_TIMEOUT',
        message: 'Stream idle timeout after 60s',
      }),
    ).toBe('TIMEOUT');
    expect(
      classifyRunPlatformProblem({
        code: 'VISION_UNSUPPORTED',
        message: 'Active model does not support image input',
      }),
    ).toBe('VISION_UNSUPPORTED');
    expect(
      classifyRunPlatformProblem({
        code: 'LLM_EMPTY_RESPONSE',
        message: 'Model returned empty response without tool edits',
      }),
    ).toBeNull();

    const platformPres = formatRunFailurePresentation({
      code: 'LLM_NOT_CONFIGURED',
      message: 'No enabled LLM gateway provider is configured.',
    });
    expect(platformPres.isPlatformProblem).toBe(true);
    expect(platformPres.summary.zh).toContain(PLATFORM_UNAVAILABLE_COPY.zh);
    expect(platformPres.summary.en).toContain(PLATFORM_UNAVAILABLE_COPY.en);
  });

  it('renders deterministic Business View progress lines, tucks tool args/outputs, thinking, char counts & token usage inside closed "查看细节", supports changeSummarySlot, and passes checkBusinessViewMarkup in zh-CN and en-US', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const suite = store.getProject('proj-contract')!.suite;
    const agg = suite.M1!.aggregates[0]!;
    const bhv = suite.M2!.behaviors[0]!;

    const richSession: AgentSession = {
      id: 'sess-bview-1',
      projectId: 'proj-contract',
      agentKind: 'COPILOT',
      title: '合同审批讨论',
      status: 'IDLE',
      tokenUsage: { inputTokens: 820, outputTokens: 340, totalTokens: 1160 },
      messages: [
        {
          id: 'u-bv-1',
          role: 'user',
          content: '请补充超额合同提交审批与归档校验',
          timestamp: '2026-11-17T10:00:00.000Z',
        },
        {
          id: 'a-bv-1',
          role: 'assistant',
          content: '已补充超额合同的审批流转与归档校验规则。',
          thinking: 'Inspect M1 AGG-01 & M2 BHV-01, then apply YAML AST mutation and SQL check.',
          modelUsed: 'auto/glm-5.3-flash',
          providerName: 'Primary Gateway',
          toolCalls: [
            {
              id: 'tc-1',
              toolName: 'inspect_ontology_model',
              arguments: { modelCode: 'M1' },
              output: '{"aggregates":["AGG-01"]}',
            },
            {
              id: 'tc-2',
              toolName: 'upsert_aggregate',
              arguments: { id: agg.id },
              output: 'Updated M1 AGG-01 in suite.yaml',
            },
            {
              id: 'tc-3',
              toolName: 'upsert_behavior',
              arguments: { id: bhv.id },
              output: 'Updated M2 BHV-01',
            },
            {
              id: 'tc-4',
              toolName: 'edit_prototype_anchor',
              arguments: { elementId: 'EL-ACT-SUBMIT' },
              output: '<button data-element-id="EL-ACT-SUBMIT">提交审批</button>',
              targetAnchor: {
                screenId: 'SCR-CONTRACT-LIST',
                elementId: 'EL-ACT-SUBMIT',
                label: '提交审批按钮',
              },
            },
            {
              id: 'tc-5',
              toolName: 'save_synthesized_srs_doc',
              arguments: { title: '合同管理需求说明' },
              output: 'Saved Markdown SRS',
            },
            {
              id: 'tc-6',
              toolName: 'read_application_inputs',
              arguments: {},
              output: 'Checked delivery inputs',
            },
            {
              id: 'tc-7',
              toolName: 'compile_dev_package',
              arguments: {},
              output: 'Compiled package.zip with DDL & OpenAPI',
            },
          ],
          artifacts: [
            {
              kind: 'ONTOLOGY_DIFF',
              title: '新增超额审批规则',
              modelCode: 'M3',
              changes: [],
            },
          ],
          timestamp: '2026-11-17T10:00:08.000Z',
        },
      ],
      createdAt: '2026-11-17T10:00:00.000Z',
      updatedAt: '2026-11-17T10:00:08.000Z',
    };

    const [run] = agentRunsFromSession(richSession, undefined, { suite });
    expect(run).toBeDefined();

    for (const locale of ['zh-CN', 'en-US'] as const) {
      useLocale(locale);
      const html = renderCard({
        run: run!,
        changeSummarySlot: (
          <div data-testid="mock-change-summary">
            {locale === 'en-US' ? "Updated 'Contract'" : '在「合同」上更新了业务操作'}
          </div>
        ),
      });

      // 1. Default collapsed markup passes checkBusinessViewMarkup with ZERO violations!
      const violations = checkBusinessViewMarkup(html);
      expect(
        violations,
        `Expected 0 Business View violations in ${locale}:\n${formatBusinessViewViolations(violations)}`,
      ).toEqual([]);

      // 2. Concise deterministic progress lines (<= 5 visible steps, never LLM thinking/free text)
      expect(html).toContain('data-testid="agent-run-progress"');
      const visibleStepMatches = html.match(/class="agent-run-step"/g) ?? [];
      expect(visibleStepMatches.length).toBeLessThanOrEqual(5);
      expect(html).toContain(
        locale === 'en-US' ? 'View details' : '查看细节',
      );

      // 3. Closed <details> holds all 7 tool traces, raw JSON/HTML/DDL outputs, thinking, char counts, and token usage
      expect(html).toContain('data-testid="agent-run-details"');
      expect(html).not.toMatch(/<details[^>]*\sopen/);
      expect(html).toContain('data-testid="agent-run-tool-details"');
      expect(html).toContain('data-testid="agent-run-step-anchor"');
      expect(html).toContain('SCR-CONTRACT-LIST · EL-ACT-SUBMIT');
      expect(html).toContain('data-testid="agent-run-thinking"');
      expect(html).toContain('Inspect M1 AGG-01 &amp; M2 BHV-01');
      expect(html).toContain('data-testid="agent-run-usage"');
      expect(html).toContain('1160');
      expect(html).toContain('auto/glm-5.3-flash');

      // 4. Hook point for #65/#67/#70 Change Summary & Undo footer renders cleanly
      expect(html).toContain('data-testid="agent-run-change-slot"');
      expect(html).toContain('data-testid="mock-change-summary"');

      // 5. When defaultDetailsOpen is true, <details open> opens for inspection
      const openHtml = renderCard({ run: run!, defaultDetailsOpen: true });
      expect(openHtml).toMatch(/<details[^>]*data-testid="agent-run-details"[^>]*\sopen/);
    }
  });

  it('renders unified platform problem notice + deployer settings link + ADR 0007 diagnostics in details for unconfigured, unreachable, timeout, and vision-unsupported runs, and plain-language reasons for non-platform failures', () => {
    const platformCases: Array<{
      label: string;
      run: AgentRunView;
      expectedCode: string;
    }> = [
      {
        label: 'unconfigured gateway',
        expectedCode: 'LLM_NOT_CONFIGURED',
        run: makeRun({
          status: 'FAILED',
          steps: [],
          completedAt: STARTED_AT + 1_000,
          failure: {
            code: 'LLM_NOT_CONFIGURED',
            providerName: 'No Provider Configured',
            baseUrl: '(none)',
            message: 'No enabled LLM gateway provider is configured in Live mode.',
            remediation: 'Configure an enabled provider in Platform Governance → LLM Center.',
          },
        }),
      },
      {
        label: 'unreachable / HTTP 502 gateway',
        expectedCode: 'LLM_GATEWAY_ERROR',
        run: makeRun({
          status: 'FAILED',
          steps: [],
          completedAt: STARTED_AT + 2_000,
          failure: {
            code: 'LLM_GATEWAY_ERROR',
            providerName: 'Corp OpenAI Proxy',
            baseUrl: 'http://127.0.0.1:3425/v1',
            statusCode: 502,
            message: 'HTTP 502 Bad Gateway: upstream ECONNREFUSED',
            remediation: 'Check gateway URL and API key in LLM Center.',
          },
        }),
      },
      {
        label: 'idle timeout',
        expectedCode: 'LLM_TIMEOUT',
        run: makeRun({
          status: 'FAILED',
          completedAt: STARTED_AT + 60_000,
          failure: {
            code: 'LLM_TIMEOUT',
            providerName: 'Slow Reasoning Gateway',
            baseUrl: 'https://llm.internal.example/v1',
            message: 'Session stream idle timeout after 60000ms',
            remediation: 'Switch to a faster model or retry.',
          },
        }),
      },
      {
        label: 'vision unsupported failure',
        expectedCode: 'VISION_UNSUPPORTED',
        run: makeRun({
          status: 'FAILED',
          steps: [],
          completedAt: STARTED_AT + 1_500,
          failure: {
            code: 'VISION_UNSUPPORTED',
            providerName: 'Text-Only Model',
            baseUrl: 'http://127.0.0.1:3425/v1',
            statusCode: 400,
            message: 'Model glm-4-air does not support image_url blocks',
            remediation: 'Enable a vision-capable model in LLM Center.',
          },
        }),
      },
    ];

    for (const locale of ['zh-CN', 'en-US'] as const) {
      useLocale(locale);
      const expectedPrimaryCopy =
        locale === 'en-US' ? PLATFORM_UNAVAILABLE_COPY.en : PLATFORM_UNAVAILABLE_COPY.zh;
      const expectedSettingsBtn =
        locale === 'en-US' ? 'Open platform settings' : '前往平台设置';

      for (const tc of platformCases) {
        const html = renderCard({ run: tc.run });
        const violations = checkBusinessViewMarkup(html);
        expect(
          violations,
          `Platform case "${tc.label}" (${locale}) failed Business View guard:\n${formatBusinessViewViolations(violations)}`,
        ).toEqual([]);

        expect(html).toContain(expectedPrimaryCopy);
        expect(html).toContain('data-testid="agent-run-open-platform-settings-btn"');
        expect(html).toContain(expectedSettingsBtn);
        expect(html).toContain('data-testid="agent-run-retry-btn"');
        expect(html).toContain('data-testid="agent-run-diagnostic-details"');
        expect(html).toContain(tc.expectedCode);
        expect(html).toContain(tc.run.failure!.providerName!);
        expect(html).toContain(tc.run.failure!.baseUrl!);
        expect(html).toContain(tc.run.failure!.remediation!);
      }

      // Vision fallback notice on an image-carrying run (non-failed fallback) also shows platform notice + settings link
      const visionFallbackHtml = renderCard({
        run: makeRun({
          status: 'SUCCEEDED',
          completedAt: STARTED_AT + 4_000,
          visionFallback: {
            used: true,
            providerName: 'Text-Only Gateway',
            notice: '当前模型看不了图，将只使用文字设计说明',
          },
          result: {
            summary: { zh: '已按文字说明生成草稿。', en: 'Generated draft from text notes.' },
          },
        }),
      });
      expect(checkBusinessViewMarkup(visionFallbackHtml)).toEqual([]);
      expect(visionFallbackHtml).toContain(expectedPrimaryCopy);
      expect(visionFallbackHtml).toContain('data-testid="agent-run-open-platform-settings-btn"');
      expect(visionFallbackHtml).toContain('data-testid="agent-run-diagnostic-details"');
      expect(visionFallbackHtml).toContain('Text-Only Gateway');

      // Non-platform failure: shows plain-language explanation + Retry, NO platform settings link, raw SQL/JSON error tucked in details
      const nonPlatformHtml = renderCard({
        run: makeRun({
          status: 'FAILED',
          steps: [],
          completedAt: STARTED_AT + 2_000,
          failure: {
            code: 'AGENT_RUNTIME_ERROR',
            message: 'SQLITE_CONSTRAINT: invalid JSON payload for M2 BHV-01',
            remediation: 'Retry the request.',
          },
        }),
      });
      expect(checkBusinessViewMarkup(nonPlatformHtml)).toEqual([]);
      expect(nonPlatformHtml).not.toContain(expectedPrimaryCopy);
      expect(nonPlatformHtml).not.toContain('data-testid="agent-run-open-platform-settings-btn"');
      expect(nonPlatformHtml).toContain('data-testid="agent-run-retry-btn"');
      expect(nonPlatformHtml).toContain('data-testid="agent-run-diagnostic-details"');
      expect(nonPlatformHtml).toContain('SQLITE_CONSTRAINT');
    }
  });
});
