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
import { ConsoleRequestError } from '../../components/runtime/consoleApi.js';
import { hhmm } from '../../components/runtime/RuntimeApprovals.js';
import { readFileSync } from 'node:fs';
import { ProposalPanel } from './ConsoleChanges.js';
import { prepareInvocation, approveInvocation, declineInvocation } from '../../../packages/runtime-gateway/index.js';
import {
  ConnectAppPanel,
  ConsoleConnectionPage,
  ConsoleDataIssuesPage,
  ConsoleObjectPage,
  ConsoleOverviewPage,
  ConsoleReportPage,
  ConsoleRulesPage,
  OperationsConsoleView,
  cardsToShow,
  formatConsoleValue,
  type ConsoleApprovals,
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

  it('asks for approval in business words, offers record actions, and keeps settled ones out of the way (spec §10.1)', async () => {
    const { fetch, client } = await teaco();
    const manifest = await client.readManifest();
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const api = createApiApp(store, { connectedAppFetch: fetch });
    const projectId = store.listProjects()[0]!.id;
    await api.request(`/api/projects/${projectId}/connected-app`, { method: 'POST', body: JSON.stringify({ baseUrl: 'teaco.local' }), headers: { 'content-type': 'application/json' } });
    const deps = { store, fetch, now: () => new Date('2026-09-10T09:00:00Z') };
    const prep = async (actionId: string, target: string, params = {}) => {
      const r = await prepareInvocation(deps, projectId, { actionId, target, params, actor: 'owner', requestedBy: 'user' });
      if (!r.ok) throw new Error(r.code);
      return r.value;
    };
    const repair = await prep('repair_stock', 'HRB-PEPMNT-2OZ', { quantity: 20 });
    const declined = await prep('cancel_order', '1105');
    declineInvocation(deps, projectId, declined.id);
    const shipped = await prep('ship_order', '1106');
    await approveInvocation(deps, projectId, shipped.id);
    const invocations = store.listActionInvocations(projectId);
    const { cards, settled } = cardsToShow(invocations);
    expect(cards.map((i) => i.id)).toEqual([repair.id]);
    expect(settled.map((i) => i.status).sort()).toEqual(['REJECTED', 'VERIFIED']);
    const approvals: ConsoleApprovals = {
      invocations, busyId: null, prepare: async () => null, approve: () => undefined, decline: () => undefined, reconcile: () => undefined, prepareAgain: () => undefined,
    };
    const overview = { metrics: await client.metrics('owner'), dataIssues: await client.dataIssues('owner'), activity: await client.activity('owner') };
    stubLocale('zh-CN');
    const zh = render(<ConsoleOverviewPage manifest={manifest} actorId="owner" overview={overview} approvals={approvals} />);
    // The pending repair replaces the data problem it fixes, so the owner is asked once.
    expect(zh).toContain('有 1 件事等你确认。');
    expect(zh).toContain(`data-testid="console-invocation-${repair.id}"`);
    expect(zh).not.toContain('data-testid="console-decision-negative-stock-HRB-PEPMNT-2OZ"');
    expect(zh).toContain('批准并执行');
    expect(zh).toContain('按盘点把Peppermint Leaf（2 oz tin）的库存改为 20 并解锁');
    expect(zh).toContain('库存 0 → 20，可以正常发货');
    expect(zh).toContain('为什么可以放心批准');
    expect(zh).toContain(`${hhmm('2026-09-10T09:10:00.000Z')} 前有效`);
    expect(zh).toContain(`data-testid="console-settled-${shipped.id}"`);
    expectBusinessView(zh);
    stubLocale('en-US');
    const en = render(<ConsoleOverviewPage manifest={manifest} actorId="owner" overview={overview} approvals={approvals} />);
    expect(en).toContain('Approve and run');
    expect(en).toContain('Why approving is safe');
    expectBusinessView(en);

    stubLocale('zh-CN');
    const orders = manifest.objects.find((o) => o.id === 'orders')!;
    const detail = await client.getObject('orders', '1104', 'owner');
    const page = render(
      <ConsoleObjectPage manifest={manifest} object={orders} filter="open" list={await client.listObjects('orders', 'owner', { filter: 'open' })} selectedKey="1104" detail={detail} detailState="ready" approvals={approvals} />,
    );
    expect(page).toContain('可以做的操作（执行前会请你批准）');
    for (const id of ['pack_order', 'ship_order', 'cancel_order']) expect(page).toContain(`data-testid="console-action-${id}"`);
    expectBusinessView(page);
    const finance = render(
      <ConsoleObjectPage manifest={manifest} object={orders} filter="open" list={await client.listObjects('orders', 'finance', { filter: 'open' })} selectedKey="1104" detail={await client.getObject('orders', '1104', 'finance')} detailState="ready" approvals={approvals} />,
    );
    expect(finance).not.toContain('data-testid="console-record-actions"');
  });

  it('shows a requirement change in business words: what changes, its checks and the figures that stay (spec §10.6)', async () => {
    const { fetch } = await teaco('v1');
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const api = createApiApp(store, { connectedAppFetch: fetch });
    const projectId = store.listProjects()[0]!.id;
    const post = (path: string, body?: unknown) =>
      Promise.resolve(api.request(path, { method: 'POST', ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) })).then((r) => r.json() as Promise<any>);
    await post(`/api/projects/${projectId}/connected-app`, { baseUrl: 'teaco.local' });
    const v4 = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../examples/teaco/changes/v4.json', import.meta.url)), 'utf8'));
    await post(`/api/projects/${projectId}/change-proposals`, v4);
    const proposal = (await post(`/api/projects/${projectId}/console/releases/v4/verify`)).proposal;
    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);
      const html = render(<ProposalPanel version="v4" current="v1" proposal={proposal} busy={null} onVerify={() => undefined} onRelease={() => undefined} />);
      if (locale === 'zh-CN') {
        expect(html).toContain('需求是怎么说的');
        expect(html).toContain('订单新增「挂起中」');
        expect(html).toContain('验收条件（4/4 通过）');
        expect(html).toContain('Jonah 不能解除挂起');
        expect(html).toContain('不变');
        expect(html).toContain('确认上线');
      } else {
        expect(html).toContain('Acceptance checks (4/4 pass)');
        expect(html).toContain('Put live');
      }
      expectBusinessView(html);
    }
    stubLocale('zh-CN');
    const stale = render(<ProposalPanel version="v4" current="v2" proposal={proposal} busy={null} onVerify={() => undefined} onRelease={() => undefined} />);
    expect(stale).toContain('上次是对照 v1 核对的，现在用的是 v2，请重新核对');
    expect(stale).not.toContain('确认上线');
  });
});
