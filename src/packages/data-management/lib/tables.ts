import type { Bilingual, ClaimCandidate, ClaimValue, ProvenanceRecord } from './claims.js';

/**
 * Tables people attach as data sources (TeaCo spec §8.2 FileConnector, T3-003/004): parsed
 * exactly (UTF-8 BOM, quoted commas and quotes, CRLF), typed by their values, and turned into
 * claim candidates with one provenance record per row. Nothing here guesses a value: a cell that
 * does not parse as its column's type is reported, not converted.
 */
export interface ParsedTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** The raw text of each data row, for provenance excerpts. */
  readonly lines: readonly string[];
}

/** RFC 4180 parsing with a leading BOM tolerated and blank trailing lines dropped. */
export function parseCsv(text: string): ParsedTable {
  const src = text.replace(/^﻿/, '');
  const records: string[][] = [];
  const raws: string[] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      record.push(field);
      field = '';
      records.push(record);
      raws.push(src.slice(start, i));
      record = [];
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      start = i + 1;
    } else field += ch;
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
    raws.push(src.slice(start));
  }
  const keep = records.map((r, i) => ({ r, raw: raws[i]! })).filter(({ r }) => r.some((c) => c.trim() !== ''));
  const [head, ...body] = keep;
  return { header: (head?.r ?? []).map((h) => h.trim()), rows: body.map(({ r }) => r), lines: body.map(({ raw }) => raw) };
}

export type ColumnType = 'money' | 'number' | 'date' | 'text';

export interface ColumnProfile {
  readonly name: string;
  readonly type: ColumnType;
  /** Cells that do not fit the column's type, with their row number (1-based, after the header). */
  readonly problems: readonly { readonly row: number; readonly value: string }[];
}

const MONEY = /^-?\$\s?-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\$\s?-?\d+(\.\d+)?$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Types each column by most of its non-empty cells and lists the cells that disagree. */
export function profileColumns(table: ParsedTable): ColumnProfile[] {
  return table.header.map((name, col) => {
    const cells = table.rows.map((r, i) => ({ row: i + 1, value: (r[col] ?? '').trim() })).filter((c) => c.value !== '');
    const fits = (t: ColumnType, v: string) => (t === 'money' ? MONEY.test(v) : t === 'number' ? NUMBER.test(v) : t === 'date' ? ISO_DATE.test(v) : true);
    const moneyHeader = /cost|price|amount|金额|价/i.test(name);
    const type: ColumnType =
      cells.length && cells.filter((c) => fits('money', c.value)).length >= cells.length / 2 ? 'money'
      : cells.length && moneyHeader && cells.filter((c) => fits('number', c.value) || fits('money', c.value)).length >= cells.length / 2 ? 'money'
      : cells.length && cells.filter((c) => fits('number', c.value)).length >= cells.length / 2 ? 'number'
      : cells.length && cells.filter((c) => fits('date', c.value)).length >= cells.length / 2 ? 'date'
      : 'text';
    const problems = type === 'text' ? [] : cells.filter((c) => !(fits(type, c.value) || (type === 'money' && fits('number', c.value))));
    return { name, type, problems };
  });
}

/**
 * Integer minor units from `$1,234.56` / `1234.56`; null when it is not exactly a money value.
 * Commas count only as thousands separators, so `$2,40` is rejected rather than read as 240.
 */
export function toCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^-?\$?\s?(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(trimmed)) return null;
  const v = trimmed.replace(/[$,\s]/g, '');
  const [whole, frac = ''] = v.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return v.startsWith('-') ? -cents : cents;
}

const PREDICATE_LABELS: Record<string, Bilingual> = {
  unit_cost: { zh: '进价', en: 'Unit cost' },
  cost: { zh: '进价', en: 'Cost' },
  price: { zh: '价格', en: 'Price' },
  lead_time_days: { zh: '到货天数', en: 'Lead time (days)' },
  lead_time: { zh: '到货天数', en: 'Lead time' },
  min_order_qty: { zh: '起订量', en: 'Minimum order' },
  pack_size: { zh: '包装规格', en: 'Pack size' },
};

export const predicateLabel = (column: string): Bilingual => PREDICATE_LABELS[column.toLowerCase()] ?? { zh: column, en: column };

