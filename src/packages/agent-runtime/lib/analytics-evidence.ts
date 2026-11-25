import { checkSqlGrounding, type DataGrounding } from '../../ontology-core/index.js';

type GroundingTable = DataGrounding['tables'][number];
import type { ProjectDetail, WorkspaceStore } from '../../workspace-store/index.js';
import { type AgentLocale, pickLocaleText } from './locale.js';
import { buildProjectDataGrounding, describeGroundingRefusal, describeMissingModels } from './reasoning-grounding.js';

/**
 * Evidence for Metric Insight and Scenario Attribution (#19, TeaCo spec §8.5). Every figure either
 * comes from a query that the project's own grounding (MM, M1, M7) allows and that returned rows,
 * or it is not produced: a missing model, an unknown table, a failed query and an empty result
 * each say what is missing instead of falling back to a default percentage.
 */
export type EvidenceGap = 'NO_MM' | 'NO_TABLE' | 'OUTSIDE_GROUNDING' | 'QUERY_FAILED' | 'EMPTY' | 'NOT_ATTRIBUTABLE';

export interface Evidence {
  readonly ok: true;
  readonly sql: string;
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  /** The M7 reference query the SQL came from, when it did. */
  readonly referenceQueryId?: string;
}

export interface EvidenceGapResult {
  readonly ok: false;
  readonly gap: EvidenceGap;
  readonly sql: string | null;
  readonly message: string;
}

export type EvidenceResult = Evidence | EvidenceGapResult;

const PLAIN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DIMENSION_HINT = /(status|state|type|kind|level|category|channel|region|segment|stage|grade|rating)$/i;

/** Runs one query under the project's grounding; anything short of returned rows is a gap. */
export function runGroundedQuery(
  store: WorkspaceStore,
  project: ProjectDetail | undefined,
  sql: string,
  locale: AgentLocale,
  grounding: DataGrounding = buildProjectDataGrounding(store, project),
  referenceQueryId?: string,
  /** Saved figures must read at least one table this project's MM maps, not only shared resources. */
  requireMappedTable = false,
): EvidenceResult {
  const report = checkSqlGrounding(grounding, sql);
  if (report.unknownTables.length > 0) {
    return { ok: false, gap: 'OUTSIDE_GROUNDING', sql, message: describeGroundingRefusal(grounding, report, locale) };
  }
  const mapped = new Set(grounding.tables.filter((t) => t.mapped).map((t) => t.table.toLowerCase()));
  if (requireMappedTable && !report.referencedTables.some((t) => mapped.has(t.toLowerCase()))) {
    return {
      ok: false,
      gap: 'OUTSIDE_GROUNDING',
      sql,
      message: pickLocaleText(
        locale,
        `取数依据必须读取本工程映射的业务表（${[...mapped].join('、') || '无'}），这条查询没有读取任何一张，不能作为本工程的数字保存。`,
        `The evidence must read a table this project maps (${[...mapped].join(', ') || 'none'}); this query reads none of them, so it cannot back this project's figures.`,
      ),
    };
  }
  let result;
  try {
    result = store.executeReadOnlyAnalyticsSql(sql);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      gap: 'QUERY_FAILED',
      sql,
      message: pickLocaleText(locale, `取数失败，没有得到任何数字：${reason}`, `The query failed, so there are no figures: ${reason}`),
    };
  }
  if (result.rowCount === 0) {
    return {
      ok: false,
      gap: 'EMPTY',
      sql,
      message: pickLocaleText(
        locale,
        '查询成功但没有任何行：表里还没有业务数据，无法给出比例、驱动因子或权重。',
        'The query ran but returned no rows: there is no business data yet, so no shares, drivers or weights can be given.',
      ),
    };
  }
  return { ok: true, sql: result.sql || sql, columns: result.columns, rows: result.rows, ...(referenceQueryId ? { referenceQueryId } : {}) };
}

function tableFor(grounding: DataGrounding, objectName: string | undefined): GroundingTable | undefined {
  const mapped = grounding.tables.filter((t) => t.mapped);
  if (!objectName) return mapped[0];
  const wanted = objectName.toLowerCase();
  return (
    mapped.find((t) => t.objectName?.toLowerCase() === wanted || t.objectAlias?.toLowerCase() === wanted) ??
    mapped[0]
  );
}

function mentions(sql: string, table: string): boolean {
  return new RegExp(`\\b${table.replace(/[^A-Za-z0-9_]/g, '')}\\b`, 'i').test(sql);
}

/**
 * Finds evidence for an object (and optionally a question): an M7 reference query over the
 * object's table first, then a count by the table's most dimension-like column. Never names a
 * table the grounding does not list.
 */
