import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';
import { stopBuiltApplications } from './build-runner.js';

/**
 * The runnable system prepared on this machine (TeaCo spec U-02): a real copy, a real process, real
 * acceptance checks through the contract, then the normal connection. The workspace sits inside the
 * repository so the copied application resolves its dependencies.
 */
const root = resolve(process.cwd(), '.scratch', 'build-runner-test');
afterEach(() => {
  stopBuiltApplications();
  rmSync(root, { recursive: true, force: true });
});

describe('build runner', () => {
  it('builds from the reference implementation, starts it, checks it and connects the project, step by step', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const api = createApiApp(store, { buildWorkspacesRoot: join(root, String(Date.now())) });
    const projectId = store.listProjects()[0]!.id;
    const res = await api.request(`/api/projects/${projectId}/build-runs?wait=1`, { method: 'POST' });
    const { run } = (await res.json()) as { run: any };
    expect(run.steps.map((s: any) => [s.id, s.status])).toEqual([['build', 'DONE'], ['start', 'DONE'], ['acceptance', 'DONE'], ['connect', 'DONE']]);
    expect(run.status).toBe('SUCCEEDED');
    expect(run.steps[2].detail.zh).toBe('10/10 项通过（接入清单、四个经营数字、Jonah 的范围、客户/商品/订单数、零售报价）');
    expect(run.steps.every((s: any) => s.startedAt && s.finishedAt && s.startedAt <= s.finishedAt)).toBe(true);
    expect(store.getConnectedApp(projectId)).toMatchObject({ status: 'CONNECTED', baseUrl: run.baseUrl });
    const overview = (await (await api.request(`/api/projects/${projectId}/console/overview`)).json()) as any;
    expect(overview.data.metrics.values.find((v: any) => v.id === 'open_orders').value).toBe(34);
    expect(((await (await api.request(`/api/projects/${projectId}/build-runs/latest`)).json()) as any).run.id).toBe(run.id);
  }, 60000);
});
