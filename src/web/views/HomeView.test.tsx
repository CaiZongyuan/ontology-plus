import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../../packages/business-vocabulary/index.js';
import { createWorkspaceStore } from '../../packages/workspace-store/index.js';
import { createApiApp } from '../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload } from '../api.js';
import { PreferencesProvider } from '../i18n.js';
import { OverviewSessionsView } from './application-center/OverviewSessionsView.js';

const initialStoreSnapshot = { ...useWorkbenchStore.getInitialState() };

afterEach(() => {
  vi.unstubAllGlobals();
  useWorkbenchStore.setState({
    data: initialStoreSnapshot.data,
    loading: initialStoreSnapshot.loading,
    activeNav: initialStoreSnapshot.activeNav,
    activeItemId: initialStoreSnapshot.activeItemId,
    activeSessionId: initialStoreSnapshot.activeSessionId,
    liveSessionDrafts: {},
    sessionQueues: {},
  });
  Object.assign(useWorkbenchStore.getInitialState(), initialStoreSnapshot);
});

function stubLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: () => undefined,
    removeItem: () => undefined,
  });
}

async function seedFromServer(options: { seedProjects?: boolean } = {}) {
  const store = createWorkspaceStore({
    dbPath: ':memory:',
    enableFileMirror: false,
    ...(options.seedProjects !== undefined ? { seedProjects: options.seedProjects } : {}),
  });
  const app = createApiApp(store);
  const res = await app.request('/api/bootstrap');
  const data = (await res.json()) as BootstrapPayload;
  useWorkbenchStore.setState({
    data,
    loading: false,
    activeNav: 'overview',
    activeItemId: null,
    activeSessionId: null,
  });
  Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
  return { store, app, data };
}

describe('HomeView / OverviewSessionsView (#61)', () => {
  it('renders first-time empty workspace with composer and 3 clickable examples, passing checkBusinessViewMarkup in zh-CN and en-US', async () => {
    const { store } = await seedFromServer({ seedProjects: false });

    stubLocale('zh-CN');
    const zhHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <OverviewSessionsView onNavigate={() => undefined} />
      </PreferencesProvider>,
    );

    expect(zhHtml).toContain('data-testid="home-view"');
    expect(zhHtml).toContain('data-testid="home-description-input"');
    expect(zhHtml).toContain('data-testid="home-create-submit-btn"');
    expect(zhHtml).toContain('描述你想做的系统');
    expect(zhHtml).toContain('data-testid="home-example-0"');
    expect(zhHtml).toContain('data-testid="home-example-1"');
    expect(zhHtml).toContain('data-testid="home-example-2"');
    expect(zhHtml).not.toContain('data-testid="home-project-list"');

    const zhViolations = checkBusinessViewMarkup(zhHtml);
    expect(zhViolations, formatBusinessViewViolations(zhViolations)).toEqual([]);

    stubLocale('en-US');
    const enHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <OverviewSessionsView onNavigate={() => undefined} />
      </PreferencesProvider>,
    );

    expect(enHtml).toContain('Describe the system you want to build');
    expect(enHtml).toContain('data-testid="home-example-0"');
    expect(enHtml).toContain('data-testid="home-example-1"');
    expect(enHtml).toContain('data-testid="home-example-2"');
    expect(enHtml).not.toContain('data-testid="home-project-list"');

    const enViolations = checkBusinessViewMarkup(enHtml);
    expect(enViolations, formatBusinessViewViolations(enViolations)).toEqual([]);

    store.close();
  });

  it('renders populated workspace project list with each project step & status, hides starter examples, and passes checkBusinessViewMarkup in zh-CN and en-US', async () => {
    const { store, app } = await seedFromServer({ seedProjects: true });

    // Also add a project whose raw description contains legacy technical terms to verify Home never leaks jargon
    store.createProject({
      name: '仓储盘点管理',
      code: 'WMS-CHECK',
      domain: '仓储盘点',
      description: 'Legacy DDL & YAML note for M1',
      template: 'EMPTY',
    });
    const refreshed = (await (await app.request('/api/bootstrap')).json()) as BootstrapPayload;
    useWorkbenchStore.setState({ data: refreshed });
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

    stubLocale('zh-CN');
    const zhHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <OverviewSessionsView onNavigate={() => undefined} />
      </PreferencesProvider>,
    );

    expect(zhHtml).toContain('data-testid="home-view"');
    expect(zhHtml).toContain('data-testid="home-project-list"');
    expect(zhHtml).not.toContain('data-testid="home-example-0"');
    expect(zhHtml).toContain('合同全生命周期管理系统');
    expect(zhHtml).toContain('交付 · 进行中');
    expect(zhHtml).toContain('业务模型 · 进行中');
    expect(zhHtml).toContain('需求 · 未开始');
    expect(zhHtml).not.toContain('本体工程');

    const zhViolations = checkBusinessViewMarkup(zhHtml);
    expect(zhViolations, formatBusinessViewViolations(zhViolations)).toEqual([]);

    stubLocale('en-US');
    const enHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <OverviewSessionsView onNavigate={() => undefined} />
      </PreferencesProvider>,
    );

    expect(enHtml).toContain('data-testid="home-project-list"');
    expect(enHtml).not.toContain('data-testid="home-example-0"');
    expect(enHtml).toContain('Delivery · In progress');
    expect(enHtml).toContain('Business Model · In progress');
    expect(enHtml).toContain('Requirements · Not started');
    expect(enHtml).not.toContain('Ontology Project');

    const enViolations = checkBusinessViewMarkup(enHtml);
    expect(enViolations, formatBusinessViewViolations(enViolations)).toEqual([]);

    store.close();
  });

  it('creates a project from a single sentence, enters REQUIREMENTS, and sends the description as the first user message', async () => {
    const { store, app } = await seedFromServer({ seedProjects: false });
    store.updateSystemSettings({ mockLlmMode: true });

    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.pathname + input.search
            : input.url;
      const resolved = url.startsWith('http') ? url : `http://localhost${url}`;
      return app.request(resolved, init);
    });

    const sentence =
      '管理供应商准入：供应商在线提交资质，采购和质量部门分别审核，每年做一次评估，不合格的暂停合作。';
    const storeState = useWorkbenchStore.getState() as unknown as {
      createProjectFromDescription: (description: string) => Promise<{
        project: { id: string; name: string };
        session: { id: string };
        runPromise: Promise<void>;
      }>;
    };

    const result = await storeState.createProjectFromDescription(sentence);
    await result.runPromise;

    const after = useWorkbenchStore.getState();
    expect(after.activeNav).toBe('app-req-explore');
    expect(after.data?.activeProject.id).toBe(result.project.id);
    expect(after.data?.activeProject.name).toBe('管理供应商准入');
    expect(after.activeSessionId).toBe(result.session.id);

    const persistedSession = store.getAgentSession(result.session.id);
    expect(persistedSession?.agentKind).toBe('REQUIREMENT');
    expect(persistedSession?.messages[0]?.role).toBe('user');
    expect(persistedSession?.messages[0]?.content).toBe(sentence);
    expect(persistedSession?.messages.some((m) => m.role === 'assistant')).toBe(true);

    // Returning to Home sees the project at REQUIREMENTS · IN_PROGRESS
    const updatedSummary = after.data?.projects.find((p) => p.id === result.project.id);
    expect(updatedSummary?.currentStep).toBe('REQUIREMENTS');
    expect(updatedSummary?.currentStepState).toBe('IN_PROGRESS');

    store.close();
  });
});
