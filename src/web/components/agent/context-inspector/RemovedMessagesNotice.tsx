import React from 'react';
import { History } from 'lucide-react';
import type {
  ContextEventSummary,
  ModelCallSummary,
} from '../../../../packages/workspace-store/index.js';
import { usePreferences } from '../../../i18n.js';
import './context-inspector.css';

export interface RemovedMessagesNoticeState {
  readonly visible: boolean;
  readonly compactedCount: number;
  readonly excludedCount: number;
}

export function resolveRemovedMessagesNoticeState(
  latestCall?: Pick<ModelCallSummary, 'excludedCount'> | null,
  contextEvents?: readonly ContextEventSummary[],
): RemovedMessagesNoticeState {
  const compactedCount = (contextEvents ?? [])
    .filter((event) => event.kind === 'COMPACT')
    .reduce((sum, event) => sum + Math.max(0, event.removedCount), 0);
  const excludedCount = Math.max(0, latestCall?.excludedCount ?? 0);
  return {
    visible: compactedCount > 0 || excludedCount > 0,
    compactedCount,
    excludedCount,
  };
}

export interface RemovedMessagesNoticeProps {
  latestCall?: Pick<ModelCallSummary, 'excludedCount'> | null;
  contextEvents?: readonly ContextEventSummary[];
  onOpenInspector?: (focus: 'removed') => void;
}

/**
 * Single lightweight calm notice row inserted in ConversationThread when earlier messages
 * were summarized by compaction or left out by the session message window (#82, ADR 0014 / 0017).
 * Clicking opens the Context Inspector directly focused on the "已移出 / Removed" section.
 */
export function RemovedMessagesNotice({
  latestCall,
  contextEvents,
  onOpenInspector,
}: RemovedMessagesNoticeProps) {
  const { t } = usePreferences();
  const { visible, compactedCount, excludedCount } = resolveRemovedMessagesNoticeState(
    latestCall,
    contextEvents,
  );
  if (!visible) return null;

  let text: string;
  if (compactedCount > 0 && excludedCount > 0) {
    const compactedUnit = compactedCount === 1 ? 'message' : 'messages';
    text = t(
      `较早的 ${compactedCount} 条消息已概括，另有 ${excludedCount} 条未带入当前回答 · 查看已移出内容`,
      `Earlier ${compactedCount} ${compactedUnit} summarized and ${excludedCount} left out of current reply · View removed messages`,
    );
  } else if (compactedCount > 0) {
    const unit = compactedCount === 1 ? 'message' : 'messages';
    text = t(
      `较早的 ${compactedCount} 条消息已概括 · 查看已移出内容`,
      `Earlier ${compactedCount} ${unit} summarized · View removed messages`,
    );
  } else {
    const unit = excludedCount === 1 ? 'message' : 'messages';
    text = t(
      `较早的 ${excludedCount} 条消息未带入当前回答 · 查看已移出内容`,
      `Earlier ${excludedCount} ${unit} left out of current reply · View removed messages`,
    );
  }

  return (
    <button
      type="button"
      className="conversation-removed-notice"
      data-testid="conversation-removed-notice"
      data-compacted-count={String(compactedCount)}
      data-excluded-count={String(excludedCount)}
      onClick={() => onOpenInspector?.('removed')}
    >
      <History size={13} className="conversation-removed-notice-icon" aria-hidden="true" />
      <span>{text}</span>
    </button>
  );
}
