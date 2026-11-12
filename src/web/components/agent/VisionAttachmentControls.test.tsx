import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceStore,
  type AgentImageAttachmentRef,
} from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import type { BootstrapPayload } from '../../api.js';
import { useWorkbenchStore } from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import {
  LOCAL_IMAGE_DB_NAME,
  clearLocalImageStore,
  compressImageBlob,
  deleteLocalImage,
  extractClipboardImageFiles,
  loadLocalImage,
  resetLocalImageMemoryCacheForTests,
  resetLocalImageStoreForTests,
  resolveTurnImagesForRequest,
  storeUploadedOrPastedImage,
} from '../../lib/localImageStore.js';
import { LlmCenterView } from '../../views/DataAndInfraViews.js';
import { AgentPanel } from './AgentPanel.js';
import { ShellAgentPanel, agentPanelSurfaceFor } from './ShellAgentPanel.js';
import {
  LocalImageThumbnail,
  VisionAttachmentControls,
  VisionCapabilityBanner,
} from './VisionAttachmentControls.js';

const noop = () => {};

function useLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

/** Minimal synchronous-microtask fake IndexedDB to exercise the `onto_local_images_v1` IDB adapter in Node. */
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
                const op: Record<string, unknown> = { result: val.id, onsuccess: null, onerror: null };
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
                const op: Record<string, unknown> = { result: undefined, onsuccess: null, onerror: null };
                bucket.delete(key);
                queueMicrotask(() => {
                  (op.onsuccess as (() => void) | null)?.();
                  (tx.oncomplete as (() => void) | null)?.();
                });
                return op;
              },
              clear: () => {
                const op: Record<string, unknown> = { result: undefined, onsuccess: null, onerror: null };
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

afterEach(async () => {
  await resetLocalImageStoreForTests();
  vi.unstubAllGlobals();
  useWorkbenchStore.getInitialState().data = null;
  useWorkbenchStore.setState({ data: null });
});

describe('LlmCenterView vision badge (#30)', () => {
  it('renders Vision Input badge and editable supportsVision checkbox in zh-CN and en-US', () => {
    const mockData = {
      llmProviders: [
        {
          id: 'llm-vision-on',
          name: 'Vision Gateway',
          providerType: 'OPENAI_COMPATIBLE',
          baseUrl: 'http://127.0.0.1:3425/v1',
          apiKey: 'magpie',
          defaultModel: 'auto/glm-5.3-flash',
          availableModels: ['auto/glm-5.3-flash'],
          enabled: true,
          supportsVision: true,
        },
        {
          id: 'llm-vision-off',
          name: 'Text Gateway',
          providerType: 'OPENAI_COMPATIBLE',
          baseUrl: 'http://127.0.0.1:3425/v1',
          apiKey: 'magpie',
          defaultModel: 'auto/glm-5.2',
          availableModels: ['auto/glm-5.2'],
          enabled: true,
          supportsVision: false,
        },
      ],
    } as unknown as BootstrapPayload;
    useWorkbenchStore.getInitialState().data = mockData;
    useWorkbenchStore.setState({ data: mockData });

    useLocale('zh-CN');
    const htmlZh = renderToStaticMarkup(
      <PreferencesProvider>
        <LlmCenterView />
      </PreferencesProvider>,
    );
    expect(htmlZh).toContain('支持看图');
    expect(htmlZh).toContain('仅文本');
    expect(htmlZh).toContain('data-vision-supported="true"');
    expect(htmlZh).toContain('data-vision-supported="false"');
    expect(htmlZh).toContain('data-testid="llm-provider-supports-vision-checkbox"');

    useLocale('en-US');
    const htmlEn = renderToStaticMarkup(
      <PreferencesProvider>
        <LlmCenterView />
      </PreferencesProvider>,
    );
    expect(htmlEn).toContain('Vision Input');
    expect(htmlEn).toContain('Text Only');
    expect(htmlEn).toContain('data-testid="llm-provider-supports-vision-checkbox"');
  });
});

describe('localImageStore browser-only storage & IndexedDB adapter (#30)', () => {
  it('stores uploaded and pasted images in IndexedDB onto_local_images_v1, resolves turn payloads, and returns null when deleted', async () => {
    const fakeIdb = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', fakeIdb.indexedDB);

    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    const uploadedBlob = new Blob([pngBytes], { type: 'image/png' });

    const storedUpload = await storeUploadedOrPastedImage(uploadedBlob, {
      name: 'dashboard-sketch.png',
      role: 'user_upload',
      width: 1280,
      height: 800,
    });

    // Returned attachment ref has lightweight metadata ONLY — zero base64 bytes
    expect(storedUpload.ref).toEqual({
      id: storedUpload.record.id,
      name: 'dashboard-sketch.png',
      mimeType: 'image/png',
      source: 'local',
      width: 1280,
      height: 800,
      role: 'user_upload',
    });
    expect('dataBase64' in (storedUpload.ref as unknown as Record<string, unknown>)).toBe(false);
    expect(storedUpload.record.dataBase64).toBe(Buffer.from(pngBytes).toString('base64'));
    expect(fakeIdb.databases.has(LOCAL_IMAGE_DB_NAME)).toBe(true);

    // Simulate reloading the browser tab (clearing in-memory cache while keeping IndexedDB)
    resetLocalImageMemoryCacheForTests();
    const reloaded = await loadLocalImage(storedUpload.record.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.name).toBe('dashboard-sketch.png');
    expect(reloaded?.dataBase64).toBe(Buffer.from(pngBytes).toString('base64'));

    // Extract clipboard image files from a paste DataTransfer-like payload
    const pastedFile = new File([new Uint8Array([82, 73, 70, 70])], 'clipboard.webp', {
      type: 'image/webp',
    });
    const extracted = extractClipboardImageFiles({
      items: [
        {
          kind: 'string',
          type: 'text/plain',
          getAsFile: () => null,
        },
        {
          kind: 'file',
          type: 'image/webp',
          getAsFile: () => pastedFile,
        },
      ],
    });
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.name).toBe('clipboard.webp');

    const storedPaste = await storeUploadedOrPastedImage(extracted[0]!, {
      role: 'borrowed_ref',
    });

    // Resolve transient turn images right before sending an Agent Run
    const remoteRef: AgentImageAttachmentRef = {
      id: 'inspo-hero-1',
      name: 'Increase Hero',
      mimeType: 'image/webp',
      source: 'remote',
      remoteUrl: 'https://example.com/captures/increase/hero.webp',
      role: 'primary_ref',
    };
    const resolvedBeforeClear = await resolveTurnImagesForRequest([
      remoteRef,
      storedUpload.ref,
      storedPaste.ref,
    ]);
    expect(resolvedBeforeClear).toHaveLength(3);
    expect(resolvedBeforeClear[0]?.remoteUrl).toBe('https://example.com/captures/increase/hero.webp');
    expect(resolvedBeforeClear[0]?.dataBase64).toBeUndefined();
    expect(resolvedBeforeClear[1]?.dataBase64).toBe(Buffer.from(pngBytes).toString('base64'));
    expect(resolvedBeforeClear[2]?.dataBase64).toBe(
      Buffer.from(new Uint8Array([82, 73, 70, 70])).toString('base64'),
    );

    // Deleting / clearing local storage returns null on subsequent loads without throwing
    await deleteLocalImage(storedUpload.record.id);
    expect(await loadLocalImage(storedUpload.record.id)).toBeNull();

    await clearLocalImageStore();
    expect(await loadLocalImage(storedPaste.record.id)).toBeNull();

    const resolvedAfterClear = await resolveTurnImagesForRequest(
      [storedUpload.ref],
      { [storedUpload.ref.id]: 'User sketch: two-column contract ledger' },
    );
    expect(resolvedAfterClear).toHaveLength(1);
    expect(resolvedAfterClear[0]?.dataBase64).toBeUndefined();
    expect(resolvedAfterClear[0]?.textFallbackNote).toBe(
      'User sketch: two-column contract ledger',
    );
  });

  it('downscales oversized images via <canvas> in compressImageBlob when browser canvas APIs exist', async () => {
    const encodedWebpBytes = new Uint8Array([82, 73, 70, 70, 99, 88, 77]);
    let drawnSize: { w: number; h: number } | null = null;

    vi.stubGlobal('createImageBitmap', async () => ({
      width: 3200,
      height: 1600,
      close: noop,
    }));
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') return {};
        const canvasObj = {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: (_img: unknown, _x: number, _y: number, w: number, h: number) => {
              drawnSize = { w, h };
            },
          }),
          toBlob: (cb: (b: Blob | null) => void, mime?: string) => {
            cb(new Blob([encodedWebpBytes], { type: mime || 'image/webp' }));
          },
        };
        return canvasObj;
      },
    });

    const inputBlob = new Blob([new Uint8Array(4096)], { type: 'image/png' });
    const compressed = await compressImageBlob(inputBlob, { maxEdgePx: 1600, quality: 0.82 });

    expect(drawnSize).toEqual({ w: 1600, h: 800 });
    expect(compressed.width).toBe(1600);
    expect(compressed.height).toBe(800);
    expect(compressed.mimeType).toBe('image/webp');
    expect(compressed.dataBase64).toBe(Buffer.from(encodedWebpBytes).toString('base64'));
  });
});

