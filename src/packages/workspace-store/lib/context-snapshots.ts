/**
 * Context Snapshots (ADR 0017): what each Model Call actually sent to the model and the usage the
 * provider reported for it. Content is stored once per `(project, content hash)` so instructions and
 * tool definitions repeated on every call cost one row, and messages survive session compaction.
 */
import { cyrb64Hex } from './content-hash.js';

/** What a piece of a Model Call's context is. */
export type ContextItemKind =
  | 'INSTRUCTIONS'
  | 'BUSINESS_CONTEXT'
  | 'COMPACTED_SUMMARY'
  | 'TOOL_GUIDE'
  | 'TOOL_DEFINITION'
  | 'USER_MESSAGE'
  | 'ASSISTANT_MESSAGE'
  | 'REASONING'
  | 'TOOL_CALL'
  | 'TOOL_RESULT';

export const CONTEXT_ITEM_KINDS: readonly ContextItemKind[] = [
  'INSTRUCTIONS',
  'BUSINESS_CONTEXT',
  'COMPACTED_SUMMARY',
  'TOOL_GUIDE',
  'TOOL_DEFINITION',
  'USER_MESSAGE',
  'ASSISTANT_MESSAGE',
  'REASONING',
  'TOOL_CALL',
  'TOOL_RESULT',
];

export type ToolDefinitionSource = 'BUILTIN' | 'MCP' | 'CODEMODE';

/** Where a usage figure came from. Only `PROVIDER` figures were reported by the model provider. */
export type ModelCallUsageSource = 'PROVIDER' | 'ESTIMATED' | 'SIMULATED';

export type ModelCallPurpose = 'TURN' | 'SUBAGENT' | 'COMPACTION';

export type ModelCallStatus = 'COMPLETED' | 'ERROR' | 'ABORTED';

export interface ContextItemInput {
  kind: ContextItemKind;
  content: string;
  /** Short name shown before the content, e.g. a tool name. */
  label?: string;
  source?: ToolDefinitionSource;
  /** The Agent Session message this item was replayed from, when it came from session history. */
  sessionMessageId?: string;
}

export interface ContextItemRef {
  blobId: string;
  kind: ContextItemKind;
  label?: string;
  source?: ToolDefinitionSource;
  sessionMessageId?: string;
  /** Estimated tokens of this item alone (providers report totals, never per item). */
  tokens: number;
}

export interface ContextItem extends ContextItemRef {
  content: string;
}

export interface ProviderReportedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCallUsage {
  /** Everything the model read for this call: uncached input plus cache reads and writes. */
  promptTokens: number;
  /** Input tokens not served from the provider's cache. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  source: ModelCallUsageSource;
}

export interface ModelCallEstimate {
  /** Estimated input tokens per kind of context item. */
  byKind: Record<ContextItemKind, number>;
  inputTokens: number;
  outputTokens: number;
  /** Estimated tokens of the session messages this call left out. */
  excludedTokens: number;
}

export interface ModelCallRecordInput {
  projectId: string;
  sessionId: string;
  runId?: string;
  parentCallId?: string;
  /** Subagent lane name for SUBAGENT calls. */
  laneLabel?: { zh: string; en: string };
  purpose: ModelCallPurpose;
  provider: string;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  startedAt: string;
  endedAt: string;
  status: ModelCallStatus;
  errorMessage?: string;
  /** Usage the provider reported, if any. Ignored when `simulated`. */
  providerUsage?: ProviderReportedUsage;
  /** True in the Mock mode of ADR 0007: usage is never presented as provider-reported. */
  simulated: boolean;
  included: ContextItemInput[];
  excluded: ContextItemInput[];
  response: ContextItemInput[];
  /** Fixed id for tests and for linking subagent calls to a parent; generated otherwise. */
  id?: string;
}

/** A Model Call as listed: no content, and `hasDetail` false once the full snapshot was dropped. */
export interface ModelCallSummary {
  id: string;
  projectId: string;
  sessionId: string;
  runId?: string;
  parentCallId?: string;
  laneLabel?: { zh: string; en: string };
  purpose: ModelCallPurpose;
  /** 1-based order of the call within its session. */
  seq: number;
  provider: string;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: ModelCallStatus;
  errorMessage?: string;
  usage: ModelCallUsage;
  estimate: ModelCallEstimate;
  includedCount: number;
  excludedCount: number;
  hasDetail: boolean;
}

