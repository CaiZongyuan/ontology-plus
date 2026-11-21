import { expect, it } from 'vitest';
import { buildPiModelsForStore, runUnifiedAgentSessionStream } from '../packages/agent-runtime/index.js';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

it('validates provider/model pairs atomically and keeps settings changed during a reply for the following run', async () => {
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  try {
    const provider = store.listLlmProviders().find((item) => item.enabled)!;
    const other = store.saveLlmProvider({ ...provider, id: 'alternate', name: 'Alternate',
      defaultModel: 'alt-default', availableModels: ['alt-other'], enabled: true });
    store.saveLlmProvider({ ...other, id: 'disabled', enabled: false });
    const session = store.createAgentSession({ projectId: 'proj-contract', agentKind: 'REQUIREMENT',
      providerId: provider.id, modelOverride: provider.defaultModel });
    const app = createApiApp(store);
    const patch = (settings: object) => app.request(`/api/agent-sessions/${session.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
    });
    for (const [providerId, modelOverride] of [['disabled', 'alt-default'], ['unknown', 'alt-default'], [other.id, 'not-listed']]) {
      const response = await patch({ providerId, modelOverride, multiAgentConcurrency: 6 });
      expect(response.status).toBe(400);
      expect(store.getAgentSession(session.id)).toMatchObject({ providerId: provider.id, multiAgentConcurrency: 3 });
    }
    let changedDuringRun = false;
    for await (const event of runUnifiedAgentSessionStream(store, { sessionId: session.id, prompt: 'Hello', mockMode: true })) {
      if (event.event === 'session_meta' && !changedDuringRun) {
        expect(store.getAgentSession(session.id)?.status).toBe('RUNNING');
        expect((await patch({ providerId: other.id, modelOverride: 'alt-other', multiAgentConcurrency: 6 })).status).toBe(200);
        changedDuringRun = true;
      }
    }
    expect(changedDuringRun).toBe(true);
    const completed = store.getAgentSession(session.id)!;
    expect(completed.messages.at(-1)?.modelUsed).not.toBe('alt-other');
    expect(completed).toMatchObject({ providerId: other.id, modelOverride: 'alt-other', multiAgentConcurrency: 6 });
    const next = buildPiModelsForStore(store, completed, { mockMode: false });
    expect(next.selectedModel.id).toBe('alt-other');
    expect(next.providerConfig?.id).toBe(other.id);
    store.saveLlmProvider({ ...other, availableModels: [] });
    expect(() => buildPiModelsForStore(store, completed, { mockMode: false })).toThrow();
    store.saveLlmProvider({ ...other, enabled: false });
    expect(() => buildPiModelsForStore(store, completed, { mockMode: false })).toThrow();
    expect((await patch({ providerId: '', modelOverride: '' })).status).toBe(200);
    expect(store.getAgentSession(session.id)?.providerId).toBeUndefined();
    expect(store.getAgentSession(session.id)?.modelOverride).toBeUndefined();
  } finally {
    store.close();
  }
});
