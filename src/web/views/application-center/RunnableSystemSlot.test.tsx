import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBusinessViewMarkup, formatBusinessViewViolations } from '../../../packages/business-vocabulary/index.js';
import type { BuildRunRecord } from '../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../i18n.js';
import { RunnableSystemSlot } from './DeliveryStepViews.js';

afterEach(() => vi.unstubAllGlobals());

const step = (id: BuildRunRecord['steps'][number]['id'], zh: string, status: BuildRunRecord['steps'][number]['status'], detail: string | null = null) => ({
  id, label: { zh, en: zh }, status, detail: detail ? { zh: detail, en: detail } : null, startedAt: null, finishedAt: null,
});

const run = (status: BuildRunRecord['status'], steps: BuildRunRecord['steps']): BuildRunRecord => ({
  id: 'b1', projectId: 'p', template: 'teaco', status, steps, workspaceDir: '/w', baseUrl: null, pid: null, createdAt: '', updatedAt: '',
});

describe('runnable system slot while it is prepared (TeaCo spec U-02)', () => {
  it('shows the real steps in business words while running, and a retry after a failure', () => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'onto_locale' ? 'zh-CN' : null), setItem: () => undefined, removeItem: () => undefined });
    const running = renderToStaticMarkup(
      <PreferencesProvider>
        <RunnableSystemSlot buildRun={run('RUNNING', [step('build', '按开发包搭建（用参考实现）', 'DONE', '独立工作目录里放好了 23 个文件'), step('start', '在本机启动', 'RUNNING'), step('acceptance', '跑验收', 'PENDING'), step('connect', '接入核对', 'PENDING')])} onBuild={() => undefined} />
      </PreferencesProvider>,
    );
    expect(running).toContain('data-slot-status="PREPARING"');
    expect(running).toContain('data-testid="runnable-system-build-step-start" data-status="RUNNING"');
    expect(running).toContain('不是 AI 编写的代码');
    expect(running).not.toContain('data-testid="runnable-system-build"');
    const violations = checkBusinessViewMarkup(running);
    expect(violations, formatBusinessViewViolations(violations)).toEqual([]);

    const failed = renderToStaticMarkup(
      <PreferencesProvider>
        <RunnableSystemSlot buildRun={run('FAILED', [step('build', '按开发包搭建（用参考实现）', 'DONE'), step('start', '在本机启动', 'FAILED', '30 秒内没有启动起来。'), step('acceptance', '跑验收', 'PENDING'), step('connect', '接入核对', 'PENDING')])} onBuild={() => undefined} />
      </PreferencesProvider>,
    );
    expect(failed).toContain('30 秒内没有启动起来。');
    expect(failed).toContain('再试一次');
  });
});
