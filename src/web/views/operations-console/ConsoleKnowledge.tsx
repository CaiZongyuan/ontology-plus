import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BookMarked, FileSpreadsheet, Loader2, PackageSearch, Paperclip, Scale } from 'lucide-react';
import type { Bilingual } from '../../../packages/application-runtime/index.js';
import type { KnowledgeClaim } from '../../../packages/data-management/index.js';
import type { RuntimeTaskRecord } from '../../../packages/workspace-store/index.js';
import { Button } from '../../components/beautifui/index.js';
import { announceInvocationsChanged } from '../../components/runtime/RuntimeApprovals.js';
import {
  consoleApi,
  type ConsoleRequestError,
  type DataSourcesView,
  type KnowledgePending,
  type KnowledgeView,
} from '../../components/runtime/consoleApi.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import './operations-console.css';

/**
 * Data sources, knowledge and event-started work in the Operations Console (TeaCo spec §10.3–
 * §10.5; U-10, U-12, U-14). Knowledge never changes the application: confirming a statement only
 * makes it count when people and the AI ask about it.
 */
type Translate = (zh: string, en: string) => string;
const tb = (t: Translate, b: Bilingual | null | undefined) => (b ? t(b.zh, b.en) : '');
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const sourceName = (fileName: string) => fileName.replace(/\.[a-z0-9]+$/i, '');
const rowLabel = (t: Translate, locator: string) => {
  const n = /^row (\d+)$/.exec(locator)?.[1];
  return n ? t(`第 ${n} 行`, `row ${n}`) : locator;
};

export function claimValueText(claim: KnowledgeClaim): string {
  const v = claim.value;
  if (v.type === 'money' && typeof v.value === 'number') return new Intl.NumberFormat('en-US', { style: 'currency', currency: v.unit ?? 'USD' }).format(v.value / 100);
  return String(v.value);
}

const errorText = (t: Translate, err: unknown) => {
  const e = err as ConsoleRequestError;
  return e.businessMessage ? tb(t, e.businessMessage) : t(`没有完成：${e.message ?? ''}`, `Not done: ${e.message ?? ''}`);
};

// ─── 等你确认: work started by events and knowledge to review ─────────────────

export interface ConsoleWorkProps {
  readonly projectId: string;
  /** The Acting Identity a prepared change is requested as. */
  readonly actor: string;
  readonly tasks: readonly RuntimeTaskRecord[];
  readonly pending: KnowledgePending | null;
  readonly onChanged: () => void;
}

/** How many decisions these cards add to the overview's 等你确认 count. */
export const workCount = (tasks: readonly RuntimeTaskRecord[], pending: KnowledgePending | null) =>
  tasks.filter((x) => x.status === 'OPEN').length + (pending?.proposed.length ?? 0) + (pending?.disputes.length ?? 0);

export function ConsoleWorkCards({ projectId, actor, tasks, pending, onChanged }: ConsoleWorkProps) {
  return (
    <>
      {tasks.filter((x) => x.status === 'OPEN').map((task) => <ShortageCard key={task.id} projectId={projectId} actor={actor} task={task} onChanged={onChanged} />)}
      {pending?.disputes.map((d) => <DisputeCard key={`${d.subject.ref}|${d.predicateLabel.en}`} projectId={projectId} dispute={d} onChanged={onChanged} />)}
      {pending?.proposed.map((p) => <NewKnowledgeCard key={p.source.id} projectId={projectId} entry={p} onChanged={onChanged} />)}
    </>
  );
}