export interface ModelCallDetail extends ModelCallSummary {
  included: ContextItem[];
  excluded: ContextItem[];
  response: ContextItem[];
}

export type ContextEventKind = 'COMPACT';

export interface ContextEventInput {
  projectId: string;
  sessionId: string;
  kind: ContextEventKind;
  /** Messages removed from the session by this event, archived so they stay inspectable. */
  removed: ContextItemInput[];
  /** The summary that replaced them, when there is one. */
  summary?: string;
  /** Whether a language model wrote the summary (true) or it was built deterministically. */
  summarizedByModel?: boolean;
  createdAt?: string;
}

export interface ContextEventSummary {
  id: string;
  projectId: string;
  sessionId: string;
  kind: ContextEventKind;
  createdAt: string;
  removedCount: number;
  /** Estimated tokens removed minus the tokens of the replacing summary (positive = reclaimed). */
  reclaimedTokens: number;
  summarizedByModel: boolean;
  /** Seq of the session's latest Model Call when the event happened (0 = before any call). */
  afterCallSeq: number;
}

export interface ContextEventDetail extends ContextEventSummary {
  removed: ContextItem[];
  summary?: ContextItem;
}

export const DEFAULT_MAX_FULL_MODEL_CALLS_PER_SESSION = 200;

/**
 * Rough token estimate used wherever the provider does not report a figure. CJK characters are
 * close to one token each; other text averages about four characters per token.
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk += 1;
    }
  }
  const other = text.length - cjk;
  return cjk + Math.ceil(other / 4);
}

interface StoredBlob {
  id: string;
  projectId: string;
  content: string;
}

interface StoredModelCall extends Omit<ModelCallSummary, 'hasDetail' | 'includedCount' | 'excludedCount'> {
  includedCount: number;
  excludedCount: number;
  detail?: {
    included: ContextItemRef[];
    excluded: ContextItemRef[];
    response: ContextItemRef[];
  };
}

interface StoredContextEvent extends ContextEventSummary {
  removed: ContextItemRef[];
  summary?: ContextItemRef;
}

/** The slice of the entity store this module needs. */
export interface ContextSnapshotStorage {
  put<T>(collection: string, itemId: string, payload: T, projectId: string): void;
  get<T>(collection: string, itemId: string): T | undefined;
  delete(collection: string, itemId: string): void;
  listBySession<T>(collection: string, projectId: string, sessionId: string): T[];
  listByProject<T>(collection: string, projectId: string): T[];
  newId(prefix: string): string;
}

const CALLS = 'model_calls';
const EVENTS = 'context_events';
const BLOBS = 'context_blobs';

function blobKey(projectId: string, blobId: string): string {
  return `${projectId}:${blobId}`;
}

function contentHash(content: string): string {
  return `ctx-${cyrb64Hex(content)}-${content.length.toString(36)}`;
}

function storeItems(
  storage: ContextSnapshotStorage,
  projectId: string,
  items: readonly ContextItemInput[],
  written: Set<string>,
): ContextItemRef[] {
  return items.map((item) => {
    const blobId = contentHash(item.content);
    const key = blobKey(projectId, blobId);
    if (!written.has(key)) {
      written.add(key);
      if (!storage.get<StoredBlob>(BLOBS, key)) {
        storage.put<StoredBlob>(BLOBS, key, { id: blobId, projectId, content: item.content }, projectId);
      }
    }
    return {
      blobId,
      kind: item.kind,
      ...(item.label ? { label: item.label } : {}),
      ...(item.source ? { source: item.source } : {}),
      ...(item.sessionMessageId ? { sessionMessageId: item.sessionMessageId } : {}),
      tokens: estimateTextTokens(item.content),
    };
  });
}

function resolveItems(
  storage: ContextSnapshotStorage,
  projectId: string,
  refs: readonly ContextItemRef[],
): ContextItem[] {
  return refs.map((ref) => ({
    ...ref,
    content: storage.get<StoredBlob>(BLOBS, blobKey(projectId, ref.blobId))?.content ?? '',
  }));
}

