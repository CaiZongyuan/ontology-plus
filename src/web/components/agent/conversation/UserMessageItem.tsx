import React, { useEffect, useState } from 'react';
import { CornerDownRight, Info, Pencil, RotateCcw } from 'lucide-react';
import {
  PROJECT_STEP_NAMES,
  checkBusinessViewMarkup,
  sanitizeBusinessText,
} from '../../../../packages/business-vocabulary/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../beautifui/index.js';
import { LocalImageThumbnail } from '../VisionAttachmentControls.js';
import type { AgentRunView } from '../agentRun.js';
import { shouldSubmitConversationKey } from './ConversationComposer.js';
import './composer-actions.css';

const USER_MESSAGE_CLAMP_CHARS = 280;

export interface UserMessageItemProps {
  run: AgentRunView;
  isLatestTurn: boolean;
  /** True when any run in the conversation is currently streaming/running. */
  sessionRunning?: boolean;
  /** True when latest-turn editing/retrying is supported in this conversation. */
  turnEditingSupported?: boolean;
  /** Initial inline edit state (for deterministic SSR testing). */
  defaultEditing?: boolean;
  /** Replaces the latest turn in session.messages and immediately resends the edited prompt. */
  onEditLatestTurn?: (nextPrompt: string) => void | Promise<void>;
  /** Replaces the latest turn in session.messages and immediately retries the prompt. */
  onRetryLatestTurn?: () => void | Promise<void>;
  /** Optional custom action bar slot. */
  actionsSlot?: React.ReactNode;
}

/**
 * Renders the user's side of a conversation turn in desktop chat presentation (ADR 0009, amended).
 * Edit and Retry are offered ONLY on the latest user message when idle; earlier user messages
 * provide a calm non-blocking explanation pointing to History restore.
 */
