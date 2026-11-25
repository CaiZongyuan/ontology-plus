import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { REVISIONS, type Revision } from '../domain/index.js';
import { openTeacoRepository } from './db.js';
import { createTeacoRuntimeApp } from './runtime.js';
import { seedIfEmpty } from './seed.js';

/**
 * Local TeaCo process (spec §5.1, P0–P4 local-first). Listens on loopback only, because the
 * connection to Ontology Plus carries no authentication (spec v0.3.1, ADR 0020 amendment).
 *   TEACO_PORT (4320) · TEACO_REVISION (v1–v4, default v1) · TEACO_DB (examples/teaco/.data/teaco.sqlite)
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const port = Number(process.env.TEACO_PORT ?? 4320);
const revision = (process.env.TEACO_REVISION ?? 'v1') as Revision;
if (!REVISIONS.includes(revision)) throw new Error(`TEACO_REVISION must be one of ${REVISIONS.join(', ')}`);
const dbPath = process.env.TEACO_DB ?? resolve(here, '../.data/teaco.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

const repository = openTeacoRepository(dbPath);
const at = new Date().toISOString();
const seeded = await seedIfEmpty(repository, resolve(repoRoot, 'benchmark/datasets/bb-seed0'), at);
await repository.recordActivity({
  at, kind: 'info',
  text: { zh: `订单系统按需求 ${revision} 启动`, en: `Order system started on requirement ${revision}` },
});
const app = createTeacoRuntimeApp({ repository, revision });
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`TeaCo ${revision} on http://127.0.0.1:${port} (${seeded ? 'seeded from bb-seed0' : 'existing data'}; ${dbPath})`);
});