function emptyByKind(): Record<ContextItemKind, number> {
  return Object.fromEntries(CONTEXT_ITEM_KINDS.map((k) => [k, 0])) as Record<ContextItemKind, number>;
}

function sumTokens(refs: readonly ContextItemRef[]): number {
  return refs.reduce((sum, ref) => sum + ref.tokens, 0);
}

function resolveUsage(
  input: ModelCallRecordInput,
  estimate: ModelCallEstimate,
): ModelCallUsage {
  const reported = input.providerUsage;
  if (!input.simulated && reported && reported.input + reported.output + reported.cacheRead > 0) {
    // pi-ai reports `input` without cached tokens, so the prompt is the sum of the three.
    return {
      promptTokens: reported.input + reported.cacheRead + reported.cacheWrite,
      inputTokens: reported.input,
      outputTokens: reported.output,
      cacheReadTokens: reported.cacheRead,
      cacheWriteTokens: reported.cacheWrite,
      totalTokens: reported.input + reported.output + reported.cacheRead + reported.cacheWrite,
      source: 'PROVIDER',
    };
  }
  return {
    promptTokens: estimate.inputTokens,
    inputTokens: estimate.inputTokens,
    outputTokens: estimate.outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: estimate.inputTokens + estimate.outputTokens,
    source: input.simulated ? 'SIMULATED' : 'ESTIMATED',
  };
}

function toSummary(call: StoredModelCall): ModelCallSummary {
  const { detail, ...rest } = call;
  return { ...rest, hasDetail: Boolean(detail) };
}

function sortBySeq(calls: StoredModelCall[]): StoredModelCall[] {
  return calls.sort((a, b) => a.seq - b.seq);
}

function latestSeq(storage: ContextSnapshotStorage, projectId: string, sessionId: string): number {
  return storage
    .listBySession<StoredModelCall>(CALLS, projectId, sessionId)
    .reduce((max, call) => Math.max(max, call.seq), 0);
}

/** Deletes blobs of a project that no remaining call or event references. */
function collectGarbage(storage: ContextSnapshotStorage, projectId: string): void {
  const referenced = new Set<string>();
  for (const call of storage.listByProject<StoredModelCall>(CALLS, projectId)) {
    if (!call.detail) continue;
    for (const ref of [...call.detail.included, ...call.detail.excluded, ...call.detail.response]) {
      referenced.add(ref.blobId);
    }
  }
  for (const event of storage.listByProject<StoredContextEvent>(EVENTS, projectId)) {
    for (const ref of event.removed) referenced.add(ref.blobId);
    if (event.summary) referenced.add(event.summary.blobId);
  }
  for (const blob of storage.listByProject<StoredBlob>(BLOBS, projectId)) {
    if (!referenced.has(blob.id)) storage.delete(BLOBS, blobKey(projectId, blob.id));
  }
}

export function recordModelCall(
  storage: ContextSnapshotStorage,
  input: ModelCallRecordInput,
  maxFullCallsPerSession: number = DEFAULT_MAX_FULL_MODEL_CALLS_PER_SESSION,
): ModelCallSummary {
  const written = new Set<string>();
  const included = storeItems(storage, input.projectId, input.included, written);
  const excluded = storeItems(storage, input.projectId, input.excluded, written);
  const response = storeItems(storage, input.projectId, input.response, written);

  const byKind = emptyByKind();
  for (const ref of included) byKind[ref.kind] += ref.tokens;
  const estimate: ModelCallEstimate = {
    byKind,
    inputTokens: sumTokens(included),
    outputTokens: sumTokens(response),
    excludedTokens: sumTokens(excluded),
  };

  const existing = sortBySeq(
    storage.listBySession<StoredModelCall>(CALLS, input.projectId, input.sessionId),
  );
  const seq = (existing.at(-1)?.seq ?? 0) + 1;
  const startedMs = Date.parse(input.startedAt);
  const endedMs = Date.parse(input.endedAt);
  const call: StoredModelCall = {
    id: input.id ?? storage.newId('mcall'),
    projectId: input.projectId,
    sessionId: input.sessionId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.parentCallId ? { parentCallId: input.parentCallId } : {}),
    ...(input.laneLabel ? { laneLabel: input.laneLabel } : {}),
    purpose: input.purpose,
    seq,
    provider: input.provider,
    model: input.model,
    contextWindow: input.contextWindow,
    maxOutputTokens: input.maxOutputTokens,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs:
      Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - startedMs) : 0,
    status: input.status,
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    usage: resolveUsage(input, estimate),
    estimate,
    includedCount: included.length,
    excludedCount: excluded.length,
    detail: { included, excluded, response },
  };
  storage.put(CALLS, call.id, call, input.projectId);

  const withDetail = [...existing, call].filter((c) => c.detail);
  const overflow = withDetail.length - Math.max(1, maxFullCallsPerSession);
  if (overflow > 0) {
    for (const old of withDetail.slice(0, overflow)) {
      const { detail: _dropped, ...usageOnly } = old;
      storage.put(CALLS, old.id, usageOnly, input.projectId);
    }
    collectGarbage(storage, input.projectId);
  }
  return toSummary(call);
}

