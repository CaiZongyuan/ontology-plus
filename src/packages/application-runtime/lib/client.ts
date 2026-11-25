import type { z } from 'zod';
import {
  ACTOR_HEADER,
  ActivityResponseSchema,
  DataIssuesResponseSchema,
  MANIFEST_PATH,
  MetricsResponseSchema,
  ObjectDetailResponseSchema,
  ObjectListResponseSchema,
  ReportResponseSchema,
  parseConnectionManifest,
  type ActivityResponse,
  type ConnectionManifest,
  type DataIssuesResponse,
  type ManifestProblem,
  type MetricsResponse,
  type ObjectDetailResponse,
  type ObjectListResponse,
  type ReportResponse,
} from './contract.js';

export type ConnectionErrorCode = 'INVALID_ADDRESS' | 'UNREACHABLE' | 'NOT_FOUND' | 'REJECTED' | 'BAD_RESPONSE' | 'INVALID_MANIFEST';

/** A failed call to a connected application, with a reason the console can explain. */
export class ConnectionError extends Error {
  constructor(
    readonly code: ConnectionErrorCode,
    message: string,
    readonly status?: number,
    readonly problems: readonly ManifestProblem[] = [],
  ) {
    super(message);
    this.name = 'ConnectionError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ConnectionClientOptions {
  readonly baseUrl: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

export interface ObjectListQuery {
  readonly filter?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ConnectionClient {
  readonly baseUrl: string;
  readManifest(): Promise<ConnectionManifest>;
  metrics(actor: string): Promise<MetricsResponse>;
  listObjects(objectId: string, actor: string, query?: ObjectListQuery): Promise<ObjectListResponse>;
  getObject(objectId: string, key: string, actor: string): Promise<ObjectDetailResponse>;
  report(reportId: string, actor: string): Promise<ReportResponse>;
  dataIssues(actor: string): Promise<DataIssuesResponse>;
  activity(actor: string): Promise<ActivityResponse>;
}

/** Normalises what a user typed as the application's address; only http(s) is accepted. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    throw new ConnectionError('INVALID_ADDRESS', `"${raw}" is not an address`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConnectionError('INVALID_ADDRESS', 'only http and https addresses can be connected');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

export function createConnectionClient(options: ConnectionClientOptions): ConnectionClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 8000;

  async function getJson(path: string, actor?: string): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(baseUrl + path, {
        headers: { accept: 'application/json', ...(actor ? { [ACTOR_HEADER]: actor } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ConnectionError('UNREACHABLE', `cannot reach ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 404) throw new ConnectionError('NOT_FOUND', `${path} was not found on ${baseUrl}`, 404);
    if (res.status === 400 || res.status === 403) {
      throw new ConnectionError('REJECTED', `${baseUrl} refused ${path} (${res.status})`, res.status);
    }
    if (!res.ok) throw new ConnectionError('BAD_RESPONSE', `${baseUrl} answered ${path} with ${res.status}`, res.status);
    try {
      return await res.json();
    } catch {
      throw new ConnectionError('BAD_RESPONSE', `${baseUrl} answered ${path} with something that is not JSON`, res.status);
    }
  }

  async function read<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, path: string, actor: string): Promise<T> {
    const body = await getJson(path, actor);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ConnectionError('BAD_RESPONSE', `${path} does not follow the connection contract: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim());
    }
    return parsed.data;
  }

  const enc = encodeURIComponent;
  return {
    baseUrl,
    async readManifest() {
      const body = await getJson(MANIFEST_PATH);
      const parsed = parseConnectionManifest(body);
      if (!parsed.ok) throw new ConnectionError('INVALID_MANIFEST', 'the connection manifest does not follow the contract', undefined, parsed.problems);
      return parsed.manifest;
    },
    metrics: (actor) => read(MetricsResponseSchema, '/runtime/metrics', actor),
    listObjects(objectId, actor, query = {}) {
      const params = new URLSearchParams();
      if (query.filter) params.set('filter', query.filter);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.offset !== undefined) params.set('offset', String(query.offset));
      const qs = params.toString();
      return read(ObjectListResponseSchema, `/runtime/objects/${enc(objectId)}${qs ? `?${qs}` : ''}`, actor);
    },
    getObject: (objectId, key, actor) => read(ObjectDetailResponseSchema, `/runtime/objects/${enc(objectId)}/${enc(key)}`, actor),
    report: (reportId, actor) => read(ReportResponseSchema, `/runtime/reports/${enc(reportId)}`, actor),
    dataIssues: (actor) => read(DataIssuesResponseSchema, '/runtime/data-issues', actor),
    activity: (actor) => read(ActivityResponseSchema, '/runtime/activity', actor),
  };
}
