// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initPrototypeShell, upsertPrototypeScreen } from '../../../packages/agent-runtime/index.js';
import {
  applyPrototypeLiveEvent,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
} from '../../../packages/ontology-core/index.js';
import {
  createWorkspaceStore,
  type InteractivePrototype,
} from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload, type SessionLiveDraft } from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import { PrototypeStudioView } from './PrototypeStudioView.js';

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
});
