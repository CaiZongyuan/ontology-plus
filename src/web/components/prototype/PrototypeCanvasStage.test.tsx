import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceStore,
  type ConfirmedPrototypeRevision,
  type InteractivePrototype,
  type ProjectDetail,
} from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { PreferencesProvider } from '../../i18n.js';
import { useWorkbenchStore, type BootstrapPayload } from '../../api.js';
import { PrototypeStudioView } from '../../views/ApplicationCenterViews.js';
import { useAgentPanelStore } from '../agent/agentPanelStore.js';
import {
  PrototypeCanvasStage,
  computeFocusModeRightOffset,
  registerFocusModeEscapeListener,
  runClonePrototypeAsNew,
  runDeletePrototypeSafely,
  runImportPrototypeHtml,
  toggleShellAgentPanelFromCanvas,
} from './PrototypeCanvasStage.js';
import {
  injectVisualInspectorIntoHtml,
  openCleanPrototypeInNewTab,
} from './PrototypeVisualInspector.js';

const noop = () => {};

function stubLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

function makeMockProject(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'proj-canvas-1',
    name: '采购合同管理工程',
    code: 'PROJ_CLM',
    center: 'APPLICATION',
    domain: '合同全生命周期管理',
    description: '',
    currentStage: 3,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
    suite: {},
    validation: {
      valid: true,
      errorCount: 0,
      warningCount: 0,
      diagnostics: [],
      presentModels: [],
      missingModels: [],
    },
    knowledgeGraph: { nodes: [], edges: [] },
    changelog: '',
    ...overrides,
  };
}

function makeMockPrototypes(): {
  prototypes: InteractivePrototype[];
  confirmedRevision: ConfirmedPrototypeRevision;
} {
  const rev1 = {
    id: 'rev-1',
    prototypeId: 'proto-a',
    projectId: 'proj-canvas-1',
    revisionNumber: 1,
    title: '初始暖纸台账布局',
    htmlContent:
      '<!DOCTYPE html><html><body><section data-screen-id="SCR-LIST"><button data-element-id="EL-NEW">新建</button></section></body></html>',
    extractedScreenCount: 1,
    source: 'GENERATED' as const,
    createdAt: '2026-11-12T10:00:00.000Z',
  };
  const rev2 = {
    id: 'rev-2',
    prototypeId: 'proto-a',
    projectId: 'proj-canvas-1',
    revisionNumber: 2,
    title: '补充状态筛选栏',
    htmlContent:
      '<!DOCTYPE html><html><body><section data-screen-id="SCR-LIST"><input data-element-id="EL-KW" /><button data-element-id="EL-NEW">新建</button></section></body></html>',
    extractedScreenCount: 1,
    source: 'REFINED' as const,
    createdAt: '2026-11-12T10:05:00.000Z',
  };
  const rev3 = {
    id: 'rev-3',
    prototypeId: 'proto-a',
    projectId: 'proj-canvas-1',
    revisionNumber: 3,
    title: '增加批量审批抽屉',
    starred: true,
    htmlContent:
      '<!DOCTYPE html><html><body><section data-screen-id="SCR-LIST"><button data-element-id="EL-BATCH">批量审批</button></section><section data-screen-id="SCR-DRAWER"></section></body></html>',
    extractedScreenCount: 2,
    source: 'REFINED' as const,
    createdAt: '2026-11-12T10:10:00.000Z',
  };

  const protoA: InteractivePrototype = {
    id: 'proto-a',
    projectId: 'proj-canvas-1',
    name: '暖纸台账方向 A',
    revisions: [rev1, rev2, rev3],
    currentRevisionId: 'rev-3',
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-12T10:10:00.000Z',
    version: 'r3',
    htmlContent: rev3.htmlContent,
    extractedScreenCount: 2,
    isConfirmed: false,
    confirmedRevisionId: 'rev-1',
    aheadOfConfirmedCount: 2,
  };

  const revB1 = {
    id: 'rev-b1',
    prototypeId: 'proto-b',
    projectId: 'proj-canvas-1',
    revisionNumber: 1,
    title: '深色看板方向初稿',
    htmlContent: '<!DOCTYPE html><html><body><section data-screen-id="SCR-BOARD"></section></body></html>',
    extractedScreenCount: 1,
    source: 'GENERATED' as const,
    createdAt: '2026-11-12T11:00:00.000Z',
  };

  const protoB: InteractivePrototype = {
    id: 'proto-b',
    projectId: 'proj-canvas-1',
    name: '深色高密方向 B',
    revisions: [revB1],
    currentRevisionId: 'rev-b1',
    createdAt: '2026-11-12T11:00:00.000Z',
    updatedAt: '2026-11-12T11:00:00.000Z',
    version: 'r1',
    htmlContent: revB1.htmlContent,
    extractedScreenCount: 1,
    isConfirmed: false,
    aheadOfConfirmedCount: 0,
  };

  const confirmedRevision: ConfirmedPrototypeRevision = {
    projectId: 'proj-canvas-1',
    prototypeId: 'proto-a',
    revisionId: 'rev-1',
    confirmedAt: '2026-11-12T10:01:00.000Z',
    prototype: protoA,
    revision: rev1,
    htmlContent: rev1.htmlContent,
  };

  return { prototypes: [protoA, protoB], confirmedRevision };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(useAgentPanelStore.getInitialState(), {
    open: true,
    overlayOpen: false,
    width: 384,
  });
  useAgentPanelStore.setState({ open: true, overlayOpen: false, width: 384 });
});

