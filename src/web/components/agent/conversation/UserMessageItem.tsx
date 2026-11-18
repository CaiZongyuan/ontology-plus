import React, { useState } from 'react';
import { CornerDownRight } from 'lucide-react';
import {
  PROJECT_STEP_NAMES,
  checkBusinessViewMarkup,
  sanitizeBusinessText,
} from '../../../../packages/business-vocabulary/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { LocalImageThumbnail } from '../VisionAttachmentControls.js';
import type { AgentRunView } from '../agentRun.js';

const USER_MESSAGE_CLAMP_CHARS = 280;

export interface UserMessageItemProps {
  run: AgentRunView;
  isLatestTurn: boolean;
  /** Optional action bar slot for #81 (latest-user-message-only edit & retry). */
  actionsSlot?: React.ReactNode;
}

/**
 * Renders the user's side of a conversation turn in desktop chat presentation (ADR 0009, amended).
 * Owned by Wave 2 #81 for latest-user-message-only edit & retry actions.
 */
export function UserMessageItem({
  run,
  isLatestTurn,
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

      {actionsSlot && (
        <div className="conversation-user-actions" data-testid="conversation-user-actions">
          {actionsSlot}
        </div>
      )}
    </div>
  );
}
