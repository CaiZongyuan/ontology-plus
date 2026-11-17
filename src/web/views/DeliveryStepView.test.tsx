import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../../packages/business-vocabulary/index.js';
import {
  CONTRACT_LIFECYCLE_SUITE,
  CONTRACT_PROTOTYPE_HTML,
} from '../../packages/ontology-core/index.js';
import { createWorkspaceStore } from '../../packages/workspace-store/index.js';
import { createApiApp } from '../../server/app.js';
import { WorkbenchShell } from '../App.js';
import { useWorkbenchStore, type BootstrapPayload } from '../api.js';
import { PreferencesProvider } from '../i18n.js';
import { writeDeliveryTechTab, writeStepViewMode } from '../navigation/index.js';
import {
  DeliveryStepView,
  RunnableSystemSlot,
  type RunnableSystemSlotState,
} from './ApplicationCenterViews.js';

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

describe('DeliveryStepView Business View, RunnableSystemSlot, and Technical Details (#73)', () => {
  const initialSnapshot = { ...useWorkbenchStore.getInitialState() };

  afterEach(() => {
    vi.unstubAllGlobals();
    useWorkbenchStore.setState({
      data: initialSnapshot.data,
      loading: initialSnapshot.loading,
      activeNav: initialSnapshot.activeNav,
      activeItemId: initialSnapshot.activeItemId,
      activeSessionId: initialSnapshot.activeSessionId,
    });
    Object.assign(useWorkbenchStore.getInitialState(), initialSnapshot);
  });

  it('renders RunnableSystemSlot across UNAVAILABLE, PREPARING, and READY states in zh-CN and en-US with zero Business View violations', () => {
    const cases: {
      state: RunnableSystemSlotState;
      expectedZh: string;
      expectedEn: string;
      expectsLink: boolean;
    }[] = [
      {
        state: { status: 'UNAVAILABLE', openUrl: null },
        expectedZh: '蓝图已就绪，可交付开发',
        expectedEn: 'Blueprint is ready for development',
        expectsLink: false,
      },
      {
        state: { status: 'PREPARING', openUrl: null },
        expectedZh: '准备中',
        expectedEn: 'Preparing',
        expectsLink: false,
      },
      {
        state: { status: 'READY', openUrl: 'https://runnable.example.com/clm' },
        expectedZh: '打开你的系统',
        expectedEn: 'Open your system',
        expectsLink: true,
      },
    ];

    for (const c of cases) {
      stubBrowserStorage({ onto_locale: 'zh-CN' });
      const zhHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <RunnableSystemSlot state={c.state} />
        </PreferencesProvider>,
      );
      assertZeroBusinessViolations(zhHtml, `RunnableSystemSlot ${c.state.status} (zh-CN)`);
      expect(zhHtml).toContain('data-testid="runnable-system-slot"');
      expect(zhHtml).toContain(`data-slot-status="${c.state.status}"`);
      expect(zhHtml).toContain(c.expectedZh);

      stubBrowserStorage({ onto_locale: 'en-US' });
      const enHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <RunnableSystemSlot state={c.state} />
        </PreferencesProvider>,
      );
      assertZeroBusinessViolations(enHtml, `RunnableSystemSlot ${c.state.status} (en-US)`);
      expect(enHtml).toContain(c.expectedEn);

      if (c.expectsLink) {
        expect(zhHtml).toContain('data-testid="runnable-system-open-link"');
        expect(zhHtml).toContain('href="https://runnable.example.com/clm"');
        expect(enHtml).toContain('data-testid="runnable-system-open-link"');
        expect(enHtml).toContain('href="https://runnable.example.com/clm"');
      } else {
        expect(zhHtml).not.toContain('data-testid="runnable-system-open-link"');
        expect(enHtml).not.toContain('data-testid="runnable-system-open-link"');
      }
    }
  });

  it('renders Delivery Business View across NOT_STARTED, IN_PROGRESS, CONFIRMED, and OUTDATED with zero vocabulary violations and at most one primary CTA in zh-CN and en-US', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const api = createApiApp(store);
    try {
      const proj = store.createProject({
        name: '设备巡检维保系统',
        code: 'EQUIP-MAINT',
        domain: '设备运维管理',
        template: 'EMPTY',
      });
      store.saveRequirementDoc({
        id: 'rdoc-equip-1',
        projectId: proj.id,
        title: '设备巡检需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: '# 设备巡检需求\n\n## 1. 目标\n- 巡检工单派发与维保验收。',
      });
      store.confirmRequirementsStep(proj.id, { docId: 'rdoc-equip-1' });
      const { revision } = store.createPrototype(proj.id, {
        name: '设备巡检界面原型',
        htmlContent: CONTRACT_PROTOTYPE_HTML,
      });
      store.confirmPrototypeRevision(proj.id, revision.id);
      store.updateSuite(proj.id, structuredClone(CONTRACT_LIFECYCLE_SUITE), 'Initial suite');

      const renderInBothLocales = (expectedState: string) => {
        for (const locale of ['zh-CN', 'en-US'] as const) {
          stubBrowserStorage({ onto_locale: locale });
          const html = renderToStaticMarkup(
            <PreferencesProvider>
              <DeliveryStepView onNavigate={() => {}} />
            </PreferencesProvider>,
          );
          assertZeroBusinessViolations(html, `Delivery ${expectedState} (${locale})`);
          expect(countPrimaryAccentButtons(html)).toBe(1);
          expect(html).toContain('data-testid="delivery-business-view"');
          expect(html).toContain('data-testid="delivery-status-banner"');
          expect(html).toContain(`data-step-state="${expectedState}"`);
          expect(html).toContain('data-testid="delivery-readiness-check"');
          expect(html).toContain('data-testid="delivery-deliverables-list"');
          expect(html).toContain('data-testid="runnable-system-slot"');
          expect(html).toContain('data-testid="deliverable-dev-package"');
          expect(html).toContain('data-testid="deliverable-ontology-skill"');
          expect(html).toContain('data-testid="deliverable-published-versions"');
          expect(html).not.toContain('输入已变化');
          expect(html).not.toContain('Inputs changed');
          expect(html.toLowerCase()).not.toContain('stale');
          if (locale === 'zh-CN') {
            expect(html).toContain('蓝图已就绪，可交付开发');
            expect(html).toContain('没有需要修正的问题');
          } else {
            expect(html).toContain('Blueprint is ready for development');
            expect(html).toContain('No problems to fix');
          }
        }
      };

      // 1. NOT_STARTED (Business Model not yet confirmed)
      const notStartedBoot = await fetchBootstrap(store, proj.id);
      useWorkbenchStore.setState({ loading: false, data: notStartedBoot, activeNav: 'app-assembly-dev' });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
      renderInBothLocales('NOT_STARTED');

      // 2. IN_PROGRESS (Business Model confirmed, no snapshot yet)
      store.confirmBusinessModelStep(proj.id);
      const inProgressBoot = await fetchBootstrap(store, proj.id);
      useWorkbenchStore.setState({ loading: false, data: inProgressBoot, activeNav: 'app-assembly-dev' });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
      renderInBothLocales('IN_PROGRESS');

      // 3. CONFIRMED (Package snapshot generated from current Business Model confirmation)
      const compileRes = await api.request(`/api/projects/${proj.id}/compile-package`, {
        method: 'POST',
      });
      expect(compileRes.status).toBe(200);
      await api.request(`/api/projects/${proj.id}/generate-skill`, { method: 'POST' });
      const confirmedBoot = await fetchBootstrap(store, proj.id);
      useWorkbenchStore.setState({ loading: false, data: confirmedBoot, activeNav: 'app-assembly-dev' });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
      renderInBothLocales('CONFIRMED');

      // 4. OUTDATED (Business Model re-confirmed after snapshot)
      const updatedSuite = structuredClone(CONTRACT_LIFECYCLE_SUITE);
      updatedSuite.M1!.aggregates[0]!.description = '支持预防性维保工单与备件核销';
      store.updateSuite(proj.id, updatedSuite, 'Update description');
      store.confirmBusinessModelStep(proj.id);
      const outdatedBoot = await fetchBootstrap(store, proj.id);
      useWorkbenchStore.setState({ loading: false, data: outdatedBoot, activeNav: 'app-assembly-dev' });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
      renderInBothLocales('OUTDATED');

      // Also verify seeded proj-contract (with seeded skill + published version) passes 0 violations
      const contractBoot = await fetchBootstrap(store, 'proj-contract');
      useWorkbenchStore.setState({ loading: false, data: contractBoot, activeNav: 'app-assembly-dev' });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
      renderInBothLocales('IN_PROGRESS');
    } finally {
      store.close();
    }
  });

  it('switches ShellAgentPanel to ARCHITECTURE when Technical Details shows Architecture Standards and CODING otherwise while keeping header as AI Assistant', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'CODING',
        targetId: 'app-contract-clm',
        title: 'CODING_DELIVERY_SESSION',
        initialMessages: [
          {
            id: 'm-coding-1',
            role: 'user',
            content: 'CODING_PROMPT_MARKER',
            timestamp: '2026-11-17T10:00:00Z',
          },
        ],
      });
      store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'ARCHITECTURE',
        title: 'ARCHITECTURE_STANDARDS_SESSION',
        initialMessages: [
          {
            id: 'm-arch-1',
            role: 'user',
            content: 'ARCHITECTURE_PROMPT_MARKER',
            timestamp: '2026-11-17T10:05:00Z',
          },
        ],
      });

      const boot = await fetchBootstrap(store, 'proj-contract');

      // 1. Business View on Delivery -> CODING session
      stubBrowserStorage({ onto_locale: 'zh-CN' });
      writeStepViewMode('DELIVERY', 'business');
      writeDeliveryTechTab('standards');
      useWorkbenchStore.setState({
        loading: false,
        data: boot,
        activeNav: 'app-assembly-dev',
        activeItemId: 'app-contract-clm',
      });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      const businessShellHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <WorkbenchShell />
        </PreferencesProvider>,
      );
      expect(businessShellHtml).toContain('data-testid="delivery-business-view"');
      expect(businessShellHtml).toContain('CODING_PROMPT_MARKER');
      expect(businessShellHtml).not.toContain('ARCHITECTURE_PROMPT_MARKER');
      expect(businessShellHtml).not.toContain('data-testid="step-subview-bar"');

      // 2. Technical Details on 'standards' (FourLayerAssetsView) -> ARCHITECTURE session, header still "AI 助手"
      writeStepViewMode('DELIVERY', 'technical');
      writeDeliveryTechTab('standards');
      const archShellHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <WorkbenchShell />
        </PreferencesProvider>,
      );
      expect(archShellHtml).toContain('data-testid="delivery-tech-bar"');
      expect(archShellHtml).toContain('data-testid="four-layer-asset-library"');
      expect(archShellHtml).toContain('data-testid="back-to-business-view-btn"');
      expect(archShellHtml).toContain('ARCHITECTURE_PROMPT_MARKER');
      expect(archShellHtml).not.toContain('CODING_PROMPT_MARKER');
      expect(archShellHtml).toContain('编写与维护开发规范');
      expect(archShellHtml).not.toContain('Architecture Asset Agent');

      // 3. Technical Details on 'assembly' (ApplicationAssemblyDevView) -> CODING session
      writeDeliveryTechTab('assembly');
      const assemblyShellHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <WorkbenchShell />
        </PreferencesProvider>,
      );
      expect(assemblyShellHtml).toContain('data-testid="application-development-workflow"');
      expect(assemblyShellHtml).toContain('CODING_PROMPT_MARKER');
      expect(assemblyShellHtml).not.toContain('ARCHITECTURE_PROMPT_MARKER');
    } finally {
      store.close();
    }
  });
});
