import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { serve, type ServerType } from '@hono/node-server';
import { afterEach, describe, expect, it } from 'vitest';
import { openTeacoRepository } from '../../examples/teaco/app/db.js';
import { createTeacoRuntimeApp } from '../../examples/teaco/app/runtime.js';
import { seedIfEmpty } from '../../examples/teaco/app/seed.js';
import type { Revision } from '../../examples/teaco/domain/index.js';
import { collectUnifiedAgentTurn } from '../packages/agent-runtime/index.js';
import { approveInvocation } from '../packages/runtime-gateway/index.js';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

/**
 * The AI Assistant in the Operations Console (TeaCo spec §19.4 M3): it reads the connected
 * application as the identity the person chose, answers with its basis, and can only prepare a
 * change for approval. TeaCo runs on a real loopback port, as a developed application would.
 */
const seedDir = fileURLToPath(new URL('../../benchmark/datasets/bb-seed0/', import.meta.url));
const servers: ServerType[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

async function setup() {
  const repository = openTeacoRepository(':memory:');
  await seedIfEmpty(repository, seedDir, '2026-09-10T08:00:00.000Z');
  const teaco = { revision: 'v2' as Revision };
  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: (req) => createTeacoRuntimeApp({ repository, revision: teaco.revision }).fetch(req), port: 0, hostname: '127.0.0.1' }, () => resolve(s));
  });
  servers.push(server);
  const address = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  const api = createApiApp(store);
  const projectId = store.listProjects()[0]!.id;
  const post = (path: string, body: unknown) =>
    Promise.resolve(api.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
  expect((await post(`/api/projects/${projectId}/connected-app`, { baseUrl: address })).status).toBe(201);
  const session = store.createAgentSession({ projectId, agentKind: 'REASONING', targetId: 'operations-console', title: '经营驾驶舱对话' });
  const ask = async (prompt: string) => {
    const turn = await collectUnifiedAgentTurn(store, { sessionId: session.id, prompt, mockMode: true });
    return turn.session.messages.at(-1)!;
  };
  const stock = async (sku: string) => {
    const res = await fetch(`http://${address}/runtime/objects/products/${sku}`, { headers: { 'X-Ontology-Plus-Actor': 'owner' } });
    return ((await res.json()) as { values: { stock: number } }).values.stock;
  };
  return { store, api, post, projectId, session, ask, stock, teaco };
}

describe('the Operations Console assistant', () => {
  it('answers with figures read from the application and says where they came from', async () => {
    const t = await setup();
    const reply = await t.ask('今天经营情况怎么样？');
    expect(reply.toolCalls?.map((c) => c.toolName)).toEqual(['read_operations_overview']);
    expect(reply.content).toContain('没发货的订单 34');
    expect(reply.content).toContain('$24,338.27');
    expect(reply.content).toContain('需要你决定');
    expect(reply.content).toContain('依据：TeaCo 茶叶订单系统（v2），以 店主（全店）的身份读取');
    const report = await t.ask('看一下月度销售报表');
    expect(report.toolCalls?.map((c) => c.toolName)).toEqual(['read_business_report']);
    expect(report.content).toContain('口径：');
    const english = await t.ask('Which orders are not shipped yet?');
    expect(english.toolCalls?.[0]).toMatchObject({ toolName: 'list_business_records', arguments: { objectId: 'orders', filter: 'open' } });
    expect(english.content).toContain('Orders "Not shipped": 34 in total');
  }, 30000);

  it('acts only as the identity chosen in the console, whatever the model asks for', async () => {
    const t = await setup();
    expect((await t.post(`/api/projects/${t.projectId}/connected-app/acting-identity`, { actor: 'jonah' })).status).toBe(200);
    const reply = await t.ask('还有多少订单没发货？');
    expect(reply.content).toContain('以 Jonah');
    expect(reply.content).toContain('订单「没发货」共 3 条');
    expect((await t.post(`/api/projects/${t.projectId}/connected-app/acting-identity`, { actor: 'someone' })).status).toBe(400);
    // The tool schema has no identity argument, and an extra one is ignored.
    const record = await t.ask('看看订单 1008');
    expect(record.content).toContain('不在当前身份能看的范围内');
  }, 30000);

  it('prepares a change as an approval card and changes nothing until a person approves it', async () => {
    const t = await setup();
    const reply = await t.ask('帮我把订单 1106 发货');
    expect(reply.toolCalls?.map((c) => c.toolName)).toEqual(['propose_business_change']);
    const card = reply.artifacts?.find((a) => a.kind === 'RUNTIME_APPROVAL');
    expect(card).toMatchObject({ kind: 'RUNTIME_APPROVAL', summary: { zh: '发货：订单 1106' } });
    expect(reply.content).toContain('等你批准后才会执行');
    expect(await t.stock('BLK-EARLGR-2OZ')).toBe(28);
    const inv = t.store.getActionInvocation((card as { invocationId: string }).invocationId)!;
    expect(inv).toMatchObject({ status: 'PENDING_APPROVAL', requestedBy: 'assistant', actor: 'owner' });
    const approved = await approveInvocation({ store: t.store }, t.projectId, inv.id);
    expect(approved.ok && approved.value.status).toBe('VERIFIED');
    expect(await t.stock('BLK-EARLGR-2OZ')).toBe(22);
  }, 30000);

  it('passes the application’s refusal through, and asks for what it still needs', async () => {
    const t = await setup();
    await t.post(`/api/projects/${t.projectId}/connected-app/acting-identity`, { actor: 'finance' });
    const refused = await t.ask('把订单 1104 取消订单');
    expect(refused.content).toContain('财务是只读身份');
    expect(refused.artifacts ?? []).toEqual([]);
    await t.post(`/api/projects/${t.projectId}/connected-app/acting-identity`, { actor: 'owner' });
    const needs = await t.ask('按盘点修正库存 HRB-PEPMNT-2OZ');
    expect(needs.content).toContain('还需要');
    const prepared = await t.ask('按盘点修正库存 HRB-PEPMNT-2OZ 改为 20');
    expect(prepared.artifacts?.[0]).toMatchObject({ kind: 'RUNTIME_APPROVAL' });
    expect(await t.stock('HRB-PEPMNT-2OZ')).toBe(0);
  }, 30000);

  it('stops reading when the application changed since it was connected', async () => {
    const t = await setup();
    t.teaco.revision = 'v3';
    const reply = await t.ask('今天经营情况怎么样？');
    expect(reply.content).toContain('重新核对');
    expect(reply.content).not.toContain('$');
    expect(t.store.getConnectedApp(t.projectId)!.status).toBe('DRIFTED');
  }, 30000);
});