describe('VisionAttachmentControls, LocalImageThumbnail & AgentPanel banner (#30)', () => {
  it('renders local image thumbnail when present and missing-on-device placeholder in zh-CN and en-US when cleared', async () => {
    const sampleBytes = new Uint8Array([1, 3, 3, 7]);
    const { ref: presentRef } = await storeUploadedOrPastedImage(
      new Blob([sampleBytes], { type: 'image/webp' }),
      { name: 'wireframe.webp', role: 'user_upload' },
    );
    const missingRef: AgentImageAttachmentRef = {
      id: 'local-img-cleared-on-other-device',
      name: 'cleared-reference.png',
      mimeType: 'image/png',
      source: 'local',
      role: 'user_upload',
    };

    useLocale('zh-CN');
    const htmlZh = renderToStaticMarkup(
      <PreferencesProvider>
        <section data-testid="design-brief-card">
          <h3>设计简报：暖纸台账风格</h3>
          <LocalImageThumbnail attachment={presentRef} />
          <LocalImageThumbnail attachment={missingRef} />
        </section>
      </PreferencesProvider>,
    );
    expect(htmlZh).toContain('设计简报：暖纸台账风格');
    expect(htmlZh).toContain(`data:image/webp;base64,${Buffer.from(sampleBytes).toString('base64')}`);
    expect(htmlZh).toContain('图片已不在本机');
    expect(htmlZh).toContain('cleared-reference.png');

    useLocale('en-US');
    const htmlEn = renderToStaticMarkup(
      <PreferencesProvider>
        <section data-testid="design-brief-card">
          <h3>Design Brief: Warm Paper Ledger</h3>
          <LocalImageThumbnail attachment={missingRef} />
        </section>
      </PreferencesProvider>,
    );
    expect(htmlEn).toContain('Design Brief: Warm Paper Ledger');
    expect(htmlEn).toContain('Image no longer on this device');
  });

  it('renders explicit non-vision fallback notice with LLM Center link when supportsVision is false', () => {
    useLocale('zh-CN');
    const panelZh = renderToStaticMarkup(
      <PreferencesProvider>
        <AgentPanel
          title={{ zh: '原型共创', en: 'Prototype Co-Design' }}
          runs={[]}
          width={380}
          visionSupported={false}
          onClose={noop}
          onResize={noop}
          onOpenLlmCenter={noop}
        />
      </PreferencesProvider>,
    );
    expect(panelZh).toContain('当前模型看不了图，将只使用文字设计说明');
    expect(panelZh).toContain('data-testid="vision-open-llm-center-btn"');

    useLocale('en-US');
    const controlsEn = renderToStaticMarkup(
      <PreferencesProvider>
        <VisionAttachmentControls
          attachments={[]}
          onAttachmentsChange={noop}
          visionSupported={false}
          onOpenLlmCenter={noop}
        />
      </PreferencesProvider>,
    );
    expect(controlsEn).toContain(
      'Current model cannot view images; only text design notes will be used',
    );
    expect(controlsEn).toContain('data-testid="vision-open-llm-center-btn"');
    expect(controlsEn).toContain('data-testid="vision-file-input"');

    // When visionSupported is true, VisionCapabilityBanner renders nothing
    const bannerSupported = renderToStaticMarkup(
      <PreferencesProvider>
        <VisionCapabilityBanner visionSupported={true} onOpenLlmCenter={noop} />
      </PreferencesProvider>,
    );
    expect(bannerSupported).toBe('');

    // ShellAgentPanel automatically reflects active provider supportsVision === false on app-prototype
    const mockData = {
      activeProject: { id: 'proj-contract' },
      llmProviders: [
        {
          id: 'llm-text-only',
          name: 'Internal Text Gateway',
          providerType: 'OPENAI_COMPATIBLE',
          baseUrl: 'http://127.0.0.1:3425/v1',
          apiKey: 'magpie',
          defaultModel: 'auto/glm-5.2',
          availableModels: ['auto/glm-5.2'],
          enabled: true,
          supportsVision: false,
        },
      ],
    } as unknown as BootstrapPayload;
    useWorkbenchStore.getInitialState().data = mockData;
    useWorkbenchStore.setState({ data: mockData });

    const protoSurface = agentPanelSurfaceFor('app-prototype')!;
    const shellPanelEn = renderToStaticMarkup(
      <PreferencesProvider>
        <ShellAgentPanel
          surface={protoSurface}
          overlay={false}
          onClose={noop}
          onNavigate={noop}
        />
      </PreferencesProvider>,
    );
    expect(shellPanelEn).toContain(
      'Current model cannot view images; only text design notes will be used',
    );
    expect(shellPanelEn).toContain('(Internal Text Gateway)');
  });

  it('streams /api/agent-sessions/:id/stream with transient images and persists zero base64 in store', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'COPILOT',
      title: 'HTTP SSE Vision Stream Test',
      providerId: 'llm-pi-local',
    });

    const transientSecretBase64 = Buffer.from(
      'http-stream-transient-local-image-bytes-9999',
    ).toString('base64');

    const res = await app.request(`/api/agent-sessions/${session.id}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '请根据参考图检查对象卡片字段排布',
        mockMode: true,
        images: [
          {
            id: 'local-http-1',
            name: 'card-layout.webp',
            mimeType: 'image/webp',
            dataBase64: transientSecretBase64,
            width: 960,
            height: 640,
            role: 'user_upload',
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const sseText = await res.text();
    expect(sseText).toContain('event: session_meta');
    expect(sseText).toContain('"visionSupported":true');
    expect(sseText).not.toContain(transientSecretBase64);

    const saved = store.getAgentSession(session.id)!;
    expect(JSON.stringify(saved)).not.toContain(transientSecretBase64);
    const userMsg = saved.messages.find((m) => m.role === 'user')!;
    expect(userMsg.images).toEqual([
      {
        id: 'local-http-1',
        name: 'card-layout.webp',
        mimeType: 'image/webp',
        source: 'local',
        width: 960,
        height: 640,
        role: 'user_upload',
      },
    ]);
  });
});
