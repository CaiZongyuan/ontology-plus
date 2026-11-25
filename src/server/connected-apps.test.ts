import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openTeacoRepository } from '../../examples/teaco/app/db.js';
import { createTeacoRuntimeApp } from '../../examples/teaco/app/runtime.js';
import { seedIfEmpty } from '../../examples/teaco/app/seed.js';
import type { Revision } from '../../examples/teaco/domain/index.js';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

const seedDir = fileURLToPath(new URL('../../benchmark/datasets/bb-seed0/', import.meta.url));

/** Ontology Plus with the TeaCo reference app reachable at http://teaco.local, in-process. */
async function setup() {
  const repository = openTeacoRepository(':memory:');
  await seedIfEmpty(repository, seedDir, '2026-09-10T08:00:00.000Z');
  const teaco = { revision: 'v1' as Revision, down: false };
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  const api = createApiApp(store, {
    connectedAppFetch: async (input, init) => {
      if (teaco.down) throw new TypeError('connect ECONNREFUSED 127.0.0.1:4320');
      const url = new URL(input);
      if (url.host !== 'teaco.local') throw new TypeError(`getaddrinfo ENOTFOUND ${url.host}`);
      return createTeacoRuntimeApp({ repository, revision: teaco.revision }).request(url.pathname + url.search, init);
    },
  });
  const projectId = store.listProjects()[0]!.id;
  const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });
  const call = (method: string, path: string, body?: unknown) =>
    Promise.resolve(api.request(path, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) })).then(json);
  return { api, store, teaco, projectId, call };
}

describe('connecting a Runnable System and reading it through the Operations Console', () => {
  it('connects by address, keeps the manifest and lists it in bootstrap', async () => {
    const { call, projectId } = await setup();
    const res = await call('POST', `/api/projects/${projectId}/connected-app`, { baseUrl: 'teaco.local' });
    expect(res.status).toBe(201);
    expect(res.body.connectedApp).toMatchObject({ projectId, baseUrl: 'http://teaco.local', status: 'CONNECTED', driftReason: null });
    expect(res.body.connectedApp.manifestFingerprint).toMatch(/^sha256:/);
    // The demo project models contracts, so TeaCo's objects are listed as hints but do not block the connection.
    expect(res.body.connectedApp.hints.map((h: { code: string; objectId: string }) => [h.code, h.objectId])).toEqual([
      ['OBJECT_NOT_IN_MODEL', 'orders'], ['OBJECT_NOT_IN_MODEL', 'products'], ['OBJECT_NOT_IN_MODEL', 'customers'],
    ]);
    const boot = await call('GET', `/api/bootstrap?projectId=${projectId}`);
    expect(boot.body.connectedApps.map((a: { projectId: string }) => a.projectId)).toEqual([projectId]);
  });

  it('explains why an address cannot be connected', async () => {
    const { call, projectId } = await setup();
    expect((await call('POST', `/api/projects/${projectId}/connected-app`, { baseUrl: 'other.local' })).body.error.code).toBe('UNREACHABLE');
    expect((await call('POST', `/api/projects/${projectId}/connected-app`, { baseUrl: 'ftp://x' })).status).toBe(422);
    expect((await call('POST', `/api/projects/${projectId}/connected-app`, {})).status).toBe(422);
    expect((await call('GET', `/api/projects/${projectId}/console/overview`)).body.error.code).toBe('NOT_CONNECTED');
  });

  it('reads as the chosen Acting Identity, and the application decides the scope', async () => {
    const { call, projectId } = await setup();
    await call('POST', `/api/projects/${projectId}/connected-app`, { baseUrl: 'teaco.local' });
    const owner = await call('GET', `/api/projects/${projectId}/console/overview`);
    expect(owner.status).toBe(200);
    expect(owner.body.actor).toBe('owner');
    expect(owner.body.data.metrics.values.find((v: { id: string }) => v.id === 'open_orders').value).toBe(34);
    expect(owner.body.data.dataIssues.issues.some((i: { needsDecision: boolean }) => i.needsDecision)).toBe(true);
    const jonah = await call('GET', `/api/projects/${projectId}/console/overview?actor=jonah`);
    expect(jonah.body.data.metrics.values.find((v: { id: string }) => v.id === 'open_orders').value).toBe(3);
    expect((await call('GET', `/api/projects/${projectId}/console/objects/orders?actor=jonah&filter=all`)).body.data.total).toBe(16);
    expect((await call('GET', `/api/projects/${projectId}/console/objects/orders/1008?actor=jonah`)).status).toBe(404);
    expect((await call('GET', `/api/projects/${projectId}/console/objects/orders/1008`)).body.data.values.customer).toBe('Evergreen Health Foods');
    expect((await call('GET', `/api/projects/${projectId}/console/overview?actor=mallory`)).body.error.code).toBe('UNKNOWN_ACTOR');
  });

  it('marks the connection Drifted when the application changes, and resumes after a re-check', async () => {
    const { call, projectId, teaco } = await setup();
    await call('POST', `/api/projects/${projectId}/connected-app`, { baseUrl: 'teaco.local' });
    expect((await call('GET', `/api/projects/${projectId}/console/reports/monthly_sales`)).status).toBe(404);
    teaco.revision = 'v2';
    const drifted = await call('GET', `/api/projects/${projectId}/console/overview`);
    expect(drifted.status).toBe(409);
    expect(drifted.body).toMatchObject({ error: { code: 'DRIFTED', reason: 'MANIFEST_CHANGED' }, connectedApp: { status: 'DRIFTED' } });
    expect((await call('GET', `/api/projects/${projectId}/console/objects/orders`)).status).toBe(409);
    const checked = await call('POST', `/api/projects/${projectId}/connected-app/check`);
    expect(checked.body.connectedApp).toMatchObject({ status: 'CONNECTED', manifest: { application: { version: 'v2' } } });
    const report = await call('GET', `/api/projects/${projectId}/console/reports/monthly_sales`);
    expect(report.body.data.rows.filter((r: { month: string }) => r.month === '2026-03')).toHaveLength(2);
  });

  it('marks the connection Drifted when the Business Model was re-confirmed since', async () => {
    const { call, projectId, store } = await setup();
    await call('POST', `/api/projects/${projectId}/connected-app`, { baseUrl: 'teaco.local' });
    store.saveConnectedApp({ ...store.getConnectedApp(projectId)!, modelHash: 'checked-against-an-older-model' });
    expect((await call('GET', `/api/projects/${projectId}/console/overview`)).body.error).toMatchObject({ code: 'DRIFTED', reason: 'MODEL_CHANGED' });
  });

  it('says the application cannot be reached instead of showing old numbers', async () => {
    const { call, projectId, teaco } = await setup();
    await call('POST', `/api/projects/${projectId}/connected-app`, { baseUrl: 'teaco.local' });
    teaco.down = true;
    const res = await call('GET', `/api/projects/${projectId}/console/overview`);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UNREACHABLE');
    expect(res.body.data).toBeUndefined();
  });

  it('disconnects', async () => {
    const { call, projectId } = await setup();
    await call('POST', `/api/projects/${projectId}/connected-app`, { baseUrl: 'teaco.local' });
    expect((await call('DELETE', `/api/projects/${projectId}/connected-app`)).body.removed).toBe(true);
    expect((await call('GET', `/api/projects/${projectId}/connected-app`)).body.connectedApp).toBeNull();
  });
});
