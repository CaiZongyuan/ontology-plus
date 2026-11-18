import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Clock,
  GitFork,
  History,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  PanelRightClose,
  Pencil,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  BUSINESS_VOCABULARY,
  type ProjectStepId,
} from '../../../packages/business-vocabulary/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../beautifui/index.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
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

export interface AgentPanelSessionOption {
  id: string;
  title: string;
  isFork?: boolean;
  /** Number of user turns in the conversation, shown as a hint in the history menu. */
  turnCount?: number;
  /** Pre-formatted "last active" label. */
  updatedLabel?: string;
  running?: boolean;
}

export interface AgentPanelProps {
  /** User-facing title of the conversational counterpart (`AI 助手` / `AI Assistant`). */
  title: LocalizedText;
  /** Optional contextual subtitle explaining what can be asked on this view. */
  subtitle?: LocalizedText;
  /** Oldest first, like a conversation. */
  runs: AgentRunView[];
  width: number;
  /** Wide docked mode for conversation-primary surfaces or side-by-side deep review. */
  wideMode?: boolean;
  onToggleWideMode?: () => void;
  /** Overlay presentation for narrow viewports. */
  overlay?: boolean;
  /** Which side of the workspace this panel is docked on (default: 'right'). */
  side?: 'left' | 'right';
  /** Whether the user can collapse this panel away (false when permanently docked as the left conversation pane). */
  closable?: boolean;
  /** Whether drag/keyboard width resizing is enabled (defaults to !overlay). */
  resizable?: boolean;
  onClose: () => void;
  onResize: (width: number, opts: { commit: boolean }) => void;
  onCancelRun?: (runId: string) => void;
  onRetryRun?: (runId: string) => void;
  onOpenRunArtifact?: (runId: string) => void;
  onOpenPlatformSettings?: () => void;
  onOpenLlmCenter?: () => void;
  onHoverAnchor?: (anchor: PrototypeTargetAnchor | null) => void;
  onAnswerAskUser?: (
    runId: string,
    promptId: string,
    selectedAnswers: string[],
    freeformText?: string,
  ) => void;
  onAcceptStepHandoff?: (runId: string, handoffId: string) => void | Promise<void>;
  onDeclineStepHandoff?: (runId: string, handoffId: string) => void | Promise<void>;
  onOpenHandoffTargetStep?: (targetStep: ProjectStepId, targetSessionId?: string) => void;
  handoffBusyById?: Readonly<Record<string, 'accept' | 'decline'>>;
  onTriggerWriteback?: (writebackInterfaceId: string, actionTitle: string) => void;
  /** Optional hook slot for #65/#67/#70 computed Change Summary & run-level Undo footer per run. */
  renderRunFooter?: (run: AgentRunView) => React.ReactNode;
  /** Conversations of the current specialist agent, newest first, shown inside the History Menu. */
  sessions?: AgentPanelSessionOption[];
  activeSessionId?: string;
  isForkSession?: boolean;
  /** True when conversations are 1-to-1 bound to an artifact (e.g. Interactive Prototype). */
  sessionsOwnedByArtifact?: boolean;
  /** Opens the History Menu initially (useful for deterministic SSR verification). */
  defaultHistoryOpen?: boolean;
  onSelectSession?: (sessionId: string) => void;
  /** Starts a fresh conversation for this step's specialist. Omit where conversations are owned by an artifact. */
  onCreateSession?: () => void | Promise<void>;
  onRenameSession?: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteSession?: (sessionId: string) => void | Promise<void>;
  /** One-click openers shown while the conversation has no turns yet. */
  starterPrompts?: LocalizedText[];
  /** Optional view-specific header context slot (e.g. Reasoning Mode pills, Capability selector). */
  headerContextSlot?: React.ReactNode;
  /** Interactive composer submission handler. When supplied, renders the composer footer. */
  onSubmitPrompt?: (prompt: string) => void | Promise<void>;
  composerValue?: string;
  onComposerValueChange?: (value: string) => void;
  composerPlaceholder?: LocalizedText;
  composerDisabled?: boolean;
  /** Optional slot above the textarea for selection chips (#28) or image attachments (#31). */
  composerHeaderSlot?: React.ReactNode;
  /** Prompts queued behind the currently active run on this conversation. */
  queuedPrompts?: AgentPanelQueuedPrompt[];
  onRemoveQueuedPrompt?: (queueId: string) => void;
  /** Whether the active provider/model supports multimodal vision input (`false` shows explicit fallback banner). */
  visionSupported?: boolean;
  visionProviderLabel?: string;
  visionModelLabel?: string;
  /** Fixed clock passed through to the run cards for deterministic rendering. */
  now?: number;
}

