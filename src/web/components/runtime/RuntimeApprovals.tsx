import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, CircleSlash, Clock, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { Bilingual, ConnectionAction, ConnectionManifest } from '../../../packages/application-runtime/index.js';
import type { ActionInvocationRecord } from '../../../packages/workspace-store/index.js';
import { Button } from '../beautifui/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { consoleApi } from './consoleApi.js';
import './runtime-approvals.css';

/**
 * Approval cards for approved runtime changes (spec §10.1, ADR 0020; reference: 等你决定 in
 * docs/ui-reference/teaco-operations-console.html). A card says what happened, what will change,
 * why approving is safe, and offers one primary action. The same invocation id appears here and,
 * from M3, in the AI Assistant, so approving in either place settles both.
 */
type Translate = (zh: string, en: string) => string;
const tb = (t: Translate, b: Bilingual | null | undefined) => (b ? t(b.zh, b.en) : '');
/** Local wall-clock time, as the person reads it. */
export const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export interface ApprovalCardProps {
  readonly invocation: ActionInvocationRecord;
  readonly manifest: ConnectionManifest;
  readonly busy?: boolean;
  /** Why the last step on this card did not go through (for example, the application could not be reached). */
  readonly notice?: Bilingual | null;
  readonly onApprove?: (inv: ActionInvocationRecord) => void;
  readonly onDecline?: (inv: ActionInvocationRecord) => void;
  readonly onReconcile?: (inv: ActionInvocationRecord) => void;
  readonly onPrepareAgain?: (inv: ActionInvocationRecord) => void;
}

