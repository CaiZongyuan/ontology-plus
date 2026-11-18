import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { createWorkspaceStore, type AgentSessionMessage } from '../../workspace-store/index.js';
import { collectUnifiedAgentTurn, compactAgentSession } from '../index.js';

type ChatBody = { messages: { role: string; content: unknown }[] };

function sseChunk(delta: Record<string, unknown>, finish: string | null): string {
  return `data: ${JSON.stringify({
    id: 'cmpl',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

function usageChunk(prompt: number, completion: number, cached: number): string {
  return `data: ${JSON.stringify({
    id: 'cmpl',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'test-model',
    choices: [],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      prompt_tokens_details: { cached_tokens: cached },
    },
  })}\n\n`;
}

/** A gateway whose coordinator spawns two subagents, then summarises; every reply reports usage. */
async function startGateway(): Promise<{ baseUrl: string; close: () => void }> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatBody;
    const last = body.messages.at(-1);
    const lastText = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });

    const screen = /`(SCR-[A-Z0-9-]+)`/.exec(lastText)?.[1];
    if (screen) {
      res.write(
        sseChunk(
          {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `call-${screen}`,
                type: 'function',
                function: {
                  name: 'upsert_prototype_screen',
                  arguments: JSON.stringify({
                    screenId: screen,
                    screenHtml: `<div><button type="button" data-element-id="EL-${screen}-ACT" data-element-type="BUTTON" data-element-label="新增">新增</button></div>`,
                  }),
                },
              },
            ],
          },
          'tool_calls',
        ),
      );
      res.write(usageChunk(400, 50, 0));
    } else if (last?.role === 'user') {
      const code = `
        await tools.init_prototype_shell({ appTitle: "合同台账", screens: [
          { screenId: "SCR-A", screenName: "合同列表", screenType: "LIST" },
          { screenId: "SCR-B", screenName: "合同录入", screenType: "FORM" } ] });
        return await tools.spawn_subagents({ tasks: [
          { title: "合同列表", roleLabel: "列表设计师", screenId: "SCR-A", screenName: "合同列表", instruction: "列表" },
          { title: "合同录入", roleLabel: "表单设计师", screenId: "SCR-B", screenName: "合同录入", instruction: "表单" } ] });
      `;
      res.write(
        sseChunk(
          {
            role: 'assistant',
            tool_calls: [
              { index: 0, id: 'call-codemode', type: 'function', function: { name: 'codemode', arguments: JSON.stringify({ code }) } },
            ],
          },
          'tool_calls',
        ),
      );
      res.write(usageChunk(3000, 200, 2048));
    } else {
      res.write(sseChunk({ role: 'assistant', content: '两个页面都已完成。' }, 'stop'));
      res.write(usageChunk(3500, 20, 3000));
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, close: () => server.close() };
}

function liveStore(baseUrl: string) {
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  store.updateSystemSettings({ mockLlmMode: false });
  for (const p of store.listLlmProviders()) store.saveLlmProvider({ ...p, enabled: false });
  store.saveLlmProvider({
    id: 'llm-snapshot-test',
    name: 'Snapshot Test Gateway',
    providerType: 'OPENAI_COMPATIBLE',
    baseUrl,
    apiKey: 'k',
    defaultModel: 'test-model',
    availableModels: ['test-model'],
    contextWindow: 1_000_000,
    enabled: true,
  });
  return store;
}

describe('agent-runtime: every Model Call records a Context Snapshot (ADR 0017)', () => {
  it('records provider-reported usage per call and links subagent calls to the call that spawned them', async () => {
    const gateway = await startGateway();
    try {
      const store = liveStore(gateway.baseUrl);
      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'PROTOTYPE_CO_DESIGN',
        title: '合同台账 · 交互原型',
      });

      const turn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '生成合同台账首版原型',
        prototypeName: '合同台账原型',
        mockMode: false,
      });
      expect(turn.session.status).toBe('IDLE');

      const calls = store.listModelCalls('proj-contract', session.id);
      const turnCalls = calls.filter((c) => c.purpose === 'TURN');
      const subCalls = calls.filter((c) => c.purpose === 'SUBAGENT');
      expect(turnCalls).toHaveLength(2);
      expect(subCalls).toHaveLength(2);
      expect(calls.map((c) => c.seq)).toEqual([1, 2, 3, 4]);
      expect(new Set(calls.map((c) => c.runId)).size).toBe(1);
      expect(subCalls.every((c) => c.parentCallId === turnCalls[0]!.id)).toBe(true);
      expect(subCalls.map((c) => c.laneLabel?.zh).sort()).toEqual(['列表设计师', '表单设计师']);

      const first = turnCalls[0]!;
      expect(first.provider).toBe('Snapshot Test Gateway');
      expect(first.contextWindow).toBe(1_000_000);
      expect(first.status).toBe('COMPLETED');
      expect(first.usage).toMatchObject({
        source: 'PROVIDER',
        promptTokens: 3000,
        inputTokens: 952,
        cacheReadTokens: 2048,
        outputTokens: 200,
      });

      const detail = store.getModelCall('proj-contract', first.id)!;
      const kinds = new Set(detail.included.map((i) => i.kind));
      expect(kinds).toContain('INSTRUCTIONS');
      expect(kinds).toContain('BUSINESS_CONTEXT');
      expect(kinds).toContain('TOOL_GUIDE');
      expect(kinds).toContain('TOOL_DEFINITION');
      expect(detail.included.find((i) => i.kind === 'TOOL_DEFINITION' && i.label === 'codemode')?.source).toBe('CODEMODE');
      const userItem = detail.included.find((i) => i.kind === 'USER_MESSAGE');
      expect(userItem?.content).toContain('生成合同台账首版原型');
      expect(turn.session.messages.some((m) => m.id === userItem?.sessionMessageId)).toBe(true);
      expect(detail.response.map((r) => [r.kind, r.label])).toEqual([['TOOL_CALL', 'codemode']]);

      // The second coordinator call sees the first call's tool call and its result.
      const second = store.getModelCall('proj-contract', turnCalls[1]!.id)!;
      expect(second.included.some((i) => i.kind === 'TOOL_RESULT' && i.label === 'codemode')).toBe(true);

      // Session usage is the sum of the run's calls, never a fixed input/output split.
      expect(turn.session.tokenUsage).toEqual({
        inputTokens: calls.reduce((s, c) => s + c.usage.inputTokens, 0),
        outputTokens: calls.reduce((s, c) => s + c.usage.outputTokens, 0),
        cacheReadTokens: 2048 + 3000,
        cacheWriteTokens: 0,
        totalTokens: calls.reduce((s, c) => s + c.usage.totalTokens, 0),
        source: 'PROVIDER',
      });
    } finally {
      gateway.close();
    }
  });

  it('records simulated usage in Mock mode and lists the session messages a call left out', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const older: AgentSessionMessage[] = Array.from({ length: 20 }, (_, i) => ({
      id: `msg-old-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `第 ${i} 条较早的对话`,
      timestamp: new Date(Date.UTC(2026, 10, 1, 8, i)).toISOString(),
    }));
    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'REQUIREMENT',
      initialMessages: older,
    });

    const turn = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '补充合同到期提醒的需求',
      mockMode: true,
    });
    expect(turn.session.status).not.toBe('ERROR');

    const calls = store.listModelCalls('proj-contract', session.id);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.usage.source === 'SIMULATED')).toBe(true);
    expect(turn.session.tokenUsage?.source).toBe('SIMULATED');

    const detail = store.getModelCall('proj-contract', calls[0]!.id)!;
    // 21 session messages before the call, the last 18 replayed: the first 3 are left out.
    expect(detail.excluded.map((e) => e.sessionMessageId)).toEqual(['msg-old-0', 'msg-old-1', 'msg-old-2']);
    expect(detail.estimate.excludedTokens).toBeGreaterThan(0);
    expect(detail.included.some((i) => i.sessionMessageId === 'msg-old-3')).toBe(true);
  });

  it('archives compacted messages and marks the summary that replaces them in later calls', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'REQUIREMENT',
      initialMessages: Array.from({ length: 8 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `合同审批第 ${i} 轮讨论`,
        timestamp: new Date(Date.UTC(2026, 10, 1, 8, i)).toISOString(),
      })),
    });

    compactAgentSession(store, session.id, 'zh-CN');
    const events = store.listContextEvents('proj-contract', session.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'COMPACT', removedCount: 4, summarizedByModel: false, afterCallSeq: 0 });
    const archived = store.getContextEvent('proj-contract', events[0]!.id)!;
    expect(archived.removed.map((r) => r.sessionMessageId)).toEqual(['msg-0', 'msg-1', 'msg-2', 'msg-3']);
    expect(archived.summary?.content).toContain('合同审批第 0 轮讨论');

    await collectUnifiedAgentTurn(store, { sessionId: session.id, prompt: '继续', mockMode: true });
    const call = store.listModelCalls('proj-contract', session.id)[0]!;
    const detail = store.getModelCall('proj-contract', call.id)!;
    expect(detail.included.some((i) => i.kind === 'COMPACTED_SUMMARY' && i.content.includes('合同审批'))).toBe(true);
  });
});
