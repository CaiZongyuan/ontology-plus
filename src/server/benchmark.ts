import type { Hono } from 'hono';
import { z } from 'zod';
import type { BenchmarkReportRecord, WorkspaceStore } from '../packages/workspace-store/index.js';

/**
 * Archived evaluation reports for 平台治理 → 评测基准 (TeaCo spec §12.4, U-16). Reports come from
 * real runs of the benchmark runner; the platform only stores and shows them, and never makes up a
 * result for a case that was not run.
 */
const Bilingual = z.object({ zh: z.string(), en: z.string() });
const ReportSchema = z.object({
  id: z.string().min(1),
  campaignId: z.string().min(1),
  suite: Bilingual,
  createdAt: z.string().min(1),
  environment: z.record(z.unknown()),
  results: z.array(z.object({
    taskId: z.string().min(1),
    track: z.string(),
    title: Bilingual,
    campaignType: z.string(),
    status: z.enum(['PASS', 'FAIL', 'NOT_RUN', 'INFRA_ERROR', 'TIMEOUT', 'POLICY_VIOLATION']),
    checks: z.array(z.object({ id: z.string(), passed: z.boolean(), evidence: z.string() })),
    reason: Bilingual.optional(),
    wallClockMs: z.number(),
  })).min(1),
  summary: z.object({ pass: z.number(), fail: z.number(), notRun: z.number(), infraError: z.number() }),
}).superRefine((r, ctx) => {
  // A PASS needs at least one check and all of them passed; the summary must match the cases.
  for (const x of r.results) {
    if (x.status === 'PASS' && (x.checks.length === 0 || x.checks.some((c) => !c.passed))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${x.taskId} is PASS without passing checks` });
    }
  }
  const count = (s: string) => r.results.filter((x) => x.status === s).length;
  if (count('PASS') !== r.summary.pass || count('FAIL') !== r.summary.fail || count('NOT_RUN') !== r.summary.notRun) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'summary does not match the results' });
  }
});

export function registerBenchmarkRoutes(app: Hono, store: WorkspaceStore): void {
  app.get('/api/benchmark/reports', (c) => c.json({ reports: store.listBenchmarkReports() }));

  app.post('/api/benchmark/reports', async (c) => {
    const parsed = ReportSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'INVALID_REPORT', problems: parsed.error.issues.map((i) => i.message) } }, 422);
    return c.json({ report: store.saveBenchmarkReport(parsed.data as BenchmarkReportRecord) }, 201);
  });
}
