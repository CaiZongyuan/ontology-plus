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
});
