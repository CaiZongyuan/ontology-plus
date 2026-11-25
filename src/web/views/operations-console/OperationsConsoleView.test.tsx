import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTeacoRepository } from '../../../../examples/teaco/app/db.js';
import { createTeacoRuntimeApp } from '../../../../examples/teaco/app/runtime.js';
import { seedIfEmpty } from '../../../../examples/teaco/app/seed.js';
import type { Revision } from '../../../../examples/teaco/domain/index.js';
import { createConnectionClient, type ConnectionManifest } from '../../../packages/application-runtime/index.js';
import { checkBusinessViewMarkup, formatBusinessViewViolations } from '../../../packages/business-vocabulary/index.js';
import { createWorkspaceStore } from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload } from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import { OverviewSessionsView } from '../application-center/OverviewSessionsView.js';
import { ConsoleRequestError } from './consoleApi.js';
import {
  ConnectAppPanel,
  ConsoleConnectionPage,
  ConsoleDataIssuesPage,
  ConsoleObjectPage,
  ConsoleOverviewPage,
  ConsoleReportPage,
  ConsoleRulesPage,
  OperationsConsoleView,
  formatConsoleValue,
} from './OperationsConsoleView.js';

const seedDir = fileURLToPath(new URL('../../../../benchmark/datasets/bb-seed0/', import.meta.url));
const initialStoreSnapshot = { ...useWorkbenchStore.getInitialState() };

afterEach(() => {
  vi.unstubAllGlobals();
  useWorkbenchStore.setState({ data: initialStoreSnapshot.data, loading: initialStoreSnapshot.loading, activeNav: initialStoreSnapshot.activeNav });
  Object.assign(useWorkbenchStore.getInitialState(), initialStoreSnapshot);
});

function stubLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'onto_locale' ? locale : null), setItem: () => undefined, removeItem: () => undefined });
}

async function teaco(revision: Revision = 'v1') {
  const repository = openTeacoRepository(':memory:');
  await seedIfEmpty(repository, seedDir, '2026-09-10T08:00:00.000Z');
  const app = createTeacoRuntimeApp({ repository, revision, now: () => new Date('2026-09-10T09:00:00Z') });
  const fetch = async (input: string, init?: RequestInit) => app.request(new URL(input).pathname + new URL(input).search, init);
  return { fetch, client: createConnectionClient({ baseUrl: 'http://teaco.local', fetch }) };
}

const render = (node: React.ReactElement) => renderToStaticMarkup(<PreferencesProvider>{node}</PreferencesProvider>);
function expectBusinessView(html: string) {
  const violations = checkBusinessViewMarkup(html);
  expect(violations, formatBusinessViewViolations(violations)).toEqual([]);
}

