import { describe, expect, it } from 'vitest';
import {
  createWorkspaceStore,
  type ModelCallRecordInput,
  type WorkspaceStoreOptions,
} from '../index.js';

function withStore(
  options: Partial<WorkspaceStoreOptions>,
  run: (store: ReturnType<typeof createWorkspaceStore>, projectId: string, sessionId: string) => void,
): void {
  const store = createWorkspaceStore({
    dbPath: ':memory:',
    enableFileMirror: false,
    seedProjects: false,
    ...options,
  });
  try {
    const project = store.createProject({
      name: '上下文快照',
      code: 'CTX-SNAP',
      domain: '合同管理',
      template: 'EMPTY',
    });
    const session = store.createAgentSession({ projectId: project.id, agentKind: 'REQUIREMENT' });
    run(store, project.id, session.id);
  } finally {
    store.close();
  }
}

const SYSTEM_RULES = '你是需求助手。始终用用户的语言回答。'.repeat(20);
const TOOL_SCHEMA = JSON.stringify({ name: 'save_requirement_doc', parameters: { type: 'object' } });

function callInput(
  projectId: string,
  sessionId: string,
  overrides: Partial<ModelCallRecordInput> = {},
): ModelCallRecordInput {
  return {
    projectId,
    sessionId,
    runId: 'run-1',
    purpose: 'TURN',
    provider: 'zai-coding-cn',
    model: 'glm-5.3-flash',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    startedAt: '2026-11-18T08:00:00.000Z',
    endedAt: '2026-11-18T08:00:02.500Z',
    status: 'COMPLETED',
    simulated: false,
    included: [
      { kind: 'INSTRUCTIONS', content: SYSTEM_RULES },
      { kind: 'BUSINESS_CONTEXT', content: '当前项目：合同管理' },
      { kind: 'TOOL_DEFINITION', label: 'save_requirement_doc', source: 'BUILTIN', content: TOOL_SCHEMA },
      { kind: 'USER_MESSAGE', content: '我要管理采购合同', sessionMessageId: 'msg-u1' },
    ],
    excluded: [{ kind: 'USER_MESSAGE', content: '很早以前的一句话', sessionMessageId: 'msg-old' }],
    response: [{ kind: 'ASSISTANT_MESSAGE', content: '好的，先确认合同的审批流程。' }],
    ...overrides,
  };
}

