import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  DEFAULT_MAX_FULL_MODEL_CALLS_PER_SESSION,
  type ContextEventDetail,
  type ContextEventSummary,
  type ContextItem,
  type ContextItemKind,
  type ModelCallDetail,
  type ModelCallSummary,
  type ToolDefinitionSource,
} from '../../../../packages/workspace-store/index.js';
import { apiGetContextEvent, apiGetModelCall } from '../../../api.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import {
  ContextUsageSourceBadge,
  formatTokenCount,
  type ContextCompositionSegmentKey,
} from './ContextCompositionBar.js';
import {
  formatModelCallDuration,
  formatModelCallPurposeLabel,
} from './ModelCallTimeline.js';
import './context-inspector.css';

export type ContextBrowserCategoryKind = ContextItemKind | 'RESPONSE';

export const CONTEXT_BROWSER_INCLUDED_ORDER: readonly ContextItemKind[] = [
  'INSTRUCTIONS',
  'TOOL_GUIDE',
  'TOOL_DEFINITION',
  'BUSINESS_CONTEXT',
  'COMPACTED_SUMMARY',
  'USER_MESSAGE',
  'ASSISTANT_MESSAGE',
  'REASONING',
  'TOOL_CALL',
  'TOOL_RESULT',
] as const;

export interface ContextBrowserCategoryGroup {
  readonly kind: ContextBrowserCategoryKind;
  readonly items: readonly ContextItem[];
  readonly totalTokens: number;
}

export function groupContextBrowserItems(
  detail: Pick<ModelCallDetail, 'included' | 'response'>,
): ContextBrowserCategoryGroup[] {
  const byKind = new Map<ContextItemKind, ContextItem[]>();
  for (const item of detail.included) {
    const bucket = byKind.get(item.kind);
    if (bucket) {
      bucket.push(item);
    } else {
      byKind.set(item.kind, [item]);
    }
  }

  const groups: ContextBrowserCategoryGroup[] = [];
  for (const kind of CONTEXT_BROWSER_INCLUDED_ORDER) {
    const items = byKind.get(kind);
    if (!items || items.length === 0) continue;
    groups.push({
      kind,
      items,
      totalTokens: items.reduce((sum, item) => sum + item.tokens, 0),
    });
  }

  if (detail.response.length > 0) {
    groups.push({
      kind: 'RESPONSE',
      items: detail.response,
      totalTokens: detail.response.reduce((sum, item) => sum + item.tokens, 0),
    });
  }

  return groups;
}

export function formatToolDefinitionSourceLabel(
  source: ToolDefinitionSource,
  t: (zh: string, en: string) => string,
): string {
  switch (source) {
    case 'BUILTIN':
      return t('内置', 'Built-in');
    case 'MCP':
      return 'MCP';
    case 'CODEMODE':
      return 'codemode';
  }
}

export function formatContextCategoryLabel(
  kind: ContextBrowserCategoryKind,
  t: (zh: string, en: string) => string,
): string {
  switch (kind) {
    case 'INSTRUCTIONS':
      return 'system prompt';
    case 'TOOL_GUIDE':
      return t('工具说明', 'Tool guide');
    case 'TOOL_DEFINITION':
      return t('工具定义', 'Tool definitions');
    case 'BUSINESS_CONTEXT':
      return t('注入的业务上下文', 'Injected business context');
    case 'COMPACTED_SUMMARY':
      return t('历史摘要', 'Compacted summary');
    case 'USER_MESSAGE':
      return t('用户消息', 'User messages');
    case 'ASSISTANT_MESSAGE':
      return t('助手回复', 'Assistant replies');
    case 'REASONING':
      return t('思考', 'Thinking');
    case 'TOOL_CALL':
      return t('工具调用', 'Tool calls');
    case 'TOOL_RESULT':
      return t('工具结果', 'Tool results');
    case 'RESPONSE':
      return t('本次模型输出', 'Model response');
  }
}

