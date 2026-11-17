import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceStore, type AgentSession } from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { useWorkbenchStore } from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import { AgentRunCard } from './AgentRunCard.js';
import { agentRunsFromSession, type AgentRunView } from './agentRun.js';
import { agentPanelSurfaceFor, resolveActiveWorkspaceRuns, resolveSurfaceAgentSession } from './ShellAgentPanel.js';

function renderRun(run: AgentRunView) {
  return renderToStaticMarkup(<PreferencesProvider><AgentRunCard run={run} now={Date.now()} onRetry={() => {}} /></PreferencesProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  useWorkbenchStore.setState({ data: null, liveSessionDrafts: {}, sessionQueues: {}, activeSessionId: null });
});

describe('assistant transcript streaming', () => {
  it('keeps SSE assistant text as visible Markdown through live draft, run adaptation and completed card', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const session = store.createAgentSession({ projectId: 'proj-contract', agentKind: 'CODING', targetId: 'app-contract-clm' });
    const app = createApiApp(store);
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith(`/agent-sessions/${session.id}/stream`)) {
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(next) { controller = next; } }), { headers: { 'Content-Type': 'text/event-stream' } }));
      }
      return app.request(url.startsWith('http') ? url : `http://localhost${url}`, init);
    });
    await useWorkbenchStore.getState().bootstrap('proj-contract');
    const running = useWorkbenchStore.getState().startSessionAgentRun({ sessionId: session.id, prompt: 'Refine the implementation specification' });
    const emit = (event: string, data: unknown) => controller!.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    await vi.waitFor(() => expect(controller).toBeDefined());
    emit('thinking_delta', { delta: 'Inspect the selected standards.' });
    emit('tool_result', { trace: { id: 'inspect-inputs', toolName: 'read_application_inputs', arguments: {}, output: 'Read selected inputs.' } });
    const chunks = ['# Implementation specification', '\n\n## Acceptance\n\n- Keep approved UI intent.', '\n\n```ts\nconst ready = true;\n```'];
    for (const text of chunks) emit('delta', { text });
    await vi.waitFor(() => expect(useWorkbenchStore.getState().liveSessionDrafts[session.id]?.text).toBe(chunks.join('')));
    const state = useWorkbenchStore.getState();
    const liveRun = agentRunsFromSession(state.data!.agentSessions.find((item) => item.id === session.id), state.liveSessionDrafts[session.id])[0]!;
    expect(liveRun.text).toBe(chunks.join(''));
    expect(liveRun.liveStatus.en).toBe('Responding…');
    expect(liveRun.steps.map((step) => step.toolName)).toEqual(['read_application_inputs']);
    const liveHtml = renderRun(liveRun);
    expect(liveHtml).toContain('<h1>Implementation specification</h1>');
    expect(liveHtml).toContain('<h2>Acceptance</h2>');
    expect(liveHtml).toContain('<li>Keep approved UI intent.</li>');
    expect(liveHtml).toContain('<pre');
    expect(liveHtml).toContain('ready');
    expect(liveHtml).toContain('stream-caret is-streaming');
    expect(liveHtml).not.toMatch(/<details[^>]*\sopen/);
    expect(liveHtml.indexOf('data-testid="agent-run-text"')).toBeGreaterThan(liveHtml.lastIndexOf('</details>'));
    expect(liveHtml).not.toContain('Analyzing instruction &amp; anchors');

    const completed: AgentSession = {
      ...session, messages: [
        { id: 'u', role: 'user', content: 'Refine the implementation specification', timestamp: new Date().toISOString() },
        { id: 'a', role: 'assistant', content: chunks.join(''), thinking: liveRun.thinking, timestamp: new Date().toISOString() },
      ],
    };
    emit('message_end', { session: completed });
    controller!.close();
    await running;
    const saved = useWorkbenchStore.getState().data!.agentSessions.find((item) => item.id === session.id)!;
    const finalRun = agentRunsFromSession(saved)[0]!;
    expect(finalRun.status).toBe('SUCCEEDED');
    const finalHtml = renderRun(finalRun);
    expect(finalHtml).toContain('<h1>Implementation specification</h1>');
    expect(finalHtml).toContain('<h2>Acceptance</h2>');
    expect(finalHtml.match(/<h1>/g)).toHaveLength(1);
    expect(finalHtml).toContain('<pre');
    expect(finalHtml).not.toContain('stream-caret is-streaming');
  });

  it('preserves partial assistant Markdown on failed and cancelled runs', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const session = store.createAgentSession({ projectId: 'proj-contract', agentKind: 'CODING' });
    for (const cancelled of [true, false]) {
      const run = agentRunsFromSession({ ...session, messages: [
        { id: 'u', role: 'user', content: 'Inspect inputs', timestamp: new Date().toISOString() },
        { id: 'a', role: 'assistant', content: '## Partial findings\n\nThe selected UI standard needs review.', timestamp: new Date().toISOString(),
          ...(cancelled ? { cancelled: true } : { errorDiagnostic: { code: 'GATEWAY', message: 'Gateway disconnected', remediation: 'Retry the run.' } }) },
      ] })[0]!;
      const html = renderRun(run);
      expect(html).toContain('<h2>Partial findings</h2>');
      expect(html).toContain('data-testid="agent-run-retry-btn"');
      expect(run.status).toBe(cancelled ? 'CANCELLED' : 'FAILED');
    }
  });

  it('separates specialist histories and excludes another application conversation from the current target', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    const application = store.listAssembledApplications().find((item) => item.id === 'app-contract-clm')!;
    const other = store.saveAssembledApplication({ ...application, id: 'another-application', name: 'Another application' });
    const architecture = store.createAgentSession({ projectId: application.projectId, agentKind: 'ARCHITECTURE' });
    const previous = store.createAgentSession({ projectId: application.projectId, agentKind: 'CODING', targetId: application.id });
    const projectSession = store.createAgentSession({ projectId: application.projectId, agentKind: 'CODING' });
    const data = await (await app.request(`http://localhost/api/bootstrap?projectId=${application.projectId}`)).json();
    const architectureSurface = agentPanelSurfaceFor('app-four-layer-assets');
    const applicationSurface = agentPanelSurfaceFor('app-assembly-dev');
    expect(architectureSurface.sessionKind).toBe('ARCHITECTURE');
    expect(architectureSurface.title.en).toBe('Architecture Asset Agent');
    expect(applicationSurface.title.en).toBe('Application Specification Assistant');
    expect(resolveSurfaceAgentSession(architectureSurface, data, { activeSessionId: previous.id }).session?.id).toBe(architecture.id);
    expect(resolveSurfaceAgentSession(applicationSurface, data, { activeItemId: other.id, activeSessionId: previous.id }).session?.id).toBe(projectSession.id);
    expect(resolveSurfaceAgentSession(applicationSurface, data).matchingSessions.map((session) => session.id)).toEqual([projectSession.id]);
    expect(resolveSurfaceAgentSession(applicationSurface, data, { activeItemId: application.id, activeSessionId: previous.id }).session?.id).toBe(previous.id);
    const active = resolveActiveWorkspaceRuns({ ...data, agentSessions: [{ ...architecture, status: 'RUNNING' }] }, {});
    expect(active[0]?.targetNav).toBe('app-four-layer-assets');
  });
});
