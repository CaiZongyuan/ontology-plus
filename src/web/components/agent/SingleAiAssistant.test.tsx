import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_VOCABULARY,
  PROJECT_STEP_IDS,
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../../../packages/business-vocabulary/index.js';
import {
  createWorkspaceStore,
  type AgentSessionKind,
} from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload } from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import {
  AGENT_PANEL_SURFACES,
  NAV_ITEMS,
  PROJECT_STEP_VIEWS,
  agentPanelSurfaceFor,
  getDefaultViewForStep,
  type NavViewId,
} from '../../navigation/index.js';
import { AgentPanel } from './AgentPanel.js';
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  agentSessionScopeKey,
  useAgentPanelStore,
} from './agentPanelStore.js';
import { ShellAgentPanel, resolveSurfaceAgentSession } from './ShellAgentPanel.js';
import { PrototypeRevisionHistoryDrawer } from '../prototype/PrototypeRevisionHistory.js';
import {
  AppPublishView,
  ApplicationAssemblyDevView,
  FourLayerAssetsView,
  OntologySkillsView,
} from '../../views/application-center/DeliveryStepViews.js';
import { CapabilityAgentsView } from '../../views/CapabilityViews.js';
import { DataReasoningView, LlmCenterView } from '../../views/DataAndInfraViews.js';

const noop = () => undefined;

function stubLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