describe('Operations Console (TeaCo spec v0.3.1 §11.1)', () => {
  it('formats values as the manifest types them', () => {
    const t = (zh: string) => zh;
    expect(formatConsoleValue(2433827, 'money', t, 'USD')).toBe('$24,338.27');
    expect(formatConsoleValue(34, 'count', t, 'USD')).toBe('34');
    expect(formatConsoleValue({ zh: '已付款', en: 'Paid' }, 'status', t, 'USD')).toBe('已付款');
    expect(formatConsoleValue(null, 'money', t, 'USD')).toBe('—');
  });

  it('opens on a one-sentence overview with live figures and what needs the owner, in both languages', async () => {
    const { client } = await teaco();
    const manifest = await client.readManifest();
    const overview = { metrics: await client.metrics('owner'), dataIssues: await client.dataIssues('owner'), activity: await client.activity('owner') };
    stubLocale('zh-CN');
    const zh = render(<ConsoleOverviewPage manifest={manifest} actorId="owner" overview={overview} />);
    expect(zh).toContain('还有 34 张订单没发货；有 1 件事等你确认。');
    expect(zh).toContain('店主 · 全店');
    expect(zh).toContain('$24,338.27');
    expect(zh).toContain('$771.87');
    expect(zh).toContain('$368.76');
    expect(zh).toContain('data-testid="console-decision-negative-stock-HRB-PEPMNT-2OZ"');
    expectBusinessView(zh);
    stubLocale('en-US');
    const en = render(<ConsoleOverviewPage manifest={manifest} actorId="owner" overview={overview} />);
    expect(en).toContain('34 orders have not shipped. 1 thing needs you.');
    expectBusinessView(en);
  });

  it('shows an account manager only their own scope', async () => {
    const { client } = await teaco();
    const manifest = await client.readManifest();
    stubLocale('zh-CN');
    const html = render(
      <ConsoleOverviewPage manifest={manifest} actorId="jonah" overview={{ metrics: await client.metrics('jonah'), dataIssues: null, activity: null }} />,
    );
    expect(html).toContain('Jonah Whitaker · 自己负责的 14 家批发客户');
    expect(html).toContain('还有 3 张订单没发货');
  });

  it('lists a business object with filter counts, and explains a record', async () => {
    const { client } = await teaco();
    const manifest = await client.readManifest();
    const orders = manifest.objects.find((o) => o.id === 'orders')!;
    stubLocale('zh-CN');
    const html = render(
      <ConsoleObjectPage
        manifest={manifest}
        object={orders}
        filter="open"
        list={await client.listObjects('orders', 'owner', { filter: 'open' })}
        selectedKey="1104"
        detail={await client.getObject('orders', '1104', 'owner')}
        detailState="ready"
      />,
    );
    expect(html).toContain('34 条');
    expect(html).toMatch(/没发货<strong>34<\/strong>/);
    expect(html).toContain('Ridgeview Senior Living');
    expect(html).toContain('金额怎么算出来的');
    expect(html).toContain('$370.28');
    expectBusinessView(html);
    const missing = render(<ConsoleObjectPage manifest={manifest} object={orders} filter="open" list={null} selectedKey="1008" detail={null} detailState="missing" />);
    expect(missing).toContain('不在当前身份能看的范围内');
  });

  it('shows reports, the data check and the confirmed rules', async () => {
    const { client } = await teaco('v2');
    const manifest = await client.readManifest();
    stubLocale('zh-CN');
    const report = render(<ConsoleReportPage manifest={manifest} reportId="monthly_sales" report={await client.report('monthly_sales', 'owner')} />);
    expect(report).toContain('月度销售报表');
    expect(report).toContain('$4,753.80');
    expect(report).toContain('按下单日期算月份');
    expectBusinessView(report);
    const issues = render(<ConsoleDataIssuesPage issues={await client.dataIssues('owner')} />);
    expect(issues).toContain('还有 1 类等你确认');
    expect(issues).toContain('客户去重：150 行 → 142 位客户');
    expectBusinessView(issues);
    expect(render(<ConsoleRulesPage suite={null} />)).toContain('业务模型还没有确认');
  });

  it('describes the connection, its hints and a drifted state', async () => {
    const { client } = await teaco();
    const manifest: ConnectionManifest = await client.readManifest();
    const record = {
      projectId: 'p', baseUrl: 'http://127.0.0.1:4320', status: 'DRIFTED' as const, driftReason: 'MANIFEST_CHANGED' as const,
      manifest: manifest as unknown as Record<string, unknown>, manifestFingerprint: 'sha256:abc', modelHash: null,
      hints: [{ code: 'OBJECT_NOT_IN_MODEL', objectId: 'orders', message: { zh: '「订单」对应的「Order」在已确认的业务模型里找不到。', en: 'x' } }],
      connectedAt: '2026-11-25T09:00:00.000Z', checkedAt: '2026-11-25T09:05:00.000Z',
    };
    stubLocale('zh-CN');
    const html = render(<ConsoleConnectionPage record={record} manifest={manifest} />);
    expect(html).toContain('应用有变化，等你重新核对');
    expect(html).toContain('已漂移');
    expect(html).toContain('「订单」对应的「Order」在已确认的业务模型里找不到。');
    expect(html).toContain('自己负责的 13 家批发客户');
    expectBusinessView(html);
  });

  it('asks for an address when nothing is connected and explains failures', () => {
    stubLocale('zh-CN');
    const html = render(<ConnectAppPanel projectName="茶叶订单" error={new ConsoleRequestError('UNREACHABLE', 'cannot reach', 502)} />);
    expect(html).toContain('接入「茶叶订单」开发好的应用');
    expect(html).toContain('不需要账号密码');
    expect(html).toContain('连不上这个地址');
    expectBusinessView(html);
  });

  it('is entered from the project list once connected, and offers connecting otherwise', async () => {
    const { fetch } = await teaco();
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const api = createApiApp(store, { connectedAppFetch: fetch });
    const projectId = store.listProjects()[0]!.id;
    await api.request(`/api/projects/${projectId}/connected-app`, { method: 'POST', body: JSON.stringify({ baseUrl: 'teaco.local' }), headers: { 'content-type': 'application/json' } });
    const data = (await (await api.request(`/api/bootstrap?projectId=${projectId}`)).json()) as BootstrapPayload;
    useWorkbenchStore.setState({ data, loading: false, activeNav: 'overview' });
    // Server rendering reads zustand's initial snapshot.
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
    stubLocale('zh-CN');
    const home = render(<OverviewSessionsView onNavigate={() => undefined} />);
    expect(home).toContain(`data-testid="home-open-console-${projectId}"`);
    expect(home).toContain('经营驾驶舱');
    expectBusinessView(home);
    const consoleHtml = render(<OperationsConsoleView onNavigate={() => undefined} />);
    expect(consoleHtml).toContain('data-testid="operations-console"');
    expect(consoleHtml).toContain('TeaCo 茶叶订单系统');
    expect(consoleHtml).toContain('data-testid="console-actor-select"');
    expect(consoleHtml).toContain('data-testid="console-nav-object-orders"');
    useWorkbenchStore.setState({ data: { ...data, connectedApps: [] } });
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
    expect(render(<OperationsConsoleView onNavigate={() => undefined} />)).toContain('data-testid="console-connect-panel"');
  });
});
