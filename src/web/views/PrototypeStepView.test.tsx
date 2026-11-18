import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../../packages/business-vocabulary/index.js';
import { createWorkspaceStore } from '../../packages/workspace-store/index.js';
import { createApiApp } from '../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload } from '../api.js';
import {
  ConfirmRevisionMuDiffModal,
  PrototypeRevisionHistoryDrawer,
  createInitialRevisionHistoryViewState,
  formatPrototypeLabelForBusinessView,
} from '../components/prototype/PrototypeRevisionHistory.js';
import * as DesignBriefModule from '../components/prototype/DesignBriefAndStyleTile.js';
import * as AgentPanelModule from '../components/agent/AgentPanel.js';
import { ShellAgentPanel } from '../components/agent/ShellAgentPanel.js';
import { agentPanelSurfaceFor } from '../navigation/index.js';
import { PreferencesProvider } from '../i18n.js';
import { PrototypeStudioView } from './ApplicationCenterViews.js';

function stubBrowserStorage(entries: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(entries));
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
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

async function fetchBootstrap(
  store: ReturnType<typeof createWorkspaceStore>,
  projectId: string,
): Promise<BootstrapPayload> {
  const app = createApiApp(store);
  const res = await app.request(`/api/bootstrap?projectId=${encodeURIComponent(projectId)}`);
  return (await res.json()) as BootstrapPayload;
}

function assertZeroBusinessViolations(html: string, contextLabel: string) {
  const violations = checkBusinessViewMarkup(html);
  expect(violations, `${contextLabel}\n${formatBusinessViewViolations(violations)}`).toEqual([]);
}

function countPrimaryAccentButtons(html: string): number {
  return (
    html.match(/<button[^>]*bg-primary border-primary text-primary-foreground[^>]*>/g) ?? []
  ).length;
}

