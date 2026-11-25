/**
 * Knowledge Claims with provenance and two time axes (TeaCo spec §10.5, GLOSSARY: Provenance
 * Record, Knowledge Claim). `validFrom/validTo` is when a statement holds in the world;
 * `recordedAt` is when Ontology Plus learned it. A question is answered `asOf` a moment in the
 * world and `knownAt` a moment of knowledge, so nothing can be learned from the future. Conflicts
 * are never overwritten silently, and no claim ever changes business execution by itself.
 */
export interface Bilingual {
  readonly zh: string;
  readonly en: string;
}

export type ClaimKind = 'OBSERVATION' | 'ASSERTION' | 'INFERENCE' | 'HYPOTHESIS';
export type ClaimStatus = 'PROPOSED' | 'VERIFIED' | 'DISPUTED' | 'REJECTED' | 'SUPERSEDED' | 'RETIRED';

export interface ClaimSubject {
  /** The business object kind as the application names it, e.g. `products`. */
  readonly kind: string;
  readonly ref: string;
  readonly label: string;
}

export interface ClaimValue {
  readonly type: 'money' | 'number' | 'text' | 'date';
  readonly value: string | number;
  /** ISO currency for money (minor units), or a unit for numbers. */
  readonly unit?: string;
}

export interface KnowledgeClaim {
  readonly id: string;
  readonly projectId: string;
  readonly subject: ClaimSubject;
  /** A stable predicate key, e.g. `unit_cost`, with a business label. */
  readonly predicate: string;
  readonly predicateLabel: Bilingual;
  readonly value: ClaimValue;
  readonly kind: ClaimKind;
  readonly status: ClaimStatus;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly recordedAt: string;
  /**
   * When `validTo` became known, if a later statement or a retirement set it. Before that moment
   * of knowledge the claim was believed open-ended, which is what a `knownAt` query must see.
   */
  readonly closedAt: string | null;
  readonly supersedesId: string | null;
  readonly provenanceIds: readonly string[];
  /** Which source family the claim comes from; supersession only happens within one family. */
  readonly sourceId: string;
  readonly reviewer: string | null;
  readonly reviewedAt: string | null;
  readonly note: Bilingual | null;
}

export interface ProvenanceRecord {
  readonly id: string;
  readonly projectId: string;
  readonly sourceId: string;
  /** Where in the source: `row 3`, `paragraph 2`, `event <id>`. */
  readonly locator: string;
  /** sha256 of the exact excerpt, so the same statement is never recorded twice. */
  readonly hash: string;
  readonly excerpt: string;
  readonly observedAt: string;
}

export type ClaimCandidate = Omit<KnowledgeClaim, 'id' | 'status' | 'supersedesId' | 'reviewer' | 'reviewedAt' | 'note' | 'validTo' | 'closedAt'> & {
  readonly validTo?: string | null;
};

const sameFact = (a: Pick<KnowledgeClaim, 'subject' | 'predicate'>, b: Pick<KnowledgeClaim, 'subject' | 'predicate'>) =>
  a.subject.kind === b.subject.kind && a.subject.ref === b.subject.ref && a.predicate === b.predicate;

const sameValue = (a: ClaimValue, b: ClaimValue) => a.type === b.type && a.value === b.value && (a.unit ?? '') === (b.unit ?? '');

/** The end of validity as known at `knownAt`: a closing learned later did not exist yet. */
const validToKnown = (c: KnowledgeClaim, knownAt: string) => (c.closedAt && knownAt < c.closedAt ? null : c.validTo);

const overlaps = (a: { validFrom: string; validTo: string | null }, b: { validFrom: string; validTo: string | null }) =>
  a.validFrom < (b.validTo ?? '￿') && b.validFrom < (a.validTo ?? '￿');

const live = (c: KnowledgeClaim) => c.status !== 'REJECTED' && c.status !== 'RETIRED';

export interface IngestResult {
  /** Every claim after ingestion: unchanged ones, updated ones and the new ones. */
  readonly claims: KnowledgeClaim[];
  readonly added: KnowledgeClaim[];
  /** Candidates already known (same statement, same validity, same evidence): nothing was added. */
  readonly duplicates: number;
  /** Claims that now disagree with another source about the same fact and time. */
  readonly disputed: KnowledgeClaim[];
  /** Claims whose validity was closed by a newer statement from the same source family. */
  readonly superseded: KnowledgeClaim[];
}

/**
 * Adds candidate claims to the known set. Within one source family a later `validFrom` closes the
 * earlier claim (it stays true for its own period); across families a different value for the
 * same fact and time makes both DISPUTED until a person decides. New claims start PROPOSED.
 */
