import React, { useEffect, useRef, useState } from 'react';
import { Clock, PanelRightClose, Send, X } from 'lucide-react';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../beautifui/index.js';
import { AgentRunCard } from './AgentRunCard.js';
import { VisionCapabilityBanner } from './VisionAttachmentControls.js';
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
} from './agentPanelStore.js';
import type { AgentRunView, LocalizedText, PrototypeTargetAnchor } from './agentRun.js';

const RESIZING_BODY_CLASS = 'agent-panel-resizing';
const KEYBOARD_RESIZE_STEP = 16;

export function shouldSubmitComposerKey(event: {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
}): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing;
}

export interface AgentPanelQueuedPrompt {
  id: string;
  label: string;
}

export interface AgentPanelProps {
  /** Name of the Agent Session shown for the module in view. */
  title: LocalizedText;
  /** Oldest first, like a conversation. */
  runs: AgentRunView[];
  width: number;
  /** Overlay presentation for narrow viewports. */
  overlay?: boolean;
  onClose: () => void;
  onResize: (width: number, opts: { commit: boolean }) => void;
  onCancelRun?: (runId: string) => void;
  onRetryRun?: (runId: string) => void;
  onOpenRunArtifact?: (runId: string) => void;
  onOpenLlmCenter?: () => void;
  onHoverAnchor?: (anchor: PrototypeTargetAnchor | null) => void;
  /** Interactive composer submission handler. When supplied, renders the composer footer. */
  onSubmitPrompt?: (prompt: string) => void | Promise<void>;
  composerValue?: string;
  onComposerValueChange?: (value: string) => void;
  composerPlaceholder?: LocalizedText;
  composerDisabled?: boolean;
  /** Optional slot above the textarea for selection chips (#28) or image attachments (#31). */
  composerHeaderSlot?: React.ReactNode;
  /** Prompts queued behind the currently active run on this session. */
  queuedPrompts?: AgentPanelQueuedPrompt[];
  onRemoveQueuedPrompt?: (queueId: string) => void;
  /** Whether the active provider/model supports multimodal vision input (`false` shows explicit fallback banner). */
  visionSupported?: boolean;
  visionProviderLabel?: string;
  /** Fixed clock passed through to the run cards for deterministic rendering. */
  now?: number;
}

/**
 * The single place in the workbench where the user watches agents work (ADR 0009).
 * Purely presentational: the shell decides which session's runs to pass in.
 */