/**
 * The single conversational surface in the workbench (ADR 0009, amended).
 * Presents calmly as `AI 助手` / `AI Assistant` while the shell routes to the
 * specialist session for the step in view and tucks conversation management into the History Menu.
 */
export function AgentPanel({
  title,
  subtitle,
  runs,
  width,
  wideMode = false,
  onToggleWideMode,
  overlay = false,
  side = 'right',
  closable = true,
  resizable,
  onClose,
  onResize,
  onCancelRun,
  onRetryRun,
  onOpenRunArtifact,
  onOpenPlatformSettings,
  onOpenLlmCenter,
  onHoverAnchor,
  onAnswerAskUser,
  onAcceptStepHandoff,
  onDeclineStepHandoff,
  onOpenHandoffTargetStep,
  handoffBusyById,
  onTriggerWriteback,
  renderRunFooter,
  sessions,
  activeSessionId,
  isForkSession = false,
  sessionsOwnedByArtifact = false,
  defaultHistoryOpen = false,
  onSelectSession,
  onCreateSession,
  onRenameSession,
  onDeleteSession,
  starterPrompts,
  headerContextSlot,
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
  visionModelLabel,
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
  const sessionList = sessions ?? [];
  const activeSessionOption =
    sessionList.find((s) => s.id === activeSessionId) ?? sessionList[0];
  const showHistoryMenu = Boolean(
    onCreateSession || onSelectSession || sessionList.length > 0 || sessionsOwnedByArtifact,
  );
  const [historyOpen, setHistoryOpen] = useState<boolean>(defaultHistoryOpen);

  // Close the History Menu when the active conversation changes externally (e.g. step switch).
  const prevActiveSessionRef = useRef(activeSessionId);
  useEffect(() => {
    if (prevActiveSessionRef.current !== activeSessionId) {
      prevActiveSessionRef.current = activeSessionId;
      setHistoryOpen(false);
    }
  }, [activeSessionId]);

  const handleComposerSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = draft.trim();
    if (!onSubmitPrompt || composerDisabled || !trimmed) return;
    setDraft('');
    void onSubmitPrompt(trimmed);
  };

  // Keep the newest turn in view, the way a conversation follows its last message.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [latestRunId, activeSessionId]);

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

  const widthFromPointer = (clientX: number) => {
    if (side === 'left') {
      const leftEdge = panelRef.current?.getBoundingClientRect().left ?? 0;
      return clientX - leftEdge;
    }
    return window.innerWidth - clientX;
  };

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
    const widenKey = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const narrowKey = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === widenKey) onResize(width + KEYBOARD_RESIZE_STEP, { commit: true });
    else if (e.key === narrowKey) onResize(width - KEYBOARD_RESIZE_STEP, { commit: true });
    else if (e.key === 'Home') onResize(AGENT_PANEL_MAX_WIDTH, { commit: true });
    else if (e.key === 'End') onResize(AGENT_PANEL_MIN_WIDTH, { commit: true });
    else return;
    e.preventDefault();
  };

  const showResizer = resizable ?? !overlay;
  const assistantLabel = t(
    BUSINESS_VOCABULARY.AI_ASSISTANT.zh,
    BUSINESS_VOCABULARY.AI_ASSISTANT.en,
  );

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
        className={cn(
          'agent-panel',
          side === 'left' && 'is-left',
          overlay && 'is-overlay',
          wideMode && 'is-wide',
        )}
        data-testid="agent-panel"
        data-side={side}
        data-wide-mode={wideMode ? 'true' : 'false'}
        aria-label={assistantLabel}
        tabIndex={-1}
      >
        {showResizer && (
          <div
            className="agent-panel-resizer"
            data-testid="agent-panel-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('调整对话栏宽度', 'Resize conversation pane')}
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
            <div className="agent-panel-kicker-row">
              <h2 className="agent-panel-title" data-testid="assistant-panel-title">
                {t(title.zh, title.en)}
              </h2>
              {isForkSession && (
                <span className="agent-panel-fork-badge" data-testid="agent-panel-fork-badge">
                  <GitFork size={10} aria-hidden="true" />
                  {t('分支对话', 'Branch')}
                </span>
              )}
            </div>
            {subtitle && (
              <span className="agent-panel-subtitle" data-testid="assistant-panel-subtitle">
                {t(subtitle.zh, subtitle.en)}
              </span>
            )}
          </div>
          {runningCount > 0 && (
            <span className="agent-panel-running" data-testid="agent-panel-running">
              <span className="agent-panel-running-dot" aria-hidden="true" />
              {t(`${runningCount} 个运行中`, `${runningCount} running`)}
            </span>
          )}
          <div className="agent-panel-head-actions">
            {showHistoryMenu && (
              <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="xs"
                      data-testid="assistant-history-menu-btn"
                      aria-label={t('历史对话', 'Conversation history')}
                      title={t('历史对话', 'Conversation history')}
                    />
                  }
                >
                  <History size={14} aria-hidden="true" />
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  align={side === 'left' ? 'start' : 'end'}
                  sideOffset={6}
                  className="w-80 p-0 overflow-hidden"
                >
                  <AssistantHistoryMenu
                    sessions={sessionList}
                    activeSessionId={activeSessionOption?.id}
                    sessionsOwnedByArtifact={sessionsOwnedByArtifact}
                    onSelect={(id) => {
                      setHistoryOpen(false);
                      onSelectSession?.(id);
                    }}
                    {...(onCreateSession && !sessionsOwnedByArtifact
                      ? {
                          onCreate: () => {
                            setHistoryOpen(false);
                            void onCreateSession();
                          },
                        }
                      : {})}
                    {...(onRenameSession ? { onRename: onRenameSession } : {})}
                    {...(onDeleteSession && !sessionsOwnedByArtifact
                      ? { onDelete: onDeleteSession }
                      : {})}
                  />
                </PopoverContent>
              </Popover>
            )}
            {!overlay && resizable !== false && onToggleWideMode && (
              <Button
                variant="ghost"
                size="xs"
                data-testid="agent-panel-wide-toggle"
                aria-pressed={wideMode}
                aria-label={
                  wideMode
                    ? t('恢复标准面板宽度', 'Restore standard panel width')
                    : t('展开为宽屏对话模式', 'Expand to Wide Mode')
                }
                title={
                  wideMode
                    ? t('恢复标准宽度', 'Standard width')
                    : t('宽屏模式', 'Wide mode')
                }
                onClick={onToggleWideMode}
              >
                {wideMode ? (
                  <Minimize2 size={13} aria-hidden="true" />
                ) : (
                  <Maximize2 size={13} aria-hidden="true" />
                )}
              </Button>
            )}
            {closable && (
              <Button
                variant="ghost"
                size="xs"
                data-testid="agent-panel-close-btn"
                aria-label={t('收起对话栏', 'Collapse conversation pane')}
                title={t('收起对话栏', 'Collapse conversation pane')}
                onClick={onClose}
              >
                <PanelRightClose size={14} aria-hidden="true" />
              </Button>
            )}
          </div>
        </header>

        {headerContextSlot && (
          <div className="agent-panel-subhead" data-testid="agent-panel-subhead">
            {headerContextSlot}
          </div>
        )}

        {visionSupported === false && (
          <VisionCapabilityBanner
            visionSupported={false}
            {...(visionProviderLabel ? { providerLabel: visionProviderLabel } : {})}
            {...(visionModelLabel ? { modelLabel: visionModelLabel } : {})}
            {...(onOpenPlatformSettings ? { onOpenPlatformSettings } : {})}
            {...(onOpenLlmCenter ? { onOpenLlmCenter } : {})}
            className="agent-panel-vision-banner"
          />
        )}

        <div className="agent-panel-body" ref={bodyRef}>
          {runs.length === 0 ? (
            <div className="agent-panel-empty" data-testid="agent-panel-empty">
              <span className="agent-panel-empty-mark" aria-hidden="true">
                <Sparkles size={16} />
              </span>
              <p className="agent-panel-empty-text">
                {onSubmitPrompt
                  ? t(
                      '这是一段新的对话。直接描述你的目标，进展和结果都会显示在这里。',
                      'A fresh conversation. Describe what you need; progress and results show up here.',
                    )
                  : t(
                      'AI 助手在这里展示当前步骤的进展与结果。',
                      'The AI Assistant shows progress and results for this step here.',
                    )}
              </p>
              {onSubmitPrompt && starterPrompts && starterPrompts.length > 0 && (
                <div className="agent-panel-starters" data-testid="agent-panel-starters">
                  {starterPrompts.map((starter, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="agent-panel-starter"
                      disabled={composerDisabled}
                      onClick={() => void onSubmitPrompt(t(starter.zh, starter.en))}
                    >
                      {t(starter.zh, starter.en)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            runs.map((run) => (
              <AgentRunCard
                key={run.id}
                run={run}
                {...(now !== undefined ? { now } : {})}
                {...(onCancelRun ? { onCancel: () => onCancelRun(run.id) } : {})}
                {...(onRetryRun ? { onRetry: () => onRetryRun(run.id) } : {})}
                {...(onOpenRunArtifact ? { onOpenArtifact: () => onOpenRunArtifact(run.id) } : {})}
                {...(onOpenPlatformSettings ? { onOpenPlatformSettings } : {})}
                {...(onOpenLlmCenter ? { onOpenLlmCenter } : {})}
                {...(onHoverAnchor ? { onHoverAnchor } : {})}
                {...(onAnswerAskUser
                  ? {
                      onAnswerAskUser: (promptId, selectedAnswers, freeformText) =>
                        onAnswerAskUser(run.id, promptId, selectedAnswers, freeformText),
                    }
                  : {})}
                {...(onAcceptStepHandoff
                  ? {
                      onAcceptStepHandoff: (handoffId) => onAcceptStepHandoff(run.id, handoffId),
                    }
                  : {})}
                {...(onDeclineStepHandoff
                  ? {
                      onDeclineStepHandoff: (handoffId) =>
                        onDeclineStepHandoff(run.id, handoffId),
                    }
                  : {})}
                {...(onOpenHandoffTargetStep ? { onOpenHandoffTargetStep } : {})}
                {...(run.stepHandoff && handoffBusyById?.[run.stepHandoff.id]
                  ? { handoffBusyAction: handoffBusyById[run.stepHandoff.id] }
                  : {})}
                {...(onTriggerWriteback ? { onTriggerWriteback } : {})}
                {...(renderRunFooter ? { changeSummarySlot: renderRunFooter(run) } : {})}
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
                          '输入你的想法或修改需求（Enter 发送，Shift+Enter 换行）…',
                          'Describe what you want to change (Enter to send, Shift+Enter for newline)…',
                        )
                  }
                  aria-label={t('向 AI 助手提问', 'Message AI Assistant')}
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
                      ? t('当前有正在执行的请求，新消息会自动排队', 'Request in progress — new messages queue automatically')
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

interface AssistantHistoryMenuProps {
  sessions: AgentPanelSessionOption[];
  activeSessionId: string | undefined;
  sessionsOwnedByArtifact?: boolean;
  onSelect: (sessionId: string) => void;
  onCreate?: () => void;
  onRename?: (sessionId: string, title: string) => void | Promise<void>;
  onDelete?: (sessionId: string) => void | Promise<void>;
}

/**
 * Conversation history menu rendered inside a Popover. Rename and delete happen
 * inline in the row so managing conversations never uses a blocking browser dialog.
 */
function AssistantHistoryMenu({
  sessions,
  activeSessionId,
  sessionsOwnedByArtifact = false,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: AssistantHistoryMenuProps) {
  const { t } = usePreferences();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const committedRenameIdRef = useRef<string | null>(null);

  const commitRename = (session: AgentPanelSessionOption) => {
    if (committedRenameIdRef.current === session.id) return;
    committedRenameIdRef.current = session.id;
    const next = renameDraft.trim();
    setRenamingId(null);
    if (next && next !== session.title) void onRename?.(session.id, next);
  };

  return (
    <div
      className="assistant-history-menu"
      data-testid="assistant-history-menu"
      aria-label={t('历史对话', 'Conversation history')}
    >
      <div className="agent-session-menu-head">
        <span>
          {t(`历史对话 · ${sessions.length}`, `Conversations · ${sessions.length}`)}
        </span>
        {onCreate && !sessionsOwnedByArtifact ? (
          <button
            type="button"
            className="agent-session-menu-new"
            data-testid="assistant-new-session-btn"
            onClick={onCreate}
          >
            <MessageSquarePlus size={12} aria-hidden="true" />
            {t('新建对话', 'New conversation')}
          </button>
        ) : sessionsOwnedByArtifact ? (
          <span className="text-xs text-muted-foreground">
            {t('随界面原型自动管理', 'Follows each prototype')}
          </span>
        ) : null}
      </div>

      {sessions.length === 0 ? (
        <div className="px-3 py-4 text-[12px] text-muted-foreground">
          {sessionsOwnedByArtifact
            ? t('发送消息后将自动记录当前界面原型的对话。', 'Send a message to start the conversation for this prototype.')
            : t('还没有历史对话，发送消息即可开始。', 'No previous conversations yet. Send a message to start.')}
        </div>
      ) : (
        <ul className="agent-session-menu-list" role="listbox" aria-label={t('历史对话列表', 'Conversations')}>
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const meta = [
              session.turnCount !== undefined
                ? session.turnCount === 0
                  ? t('尚未开始', 'Not started')
                  : t(
                      `${session.turnCount} 轮对话`,
                      `${session.turnCount} turn${session.turnCount === 1 ? '' : 's'}`,
                    )
                : '',
              session.updatedLabel ?? '',
            ]
              .filter(Boolean)
              .join(' · ');

            if (renamingId === session.id) {
              return (
                <li
                  key={session.id}
                  className="agent-session-row is-editing"
                  data-testid="assistant-history-item"
                  data-session-id={session.id}
                  data-active={isActive ? 'true' : 'false'}
                >
                  <input
                    className="agent-session-rename-input"
                    data-testid="assistant-rename-session-input"
                    aria-label={t('对话名称', 'Conversation title')}
                    value={renameDraft}
                    autoFocus
                    maxLength={80}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(session)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        commitRename(session);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        committedRenameIdRef.current = session.id;
                        setRenamingId(null);
                      }
                    }}
                  />
                </li>
              );
            }

            if (confirmingDeleteId === session.id) {
              return (
                <li
                  key={session.id}
                  className="agent-session-row is-confirming"
                  role="alert"
                  data-testid="assistant-history-item"
                  data-session-id={session.id}
                  data-active={isActive ? 'true' : 'false'}
                >
                  <span className="agent-session-confirm-text">
                    {t(
                      `删除「${session.title}」及其全部对话记录？`,
                      `Delete "${session.title}" and all of its messages?`,
                    )}
                  </span>
                  <span className="agent-session-confirm-actions">
                    <button
                      type="button"
                      className="agent-session-confirm-btn"
                      data-testid="assistant-delete-cancel-btn"
                      autoFocus
                      onClick={() => setConfirmingDeleteId(null)}
                    >
                      {t('取消', 'Cancel')}
                    </button>
                    <button
                      type="button"
                      className="agent-session-confirm-btn is-danger"
                      data-testid="assistant-delete-confirm-btn"
                      onClick={() => {
                        setConfirmingDeleteId(null);
                        void onDelete?.(session.id);
                      }}
                    >
                      {t('删除', 'Delete')}
                    </button>
                  </span>
                </li>
              );
            }

            return (
              <li
                key={session.id}
                className={cn('agent-session-row', isActive && 'is-active')}
                data-testid="assistant-history-item"
                data-session-id={session.id}
                data-active={isActive ? 'true' : 'false'}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className="agent-session-row-main"
                  data-testid="assistant-select-session-btn"
                  onClick={() => onSelect(session.id)}
                >
                  <span className="agent-session-row-check" aria-hidden="true">
                    {isActive ? (
                      <Check size={12} />
                    ) : session.running ? (
                      <span className="agent-panel-running-dot" />
                    ) : session.isFork ? (
                      <GitFork size={11} />
                    ) : null}
                  </span>
                  <span className="agent-session-row-text">
                    <span className="agent-session-row-title">{session.title}</span>
                    {meta && <span className="agent-session-row-meta">{meta}</span>}
                  </span>
                </button>
                {(onRename || (onDelete && !sessionsOwnedByArtifact)) && (
                  <span className="agent-session-row-actions">
                    {onRename && (
                      <button
                        type="button"
                        className="agent-session-row-action"
                        data-testid="assistant-rename-session-btn"
                        aria-label={t(`重命名「${session.title}」`, `Rename "${session.title}"`)}
                        title={t('重命名', 'Rename')}
                        onClick={() => {
                          setConfirmingDeleteId(null);
                          committedRenameIdRef.current = null;
                          setRenameDraft(session.title);
                          setRenamingId(session.id);
                        }}
                      >
                        <Pencil size={12} aria-hidden="true" />
                      </button>
                    )}
                    {onDelete && !sessionsOwnedByArtifact && (
                      <button
                        type="button"
                        className="agent-session-row-action is-danger"
                        data-testid="assistant-delete-session-btn"
                        aria-label={t(`删除「${session.title}」`, `Delete "${session.title}"`)}
                        title={t('删除', 'Delete')}
                        onClick={() => {
                          setRenamingId(null);
                          setConfirmingDeleteId(session.id);
                        }}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