export interface TableToClaimsInput {
  readonly projectId: string;
  readonly sourceId: string;
  readonly table: ParsedTable;
  readonly profiles: readonly ColumnProfile[];
  /** The column whose values are record keys, and the business object they belong to. */
  readonly keyColumn: string;
  readonly subjectKind: string;
  readonly labelOf: (key: string) => string;
  /** The column saying from when a row holds; without it, the whole table holds from `observedAt`. */
  readonly validFromColumn: string | null;
  readonly currency: string;
  readonly observedAt: string;
  readonly hash: (text: string) => string;
  readonly newId: () => string;
}

/** One candidate per (row, value column), each pointing at its row's provenance record. */
export function tableToClaims(input: TableToClaimsInput): { candidates: ClaimCandidate[]; provenance: ProvenanceRecord[] } {
  const col = (name: string) => input.table.header.indexOf(name);
  const keyAt = col(input.keyColumn);
  const fromAt = input.validFromColumn ? col(input.validFromColumn) : -1;
  const valueColumns = input.profiles.filter((p) => p.name !== input.keyColumn && p.name !== input.validFromColumn);
  const candidates: ClaimCandidate[] = [];
  const provenance: ProvenanceRecord[] = [];
  input.table.rows.forEach((row, i) => {
    const key = (row[keyAt] ?? '').trim();
    if (!key) return;
    const validFrom = fromAt >= 0 && ISO_DATE.test((row[fromAt] ?? '').trim()) ? `${row[fromAt]!.trim()}T00:00:00.000Z` : input.observedAt;
    const excerpt = input.table.lines[i] ?? row.join(',');
    const prov: ProvenanceRecord = {
      id: input.newId(),
      projectId: input.projectId,
      sourceId: input.sourceId,
      locator: `row ${i + 2}`,
      hash: input.hash(`${input.table.header.join(',')}\n${excerpt}`),
      excerpt,
      observedAt: input.observedAt,
    };
    provenance.push(prov);
    for (const p of valueColumns) {
      const raw = (row[col(p.name)] ?? '').trim();
      if (!raw) continue;
      let value: ClaimValue | null;
      if (p.type === 'money') {
        const cents = toCents(raw);
        value = cents === null ? null : { type: 'money', value: cents, unit: input.currency };
      } else if (p.type === 'number') value = NUMBER.test(raw) ? { type: 'number', value: Number(raw) } : null;
      else if (p.type === 'date') value = ISO_DATE.test(raw) ? { type: 'date', value: raw } : null;
      else value = { type: 'text', value: raw };
      if (!value) continue; // A cell that does not fit its column stays a reported problem, never a claim.
      candidates.push({
        projectId: input.projectId,
        subject: { kind: input.subjectKind, ref: key, label: input.labelOf(key) },
        predicate: p.name.toLowerCase(),
        predicateLabel: predicateLabel(p.name),
        value,
        kind: 'ASSERTION',
        validFrom,
        recordedAt: input.observedAt,
        provenanceIds: [prov.id],
        sourceId: input.sourceId,
      });
    }
  });
  return { candidates, provenance };
}

/** Finds the column whose values are keys of one of the application's objects. */
export function matchKeyColumn(
  table: ParsedTable,
  objects: readonly { readonly id: string; readonly keys: ReadonlySet<string> }[],
): { column: string; objectId: string; matched: number; total: number } | null {
  let best: { column: string; objectId: string; matched: number; total: number } | null = null;
  table.header.forEach((column, c) => {
    const values = table.rows.map((r) => (r[c] ?? '').trim()).filter(Boolean);
    if (!values.length) return;
    for (const o of objects) {
      const matched = values.filter((v) => o.keys.has(v)).length;
      if (matched > 0 && matched >= values.length / 2 && (!best || matched > best.matched)) best = { column, objectId: o.id, matched, total: values.length };
    }
  });
  return best;
}

export function findValidFromColumn(profiles: readonly ColumnProfile[]): string | null {
  return profiles.find((p) => p.type === 'date' && /valid|effective|from|start|生效/i.test(p.name))?.name
    ?? profiles.find((p) => p.type === 'date')?.name
    ?? null;
}
