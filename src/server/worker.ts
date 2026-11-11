import { createWorkspaceStore, type WorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

export interface CloudflareD1Statement {
  bind(...values: unknown[]): CloudflareD1Statement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface CloudflareD1Database {
  prepare(query: string): CloudflareD1Statement;
  exec(query: string): Promise<unknown>;
}

export interface WorkerEnv {
  ONTOLOGY_DB?: CloudflareD1Database;
  [key: string]: unknown;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const WORKER_D1_BOOTSTRAP_DDL = [
  'CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL, center TEXT NOT NULL, domain TEXT NOT NULL, description TEXT NOT NULL, current_stage INTEGER NOT NULL, suite_json TEXT NOT NULL, changelog TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS workspace_entities (collection TEXT NOT NULL, item_id TEXT NOT NULL, project_id TEXT, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection, item_id));',
  'CREATE TABLE IF NOT EXISTS agent_checkpoints (session_id TEXT PRIMARY KEY, workflow TEXT NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS ea_relations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL, relation TEXT NOT NULL, label_zh TEXT NOT NULL, label_en TEXT NOT NULL, updated_at TEXT NOT NULL);',
].join(' ');

let edgeStore: WorkspaceStore | undefined;
let edgeApp: ReturnType<typeof createApiApp> | undefined;
let d1Bootstrapped = false;

function ensureWorkerApp(env?: WorkerEnv): ReturnType<typeof createApiApp> {
  if (!edgeStore) {
    edgeStore = createWorkspaceStore({
      dbPath: ':memory:',
      enableFileMirror: false,
      d1Database: env?.ONTOLOGY_DB,
    });
  }
  if (!edgeApp) {
    edgeApp = createApiApp(edgeStore);
  }
  return edgeApp;
}

export default {
  async fetch(
    request: Request,
    env?: WorkerEnv,
    ctx?: WorkerExecutionContext,
  ): Promise<Response> {
    const app = ensureWorkerApp(env);
    if (env?.ONTOLOGY_DB && !d1Bootstrapped) {
      d1Bootstrapped = true;
      const bootstrapTask = env.ONTOLOGY_DB.exec(WORKER_D1_BOOTSTRAP_DDL).catch(() => undefined);
      if (ctx?.waitUntil) {
        ctx.waitUntil(bootstrapTask);
      } else {
        await bootstrapTask;
      }
    }
    return app.fetch(request, env as Record<string, unknown>, ctx as never);
  },
};
