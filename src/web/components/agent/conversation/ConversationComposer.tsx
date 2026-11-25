import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, ImagePlus, Quote, Send, Sheet, Square, X } from 'lucide-react';
import type { AgentImageAttachmentRef } from '../../../../packages/workspace-store/index.js';
import { usePreferences } from '../../../i18n.js';
import {
  extractClipboardImageFiles,
  type ClipboardLikeData,
} from '../../../lib/localImageStore.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../beautifui/index.js';
import {
  LocalImageThumbnail,
  VisionCapabilityBanner,
  ingestClipboardOrSelectedImages,
} from '../VisionAttachmentControls.js';
import { summarizeTable, tableChipLabel } from './tableAttachment.js';
import type { LocalizedText } from '../agentRun.js';
import {
  appendUniqueQuote,
  composePromptWithQuotes,
  readWindowQuotableSelection,
  summarizeQuoteChipLabel,
  type ActiveQuotableSelection,
} from './quotedSelection.js';
import './composer-actions.css';

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
  quotes?: readonly string[];
  onQuotesChange?: (nextQuotes: string[]) => void;
  attachments?: AgentImageAttachmentRef[];
  onAttachmentsChange?: (nextAttachments: AgentImageAttachmentRef[]) => void;
  onSubmitPrompt?: (
    prompt: string,
    attachments?: AgentImageAttachmentRef[],
  ) => void | Promise<void>;
  onAfterSubmit?: () => void;
  onCancelActiveRun?: () => void;
  placeholder?: LocalizedText;
  disabled?: boolean;
  runningCount: number;
  headerSlot?: React.ReactNode;
  /** Reserved slot next to Stop/Send in the bottom-right action bar for Wave 3 (#82) Context Occupancy Ring. */
  rightAccessorySlot?: React.ReactNode;
  queuedPrompts?: ConversationQueuedPrompt[];
  onRemoveQueuedPrompt?: (queueId: string) => void;
  visionSupported?: boolean;
  visionProviderLabel?: string;
  visionModelLabel?: string;
  onOpenPlatformSettings?: () => void;
  onOpenLlmCenter?: () => void;
  suppressVisionBanner?: boolean;
  enableSelectionQuote?: boolean;
  /** Lets the person attach a table; its header, column types and first rows go with the message. */
  acceptTables?: boolean;
}

export interface SelectionQuotePortalProps {
  enabled: boolean;
  onQuoteText: (text: string) => void;
}

/**
 * Shared floating "引用到对话 / Quote in reply" portal button watching document selection
 * across assistant replies and step canvases (both split desktop and <1280px compact canvas pane).
 */
