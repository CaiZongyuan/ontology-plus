import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Gauge,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Table2,
  Unplug,
} from 'lucide-react';
import {
  parseConnectionManifest,
  type ActivityResponse,
  type Bilingual,
  type ConnectionField,
  type ConnectionManifest,
  type ConnectionObject,
  type DataIssueStatus,
  type DataIssuesResponse,
  type FieldType,
  type MetricsResponse,
  type ObjectDetailResponse,
  type ObjectListResponse,
  type ReportResponse,
} from '../../../packages/application-runtime/index.js';
import type { OntologySuite } from '../../../packages/ontology-core/index.js';
import type { ActionInvocationRecord, ConnectedAppRecord } from '../../../packages/workspace-store/index.js';
import { useWorkbenchStore } from '../../api.js';
import { Button, ConfirmDialog } from '../../components/beautifui/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import type { NavViewId } from '../../navigation/index.js';
import { ActionForm, ApprovalCard, SettledInvocationLine, formFriendly, hhmm } from './ConsoleApprovals.js';
import { ConsoleRequestError, consoleApi, type ConsoleOverview } from './consoleApi.js';
import './operations-console.css';

/**
 * The Operations Console (经营驾驶舱, TeaCo spec v0.3.1 §11.1): one workspace per project whose
 * Runnable System is connected. Everything it shows is declared by the application's Connection
 * Manifest and read live as the chosen Acting Identity; rules come from the confirmed Business Model.
 * Reference: docs/ui-reference/teaco-operations-console.html.
 */

type Translate = (zh: string, en: string) => string;
const tb = (t: Translate, b: Bilingual | undefined | null) => (b ? t(b.zh, b.en) : '');
/** An application address as people read it: host and port, without the web protocol prefix. */
export const displayAddress = (url: string) => url.replace(/^[a-z]+:\/\//i, '');
const isBilingual = (v: unknown): v is Bilingual =>
  typeof v === 'object' && v !== null && typeof (v as Bilingual).zh === 'string' && typeof (v as Bilingual).en === 'string';

/** Formats one field value as the manifest types it; money is integer minor units of `currency`. */
export function formatConsoleValue(value: unknown, type: FieldType | 'count', t: Translate, currency: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (isBilingual(value)) return tb(t, value);
  if (typeof value === 'number') {
    if (type === 'money') return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);
    return value.toLocaleString('en-US');
  }
  return String(value);
}