export function ApprovalCard({ invocation: inv, manifest, busy, notice, onApprove, onDecline, onReconcile, onPrepareAgain }: ApprovalCardProps) {
  const { t } = usePreferences();
  const actor = manifest.actors.find((a) => a.id === inv.actor);
  const pending = inv.status === 'PENDING_APPROVAL';
  const kicker = pending
    ? inv.requestedBy === 'assistant' ? t('AI 代办 · 需要你批准', 'AI request · needs your approval') : t('需要你批准', 'Needs your approval')
    : inv.status === 'VERIFIED' ? t('已完成', 'Done') : inv.status === 'UNKNOWN' ? t('结果未知', 'Outcome unknown') : inv.status === 'EXECUTING' ? t('执行中', 'Running') : t('没有执行', 'Not run');
  const last = inv.log[inv.log.length - 1];
  return (
    <article className={cn('rt-approval', pending ? 'is-pending' : inv.status === 'UNKNOWN' || inv.status === 'FAILED' ? 'is-warn' : 'is-done')} data-testid={`console-invocation-${inv.id}`} data-status={inv.status}>
      <div className="rt-approval-head">
        <span className="rt-approval-kicker">
          {pending ? <Sparkles size={13} aria-hidden="true" /> : inv.status === 'VERIFIED' ? <CheckCircle2 size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
          {kicker}
          {actor ? <span className="rt-approval-actor">{t(`以 ${actor.name.zh} 的身份`, `as ${actor.name.en}`)}</span> : null}
        </span>
        {pending ? (
          <span className="rt-approval-expiry"><Clock size={12} aria-hidden="true" />{t(`${hhmm(inv.expiresAt)} 前有效`, `valid until ${hhmm(inv.expiresAt)}`)}</span>
        ) : null}
      </div>
      <div className="rt-approval-body">
        <div className="rt-approval-title">{tb(t, inv.preview.summary)}</div>
        {pending || inv.status === 'EXECUTING' ? (
          <>
            <ul className="rt-approval-effects">
              {inv.preview.effects.map((e, i) => (
                <li key={i}><ArrowRight size={12} aria-hidden="true" /><span>{tb(t, e)}</span></li>
              ))}
            </ul>
            <details className="rt-details">
              <summary>{t('为什么可以放心批准', 'Why approving is safe')}</summary>
              <ul className="rt-approval-why">
                <li>{t(`用的是 ${actor?.name.zh ?? inv.actor} 的权限，应用会再检查一遍这个身份能不能做。`, `It uses ${actor?.name.en ?? inv.actor}’s permissions, and the application checks them again.`)}</li>
                <li>{inv.targetVersion !== null
                  ? t(`批准只对这一条的第 ${inv.targetVersion} 版、这些参数有效；执行前它被改动，批准自动作废。`, `The approval holds only for version ${inv.targetVersion} of this record with these values; if it changes first, the approval is void.`)
                  : t('批准只对这些参数有效。', 'The approval holds only for these values.')}</li>
                <li>{t('执行后会回头向应用核对结果；没收到回应时只按原请求编号对账，不会重复执行。', 'After running it is read back from the application; without an answer it is reconciled by the same request key and never run twice.')}</li>
              </ul>
            </details>
          </>
        ) : last && !inv.failure ? (
          <p className="rt-approval-outcome">{tb(t, last.text)}</p>
        ) : null}
        {inv.failure && !pending ? <p className="rt-approval-outcome warn">{tb(t, inv.failure.message)}</p> : null}
        {notice ? <p className="rt-approval-outcome warn" role="alert" data-testid="console-invocation-notice">{tb(t, notice)}</p> : null}
      </div>
      {pending ? (
        <div className="rt-approval-foot">
          <Button size="xs" onClick={() => onDecline?.(inv)} disabled={busy} data-testid="console-invocation-decline">{t('不执行', 'Don’t run')}</Button>
          <Button size="xs" variant="accent" onClick={() => onApprove?.(inv)} disabled={busy} data-testid="console-invocation-approve">
            {busy ? <Loader2 size={11} className="pipeline-spin" aria-hidden="true" /> : <Check size={11} aria-hidden="true" />}
            {t('批准并执行', 'Approve and run')}
          </Button>
        </div>
      ) : inv.status === 'UNKNOWN' ? (
        <div className="rt-approval-foot">
          <Button size="xs" variant="accent" onClick={() => onReconcile?.(inv)} disabled={busy} data-testid="console-invocation-reconcile">
            <RefreshCw size={11} aria-hidden="true" />
            {t('按原请求编号对账', 'Reconcile with the same request')}
          </Button>
        </div>
      ) : inv.status === 'EXPIRED' || (inv.status === 'FAILED' && (inv.failure?.code === 'VERSION_CONFLICT' || inv.failure?.code === 'APP_CHANGED')) ? (
        <div className="rt-approval-foot">
          <Button size="xs" onClick={() => onPrepareAgain?.(inv)} disabled={busy} data-testid="console-invocation-again">
            <RefreshCw size={11} aria-hidden="true" />
            {t('按现在的情况重新准备', 'Prepare again from the current state')}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

/** One line for a settled invocation in the history under the cards. */
export function SettledInvocationLine({ invocation: inv }: { invocation: ActionInvocationRecord }) {
  const { t } = usePreferences();
  const icon = inv.status === 'VERIFIED' ? <CheckCircle2 size={13} className="text-success" aria-hidden="true" /> : <CircleSlash size={13} className="text-faint-foreground" aria-hidden="true" />;
  const label = inv.status === 'VERIFIED' ? t('已完成', 'Done') : inv.status === 'REJECTED' ? t('没执行', 'Not run') : inv.status === 'EXPIRED' ? t('已作废', 'Void') : t('没成功', 'Failed');
  return (
    <li className="rt-settled" data-testid={`console-settled-${inv.id}`}>
      {icon}
      <span className="rt-settled-label">{label}</span>
      <span className="min-w-0 truncate">{tb(t, inv.preview.summary)}</span>
      <span className="rt-settled-at">{hhmm(inv.updatedAt)}</span>
    </li>
  );
}

/** Asks for an action's simple parameters (numbers and text) before preparing it. */
export function ActionForm({ action, busy, error, initial, onSubmit, onCancel }: {
  action: ConnectionAction;
  busy?: boolean;
  error?: Bilingual | null;
  initial?: Record<string, unknown>;
  onSubmit: (params: Record<string, unknown>) => void;
  onCancel?: () => void;
}) {
  const { t } = usePreferences();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(action.params.map((p) => [p.key, initial?.[p.key] === undefined ? '' : String(initial[p.key])])),
  );
  const ready = action.params.every((p) => !p.required || values[p.key]?.trim());
  return (
    <form
      className="rt-action-form"
      data-testid={`console-action-form-${action.id}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onSubmit(Object.fromEntries(action.params.map((p) => [p.key, p.type === 'number' ? Number(values[p.key]) : values[p.key]])));
      }}
    >
      <div className="rt-eyebrow">{tb(t, action.name)}</div>
      {action.description ? <p className="rt-note">{tb(t, action.description)}</p> : null}
      {action.params.map((p) => (
        <label key={p.key} className="rt-action-field">
          <span>{tb(t, p.label)}</span>
          <input
            className="rt-input"
            inputMode={p.type === 'number' ? 'numeric' : undefined}
            value={values[p.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
            data-testid={`console-action-param-${p.key}`}
          />
        </label>
      ))}
      {error ? <p className="rt-approval-outcome warn" role="alert">{tb(t, error)}</p> : null}
      <div className="flex justify-end gap-2">
        {onCancel ? <Button size="xs" onClick={onCancel} disabled={busy}>{t('取消', 'Cancel')}</Button> : null}
        <Button size="xs" variant="accent" type="submit" disabled={busy || !ready} data-testid="console-action-prepare">
          {busy ? <Loader2 size={11} className="pipeline-spin" aria-hidden="true" /> : null}
          {t('看看会改变什么', 'See what it would change')}
        </Button>
      </div>
    </form>
  );
}

/** Actions a person can start from the console: those that need no picker beyond numbers and text. */
export const formFriendly = (action: ConnectionAction) => action.params.every((p) => p.type === 'number' || p.type === 'text');

// ─── Keeping every place that shows a change in step ─────────────────────────

const INVOCATIONS_CHANGED = 'onto:runtime-invocations-changed';

/** Tells every open approval list (console pages, assistant replies) that a change moved on. */
export function announceInvocationsChanged(projectId: string, source?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(INVOCATIONS_CHANGED, { detail: { projectId, source } }));
}

/** Calls `onChange` when another place (not `source`) moves a change of this project on. */
export function useInvocationsChanged(projectId: string, onChange: () => void, source?: string): void {
  const latest = React.useRef(onChange);
  latest.current = onChange;
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId: string; source?: string }>).detail;
      if (detail?.projectId === projectId && (!source || detail.source !== source)) latest.current();
    };
    window.addEventListener(INVOCATIONS_CHANGED, listener);
    return () => window.removeEventListener(INVOCATIONS_CHANGED, listener);
  }, [projectId, source]);
}

/**
 * The approval cards an AI Assistant reply prepared (artifact `RUNTIME_APPROVAL`), shown live in
 * the conversation. Approving here or in the console settles the same change.
 */
export function RuntimeApprovalCards({ projectId, invocationIds, manifest }: {
  projectId: string;
  invocationIds: readonly string[];
  manifest: ConnectionManifest | null;
}) {
  const { t } = usePreferences();
  const [invocations, setInvocations] = useState<ActionInvocationRecord[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, Bilingual>>({});
  // A change prepared again from one of these cards replaces it here, so it stays in view.
  const [preparedAgain, setPreparedAgain] = useState<string[]>([]);
  const ids = [...invocationIds, ...preparedAgain];
  const load = React.useCallback(() => {
    consoleApi.invocations(projectId).then(
      (list) => setInvocations(list.filter((i) => ids.includes(i.id)).reverse()),
      () => setInvocations([]),
    );
  }, [projectId, ids.join('|')]);
  React.useEffect(load, [load]);
  useInvocationsChanged(projectId, load, 'assistant');
  // A card the assistant has just prepared also belongs in the console's 等你确认 list.
  const announced = React.useRef(false);
  React.useEffect(() => {
    if (announced.current || !invocations) return;
    const fresh = invocations.some((i) => i.status === 'PENDING_APPROVAL' && Date.now() - Date.parse(i.createdAt) < 120_000);
    if (fresh) {
      announced.current = true;
      announceInvocationsChanged(projectId, 'assistant');
    }
  }, [invocations, projectId]);
  if (!manifest || !invocations) return null;
  const step = async (inv: ActionInvocationRecord, run: (projectId: string, id: string) => Promise<ActionInvocationRecord>) => {
    setBusy(inv.id);
    setNotices(({ [inv.id]: _, ...rest }) => rest);
    try {
      await run(projectId, inv.id);
    } catch (err) {
      const e = err as { businessMessage?: Bilingual | null; code?: string; message?: string };
      setNotices((n) => ({
        ...n,
        [inv.id]: e.businessMessage
          ?? (e.code === 'UNREACHABLE'
            ? { zh: '现在连不上应用，什么都没有执行；应用恢复后再批准即可。', en: 'The application cannot be reached; nothing ran. Approve again once it is back.' }
            : { zh: `没有执行：${e.message ?? ''}`, en: `Nothing ran: ${e.message ?? ''}` }),
      }));
    } finally {
      setBusy(null);
      load();
      announceInvocationsChanged(projectId, 'assistant');
    }
  };
  return (
    <div className="rt-reply-cards" data-testid="agent-runtime-approvals" aria-label={t('等你批准的改动', 'Changes waiting for your approval')}>
      {invocations.map((inv) => (
        <ApprovalCard
          key={inv.id}
          invocation={inv}
          manifest={manifest}
          busy={busy === inv.id}
          notice={notices[inv.id] ?? null}
          onApprove={(i) => void step(i, consoleApi.approve)}
          onDecline={(i) => void step(i, consoleApi.decline)}
          onReconcile={(i) => void step(i, consoleApi.reconcile)}
          onPrepareAgain={(i) =>
            void consoleApi.prepare(projectId, i.actionId, i.actor, i.target ?? undefined, { ...i.params }).then(
              (next) => {
                setPreparedAgain((p) => [...p, next.id]);
                announceInvocationsChanged(projectId, 'assistant');
              },
              (err: { businessMessage?: Bilingual | null; message?: string }) =>
                setNotices((n) => ({ ...n, [i.id]: err.businessMessage ?? { zh: `没能重新准备：${err.message ?? ''}`, en: `Could not prepare it again: ${err.message ?? ''}` } })),
            )}
        />
      ))}
    </div>
  );
}
