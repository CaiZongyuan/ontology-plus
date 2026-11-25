import { describe, expect, it } from 'vitest';
import { SMOKE_CASES } from '../../benchmark/runner/cases.js';
import { createEnv } from '../../benchmark/runner/env.js';
import { runSmokeSuite } from '../../benchmark/runner/run.js';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

/**
 * The deterministic gate (spec §16.2, §14.1): the smoke suite passes against the reference app with
 * a scripted operator, cases that need a model stay NOT_RUN, and the verifier is shown not to trust
 * the operator (spec §17.3).
 */
describe('TeaCo smoke suite', () => {
  it('passes every case it can run, and says why the others did not run', async () => {
    const report = await runSmokeSuite();
    expect(report.results).toHaveLength(24);
    expect(report.summary).toEqual({ pass: 20, fail: 0, notRun: 4, infraError: 0 });
    expect(report.results.filter((r) => r.status === 'NOT_RUN').map((r) => r.taskId)).toEqual(['T1-002', 'T1-004', 'T1-005', 'T2-003']);
    expect(report.results.filter((r) => r.status === 'NOT_RUN').every((r) => r.reason?.zh && r.reason.en)).toBe(true);
    expect(report.environment.datasetFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Archived for 平台治理 → 评测基准; a report that claims more than its checks show is refused.
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const api = createApiApp(store);
    const post = (body: unknown) => Promise.resolve(api.request('/api/benchmark/reports', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
    expect((await post(report)).status).toBe(201);
    const listed = (await (await api.request('/api/benchmark/reports')).json()) as { reports: { id: string; summary: unknown }[] };
    expect(listed.reports.map((r) => [r.id, r.summary])).toEqual([[report.id, report.summary]]);
    const inflated = { ...report, id: 'x', results: report.results.map((r) => (r.status === 'NOT_RUN' ? { ...r, status: 'PASS' } : r)) };
    expect((await post(inflated)).status).toBe(422);
  }, 120000);

  it('fails a case when the operator only claims to have acted (verifier self-test)', async () => {
    const env = await createEnv();
    try {
      const real = env.call;
      // Approvals "succeed" without reaching the application.
      const liar = Object.assign(Object.create(Object.getPrototypeOf(env)), env, {
        call: async (method: string, path: string, body?: unknown) =>
          path.endsWith('/approve') ? { status: 200, body: { invocation: { status: 'VERIFIED', idempotencyKey: 'x' } } } : real(method, path, body),
      });
      const ship = SMOKE_CASES.find((c) => c.id === 'T6-004')!;
      const checks = await ship.run!(liar);
      expect(checks.find((c) => c.id === 'verified')!.passed).toBe(true);
      expect(checks.find((c) => c.id === 'state')!.passed).toBe(false);
      expect(checks.find((c) => c.id === 'stock-deltas')!.passed).toBe(false);
    } finally {
      env.dispose();
    }
  }, 30000);
});
