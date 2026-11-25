import { randomUUID } from 'node:crypto';
import {
  ConnectionError,
  createConnectionClient,
  fingerprintManifest,
  type Bilingual,
  type ConnectionClient,
  type ConnectionManifest,
  type FetchLike,
} from '../../application-runtime/index.js';
import type {
  ActionInvocationRecord,
  ConnectedAppRecord,
  WorkspaceStore,
} from '../../workspace-store/index.js';

/**
 * The runtime gateway between Ontology Plus and a connected application (TeaCo spec §8–§10,
 * ADR 0020 as amended). It is used by the Operations Console routes and by the AI Assistant's
 * runtime tools alike, so both follow the same rules:
 * - every call re-reads the Connection Manifest; a changed application or a re-confirmed
 *   Business Model is Drifted and nothing is read or written until it is checked again;
 * - the Acting Identity is the one the person chose, never one the AI names;
 * - writes are prepared, approved by a person (bound to arguments, target version, identity and
 *   manifest, for ten minutes), invoked with one request key and read back; an unconfirmed result
 *   is UNKNOWN and is reconciled with that same key, never re-sent under a new one.
 */
export interface GatewayDeps {
  readonly store: WorkspaceStore;
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
}

export const APPROVAL_TTL_MS = 10 * 60 * 1000;

export type GatewayFailure = {
  readonly ok: false;
  readonly status: 400 | 404 | 409 | 422 | 502;
  readonly code: string;
  readonly message: string | Bilingual;
  readonly connectedApp?: ConnectedAppRecord;
  readonly invocation?: ActionInvocationRecord;
};
export type GatewayResult<T> = { readonly ok: true; readonly value: T } | GatewayFailure;

export interface OpenConnection {
  readonly client: ConnectionClient;
  readonly manifest: ConnectionManifest;
  readonly actor: string;
  readonly record: ConnectedAppRecord;
  readonly fingerprint: string;
}

const nowIso = (deps: GatewayDeps) => (deps.now?.() ?? new Date()).toISOString();
export const clientFor = (deps: GatewayDeps, baseUrl: string): ConnectionClient =>
  createConnectionClient({ baseUrl, ...(deps.fetch ? { fetch: deps.fetch } : {}) });

export function confirmedModel(store: WorkspaceStore, projectId: string) {
  const confirmation = store.getProjectStepConfirmations(projectId).businessModel;
  if (!confirmation) return null;
  const suite = confirmation.suiteSnapshot ?? confirmation.suite;
  return { hash: confirmation.suiteHash, objects: (suite.M1?.aggregates ?? []).map((a) => ({ id: a.id, name: a.name, alias: a.alias })) };
}

/** Opens a connection for one read or write: drift check, then the Acting Identity. */
export async function openConnection(deps: GatewayDeps, projectId: string, requestedActor: string | undefined): Promise<GatewayResult<OpenConnection>> {
  const record = deps.store.getConnectedApp(projectId);
  if (!record) return { ok: false, status: 404, code: 'NOT_CONNECTED', message: 'This project has no connected application' };
  if (record.status === 'DRIFTED') return { ok: false, status: 409, code: 'DRIFTED', message: record.driftReason ?? 'DRIFTED', connectedApp: record };
  const client = clientFor(deps, record.baseUrl);
  let manifest: ConnectionManifest;
  try {
    manifest = await client.readManifest();
  } catch (err) {
    if (err instanceof ConnectionError) return { ok: false, status: 502, code: err.code, message: err.message, connectedApp: record };
    throw err;
  }
  const fingerprint = await fingerprintManifest(manifest);
  const model = confirmedModel(deps.store, projectId);
  const reason = fingerprint !== record.manifestFingerprint ? 'MANIFEST_CHANGED' : (model?.hash ?? null) !== record.modelHash ? 'MODEL_CHANGED' : null;
  if (reason) {
    const drifted = deps.store.saveConnectedApp({ ...record, status: 'DRIFTED', driftReason: reason, checkedAt: nowIso(deps) });
    return { ok: false, status: 409, code: 'DRIFTED', message: reason, connectedApp: drifted };
  }
  const actor = requestedActor ? manifest.actors.find((a) => a.id === requestedActor) : manifest.actors[0];
  if (!actor) return { ok: false, status: 400, code: 'UNKNOWN_ACTOR', message: `"${requestedActor}" is not an identity this application declares` };
  return { ok: true, value: { client, manifest, actor: actor.id, record, fingerprint } };
}

