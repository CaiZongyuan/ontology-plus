import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Database,
  GitBranch,
  History,
  Loader2,
  MessageSquarePlus,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react';
import type { ModelCode } from '../../../packages/ontology-core/index.js';
import type {
  AgentAskUserPrompt,
  AgentDomainArtifact,
  AgentSession,
  AgentSessionKind,
  AgentSessionMessage,
  AgentToolCallTrace,
} from '../../../packages/workspace-store/index.js';
import {
  apiAbortAgentSession,
  apiCompactAgentSession,
  apiCreateAgentSession,
  apiDeleteAgentSession,
  apiForkAgentSession,
  apiPatchAgentSession,
  apiPutJson,
  streamAgentSessionTurn,
  useWorkbenchStore,
} from '../../api.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import {
  ApprovalCard,
  Button,
  CodeBlock,
  ConfirmDialog,
  ThinkingState,
  ToolChips,
} from '../beautifui/index.js';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';

export interface AgentSessionWorkbenchProps {
  agentKind: AgentSessionKind;
  targetId?: string;
  activeModelCode?: ModelCode;
  compactRailByDefault?: boolean;
  height?: number | string;
  title?: string;
  subtitle?: string;
  placeholder?: string;
  defaultPromptWhenEmpty?: string;
  defaultReasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
  quickPrompts?: string[];
  inputTestId?: string;
  sendBtnTestId?: string;
  toolLogTestId?: string;
  onJumpToOntology?: (modelCode: ModelCode, elementId?: string) => void;
  onTriggerWriteback?: (writebackInterfaceId: string, recommendationTitle: string) => void;
  onTurnCompleted?: (session: AgentSession) => void;
  headerExtra?: React.ReactNode;
  className?: string;
}

interface StreamingDraftState {
  sessionId: string;
  thinking: string;
  text: string;
  step: number;
  toolCalls: AgentToolCallTrace[];
  artifacts: AgentDomainArtifact[];
  askUser?: AgentAskUserPrompt;
  errorDiagnostic?: AgentSessionMessage['errorDiagnostic'];
}

const KIND_META: Record<
  AgentSessionKind,
  { badgeZh: string; badgeEn: string; starterPrompts: string[] }
> = {
  REQUIREMENT: {
    badgeZh: '需求启发 Agent',
    badgeEn: 'Requirement Explorer',
    starterPrompts: [
      '梳理大额采购合同审批与履约里程碑的核心聚合、行为和风控规则',
      '帮我检查当前需求是否存在边界模糊的业务决策点并让我确认',
    ],
  },
  COPILOT: {
    badgeZh: '本体建模 Copilot',
    badgeEn: 'Ontology Copilot',
    starterPrompts: [
      '请新增一条超额采购合同双重风控校验规则',
      '检查当前 11 模型一致性状态并给出补全建议',
    ],
  },
  CODING: {
    badgeZh: '四层研发 Coding Agent',
    badgeEn: '4-Layer Coding Agent',
    starterPrompts: [
      '生成合同风控审批接口、前端表单组件与单元测试骨架',
      '编译并检查当前四层装配研发工程包目录结构',
    ],
  },
  CAPABILITY: {
    badgeZh: '能力中心智能问答',
    badgeEn: 'Capability Smart Agent',
    starterPrompts: [
      '请查询当前合同台账并核对大额合同资信准入规则',
      '盘点当前已挂载的本体技能与 MCP 工具清单',
    ],
  },
  REASONING: {
    badgeZh: '三段式数据本体推理',
    badgeEn: '3-Stage Data Reasoning',
    starterPrompts: [
      '分析高风险采购合同履约延期根因，并输出闭环写回策略建议',
      '统计各业务部门合同金额分布与履约风险敞口',
    ],
  },
};

