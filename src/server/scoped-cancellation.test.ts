import { expect, it } from 'vitest';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

it('records a stop before delivery; duplicate stops cannot cancel a newer run', async () => {
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  try {
    const session = store.createAgentSession({ projectId: 'proj-contract', agentKind: 'REQUIREMENT' });
    const app = createApiApp(store);
    const post = (route: string, body: object) => app.request(`/api/agent-sessions/${session.id}/${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect((await post('abort', {})).status).toBe(400);
    expect(await (await post('abort', { submissionId: 'stopped' })).json()).toMatchObject({ acknowledged: true });
    const later = await post('stream', { submissionId: 'later', prompt: 'Work on returns', mockMode: true });
    const lateDelivery = await post('stream', { submissionId: 'stopped', prompt: 'Never start', mockMode: true });
    expect(await lateDelivery.text()).toContain('event: message_end');
    expect(await (await post('abort', { submissionId: 'stopped' })).json()).toMatchObject({ aborted: false });
    expect(await later.text()).toContain('event: message_end');
    const saved = store.getAgentSession(session.id)!;
    expect(saved.messages.filter(message => message.role === 'user').map(message => message.content)).toEqual(['Work on returns']);
    expect(saved.messages.some(message => message.cancelled)).toBe(false);
    expect(saved.cancelledSubmissionIds).toEqual(['stopped']);
  } finally { store.close(); }
});
