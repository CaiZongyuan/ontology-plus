import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from '../server/app.js';
import type { BootstrapPayload } from './api.js';

afterEach(() => { vi.unstubAllGlobals(); });

it.each(['before acceptance', 'after acceptance', 'during streaming', 'while queued', 'after refresh'] as const)(
  'recovers a dropped POST %s, resending only when absent and retaining exactly one turn', async (failure) => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    const storage = new Map<string, string>();
    const savedStorage = { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
    vi.stubGlobal('sessionStorage', savedStorage);
    const session = store.createAgentSession({ projectId: 'proj-contract', agentKind: 'REQUIREMENT' });
    const payload = await (await app.request('/api/bootstrap?projectId=proj-contract')).json() as BootstrapPayload;
    const submissions: string[] = [];
    const lookups: string[] = [];
    const cursors: (string | null)[] = [];
    const prompt = 'Which requirements remain open?';
    let persistedBeforeResponse: [string, string][] = [];
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname.endsWith('/stream') && init?.method === 'POST') {
        submissions.push(JSON.parse(String(init.body)).submissionId);
        if (submissions.length === 1) {
          persistedBeforeResponse = [...storage.entries()];
          if (failure === 'before acceptance') throw new TypeError('connection dropped');
          const accepted = await app.request(url.href, init);
          if (failure === 'while queued') {
            await accepted.text();
            return Response.json({ state: 'queued' }, { status: 409 });
          }
          if (failure === 'during streaming') {
            const upstream = accepted.body!.getReader();
            let delivered = false;
            return new Response(new ReadableStream<Uint8Array>({ async pull(downstream) {
              if (delivered) { downstream.error(new TypeError('stream dropped')); void upstream.cancel(); return; }
              const { value } = await upstream.read();
              downstream.enqueue(value);
              delivered = true;
            } }), { headers: accepted.headers });
          }
          await accepted.text();
          throw new TypeError('reply unavailable');
        }
      }
      if (url.pathname.endsWith('/live')) {
        lookups.push(url.searchParams.get('submissionId') ?? '');
        cursors.push(url.searchParams.get('afterEventId'));
      }
      return app.request(url.href, init);
    });
    try {
      const { useWorkbenchStore: client } = await import('./api.js');
      client.setState({ data: payload, loading: false, liveSessionDrafts: {}, sessionQueues: {} });
      await client.getState().startSessionAgentRun({ sessionId: session.id, prompt, mockMode: true });
      if (failure === 'after refresh') {
        for (const [key, value] of persistedBeforeResponse) storage.set(key, value);
        lookups.length = 0;
        vi.resetModules();
        const { useWorkbenchStore: refreshed } = await import('./api.js');
        await refreshed.getState().bootstrap('proj-contract');
        await vi.waitFor(() => expect(storage.size).toBe(0));
        expect(refreshed.getState().liveSessionDrafts[session.id]).toBeUndefined();
      }
      expect(submissions[0]).toBeTruthy();
      expect(submissions).toHaveLength(failure === 'before acceptance' ? 2 : 1);
      expect(new Set([...submissions, ...lookups]).size).toBe(1);
      expect(lookups).toEqual([submissions[0]]);
      if (failure === 'during streaming') expect(cursors[0]).toBeTruthy();
      expect(persistedBeforeResponse.length).toBeGreaterThan(0);
      expect(storage.size).toBe(0);
      const saved = store.getAgentSession(session.id)!;
      expect(saved.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([prompt]);
      expect(saved.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    } finally { store.close(); }
  });
