import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBusinessViewMarkup } from '../packages/business-vocabulary/index.js';
import { CONTRACT_LIFECYCLE_SUITE } from '../packages/ontology-core/index.js';
import type { AssembledApplication, GeneratedSkill } from '../packages/workspace-store/index.js';
import { WorkbenchShell, buildCommandPaletteEntries } from './App.js';
import { useWorkbenchStore, type BootstrapPayload } from './api.js';
import { PreferencesProvider } from './i18n.js';
import { readStepViewMode, writeStepViewMode } from './navigation/index.js';

function makeBootstrap(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  const base: Partial<BootstrapPayload> = {
    projects: [
      {
        id: 'proj-contract',
        name: '合同全生命周期管理系统',
        code: 'CONTRACT-CLM',
        center: 'APPLICATION',
        domain: '合同全生命周期管理系统',
        description: 'CLM',
        currentStage: 11,
        createdAt: '2026-11-17T00:00:00Z',
        updatedAt: '2026-11-17T00:00:00Z',
      },
      {
        id: 'proj-mft',
        name: '企业文件安全传输系统',
        code: 'MFT-SEC',
        center: 'CAPABILITY',
        domain: '企业文件安全传输系统',
        description: 'MFT',
        currentStage: 5,
        createdAt: '2026-11-17T00:00:00Z',
        updatedAt: '2026-11-17T00:00:00Z',
      },
    ],
    activeProject: {
      id: 'proj-contract',
      name: '合同全生命周期管理系统',
      code: 'CONTRACT-CLM',
      center: 'APPLICATION',
      domain: '合同全生命周期管理系统',
      description: 'CLM',
      currentStage: 11,
      suite: {},
      changelog: '',
      createdAt: '2026-11-17T00:00:00Z',
      updatedAt: '2026-11-17T00:00:00Z',
      validation: {
        valid: true,
        presentModels: ['M1', 'M2', 'M3', 'ME', 'M4', 'M5', 'M6', 'M7', 'MU', 'MM', 'MI'],
        missingModels: [],
        errorCount: 0,
        warningCount: 0,
        diagnostics: [],
      },
      knowledgeGraph: { nodes: [], edges: [] },
    } as unknown as BootstrapPayload['activeProject'],
    projectSnapshots: [],
    agentSessions: [],
    requirementSessions: [],
    requirementDocs: [
      {
        id: 'doc-1',
        projectId: 'proj-contract',
        title: '合同管理需求规格书',
        version: 'v1.0',
        status: 'CONFIRMED',
        content: '# 需求',
        updatedAt: '2026-11-17T00:00:00Z',
      },
    ],
    prototypes: [
      {
        id: 'proto-1',
        projectId: 'proj-contract',
        name: '合同工作台原型',
        version: 'v1',
        htmlContent: '<div>proto</div>',
        extractedScreenCount: 1,
        currentRevisionId: 'rev-1',
        revisions: [],
        updatedAt: '2026-11-17T00:00:00Z',
      } as unknown as BootstrapPayload['prototypes'][number],
    ],
    confirmedPrototypeRevision: {
      projectId: 'proj-contract',
      prototypeId: 'proto-1',
      revisionId: 'rev-1',
      confirmedAt: '2026-11-17T00:00:00Z',
      prototypeName: '合同工作台原型',
      revisionNumber: 1,
      revisionTitle: '初版',
      htmlContent: '<div>proto</div>',
    } as unknown as BootstrapPayload['confirmedPrototypeRevision'],
    fourLayerAssets: [],
    assembledApplications: [
      {
        id: 'app-1',
        projectId: 'proj-contract',
        name: '合同管理应用',
        latestPackageSnapshotId: 'snap-1',
      } as AssembledApplication,
    ],
    generatedSkills: [],
    legacySystems: [],
    extractionJobs: [],
    mcpServers: [],
    capabilityAgents: [],
    capabilityChatSessions: [],
    crossSystemFlows: [],
    knowledgeEntries: [],
    databaseResources: [],
    dataDocuments: [],
    dataMappings: [],
    metrics: [],
    analyticsScenarios: [],
    analyticsReports: [],
    reasoningSessions: [],
    writebackInterfaces: [],
    llmProviders: [],
    systemSettings: {
      activeProviderId: 'prov-1',
      mockLlmMode: true,
      defaultCenter: 'APPLICATION',
      enableAutoSaveMirror: false,
    } as unknown as BootstrapPayload['systemSettings'],
  };
  return { ...base, ...overrides } as BootstrapPayload;
}