describe('PrototypeCanvasStage toolbar, revision status & preview controls (#27)', () => {
  it('renders single top toolbar with Prototype Switcher, Revision History ahead indicator, Desktop/Tablet/Mobile + Auto-Fit, Box-Select, Focus Mode, Open in New Tab, Confirm Revision, and Back to Brief', () => {
    stubLocale('zh-CN');
    const project = makeMockProject();
    const { prototypes, confirmedRevision } = makeMockPrototypes();

    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCanvasStage
          project={project}
          prototypes={prototypes}
          selectedPrototypeId="proto-a"
          confirmedRevision={confirmedRevision}
          onSelectPrototype={noop}
          onPrototypesUpdated={noop}
          onBackToBrief={noop}
          containerWidthOverride={960}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('data-testid="prototype-canvas-stage"');
    expect(html).toContain('data-testid="prototype-switcher-trigger"');
    expect(html).toContain('暖纸台账方向 A');
    expect(html).toContain('data-testid="prototype-back-to-brief-btn"');
    expect(html).toContain('data-testid="prototype-history-btn"');
    expect(html).toContain('R3');
    expect(html).toContain('增加批量审批抽屉');
    expect(html).toContain('领先已确认 2 条');

    // Viewport & Auto-Fit zoom controls
    expect(html).toContain('data-testid="prototype-viewport-desktop"');
    expect(html).toContain('data-testid="prototype-viewport-tablet"');
    expect(html).toContain('data-testid="prototype-viewport-mobile"');
    expect(html).toContain('data-testid="prototype-zoom-fit-toggle"');
    expect(html).toContain('65%');

    // Box-select, Focus Mode, Open in New Tab, Confirm This Revision
    expect(html).toContain('data-testid="prototype-inspect-toggle-btn"');
    expect(html).toContain('data-testid="prototype-focus-mode-btn"');
    expect(html).toContain('data-testid="prototype-open-tab-btn"');
    expect(html).toContain('data-testid="prototype-confirm-revision-btn"');
    expect(html).toContain('确认此修订');

    // Previewing or selecting the already-confirmed revision shows "已确认此修订"
    const confirmedHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCanvasStage
          project={project}
          prototypes={prototypes}
          selectedPrototypeId="proto-a"
          previewRevisionId="rev-1"
          confirmedRevision={confirmedRevision}
          onSelectPrototype={noop}
          onPrototypesUpdated={noop}
          onBackToBrief={noop}
        />
      </PreferencesProvider>,
    );
    expect(confirmedHtml).toContain('已确认此修订');
    expect(confirmedHtml).toContain('R1');

    // Built-in default History & Confirm Modal render Ticket 04 (#26) PrototypeRevisionHistoryDrawer & ConfirmRevisionMuDiffModal
    const builtInHistoryAndConfirmHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCanvasStage
          project={project}
          prototypes={prototypes}
          selectedPrototypeId="proto-a"
          confirmedRevision={confirmedRevision}
          onSelectPrototype={noop}
          onPrototypesUpdated={noop}
          onBackToBrief={noop}
          defaultHistoryOpen
          defaultConfirmModalOpen
        />
      </PreferencesProvider>,
    );
    expect(builtInHistoryAndConfirmHtml).toContain(
      'data-testid="prototype-revision-history-drawer"',
    );
    expect(builtInHistoryAndConfirmHtml).toContain('data-testid="confirm-revision-mu-diff-modal"');
    expect(builtInHistoryAndConfirmHtml).toContain('data-testid="confirm-modal-mu-diff"');

    // Also supports pluggable renderRevisionHistory & renderConfirmModal slots for overrides
    const customSlotsHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCanvasStage
          project={project}
          prototypes={prototypes}
          selectedPrototypeId="proto-a"
          confirmedRevision={confirmedRevision}
          onSelectPrototype={noop}
          onPrototypesUpdated={noop}
          onBackToBrief={noop}
          defaultHistoryOpen
          defaultConfirmModalOpen
          renderRevisionHistory={({ prototype, activeRevision }) => (
            <aside data-testid="custom-history-slot">
              History for {prototype.id} @ {activeRevision.id}
            </aside>
          )}
          renderConfirmModal={({ revision }) => (
            <div data-testid="custom-confirm-slot">Confirm {revision.id}</div>
          )}
        />
      </PreferencesProvider>,
    );
    expect(customSlotsHtml).toContain('data-testid="custom-history-slot"');
    expect(customSlotsHtml).toContain('History for proto-a @ rev-3');
    expect(customSlotsHtml).toContain('data-testid="custom-confirm-slot"');
    expect(customSlotsHtml).toContain('Confirm rev-3');
  });

  it('supports Prototype Switcher actions: Import HTML (1 revision, no MU sync), Save as New Prototype (clones Design Brief & forks session), and Delete (inline 409 Confirmed Revision guard, zero alert/confirm/prompt)', async () => {
    stubLocale('zh-CN');
    const alertSpy = vi.fn();
    const confirmSpy = vi.fn();
    const promptSpy = vi.fn();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => (key === 'onto_locale' ? 'zh-CN' : null),
        setItem: noop,
        removeItem: noop,
      },
      alert: alertSpy,
      confirm: confirmSpy,
      prompt: promptSpy,
    });

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

    const project = store.createProject({
      name: '仓储盘点工程',
      code: 'PROJ_WMS',
      center: 'APPLICATION',
      domain: '仓储库存管理',
      template: 'EMPTY',
    });

    // Create co-design session + initial prototype with Design Brief and confirm its revision
    const baseSession = store.createAgentSession({
      projectId: project.id,
      agentKind: 'REQUIREMENT',
      title: '方向 A 共创会话',
    });
    const createdA = store.createPrototype(project.id, {
      name: '盘点台账方向 A',
      htmlContent:
        '<!DOCTYPE html><html><body><section data-screen-id="SCR-WMS-1" data-screen-name="盘点单列表"></section></body></html>',
      coDesignSessionId: baseSession.id,
      designBrief: {
        items: [{ id: 'b1', category: '色调', statement: '暖白底色配深靛蓝主按钮' }],
        primaryReferenceId: 'increase-com',
        primaryReferenceTitle: 'Increase',
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
    });
    store.confirmPrototypeRevision(project.id, createdA.revision.id);
    const muAfterConfirm = store.getProject(project.id)!.suite.MU;
    expect(muAfterConfirm?.screens.map((s) => s.screenId)).toEqual(['SCR-WMS-1']);

    // 1. Import HTML creates a single-revision prototype WITHOUT syncing MU!
    const importedRes = await runImportPrototypeHtml(
      project.id,
      '外部导入看板.html',
      '<!DOCTYPE html><html><body><section data-screen-id="SCR-IMPORTED-99" data-screen-name="外部大屏"></section><script data-onto-visual-inspector="1">window.__x=1;</script></body></html>',
      'zh-CN',
    );
    expect(importedRes).not.toBeNull();
    expect(importedRes!.prototype.revisions).toHaveLength(1);
    expect(importedRes!.prototype.revisions[0]?.source).toBe('UPLOADED');
    expect(importedRes!.prototype.htmlContent).not.toContain('data-onto-visual-inspector');
    // MU must remain strictly at SCR-WMS-1 (Confirmed Revision), untouched by Import HTML!
    expect(store.getProject(project.id)!.suite.MU?.screens.map((s) => s.screenId)).toEqual([
      'SCR-WMS-1',
    ]);

    // 2. Save as New Prototype clones current revision + Design Brief + forks coDesignSessionId
    const clonedRes = await runClonePrototypeAsNew(
      createdA.prototype.id,
      createdA.prototype.name,
      '盘点台账方向 A · 紧凑版',
    );
    expect(clonedRes.prototype.name).toBe('盘点台账方向 A · 紧凑版');
    expect(clonedRes.prototype.revisions).toHaveLength(1);
    expect(clonedRes.prototype.designBrief?.primaryReferenceId).toBe('increase-com');
    expect(clonedRes.prototype.coDesignSessionId).toBeTruthy();
    expect(clonedRes.prototype.coDesignSessionId).not.toBe(baseSession.id);

    // 3. Deleting the prototype that holds Confirmed Revision is guarded by 409 & returns reason cleanly
    const blockedDelete = await runDeletePrototypeSafely(createdA.prototype.id, project.id);
    expect(blockedDelete.ok).toBe(false);
    if (!blockedDelete.ok) {
      expect(blockedDelete.code).toBe('PROTOTYPE_HOLDS_CONFIRMED_REVISION');
      expect(blockedDelete.errorMessage.length).toBeGreaterThan(4);

      // Render Canvas Stage with switcher delete confirmation showing the inline server error banner
      const stageWithBlockedError = renderToStaticMarkup(
        <PreferencesProvider>
          <PrototypeCanvasStage
            project={store.getProject(project.id)!}
            prototypes={clonedRes.prototypes}
            selectedPrototypeId={createdA.prototype.id}
            confirmedRevision={clonedRes.confirmedRevision}
            onSelectPrototype={noop}
            onPrototypesUpdated={noop}
            onBackToBrief={noop}
            defaultSwitcherOpen
            defaultSwitcherSubPanel="DELETE"
            defaultDeleteError={blockedDelete.errorMessage}
          />
        </PreferencesProvider>,
      );
      expect(stageWithBlockedError).toContain('data-testid="prototype-switcher-menu"');
      expect(stageWithBlockedError).toContain(
        `data-testid="prototype-switcher-item-${createdA.prototype.id}"`,
      );
      expect(stageWithBlockedError).toContain(
        `data-testid="prototype-switcher-item-${importedRes!.prototype.id}"`,
      );
      expect(stageWithBlockedError).toContain(
        `data-testid="prototype-switcher-item-${clonedRes.prototype.id}"`,
      );
      expect(stageWithBlockedError).toContain('data-testid="prototype-import-html-btn"');
      expect(stageWithBlockedError).toContain('data-testid="prototype-clone-action-btn"');
      expect(stageWithBlockedError).toContain('data-testid="prototype-delete-action-btn"');
      expect(stageWithBlockedError).toContain('data-testid="prototype-delete-error-banner"');
      expect(stageWithBlockedError).toContain(blockedDelete.errorMessage);
    }

    // Deleting an unconfirmed prototype succeeds cleanly
    const okDelete = await runDeletePrototypeSafely(clonedRes.prototype.id, project.id);
    expect(okDelete.ok).toBe(true);
    if (okDelete.ok) {
      expect(okDelete.prototypes.map((p) => p.id)).not.toContain(clonedRes.prototype.id);
    }

    // Zero blocking browser dialogs ever invoked
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('enters in-app Focus Mode overlay while keeping Box-Select and Shell Agent Panel accessible, and exits on Escape', () => {
    stubLocale('zh-CN');
    Object.assign(useAgentPanelStore.getInitialState(), {
      open: true,
      overlayOpen: false,
      width: 420,
    });
    useAgentPanelStore.setState({ open: true, overlayOpen: false, width: 420 });
    const project = makeMockProject();
    const { prototypes, confirmedRevision } = makeMockPrototypes();

    expect(computeFocusModeRightOffset(true, true, false, 420)).toBe('420px');
    expect(computeFocusModeRightOffset(true, false, false, 420)).toBe('0px');
    expect(computeFocusModeRightOffset(true, true, true, 420)).toBe('0px');

    const focusHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCanvasStage
          project={project}
          prototypes={prototypes}
          selectedPrototypeId="proto-a"
          confirmedRevision={confirmedRevision}
          onSelectPrototype={noop}
          onPrototypesUpdated={noop}
          onBackToBrief={noop}
          focusMode
          inspectMode
        />
      </PreferencesProvider>,
    );

    expect(focusHtml).toContain('data-focus-mode="true"');
    expect(focusHtml).toContain('right:420px');
    expect(focusHtml).toContain('退出专注 (Esc)');
    // Box-select and Agent Panel toggle remain accessible inside Focus Mode
    expect(focusHtml).toContain('data-testid="prototype-inspect-toggle-btn"');
    expect(focusHtml).toContain('data-testid="visual-select-banner"');
    expect(focusHtml).toContain('data-testid="prototype-focus-agent-toggle-btn"');
    expect(focusHtml).toMatch(/data-testid="prototype-focus-agent-toggle-btn"[^>]*aria-pressed="true"/);

    // Toggling shell Agent Panel from Focus Mode updates shell Agent Panel store
    toggleShellAgentPanelFromCanvas(false);
    expect(useAgentPanelStore.getState().open).toBe(false);
    toggleShellAgentPanelFromCanvas(false);
    expect(useAgentPanelStore.getState().open).toBe(true);

    // Escape key listener exits Focus Mode cleanly
    const listeners = new Map<string, (ev: { key: string; preventDefault: () => void }) => void>();
    const fakeTarget = {
      addEventListener: (
        type: string,
        fn: (ev: { key: string; preventDefault: () => void }) => void,
      ) => {
        listeners.set(type, fn);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    };
    const onExitFocus = vi.fn();
    const cleanup = registerFocusModeEscapeListener(fakeTarget, {
      switcherOpen: false,
      confirmModalOpen: false,
      onCloseSwitcher: noop,
      onCloseConfirmModal: noop,
      onExitFocusMode: onExitFocus,
    });

    const preventDefault = vi.fn();
    listeners.get('keydown')?.({ key: 'Enter', preventDefault });
    expect(onExitFocus).not.toHaveBeenCalled();

    listeners.get('keydown')?.({ key: 'Escape', preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onExitFocus).toHaveBeenCalledTimes(1);

    cleanup();
    expect(listeners.has('keydown')).toBe(false);
  });

  it('switches across Desktop (1440px), Tablet (768px), and Mobile (390px) with auto-fit scaling, and opens clean HTML in a new tab without inspector script', () => {
    stubLocale('en-US');
    const project = makeMockProject();
    const { prototypes, confirmedRevision } = makeMockPrototypes();

    const desktopHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCanvasStage
          project={project}
          prototypes={prototypes}
          selectedPrototypeId="proto-a"
          confirmedRevision={confirmedRevision}
          onSelectPrototype={noop}
          onPrototypesUpdated={noop}
          onBackToBrief={noop}
          viewport="DESKTOP"
          zoomMode="FIT"
          containerWidthOverride={960}
        />
      </PreferencesProvider>,
    );
    expect(desktopHtml).toContain('data-viewport="DESKTOP"');
    expect(desktopHtml).toContain('width:1440px');
    expect(desktopHtml).toContain('transform:scale(0.65)');
    expect(desktopHtml).toContain('65%');

    const tabletHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCanvasStage
          project={project}
          prototypes={prototypes}
          selectedPrototypeId="proto-a"
          confirmedRevision={confirmedRevision}
          onSelectPrototype={noop}
          onPrototypesUpdated={noop}
          onBackToBrief={noop}
          viewport="TABLET"
          zoomMode="FIT"
          containerWidthOverride={640}
        />
      </PreferencesProvider>,
    );
    expect(tabletHtml).toContain('data-viewport="TABLET"');
    expect(tabletHtml).toContain('width:768px');
    expect(tabletHtml).toContain('transform:scale(0.802)');
    expect(tabletHtml).toContain('80%');

    const mobileHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeCanvasStage
          project={project}
          prototypes={prototypes}
          selectedPrototypeId="proto-a"
          confirmedRevision={confirmedRevision}
          onSelectPrototype={noop}
          onPrototypesUpdated={noop}
          onBackToBrief={noop}
          viewport="MOBILE"
          zoomMode="FIT"
          containerWidthOverride={640}
        />
      </PreferencesProvider>,
    );
    expect(mobileHtml).toContain('data-viewport="MOBILE"');
    expect(mobileHtml).toContain('width:390px');
    expect(mobileHtml).toContain('transform:scale(1)');
    expect(mobileHtml).toContain('100%');

    // Open in New Tab creates a clean Blob URL stripped of any injected inspector script
    const inspectedHtml = injectVisualInspectorIntoHtml(prototypes[0]!.htmlContent, {
      token: 'tok-canvas-tab',
      targetOrigin: 'http://localhost:5173',
      initialActive: true,
      locale: 'en-US',
    });
    expect(inspectedHtml).toContain('data-onto-visual-inspector="1"');

    const capturedBlobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      capturedBlobs.push(blob);
      return 'blob:http://localhost/clean-tab-preview';
    });
    const revokeObjectURL = vi.fn();
    const openWindow = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => (key === 'onto_locale' ? 'en-US' : null),
        setItem: noop,
        removeItem: noop,
      },
      open: openWindow,
    });

    const opened = openCleanPrototypeInNewTab(inspectedHtml);
    expect(opened).not.toBeNull();
    expect(opened?.cleanHtml).not.toContain('data-onto-visual-inspector');
    expect(opened?.cleanHtml).toContain('data-screen-id="SCR-LIST"');
    expect(capturedBlobs[0]?.type).toBe('text/html;charset=utf-8');
    expect(openWindow).toHaveBeenCalledWith(
      'blob:http://localhost/clean-tab-preview',
      '_blank',
      'noopener,noreferrer',
    );
  });
});

