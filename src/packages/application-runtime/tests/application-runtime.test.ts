import { describe, expect, it } from 'vitest';
import {
  ACTOR_HEADER,
  CONNECTION_PROTOCOL,
  ConnectionError,
  checkManifestAgainstModel,
  createConnectionClient,
  fingerprintManifest,
  normalizeBaseUrl,
  parseConnectionManifest,
  type ConnectionManifest,
} from '../index.js';

const bi = (zh: string, en: string) => ({ zh, en });

function manifestDoc(overrides: Record<string, unknown> = {}) {
  return {
    protocol: CONNECTION_PROTOCOL,
    application: { name: bi('茶叶订单系统', 'Tea orders'), version: 'v1' },
    actors: [{ id: 'owner', name: bi('店主', 'Owner'), role: bi('管理员', 'Admin'), scope: bi('全店', 'Whole shop') }],
    metrics: [{ id: 'open_orders', name: bi('没发货的订单', 'Open orders'), unit: 'count' }],
    objects: [{
      id: 'orders', name: bi('订单', 'Orders'), modelObject: 'Order', titleField: 'customer', statusField: 'status',
      fields: [
        { key: 'no', label: bi('订单', 'Order'), type: 'text' },
        { key: 'customer', label: bi('客户', 'Customer'), type: 'text' },
        { key: 'status', label: bi('状态', 'Status'), type: 'status' },
      ],
    }],
    ...overrides,
  };
}

function fakeFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: { url: string; actor: string | null }[] = [];
  const fn = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const headers = new Headers(init?.headers);
    calls.push({ url: url.pathname + url.search, actor: headers.get(ACTOR_HEADER) });
    const handler = routes[url.pathname];
    return handler ? handler(init) : new Response('not found', { status: 404 });
  };
  return { fn, calls };
}

describe('connection manifest', () => {
  it('accepts a v1 manifest and fills defaults', () => {
    const r = parseConnectionManifest(manifestDoc());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.reports).toEqual([]);
      expect(r.manifest.objects[0]!.filters).toEqual([]);
    }
  });

  it('rejects another protocol instead of guessing', () => {
    const r = parseConnectionManifest(manifestDoc({ protocol: 'ontology-plus-connect/2' }));
    expect(r).toEqual({ ok: false, problems: [expect.objectContaining({ path: 'protocol' })] });
  });

  it('reports an object that names a field it does not list, and duplicate ids', () => {
    const doc = manifestDoc();
    (doc.objects[0] as { titleField: string }).titleField = 'missing';
    (doc as { metrics: unknown[] }).metrics.push({ id: 'open_orders', name: bi('重复', 'Dup'), unit: 'count' });
    const r = parseConnectionManifest(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const messages = r.problems.map((p) => p.message).join('\n');
      expect(messages).toContain('field "missing"');
      expect(messages).toContain('duplicate metric id "open_orders"');
    }
  });

  it('requires at least one acting identity', () => {
    expect(parseConnectionManifest(manifestDoc({ actors: [] })).ok).toBe(false);
  });

  it('fingerprints independently of key order and notices a change', async () => {
    const a = parseConnectionManifest(manifestDoc());
    const reordered = JSON.parse(JSON.stringify(manifestDoc(), Object.keys(manifestDoc()).reverse()));
    const b = parseConnectionManifest({ ...reordered, ...manifestDoc() });
    const c = parseConnectionManifest(manifestDoc({ application: { name: bi('茶叶订单系统', 'Tea orders'), version: 'v2' } }));
    if (!a.ok || !b.ok || !c.ok) throw new Error('fixture');
    expect(await fingerprintManifest(a.manifest)).toBe(await fingerprintManifest(b.manifest));
    expect(await fingerprintManifest(a.manifest)).not.toBe(await fingerprintManifest(c.manifest));
  });
});

