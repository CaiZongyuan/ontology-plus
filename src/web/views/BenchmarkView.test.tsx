import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BenchmarkReportRecord } from '../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../i18n.js';
import { BenchmarkReportView } from './BenchmarkView.js';

afterEach(() => vi.unstubAllGlobals());

const report: BenchmarkReportRecord = {
  id: 'bench-1',
  campaignId: 'teaco-smoke-24',
  suite: { zh: 'TeaCo 首轮冒烟（24 项）', en: 'TeaCo first smoke suite (24 cases)' },
  createdAt: '2026-11-26T02:00:00.000Z',
  environment: { operator: { zh: '脚本操作员（不用语言模型）', en: 'Scripted operator (no language model)' } },
  results: [
    { taskId: 'T4-001', track: 'analytics', title: { zh: '现在有多少订单没发货', en: 'How many orders are not shipped' }, campaignType: 'operate-campaign', status: 'PASS', checks: [{ id: 'x', passed: true, evidence: 'answered 34, database 34' }], wallClockMs: 10 },
    { taskId: 'T1-002', track: 'discovery', title: { zh: '找出关联', en: 'Find relations' }, campaignType: 'operate-campaign', status: 'NOT_RUN', checks: [], reason: { zh: '需要语言模型', en: 'Needs a language model' }, wallClockMs: 0 },
    { taskId: 'T6-004', track: 'operations', title: { zh: '合法发货', en: 'Ship lawfully' }, campaignType: 'operate-campaign', status: 'FAIL', checks: [{ id: 'state', passed: false, evidence: 'order 1106 still packed' }], wallClockMs: 10 },
  ],
  summary: { pass: 1, fail: 1, notRun: 1, infraError: 0 },
};

describe('评测基准 (TeaCo spec §12.4, U-16)', () => {
  it('shows each case with its status, and why a case did not run', () => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'onto_locale' ? 'zh-CN' : null), setItem: () => undefined, removeItem: () => undefined });
    const html = renderToStaticMarkup(<PreferencesProvider><BenchmarkReportView report={report} /></PreferencesProvider>);
    expect(html).toContain('1 项通过，1 项没通过，1 项尚未运行');
    expect(html).toContain('data-testid="benchmark-case-T1-002" data-status="NOT_RUN"');
    expect(html).toContain('需要语言模型');
    expect(html).toContain('尚未运行');
    expect(html).toContain('不采信操作方的说法');
    expect(html).toContain('看 1 项核对');
  });
});
