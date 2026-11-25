import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot, History, Loader2, RotateCcw, Rocket, ShieldCheck, XCircle } from 'lucide-react';
import type { Bilingual } from '../../../packages/application-runtime/index.js';
import type { ChangeProposalRecord, ConnectedAppRecord } from '../../../packages/workspace-store/index.js';
import { Button, ConfirmDialog } from '../../components/beautifui/index.js';
import { ConsoleRequestError, consoleApi, type ReleasesOverview } from '../../components/runtime/consoleApi.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';

/**
 * 需求变化 (TeaCo spec §10.6, U-03, U-13): every requirement change is a version of the connected
 * application. A staged version is previewed and checked against the one in use — what changes,
 * whether the existing figures move, and whether the requirement's acceptance checks hold — before
 * the owner puts it live. Going back is offered for the version in use; business already done is
 * never undone by it.
 */
type Translate = (zh: string, en: string) => string;
const tb = (t: Translate, b: Bilingual | null | undefined) => (b ? t(b.zh, b.en) : '');

export interface ConsoleChangesPageProps {
  readonly projectId: string;
  readonly onConnectionChanged: (record: ConnectedAppRecord) => void;
}

export function ConsoleChangesPage({ projectId, onConnectionChanged }: ConsoleChangesPageProps) {
  const { t } = usePreferences();
  const [overview, setOverview] = useState<ReleasesOverview | null>(null);
  const [error, setError] = useState<Bilingual | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'release'; version: string } | { kind: 'rollback'; version: string } | null>(null);

  const load = useCallback(() => {
    consoleApi.releases(projectId).then(
      (o) => {
        setOverview(o);
        setError(null);
      },
      (err: ConsoleRequestError) => setError(err.businessMessage ?? { zh: `读不到版本信息：${err.message}`, en: `Could not read the versions: ${err.message}` }),
    );
  }, [projectId]);
  useEffect(load, [load]);

  const run = async (key: string, step: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await step();
    } catch (err) {
      const e = err as ConsoleRequestError;
      if (e.connectedApp) onConnectionChanged(e.connectedApp);
      setError(e.businessMessage ?? { zh: `没有完成：${e.message}`, en: `Not done: ${e.message}` });
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };
  const verify = (version: string) =>
    run(`verify:${version}`, async () => {
      await consoleApi.verifyRelease(projectId, version);
      load();
    });
  const release = (version: string) =>
    run(`release:${version}`, async () => {
      const res = await consoleApi.releaseVersion(projectId, version);
      onConnectionChanged(res.connectedApp);
    });
  const rollback = () =>
    run('rollback', async () => {
      const res = await consoleApi.rollback(projectId);
      onConnectionChanged(res.connectedApp);
    });

  if (!overview) {
    return error ? <p className="oc-callout warn">{tb(t, error)}</p> : <p className="oc-callout">{t('正在读取版本…', 'Reading the versions…')}</p>;
  }
  const live = overview.versions.find((v) => v.state === 'LIVE');
  const staged = overview.versions.filter((v) => v.state === 'STAGED');
  const headline = staged.length
    ? t(`现在用的是需求 ${overview.current}「${live?.name.zh ?? ''}」；有 ${staged.length} 个新版本等你核对后上线。`, `Requirement ${overview.current} (${live?.name.en ?? ''}) is live; ${staged.length} newer version(s) wait to be checked and put live.`)
    : t(`现在用的是需求 ${overview.current}「${live?.name.zh ?? ''}」，没有待上线的版本。`, `Requirement ${overview.current} (${live?.name.en ?? ''}) is live; no newer version is waiting.`);

  return (
    <div className="oc-page" data-testid="console-changes">
      <div className="oc-lead">
        <span className="oc-eyebrow">{t('需求变化', 'Requirement changes')}</span>
        <h1 className="oc-headline">{headline}</h1>
        <p className="oc-note">
          {t('每个版本先预览核对：会改变什么、现有数字会不会变、需求的验收条件过不过；核对通过才能上线。上线或回退后，连接要重新核对一次。', 'Each version is previewed first: what changes, whether existing figures move, and whether the requirement’s acceptance checks hold; only a passing version can go live. After going live or back, the connection is re-checked once.')}
        </p>
      </div>
      {error ? <p className="oc-callout warn" role="alert" data-testid="console-changes-error"><AlertTriangle size={13} className="mr-1.5 inline" aria-hidden="true" />{tb(t, error)}</p> : null}

      <ol className="oc-timeline" data-testid="console-release-timeline">
        {overview.versions.map((v) => (
          <li key={v.version} className={cn('oc-timeline-item', v.state === 'LIVE' && 'is-live', v.state === 'EARLIER' && 'is-earlier')} data-testid={`console-release-${v.version}`} data-state={v.state}>
            <span className="oc-timeline-dot" aria-hidden="true">{v.state === 'LIVE' ? <CircleDot size={14} /> : v.state === 'EARLIER' ? <History size={13} /> : <Rocket size={13} />}</span>
            <div className="oc-timeline-body">
              <div className="oc-timeline-head">
                <span className="oc-timeline-title">{t(`需求 ${v.version} · ${v.name.zh}`, `Requirement ${v.version} · ${v.name.en}`)}</span>
                <span className={cn('oc-tag', v.state === 'LIVE' ? 'ok' : v.state === 'STAGED' ? 'info' : '')}>
                  {v.state === 'LIVE' ? t('使用中', 'Live') : v.state === 'STAGED' ? t('可以上线', 'Can go live') : t('之前的版本', 'Earlier version')}
                </span>
              </div>
              <ul className="oc-notes">{v.notes.map((n, i) => <li key={i}>{tb(t, n)}</li>)}</ul>
              {v.state === 'LIVE' && overview.previous ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="xs" onClick={() => setConfirm({ kind: 'rollback', version: overview.previous! })} disabled={busy !== null} data-testid="console-rollback">
                    <RotateCcw size={11} aria-hidden="true" />
                    {t(`回到上一版 ${overview.previous}`, `Go back to ${overview.previous}`)}
                  </Button>
                </div>
              ) : null}
              {v.state === 'STAGED' ? (
                <ProposalPanel
                  version={v.version}
                  current={overview.current}
                  proposal={v.proposal}
                  busy={busy}
                  onVerify={() => void verify(v.version)}
                  onRelease={() => setConfirm({ kind: 'release', version: v.version })}
                />
              ) : v.proposal?.log.length ? (
                <details className="oc-details">
                  <summary>{t('经过', 'History')}</summary>
                  <ul className="oc-notes">{v.proposal.log.map((l, i) => <li key={i}>{tb(t, l.text)}</li>)}</ul>
                </details>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'release' ? t(`让需求 ${confirm.version} 上线？`, `Put requirement ${confirm.version} live?`) : t(`回到需求 ${confirm?.version ?? ''}？`, `Go back to requirement ${confirm?.version ?? ''}?`)}
        description={
          confirm?.kind === 'release'
            ? t('上线后应用按新规则办事。连接会等你重新核对，核对前经营驾驶舱和 AI 都不报数字、不做代办。', 'The application then works by the new rules. The connection waits for your re-check; until then the console and the AI report no figures and prepare no changes.')
            : t('应用回到上一版的规则。已经办完的业务不会被撤销；如果有数据上一版表示不了（比如挂起中的订单），应用会拒绝并说明要先处理什么。', 'The application returns to the previous rules. Business already done is not undone; if some data cannot be represented by the previous version (such as orders on hold), the application refuses and says what to resolve first.')
        }
        confirmLabel={confirm?.kind === 'release' ? t('确认上线', 'Put live') : t('回到上一版', 'Go back')}
        cancelLabel={t('取消', 'Cancel')}
        danger={confirm?.kind === 'rollback'}
        busy={busy !== null}
        onConfirm={() => void (confirm?.kind === 'release' ? release(confirm.version) : rollback())}
        onClose={() => setConfirm(null)}
        testId="console-release-dialog"
      />
    </div>
  );
}

export function ProposalPanel({ version, current, proposal, busy, onVerify, onRelease }: {
  version: string;
  current: string;
  proposal: ChangeProposalRecord | null;
  busy: string | null;
  onVerify: () => void;
  onRelease: () => void;
}) {
  const { t } = usePreferences();
  const v = proposal?.verification ?? null;
  const stale = v !== null && v.baseVersion !== current;
  const failed = v ? v.results.filter((r) => r.outcome === 'FAIL').length : 0;
  const checks = proposal?.checks ?? [];
  return (
    <div className="oc-proposal" data-testid={`console-proposal-${version}`} data-status={proposal?.status ?? 'NONE'}>
      {proposal?.request ? (
        <div>
          <div className="oc-eyebrow">{t('需求是怎么说的', 'What the requirement says')}</div>
          <p className="oc-proposal-request">{tb(t, proposal.request)}</p>
        </div>
      ) : (
        <p className="oc-note">{t('还没有记下这项需求变化的原话和验收条件；可以先核对，看看会改变什么、现有数字会不会变。', 'The wording and acceptance checks of this change are not recorded yet; you can still check what it changes and whether existing figures move.')}</p>
      )}

      {v && !stale ? (
        <>
          <div className="oc-proposal-section">
            <div className="oc-eyebrow">{t('会改变什么', 'What changes')}</div>
            {v.changes.length ? (
              <ul className="oc-proposal-list">
                {v.changes.map((c, i) => <li key={i}><ArrowRight size={12} aria-hidden="true" /><span>{tb(t, c.text)}</span></li>)}
              </ul>
            ) : <p className="oc-note">{t('页面、报表和操作都没有增减；变化在规则里，见验收条件。', 'No pages, reports or actions are added or removed; the change is in the rules — see the acceptance checks.')}</p>}
          </div>

          <div className="oc-proposal-section">
            <div className="oc-eyebrow">{t(`验收条件（${v.results.filter((r) => r.outcome === 'PASS').length}/${v.results.length} 通过）`, `Acceptance checks (${v.results.filter((r) => r.outcome === 'PASS').length}/${v.results.length} pass)`)}</div>
            {v.results.length === 0 ? <p className="oc-note">{t('没有验收条件，只核对了现有数字。', 'No acceptance checks; only the existing figures were compared.')}</p> : null}
            <ul className="oc-proposal-checks">
              {v.results.map((r) => {
                const check = checks.find((c) => c.id === r.checkId);
                return (
                  <li key={r.checkId} className={r.outcome === 'PASS' ? 'pass' : 'fail'} data-testid={`console-check-${r.checkId}`} data-outcome={r.outcome}>
                    {r.outcome === 'PASS' ? <CheckCircle2 size={13} aria-hidden="true" /> : <XCircle size={13} aria-hidden="true" />}
                    <span className="min-w-0">
                      <span className="oc-check-text">{tb(t, check?.text)}</span>
                      <span className="oc-check-seen">{tb(t, r.observed)}{check?.source ? ` · ${check.source}` : ''}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {v.regression.length ? (
            <div className="oc-proposal-section">
              <div className="oc-eyebrow">{t('现有数字会不会变', 'Do existing figures move')}</div>
              <table className="oc-table oc-proposal-table">
                <thead>
                  <tr><th>{t('数字', 'Figure')}</th><th className="num">{t('现在', 'Now')}</th><th className="num">{t(`${version} 上线后`, `With ${version}`)}</th><th>{t('结论', 'Result')}</th></tr>
                </thead>
                <tbody>
                  {v.regression.map((r, i) => (
                    <tr key={i}>
                      <td>{tb(t, r.label)}</td>
                      <td className="num">{r.before}</td>
                      <td className="num">{r.after}</td>
                      <td>{r.changed ? <span className="oc-tag warn">{t('会变', 'Changes')}</span> : <span className="oc-tag ok">{t('不变', 'Same')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {v.modelHints.length ? (
            <details className="oc-details">
              <summary>{t(`和已确认的业务模型对照：${v.modelHints.length} 条提示`, `Against the confirmed Business Model: ${v.modelHints.length} note(s)`)}</summary>
              <ul className="oc-notes">{v.modelHints.map((h, i) => <li key={i}>{tb(t, h.message)}</li>)}</ul>
            </details>
          ) : null}
        </>
      ) : null}

      <div className="oc-proposal-foot">
        {v && !stale ? (
          proposal?.status === 'VERIFIED' ? (
            <span className="oc-proposal-verdict ok"><ShieldCheck size={13} aria-hidden="true" />{t(`对照 ${v.baseVersion} 核对通过，可以上线`, `Checked against ${v.baseVersion}: ready to go live`)}</span>
          ) : (
            <span className="oc-proposal-verdict warn"><AlertTriangle size={13} aria-hidden="true" />{t(`有 ${failed} 条验收没通过，不能上线`, `${failed} acceptance check(s) failed; it cannot go live`)}</span>
          )
        ) : stale ? (
          <span className="oc-proposal-verdict warn"><AlertTriangle size={13} aria-hidden="true" />{t(`上次是对照 ${v!.baseVersion} 核对的，现在用的是 ${current}，请重新核对`, `Last checked against ${v!.baseVersion}; ${current} is live now — check again`)}</span>
        ) : null}
        <div className="flex gap-2">
          <Button size="xs" onClick={onVerify} disabled={busy !== null} data-testid={`console-verify-${version}`}>
            {busy === `verify:${version}` ? <Loader2 size={11} className="pipeline-spin" aria-hidden="true" /> : null}
            {v && !stale ? t('重新核对', 'Check again') : t('核对这个版本', 'Check this version')}
          </Button>
          {proposal?.status === 'VERIFIED' && !stale ? (
            <Button size="xs" variant="accent" onClick={onRelease} disabled={busy !== null} data-testid={`console-release-${version}-btn`}>
              <Rocket size={11} aria-hidden="true" />
              {t('确认上线', 'Put live')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
