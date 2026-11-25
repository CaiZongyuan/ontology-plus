import { randomUUID } from 'node:crypto';
import {
  ConnectionError,
  checkManifestAgainstModel,
  createConnectionClient,
  type Bilingual,
  type ConnectionClient,
  type ConnectionManifest,
} from '../../application-runtime/index.js';
import type {
  AcceptanceCheck,
  AcceptanceResult,
  ChangeProposalRecord,
  ReleaseVerification,
} from '../../workspace-store/index.js';
import { confirmedModel, openConnection, type GatewayDeps, type GatewayResult } from './gateway.js';

/**
 * Requirement evolution against a connected application (TeaCo spec §10.6, U-03, U-13). A staged
 * version is previewed read-only and compared with the version in use: what it adds or removes,
 * which existing figures change, and whether the requirement's acceptance checks hold. Only a
 * verified version goes live, only when the version in use is still the one it was verified
 * against, and going back is refused by the application when data would be stranded.
 */
const nowIso = (deps: GatewayDeps) => (deps.now?.() ?? new Date()).toISOString();
const bi = (zh: string, en: string): Bilingual => ({ zh, en });

export interface ReleaseView {
  readonly version: string;
  readonly name: Bilingual;
  readonly notes: readonly Bilingual[];
  /** LIVE = in use; STAGED = later, can go live; EARLIER = was in use before. */
  readonly state: 'LIVE' | 'STAGED' | 'EARLIER';
  readonly proposal: ChangeProposalRecord | null;
}

export interface ReleasesOverview {
  readonly current: string;
  readonly previous: string | null;
  readonly versions: readonly ReleaseView[];
}

const noReleases: GatewayResult<never> = {
  ok: false, status: 422, code: 'NO_RELEASES',
  message: bi('这个应用没有声明版本，无法在这里上线或回退。', 'This application declares no versions, so nothing can go live or back from here.'),
};

export async function listReleases(deps: GatewayDeps, projectId: string): Promise<GatewayResult<ReleasesOverview>> {
  const opened = await openConnection(deps, projectId, undefined);
  if (!opened.ok) return opened;
  const releases = opened.value.manifest.releases;
  if (!releases) return noReleases;
  const at = releases.available.findIndex((r) => r.version === releases.current);
  return {
    ok: true,
    value: {
      current: releases.current,
      previous: releases.previous,
      versions: releases.available.map((r, i) => ({
        version: r.version,
        name: r.name,
        notes: r.notes,
        state: r.version === releases.current ? 'LIVE' : at >= 0 && i < at ? 'EARLIER' : 'STAGED',
        proposal: deps.store.getChangeProposal(projectId, r.version) ?? null,
      })),
    },
  };
}

export interface ProposalInput {
  readonly targetVersion: string;
  readonly title?: Bilingual;
  readonly request?: Bilingual | null;
  readonly checks?: readonly AcceptanceCheck[];
}

/** Records (or replaces) what a requirement change asks and how it is accepted. */
export function upsertProposal(deps: GatewayDeps, projectId: string, input: ProposalInput): ChangeProposalRecord {
  const at = nowIso(deps);
  const prior = deps.store.getChangeProposal(projectId, input.targetVersion);
  const changedChecks = input.checks !== undefined;
  return deps.store.saveChangeProposal({
    id: prior?.id ?? `chg-${randomUUID()}`,
    projectId,
    targetVersion: input.targetVersion,
    title: input.title ?? prior?.title ?? bi(`需求 ${input.targetVersion}`, `Requirement ${input.targetVersion}`),
    request: input.request !== undefined ? input.request : prior?.request ?? null,
    checks: input.checks ?? prior?.checks ?? [],
    // New acceptance checks void an earlier verification.
    status: prior && !changedChecks ? prior.status : prior?.status === 'RELEASED' ? 'RELEASED' : 'PROPOSED',
    verification: changedChecks ? null : prior?.verification ?? null,
    releasedAt: prior?.releasedAt ?? null,
    rolledBackAt: prior?.rolledBackAt ?? null,
    log: [...(prior?.log ?? []), { at, text: prior ? bi('需求变化和验收条件已更新', 'Requirement change and acceptance checks updated') : bi('记下了需求变化和验收条件', 'Requirement change and acceptance checks recorded') }],
    createdAt: prior?.createdAt ?? at,
    updatedAt: at,
  });
}

// ─── Comparing two versions ──────────────────────────────────────────────────