export function UserMessageItem({
  run,
  isLatestTurn,
  sessionRunning = false,
  turnEditingSupported,
  defaultEditing = false,
  onEditLatestTurn,
  onRetryLatestTurn,
  actionsSlot,
}: UserMessageItemProps) {
  const { locale, t } = usePreferences();
  const [expanded, setExpanded] = useState(false);

  const rawTitle = t(run.title.zh, run.title.en);
  const safeFallbackTitle =
    checkBusinessViewMarkup(rawTitle, { plainText: true }).length === 0
      ? rawTitle
      : sanitizeBusinessText(rawTitle, locale);
  const displayText = run.userPrompt ?? safeFallbackTitle;
  const isStructuredAction = !run.userPrompt;
  const isLong =
    displayText.length > USER_MESSAGE_CLAMP_CHARS || displayText.split('\n').length > 6;

  const isRunning = sessionRunning || run.status === 'RUNNING';
  const canMutateTurn = isLatestTurn && !isRunning;

  const [editing, setEditing] = useState<boolean>(() => Boolean(defaultEditing && canMutateTurn));
  const [editDraft, setEditDraft] = useState<string>(displayText);
  const [hintPinned, setHintPinned] = useState<boolean>(false);

  useEffect(() => {
    if (!canMutateTurn && editing) {
      setEditing(false);
    }
  }, [canMutateTurn, editing]);

  const handleOpenEdit = () => {
    if (!canMutateTurn || !onEditLatestTurn) return;
    setEditDraft(displayText);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditDraft(displayText);
  };

  const handleSubmitEdit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = editDraft.trim();
    if (!canMutateTurn || !onEditLatestTurn || !trimmed) return;
    setEditing(false);
    void onEditLatestTurn(trimmed);
  };

  const showLatestActions =
    canMutateTurn && !editing && Boolean(onEditLatestTurn || onRetryLatestTurn);
  const showEarlierHint =
    !isLatestTurn &&
    (turnEditingSupported ?? Boolean(onEditLatestTurn || onRetryLatestTurn));

  return (
    <div
      className="conversation-user-turn"
      data-testid="conversation-user-message"
      data-latest-user-turn={isLatestTurn ? 'true' : 'false'}
    >
      {run.handoffFrom && (
        <div
          className="conversation-handoff-origin"
          data-testid="agent-turn-handoff-origin"
        >
          <CornerDownRight size={12} aria-hidden="true" />
          <span>
            {run.handoffFrom.sourceStep
              ? t(
                  `来自「${PROJECT_STEP_NAMES[run.handoffFrom.sourceStep].zh}」步骤的转交请求`,
                  `Handed off from ${PROJECT_STEP_NAMES[run.handoffFrom.sourceStep].en}`,
                )
              : t('跨步骤转交请求', 'Handed-off request')}
          </span>
        </div>
      )}

      {run.images && run.images.length > 0 && (
        <div
          className="vision-attachment-strip agent-run-images"
          data-testid="agent-run-images"
          aria-label={t('参考图附件', 'Attached reference images')}
        >
          {run.images.map((img) => (
            <LocalImageThumbnail key={img.id} attachment={img} compact />
          ))}
        </div>
      )}

      {editing ? (
        <form className="conversation-user-edit-form" onSubmit={handleSubmitEdit}>
          <textarea
            className="conversation-user-edit-input"
            data-testid="user-msg-edit-input"
            rows={3}
            value={editDraft}
            autoFocus
            aria-label={t('编辑最后一条消息', 'Edit latest message')}
            onChange={(e) => setEditDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                handleCancelEdit();
                return;
              }
              if (
                shouldSubmitConversationKey({
                  key: e.key,
                  shiftKey: e.shiftKey,
                  isComposing: e.nativeEvent.isComposing,
                })
              ) {
                e.preventDefault();
                handleSubmitEdit();
              }
            }}
          />
          <div className="conversation-user-edit-actions">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="user-msg-edit-cancel"
              onClick={handleCancelEdit}
            >
              {t('取消', 'Cancel')}
            </Button>
            <Button
              type="submit"
              variant="accent"
              size="xs"
              data-testid="user-msg-edit-submit"
              disabled={!editDraft.trim()}
            >
              {t('重新发送', 'Save & resend')}
            </Button>
          </div>
        </form>
      ) : (
        <div
          className={cn(
            'conversation-user-bubble',
            isStructuredAction && 'is-action',
            isLong && !expanded && 'is-clamped',
          )}
          data-testid="agent-turn-user"
        >
          <p className="conversation-user-text">{displayText}</p>
          {isLong && (
            <button
              type="button"
              className="conversation-user-more"
              aria-expanded={expanded}
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? t('收起', 'Show less') : t('展开全文', 'Show more')}
            </button>
          )}
        </div>
      )}

      {(showLatestActions || actionsSlot) && (
        <div className="conversation-user-actions" data-testid="conversation-user-actions">
          {showLatestActions && onEditLatestTurn && (
            <button
              type="button"
              className="conversation-msg-action-btn"
              data-testid="user-msg-edit-btn"
              onClick={handleOpenEdit}
            >
              <Pencil size={12} aria-hidden="true" />
              <span>{t('编辑', 'Edit')}</span>
            </button>
          )}
          {showLatestActions && onRetryLatestTurn && (
            <button
              type="button"
              className="conversation-msg-action-btn"
              data-testid="user-msg-retry-btn"
              onClick={() => void onRetryLatestTurn()}
            >
              <RotateCcw size={12} aria-hidden="true" />
              <span>{t('重试', 'Retry')}</span>
            </button>
          )}
          {actionsSlot}
        </div>
      )}

      {showEarlierHint && (
        <div className="conversation-earlier-msg-bar">
          <button
            type="button"
            className={cn('conversation-earlier-info-btn', hintPinned && 'is-pinned')}
            aria-expanded={hintPinned}
            aria-label={t('为什么不能编辑此消息', 'Why this message cannot be edited')}
            onClick={() => setHintPinned((prev) => !prev)}
          >
            <Info size={12} aria-hidden="true" />
            <span>{t('历史消息说明', 'History note')}</span>
          </button>
          <p
            className={cn('conversation-earlier-msg-hint', hintPinned && 'is-pinned')}
            data-testid="earlier-msg-locked-hint"
          >
            {t(
              '仅支持编辑最后一条消息；如需回到更早的状态，请在历史记录中使用「恢复到这次变更之前」',
              "Only the latest message can be edited; to return to an earlier state, use 'Restore to before this change' in history",
            )}
          </p>
        </div>
      )}
    </div>
  );
}
