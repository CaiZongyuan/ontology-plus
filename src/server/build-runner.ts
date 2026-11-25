import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import type { Hono } from 'hono';
import { ConnectionError, createConnectionClient } from '../packages/application-runtime/index.js';
import type { BuildRunRecord, WorkspaceStore } from '../packages/workspace-store/index.js';

/**
 * Preparing a project's runnable system on this machine (TeaCo spec U-02, §9.1 BuildRunner,
 * ADR 0019). It builds from the TeaCo reference implementation — not code written by an AI, which
 * needs a configured model — in an isolated workspace, starts it on a free loopback port, checks it
 * against Business Bench figures through the connection contract, and connects the project. Every
 * step is real and persisted with its timestamps, so the Delivery step shows true progress.
 */
export interface BuildRunnerOptions {
  /** Where workspaces are created; must sit inside the repository so dependencies resolve. */
  readonly workspacesRoot?: string;
  /** The repository root holding the reference implementation and seed data. */
  readonly repoRoot?: string;
}

const bi = (zh: string, en: string) => ({ zh, en });
const children = new Set<ChildProcess>();
let exitHookInstalled = false;

function stopChildrenOnExit() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const c of children) c.kill();
  });
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => done(port));
    });
  });
}

const countFiles = (dir: string): number =>
  readdirSync(dir).reduce((n, name) => n + (statSync(join(dir, name)).isDirectory() ? countFiles(join(dir, name)) : 1), 0);

const STEP_LABELS: Record<BuildRunRecord['steps'][number]['id'], { zh: string; en: string }> = {
  build: bi('按开发包搭建（用参考实现）', 'Build from the development package (reference implementation)'),
  start: bi('在本机启动', 'Start on this machine'),
  acceptance: bi('跑验收', 'Run acceptance checks'),
  connect: bi('接入核对', 'Connect and check'),
};

