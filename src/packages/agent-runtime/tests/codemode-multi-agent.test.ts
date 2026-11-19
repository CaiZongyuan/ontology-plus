import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { checkBusinessViewMarkup } from '../../business-vocabulary/index.js';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import {
  collectUnifiedAgentTurn,
  extractPrototypeArtboards,
  getToolsForAgentKind,
  initPrototypeShell,
  upsertPrototypeScreen,
} from '../index.js';

describe('3-Way Parallel Multi-Agent Prototype Co-Design', () => {
  it('enables multiAgentConcurrency=3 by default on new AgentSessions and exposes spawn_subagents without codemode', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      title: '咖啡店管理系统 · 交互原型',
    });

    expect(session.multiAgentConcurrency).toBe(3);

    const offered = getToolsForAgentKind('PROTOTYPE_CO_DESIGN', {
      multiAgentConcurrency: session.multiAgentConcurrency,
    });
    const names = offered.map((t) => t.name);
    expect(names).toContain('init_prototype_shell');
    expect(names).toContain('upsert_prototype_screen');
    expect(names).toContain('spawn_subagents');
    expect(names).not.toContain('codemode');
  });

  it('assembles multi-artboard prototype via initPrototypeShell + upsertPrototypeScreen and extracts isolated artboards cleanly', () => {
    const shell = initPrototypeShell({
      appTitle: '咖啡店管理系统',
      subtitle: '单店运营工作台',
      themeTokens: {
        mode: 'light',
        canvasBg: '#f6f4f0',
        cardBg: '#fffdf9',
        accentColor: '#f94c05',
      },
      screens: [
        { screenId: 'SCR-MEMBER', screenName: '会员储值台账', screenType: 'LIST' },
        { screenId: 'SCR-DRAWER', screenName: '储值录入抽屉', screenType: 'FORM' },
        { screenId: 'SCR-POS', screenName: '现磨点单收银台', screenType: 'MASTER_DETAIL_FORM' },
      ],
    });
    expect(shell.isError).toBe(false);

    const initialBoards = extractPrototypeArtboards(shell.nextHtml);
    expect(initialBoards).toHaveLength(3);
    expect(initialBoards.every((b) => b.status === 'queued')).toBe(true);

    // Rejects unanchored interactive <button> inside a screen without corrupting shell
    const badScreen = upsertPrototypeScreen(shell.nextHtml, {
      screenId: 'SCR-MEMBER',
      screenName: '会员储值台账',
      screenHtml: `<div class="card"><button type="button">未锚定按钮</button></div>`,
    });
    expect(badScreen.isError).toBe(true);

    // Valid screen update marks ONLY SCR-MEMBER ready while SCR-DRAWER & SCR-POS stay queued
    const goodScreen = upsertPrototypeScreen(shell.nextHtml, {
      screenId: 'SCR-MEMBER',
      screenName: '会员储值台账',
      screenHtml: `<div class="proto-card"><button type="button" data-element-id="EL-MEMBER-TOPUP" data-element-type="BUTTON" data-element-label="办理储值">办理储值</button></div>`,
    });
    expect(goodScreen.isError).toBe(false);

    const updatedBoards = extractPrototypeArtboards(goodScreen.nextHtml);
    expect(updatedBoards.find((b) => b.screenId === 'SCR-MEMBER')?.status).toBe('ready');
    expect(updatedBoards.find((b) => b.screenId === 'SCR-MEMBER')?.elementCount).toBe(1);
    expect(updatedBoards.find((b) => b.screenId === 'SCR-DRAWER')?.status).toBe('queued');
    expect(updatedBoards.find((b) => b.screenId === 'SCR-POS')?.status).toBe('queued');
  });

  it('executes QuickJS codemode script with Promise.all and enforces concurrency=3 across 4 parallel subagents in live streaming turn', async () => {
    let activeSubagentRequests = 0;
    let peakSubagentConcurrency = 0;
    let totalChatCalls = 0;

    const server = http.createServer(async (req, res) => {
      if (!req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const ch of req) chunks.push(ch as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        messages: { role: string; content: unknown }[];
      };

      totalChatCalls += 1;
      const lastMsg = body.messages[body.messages.length - 1];
      const lastText =
        typeof lastMsg?.content === 'string'
          ? lastMsg.content
          : JSON.stringify(lastMsg?.content ?? '');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });

      // Subagent turn: contains target screenId
      const screenMatch = /`(SCR-[A-Z0-9-]+)`/.exec(lastText);
      if (screenMatch) {
        const sid = screenMatch[1]!;
        activeSubagentRequests += 1;
        peakSubagentConcurrency = Math.max(peakSubagentConcurrency, activeSubagentRequests);
        await new Promise((r) => setTimeout(r, 60));
        activeSubagentRequests -= 1;

        const tcChunk = {
          id: `cmpl-${sid}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'test-pi-model',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${sid}`,
                    type: 'function',
                    function: {
                      name: 'upsert_prototype_screen',
                      arguments: JSON.stringify({
                        screenId: sid,
                        screenHtml: `<div class="proto-card"><button type="button" data-element-id="EL-${sid}-ACT" data-element-type="BUTTON" data-element-label="操作">+ 新增</button></div>`,
                      }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        };
        res.write(`data: ${JSON.stringify(tcChunk)}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }

      // Coordinator round 1: calls `init_prototype_shell` + `spawn_subagents` to init 4 artboards and spawn 4 parallel subagents!
      if (lastMsg?.role === 'user') {
        const coordChunk = {
          id: 'cmpl-coord-1',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'test-pi-model',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-shell-1',
                    type: 'function',
                    function: {
                      name: 'init_prototype_shell',
                      arguments: JSON.stringify({
                        appTitle: '咖啡店管理系统',
                        screens: [
                          { screenId: 'SCR-S1', screenName: '会员储值台账', screenType: 'LIST' },
                          { screenId: 'SCR-S2', screenName: '储值录入抽屉', screenType: 'FORM' },
                          { screenId: 'SCR-S3', screenName: '现磨点单收银', screenType: 'LIST' },
                          { screenId: 'SCR-S4', screenName: '门市日结对账', screenType: 'REPORT' },
                        ],
                      }),
                    },
                  },
                  {
                    index: 1,
                    id: 'call-spawn-1',
                    type: 'function',
                    function: {
                      name: 'spawn_subagents',
                      arguments: JSON.stringify({
                        tasks: [
                          { title: '绘制会员储值台账', roleLabel: '会员设计师', screenId: 'SCR-S1', screenName: '会员储值台账', instruction: '构建储值列表' },
                          { title: '绘制储值录入抽屉', roleLabel: '交互架构师', screenId: 'SCR-S2', screenName: '储值录入抽屉', instruction: '构建充值档位' },
                          { title: '绘制现磨点单收银', roleLabel: '收银设计师', screenId: 'SCR-S3', screenName: '现磨点单收银', instruction: '构建饮品网格' },
                          { title: '绘制门市日结对账', roleLabel: '财务设计师', screenId: 'SCR-S4', screenName: '门市日结对账', instruction: '构建日结核对表' },
                        ],
                      }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        };
        res.write(`data: ${JSON.stringify(coordChunk)}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }

      // Coordinator round 2: concise summary after codemode completes
      const summaryChunk = {
        id: 'cmpl-coord-2',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'test-pi-model',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: '已通过并行协作完成咖啡店管理系统的四个核心业务页面。',
            },
            finish_reason: 'stop',
          },
        ],
      };
      res.write(`data: ${JSON.stringify(summaryChunk)}\n\n`);
      res.end('data: [DONE]\n\n');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
      store.updateSystemSettings({ mockLlmMode: false });
      for (const p of store.listLlmProviders()) store.saveLlmProvider({ ...p, enabled: false });
      store.saveLlmProvider({
        id: 'llm-parallel-test',
        name: 'Parallel Test Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: 'k',
        defaultModel: 'test-pi-model',
        availableModels: ['test-pi-model'],
        enabled: true,
      });

      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'PROTOTYPE_CO_DESIGN',
        title: '咖啡店管理系统 · 交互原型',
      });

      const turn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '按已确认设计简报生成咖啡店管理系统首版原型',
        prototypeName: '咖啡店管理系统原型 V1',
        mockMode: false,
      });

      expect(turn.session.status).toBe('IDLE');
      expect(totalChatCalls).toBe(6); // 1 coord + 4 subagents + 1 coord summary
      // Default concurrency = 3: 4 subagent tasks ran in parallel capped at 3 simultaneous!
      expect(peakSubagentConcurrency).toBeGreaterThanOrEqual(2);
      expect(peakSubagentConcurrency).toBeLessThanOrEqual(3);

      // Live building streams per-screen deltas (#89): each event carries exactly one screen,
      // never the whole document, and every screen gets its own deltas.
      expect(turn.events.some((e) => (e.event as string) === 'prototype_preview')).toBe(false);
      const screenEvents = turn.events.filter((e) => e.event === 'prototype_screen');
      expect(new Set(screenEvents.map((e) => e.data.screenId))).toEqual(
        new Set(['SCR-S1', 'SCR-S2', 'SCR-S3', 'SCR-S4']),
      );
      for (const ev of screenEvents) {
        const html = String(ev.data.html);
        expect(html).not.toMatch(/<!DOCTYPE|<html|<head/i);
        expect(html.match(/data-screen-id=/g)).toHaveLength(1);
        expect(html).toContain(`data-screen-id="${String(ev.data.screenId)}"`);
      }
      const seqs = turn.events
        .filter((e) => e.event === 'prototype_screen' || e.event === 'prototype_frame')
        .map((e) => Number(e.data.seq));
      expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
      expect(turn.events.some((e) => e.event === 'prototype_frame')).toBe(true);
      const subagentEvents = turn.events.filter((e) => e.event === 'subagent_update');
      expect(subagentEvents.length).toBeGreaterThanOrEqual(4);

      const lastAssistant = turn.session.messages.filter((m) => m.role === 'assistant').at(-1)!;
      expect(lastAssistant.subagentLanes).toHaveLength(4);
      expect(lastAssistant.subagentLanes!.every((l) => l.status === 'DONE')).toBe(true);

      // Persisted single clean Revision #1 with all 4 screens ready!
      const protos = store.listPrototypes('proj-contract');
      const created = protos.find((p) => p.name === '咖啡店管理系统原型 V1')!;
      expect(created).toBeDefined();
      expect(created.revisions).toHaveLength(1);
      const boards = extractPrototypeArtboards(created.htmlContent);
      expect(boards).toHaveLength(4);
      expect(boards.every((b) => b.status === 'ready')).toBe(true);

      // Business View check on assistant summary
      expect(checkBusinessViewMarkup(lastAssistant.content, { plainText: true })).toHaveLength(0);
    } finally {
      server.close();
    }
  });
});
