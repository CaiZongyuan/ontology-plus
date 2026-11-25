import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { openTeacoRepository, type TeacoRepository } from '../../examples/teaco/app/db.js';
import { createTeacoRuntimeApp } from '../../examples/teaco/app/runtime.js';
import { seedIfEmpty } from '../../examples/teaco/app/seed.js';
import type { Revision } from '../../examples/teaco/domain/index.js';
import { createWorkspaceStore, type WorkspaceStore } from '../../src/packages/workspace-store/index.js';
import { createApiApp } from '../../src/server/app.js';

/**
 * One isolated evaluation environment (spec §12.3): a fresh TeaCo reference app on its own
 * database file with a fixed clock, a fresh in-memory Ontology Plus workspace connected to it, and
 * an independent read-only channel to TeaCo's database for the verifier. Nothing is shared between
 * cases, so no case can change another case's counts.
 */
export const SEED_DIR = fileURLToPath(new URL('../datasets/bb-seed0/', import.meta.url));
export const FIXED_CLOCK = '2026-09-10T09:00:00.000Z';

export interface Env {
  readonly store: WorkspaceStore;
  readonly projectId: string;
  readonly repository: TeacoRepository;
  /** The scripted operator's only channel: Ontology Plus's public HTTP API. */
  call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  readonly base: string;
  /** The verifier's channel: TeaCo's own database, opened separately and read only. */
  sql<T = Record<string, unknown>>(query: string, ...params: (string | number)[]): T[];
  /** Puts the reference app on another requirement version, as its operator would. */
  setRevision(revision: Revision): void;
  readonly dbPath: string;
  dispose(): void;
}

export function datasetFingerprint(): string {
  const hash = createHash('sha256');
  for (const f of ['customers.csv', 'products.csv', 'order_lines.csv']) hash.update(readFileSync(join(SEED_DIR, f)));
  return `sha256:${hash.digest('hex')}`;
}

export async function createEnv(): Promise<Env> {
  const dir = mkdtempSync(join(tmpdir(), 'teaco-bench-'));
  const dbPath = join(dir, 'teaco.sqlite');
  const repository = openTeacoRepository(dbPath);
  await seedIfEmpty(repository, SEED_DIR, '2026-09-10T08:00:00.000Z');
  const teaco = { revision: 'v1' as Revision };
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  const api = createApiApp(store, {
    connectedAppFetch: async (input, init) => {
      const url = new URL(input);
      return createTeacoRuntimeApp({ repository, revision: teaco.revision, now: () => new Date(FIXED_CLOCK) }).request(url.pathname + url.search, init);
    },
  });
  const projectId = store.listProjects()[0]!.id;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await api.request(path, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  const base = `/api/projects/${projectId}`;
  const connected = await call('POST', `${base}/connected-app`, { baseUrl: 'teaco.local' });
  if (connected.status !== 201) throw new Error(`connect failed: ${JSON.stringify(connected.body)}`);
  const reader = new DatabaseSync(dbPath, { readOnly: true });
  return {
    store, projectId, repository, call, base, dbPath,
    sql: <T,>(query: string, ...params: (string | number)[]) => reader.prepare(query).all(...params) as T[],
    setRevision: (r) => {
      teaco.revision = r;
    },
    dispose: () => {
      reader.close();
      try {
        repository.close();
      } catch {
        // A case may have closed it already (the restart check).
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
