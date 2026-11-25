import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openTeacoRepository } from '../../examples/teaco/app/db.js';
import { createTeacoRuntimeApp } from '../../examples/teaco/app/runtime.js';
import { seedIfEmpty } from '../../examples/teaco/app/seed.js';
import type { Revision } from '../../examples/teaco/domain/index.js';
import { createConnectionClient } from '../packages/application-runtime/index.js';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';
import {
  approveInvocation,
  declineInvocation,
  listInvocations,
  prepareInvocation,
  reconcileInvocation,
  type GatewayDeps,
} from '../packages/runtime-gateway/index.js';

const seedDir = fileURLToPath(new URL('../../benchmark/datasets/bb-seed0/', import.meta.url));

/** Ontology Plus + TeaCo in-process. `faults` simulates a lost answer around invoke. */
async function setup() {
  const repository = openTeacoRepository(':memory:');
  await seedIfEmpty(repository, seedDir, '2026-09-10T08:00:00.000Z');
  const teaco = { revision: 'v1' as Revision };
  const faults = { dropInvokeAnswer: false, failBeforeInvoke: false };
  const clock = { now: new Date('2026-09-10T09:00:00Z') };
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const isInvoke = url.pathname.endsWith('/invoke');
    if (isInvoke && faults.failBeforeInvoke) throw new TypeError('socket hang up');
    const res = await createTeacoRuntimeApp({ repository, revision: teaco.revision }).request(url.pathname + url.search, init);
    if (isInvoke && faults.dropInvokeAnswer) throw new TypeError('socket hang up after commit');
    return res;
  };
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  const api = createApiApp(store, { connectedAppFetch: fetch });
  const projectId = store.listProjects()[0]!.id;
  await api.request(`/api/projects/${projectId}/connected-app`, { method: 'POST', body: JSON.stringify({ baseUrl: 'teaco.local' }), headers: { 'content-type': 'application/json' } });
  const deps: GatewayDeps = { store, fetch, now: () => clock.now };
  const app = createConnectionClient({ baseUrl: 'http://teaco.local', fetch });
  const stock = async (sku: string) => (await app.getObject('products', sku, 'owner')).values.stock;
  const prepare = async (actionId: string, target?: string, params?: Record<string, unknown>, actor = 'owner') => {
    const r = await prepareInvocation(deps, projectId, { actionId, target, params, actor, requestedBy: 'user' });
    if (!r.ok) throw new Error(`prepare failed: ${r.code}`);
    return r.value;
  };
  return { api, store, deps, projectId, teaco, faults, clock, stock, prepare, app };
}

