import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { BUSINESS_VOCABULARY } from '../../../../packages/business-vocabulary/index.js';
import type {
  ContextEventDetail,
  ContextEventSummary,
  ContextItem,
  ContextItemKind,
  ModelCallDetail,
  ModelCallSummary,
} from '../../../../packages/workspace-store/index.js';
import { apiGetContextEvent, apiGetModelCall } from '../../../api.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_WIDE_CSS_WIDTH,
} from '../agentPanelStore.js';
import {
  ContextCompositionBar,
  formatTokenCount,
} from './ContextCompositionBar.js';
import './context-inspector.css';

export const CONTEXT_INSPECTOR_DRAWER_TEST_ID = 'context-inspector-drawer' as const;

export type ContextInspectorFocus =
  | 'composition'
  | 'removed'
  | 'calls'
  | 'events'
  | 'lanes';

export function resolveLatestTurnModelCall(
  modelCalls?: readonly ModelCallSummary[],
): ModelCallSummary | null {
  if (!modelCalls || modelCalls.length === 0) return null;
  for (let i = modelCalls.length - 1; i >= 0; i -= 1) {
    if (modelCalls[i]!.purpose === 'TURN') {
      return modelCalls[i]!;
    }
  }
  return modelCalls[modelCalls.length - 1] ?? null;
}

export function resolveOverlayOffsetStyle(opts: {
  side: 'left' | 'right';
  panelWidth: number;
  wideMode: boolean;
  overlay: boolean;
}): React.CSSProperties {
  if (opts.overlay) {
    return { left: '0px', right: '0px' };
  }
  const offsetCss = opts.wideMode ? AGENT_PANEL_WIDE_CSS_WIDTH : `${opts.panelWidth}px`;
  return opts.side === 'left'
    ? { left: offsetCss, right: '0px' }
    : { left: '0px', right: offsetCss };
}

export function shouldDismissContextInspectorKey(event: { key: string }): boolean {
  return event.key === 'Escape';
}

function formatContextItemKindLabel(
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

  const firstLine =
    item.label ||
    item.content
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 72) ||
    t('（空内容）', '(empty)');

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
          {formatContextItemKindLabel(item.kind, t)}
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

export interface ContextInspectorOverlayProps {
  open: boolean;
  onClose: () => void;
  focus?: ContextInspectorFocus;
  side?: 'left' | 'right';
  panelWidth?: number;
  wideMode?: boolean;
  overlay?: boolean;
  projectId?: string;
  latestCall?: ModelCallSummary | null;
  modelCalls?: readonly ModelCallSummary[];
  contextEvents?: readonly ContextEventSummary[];
  defaultContextWindow?: number;
  /** Optional pre-loaded call detail (used by deterministic SSR tests or Wave 4 selection). */
  latestCallDetail?: ModelCallDetail | null;
  /** Optional pre-loaded compaction event details (used by deterministic SSR tests). */
  compactedEventDetails?: readonly ContextEventDetail[];
  /** Modular Wave 4 (#83) & Wave 5 (#84) extension slots. */
  timelineSlot?: React.ReactNode;
  eventsSlot?: React.ReactNode;
  lanesSlot?: React.ReactNode;
  browserSlot?: React.ReactNode;
}

/**
 * Wide two-column canvas overlay ("对话记忆 / Conversation memory", Prototype Variant B from #77, #82).
 * Overlays ONLY the canvas area beside AgentPanel so conversation stays visible and canvas width never squeezes.
 */
