import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openTeacoRepository } from '../../examples/teaco/app/db.js';
import { createTeacoRuntimeApp } from '../../examples/teaco/app/runtime.js';
import { seedIfEmpty } from '../../examples/teaco/app/seed.js';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

/**
 * Requirement evolution v1 → v4 against the TeaCo reference app (spec §3.3, §10.6, M4): each
 * requirement change is previewed and checked before it goes live, the connection is re-checked
 * after it, and going back is refused while data would be stranded.
 */
const seedDir = fileURLToPath(new URL('../../benchmark/datasets/bb-seed0/', import.meta.url));
const change = (v: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../examples/teaco/changes/${v}.json`, import.meta.url)), 'utf8'));

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
  expect((await call('POST', `${base}/connected-app`, { baseUrl: 'teaco.local' })).status).toBe(201);
  for (const v of ['v2', 'v3', 'v4']) expect((await call('POST', `${base}/change-proposals`, change(v))).status).toBe(200);
  const recheck = () => call('POST', `${base}/connected-app/check`);
  return { store, call, base, recheck, projectId };
}

describe('requirement changes as versions of the connected application', () => {
  it('previews, checks and puts v2–v4 live in order, then marks what is new after each re-check', async () => {
    const t = await setup();
    const overview = await t.call('GET', `${t.base}/console/releases`);
    expect(overview.body.current).toBe('v1');
    expect(overview.body.versions.map((v: any) => [v.version, v.state, v.proposal?.checks.length ?? 0])).toEqual([
      ['v1', 'LIVE', 0], ['v2', 'STAGED', 7], ['v3', 'STAGED', 5], ['v4', 'STAGED', 4],
    ]);

    const v2 = (await t.call('POST', `${t.base}/console/releases/v2/verify`)).body.proposal;
    expect(v2.status).toBe('VERIFIED');
    expect(v2.verification.results.map((r: any) => r.outcome)).toEqual(Array(7).fill('PASS'));
    expect(v2.verification.changes.map((c: any) => c.text.zh)).toEqual(['新增报表「月度销售报表」']);
    expect(v2.verification.regression.every((r: any) => !r.changed)).toBe(true);
    expect((await t.call('GET', `${t.base}/console/overview`)).status).toBe(200);

    const released = await t.call('POST', `${t.base}/console/releases/v2/release`);
    expect(released.body.proposal.status).toBe('RELEASED');
    expect(released.body.connectedApp.status).toBe('DRIFTED');
    expect((await t.call('GET', `${t.base}/console/overview`)).status).toBe(409);
    expect((await t.recheck()).body.connectedApp.newSince).toEqual({ objects: [], reports: ['monthly_sales'], actions: [], filters: [] });

    const v3 = (await t.call('POST', `${t.base}/console/releases/v3/verify`)).body.proposal;
    expect(v3.verification.results.map((r: any) => [r.checkId, r.outcome])).toEqual([
      ['bb30-cedar-grove', 'PASS'], ['bb31-at-threshold', 'PASS'], ['bb31-below-threshold', 'PASS'], ['bb32-retail', 'PASS'], ['import-not-repriced', 'PASS'],
    ]);
    expect(v3.verification.regression.every((r: any) => !r.changed)).toBe(true);
    await t.call('POST', `${t.base}/console/releases/v3/release`);
    await t.recheck();

    const v4 = (await t.call('POST', `${t.base}/console/releases/v4/verify`)).body.proposal;
    expect(v4.status).toBe('VERIFIED');
    expect(v4.verification.changes.map((c: any) => c.text.zh)).toEqual(['新增操作「挂起」', '新增操作「解除挂起」', '订单新增「挂起中」']);
    await t.call('POST', `${t.base}/console/releases/v4/release`);
    const after = (await t.recheck()).body.connectedApp;
    expect(after.newSince).toEqual({ objects: [], reports: [], actions: ['hold_order', 'release_order'], filters: ['orders:on_hold'] });
    expect((await t.call('GET', `${t.base}/console/releases`)).body.versions.map((v: any) => v.state)).toEqual(['EARLIER', 'EARLIER', 'EARLIER', 'LIVE']);
  });

  it('refuses to go back while orders are on hold, and goes back once they are released', async () => {
    const t = await setup();
    for (const v of ['v2', 'v3', 'v4']) {
      await t.call('POST', `${t.base}/console/releases/${v}/verify`);
      await t.call('POST', `${t.base}/console/releases/${v}/release`);
      await t.recheck();
    }
    const hold = (await t.call('POST', `${t.base}/console/actions/hold_order/prepare`, { actor: 'jonah', target: '1104' })).body.invocation;
    expect((await t.call('POST', `${t.base}/console/invocations/${hold.id}/approve`)).body.invocation.status).toBe('VERIFIED');
    const blocked = await t.call('POST', `${t.base}/console/releases/rollback`);
    expect(blocked).toMatchObject({ status: 409, body: { error: { code: 'ROLLBACK_BLOCKED' } } });
    expect(blocked.body.error.message.zh).toContain('有 1 张订单处于「挂起中」');
    expect(t.store.getConnectedApp(t.projectId)!.status).toBe('CONNECTED');

    const release = (await t.call('POST', `${t.base}/console/actions/release_order/prepare`, { actor: 'owner', target: '1104' })).body.invocation;
    await t.call('POST', `${t.base}/console/invocations/${release.id}/approve`);
    const back = await t.call('POST', `${t.base}/console/releases/rollback`);
    expect(back.body).toMatchObject({ current: 'v3', from: 'v4', connectedApp: { status: 'DRIFTED' } });
    expect(t.store.getChangeProposal(t.projectId, 'v4')!.status).toBe('ROLLED_BACK');
    await t.recheck();
    expect((await t.call('GET', `${t.base}/console/releases`)).body).toMatchObject({ current: 'v3', previous: 'v2' });
  });

  it('keeps a version from going live when a check fails, the check is stale, or the identity may not', async () => {
    const t = await setup();
    const wrong = change('v2');
    wrong.checks[1].expected = 57864;
    await t.call('POST', `${t.base}/change-proposals`, wrong);
    const failed = (await t.call('POST', `${t.base}/console/releases/v2/verify`)).body.proposal;
    expect(failed.status).toBe('NOT_READY');
    expect(failed.verification.results[1]).toMatchObject({ outcome: 'FAIL', observed: { zh: '读到 $578.63' } });
    expect((await t.call('POST', `${t.base}/console/releases/v2/release`)).body.error.code).toBe('NOT_VERIFIED');

    await t.call('POST', `${t.base}/change-proposals`, change('v2'));
    expect((await t.call('POST', `${t.base}/console/releases/v2/verify`)).body.proposal.status).toBe('VERIFIED');
    await t.call('POST', `${t.base}/connected-app/acting-identity`, { actor: 'jonah' });
    const refused = await t.call('POST', `${t.base}/console/releases/v2/release`);
    expect(refused.body.error).toMatchObject({ code: 'FORBIDDEN', message: { zh: '只有店主能让新版本上线或回退。' } });

    await t.call('POST', `${t.base}/connected-app/acting-identity`, { actor: 'owner' });
    await t.call('POST', `${t.base}/console/releases/v3/verify`);
    await t.call('POST', `${t.base}/console/releases/v3/release`);
    await t.recheck();
    const stale = await t.call('POST', `${t.base}/console/releases/v2/release`);
    expect(stale.body.error.code).toBe('STALE_VERIFICATION');
  });
});