function useStep(onChanged: () => void) {
  const { t } = usePreferences();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, step: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await step();
      onChanged();
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

function ShortageCard({ projectId, actor, task, onChanged }: { projectId: string; actor: string; task: RuntimeTaskRecord; onChanged: () => void }) {
  const { t } = usePreferences();
  const { busy, error, run } = useStep(onChanged);
  return (
    <article className="oc-decision" data-testid={`console-task-${task.id}`}>
      <div className="oc-decision-head"><PackageSearch size={13} aria-hidden="true" />{t('缺货调查 · 需要你决定', 'Shortage check · needs you')}</div>
      <div className="oc-decision-body">
        <div className="oc-decision-title">{tb(t, task.title)}</div>
        <ul className="oc-notes">{task.findings.map((f, i) => <li key={i}>{tb(t, f)}</li>)}</ul>
        <p className="oc-note">{t('应用通知了缺货，已按最新数据核实。补货要你批准后才会执行。', 'The application reported the shortage and it was checked against the latest data. Any refill runs only after you approve it.')}</p>
        {error ? <p className="oc-callout warn" role="alert">{error}</p> : null}
      </div>
      <div className="oc-decision-foot">
        <Button size="xs" disabled={busy !== null} onClick={() => void run('dismiss', () => consoleApi.settleTask(projectId, task.id, { dismiss: true }))} data-testid="console-task-dismiss">
          {t('先不处理', 'Not now')}
        </Button>
        {task.suggestions.map((s, i) => (
          <Button
            key={i}
            size="xs"
            variant="accent"
            disabled={busy !== null}
            data-testid={`console-task-suggestion-${i}`}
            onClick={() =>
              void run(`s${i}`, async () => {
                const inv = await consoleApi.prepare(projectId, s.actionId, actor, s.target, { ...s.params });
                await consoleApi.settleTask(projectId, task.id, { handedOver: inv.id });
                announceInvocationsChanged(projectId);
              })
            }
          >
            {busy === `s${i}` ? <Loader2 size={11} className="pipeline-spin" aria-hidden="true" /> : null}
            {tb(t, s.label)}
          </Button>
        ))}
      </div>
    </article>
  );
}

function DisputeCard({ projectId, dispute, onChanged }: { projectId: string; dispute: KnowledgePending['disputes'][number]; onChanged: () => void }) {
  const { t } = usePreferences();
  const { busy, error, run } = useStep(onChanged);
  return (
    <article className="oc-decision" data-testid={`console-dispute-${dispute.subject.ref}`}>
      <div className="oc-decision-head"><Scale size={13} aria-hidden="true" />{t('资料说法不一致 · 需要你确认', 'Sources disagree · needs you')}</div>
      <div className="oc-decision-body">
        <div className="oc-decision-title">{t(`${dispute.subject.label} 的${dispute.predicateLabel.zh}`, `${dispute.subject.label}: ${dispute.predicateLabel.en}`)}</div>
        <ul className="oc-dispute-sides">
          {dispute.sides.map((side) => (
            <li key={side.claim.id}>
              <span className="oc-dispute-value">{claimValueText(side.claim)}</span>
              <span className="oc-check-seen">{t(`「${sourceName(side.fileName ?? side.family ?? '')}」· 自 ${day(side.claim.validFrom)} 起`, `"${sourceName(side.fileName ?? side.family ?? '')}" · from ${day(side.claim.validFrom)}`)}</span>
              <Button size="xs" disabled={busy !== null} onClick={() => void run(side.claim.id, () => consoleApi.decideClaim(projectId, side.claim.id, 'VERIFY'))} data-testid={`console-dispute-pick-${side.claim.id}`}>
                {t('以这个为准', 'Use this one')}
              </Button>
            </li>
          ))}
        </ul>
        <p className="oc-note">{t('两边都保留着，选定之前不会把任何一边当成事实。', 'Both are kept; neither counts as fact until you choose.')}</p>
        {error ? <p className="oc-callout warn" role="alert">{error}</p> : null}
      </div>
    </article>
  );
}

function NewKnowledgeCard({ projectId, entry, onChanged }: { projectId: string; entry: KnowledgePending['proposed'][number]; onChanged: () => void }) {
  const { t } = usePreferences();
  const { busy, error, run } = useStep(onChanged);
  return (
    <article className="oc-decision" data-testid={`console-new-knowledge-${entry.source.id}`}>
      <div className="oc-decision-head"><BookMarked size={13} aria-hidden="true" />{t('新资料 · 需要你确认', 'New source · needs you')}</div>
      <div className="oc-decision-body">
        <div className="oc-decision-title">{t(`「${sourceName(entry.source.fileName)}」带来 ${entry.count} 条新知识`, `"${sourceName(entry.source.fileName)}" brings ${entry.count} new statements`)}</div>
        <ul className="oc-notes">
          {entry.sample.map((c) => <li key={c.id}>{t(`${c.subject.label} 的${c.predicateLabel.zh}：${claimValueText(c)}（自 ${day(c.validFrom)} 起）`, `${c.subject.label}, ${c.predicateLabel.en}: ${claimValueText(c)} (from ${day(c.validFrom)})`)}</li>)}
        </ul>
        <p className="oc-note">{t('确认后，你和 AI 问到时会用这些说法，并注明出自哪一行；不会改动订单系统里的任何数据。', 'Once confirmed, you and the AI use these statements with their source row; nothing in the order system changes.')}</p>
        {error ? <p className="oc-callout warn" role="alert">{error}</p> : null}
      </div>
      <div className="oc-decision-foot">
        <Button size="xs" disabled={busy !== null} onClick={() => void run('reject', () => consoleApi.decideSource(projectId, entry.source.id, 'REJECT'))} data-testid="console-new-knowledge-reject">
          {t('不采用', 'Don’t use')}
        </Button>
        <Button size="xs" variant="accent" disabled={busy !== null} onClick={() => void run('verify', () => consoleApi.decideSource(projectId, entry.source.id, 'VERIFY'))} data-testid="console-new-knowledge-verify">
          {busy === 'verify' ? <Loader2 size={11} className="pipeline-spin" aria-hidden="true" /> : null}
          {t('确认这些知识', 'Confirm them')}
        </Button>
      </div>
    </article>
  );
}

// ─── 应用与连接: data sources ─────────────────────────────────────────────────

export function ConsoleSourcesSection({ projectId, onChanged }: { projectId: string; onChanged?: () => void }) {
  const { t } = usePreferences();
  const [view, setView] = useState<DataSourcesView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const load = useCallback(() => {
    consoleApi.dataSources(projectId).then(setView, () => setView({ application: null, sources: [] }));
  }, [projectId]);
  useEffect(load, [load]);

  const attach = async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await consoleApi.attachSource(projectId, file.name, await file.text());
      const s = res.source;
      setMessage(
        res.duplicate
          ? { tone: 'ok', text: t('这份资料之前已经加过，内容一样，没有重复记下。', 'This file was added before with the same content; nothing was recorded twice.') }
          : s.objectId
            ? { tone: 'ok', text: t(`已加入：${s.rowCount} 行，带来 ${s.summary.claims} 条新知识${s.summary.disputed ? `，其中 ${s.summary.disputed} 条和别的资料说法不一致` : ''}，等你确认。`, `Added: ${s.rowCount} rows, ${s.summary.claims} new statements${s.summary.disputed ? `, ${s.summary.disputed} disagreeing with another source` : ''}, waiting for you.`) }
            : { tone: 'warn', text: t('已加入，但表里没有哪一列对得上应用里的记录，所以没有记下知识。', 'Added, but no column matches the application’s records, so no statements were recorded.') },
      );
      load();
      onChanged?.();
    } catch (err) {
      setMessage({ tone: 'warn', text: errorText(t, err) });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <section className="oc-card" data-testid="console-sources">
      <div className="oc-card-head">
        <div className="min-w-0">
          <h3 className="oc-card-title">{t('数据来源', 'Data sources')}</h3>
          <p className="oc-note">{t('经营数据来自已接入的应用；供应商报价等表格可以附加进来，确认后作为知识使用，不会改动应用。', 'Operating data comes from the connected application; tables such as supplier quotes can be attached and, once confirmed, used as knowledge without changing the application.')}</p>
        </div>
        <Button size="xs" onClick={() => input.current?.click()} disabled={busy} data-testid="console-attach-source">
          {busy ? <Loader2 size={11} className="pipeline-spin" aria-hidden="true" /> : <Paperclip size={11} aria-hidden="true" />}
          {t('附加表格', 'Attach a table')}
        </Button>
        <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={(e) => e.target.files?.[0] && void attach(e.target.files[0])} data-testid="console-attach-input" />
      </div>
      <div className="oc-card-pad">
        {message ? <p className={cn('oc-callout', message.tone === 'warn' && 'warn')} role="status" data-testid="console-attach-message">{message.text}</p> : null}
        <ul className="oc-source-list">
          {view?.application ? (
            <li>
              <span className="oc-source-icon" aria-hidden="true"><PackageSearch size={14} /></span>
              <span className="min-w-0">
                <span className="oc-check-text">{tb(t, view.application.name)}</span>
                <span className="oc-check-seen">{t('已接入的应用 · 实时读取', 'Connected application · read live')}</span>
              </span>
            </li>
          ) : null}
          {view?.sources.map((s) => {
            const problems = s.columns.reduce((n, c) => n + c.problems.length, 0);
            return (
              <li key={s.id} data-testid={`console-source-${s.id}`}>
                <span className="oc-source-icon" aria-hidden="true"><FileSpreadsheet size={14} /></span>
                <span className="min-w-0">
                  <span className="oc-check-text">{sourceName(s.fileName)}</span>
                  <span className="oc-check-seen">
                    {t(`${s.rowCount} 行 · ${s.columns.length} 列 · ${s.summary.claims} 条知识 · ${day(s.addedAt)} 加入`, `${s.rowCount} rows · ${s.columns.length} columns · ${s.summary.claims} statements · added ${day(s.addedAt)}`)}
                  </span>
                  {problems ? (
                    <span className="oc-check-seen warn">
                      <AlertTriangle size={11} className="mr-1 inline" aria-hidden="true" />
                      {t(`${problems} 个格子读不懂，没有当成知识：`, `${problems} cell(s) could not be read and were not used: `)}
                      {s.columns.flatMap((c) => c.problems.map((p) => t(`${c.name} 第 ${p.row + 1} 行「${p.value}」`, `${c.name} row ${p.row + 1} "${p.value}"`))).join(t('；', '; '))}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ─── 业务规则: what is known ──────────────────────────────────────────────────

export function ConsoleKnowledgeSection({ projectId, reload = 0 }: { projectId: string; reload?: number }) {
  const { t } = usePreferences();
  const [history, setHistory] = useState(false);
  const [view, setView] = useState<KnowledgeView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    consoleApi.knowledge(projectId, history).then(setView, () => setView({ asOf: '', claims: [] }));
  }, [projectId, history]);
  useEffect(load, [load, reload]);
  const statusText = (c: KnowledgeClaim) =>
    ({
      PROPOSED: t('等确认', 'Waiting'), VERIFIED: t('已确认', 'Confirmed'), DISPUTED: t('有争议', 'Disputed'), REJECTED: t('不采用', 'Not used'),
      SUPERSEDED: t('已被新版取代', 'Replaced by a newer one'), RETIRED: t('不再适用', 'No longer applies'),
    })[c.status];
  const rows = (view?.claims ?? []).filter((x) => history || x.claim.status !== 'PROPOSED');
  return (
    <section className="oc-card" data-testid="console-knowledge">
      <div className="oc-card-head">
        <div className="min-w-0">
          <h3 className="oc-card-title">{t('资料里记下的知识', 'Knowledge from sources')}</h3>
          <p className="oc-note">{history ? t('所有记下过的说法，包括被取代、不采用和不再适用的。', 'Every statement ever recorded, including replaced, unused and retired ones.') : t('今天适用的说法；每条都注明出自哪份资料哪一行。', 'Statements that apply today, each with its source and row.')}</p>
        </div>
        <Button size="xs" variant="toggle" aria-pressed={history} onClick={() => setHistory((h) => !h)} data-testid="console-knowledge-history">
          {t('看历史', 'Show history')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="oc-callout m-3">{t('还没有确认过的知识。附加资料并确认后会出现在这里。', 'No confirmed knowledge yet. Attach a source and confirm it to see it here.')}</p>
      ) : (
        <div className="oc-table-region">
          <table className="oc-table">
            <thead>
              <tr>
                <th>{t('对象', 'Record')}</th><th>{t('说法', 'Statement')}</th><th>{t('有效期', 'Valid')}</th><th>{t('出处', 'Source')}</th><th>{t('状态', 'Status')}</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ claim, provenance }) => (
                <tr key={claim.id} data-testid={`console-claim-${claim.id}`} data-status={claim.status}>
                  <td>{claim.subject.label}</td>
                  <td>{`${tb(t, claim.predicateLabel)}：${claimValueText(claim)}`}</td>
                  <td className="whitespace-nowrap">{claim.validTo ? `${day(claim.validFrom)} → ${day(claim.validTo)}` : t(`${day(claim.validFrom)} 起`, `from ${day(claim.validFrom)}`)}</td>
                  <td>{provenance[0] ? `${sourceName(provenance[0].fileName ?? '')} · ${rowLabel(t, provenance[0].locator)}` : '—'}</td>
                  <td><span className={cn('oc-tag', claim.status === 'VERIFIED' ? 'ok' : claim.status === 'DISPUTED' ? 'warn' : '')}>{statusText(claim)}</span></td>
                  <td>
                    {claim.status === 'VERIFIED' ? (
                      <Button size="xs" disabled={busy !== null} onClick={() => {
                        setBusy(claim.id);
                        consoleApi.decideClaim(projectId, claim.id, 'RETIRE').then(load, () => undefined).finally(() => setBusy(null));
                      }} data-testid={`console-claim-retire-${claim.id}`}>
                        {t('不再适用', 'Retire')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
