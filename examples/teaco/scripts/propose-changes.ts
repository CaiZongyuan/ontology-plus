import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Records TeaCo's requirement changes v2–v4 (Business Bench changes 1–3, with their acceptance
 * items #27–35) as change proposals of an Ontology Plus project, as a requirement owner would.
 *
 *   pnpm teaco:changes -- --project <projectId> [--api http://127.0.0.1:4310]
 */
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const project = option('project');
const api = (option('api') ?? 'http://127.0.0.1:4310').replace(/\/+$/, '');
if (!project) {
  console.error('Usage: pnpm teaco:changes -- --project <projectId> [--api http://127.0.0.1:4310]');
  process.exit(1);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'changes');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const body = readFileSync(join(dir, file), 'utf8');
  const res = await fetch(`${api}/api/projects/${encodeURIComponent(project)}/change-proposals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  const out = (await res.json()) as { proposal?: { targetVersion: string; checks: unknown[] }; error?: unknown };
  if (!res.ok || !out.proposal) {
    console.error(`${file}: ${res.status} ${JSON.stringify(out.error ?? out)}`);
    process.exit(1);
  }
  console.log(`${out.proposal.targetVersion}: recorded with ${out.proposal.checks.length} acceptance checks`);
}
