import { createHash, randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { ConnectionError, type FetchLike } from '../packages/application-runtime/index.js';
import {
  decideClaim,
  findValidFromColumn,
  ingestClaims,
  matchKeyColumn,
  parseCsv,
  profileColumns,
  queryClaims,
  tableToClaims,
  type Bilingual,
  type ClaimDecision,
  type KnowledgeClaim,
} from '../packages/data-management/index.js';
import { openConnection, type GatewayDeps } from '../packages/runtime-gateway/index.js';
import type { DataSourceRecord, WorkspaceStore } from '../packages/workspace-store/index.js';

/**
 * Data sources and knowledge for a connected project (TeaCo spec §8.2, §10.5; U-10, U-12). A table
 * is attached as a source, matched to the application's records, and turned into Knowledge Claims
 * with row-level provenance; they wait for a person before they count, disputes are shown side by
 * side, and no claim ever changes the application.
 */
export interface DataSourceRouteOptions {
  readonly fetch?: FetchLike;
}

const MAX_BYTES = 1024 * 1024;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const bi = (zh: string, en: string): Bilingual => ({ zh, en });

/** `leafline-quotes-2026-09.csv` → `leafline-quotes`: dated files of one source are versions. */
export function familyOf(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[-_ ]?\d{4}[-_]?\d{2}([-_]?\d{2})?$/, '').trim() || fileName;
}

const sourceView = ({ content: _content, ...rest }: DataSourceRecord) => rest;

