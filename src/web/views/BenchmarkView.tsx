import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDashed, FlaskConical, XCircle } from 'lucide-react';
import type { BenchmarkReportRecord } from '../../packages/workspace-store/index.js';
import { usePreferences } from '../i18n.js';
import { cn } from '../lib/utils.js';
import './operations-console/operations-console.css';

/**
 * 平台治理 → 评测基准 (TeaCo spec §12.4, U-16): archived evaluation reports, read only. Every case
 * shows its checks and evidence; a case that was not run says why and is never shown as passed.
 */
type Report = BenchmarkReportRecord;
type Translate = (zh: string, en: string) => string;

const TRACKS: Record<string, { zh: string; en: string }> = {
  discovery: { zh: '发现业务模型', en: 'Discovery' },
  build: { zh: '搭建应用', en: 'Build' },
  integration: { zh: '数据接入', en: 'Data integration' },
  analytics: { zh: '问数', en: 'Analytics' },
  governance: { zh: '数据治理', en: 'Data governance' },
  operations: { zh: '代办操作', en: 'Operations' },
  knowledge: { zh: '知识演化', en: 'Knowledge' },
  autonomy: { zh: '自主管理', en: 'Autonomous management' },
};

export function statusText(t: Translate, status: Report['results'][number]['status']) {
  return ({
    PASS: t('通过', 'Pass'), FAIL: t('没通过', 'Fail'), NOT_RUN: t('尚未运行', 'Not run'), INFRA_ERROR: t('环境出错', 'Environment error'),
    TIMEOUT: t('超时', 'Timeout'), POLICY_VIOLATION: t('越权', 'Policy violation'),
  })[status];
}

