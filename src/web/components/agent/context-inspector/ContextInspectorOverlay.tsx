import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { BUSINESS_VOCABULARY } from '../../../../packages/business-vocabulary/index.js';
import type {
  ContextEventDetail,
  ContextEventSummary,
  ModelCallDetail,
  ModelCallSummary,
} from '../../../../packages/workspace-store/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_WIDE_CSS_WIDTH,
} from '../agentPanelStore.js';
import { ContextBrowser } from './ContextBrowser.js';
import { ContextCompositionBar } from './ContextCompositionBar.js';
import {
  ContextEventsList,
  type ContextEventFilterKind,
  type ContextInspectorRunTrace,
} from './ContextEventsList.js';
import {
  ModelCallTimeline,
  type ModelCallTimelineMode,
} from './ModelCallTimeline.js';
import { SubagentLanesPanel } from './SubagentLanesPanel.js';
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

export function resolveSelectedModelCall(
  modelCalls: readonly ModelCallSummary[],
  selectedCallId: string | null | undefined,
  fallbackCall: ModelCallSummary | null,
): ModelCallSummary | null {
  if (selectedCallId) {
    const matched = modelCalls.find((c) => c.id === selectedCallId);
    if (matched) return matched;
  }
  if (fallbackCall) {
    const matchedFallback = modelCalls.find((c) => c.id === fallbackCall.id);
    return matchedFallback ?? fallbackCall;
  }
  return modelCalls[modelCalls.length - 1] ?? null;
}