export function formatSingleItemKindBadge(
  kind: ContextItemKind,
  t: (zh: string, en: string) => string,
): string {
  switch (kind) {
    case 'USER_MESSAGE':
      return t('用户消息', 'User message');
    case 'ASSISTANT_MESSAGE':
      return t('助手回复', 'Assistant reply');
    case 'TOOL_CALL':
      return t('工具调用', 'Tool call');
    case 'TOOL_RESULT':
      return t('工具结果', 'Tool result');
    case 'REASONING':
      return t('思考', 'Thinking');
    case 'COMPACTED_SUMMARY':
      return t('历史摘要', 'Compacted summary');
    case 'BUSINESS_CONTEXT':
      return t('业务上下文', 'Business context');
    case 'TOOL_DEFINITION':
      return t('工具定义', 'Tool definition');
    case 'TOOL_GUIDE':
      return t('工具说明', 'Tool guide');
    case 'INSTRUCTIONS':
      return 'system prompt';
  }
}

function categorySwatchKey(
  kind: ContextBrowserCategoryKind,
): Exclude<ContextCompositionSegmentKey, 'remaining'> {
  switch (kind) {
    case 'INSTRUCTIONS':
    case 'TOOL_GUIDE':
      return 'system_prompt';
    case 'TOOL_DEFINITION':
      return 'tool_definitions';
    case 'BUSINESS_CONTEXT':
    case 'COMPACTED_SUMMARY':
      return 'business_context';
    case 'USER_MESSAGE':
    case 'ASSISTANT_MESSAGE':
    case 'RESPONSE':
      return 'messages';
    case 'REASONING':
      return 'thinking';
    case 'TOOL_CALL':
    case 'TOOL_RESULT':
      return 'tool_results';
  }
}

function formatStartedTimeShort(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export interface ModelCallDetailCache {
  get(projectId: string, callId: string): ModelCallDetail | undefined;
  set(projectId: string, detail: ModelCallDetail): void;
  loadIfNeeded(
    projectId: string | undefined,
    call: ModelCallSummary | null | undefined,
  ): Promise<ModelCallDetail | null>;
}

export function createModelCallDetailCache(): ModelCallDetailCache {
  const resolved = new Map<string, ModelCallDetail>();
  const inflight = new Map<string, Promise<ModelCallDetail | null>>();
  const keyOf = (projectId: string, callId: string) => `${projectId}:${callId}`;

  return {
    get(projectId, callId) {
      return resolved.get(keyOf(projectId, callId));
    },
    set(projectId, detail) {
      resolved.set(keyOf(projectId, detail.id), detail);
    },
    async loadIfNeeded(projectId, call) {
      if (!projectId || !call || !call.hasDetail || typeof fetch !== 'function') {
        return null;
      }
      const key = keyOf(projectId, call.id);
      const hit = resolved.get(key);
      if (hit) return hit;

      const existingPromise = inflight.get(key);
      if (existingPromise) return existingPromise;

      const req = apiGetModelCall(projectId, call.id)
        .then((res) => {
          resolved.set(key, res.modelCall);
          return res.modelCall;
        })
        .catch(() => null)
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, req);
      return req;
    },
  };
}

function summarizeItemPreview(
  item: ContextItem,
  t: (zh: string, en: string) => string,
): string {
  if (item.label) return item.label;
  const firstNonEmpty = item.content
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim();
  if (!firstNonEmpty) return t('（空内容）', '(empty)');
  return firstNonEmpty.length > 76 ? `${firstNonEmpty.slice(0, 75)}…` : firstNonEmpty;
}

function BrowserItemRow({
  item,
  inResponseGroup,
  defaultExpanded,
}: {
  item: ContextItem;
  inResponseGroup: boolean;
  defaultExpanded: boolean;
}) {
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded, item.blobId]);

  const preview = summarizeItemPreview(item, t);
  const toolSource: ToolDefinitionSource | undefined =
    item.kind === 'TOOL_DEFINITION' ? (item.source ?? 'BUILTIN') : item.source;

  return (
    <div
      className={cn('context-browser-item', expanded && 'is-expanded')}
      data-testid="context-browser-item"
      data-item-kind={item.kind}
    >
      <button
        type="button"
        className="context-browser-item-head"
        data-testid="context-browser-item-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? (
          <ChevronDown size={13} className="context-browser-chevron" aria-hidden="true" />
        ) : (
          <ChevronRight size={13} className="context-browser-chevron" aria-hidden="true" />
        )}

        {inResponseGroup && (
          <span className="context-removed-item-badge">
            {formatSingleItemKindBadge(item.kind, t)}
          </span>
        )}

        <span
          className={cn(
            'context-browser-item-label',
            Boolean(item.label) && 'is-mono',
          )}
        >
          {preview}
        </span>

        {toolSource && (
          <span
            className={cn('context-tool-source', `is-${toolSource.toLowerCase()}`)}
            data-testid="context-tool-source"
            data-tool-source={toolSource}
          >
            {formatToolDefinitionSourceLabel(toolSource, t)}
          </span>
        )}

        <span className="context-browser-item-tokens">
          ≈{formatTokenCount(item.tokens)}
        </span>
      </button>

      {expanded && (
        <pre
          className="context-browser-item-content"
          data-testid="context-browser-item-content"
        >
          {item.content}
        </pre>
      )}
    </div>
  );
}

