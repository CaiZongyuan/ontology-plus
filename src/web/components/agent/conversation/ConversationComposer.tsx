import React from 'react';
import { Clock, Send, X } from 'lucide-react';
import { usePreferences } from '../../../i18n.js';
import { Button } from '../../beautifui/index.js';
import type { LocalizedText } from '../agentRun.js';

export interface ConversationQueuedPrompt {
  id: string;
  label: string;
}

export function shouldSubmitConversationKey(event: {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
}): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing;
}

export interface ConversationComposerProps {
  draft: string;
  onDraftChange: (next: string) => void;
  onSubmitPrompt?: (prompt: string) => void | Promise<void>;
  onAfterSubmit?: () => void;
  placeholder?: LocalizedText;
  disabled?: boolean;
  runningCount: number;
  headerSlot?: React.ReactNode;
  queuedPrompts?: ConversationQueuedPrompt[];
  onRemoveQueuedPrompt?: (queueId: string) => void;
}

/**
 * Composer footer for the continuous desktop conversation stream.
 * Owned by Wave 2 #81 for per-session draft store, stop button, queued prompts strip,
 * selection quote insertion, and paste/drag vision attachments.
 */
export function ConversationComposer({
  draft,
  onDraftChange,
  onSubmitPrompt,
  onAfterSubmit,
  placeholder,
  disabled = false,
  runningCount,
  headerSlot,
  queuedPrompts,
  onRemoveQueuedPrompt,
}: ConversationComposerProps) {
  const { t } = usePreferences();
  const canSend = !disabled && draft.trim().length > 0;

  if (!onSubmitPrompt && (!queuedPrompts || queuedPrompts.length === 0)) {
    return null;
  }

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = draft.trim();
    if (!onSubmitPrompt || disabled || !trimmed) return;
    onDraftChange('');
    onAfterSubmit?.();
    void onSubmitPrompt(trimmed);
  };

  return (
    <footer className="agent-panel-composer" data-testid="agent-panel-composer">
      {queuedPrompts && queuedPrompts.length > 0 && (
        <div className="agent-panel-queue" data-testid="agent-panel-queue">
          <div className="agent-panel-queue-head">
            <Clock size={12} aria-hidden="true" />
            <span>
              {t(`排队中 (${queuedPrompts.length})`, `Queued (${queuedPrompts.length})`)}
            </span>
          </div>
          <ul className="agent-panel-queue-list">
            {queuedPrompts.map((item) => (
              <li key={item.id} className="agent-panel-queue-item">
                <span className="agent-panel-queue-label">{item.label}</span>
                {onRemoveQueuedPrompt && (
                  <button
                    type="button"
                    className="agent-panel-queue-remove"
                    data-testid="agent-panel-queue-remove-btn"
                    aria-label={t('移出队列', 'Remove from queue')}
                    onClick={() => onRemoveQueuedPrompt(item.id)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {headerSlot && (
        <div className="agent-panel-composer-slot" data-testid="agent-panel-composer-slot">
          {headerSlot}
        </div>
      )}

      {onSubmitPrompt && (
        <form className="agent-panel-composer-form" onSubmit={handleSubmit}>
          <textarea
            className="agent-panel-composer-input"
            data-testid="agent-panel-composer-input"
            rows={2}
            value={draft}
            disabled={disabled}
            placeholder={
              placeholder
                ? t(placeholder.zh, placeholder.en)
                : t(
                    '输入你的想法或修改需求（Enter 发送，Shift+Enter 换行）…',
                    'Describe what you want to change (Enter to send, Shift+Enter for newline)…',
                  )
            }
            aria-label={t('向 AI 助手提问', 'Message AI Assistant')}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (
                shouldSubmitConversationKey({
                  key: e.key,
                  shiftKey: e.shiftKey,
                  isComposing: e.nativeEvent.isComposing,
                })
              ) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <div className="agent-panel-composer-actions">
            <span className="agent-panel-composer-hint">
              {runningCount > 0
                ? t(
                    '当前有正在执行的请求，新消息会自动排队',
                    'Request in progress — new messages queue automatically',
                  )
                : t('Enter 发送 · Shift+Enter 换行', 'Enter to send · Shift+Enter newline')}
            </span>
            <Button
              type="submit"
              variant="accent"
              size="xs"
              data-testid="agent-panel-send-btn"
              disabled={!canSend}
            >
              <Send size={12} aria-hidden="true" />
              {runningCount > 0 ? t('排队发送', 'Queue') : t('发送', 'Send')}
            </Button>
          </div>
        </form>
      )}
    </footer>
  );
}
