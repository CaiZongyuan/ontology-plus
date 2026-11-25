import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The reference app follows the public contract; its tests check that against the platform's validator.
import { createConnectionClient, parseConnectionManifest } from '../../../src/packages/application-runtime/index.js';
import type { Revision } from '../domain/index.js';
import { openTeacoRepository } from '../app/db.js';
import { createTeacoRuntimeApp } from '../app/runtime.js';
import { seedIfEmpty } from '../app/seed.js';

const seedDir = fileURLToPath(new URL('../../../benchmark/datasets/bb-seed0/', import.meta.url));

async function teaco(revision: Revision = 'v1') {
  const repository = openTeacoRepository(':memory:');
  await seedIfEmpty(repository, seedDir, '2026-09-10T08:00:00.000Z');
  const app = createTeacoRuntimeApp({ repository, revision, now: () => new Date('2026-09-10T09:00:00Z') });
  const client = createConnectionClient({ baseUrl: 'http://teaco.local', fetch: async (input, init) => app.request(input, init) });
  return { app, client };
}

describe('TeaCo serves connection contract v1', () => {
  it('publishes a valid manifest whose identities come from the data', async () => {
    const { client } = await teaco();
    const m = await client.readManifest();
    expect(m.application.version).toBe('v1');
    expect(m.actors.map((a) => a.id)).toEqual(['owner', 'priya', 'jonah', 'carlos', 'finance']);
    expect(m.actors.find((a) => a.id === 'jonah')!.scope.zh).toBe('自己负责的 14 家批发客户');
    expect(m.objects.map((o) => o.id)).toEqual(['orders', 'products', 'customers']);
    expect(m.reports).toEqual([]);
  });

  it('adds the monthly report from requirement v2 and its discount column from v3', async () => {
    const v2 = await teaco('v2');
    expect((await v2.client.readManifest()).reports.map((r) => r.id)).toEqual(['monthly_sales']);
    const march = (await v2.client.report('monthly_sales', 'owner')).rows.filter((r) => r.month === '2026-03');
    expect(march.map((r) => [r.orders, r.total])).toEqual([[5, 57863], [5, 475380]]);
    const v3 = await teaco('v3');
    expect((await v3.client.report('monthly_sales', 'owner')).columns.map((c) => c.key)).toContain('discount');
    await expect((await teaco('v1')).client.report('monthly_sales', 'owner')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('scopes every read to the acting identity (BB 6, 8, 9, 26)', async () => {
    const { client } = await teaco();
    const value = async (actor: string, id: string) => (await client.metrics(actor)).values.find((v) => v.id === id)!.value;
    expect([await value('owner', 'open_orders'), await value('owner', 'shipped_sales'), await value('owner', 'shipped_tax'), await value('owner', 'average_shipped_order')]).toEqual([34, 2433827, 77187, 36876]);
    expect(await value('jonah', 'open_orders')).toBe(3);
    expect((await client.listObjects('orders', 'jonah', { filter: 'all' })).total).toBe(16);
    expect((await client.listObjects('customers', 'jonah', { filter: 'all' })).total).toBe(14);
    await expect(client.getObject('orders', '1008', 'jonah')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await client.getObject('orders', '1008', 'owner')).values.customer).toBe('Evergreen Health Foods');
  });

  it('refuses an identity it does not know', async () => {
    const { client } = await teaco();
    await expect(client.metrics('mallory')).rejects.toMatchObject({ code: 'REJECTED', status: 400 });
  });

  it('lists orders with per-filter counts and explains how a total adds up', async () => {
    const { client } = await teaco();
    const open = await client.listObjects('orders', 'owner');
    expect(open.total).toBe(34);
    expect(Object.fromEntries(open.counts.map((c) => [c.filter, c.count]))).toMatchObject({ open: 34, new: 16, paid: 12, packed: 6, shipped: 14, delivered: 52, cancelled: 10, all: 110 });
    const detail = await client.getObject('orders', '1006', 'owner');
    expect(detail.sections[0]!.rows).toHaveLength(3);
    expect(detail.sections[1]!.rows.at(-1)).toMatchObject({ amount: 142620 });
    expect(detail.notes[0]!.zh).toContain('导入的历史订单');
  });

  it('shows the locked negative stock and the data issue that needs a decision (BB 18)', async () => {
    const { client } = await teaco();
    const attention = await client.listObjects('products', 'owner', { filter: 'attention' });
    expect(attention.rows[0]).toMatchObject({ key: 'HRB-PEPMNT-2OZ', values: { stock: 0 } });
    const issues = await client.dataIssues('owner');
    expect(issues.issues.filter((i) => i.needsDecision).map((i) => i.id)).toEqual(['negative-stock-HRB-PEPMNT-2OZ']);
    expect((await client.activity('owner')).events[0]!.text.zh).toContain('142 位客户');
  });

  it('keeps the manifest valid in every revision', async () => {
    for (const r of ['v1', 'v2', 'v3', 'v4'] as const) {
      const { app } = await teaco(r);
      const res = await app.request('/.well-known/ontology-plus.json');
      expect(parseConnectionManifest(await res.json()).ok).toBe(true);
    }
  });
});