function BrowserCategorySection({
  group,
  expandedItemKeySet,
}: {
  group: ContextBrowserCategoryGroup;
  expandedItemKeySet: ReadonlySet<string>;
}) {
  const { t } = usePreferences();
  const [open, setOpen] = useState<boolean>(true);
  const swatchKey = categorySwatchKey(group.kind);
  const title = formatContextCategoryLabel(group.kind, t);

  return (
    <div
      className="context-browser-category"
      data-testid="context-browser-category"
      data-category-kind={group.kind}
    >
      <button
        type="button"
        className="context-browser-category-head"
        data-testid="context-browser-category-toggle"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? (
          <ChevronDown size={13} className="context-browser-chevron" aria-hidden="true" />
        ) : (
          <ChevronRight size={13} className="context-browser-chevron" aria-hidden="true" />
        )}
        <span className={`context-seg-swatch is-${swatchKey}`} aria-hidden="true" />
        <span className="context-browser-category-title">{title}</span>
        <span className="context-browser-category-count">
          {t(`${group.items.length} 项`, `${group.items.length} items`)}
        </span>
        <span className="context-browser-category-tokens">
          ≈{formatTokenCount(group.totalTokens)}
        </span>
      </button>

      {open && (
        <div className="context-browser-item-list">
          {group.items.map((item, idx) => {
            const defaultExpanded =
              expandedItemKeySet.has('*') ||
              expandedItemKeySet.has(item.blobId) ||
              (item.label ? expandedItemKeySet.has(item.label) : false);
            return (
              <BrowserItemRow
                key={`${group.kind}-${item.blobId}-${idx}`}
                item={item}
                inResponseGroup={group.kind === 'RESPONSE'}
                defaultExpanded={defaultExpanded}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function RemovedItemCard({
  item,
  origin,
  defaultExpanded,
}: {
  item: ContextItem;
  origin: 'trimmed' | 'compacted';
  defaultExpanded: boolean;
}) {
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);

  useEffect(() => {
    if (defaultExpanded) setExpanded(true);
  }, [defaultExpanded]);

  const firstLine = summarizeItemPreview(item, t);

  return (
    <div
      className="context-removed-item"
      data-testid="context-removed-item"
      data-removed-origin={origin}
    >
      <button
        type="button"
        className="context-removed-item-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? (
          <ChevronDown size={13} aria-hidden="true" />
        ) : (
          <ChevronRight size={13} aria-hidden="true" />
        )}
        <span className="context-removed-item-badge">
          {formatSingleItemKindBadge(item.kind, t)}
        </span>
        <span className="context-removed-item-preview">{firstLine}</span>
        <span className="context-removed-item-tokens">
          ≈{formatTokenCount(item.tokens)}
        </span>
      </button>
      {expanded && (
        <pre className="context-removed-item-body">{item.content}</pre>
      )}
    </div>
  );
}

export interface ContextBrowserProps {
  projectId?: string;
  selectedCall?: ModelCallSummary | null;
  isLatestSelected?: boolean;
  focus?: 'composition' | 'removed' | 'calls' | 'events' | 'lanes';
  contextEvents?: readonly ContextEventSummary[];
  /** Optional deterministic pre-supplied call details keyed by callId (for SSR unit tests). */
  callDetailsById?: Readonly<Record<string, ModelCallDetail>>;
  /** Backwards-compatible pre-loaded call detail from #82. */
  fallbackCallDetail?: ModelCallDetail | null;
  /** Optional pre-loaded compaction event details (for SSR unit tests). */
  compactedEventDetails?: readonly ContextEventDetail[];
  /** Optional item keys (`blobId`, `label`, or `'*'`) expanded on initial render (for SSR unit tests). */
  defaultExpandedItemKeys?: readonly string[];
}

/**
 * Right-column Context Browser (#83, User Stories 23–25, 27, ADR 0017).
 * Shows the exact context items sent on the selected Model Call grouped by category,
 * tool definition source badges (BUILTIN / MCP / CODEMODE), separate "已移出 / Removed" messages,
 * and a calm pruned notice ("详情已不保留 / Details no longer retained") for calls older than 200 snapshots.
 */
export function ContextBrowser({
  projectId,
  selectedCall,
  isLatestSelected = true,
  focus = 'composition',
  contextEvents,
  callDetailsById,
  fallbackCallDetail,
  compactedEventDetails: controlledCompactedDetails,
  defaultExpandedItemKeys,
}: ContextBrowserProps) {
  const { t } = usePreferences();
  const removedSectionRef = useRef<HTMLElement>(null);
  const callCacheRef = useRef<ModelCallDetailCache | null>(null);
  if (!callCacheRef.current) {
    callCacheRef.current = createModelCallDetailCache();
  }
  const eventCacheRef = useRef<Map<string, ContextEventDetail>>(new Map());

  const expandedItemKeySet = useMemo(
    () => new Set(defaultExpandedItemKeys ?? []),
    [defaultExpandedItemKeys],
  );

  const preSuppliedDetail: ModelCallDetail | null | undefined = useMemo(() => {
    if (!selectedCall) return null;
    if (callDetailsById && callDetailsById[selectedCall.id] !== undefined) {
      return callDetailsById[selectedCall.id]!;
    }
    if (fallbackCallDetail !== undefined) {
      if (fallbackCallDetail === null) return null;
      if (fallbackCallDetail.id === selectedCall.id || isLatestSelected) {
        return fallbackCallDetail;
      }
    }
    if (projectId) {
      const cached = callCacheRef.current?.get(projectId, selectedCall.id);
      if (cached) return cached;
    }
    return undefined;
  }, [selectedCall, callDetailsById, fallbackCallDetail, isLatestSelected, projectId]);

  const [fetchedDetail, setFetchedDetail] = useState<ModelCallDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  useEffect(() => {
    if (!selectedCall || !selectedCall.hasDetail || !projectId) {
      setFetchedDetail(null);
      setLoadingDetail(false);
      return;
    }
    if (preSuppliedDetail !== undefined) {
      setFetchedDetail(preSuppliedDetail);
      setLoadingDetail(false);
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    void callCacheRef.current!.loadIfNeeded(projectId, selectedCall).then((detail) => {
      if (cancelled) return;
      setFetchedDetail(detail);
      setLoadingDetail(false);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, selectedCall, preSuppliedDetail]);

  const compactEventSummaries = useMemo(
    () => (contextEvents ?? []).filter((e) => e.kind === 'COMPACT'),
    [contextEvents],
  );
  const compactIdsKey = compactEventSummaries.map((e) => e.id).join(',');

  const [fetchedCompactedDetails, setFetchedCompactedDetails] = useState<ContextEventDetail[]>([]);
  const [loadingEvents, setLoadingEvents] = useState<boolean>(false);

  useEffect(() => {
    if (controlledCompactedDetails !== undefined) {
      setLoadingEvents(false);
      return;
    }
    if (!projectId || compactEventSummaries.length === 0 || typeof fetch !== 'function') {
      setFetchedCompactedDetails([]);
      setLoadingEvents(false);
      return;
    }

    let cancelled = false;
    setLoadingEvents(true);
    void Promise.all(
      compactEventSummaries.map(async (ev) => {
        const key = `${projectId}:${ev.id}`;
        const hit = eventCacheRef.current.get(key);
        if (hit) return hit;
        try {
          const res = await apiGetContextEvent(projectId, ev.id);
          eventCacheRef.current.set(key, res.contextEvent);
          return res.contextEvent;
        } catch {
          return null;
        }
      }),
    ).then((list) => {
      if (cancelled) return;
      setFetchedCompactedDetails(
        list.filter((item): item is ContextEventDetail => item !== null),
      );
      setLoadingEvents(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, compactIdsKey, controlledCompactedDetails]);

  useEffect(() => {
    if (focus === 'removed') {
      removedSectionRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [focus]);

  const resolvedDetail: ModelCallDetail | null =
    preSuppliedDetail !== undefined
      ? preSuppliedDetail
      : fetchedDetail && selectedCall && fetchedDetail.id === selectedCall.id
        ? fetchedDetail
        : null;

  const allCompactedDetails =
    controlledCompactedDetails !== undefined
      ? controlledCompactedDetails
      : fetchedCompactedDetails;

  const isRemovedFocused = focus === 'removed';
  const relevantCompactedDetails = useMemo(() => {
    if (!selectedCall || isLatestSelected || isRemovedFocused) {
      return allCompactedDetails;
    }
    return allCompactedDetails.filter((ev) => ev.afterCallSeq < selectedCall.seq);
  }, [allCompactedDetails, selectedCall, isLatestSelected, isRemovedFocused]);

  const relevantCompactSummaries = useMemo(() => {
    if (!selectedCall || isLatestSelected || isRemovedFocused) {
      return compactEventSummaries;
    }
    return compactEventSummaries.filter((ev) => ev.afterCallSeq < selectedCall.seq);
  }, [compactEventSummaries, selectedCall, isLatestSelected, isRemovedFocused]);

  const categoryGroups = useMemo(
    () => (resolvedDetail ? groupContextBrowserItems(resolvedDetail) : []),
    [resolvedDetail],
  );

  const excludedItems: readonly ContextItem[] = resolvedDetail?.excluded ?? [];
  const totalCompactedCount =
    relevantCompactedDetails.length > 0
      ? relevantCompactedDetails.reduce((sum, d) => sum + d.removed.length, 0)
      : relevantCompactSummaries.reduce((sum, s) => sum + s.removedCount, 0);
  const totalRemovedCount = excludedItems.length + totalCompactedCount;

  const startedClock = selectedCall ? formatStartedTimeShort(selectedCall.startedAt) : '';

  return (
    <div
      className="context-browser"
      data-testid="context-browser"
      data-selected-call-id={selectedCall?.id ?? ''}
      data-selected-call-seq={selectedCall ? String(selectedCall.seq) : ''}
    >
      <section className="context-inspector-section context-browser-main">
        {!selectedCall ? (
          <>
            <div className="context-inspector-section-head">
              <h3 className="context-inspector-section-title">
                {t('调用详情', 'Call context items')}
              </h3>
            </div>
            <p className="context-inspector-note" data-testid="context-browser-empty">
              {t(
                '尚未记录模型调用；发送消息后可在此逐项查看实际发送的上下文。',
                'No model calls recorded yet. Send a message to inspect the exact context items sent.',
              )}
            </p>
          </>
        ) : (
          <>
            <div
              className="context-browser-head"
              data-testid="context-browser-head"
            >
              <div className="context-browser-head-top">
                <h3 className="context-inspector-section-title">
                  {t(
                    `第 #${selectedCall.seq} 次调用发送的内容`,
                    `Call #${selectedCall.seq} context snapshot`,
                  )}
                </h3>
                <ContextUsageSourceBadge source={selectedCall.usage.source} />
              </div>

              <div className="context-browser-head-meta">
                <span>
                  #{selectedCall.seq}{' '}
                  {formatModelCallPurposeLabel(
                    selectedCall.purpose,
                    selectedCall.laneLabel,
                    t,
                  )}
                </span>
                <span className="context-browser-head-model">{selectedCall.model}</span>
                <span>
                  {t('输入', 'Input')} {formatTokenCount(selectedCall.usage.promptTokens)}
                  {selectedCall.usage.cacheReadTokens > 0 && (
                    <>
                      {' '}
                      ({t(
                        `缓存命中 ${formatTokenCount(selectedCall.usage.cacheReadTokens)}`,
                        `cache read ${formatTokenCount(selectedCall.usage.cacheReadTokens)}`,
                      )})
                    </>
                  )}
                </span>
                <span>
                  {t('输出', 'Output')} {formatTokenCount(selectedCall.usage.outputTokens)}
                </span>
                <span>{formatModelCallDuration(selectedCall.durationMs)}</span>
                {startedClock && <span>{startedClock} UTC</span>}
              </div>
            </div>

            {!selectedCall.hasDetail ? (
              <div
                className="context-browser-pruned-notice"
                data-testid="context-browser-pruned-notice"
              >
                <div className="context-browser-pruned-title">
                  {t('详情已不保留', 'Details no longer retained')}
                </div>
                <p className="context-browser-pruned-desc">
                  {t(
                    `完整上下文快照仅保留最近 ${DEFAULT_MAX_FULL_MODEL_CALLS_PER_SESSION} 次模型调用；本次调用的用量数值、模型名称与耗时记录仍完整保留在上方。`,
                    `Full context snapshots are kept for the most recent ${DEFAULT_MAX_FULL_MODEL_CALLS_PER_SESSION} model calls; this call's recorded token usage, model, and timing remain preserved above.`,
                  )}
                </p>
              </div>
            ) : loadingDetail && !resolvedDetail ? (
              <p className="context-inspector-note" data-testid="context-browser-loading">
                {t('正在加载本次调用上下文…', 'Loading context snapshot…')}
              </p>
            ) : categoryGroups.length === 0 ? (
              <p className="context-inspector-note">
                {t('本次调用暂无可展开的上下文条目。', 'No context items recorded for this call.')}
              </p>
            ) : (
              <div className="context-browser-categories">
                {categoryGroups.map((group) => (
                  <BrowserCategorySection
                    key={group.kind}
                    group={group}
                    expandedItemKeySet={expandedItemKeySet}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section
        ref={removedSectionRef}
        className={cn(
          'context-inspector-section context-removed-section',
          isRemovedFocused && 'is-focused',
        )}
        data-testid="context-inspector-removed-section"
        data-focused={isRemovedFocused ? 'true' : 'false'}
      >
        <div className="context-inspector-section-head">
          <h3 className="context-inspector-section-title">
            {t('已移出（未原样发送）', 'Removed (not sent verbatim)')}
          </h3>
          <span className="context-inspector-section-meta">
            {t(`${totalRemovedCount} 条`, `${totalRemovedCount} items`)}
          </span>
        </div>

        {(loadingDetail || loadingEvents) &&
        excludedItems.length === 0 &&
        relevantCompactedDetails.length === 0 ? (
          <p className="context-inspector-note">
            {t('正在读取已移出内容…', 'Loading removed messages…')}
          </p>
        ) : excludedItems.length === 0 && relevantCompactedDetails.length === 0 ? (
          <p className="context-inspector-note">
            {t(
              '当前对话没有被移出或概括的消息，所有历史消息均已完整带入。',
              'No messages have been summarized or left out yet — full conversation history is included.',
            )}
          </p>
        ) : (
          <div className="context-removed-groups">
            {excludedItems.length > 0 && (
              <div className="context-removed-group">
                <div className="context-removed-group-head">
                  <span>
                    {t(
                      `本次窗口未带入的消息 (${excludedItems.length})`,
                      `Left out of this call (${excludedItems.length})`,
                    )}
                  </span>
                </div>
                <div className="context-removed-item-list">
                  {excludedItems.map((item, idx) => (
                    <RemovedItemCard
                      key={`${item.blobId}-${idx}`}
                      item={item}
                      origin="trimmed"
                      defaultExpanded={isRemovedFocused && idx === 0}
                    />
                  ))}
                </div>
              </div>
            )}

            {relevantCompactedDetails.map((eventDetail) => (
              <div key={eventDetail.id} className="context-removed-group">
                <div className="context-removed-group-head">
                  <span>
                    {t(
                      `已概括归档的早期消息 (${eventDetail.removed.length})`,
                      `Summarized & archived (${eventDetail.removed.length})`,
                    )}
                  </span>
                  <span className="context-removed-group-meta">
                    {eventDetail.summarizedByModel
                      ? t('模型概括', 'Model summary')
                      : t('自动摘录', 'Structured summary')}
                  </span>
                </div>
                {eventDetail.summary && (
                  <div
                    className="context-compacted-summary"
                    data-testid="context-compacted-summary"
                  >
                    <div className="context-compacted-summary-label">
                      {t('替代摘要（已带入上下文）', 'Replacing summary (included in context)')}
                    </div>
                    <pre className="context-removed-item-body">
                      {eventDetail.summary.content}
                    </pre>
                  </div>
                )}
                <div className="context-removed-item-list">
                  {eventDetail.removed.map((item, idx) => (
                    <RemovedItemCard
                      key={`${eventDetail.id}-${item.blobId}-${idx}`}
                      item={item}
                      origin="compacted"
                      defaultExpanded={isRemovedFocused && idx === 0}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