describe('PrototypeStepView Business View, Screen Changes dialog, OUTDATED banner, and Technical Details (#66)', () => {
  const initialSnapshot = { ...useWorkbenchStore.getInitialState() };

  afterEach(() => {
    vi.unstubAllGlobals();
    useWorkbenchStore.setState({
      data: initialSnapshot.data,
      loading: initialSnapshot.loading,
      activeNav: initialSnapshot.activeNav,
    });
    Object.assign(useWorkbenchStore.getInitialState(), initialSnapshot);
  });

  it('renders Blocked state (when Requirements unconfirmed) and Briefing Stage (when Requirements confirmed) with zero Business View violations in zh-CN and en-US while keeping Style Tile target-app colors intact', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      const proj = store.createProject({
        name: '供应商准入评审系统',
        code: 'SUPPLIER-ONBOARD',
        domain: '采购供应链管理',
        template: 'EMPTY',
      });

      // 1. Blocked state: Requirements not confirmed yet, 0 prototypes
      const blockedBoot = await fetchBootstrap(store, proj.id);
      useWorkbenchStore.setState({ loading: false, data: blockedBoot });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubBrowserStorage({ onto_locale: locale });
        const blockedHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <PrototypeStudioView onNavigate={() => {}} />
          </PreferencesProvider>,
        );
        assertZeroBusinessViolations(blockedHtml, `Blocked state (${locale})`);
        expect(countPrimaryAccentButtons(blockedHtml)).toBeLessThanOrEqual(1);
        expect(blockedHtml).toContain('data-testid="prototype-blocked-state"');
        expect(blockedHtml).toContain('data-testid="prototype-status-banner"');
      }

      // 2. Confirm Requirements -> unlocks Briefing Stage (Visual References + Design Brief + Style Tile + Motion Schematics)
      store.saveRequirementDoc({
        id: 'rdoc-sup-1',
        projectId: proj.id,
        title: '供应商准入评审需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: [
          '# 供应商准入评审需求文档',
          '',
          '## 1. 业务目标',
          '- 围绕**供应商准入申请**（SupplierApplication）与**资质审核记录**（QualificationReview）完成准入审批。',
        ].join('\n'),
      });
      store.confirmRequirementsStep(proj.id, { docId: 'rdoc-sup-1' });

      const briefingBoot = await fetchBootstrap(store, proj.id);
      useWorkbenchStore.setState({ loading: false, data: briefingBoot });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubBrowserStorage({ onto_locale: locale });
        const briefingHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <PrototypeStudioView onNavigate={() => {}} />
          </PreferencesProvider>,
        );
        assertZeroBusinessViolations(briefingHtml, `Briefing Stage REFERENCES (${locale})`);
        expect(countPrimaryAccentButtons(briefingHtml)).toBe(1);
        expect(briefingHtml).toContain('data-testid="prototype-briefing-stage"');
        expect(briefingHtml).toContain('data-testid="prototype-status-banner"');
        expect(briefingHtml).toContain('data-testid="prototype-view-mode-toggle"');
        expect(briefingHtml).toContain('data-testid="visual-reference-picker"');
        expect(briefingHtml).toContain('data-testid="design-brief-card"');
        expect(briefingHtml).toContain('data-testid="style-tile-card"');
        expect(briefingHtml).toContain('data-testid="confirm-brief-generate-btn"');
        // Target-application colors in Style Tile remain literal hex values untouched by workbench theme
        expect(briefingHtml).toContain('data-testid="style-tile-swatches"');
        expect(briefingHtml).toMatch(/style="background:#[0-9a-fA-F]{6}"/);

        for (const stepTab of ['FEEL', 'MOTION'] as const) {
          const subTabHtml = renderToStaticMarkup(
            <PreferencesProvider>
              <PrototypeStudioView onNavigate={() => {}} defaultBriefStep={stepTab} />
            </PreferencesProvider>,
          );
          assertZeroBusinessViolations(subTabHtml, `Briefing Stage ${stepTab} (${locale})`);
          expect(countPrimaryAccentButtons(subTabHtml)).toBe(1);
        }
      }
    } finally {
      store.close();
    }
  });

  it('renders Canvas Stage in CONFIRMED, UNCONFIRMED_CHANGES, and OUTDATED states with zero Business View violations in zh-CN and en-US', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      // 1. Seeded proj-contract -> CONFIRMED state with single primary action ("去整理业务模型" / "Go to Business Model")
      const confirmedBoot = await fetchBootstrap(store, 'proj-contract');
      useWorkbenchStore.setState({ loading: false, data: confirmedBoot });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubBrowserStorage({ onto_locale: locale });
        const confirmedHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <PrototypeStudioView onNavigate={() => {}} defaultHistoryOpen />
          </PreferencesProvider>,
        );
        assertZeroBusinessViolations(confirmedHtml, `Canvas CONFIRMED + History (${locale})`);
        expect(countPrimaryAccentButtons(confirmedHtml)).toBe(1);
        expect(confirmedHtml).toContain('data-testid="prototype-canvas-stage"');
        expect(confirmedHtml).toContain('data-testid="prototype-revision-history-drawer"');
        expect(confirmedHtml).toContain('data-testid="prototype-status-banner"');
        expect(confirmedHtml).toContain('data-testid="go-to-business-model-btn"');
        expect(confirmedHtml).toContain('data-testid="prototype-view-mode-toggle"');
      }

      // 2. Edit & re-confirm Requirements -> Prototype enters OUTDATED while keeping prototype intact!
      const reqDoc = store.listRequirementDocs('proj-contract')[0]!;
      store.saveRequirementDoc({
        id: reqDoc.id,
        projectId: 'proj-contract',
        title: reqDoc.title,
        version: 'v2.0',
        status: 'DRAFT',
        content: `${reqDoc.content}\n\n## 新增归档要求\n- 已盖章合同支持登记纸质原件归档柜号。`,
      });
      store.confirmRequirementsStep('proj-contract', { docId: reqDoc.id });

      const outdatedBoot = await fetchBootstrap(store, 'proj-contract');
      useWorkbenchStore.setState({ loading: false, data: outdatedBoot });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      stubBrowserStorage({ onto_locale: 'zh-CN' });
      const outdatedZh = renderToStaticMarkup(
        <PreferencesProvider>
          <PrototypeStudioView onNavigate={() => {}} />
        </PreferencesProvider>,
      );
      assertZeroBusinessViolations(outdatedZh, 'Canvas OUTDATED (zh-CN)');
      expect(countPrimaryAccentButtons(outdatedZh)).toBe(1);
      expect(outdatedZh).toContain('data-testid="prototype-canvas-stage"');
      expect(outdatedZh).toContain('data-testid="prototype-outdated-banner"');
      expect(outdatedZh).toContain(
        '需求有了新的确认；原型更新确认后，业务模型也会提示更新。',
      );
      expect(outdatedZh).toContain('data-testid="prototype-ask-assistant-update-btn"');
      expect(outdatedZh).toContain('让 AI 助手更新');
      expect(outdatedZh).toContain('data-testid="prototype-confirm-as-is-btn"');
      expect(outdatedZh).toContain('不需要改动，按现状确认');

      stubBrowserStorage({ onto_locale: 'en-US' });
      const outdatedEn = renderToStaticMarkup(
        <PreferencesProvider>
          <PrototypeStudioView onNavigate={() => {}} />
        </PreferencesProvider>,
      );
      assertZeroBusinessViolations(outdatedEn, 'Canvas OUTDATED (en-US)');
      expect(countPrimaryAccentButtons(outdatedEn)).toBe(1);
      expect(outdatedEn).toContain('data-testid="prototype-outdated-banner"');
      expect(outdatedEn).toContain(
        'Requirements were re-confirmed; once the prototype is updated and confirmed, the Business Model will also prompt for an update.',
      );
      expect(outdatedEn).toContain('Update with AI Assistant');
      expect(outdatedEn).toContain('Confirm as is without changes');

      // 3. Append a new revision after confirming -> UNCONFIRMED_CHANGES
      const proto = store.listPrototypes('proj-contract')[0]!;
      store.confirmPrototypeRevision('proj-contract', proto.currentRevisionId);
      store.appendPrototypeRevision(proto.id, {
        htmlContent: `${proto.htmlContent}\n<!-- refined -->`,
        title: '补充归档柜号展示列',
        source: 'AGENT_RUN',
      });

      const unconfirmedBoot = await fetchBootstrap(store, 'proj-contract');
      useWorkbenchStore.setState({ loading: false, data: unconfirmedBoot });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubBrowserStorage({ onto_locale: locale });
        const unconfirmedHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <PrototypeStudioView onNavigate={() => {}} />
          </PreferencesProvider>,
        );
        assertZeroBusinessViolations(unconfirmedHtml, `Canvas UNCONFIRMED_CHANGES (${locale})`);
        expect(countPrimaryAccentButtons(unconfirmedHtml)).toBe(1);
        expect(unconfirmedHtml).toContain('data-testid="prototype-confirm-revision-btn"');
      }

      // 4. Technical Details mode persisted via onto_step_view_mode_PROTOTYPE
      stubBrowserStorage({
        onto_locale: 'zh-CN',
        onto_step_view_mode_PROTOTYPE: 'technical',
      });
      const technicalHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <PrototypeStudioView onNavigate={() => {}} />
        </PreferencesProvider>,
      );
      expect(technicalHtml).toContain('data-testid="prototype-technical-details"');
      expect(technicalHtml).toContain('data-testid="prototype-technical-inspector"');
      expect(technicalHtml).toContain('返回业务视图');
    } finally {
      store.close();
    }
  });

  it('presents pre-confirmation Screen Changes in plain business language with zero Business View violations in zh-CN and en-US', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      const proj = store.createProject({
        name: '费用报销管理',
        code: 'EXPENSE-APP',
        domain: '企业费用报销',
        template: 'CONTRACT',
      });

      const c1 = store.createPrototype(proj.id, {
        name: '报销工作台原型',
        htmlContent: `
          <section data-screen-id="SCR-EXP-LIST" data-screen-name="报销单列表" data-screen-type="LIST">
            <input data-element-id="EL-EXP-NO" data-element-label="单据编号" data-binding="Expense.no" />
          </section>
          <section data-screen-id="SCR-OLD-PRINT" data-screen-name="旧版打印页" data-screen-type="MODAL">
            <button data-element-id="EL-PRINT" data-element-type="BUTTON">打印</button>
          </section>
        `,
        source: 'GENERATED',
      });
      const conf1 = store.confirmPrototypeRevision(proj.id, c1.revision.id);

      const c2 = store.appendPrototypeRevision(c1.prototype.id, {
        htmlContent: `
          <section data-screen-id="SCR-EXP-LIST" data-screen-name="报销单台账" data-screen-type="LIST">
            <input data-element-id="EL-EXP-NO" data-element-label="报销单号" data-binding="Expense.expenseNo" data-required="true" />
          </section>
          <section data-screen-id="SCR-EXP-APPLY" data-screen-name="发起报销申请" data-screen-type="FORM">
            <button data-element-id="EL-EXP-SUBMIT" data-element-label="提交财务审批" data-element-type="BUTTON" data-action-type="SUBMIT" data-event-id="UIE-EXP-SUBMIT" data-behavior-ref="BHV-01">提交审批</button>
          </section>
        `,
        title: '新增发起报销申请界面',
        source: 'AGENT_RUN',
      });

      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubBrowserStorage({ onto_locale: locale });
        const modalHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <ConfirmRevisionMuDiffModal
              open
              revision={c2.revision}
              prototypeName={c2.prototype.name}
              confirmedRevision={conf1.confirmed}
              suite={store.getProject(proj.id)!.suite}
              domain={proj.domain}
              onConfirm={() => {}}
              onClose={() => {}}
            />
          </PreferencesProvider>,
        );
        assertZeroBusinessViolations(modalHtml, `ConfirmRevisionMuDiffModal (${locale})`);
        expect(modalHtml).toContain('data-testid="confirm-revision-mu-diff-modal"');
        expect(modalHtml).toContain('data-testid="confirm-screen-changes-summary"');
        expect(modalHtml).toContain('data-testid="confirm-screen-changes-list"');
        expect(modalHtml).toContain('发起报销申请');
        expect(modalHtml).toContain('旧版打印页');
        expect(modalHtml).toContain('报销单号');
        expect(modalHtml).toContain('提交财务审批');
      }
    } finally {
      store.close();
    }
  });

  it('harmonizes PrototypeRevisionHistoryDrawer side-by-side compare & 1-click Undo and PrototypeStudioView ArtifactHistoryDrawer with zero Business View violations in zh-CN & en-US (#67)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      const proto = store.listPrototypes('proj-contract')[0]!;
      const r1Id = proto.currentRevisionId;
      const r2 = store.appendPrototypeRevision(proto.id, {
        htmlContent: `${proto.htmlContent}\n<section data-screen-id="SCR-ARCHIVE" data-screen-name="合同归档登记页" data-screen-type="FORM"><button data-element-id="EL-ARCHIVE-BTN" data-element-type="BUTTON" data-element-label="确认归档">确认归档</button></section>`,
        title: '增加合同归档登记页 (界面原型.html)',
        source: 'AGENT_RUN',
        agentRunId: 'run-proto-67',
      });

      const boot = await fetchBootstrap(store, 'proj-contract');
      useWorkbenchStore.setState({
        loading: false,
        data: boot,
        historyDrawerArtifactKind: 'PROTOTYPE',
      });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      const compareState = createInitialRevisionHistoryViewState(r2.prototype, {
        comparePair: { leftRevisionId: r1Id, rightRevisionId: r2.revision.id },
      });

      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubBrowserStorage({ onto_locale: locale });

        const studioHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <PrototypeStudioView onNavigate={() => {}} defaultHistoryOpen />
          </PreferencesProvider>,
        );
        assertZeroBusinessViolations(
          studioHtml,
          `PrototypeStudioView + History drawers (${locale})`,
        );
        expect(countPrimaryAccentButtons(studioHtml)).toBe(1);
        expect(studioHtml).toContain('data-testid="artifact-history-drawer"');
        expect(studioHtml).toContain('data-testid="revision-undo-latest-btn"');

        const compareDrawerHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <PrototypeRevisionHistoryDrawer
              open
              prototype={r2.prototype}
              confirmedRevision={boot.confirmedPrototypeRevision}
              domain={boot.activeProject.domain}
              viewMode="business"
              viewState={compareState}
              onSelectPreviewRevision={() => {}}
              onRestoreRevision={() => {}}
              onUndoLatestRevision={() => {}}
              onRenameRevision={() => {}}
              onToggleStarRevision={() => {}}
              onRequestConfirmRevision={() => {}}
            />
          </PreferencesProvider>,
        );
        assertZeroBusinessViolations(
          compareDrawerHtml,
          `PrototypeRevisionHistoryDrawer + Side-by-Side Compare (${locale})`,
        );
        expect(compareDrawerHtml).toContain('data-testid="revision-side-by-side-compare"');
        expect(compareDrawerHtml).toContain('data-testid="compare-mu-diff-section"');
        expect(compareDrawerHtml).not.toContain('data-testid="compare-tab-html-btn"');
        expect(compareDrawerHtml).toContain('合同归档登记页');
      }
    } finally {
      store.close();
    }
  });

  it('routes Prototype left composer turns through an ordinary PROTOTYPE_CO_DESIGN conversation turn when no prototype exists yet, never reading draft requirementDocs[0] or generating R1 when Requirements are unconfirmed', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const app = createApiApp(store);
    try {
      stubBrowserStorage({ onto_locale: 'zh-CN' });
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

      const proj = store.createProject({
        name: '冷链车辆调度系统',
        code: 'COLD-CHAIN-GATE',
        domain: '冷链物流调度',
        template: 'EMPTY',
      });
      // Save an UNCONFIRMED draft RequirementDoc (must NEVER be read by Prototype composer!)
      store.saveRequirementDoc({
        id: 'rdoc-unconfirmed-draft',
        projectId: proj.id,
        title: '未确认草稿需求',
        version: 'v0.1',
        status: 'DRAFT',
        content: '# 未确认草稿\n\n## 1. 草稿机密对象\n- SECRET_DRAFT_ONLY_ENTITY_991',
      });

      const decideSpy = vi.spyOn(DesignBriefModule, 'decideDesignBriefForMe');
      const briefGenSpy = vi.spyOn(
        useWorkbenchStore.getState(),
        'startPrototypeBriefGenerationRun',
      );
      let capturedOnSubmit: ((prompt: string) => void | Promise<void>) | undefined;
      const origAgentPanel = AgentPanelModule.AgentPanel;
      vi.spyOn(AgentPanelModule, 'AgentPanel').mockImplementation((props) => {
        capturedOnSubmit = props.onSubmitPrompt;
        return origAgentPanel(props);
      });

      await useWorkbenchStore.getState().bootstrap(proj.id);
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      const surface = agentPanelSurfaceFor('app-prototype')!;
      renderToStaticMarkup(
        <PreferencesProvider>
          <ShellAgentPanel surface={surface} overlay={false} onClose={() => {}} onNavigate={() => {}} />
        </PreferencesProvider>,
      );

      expect(capturedOnSubmit).toBeTypeOf('function');
      await capturedOnSubmit!('先帮我看看原型应该怎么布局');

      expect(decideSpy).not.toHaveBeenCalled();
      expect(briefGenSpy).not.toHaveBeenCalled();
      expect(store.listPrototypes(proj.id)).toEqual([]);

      const sessions = store.listAgentSessions({
        projectId: proj.id,
        agentKind: 'PROTOTYPE_CO_DESIGN',
      });
      expect(sessions).toHaveLength(1);
      const assistantReply =
        sessions[0]!.messages.find((m) => m.role === 'assistant')?.content ?? '';
      expect(assistantReply).not.toContain('SECRET_DRAFT_ONLY_ENTITY_991');
      expect(assistantReply.length).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });

  it('preserves English words containing me/mi/mm in formatPrototypeLabelForBusinessView and uses bilingual fallback without 原型版本', () => {
    expect(formatPrototypeLabelForBusinessView('Decide for me', undefined, 'en-US')).toBe(
      'Decide for me',
    );
    expect(
      formatPrototypeLabelForBusinessView('Minimum order summary', undefined, 'en-US'),
    ).toBe('Minimum order summary');
    expect(
      formatPrototypeLabelForBusinessView('M1 采购合同原型 (界面原型.html)', undefined, 'zh-CN'),
    ).toBe('采购合同原型');
    expect(formatPrototypeLabelForBusinessView('M1.html', undefined, 'en-US')).toBe(
      'Interactive Prototype',
    );
    expect(formatPrototypeLabelForBusinessView('M1.html', undefined, 'zh-CN')).toBe(
      '界面原型',
    );
    expect(formatPrototypeLabelForBusinessView('', undefined, 'zh-CN')).not.toBe('原型版本');
  });
});