function setMockWorkbenchData(patch: Partial<BootstrapPayload>) {
  const project = makeMockProject();
  const payload: BootstrapPayload = {
    projects: [
      {
        id: project.id,
        name: project.name,
        code: project.code,
        center: project.center,
        domain: project.domain,
        description: project.description,
        currentStage: project.currentStage,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ],
    activeProject: project,
    projectSnapshots: [],
    agentSessions: [],
    requirementSessions: [],
    requirementDocs: [],
    prototypes: [],
    confirmedPrototypeRevision: null,
    fourLayerAssets: [],
    assembledApplications: [],
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
      workspaceDir: '/tmp/onto-test',
      defaultLanguage: 'zh-CN',
      defaultTheme: 'light',
      strictValidation: true,
      autoMirrorYaml: false,
      autoSyncPrototypeMu: false,
    },
    ...patch,
  };
  Object.assign(useWorkbenchStore.getInitialState(), { data: payload });
  useWorkbenchStore.setState({ data: payload });
}

describe('PrototypeStudioView two-stage architecture: Briefing Stage <-> Canvas Stage (#27)', () => {
  afterEach(() => {
    Object.assign(useWorkbenchStore.getInitialState(), { data: null });
    useWorkbenchStore.setState({ data: null });
  });

  it('automatically enters Canvas Stage when prototypes exist and removes Version Registry and 3-step wizard', () => {
    stubLocale('zh-CN');
    const { prototypes, confirmedRevision } = makeMockPrototypes();
    setMockWorkbenchData({
      prototypes,
      confirmedPrototypeRevision: confirmedRevision,
    });

    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView />
      </PreferencesProvider>,
    );

    expect(html).toContain('data-testid="prototype-canvas-stage"');
    expect(html).toContain('data-testid="prototype-switcher-trigger"');
    expect(html).toContain('data-testid="prototype-history-btn"');
    expect(html).toContain('data-testid="prototype-confirm-revision-btn"');
    expect(html).toContain('data-testid="prototype-back-to-brief-btn"');

    // Legacy Version Registry and 1 -> 2 -> 3 wizard are completely removed
    expect(html).not.toContain('prototype-registry-table');
    expect(html).not.toContain('proto-mode-registry');
    expect(html).not.toContain('proto-step-1');
    expect(html).not.toContain('proto-step-2');
    expect(html).not.toContain('proto-step-3');
  });

  it('enters Briefing Stage when 0 prototypes exist, and supports switching Canvas Stage <-> Briefing Stage in zh-CN and en-US', () => {
    // 1. 0 prototypes -> Briefing Stage automatically
    stubLocale('zh-CN');
    setMockWorkbenchData({ prototypes: [], confirmedPrototypeRevision: null });

    const emptyProjectHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView />
      </PreferencesProvider>,
    );
    expect(emptyProjectHtml).toContain('data-testid="prototype-briefing-stage"');
    expect(emptyProjectHtml).not.toContain('data-testid="prototype-canvas-stage"');
    expect(emptyProjectHtml).not.toContain('data-testid="prototype-back-to-canvas-btn"');
    expect(emptyProjectHtml).not.toContain('prototype-registry-table');
    expect(emptyProjectHtml).not.toContain('proto-step-1');

    // 2. With prototypes present, Back to Brief switches to Briefing Stage and offers Back to Canvas (zh-CN)
    const { prototypes, confirmedRevision } = makeMockPrototypes();
    setMockWorkbenchData({
      prototypes,
      confirmedPrototypeRevision: confirmedRevision,
    });

    const zhBriefHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView defaultStageOverride="BRIEFING" />
      </PreferencesProvider>,
    );
    expect(zhBriefHtml).toContain('data-testid="prototype-briefing-stage"');
    expect(zhBriefHtml).toContain('data-testid="prototype-back-to-canvas-btn"');
    expect(zhBriefHtml).toContain('返回画布');
    expect(zhBriefHtml).not.toContain('proto-step-1');

    const zhCanvasHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView defaultStageOverride="CANVAS" />
      </PreferencesProvider>,
    );
    expect(zhCanvasHtml).toContain('data-testid="prototype-canvas-stage"');
    expect(zhCanvasHtml).toContain('返回简报');

    // 3. Same Canvas <-> Briefing round-trip in en-US
    stubLocale('en-US');
    const enCanvasHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView defaultStageOverride="CANVAS" />
      </PreferencesProvider>,
    );
    expect(enCanvasHtml).toContain('data-testid="prototype-canvas-stage"');
    expect(enCanvasHtml).toContain('Back to Brief');

    const enBriefHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView defaultStageOverride="BRIEFING" />
      </PreferencesProvider>,
    );
    expect(enBriefHtml).toContain('data-testid="prototype-briefing-stage"');
    expect(enBriefHtml).toContain('data-testid="prototype-back-to-canvas-btn"');
    expect(enBriefHtml).toContain('Back to Canvas');
    expect(enBriefHtml).not.toContain('prototype-registry-table');
    expect(enBriefHtml).not.toContain('proto-step-1');
  });
});
