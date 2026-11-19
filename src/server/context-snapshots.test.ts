import { describe, expect, it } from 'vitest';
import {
  createWorkspaceStore,
  type ContextEventDetail,
  type ContextEventSummary,
  type ModelCallDetail,
  type ModelCallSummary,
} from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

describe('HTTP Context Snapshots (ADR 0017)', () => {
  it('lists a session’s Model Calls and context events, serves details, and stays inside the project', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    const project = store.createProject({
      name: '合同管理',
      code: 'CTX-HTTP',
      domain: '合同',
      template: 'EMPTY',
    });
    const other = store.createProject({ name: '仓储', code: 'CTX-OTHER', domain: '仓储', template: 'EMPTY' });

    const created = await app.request('/api/agent-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, agentKind: 'REQUIREMENT' }),
    });
    const { session } = (await created.json()) as { session: { id: string } };

    for (const prompt of ['我要管理采购合同', '审批要分三级', '到期前一个月提醒']) {
      const streamed = await app.request(`/api/agent-sessions/${session.id}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mockMode: true }),
      });
      expect(streamed.status).toBe(200);
      await streamed.text();
    }
    const compacted = await app.request(`/api/agent-sessions/${session.id}/compact`, { method: 'POST' });
    expect(compacted.status).toBe(200);

    const listRes = await app.request(`/api/projects/${project.id}/agent-sessions/${session.id}/model-calls`);
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      modelCalls: ModelCallSummary[];
      contextEvents: ContextEventSummary[];
    };
    expect(listed.modelCalls.length).toBeGreaterThanOrEqual(3);
    expect(listed.modelCalls.every((c) => c.usage.source === 'SIMULATED' && c.hasDetail)).toBe(true);
    expect(listed.contextEvents.map((e) => e.kind)).toEqual(['COMPACT']);

    const callId = listed.modelCalls.at(-1)!.id;
    const detailRes = await app.request(`/api/projects/${project.id}/model-calls/${callId}`);
    expect(detailRes.status).toBe(200);
    const { modelCall } = (await detailRes.json()) as { modelCall: ModelCallDetail };
    expect(modelCall.included.some((i) => i.kind === 'USER_MESSAGE' && i.content.includes('到期前一个月提醒'))).toBe(true);

    const eventRes = await app.request(`/api/projects/${project.id}/context-events/${listed.contextEvents[0]!.id}`);
    const { contextEvent } = (await eventRes.json()) as { contextEvent: ContextEventDetail };
    expect(contextEvent.removed.some((r) => r.content.includes('我要管理采购合同'))).toBe(true);

    // Another project's id never reaches this project's snapshots.
    expect((await app.request(`/api/projects/${other.id}/agent-sessions/${session.id}/model-calls`)).status).toBe(404);
    expect((await app.request(`/api/projects/${other.id}/model-calls/${callId}`)).status).toBe(404);
    expect(
      (await app.request(`/api/projects/${other.id}/context-events/${listed.contextEvents[0]!.id}`)).status,
    ).toBe(404);

    // Deleting the session deletes its snapshots.
    await app.request(`/api/agent-sessions/${session.id}`, { method: 'DELETE' });
    expect((await app.request(`/api/projects/${project.id}/model-calls/${callId}`)).status).toBe(404);
  });
});