export function resolveOverlayOffsetStyle(opts: {
  side: 'left' | 'right';
  panelWidth: number;
  wideMode: boolean;
  overlay: boolean;
  fullWidth?: boolean;
}): React.CSSProperties {
  if (opts.overlay || opts.fullWidth) {
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

export interface ContextInspectorOverlayProps {
  open: boolean;
  onClose: () => void;
  focus?: ContextInspectorFocus;
  side?: 'left' | 'right';
  panelWidth?: number;
  wideMode?: boolean;
  overlay?: boolean;
  /** True when AgentPanel occupies full width in compact (<1280px) workspace mode. */
  fullWidth?: boolean;
  projectId?: string;
  latestCall?: ModelCallSummary | null;
  modelCalls?: readonly ModelCallSummary[];
  contextEvents?: readonly ContextEventSummary[];
  runs?: readonly ContextInspectorRunTrace[];
  defaultContextWindow?: number;
  /** Controlled / initial selected Model Call ID (exposed cleanly for Wave 4 #83 & Wave 5 #84). */
  selectedCallId?: string | null;
  defaultSelectedCallId?: string | null;
  onSelectCallId?: (callId: string) => void;
  /** Optional timeline mode control for deterministic SSR tests. */
  timelineMode?: ModelCallTimelineMode;
  defaultTimelineMode?: ModelCallTimelineMode;
  onTimelineModeChange?: (mode: ModelCallTimelineMode) => void;
  /** Optional event filter control for deterministic SSR tests (#84). */
  eventFilter?: ContextEventFilterKind;
  defaultEventFilter?: ContextEventFilterKind;
  onEventFilterChange?: (filter: ContextEventFilterKind) => void;
  /** Optional pre-supplied call details keyed by callId (for synchronous SSR tests). */
  callDetailsById?: Readonly<Record<string, ModelCallDetail>>;
  /** Optional pre-loaded call detail (used by deterministic SSR tests from #82). */
  latestCallDetail?: ModelCallDetail | null;
  /** Optional pre-loaded compaction event details (used by deterministic SSR tests). */
  compactedEventDetails?: readonly ContextEventDetail[];
  /** Optional item keys (`blobId`, `label`, or `'*'`) expanded on initial render in ContextBrowser. */
  defaultExpandedItemKeys?: readonly string[];
  /** Modular Wave 4 (#83) & Wave 5 (#84) extension slots. */
  timelineSlot?: React.ReactNode;
  eventsSlot?: React.ReactNode;
  lanesSlot?: React.ReactNode;
  browserSlot?: React.ReactNode;
}

/**
 * Wide two-column canvas overlay ("对话记忆 / Conversation memory", Prototype Variant B from #77, #82, #83).
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
  fullWidth = false,
  projectId,
  latestCall,
  modelCalls,
  contextEvents,
  runs,
  defaultContextWindow,
  selectedCallId: controlledSelectedCallId,
  defaultSelectedCallId = null,
  onSelectCallId,
  timelineMode,
  defaultTimelineMode,
  onTimelineModeChange,
  eventFilter,
  defaultEventFilter,
  onEventFilterChange,
  callDetailsById,
  latestCallDetail: controlledCallDetail,
  compactedEventDetails: controlledCompactedDetails,
  defaultExpandedItemKeys,
  timelineSlot,
  eventsSlot,
  lanesSlot,
  browserSlot,
}: ContextInspectorOverlayProps) {
  const { t } = usePreferences();

  const effectiveLatestCall = useMemo(
    () => latestCall ?? resolveLatestTurnModelCall(modelCalls),
    [latestCall, modelCalls],
  );

  const effectiveModelCalls = useMemo<readonly ModelCallSummary[]>(() => {
    if (modelCalls && modelCalls.length > 0) return modelCalls;
    return effectiveLatestCall ? [effectiveLatestCall] : [];
  }, [modelCalls, effectiveLatestCall]);

  const [internalSelectedCallId, setInternalSelectedCallId] = useState<string | null>(
    defaultSelectedCallId,
  );

  useEffect(() => {
    if (!open && controlledSelectedCallId === undefined) {
      setInternalSelectedCallId(defaultSelectedCallId);
    }
  }, [open, controlledSelectedCallId, defaultSelectedCallId]);

  const activeSelectedCallId =
    controlledSelectedCallId !== undefined
      ? controlledSelectedCallId
      : internalSelectedCallId;

  const selectedCall = useMemo(
    () =>
      resolveSelectedModelCall(
        effectiveModelCalls,
        activeSelectedCallId,
        effectiveLatestCall,
      ),
    [effectiveModelCalls, activeSelectedCallId, effectiveLatestCall],
  );

  const handleSelectCallId = (callId: string) => {
    if (controlledSelectedCallId === undefined) {
      setInternalSelectedCallId(callId);
    }
    onSelectCallId?.(callId);
  };

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

  if (!open) return null;

  const offsetStyle = resolveOverlayOffsetStyle({
    side,
    panelWidth,
    wideMode,
    overlay,
    fullWidth,
  });

  const title = t(
    BUSINESS_VOCABULARY.CONTEXT_INSPECTOR.zh,
    BUSINESS_VOCABULARY.CONTEXT_INSPECTOR.en,
  );

  const isLatestSelected = Boolean(
    selectedCall && effectiveLatestCall && selectedCall.id === effectiveLatestCall.id,
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
            {timelineSlot !== undefined ? (
              timelineSlot
            ) : (
              <ModelCallTimeline
                modelCalls={effectiveModelCalls}
                selectedCallId={selectedCall?.id ?? null}
                onSelectCall={handleSelectCallId}
                {...(contextEvents !== undefined ? { contextEvents } : {})}
                {...(timelineMode !== undefined ? { mode: timelineMode } : {})}
                {...(defaultTimelineMode !== undefined
                  ? { defaultMode: defaultTimelineMode }
                  : {})}
                {...(onTimelineModeChange !== undefined
                  ? { onModeChange: onTimelineModeChange }
                  : {})}
              />
            )}
            {eventsSlot !== undefined ? (
              eventsSlot
            ) : (
              <ContextEventsList
                modelCalls={effectiveModelCalls}
                selectedCallId={selectedCall?.id ?? null}
                onSelectCall={handleSelectCallId}
                focused={focus === 'events'}
                {...(contextEvents !== undefined ? { contextEvents } : {})}
                {...(runs !== undefined ? { runs } : {})}
                {...(eventFilter !== undefined ? { filter: eventFilter } : {})}
                {...(defaultEventFilter !== undefined
                  ? { defaultFilter: defaultEventFilter }
                  : {})}
                {...(onEventFilterChange !== undefined
                  ? { onFilterChange: onEventFilterChange }
                  : {})}
              />
            )}
            {lanesSlot !== undefined ? (
              lanesSlot
            ) : (
              <SubagentLanesPanel
                modelCalls={effectiveModelCalls}
                selectedCallId={selectedCall?.id ?? null}
                onSelectCall={handleSelectCallId}
                focused={focus === 'lanes'}
                {...(runs !== undefined ? { runs } : {})}
              />
            )}
          </div>

          <div
            className="context-inspector-right-col"
            data-testid="context-inspector-right-col"
          >
            {browserSlot !== undefined ? (
              browserSlot
            ) : (
              <ContextBrowser
                {...(projectId !== undefined ? { projectId } : {})}
                selectedCall={selectedCall}
                isLatestSelected={isLatestSelected}
                focus={focus}
                {...(contextEvents !== undefined ? { contextEvents } : {})}
                {...(callDetailsById !== undefined ? { callDetailsById } : {})}
                {...(controlledCallDetail !== undefined
                  ? { fallbackCallDetail: controlledCallDetail }
                  : {})}
                {...(controlledCompactedDetails !== undefined
                  ? { compactedEventDetails: controlledCompactedDetails }
                  : {})}
                {...(defaultExpandedItemKeys !== undefined
                  ? { defaultExpandedItemKeys }
                  : {})}
              />
            )}
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
