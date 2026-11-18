import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_VOCABULARY,
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
  formatToolProgressLine,
  type BusinessLocale,
} from '../../../../packages/business-vocabulary/index.js';
import { createWorkspaceStore } from '../../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload } from '../../../api.js';
import { PreferencesProvider } from '../../../i18n.js';
import { agentPanelSurfaceFor } from '../../../navigation/index.js';
import { AgentPanel } from '../AgentPanel.js';
import { ShellAgentPanel, resolveSurfaceAgentSession } from '../ShellAgentPanel.js';
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  agentSessionScopeKey,
  useAgentPanelStore,
} from '../agentPanelStore.js';
import type { AgentRunView } from '../agentRun.js';
import {
  clearConversationScrollMemoryForTests,
  writeSessionScrollPosition,
} from './scrollPosition.js';

const noop = () => undefined;
const FIXED_NOW = Date.UTC(2026, 10, 18, 9, 30, 0);

function stubLocale(locale: BusinessLocale, extra: Record<string, string> = {}) {
  const entries = new Map<string, string>(Object.entries({ onto_locale: locale, ...extra }));
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, val: string) => {
      entries.set(key, val);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

describe('ConversationThread & AgentPanel conversation mode (#79)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearConversationScrollMemoryForTests();
    useWorkbenchStore.setState({
      data: null,
      liveSessionDrafts: {},
      sessionQueues: {},
      activeItemId: null,
      activeSessionId: null,
    });
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
  });

  it('renders one Agent Run as one continuous conversation turn without AgentRunCard chrome in conversation mode, while keeping run-cards mode on non-Requirements surfaces', async () => {
    const runs: AgentRunView[] = [
      {
        id: 'turn-1',
        userPrompt: '我们需要管理供应商准入与采购合同会签。',
        title: { zh: '管理供应商准入', en: 'Supplier onboarding' },
        status: 'SUCCEEDED',
        liveStatus: { zh: '已完成', en: 'Completed' },
        startedAt: FIXED_NOW - 10_000,
        completedAt: FIXED_NOW - 7_000,
        steps: [],
        text: '已记录核心范围：**供应商准入**与**采购合同会签**。',
      },
      {
        id: 'turn-2',
        userPrompt: '超过 100 万元的合同需要法务和财务双签。',
        title: { zh: '超额合同双签', en: 'Dual approval rule' },
        status: 'SUCCEEDED',
        liveStatus: { zh: '已完成', en: 'Completed' },
        startedAt: FIXED_NOW - 5_000,
        completedAt: FIXED_NOW - 2_000,
        steps: [],
        text: '已补充高金额合同的法务与财务会签规则。',
      },
    ];

    stubLocale('zh-CN');
    const conversationHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <AgentPanel
          title={BUSINESS_VOCABULARY.AI_ASSISTANT}
          runs={runs}
          width={AGENT_PANEL_DEFAULT_WIDTH}
          presentationMode="conversation"
          onSubmitPrompt={noop}
          renderRunFooter={(run) =>
            run.id === 'turn-2' ? (
              <div data-testid="run-change-summary">已更新需求章节</div>
            ) : null
          }
          onClose={noop}
          onResize={noop}
          now={FIXED_NOW}
        />
      </PreferencesProvider>,
    );

    // Continuous conversation turns: zero AgentRunCard elements!
    expect(conversationHtml).not.toContain('data-testid="agent-run-card"');
    expect(conversationHtml.match(/data-testid="conversation-turn"/g)).toHaveLength(2);
    expect(conversationHtml.match(/data-testid="conversation-user-message"/g)).toHaveLength(2);
    expect(conversationHtml.match(/data-testid="conversation-assistant-reply"/g)).toHaveLength(2);
    // Only the latest user message carries data-latest-user-turn="true" (seam for #81)
    expect(conversationHtml.match(/data-latest-user-turn="true"/g)).toHaveLength(1);
    expect(conversationHtml.match(/data-latest-user-turn="false"/g)).toHaveLength(1);
    // User prompt precedes assistant reply in DOM order
    expect(conversationHtml.indexOf('我们需要管理供应商准入与采购合同会签。')).toBeLessThan(
      conversationHtml.indexOf('已记录核心范围'),
    );
    // Run footer (Change Summary) renders on completed mutating turn
    expect(conversationHtml).toContain('data-testid="run-change-summary"');

    // ShellAgentPanel automatically uses conversation mode on Requirements and keeps run-cards on Business Model
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      const boot = (await (
        await app.request('/api/bootstrap?projectId=proj-contract')
      ).json()) as BootstrapPayload;
      useWorkbenchStore.setState({ loading: false, data: boot, activeSessionId: null });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      const reqHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ShellAgentPanel
            surface={agentPanelSurfaceFor('app-requirements')}
            overlay={false}
            side="left"
            closable={false}
            onClose={noop}
            onNavigate={noop}
          />
        </PreferencesProvider>,
      );
      expect(reqHtml).toContain('data-testid="conversation-thread"');
      expect(reqHtml).toContain('data-testid="conversation-turn"');
      expect(reqHtml).not.toContain('data-testid="agent-run-card"');

      const bmHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ShellAgentPanel
            surface={agentPanelSurfaceFor('app-ontology')}
            overlay={false}
            side="left"
            closable={false}
            onClose={noop}
            onNavigate={noop}
          />
        </PreferencesProvider>,
      );
      expect(bmHtml).not.toContain('data-testid="conversation-thread"');
    } finally {
      store.close();
    }
  });

  it('shows bilingual Jump to latest button when a conversation is scrolled away from the bottom and remembers scroll state per sessionId across reload', () => {
    const runs: AgentRunView[] = [
      {
        id: 'turn-scroll-1',
        userPrompt: '第一轮需求讨论',
        title: { zh: '第一轮需求讨论', en: 'Turn 1' },
        status: 'SUCCEEDED',
        liveStatus: { zh: '已完成', en: 'Completed' },
        startedAt: FIXED_NOW - 8_000,
        completedAt: FIXED_NOW - 6_000,
        steps: [],
        text: '已记录第一轮讨论结论。',
      },
    ];

    for (const locale of ['zh-CN', 'en-US'] as const) {
      const storage = stubLocale(locale);
      writeSessionScrollPosition('sess-scrolled-up', { atBottom: false, scrollTop: 180 }, storage);
      writeSessionScrollPosition('sess-pinned-bottom', { atBottom: true }, storage);

      // Simulate browser reload by clearing in-memory cache while keeping persisted localStorage
      clearConversationScrollMemoryForTests();

      const scrolledUpHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AgentPanel
            title={BUSINESS_VOCABULARY.AI_ASSISTANT}
            runs={runs}
            activeSessionId="sess-scrolled-up"
            width={AGENT_PANEL_DEFAULT_WIDTH}
            presentationMode="conversation"
            onSubmitPrompt={noop}
            onClose={noop}
            onResize={noop}
          />
        </PreferencesProvider>,
      );
      expect(scrolledUpHtml).toContain('data-testid="conversation-jump-to-latest"');
      expect(scrolledUpHtml).toContain(locale === 'en-US' ? 'Jump to latest' : '跳到最新');

      const atBottomHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AgentPanel
            title={BUSINESS_VOCABULARY.AI_ASSISTANT}
            runs={runs}
            activeSessionId="sess-pinned-bottom"
            width={AGENT_PANEL_DEFAULT_WIDTH}
            presentationMode="conversation"
            onSubmitPrompt={noop}
            onClose={noop}
            onResize={noop}
          />
        </PreferencesProvider>,
      );
      expect(atBottomHtml).not.toContain('data-testid="conversation-jump-to-latest"');

      // Empty conversation never shows Jump to latest even if storage had an old offset
      const emptyHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AgentPanel
            title={BUSINESS_VOCABULARY.AI_ASSISTANT}
            runs={[]}
            activeSessionId="sess-scrolled-up"
            width={AGENT_PANEL_DEFAULT_WIDTH}
            presentationMode="conversation"
            onSubmitPrompt={noop}
            onClose={noop}
            onResize={noop}
          />
        </PreferencesProvider>,
      );
      expect(emptyHtml).toContain('data-testid="agent-panel-empty"');
      expect(emptyHtml).not.toContain('data-testid="conversation-jump-to-latest"');
    }
  });

  it('preserves History Menu (create, switch, inline rename, inline delete) in conversation mode and passes checkBusinessViewMarkup in zh-CN and en-US with 0 violations', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      const surface = agentPanelSurfaceFor('app-requirements');
      const sessA = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'REQUIREMENT',
        title: '履约验收条款梳理',
        initialMessages: [
          {
            id: 'u-a1',
            role: 'user',
            content: '到货验收不合格时怎么处理退换货？',
            timestamp: '2026-11-18T08:00:00Z',
          },
          {
            id: 'a-a1',
            role: 'assistant',
            content: '建议区分**整批拒收**与**让步接收扣款**两种路径。',
            timestamp: '2026-11-18T08:00:04Z',
          },
        ],
      });
      const sessB = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'REQUIREMENT',
        title: '新对话',
      });

      // Rename sessB via API (inline rename path)
      const renameRes = await app.request(`/api/agent-sessions/${sessB.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '多币种结算汇率专题' }),
      });
      expect(renameRes.status).toBe(200);

      const boot = (await (
        await app.request('/api/bootstrap?projectId=proj-contract')
      ).json()) as BootstrapPayload;
      useWorkbenchStore.setState({
        loading: false,
        data: boot,
        activeNav: 'app-requirements',
        activeSessionId: sessA.id,
      });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      for (const locale of ['zh-CN', 'en-US'] as const) {
        const storage = stubLocale(locale);
        writeSessionScrollPosition(sessA.id, { atBottom: false, scrollTop: 140 }, storage);

        const shellHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <ShellAgentPanel
              surface={surface}
              overlay={false}
              side="left"
              closable={false}
              defaultHistoryOpen
              onClose={noop}
              onNavigate={noop}
            />
          </PreferencesProvider>,
        );

        expect(shellHtml).toContain('data-presentation-mode="conversation"');
        expect(shellHtml).toContain('data-testid="assistant-history-menu"');
        expect(shellHtml).toContain('data-testid="assistant-new-session-btn"');
        expect(shellHtml).toContain('data-testid="assistant-rename-session-btn"');
        expect(shellHtml).toContain('data-testid="assistant-delete-session-btn"');
        expect(shellHtml).toContain('履约验收条款梳理');
        expect(shellHtml).toContain('多币种结算汇率专题');
        expect(shellHtml).toContain('data-testid="conversation-jump-to-latest"');

        const shellViolations = checkBusinessViewMarkup(shellHtml);
        expect(
          shellViolations,
          `ShellAgentPanel Requirements [${locale}]:\n${formatBusinessViewViolations(shellViolations)}`,
        ).toEqual([]);

        // Also guard comprehensive conversation turn states (empty starters, running progress, askUser, stepHandoff, handoffFrom, failure, cancelled)
        const emptyStartersHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <AgentPanel
              title={BUSINESS_VOCABULARY.AI_ASSISTANT}
              runs={[]}
              starterPrompts={surface.starters ?? []}
              width={AGENT_PANEL_DEFAULT_WIDTH}
              presentationMode="conversation"
              onSubmitPrompt={noop}
              onClose={noop}
              onResize={noop}
            />
          </PreferencesProvider>,
        );
        expect(emptyStartersHtml).toContain('data-testid="agent-panel-starters"');
        expect(checkBusinessViewMarkup(emptyStartersHtml)).toEqual([]);

        const richRuns: AgentRunView[] = [
          {
            id: 'r-running',
            userPrompt:
              locale === 'en-US'
                ? 'Organize contract approval thresholds'
                : '梳理采购合同分级审批门槛',
            handoffFrom: {
              handoffId: 'ho-1',
              sourceStep: 'PROTOTYPE',
              sourceSessionId: 'sess-proto-1',
            },
            title: { zh: '梳理审批门槛', en: 'Approval thresholds' },
            status: 'RUNNING',
            liveStatus: { zh: '正在整理需求要点…', en: 'Organizing requirements…' },
            startedAt: FIXED_NOW - 4_000,
            thinking: 'Internal model reasoning hidden inside closed details',
            steps: [
              {
                id: 's1',
                label: {
                  zh: formatToolProgressLine('save_requirement_doc', {}, 'zh-CN'),
                  en: formatToolProgressLine('save_requirement_doc', {}, 'en-US'),
                },
                status: 'RUNNING',
                toolName: 'save_requirement_doc',
                detail: '{"docId":"rdoc-1"}',
              },
            ],
            text:
              locale === 'en-US'
                ? 'Drafting the approval thresholds section…'
                : '正在起草分级审批门槛章节…',
          },
          {
            id: 'r-hitl',
            userPrompt:
              locale === 'en-US'
                ? 'Not sure how overdue contracts should be handled'
                : '逾期未归档合同不确定怎么处理',
            title: { zh: '逾期处理选项', en: 'Overdue options' },
            status: 'SUCCEEDED',
            liveStatus: { zh: '已完成', en: 'Completed' },
            startedAt: FIXED_NOW - 3_000,
            completedAt: FIXED_NOW - 2_000,
            steps: [],
            askUser: {
              id: 'ask-conv-1',
              question:
                locale === 'en-US'
                  ? 'How should overdue unarchived contracts be handled?'
                  : '超过 30 天未归档的合同应如何处理？',
              options:
                locale === 'en-US'
                  ? ['Notify owner daily', 'Pause subsequent payments until archived']
                  : ['每日提醒经办人', '归档前暂停后续付款申请'],
              answered: false,
            },
            stepHandoff: {
              id: 'ho-conv-2',
              sourceStep: 'REQUIREMENTS',
              targetStep: 'PROTOTYPE',
              request:
                locale === 'en-US'
                  ? 'Adjust filter bar spacing on Contract List'
                  : '把合同列表筛选栏间距调紧一点',
              reason:
                locale === 'en-US'
                  ? 'Screen layout belongs to the Prototype step'
                  : '界面排版调整属于原型步骤',
              status: 'PENDING',
            },
          },
          {
            id: 'r-platform-fail',
            userPrompt: locale === 'en-US' ? 'Continue refining' : '继续补充验收规则',
            title: { zh: '继续补充', en: 'Continue refining' },
            status: 'FAILED',
            liveStatus: { zh: '失败', en: 'Failed' },
            startedAt: FIXED_NOW - 2_000,
            completedAt: FIXED_NOW - 1_000,
            steps: [],
            failure: {
              code: 'LLM_GATEWAY_ERROR',
              statusCode: 502,
              message: 'HTTP 502 Bad Gateway from http://127.0.0.1:9999/v1',
            },
          },
          {
            id: 'r-cancelled',
            userPrompt: locale === 'en-US' ? 'Generate summary' : '生成需求摘要',
            title: { zh: '生成需求摘要', en: 'Generate summary' },
            status: 'CANCELLED',
            liveStatus: { zh: '已取消', en: 'Cancelled' },
            startedAt: FIXED_NOW - 1_000,
            completedAt: FIXED_NOW,
            steps: [],
          },
        ];

        const richHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <AgentPanel
              title={BUSINESS_VOCABULARY.AI_ASSISTANT}
              runs={richRuns}
              activeSessionId={sessA.id}
              width={AGENT_PANEL_DEFAULT_WIDTH}
              presentationMode="conversation"
              onCancelRun={noop}
              onRetryRun={noop}
              onOpenPlatformSettings={noop}
              onAnswerAskUser={noop}
              onAcceptStepHandoff={noop}
              onDeclineStepHandoff={noop}
              onSubmitPrompt={noop}
              queuedPrompts={[
                {
                  id: 'q-1',
                  label:
                    locale === 'en-US' ? 'Add seal custody rule' : '补充印章保管与外借登记要求',
                },
              ]}
              onRemoveQueuedPrompt={noop}
              onClose={noop}
              onResize={noop}
              now={FIXED_NOW}
            />
          </PreferencesProvider>,
        );

        const richViolations = checkBusinessViewMarkup(richHtml);
        expect(
          richViolations,
          `Rich conversation states [${locale}]:\n${formatBusinessViewViolations(richViolations)}`,
        ).toEqual([]);
      }

      // Delete sessA via API (inline delete path) -> falls back cleanly to sessB
      const scopeKey = agentSessionScopeKey('proj-contract', 'REQUIREMENT');
      useAgentPanelStore.getState().rememberSession(scopeKey, sessA.id);
      const delRes = await app.request(`/api/agent-sessions/${sessA.id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(200);
      const bootAfterDelete = (await (
        await app.request('/api/bootstrap?projectId=proj-contract')
      ).json()) as BootstrapPayload;
      const resolved = resolveSurfaceAgentSession(surface, bootAfterDelete, {
        rememberedSessionByScope: useAgentPanelStore.getState().sessionByScope,
      });
      expect(resolved.session?.id).toBe(sessB.id);
    } finally {
      store.close();
    }
  });
});
