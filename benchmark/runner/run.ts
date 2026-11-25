import { randomUUID } from 'node:crypto';
import { SMOKE_CASES, type Bilingual, type CampaignType, type CheckResult, type SmokeCase } from './cases.js';
import { createEnv, datasetFingerprint, FIXED_CLOCK } from './env.js';

/**
 * Runs the TeaCo smoke suite (spec §12.3–§12.4, §14.1): one fresh environment per case, a scripted
 * operator, an independent verifier. PASS needs at least one check and every check passed; a case
 * that could not be set up is INFRA_ERROR, never success.
 */
export type CaseStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'INFRA_ERROR';

export interface CaseResult {
  readonly taskId: string;
  readonly track: string;
  readonly title: Bilingual;
  readonly campaignType: CampaignType;
  readonly status: CaseStatus;
  readonly checks: readonly CheckResult[];
  readonly reason?: Bilingual;
  readonly wallClockMs: number;
}

export interface SmokeReport {
  readonly id: string;
  readonly campaignId: 'teaco-smoke-24';
  readonly suite: Bilingual;
  readonly createdAt: string;
  readonly environment: {
    readonly dataset: string;
    readonly datasetFingerprint: string;
    readonly application: string;
    readonly applicationRevision: string;
    readonly clock: string;
    readonly operator: Bilingual;
    readonly verifierVersion: string;
  };
  readonly results: readonly CaseResult[];
  readonly summary: { readonly pass: number; readonly fail: number; readonly notRun: number; readonly infraError: number };
}

async function runCase(c: SmokeCase): Promise<CaseResult> {
  const started = Date.now();
  const base = { taskId: c.id, track: c.track, title: c.title, campaignType: c.campaignType };
  if (!c.run) return { ...base, status: 'NOT_RUN', checks: [], ...(c.notRun ? { reason: c.notRun } : {}), wallClockMs: 0 };
  let env;
  try {
    env = await createEnv();
  } catch (err) {
    return { ...base, status: 'INFRA_ERROR', checks: [], reason: { zh: `环境没能准备好：${String(err)}`, en: `The environment could not be prepared: ${String(err)}` }, wallClockMs: Date.now() - started };
  }
  try {
    const checks = await c.run(env);
    const status: CaseStatus = checks.length > 0 && checks.every((x) => x.passed) ? 'PASS' : 'FAIL';
    return { ...base, status, checks, wallClockMs: Date.now() - started };
  } catch (err) {
    return { ...base, status: 'FAIL', checks: [{ id: 'completed', passed: false, evidence: err instanceof Error ? err.message : String(err) }], wallClockMs: Date.now() - started };
  } finally {
    env.dispose();
  }
}

export async function runSmokeSuite(cases: readonly SmokeCase[] = SMOKE_CASES): Promise<SmokeReport> {
  const results: CaseResult[] = [];
  for (const c of cases) results.push(await runCase(c));
  const count = (s: CaseStatus) => results.filter((r) => r.status === s).length;
  return {
    id: `bench-${randomUUID()}`,
    campaignId: 'teaco-smoke-24',
    suite: { zh: 'TeaCo 首轮冒烟（24 项）', en: 'TeaCo first smoke suite (24 cases)' },
    createdAt: new Date().toISOString(),
    environment: {
      dataset: 'bb-seed0',
      datasetFingerprint: datasetFingerprint(),
      application: 'TeaCo reference app',
      applicationRevision: 'v1',
      clock: FIXED_CLOCK,
      operator: { zh: '脚本操作员（不用语言模型）', en: 'Scripted operator (no language model)' },
      verifierVersion: '1',
    },
    results,
    summary: { pass: count('PASS'), fail: count('FAIL'), notRun: count('NOT_RUN'), infraError: count('INFRA_ERROR') },
  };
}
