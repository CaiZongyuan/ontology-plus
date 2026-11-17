import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../../../packages/business-vocabulary/index.js';
import {
  createWorkspaceStore,
  type ChangeSummaryView,
} from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload } from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import { RequirementsStepView } from '../../views/ApplicationCenterViews.js';
import { BusinessModelStepView } from '../../views/BusinessModelStepView.js';
import { OntologyWorkbenchView } from '../../views/OntologyWorkbenchView.js';
import { ShellAgentPanel, agentPanelSurfaceFor } from '../agent/ShellAgentPanel.js';
import { ArtifactHistoryDrawer, ChangeSummaryCard } from './index.js';

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

describe('ChangeSummaryCard & ArtifactHistoryDrawer UI (#65)', () => {
  const initialSnapshot = { ...useWorkbenchStore.getInitialState() };

  afterEach(() => {
    vi.unstubAllGlobals();
    useWorkbenchStore.setState({
      data: initialSnapshot.data,
      loading: initialSnapshot.loading,
      activeNav: initialSnapshot.activeNav,
      activeItemId: initialSnapshot.activeItemId,
      activeSessionId: initialSnapshot.activeSessionId,
      highlightedBusinessModelTarget: null,
    });
    Object.assign(useWorkbenchStore.getInitialState(), initialSnapshot);
  });

  it('renders ChangeSummaryCard with computed items, 1-sentence reason, latest-only Undo, grouped object items, and 0 Business View violations in zh-CN & en-US', () => {
    const summary: ChangeSummaryView = {
      entryId: 'ahist-1',
      artifactKind: 'REQUIREMENTS_DOC',
      targetId: 'rdoc-1',
      reason: {
        zh: '按你的最新说明补充了冷链收货复核规则。',
        en: 'Added cold-chain receiving verification rules from your latest note.',
      },
      canUndo: true,
      items: [
        {
          id: 'item-1',
          changeType: 'MODIFIED',
          label: {
            zh: '修改章节「2. 核心业务对象」（新增 2 行）',
            en: 'Updated section "2. Core Business Objects" (+2 lines)',
          },
          detail: {
            zh: '冷链收货单：记录车厢实测温度与双人签字',
            en: 'Cold-chain receipt: records cabin temperature and dual signatures',
          },
          jumpTarget: {
            kind: 'REQUIREMENTS_SECTION',
            docId: 'rdoc-1',
            sectionHeading: '2. 核心业务对象',
          },
        },
        {
          id: 'item-2',
          changeType: 'ADDED',
          groupLabel: { zh: '合同', en: 'Contract' },
          label: {
            zh: '在「合同」上新增业务操作「提交审批」',
            en: 'Added Action "Submit for Approval" on "Contract"',
          },
        },
      ],
    };

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubBrowserStorage({ onto_locale: locale });
      const html = renderToStaticMarkup(
        <PreferencesProvider>
          <ChangeSummaryCard summary={summary} onUndo={() => {}} onJumpToTarget={() => {}} />
        </PreferencesProvider>,
      );
      const violations = checkBusinessViewMarkup(html);
      expect(violations, formatBusinessViewViolations(violations)).toEqual([]);
      expect(html).toContain('data-testid="run-change-summary"');
      expect(html).toContain('data-testid="change-summary-reason"');
      expect(html).toContain('data-testid="change-summary-item"');
      expect(html).toContain('data-testid="change-summary-undo-btn"');
      expect(html).toContain(locale === 'en-US' ? 'Change Summary' : '变更说明');
      expect(html).toContain(locale === 'en-US' ? 'Undo' : '撤销');
    }

    // When no longer latest (canUndo=false), Undo button is omitted
    stubBrowserStorage({ onto_locale: 'zh-CN' });
    const olderHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ChangeSummaryCard summary={{ ...summary, canUndo: false }} onUndo={() => {}} />
      </PreferencesProvider>,
    );
    expect(olderHtml).toContain('data-testid="run-change-summary"');
    expect(olderHtml).not.toContain('data-testid="change-summary-undo-btn"');

    // Empty change list renders nothing
    const emptyHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ChangeSummaryCard summary={{ ...summary, items: [] }} />
      </PreferencesProvider>,
    );
    expect(emptyHtml).toBe('');
  });

  it('wires ShellAgentPanel + RequirementsStepView + ArtifactHistoryDrawer end-to-end: zero-diff runs omit Change Summary, mutating runs show Change Summary + Undo until superseded by manual edit, and History Drawer offers Undo on top & Restore on earlier entries with 0 Business View violations', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const app = createApiApp(store);

    try {
      const proj = store.createProject({
        name: '门店退货核销系统',
        code: 'STORE-RETURN-65',
        domain: '零售门店售后',
        template: 'EMPTY',
      });
      const sess = store.createAgentSession({
        projectId: proj.id,
        agentKind: 'REQUIREMENT',
        title: '门店退货需求对话',
      });

      // Turn 1: no-op exploratory turn (does not touch RequirementDoc)
      const noopRes = await app.request(`/api/agent-sessions/${sess.id}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '支持顾客凭小票 7 天内无理由退货', mockMode: true }),
      });
      await noopRes.text();

      // Turn 2: SRS synthesis turn (mutates RequirementDoc)
      const srsRes = await app.request(`/api/agent-sessions/${sess.id}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: '[ACTION:SYNTHESIZE_SRS {}]\n请整理需求文档',
          mockMode: true,
        }),
      });
      await srsRes.text();

      const boot1 = (await (
        await app.request(`/api/bootstrap?projectId=${encodeURIComponent(proj.id)}`)
      ).json()) as BootstrapPayload;
      useWorkbenchStore.setState({
        loading: false,
        data: boot1,
        activeNav: 'app-req-docs',
        activeSessionId: sess.id,
      });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubBrowserStorage({ onto_locale: locale });
        const panelHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <ShellAgentPanel
              surface={agentPanelSurfaceFor('app-req-docs')}
              overlay={false}
              side="left"
              closable={false}
              onClose={() => {}}
              onNavigate={() => {}}
            />
          </PreferencesProvider>,
        );
        const violations = checkBusinessViewMarkup(panelHtml);
        expect(violations, formatBusinessViewViolations(violations)).toEqual([]);
        // Two run cards total (Turn 1 no-op + Turn 2 SRS synthesis), ONLY ONE run-change-summary!
        expect(panelHtml.match(/data-testid="agent-run-card"/g)?.length).toBe(2);
        expect(panelHtml.match(/data-testid="run-change-summary"/g)?.length).toBe(1);
        expect(panelHtml.match(/data-testid="change-summary-undo-btn"/g)?.length).toBe(1);
      }

      // Manual edit afterwards supersedes Turn 2 as latest change
      const doc = store.listRequirementDocs(proj.id)[0]!;
      await app.request('/api/requirements/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: doc.id,
          projectId: proj.id,
          title: doc.title,
          version: 'v5.1',
          status: 'DRAFT',
          content: `${doc.content}\n\n## 10. 高价值商品店长复核\n- 单笔超过 2000 元退货需店长扫码确认。\n`,
        }),
      });

      const boot2 = (await (
        await app.request(`/api/bootstrap?projectId=${encodeURIComponent(proj.id)}`)
      ).json()) as BootstrapPayload;
      useWorkbenchStore.setState({
        loading: false,
        data: boot2,
        activeNav: 'app-req-docs',
        activeSessionId: sess.id,
      });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      stubBrowserStorage({ onto_locale: 'zh-CN' });
      const panelAfterManualHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ShellAgentPanel
            surface={agentPanelSurfaceFor('app-req-docs')}
            overlay={false}
            side="left"
            closable={false}
            onClose={() => {}}
            onNavigate={() => {}}
          />
        </PreferencesProvider>,
      );
      // Turn 2 still displays its Change Summary, and no longer offers 1-click Undo on the card
      expect(panelAfterManualHtml.match(/data-testid="run-change-summary"/g)?.length).toBe(1);
      expect(panelAfterManualHtml).not.toContain('data-testid="change-summary-undo-btn"');

      // RequirementsStepView renders requirements-history-btn and passes Business View guard
      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubBrowserStorage({ onto_locale: locale });
        const stepHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <RequirementsStepView onNavigate={() => {}} />
          </PreferencesProvider>,
        );
        const stepViolations = checkBusinessViewMarkup(stepHtml);
        expect(stepViolations, formatBusinessViewViolations(stepViolations)).toEqual([]);
        expect(stepHtml).toContain('data-testid="requirements-history-btn"');

        // Open ArtifactHistoryDrawer in SSR (`open={true}`): top item has Undo, earlier item has Restore-before
        const reqEntries = (boot2.artifactHistory ?? []).filter(
          (e) => e.artifactKind === 'REQUIREMENTS_DOC',
        );
        const drawerHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <ArtifactHistoryDrawer
              open
              onOpenChange={() => {}}
              artifactLabel={{ zh: '需求文档', en: 'Requirements Document' }}
              entries={reqEntries}
              onUndoLatest={() => {}}
              onRestoreBefore={() => {}}
            />
          </PreferencesProvider>,
        );
        const drawerViolations = checkBusinessViewMarkup(drawerHtml);
        expect(drawerViolations, formatBusinessViewViolations(drawerViolations)).toEqual([]);
        expect(drawerHtml).toContain('data-testid="artifact-history-drawer"');
        expect(drawerHtml.match(/data-testid="artifact-history-item"/g)?.length).toBe(2);
        expect(drawerHtml.match(/data-testid="history-undo-latest-btn"/g)?.length).toBe(1);
        expect(drawerHtml.match(/data-testid="history-restore-before-btn"/g)?.length).toBe(1);
      }
    } finally {
      store.close();
    }
  });

  it('wires ONTOLOGY_SUITE Change Summary, Business Object grouping, canvas flash jump, BusinessModelStepView history drawer, and server-backed Technical Details Undo/Redo with 0 Business View violations (#70)', async () => {
    // Browser-memory undoStack / redoStack / pushUndoSnapshot are retired from useWorkbenchStore
    const storeKeys = Object.keys(useWorkbenchStore.getState());
    expect(storeKeys).not.toContain('undoStack');
    expect(storeKeys).not.toContain('redoStack');
    expect(storeKeys).not.toContain('pushUndoSnapshot');

    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const app = createApiApp(store);

    try {
      const proj = store.createProject({
        name: '合同审批建模工作台',
        code: 'CONTRACT-SSR-70',
        domain: 'contract_lifecycle',
        template: 'CONTRACT',
      });
      const sess = store.createAgentSession({
        projectId: proj.id,
        agentKind: 'COPILOT',
        title: '合同业务模型对话',
      });

      // Turn 1: read-only inspection turn -> NO Change Summary
      const noopRes = await app.request(`/api/agent-sessions/${sess.id}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '请检查当前业务模型结构', mockMode: true }),
      });
      await noopRes.text();

      // Turn 2: mutating COPILOT turn -> adds action "提交审批" on Contract
      const actRes = await app.request(`/api/agent-sessions/${sess.id}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: '请在合同上新增业务操作『提交审批』',
          mockMode: true,
        }),
      });
      await actRes.text();

      const boot1 = (await (
        await app.request(`/api/bootstrap?projectId=${encodeURIComponent(proj.id)}`)
      ).json()) as BootstrapPayload;
      useWorkbenchStore.setState({
        loading: false,
        data: boot1,
        activeNav: 'app-ontology',
        activeSessionId: sess.id,
      });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      const ontEntries = (boot1.artifactHistory ?? []).filter(
        (e) => e.artifactKind === 'ONTOLOGY_SUITE',
      );
      expect(ontEntries).toHaveLength(1);
      const jumpTarget = ontEntries[0]!.changeSummary.items[0]!.jumpTarget!;
      expect(jumpTarget.kind).toBe('BUSINESS_OBJECT');

      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubBrowserStorage({ onto_locale: locale });
        const panelHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <ShellAgentPanel
              surface={agentPanelSurfaceFor('app-ontology')}
              overlay={false}
              side="left"
              closable={false}
              onClose={() => {}}
              onNavigate={() => {}}
            />
          </PreferencesProvider>,
        );
        const panelViolations = checkBusinessViewMarkup(panelHtml);
        expect(panelViolations, formatBusinessViewViolations(panelViolations)).toEqual([]);
        expect(panelHtml.match(/data-testid="agent-run-card"/g)?.length).toBe(2);
        expect(panelHtml.match(/data-testid="run-change-summary"/g)?.length).toBe(1);
        expect(panelHtml.match(/data-testid="change-summary-undo-btn"/g)?.length).toBe(1);
        expect(panelHtml).toContain(
          locale === 'en-US'
            ? 'Added Action &#x27;Submit for Approval&#x27; on &#x27;Contract&#x27;'
            : '在『合同』上新增业务操作『提交审批』',
        );

        const bmHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <BusinessModelStepView viewModeOverride="business" />
          </PreferencesProvider>,
        );
        const bmViolations = checkBusinessViewMarkup(bmHtml);
        expect(bmViolations, formatBusinessViewViolations(bmViolations)).toEqual([]);
        expect(bmHtml).toContain('data-testid="business-model-history-btn"');

        const drawerHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <ArtifactHistoryDrawer
              open
              onOpenChange={() => {}}
              artifactLabel={{ zh: '业务模型', en: 'Business Model' }}
              entries={ontEntries}
              onUndoLatest={() => {}}
              onRestoreBefore={() => {}}
            />
          </PreferencesProvider>,
        );
        const drawerViolations = checkBusinessViewMarkup(drawerHtml);
        expect(drawerViolations, formatBusinessViewViolations(drawerViolations)).toEqual([]);
      }

      // Jump to target flashes the added action row on BusinessModelStepView!
      if (jumpTarget.kind === 'BUSINESS_OBJECT') {
        useWorkbenchStore.getState().focusBusinessModelTarget(jumpTarget);
        Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
      }
      stubBrowserStorage({ onto_locale: 'zh-CN' });
      const flashedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView viewModeOverride="business" />
        </PreferencesProvider>,
      );
      expect(flashedHtml).toContain('data-flash="true"');
      expect(flashedHtml).toContain('提交审批');

      // Technical Details Undo/Redo buttons reflect server history before & after Undo!
      const techBeforeUndoHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <OntologyWorkbenchView onNavigate={() => {}} />
        </PreferencesProvider>,
      );
      expect(techBeforeUndoHtml).toMatch(/data-testid="undo-btn"(?![^>]*disabled)/);
      expect(techBeforeUndoHtml).toMatch(/data-testid="redo-btn"[^>]*disabled/);

      // Undo on server -> redo-btn becomes enabled, undo-btn disabled!
      await app.request(`/api/projects/${proj.id}/history/ONTOLOGY_SUITE/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const bootAfterUndo = (await (
        await app.request(`/api/bootstrap?projectId=${encodeURIComponent(proj.id)}`)
      ).json()) as BootstrapPayload;
      useWorkbenchStore.setState({ data: bootAfterUndo });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      const techAfterUndoHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <OntologyWorkbenchView onNavigate={() => {}} />
        </PreferencesProvider>,
      );
      expect(techAfterUndoHtml).toMatch(/data-testid="undo-btn"[^>]*disabled/);
      expect(techAfterUndoHtml).toMatch(/data-testid="redo-btn"(?![^>]*disabled)/);
    } finally {
      store.close();
    }
  });
});
