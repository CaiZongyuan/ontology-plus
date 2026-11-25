import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openTeacoRepository } from '../../examples/teaco/app/db.js';
import { createTeacoRuntimeApp } from '../../examples/teaco/app/runtime.js';
import { seedIfEmpty } from '../../examples/teaco/app/seed.js';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

/**
 * Events from TeaCo's outbox start work in Ontology Plus (spec §10.3, U-14, T8-001/002): a new
 * shortage becomes one investigation checked against the latest data, a repeat changes nothing,
 * and the event never changes TeaCo by itself.
 */
const seedDir = fileURLToPath(new URL('../../benchmark/datasets/bb-seed0/', import.meta.url));

async function setup() {
  const repository = openTeacoRepository(':memory:');
  await seedIfEmpty(repository, seedDir, '2026-09-10T08:00:00.000Z');
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  const api = createApiApp(store, {
    connectedAppFetch: async (input, init) => {
      const url = new URL(input);
      return createTeacoRuntimeApp({ repository, revision: 'v1' }).request(url.pathname + url.search, init);
    },
  });
  const projectId = store.listProjects()[0]!.id;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await api.request(path, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const base = `/api/projects/${projectId}`;
  await call('POST', `${base}/connected-app`, { baseUrl: 'teaco.local' });
  const run = async (actionId: string, target: string | undefined, params: Record<string, unknown>) => {
    const inv = (await call('POST', `${base}/console/actions/${actionId}/prepare`, { actor: 'owner', target, params })).body.invocation;
    return (await call('POST', `${base}/console/invocations/${inv.id}/approve`)).body.invocation;
  };
  const amanda = (await call('GET', `${base}/console/objects/customers?filter=retail&limit=200`)).body.data.rows.find((r: any) => r.values.name === 'Amanda Bennett').key;
  const tasks = async () => (await call('GET', `${base}/console/tasks`)).body;
  return { store, projectId, call, base, run, amanda, tasks };
}

describe('events from the connected application', () => {
  it('turns a new shortage into one investigation with what is short now and what could be done (T8-001)', async () => {
    const t = await setup();
    const before = await t.tasks();
    expect(before.tasks).toEqual([]);
    expect(before.received).toBe(0);
    const created = await t.run('create_order', undefined, { customer: t.amanda, lines: [{ sku: 'WHT-SILVER-1LB', qty: 5 }] });
    expect(created.status).toBe('VERIFIED');
    const after = await t.tasks();
    expect(after.received).toBe(2);
    expect(after.tasks).toHaveLength(1);
    const task = after.tasks[0];
    expect(task).toMatchObject({ kind: 'STOCK_SHORTAGE', subject: '1111', status: 'OPEN', title: { zh: '订单 1111 缺货，发不了' } });
    expect(task.findings.map((f: any) => f.zh)).toEqual(['Silver Needle（1 lb bag）：这张订单要 5，现在库存 3；所有没发货的订单一共要 5']);
    expect(task.suggestions).toEqual([{ actionId: 'adjust_stock', target: 'WHT-SILVER-1LB', params: { quantity: 5 }, label: { zh: '把Silver Needle（1 lb bag）的库存调到 5', en: 'Set Silver Needle (1 lb bag) stock to 5' } }]);
    // The event changed nothing in TeaCo by itself.
    expect((await t.call('GET', `${t.base}/console/objects/products/WHT-SILVER-1LB`)).body.data.values.stock).toBe(3);

    const s = task.suggestions[0];
    const inv = (await t.call('POST', `${t.base}/console/actions/${s.actionId}/prepare`, { actor: 'owner', target: s.target, params: s.params })).body.invocation;
    const settled = await t.call('POST', `${t.base}/console/tasks/${task.id}/settle`, { handedOver: inv.id });
    expect(settled.body.task).toMatchObject({ status: 'HANDED_OVER', invocationIds: [inv.id] });
    expect((await t.call('POST', `${t.base}/console/tasks/${task.id}/settle`, { dismiss: true })).status).toBe(409);
  });

  it('receives a re-delivered event once and starts no second task (T8-002)', async () => {
    const t = await setup();
    await t.run('create_order', undefined, { customer: t.amanda, lines: [{ sku: 'WHT-SILVER-1LB', qty: 5 }] });
    expect((await t.tasks()).tasks).toHaveLength(1);
    // Read the whole outbox again from the start, as a dispatcher retry would deliver it.
    t.store.saveConnectedApp({ ...t.store.getConnectedApp(t.projectId)!, eventCursor: '0' });
    const again = await t.tasks();
    expect(again.received).toBe(0);
    expect(again.duplicates).toBeGreaterThan(0);
    expect(again.tasks).toHaveLength(1);
  });

  it('closes a late notice whose shortage was already fixed, instead of suggesting a refill', async () => {
    const t = await setup();
    await t.tasks();
    await t.run('create_order', undefined, { customer: t.amanda, lines: [{ sku: 'WHT-SILVER-1LB', qty: 5 }] });
    await t.run('adjust_stock', 'WHT-SILVER-1LB', { quantity: 10 });
    const tasks = (await t.tasks()).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'NO_LONGER_NEEDED', suggestions: [] });
  });
});
