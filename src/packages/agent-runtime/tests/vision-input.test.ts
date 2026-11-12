import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createWorkspaceStore,
  doesProviderSupportVision,
  type AgentImageAttachmentRef,
} from '../../workspace-store/index.js';
import {
  buildPiModelsForStore,
  collectUnifiedAgentTurn,
} from '../index.js';

const LOCAL_UPLOAD_BASE64 = Buffer.from('fake-webp-local-upload-binary-payload-0001').toString(
  'base64',
);
const SELECTION_CROP_BASE64 = Buffer.from('fake-webp-selection-crop-binary-payload-0002').toString(
  'base64',
);
const REMOTE_HERO_BYTES = Buffer.from('fake-webp-remote-inspo-hero-binary-payload-0003');
const REMOTE_HERO_BASE64 = REMOTE_HERO_BYTES.toString('base64');
const ACCIDENTAL_SMUGGLED_BASE64 = Buffer.from(
  'accidental-inline-base64-that-must-never-hit-sqlite-0004',
).toString('base64');

describe('vision input & provider capability (#30)', () => {
  it('defaults supportsVision accurately across providers/models and honors explicit user boolean', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const seeded = store.listLlmProviders()[0]!;

    expect(seeded.id).toBe('llm-pi-local');
    expect(seeded.defaultModel).toBe('auto/glm-5.3-flash');
    expect(seeded.supportsVision).toBe(true);
    expect(doesProviderSupportVision(seeded)).toBe(true);

    // Anthropic, Gemini, and OpenAI multimodal models default to vision-capable
    expect(
      doesProviderSupportVision({
        providerType: 'ANTHROPIC',
        defaultModel: 'claude-sonnet-4-20250514',
      }),
    ).toBe(true);
    expect(
      doesProviderSupportVision({
        providerType: 'GOOGLE_GEMINI',
        defaultModel: 'gemini-2.5-flash',
      }),
    ).toBe(true);
    expect(
      doesProviderSupportVision({
        providerType: 'OPENAI_COMPATIBLE',
        defaultModel: 'gpt-4o-mini',
      }),
    ).toBe(true);

    // Text-only models without explicit override default to false
    expect(
      doesProviderSupportVision({
        providerType: 'OPENAI_COMPATIBLE',
        defaultModel: 'auto/glm-5.2',
      }),
    ).toBe(false);

    // Explicit boolean saved by user overrides any model heuristic
    store.saveLlmProvider({
      ...seeded,
      supportsVision: false,
    });
    const updated = store.listLlmProviders()[0]!;
    expect(updated.supportsVision).toBe(false);
    expect(doesProviderSupportVision(updated)).toBe(false);

    store.saveLlmProvider({
      ...updated,
      defaultModel: 'custom-internal-model',
      supportsVision: true,
    });
    const reEnabled = store.listLlmProviders()[0]!;
    expect(reEnabled.supportsVision).toBe(true);
    expect(doesProviderSupportVision(reEnabled)).toBe(true);
  });

  it('passes ImageContent blocks to vision-capable models and persists ZERO image bytes/base64 in SQLite', async () => {
    const capturedBodies: Record<string, unknown>[] = [];

    const imgServer = http.createServer((req, res) => {
      if (req.url === '/captures/increase-com/hero.1440.webp') {
        res.writeHead(200, { 'Content-Type': 'image/webp' });
        res.end(REMOTE_HERO_BYTES);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const llmServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += String(chunk);
      });
      req.on('end', () => {
        try {
          capturedBodies.push(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          // Ignore malformed JSON
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(
          `data: ${JSON.stringify({
            id: 'cmpl-vision-1',
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: { content: '已读取主参考截图、上传参考图与框选区域，完成样式对齐。' },
                finish_reason: 'stop',
              },
            ],
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });

    await Promise.all([
      new Promise<void>((resolve) => imgServer.listen(0, '127.0.0.1', resolve)),
      new Promise<void>((resolve) => llmServer.listen(0, '127.0.0.1', resolve)),
    ]);

    const imgPort = (imgServer.address() as { port: number }).port;
    const llmPort = (llmServer.address() as { port: number }).port;
    const remoteHeroUrl = `http://127.0.0.1:${imgPort}/captures/increase-com/hero.1440.webp`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-vision-sqlite-'));
    const dbPath = path.join(tmpDir, 'vision-test.db');

    try {
      const store = createWorkspaceStore({ dbPath, enableFileMirror: false });
      store.saveLlmProvider({
        id: 'llm-pi-local',
        name: 'Vision Test Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${llmPort}/v1`,
        apiKey: 'test-key',
        defaultModel: 'auto/glm-5.3-flash',
        availableModels: ['auto/glm-5.3-flash'],
        enabled: true,
        supportsVision: true,
      });

      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'COPILOT',
        title: '视觉参考看图测试会话',
        providerId: 'llm-pi-local',
      });

      const built = buildPiModelsForStore(store, session, { mockMode: false });
      expect(built.selectedModel.input).toContain('image');

      const turn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '请按照主参考与框选区域优化表格密度和按钮层级',
        mockMode: false,
        images: [
          {
            id: 'ref-primary-1',
            name: 'Increase Hero',
            mimeType: 'image/webp',
            remoteUrl: remoteHeroUrl,
            width: 1440,
            height: 900,
            role: 'primary_ref',
            textFallbackNote: 'Primary Reference: Increase clean ledger palette',
          },
          {
            id: 'local-upload-1',
            name: 'custom-sketch.webp',
            mimeType: 'image/webp',
            dataBase64: `data:image/webp;base64,${LOCAL_UPLOAD_BASE64}`,
            width: 1200,
            height: 800,
            role: 'user_upload',
          },
          {
            id: 'crop-1',
            name: 'table-header-crop.webp',
            mimeType: 'image/webp',
            dataBase64: SELECTION_CROP_BASE64,
            width: 640,
            height: 220,
            role: 'selection_crop',
          },
        ],
      });

      const metaEvt = turn.events.find((e) => e.event === 'session_meta');
      expect(metaEvt?.data.visionSupported).toBe(true);
      expect(metaEvt?.data.visionFallbackNotice).toBeUndefined();

      // Model wire request received all 3 images serialized as multimodal image_url blocks
      expect(capturedBodies.length).toBeGreaterThanOrEqual(1);
      const wirePayloadJson = JSON.stringify(capturedBodies[0]);
      expect(wirePayloadJson).toContain(REMOTE_HERO_BASE64);
      expect(wirePayloadJson).toContain(LOCAL_UPLOAD_BASE64);
      expect(wirePayloadJson).toContain(SELECTION_CROP_BASE64);

      // Even if a caller accidentally passes inline base64 or data: URI to saveAgentSession, store strips it
      const persisted = store.getAgentSession(session.id)!;
      const userMsg = persisted.messages.find((m) => m.role === 'user')!;
      expect(userMsg.images).toHaveLength(3);
      expect(userMsg.images?.[0]).toEqual({
        id: 'ref-primary-1',
        name: 'Increase Hero',
        mimeType: 'image/webp',
        source: 'remote',
        remoteUrl: remoteHeroUrl,
        width: 1440,
        height: 900,
        role: 'primary_ref',
      });
      expect(userMsg.images?.[1]).toEqual({
        id: 'local-upload-1',
        name: 'custom-sketch.webp',
        mimeType: 'image/webp',
        source: 'local',
        width: 1200,
        height: 800,
        role: 'user_upload',
      });

      const dirtyAttachment = {
        id: 'dirty-1',
        name: 'accidental-inline.png',
        mimeType: 'image/png',
        source: 'local' as const,
        remoteUrl: `data:image/png;base64,${ACCIDENTAL_SMUGGLED_BASE64}`,
        dataBase64: ACCIDENTAL_SMUGGLED_BASE64,
        data: ACCIDENTAL_SMUGGLED_BASE64,
      } as unknown as AgentImageAttachmentRef;

      store.saveAgentSession({
        ...persisted,
        messages: [
          ...persisted.messages,
          {
            id: 'amsg-dirty-check',
            role: 'user',
            content: '测试意外夹带 base64 拦截',
            images: [dirtyAttachment],
            timestamp: new Date().toISOString(),
          },
        ],
      });

      const afterDirtySave = store.getAgentSession(session.id)!;
      const sanitizedMsg = afterDirtySave.messages.find((m) => m.id === 'amsg-dirty-check')!;
      expect(sanitizedMsg.images?.[0]).toEqual({
        id: 'dirty-1',
        name: 'accidental-inline.png',
        mimeType: 'image/png',
        source: 'local',
      });

      // Inspect raw SQLite rows directly to guarantee ZERO base64 payloads anywhere on disk
      const req = createRequire(import.meta.url);
      const { DatabaseSync } = req('node:sqlite') as {
        DatabaseSync: new (p: string) => {
          prepare: (sql: string) => { all: () => Record<string, unknown>[] };
          close: () => void;
        };
      };
      const rawDb = new DatabaseSync(dbPath);
      try {
        const entityRows = rawDb
          .prepare(`SELECT collection, item_id, payload_json FROM workspace_entities`)
          .all();
        const checkpointRows = rawDb
          .prepare(`SELECT session_id, state_json FROM agent_checkpoints`)
          .all();
        const dump = JSON.stringify({ entityRows, checkpointRows });

        expect(dump).not.toContain(LOCAL_UPLOAD_BASE64);
        expect(dump).not.toContain(SELECTION_CROP_BASE64);
        expect(dump).not.toContain(REMOTE_HERO_BASE64);
        expect(dump).not.toContain(ACCIDENTAL_SMUGGLED_BASE64);
        expect(dump).not.toContain('data:image/');
      } finally {
        rawDb.close();
      }
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => imgServer.close(() => resolve())),
        new Promise<void>((resolve) => llmServer.close(() => resolve())),
      ]);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('emits explicit visionFallbackNotice and continues with text design notes when supportsVision is false', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const llmServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += String(chunk);
      });
      req.on('end', () => {
        try {
          capturedBodies.push(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          // Ignore
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(
          `data: ${JSON.stringify({
            id: 'cmpl-text-fallback',
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: { content: '已根据文字设计说明生成界面布局。' },
                finish_reason: 'stop',
              },
            ],
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });

    await new Promise<void>((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
    const llmPort = (llmServer.address() as { port: number }).port;

    try {
      const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
      store.saveLlmProvider({
        id: 'llm-pi-local',
        name: 'Text-Only Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${llmPort}/v1`,
        apiKey: 'test-key',
        defaultModel: 'auto/glm-5.2',
        availableModels: ['auto/glm-5.2'],
        enabled: true,
        supportsVision: false,
      });

      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'COPILOT',
        title: '无看图能力降级测试',
        providerId: 'llm-pi-local',
      });

      // Verify both Live and Mock model builders respect supportsVision: false
      const liveBuilt = buildPiModelsForStore(store, session, { mockMode: false });
      expect(liveBuilt.selectedModel.input).toEqual(['text']);
      const mockBuilt = buildPiModelsForStore(store, session, { mockMode: true });
      expect(mockBuilt.selectedModel.input).toEqual(['text']);

      const turn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '按设计简报调整主工作台',
        locale: 'zh-CN',
        mockMode: false,
        images: [
          {
            id: 'local-upload-2',
            name: 'reference-board.webp',
            mimeType: 'image/webp',
            dataBase64: LOCAL_UPLOAD_BASE64,
            role: 'primary_ref',
            textFallbackNote: '主参考色板：暖纸白 #f3f2ee，主强调色 #4c50c4，紧凑双栏台账布局',
          },
        ],
      });

      const metaEvt = turn.events.find((e) => e.event === 'session_meta');
      expect(metaEvt?.data.visionSupported).toBe(false);
      expect(String(metaEvt?.data.visionFallbackNotice ?? '')).toContain(
        '当前模型看不了图，将只使用文字设计说明',
      );

      // Wire payload must NOT include base64 image blocks, and MUST carry textFallbackNote
      expect(capturedBodies).toHaveLength(1);
      const wireStr = JSON.stringify(capturedBodies[0]);
      expect(wireStr).not.toContain(LOCAL_UPLOAD_BASE64);
      expect(wireStr).not.toContain('image_url');
      expect(wireStr).toContain('暖纸白 #f3f2ee');

      const saved = store.getAgentSession(session.id)!;
      const assistantMsg = saved.messages.find((m) => m.role === 'assistant')!;
      expect(assistantMsg.visionFallbackUsed).toBe(true);
    } finally {
      await new Promise<void>((resolve) => llmServer.close(() => resolve()));
    }
  });

  it('gracefully falls back to textFallbackNote when a remote reference screenshot returns 404', async () => {
    const capturedBodies: Record<string, unknown>[] = [];
    const imgServer = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end('Not found');
    });
    const llmServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += String(chunk);
      });
      req.on('end', () => {
        try {
          capturedBodies.push(JSON.parse(raw) as Record<string, unknown>);
        } catch {
          // Ignore
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(
          `data: ${JSON.stringify({
            id: 'cmpl-remote-404',
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: { content: 'Handled missing remote image cleanly via fallback note.' },
                finish_reason: 'stop',
              },
            ],
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });

    await Promise.all([
      new Promise<void>((resolve) => imgServer.listen(0, '127.0.0.1', resolve)),
      new Promise<void>((resolve) => llmServer.listen(0, '127.0.0.1', resolve)),
    ]);

    const imgPort = (imgServer.address() as { port: number }).port;
    const llmPort = (llmServer.address() as { port: number }).port;

    try {
      const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
      store.saveLlmProvider({
        id: 'llm-pi-local',
        name: 'Vision Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${llmPort}/v1`,
        apiKey: 'test-key',
        defaultModel: 'auto/glm-5.3-flash',
        availableModels: ['auto/glm-5.3-flash'],
        enabled: true,
        supportsVision: true,
      });

      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'COPILOT',
        title: 'Remote 404 fallback test',
        providerId: 'llm-pi-local',
      });

      const turn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: 'Apply borrowed reference rhythm',
        locale: 'en-US',
        mockMode: false,
        images: [
          {
            id: 'ref-borrowed-missing',
            name: 'Missing Borrowed Screenshot',
            mimeType: 'image/webp',
            remoteUrl: `http://127.0.0.1:${imgPort}/missing-screenshot.webp`,
            role: 'borrowed_ref',
            textFallbackNote: 'Borrowed Reference: Linear 24px compact row rhythm',
          },
        ],
      });

      expect(turn.session.status).toBe('IDLE');
      expect(capturedBodies).toHaveLength(1);
      expect(JSON.stringify(capturedBodies[0])).toContain(
        'Borrowed Reference: Linear 24px compact row rhythm',
      );
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => imgServer.close(() => resolve())),
        new Promise<void>((resolve) => llmServer.close(() => resolve())),
      ]);
    }
  });
});
