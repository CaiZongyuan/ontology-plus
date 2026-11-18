import { describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

describe('PATCH /api/agent-sessions/:id latest-turn replacement guard (#81, ADR 0009)', () => {
  it('drops ONLY the latest turn on IDLE sessions, rejects earlier-turn truncation and RUNNING sessions, and leaves ArtifactHistory untouched', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      // Trigger a mutating manual save so ArtifactHistory has real entries on proj-contract
      const saveDocRes = await app.request('/api/requirements/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'rdoc-edit-test-1',
          projectId: 'proj-contract',
          title: '采购合同需求规格书',
          version: 'v1.1',
          content: '# 1. 业务目标\n\n支持采购合同全生命周期审批与履约核验。\n',
        }),
      });
      expect(saveDocRes.status).toBe(200);
      const historyBefore = store.listArtifactHistoryViews('proj-contract');
      expect(historyBefore.length).toBeGreaterThan(0);

      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'REQUIREMENT',
        title: '多轮编辑验证',
        initialMessages: [
          {
            id: 'u-turn-1',
            role: 'user',
            content: '第一轮：梳理供应商准入条件',
            timestamp: '2026-11-18T08:00:00.000Z',
          },
          {
            id: 'a-turn-1',
            role: 'assistant',
            content: '已整理供应商准入资质要求。',
            timestamp: '2026-11-18T08:00:05.000Z',
          },
          {
            id: 'u-turn-2',
            role: 'user',
            content: '第二轮：超过 100 万合同双签',
            timestamp: '2026-11-18T08:02:00.000Z',
          },
          {
            id: 'a-turn-2',
            role: 'assistant',
            content: '已记录超 100 万合同双签规则。',
            timestamp: '2026-11-18T08:02:05.000Z',
          },
        ],
      });

      // 1. Attempting to truncate from an EARLIER user message is rejected (400 ONLY_LATEST_TURN_ALLOWED)
      const earlierRes = await app.request(`/api/agent-sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ truncateFromUserMessageId: 'u-turn-1' }),
      });
      expect(earlierRes.status).toBe(400);
      const earlierBody = (await earlierRes.json()) as { code?: string };
      expect(earlierBody.code).toBe('ONLY_LATEST_TURN_ALLOWED');
      expect(store.getAgentSession(session.id)!.messages).toHaveLength(4);

      // 2. Attempting to drop/truncate while session is RUNNING is rejected (409 SESSION_RUNNING)
      store.saveAgentSession({
        ...store.getAgentSession(session.id)!,
        status: 'RUNNING',
      });
      const runningRes = await app.request(`/api/agent-sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropLatestTurn: true, truncateFromUserMessageId: 'u-turn-2' }),
      });
      expect(runningRes.status).toBe(409);
      const runningBody = (await runningRes.json()) as { code?: string };
      expect(runningBody.code).toBe('SESSION_RUNNING');
      expect(store.getAgentSession(session.id)!.messages).toHaveLength(4);

      // Restore session to IDLE and drop the latest turn cleanly
      store.saveAgentSession({
        ...store.getAgentSession(session.id)!,
        status: 'IDLE',
      });
      const okRes = await app.request(`/api/agent-sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropLatestTurn: true, truncateFromUserMessageId: 'u-turn-2' }),
      });
      expect(okRes.status).toBe(200);
      const okBody = (await okRes.json()) as { session: { messages: Array<{ id: string }> } };
      expect(okBody.session.messages.map((m) => m.id)).toEqual(['u-turn-1', 'a-turn-1']);

      // 3. ArtifactHistory is completely unchanged
      const historyAfter = store.listArtifactHistoryViews('proj-contract');
      expect(historyAfter).toEqual(historyBefore);
    } finally {
      store.close();
    }
  });

  it('prunes discarded turn ModelCall snapshots on dropLatestTurn / clearMessages and deletes bound coDesignSessionId (+ snapshots) on deletePrototype (#78, #81)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'REQUIREMENT',
        title: '快照清理测试',
        initialMessages: [
          {
            id: 'u-snap-1',
            runId: 'u-snap-1',
            role: 'user',
            content: '第一轮消息',
            timestamp: '2026-11-18T09:00:00.000Z',
          },
          {
            id: 'a-snap-1',
            runId: 'u-snap-1',
            role: 'assistant',
            content: '第一轮回复',
            timestamp: '2026-11-18T09:00:04.000Z',
          },
          {
            id: 'u-snap-2',
            runId: 'u-snap-2',
            role: 'user',
            content: '第二轮待修改消息',
            timestamp: '2026-11-18T09:02:00.000Z',
          },
          {
            id: 'a-snap-2',
            runId: 'u-snap-2',
            role: 'assistant',
            content: '第二轮待丢弃回复',
            timestamp: '2026-11-18T09:02:05.000Z',
          },
        ],
      });

      const call1 = store.recordModelCall({
        projectId: 'proj-contract',
        sessionId: session.id,
        runId: 'u-snap-1',
        purpose: 'TURN',
        provider: 'Mock',
        model: 'mock-v1',
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        startedAt: '2026-11-18T09:00:00.000Z',
        endedAt: '2026-11-18T09:00:03.000Z',
        status: 'COMPLETED',
        simulated: true,
        included: [{ kind: 'USER_MESSAGE', content: '第一轮消息' }],
        excluded: [],
        response: [{ kind: 'ASSISTANT_MESSAGE', content: '第一轮回复' }],
      });
      const call2 = store.recordModelCall({
        projectId: 'proj-contract',
        sessionId: session.id,
        runId: 'u-snap-2',
        purpose: 'TURN',
        provider: 'Mock',
        model: 'mock-v1',
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        startedAt: '2026-11-18T09:02:00.000Z',
        endedAt: '2026-11-18T09:02:02.000Z',
        status: 'COMPLETED',
        simulated: true,
        included: [{ kind: 'USER_MESSAGE', content: '第二轮待修改消息' }],
        excluded: [],
        response: [{ kind: 'TOOL_CALL', label: 'spawn_subagents', content: '{}' }],
      });
      store.recordModelCall({
        projectId: 'proj-contract',
        sessionId: session.id,
        runId: 'u-snap-2',
        parentCallId: call2.id,
        laneLabel: { zh: '子任务 1', en: 'Subagent 1' },
        purpose: 'SUBAGENT',
        provider: 'Mock',
        model: 'mock-v1',
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        startedAt: '2026-11-18T09:02:02.000Z',
        endedAt: '2026-11-18T09:02:04.000Z',
        status: 'COMPLETED',
        simulated: true,
        included: [{ kind: 'USER_MESSAGE', content: '子任务上下文' }],
        excluded: [],
        response: [{ kind: 'ASSISTANT_MESSAGE', content: '子任务结果' }],
      });
      store.recordContextEvent({
        projectId: 'proj-contract',
        sessionId: session.id,
        kind: 'COMPACT',
        removed: [{ kind: 'USER_MESSAGE', content: '已归档早期内容' }],
        summary: '早期摘要',
      });

      expect(store.listModelCalls('proj-contract', session.id)).toHaveLength(3);

      // 1. dropLatestTurn removes Turn 2's TURN + SUBAGENT ModelCalls, keeping Turn 1's ModelCall intact
      const dropRes = await app.request(`/api/agent-sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropLatestTurn: true, truncateFromUserMessageId: 'u-snap-2' }),
      });
      expect(dropRes.status).toBe(200);
      expect(store.listModelCalls('proj-contract', session.id).map((c) => c.id)).toEqual([call1.id]);
      expect(store.getModelCall('proj-contract', call2.id)).toBeUndefined();

      // 2. clearMessages wipes the session's remaining ModelCalls and ContextEvents
      const clearRes = await app.request(`/api/agent-sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearMessages: true }),
      });
      expect(clearRes.status).toBe(200);
      expect(store.listModelCalls('proj-contract', session.id)).toEqual([]);
      expect(store.listContextEvents('proj-contract', session.id)).toEqual([]);

      // 3. Deleting an unconfirmed prototype also deletes its bound coDesignSessionId AgentSession + snapshots
      const coDesignSess = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'PROTOTYPE_CO_DESIGN',
        title: '临时原型共创会话',
      });
      const draftProto = store.createPrototype('proj-contract', {
        name: '待删除探索原型',
        htmlContent: '<section data-screen-id="SCR-TMP" data-screen-name="探索页"></section>',
        coDesignSessionId: coDesignSess.id,
      });
      store.saveAgentSession({
        ...coDesignSess,
        targetId: draftProto.prototype.id,
      });
      store.recordModelCall({
        projectId: 'proj-contract',
        sessionId: coDesignSess.id,
        purpose: 'TURN',
        provider: 'Mock',
        model: 'mock-v1',
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        startedAt: '2026-11-18T09:10:00.000Z',
        endedAt: '2026-11-18T09:10:02.000Z',
        status: 'COMPLETED',
        simulated: true,
        included: [{ kind: 'USER_MESSAGE', content: '生成探索页' }],
        excluded: [],
        response: [{ kind: 'ASSISTANT_MESSAGE', content: '已生成探索页' }],
      });

      expect(store.getAgentSession(coDesignSess.id)).toBeDefined();
      expect(store.listModelCalls('proj-contract', coDesignSess.id)).toHaveLength(1);

      const delProtoRes = await app.request(
        `/api/prototypes/${draftProto.prototype.id}?projectId=proj-contract`,
        { method: 'DELETE' },
      );
      expect(delProtoRes.status).toBe(200);
      expect(store.getPrototype(draftProto.prototype.id)).toBeUndefined();
      expect(store.getAgentSession(coDesignSess.id)).toBeUndefined();
      expect(store.listModelCalls('proj-contract', coDesignSess.id)).toEqual([]);
    } finally {
      store.close();
    }
  });
});
