import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROJECT_STEP_IDS,
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
  formatToolProgressLine,
  type BusinessLocale,
} from '../../packages/business-vocabulary/index.js';
import {
  CONTRACT_LIFECYCLE_SUITE,
  DEFAULT_COLLAPSED_OBJECT_SECTIONS,
  MFT_ENTERPRISE_SUITE,
  projectByBusinessObject,
  type OntologySuite,
} from '../../packages/ontology-core/index.js';
import {
  createWorkspaceStore,
  type ContextEventDetail,
  type ContextEventSummary,
  type ModelCallDetail,
  type ModelCallSummary,
  type StepHandoffProposal,
} from '../../packages/workspace-store/index.js';
import { createApiApp } from '../../server/app.js';
import { WorkbenchShell } from '../App.js';
import { useWorkbenchStore, type BootstrapPayload } from '../api.js';
import { AgentPanel } from '../components/agent/AgentPanel.js';
import { ConversationThread } from '../components/agent/conversation/ConversationThread.js';
import {
  ShellAgentPanel,
  agentPanelSurfaceFor,
} from '../components/agent/ShellAgentPanel.js';
import { StepHandoffCard } from '../components/agent/StepHandoffCard.js';
import {
  VisionAttachmentControls,
  VisionCapabilityBanner,
} from '../components/agent/VisionAttachmentControls.js';
import { CONTEXT_INSPECTOR_DRAWER_TEST_ID } from '../components/agent/context-inspector/index.js';
import { AGENT_PANEL_DEFAULT_WIDTH, useAgentPanelStore } from '../components/agent/agentPanelStore.js';
import type { AgentRunView } from '../components/agent/agentRun.js';
import { ApprovalCard } from '../components/beautifui/ApprovalCard.js';
import { ArtifactHistoryDrawer, ChangeSummaryCard } from '../components/history/index.js';
import {
  ConfirmRevisionMuDiffModal,
  PrototypeRevisionHistoryDrawer,
  createInitialRevisionHistoryViewState,
} from '../components/prototype/PrototypeRevisionHistory.js';
import {
  PrototypePostRunBanner,
  SelectionAttachmentStrip,
} from '../components/prototype/SelectionAttachmentStrip.js';
import { usePrototypeSelectionStore } from '../components/prototype/prototypeSelectionStore.js';
import { SecondaryMoreMenu } from '../components/shell/SecondaryMoreMenu.js';
import { PreferencesProvider } from '../i18n.js';
import { getDefaultViewForStep, type NavViewId } from '../navigation/index.js';
import {
  DeliveryStepView,
  OverviewSessionsView,
  PrototypeStudioView,
  RequirementsStepView,
  RunnableSystemSlot,
  type RunnableSystemSlotState,
} from './ApplicationCenterViews.js';
import {
  BUSINESS_MODEL_CROSS_VIEW_IDS,
  BusinessModelStepView,
} from './BusinessModelStepView.js';

const LOCALES: readonly BusinessLocale[] = ['zh-CN', 'en-US'];
const FIXED_NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const noop = () => undefined;

function stubBrowserStorage(locale: BusinessLocale, extra: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries({ onto_locale: locale, ...extra }));
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, val: string) => {
      map.set(key, val);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', {
    localStorage: storage,
    location: new URL('http://127.0.0.1:4364/'),
    history: { replaceState: noop },
    matchMedia: () => ({
      matches: false,
      addEventListener: noop,
      removeEventListener: noop,
    }),
  });
}

function seedWorkbenchState(patch: Partial<ReturnType<typeof useWorkbenchStore.getState>>) {
  useWorkbenchStore.setState(patch);
  Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
}

