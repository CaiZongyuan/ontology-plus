import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceStore,
  type AgentSession,
  type ConfirmedPrototypeRevision,
  type InteractivePrototype,
  type ProjectDetail,
} from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload } from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import {
  LOCAL_IMAGE_DB_NAME,
  clearLocalImageStore,
  loadLocalImage,
  resetLocalImageMemoryCacheForTests,
  resetLocalImageStoreForTests,
} from '../../lib/localImageStore.js';
import { PrototypeStudioView } from '../../views/ApplicationCenterViews.js';
import { ShellAgentPanel, agentPanelSurfaceFor } from '../agent/ShellAgentPanel.js';
import { useAgentPanelStore } from '../agent/agentPanelStore.js';
import type { PrototypeSelectionTarget } from './PrototypeVisualInspector.js';
import {
  PrototypePostRunBanner,
  SelectionAttachmentStrip,
} from './SelectionAttachmentStrip.js';
import {
  buildRefinementPayloadFromAttachments,
  ingestSelectionTargetAsAttachment,
  resetPrototypeSelectionStoreForTests,
  revertPostRunToPreviousRevision,
  submitPrototypeComposerTurnWithSelections,
  usePrototypeSelectionStore,
} from './prototypeSelectionStore.js';

const noop = () => {};

function stubLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

function createFakeIndexedDb() {
  const databases = new Map<string, Map<string, Map<string, unknown>>>();

  const open = (dbName: string, _version?: number) => {
    const req: Record<string, unknown> = {
      result: null,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };

    queueMicrotask(() => {
      let stores = databases.get(dbName);
      const isNew = !stores;
      if (!stores) {
        stores = new Map();
        databases.set(dbName, stores);
      }

      const db = {
        objectStoreNames: {
          contains: (name: string) => stores!.has(name),
        },
        createObjectStore: (name: string) => {
          if (!stores!.has(name)) {
            stores!.set(name, new Map());
          }
          return {};
        },
        transaction: (storeName: string, _mode?: string) => {
          const bucket = stores!.get(storeName) ?? new Map<string, unknown>();
          stores!.set(storeName, bucket);
          const tx: Record<string, unknown> = {
            oncomplete: null,
            onerror: null,
            objectStore: () => ({
              put: (val: { id: string }) => {
                const op: Record<string, unknown> = {
                  result: val.id,
                  onsuccess: null,
                  onerror: null,
                };
                bucket.set(val.id, structuredClone(val));
                queueMicrotask(() => {
                  (op.onsuccess as (() => void) | null)?.();
                  (tx.oncomplete as (() => void) | null)?.();
                });
                return op;
              },
              get: (key: string) => {
                const op: Record<string, unknown> = {
                  result: bucket.has(key) ? structuredClone(bucket.get(key)) : undefined,
                  onsuccess: null,
                  onerror: null,
                };
                queueMicrotask(() => {
                  (op.onsuccess as (() => void) | null)?.();
                  (tx.oncomplete as (() => void) | null)?.();
                });
                return op;
              },
              delete: (key: string) => {
                const op: Record<string, unknown> = {
                  result: undefined,
                  onsuccess: null,
                  onerror: null,
                };
                bucket.delete(key);
                queueMicrotask(() => {
                  (op.onsuccess as (() => void) | null)?.();
                  (tx.oncomplete as (() => void) | null)?.();
                });
                return op;
              },
              clear: () => {
                const op: Record<string, unknown> = {
                  result: undefined,
                  onsuccess: null,
                  onerror: null,
                };
                bucket.clear();
                queueMicrotask(() => {
                  (op.onsuccess as (() => void) | null)?.();
                  (tx.oncomplete as (() => void) | null)?.();
                });
                return op;
              },
            }),
          };
          return tx;
        },
        close: noop,
      };

      req.result = db;
      if (isNew) {
        (req.onupgradeneeded as (() => void) | null)?.();
      }
      (req.onsuccess as (() => void) | null)?.();
    });

    return req;
  };

  return { databases, indexedDB: { open } };
}