const ISSUE_STATUS: Record<DataIssueStatus, { label: Bilingual; tone: string }> = {
  OPEN: { label: { zh: '等你确认', en: 'Needs you' }, tone: 'bg-warning-soft text-warning' },
  INVESTIGATING: { label: { zh: '调查中', en: 'Investigating' }, tone: 'bg-primary-soft text-primary' },
  PROPOSED: { label: { zh: '已提方案', en: 'Fix proposed' }, tone: 'bg-primary-soft text-primary' },
  APPROVED: { label: { zh: '已批准', en: 'Approved' }, tone: 'bg-primary-soft text-primary' },
  APPLIED: { label: { zh: '已修正', en: 'Applied' }, tone: 'bg-primary-soft text-primary' },
  VERIFIED: { label: { zh: '已处理', en: 'Handled' }, tone: 'bg-success-soft text-success' },
  DISMISSED: { label: { zh: '已忽略', en: 'Dismissed' }, tone: 'bg-muted text-muted-foreground' },
};
const FLAG_TONE = { info: 'bg-primary-soft text-primary', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', error: 'bg-destructive-soft text-destructive' } as const;

function Pill({ tone, children, testId }: { tone: string; children: React.ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className={cn('inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium', tone)}>
      {children}
    </span>
  );
}

function SectionCard({ title, sub, children, aside }: { title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="oc-card">
      <div className="oc-card-head">
        <div className="min-w-0">
          <h3 className="oc-card-title">{title}</h3>
          {sub ? <p className="oc-card-sub">{sub}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

const openDecisions = (issues: DataIssuesResponse | null) =>
  (issues?.issues ?? []).filter((i) => i.needsDecision && i.status !== 'VERIFIED' && i.status !== 'DISMISSED');

/** Month-day and wall-clock time in the viewer's own time zone. */
function localStamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${hhmm(iso)}`;
}

// ─── Approvals ────────────────────────────────────────────────────────────────

/** What the workspace hands its pages so they can start, approve and settle runtime changes. */
export interface ConsoleApprovals {
  readonly invocations: readonly ActionInvocationRecord[];
  readonly busyId: string | null;
  /** Per card: why its last step did not go through. */
  readonly notices?: Readonly<Record<string, Bilingual>>;
  /** Prepares an action; resolves to the application's refusal, or null when a card was created. */
  readonly prepare: (actionId: string, target: string | undefined, params: Record<string, unknown>) => Promise<Bilingual | null>;
  readonly approve: (inv: ActionInvocationRecord) => void;
  readonly decline: (inv: ActionInvocationRecord) => void;
  readonly reconcile: (inv: ActionInvocationRecord) => void;
  readonly prepareAgain: (inv: ActionInvocationRecord) => void;
}

const OPEN_STATES = new Set(['PENDING_APPROVAL', 'EXECUTING', 'UNKNOWN']);

/** Cards that still need the person: open ones, plus the latest failure or expiry per action and record. */
export function cardsToShow(invocations: readonly ActionInvocationRecord[], target?: string) {
  const seen = new Set<string>();
  const cards: ActionInvocationRecord[] = [];
  const settled: ActionInvocationRecord[] = [];
  for (const inv of invocations) {
    if (target !== undefined && inv.target !== target) continue;
    const key = `${inv.actionId}|${inv.target ?? ''}`;
    const latest = !seen.has(key);
    seen.add(key);
    if (OPEN_STATES.has(inv.status) || (latest && (inv.status === 'FAILED' || inv.status === 'EXPIRED'))) cards.push(inv);
    else settled.push(inv);
  }
  return { cards, settled };
}

function approvalCard(inv: ActionInvocationRecord, manifest: ConnectionManifest, approvals: ConsoleApprovals) {
  return (
    <ApprovalCard
      key={inv.id}
      invocation={inv}
      manifest={manifest}
      busy={approvals.busyId === inv.id}
      notice={approvals.notices?.[inv.id] ?? null}
      onApprove={approvals.approve}
      onDecline={approvals.decline}
      onReconcile={approvals.reconcile}
      onPrepareAgain={approvals.prepareAgain}
    />
  );
}

/** A data problem whose fix is an action: says what is wrong and lets the owner start the fix. */
function IssueDecision({ issue, manifest, approvals, onOpenDataIssues }: {
  issue: DataIssuesResponse['issues'][number];
  manifest: ConnectionManifest;
  approvals: ConsoleApprovals | undefined;
  onOpenDataIssues: (() => void) | undefined;
}) {
  const { t } = usePreferences();
  const action = issue.action ? manifest.actions.find((a) => a.id === issue.action!.actionId) : undefined;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);
  const start = async (params: Record<string, unknown>) => {
    if (!approvals || !action) return;
    setBusy(true);
    const refusal = await approvals.prepare(action.id, issue.action!.target, params);
    setBusy(false);
    setError(refusal);
    if (!refusal) setOpen(false);
  };
  return (
    <article className="oc-decision" data-testid={`console-decision-${issue.id}`}>
      <div className="oc-decision-head">
        <AlertTriangle size={13} aria-hidden="true" />
        {t('数据问题 · 需要你确认', 'Data problem · needs you')}
      </div>
      <div className="oc-decision-body">
        <div className="oc-decision-title">{tb(t, issue.title)}</div>
        <p className="oc-decision-what">{tb(t, issue.detail)}</p>
        {open && action ? (
          <ActionForm action={action} busy={busy} error={error} onSubmit={(p) => void start(p)} onCancel={() => setOpen(false)} />
        ) : null}
      </div>
      {!open ? (
        <div className="oc-decision-foot">
          <Button size="xs" onClick={onOpenDataIssues}>{t('在数据体检里查看', 'Open in data check')}</Button>
          {action && approvals ? (
            <Button
              size="xs"
              variant="accent"
              data-testid={`console-decision-start-${issue.id}`}
              onClick={() => (action.params.length ? setOpen(true) : void start({}))}
            >
              {tb(t, action.name)}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

export interface ConsoleOverviewPageProps {
  readonly manifest: ConnectionManifest;
  readonly actorId: string;
  readonly overview: ConsoleOverview;
  readonly onOpenDataIssues?: () => void;
  readonly onOpenReport?: (reportId: string) => void;
  readonly approvals?: ConsoleApprovals;
}

export function ConsoleOverviewPage({ manifest, actorId, overview, onOpenDataIssues, onOpenReport, approvals }: ConsoleOverviewPageProps) {
  const { t } = usePreferences();
  const currency = manifest.application.currency;
  const actor = manifest.actors.find((a) => a.id === actorId) ?? manifest.actors[0]!;
  const values = new Map(overview.metrics.values.map((v) => [v.id, v]));
  const headlineMetric = manifest.metrics.find((m) => m.headline);
  const { cards, settled } = cardsToShow(approvals?.invocations ?? []);
  // A data problem whose fix is already waiting as a card is not asked twice.
  const decisions = openDecisions(overview.dataIssues).filter(
    (i) => !cards.some((c) => i.action && c.actionId === i.action.actionId && c.target === i.action.target && c.status !== 'FAILED' && c.status !== 'EXPIRED'),
  );
  const waiting = cards.length + decisions.length;
  const headlineValue = headlineMetric ? formatConsoleValue(values.get(headlineMetric.id)?.value, headlineMetric.unit, t, currency) : null;
  const headline = headlineMetric?.headline && headlineValue
    ? t(headlineMetric.headline.zh.replace('{value}', headlineValue), headlineMetric.headline.en.replace('{value}', headlineValue))
    : t('数据已经接上', 'The data is connected');
  const tail = waiting
    ? t(`有 ${waiting} 件事等你确认。`, `${waiting} ${waiting === 1 ? 'thing needs' : 'things need'} you.`)
    : t('没有需要你确认的事。', 'Nothing needs you right now.');

  return (
    <div className="oc-page" data-testid="console-overview">
      <div className="oc-lead">
        <span className="oc-eyebrow">{`${tb(t, actor.name)} · ${tb(t, actor.scope)}`}</span>
        <h1 className="oc-headline" data-testid="console-headline">
          {headline}
          {t('；', '. ')}
          {tail}
        </h1>
      </div>

      <div className="oc-kpis">
        {manifest.metrics.map((m) => {
          const v = values.get(m.id);
          return (
            <div key={m.id} className="oc-kpi" data-testid={`console-metric-${m.id}`}>
              <span className="oc-kpi-k">{tb(t, m.name)}</span>
              <span className="oc-kpi-v">{formatConsoleValue(v?.value, m.unit, t, currency)}</span>
              <span className="oc-kpi-h">{tb(t, v?.hint ?? m.hint)}</span>
            </div>
          );
        })}
      </div>

      <div className="oc-two">
        <div className="oc-stack">
          <h2 className="oc-section-title">
            {t('等你确认', 'Needs you')}
            <span className="oc-count">{waiting}</span>
          </h2>
          {waiting === 0 ? (
            <p className="oc-callout">{t('都处理完了。有新的事会出现在这里。', 'All clear. New items will appear here.')}</p>
          ) : null}
          {approvals ? cards.map((inv) => approvalCard(inv, manifest, approvals)) : null}
          {decisions.map((issue) => (
            <IssueDecision key={issue.id} issue={issue} manifest={manifest} approvals={approvals} onOpenDataIssues={onOpenDataIssues} />
          ))}
          {settled.length > 0 ? (
            <ul className="oc-settled-list" aria-label={t('最近处理过的', 'Recently settled')}>
              {settled.slice(0, 5).map((inv) => <SettledInvocationLine key={inv.id} invocation={inv} />)}
            </ul>
          ) : null}
        </div>

        <div className="oc-stack">
          {manifest.reports.map((r) => (
            <button key={r.id} type="button" className="oc-link-card" onClick={() => onOpenReport?.(r.id)}>
              <BarChart3 size={15} aria-hidden="true" className="text-primary" />
              <span className="min-w-0">
                <span className="oc-link-card-title">{tb(t, r.name)}</span>
                {r.description ? <span className="oc-link-card-sub">{tb(t, r.description)}</span> : null}
              </span>
            </button>
          ))}
          {overview.activity ? (
            <SectionCard title={t('最近发生的事', 'Recent activity')}>
              <ConsoleActivityList activity={overview.activity} />
            </SectionCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ConsoleActivityList({ activity }: { activity: ActivityResponse }) {
  const { t } = usePreferences();
  if (activity.events.length === 0) return <p className="oc-empty">{t('还没有记录。', 'Nothing recorded yet.')}</p>;
  return (
    <ul className="oc-feed">
      {activity.events.slice(0, 8).map((e, i) => (
        <li key={`${e.at}-${i}`}>
          <span className="oc-feed-t">{localStamp(e.at)}</span>
          {e.kind === 'warning' ? <AlertTriangle size={14} className="text-warning" aria-hidden="true" /> : <CheckCircle2 size={14} className="text-success" aria-hidden="true" />}
          <span>{tb(t, e.text)}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Business objects ─────────────────────────────────────────────────────────

export interface ConsoleObjectPageProps {
  readonly manifest: ConnectionManifest;
  readonly object: ConnectionObject;
  readonly filter: string;
  readonly list: ObjectListResponse | null;
  readonly selectedKey: string | null;
  readonly detail: ObjectDetailResponse | null;
  readonly detailState: 'idle' | 'loading' | 'ready' | 'missing';
  readonly onFilter?: (filter: string) => void;
  readonly onSelect?: (key: string) => void;
  readonly approvals?: ConsoleApprovals;
}

function Cell({ field, value, currency }: { field: ConnectionField; value: unknown; currency: string }) {
  const { t } = usePreferences();
  const text = formatConsoleValue(value, field.type, t, currency);
  if (field.type === 'status' && text !== '—') return <Pill tone="bg-muted text-foreground-soft">{text}</Pill>;
  return <>{text}</>;
}

export function ConsoleObjectPage({ manifest, object, filter, list, selectedKey, detail, detailState, onFilter, onSelect, approvals }: ConsoleObjectPageProps) {
  const { t } = usePreferences();
  const currency = manifest.application.currency;
  const counts = new Map((list?.counts ?? []).map((c) => [c.filter, c.count]));
  const numeric = (f: ConnectionField) => f.type === 'money' || f.type === 'number';
  return (
    <div className="oc-page" data-testid={`console-object-${object.id}`}>
      <div className="oc-lead">
        <span className="oc-eyebrow">{tb(t, object.name)}</span>
        <h1 className="oc-headline">
          {list ? t(`${list.total} 条`, `${list.total} shown`) : t('正在读取…', 'Loading…')}
        </h1>
      </div>
      {object.filters.length > 0 ? (
        <div className="oc-filters" role="group" aria-label={t('筛选', 'Filter')}>
          {object.filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              className="oc-filter"
              onClick={() => onFilter?.(f.id)}
              data-testid={`console-filter-${f.id}`}
            >
              {tb(t, f.label)}
              {counts.has(f.id) ? <strong>{counts.get(f.id)}</strong> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="oc-two">
        <section className="oc-card">
          <div className="oc-table-region" role="region" aria-label={tb(t, object.name)} tabIndex={0}>
            <table className="oc-table">
              <thead>
                <tr>
                  {object.fields.map((f) => (
                    <th key={f.key} className={numeric(f) ? 'r' : undefined}>{tb(t, f.label)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(list?.rows ?? []).map((row) => (
                  <tr
                    key={row.key}
                    className={cn('clickable', selectedKey === row.key && 'is-active')}
                    onClick={() => onSelect?.(row.key)}
                    data-testid={`console-row-${row.key}`}
                  >
                    {object.fields.map((f) => (
                      <td key={f.key} className={numeric(f) ? 'r' : undefined}>
                        <Cell field={f} value={row.values[f.key]} currency={currency} />
                        {f.key === object.titleField && row.flags.length > 0 ? (
                          <span className="ml-1.5 inline-flex gap-1 align-middle">
                            {row.flags.map((flag, i) => (
                              <Pill key={i} tone={FLAG_TONE[flag.tone]}>{tb(t, flag.label)}</Pill>
                            ))}
                          </span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
                {list && list.rows.length === 0 ? (
                  <tr>
                    <td colSpan={object.fields.length} className="oc-empty">{t('这个筛选下没有记录。', 'Nothing under this filter.')}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
        <ConsoleObjectDetail object={object} manifest={manifest} detail={detail} state={detailState} approvals={approvals} />
      </div>
    </div>
  );
}

function ConsoleObjectDetail({ object, manifest, detail, state, approvals }: {
  object: ConnectionObject;
  manifest: ConnectionManifest;
  detail: ObjectDetailResponse | null;
  state: ConsoleObjectPageProps['detailState'];
  approvals: ConsoleApprovals | undefined;
}) {
  const { t } = usePreferences();
  const currency = manifest.application.currency;
  const [formFor, setFormFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Bilingual | null>(null);
  const key = detail?.key;
  useEffect(() => {
    setFormFor(null);
    setRefusal(null);
  }, [key]);
  if (state === 'idle') return <p className="oc-callout">{t('点左边任意一条，看它的明细。', 'Pick a row to see its details.')}</p>;
  if (state === 'loading') return <p className="oc-callout">{t('正在读取…', 'Loading…')}</p>;
  if (state === 'missing' || !detail) return <p className="oc-callout">{t('这一条不存在，或不在当前身份能看的范围内。', 'This record does not exist or is outside the current identity’s scope.')}</p>;
  const title = formatConsoleValue(detail.values[object.titleField], 'text', t, currency);
  // A change already waiting (or unsettled) on this record is not offered a second time.
  const recordCards = approvals ? cardsToShow(approvals.invocations, detail.key).cards : [];
  return (
    <SectionCard
      title={title}
      sub={object.statusField ? formatConsoleValue(detail.values[object.statusField], 'status', t, currency) : undefined}
    >
      <div className="oc-card-pad" data-testid="console-object-detail">
        {recordCards.map((inv) => approvalCard(inv, manifest, approvals!))}
        {approvals ? (
          <RecordActions
            manifest={manifest}
            offered={detail.actions.filter((id) => !recordCards.some((c) => c.actionId === id && (c.status === 'PENDING_APPROVAL' || c.status === 'EXECUTING' || c.status === 'UNKNOWN')))}
            formFor={formFor}
            busy={busy}
            refusal={refusal}
            onPick={async (action) => {
              setRefusal(null);
              if (action.params.length) return setFormFor(action.id);
              setBusy(action.id);
              setRefusal(await approvals.prepare(action.id, detail.key, {}));
              setBusy(null);
            }}
            onSubmit={async (action, params) => {
              setBusy(action.id);
              const r = await approvals.prepare(action.id, detail.key, params);
              setBusy(null);
              setRefusal(r);
              if (!r) setFormFor(null);
            }}
            onCancel={() => setFormFor(null)}
          />
        ) : null}
        {detail.flags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {detail.flags.map((flag, i) => <Pill key={i} tone={FLAG_TONE[flag.tone]}>{tb(t, flag.label)}</Pill>)}
          </div>
        ) : null}
        <dl className="oc-dl">
          {object.fields.filter((f) => f.key !== object.titleField).map((f) => (
            <React.Fragment key={f.key}>
              <dt>{tb(t, f.label)}</dt>
              <dd><Cell field={f} value={detail.values[f.key]} currency={currency} /></dd>
            </React.Fragment>
          ))}
        </dl>
        {detail.sections.map((section, i) => (
          <ConsoleTable key={i} title={section.title} columns={section.columns} rows={section.rows} currency={currency} />
        ))}
        {detail.notes.map((note, i) => <p key={i} className="oc-note">{tb(t, note)}</p>)}
      </div>
    </SectionCard>
  );
}

/** The actions this record offers to the acting identity; each one is prepared, then approved. */
function RecordActions({ manifest, offered, formFor, busy, refusal, onPick, onSubmit, onCancel }: {
  manifest: ConnectionManifest;
  offered: readonly string[];
  formFor: string | null;
  busy: string | null;
  refusal: Bilingual | null;
  onPick: (action: ConnectionManifest['actions'][number]) => void;
  onSubmit: (action: ConnectionManifest['actions'][number], params: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const { t } = usePreferences();
  const actions = manifest.actions.filter((a) => offered.includes(a.id) && formFriendly(a));
  if (actions.length === 0) return null;
  const open = actions.find((a) => a.id === formFor);
  return (
    <div className="oc-record-actions" data-testid="console-record-actions">
      <div className="oc-eyebrow">{t('可以做的操作（执行前会请你批准）', 'Possible actions (you approve before anything runs)')}</div>
      {open ? (
        <ActionForm action={open} busy={busy === open.id} error={refusal} onSubmit={(p) => onSubmit(open, p)} onCancel={onCancel} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {actions.map((a) => (
              <Button key={a.id} size="xs" onClick={() => onPick(a)} disabled={busy !== null} data-testid={`console-action-${a.id}`}>
                {busy === a.id ? <Loader2 size={11} className="pipeline-spin" aria-hidden="true" /> : null}
                {tb(t, a.name)}
              </Button>
            ))}
          </div>
          {refusal ? <p className="oc-approval-outcome warn" role="alert" data-testid="console-action-refusal">{tb(t, refusal)}</p> : null}
        </>
      )}
    </div>
  );
}

function ConsoleTable({ title, columns, rows, currency }: { title?: Bilingual | undefined; columns: readonly ConnectionField[]; rows: readonly Record<string, unknown>[]; currency: string }) {
  const { t } = usePreferences();
  const numeric = (f: ConnectionField) => f.type === 'money' || f.type === 'number';
  return (
    <div className="oc-stack">
      {title ? <div className="oc-eyebrow">{tb(t, title)}</div> : null}
      <div className="oc-table-region" role="region" aria-label={tb(t, title) || t('表格', 'Table')} tabIndex={0}>
        <table className="oc-table">
          <thead>
            <tr>{columns.map((c) => <th key={c.key} className={numeric(c) ? 'r' : undefined}>{tb(t, c.label)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className={numeric(c) ? 'r' : undefined}><Cell field={c} value={row[c.key]} currency={currency} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Reports, data check, rules ───────────────────────────────────────────────

export function ConsoleReportPage({ manifest, reportId, report }: { manifest: ConnectionManifest; reportId: string; report: ReportResponse }) {
  const { t } = usePreferences();
  const spec = manifest.reports.find((r) => r.id === reportId);
  return (
    <div className="oc-page" data-testid={`console-report-${reportId}`}>
      <div className="oc-lead">
        <span className="oc-eyebrow">{t('报表', 'Report')}</span>
        <h1 className="oc-headline">{tb(t, report.title ?? spec?.name)}</h1>
        {report.basis ? <p className="oc-note">{tb(t, report.basis)}</p> : null}
      </div>
      <section className="oc-card oc-card-pad">
        <ConsoleTable columns={report.columns} rows={report.rows} currency={manifest.application.currency} />
      </section>
    </div>
  );
}

export function ConsoleDataIssuesPage({ issues }: { issues: DataIssuesResponse }) {
  const { t } = usePreferences();
  const pending = openDecisions(issues).length;
  return (
    <div className="oc-page" data-testid="console-data-issues">
      <div className="oc-lead">
        <span className="oc-eyebrow">{t('数据体检', 'Data check')}</span>
        <h1 className="oc-headline">
          {pending
            ? t(`发现 ${issues.issues.length} 类问题，还有 ${pending} 类等你确认`, `${issues.issues.length} kinds of problem found; ${pending} still need you`)
            : t(`发现 ${issues.issues.length} 类问题，都已处理`, `${issues.issues.length} kinds of problem found, all handled`)}
        </h1>
        <p className="oc-note">{t('原始数据一个字都没改；每一处修正都记了来源和原因。', 'The original data is untouched; every correction records its source and reason.')}</p>
      </div>
      <section className="oc-card">
        <ul className="oc-checklist">
          {issues.issues.map((issue) => {
            const s = ISSUE_STATUS[issue.status];
            return (
              <li key={issue.id} data-testid={`console-issue-${issue.id}`}>
                {issue.status === 'VERIFIED' ? <CheckCircle2 size={15} className="text-success" aria-hidden="true" /> : <AlertTriangle size={15} className="text-warning" aria-hidden="true" />}
                <div className="min-w-0">
                  <div className="oc-check-title">{tb(t, issue.title)}</div>
                  <div className="oc-check-detail">{tb(t, issue.detail)}</div>
                </div>
                <Pill tone={s.tone}>{tb(t, s.label)}</Pill>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export function ConsoleRulesPage({ suite }: { suite: OntologySuite | null }) {
  const { t } = usePreferences();
  const rules = suite
    ? [
        ...(suite.M3?.rules ?? []).map((r) => ({ key: r.id, title: r.alias || r.name, detail: r.description ?? '' })),
        ...(suite.M1?.aggregates ?? []).flatMap((a) => a.invariants.map((inv, i) => ({ key: `${a.id}-${i}`, title: `${a.alias || a.name}：${inv.name}`, detail: inv.violationMessage }))),
      ]
    : [];
  return (
    <div className="oc-page" data-testid="console-rules">
      <div className="oc-lead">
        <span className="oc-eyebrow">{t('业务规则', 'Business rules')}</span>
        <h1 className="oc-headline">
          {suite ? t(`应用按已确认的业务模型里的 ${rules.length} 条规则办事`, `The application follows ${rules.length} rules from the confirmed Business Model`) : t('业务模型还没有确认', 'The Business Model is not confirmed yet')}
        </h1>
        <p className="oc-note">
          {t('规则来自项目里确认过的业务模型；要改规则，回到业务模型步骤修改并重新确认。', 'Rules come from the project’s confirmed Business Model; change them in the Business Model step and confirm again.')}
        </p>
      </div>
      {rules.length > 0 ? (
        <section className="oc-card">
          <ul className="oc-checklist">
            {rules.map((r) => (
              <li key={r.key}>
                <BookOpen size={15} className="text-faint-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="oc-check-title">{r.title}</div>
                  {r.detail ? <div className="oc-check-detail">{r.detail}</div> : null}
                </div>
                <span />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ─── Connection ───────────────────────────────────────────────────────────────

export interface ConsoleConnectionPageProps {
  readonly record: ConnectedAppRecord;
  readonly manifest: ConnectionManifest;
  readonly busy?: boolean;
  readonly onCheck?: () => void;
  readonly onDisconnect?: () => void;
}

export function ConsoleConnectionPage({ record, manifest, busy, onCheck, onDisconnect }: ConsoleConnectionPageProps) {
  const { t } = usePreferences();
  const drifted = record.status === 'DRIFTED';
  const chips = (items: string[]) => (
    <div className="flex flex-wrap gap-1.5">
      {items.map((x) => <span key={x} className="oc-chip">{x}</span>)}
    </div>
  );
  return (
    <div className="oc-page" data-testid="console-connection">
      <div className="oc-lead">
        <span className="oc-eyebrow">{t('应用与连接', 'Application and connection')}</span>
        <h1 className="oc-headline">
          {drifted ? t('应用有变化，等你重新核对', 'The application changed and needs a re-check') : t('应用在运行，已经接上并核对过', 'The application is running, connected and checked')}
        </h1>
      </div>
      <div className="oc-two">
        <SectionCard
          title={`${tb(t, manifest.application.name)} ${manifest.application.version}`}
          sub={tb(t, manifest.application.description)}
          aside={drifted ? <Pill tone="bg-warning-soft text-warning">{t('已漂移', 'Drifted')}</Pill> : <Pill tone="bg-success-soft text-success">{t('已接入', 'Connected')}</Pill>}
        >
          <div className="oc-card-pad">
            <div className="oc-eyebrow">{t('能查的业务对象', 'Business objects it shows')}</div>
            {chips(manifest.objects.map((o) => tb(t, o.name)))}
            <div className="oc-eyebrow">{t('能看的数字', 'Figures it reports')}</div>
            {chips(manifest.metrics.map((m) => tb(t, m.name)))}
            {manifest.reports.length > 0 ? (
              <>
                <div className="oc-eyebrow">{t('报表', 'Reports')}</div>
                {chips(manifest.reports.map((r) => tb(t, r.name)))}
              </>
            ) : null}
            {record.hints.length > 0 ? (
              <div className="oc-callout warn" data-testid="console-connection-hints">
                <div className="font-medium">{t('核对时发现：', 'The check found:')}</div>
                <ul className="m-0 mt-1 list-disc pl-4">
                  {record.hints.map((h, i) => <li key={i}>{tb(t, h.message)}</li>)}
                </ul>
              </div>
            ) : (
              <p className="oc-note">{t('应用里的业务对象和已确认的业务模型一一对得上。', 'Every business object matches the confirmed Business Model.')}</p>
            )}
            <details className="oc-details">
              <summary>{t('技术详情', 'Technical Details')}</summary>
              <dl className="oc-dl">
                <dt>{t('地址', 'Address')}</dt><dd>{displayAddress(record.baseUrl)}</dd>
                <dt>{t('协议', 'Protocol')}</dt><dd>{manifest.protocol}</dd>
                <dt>{t('清单指纹', 'Manifest fingerprint')}</dt><dd className="break-all">{record.manifestFingerprint}</dd>
                <dt>{t('接入时间', 'Connected at')}</dt><dd>{record.connectedAt.slice(0, 16).replace('T', ' ')}</dd>
                <dt>{t('上次核对', 'Last checked')}</dt><dd>{record.checkedAt.slice(0, 16).replace('T', ' ')}</dd>
              </dl>
            </details>
          </div>
          <div className="oc-card-foot">
            <Button size="xs" variant="danger" onClick={onDisconnect} disabled={busy} data-testid="console-disconnect-btn">
              <Unplug size={12} aria-hidden="true" />
              {t('断开连接', 'Disconnect')}
            </Button>
            <Button size="xs" variant="accent" onClick={onCheck} disabled={busy} data-testid="console-recheck-btn">
              <RefreshCw size={12} aria-hidden="true" />
              {t('重新核对', 'Check again')}
            </Button>
          </div>
        </SectionCard>
        <SectionCard title={t('谁能看什么', 'Who sees what')} sub={t('身份由你在上方选择；应用按身份决定能看到的范围。', 'You pick the identity above; the application decides what that identity can see.')}>
          <ul className="oc-checklist">
            {manifest.actors.map((a) => (
              <li key={a.id}>
                <ShieldCheck size={15} className="text-faint-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="oc-check-title">{`${tb(t, a.name)} · ${tb(t, a.role)}`}</div>
                  <div className="oc-check-detail">{tb(t, a.scope)}</div>
                </div>
                <span />
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}

// ─── Connecting ───────────────────────────────────────────────────────────────

export interface ConnectAppPanelProps {
  readonly projectName: string;
  readonly busy?: boolean;
  readonly error?: ConsoleRequestError | null;
  readonly initialAddress?: string;
  readonly onConnect?: (address: string) => void;
}

function describeConnectError(t: Translate, err: ConsoleRequestError): string {
  switch (err.code) {
    case 'INVALID_ADDRESS': return t('这个地址不对，请填应用的网址，比如 127.0.0.1:4320。', 'That address is not valid; enter the application’s address, for example 127.0.0.1:4320.');
    case 'UNREACHABLE': return t('连不上这个地址。请确认应用已经启动，地址和端口都对。', 'Nothing answers at this address. Check that the application is running and the address and port are right.');
    case 'NOT_FOUND': return t('这个地址上的应用没有按开发包的《接入 Ontology Plus》提供接入清单。', 'The application at this address does not serve the Connection Manifest described in the Development Package.');
    case 'INVALID_MANIFEST': return t('应用提供的接入清单不符合约定：', 'The application’s Connection Manifest does not follow the contract:');
    default: return t(`接入没有成功：${err.message}`, `Connecting failed: ${err.message}`);
  }
}

export function ConnectAppPanel({ projectName, busy, error, initialAddress, onConnect }: ConnectAppPanelProps) {
  const { t } = usePreferences();
  const [address, setAddress] = useState(initialAddress ?? '127.0.0.1:4320');
  return (
    <div className="oc-connect" data-testid="console-connect-panel">
      <div className="oc-connect-card">
        <div className="oc-connect-icon"><Plug size={18} aria-hidden="true" /></div>
        <h1 className="oc-headline">{t(`接入「${projectName}」开发好的应用`, `Connect the application built for “${projectName}”`)}</h1>
        <p className="oc-note">
          {t(
            '按开发包里《接入 Ontology Plus》开发的应用，填上它的地址就能接入，不需要账号密码。接入后这里会变成经营驾驶舱：实时看数字、订单和数据问题。',
            'An application built by the Development Package’s “Connect to Ontology Plus” guide connects by its address alone, with no account or password. Once connected, this becomes the Operations Console with live figures, records and data problems.',
          )}
        </p>
        <form
          className="oc-connect-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (address.trim()) onConnect?.(address.trim());
          }}
        >
          <label className="oc-eyebrow" htmlFor="console-connect-address">{t('应用地址', 'Application address')}</label>
          <div className="flex gap-2">
            <input
              id="console-connect-address"
              data-testid="console-connect-address"
              className="oc-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="127.0.0.1:4320"
              autoComplete="off"
            />
            <Button type="submit" variant="accent" size="md" disabled={busy || !address.trim()} data-testid="console-connect-submit">
              {busy ? <Loader2 size={13} className="pipeline-spin" aria-hidden="true" /> : <Plug size={13} aria-hidden="true" />}
              {t('接入', 'Connect')}
            </Button>
          </div>
        </form>
        {error ? (
          <div className="oc-callout warn" role="alert" data-testid="console-connect-error">
            {describeConnectError(t, error)}
            {error.problems.length > 0 ? (
              <ul className="m-0 mt-1 list-disc pl-4">
                {error.problems.slice(0, 6).map((p, i) => <li key={i}>{`${p.path}: ${p.message}`}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Workspace ────────────────────────────────────────────────────────────────

type ConsolePage =
  | { readonly kind: 'overview' }
  | { readonly kind: 'object'; readonly id: string }
  | { readonly kind: 'report'; readonly id: string }
  | { readonly kind: 'data' }
  | { readonly kind: 'rules' }
  | { readonly kind: 'connection' };

const pageKey = (p: ConsolePage) => ('id' in p ? `${p.kind}:${p.id}` : p.kind);

function readStoredActor(projectId: string): string | null {
  try {
    return window.localStorage.getItem(`onto.console.actor.${projectId}`);
  } catch {
    return null;
  }
}
function storeActor(projectId: string, actor: string) {
  try {
    window.localStorage.setItem(`onto.console.actor.${projectId}`, actor);
  } catch {
    /* per-device convenience only */
  }
}

interface ReadState<T> {
  readonly status: 'loading' | 'ready' | 'error';
  readonly data: T | null;
  readonly error: ConsoleRequestError | null;
}

function useConsoleRead<T>(load: (() => Promise<T>) | null, deps: readonly unknown[], onError: (err: ConsoleRequestError) => void): ReadState<T> {
  const [state, setState] = useState<ReadState<T>>({ status: 'loading', data: null, error: null });
  useEffect(() => {
    if (!load) return;
    let live = true;
    setState((s) => ({ status: 'loading', data: s.data, error: null }));
    load().then(
      (data) => live && setState({ status: 'ready', data, error: null }),
      (err: unknown) => {
        if (!live) return;
        const e = err instanceof ConsoleRequestError ? err : new ConsoleRequestError('UNKNOWN', String(err), 0);
        onError(e);
        setState({ status: 'error', data: null, error: e });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function setConnectedApp(projectId: string, record: ConnectedAppRecord | null) {
  useWorkbenchStore.setState((s) =>
    s.data
      ? { data: { ...s.data, connectedApps: [...(s.data.connectedApps ?? []).filter((a) => a.projectId !== projectId), ...(record ? [record] : [])] } }
      : {},
  );
}

function ConsoleStateNotice({ error, record, busy, onCheck, onRetry }: { error: ConsoleRequestError | null; record: ConnectedAppRecord; busy: boolean; onCheck: () => void; onRetry: () => void }) {
  const { t } = usePreferences();
  if (record.status === 'DRIFTED' || error?.code === 'DRIFTED') {
    const reason = (error?.connectedApp ?? record).driftReason;
    return (
      <div className="oc-notice warn" role="status" data-testid="console-drifted">
        <AlertTriangle size={16} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {reason === 'MODEL_CHANGED'
              ? t('业务模型重新确认过了，需要重新核对应用', 'The Business Model was confirmed again; the application needs a re-check')
              : t('应用更新了，需要重新核对', 'The application changed and needs a re-check')}
          </div>
          <div className="text-[12.5px] text-muted-foreground">
            {t('重新核对之前，这里不显示数字，免得按旧的意思理解新数据。', 'Until it is checked again, no figures are shown, so new data is not read with old meaning.')}
          </div>
        </div>
        <Button size="sm" variant="accent" onClick={onCheck} disabled={busy} data-testid="console-drift-recheck-btn">
          <RefreshCw size={13} aria-hidden="true" />
          {t('重新核对', 'Check again')}
        </Button>
      </div>
    );
  }
  if (!error) return null;
  return (
    <div className="oc-notice bad" role="status" data-testid={`console-error-${error.code}`}>
      <AlertTriangle size={16} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {error.code === 'UNREACHABLE'
            ? t(`连不上应用（${displayAddress(record.baseUrl)}）`, `The application cannot be reached (${displayAddress(record.baseUrl)})`)
            : t('应用的回答不符合接入约定', 'The application’s answer does not follow the connection contract')}
        </div>
        <div className="text-[12.5px] text-muted-foreground">
          {error.code === 'UNREACHABLE' ? t('请确认应用在运行；这里不显示旧数据。', 'Check that it is running; old data is not shown here.') : error.message}
        </div>
      </div>
      <Button size="sm" onClick={onRetry}>
        <RefreshCw size={13} aria-hidden="true" />
        {t('再试一次', 'Try again')}
      </Button>
    </div>
  );
}

function ConsoleWorkspace({ record, projectId, suite }: { record: ConnectedAppRecord; projectId: string; suite: OntologySuite | null }) {
  const { t } = usePreferences();
  const parsed = useMemo(() => parseConnectionManifest(record.manifest), [record.manifest]);
  const manifest = parsed.ok ? parsed.manifest : null;
  const [actor, setActor] = useState<string>(() => {
    const stored = readStoredActor(projectId);
    return manifest?.actors.some((a) => a.id === stored) ? stored! : manifest?.actors[0]?.id ?? '';
  });
  const [page, setPage] = useState<ConsolePage>({ kind: 'overview' });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, string | null>>({});
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const drifted = record.status === 'DRIFTED';
  const onError = (err: ConsoleRequestError) => {
    if (err.code === 'DRIFTED' && err.connectedApp) setConnectedApp(projectId, err.connectedApp);
  };
  const blocked = drifted || !manifest;
  const needsOverview = !blocked && (page.kind === 'overview' || page.kind === 'data');
  const overview = useConsoleRead(needsOverview ? () => consoleApi.overview(projectId, actor).then((r) => r.data) : null, [needsOverview, projectId, actor, reload], onError);
  const object = page.kind === 'object' ? manifest?.objects.find((o) => o.id === page.id) ?? null : null;
  const filter = object ? filters[object.id] ?? object.filters[0]?.id ?? '' : '';
  const list = useConsoleRead(!blocked && object ? () => consoleApi.objects(projectId, object.id, actor, filter).then((r) => r.data) : null, [blocked, projectId, object?.id, actor, filter, reload], onError);
  const selectedKey = object ? selected[object.id] ?? null : null;
  const detail = useConsoleRead(!blocked && object && selectedKey ? () => consoleApi.object(projectId, object.id, selectedKey, actor).then((r) => r.data) : null, [blocked, projectId, object?.id, selectedKey, actor, reload], onError);
  const report = useConsoleRead(!blocked && page.kind === 'report' ? () => consoleApi.report(projectId, page.id, actor).then((r) => r.data) : null, [blocked, projectId, pageKey(page), actor, reload], onError);
  const [invocations, setInvocations] = useState<readonly ActionInvocationRecord[]>([]);
  const [busyInvocation, setBusyInvocation] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, Bilingual>>({});
  useEffect(() => {
    let live = true;
    consoleApi.invocations(projectId).then((list) => live && setInvocations(list), () => undefined);
    return () => {
      live = false;
    };
  }, [projectId, reload]);
  const upsertInvocation = (inv: ActionInvocationRecord) =>
    setInvocations((list) => [inv, ...list.filter((x) => x.id !== inv.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  /** Runs one approval step; a settled change re-reads the application so pages show its result. */
  const settle = async (inv: ActionInvocationRecord, step: (projectId: string, id: string) => Promise<ActionInvocationRecord>) => {
    setBusyInvocation(inv.id);
    setNotices(({ [inv.id]: _, ...rest }) => rest);
    try {
      const next = await step(projectId, inv.id);
      upsertInvocation(next);
      if (next.status !== 'PENDING_APPROVAL') setReload((x) => x + 1);
    } catch (err) {
      if (err instanceof ConsoleRequestError) {
        if (err.invocation) upsertInvocation(err.invocation);
        else {
          const notice = err.businessMessage
            ?? (err.code === 'UNREACHABLE'
              ? { zh: '现在连不上应用，什么都没有执行；应用恢复后再批准即可。', en: 'The application cannot be reached; nothing ran. Approve again once it is back.' }
              : { zh: `没有执行：${err.message}`, en: `Nothing ran: ${err.message}` });
          setNotices((n) => ({ ...n, [inv.id]: notice }));
        }
        onError(err);
      }
    } finally {
      setBusyInvocation(null);
    }
  };
  const prepareAs = async (who: string, actionId: string, target: string | undefined, params: Record<string, unknown>): Promise<Bilingual | null> => {
    try {
      upsertInvocation(await consoleApi.prepare(projectId, actionId, who, target, params));
      return null;
    } catch (err) {
      if (!(err instanceof ConsoleRequestError)) throw err;
      onError(err);
      return err.businessMessage ?? { zh: `没能准备：${err.message}`, en: `Could not prepare it: ${err.message}` };
    }
  };
  const approvals: ConsoleApprovals = {
    invocations,
    busyId: busyInvocation,
    notices,
    prepare: (actionId, target, params) => prepareAs(actor, actionId, target, params),
    approve: (inv) => void settle(inv, consoleApi.approve),
    decline: (inv) => void settle(inv, consoleApi.decline),
    reconcile: (inv) => void settle(inv, consoleApi.reconcile),
    prepareAgain: (inv) => void prepareAs(inv.actor, inv.actionId, inv.target ?? undefined, { ...inv.params }),
  };
  const openCount = cardsToShow(invocations).cards.filter((i) => i.status === 'PENDING_APPROVAL' || i.status === 'UNKNOWN').length;

  if (!manifest) {
    return <p className="oc-callout warn">{t('保存的接入清单读不懂了，请断开后重新接入。', 'The saved Connection Manifest can no longer be read; disconnect and connect again.')}</p>;
  }
  const actorDef = manifest.actors.find((a) => a.id === actor) ?? manifest.actors[0]!;

  const recheck = async () => {
    setBusy(true);
    try {
      setConnectedApp(projectId, await consoleApi.check(projectId));
      setReload((x) => x + 1);
    } catch (err) {
      if (err instanceof ConsoleRequestError) onError(err);
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      await consoleApi.disconnect(projectId);
      setConnectedApp(projectId, null);
    } finally {
      setBusy(false);
      setConfirmDisconnect(false);
    }
  };

  const currentError =
    page.kind === 'overview' || page.kind === 'data' ? overview.error : page.kind === 'object' ? list.error : page.kind === 'report' ? report.error : null;
  const navItems: { page: ConsolePage; icon: React.ReactNode; label: string; badge?: React.ReactNode }[] = [
    {
      page: { kind: 'overview' },
      icon: <Gauge size={15} />,
      label: t('今日概览', 'Today'),
      ...(openCount ? { badge: <Pill tone="bg-primary-soft text-primary" testId="console-open-approvals">{t(`${openCount} 待批准`, `${openCount} to approve`)}</Pill> } : {}),
    },
    ...manifest.objects.map((o) => ({ page: { kind: 'object', id: o.id } as ConsolePage, icon: <Table2 size={15} />, label: tb(t, o.name) })),
    ...manifest.reports.map((r) => ({ page: { kind: 'report', id: r.id } as ConsolePage, icon: <BarChart3 size={15} />, label: tb(t, r.name) })),
    ...(manifest.dataIssues ? [{ page: { kind: 'data' } as ConsolePage, icon: <ShieldCheck size={15} />, label: t('数据体检', 'Data check') }] : []),
    { page: { kind: 'rules' }, icon: <BookOpen size={15} />, label: t('业务规则', 'Business rules') },
    {
      page: { kind: 'connection' },
      icon: <Plug size={15} />,
      label: t('应用与连接', 'Application and connection'),
      ...(drifted ? { badge: <Pill tone="bg-warning-soft text-warning">{t('待核对', 'Re-check')}</Pill> } : {}),
    },
  ];

  let body: React.ReactNode;
  const loading = <p className="oc-callout"><Loader2 size={13} className="pipeline-spin mr-1.5 inline" aria-hidden="true" />{t('正在从应用读取…', 'Reading from the application…')}</p>;
  if (page.kind === 'connection') {
    body = <ConsoleConnectionPage record={record} manifest={manifest} busy={busy} onCheck={() => void recheck()} onDisconnect={() => setConfirmDisconnect(true)} />;
  } else if (page.kind === 'rules') {
    body = <ConsoleRulesPage suite={suite} />;
  } else if (blocked || currentError) {
    body = null;
  } else if (page.kind === 'overview') {
    body = overview.data ? (
      <ConsoleOverviewPage
        manifest={manifest}
        actorId={actor}
        overview={overview.data}
        onOpenDataIssues={() => setPage({ kind: 'data' })}
        onOpenReport={(id) => setPage({ kind: 'report', id })}
        approvals={blocked ? undefined : approvals}
      />
    ) : loading;
  } else if (page.kind === 'data') {
    body = overview.data?.dataIssues ? <ConsoleDataIssuesPage issues={overview.data.dataIssues} /> : loading;
  } else if (page.kind === 'report') {
    body = report.data ? <ConsoleReportPage manifest={manifest} reportId={page.id} report={report.data} /> : loading;
  } else if (object) {
    body = (
      <ConsoleObjectPage
        manifest={manifest}
        object={object}
        filter={filter}
        list={list.data}
        selectedKey={selectedKey}
        detail={detail.data}
        detailState={!selectedKey ? 'idle' : detail.status === 'loading' ? 'loading' : detail.status === 'error' ? 'missing' : 'ready'}
        onFilter={(f) => setFilters((x) => ({ ...x, [object.id]: f }))}
        onSelect={(k) => setSelected((x) => ({ ...x, [object.id]: k }))}
        approvals={approvals}
      />
    );
  }

  return (
    <div className="oc-shell" data-testid="operations-console">
      <header className="oc-header">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="oc-app-mark" aria-hidden="true">{tb(t, manifest.application.name).slice(0, 1)}</span>
          <div className="min-w-0">
            <div className="oc-app-name">{tb(t, manifest.application.name)}</div>
            <div className="oc-app-sub">{tb(t, manifest.application.description) || manifest.application.version}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-foreground-soft" data-testid="console-connection-status">
            <span className={cn('oc-dot', drifted && 'warn')} aria-hidden="true" />
            {drifted ? t('等你重新核对', 'Waiting for a re-check') : t('已接入并核对', 'Connected and checked')}
          </span>
          <label className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
            {t('身份', 'Acting as')}
            <select
              className="oc-select"
              value={actor}
              data-testid="console-actor-select"
              onChange={(e) => {
                setActor(e.target.value);
                storeActor(projectId, e.target.value);
                setSelected({});
              }}
            >
              {manifest.actors.map((a) => (
                <option key={a.id} value={a.id}>{`${tb(t, a.name)}（${tb(t, a.role)}）`}</option>
              ))}
            </select>
          </label>
          <span className="hidden text-[12px] text-faint-foreground xl:inline">{tb(t, actorDef.scope)}</span>
        </div>
      </header>
      <div className="oc-body">
        <nav className="oc-nav" aria-label={t('经营驾驶舱', 'Operations Console')}>
          {navItems.map((item) => (
            <button
              key={pageKey(item.page)}
              type="button"
              className="oc-nav-item"
              aria-current={pageKey(item.page) === pageKey(page) ? 'page' : undefined}
              onClick={() => setPage(item.page)}
              data-testid={`console-nav-${pageKey(item.page).replace(':', '-')}`}
            >
              <span className="oc-nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="min-w-0 truncate">{item.label}</span>
              {item.badge ? <span className="ml-auto">{item.badge}</span> : null}
            </button>
          ))}
        </nav>
        <main className="oc-main">
          {page.kind !== 'connection' && page.kind !== 'rules' ? (
            <ConsoleStateNotice error={currentError} record={record} busy={busy} onCheck={() => void recheck()} onRetry={() => setReload((x) => x + 1)} />
          ) : null}
          {body}
        </main>
      </div>
      <ConfirmDialog
        open={confirmDisconnect}
        title={t('断开这个应用？', 'Disconnect this application?')}
        description={t('断开后经营驾驶舱不再显示它的数据；应用本身不受影响，随时可以重新接入。', 'The console stops showing its data; the application itself is untouched and can be connected again at any time.')}
        confirmLabel={t('断开连接', 'Disconnect')}
        cancelLabel={t('取消', 'Cancel')}
        danger
        busy={busy}
        onConfirm={() => void disconnect()}
        onClose={() => setConfirmDisconnect(false)}
        testId="console-disconnect-dialog"
      />
    </div>
  );
}

export function OperationsConsoleView({ onNavigate }: { onNavigate: (view: NavViewId) => void }) {
  const { t } = usePreferences();
  const data = useWorkbenchStore((s) => s.data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ConsoleRequestError | null>(null);
  if (!data) return null;
  const project = data.activeProject;
  if (!project.id) {
    return (
      <div className="oc-connect">
        <div className="oc-connect-card">
          <p className="oc-note">{t('先在首页选一个项目。', 'Pick a project on Home first.')}</p>
          <Button onClick={() => onNavigate('overview')}>{t('回到首页', 'Back to Home')}</Button>
        </div>
      </div>
    );
  }
  const record = data.connectedApps?.find((a) => a.projectId === project.id) ?? null;
  const confirmation = data.stepConfirmations?.businessModel ?? null;
  const suite = confirmation ? confirmation.suiteSnapshot ?? confirmation.suite : null;
  if (!record) {
    return (
      <ConnectAppPanel
        projectName={project.name}
        busy={busy}
        error={error}
        onConnect={async (address) => {
          setBusy(true);
          setError(null);
          try {
            setConnectedApp(project.id, await consoleApi.connect(project.id, address));
          } catch (err) {
            setError(err instanceof ConsoleRequestError ? err : new ConsoleRequestError('UNKNOWN', String(err), 0));
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }
  return <ConsoleWorkspace key={project.id} record={record} projectId={project.id} suite={suite} />;
}
