import { expect, it } from 'vitest';
import { createWorkspaceStore, type AgentSession } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

it('deduplicates concurrent and queued submissions without coalescing identical instructions from separate sends', async () => {
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  try {
    const session = store.createAgentSession({ projectId: 'proj-contract', agentKind: 'REQUIREMENT' });
    const app = createApiApp(store);
    const path = `/api/agent-sessions/${session.id}`;
    const prompt = 'What approvals are required?';
    const post = (submissionId: string) => app.request(`${path}/stream`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId, prompt, mockMode: true }),
    });
    const [first, duplicate] = await Promise.all([post('first'), post('first')]);
    const [second, duplicateSecond] = await Promise.all([post('second'), post('second')]);
    const wrong = await app.request(`${path}/live?submissionId=never-sent`);
    const pending = await app.request(`${path}/live?submissionId=second`);
    const bodies = await Promise.all([first, duplicate, second, duplicateSecond].map((response) => response.text()));
    expect(duplicateSecond.status).toBe(409);
    expect(JSON.parse(bodies[3])).toEqual({ state: 'queued' });
    expect(wrong.status).toBe(404);
    expect(await wrong.json()).toMatchObject({ state: 'absent' });
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({ state: 'queued' });
    expect(bodies[0]).toContain('event: message_end');
    expect(bodies[2]).toContain('event: message_end');
    const replay = await post('first');
    expect(await replay.text()).toContain('event: message_end');
    const { session: result } = await (await app.request(`${path}/status`)).json() as { session: AgentSession };
    expect(result.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([prompt, prompt]);
    expect(result.messages.filter((message) => message.role === 'assistant')).toHaveLength(2);
    expect(result.acceptedSubmissionIds).toEqual(['first', 'second']);
    store.saveAgentSession({ ...result, cancelledSubmissionIds: ['cancelled-in-parent'] });
    const fork = await app.request(`${path}/fork`, { method: 'POST', body: JSON.stringify({ fromMessageId: result.messages[0].id }) });
    const { session: forked } = await fork.json() as { session: AgentSession };
    expect((await app.request(`/api/agent-sessions/${forked.id}/live?submissionId=first`)).status).toBe(404);
    expect(forked.cancelledSubmissionIds ?? []).not.toContain('cancelled-in-parent');
  } finally { store.close(); }
});