export function BenchmarkReportView({ report }: { report: Report }) {
  const { t } = usePreferences();
  const env = report.environment as { operator?: { zh: string; en: string }; dataset?: string; clock?: string; applicationRevision?: string };
  const [open, setOpen] = useState<string | null>(null);
  const tracks = useMemo(() => [...new Set(report.results.map((r) => r.track))], [report]);
  return (
    <div className="oc-page" data-testid="benchmark-report">
      <div className="oc-lead">
        <span className="oc-eyebrow">{t(report.suite.zh, report.suite.en)}</span>
        <h1 className="oc-headline">
          {t(
            `${report.summary.pass} 项通过，${report.summary.fail} 项没通过，${report.summary.notRun} 项尚未运行`,
            `${report.summary.pass} passed, ${report.summary.fail} failed, ${report.summary.notRun} not run`,
          )}
        </h1>
        <p className="oc-note">
          {t(
            `${report.createdAt.slice(0, 16).replace('T', ' ')} UTC 运行 · ${env.operator?.zh ?? ''} · 每项都由独立核对直接查看应用自己的数据，不采信操作方的说法`,
            `Run ${report.createdAt.slice(0, 16).replace('T', ' ')} UTC · ${env.operator?.en ?? ''} · every case is checked independently against the application’s own data, not the operator’s word`,
          )}
        </p>
      </div>
      {tracks.map((track) => (
        <section key={track} className="oc-card">
          <div className="oc-card-head"><h3 className="oc-card-title">{t(TRACKS[track]?.zh ?? track, TRACKS[track]?.en ?? track)}</h3></div>
          <ul className="oc-checklist">
            {report.results.filter((r) => r.track === track).map((r) => (
              <li key={r.taskId} data-testid={`benchmark-case-${r.taskId}`} data-status={r.status}>
                {r.status === 'PASS' ? <CheckCircle2 size={15} className="text-success" aria-hidden="true" /> : r.status === 'NOT_RUN' ? <CircleDashed size={15} className="text-faint-foreground" aria-hidden="true" /> : <XCircle size={15} className="text-destructive" aria-hidden="true" />}
                <div className="min-w-0">
                  <div className="oc-check-title">{`${r.taskId} · ${t(r.title.zh, r.title.en)}`}</div>
                  {r.reason ? <div className="oc-check-detail">{t(r.reason.zh, r.reason.en)}</div> : null}
                  {r.checks.length ? (
                    <button type="button" className="oc-link-btn" onClick={() => setOpen(open === r.taskId ? null : r.taskId)} data-testid={`benchmark-case-toggle-${r.taskId}`}>
                      {open === r.taskId ? t('收起核对', 'Hide checks') : t(`看 ${r.checks.length} 项核对`, `Show ${r.checks.length} checks`)}
                    </button>
                  ) : null}
                  {open === r.taskId ? (
                    <ul className="oc-notes">
                      {r.checks.map((c) => <li key={c.id} className={cn(!c.passed && 'text-destructive')}>{`${c.passed ? '✓' : '✗'} ${c.evidence}`}</li>)}
                    </ul>
                  ) : null}
                </div>
                <span className={cn('oc-tag', r.status === 'PASS' ? 'ok' : r.status === 'NOT_RUN' ? '' : 'warn')}>{statusText(t, r.status)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function BenchmarkView() {
  const { t } = usePreferences();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/benchmark/reports')
      .then((res) => (res.ok ? (res.json() as Promise<{ reports: Report[] }>) : { reports: [] }))
      .then((r) => setReports(r.reports), () => setReports([]));
  }, []);
  if (!reports) return <p className="oc-callout">{t('正在读取评测报告…', 'Reading reports…')}</p>;
  if (reports.length === 0) {
    return (
      <div className="oc-page" data-testid="benchmark-empty">
        <div className="oc-lead">
          <span className="oc-eyebrow"><FlaskConical size={13} className="mr-1 inline" aria-hidden="true" />{t('评测基准', 'Benchmarks')}</span>
          <h1 className="oc-headline">{t('还没有评测报告：尚未运行', 'No reports yet: not run')}</h1>
          <p className="oc-note">{t('研发运行一次冒烟评测并存档后，每一项的结果和核对依据都会出现在这里。', 'Once a smoke evaluation is run and archived, every case and its evidence appears here.')}</p>
        </div>
      </div>
    );
  }
  const report = reports.find((r) => r.id === selected) ?? reports[0]!;
  return (
    <div className="flex flex-col gap-3">
      {reports.length > 1 ? (
        <label className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
          {t('报告', 'Report')}
          <select className="oc-select" value={report.id} onChange={(e) => setSelected(e.target.value)} data-testid="benchmark-report-select">
            {reports.map((r) => (
              <option key={r.id} value={r.id}>{`${r.createdAt.slice(0, 16).replace('T', ' ')} · ${r.summary.pass}/${r.results.length}`}</option>
            ))}
          </select>
        </label>
      ) : null}
      <BenchmarkReportView report={report} />
    </div>
  );
}

/** The console's AI 能力体检: the latest report in brief, with the details one click away. */
export function ConsoleAiCheckPage({ onOpenDetails }: { onOpenDetails?: () => void }) {
  const { t } = usePreferences();
  const [latest, setLatest] = useState<Report | null | undefined>(undefined);
  useEffect(() => {
    fetch('/api/benchmark/reports')
      .then((res) => (res.ok ? (res.json() as Promise<{ reports: Report[] }>) : { reports: [] }))
      .then((r) => setLatest(r.reports[0] ?? null), () => setLatest(null));
  }, []);
  if (latest === undefined) return <p className="oc-callout">{t('正在读取…', 'Reading…')}</p>;
  const tracks = latest ? [...new Set(latest.results.map((r) => r.track))] : [];
  return (
    <div className="oc-page" data-testid="console-ai-check">
      <div className="oc-lead">
        <span className="oc-eyebrow">{t('AI 能力体检', 'AI check-up')}</span>
        <h1 className="oc-headline">
          {latest
            ? t(`最近一次评测：${latest.summary.pass} 项通过，${latest.summary.fail} 项没通过，${latest.summary.notRun} 项尚未运行`, `Latest evaluation: ${latest.summary.pass} passed, ${latest.summary.fail} failed, ${latest.summary.notRun} not run`)
            : t('尚未运行评测', 'No evaluation has been run')}
        </h1>
        <p className="oc-note">
          {latest
            ? t(`${latest.createdAt.slice(0, 10)} 在独立的参考环境里运行，只显示真实跑出的结果。`, `Run on ${latest.createdAt.slice(0, 10)} in a separate reference environment; only real results are shown.`)
            : t('评测跑过之后，这里会显示 AI 在问数、代办、数据治理和知识上能不能放心用。', 'After an evaluation runs, this shows whether the AI can be trusted with questions, changes, data care and knowledge.')}
        </p>
      </div>
      {latest ? (
        <section className="oc-card">
          <ul className="oc-checklist">
            {tracks.map((track) => {
              const rows = latest.results.filter((r) => r.track === track);
              const pass = rows.filter((r) => r.status === 'PASS').length;
              const notRun = rows.filter((r) => r.status === 'NOT_RUN').length;
              return (
                <li key={track} data-testid={`console-ai-check-${track}`}>
                  {notRun === rows.length ? <CircleDashed size={15} className="text-faint-foreground" aria-hidden="true" /> : pass + notRun === rows.length ? <CheckCircle2 size={15} className="text-success" aria-hidden="true" /> : <XCircle size={15} className="text-destructive" aria-hidden="true" />}
                  <div className="min-w-0">
                    <div className="oc-check-title">{t(TRACKS[track]?.zh ?? track, TRACKS[track]?.en ?? track)}</div>
                    <div className="oc-check-detail">{t(`${pass}/${rows.length} 通过${notRun ? `，${notRun} 项尚未运行` : ''}`, `${pass}/${rows.length} passed${notRun ? `, ${notRun} not run` : ''}`)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {onOpenDetails ? (
        <div>
          <button type="button" className="oc-link-btn" onClick={onOpenDetails} data-testid="console-ai-check-details">{t('去「平台治理 → 评测基准」看每一项', 'See every case under Platform Governance → Benchmarks')}</button>
        </div>
      ) : null}
    </div>
  );
}
