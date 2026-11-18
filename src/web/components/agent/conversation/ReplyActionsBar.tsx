import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import './composer-actions.css';

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to temporary textarea selection copy below
  }
  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'true');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand?.('copy') ?? true;
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}

export interface ReplyActionsBarProps {
  text: string;
}

/**
 * Quiet action bar attached below a completed assistant reply via `ConversationThread.renderReplyActions`
 * without touching `AssistantReplyItem.tsx` (#81).
 */
export function ReplyActionsBar({ text }: ReplyActionsBarProps) {
  const { t } = usePreferences();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleCopy = async () => {
    await copyTextToClipboard(text);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, 1800);
  };

  return (
    <button
      type="button"
      className={cn('conversation-msg-action-btn', copied && 'is-copied')}
      data-testid="reply-copy-btn"
      data-copied={copied ? 'true' : 'false'}
      aria-label={copied ? t('已复制回复内容', 'Copied reply') : t('复制回复内容', 'Copy reply')}
      title={copied ? t('已复制', 'Copied') : t('复制', 'Copy')}
      onClick={() => void handleCopy()}
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      <span>{copied ? t('已复制', 'Copied') : t('复制', 'Copy')}</span>
    </button>
  );
}