export function AgentPanel({
  title,
  runs,
  width,
  overlay = false,
  onClose,
  onResize,
  onCancelRun,
  onRetryRun,
  onOpenRunArtifact,
  onOpenLlmCenter,
  onHoverAnchor,
  onSubmitPrompt,
  composerValue,
  onComposerValueChange,
  composerPlaceholder,
  composerDisabled = false,
  composerHeaderSlot,
  queuedPrompts,
  onRemoveQueuedPrompt,
  visionSupported,
  visionProviderLabel,
  now,
}: AgentPanelProps) {
  const { t } = usePreferences();
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [internalDraft, setInternalDraft] = useState('');
  const draft = composerValue !== undefined ? composerValue : internalDraft;
  const setDraft = (next: string) => {
    if (composerValue === undefined) setInternalDraft(next);
    onComposerValueChange?.(next);
  };
  const runningCount = runs.filter((r) => r.status === 'RUNNING').length;
  const latestRunId = runs[runs.length - 1]?.id;
  const canSend = !composerDisabled && draft.trim().length > 0;

  const handleComposerSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = draft.trim();
    if (!onSubmitPrompt || composerDisabled || !trimmed) return;
    setDraft('');
    void onSubmitPrompt(trimmed);
  };

  // Keep the newest run in view, the way a conversation follows its last message.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [latestRunId]);

  useEffect(() => {
    if (!overlay) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay, onClose]);

  useEffect(() => () => document.body.classList.remove(RESIZING_BODY_CLASS), []);

  const widthFromPointer = (clientX: number) => window.innerWidth - clientX;

  const onResizerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Pointer capture keeps the drag alive while the pointer crosses the prototype iframe.
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add(RESIZING_BODY_CLASS);
  };
  const onResizerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    onResize(widthFromPointer(e.clientX), { commit: false });
  };
  const onResizerPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove(RESIZING_BODY_CLASS);
    onResize(widthFromPointer(e.clientX), { commit: true });
  };
  const onResizerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // The panel sits on the right, so moving the divider left makes it wider.
    if (e.key === 'ArrowLeft') onResize(width + KEYBOARD_RESIZE_STEP, { commit: true });
    else if (e.key === 'ArrowRight') onResize(width - KEYBOARD_RESIZE_STEP, { commit: true });
    else if (e.key === 'Home') onResize(AGENT_PANEL_MAX_WIDTH, { commit: true });
    else if (e.key === 'End') onResize(AGENT_PANEL_MIN_WIDTH, { commit: true });
    else return;
    e.preventDefault();
  };

  return (
    <>
      {overlay && (
        <div
          className="agent-panel-scrim"
          data-testid="agent-panel-scrim"
          aria-hidden="true"
          onClick={onClose}
        />
      )}
      <aside
        ref={panelRef}
        id="agent-panel"
        className={cn('agent-panel', overlay && 'is-overlay')}
        data-testid="agent-panel"
        aria-label={t('智能体面板', 'Agent Panel')}
        tabIndex={-1}
      >
        {!overlay && (
          <div
            className="agent-panel-resizer"
            data-testid="agent-panel-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('调整智能体面板宽度', 'Resize Agent Panel')}
            aria-valuemin={AGENT_PANEL_MIN_WIDTH}
            aria-valuemax={AGENT_PANEL_MAX_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={onResizerPointerDown}
            onPointerMove={onResizerPointerMove}
            onPointerUp={onResizerPointerEnd}
            onPointerCancel={onResizerPointerEnd}
            onDoubleClick={() => onResize(AGENT_PANEL_DEFAULT_WIDTH, { commit: true })}
            onKeyDown={onResizerKeyDown}
          />
        )}

        <header className="agent-panel-head">
          <div className="agent-panel-heading">
            <span className="agent-panel-kicker">{t('智能体', 'Agent')}</span>
            <h2 className="agent-panel-title">{t(title.zh, title.en)}</h2>
          </div>
          {runningCount > 0 && (
            <span className="agent-panel-running" data-testid="agent-panel-running">
              <span className="agent-panel-running-dot" aria-hidden="true" />
              {t(`${runningCount} 个运行中`, `${runningCount} running`)}
            </span>
          )}
          <Button
            variant="ghost"
            size="xs"
            data-testid="agent-panel-close-btn"
            aria-label={t('收起智能体面板', 'Collapse Agent Panel')}
            title={t('收起智能体面板', 'Collapse Agent Panel')}
            onClick={onClose}
          >
            <PanelRightClose size={14} aria-hidden="true" />
          </Button>
        </header>

        {visionSupported === false && (
          <VisionCapabilityBanner
            visionSupported={false}
            {...(visionProviderLabel ? { providerLabel: visionProviderLabel } : {})}
            {...(onOpenLlmCenter ? { onOpenLlmCenter } : {})}
            className="agent-panel-vision-banner"
          />
        )}

        <div className="agent-panel-body" ref={bodyRef}>
          {runs.length === 0 ? (
            <p className="agent-panel-empty" data-testid="agent-panel-empty">
              {t(
                '智能体在本模块的每一次运行都会显示在这里：进展、步骤和结果。',
                'Every agent run in this module shows up here: progress, steps, and results.',
              )}
            </p>
          ) : (
            runs.map((run) => (
              <AgentRunCard
                key={run.id}
                run={run}
                {...(now !== undefined ? { now } : {})}
                {...(onCancelRun ? { onCancel: () => onCancelRun(run.id) } : {})}
                {...(onRetryRun ? { onRetry: () => onRetryRun(run.id) } : {})}
                {...(onOpenRunArtifact ? { onOpenArtifact: () => onOpenRunArtifact(run.id) } : {})}
                {...(onOpenLlmCenter ? { onOpenLlmCenter } : {})}
                {...(onHoverAnchor ? { onHoverAnchor } : {})}
              />
            ))
          )}
        </div>

        {(onSubmitPrompt || (queuedPrompts && queuedPrompts.length > 0)) && (
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
                          <X size={11} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {composerHeaderSlot && (
              <div className="agent-panel-composer-slot" data-testid="agent-panel-composer-slot">
                {composerHeaderSlot}
              </div>
            )}

            {onSubmitPrompt && (
              <form className="agent-panel-composer-form" onSubmit={handleComposerSubmit}>
                <textarea
                  className="agent-panel-composer-input"
                  data-testid="agent-panel-composer-input"
                  rows={2}
                  value={draft}
                  disabled={composerDisabled}
                  placeholder={
                    composerPlaceholder
                      ? t(composerPlaceholder.zh, composerPlaceholder.en)
                      : t(
                          '输入局部精修指令（Enter 发送，Shift+Enter 换行）…',
                          'Describe a prototype refinement (Enter to send, Shift+Enter for newline)…',
                        )
                  }
                  aria-label={t('智能体输入', 'Agent prompt')}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      shouldSubmitComposerKey({
                        key: e.key,
                        shiftKey: e.shiftKey,
                        isComposing: e.nativeEvent.isComposing,
                      })
                    ) {
                      e.preventDefault();
                      handleComposerSubmit();
                    }
                  }}
                />
                <div className="agent-panel-composer-actions">
                  <span className="agent-panel-composer-hint">
                    {runningCount > 0
                      ? t('当前有运行中的任务，发送后将自动排队执行', 'Active run in progress — new prompts queue automatically')
                      : t('Enter 发送 · Shift+Enter 换行', 'Enter to send · Shift+Enter newline')}
                  </span>
                  <Button
                    type="submit"
                    variant="accent"
                    size="xs"
                    data-testid="agent-panel-send-btn"
                    disabled={!canSend}
                  >
                    <Send size={11} aria-hidden="true" />
                    {runningCount > 0 ? t('排队发送', 'Queue') : t('发送', 'Send')}
                  </Button>
                </div>
              </form>
            )}
          </footer>
        )}
      </aside>
    </>
  );
}
