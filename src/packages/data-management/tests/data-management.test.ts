import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decideClaim,
  findValidFromColumn,
  ingestClaims,
  matchKeyColumn,
  parseCsv,
  profileColumns,
  queryClaims,
  tableToClaims,
  toCents,
  type KnowledgeClaim,
} from '../index.js';

let n = 0;
const newId = () => `id-${++n}`;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

function quotes(csv: string, sourceId: string, observedAt: string) {
  const table = parseCsv(csv);
  const profiles = profileColumns(table);
  return tableToClaims({
    projectId: 'p', sourceId, table, profiles, keyColumn: 'sku', subjectKind: 'products', labelOf: (k) => k,
    validFromColumn: findValidFromColumn(profiles), currency: 'USD', observedAt, hash: sha, newId,
  });
}

const AUGUST = '﻿sku,unit_cost,lead_time_days,valid_from\r\nWHT-SILVER-1LB,"$31.40",12,2026-08-01\r\nHRB-ROOIBO-1LB,$7.10,6,2026-08-01\r\n';
const SEPTEMBER = 'sku,unit_cost,lead_time_days,valid_from\nWHT-SILVER-1LB,$32.90,12,2026-09-01\nHRB-ROOIBO-1LB,$7.10,6,2026-09-01\n';

const verifyAll = (claims: KnowledgeClaim[]) =>
  claims.reduce((acc, c) => (c.status === 'PROPOSED' ? (decideClaim(acc, c.id, 'VERIFY', 'owner', c.recordedAt) as { claims: KnowledgeClaim[] }).claims : acc), claims);
const cost = (claims: KnowledgeClaim[], asOf: string, knownAt?: string) =>
  queryClaims(claims, { subjectRef: 'WHT-SILVER-1LB', predicate: 'unit_cost', asOf, ...(knownAt ? { knownAt } : {}) }).map((c) => c.value.value);

describe('tables people attach (T3-003, T3-004)', () => {
  it('parses a BOM, quoted commas and quotes exactly, and types columns by their values', () => {
    const table = parseCsv('﻿name,note,amount\r\n"Leafline, Ltd","said ""ok""","$1,250.00"\r\nCedar,plain,$12.50\r\n\r\n');
    expect(table.header).toEqual(['name', 'note', 'amount']);
    expect(table.rows).toEqual([['Leafline, Ltd', 'said "ok"', '$1,250.00'], ['Cedar', 'plain', '$12.50']]);
    expect(profileColumns(table).map((p) => p.type)).toEqual(['text', 'text', 'money']);
    expect([toCents('$1,250.00'), toCents('12.5'), toCents('12.505'), toCents('abc')]).toEqual([125000, 1250, null, null]);
    const bad = profileColumns(parseCsv('sku,unit_cost\nA,$1.00\nB,$2.00\nC,call us\n'));
    expect(bad[1]).toMatchObject({ type: 'money', problems: [{ row: 3, value: 'call us' }] });
  });

  it('finds which column holds the application’s record keys', () => {
    const table = parseCsv(AUGUST);
    expect(matchKeyColumn(table, [{ id: 'products', keys: new Set(['WHT-SILVER-1LB', 'HRB-ROOIBO-1LB']) }, { id: 'orders', keys: new Set(['1001']) }]))
      .toEqual({ column: 'sku', objectId: 'products', matched: 2, total: 2 });
    expect(matchKeyColumn(table, [{ id: 'orders', keys: new Set(['1001']) }])).toBeNull();
  });
});