function extractSubtreeByTestId(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`;
  const idx = html.indexOf(marker);
  if (idx < 0) return '';
  const openStart = html.lastIndexOf('<', idx);
  const tagMatch = /^<([A-Za-z0-9-]+)/.exec(html.slice(openStart));
  if (!tagMatch) return '';
  const tag = tagMatch[1]!;
  const closeToken = `</${tag}>`;
  const openToken = `<${tag}`;
  let depth = 0;
  let pos = openStart;
  while (pos < html.length) {
    const nextOpen = html.indexOf(openToken, pos);
    const nextClose = html.indexOf(closeToken, pos);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      pos = nextOpen + openToken.length;
    } else {
      depth -= 1;
      pos = nextClose + closeToken.length;
      if (depth <= 0) {
        return html.slice(openStart, pos);
      }
    }
  }
  return html.slice(openStart);
}

describe('WorkbenchShell (#60)', () => {
  const initialSnapshot = { ...useWorkbenchStore.getInitialState() };

  function seedStore(patch: Partial<ReturnType<typeof useWorkbenchStore.getState>>) {
    useWorkbenchStore.setState(patch);
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
  }

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

  it('renders the top-bar shell with 4 ordered steps, business-language health status, More menu trigger, and zero vocabulary violations', () => {
    const payload = makeBootstrap();
    const errorPayload = makeBootstrap({
      activeProject: {
        ...payload.activeProject,
        validation: {
          ...payload.activeProject.validation,
          errorCount: 3,
          warningCount: 2,
        },
      },
    });

    seedStore({
      loading: false,
      activeNav: 'app-ontology',
      data: errorPayload,
    });

    const zhHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchShell />
      </PreferencesProvider>,
    );

    expect(zhHtml).not.toContain('platform-sidebar');
    expect(zhHtml).toContain('data-testid="workbench-topbar"');
    expect(zhHtml).toContain('data-testid="project-selector"');
    expect(zhHtml).toContain('data-testid="project-step-bar"');
    expect(zhHtml).toContain('data-testid="step-tab-REQUIREMENTS"');
    expect(zhHtml).toContain('data-testid="step-tab-PROTOTYPE"');
    expect(zhHtml).toContain('data-testid="step-tab-BUSINESS_MODEL"');
    expect(zhHtml).toContain('data-testid="step-tab-DELIVERY"');
    expect(zhHtml).toContain('data-testid="shell-health-status"');
    expect(zhHtml).toContain('3 个需要修正的问题');
    expect(zhHtml).toContain('data-testid="open-command-palette-btn"');
    expect(zhHtml).toContain('data-testid="theme-toggle-btn"');
    expect(zhHtml).toContain('data-testid="locale-toggle-btn"');
    expect(zhHtml).toContain('data-testid="more-menu-btn"');

    const topbarMarkup = extractSubtreeByTestId(zhHtml, 'workbench-topbar');
    expect(topbarMarkup.length).toBeGreaterThan(0);
    expect(checkBusinessViewMarkup(topbarMarkup)).toEqual([]);

    // English rendering check
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k === 'onto_locale' ? 'en-US' : null),
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    const enHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchShell />
      </PreferencesProvider>,
    );
    expect(enHtml).toContain('3 problems to fix');
    expect(checkBusinessViewMarkup(extractSubtreeByTestId(enHtml, 'workbench-topbar'))).toEqual([]);
  });

  it('styles blocked ("cannot start yet") step subtitles at >=12px in secondary text color and renders inline canvas guidance only when empty', () => {
    const base = makeBootstrap();
    const emptyProjectPayload = makeBootstrap({
      activeProject: {
        ...base.activeProject,
        id: 'proj-empty',
        name: '冷链仓储系统',
        domain: '冷链仓储',
        suite: {},
        validation: {
          valid: true,
          presentModels: [],
          missingModels: [],
          errorCount: 0,
          warningCount: 0,
          diagnostics: [],
        },
      },
      requirementDocs: [],
      requirementSessions: [],
      prototypes: [],
      confirmedPrototypeRevision: null,
      assembledApplications: [],
      generatedSkills: [],
    });

    seedStore({
      loading: false,
      activeNav: 'app-prototype',
      data: emptyProjectPayload,
    });

    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchShell />
      </PreferencesProvider>,
    );

    const protoStatus = extractSubtreeByTestId(html, 'step-status-PROTOTYPE');
    expect(protoStatus).toContain('需先确认需求');
    expect(protoStatus).toContain('text-[12px]');
    expect(protoStatus).toContain('text-muted-foreground');
    expect(protoStatus).not.toContain('text-faint-foreground');

    // Step buttons are always clickable (never disabled)
    const protoTab = extractSubtreeByTestId(html, 'step-tab-PROTOTYPE');
    expect(protoTab).not.toMatch(/\bdisabled\b/);

    // Inline canvas guidance appears when blocked & empty
    const banner = extractSubtreeByTestId(html, 'step-cannot-start-banner');
    expect(banner).toContain('原型还不能开始');
    expect(banner).toContain('data-testid="step-cannot-start-action"');
    expect(banner).toContain('去完成需求');
    expect(checkBusinessViewMarkup(banner)).toEqual([]);

    // Legacy project with existing models (e.g. proj-mft) omits blocked banner on BUSINESS_MODEL
    const legacyMftPayload = makeBootstrap({
      activeProject: {
        ...base.activeProject,
        id: 'proj-mft',
        name: '企业文件安全传输系统',
        domain: '企业文件安全传输系统',
        validation: {
          valid: true,
          presentModels: ['M1', 'M2', 'M3', 'ME', 'M5'],
          missingModels: ['M4', 'M6', 'M7', 'MU', 'MM', 'MI'],
          errorCount: 0,
          warningCount: 6,
          diagnostics: [],
        },
      },
      requirementDocs: [],
      prototypes: [],
      confirmedPrototypeRevision: null,
      assembledApplications: [],
      generatedSkills: [{ id: 'sk-mft', projectId: 'proj-mft' } as GeneratedSkill],
    });
    seedStore({
      loading: false,
      activeNav: 'app-ontology',
      data: legacyMftPayload,
    });
    const legacyHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchShell />
      </PreferencesProvider>,
    );
    expect(legacyHtml).not.toContain('data-testid="step-cannot-start-banner"');
    expect(legacyHtml).toContain('6 处尚未完成的部分');
  });

  it('places Conversation on the left and Canvas on the right in project workspace, and switches panes in compact tablet mode', () => {
    seedStore({
      loading: false,
      activeNav: 'app-ontology',
      data: makeBootstrap(),
    });

    const desktopHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchShell />
      </PreferencesProvider>,
    );

    const agentIdx = desktopHtml.indexOf('data-testid="agent-panel"');
    const canvasIdx = desktopHtml.indexOf('data-testid="workbench-canvas"');
    expect(agentIdx).toBeGreaterThan(-1);
    expect(canvasIdx).toBeGreaterThan(agentIdx);
    expect(desktopHtml).toContain('data-side="left"');
    // BUSINESS_MODEL is now a single-view step (#68): no legacy 3-button subview bar
    expect(desktopHtml).not.toContain('data-testid="step-subview-bar"');
    expect(desktopHtml).not.toContain('data-testid="nav-app-ontology"');
    expect(desktopHtml).not.toContain('data-testid="nav-app-model-files"');
    expect(desktopHtml).not.toContain('data-testid="nav-app-knowledge-graph"');
    expect(desktopHtml).not.toContain('data-testid="workspace-pane-toggle"');

    // Multi-view step not yet collapsed (REQUIREMENTS) still renders its temporary sub-view switcher bar
    seedStore({ activeNav: 'app-req-explore' });
    const reqHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchShell />
      </PreferencesProvider>,
    );
    expect(reqHtml).toContain('data-testid="step-subview-bar"');
    expect(reqHtml).toContain('data-testid="nav-app-req-explore"');

    // Single-view step (PROTOTYPE) omits the temporary sub-view switcher bar
    seedStore({ activeNav: 'app-prototype' });
    const protoHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchShell />
      </PreferencesProvider>,
    );
    expect(protoHtml).not.toContain('data-testid="step-subview-bar"');

    // Compact / tablet mode (<1280px): renders segmented toggle and shows only the active pane
    const compactCanvasHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchShell compactWorkspaceOverride initialWorkspacePane="canvas" />
      </PreferencesProvider>,
    );
    expect(compactCanvasHtml).toContain('data-testid="workspace-pane-toggle"');
    expect(compactCanvasHtml).toContain('data-testid="workbench-canvas"');
    expect(compactCanvasHtml).not.toContain('data-testid="agent-panel"');

    const compactChatHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchShell compactWorkspaceOverride initialWorkspacePane="conversation" />
      </PreferencesProvider>,
    );
    expect(compactChatHtml).toContain('data-testid="workspace-pane-toggle"');
    expect(compactChatHtml).toContain('data-testid="agent-panel"');
    expect(compactChatHtml).not.toContain('data-testid="workbench-canvas"');
  });

  it('renders intra-area navigation for Secondary Areas and omits the project step bar outside project workspace', () => {
    seedStore({
      loading: false,
      activeNav: 'cap-extraction',
      data: makeBootstrap(),
    });

    const capHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchShell />
      </PreferencesProvider>,
    );
    expect(capHtml).not.toContain('data-testid="project-step-bar"');
    expect(capHtml).toContain('data-testid="secondary-area-nav"');
    expect(capHtml).toContain('data-testid="nav-cap-systems"');
    expect(capHtml).toContain('data-testid="nav-cap-extraction"');
    expect(capHtml).toContain('data-testid="nav-cap-mcp"');
    expect(capHtml).toContain('data-testid="nav-cap-agents"');
    expect(capHtml).toContain('data-testid="nav-cap-cross-flows"');
    expect(capHtml).toContain('data-testid="nav-cap-knowledge"');

    seedStore({ activeNav: 'system-settings' });
    const settingsHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchShell />
      </PreferencesProvider>,
    );
    expect(settingsHtml).not.toContain('data-testid="project-step-bar"');
    expect(settingsHtml).toContain('data-testid="secondary-area-nav"');
    expect(settingsHtml).toContain('data-testid="nav-llm-center"');
    expect(settingsHtml).toContain('data-testid="nav-system-settings"');
  });

  it('builds Command Palette entries for Projects, Project Steps, and Business Objects while retiring legacy ontology nav items (#68)', async () => {
    const storeMap = new Map<string, string>();
    const storage = {
      getItem: (k: string) => storeMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storeMap.set(k, v);
      },
      removeItem: (k: string) => {
        storeMap.delete(k);
      },
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', {
      localStorage: storage,
      location: new URL('http://127.0.0.1:4352/?projectId=proj-contract'),
      history: { replaceState: () => undefined },
    });

    const base = makeBootstrap();
    const payload = makeBootstrap({
      activeProject: {
        ...base.activeProject,
        suite: CONTRACT_LIFECYCLE_SUITE,
      },
    });
    seedStore({
      loading: false,
      activeNav: 'app-req-explore',
      data: payload,
    });

    const entries = buildCommandPaletteEntries({
      data: payload,
      locale: 'zh-CN',
      theme: 'light',
      workbenchTheme: 'default',
      t: (zh) => zh,
      onSelectStep: (step) => useWorkbenchStore.getState().setActiveNav(step),
      onSelectView: (view) => useWorkbenchStore.getState().setActiveNav(view),
      onSwitchProject: () => undefined,
      onToggleTheme: () => undefined,
      onSelectWorkbenchTheme: () => undefined,
      onToggleLocale: () => undefined,
    });

    const keys = entries.map((e) => e.key);
    // 4 steps
    expect(keys).toContain('step:REQUIREMENTS');
    expect(keys).toContain('step:PROTOTYPE');
    expect(keys).toContain('step:BUSINESS_MODEL');
    expect(keys).toContain('step:DELIVERY');
    // Projects
    expect(keys).toContain('project:proj-contract');
    expect(keys).toContain('project:proj-mft');
    // Business Objects from CONTRACT_LIFECYCLE_SUITE
    expect(keys).toContain('object:AGG-01');
    expect(keys).toContain('object:AGG-02');
    expect(keys).toContain('object:AGG-03');
    // Legacy entries retired from Command Palette
    expect(keys).not.toContain('nav:app-ontology');
    expect(keys).not.toContain('nav:app-model-files');
    expect(keys).not.toContain('nav:app-knowledge-graph');

    const counterpartyEntry = entries.find((e) => e.key === 'object:AGG-02');
    expect(counterpartyEntry?.label).toBe('签约相对方');
    expect(counterpartyEntry?.section).toBe('业务对象');

    writeStepViewMode('BUSINESS_MODEL', 'technical');
    counterpartyEntry!.run();
    expect(readStepViewMode('BUSINESS_MODEL')).toBe('business');
    expect(useWorkbenchStore.getState().activeNav).toBe('app-ontology');
    expect(useWorkbenchStore.getState().activeItemId).toBe('AGG-02');

    // Selecting a project in Command Palette from Home or a secondary page enters that project's currentStep
    const switchedIds: string[] = [];
    const navigatedViews: string[] = [];
    const payloadWithSteps: BootstrapPayload = {
      ...payload,
      projects: payload.projects.map((p) =>
        p.id === 'proj-mft' ? { ...p, currentStep: 'BUSINESS_MODEL' as const } : p,
      ),
    };

    const fromHomeEntries = buildCommandPaletteEntries({
      data: payloadWithSteps,
      activeView: 'overview',
      locale: 'zh-CN',
      theme: 'light',
      workbenchTheme: 'default',
      t: (zh) => zh,
      onSelectStep: () => undefined,
      onSelectView: (view) => navigatedViews.push(view),
      onSwitchProject: (id) => {
        switchedIds.push(id);
      },
      onToggleTheme: () => undefined,
      onSelectWorkbenchTheme: () => undefined,
      onToggleLocale: () => undefined,
    });
    fromHomeEntries.find((e) => e.key === 'project:proj-mft')!.run();
    await Promise.resolve();
    expect(switchedIds).toEqual(['proj-mft']);
    expect(navigatedViews).toEqual(['app-ontology']);

    const fromSecondaryEntries = buildCommandPaletteEntries({
      data: payloadWithSteps,
      activeView: 'llm-center',
      locale: 'zh-CN',
      theme: 'light',
      workbenchTheme: 'default',
      t: (zh) => zh,
      onSelectStep: () => undefined,
      onSelectView: (view) => navigatedViews.push(view),
      onSwitchProject: (id) => {
        switchedIds.push(id);
      },
      onToggleTheme: () => undefined,
      onSelectWorkbenchTheme: () => undefined,
      onToggleLocale: () => undefined,
    });
    fromSecondaryEntries.find((e) => e.key === 'project:proj-contract')!.run();
    await Promise.resolve();
    expect(switchedIds).toEqual(['proj-mft', 'proj-contract']);
    expect(navigatedViews).toEqual(['app-ontology', 'app-req-explore']);
  });
});