async function argsHash(actionId: string, target: string | null, params: Readonly<Record<string, unknown>>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ actionId, target, params })));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function appFailure(err: ConnectionError, invocation?: ActionInvocationRecord): GatewayFailure {
  const status = err.code === 'UNREACHABLE' || err.code === 'BAD_RESPONSE' ? 502 : err.code === 'CONFLICT' ? 409 : err.code === 'NOT_FOUND' ? 404 : 422;
  return {
    ok: false, status, code: err.appError?.code ?? err.code, message: err.appError?.message ?? err.message,
    ...(invocation ? { invocation } : {}),
  };
}

function withLog(record: ActionInvocationRecord, at: string, text: Bilingual, patch: Partial<ActionInvocationRecord>): ActionInvocationRecord {
  return { ...record, ...patch, log: [...record.log, { at, text }], updatedAt: at };
}

export interface PrepareInput {
  readonly actionId: string;
  readonly actor?: string | undefined;
  readonly target?: string | undefined;
  readonly params?: Readonly<Record<string, unknown>> | undefined;
  readonly requestedBy: 'user' | 'assistant';
}

/** Asks the application what an action would do and records it as waiting for approval. */
export async function prepareInvocation(deps: GatewayDeps, projectId: string, input: PrepareInput): Promise<GatewayResult<ActionInvocationRecord>> {
  const opened = await openConnection(deps, projectId, input.actor);
  if (!opened.ok) return opened;
  const { client, manifest, actor, fingerprint } = opened.value;
  const action = manifest.actions.find((a) => a.id === input.actionId);
  if (!action) return { ok: false, status: 404, code: 'UNKNOWN_ACTION', message: { zh: '这个应用没有这个操作。', en: 'The application does not offer that action.' } };
  const params = input.params ?? {};
  let preview;
  try {
    preview = await client.prepareAction(action.id, actor, { target: input.target, params });
  } catch (err) {
    if (err instanceof ConnectionError) return appFailure(err);
    throw err;
  }
  const at = nowIso(deps);
  const target = input.target ?? null;
  const actorDef = manifest.actors.find((a) => a.id === actor)!;
  const record: ActionInvocationRecord = {
    id: `inv-${randomUUID()}`,
    projectId,
    actionId: action.id,
    actionName: action.name,
    actor,
    target,
    params,
    argsHash: await argsHash(action.id, target, params),
    targetVersion: preview.preview.target.version,
    manifestFingerprint: fingerprint,
    idempotencyKey: `op-${randomUUID()}`,
    requestedBy: input.requestedBy,
    status: 'PENDING_APPROVAL',
    preview: { summary: preview.preview.summary, effects: preview.preview.effects },
    expiresAt: new Date(Date.parse(at) + APPROVAL_TTL_MS).toISOString(),
    approvedAt: null,
    receipt: null,
    failure: null,
    log: [{
      at,
      text: input.requestedBy === 'assistant'
        ? { zh: `AI 以 ${actorDef.name.zh} 的身份提出，等你批准`, en: `The AI proposed it as ${actorDef.name.en}; waiting for your approval` }
        : { zh: `以 ${actorDef.name.zh} 的身份准备好了，等你批准`, en: `Prepared as ${actorDef.name.en}; waiting for your approval` },
    }],
    createdAt: at,
    updatedAt: at,
  };
  return { ok: true, value: deps.store.saveActionInvocation(record) };
}