describe('Single AI Assistant — 7-specialist mapping & surface vocabulary (#62)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useWorkbenchStore.setState({
      data: null,
      liveSessionDrafts: {},
      sessionQueues: {},
      activeItemId: null,
      activeSessionId: null,
    });
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
  });

  it('maps the 4 Project Steps, Delivery Technical Details, and Secondary Areas to all 7 specialist AgentSessionKinds while presenting every surface as AI 助手 / AI Assistant', () => {
    // 1. Default view of each of the 4 Project Steps
    expect(agentPanelSurfaceFor(getDefaultViewForStep('REQUIREMENTS')).sessionKind).toBe(
      'REQUIREMENT',
    );
    expect(agentPanelSurfaceFor(getDefaultViewForStep('PROTOTYPE')).sessionKind).toBe(
      'PROTOTYPE_CO_DESIGN',
    );
    expect(agentPanelSurfaceFor(getDefaultViewForStep('BUSINESS_MODEL')).sessionKind).toBe(
      'COPILOT',
    );
    expect(agentPanelSurfaceFor(getDefaultViewForStep('DELIVERY')).sessionKind).toBe('CODING');

    // 2. Sub-views within each Project Step
    for (const viewId of PROJECT_STEP_VIEWS.REQUIREMENTS.views) {
      expect(agentPanelSurfaceFor(viewId).sessionKind).toBe('REQUIREMENT');
    }
    for (const viewId of PROJECT_STEP_VIEWS.PROTOTYPE.views) {
      expect(agentPanelSurfaceFor(viewId).sessionKind).toBe('PROTOTYPE_CO_DESIGN');
    }
    for (const viewId of PROJECT_STEP_VIEWS.BUSINESS_MODEL.views) {
      expect(agentPanelSurfaceFor(viewId).sessionKind).toBe('COPILOT');
    }
    // Delivery: Business View & deliverables use CODING; Technical Details (4-layer architecture standards) uses ARCHITECTURE
    expect(agentPanelSurfaceFor('app-assembly-dev').sessionKind).toBe('CODING');
    expect(agentPanelSurfaceFor('app-skills').sessionKind).toBe('CODING');
    expect(agentPanelSurfaceFor('app-publish').sessionKind).toBe('CODING');
    expect(agentPanelSurfaceFor('app-four-layer-assets').sessionKind).toBe('ARCHITECTURE');

    // 3. Secondary areas cover CAPABILITY and REASONING
    expect(agentPanelSurfaceFor('cap-agents').sessionKind).toBe('CAPABILITY');
    expect(agentPanelSurfaceFor('data-reasoning').sessionKind).toBe('REASONING');

    // All 7 AgentSessionKinds are represented across AGENT_PANEL_SURFACES
    const coveredKinds = new Set<AgentSessionKind>(
      Object.values(AGENT_PANEL_SURFACES).map((s) => s.sessionKind),
    );
    expect(coveredKinds).toEqual(
      new Set<AgentSessionKind>([
        'REQUIREMENT',
        'PROTOTYPE_CO_DESIGN',
        'COPILOT',
        'CODING',
        'ARCHITECTURE',
        'CAPABILITY',
        'REASONING',
      ]),
    );

    // 4. Every single surface presents as BUSINESS_VOCABULARY.AI_ASSISTANT and has zero INTERNAL_TERM violations
    expect(PROJECT_STEP_IDS).toHaveLength(4);
    for (const item of NAV_ITEMS) {
      const surface = agentPanelSurfaceFor(item.id);
      expect(surface.title).toEqual({
        zh: BUSINESS_VOCABULARY.AI_ASSISTANT.zh,
        en: BUSINESS_VOCABULARY.AI_ASSISTANT.en,
      });

      const textsToCheck = [
        surface.title.zh,
        surface.title.en,
        surface.subtitle?.zh ?? '',
        surface.subtitle?.en ?? '',
        surface.placeholder?.zh ?? '',
        surface.placeholder?.en ?? '',
        ...(surface.starters ?? []).flatMap((st) => [st.zh, st.en]),
      ].filter(Boolean);

      for (const text of textsToCheck) {
        const violations = checkBusinessViewMarkup(text, {
          plainText: true,
          categories: ['INTERNAL_TERM'],
        });
        expect(
          violations,
          `Surface ${item.id} leaked internal term in "${text}":\n${formatBusinessViewViolations(violations)}`,
        ).toEqual([]);
      }
    }

    // Delivery Technical Details (`app-four-layer-assets`) gives contextual guidance without naming "Architecture Asset Agent"
    const archSurface = agentPanelSurfaceFor('app-four-layer-assets');
    expect(archSurface.subtitle?.zh.length).toBeGreaterThan(0);
    expect(archSurface.subtitle?.en.length).toBeGreaterThan(0);
  });

  it('renders a calm single "AI 助手 / AI Assistant" header without inline session toolbar clutter, passes INTERNAL_TERM guard in both zh-CN and en-US, and moves session management into the History Menu Popover', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const expectedTitle =
        locale === 'en-US'
          ? BUSINESS_VOCABULARY.AI_ASSISTANT.en
          : BUSINESS_VOCABULARY.AI_ASSISTANT.zh;

      const closedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AgentPanel
            title={{
              zh: BUSINESS_VOCABULARY.AI_ASSISTANT.zh,
              en: BUSINESS_VOCABULARY.AI_ASSISTANT.en,
            }}
            subtitle={{
              zh: '编写与维护开发规范',
              en: 'Authoring development standards',
            }}
            runs={[]}
            width={AGENT_PANEL_DEFAULT_WIDTH}
            sessions={[
              {
                id: 'sess-1',
                title: '合同审批流讨论',
                turnCount: 3,
                updatedLabel: locale === 'en-US' ? '2m ago' : '2 分钟前',
              },
              {
                id: 'sess-2',
                title: '逾期违约金规则',
                turnCount: 1,
                updatedLabel: locale === 'en-US' ? '1h ago' : '1 小时前',
              },
            ]}
            activeSessionId="sess-1"
            onSelectSession={noop}
            onCreateSession={noop}
            onRenameSession={noop}
            onDeleteSession={noop}
            onSubmitPrompt={noop}
            onClose={noop}
            onResize={noop}
          />
        </PreferencesProvider>,
      );

      expect(closedHtml).toContain('data-testid="assistant-panel-title"');
      expect(closedHtml).toContain(expectedTitle);
      expect(closedHtml).toContain('data-testid="assistant-panel-subtitle"');
      expect(closedHtml).toContain('data-testid="assistant-history-menu-btn"');
      // Cluttered inline session select & standalone header new-session button are gone
      expect(closedHtml).not.toContain('data-testid="agent-panel-session-select"');
      expect(closedHtml).not.toContain('data-testid="agent-new-session-btn"');
      // Closed by default: session titles stay tucked inside the History Menu
      expect(closedHtml).not.toContain('data-testid="assistant-history-menu"');
      expect(closedHtml).not.toContain('逾期违约金规则');

      const closedViolations = checkBusinessViewMarkup(closedHtml, {
        categories: ['INTERNAL_TERM'],
      });
      expect(closedViolations, formatBusinessViewViolations(closedViolations)).toEqual([]);

      // Open History Menu (via Popover primitive)
      const openHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AgentPanel
            title={{
              zh: BUSINESS_VOCABULARY.AI_ASSISTANT.zh,
              en: BUSINESS_VOCABULARY.AI_ASSISTANT.en,
            }}
            runs={[]}
            width={AGENT_PANEL_DEFAULT_WIDTH}
            defaultHistoryOpen
            sessions={[
              {
                id: 'sess-1',
                title: '合同审批流讨论',
                turnCount: 3,
                updatedLabel: locale === 'en-US' ? '2m ago' : '2 分钟前',
              },
              {
                id: 'sess-2',
                title: '逾期违约金规则',
                turnCount: 1,
                updatedLabel: locale === 'en-US' ? '1h ago' : '1 小时前',
              },
            ]}
            activeSessionId="sess-1"
            onSelectSession={noop}
            onCreateSession={noop}
            onRenameSession={noop}
            onDeleteSession={noop}
            onSubmitPrompt={noop}
            onClose={noop}
            onResize={noop}
          />
        </PreferencesProvider>,
      );

      expect(openHtml).toContain('data-slot="popover-content"');
      expect(openHtml).toContain('data-testid="assistant-history-menu"');
      expect(openHtml).toContain('data-testid="assistant-new-session-btn"');
      expect(openHtml).toContain('data-testid="assistant-history-item"');
      expect(openHtml).toContain('data-session-id="sess-1"');
      expect(openHtml).toContain('data-active="true"');
      expect(openHtml).toContain('合同审批流讨论');
      expect(openHtml).toContain('逾期违约金规则');
      expect(openHtml).toContain('data-testid="assistant-rename-session-btn"');
      expect(openHtml).toContain('data-testid="assistant-delete-session-btn"');

      const openViolations = checkBusinessViewMarkup(openHtml, {
        categories: ['INTERNAL_TERM'],
      });
      expect(openViolations, formatBusinessViewViolations(openViolations)).toEqual([]);
    }
  });

  it('switches to each step’s own conversation while keeping the header calmly titled AI 助手 / AI Assistant, and enforces the PROTOTYPE_CO_DESIGN 1-to-1 invariant (no manual create/delete)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);

    // Seed distinct turns in REQUIREMENT, COPILOT, CODING, ARCHITECTURE, CAPABILITY, REASONING, and PROTOTYPE_CO_DESIGN
    store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'REQUIREMENT',
      title: '付款里程碑准入话题',
      initialMessages: [
        { id: 'u-req', role: 'user', content: '需求步骤专属提问：付款节点怎么定？', timestamp: '2026-11-17T08:00:00Z' },
        { id: 'a-req', role: 'assistant', content: '建议按签约、到货、验收三阶段拆分。', timestamp: '2026-11-17T08:00:02Z' },
      ],
    });

    store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'COPILOT',
      title: '合同对象字段调整',
      initialMessages: [
        { id: 'u-cop', role: 'user', content: '业务模型专属提问：给合同加上质保期字段', timestamp: '2026-11-17T08:05:00Z' },
        { id: 'a-cop', role: 'assistant', content: '已在合同业务对象上补充质保期字段。', timestamp: '2026-11-17T08:05:02Z' },
      ],
    });

    store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'CODING',
      targetId: 'app-contract-clm',
      title: '交付资料包核对',
      initialMessages: [
        { id: 'u-cod', role: 'user', content: '交付步骤专属提问：检查当前应用的验收条件', timestamp: '2026-11-17T08:10:00Z' },
        { id: 'a-cod', role: 'assistant', content: '当前应用的输入与验收条件已核对完毕。', timestamp: '2026-11-17T08:10:02Z' },
      ],
    });

    store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'ARCHITECTURE',
      title: '前端组件库规范修订',
      initialMessages: [
        { id: 'u-arc', role: 'user', content: '架构规范专属提问：整理表单间距约定', timestamp: '2026-11-17T08:15:00Z' },
        { id: 'a-arc', role: 'assistant', content: '已整理统一的表单间距规范草案。', timestamp: '2026-11-17T08:15:02Z' },
      ],
    });

    const proto = store.listPrototypes('proj-contract')[0]!;
    const protoSession = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      targetId: proto.id,
      title: proto.name,
      initialMessages: [
        { id: 'u-pro', role: 'user', content: '原型步骤专属提问：把顶部筛选栏收紧一点', timestamp: '2026-11-17T08:20:00Z' },
        { id: 'a-pro', role: 'assistant', content: '已收紧筛选栏留白并保持响应式布局。', timestamp: '2026-11-17T08:20:02Z' },
      ],
    });
    store.linkPrototypeCoDesignSession(proto.id, protoSession.id);

    const response = await app.request('http://localhost/api/bootstrap?projectId=proj-contract');
    const data = (await response.json()) as BootstrapPayload;
    useWorkbenchStore.setState({ data, activeItemId: 'app-contract-clm', activeSessionId: null });
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

    const stepChecks: Array<{
      view: NavViewId;
      mustContain: string;
      mustNotContain: string[];
      canCreateDelete: boolean;
    }> = [
      {
        view: 'app-req-explore',
        mustContain: '需求步骤专属提问：付款节点怎么定？',
        mustNotContain: ['业务模型专属提问', '交付步骤专属提问', '原型步骤专属提问', '架构规范专属提问'],
        canCreateDelete: true,
      },
      {
        view: 'app-prototype',
        mustContain: '原型步骤专属提问：把顶部筛选栏收紧一点',
        mustNotContain: ['需求步骤专属提问', '业务模型专属提问', '交付步骤专属提问', '架构规范专属提问'],
        canCreateDelete: false,
      },
      {
        view: 'app-ontology',
        mustContain: '业务模型专属提问：给合同加上质保期字段',
        mustNotContain: ['需求步骤专属提问', '原型步骤专属提问', '交付步骤专属提问', '架构规范专属提问'],
        canCreateDelete: true,
      },
      {
        view: 'app-assembly-dev',
        mustContain: '交付步骤专属提问：检查当前应用的验收条件',
        mustNotContain: ['需求步骤专属提问', '原型步骤专属提问', '业务模型专属提问', '架构规范专属提问'],
        canCreateDelete: true,
      },
      {
        view: 'app-four-layer-assets',
        mustContain: '架构规范专属提问：整理表单间距约定',
        mustNotContain: ['需求步骤专属提问', '原型步骤专属提问', '业务模型专属提问', '交付步骤专属提问'],
        canCreateDelete: true,
      },
      {
        view: 'cap-agents',
        mustContain: '高风险合同审查与结算巡检对话',
        mustNotContain: ['需求步骤专属提问', '交付步骤专属提问'],
        canCreateDelete: true,
      },
      {
        view: 'data-reasoning',
        mustContain: 'Q4 高风险合同逾期归因与策略回写',
        mustNotContain: ['需求步骤专属提问', '交付步骤专属提问'],
        canCreateDelete: true,
      },
    ];

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const expectedAssistantLabel =
        locale === 'en-US'
          ? BUSINESS_VOCABULARY.AI_ASSISTANT.en
          : BUSINESS_VOCABULARY.AI_ASSISTANT.zh;

      for (const check of stepChecks) {
        const html = renderToStaticMarkup(
          <PreferencesProvider>
            <ShellAgentPanel
              surface={agentPanelSurfaceFor(check.view)}
              overlay={false}
              defaultHistoryOpen
              onClose={noop}
              onNavigate={noop}
            />
          </PreferencesProvider>,
        );

        expect(html).toContain('data-testid="assistant-panel-title"');
        expect(html).toContain(expectedAssistantLabel);
        expect(html).toContain('data-testid="assistant-history-menu-btn"');
        expect(html).toContain('data-testid="assistant-history-menu"');
        expect(html).toContain(check.mustContain);
        for (const absent of check.mustNotContain) {
          expect(html).not.toContain(absent);
        }

        if (check.canCreateDelete) {
          expect(html).toContain('data-testid="assistant-new-session-btn"');
          expect(html).toContain('data-testid="assistant-delete-session-btn"');
          expect(html).toContain('data-testid="assistant-rename-session-btn"');
        } else {
          // PROTOTYPE_CO_DESIGN invariant: strictly 1-to-1 with Interactive Prototype; no manual create or delete
          expect(html).not.toContain('data-testid="assistant-new-session-btn"');
          expect(html).not.toContain('data-testid="assistant-delete-session-btn"');
          expect(html).toContain('data-testid="assistant-rename-session-btn"');
        }

        const violations = checkBusinessViewMarkup(html, {
          categories: ['INTERNAL_TERM'],
        });
        expect(
          violations,
          `ShellAgentPanel on ${check.view} (${locale}) leaked internal term:\n${formatBusinessViewViolations(violations)}`,
        ).toEqual([]);
      }
    }
  });

  it('presents only AI 助手 / AI Assistant across DeliveryStepViews, CapabilityViews, DataAndInfraViews, and PrototypeRevisionHistory with 0 INTERNAL_TERM violations in both zh-CN and en-US', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    const proto = store.listPrototypes('proj-contract')[0]!;
    store.appendPrototypeRevision(proto.id, {
      htmlContent: proto.htmlContent,
      title: '精修筛选栏布局',
      source: 'AGENT_RUN',
      agentRunId: 'run-demo-1',
    });

    const response = await app.request('http://localhost/api/bootstrap?projectId=proj-contract');
    const data = (await response.json()) as BootstrapPayload & {
      technologyProfiles: ReturnType<typeof store.listTechnologyProfiles>;
    };
    data.technologyProfiles = store.listTechnologyProfiles();
    useWorkbenchStore.setState({ data, activeItemId: 'app-contract-clm', activeSessionId: null });
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

    const updatedProto = data.prototypes[0]!;

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const expectedAssistantLabel =
        locale === 'en-US'
          ? BUSINESS_VOCABULARY.AI_ASSISTANT.en
          : BUSINESS_VOCABULARY.AI_ASSISTANT.zh;
      const expectedArchAuthorBtn =
        locale === 'en-US'
          ? 'Author standards with the AI Assistant'
          : '请 AI 助手协助编写规范';

      const assemblyHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ApplicationAssemblyDevView />
        </PreferencesProvider>,
      );
      expect(assemblyHtml).toContain(expectedAssistantLabel);

      const assetsHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <FourLayerAssetsView />
        </PreferencesProvider>,
      );
      expect(assetsHtml).toContain(expectedArchAuthorBtn);

      const views: Array<[string, string]> = [
        ['ApplicationAssemblyDevView', assemblyHtml],
        ['FourLayerAssetsView', assetsHtml],
        [
          'AppPublishView',
          renderToStaticMarkup(
            <PreferencesProvider>
              <AppPublishView />
            </PreferencesProvider>,
          ),
        ],
        [
          'OntologySkillsView',
          renderToStaticMarkup(
            <PreferencesProvider>
              <OntologySkillsView />
            </PreferencesProvider>,
          ),
        ],
        [
          'CapabilityAgentsView',
          renderToStaticMarkup(
            <PreferencesProvider>
              <CapabilityAgentsView />
            </PreferencesProvider>,
          ),
        ],
        [
          'DataReasoningView',
          renderToStaticMarkup(
            <PreferencesProvider>
              <DataReasoningView />
            </PreferencesProvider>,
          ),
        ],
        [
          'LlmCenterView',
          renderToStaticMarkup(
            <PreferencesProvider>
              <LlmCenterView />
            </PreferencesProvider>,
          ),
        ],
        [
          'PrototypeRevisionHistoryDrawer',
          renderToStaticMarkup(
            <PreferencesProvider>
              <PrototypeRevisionHistoryDrawer
                open
                prototype={updatedProto}
                confirmedRevision={data.confirmedPrototypeRevision}
                onSelectPreviewRevision={noop}
                onRestoreRevision={noop}
                onRenameRevision={noop}
                onToggleStarRevision={noop}
                onRequestConfirmRevision={noop}
              />
            </PreferencesProvider>,
          ),
        ],
      ];

      for (const [name, markup] of views) {
        const violations = checkBusinessViewMarkup(markup, {
          categories: ['INTERNAL_TERM'],
        });
        expect(
          violations,
          `${name} (${locale}) leaked internal term:\n${formatBusinessViewViolations(violations)}`,
        ).toEqual([]);
      }
    }
  });

  it('supports creating, renaming, switching, and deleting conversations via the /api/agent-sessions endpoints while remembering per-step selection', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    const surface = agentPanelSurfaceFor('app-req-explore');

    // 1. Create two REQUIREMENT conversations via POST /api/agent-sessions
    const createdA = await (
      await app.request('http://localhost/api/agent-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj-contract',
          agentKind: 'REQUIREMENT',
          title: '违约金与滞纳金规则',
        }),
      })
    ).json();
    const createdB = await (
      await app.request('http://localhost/api/agent-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj-contract',
          agentKind: 'REQUIREMENT',
          title: '新对话',
        }),
      })
    ).json();

    expect(createdA.session.agentKind).toBe('REQUIREMENT');
    expect(createdB.session.title).toBe('新对话');

    // 2. Rename conversation B via PATCH /api/agent-sessions/:id
    const renamed = await (
      await app.request(`http://localhost/api/agent-sessions/${createdB.session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '多币种结算汇率锁定' }),
      })
    ).json();
    expect(renamed.session.title).toBe('多币种结算汇率锁定');

    // 3. Switch & remember conversation A in scope
    const scopeKey = agentSessionScopeKey('proj-contract', 'REQUIREMENT');
    useAgentPanelStore.getState().rememberSession(scopeKey, createdA.session.id);
    const bootAfterRename = (await (
      await app.request('http://localhost/api/bootstrap?projectId=proj-contract')
    ).json()) as BootstrapPayload;

    const resolvedSwitched = resolveSurfaceAgentSession(surface, bootAfterRename, {
      rememberedSessionByScope: useAgentPanelStore.getState().sessionByScope,
    });
    expect(resolvedSwitched.session?.id).toBe(createdA.session.id);
    expect(resolvedSwitched.matchingSessions.map((s) => s.title)).toEqual(
      expect.arrayContaining(['违约金与滞纳金规则', '多币种结算汇率锁定']),
    );

    // 4. Delete conversation A via DELETE /api/agent-sessions/:id -> falls back cleanly to remaining conversation
    const deleted = await (
      await app.request(`http://localhost/api/agent-sessions/${createdA.session.id}`, {
        method: 'DELETE',
      })
    ).json();
    expect(deleted.deletedId).toBe(createdA.session.id);

    const bootAfterDelete = (await (
      await app.request('http://localhost/api/bootstrap?projectId=proj-contract')
    ).json()) as BootstrapPayload;
    const resolvedAfterDelete = resolveSurfaceAgentSession(surface, bootAfterDelete, {
      rememberedSessionByScope: useAgentPanelStore.getState().sessionByScope,
    });
    expect(resolvedAfterDelete.session?.id).toBe(createdB.session.id);
    expect(resolvedAfterDelete.session?.title).toBe('多币种结算汇率锁定');
  });
});