describe('workspace-store: Context Snapshots (ADR 0017)', () => {
  it('records what a Model Call sent, with provider-reported usage including cache reads', () => {
    withStore({}, (store, projectId, sessionId) => {
      const summary = store.recordModelCall(
        callInput(projectId, sessionId, {
          providerUsage: { input: 120, output: 30, cacheRead: 900, cacheWrite: 0 },
        }),
      );

      expect(summary.seq).toBe(1);
      expect(summary.durationMs).toBe(2500);
      expect(summary.hasDetail).toBe(true);
      expect(summary.usage).toEqual({
        promptTokens: 1020,
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: 900,
        cacheWriteTokens: 0,
        totalTokens: 1050,
        source: 'PROVIDER',
      });
      expect(summary.estimate.byKind.INSTRUCTIONS).toBeGreaterThan(0);
      expect(summary.estimate.byKind.TOOL_DEFINITION).toBeGreaterThan(0);
      expect(summary.estimate.excludedTokens).toBeGreaterThan(0);

      const detail = store.getModelCall(projectId, summary.id);
      expect(detail?.included.map((i) => i.content)).toEqual([
        SYSTEM_RULES,
        '当前项目：合同管理',
        TOOL_SCHEMA,
        '我要管理采购合同',
      ]);
      expect(detail?.included[2]).toMatchObject({ label: 'save_requirement_doc', source: 'BUILTIN' });
      expect(detail?.included[3]?.sessionMessageId).toBe('msg-u1');
      expect(detail?.excluded[0]?.content).toBe('很早以前的一句话');
      expect(detail?.response[0]?.content).toBe('好的，先确认合同的审批流程。');
    });
  });

  it('labels usage as estimated when the provider reports none, and as simulated in Mock mode', () => {
    withStore({}, (store, projectId, sessionId) => {
      const estimated = store.recordModelCall(callInput(projectId, sessionId));
      expect(estimated.usage.source).toBe('ESTIMATED');
      expect(estimated.usage.inputTokens).toBe(estimated.estimate.inputTokens);
      expect(estimated.usage.outputTokens).toBe(estimated.estimate.outputTokens);

      const simulated = store.recordModelCall(
        callInput(projectId, sessionId, {
          simulated: true,
          providerUsage: { input: 999, output: 999, cacheRead: 0, cacheWrite: 0 },
        }),
      );
      expect(simulated.usage.source).toBe('SIMULATED');
      expect(simulated.usage.inputTokens).toBe(simulated.estimate.inputTokens);
      expect(simulated.seq).toBe(2);
    });
  });

  it('lists calls of one session in order and links subagent calls to their parent', () => {
    withStore({}, (store, projectId, sessionId) => {
      const other = store.createAgentSession({ projectId, agentKind: 'COPILOT' });
      const parent = store.recordModelCall(callInput(projectId, sessionId));
      store.recordModelCall(callInput(projectId, other.id));
      const child = store.recordModelCall(
        callInput(projectId, sessionId, {
          purpose: 'SUBAGENT',
          parentCallId: parent.id,
          laneLabel: { zh: '子智能体 A', en: 'Subagent A' },
        }),
      );

      const listed = store.listModelCalls(projectId, sessionId);
      expect(listed.map((c) => c.id)).toEqual([parent.id, child.id]);
      expect(listed[1]).toMatchObject({ purpose: 'SUBAGENT', parentCallId: parent.id, seq: 2 });
      expect(store.listModelCalls(projectId, other.id)).toHaveLength(1);
    });
  });

  it('keeps full snapshots for the most recent calls only and drops content nothing references', () => {
    withStore({ maxFullModelCallsPerSession: 2 }, (store, projectId, sessionId) => {
      const first = store.recordModelCall(
        callInput(projectId, sessionId, {
          included: [{ kind: 'USER_MESSAGE', content: '只在第一次出现的内容' }],
          excluded: [],
          response: [],
          providerUsage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
        }),
      );
      store.recordModelCall(callInput(projectId, sessionId));
      store.recordModelCall(callInput(projectId, sessionId));

      const listed = store.listModelCalls(projectId, sessionId);
      expect(listed.map((c) => c.hasDetail)).toEqual([false, true, true]);
      expect(listed[0]?.usage.totalTokens).toBe(15);

      const dropped = store.getModelCall(projectId, first.id);
      expect(dropped?.hasDetail).toBe(false);
      expect(dropped?.included).toEqual([]);
    });
  });

  it('archives messages removed by compaction so they stay inspectable', () => {
    withStore({}, (store, projectId, sessionId) => {
      store.recordModelCall(callInput(projectId, sessionId));
      const event = store.recordContextEvent({
        projectId,
        sessionId,
        kind: 'COMPACT',
        removed: [
          { kind: 'USER_MESSAGE', content: '第一轮：我要管理采购合同的全部审批节点和付款节点', sessionMessageId: 'm1' },
          { kind: 'ASSISTANT_MESSAGE', content: '好的，我们先从审批节点开始梳理，再看付款节点。', sessionMessageId: 'm2' },
        ],
        summary: '用户要管理采购合同。',
      });

      expect(event).toMatchObject({ kind: 'COMPACT', removedCount: 2, afterCallSeq: 1, summarizedByModel: false });
      expect(event.reclaimedTokens).toBeGreaterThan(0);
      expect(store.listContextEvents(projectId, sessionId).map((e) => e.id)).toEqual([event.id]);

      const detail = store.getContextEvent(projectId, event.id);
      expect(detail?.removed.map((r) => r.sessionMessageId)).toEqual(['m1', 'm2']);
      expect(detail?.summary?.content).toBe('用户要管理采购合同。');
    });
  });

  it('refuses reads across projects', () => {
    withStore({}, (store, projectId, sessionId) => {
      const call = store.recordModelCall(callInput(projectId, sessionId));
      const otherProject = store.createProject({
        name: '别的项目',
        code: 'CTX-OTHER',
        domain: '仓储',
        template: 'EMPTY',
      });
      expect(store.getModelCall(otherProject.id, call.id)).toBeUndefined();
      expect(store.listModelCalls(otherProject.id, sessionId)).toEqual([]);
    });
  });

  it('deletes a session’s snapshots and events with the session but keeps content other sessions use', () => {
    withStore({}, (store, projectId, sessionId) => {
      const keeper = store.createAgentSession({ projectId, agentKind: 'COPILOT' });
      store.recordModelCall(callInput(projectId, sessionId));
      store.recordContextEvent({
        projectId,
        sessionId,
        kind: 'COMPACT',
        removed: [{ kind: 'USER_MESSAGE', content: '要被删除的旧消息' }],
      });
      const kept = store.recordModelCall(callInput(projectId, keeper.id));

      store.deleteAgentSession(sessionId);

      expect(store.listModelCalls(projectId, sessionId)).toEqual([]);
      expect(store.listContextEvents(projectId, sessionId)).toEqual([]);
      const keptDetail = store.getModelCall(projectId, kept.id);
      expect(keptDetail?.included[0]?.content).toBe(SYSTEM_RULES);
    });
  });

  it('exposes responseToolNames on ModelCallSummary from TOOL_CALL response items and preserves them after detail pruning', () => {
    withStore({ maxFullModelCallsPerSession: 1 }, (store, projectId, sessionId) => {
      const first = store.recordModelCall(
        callInput(projectId, sessionId, {
          response: [
            { kind: 'REASONING', content: '先初始化原型骨架再并行派生子智能体。' },
            { kind: 'TOOL_CALL', label: 'init_prototype_shell', content: '{"appTitle":"合同台账"}' },
            { kind: 'TOOL_CALL', label: 'spawn_subagents', content: '{"tasks":[]}' },
            { kind: 'TOOL_CALL', label: '   ', content: '{}' },
            { kind: 'ASSISTANT_MESSAGE', label: 'ignored_non_tool', content: '正在执行…' },
          ],
        }),
      );
      expect(first.responseToolNames).toEqual(['init_prototype_shell', 'spawn_subagents']);

      const second = store.recordModelCall(
        callInput(projectId, sessionId, {
          response: [
            {
              kind: 'TOOL_CALL',
              label: 'propose_step_handoff',
              content: '{"targetStep":"PROTOTYPE","request":"加一列"}',
            },
          ],
        }),
      );
      expect(second.responseToolNames).toEqual(['propose_step_handoff']);

      const third = store.recordModelCall(
        callInput(projectId, sessionId, {
          response: [{ kind: 'ASSISTANT_MESSAGE', content: '已完成全部总结。' }],
        }),
      );
      expect(third.responseToolNames).toEqual([]);

      const listed = store.listModelCalls(projectId, sessionId);
      expect(listed.map((c) => c.hasDetail)).toEqual([false, false, true]);
      expect(listed.map((c) => c.responseToolNames)).toEqual([
        ['init_prototype_shell', 'spawn_subagents'],
        ['propose_step_handoff'],
        [],
      ]);
    });
  });
});
