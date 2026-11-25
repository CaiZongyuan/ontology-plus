import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createConnectionClient, parseConnectionManifest } from '../../../src/packages/application-runtime/index.js';
import type { Revision } from '../domain/index.js';
import { openTeacoRepository, type TeacoRepository } from '../app/db.js';
import { createTeacoRuntimeApp } from '../app/runtime.js';
import { seedIfEmpty } from '../app/seed.js';

const seedDir = fileURLToPath(new URL('../../../benchmark/datasets/bb-seed0/', import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function teaco(revision: Revision = 'v1', path = ':memory:') {
  const repository = openTeacoRepository(path);
  await seedIfEmpty(repository, seedDir, '2026-09-10T08:00:00.000Z');
  const app = createTeacoRuntimeApp({ repository, revision, now: () => new Date('2026-09-10T09:00:00Z') });
  const client = createConnectionClient({ baseUrl: 'http://teaco.local', fetch: async (input, init) => app.request(new URL(input).pathname + new URL(input).search, init) });
  let n = 0;
  /** Prepare, then invoke bound to the previewed version, as the gateway does after approval. */
  async function run(actor: string, actionId: string, target?: string, params?: Record<string, unknown>) {
    const prepared = await client.prepareAction(actionId, actor, { target, params });
    return client.invokeAction(actionId, actor, { target, params, idempotencyKey: `test-${++n}`, expectedVersion: prepared.preview.target.version });
  }
  const stock = async (sku: string) => (await client.getObject('products', sku, 'owner')).values.stock;
  const status = async (no: string) => ((await client.getObject('orders', no, 'owner')).values.status as { zh: string }).zh;
  return { repository, client, run, stock, status };
}

const refusal = (p: Promise<unknown>) => p.then(() => null, (e: { status?: number; appError?: { code: string } }) => ({ status: e.status, code: e.appError?.code }));

describe('TeaCo runtime actions (spec §6.2, §10.1, BB checklist)', () => {
  it('declares its actions per revision and offers them per record and identity', async () => {
    const v1 = await teaco('v1');
    const m1 = await v1.client.readManifest();
    expect(m1.actions.map((a) => a.id)).not.toContain('hold_order');
    expect((await teaco('v4')).client.readManifest().then((m) => m.actions.map((a) => a.id))).resolves.toContain('release_order');
    expect((await v1.client.getObject('orders', '1104', 'owner')).actions).toEqual(['pack_order', 'ship_order', 'cancel_order']);
    expect((await v1.client.getObject('orders', '1104', 'finance')).actions).toEqual([]);
    expect((await v1.client.getObject('products', 'HRB-PEPMNT-2OZ', 'owner')).actions).toEqual(['repair_stock']);
    expect((await v1.client.getObject('products', 'HRB-PEPMNT-2OZ', 'jonah')).actions).toEqual([]);
    for (const r of ['v1', 'v4'] as const) {
      const res = await (await teaco(r)).client.readManifest();
      expect(parseConnectionManifest(res).ok).toBe(true);
    }
  });

  it('prices a new retail order and takes stock only once, at shipping (BB 21, 23)', async () => {
    const t = await teaco();
    const amanda = (await t.client.listObjects('customers', 'owner', { filter: 'retail', limit: 200 })).rows.find((r) => r.values.name === 'Amanda Bennett')!.key;
    const preview = await t.client.prepareAction('create_order', 'owner', { params: { customer: amanda, lines: [{ sku: 'BLK-ASSAM-4OZ', qty: 2 }, { sku: 'OOL-TIEGUA-4OZ', qty: 1 }] } });
    expect(preview.preview.effects[0]!.zh).toContain('合计 $73.44');
    const created = await t.run('owner', 'create_order', undefined, { customer: amanda, lines: [{ sku: 'BLK-ASSAM-4OZ', qty: 2 }, { sku: 'OOL-TIEGUA-4OZ', qty: 1 }] });
    const no = created.receipt.after.key!;
    expect(no).toBe('1111');
    expect((await t.client.metrics('owner')).values.find((v) => v.id === 'open_orders')!.value).toBe(35);
    await t.run('owner', 'pay_order', no);
    await t.run('owner', 'pack_order', no);
    expect([await t.stock('BLK-ASSAM-4OZ'), await t.stock('OOL-TIEGUA-4OZ')]).toEqual([40, 15]);
    const shipped = await t.run('owner', 'ship_order', no);
    expect(shipped.receipt.after).toMatchObject({ key: no, state: 'SHIPPED' });
    expect([await t.stock('BLK-ASSAM-4OZ'), await t.stock('OOL-TIEGUA-4OZ')]).toEqual([38, 14]);
    await t.run('owner', 'deliver_order', no);
    expect(await refusal(t.run('owner', 'ship_order', no))).toEqual({ status: 422, code: 'INVALID_TRANSITION' });
    expect([await t.stock('BLK-ASSAM-4OZ'), await t.stock('OOL-TIEGUA-4OZ')]).toEqual([38, 14]);
  });

  it('refuses to ship what stock cannot cover, then ships after a restock (BB 24)', async () => {
    const t = await teaco();
    const amanda = (await t.client.listObjects('customers', 'owner', { filter: 'retail', limit: 200 })).rows.find((r) => r.values.name === 'Amanda Bennett')!.key;
    const no = (await t.run('owner', 'create_order', undefined, { customer: amanda, lines: [{ sku: 'WHT-SILVER-1LB', qty: 5 }] })).receipt.after.key!;
    expect((await t.client.getObject('orders', no, 'owner')).flags[0]!.label.zh).toBe('缺货');
    expect(await refusal(t.run('owner', 'ship_order', no))).toEqual({ status: 422, code: 'BACKORDERED' });
    expect(await t.stock('WHT-SILVER-1LB')).toBe(3);
    await t.run('owner', 'adjust_stock', 'WHT-SILVER-1LB', { quantity: 10 });
    await t.run('owner', 'ship_order', no);
    expect([await t.stock('WHT-SILVER-1LB'), await t.status(no)]).toEqual([5, '已发货']);
  });

  it('keeps the status flow (BB 25) and the identities’ limits (BB 5–7)', async () => {
    const t = await teaco();
    expect(await refusal(t.run('owner', 'cancel_order', '1001'))).toEqual({ status: 422, code: 'INVALID_TRANSITION' });
    expect(await refusal(t.run('owner', 'deliver_order', '1110'))).toEqual({ status: 422, code: 'INVALID_TRANSITION' });
    expect(await refusal(t.run('finance', 'cancel_order', '1104'))).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect(await refusal(t.run('jonah', 'cancel_order', '1008'))).toEqual({ status: 404, code: 'NOT_FOUND' });
    expect(await refusal(t.run('jonah', 'adjust_stock', 'WHT-SILVER-1LB', { quantity: 9 }))).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect(await t.status('1001')).toBe('已发货');
  });

  it('holds and releases under requirement v4 (BB 33–35)', async () => {
    const t = await teaco('v4');
    await t.run('jonah', 'hold_order', '1104');
    expect(await t.status('1104')).toBe('挂起中');
    expect(await refusal(t.run('jonah', 'release_order', '1104'))).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect(await refusal(t.run('jonah', 'cancel_order', '1104'))).toEqual({ status: 422, code: 'ON_HOLD' });
    await t.run('owner', 'release_order', '1104');
    expect(await t.status('1104')).toBe('已付款');
    await t.run('owner', 'hold_order', '1104');
    expect(await refusal(t.run('owner', 'ship_order', '1104'))).toEqual({ status: 422, code: 'ON_HOLD' });
    expect([await t.stock('WHT-SILVER-2OZ'), await t.stock('OOL-MILK-4OZ')]).toEqual([71, 58]);
    expect((await t.client.metrics('owner')).values.find((v) => v.id === 'open_orders')!.value).toBe(34);
    expect(await refusal((await teaco('v1')).run('jonah', 'hold_order', '1104'))).toEqual({ status: 404, code: 'UNKNOWN_ACTION' });
  });

  it('replays a request key instead of acting twice, and refuses a reused key', async () => {
    const t = await teaco();
    const prepared = await t.client.prepareAction('ship_order', 'owner', { target: '1106' });
    const first = await t.client.invokeAction('ship_order', 'owner', { target: '1106', idempotencyKey: 'k-1', expectedVersion: prepared.preview.target.version });
    const again = await t.client.invokeAction('ship_order', 'owner', { target: '1106', idempotencyKey: 'k-1', expectedVersion: prepared.preview.target.version });
    expect(again).toEqual({ receipt: first.receipt, replayed: true });
    expect(await t.stock('BLK-EARLGR-2OZ')).toBe(22);
    expect(await refusal(t.client.invokeAction('cancel_order', 'owner', { target: '1105', idempotencyKey: 'k-1', expectedVersion: 1 }))).toEqual({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await t.client.invocation('k-1', 'owner')).toEqual(first.receipt);
    expect(await t.client.invocation('never-sent', 'owner')).toBeNull();
  });

  it('voids an approval when the record changed after it (T6-015)', async () => {
    const t = await teaco();
    const prepared = await t.client.prepareAction('ship_order', 'owner', { target: '1104' });
    await t.run('owner', 'pack_order', '1104');
    expect(await refusal(t.client.invokeAction('ship_order', 'owner', { target: '1104', idempotencyKey: 'stale', expectedVersion: prepared.preview.target.version }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
    expect(await t.status('1104')).toBe('已打包');
    expect(await t.stock('WHT-SILVER-2OZ')).toBe(71);
  });

  it('corrects the negative stock from a count and closes its data issue (DQ-06, BB 18)', async () => {
    const t = await teaco();
    expect(await refusal(t.run('owner', 'adjust_stock', 'HRB-PEPMNT-2OZ', { quantity: 20 }))).toEqual({ status: 422, code: 'STOCK_LOCKED' });
    const issue = (await t.client.dataIssues('owner')).issues.find((i) => i.needsDecision)!;
    expect(issue.action).toEqual({ actionId: 'repair_stock', target: 'HRB-PEPMNT-2OZ' });
    expect((await t.client.dataIssues('jonah')).issues.find((i) => i.id === issue.id)!.action).toBeUndefined();
    await t.run('owner', issue.action!.actionId, issue.action!.target, { quantity: 20 });
    expect(await t.stock('HRB-PEPMNT-2OZ')).toBe(20);
    const after = (await t.client.dataIssues('owner')).issues.find((i) => i.id === issue.id)!;
    expect([after.status, after.needsDecision, after.action]).toEqual(['VERIFIED', false, undefined]);
  });

  it('writes the order, stock, movements, audit and outbox together or not at all, across connections (T6-009)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'teaco-'));
    dirs.push(dir);
    const file = join(dir, 'teaco.sqlite');
    const a = await teaco('v1', file);
    const b = openTeacoRepository(file);
    const amanda = (await a.client.listObjects('customers', 'owner', { filter: 'retail', limit: 200 })).rows.find((r) => r.values.name === 'Amanda Bennett')!.key;
    const first = (await a.run('owner', 'create_order', undefined, { customer: amanda, lines: [{ sku: 'WHT-SILVER-1LB', qty: 3 }] })).receipt.after.key!;
    const second = (await a.run('owner', 'create_order', undefined, { customer: amanda, lines: [{ sku: 'WHT-SILVER-1LB', qty: 3 }] })).receipt.after.key!;
    const owner = { id: 'owner', access: { kind: 'all', readOnly: false } as const };
    const ship = (repo: TeacoRepository, no: string, key: string) =>
      repo.execute({ actor: owner, revision: 'v1', request: { action: 'ship_order', target: no }, idempotencyKey: key, expectedVersion: null, at: '2026-09-10T09:10:00Z' });
    const results = await Promise.all([ship(a.repository, first, 'race-a'), ship(b, second, 'race-b')]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ code: 'BACKORDERED' });
    expect(await a.stock('WHT-SILVER-1LB')).toBe(0);
    const raw = new DatabaseSync(file);
    const count = (sql: string) => (raw.prepare(sql).get() as { n: number }).n;
    expect(count("SELECT COUNT(*) AS n FROM inventory_movements WHERE sku = 'WHT-SILVER-1LB'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM outbox_events WHERE type = 'OrderShipped'")).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM audit_log')).toBe(4);
    expect(count('SELECT COUNT(*) AS n FROM products WHERE stock_qty < 0')).toBe(0);
    raw.close();
    b.close();
  });
});