export function registerBuildRunnerRoutes(app: Hono, store: WorkspaceStore, options: BuildRunnerOptions = {}): void {
  const repoRoot = options.repoRoot ?? process.cwd();
  const workspacesRoot = options.workspacesRoot ?? resolve(repoRoot, '.onto-cs', 'workspaces');

  const update = (run: BuildRunRecord, patch: Partial<BuildRunRecord>) => store.saveBuildRun({ ...run, ...patch, updatedAt: new Date().toISOString() });
  const setStep = (run: BuildRunRecord, id: BuildRunRecord['steps'][number]['id'], patch: Partial<BuildRunRecord['steps'][number]>) =>
    update(run, { steps: run.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  async function execute(initial: BuildRunRecord): Promise<void> {
    let run = initial;
    const step = async <T,>(id: BuildRunRecord['steps'][number]['id'], work: () => Promise<{ detail: { zh: string; en: string }; value: T }>): Promise<T> => {
      run = setStep(run, id, { status: 'RUNNING', startedAt: new Date().toISOString() });
      try {
        const { detail, value } = await work();
        run = setStep(run, id, { status: 'DONE', detail, finishedAt: new Date().toISOString() });
        return value;
      } catch (err) {
        const detail = (err as { business?: { zh: string; en: string } }).business ?? bi(`没完成：${err instanceof Error ? err.message : String(err)}`, `Not done: ${err instanceof Error ? err.message : String(err)}`);
        run = setStep(run, id, { status: 'FAILED', detail, finishedAt: new Date().toISOString() });
        run = update(run, { status: 'FAILED' });
        throw err;
      }
    };
    try {
      await step('build', async () => {
        const source = resolve(repoRoot, 'examples', 'teaco');
        mkdirSync(run.workspaceDir, { recursive: true });
        for (const part of ['app', 'domain']) cpSync(join(source, part), join(run.workspaceDir, part), { recursive: true });
        cpSync(resolve(repoRoot, 'benchmark', 'datasets', 'bb-seed0'), join(run.workspaceDir, 'seed'), { recursive: true });
        const files = countFiles(run.workspaceDir);
        return { value: undefined, detail: bi(`独立工作目录里放好了 ${files} 个文件（订单系统与三份原始表格）`, `${files} files placed in an isolated workspace (the order system and the three raw tables)`) };
      });

      const baseUrl = await step('start', async () => {
        const port = await freePort();
        const child = spawn(process.execPath, ['--import', 'tsx', join(run.workspaceDir, 'app', 'server.ts')], {
          cwd: repoRoot,
          env: { ...process.env, TEACO_PORT: String(port), TEACO_DB: join(run.workspaceDir, 'data', 'teaco.sqlite'), TEACO_SEED_DIR: join(run.workspaceDir, 'seed'), TEACO_REVISION: 'v1' },
          stdio: 'ignore',
        });
        children.add(child);
        child.once('exit', () => children.delete(child));
        stopChildrenOnExit();
        const url = `http://127.0.0.1:${port}`;
        const deadline = Date.now() + 30_000;
        for (;;) {
          if (child.exitCode !== null) throw Object.assign(new Error('the process ended'), { business: bi('应用启动后立刻退出了。', 'The application exited right after starting.') });
          try {
            const res = await fetch(`${url}/.well-known/ontology-plus.json`);
            if (res.ok) break;
          } catch {
            // Not listening yet.
          }
          if (Date.now() > deadline) throw Object.assign(new Error('timeout'), { business: bi('30 秒内没有启动起来。', 'It did not start within 30 seconds.') });
          await new Promise((r) => setTimeout(r, 300));
        }
        run = update(run, { pid: child.pid ?? null, baseUrl: url });
        return { value: url, detail: bi(`已在本机 127.0.0.1:${port} 运行`, `Running on this machine at 127.0.0.1:${port}`) };
      });

      await step('acceptance', async () => {
        const client = createConnectionClient({ baseUrl });
        const results: [string, boolean][] = [];
        const expect = (label: string, ok: boolean) => results.push([label, ok]);
        const manifest = await client.readManifest();
        expect('接入清单', manifest.protocol === 'ontology-plus-connect/1');
        const m = new Map((await client.metrics('owner')).values.map((v) => [v.id, v.value]));
        expect('BB #8 没发货 34', m.get('open_orders') === 34);
        expect('BB #8 已发货销售额 $24,338.27', m.get('shipped_sales') === 2433827);
        expect('BB #8 税 $771.87', m.get('shipped_tax') === 77187);
        expect('BB #8 平均每单 $368.76', m.get('average_shipped_order') === 36876);
        expect('BB #9 Jonah 没发货 3', (await client.metrics('jonah')).values.find((v) => v.id === 'open_orders')?.value === 3);
        expect('BB #15 客户 142', (await client.listObjects('customers', 'owner', { filter: 'all', limit: 1 })).total === 142);
        expect('BB #17 商品 60', (await client.listObjects('products', 'owner', { filter: 'all', limit: 1 })).total === 60);
        expect('BB #19 订单 110', (await client.listObjects('orders', 'owner', { filter: 'all', limit: 1 })).total === 110);
        const amanda = (await client.listObjects('customers', 'owner', { filter: 'retail', limit: 200 })).rows.find((r) => r.values.name === 'Amanda Bennett')?.key;
        const quote = amanda
          ? await client.prepareAction('create_order', 'owner', { params: { customer: amanda, lines: [{ sku: 'BLK-ASSAM-4OZ', qty: 2 }, { sku: 'OOL-TIEGUA-4OZ', qty: 1 }] } }).catch(() => null)
          : null;
        expect('BB #21 报价合计 $73.44', Boolean(quote?.preview.effects.some((e) => e.zh.includes('合计 $73.44'))));
        const failed = results.filter(([, ok]) => !ok).map(([label]) => label);
        if (failed.length) throw Object.assign(new Error(failed.join(', ')), { business: bi(`${results.length - failed.length}/${results.length} 项通过；没通过：${failed.join('、')}`, `${results.length - failed.length}/${results.length} passed; failed: ${failed.join(', ')}`) });
        return { value: undefined, detail: bi(`${results.length}/${results.length} 项通过（接入清单、四个经营数字、Jonah 的范围、客户/商品/订单数、零售报价）`, `${results.length}/${results.length} passed (manifest, four figures, Jonah’s scope, customer/tea/order counts, a retail quote)`) };
      });

      await step('connect', async () => {
        const res = await app.request(`/api/projects/${encodeURIComponent(run.projectId)}/connected-app`, {
          method: 'POST', body: JSON.stringify({ baseUrl }), headers: { 'content-type': 'application/json' },
        });
        if (res.status !== 201) throw Object.assign(new Error(`connect ${res.status}`), { business: bi('接入时核对没通过。', 'The connection check did not pass.') });
        return { value: undefined, detail: bi('已接入并核对，可以打开经营驾驶舱', 'Connected and checked; the Operations Console can be opened') };
      });
      run = update(run, { status: 'SUCCEEDED' });
    } catch (err) {
      if (!(err instanceof Error) && !(err instanceof ConnectionError)) throw err;
    }
  }

  app.post('/api/projects/:id/build-runs', async (c) => {
    const projectId = c.req.param('id');
    if (!store.getProject(projectId)) return c.json({ error: 'Project not found' }, 404);
    const latest = store.getLatestBuildRun(projectId);
    if (latest?.status === 'RUNNING') return c.json({ error: { code: 'ALREADY_RUNNING' }, run: latest }, 409);
    if (!existsSync(resolve(repoRoot, 'examples', 'teaco', 'app', 'server.ts'))) {
      return c.json({ error: { code: 'NO_TEMPLATE', message: bi('这台机器上没有参考实现。', 'No reference implementation on this machine.') } }, 422);
    }
    const id = `build-${randomUUID()}`;
    const at = new Date().toISOString();
    const run = store.saveBuildRun({
      id, projectId, template: 'teaco', status: 'RUNNING',
      steps: (['build', 'start', 'acceptance', 'connect'] as const).map((s) => ({ id: s, label: STEP_LABELS[s], status: 'PENDING' as const, detail: null, startedAt: null, finishedAt: null })),
      workspaceDir: join(workspacesRoot, id), baseUrl: null, pid: null, createdAt: at, updatedAt: at,
    });
    const done = execute(run);
    if (c.req.query('wait') === '1') await done;
    return c.json({ run: store.getLatestBuildRun(projectId) }, 202);
  });

  app.get('/api/projects/:id/build-runs/latest', (c) => c.json({ run: store.getLatestBuildRun(c.req.param('id')) ?? null }));
}

/** Stops every application this process started (tests and shutdown). */
export function stopBuiltApplications(): void {
  for (const c of children) c.kill();
  children.clear();
}
