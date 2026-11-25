import type {
  ActivityResponse,
  ConnectionManifest,
  DataIssuesResponse,
  MetricsResponse,
  ObjectDetailResponse,
  ObjectListResponse,
  ReportResponse,
} from '../../../packages/application-runtime/index.js';
import type { ActionInvocationRecord, ChangeProposalRecord, ConnectedAppRecord } from '../../../packages/workspace-store/index.js';

/** The application's versions as the console shows them (TeaCo spec §10.6). */
export interface ReleasesOverview {
  readonly current: string;
  readonly previous: string | null;
  readonly versions: readonly {
    readonly version: string;
    readonly name: { readonly zh: string; readonly en: string };
    readonly notes: readonly { readonly zh: string; readonly en: string }[];
    readonly state: 'LIVE' | 'STAGED' | 'EARLIER';
    readonly proposal: ChangeProposalRecord | null;
  }[];
}

/** Why a console read could not be shown; the console explains each in business terms. */
export type ConsoleErrorCode =
  | 'NOT_CONNECTED'
  | 'DRIFTED'
  | 'UNREACHABLE'
  | 'NOT_FOUND'
  | 'REJECTED'
  | 'BAD_RESPONSE'
  | 'INVALID_MANIFEST'
  | 'INVALID_ADDRESS'
  | 'UNKNOWN_ACTOR'
  | 'EXPIRED'
  | 'APP_CHANGED'
  | 'ROLLBACK_BLOCKED'
  | 'NOT_VERIFIED'
  | 'STALE_VERIFICATION'
  | 'FORBIDDEN'
  | 'UNKNOWN';

export class ConsoleRequestError extends Error {
  constructor(
    readonly code: ConsoleErrorCode,
    message: string,
    readonly status: number,
    readonly connectedApp: ConnectedAppRecord | null = null,
    readonly problems: readonly { path: string; message: string }[] = [],
    /** The application's own reason, when it refused in business words. */
    readonly businessMessage: { readonly zh: string; readonly en: string } | null = null,
    readonly invocation: ActionInvocationRecord | null = null,
  ) {
    super(message);
    this.name = 'ConsoleRequestError';
  }
}

export interface ConsoleOverview {
  readonly metrics: MetricsResponse;
  readonly dataIssues: DataIssuesResponse | null;
  readonly activity: ActivityResponse | null;
}

interface ConsoleEnvelope<T> {
  readonly actor: string;
  readonly data: T;
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    throw new ConsoleRequestError('UNKNOWN', err instanceof Error ? err.message : String(err), 0);
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: unknown; problems?: { path: string; message: string }[] } | string;
    connectedApp?: ConnectedAppRecord;
    invocation?: ActionInvocationRecord;
  };
  if (!res.ok) {
    const error = typeof body.error === 'object' && body.error ? body.error : { message: typeof body.error === 'string' ? body.error : res.statusText };
    const message = error.message;
    const business = message && typeof message === 'object' && 'zh' in message && 'en' in message ? (message as { zh: string; en: string }) : null;
    throw new ConsoleRequestError(
      ((error as { code?: string }).code as ConsoleErrorCode | undefined) ?? 'UNKNOWN',
      business ? business.en : String(message ?? res.statusText),
      res.status,
      body.connectedApp ?? null,
      (error as { problems?: { path: string; message: string }[] }).problems ?? [],
      business,
      body.invocation ?? null,
    );
  }
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
});
const query = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};
const enc = encodeURIComponent;

export const consoleApi = {
  connect: (projectId: string, baseUrl: string) =>
    send<{ connectedApp: ConnectedAppRecord }>(`/api/projects/${enc(projectId)}/connected-app`, json('POST', { baseUrl })).then((r) => r.connectedApp),
  check: (projectId: string) =>
    send<{ connectedApp: ConnectedAppRecord }>(`/api/projects/${enc(projectId)}/connected-app/check`, json('POST')).then((r) => r.connectedApp),
  releases: (projectId: string) => send<ReleasesOverview>(`/api/projects/${enc(projectId)}/console/releases`),
  verifyRelease: (projectId: string, version: string) =>
    send<{ proposal: ChangeProposalRecord }>(`/api/projects/${enc(projectId)}/console/releases/${enc(version)}/verify`, json('POST')).then((r) => r.proposal),
  releaseVersion: (projectId: string, version: string) =>
    send<{ proposal: ChangeProposalRecord; connectedApp: ConnectedAppRecord }>(`/api/projects/${enc(projectId)}/console/releases/${enc(version)}/release`, json('POST')),
  rollback: (projectId: string) =>
    send<{ current: string; from: string; connectedApp: ConnectedAppRecord }>(`/api/projects/${enc(projectId)}/console/releases/rollback`, json('POST')),
  /** The identity the AI Assistant acts as follows the console's identity switch. */
  setActingIdentity: (projectId: string, actor: string) =>
    send<{ connectedApp: ConnectedAppRecord }>(`/api/projects/${enc(projectId)}/connected-app/acting-identity`, json('POST', { actor })).then((r) => r.connectedApp),
  disconnect: (projectId: string) => send<{ removed: boolean }>(`/api/projects/${enc(projectId)}/connected-app`, json('DELETE')),
  overview: (projectId: string, actor: string) =>
    send<ConsoleEnvelope<ConsoleOverview>>(`/api/projects/${enc(projectId)}/console/overview${query({ actor })}`),
  objects: (projectId: string, objectId: string, actor: string, filter?: string) =>
    send<ConsoleEnvelope<ObjectListResponse>>(`/api/projects/${enc(projectId)}/console/objects/${enc(objectId)}${query({ actor, filter, limit: 200 })}`),
  object: (projectId: string, objectId: string, key: string, actor: string) =>
    send<ConsoleEnvelope<ObjectDetailResponse>>(`/api/projects/${enc(projectId)}/console/objects/${enc(objectId)}/${enc(key)}${query({ actor })}`),
  invocations: (projectId: string) =>
    send<{ invocations: ActionInvocationRecord[] }>(`/api/projects/${enc(projectId)}/console/invocations`).then((r) => r.invocations),
  prepare: (projectId: string, actionId: string, actor: string, target: string | undefined, params: Record<string, unknown>) =>
    send<{ invocation: ActionInvocationRecord }>(`/api/projects/${enc(projectId)}/console/actions/${enc(actionId)}/prepare`, json('POST', { actor, target, params })).then((r) => r.invocation),
  approve: (projectId: string, invocationId: string) =>
    send<{ invocation: ActionInvocationRecord }>(`/api/projects/${enc(projectId)}/console/invocations/${enc(invocationId)}/approve`, json('POST')).then((r) => r.invocation),
  decline: (projectId: string, invocationId: string) =>
    send<{ invocation: ActionInvocationRecord }>(`/api/projects/${enc(projectId)}/console/invocations/${enc(invocationId)}/decline`, json('POST')).then((r) => r.invocation),
  reconcile: (projectId: string, invocationId: string) =>
    send<{ invocation: ActionInvocationRecord }>(`/api/projects/${enc(projectId)}/console/invocations/${enc(invocationId)}/reconcile`, json('POST')).then((r) => r.invocation),
  report: (projectId: string, reportId: string, actor: string) =>
    send<ConsoleEnvelope<ReportResponse>>(`/api/projects/${enc(projectId)}/console/reports/${enc(reportId)}${query({ actor })}`),
};

export type { ConnectionManifest };