export function ingestClaims(
  existing: readonly KnowledgeClaim[],
  candidates: readonly ClaimCandidate[],
  newId: () => string,
): IngestResult {
  const claims = existing.map((c) => ({ ...c }));
  const added: KnowledgeClaim[] = [];
  const disputed = new Map<string, KnowledgeClaim>();
  const superseded = new Map<string, KnowledgeClaim>();
  let duplicates = 0;
  const replace = (next: KnowledgeClaim) => {
    const i = claims.findIndex((c) => c.id === next.id);
    claims[i] = next;
    return next;
  };

  for (const cand of [...candidates].sort((a, b) => a.validFrom.localeCompare(b.validFrom))) {
    const known = claims.find(
      (c) => sameFact(c, cand) && sameValue(c.value, cand.value) && c.validFrom === cand.validFrom && c.sourceId === cand.sourceId && live(c),
    );
    if (known) {
      duplicates += 1;
      continue;
    }
    let claim: KnowledgeClaim = {
      ...cand,
      id: newId(),
      status: 'PROPOSED',
      validTo: cand.validTo ?? null,
      closedAt: null,
      supersedesId: null,
      reviewer: null,
      reviewedAt: null,
      note: null,
    };
    // Same family, earlier start: the newer statement takes over from its start.
    for (const prior of claims.filter((c) => sameFact(c, cand) && c.sourceId === cand.sourceId && live(c) && c.validFrom < cand.validFrom && (c.validTo === null || c.validTo > cand.validFrom))) {
      superseded.set(prior.id, replace({ ...prior, validTo: cand.validFrom, closedAt: cand.recordedAt, status: prior.status === 'VERIFIED' ? 'SUPERSEDED' : prior.status }));
      claim = { ...claim, supersedesId: prior.id };
    }
    // An older statement that arrives late ends where the family's next statement begins.
    const next = claims
      .filter((c) => sameFact(c, cand) && c.sourceId === cand.sourceId && live(c) && c.validFrom > cand.validFrom)
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0];
    if (next && (claim.validTo === null || claim.validTo > next.validFrom)) claim = { ...claim, validTo: next.validFrom, closedAt: cand.recordedAt };
    // Other families saying something else about the same fact and time.
    for (const other of claims.filter((c) => sameFact(c, cand) && c.sourceId !== cand.sourceId && live(c) && c.status !== 'SUPERSEDED' && overlaps(c, claim) && !sameValue(c.value, cand.value))) {
      disputed.set(other.id, replace({ ...other, status: 'DISPUTED' }));
      claim = { ...claim, status: 'DISPUTED' };
    }
    claims.push(claim);
    added.push(claim);
    if (claim.status === 'DISPUTED') disputed.set(claim.id, claim);
  }
  return { claims, added, duplicates, disputed: [...disputed.values()], superseded: [...superseded.values()] };
}

export type ClaimDecision = 'VERIFY' | 'REJECT' | 'RETIRE';

/**
 * A person's decision on a claim. Verifying one side of a dispute rejects the claims it disagreed
 * with; retiring ends a verified claim's validity at `at`, so it is no longer current but stays
 * true for its past.
 */
export function decideClaim(
  claims: readonly KnowledgeClaim[],
  id: string,
  decision: ClaimDecision,
  reviewer: string,
  at: string,
  note: Bilingual | null = null,
): { claims: KnowledgeClaim[]; changed: KnowledgeClaim[] } | { error: 'NOT_FOUND' | 'NOT_ALLOWED' } {
  const target = claims.find((c) => c.id === id);
  if (!target) return { error: 'NOT_FOUND' };
  const changed: KnowledgeClaim[] = [];
  const next = claims.map((c) => ({ ...c }));
  const set = (c: KnowledgeClaim) => {
    next[next.findIndex((x) => x.id === c.id)] = c;
    changed.push(c);
  };
  const base = { reviewer, reviewedAt: at, note };
  if (decision === 'VERIFY') {
    if (target.status !== 'PROPOSED' && target.status !== 'DISPUTED') return { error: 'NOT_ALLOWED' };
    // A statement a newer one already took over from counts for its own period only.
    set({ ...target, ...base, status: target.closedAt !== null && target.validTo !== null ? 'SUPERSEDED' : 'VERIFIED' });
    for (const other of claims.filter((c) => c.id !== id && sameFact(c, target) && c.status === 'DISPUTED' && overlaps(c, target) && !sameValue(c.value, target.value))) {
      set({ ...other, ...base, status: 'REJECTED', note: { zh: '与已确认的说法冲突', en: 'Conflicts with the confirmed statement' } });
    }
  } else if (decision === 'REJECT') {
    if (target.status === 'RETIRED' || target.status === 'REJECTED') return { error: 'NOT_ALLOWED' };
    set({ ...target, ...base, status: 'REJECTED' });
  } else {
    if (target.status !== 'VERIFIED') return { error: 'NOT_ALLOWED' };
    const closes = !(target.validTo && target.validTo < at);
    set({ ...target, ...base, status: 'RETIRED', ...(closes ? { validTo: at, closedAt: at } : {}) });
  }
  return { claims: next, changed };
}

export interface ClaimQuery {
  readonly subjectRef?: string;
  readonly predicate?: string;
  /** The moment in the world the answer is about. */
  readonly asOf: string;
  /** Only what had been learned by this moment; everything known so far when absent. */
  readonly knownAt?: string;
  /** Include claims still waiting for review (marked as such by their status). */
  readonly includeProposed?: boolean;
}

/**
 * What was true `asOf`, as known `knownAt`. Verified, superseded (for their period) and retired
 * (before retirement) claims count; disputed claims are returned so the answer can say there is a
 * dispute; rejected ones never are.
 */
export function queryClaims(claims: readonly KnowledgeClaim[], q: ClaimQuery): KnowledgeClaim[] {
  const knownAt = q.knownAt ?? '\uffff';
  return claims
    .filter((c) => (!q.subjectRef || c.subject.ref === q.subjectRef) && (!q.predicate || c.predicate === q.predicate))
    .filter((c) => c.recordedAt <= knownAt)
    .filter((c) => {
      const end = validToKnown(c, knownAt);
      return c.validFrom <= q.asOf && (end === null || q.asOf < end);
    })
    .filter((c) => c.status === 'VERIFIED' || c.status === 'SUPERSEDED' || c.status === 'RETIRED' || c.status === 'DISPUTED' || (q.includeProposed === true && c.status === 'PROPOSED'))
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
}