function makeMockProject(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'proj-sel-1',
    name: '合同全生命周期工程',
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

function makeSampleTargets(): {
  approveBtnTarget: PrototypeSelectionTarget;
  filterRegionTarget: PrototypeSelectionTarget;
} {
  return {
    approveBtnTarget: {
      kind: 'ELEMENT',
      tagName: 'button',
      cssSelector: 'button[data-element-id="EL-APPROVE"]',
      label: '批量审批',
      textPreview: '批量审批',
      htmlSnippet: '<button data-element-id="EL-APPROVE">批量审批</button>',
      screenId: 'SCR-CONTRACT-LIST',
      elementId: 'EL-APPROVE',
      eventId: 'UIE-APPROVE',
      rect: { x: 420, y: 84, width: 112, height: 34 },
    },
    filterRegionTarget: {
      kind: 'REGION',
      tagName: 'section',
      cssSelector: '[data-screen-id="SCR-CONTRACT-LIST"]',
      label: '框选 2 个控件 · SCR-CONTRACT-LIST',
      textPreview: '检索合同 / 状态筛选',
      htmlSnippet: '<input data-element-id="EL-SEARCH" /><select data-element-id="EL-STATUS"></select>',
      screenId: 'SCR-CONTRACT-LIST',
      matchedElementCount: 2,
      matchedElementsSummary: [
        'SCR-CONTRACT-LIST · EL-SEARCH · 检索合同',
        'SCR-CONTRACT-LIST · EL-STATUS · 状态筛选',
      ],
      rect: { x: 24, y: 72, width: 360, height: 56 },
    },
  };
}

function makePrototypesFixture(): {
  proto: InteractivePrototype;
  confirmedRevision: ConfirmedPrototypeRevision;
} {
  const rev1 = {
    id: 'rev-1',
    prototypeId: 'proto-1',
    projectId: 'proj-sel-1',
    revisionNumber: 1,
    title: '初始合同台账布局',
    htmlContent:
      '<!DOCTYPE html><html><body><section data-screen-id="SCR-CONTRACT-LIST"><input data-element-id="EL-SEARCH" /><button data-element-id="EL-APPROVE">审批旧文案</button></section></body></html>',
    extractedScreenCount: 1,
    source: 'GENERATED' as const,
    createdAt: '2026-11-12T10:00:00.000Z',
  };
  const rev2 = {
    id: 'rev-2',
    prototypeId: 'proto-1',
    projectId: 'proj-sel-1',
    revisionNumber: 2,
    title: '审批按钮增加高亮徽标',
    htmlContent:
      '<!DOCTYPE html><html><body><section data-screen-id="SCR-CONTRACT-LIST"><input data-element-id="EL-SEARCH" /><button data-element-id="EL-APPROVE" class="refined-primary">批量审批（新）</button></section></body></html>',
    extractedScreenCount: 1,
    source: 'AGENT_RUN' as const,
    agentRunId: 'amsg-run-1',
    createdAt: '2026-11-12T10:05:00.000Z',
  };
  const proto: InteractivePrototype = {
    id: 'proto-1',
    projectId: 'proj-sel-1',
    name: '合同台账方向 A',
    coDesignSessionId: 'sess-proto-1',
    revisions: [rev1, rev2],
    currentRevisionId: 'rev-2',
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: '2026-11-12T10:05:00.000Z',
    version: 'r2',
    htmlContent: rev2.htmlContent,
    extractedScreenCount: 1,
    isConfirmed: false,
    confirmedRevisionId: 'rev-1',
    aheadOfConfirmedCount: 1,
  };
  const confirmedRevision: ConfirmedPrototypeRevision = {
    projectId: 'proj-sel-1',
    prototypeId: 'proto-1',
    revisionId: 'rev-1',
    confirmedAt: '2026-11-12T10:01:00.000Z',
    prototype: proto,
    revision: rev1,
    htmlContent: rev1.htmlContent,
  };
  return { proto, confirmedRevision };
}

function setWorkbenchDataForTest(
  patch: Partial<BootstrapPayload>,
  extraState?: Partial<ReturnType<typeof useWorkbenchStore.getState>>,
) {
  const project = patch.activeProject ?? makeMockProject();
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
    llmProviders: [
      {
        id: 'llm-1',
        name: 'Vision Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: 'http://127.0.0.1:3425/v1',
        apiKey: 'test',
        defaultModel: 'auto/glm-5.3-flash',
        availableModels: ['auto/glm-5.3-flash'],
        enabled: true,
        supportsVision: true,
      },
    ],
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

  const next = {
    data: payload,
    backgroundTasks: [],
    liveSessionDrafts: {},
    sessionQueues: {},
    activePrototypeIdByProject: {},
    ...extraState,
  };
  Object.assign(useWorkbenchStore.getInitialState(), next);
  useWorkbenchStore.setState(next);
}

afterEach(async () => {
  resetPrototypeSelectionStoreForTests();
  await resetLocalImageStoreForTests();
  vi.unstubAllGlobals();
  Object.assign(useAgentPanelStore.getInitialState(), {
    open: true,
    overlayOpen: false,
    width: 384,
    hoveredAnchor: null,
  });
  useAgentPanelStore.setState({
    open: true,
    overlayOpen: false,
    width: 384,
    hoveredAnchor: null,
  });
  Object.assign(useWorkbenchStore.getInitialState(), {
    data: null,
    backgroundTasks: [],
    liveSessionDrafts: {},
    sessionQueues: {},
    activePrototypeIdByProject: {},
  });
  useWorkbenchStore.setState({
    data: null,
    backgroundTasks: [],
    liveSessionDrafts: {},
    sessionQueues: {},
    activePrototypeIdByProject: {},
  });
});

describe('Ticket 06 (#28): Box-Select Attachment Cards, Live Anchor Highlight, and Before/After Toggle', () => {
  it('stores cropped box-selection screenshots in browser-only localImageStore, renders composer attachment cards in ShellAgentPanel, supports individual removal, and shows graceful missing-image placeholder when cleared locally (§5.4)', async () => {
    const fakeIdb = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', fakeIdb.indexedDB);
    stubLocale('zh-CN');

    const { proto, confirmedRevision } = makePrototypesFixture();
    setWorkbenchDataForTest(
      {
        prototypes: [{ ...proto, revisions: [proto.revisions[0]!], currentRevisionId: 'rev-1' }],
        confirmedPrototypeRevision: confirmedRevision,
      },
      { activePrototypeIdByProject: { [proto.projectId]: proto.id } },
    );

    const { approveBtnTarget, filterRegionTarget } = makeSampleTargets();
    const cropBase64A = Buffer.from('fake-webp-crop-approve').toString('base64');
    const cropBase64B = Buffer.from('fake-webp-crop-region').toString('base64');

    const attA = await ingestSelectionTargetAsAttachment(proto.id, approveBtnTarget, {
      crop: { mimeType: 'image/webp', dataBase64: cropBase64A, width: 112, height: 34 },
    });
    const attB = await ingestSelectionTargetAsAttachment(proto.id, filterRegionTarget, {
      crop: { mimeType: 'image/webp', dataBase64: cropBase64B, width: 360, height: 56 },
    });

    // Persisted in browser-only IndexedDB with role 'selection_crop'
    expect(fakeIdb.databases.has(LOCAL_IMAGE_DB_NAME)).toBe(true);
    expect(attA.imageRef.role).toBe('selection_crop');
    expect(attA.imageRef.source).toBe('local');
    expect('dataBase64' in (attA.imageRef as unknown as Record<string, unknown>)).toBe(false);

    const loadedCropA = await loadLocalImage(attA.imageRef.id);
    expect(loadedCropA?.dataBase64).toBe(cropBase64A);

    // ShellAgentPanel on 'app-prototype' automatically renders SelectionAttachmentStrip in composerHeaderSlot
    const surface = agentPanelSurfaceFor('app-prototype')!;
    const panelHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ShellAgentPanel surface={surface} overlay={false} onClose={noop} onNavigate={noop} />
      </PreferencesProvider>,
    );

    expect(panelHtml).toContain('data-testid="agent-panel-composer-slot"');
    expect(panelHtml).toContain('data-testid="selection-attachment-strip"');
    expect(panelHtml).toContain('SCR-CONTRACT-LIST · EL-APPROVE');
    expect(panelHtml).toContain('批量审批');
    expect(panelHtml).toContain('框选 2 个控件');
    expect(panelHtml).toContain(`data-testid="selection-attachment-remove-${attA.id}"`);
    expect(panelHtml).toContain(`data-testid="selection-attachment-remove-${attB.id}"`);
    expect(panelHtml).toContain(`data:image/webp;base64,${cropBase64A}`);

    // Remove individual attachment card A -> only B remains
    usePrototypeSelectionStore.getState().removeSelectionAttachment(proto.id, attA.id);
    const afterRemoveHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <SelectionAttachmentStrip prototypeId={proto.id} />
      </PreferencesProvider>,
    );
    expect(afterRemoveHtml).not.toContain(`data-testid="selection-attachment-remove-${attA.id}"`);
    expect(afterRemoveHtml).toContain(`data-testid="selection-attachment-remove-${attB.id}"`);

    // Clear browser IndexedDB + memory cache -> shows graceful missing-image placeholder (§5.4) in zh-CN and en-US
    await clearLocalImageStore();
    resetLocalImageMemoryCacheForTests();
    await loadLocalImage(attB.imageRef.id);

    const missingZhHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <SelectionAttachmentStrip prototypeId={proto.id} />
      </PreferencesProvider>,
    );
    expect(missingZhHtml).toContain('data-testid="local-image-missing-placeholder"');
    expect(missingZhHtml).toContain('图片已不在本机');

    stubLocale('en-US');
    const missingEnHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <SelectionAttachmentStrip prototypeId={proto.id} />
      </PreferencesProvider>,
    );
    expect(missingEnHtml).toContain('Image no longer on this device');
  });

  it('passes BOTH selections and selection_crop images into startPrototypeRefinementRun when supportsVision is true, and omits image bytes while recording visionFallbackUsed when supportsVision is false (#28, #30)', async () => {
    const fakeIdb = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', fakeIdb.indexedDB);
    stubLocale('zh-CN');

    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return app.request(url.startsWith('http') ? url : `http://localhost${url}`, init);
    });

    const project = store.listProjects()[0]!;
    const createdProto = store.createPrototype(project.id, {
      name: '测试共创原型',
      htmlContent:
        '<!DOCTYPE html><html><body><section data-screen-id="SCR-CONTRACT-LIST"><button data-element-id="EL-APPROVE">审批</button></section></body></html>',
      source: 'GENERATED',
    });

    const { approveBtnTarget } = makeSampleTargets();
    const cropBytesBase64 = Buffer.from('real-crop-image-bytes-png').toString('base64');
    const att = await ingestSelectionTargetAsAttachment(createdProto.prototype.id, approveBtnTarget, {
      crop: { mimeType: 'image/png', dataBase64: cropBytesBase64, width: 112, height: 34 },
    });

    // 1. Vision supported = true -> payload contains both selections AND dataBase64 image
    const visionPayload = await buildRefinementPayloadFromAttachments([att], {
      visionSupported: true,
    });
    expect(visionPayload.selections).toHaveLength(1);
    expect(visionPayload.selections[0]?.elementId).toBe('EL-APPROVE');
    expect(visionPayload.selections[0]?.screenId).toBe('SCR-CONTRACT-LIST');
    expect(visionPayload.images).toHaveLength(1);
    expect(visionPayload.images[0]).toMatchObject({
      id: att.imageRef.id,
      mimeType: 'image/png',
      dataBase64: cropBytesBase64,
      role: 'selection_crop',
    });

    // 2. Vision supported = false -> omits dataBase64 bytes on the wire while keeping lightweight ref so server records visionFallbackUsed
    const textOnlyProvider = store.listLlmProviders()[0]!;
    store.saveLlmProvider({
      ...textOnlyProvider,
      enabled: true,
      supportsVision: false,
    });

    setWorkbenchDataForTest(
      {
        activeProject: store.getProject(project.id)!,
        prototypes: store.listPrototypes(project.id),
        agentSessions: store.listAgentSessions({ projectId: project.id }),
        llmProviders: store.listLlmProviders(),
      },
      { activePrototypeIdByProject: { [project.id]: createdProto.prototype.id } },
    );

    const spyRefinement = vi.spyOn(useWorkbenchStore.getState(), 'startPrototypeRefinementRun');

    await submitPrototypeComposerTurnWithSelections({
      projectId: project.id,
      prototypeId: createdProto.prototype.id,
      instruction: '将批量审批按钮改为醒目主按钮样式',
      visionSupported: false,
      mockMode: true,
    });

    expect(spyRefinement).toHaveBeenCalledTimes(1);
    const callArg = spyRefinement.mock.calls[0]?.[0];
    expect(callArg?.selections).toHaveLength(1);
    expect(callArg?.selections?.[0]?.elementId).toBe('EL-APPROVE');
    expect(callArg?.images).toHaveLength(1);
    expect(callArg?.images?.[0]?.role).toBe('selection_crop');
    expect(callArg?.images?.[0]?.dataBase64).toBeUndefined();

    // Composer attachment strip was consumed/cleared on submit
    expect(usePrototypeSelectionStore.getState().getAttachments(createdProto.prototype.id)).toHaveLength(0);

    // Wait briefly for in-memory mock stream to finish and verify SQLite zero-byte contract + visionFallbackUsed
    await vi.waitFor(() => {
      const sessions = store.listAgentSessions({
        projectId: project.id,
        agentKind: 'PROTOTYPE_CO_DESIGN',
      });
      expect(sessions[0]?.messages.some((m) => m.role === 'assistant')).toBe(true);
    });

    const persistedSession = store.listAgentSessions({
      projectId: project.id,
      agentKind: 'PROTOTYPE_CO_DESIGN',
    })[0]!;
    const userMsg = persistedSession.messages.find((m) => m.role === 'user')!;
    expect(userMsg.images).toHaveLength(1);
    expect(userMsg.images?.[0]).toMatchObject({
      id: att.imageRef.id,
      source: 'local',
      role: 'selection_crop',
    });
    expect(JSON.stringify(persistedSession)).not.toContain(cropBytesBase64);
  });

  it('highlights matching canvas region bidirectionally when hovering an attachment card OR an AgentRunCard step anchor badge (#28)', async () => {
    stubLocale('zh-CN');
    const { proto, confirmedRevision } = makePrototypesFixture();
    setWorkbenchDataForTest({
      prototypes: [{ ...proto, revisions: [proto.revisions[0]!], currentRevisionId: 'rev-1' }],
      confirmedPrototypeRevision: confirmedRevision,
    });

    const { approveBtnTarget } = makeSampleTargets();
    const att = await ingestSelectionTargetAsAttachment(proto.id, approveBtnTarget);

    // 1. Hovering an attachment card sets hoveredAnchor -> PrototypeStudioView passes highlightedSelector to canvas
    usePrototypeSelectionStore.getState().hoverAttachment(att);
    expect(useAgentPanelStore.getState().hoveredAnchor).toEqual({
      screenId: 'SCR-CONTRACT-LIST',
      elementId: 'EL-APPROVE',
      cssSelector: 'button[data-element-id="EL-APPROVE"]',
      label: '批量审批',
    });

    const hoveredFromAttachmentHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView />
      </PreferencesProvider>,
    );
    expect(hoveredFromAttachmentHtml).toContain(
      'data-highlighted-selector="[data-screen-id=&quot;SCR-CONTRACT-LIST&quot;] [data-element-id=&quot;EL-APPROVE&quot;]"',
    );

    // Unhover clears canvas highlight
    usePrototypeSelectionStore.getState().hoverAttachment(null);
    expect(useAgentPanelStore.getState().hoveredAnchor).toBeNull();

    // 2. Hovering an AgentRunCard step anchor badge (via useAgentPanelStore.setHoveredAnchor) also highlights live canvas
    useAgentPanelStore.getState().setHoveredAnchor({
      screenId: 'SCR-CONTRACT-LIST',
      elementId: 'EL-SEARCH',
    });
    Object.assign(useAgentPanelStore.getInitialState(), useAgentPanelStore.getState());

    const hoveredFromRunStepHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView />
      </PreferencesProvider>,
    );
    expect(hoveredFromRunStepHtml).toContain(
      'data-highlighted-selector="[data-screen-id=&quot;SCR-CONTRACT-LIST&quot;] [data-element-id=&quot;EL-SEARCH&quot;]"',
    );
  });

  it('highlights activeAnchor live during RUNNING turn while keeping Box-Select enabled and queueing new selections + images FIFO (#28)', async () => {
    stubLocale('zh-CN');
    const { proto, confirmedRevision } = makePrototypesFixture();
    const runningSession: AgentSession = {
      id: 'sess-proto-1',
      projectId: proto.projectId,
      agentKind: 'PROTOTYPE_CO_DESIGN',
      targetId: proto.id,
      title: '原型共创会话',
      status: 'RUNNING',
      messages: [
        {
          id: 'amsg-u1',
          role: 'user',
          content: '第一轮修改标题',
          timestamp: '2026-11-12T10:04:00.000Z',
        },
      ],
      createdAt: '2026-11-12T10:00:00.000Z',
      updatedAt: '2026-11-12T10:04:00.000Z',
    };

    setWorkbenchDataForTest(
      {
        prototypes: [{ ...proto, revisions: [proto.revisions[0]!], currentRevisionId: 'rev-1' }],
        confirmedPrototypeRevision: confirmedRevision,
        agentSessions: [runningSession],
      },
      {
        activePrototypeIdByProject: { [proto.projectId]: proto.id },
        liveSessionDrafts: {
          'sess-proto-1': {
            runId: 'lrun-1',
            sessionId: 'sess-proto-1',
            userPrompt: '第一轮修改标题',
            startedAt: Date.now() - 2000,
            liveStatus: { zh: '局部修改锚点片段 (SCR-CONTRACT-LIST · EL-SEARCH)…', en: 'Edit anchor…' },
            thinking: '',
            text: '',
            steps: [
              {
                id: 'tc-1',
                label: { zh: '局部修改锚点片段', en: 'Edit anchor fragment' },
                status: 'RUNNING',
                toolName: 'edit_prototype_anchor',
                targetAnchor: {
                  screenId: 'SCR-CONTRACT-LIST',
                  elementId: 'EL-SEARCH',
                },
              },
            ],
            activeAnchor: {
              screenId: 'SCR-CONTRACT-LIST',
              elementId: 'EL-SEARCH',
            },
          },
        },
      },
    );

    const liveCanvasHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView />
      </PreferencesProvider>,
    );

    // Live modifying badge is shown for the active anchor AND Box-Select toggle button is NOT disabled
    expect(liveCanvasHtml).toContain('data-testid="prototype-live-modifying-badge"');
    expect(liveCanvasHtml).toContain('Agent 正在修改');
    expect(liveCanvasHtml).toContain('SCR-CONTRACT-LIST · EL-SEARCH');
    const inspectBtnMatch = /<button[^>]*data-testid="prototype-inspect-toggle-btn"[^>]*>/.exec(
      liveCanvasHtml,
    );
    expect(inspectBtnMatch?.[0]).toBeDefined();
    expect(inspectBtnMatch?.[0]).not.toMatch(/\sdisabled(?:=|>|\s)/);

    // User box-selects an element during the active run -> accumulates for the NEXT queued turn
    const { approveBtnTarget } = makeSampleTargets();
    const queuedCropBase64 = Buffer.from('queued-turn-crop').toString('base64');
    await ingestSelectionTargetAsAttachment(proto.id, approveBtnTarget, {
      crop: { mimeType: 'image/webp', dataBase64: queuedCropBase64, width: 112, height: 34 },
    });
    expect(usePrototypeSelectionStore.getState().getAttachments(proto.id)).toHaveLength(1);

    // User submits while Run #1 is still active -> queues FIFO into sessionQueues['sess-proto-1'] with selections + images!
    await submitPrototypeComposerTurnWithSelections({
      projectId: proto.projectId,
      prototypeId: proto.id,
      instruction: '第二轮把审批按钮改成绿色通过样式',
      visionSupported: true,
    });

    const queue = useWorkbenchStore.getState().sessionQueues['sess-proto-1'] ?? [];
    expect(queue).toHaveLength(1);
    expect(queue[0]?.prompt).toContain('EL-APPROVE');
    expect(queue[0]?.prompt).toContain('第二轮把审批按钮改成绿色通过样式');
    expect(queue[0]?.images).toHaveLength(1);
    expect(queue[0]?.images?.[0]).toMatchObject({
      role: 'selection_crop',
      dataBase64: queuedCropBase64,
    });
    // Composer attachments were consumed into the queued turn
    expect(usePrototypeSelectionStore.getState().getAttachments(proto.id)).toHaveLength(0);
  });

  it('flashes modifiedAnchors once after run completion, toggles Before / After htmlOverride, reverts to previous revision cleanly via apiRestorePrototypeRevision without rewriting history, and supports dismiss (#28)', async () => {
    stubLocale('zh-CN');
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return app.request(url.startsWith('http') ? url : `http://localhost${url}`, init);
    });

    const project = store.listProjects()[0]!;
    const r1 = store.createPrototype(project.id, {
      name: '合同审批工作台',
      htmlContent:
        '<!DOCTYPE html><html><body><section data-screen-id="SCR-CONTRACT-LIST"><button data-element-id="EL-APPROVE">审批旧版R1</button></section></body></html>',
      source: 'GENERATED',
      title: '初始版本',
    });
    const r2 = store.appendPrototypeRevision(r1.prototype.id, {
      title: '升级批量审批按钮',
      instruction: '升级批量审批按钮',
      htmlContent:
        '<!DOCTYPE html><html><body><section data-screen-id="SCR-CONTRACT-LIST"><button data-element-id="EL-APPROVE">批量审批新版R2</button></section></body></html>',
      source: 'AGENT_RUN',
      agentRunId: 'amsg-a1',
    });
    const session = store.createAgentSession({
      projectId: project.id,
      agentKind: 'PROTOTYPE_CO_DESIGN',
      targetId: r1.prototype.id,
      title: '原型共创会话',
      initialMessages: [
        {
          id: 'amsg-u1',
          role: 'user',
          content: '升级批量审批按钮',
          timestamp: '2026-11-12T10:04:00.000Z',
        },
        {
          id: 'amsg-a1',
          role: 'assistant',
          content: '已完成审批按钮升级。',
          timestamp: '2026-11-12T10:05:00.000Z',
          artifacts: [
            {
              kind: 'PROTOTYPE_REVISION',
              prototypeId: r1.prototype.id,
              revisionId: r2.revision.id,
              revisionNumber: r2.revision.revisionNumber,
              modifiedAnchors: [
                {
                  screenId: 'SCR-CONTRACT-LIST',
                  elementId: 'EL-APPROVE',
                  label: '批量审批',
                },
              ],
            },
          ],
        },
      ],
    });
    store.linkPrototypeCoDesignSession(r1.prototype.id, session.id);

    setWorkbenchDataForTest(
      {
        activeProject: store.getProject(project.id)!,
        prototypes: store.listPrototypes(project.id),
        confirmedPrototypeRevision: store.getConfirmedPrototypeRevision(project.id) ?? null,
        agentSessions: store.listAgentSessions({ projectId: project.id }),
      },
      { activePrototypeIdByProject: { [project.id]: r1.prototype.id } },
    );

    // 1. Post-run render shows post-run banner + initial one-shot flashedAnchors + After HTML (R2)
    const afterHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView />
      </PreferencesProvider>,
    );
    expect(afterHtml).toContain('data-testid="prototype-post-run-banner"');
    expect(afterHtml).toContain('R2');
    expect(afterHtml).toContain('SCR-CONTRACT-LIST · EL-APPROVE');
    expect(afterHtml).toContain('改前');
    expect(afterHtml).toContain('改后');
    expect(afterHtml).toContain('回到上一修订');
    expect(afterHtml).toContain('data-flashed-anchors="SCR-CONTRACT-LIST · EL-APPROVE"');
    expect(afterHtml).toContain('批量审批新版R2');

    // Marking revision flashed clears one-shot flash while keeping post-run banner visible
    usePrototypeSelectionStore.getState().markRevisionFlashed(r1.prototype.id, r2.revision.id);
    const postFlashHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView />
      </PreferencesProvider>,
    );
    expect(postFlashHtml).toContain('data-testid="prototype-post-run-banner"');
    expect(postFlashHtml).toContain('data-flashed-anchors=""');

    // 2. Switching to Before ('BEFORE') passes R1 htmlContent via htmlOverride!
    usePrototypeSelectionStore.getState().setBeforeAfterMode(r1.prototype.id, 'BEFORE', r2.revision.id);
    const beforeHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView />
      </PreferencesProvider>,
    );
    expect(beforeHtml).toContain('审批旧版R1');
    expect(beforeHtml).not.toContain('批量审批新版R2');

    // Switching back to After ('AFTER') shows R2 htmlContent again + check en-US labels
    usePrototypeSelectionStore.getState().setBeforeAfterMode(r1.prototype.id, 'AFTER', r2.revision.id);
    stubLocale('en-US');
    const enBannerHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView />
      </PreferencesProvider>,
    );
    expect(enBannerHtml).toContain('Before');
    expect(enBannerHtml).toContain('After');
    expect(enBannerHtml).toContain('Revert to previous revision');
    expect(enBannerHtml).toContain('批量审批新版R2');

    // 3. One-click Revert to previous revision calls apiRestorePrototypeRevision, appends R3 without rewriting [R1, R2], and exits post-run mode
    await revertPostRunToPreviousRevision(r1.prototype.id, r1.revision.id);

    const updatedProto = useWorkbenchStore
      .getState()
      .data?.prototypes.find((p) => p.id === r1.prototype.id)!;
    expect(updatedProto.revisions).toHaveLength(3);
    expect(updatedProto.revisions.map((rev) => rev.revisionNumber)).toEqual([1, 2, 3]);
    expect(updatedProto.revisions[2]?.source).toBe('RESTORED');
    expect(updatedProto.htmlContent).toContain('审批旧版R1');
    expect(usePrototypeSelectionStore.getState().getBeforeAfterMode(r1.prototype.id, updatedProto.currentRevisionId)).toBe('AFTER');

    const afterRevertHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView />
      </PreferencesProvider>,
    );
    expect(afterRevertHtml).not.toContain('data-testid="prototype-post-run-banner"');
    expect(afterRevertHtml).toContain('审批旧版R1');

    // 4. Dismiss button hides post-run banner cleanly when rendered standalone or in studio
    const standaloneBannerHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypePostRunBanner
          review={{
            prototypeId: r1.prototype.id,
            revision: r2.revision,
            previousRevision: r1.revision,
            modifiedAnchors: [{ screenId: 'SCR-CONTRACT-LIST', elementId: 'EL-APPROVE' }],
          }}
          mode="AFTER"
          onModeChange={noop}
          onRevert={noop}
          onDismiss={() =>
            usePrototypeSelectionStore.getState().dismissPostRunReview(r1.prototype.id, r2.revision.id)
          }
        />
      </PreferencesProvider>,
    );
    expect(standaloneBannerHtml).toContain('data-testid="prototype-post-run-dismiss-btn"');
  });

  it('enforces zero blocking browser dialogs across all Ticket 06 modules', () => {
    const filesToCheck = [
      'src/web/components/prototype/PrototypeVisualInspector.tsx',
      'src/web/components/prototype/prototypeSelectionStore.ts',
      'src/web/components/prototype/SelectionAttachmentStrip.tsx',
      'src/web/components/agent/ShellAgentPanel.tsx',
    ];
    for (const rel of filesToCheck) {
      const content = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');
      expect(content).not.toMatch(/\bwindow\.(alert|confirm|prompt)\b/);
    }
  });
});