/** Lists a project's invocations, newest first; approvals past their time are marked expired. */
export function listInvocations(deps: GatewayDeps, projectId: string): ActionInvocationRecord[] {
  const at = nowIso(deps);
  return deps.store.listActionInvocations(projectId).map((inv) =>
    inv.status === 'PENDING_APPROVAL' && inv.expiresAt < at
      ? deps.store.saveActionInvocation(withLog(inv, at, { zh: '超过 10 分钟没有批准，已作废', en: 'Not approved within 10 minutes; void' }, { status: 'EXPIRED' }))
      : inv,
  );
}

function loadPending(deps: GatewayDeps, projectId: string, id: string): GatewayResult<ActionInvocationRecord> {
  const inv = deps.store.getActionInvocation(id);
  if (!inv || inv.projectId !== projectId) return { ok: false, status: 404, code: 'NO_SUCH_INVOCATION', message: 'No such invocation' };
  return { ok: true, value: inv };
}

/** Approves and executes in one step, then reads the result back from the application. */
export async function approveInvocation(deps: GatewayDeps, projectId: string, id: string): Promise<GatewayResult<ActionInvocationRecord>> {
  const loaded = loadPending(deps, projectId, id);
  if (!loaded.ok) return loaded;
  let inv = loaded.value;
  if (inv.status !== 'PENDING_APPROVAL') return { ok: false, status: 409, code: 'NOT_PENDING', message: `It is ${inv.status}, not waiting for approval`, invocation: inv };
  const at = nowIso(deps);
  if (inv.expiresAt < at) {
    inv = deps.store.saveActionInvocation(withLog(inv, at, { zh: '超过 10 分钟没有批准，已作废，需要重新准备', en: 'Not approved within 10 minutes; void, prepare it again' }, { status: 'EXPIRED' }));
    return { ok: false, status: 409, code: 'EXPIRED', message: { zh: '批准已过期，请重新准备。', en: 'The approval window passed; prepare it again.' }, invocation: inv };
  }
  const opened = await openConnection(deps, projectId, inv.actor);
  if (!opened.ok) {
    if (opened.code === 'DRIFTED' || opened.code === 'UNKNOWN_ACTOR') {
      inv = deps.store.saveActionInvocation(withLog(inv, at, { zh: '应用在准备之后有变化，这次批准作废，需要重新核对后再准备', en: 'The application changed after this was prepared; the approval is void until it is checked and prepared again' }, {
        status: 'FAILED', failure: { code: 'APP_CHANGED', message: { zh: '应用在准备之后有变化，这次批准作废。', en: 'The application changed after this was prepared; the approval is void.' } },
      }));
      return { ...opened, invocation: inv };
    }
    return opened;
  }
  if (opened.value.fingerprint !== inv.manifestFingerprint) {
    inv = deps.store.saveActionInvocation(withLog(inv, at, { zh: '应用声明的内容变了，这次批准作废', en: 'The application’s declaration changed; the approval is void' }, {
      status: 'FAILED', failure: { code: 'APP_CHANGED', message: { zh: '应用声明的内容变了，这次批准作废。', en: 'The application’s declaration changed; the approval is void.' } },
    }));
    return { ok: false, status: 409, code: 'APP_CHANGED', message: inv.failure!.message, invocation: inv };
  }
  inv = deps.store.saveActionInvocation(withLog(inv, at, { zh: '你批准了，正在执行', en: 'You approved it; executing' }, { status: 'EXECUTING', approvedAt: at }));
  const { client } = opened.value;
  try {
    await client.invokeAction(inv.actionId, inv.actor, { target: inv.target ?? undefined, params: inv.params, idempotencyKey: inv.idempotencyKey, expectedVersion: inv.targetVersion });
  } catch (err) {
    if (!(err instanceof ConnectionError)) throw err;
    const done = nowIso(deps);
    if (err.code === 'UNREACHABLE' || err.code === 'BAD_RESPONSE') {
      inv = deps.store.saveActionInvocation(withLog(inv, done, {
        zh: '没收到应用的回应，结果未知；只会用原请求编号去对账，不会重发',
        en: 'No answer from the application; the outcome is unknown. It will only be reconciled with the same request key, never re-sent',
      }, { status: 'UNKNOWN' }));
      return { ok: true, value: inv };
    }
    const message = err.appError?.message ?? { zh: err.message, en: err.message };
    inv = deps.store.saveActionInvocation(withLog(inv, done, { zh: `应用拒绝了：${message.zh}`, en: `The application refused: ${message.en}` }, {
      status: 'FAILED', failure: { code: err.appError?.code ?? err.code, message },
    }));
    return { ok: true, value: inv };
  }
  return readBack(deps, inv, client);
}