describe('runtime gateway: prepare → approve → invoke → read back (spec §10.1, ADR 0020)', () => {
  it('records a preview waiting for approval, then executes once approved and reads it back', async () => {
    const t = await setup();
    const inv = await t.prepare('ship_order', '1106');
    expect(inv).toMatchObject({ status: 'PENDING_APPROVAL', actor: 'owner', target: '1106', targetVersion: 1, approvedAt: null });
    expect(inv.preview.effects.map((e) => e.zh)).toContain('Earl Grey Cream（2 oz tin）：库存 28 → 22');
    expect(inv.expiresAt).toBe('2026-09-10T09:10:00.000Z');
    expect(await t.stock('BLK-EARLGR-2OZ')).toBe(28);
    const done = await approveInvocation(t.deps, t.projectId, inv.id);
    expect(done.ok && done.value).toMatchObject({ status: 'VERIFIED', receipt: { status: 'COMMITTED', after: { state: 'SHIPPED' } } });
    expect(await t.stock('BLK-EARLGR-2OZ')).toBe(22);
    expect(done.ok && done.value.log.map((l) => l.text.zh).at(-1)).toContain('已执行，回头核对一致');
    const again = await approveInvocation(t.deps, t.projectId, inv.id);
    expect(again).toMatchObject({ ok: false, code: 'NOT_PENDING' });
  });

  it('runs nothing when declined, and voids an approval after ten minutes', async () => {
    const t = await setup();
    const declined = declineInvocation(t.deps, t.projectId, (await t.prepare('ship_order', '1106')).id);
    expect(declined.ok && declined.value.status).toBe('REJECTED');
    const late = await t.prepare('ship_order', '1106');
    t.clock.now = new Date('2026-09-10T09:11:00Z');
    const r = await approveInvocation(t.deps, t.projectId, late.id);
    expect(r).toMatchObject({ ok: false, code: 'EXPIRED', invocation: { status: 'EXPIRED' } });
    expect(await t.stock('BLK-EARLGR-2OZ')).toBe(28);
    expect(listInvocations(t.deps, t.projectId).map((i) => i.status)).toEqual(['EXPIRED', 'REJECTED']);
  });

  it('voids the approval when the record changed after it was prepared (T6-015)', async () => {
    const t = await setup();
    const ship = await t.prepare('ship_order', '1104');
    const pack = await t.prepare('pack_order', '1104');
    expect((await approveInvocation(t.deps, t.projectId, pack.id)).ok).toBe(true);
    const r = await approveInvocation(t.deps, t.projectId, ship.id);
    expect(r.ok && r.value).toMatchObject({ status: 'FAILED', failure: { code: 'VERSION_CONFLICT' } });
    expect(await t.stock('WHT-SILVER-2OZ')).toBe(71);
  });

  it('voids the approval when the application changed after it was prepared', async () => {
    const t = await setup();
    const inv = await t.prepare('ship_order', '1106');
    t.teaco.revision = 'v2';
    const r = await approveInvocation(t.deps, t.projectId, inv.id);
    expect(r).toMatchObject({ ok: false, code: 'DRIFTED', invocation: { status: 'FAILED', failure: { code: 'APP_CHANGED' } } });
    expect(t.store.getConnectedApp(t.projectId)!.status).toBe('DRIFTED');
    expect(await t.stock('BLK-EARLGR-2OZ')).toBe(28);
  });

  it('marks a lost answer UNKNOWN and reconciles it with the same key, never acting twice (T6-014)', async () => {
    const t = await setup();
    const inv = await t.prepare('ship_order', '1106');
    t.faults.dropInvokeAnswer = true;
    const r = await approveInvocation(t.deps, t.projectId, inv.id);
    expect(r.ok && r.value.status).toBe('UNKNOWN');
    t.faults.dropInvokeAnswer = false;
    const settled = await reconcileInvocation(t.deps, t.projectId, inv.id);
    expect(settled.ok && settled.value).toMatchObject({ status: 'VERIFIED', receipt: { idempotencyKey: inv.idempotencyKey } });
    expect(await t.stock('BLK-EARLGR-2OZ')).toBe(22);
  });

  it('reconciles an unsent request as not having happened', async () => {
    const t = await setup();
    const inv = await t.prepare('ship_order', '1106');
    t.faults.failBeforeInvoke = true;
    expect(((await approveInvocation(t.deps, t.projectId, inv.id)) as { value: { status: string } }).value.status).toBe('UNKNOWN');
    t.faults.failBeforeInvoke = false;
    const settled = await reconcileInvocation(t.deps, t.projectId, inv.id);
    expect(settled.ok && settled.value).toMatchObject({ status: 'FAILED', failure: { code: 'NOT_COMMITTED' } });
    expect(await t.stock('BLK-EARLGR-2OZ')).toBe(28);
  });

  it('passes the application’s own refusals through in business words', async () => {
    const t = await setup();
    const finance = await prepareInvocation(t.deps, t.projectId, { actionId: 'cancel_order', target: '1104', actor: 'finance', requestedBy: 'user' });
    expect(finance).toMatchObject({ ok: false, status: 422, code: 'FORBIDDEN', message: { zh: '财务是只读身份，不能修改任何业务数据。' } });
    const unknown = await prepareInvocation(t.deps, t.projectId, { actionId: 'hold_order', target: '1104', requestedBy: 'user' });
    expect(unknown).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
  });

  it('serves the same flow over HTTP for the console', async () => {
    const t = await setup();
    const post = (path: string, body?: unknown) =>
      Promise.resolve(t.api.request(path, { method: 'POST', ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) })).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
    const prepared = await post(`/api/projects/${t.projectId}/console/actions/repair_stock/prepare`, { actor: 'owner', target: 'HRB-PEPMNT-2OZ', params: { quantity: 20 } });
    expect(prepared.status).toBe(201);
    const approved = await post(`/api/projects/${t.projectId}/console/invocations/${prepared.body.invocation.id}/approve`);
    expect(approved.body.invocation.status).toBe('VERIFIED');
    expect(await t.stock('HRB-PEPMNT-2OZ')).toBe(20);
    const list = (await (await t.api.request(`/api/projects/${t.projectId}/console/invocations`)).json()) as { invocations: { status: string }[] };
    expect(list.invocations.map((i) => i.status)).toEqual(['VERIFIED']);
    const refused = await post(`/api/projects/${t.projectId}/console/actions/adjust_stock/prepare`, { actor: 'jonah', target: 'WHT-SILVER-1LB', params: { quantity: 1 } });
    expect(refused).toMatchObject({ status: 422, body: { error: { code: 'FORBIDDEN' } } });
  });
});