export function registerDataSourceRoutes(app: Hono, store: WorkspaceStore, options: DataSourceRouteOptions = {}): void {
  const deps: GatewayDeps = { store, ...(options.fetch ? { fetch: options.fetch } : {}) };
  const reviewer = (projectId: string) => store.getConnectedApp(projectId)?.actingIdentity ?? 'owner';

  /** Every record key the application lets the first identity see, per object, with its title. */
  async function applicationKeys(projectId: string) {
    const opened = await openConnection(deps, projectId, undefined);
    if (!opened.ok) return null;
    const { client, manifest, actor } = opened.value;
    const objects: { id: string; keys: Set<string>; labels: Map<string, string> }[] = [];
    for (const o of manifest.objects) {
      try {
        const all = o.filters.some((f) => f.id === 'all') ? 'all' : undefined;
        const list = await client.listObjects(o.id, actor, { ...(all ? { filter: all } : {}), limit: 200 });
        const labels = new Map(list.rows.map((r) => {
          const title = r.values[o.titleField];
          return [r.key, typeof title === 'object' && title && 'zh' in title ? (title as Bilingual).zh : String(title ?? r.key)] as const;
        }));
        objects.push({ id: o.id, keys: new Set(labels.keys()), labels });
      } catch (err) {
        if (!(err instanceof ConnectionError)) throw err;
      }
    }
    return { objects, currency: manifest.application.currency };
  }

  app.get('/api/projects/:id/data-sources', (c) => {
    const projectId = c.req.param('id');
    const record = store.getConnectedApp(projectId);
    const application = record
      ? { name: (record.manifest as { application?: { name?: Bilingual } }).application?.name ?? bi('已接入的应用', 'Connected application'), status: record.status, checkedAt: record.checkedAt }
      : null;
    return c.json({ application, sources: store.listDataSources(projectId).map(sourceView) });
  });

  app.post('/api/projects/:id/data-sources', async (c) => {
    const projectId = c.req.param('id');
    if (!store.getProject(projectId)) return c.json({ error: 'Project not found' }, 404);
    const body = await c.req.json<{ fileName?: string; content?: string; family?: string }>().catch(() => null);
    const fileName = body?.fileName?.trim();
    const content = body?.content ?? '';
    if (!fileName || !content.trim()) return c.json({ error: { code: 'EMPTY', message: bi('没有收到内容。', 'Nothing was received.') } }, 422);
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) return c.json({ error: { code: 'TOO_LARGE', message: bi('资料太大（上限 1 MB）。', 'The file is too large (1 MB at most).') } }, 422);
    if (!/\.(csv|tsv|txt)$/i.test(fileName)) {
      return c.json({ error: { code: 'NOT_A_TABLE', message: bi('现在只能附加表格（逗号分隔）。', 'Only tables (comma-separated) can be attached for now.') } }, 422);
    }
    const family = body?.family?.trim() || familyOf(fileName);
    const hash = sha256(content);
    const known = store.listDataSources(projectId).find((s) => s.family === family && s.hash === hash);
    if (known) return c.json({ source: sourceView(known), duplicate: true });

    const table = parseCsv(content);
    if (table.header.length < 2 || table.rows.length === 0) {
      return c.json({ error: { code: 'NOT_A_TABLE', message: bi('没读出表头和数据行。', 'No header and data rows could be read.') } }, 422);
    }
    const profiles = profileColumns(table);
    const at = new Date().toISOString();
    const sourceId = `src-${randomUUID()}`;
    const app = await applicationKeys(projectId);
    const match = app ? matchKeyColumn(table, app.objects) : null;
    const validFromColumn = findValidFromColumn(profiles);
    let summary = { claims: 0, duplicates: 0, disputed: 0, superseded: 0 };
    // A newer file of the same family continues its statements; claims are keyed by family.
    const familyId = `family:${family}`;
    if (app && match) {
      const labels = app.objects.find((o) => o.id === match.objectId)!.labels;
      const { candidates, provenance } = tableToClaims({
        projectId, sourceId: familyId, table, profiles, keyColumn: match.column, subjectKind: match.objectId,
        labelOf: (k) => labels.get(k) ?? k, validFromColumn, currency: app.currency, observedAt: at, hash: sha256, newId: () => `prv-${randomUUID()}`,
      });
      const result = ingestClaims(store.listKnowledgeClaims(projectId), candidates, () => `clm-${randomUUID()}`);
      store.saveProvenanceRecords(provenance.map((p) => ({ ...p, sourceId })));
      store.saveKnowledgeClaims([...result.added, ...result.disputed, ...result.superseded]);
      summary = { claims: result.added.length, duplicates: result.duplicates, disputed: result.disputed.length, superseded: result.superseded.length };
    }
    const source = store.saveDataSource({
      id: sourceId, projectId, family, fileName, kind: 'TABLE', hash, content, rowCount: table.rows.length,
      columns: profiles.map((p) => ({ name: p.name, type: p.type, problems: p.problems })),
      keyColumn: match?.column ?? null, objectId: match?.objectId ?? null, validFromColumn, addedAt: at, summary,
    });
    return c.json({ source: sourceView(source), duplicate: false }, 201);
  });

  /** What is known about the business: current by default, or `asOf` / `knownAt`, or everything with `all=1`. */
  app.get('/api/projects/:id/knowledge', (c) => {
    const projectId = c.req.param('id');
    const claims = store.listKnowledgeClaims(projectId);
    const asOf = c.req.query('asOf') || new Date().toISOString();
    const knownAt = c.req.query('knownAt') || undefined;
    const subject = c.req.query('subject') || undefined;
    const shown = c.req.query('all') === '1'
      ? claims.filter((x) => !subject || x.subject.ref === subject)
      : queryClaims(claims, { asOf, ...(knownAt ? { knownAt } : {}), ...(subject ? { subjectRef: subject } : {}) });
    const provenance = new Map(store.listProvenanceRecords(projectId).map((p) => [p.id, p]));
    const sources = new Map(store.listDataSources(projectId).map((s) => [s.id, s]));
    return c.json({
      asOf,
      knownAt: knownAt ?? asOf,
      claims: shown.map((claim) => ({
        claim,
        provenance: claim.provenanceIds.map((id) => provenance.get(id)).filter(Boolean).map((p) => ({
          ...p!, fileName: sources.get(p!.sourceId)?.fileName ?? null, family: sources.get(p!.sourceId)?.family ?? null,
        })),
      })),
    });
  });

  /** What waits for a person: new claims per source, and disputes shown side by side. */
  app.get('/api/projects/:id/knowledge/pending', (c) => {
    const projectId = c.req.param('id');
    const claims = store.listKnowledgeClaims(projectId);
    const provenance = new Map(store.listProvenanceRecords(projectId).map((p) => [p.id, p]));
    const sources = store.listDataSources(projectId);
    const fileOf = (claim: KnowledgeClaim) => sources.find((s) => s.id === provenance.get(claim.provenanceIds[0] ?? '')?.sourceId) ?? null;
    const proposed = new Map<string, { source: ReturnType<typeof sourceView>; count: number; sample: KnowledgeClaim[] }>();
    for (const claim of claims.filter((x) => x.status === 'PROPOSED')) {
      const file = fileOf(claim);
      if (!file) continue;
      const entry = proposed.get(file.id) ?? { source: sourceView(file), count: 0, sample: [] };
      entry.count += 1;
      if (entry.sample.length < 3) entry.sample.push(claim);
      proposed.set(file.id, entry);
    }
    const disputes = new Map<string, { subject: KnowledgeClaim['subject']; predicateLabel: Bilingual; sides: { claim: KnowledgeClaim; family: string | null; fileName: string | null }[] }>();
    for (const claim of claims.filter((x) => x.status === 'DISPUTED')) {
      const key = `${claim.subject.kind}|${claim.subject.ref}|${claim.predicate}`;
      const file = fileOf(claim);
      const entry = disputes.get(key) ?? { subject: claim.subject, predicateLabel: claim.predicateLabel, sides: [] };
      entry.sides.push({ claim, family: file?.family ?? null, fileName: file?.fileName ?? null });
      disputes.set(key, entry);
    }
    return c.json({ proposed: [...proposed.values()], disputes: [...disputes.values()] });
  });

  const decide = (c: Context, projectId: string, ids: readonly string[], decision: ClaimDecision, note: Bilingual | null) => {
    let claims = store.listKnowledgeClaims(projectId);
    const changed = new Map<string, KnowledgeClaim>();
    const at = new Date().toISOString();
    for (const id of ids) {
      const result = decideClaim(claims, id, decision, reviewer(projectId), at, note);
      if ('error' in result) return c.json({ error: { code: result.error, message: result.error === 'NOT_FOUND' ? bi('没有这条知识。', 'No such statement.') : bi('这条知识现在不能这样处理。', 'This statement cannot be decided that way now.') } }, result.error === 'NOT_FOUND' ? 404 : 409);
      claims = result.claims;
      for (const x of result.changed) changed.set(x.id, x);
    }
    store.saveKnowledgeClaims([...changed.values()]);
    return c.json({ changed: [...changed.values()] });
  };

  app.post('/api/projects/:id/knowledge/:claimId/decide', async (c) => {
    const body = await c.req.json<{ decision?: ClaimDecision; note?: Bilingual }>().catch(() => null);
    if (!body?.decision || !['VERIFY', 'REJECT', 'RETIRE'].includes(body.decision)) return c.json({ error: { code: 'INVALID_DECISION' } }, 422);
    return decide(c, c.req.param('id'), [c.req.param('claimId')], body.decision, body.note ?? null);
  });

  /** Confirms or declines every new statement a source brought, in one decision. */
  app.post('/api/projects/:id/data-sources/:sourceId/decide', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<{ decision?: 'VERIFY' | 'REJECT' }>().catch(() => null);
    if (body?.decision !== 'VERIFY' && body?.decision !== 'REJECT') return c.json({ error: { code: 'INVALID_DECISION' } }, 422);
    const ofSource = new Set(store.listProvenanceRecords(projectId).filter((p) => p.sourceId === c.req.param('sourceId')).map((p) => p.id));
    const ids = store.listKnowledgeClaims(projectId).filter((x) => x.status === 'PROPOSED' && x.provenanceIds.some((p) => ofSource.has(p))).map((x) => x.id);
    return decide(c, projectId, ids, body.decision, null);
  });
}