export function SelectionQuotePortal({ enabled, onQuoteText }: SelectionQuotePortalProps) {
  const { t } = usePreferences();
  const [activeSelection, setActiveSelection] = useState<ActiveQuotableSelection | null>(null);

  const syncWindowSelection = useCallback(() => {
    if (!enabled) {
      setActiveSelection(null);
      return;
    }
    setActiveSelection(readWindowQuotableSelection());
  }, [enabled]);

  useEffect(() => {
    if (typeof document === 'undefined' || !enabled) {
      setActiveSelection(null);
      return;
    }
    const handleSelectionChange = () => syncWindowSelection();
    const handleDismissOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveSelection(null);
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('mouseup', handleSelectionChange);
    document.addEventListener('keyup', handleSelectionChange);
    window.addEventListener('scroll', handleSelectionChange, true);
    window.addEventListener('resize', handleSelectionChange);
    window.addEventListener('keydown', handleDismissOnEscape);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('mouseup', handleSelectionChange);
      document.removeEventListener('keyup', handleSelectionChange);
      window.removeEventListener('scroll', handleSelectionChange, true);
      window.removeEventListener('resize', handleSelectionChange);
      window.removeEventListener('keydown', handleDismissOnEscape);
    };
  }, [enabled, syncWindowSelection]);

  if (!activeSelection || typeof document === 'undefined' || !document.body) {
    return null;
  }

  const handleClick = () => {
    const selectedText = activeSelection.text;
    setActiveSelection(null);
    if (typeof window !== 'undefined') {
      try {
        window.getSelection()?.removeAllRanges();
      } catch {
        // Ignore selection clear errors
      }
    }
    onQuoteText(selectedText);
  };

  return createPortal(
    <button
      type="button"
      className="selection-quote-floating-btn"
      data-testid="selection-quote-btn"
      style={{
        top: `${activeSelection.top}px`,
        left: `${activeSelection.left}px`,
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={handleClick}
    >
      <Quote size={12} aria-hidden="true" />
      <span>{t('引用到对话', 'Quote in reply')}</span>
    </button>,
    document.body,
  );
}

/**
 * Composer footer for the continuous desktop conversation stream (#81).
 * Supports per-session draft + quote chips, floating canvas/reply quote insertion,
 * paste/drag-and-drop/picker image attachments, queued prompt withdrawal, and active run Stop.
 */
export function ConversationComposer({
  draft,
  onDraftChange,
  quotes: controlledQuotes,
  onQuotesChange,
  attachments: controlledAttachments,
  onAttachmentsChange,
  onSubmitPrompt,
  onAfterSubmit,
  onCancelActiveRun,
  placeholder,
  disabled = false,
  runningCount,
  headerSlot,
  rightAccessorySlot,
  queuedPrompts,
  onRemoveQueuedPrompt,
  visionSupported = true,
  visionProviderLabel,
  visionModelLabel,
  onOpenPlatformSettings,
  onOpenLlmCenter,
  suppressVisionBanner = false,
  enableSelectionQuote = true,
  acceptTables = false,
}: ConversationComposerProps) {
  const { t, locale } = usePreferences();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableInputRef = useRef<HTMLInputElement>(null);

  const [internalQuotes, setInternalQuotes] = useState<string[]>([]);
  const [internalAttachments, setInternalAttachments] = useState<AgentImageAttachmentRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const effectiveQuotes = controlledQuotes ?? internalQuotes;
  const setQuotes = useCallback(
    (next: string[]) => {
      if (controlledQuotes === undefined) {
        setInternalQuotes(next);
      }
      onQuotesChange?.(next);
    },
    [controlledQuotes, onQuotesChange],
  );

  const effectiveAttachments = controlledAttachments ?? internalAttachments;
  const setAttachments = useCallback(
    (next: AgentImageAttachmentRef[]) => {
      if (controlledAttachments === undefined) {
        setInternalAttachments(next);
      }
      onAttachmentsChange?.(next);
    },
    [controlledAttachments, onAttachmentsChange],
  );

  const handleQuoteSelection = useCallback(
    (selectedText: string) => {
      const nextQuotes = appendUniqueQuote(effectiveQuotes, selectedText);
      setQuotes(nextQuotes);
      textareaRef.current?.focus();
    },
    [effectiveQuotes, setQuotes],
  );

  const handleRemoveQuote = (idx: number) => {
    setQuotes(effectiveQuotes.filter((_, i) => i !== idx));
  };

  const handleIngestFiles = async (files: readonly File[]) => {
    if (files.length === 0 || disabled) return;
    setBusy(true);
    setInlineError(null);
    try {
      const added = await ingestClipboardOrSelectedImages(files, 'user_upload');
      if (added.length > 0) {
        setAttachments([...effectiveAttachments, ...added]);
      }
    } catch {
      setInlineError(
        t(
          '图片无法保存在当前浏览器，请检查浏览器存储空间后重试。',
          'Could not save the image in this browser. Check available storage and try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    void handleIngestFiles(selected);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLElement>) => {
    const files = extractClipboardImageFiles(e.clipboardData as unknown as ClipboardLikeData);
    if (files.length === 0) return;
    e.preventDefault();
    void handleIngestFiles(files);
  };

  const hasDraggedFiles = (dt: React.DragEvent<HTMLElement>['dataTransfer']): boolean => {
    if (!dt) return false;
    const types = Array.from(dt.types ?? []);
    if (types.includes('Files')) return true;
    return extractClipboardImageFiles(dt as unknown as ClipboardLikeData).length > 0;
  };

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (disabled || !hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLElement>) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    if (disabled) return;
    const files = extractClipboardImageFiles(e.dataTransfer as unknown as ClipboardLikeData);
    setDragOver(false);
    if (files.length === 0) return;
    e.preventDefault();
    void handleIngestFiles(files);
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments(effectiveAttachments.filter((att) => att.id !== id));
  };

  const canSend =
    !disabled &&
    !busy &&
    (draft.trim().length > 0 || effectiveQuotes.length > 0 || effectiveAttachments.length > 0);

  if (!onSubmitPrompt && (!queuedPrompts || queuedPrompts.length === 0)) {
    return null;
  }

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!onSubmitPrompt || disabled || busy) return;
    const finalPrompt = composePromptWithQuotes(effectiveQuotes, draft);
    const submittedAttachments = [...effectiveAttachments];
    if (!finalPrompt && submittedAttachments.length === 0) return;

    onDraftChange('');
    setQuotes([]);
    setAttachments([]);
    setInlineError(null);
    onAfterSubmit?.();
    if (submittedAttachments.length > 0) {
      void onSubmitPrompt(finalPrompt, submittedAttachments);
    } else {
      void onSubmitPrompt(finalPrompt);
    }
  };

  return (
    <>
      <SelectionQuotePortal
        enabled={Boolean(enableSelectionQuote && onSubmitPrompt && !disabled)}
        onQuoteText={handleQuoteSelection}
      />
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

        {!suppressVisionBanner && !visionSupported && effectiveAttachments.length > 0 && (
          <VisionCapabilityBanner
            visionSupported={false}
            {...(visionProviderLabel ? { providerLabel: visionProviderLabel } : {})}
            {...(visionModelLabel ? { modelLabel: visionModelLabel } : {})}
            {...(onOpenPlatformSettings ? { onOpenPlatformSettings } : {})}
            {...(onOpenLlmCenter ? { onOpenLlmCenter } : {})}
          />
        )}

        {onSubmitPrompt && (
          <form
            className={cn('agent-panel-composer-form', dragOver && 'is-drag-over')}
            onSubmit={handleSubmit}
            onPaste={handlePaste}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              disabled={disabled || busy}
              data-testid="composer-image-input"
              onChange={onFileInputChange}
            />

            {effectiveQuotes.length > 0 && (
              <div className="composer-quote-list" data-testid="composer-quote-list">
                {effectiveQuotes.map((quote, idx) => (
                  <span
                    key={`${idx}-${quote.slice(0, 24)}`}
                    className="composer-quote-chip"
                    data-testid="composer-quote-chip"
                    title={quote}
                  >
                    {tableChipLabel(quote) ? (
                      <Sheet size={11} className="composer-quote-chip-icon" aria-hidden="true" />
                    ) : (
                      <Quote size={11} className="composer-quote-chip-icon" aria-hidden="true" />
                    )}
                    <span className="composer-quote-chip-text">
                      {tableChipLabel(quote) ?? summarizeQuoteChipLabel(quote)}
                    </span>
                    <button
                      type="button"
                      className="composer-quote-chip-remove"
                      data-testid="composer-quote-remove-btn"
                      aria-label={t('移除引用片段', 'Remove quoted snippet')}
                      onClick={() => handleRemoveQuote(idx)}
                    >
                      <X size={11} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {effectiveAttachments.length > 0 && (
              <div
                className="vision-attachment-strip composer-image-strip"
                data-testid="composer-image-strip"
              >
                {effectiveAttachments.map((att) => (
                  <LocalImageThumbnail
                    key={att.id}
                    attachment={att}
                    {...(!disabled ? { onRemove: handleRemoveAttachment } : {})}
                    compact
                  />
                ))}
              </div>
            )}

            {inlineError && (
              <p className="composer-inline-error" role="alert">
                {inlineError}
              </p>
            )}

            <textarea
              ref={textareaRef}
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
              <div className="composer-actions-left">
                <button
                  type="button"
                  className="composer-attach-btn"
                  data-testid="composer-attach-image-btn"
                  disabled={disabled || busy}
                  aria-label={t('添加图片', 'Attach image')}
                  title={t(
                    '添加图片（支持粘贴截图或拖拽文件）',
                    'Attach image (paste screenshot or drag & drop)',
                  )}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus size={14} aria-hidden="true" />
                </button>
                {acceptTables ? (
                  <>
                    <button
                      type="button"
                      className="composer-attach-btn"
                      data-testid="composer-attach-table-btn"
                      disabled={disabled || busy}
                      aria-label={t('附带表格', 'Attach a table')}
                      title={t('附带表格：AI 会读表头、各列类型和前几行', 'Attach a table: the AI reads its header, column types and first rows')}
                      onClick={() => tableInputRef.current?.click()}
                    >
                      <Sheet size={14} aria-hidden="true" />
                    </button>
                    <input
                      ref={tableInputRef}
                      type="file"
                      accept=".csv,.tsv,text/csv"
                      hidden
                      data-testid="composer-table-input"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        void file.text().then((content) => {
                          const summary = summarizeTable(file.name, content, locale === 'en-US' ? 'en-US' : 'zh-CN');
                          if (!summary) {
                            setInlineError(t('没读出表头和数据行（只支持逗号分隔的表格，最大 1 MB）。', 'No header and rows could be read (comma-separated tables up to 1 MB only).'));
                            return;
                          }
                          setInlineError(null);
                          setQuotes([...effectiveQuotes, summary.text]);
                        });
                      }}
                    />
                  </>
                ) : null}
                <span className="agent-panel-composer-hint">
                  {runningCount > 0
                    ? t(
                        '当前有正在执行的请求，新消息会自动排队',
                        'Request in progress — new messages queue automatically',
                      )
                    : t('Enter 发送 · Shift+Enter 换行', 'Enter to send · Shift+Enter newline')}
                </span>
              </div>

              <div className="composer-actions-right">
                {rightAccessorySlot}
                {runningCount > 0 && onCancelActiveRun && (
                  <button
                    type="button"
                    className="composer-stop-btn"
                    data-testid="composer-stop-btn"
                    aria-label={t('停止当前生成', 'Stop active run')}
                    onClick={onCancelActiveRun}
                  >
                    <Square size={11} aria-hidden="true" />
                    <span>{t('停止', 'Stop')}</span>
                  </button>
                )}
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
            </div>
          </form>
        )}
      </footer>
    </>
  );
}
