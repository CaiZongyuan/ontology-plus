import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronsUpDown,
  Clock,
  GitFork,
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

export interface AgentPanelSessionOption {
  id: string;
  title: string;
  isFork?: boolean;
  /** Number of user turns in the session, shown as a hint in the switcher. */
  turnCount?: number;
  /** Pre-formatted "last active" label. */
  updatedLabel?: string;
  running?: boolean;
}

export interface AgentPanelProps {
  /** Name of the Agent Session shown for the module in view. */
  title: LocalizedText;
  /** Oldest first, like a conversation. */
  runs: AgentRunView[];
  width: number;
  /** Wide docked mode for conversation-primary surfaces or side-by-side deep review. */
  wideMode?: boolean;
  onToggleWideMode?: () => void;
  /** Overlay presentation for narrow viewports. */
  overlay?: boolean;
  onClose: () => void;
  onResize: (width: number, opts: { commit: boolean }) => void;
  onCancelRun?: (runId: string) => void;
  onRetryRun?: (runId: string) => void;
  onOpenRunArtifact?: (runId: string) => void;
  onOpenLlmCenter?: () => void;
  onHoverAnchor?: (anchor: PrototypeTargetAnchor | null) => void;
  onAnswerAskUser?: (
    runId: string,
    promptId: string,
    selectedAnswers: string[],
    freeformText?: string,
  ) => void;
  onTriggerWriteback?: (writebackInterfaceId: string, actionTitle: string) => void;
  /** Agent Sessions of the module's agent, newest first. The switcher shows once there is one to name. */
  sessions?: AgentPanelSessionOption[];
  activeSessionId?: string;
  isForkSession?: boolean;
  onSelectSession?: (sessionId: string) => void;
  /** Starts a fresh Agent Session for this module's agent. Omit where sessions are owned by an artifact. */
  onCreateSession?: () => void | Promise<void>;
  onRenameSession?: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteSession?: (sessionId: string) => void | Promise<void>;
  /** One-click openers shown while the session has no runs yet. */
  starterPrompts?: LocalizedText[];
  /** Optional module-specific header context slot (e.g. Reasoning Mode pills, Capability Agent selector). */
  headerContextSlot?: React.ReactNode;
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
  wideMode = false,
  onToggleWideMode,
  overlay = false,
  onClose,
  onResize,
  onCancelRun,
  onRetryRun,
  onOpenRunArtifact,
  onOpenLlmCenter,
  onHoverAnchor,
  onAnswerAskUser,
  onTriggerWriteback,
  sessions,
  activeSessionId,
  isForkSession = false,
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
  const hasSessionSwitcher = Boolean(
    onSelectSession && (sessionList.length > 1 || (sessionList.length > 0 && onCreateSession)),
  );
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const sessionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!sessionMenuRef.current?.contains(e.target as Node)) setSessionMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSessionMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [sessionMenuOpen]);

  // A different session is a different conversation: start it at its latest turn.
  useEffect(() => {
    setSessionMenuOpen(false);
  }, [activeSessionId]);

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
        className={cn('agent-panel', overlay && 'is-overlay', wideMode && 'is-wide')}
        data-testid="agent-panel"
        data-wide-mode={wideMode ? 'true' : 'false'}
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
          <div className="agent-panel-heading" ref={sessionMenuRef}>
            <div className="agent-panel-kicker-row">
              <span className="agent-panel-kicker">{t(title.zh, title.en)}</span>
              {isForkSession && (
                <span className="agent-panel-fork-badge" data-testid="agent-panel-fork-badge">
                  <GitFork size={10} aria-hidden="true" />
                  {t('分叉会话', 'Fork')}
                </span>
              )}
            </div>
            {hasSessionSwitcher && activeSessionOption ? (
              <button
                type="button"
                className="agent-panel-session-trigger"
                data-testid="agent-panel-session-select"
                aria-haspopup="listbox"
                aria-expanded={sessionMenuOpen}
                aria-label={t('切换智能体会话', 'Switch Agent Session')}
                title={activeSessionOption.title}
                onClick={() => setSessionMenuOpen((v) => !v)}
              >
                <h2 className="agent-panel-title">{activeSessionOption.title}</h2>
                <ChevronsUpDown size={12} aria-hidden="true" />
              </button>
            ) : (
              <h2 className="agent-panel-title">
                {activeSessionOption?.title ?? t('新会话', 'New session')}
              </h2>
            )}
            {sessionMenuOpen && hasSessionSwitcher && (
              <AgentSessionMenu
                sessions={sessionList}
                activeSessionId={activeSessionOption?.id}
                onSelect={(id) => {
                  setSessionMenuOpen(false);
                  onSelectSession?.(id);
                }}
                {...(onCreateSession
                  ? {
                      onCreate: () => {
                        setSessionMenuOpen(false);
                        void onCreateSession();
                      },
                    }
                  : {})}
                {...(onRenameSession ? { onRename: onRenameSession } : {})}
                {...(onDeleteSession ? { onDelete: onDeleteSession } : {})}
              />
            )}
          </div>
          {runningCount > 0 && (
            <span className="agent-panel-running" data-testid="agent-panel-running">
              <span className="agent-panel-running-dot" aria-hidden="true" />
              {t(`${runningCount} 个运行中`, `${runningCount} running`)}
            </span>
          )}
          <div className="agent-panel-head-actions">
            {onCreateSession && (
              <Button
                variant="ghost"
                size="xs"
                data-testid="agent-new-session-btn"
                aria-label={t('新建会话', 'New session')}
                title={t('新建会话', 'New session')}
                onClick={() => void onCreateSession()}
              >
                <MessageSquarePlus size={14} aria-hidden="true" />
              </Button>
            )}
            {!overlay && onToggleWideMode && (
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
                      '这是一段新的对话。直接描述你的目标，智能体的进展、步骤和结果都会显示在这里。',
                      'A fresh conversation. Describe what you need; progress, steps, and results show up here.',
                    )
                  : t(
                      '智能体在本模块的每一次运行都会显示在这里：进展、步骤和结果。',
                      'Every agent run in this module shows up here: progress, steps, and results.',
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
                {...(onOpenLlmCenter ? { onOpenLlmCenter } : {})}
                {...(onHoverAnchor ? { onHoverAnchor } : {})}
                {...(onAnswerAskUser
                  ? {
                      onAnswerAskUser: (promptId, selectedAnswers, freeformText) =>
                        onAnswerAskUser(run.id, promptId, selectedAnswers, freeformText),
                    }
                  : {})}
                {...(onTriggerWriteback ? { onTriggerWriteback } : {})}
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

interface AgentSessionMenuProps {
  sessions: AgentPanelSessionOption[];
  activeSessionId: string | undefined;
  onSelect: (sessionId: string) => void;
  onCreate?: () => void;
  onRename?: (sessionId: string, title: string) => void | Promise<void>;
  onDelete?: (sessionId: string) => void | Promise<void>;
}

/**
 * Session switcher popover. Rename and delete happen in the row itself, so
 * managing conversations never needs a blocking dialog.
 */
function AgentSessionMenu({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: AgentSessionMenuProps) {
  const { t } = usePreferences();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const commitRename = (session: AgentPanelSessionOption) => {
    const next = renameDraft.trim();
    setRenamingId(null);
    if (next && next !== session.title) void onRename?.(session.id, next);
  };

  return (
    <div
      className="agent-session-menu"
      data-testid="agent-session-menu"
      role="listbox"
      aria-label={t('智能体会话', 'Agent Sessions')}
    >
      <div className="agent-session-menu-head">
        <span>{t(`会话 · ${sessions.length}`, `Sessions · ${sessions.length}`)}</span>
        {onCreate && (
          <button
            type="button"
            className="agent-session-menu-new"
            data-testid="agent-session-menu-new-btn"
            onClick={onCreate}
          >
            <MessageSquarePlus size={12} aria-hidden="true" />
            {t('新建会话', 'New session')}
          </button>
        )}
      </div>
      <ul className="agent-session-menu-list">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const meta = [
            session.turnCount !== undefined
              ? session.turnCount === 0
                ? t('尚未开始', 'Not started')
                : t(`${session.turnCount} 轮对话`, `${session.turnCount} turn${session.turnCount === 1 ? '' : 's'}`)
              : '',
            session.updatedLabel ?? '',
          ]
            .filter(Boolean)
            .join(' · ');

          if (renamingId === session.id) {
            return (
              <li key={session.id} className="agent-session-row is-editing">
                <input
                  className="agent-session-rename-input"
                  data-testid="agent-session-rename-input"
                  aria-label={t('会话名称', 'Session name')}
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
                      setRenamingId(null);
                    }
                  }}
                />
              </li>
            );
          }

          if (confirmingDeleteId === session.id) {
            return (
              <li key={session.id} className="agent-session-row is-confirming" role="alert">
                <span className="agent-session-confirm-text">
                  {t(`删除「${session.title}」及其全部对话？`, `Delete "${session.title}" and its conversation?`)}
                </span>
                <span className="agent-session-confirm-actions">
                  <button
                    type="button"
                    className="agent-session-confirm-btn"
                    autoFocus
                    onClick={() => setConfirmingDeleteId(null)}
                  >
                    {t('取消', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    className="agent-session-confirm-btn is-danger"
                    data-testid="agent-session-delete-confirm-btn"
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
              data-testid="agent-session-row"
            >
              <button
                type="button"
                role="option"
                aria-selected={isActive}
                className="agent-session-row-main"
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
              {(onRename || onDelete) && (
                <span className="agent-session-row-actions">
                  {onRename && (
                    <button
                      type="button"
                      className="agent-session-row-action"
                      data-testid="agent-session-rename-btn"
                      aria-label={t(`重命名「${session.title}」`, `Rename "${session.title}"`)}
                      title={t('重命名', 'Rename')}
                      onClick={() => {
                        setConfirmingDeleteId(null);
                        setRenameDraft(session.title);
                        setRenamingId(session.id);
                      }}
                    >
                      <Pencil size={12} aria-hidden="true" />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      className="agent-session-row-action is-danger"
                      data-testid="agent-session-delete-btn"
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
    </div>
  );
}