export function listModelCalls(
  storage: ContextSnapshotStorage,
  projectId: string,
  sessionId: string,
): ModelCallSummary[] {
  return sortBySeq(storage.listBySession<StoredModelCall>(CALLS, projectId, sessionId)).map(toSummary);
}

export function getModelCall(
  storage: ContextSnapshotStorage,
  projectId: string,
  callId: string,
): ModelCallDetail | undefined {
  const call = storage.get<StoredModelCall>(CALLS, callId);
  if (!call || call.projectId !== projectId) return undefined;
  const summary = toSummary(call);
  if (!call.detail) return { ...summary, included: [], excluded: [], response: [] };
  return {
    ...summary,
    included: resolveItems(storage, projectId, call.detail.included),
    excluded: resolveItems(storage, projectId, call.detail.excluded),
    response: resolveItems(storage, projectId, call.detail.response),
  };
}

export function recordContextEvent(
  storage: ContextSnapshotStorage,
  input: ContextEventInput,
): ContextEventSummary {
  const written = new Set<string>();
  const removed = storeItems(storage, input.projectId, input.removed, written);
  const summary = input.summary
    ? storeItems(storage, input.projectId, [{ kind: 'COMPACTED_SUMMARY', content: input.summary }], written)[0]
    : undefined;
  const event: StoredContextEvent = {
    id: storage.newId('ctxevt'),
    projectId: input.projectId,
    sessionId: input.sessionId,
    kind: input.kind,
    createdAt: input.createdAt ?? new Date().toISOString(),
    removedCount: removed.length,
    reclaimedTokens: sumTokens(removed) - (summary?.tokens ?? 0),
    summarizedByModel: Boolean(input.summarizedByModel),
    afterCallSeq: latestSeq(storage, input.projectId, input.sessionId),
    removed,
    ...(summary ? { summary } : {}),
  };
  storage.put(EVENTS, event.id, event, input.projectId);
  const { removed: _r, summary: _s, ...eventSummary } = event;
  return eventSummary;
}

export function listContextEvents(
  storage: ContextSnapshotStorage,
  projectId: string,
  sessionId: string,
): ContextEventSummary[] {
  return storage
    .listBySession<StoredContextEvent>(EVENTS, projectId, sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(({ removed: _r, summary: _s, ...rest }) => rest);
}

export function getContextEvent(
  storage: ContextSnapshotStorage,
  projectId: string,
  eventId: string,
): ContextEventDetail | undefined {
  const event = storage.get<StoredContextEvent>(EVENTS, eventId);
  if (!event || event.projectId !== projectId) return undefined;
  const { removed, summary, ...rest } = event;
  return {
    ...rest,
    removed: resolveItems(storage, projectId, removed),
    ...(summary ? { summary: resolveItems(storage, projectId, [summary])[0] } : {}),
  };
}

/** Removes every Model Call and context event of a session, then the content nothing references. */
export function deleteSessionContextSnapshots(
  storage: ContextSnapshotStorage,
  projectId: string,
  sessionId: string,
): void {
  for (const call of storage.listBySession<StoredModelCall>(CALLS, projectId, sessionId)) {
    storage.delete(CALLS, call.id);
  }
  for (const event of storage.listBySession<StoredContextEvent>(EVENTS, projectId, sessionId)) {
    storage.delete(EVENTS, event.id);
  }
  collectGarbage(storage, projectId);
}