describe('connection client', () => {
  it('normalises addresses and refuses non-web ones', () => {
    expect(normalizeBaseUrl(' 127.0.0.1:4320/ ')).toBe('http://127.0.0.1:4320');
    expect(normalizeBaseUrl('https://shop.example/app/?x=1#y')).toBe('https://shop.example/app');
    expect(() => normalizeBaseUrl('ftp://x')).toThrow(ConnectionError);
  });

  it('reads the manifest and sends the acting identity with every runtime read', async () => {
    const { fn, calls } = fakeFetch({
      '/.well-known/ontology-plus.json': () => Response.json(manifestDoc()),
      '/runtime/metrics': () => Response.json({ asOf: '2026-09-10T09:00:00Z', values: [{ id: 'open_orders', value: 34 }] }),
      '/runtime/objects/orders': () => Response.json({ asOf: 'now', total: 1, rows: [{ key: '1104', values: { no: '1104' } }] }),
    });
    const client = createConnectionClient({ baseUrl: '127.0.0.1:4320', fetch: fn });
    const manifest: ConnectionManifest = await client.readManifest();
    expect(manifest.actors[0]!.id).toBe('owner');
    expect((await client.metrics('jonah')).values[0]!.value).toBe(34);
    const list = await client.listObjects('orders', 'jonah', { filter: 'open', limit: 20 });
    expect(list.rows[0]!.flags).toEqual([]);
    expect(calls).toEqual([
      { url: '/.well-known/ontology-plus.json', actor: null },
      { url: '/runtime/metrics', actor: 'jonah' },
      { url: '/runtime/objects/orders?filter=open&limit=20', actor: 'jonah' },
    ]);
  });

  it('explains failures by kind', async () => {
    const { fn } = fakeFetch({
      '/.well-known/ontology-plus.json': () => Response.json({ protocol: CONNECTION_PROTOCOL }),
      '/runtime/metrics': () => Response.json({ values: 'nope' }),
      '/runtime/data-issues': () => new Response('{', { status: 200 }),
      '/runtime/activity': () => new Response('denied', { status: 403 }),
    });
    const client = createConnectionClient({ baseUrl: 'http://app.local', fetch: fn });
    await expect(client.readManifest()).rejects.toMatchObject({ code: 'INVALID_MANIFEST' });
    await expect(client.metrics('owner')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    await expect(client.dataIssues('owner')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    await expect(client.activity('owner')).rejects.toMatchObject({ code: 'REJECTED', status: 403 });
    await expect(client.report('monthly', 'owner')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const down = createConnectionClient({ baseUrl: 'http://app.local', fetch: async () => { throw new TypeError('connect ECONNREFUSED'); } });
    await expect(down.readManifest()).rejects.toMatchObject({ code: 'UNREACHABLE' });
  });
});

describe('checking a manifest against the confirmed Business Model', () => {
  const parsed = parseConnectionManifest(manifestDoc({
    objects: [
      ...manifestDoc().objects,
      { id: 'customers', name: bi('客户', 'Customers'), modelObject: 'Client', titleField: 'id', fields: [{ key: 'id', label: bi('编号', 'Id') }] },
      { id: 'notes', name: bi('备注', 'Notes'), titleField: 'id', fields: [{ key: 'id', label: bi('编号', 'Id') }] },
    ],
  }));
  if (!parsed.ok) throw new Error('fixture');

  it('says when there is no confirmed model to check against', () => {
    expect(checkManifestAgainstModel(parsed.manifest, null).map((h) => h.code)).toEqual(['NO_CONFIRMED_MODEL']);
  });

  it('matches by name, alias or id and lists what does not match', () => {
    const hints = checkManifestAgainstModel(parsed.manifest, [{ id: 'AGG-ORDER', name: 'order', alias: '订单' }]);
    expect(hints.map((h) => [h.code, h.objectId])).toEqual([
      ['OBJECT_NOT_IN_MODEL', 'customers'],
      ['OBJECT_WITHOUT_MODEL_LINK', 'notes'],
    ]);
    expect(hints[0]!.message.zh).toContain('「Client」');
  });
});