async function fetchBootstrap(
  app: ReturnType<typeof createApiApp>,
  projectId?: string,
): Promise<BootstrapPayload> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const res = await app.request(`/api/bootstrap${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as BootstrapPayload;
}

function assertCleanMarkup(html: string, screenLabel: string) {
  expect(html.trim().length, `${screenLabel} rendered empty markup`).toBeGreaterThan(0);
  const violations = checkBusinessViewMarkup(html);
  expect(violations, `[${screenLabel}]\n${formatBusinessViewViolations(violations)}`).toEqual([]);
}

function renderInBothLocales(
  label: string,
  renderNode: (locale: BusinessLocale) => React.ReactElement,
) {
  for (const locale of LOCALES) {
    stubBrowserStorage(locale);
    const html = renderToStaticMarkup(
      <PreferencesProvider>{renderNode(locale)}</PreferencesProvider>,
    );
    assertCleanMarkup(html, `${label} [${locale}]`);
  }
}

describe('All-Screens Business View Vocabulary Guard (#74)', () => {
  const initialWorkbench = { ...useWorkbenchStore.getInitialState() };
  const initialPanel = { ...useAgentPanelStore.getInitialState() };
  const initialSelection = { ...usePrototypeSelectionStore.getInitialState() };

  afterEach(() => {
    vi.unstubAllGlobals();
    useWorkbenchStore.setState({
      data: initialWorkbench.data,
      loading: initialWorkbench.loading,
      activeNav: initialWorkbench.activeNav,
      activeItemId: initialWorkbench.activeItemId,
      activeSessionId: initialWorkbench.activeSessionId,
      liveSessionDrafts: {},
      sessionQueues: {},
      highlightedBusinessModelTarget: null,
      historyDrawerArtifactKind: null,
    });
    Object.assign(useWorkbenchStore.getInitialState(), initialWorkbench);
    useAgentPanelStore.setState(initialPanel);
    Object.assign(useAgentPanelStore.getInitialState(), initialPanel);
    usePrototypeSelectionStore.setState(initialSelection);
    Object.assign(usePrototypeSelectionStore.getInitialState(), initialSelection);
  });

  it('1. Top-bar WorkbenchShell across Home and all 4 steps (blocked subtitles, active run indicator, SecondaryMoreMenu, and health pill with errors, warnings, and clean states)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      const emptyProj = store.createProject({
        name: '冷链入库验收系统',
        code: 'COLD-CHAIN-74',
        domain: '冷链仓储管理',
        template: 'EMPTY',
      });

      const contractBoot = await fetchBootstrap(app, 'proj-contract');
      const mftBoot = await fetchBootstrap(app, 'proj-mft');
      const emptyBoot = await fetchBootstrap(app, emptyProj.id);

      // Home shell
      seedWorkbenchState({ loading: false, activeNav: 'overview', data: contractBoot });
      renderInBothLocales('WorkbenchShell Home (overview)', () => <WorkbenchShell />);

      // Full WorkbenchShell across all 4 steps on seeded proj-contract (clean health pill) & proj-mft (warning health pill + blocked steps) & empty project (blocked banner)
      for (const [projLabel, boot] of [
        ['proj-contract (clean)', contractBoot],
        ['proj-mft (warnings + blocked)', mftBoot],
        ['proj-empty (blocked steps)', emptyBoot],
      ] as const) {
        for (const stepId of PROJECT_STEP_IDS) {
          const navView: NavViewId = getDefaultViewForStep(stepId);
          seedWorkbenchState({ loading: false, activeNav: navView, data: boot });
          renderInBothLocales(`WorkbenchShell ${projLabel} step=${stepId}`, () => (
            <WorkbenchShell />
          ));
        }
      }

      // Compact (<1280px) shell in both Conversation and Canvas panes + active running indicator pill
      const brokenSuite: OntologySuite = structuredClone(CONTRACT_LIFECYCLE_SUITE);
      brokenSuite.M2!.behaviors[0]!.ownerEntity = 'MissingAggregateRef';
      store.updateSuite('proj-contract', brokenSuite, 'Introduce error for health pill');
      const errorBoot = await fetchBootstrap(app, 'proj-contract');

      seedWorkbenchState({
        loading: false,
        activeNav: 'app-ontology',
        data: errorBoot,
        liveSessionDrafts: {
          'live-sess-74': {
            runId: 'run-live-74',
            sessionId: 'live-sess-74',
            userPrompt: '整理合同审批规则',
            startedAt: FIXED_NOW,
            liveStatus: { zh: '正在检查业务规则…', en: 'Checking business rules…' },
            thinking: '',
            text: '',
            steps: [],
          },
        },
      });
      renderInBothLocales('WorkbenchShell error health pill + running indicator', () => (
        <WorkbenchShell />
      ));
      renderInBothLocales('WorkbenchShell compact canvas', () => (
        <WorkbenchShell compactWorkspaceOverride />
      ));
      renderInBothLocales('SecondaryMoreMenu trigger', () => (
        <SecondaryMoreMenu
          activeArea={null}
          activeView="overview"
          onSelectArea={noop}
          onSelectSettings={noop}
        />
      ));
    } finally {
      store.close();
    }
  });

  it('2. Home (OverviewSessionsView): first-use empty state (3 examples) and populated multi-project list across step states', async () => {
    const emptyStore = createWorkspaceStore({
      dbPath: ':memory:',
      enableFileMirror: false,
      seedProjects: false,
    });
    const emptyApp = createApiApp(emptyStore);
    try {
      const firstUseBoot = await fetchBootstrap(emptyApp);
      seedWorkbenchState({ loading: false, activeNav: 'overview', data: firstUseBoot });
      renderInBothLocales('Home first-use empty state (3 examples)', () => (
        <OverviewSessionsView onNavigate={noop} />
      ));
    } finally {
      emptyStore.close();
    }

    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      // Create additional projects exercising NOT_STARTED, CONFIRMED, and raw jargon sanitization
      const p1 = store.createProject({
        name: '供应商准入系统',
        code: 'SUP-HOME-74',
        domain: '采购管理',
        description: 'Imported from M1 YAML & SQL DDL (AGG-01)',
        template: 'EMPTY',
      });
      store.saveRequirementDoc({
        id: `rdoc-${p1.id}`,
        projectId: p1.id,
        title: '供应商准入需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: '# 供应商准入需求\n\n## 1. 范围\n- 资质初审与年度复评。',
      });
      store.confirmRequirementsStep(p1.id, { docId: `rdoc-${p1.id}` });

      store.createProject({
        name: '售后工单中心',
        code: 'AFTER-SALES-74',
        domain: '客户服务',
        template: 'EMPTY',
      });

      const populatedBoot = await fetchBootstrap(app);
      seedWorkbenchState({ loading: false, activeNav: 'overview', data: populatedBoot });
      renderInBothLocales('Home populated multi-project list', () => (
        <OverviewSessionsView onNavigate={noop} />
      ));
    } finally {
      store.close();
    }
  });

  it('3. Requirements (RequirementsStepView & ApprovalCard): empty, forming outline, draft doc, UNCONFIRMED_CHANGES, CONFIRMED, and ApprovalCard open/collapsed', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      // Seeded proj-contract (CONFIRMED) & proj-mft
      for (const projectId of ['proj-contract', 'proj-mft'] as const) {
        const boot = await fetchBootstrap(app, projectId);
        seedWorkbenchState({ loading: false, activeNav: 'app-requirements', data: boot });
        renderInBothLocales(`RequirementsStepView seeded ${projectId}`, () => (
          <RequirementsStepView onNavigate={noop} />
        ));
      }

      const proj = store.createProject({
        name: '园区访客管理系统',
        code: 'VISITOR-74',
        domain: '园区安防',
        template: 'EMPTY',
      });

      // Empty NOT_STARTED
      seedWorkbenchState({
        loading: false,
        activeNav: 'app-requirements',
        data: await fetchBootstrap(app, proj.id),
      });
      renderInBothLocales('RequirementsStepView NOT_STARTED empty', () => (
        <RequirementsStepView onNavigate={noop} />
      ));

      // Forming outline (IN_PROGRESS with domain signals containing raw model codes/IDs)
      store.createAgentSession({
        projectId: proj.id,
        agentKind: 'REQUIREMENT',
        title: '访客需求整理',
        initialMessages: [
          {
            id: 'u1',
            role: 'user',
            content: '访客入园需被访人确认，重点研发区需安保负责人加签',
            timestamp: '2026-11-17T09:00:00Z',
          },
          {
            id: 'a1',
            role: 'assistant',
            content: '已整理关键业务对象与规则。',
            timestamp: '2026-11-17T09:00:03Z',
            artifacts: [
              {
                kind: 'REQUIREMENT_HINTS',
                aggregates: ['访客预约单 (AGG-01)', '门禁授权记录 (ENT-02)'],
                rules: ['RULE-01: 重点研发区需安保负责人审批 (M3)'],
                decisions: ['[已确认] 普通办公区由被访员工确认放行'],
                openQuestions: ['[待确认] 外部施工车辆是否纳入同一流程？'],
              },
            ],
          },
        ],
      });
      seedWorkbenchState({
        loading: false,
        activeNav: 'app-requirements',
        data: await fetchBootstrap(app, proj.id),
      });
      renderInBothLocales('RequirementsStepView IN_PROGRESS forming outline', () => (
        <RequirementsStepView onNavigate={noop} />
      ));

      // Draft RequirementDoc (IN_PROGRESS)
      store.saveRequirementDoc({
        id: 'rdoc-vis-74',
        projectId: proj.id,
        title: '园区访客管理系统需求文档 (SRS.md / M1-M6)',
        version: 'v1.0',
        status: 'DRAFT',
        content: [
          '# 园区访客管理系统需求文档',
          '',
          '## 1. 业务目标',
          '- 实现访客预约、审批与门禁通行闭环。',
          '',
          '## 2. 核心业务对象 (M1 / AGG-01)',
          '- **访客预约单 (AGG-01)**：登记访客姓名、来访事由与有效期。',
        ].join('\n'),
      });
      seedWorkbenchState({
        loading: false,
        activeNav: 'app-requirements',
        data: await fetchBootstrap(app, proj.id),
      });
      renderInBothLocales('RequirementsStepView IN_PROGRESS draft doc', () => (
        <RequirementsStepView onNavigate={noop} />
      ));

      // CONFIRMED -> edit -> UNCONFIRMED_CHANGES
      store.confirmRequirementsStep(proj.id, { docId: 'rdoc-vis-74' });
      seedWorkbenchState({
        loading: false,
        activeNav: 'app-requirements',
        data: await fetchBootstrap(app, proj.id),
      });
      renderInBothLocales('RequirementsStepView CONFIRMED', () => (
        <RequirementsStepView onNavigate={noop} />
      ));

      store.saveRequirementDoc({
        id: 'rdoc-vis-74',
        projectId: proj.id,
        title: '园区访客管理系统需求文档',
        version: 'v1.1',
        status: 'DRAFT',
        content: [
          '# 园区访客管理系统需求文档',
          '',
          '## 1. 业务目标',
          '- 实现访客预约、审批与门禁通行闭环。',
          '',
          '## 2. 核心业务对象',
          '- **访客预约单**：登记访客姓名、随行车牌号与有效期。',
        ].join('\n'),
      });
      seedWorkbenchState({
        loading: false,
        activeNav: 'app-requirements',
        data: await fetchBootstrap(app, proj.id),
      });
      renderInBothLocales('RequirementsStepView UNCONFIRMED_CHANGES', () => (
        <RequirementsStepView onNavigate={noop} />
      ));

      // ApprovalCard open & collapsed
      renderInBothLocales('ApprovalCard open (unanswered)', (locale) => (
        <ApprovalCard
          prompt={{
            id: 'ask-74',
            question:
              locale === 'en-US'
                ? 'Who gives final approval for contracts above 1,000,000 CNY?'
                : '超过 100 万元的采购合同由谁最终审批？',
            options:
              locale === 'en-US'
                ? ['Legal Director alone', 'Joint approval by Legal and Finance Directors']
                : ['法务总监单独审批', '法务总监与财务总监会签'],
            answered: false,
          }}
          onSubmit={noop}
        />
      ));
      renderInBothLocales('ApprovalCard collapsed (answered)', (locale) => (
        <ApprovalCard
          prompt={{
            id: 'ask-74',
            question:
              locale === 'en-US'
                ? 'Who gives final approval for contracts above 1,000,000 CNY?'
                : '超过 100 万元的采购合同由谁最终审批？',
            options:
              locale === 'en-US'
                ? ['Legal Director alone', 'Joint approval by Legal and Finance Directors']
                : ['法务总监单独审批', '法务总监与财务总监会签'],
            answered: true,
            selectedAnswers: [
              locale === 'en-US'
                ? 'Joint approval by Legal and Finance Directors'
                : '法务总监与财务总监会签',
            ],
          }}
        />
      ));
    } finally {
      store.close();
    }
  });

  it('4. Prototype (PrototypeStudioView): blocked, Briefing (References, Brief, Style Tile, Motion), Canvas, Screen Changes modal, History/Compare, Selection strip, and OUTDATED', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      // Blocked state on proj-mft (no confirmed Requirements)
      const mftBoot = await fetchBootstrap(app, 'proj-mft');
      seedWorkbenchState({ loading: false, activeNav: 'app-prototype', data: mftBoot });
      renderInBothLocales('PrototypeStudioView blocked (proj-mft)', () => (
        <PrototypeStudioView onNavigate={noop} />
      ));

      // Briefing Stage (confirm Requirements on a new project -> REFERENCES, FEEL, MOTION)
      const briefProj = store.createProject({
        name: '门店巡检系统',
        code: 'STORE-INSPECT-74',
        domain: '连锁门店运营',
        template: 'EMPTY',
      });
      store.saveRequirementDoc({
        id: 'rdoc-inspect-74',
        projectId: briefProj.id,
        title: '门店巡检需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: '# 门店巡检需求\n\n## 1. 核心业务\n- 巡检计划派发、问题整改与复核归档。',
      });
      store.confirmRequirementsStep(briefProj.id, { docId: 'rdoc-inspect-74' });
      const briefBoot = await fetchBootstrap(app, briefProj.id);
      seedWorkbenchState({ loading: false, activeNav: 'app-prototype', data: briefBoot });

      for (const briefTab of ['REFERENCES', 'FEEL', 'MOTION'] as const) {
        renderInBothLocales(`PrototypeStudioView Briefing tab=${briefTab}`, () => (
          <PrototypeStudioView onNavigate={noop} defaultBriefStep={briefTab} />
        ));
      }

      // Canvas Stage on seeded proj-contract (CONFIRMED + History open)
      const contractBoot = await fetchBootstrap(app, 'proj-contract');
      seedWorkbenchState({ loading: false, activeNav: 'app-prototype', data: contractBoot });
      renderInBothLocales('PrototypeStudioView Canvas CONFIRMED + History', () => (
        <PrototypeStudioView onNavigate={noop} defaultHistoryOpen />
      ));

      // Append unconfirmed revision R2 on proj-contract -> UNCONFIRMED_CHANGES + Pre-confirmation Screen Changes modal + Side-by-side Compare + Post-run banner + Selection strip
      const baseProto = store.listPrototypes('proj-contract')[0]!;
      const rev1 = baseProto.revisions[0]!;
      const appended = store.appendPrototypeRevision(baseProto.id, {
        htmlContent: `${baseProto.htmlContent}\n<section data-screen-id="SCR-CONTRACT-ARCHIVE" data-screen-name="合同原件归档登记" data-screen-type="FORM"><input data-element-id="EL-CABINET-NO" data-element-label="归档柜号" data-binding="Contract.cabinetNo" /><button data-element-id="EL-SUBMIT-ARCHIVE" data-element-label="确认归档" data-element-type="BUTTON" data-action-type="SUBMIT" data-event-id="UIE-ARCHIVE" data-behavior-ref="BHV-01">确认归档</button></section>`,
        title: '补充合同原件归档登记页 (界面原型.html)',
        source: 'AGENT_RUN',
      });
      const unconfirmedBoot = await fetchBootstrap(app, 'proj-contract');
      seedWorkbenchState({ loading: false, activeNav: 'app-prototype', data: unconfirmedBoot });
      renderInBothLocales('PrototypeStudioView Canvas UNCONFIRMED_CHANGES', () => (
        <PrototypeStudioView onNavigate={noop} />
      ));

      renderInBothLocales('ConfirmRevisionMuDiffModal (Pre-confirmation Screen Changes)', () => (
        <ConfirmRevisionMuDiffModal
          open
          revision={appended.revision}
          prototypeName={appended.prototype.name}
          confirmedRevision={unconfirmedBoot.confirmedPrototypeRevision}
          suite={unconfirmedBoot.activeProject.suite}
          domain={unconfirmedBoot.activeProject.domain}
          onConfirm={noop}
          onClose={noop}
        />
      ));

      const compareState = createInitialRevisionHistoryViewState(appended.prototype, {
        comparePair: { leftRevisionId: rev1.id, rightRevisionId: appended.revision.id },
      });
      renderInBothLocales('PrototypeRevisionHistoryDrawer side-by-side compare', () => (
        <PrototypeRevisionHistoryDrawer
          open
          prototype={appended.prototype}
          confirmedRevision={unconfirmedBoot.confirmedPrototypeRevision}
          domain={unconfirmedBoot.activeProject.domain}
          viewMode="business"
          viewState={compareState}
          onSelectPreviewRevision={noop}
          onRestoreRevision={noop}
          onUndoLatestRevision={noop}
          onRenameRevision={noop}
          onToggleStarRevision={noop}
          onRequestConfirmRevision={noop}
        />
      ));

      usePrototypeSelectionStore.setState({
        attachmentsByPrototype: {
          [baseProto.id]: [
            {
              id: 'sel-74',
              prototypeId: baseProto.id,
              target: {
                kind: 'ELEMENT',
                tagName: 'input',
                cssSelector: '[data-element-id="EL-CABINET-NO"]',
                screenId: 'SCR-CONTRACT-ARCHIVE',
                elementId: 'EL-CABINET-NO',
                label: '归档柜号输入框 (EL-CABINET-NO)',
                textPreview: '归档柜号',
                htmlSnippet: '<input data-element-id="EL-CABINET-NO" />',
                rect: { x: 12, y: 24, width: 240, height: 36 },
              },
              anchor: {
                screenId: 'SCR-CONTRACT-ARCHIVE',
                elementId: 'EL-CABINET-NO',
                label: '归档柜号输入框',
              },
              semanticLabel: '归档柜号输入框',
              note: '移到顶部筛选区右侧',
              imageRef: {
                id: 'img-sel-74',
                name: '归档柜号区域截图',
                mimeType: 'image/png',
                source: 'local',
                role: 'selection_crop',
                width: 320,
                height: 120,
              },
              createdAt: '2026-11-17T10:00:00Z',
            },
          ],
        },
      });
      Object.assign(
        usePrototypeSelectionStore.getInitialState(),
        usePrototypeSelectionStore.getState(),
      );
      renderInBothLocales('SelectionAttachmentStrip with element anchor', () => (
        <SelectionAttachmentStrip prototypeId={baseProto.id} />
      ));

      renderInBothLocales('PrototypePostRunBanner', () => (
        <PrototypePostRunBanner
          review={{
            prototypeId: baseProto.id,
            revision: appended.revision,
            previousRevision: rev1,
            modifiedAnchors: [
              {
                screenId: 'SCR-CONTRACT-ARCHIVE',
                elementId: 'EL-CABINET-NO',
                label: '归档柜号输入框 (SCR-CONTRACT-ARCHIVE)',
              },
            ],
          }}
          mode="AFTER"
          onModeChange={noop}
          onRevert={noop}
          onDismiss={noop}
        />
      ));

      // Confirm R2, then re-confirm Requirements -> Prototype becomes OUTDATED
      store.confirmPrototypeRevision('proj-contract', appended.revision.id);
      const reqDoc = store.listRequirementDocs('proj-contract')[0]!;
      store.saveRequirementDoc({
        id: reqDoc.id,
        projectId: 'proj-contract',
        title: reqDoc.title,
        version: 'v2.0',
        status: 'DRAFT',
        content: `${reqDoc.content}\n\n## 补充条款\n- 增加电子签章回执编号留存要求。`,
      });
      store.confirmRequirementsStep('proj-contract', { docId: reqDoc.id });
      const outdatedBoot = await fetchBootstrap(app, 'proj-contract');
      seedWorkbenchState({ loading: false, activeNav: 'app-prototype', data: outdatedBoot });
      renderInBothLocales('PrototypeStudioView OUTDATED', () => (
        <PrototypeStudioView onNavigate={noop} />
      ));
    } finally {
      store.close();
    }
  });

  it('5. Business Model (BusinessModelStepView): blocked, empty, every Business Object (collapsed & all sections expanded) & 3 cross-views in CONTRACT + MFT, other group, problems, incomplete parts (expanded), inline-edit rejection, OUTDATED, and CONFIRMED', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      // Blocked & Empty states
      const emptyProj = store.createProject({
        name: '资产领用系统',
        code: 'ASSET-CLAIM-74',
        domain: '行政资产',
        template: 'EMPTY',
      });
      seedWorkbenchState({
        loading: false,
        activeNav: 'app-ontology',
        data: await fetchBootstrap(app, emptyProj.id),
      });
      renderInBothLocales('BusinessModelStepView blocked empty', () => (
        <BusinessModelStepView viewModeOverride="business" onNavigate={noop} />
      ));

      // Every Business Object page (both default-collapsed AND all collapsible sections expanded!) + all 3 cross-object views on REAL seeded proj-contract AND proj-mft
      for (const [projId, suite] of [
        ['proj-contract', CONTRACT_LIFECYCLE_SUITE],
        ['proj-mft', MFT_ENTERPRISE_SUITE],
      ] as const) {
        const boot = await fetchBootstrap(app, projId);
        seedWorkbenchState({ loading: false, activeNav: 'app-ontology', data: boot });
        const projection = projectByBusinessObject(suite);

        for (const obj of projection.objects) {
          renderInBothLocales(
            `BusinessModel ${projId} object=${obj.id} (${obj.name}) [default-collapsed]`,
            () => (
              <BusinessModelStepView
                activePageId={obj.id}
                viewModeOverride="business"
                onNavigate={noop}
              />
            ),
          );
          renderInBothLocales(
            `BusinessModel ${projId} object=${obj.id} (${obj.name}) [all-expanded]`,
            () => (
              <BusinessModelStepView
                activePageId={obj.id}
                viewModeOverride="business"
                defaultExpandedSections={[...DEFAULT_COLLAPSED_OBJECT_SECTIONS]}
                defaultShowIncomplete
                onNavigate={noop}
              />
            ),
          );
        }

        for (const crossId of BUSINESS_MODEL_CROSS_VIEW_IDS) {
          renderInBothLocales(`BusinessModel ${projId} crossView=${crossId}`, () => (
            <BusinessModelStepView
              activePageId={crossId}
              viewModeOverride="business"
              defaultShowIncomplete
              onNavigate={noop}
            />
          ));
        }
      }

      // CONFIRMED state on proj-contract
      store.confirmBusinessModelStep('proj-contract');
      seedWorkbenchState({
        loading: false,
        activeNav: 'app-ontology',
        data: await fetchBootstrap(app, 'proj-contract'),
      });
      renderInBothLocales('BusinessModelStepView CONFIRMED', () => (
        <BusinessModelStepView viewModeOverride="business" onNavigate={noop} />
      ));

      // OUTDATED state (after Prototype re-confirmation)
      const proto = store.listPrototypes('proj-contract')[0]!;
      const nextRev = store.appendPrototypeRevision(proto.id, {
        htmlContent: `${proto.htmlContent}\n<!-- layout adjustment -->`,
        title: '微调列表留白',
        source: 'MANUAL_SAVE',
      });
      store.confirmPrototypeRevision('proj-contract', nextRev.revision.id);
      seedWorkbenchState({
        loading: false,
        activeNav: 'app-ontology',
        data: await fetchBootstrap(app, 'proj-contract'),
      });
      renderInBothLocales('BusinessModelStepView OUTDATED', () => (
        <BusinessModelStepView viewModeOverride="business" onNavigate={noop} />
      ));

      // Other unassigned group + Consistency Errors ("需要修正的问题") + Stage Warnings ("尚未完成的部分" expanded) + inline-edit rejection banner
      const edgeSuite: OntologySuite = structuredClone(CONTRACT_LIFECYCLE_SUITE);
      delete edgeSuite.MI;
      edgeSuite.M2!.behaviors[0]!.ownerEntity = 'NonExistentAggregate';
      edgeSuite.M1!.data_dictionaries.push({
        id: 'DICT-GLOBAL-REGION',
        name: '大区归属字典',
        description: '全国销售与采购大区划分',
        types: [
          {
            typeCode: 'REGION',
            typeName: '业务大区',
            items: [{ code: 'EAST', label: '华东区', enabled: true, sortOrder: 1 }],
          },
        ],
      });
      store.updateSuite('proj-contract', edgeSuite, 'Edge states for guard');
      seedWorkbenchState({
        loading: false,
        activeNav: 'app-ontology',
        data: await fetchBootstrap(app, 'proj-contract'),
      });

      renderInBothLocales(
        'BusinessModelStepView other group + errors + incomplete expanded',
        () => (
          <BusinessModelStepView
            activePageId="view:other"
            viewModeOverride="business"
            defaultShowIncomplete
            onNavigate={noop}
          />
        ),
      );

      renderInBothLocales('BusinessModelStepView inline-edit rejection banner', () => (
        <BusinessModelStepView
          activePageId="AGG-02"
          viewModeOverride="business"
          initialRejectionState={{
            slotKey: 'object-name-AGG-02',
            reasonZh:
              '已经存在同名的「合同」，直接改成相同名称会产生需要修正的问题；请交给 AI 助手同步调整。',
            reasonEn:
              'Another item is already named "Contract", so renaming directly would create problems to fix; let AI Assistant coordinate the update.',
            assistantPromptZh: '请帮我合并签约相对方与合同的名称调整。',
            assistantPromptEn: 'Please help coordinate renaming Counterparty.',
          }}
          onNavigate={noop}
        />
      ));
    } finally {
      store.close();
    }
  });

  it('6. Delivery (DeliveryStepView & RunnableSystemSlot): NOT_STARTED, IN_PROGRESS, CONFIRMED (with Package, Skill, and Published Release), OUTDATED, and RunnableSystemSlot in all 3 states', async () => {
    const slotStates: readonly RunnableSystemSlotState[] = [
      { status: 'UNAVAILABLE', openUrl: null },
      { status: 'PREPARING', openUrl: null },
      { status: 'READY', openUrl: 'https://system.example.com/contracts' },
    ];
    for (const slotState of slotStates) {
      renderInBothLocales(`RunnableSystemSlot status=${slotState.status}`, () => (
        <RunnableSystemSlot state={slotState} />
      ));
    }

    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      // 1. NOT_STARTED on proj-mft (Business Model not yet confirmed)
      seedWorkbenchState({
        loading: false,
        activeNav: 'app-assembly-dev',
        data: await fetchBootstrap(app, 'proj-mft'),
      });
      renderInBothLocales('DeliveryStepView NOT_STARTED (proj-mft)', () => (
        <DeliveryStepView viewModeOverride="business" onNavigate={noop} />
      ));

      // 2. IN_PROGRESS on seeded proj-contract (confirm Business Model first; proj-contract already has seeded Skill & Application)
      store.confirmBusinessModelStep('proj-contract');
      seedWorkbenchState({
        loading: false,
        activeNav: 'app-assembly-dev',
        data: await fetchBootstrap(app, 'proj-contract'),
      });
      renderInBothLocales('DeliveryStepView IN_PROGRESS (proj-contract)', () => (
        <DeliveryStepView viewModeOverride="business" onNavigate={noop} />
      ));

      // 3. CONFIRMED on proj-contract with real compiled DevelopmentPackageSnapshot, generated OntologySkill, AND Published Release
      const compileRes = await app.request('/api/projects/proj-contract/compile-package', {
        method: 'POST',
      });
      expect(compileRes.status).toBe(200);
      const { application } = (await compileRes.json()) as { application: { id: string } };

      const skillRes = await app.request('/api/projects/proj-contract/generate-skill', {
        method: 'POST',
      });
      expect(skillRes.status).toBe(200);

      const publishRes = await app.request(`/api/applications/${application.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(publishRes.status).toBe(200);

      seedWorkbenchState({
        loading: false,
        activeNav: 'app-assembly-dev',
        data: await fetchBootstrap(app, 'proj-contract'),
      });
      renderInBothLocales(
        'DeliveryStepView CONFIRMED (Package + Skill + Published Release)',
        () => <DeliveryStepView viewModeOverride="business" onNavigate={noop} />,
      );

      // 4. OUTDATED after Business Model edit & re-confirmation
      const nextSuite: OntologySuite = structuredClone(CONTRACT_LIFECYCLE_SUITE);
      nextSuite.M1!.aggregates[0]!.description = '支持合同起草、审批会签、归档与结算闭环';
      store.updateSuite('proj-contract', nextSuite, 'Update Contract description');
      store.confirmBusinessModelStep('proj-contract');
      seedWorkbenchState({
        loading: false,
        activeNav: 'app-assembly-dev',
        data: await fetchBootstrap(app, 'proj-contract'),
      });
      renderInBothLocales('DeliveryStepView OUTDATED', () => (
        <DeliveryStepView viewModeOverride="business" onNavigate={noop} />
      ));
    } finally {
      store.close();
    }
  });

  it('7. AI Assistant (ShellAgentPanel, History Menu open, Running progress, Requirements/Prototype/Business-Model Change Summaries, ArtifactHistoryDrawer, StepHandoffCard, Failures & Platform Notices)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const app = createApiApp(store);
    try {
      // A) Seeded ShellAgentPanel on proj-contract & proj-mft across all 4 steps WITH History Menu open!
      for (const projectId of ['proj-contract', 'proj-mft'] as const) {
        const boot = await fetchBootstrap(app, projectId);
        for (const stepId of PROJECT_STEP_IDS) {
          const navView = getDefaultViewForStep(stepId);
          const surface = agentPanelSurfaceFor(navView)!;
          seedWorkbenchState({
            loading: false,
            activeNav: navView,
            data: boot,
          });
          renderInBothLocales(
            `ShellAgentPanel seeded ${projectId} step=${stepId} (History Menu open)`,
            () => (
              <ShellAgentPanel
                surface={surface}
                overlay={false}
                side="left"
                closable={false}
                defaultHistoryOpen
                onClose={noop}
                onNavigate={noop}
              />
            ),
          );
        }
      }

      // B) Real mutating & conversational Mock LLM runs across Requirements, Prototype, and Business Model + ArtifactHistoryDrawer
      const reqSess = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'REQUIREMENT',
        title: '补充合同归档需求',
      });
      await (
        await app.request(`/api/agent-sessions/${reqSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '我想做一个合同管理系统：管理供应商准入、合同起草会签、盖章归档与付款结算。',
            mockMode: true,
          }),
        })
      ).text();
      await (
        await app.request(`/api/agent-sessions/${reqSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '[ACTION:SYNTHESIZE_SRS {}]\n请整理合同归档需求文档',
            mockMode: true,
          }),
        })
      ).text();

      const proto = store.listPrototypes('proj-contract')[0]!;
      const htmlNamedProto = store.createPrototype('proj-contract', {
        name: '合同审批界面原型.html',
        htmlContent: proto.htmlContent,
      });
      await app.request(
        `/api/projects/proj-contract/prototypes/${htmlNamedProto.prototype.id}/co-design-session`,
        { method: 'POST' },
      );
      const protoSessRes = await app.request(
        `/api/projects/proj-contract/prototypes/${proto.id}/co-design-session`,
        { method: 'POST' },
      );
      const { session: protoSess } = (await protoSessRes.json()) as { session: { id: string } };
      await (
        await app.request(`/api/agent-sessions/${protoSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: [
              '【已确认设计简报 · 生成首版可交互原型 Revision #1】',
              '关联需求规格说明书 (SRS)：《合同管理系统 — 需求规格说明书 (需求规格说明书.md v5.0)》(v5.0)',
              '【二、Inspo 主参考站点设计令牌 (DESIGN.md)】',
              '- Source: https://amie.so',
              '【五、MU 语义锚点与三端响应式硬性契约】',
              '1. 输出完整单文件可运行 HTML5 交互原型（M1~M7, AGG-01）。',
            ].join('\n'),
            mockMode: true,
          }),
        })
      ).text();
      await (
        await app.request(`/api/agent-sessions/${protoSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt:
              '[PROTOTYPE_BRIEF_RESTYLE] 按新简报重做风格\n【五、MU 语义锚点与三端响应式硬性契约】\n输出 HTML5 与 CSS 样式。',
            mockMode: true,
          }),
        })
      ).text();
      await (
        await app.request(`/api/agent-sessions/${protoSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: '增加借阅状态筛选框', mockMode: true }),
        })
      ).text();

      const bmSess = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'COPILOT',
        title: '新增提交审批操作',
      });
      await (
        await app.request(`/api/agent-sessions/${bmSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {}]\n根据已确认的原型生成业务模型',
            mockMode: true,
          }),
        })
      ).text();
      await (
        await app.request(`/api/agent-sessions/${bmSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '请在合同上新增业务操作『提交审批』',
            mockMode: true,
          }),
        })
      ).text();

      const mutatedBoot = await fetchBootstrap(app, 'proj-contract');

      for (const [label, navView, sessionId] of [
        ['Requirements Change Summary', 'app-requirements', reqSess.id],
        ['Prototype Change Summary', 'app-prototype', protoSess.id],
        ['Business Model Change Summary', 'app-ontology', bmSess.id],
      ] as const) {
        seedWorkbenchState({
          loading: false,
          activeNav: navView,
          activeSessionId: sessionId,
          data: mutatedBoot,
        });
        renderInBothLocales(`ShellAgentPanel ${label}`, () => (
          <ShellAgentPanel
            surface={agentPanelSurfaceFor(navView)!}
            overlay={false}
            side="left"
            closable={false}
            defaultHistoryOpen
            onClose={noop}
            onNavigate={noop}
          />
        ));
      }

      // ArtifactHistoryDrawer open for all 3 artifact kinds
      for (const [kind, zhLabel, enLabel] of [
        ['REQUIREMENTS_DOC', '需求文档', 'Requirements Document'],
        ['PROTOTYPE', '界面原型', 'Prototype'],
        ['ONTOLOGY_SUITE', '业务模型', 'Business Model'],
      ] as const) {
        const entries = (mutatedBoot.artifactHistory ?? []).filter((e) => e.artifactKind === kind);
        expect(entries.length).toBeGreaterThan(0);
        renderInBothLocales(`ArtifactHistoryDrawer kind=${kind}`, () => (
          <ArtifactHistoryDrawer
            open
            onOpenChange={noop}
            artifactLabel={{ zh: zhLabel, en: enLabel }}
            entries={entries}
            onUndoLatest={noop}
            onRestoreBefore={noop}
          />
        ));
        renderInBothLocales(`ChangeSummaryCard undone badge kind=${kind}`, () => (
          <ChangeSummaryCard
            summary={{ ...entries[0]!.changeSummary, canUndo: false, isUndone: true }}
            onOpenHistory={noop}
          />
        ));
      }

      // C) Running progress lines (with overflow count & queued prompts), StepHandoffCard (PENDING, ACCEPTED, DECLINED), Generic Failure, Cancelled, and Platform-Unavailable notices
      const runningRun: AgentRunView = {
        id: 'run-progress-74',
        userPrompt: '在合同上补充超额双签规则并更新审批流程',
        title: { zh: '更新业务模型', en: 'Update Business Model' },
        status: 'RUNNING',
        liveStatus: { zh: '正在更新业务规则…', en: 'Updating business rules…' },
        startedAt: FIXED_NOW - 12_000,
        steps: [
          {
            id: 'st-1',
            label: {
              zh: formatToolProgressLine('read_ontology_model', { modelCode: 'M1' }, 'zh-CN'),
              en: formatToolProgressLine('read_ontology_model', { modelCode: 'M1' }, 'en-US'),
            },
            status: 'DONE',
            toolName: 'read_ontology_model',
          },
          {
            id: 'st-2',
            label: {
              zh: formatToolProgressLine(
                'upsert_aggregate',
                { name: 'Contract', label: '合同' },
                'zh-CN',
              ),
              en: formatToolProgressLine(
                'upsert_aggregate',
                { name: 'Contract', label: 'Contract' },
                'en-US',
              ),
            },
            status: 'DONE',
            toolName: 'upsert_aggregate',
          },
          {
            id: 'st-3',
            label: {
              zh: formatToolProgressLine('upsert_behavior', { name: '提交会签' }, 'zh-CN'),
              en: formatToolProgressLine(
                'upsert_behavior',
                { name: 'Submit Joint Review' },
                'en-US',
              ),
            },
            status: 'DONE',
            toolName: 'upsert_behavior',
          },
          {
            id: 'st-4',
            label: {
              zh: formatToolProgressLine('upsert_rule', { name: '超额合同双签规则' }, 'zh-CN'),
              en: formatToolProgressLine(
                'upsert_rule',
                { name: 'High-Value Dual Approval Rule' },
                'en-US',
              ),
            },
            status: 'DONE',
            toolName: 'upsert_rule',
          },
          {
            id: 'st-5',
            label: {
              zh: formatToolProgressLine('validate_suite', {}, 'zh-CN'),
              en: formatToolProgressLine('validate_suite', {}, 'en-US'),
            },
            status: 'RUNNING',
            toolName: 'validate_suite',
          },
        ],
      };

      const genericFailedRun: AgentRunView = {
        id: 'run-generic-fail-74',
        userPrompt: '修改合同编号规则',
        title: { zh: '修改业务规则', en: 'Update Business Rule' },
        status: 'FAILED',
        liveStatus: { zh: '处理失败', en: 'Failed' },
        startedAt: FIXED_NOW - 8_000,
        completedAt: FIXED_NOW,
        steps: [],
        failure: {
          code: 'TOOL_VALIDATION_REJECTED',
          message: 'Rule expression references unknown field AGG-99 in M3 YAML',
        },
      };

      const platformFailedRun: AgentRunView = {
        id: 'run-platform-fail-74',
        userPrompt: '重新生成采购合同审批界面',
        title: { zh: '生成原型', en: 'Generate Prototype' },
        status: 'FAILED',
        liveStatus: { zh: '服务暂不可用', en: 'Service unavailable' },
        startedAt: FIXED_NOW - 15_000,
        completedAt: FIXED_NOW,
        steps: [],
        failure: {
          code: 'LLM_GATEWAY_ERROR',
          statusCode: 502,
          providerName: 'Corp Gateway',
          baseUrl: 'http://127.0.0.1:9999/v1',
          message: 'HTTP 502 Bad Gateway from http://127.0.0.1:9999/v1',
          remediation: 'Verify gateway endpoint in LLM Center.',
        },
      };

      const visionFallbackRun: AgentRunView = {
        id: 'run-vision-fallback-74',
        userPrompt: '参考这张截图调整筛选栏布局',
        title: { zh: '调整界面布局', en: 'Adjust screen layout' },
        status: 'SUCCEEDED',
        liveStatus: { zh: '已完成', en: 'Done' },
        startedAt: FIXED_NOW - 6_000,
        completedAt: FIXED_NOW,
        steps: [],
        text: '已按你的文字说明调整筛选栏布局。',
        visionFallback: {
          used: true,
          providerName: 'Text-Only Gateway',
          notice: 'Active model does not support multimodal image blocks',
        },
      };

      const cancelledRun: AgentRunView = {
        id: 'run-cancelled-74',
        userPrompt: '生成归档统计报表',
        title: { zh: '生成查询与报表', en: 'Generate Report' },
        status: 'CANCELLED',
        liveStatus: { zh: '已取消', en: 'Cancelled' },
        startedAt: FIXED_NOW - 3_000,
        completedAt: FIXED_NOW,
        steps: [],
      };

      renderInBothLocales(
        'AgentPanel with RUNNING progress, generic failure, platform failure, vision fallback, cancelled, and queue',
        (locale) => (
          <AgentPanel
            title={{ zh: 'AI 助手', en: 'AI Assistant' }}
            subtitle={{ zh: '围绕业务对象整理模型', en: 'Organize your Business Model' }}
            runs={[
              runningRun,
              genericFailedRun,
              platformFailedRun,
              visionFallbackRun,
              cancelledRun,
            ]}
            width={AGENT_PANEL_DEFAULT_WIDTH}
            side="left"
            closable={false}
            onClose={noop}
            onResize={noop}
            onCancelRun={noop}
            onRetryRun={noop}
            onOpenPlatformSettings={noop}
            onSubmitPrompt={noop}
            queuedPrompts={[
              {
                id: 'q-74',
                label:
                  locale === 'en-US'
                    ? 'Add Counterparty credit freeze check'
                    : '补充签约相对方资信冻结检查',
              },
            ]}
            onRemoveQueuedPrompt={noop}
            visionSupported={false}
            visionProviderLabel="Local Gateway"
            visionModelLabel="qwen-text"
            now={FIXED_NOW}
          />
        ),
      );

      // StepHandoffCard in PENDING, ACCEPTED, and DECLINED states (including raw jargon sanitization in request/reason)
      const baseHandoff: StepHandoffProposal = {
        id: 'handoff-74',
        sourceStep: 'PROTOTYPE',
        targetStep: 'BUSINESS_MODEL',
        request: '采购合同金额超过 50 万元时必须经过总经理审批 (M3 / RULE-09)',
        reason: '这条要求属于业务规则 (M3)，需要在业务模型步骤处理',
        status: 'PENDING',
      };
      for (const status of ['PENDING', 'ACCEPTED', 'DECLINED'] as const) {
        renderInBothLocales(`StepHandoffCard status=${status}`, () => (
          <StepHandoffCard
            handoff={{
              ...baseHandoff,
              status,
              ...(status === 'ACCEPTED' ? { targetSessionId: 'sess-bm-74' } : {}),
            }}
            onAccept={noop}
            onDecline={noop}
            onOpenTargetStep={noop}
          />
        ));
      }

      // ConversationThread hosting handoff origin + VisionCapabilityBanner + VisionAttachmentControls
      renderInBothLocales('ConversationThread with handoffFrom origin', (locale) => (
        <ConversationThread
          runs={[
            {
              id: 'run-handoff-dest-74',
              userPrompt:
                locale === 'en-US'
                  ? 'Require General Manager approval for contracts over 500,000 CNY'
                  : '采购合同超过 50 万元需要总经理审批',
              handoffFrom: {
                handoffId: 'handoff-74',
                sourceStep: 'PROTOTYPE',
                sourceSessionId: 'sess-proto-74',
              },
              title: { zh: '新增审批规则', en: 'Add approval rule' },
              status: 'SUCCEEDED',
              liveStatus: { zh: '已完成', en: 'Done' },
              startedAt: FIXED_NOW - 4_000,
              completedAt: FIXED_NOW,
              steps: [],
              text:
                locale === 'en-US'
                  ? 'Added the approval rule on Contract.'
                  : '已在「合同」上补充该条业务规则。',
            },
          ]}
          now={FIXED_NOW}
        />
      ));

      renderInBothLocales('VisionCapabilityBanner & VisionAttachmentControls', () => (
        <div>
          <VisionCapabilityBanner
            visionSupported={false}
            providerLabel="Default Provider"
            modelLabel="text-model-v1"
            onOpenPlatformSettings={noop}
          />
          <VisionAttachmentControls
            attachments={[
              {
                id: 'att-missing-74',
                name: '参考布局草图',
                mimeType: 'image/png',
                source: 'local',
                role: 'user_upload',
              },
            ]}
            onAttachmentsChange={noop}
            visionSupported={false}
            onOpenPlatformSettings={noop}
          />
        </div>
      ));
    } finally {
      store.close();
    }
  });

  it('8. Context Occupancy Ring (<70% & >=70%) and RemovedMessagesNotice pass WITHOUT ignoreTestIds, while ContextInspectorOverlay scopes exemption strictly to context-inspector-drawer (#82)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      const sess = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'REQUIREMENT',
        title: '采购合同审批需求梳理',
        initialMessages: [
          {
            id: 'u-82-1',
            role: 'user',
            content: '采购合同超过 100 万元时需要法务与财务负责人会签',
            timestamp: '2026-11-18T09:00:00.000Z',
          },
          {
            id: 'a-82-1',
            role: 'assistant',
            content: '已记录高额采购合同的法务与财务会签规则。',
            timestamp: '2026-11-18T09:00:02.000Z',
          },
        ],
      });
      const boot = await fetchBootstrap(app, 'proj-contract');
      const reqSurface = agentPanelSurfaceFor('app-requirements')!;

      seedWorkbenchState({
        loading: false,
        activeNav: 'app-requirements',
        activeSessionId: sess.id,
        data: boot,
      });

      const makeCall = (promptTokens: number, excludedCount: number): ModelCallSummary => ({
        id: `mcall-guard-${promptTokens}`,
        projectId: 'proj-contract',
        sessionId: sess.id,
        purpose: 'TURN',
        seq: 3,
        provider: 'Mock',
        model: 'mock-v1',
        contextWindow: 100_000,
        maxOutputTokens: 4096,
        startedAt: '2026-11-18T09:05:00.000Z',
        endedAt: '2026-11-18T09:05:01.000Z',
        durationMs: 1000,
        status: 'COMPLETED',
        usage: {
          promptTokens,
          inputTokens: promptTokens,
          outputTokens: 350,
          cacheReadTokens: 1200,
          cacheWriteTokens: 0,
          totalTokens: promptTokens + 350,
          source: 'PROVIDER',
        },
        estimate: {
          byKind: {
            INSTRUCTIONS: 2000,
            TOOL_GUIDE: 500,
            TOOL_DEFINITION: 1500,
            BUSINESS_CONTEXT: 1500,
            COMPACTED_SUMMARY: 500,
            USER_MESSAGE: 1000,
            ASSISTANT_MESSAGE: 1000,
            TOOL_CALL: 400,
            TOOL_RESULT: 600,
            REASONING: 200,
          },
          inputTokens: 9200,
          outputTokens: 350,
          excludedTokens: excludedCount * 150,
        },
        includedCount: 10,
        excludedCount,
        hasDetail: true,
      });

      const compactEvents: ContextEventSummary[] = [
        {
          id: 'ctxevt-guard-82',
          projectId: 'proj-contract',
          sessionId: sess.id,
          kind: 'COMPACT',
          createdAt: '2026-11-18T09:04:00.000Z',
          removedCount: 6,
          reclaimedTokens: 720,
          summarizedByModel: false,
          afterCallSeq: 2,
        },
      ];

      // 1. Calm (<70%) AND Warning (>=70%) ContextOccupancyRing + RemovedMessagesNotice (compacted, trimmed, and both) MUST pass checkBusinessViewMarkup WITHOUT ignoreTestIds!
      for (const [label, call, events] of [
        ['Ring <70% (42%) + compacted notice', makeCall(42_000, 0), compactEvents],
        ['Ring >=70% (78%) + trimmed notice', makeCall(78_000, 4), []],
        ['Ring >=70% (85%) + compacted & trimmed notice', makeCall(85_000, 3), compactEvents],
      ] as const) {
        renderInBothLocales(`ShellAgentPanel ${label} (unexempted)`, () => (
          <ShellAgentPanel
            surface={reqSurface}
            overlay={false}
            side="left"
            closable={false}
            initialModelCalls={[call]}
            initialContextEvents={events}
            onClose={noop}
            onNavigate={noop}
          />
        ));
      }

      // 2. Open ContextInspectorOverlay containing raw technical snapshot items (M1, AGG-01, YAML):
      //    - Unexempted check catches snapshot internals (proving guard sees inside when not exempted)
      //    - Exempted ONLY by ignoreTestIds: [CONTEXT_INSPECTOR_DRAWER_TEST_ID] passes with 0 violations
      //    - Any violation outside context-inspector-drawer (beside ring & removed notice) is STILL caught!
      const openCall = makeCall(78_000, 2);
      const openCallDetail: ModelCallDetail = {
        ...openCall,
        included: [],
        response: [],
        excluded: [
          {
            blobId: 'blob-guard-ex',
            kind: 'USER_MESSAGE',
            tokens: 160,
            content: 'Raw snapshot message mentioning M1 YAML schema and AGG-01.',
          },
        ],
      };
      const openCompactDetail: ContextEventDetail = {
        ...compactEvents[0]!,
        removed: [
          {
            blobId: 'blob-guard-rm',
            kind: 'ASSISTANT_MESSAGE',
            tokens: 210,
            content: 'Archived turn referencing BHV-01 and t_contract SQL table.',
          },
        ],
      };

      for (const locale of LOCALES) {
        stubBrowserStorage(locale);
        const openHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <ShellAgentPanel
              surface={reqSurface}
              overlay={false}
              side="left"
              closable={false}
              defaultInspectorOpen
              defaultInspectorFocus="removed"
              initialModelCalls={[openCall]}
              initialContextEvents={compactEvents}
              initialLatestCallDetail={openCallDetail}
              initialCompactedEventDetails={[openCompactDetail]}
              onClose={noop}
              onNavigate={noop}
            />
          </PreferencesProvider>,
        );

        expect(openHtml).toContain(`data-testid="${CONTEXT_INSPECTOR_DRAWER_TEST_ID}"`);
        expect(openHtml).toContain('data-testid="context-occupancy-ring"');
        expect(openHtml).toContain('data-testid="conversation-removed-notice"');

        // Without ignoreTestIds, raw snapshot content inside drawer triggers violations
        expect(checkBusinessViewMarkup(openHtml).length).toBeGreaterThan(0);

        // With ignoreTestIds: ['context-inspector-drawer'], passes with 0 violations!
        const exemptedViolations = checkBusinessViewMarkup(openHtml, {
          ignoreTestIds: [CONTEXT_INSPECTOR_DRAWER_TEST_ID],
        });
        expect(
          exemptedViolations,
          `[Open Inspector ${locale}]\n${formatBusinessViewViolations(exemptedViolations)}`,
        ).toEqual([]);

        // Negative proof: outside elements (ring, removed notice, composer) remain strictly guarded even when context-inspector-drawer is ignored!
        const leakedOutsideHtml = `${openHtml}<span>Leaked M1 AGG-01 outside drawer</span>`;
        const leakedViolations = checkBusinessViewMarkup(leakedOutsideHtml, {
          ignoreTestIds: [CONTEXT_INSPECTOR_DRAWER_TEST_ID],
        });
        expect(leakedViolations.length).toBeGreaterThan(0);
      }
    } finally {
      store.close();
    }
  });
});
