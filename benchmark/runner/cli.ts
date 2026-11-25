import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSmokeSuite } from './run.js';

/**
 * pnpm benchmark:smoke [-- --post http://127.0.0.1:4310]
 * Writes the report to benchmark/reports/ and, with --post, archives it in Ontology Plus so
 * 平台治理 → 评测基准 shows it. Exits non-zero when any case fails.
 */
const args = process.argv.slice(2);
const post = args.includes('--post') ? args[args.indexOf('--post') + 1] : undefined;
const report = await runSmokeSuite();
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'reports');
mkdirSync(dir, { recursive: true });
const file = join(dir, `${report.campaignId}-${report.createdAt.replace(/[:.]/g, '-')}.json`);
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
for (const r of report.results) {
  console.log(`${r.status.padEnd(11)} ${r.taskId}  ${r.title.en}${r.status === 'FAIL' ? `  ← ${r.checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.evidence}`).join('; ')}` : ''}`);
}
console.log(`\n${report.summary.pass} pass · ${report.summary.fail} fail · ${report.summary.notRun} not run · ${report.summary.infraError} infra errors → ${file}`);
if (post) {
  const res = await fetch(`${post.replace(/\/+$/, '')}/api/benchmark/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) });
  console.log(res.ok ? `archived in ${post}` : `archiving failed: ${res.status}`);
}
process.exit(report.summary.fail + report.summary.infraError > 0 ? 1 : 0);