function diffManifests(live: ConnectionManifest, next: ConnectionManifest): ReleaseVerification['changes'] {
  const changes: ReleaseVerification['changes'][number][] = [];
  const by = <T extends { id: string }>(xs: readonly T[]) => new Map(xs.map((x) => [x.id, x]));
  const compare = <T extends { id: string }>(
    area: ReleaseVerification['changes'][number]['area'],
    a: readonly T[],
    b: readonly T[],
    say: (x: T, kind: 'added' | 'removed') => Bilingual,
  ) => {
    const before = by(a);
    const after = by(b);
    for (const [id, x] of after) if (!before.has(id)) changes.push({ area, kind: 'added', text: say(x, 'added') });
    for (const [id, x] of before) if (!after.has(id)) changes.push({ area, kind: 'removed', text: say(x, 'removed') });
  };
  const verb = (kind: 'added' | 'removed') => (kind === 'added' ? bi('新增', 'Adds') : bi('去掉', 'Removes'));
  compare('object', live.objects, next.objects, (o, k) => bi(`${verb(k).zh}业务对象「${o.name.zh}」`, `${verb(k).en} the ${o.name.en} records`));
  compare('report', live.reports, next.reports, (r, k) => bi(`${verb(k).zh}报表「${r.name.zh}」`, `${verb(k).en} the ${r.name.en} report`));
  compare('action', live.actions, next.actions, (a, k) => bi(`${verb(k).zh}操作「${a.name.zh}」`, `${verb(k).en} the action "${a.name.en}"`));
  compare('metric', live.metrics, next.metrics, (m, k) => bi(`${verb(k).zh}指标「${m.name.zh}」`, `${verb(k).en} the figure "${m.name.en}"`));
  compare('identity', live.actors, next.actors, (a, k) => bi(`${verb(k).zh}身份「${a.name.zh}」`, `${verb(k).en} the identity ${a.name.en}`));
  for (const o of next.objects) {
    const before = live.objects.find((x) => x.id === o.id);
    if (!before) continue;
    compare('state', before.filters, o.filters, (f, k) => bi(`${o.name.zh}${verb(k).zh}「${f.label.zh}」`, `${o.name.en}: ${verb(k).en.toLowerCase()} "${f.label.en}"`));
  }
  return changes;
}