export function gatherEvidence(
  store: WorkspaceStore,
  project: ProjectDetail | undefined,
  focus: { readonly objectName?: string; readonly question?: string; readonly dimensions?: readonly string[] },
  locale: AgentLocale,
): EvidenceResult {
  const grounding = buildProjectDataGrounding(store, project, focus.question);
  const table = tableFor(grounding, focus.objectName);
  if (!table) {
    const missing = describeMissingModels(grounding, locale);
    return {
      ok: false,
      gap: grounding.missing.includes('MM') ? 'NO_MM' : 'NO_TABLE',
      sql: null,
      message:
        missing[0] ??
        pickLocaleText(
          locale,
          '本体里没有映射到数据表的业务对象，无法取数。',
          'No business object in the ontology is mapped to a table, so nothing can be queried.',
        ),
    };
  }
  const candidates: { sql: string; referenceQueryId?: string }[] = [];
  const reference = [...grounding.referenceQueries]
    .filter((q) => mentions(q.sql, table.table) && !/[:?@$]\w*/.test(q.sql.replace(/'[^']*'/g, '')))
    .sort((a, b) => b.score - a.score)[0];
  if (reference) candidates.push({ sql: reference.sql, referenceQueryId: reference.id });
  if (PLAIN.test(table.table)) {
    const declared = (focus.dimensions ?? []).map((d) => d.toLowerCase());
    const attributeName = (c: { attributeRef?: string }) => c.attributeRef?.split('.').slice(1).join('.').toLowerCase();
    const dimension =
      table.columns.find((c) => !c.isPrimaryKey && PLAIN.test(c.column) && (declared.includes(c.column.toLowerCase()) || declared.includes(attributeName(c) ?? '') || (c.label !== undefined && declared.includes(c.label.toLowerCase())))) ??
      table.columns.find((c) => !c.isPrimaryKey && PLAIN.test(c.column) && DIMENSION_HINT.test(c.column)) ??
      table.columns.find((c) => !c.isPrimaryKey && PLAIN.test(c.column) && /char|text|string/i.test(c.columnType ?? ''));
    candidates.push({
      sql: dimension
        ? `SELECT ${dimension.column} AS dimension, COUNT(*) AS record_count FROM ${table.table} GROUP BY ${dimension.column} ORDER BY record_count DESC`
        : `SELECT COUNT(*) AS record_count FROM ${table.table}`,
    });
  }
  let last: EvidenceResult | null = null;
  for (const candidate of candidates) {
    last = runGroundedQuery(store, project, candidate.sql, locale, grounding, candidate.referenceQueryId);
    if (last.ok) return last;
  }
  return (
    last ?? {
      ok: false,
      gap: 'NO_TABLE',
      sql: null,
      message: pickLocaleText(locale, `表 ${table.table} 的名称无法安全地用于查询。`, `Table ${table.table} cannot be queried safely by name.`),
    }
  );
}

export interface ShareRow {
  readonly label: string;
  readonly value: number;
  readonly share: string;
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/**
 * Shares of one measure across one label column, computed from the evidence rows. Null when the
 * rows cannot support a share: fewer than two groups, no label or measure column, or a total of
 * zero (a real zero has no shares).
 */
export function shareBreakdown(evidence: Evidence, limit = 3): { labelColumn: string; measureColumn: string; total: number; rows: ShareRow[] } | null {
  if (evidence.rows.length < 2) return null;
  const numeric = evidence.columns.filter((c) => evidence.rows.every((r) => asNumber(r[c]) !== null));
  const labelColumn = evidence.columns.find((c) => !numeric.includes(c));
  const measureColumn =
    numeric.find((c) => /amount|total|sum|value|count|cnt|qty|quantity/i.test(c)) ?? numeric[numeric.length - 1];
  if (!labelColumn || !measureColumn) return null;
  const total = evidence.rows.reduce((sum, r) => sum + (asNumber(r[measureColumn]) ?? 0), 0);
  if (!(total > 0)) return null;
  const rows = [...evidence.rows]
    .map((r) => ({ label: String(r[labelColumn] ?? '—'), value: asNumber(r[measureColumn]) ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((r) => ({ ...r, share: `${((r.value / total) * 100).toFixed(1)}%` }));
  return { labelColumn, measureColumn, total, rows };
}

/** One line naming where the figures came from. */
export function describeEvidence(evidence: Evidence, locale: AgentLocale): string {
  const sql = evidence.sql.replace(/\s+/g, ' ');
  return evidence.referenceQueryId
    ? pickLocaleText(locale, `依据：M7 参考查询 ${evidence.referenceQueryId} 实查 ${evidence.rows.length} 行（${sql}）`, `Basis: M7 reference query ${evidence.referenceQueryId}, ${evidence.rows.length} live rows (${sql})`)
    : pickLocaleText(locale, `依据：按本体映射实查 ${evidence.rows.length} 行（${sql}）`, `Basis: ${evidence.rows.length} live rows queried through the ontology mapping (${sql})`);
}
