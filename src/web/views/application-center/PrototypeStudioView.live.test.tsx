// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectUnifiedAgentTurn, initPrototypeShell, upsertPrototypeScreen } from '../../../packages/agent-runtime/index.js';
import {
  applyPrototypeLiveEvent,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
  splitPrototypeDocument,
} from '../../../packages/ontology-core/index.js';
import {
  createWorkspaceStore,
  type InteractivePrototype,
} from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload, type SessionLiveDraft } from '../../api.js';
import { ShellAgentPanel } from '../../components/agent/ShellAgentPanel.js';
import { PreferencesProvider } from '../../i18n.js';
import { agentPanelSurfaceFor } from '../../navigation/index.js';
import { PENDING_LIVE_PROTOTYPE_ID, PrototypeStudioView } from './PrototypeStudioView.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useWorkbenchStore.setState({ data: null, liveSessionDrafts: {} });
});

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe('PrototypeStudioView: one canvas from the running build to the saved prototype (#89)', () => {
  it.each([true, false])('keeps completed screens on Retry (original build plan retained: %s)', async (keepPlan) => {
    vi.stubEnv('ONTOLOGY_DISABLE_PROTOTYPE_SCREENSHOT', '1');
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const session = store.createAgentSession({
      projectId: 'proj-contract', agentKind: 'PROTOTYPE_CO_DESIGN', title: 'Interrupted build',
    });
    const { session: built } = await collectUnifiedAgentTurn(store, {
      sessionId: session.id, prompt: '设计订货工作台', mockMode: true,
    });
    const finished = built.messages.at(-1)!;
    const { prototypeBuild, ...interruptedReply } = finished;
    if (keepPlan) {
      const alreadyWritten = prototypeBuild?.screens['SCR-HOME'];
      expect(alreadyWritten?.status).toBe('done');
      if (alreadyWritten) alreadyWritten.status = 'failed';
    }
    const originalCallIds = store.listModelCalls(session.projectId, session.id).map(({ id }) => id);
    expect(originalCallIds.length).toBeGreaterThan(0);
    store.saveAgentSession({
      ...built,
      status: 'ERROR',
      messages: [...built.messages.slice(0, -1), {
        ...interruptedReply,
        ...(keepPlan && prototypeBuild ? { prototypeBuild } : {}),
        errorDiagnostic: { code: 'LLM_TIMEOUT', message: 'Timed out', remediation: 'Retry' },
      }],
    });
    const original = store.getPrototype(built.targetId!)!;
    const before = splitPrototypeDocument(original.htmlContent);
    const app = createApiApp(store);
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, { ...init, signal: null }));
    try {
      await useWorkbenchStore.getState().bootstrap('proj-contract');
      useWorkbenchStore.getState().setActivePrototypeId('proj-contract', original.id);
      useWorkbenchStore.getState().setActiveSessionId(session.id);
      await act(async () => {
        root.render(
          <PreferencesProvider>
            <ShellAgentPanel surface={agentPanelSurfaceFor('app-prototype')} overlay={false} onClose={() => {}} onNavigate={() => {}} />
          </PreferencesProvider>,
        );
      });
      vi.useFakeTimers();
      await act(async () => {
        host.querySelector<HTMLButtonElement>('[data-testid="agent-run-retry-btn"]')!.click();
        await vi.runAllTimersAsync();
      });
      expect(store.getAgentSession(session.id)!.messages[1]).toMatchObject({ id: finished.id });
      expect(store.getAgentSession(session.id)!.messages).toHaveLength(4);
      expect(store.getAgentSession(session.id)!.messages.at(-1)?.subagentLanes?.map((lane) => lane.targetAnchor?.screenId))
        .toEqual(['SCR-REFUND']);
      expect(store.listModelCalls(session.projectId, session.id).map(({ id }) => id)).toEqual(
        expect.arrayContaining(originalCallIds),
      );
      expect(useWorkbenchStore.getState().liveSessionDrafts[session.id]).toBeUndefined();
      const after = splitPrototypeDocument(store.getPrototype(original.id)!.htmlContent);
      expect(after.screens.map(({ screenId, status }) => [screenId, status])).toEqual(
        before.screens.map(({ screenId }) => [screenId, 'ready']),
      );
      for (const screen of before.screens.filter(({ status }) => status === 'ready')) {
        expect(after.screens.find(({ screenId }) => screenId === screen.screenId)?.html).toBe(screen.html);
      }
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      store.close();
    }
  });

  it('reattaches to an accepted run when the initial and first reattached streams close without a terminal event', async () => {
    vi.stubEnv('ONTOLOGY_DISABLE_PROTOTYPE_SCREENSHOT', '1');
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const session = store.createAgentSession({
      projectId: 'proj-contract', agentKind: 'PROTOTYPE_CO_DESIGN', title: 'Reconnect build',
    });
    const app = createApiApp(store);
    let posts = 0;
    let reconnects = 0;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const response = await app.request(url, { ...init, signal: null });
      if (url.endsWith('/stream')) {
        posts++;
        const [firstEvent] = (await response.text()).split('\n\n');
        return new Response(`${firstEvent}\n\n`);
      }
      if (url.includes('/live') && ++reconnects === 1) {
        await response.text();
        return new Response('');
      }
      return response;
    });
    try {
      await useWorkbenchStore.getState().bootstrap('proj-contract');
      vi.useFakeTimers();
      const completed = useWorkbenchStore.getState().startSessionAgentRun({
        sessionId: session.id, prompt: '生成订货工作台', mockMode: true,
      });
      await vi.runAllTimersAsync();
      await completed;
      expect(posts).toBe(1);
      expect(reconnects).toBe(2);
      const state = useWorkbenchStore.getState().data!;
      const persisted = state.agentSessions.find(({ id }) => id === session.id)!;
      expect(persisted.messages.at(-1)?.prototypeBuild?.plan.length).toBeGreaterThan(0);
      expect(state.prototypes.some(({ id }) => id === persisted.targetId)).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      store.close();
    }
  });

  it('keeps the same canvas and the same artboard iframes when the first build is saved', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      title: '首版原型生成',
    });
    const app = createApiApp(store);
    const bootstrap = (await (
      await app.request('http://localhost/api/bootstrap?projectId=proj-contract')
    ).json()) as BootstrapPayload;

    const shell = initPrototypeShell({
      appTitle: '门店订货',
      screens: [
        { screenId: 'SCR-HOME', screenName: '工作台首页', screenType: 'DASHBOARD' },
        { screenId: 'SCR-ORDERS', screenName: '订货单列表', screenType: 'LIST' },
      ],
    });
    const savedHtml = [
      ['SCR-HOME', '<h1 data-element-id="EL-GREET">早上好</h1>'],
      ['SCR-ORDERS', '<h2 data-element-id="EL-ORDERS">订货单</h2>'],
    ].reduce(
      (html, [screenId, screenHtml]) => upsertPrototypeScreen(html, { screenId: screenId!, screenHtml: screenHtml! }).nextHtml,
      shell.nextHtml,
    );

    // While the run is going: the shell has landed, the home screen is still streaming.
    const tracker = createPrototypeLiveTracker();
    let live = emptyPrototypeLiveState();
    for (const ev of tracker.observeDocument(shell.nextHtml)) live = applyPrototypeLiveEvent(live, ev);
    live = applyPrototypeLiveEvent(
      live,
      tracker.observePartialScreen({ screenId: 'SCR-HOME', partialHtml: '<h1 data-element-id="EL-GREET">早上' })!,
    );
    const draft: SessionLiveDraft = {
      runId: 'run-1',
      sessionId: session.id,
      userPrompt: '生成首版原型',
      startedAt: Date.now(),
      liveStatus: { zh: '正在画', en: 'Drawing' },
      thinking: '',
      text: '',
      steps: [],
      prototypeLive: live,
    };
    useWorkbenchStore.setState({
      data: {
        ...bootstrap,
        prototypes: [],
        confirmedPrototypeRevision: null,
        agentSessions: [{ ...session, status: 'RUNNING' }],
      },
      liveSessionDrafts: { [session.id]: draft },
    });

    await act(async () => {
      root.render(
        <PreferencesProvider>
          <PrototypeStudioView />
        </PreferencesProvider>,
      );
    });
    await settle();

    const canvas = host.querySelector('[data-testid="prototype-live-canvas"]');
    expect(canvas).not.toBeNull();
    expect(host.querySelector('[data-testid="prototype-canvas-toolbar"]')?.getAttribute('data-pending-live')).toBe('true');
    const homeFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-artboard-frame-SCR-HOME"]')!;
    expect(homeFrame.contentDocument!.body.textContent).toContain('早上');
    expect(homeFrame.getAttribute('data-load-count')).toBe('1');

    // The run ends: the revision is saved, the live draft goes away.
    const saved = store.createPrototype('proj-contract', {
      name: '门店订货原型',
      htmlContent: savedHtml,
      source: 'GENERATED',
    }).prototype as InteractivePrototype;
    await act(async () => {
      useWorkbenchStore.setState({
        data: {
          ...useWorkbenchStore.getState().data!,
          prototypes: [{ ...saved, coDesignSessionId: session.id }],
          agentSessions: [{ ...session, status: 'IDLE', targetId: saved.id }],
        },
        liveSessionDrafts: {},
      });
    });
    await settle();

    expect(host.querySelector('[data-testid="prototype-live-canvas"]')).toBe(canvas);
    expect(host.querySelector('[data-testid="prototype-history-btn"]')).not.toBeNull();
    const homeAfter = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-artboard-frame-SCR-HOME"]')!;
    expect(homeAfter).toBe(homeFrame);
    expect(homeAfter.getAttribute('data-load-count')).toBe('1');
    expect(homeAfter.contentDocument!.body.textContent).toContain('早上好');
    expect(
      homeAfter.contentDocument!.body.querySelector('[data-screen-id="SCR-HOME"]')?.getAttribute('data-screen-status'),
    ).toBe('ready');
  });

  it('never sends the placeholder of an unsaved first build to the server', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      title: '首版原型生成',
    });
    const app = createApiApp(store);
    const bootstrap = (await (
      await app.request('http://localhost/api/bootstrap?projectId=proj-contract')
    ).json()) as BootstrapPayload;
    const shell = initPrototypeShell({
      appTitle: '门店订货',
      screens: [{ screenId: 'SCR-HOME', screenName: '工作台首页', screenType: 'DASHBOARD' }],
    });
    const tracker = createPrototypeLiveTracker();
    let live = emptyPrototypeLiveState();
    for (const ev of tracker.observeDocument(shell.nextHtml)) live = applyPrototypeLiveEvent(live, ev);

    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: { body?: unknown }) => {
        calls.push(`${String(url)} ${typeof init?.body === 'string' ? init.body : ''}`);
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    try {
      useWorkbenchStore.setState({
        data: { ...bootstrap, prototypes: [], confirmedPrototypeRevision: null, agentSessions: [{ ...session, status: 'RUNNING' }] },
        liveSessionDrafts: {
          [session.id]: {
            runId: 'run-1',
            sessionId: session.id,
            userPrompt: '生成首版原型',
            startedAt: Date.now(),
            liveStatus: { zh: '正在画', en: 'Drawing' },
            thinking: '',
            text: '',
            steps: [],
            prototypeLive: live,
          },
        },
      });
      await act(async () => {
        root.render(
          <PreferencesProvider>
            <PrototypeStudioView />
          </PreferencesProvider>,
        );
      });
      await settle();
      const stage = host.querySelector('[data-testid="prototype-canvas-stage"]')!;
      expect(stage).not.toBeNull();
      // press everything the pending stage offers (except leaving it), and try the artboard
      for (const button of Array.from(stage.querySelectorAll<HTMLButtonElement>('button'))) {
        if (button.getAttribute('data-testid') === 'prototype-live-back-to-brief-btn' || button.disabled) continue;
        await act(async () => button.click());
      }
      await act(async () => {
        host.querySelector('[data-testid="prototype-artboard-SCR-HOME"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });
      await settle();
      expect(calls.filter((c) => c.includes(PENDING_LIVE_PROTOTYPE_ID))).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