const fmtMoney = (cents: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
const show = (value: unknown, unit: string, currency: string) =>
  value === null || value === undefined ? '—' : typeof value === 'number' ? (unit === 'money' ? fmtMoney(value, currency) : String(value)) : String(value);

async function compareFigures(live: ConnectionClient, preview: ConnectionClient, liveManifest: ConnectionManifest, nextManifest: ConnectionManifest, actor: string): Promise<ReleaseVerification['regression']> {
  const currency = liveManifest.application.currency;
  const [before, after] = await Promise.all([live.metrics(actor), preview.metrics(actor)]);
  const rows: ReleaseVerification['regression'][number][] = [];
  for (const m of liveManifest.metrics) {
    if (!nextManifest.metrics.some((x) => x.id === m.id)) continue;
    const a = before.values.find((v) => v.id === m.id)?.value ?? null;
    const b = after.values.find((v) => v.id === m.id)?.value ?? null;
    rows.push({ label: m.name, before: show(a, m.unit, currency), after: show(b, m.unit, currency), changed: a !== b });
  }
  for (const r of liveManifest.reports) {
    if (!nextManifest.reports.some((x) => x.id === r.id)) continue;
    const [ra, rb] = await Promise.all([live.report(r.id, actor), preview.report(r.id, actor)]);
    const total = (rep: typeof ra) => rep.rows.reduce((s, row) => s + (typeof row.total === 'number' ? row.total : 0), 0);
    rows.push({ label: bi(`${r.name.zh}合计`, `${r.name.en} total`), before: fmtMoney(total(ra), currency), after: fmtMoney(total(rb), currency), changed: total(ra) !== total(rb) });
  }
  return rows;
}

const cellMatches = (cell: unknown, wanted: string | number) =>
  typeof cell === 'object' && cell && 'zh' in cell ? (cell as Bilingual).zh === wanted || (cell as Bilingual).en === wanted : cell === wanted;

/** Runs one acceptance check against a client; every outcome states what was actually seen. */
async function runCheck(client: ConnectionClient, manifest: ConnectionManifest, check: AcceptanceCheck): Promise<AcceptanceResult> {
  const actor = check.actor ?? manifest.actors[0]!.id;
  const currency = manifest.application.currency;
  const result = (pass: boolean, zh: string, en: string): AcceptanceResult => ({ checkId: check.id, outcome: pass ? 'PASS' : 'FAIL', observed: bi(zh, en) });
  try {
    switch (check.kind) {
      case 'metric': {
        const value = (await client.metrics(actor)).values.find((v) => v.id === check.metricId)?.value ?? null;
        const unit = manifest.metrics.find((m) => m.id === check.metricId)?.unit ?? 'number';
        return result(value === check.expected, `读到 ${show(value, unit, currency)}`, `Read ${show(value, unit, currency)}`);
      }
      case 'report-cell':
      case 'report-sum': {
        if (!manifest.reports.some((r) => r.id === check.reportId)) return result(false, '这个版本没有这张报表', 'This version has no such report');
        const report = await client.report(check.reportId!, actor);
        const col = report.columns.find((c) => c.key === check.column);
        const rows = check.kind === 'report-sum' ? report.rows : report.rows.filter((row) => Object.entries(check.where ?? {}).every(([k, v]) => cellMatches(row[k], v)));
        if (check.kind === 'report-cell' && rows.length !== 1) return result(false, `找到 ${rows.length} 行匹配`, `${rows.length} matching rows`);
        const value = check.kind === 'report-sum'
          ? rows.reduce((s, row) => s + (typeof row[check.column!] === 'number' ? (row[check.column!] as number) : 0), 0)
          : rows[0]![check.column!];
        const seen = show(value, col?.type ?? 'number', currency);
        return result(value === check.expected, `读到 ${seen}`, `Read ${seen}`);
      }
      case 'prepare-ok': {
        const prepared = await client.prepareAction(check.actionId!, actor, { target: check.target, params: check.params ?? {} });
        const text = [prepared.preview.summary.zh, ...prepared.preview.effects.map((e) => e.zh)].join('；');
        const pass = !check.expectContains || text.includes(check.expectContains);
        return result(pass, `应用预演：${text}`, `The application previewed: ${[prepared.preview.summary.en, ...prepared.preview.effects.map((e) => e.en)].join('; ')}`);
      }
      case 'prepare-refused': {
        try {
          await client.prepareAction(check.actionId!, actor, { target: check.target, params: check.params ?? {} });
          return result(false, '应用没有拒绝', 'The application did not refuse');
        } catch (err) {
          if (!(err instanceof ConnectionError)) throw err;
          const code = err.appError?.code ?? err.code;
          return result(code === check.code, `应用拒绝：${err.appError?.message.zh ?? code}`, `The application refused: ${err.appError?.message.en ?? code}`);
        }
      }
      case 'filter-exists': {
        const object = manifest.objects.find((o) => o.id === check.objectId);
        const filter = object?.filters.find((f) => f.id === check.filterId);
        return result(Boolean(filter), filter ? `有「${filter.label.zh}」` : '没有这个分类', filter ? `"${filter.label.en}" is there` : 'Not there');
      }
    }
  } catch (err) {
    if (err instanceof ConnectionError) return result(false, `读取失败：${err.appError?.message.zh ?? err.code}`, `Reading failed: ${err.appError?.message.en ?? err.code}`);
    throw err;
  }
}

/** Previews a staged version and records what changes and whether its acceptance checks hold. */
export async function verifyRelease(deps: GatewayDeps, projectId: string, targetVersion: string): Promise<GatewayResult<ChangeProposalRecord>> {
  const opened = await openConnection(deps, projectId, undefined);
  if (!opened.ok) return opened;
  const { client, manifest, record, fingerprint } = opened.value;
  const releases = manifest.releases;
  if (!releases) return noReleases;
  const target = releases.available.find((r) => r.version === targetVersion);
  if (!target) return { ok: false, status: 404, code: 'UNKNOWN_RELEASE', message: bi('应用没有这个版本。', 'The application has no such version.') };
  if (targetVersion === releases.current) return { ok: false, status: 409, code: 'ALREADY_LIVE', message: bi('这个版本已经在用了。', 'This version is already live.') };
  const preview = createConnectionClient({ baseUrl: record.baseUrl, release: targetVersion, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
  let verification: ReleaseVerification;
  try {
    const next = await preview.readManifest();
    const owner = manifest.actors[0]!.id;
    const proposal = deps.store.getChangeProposal(projectId, targetVersion);
    const model = confirmedModel(deps.store, projectId);
    verification = {
      at: nowIso(deps),
      baseVersion: releases.current,
      baseFingerprint: fingerprint,
      changes: diffManifests(manifest, next),
      regression: await compareFigures(client, preview, manifest, next, owner),
      results: await Promise.all((proposal?.checks ?? []).map((check) => runCheck(preview, next, check))),
      modelHints: checkManifestAgainstModel(next, model?.objects ?? null),
    };
  } catch (err) {
    if (err instanceof ConnectionError) return { ok: false, status: 502, code: err.code, message: err.message };
    throw err;
  }
  const base = deps.store.getChangeProposal(projectId, targetVersion) ?? upsertProposal(deps, projectId, { targetVersion, title: target.name });
  const passed = verification.results.every((r) => r.outcome === 'PASS');
  const failed = verification.results.filter((r) => r.outcome === 'FAIL').length;
  const at = verification.at;
  return {
    ok: true,
    value: deps.store.saveChangeProposal({
      ...base,
      title: base.title,
      status: passed ? 'VERIFIED' : 'NOT_READY',
      verification,
      log: [
        ...base.log,
        {
          at,
          text: passed
            ? bi(`对照 ${releases.current} 核对通过（${verification.results.length} 条验收）`, `Checked against ${releases.current}: passed (${verification.results.length} acceptance checks)`)
            : bi(`对照 ${releases.current} 核对：${failed} 条验收没通过`, `Checked against ${releases.current}: ${failed} acceptance check(s) failed`),
        },
      ],
      updatedAt: at,
    }),
  };
}

function markDrifted(deps: GatewayDeps, projectId: string) {
  const record = deps.store.getConnectedApp(projectId);
  if (record) deps.store.saveConnectedApp({ ...record, status: 'DRIFTED', driftReason: 'MANIFEST_CHANGED', checkedAt: nowIso(deps) });
}

async function activate(deps: GatewayDeps, projectId: string, version: string, actorId: string | undefined) {
  const opened = await openConnection(deps, projectId, actorId);
  if (!opened.ok) return opened;
  try {
    const res = await opened.value.client.activateRelease(version, opened.value.actor, `op-release-${randomUUID()}`);
    return { ok: true as const, value: { ...res, opened: opened.value } };
  } catch (err) {
    if (!(err instanceof ConnectionError)) throw err;
    return {
      ok: false as const,
      status: (err.status === 403 ? 422 : err.status === 409 ? 409 : 502) as 409 | 422 | 502,
      code: err.appError?.code ?? err.code,
      message: err.appError?.message ?? err.message,
    };
  }
}

/** Puts a verified version live as the console's Acting Identity; the connection then needs a re-check. */
export async function releaseVersion(deps: GatewayDeps, projectId: string, targetVersion: string): Promise<GatewayResult<ChangeProposalRecord>> {
  const proposal = deps.store.getChangeProposal(projectId, targetVersion);
  if (!proposal?.verification || proposal.status !== 'VERIFIED') {
    return { ok: false, status: 409, code: 'NOT_VERIFIED', message: bi('这个版本还没核对通过，不能上线。', 'This version has not passed its checks, so it cannot go live.') };
  }
  const record = deps.store.getConnectedApp(projectId);
  if (!record || record.manifestFingerprint !== proposal.verification.baseFingerprint) {
    return { ok: false, status: 409, code: 'STALE_VERIFICATION', message: bi('核对之后应用有变化，请重新核对这个版本。', 'The application changed after the check; check this version again.') };
  }
  const done = await activate(deps, projectId, targetVersion, record.actingIdentity ?? undefined);
  if (!done.ok) return done;
  markDrifted(deps, projectId);
  const at = nowIso(deps);
  return {
    ok: true,
    value: deps.store.saveChangeProposal({
      ...proposal,
      status: 'RELEASED',
      releasedAt: at,
      log: [...proposal.log, { at, text: bi(`已上线（原为 ${done.value.previous}）；等重新核对接入后，AI 才会再报数字和代办`, `Live (was ${done.value.previous}); the AI reports figures and prepares changes again after the connection is re-checked`) }],
      updatedAt: at,
    }),
  };
}

/** Goes back to the version before the one in use. The application refuses when data would be stranded. */
export async function rollbackVersion(deps: GatewayDeps, projectId: string): Promise<GatewayResult<{ readonly current: string; readonly from: string }>> {
  const opened = await openConnection(deps, projectId, undefined);
  if (!opened.ok) return opened;
  const releases = opened.value.manifest.releases;
  if (!releases) return noReleases;
  if (!releases.previous) return { ok: false, status: 409, code: 'NO_PREVIOUS', message: bi('这已经是第一个版本，没有上一版。', 'This is the first version; there is nothing to go back to.') };
  const record = deps.store.getConnectedApp(projectId);
  const done = await activate(deps, projectId, releases.previous, record?.actingIdentity ?? undefined);
  if (!done.ok) return done;
  markDrifted(deps, projectId);
  const at = nowIso(deps);
  const left = deps.store.getChangeProposal(projectId, releases.current);
  if (left) {
    deps.store.saveChangeProposal({
      ...left,
      status: 'ROLLED_BACK',
      rolledBackAt: at,
      verification: null,
      log: [...left.log, { at, text: bi(`已回到 ${releases.previous}；已经办完的业务不会被撤销`, `Back to ${releases.previous}; business already done is not undone`) }],
      updatedAt: at,
    });
  }
  return { ok: true, value: { current: releases.previous, from: releases.current } };
}
