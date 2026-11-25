import type {
  ActivityResponse,
  ConnectionManifest,
  DataIssuesResponse,
  MetricsResponse,
  ObjectDetailResponse,
  ObjectListResponse,
  ReportResponse,
} from '../../../packages/application-runtime/index.js';
import type { ConnectedAppRecord } from '../../../packages/workspace-store/index.js';

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
  | 'UNKNOWN';

export class ConsoleRequestError extends Error {
  constructor(
    readonly code: ConsoleErrorCode,
    message: string,
    readonly status: number,
    readonly connectedApp: ConnectedAppRecord | null = null,
    readonly problems: readonly { path: string; message: string }[] = [],
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
    error?: { code?: string; message?: string; problems?: { path: string; message: string }[] } | string;
    connectedApp?: ConnectedAppRecord;
  };
  if (!res.ok) {
    const error = typeof body.error === 'object' && body.error ? body.error : { message: typeof body.error === 'string' ? body.error : res.statusText };
    throw new ConsoleRequestError(
      ((error as { code?: string }).code as ConsoleErrorCode | undefined) ?? 'UNKNOWN',
      error.message ?? res.statusText,
      res.status,
      body.connectedApp ?? null,
      (error as { problems?: { path: string; message: string }[] }).problems ?? [],
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
  disconnect: (projectId: string) => send<{ removed: boolean }>(`/api/projects/${enc(projectId)}/connected-app`, json('DELETE')),
  overview: (projectId: string, actor: string) =>
    send<ConsoleEnvelope<ConsoleOverview>>(`/api/projects/${enc(projectId)}/console/overview${query({ actor })}`),
  objects: (projectId: string, objectId: string, actor: string, filter?: string) =>
    send<ConsoleEnvelope<ObjectListResponse>>(`/api/projects/${enc(projectId)}/console/objects/${enc(objectId)}${query({ actor, filter, limit: 200 })}`),
  object: (projectId: string, objectId: string, key: string, actor: string) =>
    send<ConsoleEnvelope<ObjectDetailResponse>>(`/api/projects/${enc(projectId)}/console/objects/${enc(objectId)}/${enc(key)}${query({ actor })}`),
  report: (projectId: string, reportId: string, actor: string) =>
    send<ConsoleEnvelope<ReportResponse>>(`/api/projects/${enc(projectId)}/console/reports/${enc(reportId)}${query({ actor })}`),
};

export type { ConnectionManifest };
