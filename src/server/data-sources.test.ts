import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openTeacoRepository } from '../../examples/teaco/app/db.js';
import { createTeacoRuntimeApp } from '../../examples/teaco/app/runtime.js';
import { seedIfEmpty } from '../../examples/teaco/app/seed.js';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';
import { familyOf } from './data-sources.js';

/**
 * Supplier tables attached to the connected TeaCo project (spec §8.2, §10.5; T3-003/004, T5-008,
 * T7-003/004/006): matched to TeaCo's teas, recorded with row provenance, reviewed by a person,
 * and asked about by date.
 */
const seedDir = fileURLToPath(new URL('../../benchmark/datasets/bb-seed0/', import.meta.url));
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../examples/teaco/sources/${name}`, import.meta.url)), 'utf8');

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
  const attach = (name: string) => call('POST', `${base}/data-sources`, { fileName: name, content: fixture(name) });
  const cost = async (query = '') =>
    (await call('GET', `${base}/knowledge?subject=WHT-SILVER-1LB${query}`)).body.claims
      .filter((x: any) => x.claim.predicate === 'unit_cost')
      .map((x: any) => [x.claim.value.value, x.claim.status]);
  return { store, call, base, attach, cost };
}

describe('supplier tables as data sources and knowledge', () => {
  it('names a source after its file without the date, so monthly files are one source', () => {
    expect(familyOf('leafline-quotes-2026-09.csv')).toBe('leafline-quotes');
    expect(familyOf('leafline_email_20260901.csv')).toBe('leafline_email');
    expect(familyOf('notes.csv')).toBe('notes');
  });

  it('matches the table to TeaCo’s teas, reports the bad cell, and waits for review before anything counts', async () => {
    const t = await setup();
    const aug = await t.attach('leafline-quotes-2026-08.csv');
    expect(aug.status).toBe(201);
    expect(aug.body.source).toMatchObject({ family: 'leafline-quotes', keyColumn: 'sku', objectId: 'products', validFromColumn: 'valid_from', rowCount: 6 });
    expect(aug.body.source.columns.find((c: any) => c.name === 'unit_cost')).toEqual({ name: 'unit_cost', type: 'money', problems: [{ row: 6, value: '$2,40' }] });
    // 6 rows × 3 value columns, minus the malformed cost.
    expect(aug.body.source.summary).toEqual({ claims: 17, duplicates: 0, disputed: 0, superseded: 0 });
    expect(await t.cost()).toEqual([]);
    const pending = (await t.call('GET', `${t.base}/knowledge/pending`)).body;
    expect(pending.proposed).toHaveLength(1);
    expect(pending.proposed[0]).toMatchObject({ count: 17, source: { fileName: 'leafline-quotes-2026-08.csv' } });
    expect((await t.attach('leafline-quotes-2026-08.csv')).body.duplicate).toBe(true);

    await t.call('POST', `${t.base}/data-sources/${aug.body.source.id}/decide`, { decision: 'VERIFY' });
    const known = (await t.call('GET', `${t.base}/knowledge?subject=WHT-SILVER-1LB&asOf=2026-08-15T00:00:00.000Z`)).body.claims;
    const silver = known.find((x: any) => x.claim.predicate === 'unit_cost');
    expect(silver.claim).toMatchObject({ value: { value: 3140, unit: 'USD' }, subject: { label: 'Silver Needle' }, predicateLabel: { zh: '进价' } });
    expect(silver.provenance[0]).toMatchObject({ locator: 'row 2', excerpt: 'WHT-SILVER-1LB,"$31.40",12,10,2026-08-01', fileName: 'leafline-quotes-2026-08.csv' });
  });

  it('answers the current cost from the newer sheet and the August cost for August (T7-003/004)', async () => {
    const t = await setup();
    for (const f of ['leafline-quotes-2026-08.csv', 'leafline-quotes-2026-09.csv']) {
      const res = await t.attach(f);
      await t.call('POST', `${t.base}/data-sources/${res.body.source.id}/decide`, { decision: 'VERIFY' });
    }
    expect(await t.cost('&asOf=2026-09-15T00:00:00.000Z')).toEqual([[3290, 'VERIFIED']]);
    expect(await t.cost('&asOf=2026-08-15T00:00:00.000Z')).toEqual([[3140, 'SUPERSEDED']]);
    const history = (await t.call('GET', `${t.base}/knowledge?subject=WHT-SILVER-1LB&all=1`)).body.claims.filter((x: any) => x.claim.predicate === 'unit_cost');
    expect(history.map((x: any) => [x.claim.validFrom.slice(0, 10), x.claim.validTo?.slice(0, 10) ?? null])).toEqual([['2026-08-01', '2026-09-01'], ['2026-09-01', null]]);
  });

  it('keeps two disagreeing sources side by side until a person picks one (T5-008, T7-006)', async () => {
    const t = await setup();
    const sheet = await t.attach('leafline-quotes-2026-09.csv');
    await t.call('POST', `${t.base}/data-sources/${sheet.body.source.id}/decide`, { decision: 'VERIFY' });
    const email = await t.attach('leafline-email-2026-09.csv');
    expect(email.body.source.summary).toMatchObject({ claims: 2, disputed: 2 });
    const disputes = (await t.call('GET', `${t.base}/knowledge/pending`)).body.disputes;
    expect(disputes).toHaveLength(1);
    expect(disputes[0].sides.map((s: any) => [s.family, s.claim.value.value]).sort()).toEqual([['leafline-email', 3090], ['leafline-quotes', 3290]]);
    expect((await t.cost('&asOf=2026-09-15T00:00:00.000Z')).sort()).toEqual([[3090, 'DISPUTED'], [3290, 'DISPUTED']]);
    const pick = disputes[0].sides.find((s: any) => s.family === 'leafline-quotes').claim.id;
    await t.call('POST', `${t.base}/knowledge/${pick}/decide`, { decision: 'VERIFY' });
    expect(await t.cost('&asOf=2026-09-15T00:00:00.000Z')).toEqual([[3290, 'VERIFIED']]);
    expect((await t.call('GET', `${t.base}/knowledge/pending`)).body.disputes).toEqual([]);
  });

  it('retires a statement so it is no longer current (T7-005), and never touches the application', async () => {
    const t = await setup();
    const sheet = await t.attach('leafline-quotes-2026-09.csv');
    await t.call('POST', `${t.base}/data-sources/${sheet.body.source.id}/decide`, { decision: 'VERIFY' });
    const lead = (await t.call('GET', `${t.base}/knowledge?subject=WHT-SILVER-1LB`)).body.claims.find((x: any) => x.claim.predicate === 'lead_time_days').claim;
    expect((await t.call('POST', `${t.base}/knowledge/${lead.id}/decide`, { decision: 'RETIRE' })).status).toBe(200);
    const now = (await t.call('GET', `${t.base}/knowledge?subject=WHT-SILVER-1LB`)).body.claims.map((x: any) => x.claim.predicate);
    expect(now).not.toContain('lead_time_days');
    expect((await t.call('GET', `${t.base}/console/objects/products/WHT-SILVER-1LB`)).body.data.values.stock).toBe(3);
  });

  it('refuses what it cannot read as a table', async () => {
    const t = await setup();
    expect((await t.call('POST', `${t.base}/data-sources`, { fileName: 'policy.pdf', content: 'x' })).body.error.code).toBe('NOT_A_TABLE');
    expect((await t.call('POST', `${t.base}/data-sources`, { fileName: 'one.csv', content: 'only-a-header\n' })).body.error.code).toBe('NOT_A_TABLE');
  });
});