/** Confirms a committed action from the application's own record before calling it done. */
async function readBack(deps: GatewayDeps, inv: ActionInvocationRecord, client: ConnectionClient): Promise<GatewayResult<ActionInvocationRecord>> {
  const at = nowIso(deps);
  let receipt;
  try {
    receipt = await client.invocation(inv.idempotencyKey, inv.actor);
  } catch (err) {
    if (!(err instanceof ConnectionError)) throw err;
    return {
      ok: true,
      value: deps.store.saveActionInvocation(withLog(inv, at, { zh: '执行了，但回头核对时连不上应用；稍后按原请求编号对账', en: 'Executed, but the read-back could not reach the application; reconcile later with the same key' }, { status: 'UNKNOWN' })),
    };
  }
  if (!receipt) {
    return {
      ok: true,
      value: deps.store.saveActionInvocation(withLog(inv, at, { zh: '应用没有这次请求的记录：确认没有生效', en: 'The application has no record of this request: it did not take effect' }, {
        status: 'FAILED', failure: { code: 'NOT_COMMITTED', message: { zh: '应用没有这次请求的记录，没有生效。', en: 'The application has no record of it; nothing changed.' } },
      })),
    };
  }
  return {
    ok: true,
    value: deps.store.saveActionInvocation(withLog(inv, at, { zh: `已执行，回头核对一致：${receipt.summary.zh}`, en: `Done and read back: ${receipt.summary.en}` }, {
      status: 'VERIFIED', receipt: receipt as unknown as Record<string, unknown>,
    })),
  };
}

export function declineInvocation(deps: GatewayDeps, projectId: string, id: string): GatewayResult<ActionInvocationRecord> {
  const loaded = loadPending(deps, projectId, id);
  if (!loaded.ok) return loaded;
  if (loaded.value.status !== 'PENDING_APPROVAL') return { ok: false, status: 409, code: 'NOT_PENDING', message: 'Not waiting for approval', invocation: loaded.value };
  const at = nowIso(deps);
  return { ok: true, value: deps.store.saveActionInvocation(withLog(loaded.value, at, { zh: '你决定不执行', en: 'You chose not to run it' }, { status: 'REJECTED' })) };
}

/** Settles an UNKNOWN outcome by asking the application for the receipt of the same request key. */
export async function reconcileInvocation(deps: GatewayDeps, projectId: string, id: string): Promise<GatewayResult<ActionInvocationRecord>> {
  const loaded = loadPending(deps, projectId, id);
  if (!loaded.ok) return loaded;
  if (loaded.value.status !== 'UNKNOWN') return { ok: false, status: 409, code: 'NOT_UNKNOWN', message: 'Its outcome is already known', invocation: loaded.value };
  const record = deps.store.getConnectedApp(projectId);
  if (!record) return { ok: false, status: 404, code: 'NOT_CONNECTED', message: 'This project has no connected application' };
  return readBack(deps, loaded.value, clientFor(deps, record.baseUrl));
}