describe('knowledge claims on two time axes (T7-003, T7-004, T7-005)', () => {
  it('turns each cell into a claim pointing at its row, and never records the same statement twice', () => {
    const aug = quotes(AUGUST, 'leafline', '2026-08-02T09:00:00.000Z');
    expect(aug.candidates).toHaveLength(4);
    expect(aug.candidates[0]).toMatchObject({ predicate: 'unit_cost', value: { type: 'money', value: 3140, unit: 'USD' }, validFrom: '2026-08-01T00:00:00.000Z', predicateLabel: { zh: '进价' } });
    expect(aug.provenance[0]).toMatchObject({ locator: 'row 2', excerpt: 'WHT-SILVER-1LB,"$31.40",12,2026-08-01' });
    const first = ingestClaims([], aug.candidates, newId);
    const again = ingestClaims(first.claims, quotes(AUGUST, 'leafline', '2026-08-03T09:00:00.000Z').candidates, newId);
    expect([first.added.length, again.added.length, again.duplicates]).toEqual([4, 0, 4]);
  });

  it('answers the current cost after a newer quote, and the August cost as known in August', () => {
    let claims = verifyAll(ingestClaims([], quotes(AUGUST, 'leafline', '2026-08-02T09:00:00.000Z').candidates, newId).claims);
    const sep = ingestClaims(claims, quotes(SEPTEMBER, 'leafline', '2026-09-02T09:00:00.000Z').candidates, newId);
    expect(sep.superseded.map((c) => c.status)).toEqual(['SUPERSEDED', 'SUPERSEDED', 'SUPERSEDED', 'SUPERSEDED']);
    claims = verifyAll(sep.claims);
    expect(cost(claims, '2026-09-15T00:00:00.000Z')).toEqual([3290]);
    expect(cost(claims, '2026-08-15T00:00:00.000Z')).toEqual([3140]);
    // Asked on 1 September what was believed on 1 September: the newer quote was not known yet.
    expect(cost(claims, '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z')).toEqual([3140]);
    // Nothing is known before it was recorded.
    expect(cost(claims, '2026-08-15T00:00:00.000Z', '2026-08-01T00:00:00.000Z')).toEqual([]);
  });

  it('marks a statement confirmed after a newer one replaced it as replaced, not current', () => {
    const aug = ingestClaims([], quotes(AUGUST, 'leafline', '2026-08-02T09:00:00.000Z').candidates, newId);
    const sep = ingestClaims(aug.claims, quotes(SEPTEMBER, 'leafline', '2026-09-02T09:00:00.000Z').candidates, newId);
    const claims = verifyAll(sep.claims);
    const august = claims.filter((c) => c.validFrom.startsWith('2026-08'));
    expect(new Set(august.map((c) => c.status))).toEqual(new Set(['SUPERSEDED']));
    expect(cost(claims, '2026-08-15T00:00:00.000Z')).toEqual([3140]);
    expect(cost(claims, '2026-09-15T00:00:00.000Z')).toEqual([3290]);
  });

  it('closes an older sheet that arrives after a newer one at the newer one’s start', () => {
    let claims = verifyAll(ingestClaims([], quotes(SEPTEMBER, 'leafline', '2026-09-02T09:00:00.000Z').candidates, newId).claims);
    const late = ingestClaims(claims, quotes(AUGUST, 'leafline', '2026-09-03T09:00:00.000Z').candidates, newId);
    expect(late.disputed).toEqual([]);
    claims = verifyAll(late.claims);
    expect(cost(claims, '2026-09-15T00:00:00.000Z')).toEqual([3290]);
    expect(cost(claims, '2026-08-15T00:00:00.000Z')).toEqual([3140]);
  });

  it('stops citing a retired statement as current, while it stays true for its past', () => {
    const claims = verifyAll(ingestClaims([], quotes(SEPTEMBER, 'leafline', '2026-09-02T09:00:00.000Z').candidates, newId).claims);
    const lead = claims.find((c) => c.subject.ref === 'WHT-SILVER-1LB' && c.predicate === 'lead_time_days')!;
    const retired = decideClaim(claims, lead.id, 'RETIRE', 'owner', '2026-10-01T00:00:00.000Z') as { claims: KnowledgeClaim[] };
    const q = (asOf: string, knownAt?: string) => queryClaims(retired.claims, { subjectRef: 'WHT-SILVER-1LB', predicate: 'lead_time_days', asOf, ...(knownAt ? { knownAt } : {}) }).length;
    expect([q('2026-10-05T00:00:00.000Z'), q('2026-09-20T00:00:00.000Z'), q('2026-10-05T00:00:00.000Z', '2026-09-30T00:00:00.000Z')]).toEqual([0, 1, 1]);
    expect(decideClaim(retired.claims, lead.id, 'RETIRE', 'owner', '2026-10-02T00:00:00.000Z')).toEqual({ error: 'NOT_ALLOWED' });
  });
});

describe('conflicting statements (T7-006, T5-008)', () => {
  it('marks both sides disputed instead of overwriting, and resolves them only by a person', () => {
    const sheet = ingestClaims([], quotes(SEPTEMBER, 'leafline', '2026-09-02T09:00:00.000Z').candidates, newId);
    const email = ingestClaims(sheet.claims, quotes('sku,unit_cost,valid_from\nWHT-SILVER-1LB,$30.90,2026-09-01\nHRB-ROOIBO-1LB,$7.10,2026-09-01\n', 'leafline-email', '2026-09-03T09:00:00.000Z').candidates, newId);
    expect(email.disputed.map((c) => [c.sourceId, c.value.value]).sort()).toEqual([['leafline', 3290], ['leafline-email', 3090]]);
    const agreeing = email.claims.filter((c) => c.subject.ref === 'HRB-ROOIBO-1LB' && c.predicate === 'unit_cost');
    expect(agreeing.map((c) => c.status)).toEqual(['PROPOSED', 'PROPOSED']);
    expect(cost(email.claims, '2026-09-10T00:00:00.000Z').sort()).toEqual([3090, 3290]);
    const chosen = email.disputed.find((c) => c.sourceId === 'leafline-email')!;
    const decided = decideClaim(email.claims, chosen.id, 'VERIFY', 'owner', '2026-09-04T00:00:00.000Z') as { claims: KnowledgeClaim[]; changed: KnowledgeClaim[] };
    expect(decided.changed.map((c) => [c.sourceId, c.status])).toEqual([['leafline-email', 'VERIFIED'], ['leafline', 'REJECTED']]);
    expect(cost(decided.claims, '2026-09-10T00:00:00.000Z')).toEqual([3090]);
  });
});