export function AgentSessionWorkbench({
  agentKind,
  targetId,
  activeModelCode,
  compactRailByDefault = false,
  height = 580,
  title,
  subtitle,
  placeholder,
  defaultPromptWhenEmpty,
  defaultReasoningMode = 'ASK_POLICY',
  quickPrompts,
  inputTestId,
  sendBtnTestId,
  toolLogTestId,
  onJumpToOntology,
  onTriggerWriteback,
  onTurnCompleted,
  headerExtra,
  className,
}: AgentSessionWorkbenchProps) {
  const { t } = usePreferences();
  const data = useWorkbenchStore((s) => s.data);
  const activeSessionIdFromUrl = useWorkbenchStore((s) => s.activeSessionId);
  const setActiveSessionIdInUrl = useWorkbenchStore((s) => s.setActiveSessionId);
  const setActiveNav = useWorkbenchStore((s) => s.setActiveNav);
  const patchData = useWorkbenchStore((s) => s.patchData);
  const pushUndoSnapshot = useWorkbenchStore((s) => s.pushUndoSnapshot);
  const showToast = useWorkbenchStore((s) => s.showToast);

  const projectId = data?.activeProject.id ?? 'proj-contract';
  const allSessions = data?.agentSessions ?? [];
  const llmProviders = data?.llmProviders ?? [];
  const mockLlmMode = Boolean(data?.systemSettings.mockLlmMode);

  const matchingSessions = useMemo(() => {
    const filtered = allSessions.filter((s) => {
      if (s.projectId !== projectId || s.agentKind !== agentKind) return false;
      if (targetId && s.targetId && s.targetId !== targetId) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [allSessions, projectId, agentKind, targetId]);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => {
    if (
      activeSessionIdFromUrl &&
      matchingSessions.some((s) => s.id === activeSessionIdFromUrl)
    ) {
      return activeSessionIdFromUrl;
    }
    return matchingSessions[0]?.id ?? null;
  });

  const [railOpen, setRailOpen] = useState(!compactRailByDefault);
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AgentSession | null>(null);

  const [promptInput, setPromptInput] = useState('');
  const [reasoningMode, setReasoningMode] = useState<'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY'>(
    defaultReasoningMode,
  );
  const [streaming, setStreaming] = useState<StreamingDraftState | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  // Sync selected session when matchingSessions change
  useEffect(() => {
    if (selectedSessionId && matchingSessions.some((s) => s.id === selectedSessionId)) {
      return;
    }
    const nextId = matchingSessions[0]?.id ?? null;
    setSelectedSessionId(nextId);
  }, [matchingSessions, selectedSessionId]);

  const activeSession = useMemo(
    () => matchingSessions.find((s) => s.id === selectedSessionId) ?? null,
    [matchingSessions, selectedSessionId],
  );

  useEffect(() => {
    if (activeSession?.reasoningMode) {
      setReasoningMode(activeSession.reasoningMode);
    }
  }, [activeSession?.id, activeSession?.reasoningMode]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeSession?.messages.length, streaming?.text, streaming?.toolCalls.length]);

  const filteredRailSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return matchingSessions;
    return matchingSessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [matchingSessions, searchQuery]);

  const selectSession = (id: string) => {
    setSelectedSessionId(id);
    setActiveSessionIdInUrl(id);
  };

  const handleCreateSession = async (): Promise<AgentSession> => {
    const res = await apiCreateAgentSession({
      projectId,
      agentKind,
      ...(targetId ? { targetId } : {}),
      ...(agentKind === 'REASONING' ? { reasoningMode } : {}),
    });
    patchData({ agentSessions: res.agentSessions });
    selectSession(res.session.id);
    return res.session;
  };

  const handleRenameConfirm = async (session: AgentSession) => {
    const nextTitle = renameDraft.trim();
    setRenamingId(null);
    if (!nextTitle || nextTitle === session.title) return;
    const res = await apiPatchAgentSession(session.id, { title: nextTitle });
    patchData({ agentSessions: res.agentSessions });
  };

  const handleTogglePin = async (session: AgentSession) => {
    const res = await apiPatchAgentSession(session.id, { pinned: !session.pinned });
    patchData({ agentSessions: res.agentSessions });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    const res = await apiDeleteAgentSession(target.id);
    patchData({ agentSessions: res.agentSessions });
    showToast(t(`已删除会话「${target.title}」`, `Deleted session "${target.title}"`));
  };

  const handleForkFromMessage = async (messageId?: string) => {
    if (!activeSession) return;
    const res = await apiForkAgentSession(activeSession.id, {
      ...(messageId ? { fromMessageId: messageId } : {}),
    });
    patchData({ agentSessions: res.agentSessions });
    selectSession(res.session.id);
    showToast(
      t(
        `已分叉新会话：${res.session.title}`,
        `Forked session: ${res.session.title}`,
      ),
    );
  };

  const handleCompact = async () => {
    if (!activeSession) return;
    const res = await apiCompactAgentSession(activeSession.id);
    patchData({ agentSessions: res.agentSessions });
    showToast(t('已压缩历史上下文摘要', 'Compacted session history'));
  };

  const handleAbort = async () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (activeSession) {
      const res = await apiAbortAgentSession(activeSession.id);
      patchData({ agentSessions: res.agentSessions });
    }
    setStreaming(null);
    showToast(t('已停止当前生成任务', 'Aborted active generation'));
  };

  const handleEnableMockModeQuickly = async () => {
    if (!data) return;
    const nextSettings = { ...data.systemSettings, mockLlmMode: true };
    const res = await apiPutJson<{ systemSettings: typeof nextSettings }>(
      '/api/system/settings',
      nextSettings,
    );
    patchData({ systemSettings: res.systemSettings });
    showToast(
      t(
        '已开启离线演示 Mock 模式，现在可直接重新发送体验完整流式工具链',
        'Mock demo mode enabled — retry your prompt now',
      ),
    );
  };

  const executeStreamTurn = async (opts: {
    promptText?: string;
    mode?: 'PROMPT' | 'STEER' | 'FOLLOW_UP' | 'CONTINUE';
    askUserAnswer?: {
      promptId: string;
      selectedAnswers: string[];
      freeformText?: string;
    };
  }) => {
    const rawPrompt =
      opts.promptText !== undefined ? opts.promptText.trim() : promptInput.trim();
    const effectivePrompt =
      rawPrompt || (opts.askUserAnswer || opts.mode === 'CONTINUE' ? '' : defaultPromptWhenEmpty || '');

    if (!effectivePrompt && !opts.askUserAnswer && opts.mode !== 'CONTINUE') {
      return;
    }

    // If steering while streaming, abort previous HTTP stream first
    if (streaming && opts.mode === 'STEER') {
      abortControllerRef.current?.abort();
    }

    let targetSession = activeSession;
    if (!targetSession) {
      targetSession = await handleCreateSession();
    }

    const prevSuite = data?.activeProject.suite
      ? structuredClone(data.activeProject.suite)
      : null;

    if (opts.promptText === undefined) {
      setPromptInput('');
    }

    // Optimistically append user bubble so UI responds in <16ms
    if (effectivePrompt) {
      const optimisticUserMsg: AgentSessionMessage = {
        id: `temp-user-${Date.now()}`,
        role: 'user',
        content: effectivePrompt,
        timestamp: new Date().toISOString(),
      };
      const updatedSessions = (useWorkbenchStore.getState().data?.agentSessions ?? []).map(
        (s) =>
          s.id === targetSession!.id
            ? {
                ...s,
                status: 'RUNNING' as const,
                messages: [...s.messages, optimisticUserMsg],
              }
            : s,
      );
      patchData({ agentSessions: updatedSessions });
    }

    const ac = new AbortController();
    abortControllerRef.current = ac;

    setStreaming({
      sessionId: targetSession.id,
      thinking: '',
      text: '',
      step: 1,
      toolCalls: [],
      artifacts: [],
    });

    try {
      await streamAgentSessionTurn(
        targetSession.id,
        {
          ...(effectivePrompt ? { prompt: effectivePrompt } : {}),
          mode: opts.mode ?? 'PROMPT',
          ...(opts.askUserAnswer ? { askUserAnswer: opts.askUserAnswer } : {}),
          ...(activeModelCode ? { activeModelCode } : {}),
          ...(agentKind === 'REASONING' ? { reasoningMode } : {}),
        },
        {
          onThinkingDelta: (delta, step) => {
            setStreaming((cur) =>
              cur ? { ...cur, step, thinking: cur.thinking + delta } : cur,
            );
          },
          onTextDelta: (delta, step) => {
            setStreaming((cur) =>
              cur ? { ...cur, step, text: cur.text + delta } : cur,
            );
          },
          onToolCall: (call) => {
            setStreaming((cur) => {
              if (!cur) return cur;
              const nextTrace: AgentToolCallTrace = {
                id: call.id,
                toolName: call.toolName,
                arguments: call.arguments,
                output: '',
              };
              return {
                ...cur,
                step: call.step,
                toolCalls: [...cur.toolCalls.filter((c) => c.id !== call.id), nextTrace],
              };
            });
          },
          onToolResult: (trace, step) => {
            setStreaming((cur) => {
              if (!cur) return cur;
              const exists = cur.toolCalls.some((c) => c.id === trace.id);
              return {
                ...cur,
                step,
                toolCalls: exists
                  ? cur.toolCalls.map((c) => (c.id === trace.id ? trace : c))
                  : [...cur.toolCalls, trace],
              };
            });
          },
          onArtifact: (artifact) => {
            setStreaming((cur) =>
              cur ? { ...cur, artifacts: [...cur.artifacts, artifact] } : cur,
            );
          },
          onAskUser: (askUser) => {
            setStreaming((cur) => (cur ? { ...cur, askUser } : cur));
          },
          onRunError: ({ diagnostic, session }) => {
            if (session) {
              const latest = useWorkbenchStore.getState().data?.agentSessions ?? [];
              patchData({
                agentSessions: latest.some((s) => s.id === session.id)
                  ? latest.map((s) => (s.id === session.id ? session : s))
                  : [session, ...latest],
              });
            } else if (diagnostic) {
              setStreaming((cur) =>
                cur ? { ...cur, errorDiagnostic: diagnostic } : cur,
              );
            }
          },
          onMessageEnd: ({ session, project }) => {
            const latest = useWorkbenchStore.getState().data?.agentSessions ?? [];
            const mergedSessions = latest.some((s) => s.id === session.id)
              ? latest.map((s) => (s.id === session.id ? session : s))
              : [session, ...latest];

            if (project) {
              if (
                prevSuite &&
                JSON.stringify(prevSuite) !== JSON.stringify(project.suite)
              ) {
                pushUndoSnapshot(prevSuite);
              }
              patchData({
                agentSessions: mergedSessions,
                activeProject: project,
              });
            } else {
              patchData({ agentSessions: mergedSessions });
            }

            setStreaming(null);
            if (agentKind === 'REASONING') {
              showToast(
                t(
                  `已完成 ${reasoningMode} 三段式数据本体推理`,
                  `Completed ${reasoningMode} ontology reasoning`,
                ),
              );
            }
            onTurnCompleted?.(session);
          },
        },
        ac.signal,
      );
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setStreaming(null);
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  const isStreamingActive = Boolean(
    streaming && (!activeSession || streaming.sessionId === activeSession.id) && !streaming.errorDiagnostic,
  );

  const meta = KIND_META[agentKind];
  const starters = quickPrompts ?? meta.starterPrompts;

  return (
    <div
      className={cn(
        'flex w-full overflow-hidden rounded-window border border-line bg-surface shadow-card text-[13px]',
        className,
      )}
      style={{ height }}
      data-testid={`agent-workbench-${agentKind.toLowerCase()}`}
    >
      {/* ─── Left Collapsible Multi-Session Rail ─── */}
      {railOpen && (
        <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-inset/40">
          <div className="flex items-center justify-between gap-1.5 border-b border-line px-3 py-2.5">
            <span className="text-[12px] font-semibold text-ink">
              {t('智能体会话', 'Agent Sessions')} ({matchingSessions.length})
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="accent"
                size="xs"
                onClick={() => void handleCreateSession()}
                data-testid="agent-new-session-btn"
                title={t('新建会话', 'New Session')}
              >
                <MessageSquarePlus size={12} />
                {t('新建', 'New')}
              </Button>
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                title={t('收起会话栏', 'Collapse session rail')}
                className="primitive-icon-button cursor-pointer text-ink-3 hover:bg-hover hover:text-ink"
              >
                <PanelLeftClose size={13.5} />
              </button>
            </div>
          </div>

          <div className="border-b border-line px-2.5 py-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('检索历史会话…', 'Filter sessions…')}
              className="w-full rounded-control border border-line bg-surface px-2.5 py-1 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {filteredRailSessions.length === 0 ? (
              <div className="px-2 py-6 text-center text-[11.5px] text-ink-3">
                {t('暂无匹配会话，点击上方新建', 'No sessions yet')}
              </div>
            ) : (
              filteredRailSessions.map((sess) => {
                const isActive = sess.id === activeSession?.id;
                const isRenaming = renamingId === sess.id;
                return (
                  <div
                    key={sess.id}
                    onClick={() => selectSession(sess.id)}
                    className={cn(
                      'group relative flex cursor-pointer flex-col gap-1 rounded-control px-2.5 py-2 transition-colors',
                      isActive
                        ? 'bg-accent-tint/70 text-ink shadow-hairline'
                        : 'hover:bg-hover text-ink-2',
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => void handleRenameConfirm(sess)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleRenameConfirm(sess);
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          className="w-full rounded border border-accent bg-surface px-1.5 py-0.5 text-[12px] text-ink focus:outline-none"
                        />
                      ) : (
                        <span className="truncate text-[12.5px] font-medium text-ink">
                          {sess.pinned ? '📌 ' : ''}
                          {sess.title}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[10.5px] text-ink-3">
                      <span className="font-mono">
                        {sess.messages.length} msgs
                        {sess.parentSessionId ? ' · Fork' : ''}
                      </span>
                      <div
                        className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => void handleTogglePin(sess)}
                          title={t('置顶/取消置顶', 'Pin/Unpin')}
                          className="rounded p-1 hover:bg-surface hover:text-ink"
                        >
                          <Pin size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(sess.id);
                            setRenameDraft(sess.title);
                          }}
                          title={t('重命名', 'Rename')}
                          className="rounded p-1 hover:bg-surface hover:text-ink"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(sess)}
                          title={t('删除会话', 'Delete')}
                          className="rounded p-1 text-red hover:bg-red-tint"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      {/* ─── Main Streaming Conversation Pane ─── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Session Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-inset/35 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {!railOpen && (
              <button
                type="button"
                onClick={() => setRailOpen(true)}
                title={t('展开会话管理栏', 'Open session list')}
                className="primitive-icon-button cursor-pointer text-ink-3 hover:bg-hover hover:text-ink"
              >
                <PanelLeftOpen size={14} />
              </button>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold text-ink">
                  {title || activeSession?.title || t(meta.badgeZh, meta.badgeEn)}
                </span>
                <span className="rounded-full bg-accent-tint px-2 py-0.5 font-mono text-[10.5px] font-medium text-accent">
                  {t(meta.badgeZh, meta.badgeEn)}
                </span>
                {mockLlmMode && (
                  <span className="rounded-full bg-orange-tint px-2 py-0.5 font-mono text-[10px] text-orange">
                    Mock Engine
                  </span>
                )}
              </div>
              {subtitle && (
                <div className="truncate text-[11.5px] text-ink-3">{subtitle}</div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {!railOpen && (
              <Button
                variant="secondary"
                size="xs"
                onClick={() => void handleCreateSession()}
                data-testid="agent-new-session-btn"
              >
                <MessageSquarePlus size={11.5} />
                {t('新会话', 'New')}
              </Button>
            )}
            {activeSession && activeSession.messages.length >= 4 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void handleCompact()}
                title={t('压缩长对话历史上下文', 'Compact conversation context')}
              >
                <Minimize2 size={11.5} />
                {t('压缩上下文', 'Compact')}
              </Button>
            )}
            {activeSession?.tokenUsage && (
              <span className="rounded-full bg-inset px-2 py-0.5 font-mono text-[10.5px] text-ink-3 tabular-nums">
                {activeSession.tokenUsage.totalTokens} tok
              </span>
            )}
            {headerExtra}
          </div>
        </div>

        {/* Compacted Context Summary Banner */}
        {activeSession?.compactedSummary && (
          <div className="flex items-center gap-2 border-b border-line bg-accent-tint/25 px-3.5 py-1.5 text-[11.5px] text-ink-2">
            <History size={12.5} className="shrink-0 text-accent" />
            <span className="truncate">
              <strong>{t('已压缩早期上下文摘要：', 'Compacted Summary: ')}</strong>
              {activeSession.compactedSummary}
            </span>
          </div>
        )}

        {/* Scrollable Message Thread */}
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3.5">
          {(!activeSession || activeSession.messages.length === 0) && !streaming && (
            <div className="flex h-full flex-col items-center justify-center py-8 text-center">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-accent-tint text-accent">
                <Sparkles size={17} />
              </div>
              <div className="text-[13.5px] font-semibold text-ink">
                {t(meta.badgeZh, meta.badgeEn)}
              </div>
              <p className="mt-1 max-w-md text-[12px] text-ink-3">
                {t(
                  '基于 pi-durable 统一流式会话引擎：工具默认自动执行（由 11 模型校验器与撤销栈守护），仅在存在待确认业务分歧时弹出交互式确认卡。',
                  'Powered by pi-durable live SSE streaming with YOLO tool execution + validator self-repair and scoped HITL.',
                )}
              </p>
              <div className="mt-3 flex max-w-lg flex-wrap justify-center gap-1.5">
                {starters.map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => void executeStreamTurn({ promptText: sp })}
                    className="cursor-pointer rounded-full border border-line bg-inset/60 px-3 py-1 text-[11.5px] text-ink-2 transition-colors hover:border-accent hover:bg-accent-tint/40 hover:text-ink"
                  >
                    {sp}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeSession?.messages.map((msg) => (
            <MessageTurnItem
              key={msg.id}
              message={msg}
              toolLogTestId={toolLogTestId}
              disabled={isStreamingActive}
              onFork={() => void handleForkFromMessage(msg.id)}
              onJumpToOntology={onJumpToOntology}
              onTriggerWriteback={onTriggerWriteback}
              onOpenLlmCenter={() => setActiveNav('llm-center')}
              onEnableMockMode={() => void handleEnableMockModeQuickly()}
              onAnswerHitl={(promptId, selectedAnswers, freeformText) =>
                void executeStreamTurn({
                  askUserAnswer: {
                    promptId,
                    selectedAnswers,
                    ...(freeformText ? { freeformText } : {}),
                  },
                })
              }
            />
          ))}

          {/* Live In-Flight Streaming Assistant Turn */}
          {streaming && (!activeSession || streaming.sessionId === activeSession.id) && (
            <div className="space-y-2.5 rounded-window border border-accent/35 bg-inset/35 p-3.5 shadow-xs animate-[fade-up_180ms_var(--ease-out-strong)_both]">
              <ThinkingState
                working={!streaming.errorDiagnostic}
                activeLabel={t(
                  `正在流式推理与工具编排 (Step ${streaming.step}/5)…`,
                  `Streaming & running tools (Step ${streaming.step}/5)…`,
                )}
                doneLabel={t('已完成当前推理步骤', 'Reasoning step complete')}
                thinkingText={streaming.thinking}
              />

              {streaming.toolCalls.length > 0 && (
                <ToolChips
                  traces={streaming.toolCalls}
                  testId={toolLogTestId}
                  onJumpToOntology={onJumpToOntology}
                />
              )}

              {streaming.text && (
                <MarkdownRenderer content={streaming.text} isStreaming />
              )}

              {streaming.artifacts.map((art, i) => (
                <DomainArtifactCard
                  key={i}
                  artifact={art}
                  onJumpToOntology={onJumpToOntology}
                  onTriggerWriteback={onTriggerWriteback}
                />
              ))}

              {streaming.askUser && (
                <ApprovalCard
                  prompt={streaming.askUser}
                  onSubmit={(selectedAnswers, freeformText) =>
                    void executeStreamTurn({
                      askUserAnswer: {
                        promptId: streaming.askUser!.id,
                        selectedAnswers,
                        ...(freeformText ? { freeformText } : {}),
                      },
                    })
                  }
                />
              )}

              {streaming.errorDiagnostic && (
                <GatewayDiagnosticBanner
                  diagnostic={streaming.errorDiagnostic}
                  onOpenLlmCenter={() => setActiveNav('llm-center')}
                  onEnableMockMode={() => void handleEnableMockModeQuickly()}
                />
              )}
            </div>
          )}

          <div ref={scrollEndRef} />
        </div>

        {/* ─── Composer Footer ─── */}
        <div className="border-t border-line bg-inset/35 p-2.5">
          {/* Provider selector + Optional 3-Stage Reasoning Mode Pills */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {agentKind === 'REASONING' && (
                <div className="inline-flex items-center rounded-[7px] border border-line bg-surface p-0.5">
                  {(['ASK_DATA', 'ASK_WHY', 'ASK_POLICY'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setReasoningMode(m)}
                      className={cn(
                        'cursor-pointer rounded-[5px] px-2 py-0.5 font-mono text-[10.5px] font-semibold transition-colors',
                        reasoningMode === m
                          ? 'bg-accent text-accent-ink'
                          : 'text-ink-3 hover:text-ink',
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}

              {llmProviders.length > 0 && (
                <select
                  aria-label={t('选择模型网关', 'Select LLM Gateway')}
                  value={activeSession?.providerId || llmProviders.find((p) => p.enabled)?.id || ''}
                  onChange={async (e) => {
                    const providerId = e.target.value;
                    if (activeSession) {
                      const res = await apiPatchAgentSession(activeSession.id, {
                        providerId,
                      });
                      patchData({ agentSessions: res.agentSessions });
                    }
                  }}
                  className="h-6 rounded-full border border-line bg-surface px-2.5 font-mono text-[11px] text-ink-2 focus:border-accent focus:outline-none"
                >
                  {llmProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.defaultModel} {p.enabled ? '' : '(已停用)'}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {activeSession && activeSession.messages.length > 0 && !isStreamingActive && (
              <button
                type="button"
                onClick={() => void executeStreamTurn({ mode: 'CONTINUE' })}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-ink-3 hover:bg-hover hover:text-ink"
                title={t('让智能体继续推演下一步', 'Continue agent turn')}
              >
                <RefreshCw size={11} />
                {t('继续推演', 'Continue')}
              </button>
            )}
          </div>

          {/* Input Box + Send / Steer / Abort Controls */}
          <div className="flex items-end gap-2 rounded-card border border-line bg-surface p-2 shadow-2xs focus-within:border-accent">
            <textarea
              rows={2}
              data-testid={inputTestId}
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void executeStreamTurn({
                    mode: isStreamingActive ? 'STEER' : 'PROMPT',
                  });
                }
              }}
              placeholder={
                placeholder ||
                t(
                  '输入指令，按 Enter 发送（Shift+Enter 换行；生成中发送将实时转向 Steer）…',
                  'Enter instructions (Enter to send, Shift+Enter for newline)…',
                )
              }
              className="min-h-[42px] max-h-32 flex-1 resize-none border-0 bg-transparent text-[12.5px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
            />

            <div className="flex shrink-0 items-center gap-1.5">
              {isStreamingActive && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void handleAbort()}
                  data-testid="agent-abort-btn"
                  title={t('中止流式生成', 'Stop streaming')}
                >
                  <Square size={11} fill="currentColor" />
                  {t('停止', 'Stop')}
                </Button>
              )}

              <Button
                variant="accent"
                size="sm"
                data-testid={sendBtnTestId}
                disabled={
                  !promptInput.trim() && !defaultPromptWhenEmpty && !isStreamingActive
                }
                onClick={() =>
                  void executeStreamTurn({
                    mode: isStreamingActive ? 'STEER' : 'PROMPT',
                  })
                }
              >
                {isStreamingActive ? (
                  <>
                    <ArrowUp size={13} />
                    {t('转向', 'Steer')}
                  </>
                ) : (
                  <>
                    <Send size={12.5} />
                    {t('发送', 'Send')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Non-blocking Delete Session Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('删除智能体会话', 'Delete Agent Session')}
        description={
          deleteTarget
            ? t(
                `确认删除会话「${deleteTarget.title}」及其中的 ${deleteTarget.messages.length} 条消息记录吗？该操作不会回滚已写入 11 模型的资产。`,
                `Delete session "${deleteTarget.title}" (${deleteTarget.messages.length} messages)? Committed ontology mutations remain intact.`,
              )
            : ''
        }
        confirmLabel={t('确认删除', 'Delete')}
        danger
        onConfirm={() => void handleConfirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function MessageTurnItem({
  message,
  toolLogTestId,
  disabled,
  onFork,
  onJumpToOntology,
  onTriggerWriteback,
  onOpenLlmCenter,
  onEnableMockMode,
  onAnswerHitl,
}: {
  message: AgentSessionMessage;
  toolLogTestId?: string;
  disabled?: boolean;
  onFork: () => void;
  onJumpToOntology?: (modelCode: ModelCode, elementId?: string) => void;
  onTriggerWriteback?: (writebackInterfaceId: string, recommendationTitle: string) => void;
  onOpenLlmCenter: () => void;
  onEnableMockMode: () => void;
  onAnswerHitl: (
    promptId: string,
    selectedAnswers: string[],
    freeformText?: string,
  ) => void;
}) {
  const { t } = usePreferences();
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="group flex flex-col items-end gap-1">
        <div className="max-w-[86%] rounded-window rounded-br-xs bg-ink px-3.5 py-2 text-[12.5px] leading-relaxed text-surface shadow-xs whitespace-pre-wrap">
          {message.content}
        </div>
        <div className="flex items-center gap-2 text-[10.5px] text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onFork}
            data-testid="agent-fork-msg-btn"
            className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover hover:text-ink"
          >
            <GitBranch size={10.5} />
            {t('从此轮分叉', 'Fork here')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group space-y-2.5 rounded-window border border-line bg-surface p-3.5 shadow-2xs">
      <div className="flex items-center justify-between gap-2 text-[11px] text-ink-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent-tint text-accent">
            <Wrench size={9.5} />
          </span>
          <span className="font-semibold text-ink-2">
            {message.providerName || 'Ontology Agent'}
          </span>
          {message.modelUsed && (
            <span className="font-mono text-[10.5px] text-ink-3">
              · {message.modelUsed}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onFork}
          data-testid="agent-fork-msg-btn"
          title={t('从该回复节点分叉出独立会话分支', 'Fork new session from this turn')}
          className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-ink-3 opacity-75 transition-opacity hover:bg-hover hover:text-ink group-hover:opacity-100"
        >
          <GitBranch size={11} />
          {t('分叉会话', 'Fork')}
        </button>
      </div>

      {message.thinking && (
        <ThinkingState
          working={false}
          doneLabel={t('查看模型推理思维链', 'View reasoning trace')}
          thinkingText={message.thinking}
        />
      )}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolChips
          traces={message.toolCalls}
          testId={toolLogTestId}
          onJumpToOntology={onJumpToOntology}
        />
      )}

      {message.content && <MarkdownRenderer content={message.content} />}

      {message.artifacts?.map((art, idx) => (
        <DomainArtifactCard
          key={idx}
          artifact={art}
          onJumpToOntology={onJumpToOntology}
          onTriggerWriteback={onTriggerWriteback}
        />
      ))}

      {message.askUser && (
        <ApprovalCard
          prompt={message.askUser}
          disabled={disabled}
          onSubmit={(selectedAnswers, freeformText) =>
            onAnswerHitl(message.askUser!.id, selectedAnswers, freeformText)
          }
        />
      )}

      {message.errorDiagnostic && (
        <GatewayDiagnosticBanner
          diagnostic={message.errorDiagnostic}
          onOpenLlmCenter={onOpenLlmCenter}
          onEnableMockMode={onEnableMockMode}
        />
      )}
    </div>
  );
}

function DomainArtifactCard({
  artifact,
  onJumpToOntology,
  onTriggerWriteback,
}: {
  artifact: AgentDomainArtifact;
  onJumpToOntology?: (modelCode: ModelCode, elementId?: string) => void;
  onTriggerWriteback?: (writebackInterfaceId: string, recommendationTitle: string) => void;
}) {
  const { t } = usePreferences();

  if (artifact.kind === 'ONTOLOGY_DIFF') {
    return (
      <div className="rounded-card border border-line bg-inset/45 p-2.5 text-[12px]">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-semibold text-ink">{artifact.title}</span>
          {artifact.modelCode && onJumpToOntology && (
            <button
              type="button"
              onClick={() => onJumpToOntology(artifact.modelCode!)}
              className="cursor-pointer rounded bg-accent-tint px-2 py-0.5 font-mono text-[11px] text-accent"
            >
              打开 {artifact.modelCode} 视图 ↗
            </button>
          )}
        </div>
        <div className="space-y-1">
          {artifact.changes.map((c, idx) => (
            <div
              key={`${c.id}-${idx}`}
              className="flex items-center gap-2 rounded bg-surface px-2 py-1 font-mono text-[11px] shadow-hairline"
            >
              <span
                className={cn(
                  'rounded px-1.5 py-0.2 text-[10px] font-semibold',
                  c.action === 'ADDED' && 'bg-green-tint text-green',
                  c.action === 'MODIFIED' && 'bg-accent-tint text-accent',
                  c.action === 'REMOVED' && 'bg-red-tint text-red',
                )}
              >
                {c.action}
              </span>
              <span className="font-semibold text-ink">{c.id}</span>
              <span className="truncate text-ink-3">{c.detail}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (artifact.kind === 'SQL_PREVIEW') {
    return (
      <div className="space-y-2 rounded-card border border-line bg-inset/40 p-2.5">
        <div className="flex items-center justify-between text-[11.5px]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <Database size={12.5} className="text-accent" />
            SQL 沙箱执行结果 ({artifact.rows.length} rows)
          </span>
          <span className="font-mono text-[10.5px] text-ink-3">
            {artifact.elapsedMs}ms
          </span>
        </div>
        <CodeBlock code={artifact.sql} language="sql" maxHeight={140} />
        {artifact.columns.length > 0 && (
          <div
            className="responsive-table-region rounded border border-line bg-surface"
            role="region"
            aria-label="Agent SQL preview results"
            tabIndex={0}
          >
            <table className="text-[11.5px]">
              <thead>
                <tr className="border-b border-line bg-inset/60">
                  {artifact.columns.map((col) => (
                    <th key={col} className="px-2.5 py-1.5 text-left font-mono font-semibold">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {artifact.rows.slice(0, 8).map((row, idx) => (
                  <tr key={idx}>
                    {artifact.columns.map((col) => (
                      <td key={col} className="px-2.5 py-1 font-mono text-ink-2">
                        {String(row[col] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (artifact.kind === 'REASONING_POLICY') {
    return (
      <div className="space-y-2.5 rounded-card border border-accent/35 bg-accent-tint/20 p-3 text-[12px]">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-ink">
            {t('三段式数据本体推理结论与闭环策略', '3-Stage Data Reasoning & Policy')}
          </span>
          <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] text-accent-ink">
            {artifact.mode}
          </span>
        </div>

        {artifact.dataSummary.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-3">
            {artifact.dataSummary.map((kpi, i) => (
              <div key={i} className="rounded-control bg-surface p-2 shadow-hairline">
                <div className="text-[10.5px] text-ink-3">{kpi.label}</div>
                <div className="mt-0.5 font-mono text-[13px] font-semibold text-ink">
                  {kpi.value}
                  {kpi.delta && (
                    <span className="ml-1.5 text-[10.5px] text-orange">{kpi.delta}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {artifact.causalAnalysis.length > 0 && (
          <ul className="m-0 list-disc space-y-1 pl-4 text-[12px] text-ink-2">
            {artifact.causalAnalysis.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}

        {artifact.policyRecommendations.length > 0 && (
          <div className="space-y-1.5">
            {artifact.policyRecommendations.map((rec, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface p-2.5 shadow-hairline"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink">
                    {rec.actionTitle}{' '}
                    <span className="font-mono text-[11px] text-accent">
                      ({rec.targetObject})
                    </span>
                  </div>
                  <div className="text-[11.5px] text-ink-3">{rec.expectedImpact}</div>
                </div>
                {onTriggerWriteback && (
                  <Button
                    variant="accent"
                    size="xs"
                    data-testid="trigger-policy-writeback-btn"
                    onClick={() =>
                      onTriggerWriteback(rec.writebackInterfaceId, rec.actionTitle)
                    }
                  >
                    <Check size={11.5} />
                    {t('执行策略写回', 'Execute Write-Back')} ({rec.writebackInterfaceId})
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (artifact.kind === 'REQUIREMENT_HINTS') {
    return (
      <div className="rounded-card border border-line bg-inset/45 p-2.5 text-[11.5px]">
        <div className="mb-1.5 font-semibold text-ink">
          {t('实时提炼的领域建模要素', 'Extracted Domain Modeling Signals')}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {artifact.aggregates.map((a) => (
            <span key={a} className="rounded bg-accent-tint px-2 py-0.5 font-mono text-accent">
              M1:{a}
            </span>
          ))}
          {artifact.rules.map((r) => (
            <span key={r} className="rounded bg-green-tint px-2 py-0.5 font-mono text-green">
              Rule:{r}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (artifact.kind === 'CODING_PACKAGE') {
    return (
      <div className="rounded-card border border-line bg-inset/45 p-2.5 text-[11.5px]">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold text-ink">
            已更新研发工程包 ({artifact.files.length} files)
          </span>
          <span className="font-mono text-[10.5px] text-ink-3">{artifact.outputDir}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {artifact.files.map((f) => (
            <span
              key={f}
              className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2 shadow-hairline"
            >
              {f}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function GatewayDiagnosticBanner({
  diagnostic,
  onOpenLlmCenter,
  onEnableMockMode,
}: {
  diagnostic: NonNullable<AgentSessionMessage['errorDiagnostic']>;
  onOpenLlmCenter: () => void;
  onEnableMockMode: () => void;
}) {
  const { t } = usePreferences();
  return (
    <div
      className="rounded-card border border-red/40 bg-red-tint/45 p-3 text-[12px]"
      data-testid="llm-gateway-error-banner"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="font-semibold text-red">
            {t('真实大模型网关不可达', 'Live LLM Gateway Unreachable')} ({diagnostic.code})
          </div>
          <div className="text-ink">{diagnostic.message}</div>
          <div className="text-[11.5px] text-ink-2">{diagnostic.remediation}</div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="secondary" size="xs" onClick={onOpenLlmCenter}>
              {t('前往 LLM 中心配置密钥/网关', 'Configure in LLM Center')}
            </Button>
            <Button
              variant="accent"
              size="xs"
              onClick={onEnableMockMode}
              data-testid="enable-mock-mode-quick-btn"
            >
              <Loader2 size={11} className="hidden" />
              {t('一键开启离线演示 Mock 模式', 'Enable Offline Demo Mock Mode')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