export function ContextInspectorOverlay({
  open,
  onClose,
  focus = 'composition',
  side = 'left',
  panelWidth = AGENT_PANEL_DEFAULT_WIDTH,
  wideMode = false,
  overlay = false,
  projectId,
  latestCall,
  modelCalls,
  contextEvents,
  defaultContextWindow,
  latestCallDetail: controlledCallDetail,
  compactedEventDetails: controlledCompactedDetails,
  timelineSlot,
  eventsSlot,
  lanesSlot,
  browserSlot,
}: ContextInspectorOverlayProps) {
  const { t } = usePreferences();
  const removedSectionRef = useRef<HTMLElement>(null);

  const effectiveLatestCall = useMemo(
    () => latestCall ?? resolveLatestTurnModelCall(modelCalls),
    [latestCall, modelCalls],
  );

  const compactEventSummaries = useMemo(
    () => (contextEvents ?? []).filter((e) => e.kind === 'COMPACT'),
    [contextEvents],
  );
  const compactIdsKey = compactEventSummaries.map((e) => e.id).join(',');

  const [fetchedCallDetail, setFetchedCallDetail] = useState<ModelCallDetail | null>(null);
  const [fetchedCompactedDetails, setFetchedCompactedDetails] = useState<ContextEventDetail[]>(
    [],
  );
  const [loadingRemoved, setLoadingRemoved] = useState(false);

  // Fetch latest call detail (when excludedCount > 0) and COMPACT event details when overlay opens
  useEffect(() => {
    if (!open || !projectId || typeof fetch !== 'function') return;
    if (controlledCallDetail !== undefined && controlledCompactedDetails !== undefined) return;

    let cancelled = false;
    const shouldFetchCall =
      controlledCallDetail === undefined &&
      Boolean(effectiveLatestCall && effectiveLatestCall.hasDetail && effectiveLatestCall.excludedCount > 0);
    const shouldFetchEvents =
      controlledCompactedDetails === undefined && compactEventSummaries.length > 0;

    if (!shouldFetchCall && !shouldFetchEvents) {
      setFetchedCallDetail(null);
      setFetchedCompactedDetails([]);
      setLoadingRemoved(false);
      return;
    }

    setLoadingRemoved(true);
    void Promise.all([
      shouldFetchCall && effectiveLatestCall
        ? apiGetModelCall(projectId, effectiveLatestCall.id)
            .then((res) => res.modelCall)
            .catch(() => null)
        : Promise.resolve(null),
      shouldFetchEvents
        ? Promise.all(
            compactEventSummaries.map((ev) =>
              apiGetContextEvent(projectId, ev.id)
                .then((res) => res.contextEvent)
                .catch(() => null),
            ),
          ).then((list) => list.filter((item): item is ContextEventDetail => item !== null))
        : Promise.resolve([]),
    ]).then(([callDet, eventDets]) => {
      if (cancelled) return;
      if (controlledCallDetail === undefined) setFetchedCallDetail(callDet);
      if (controlledCompactedDetails === undefined) setFetchedCompactedDetails(eventDets);
      setLoadingRemoved(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    projectId,
    effectiveLatestCall?.id,
    effectiveLatestCall?.excludedCount,
    compactIdsKey,
    controlledCallDetail,
    controlledCompactedDetails,
  ]);

  // Dismiss on Escape without collapsing underlying AgentPanel overlay
  useEffect(() => {
    if (!open || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldDismissContextInspectorKey(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (open && focus === 'removed') {
      removedSectionRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [open, focus]);

  if (!open) return null;

  const resolvedCallDetail =
    controlledCallDetail !== undefined ? controlledCallDetail : fetchedCallDetail;
  const resolvedCompactedDetails =
    controlledCompactedDetails !== undefined
      ? controlledCompactedDetails
      : fetchedCompactedDetails;

  const excludedItems: readonly ContextItem[] = resolvedCallDetail?.excluded ?? [];
  const totalCompactedCount =
    resolvedCompactedDetails.length > 0
      ? resolvedCompactedDetails.reduce((sum, d) => sum + d.removed.length, 0)
      : compactEventSummaries.reduce((sum, s) => sum + s.removedCount, 0);
  const totalRemovedCount = excludedItems.length + totalCompactedCount;
  const isRemovedFocused = focus === 'removed';

  const offsetStyle = resolveOverlayOffsetStyle({
    side,
    panelWidth,
    wideMode,
    overlay,
  });

  const title = t(
    BUSINESS_VOCABULARY.CONTEXT_INSPECTOR.zh,
    BUSINESS_VOCABULARY.CONTEXT_INSPECTOR.en,
  );

  const node = (
    <div
      className={cn('context-inspector-root', side === 'right' && 'is-right')}
      data-testid={CONTEXT_INSPECTOR_DRAWER_TEST_ID}
      data-side={side}
      data-focus={focus}
      style={offsetStyle}
    >
      <section
        className="context-inspector-panel"
        data-testid="context-inspector-panel"
        role="dialog"
        aria-modal="false"
        aria-label={title}
      >
        <header className="context-inspector-head">
          <div className="context-inspector-head-text">
            <h2 className="context-inspector-title" data-testid="context-inspector-title">
              {title}
            </h2>
            <span className="context-inspector-subtitle">
              {t(
                'AI 助手每次回答时实际看到的内容',
                'What the AI Assistant actually saw on each model call',
              )}
            </span>
          </div>
          <button
            type="button"
            className="context-inspector-close-btn"
            data-testid="context-inspector-close-btn"
            aria-label={t('关闭对话记忆', 'Close conversation memory')}
            title={t('关闭', 'Close')}
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>

        <div className="context-inspector-body">
          <div
            className="context-inspector-left-col"
            data-testid="context-inspector-left-col"
          >
            <ContextCompositionBar
              latestCall={effectiveLatestCall}
              {...(defaultContextWindow !== undefined ? { defaultContextWindow } : {})}
            />
            {timelineSlot}
            {eventsSlot}
            {lanesSlot}
          </div>

          <div
            className="context-inspector-right-col"
            data-testid="context-inspector-right-col"
          >
            {browserSlot}
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

              {loadingRemoved &&
              excludedItems.length === 0 &&
              resolvedCompactedDetails.length === 0 ? (
                <p className="context-inspector-note">
                  {t('正在读取已移出内容…', 'Loading removed messages…')}
                </p>
              ) : excludedItems.length === 0 && resolvedCompactedDetails.length === 0 ? (
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
                            `Left out of current reply (${excludedItems.length})`,
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

                  {resolvedCompactedDetails.map((eventDetail) => (
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
        </div>
      </section>

      <div
        className="context-inspector-backdrop"
        data-testid="context-inspector-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(node, document.body);
  }
  return node;
}
