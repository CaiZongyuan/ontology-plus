import React, { useEffect, useMemo, useState } from 'react';
import type { TransientTurnImageInput } from '../../../packages/agent-runtime/index.js';
import type { ProjectStepId } from '../../../packages/business-vocabulary/index.js';
import type {
  AgentImageAttachmentRef,
  AgentSession,
  AgentSessionKind,
  ArtifactJumpTarget,
  WritebackInterface,
} from '../../../packages/workspace-store/index.js';
import {
  apiCreateAgentSession,
  apiDeleteAgentSession,
  apiPatchAgentSession,
  apiPostJson,
  useWorkbenchStore,
  type BootstrapPayload,
  type SessionLiveDraft,
} from '../../api.js';
import { usePreferences } from '../../i18n.js';
import { resolveTurnImagesForRequest } from '../../lib/localImageStore.js';
import {
  AGENT_PANEL_SURFACES,
  agentPanelSurfaceFor,
  defaultNavForSessionKind,
  getDefaultViewForStep,
  resolveArtifactNavTarget,
  type AgentPanelSurface,
  type NavViewId,
} from '../../navigation/index.js';
import { Button } from '../beautifui/index.js';
import { ChangeSummaryCard } from '../history/index.js';
import { formatPrototypeLabelForBusinessView } from '../prototype/PrototypeRevisionHistory.js';
import { SelectionAttachmentStrip } from '../prototype/SelectionAttachmentStrip.js';
import {
  submitPrototypeComposerTurnWithSelections,
  usePrototypeSelectionStore,
} from '../prototype/prototypeSelectionStore.js';
import { AgentPanel } from './AgentPanel.js';
import {
  AGENT_PANEL_OVERLAY_QUERY,
  agentSessionScopeKey,
  useAgentPanelStore,
} from './agentPanelStore.js';
import {
  agentRunsFromSession,
  formatRelativeTime,
  summarizeUserPromptTitle,
  type LocalizedText,
} from './agentRun.js';
import { resolveActiveVisionCapability } from './VisionAttachmentControls.js';

export {
  AGENT_PANEL_SURFACES,
  agentPanelSurfaceFor,
  defaultNavForSessionKind,
  type AgentPanelSurface,
};

/** Title a conversation carries until its first turn names it. */
export const NEW_AGENT_SESSION_TITLE: LocalizedText = { zh: '新对话', en: 'New conversation' };

export function isUntitledAgentSession(title: string): boolean {
  return (
    title === NEW_AGENT_SESSION_TITLE.zh ||
    title === NEW_AGENT_SESSION_TITLE.en ||
    title === '新会话' ||
    title === 'New session'
  );
}

export interface ActiveWorkspaceRunInfo {
  sessionId: string;
  projectId: string;
  agentKind: AgentSessionKind;
  targetId?: string;
  targetNav: NavViewId;
  title: LocalizedText;
}

/**
 * Enumerates all active Agent Runs across the entire workspace so the top bar
 * renders ONE unified `"运行中 / Running"` indicator and can navigate directly
 * to the active run's module, project, and session on click.
 */
export function resolveActiveWorkspaceRuns(
  data: BootstrapPayload | null,
  liveSessionDrafts: Record<string, SessionLiveDraft>,
): ActiveWorkspaceRunInfo[] {
  const sessions = data?.agentSessions ?? [];
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const result: ActiveWorkspaceRunInfo[] = [];

  for (const [sessionId, draft] of Object.entries(liveSessionDrafts)) {
    seen.add(sessionId);
    const sess = sessionById.get(sessionId);
    const projectId = sess?.projectId ?? data?.activeProject?.id ?? 'proj-contract';
    const agentKind = sess?.agentKind ?? 'COPILOT';
    result.push({
      sessionId,
      projectId,
      agentKind,
      ...(sess?.targetId ? { targetId: sess.targetId } : {}),
      targetNav: defaultNavForSessionKind(agentKind),
      title: summarizeUserPromptTitle(draft.userPrompt, draft.displayTitle),
    });
  }

  for (const sess of sessions) {
    if (seen.has(sess.id) || sess.status !== 'RUNNING') continue;
    seen.add(sess.id);
    const lastUser = [...(sess.messages ?? [])].reverse().find((m) => m.role === 'user');
    result.push({
      sessionId: sess.id,
      projectId: sess.projectId,
      agentKind: sess.agentKind,
      ...(sess.targetId ? { targetId: sess.targetId } : {}),
      targetNav: defaultNavForSessionKind(sess.agentKind),
      title: summarizeUserPromptTitle(lastUser?.content ?? sess.title, sess.title),
    });
  }

  return result;
}

export function resolveSurfaceAgentSession(
  surface: AgentPanelSurface,
  data: BootstrapPayload | null,
  opts?: {
    activePrototypeIdByProject?: Record<string, string>;
    activeItemId?: string | null;
    activeSessionId?: string | null;
    /** Conversation last opened per agent scope; used when the URL names no session. */
    rememberedSessionByScope?: Record<string, string>;
  },
): {
  session: AgentSession | undefined;
  matchingSessions: AgentSession[];
  activePrototypeId: string | undefined;
  activeCapabilityAgentId: string | undefined;
} {
  const activeProjectId = data?.activeProject?.id;
  if (!activeProjectId || !surface.sessionKind) {
    return {
      session: undefined,
      matchingSessions: [],
      activePrototypeId: undefined,
      activeCapabilityAgentId: undefined,
    };
  }

  const sessions = data?.agentSessions ?? [];
  if (surface.sessionKind === 'PROTOTYPE_CO_DESIGN') {
    const prototypes = data?.prototypes ?? [];
    const protoSessions = sessions
      .filter((s) => s.projectId === activeProjectId && s.agentKind === 'PROTOTYPE_CO_DESIGN')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const explicitUnbound = opts?.activeSessionId
      ? protoSessions.find(
          (s) =>
            s.id === opts.activeSessionId &&
            !s.targetId &&
            !prototypes.some((p) => p.coDesignSessionId === s.id),
        )
      : undefined;
    if (explicitUnbound) {
      return {
        session: explicitUnbound,
        matchingSessions: protoSessions,
        activePrototypeId: undefined,
        activeCapabilityAgentId: undefined,
      };
    }

    const preferredProtoId =
      opts?.activePrototypeIdByProject?.[activeProjectId] ||
      opts?.activeItemId ||
      data?.confirmedPrototypeRevision?.prototypeId;
    const activeProto =
      prototypes.find((p) => p.id === preferredProtoId) ?? prototypes[0];

    const scopedProtoSessions = activeProto
      ? protoSessions.filter(
          (s) => s.id === activeProto.coDesignSessionId || s.targetId === activeProto.id,
        )
      : protoSessions;
    const session =
      scopedProtoSessions.find((s) => s.id === opts?.activeSessionId) ??
      scopedProtoSessions[0] ??
      protoSessions.find(
        (s) =>
          (activeProto?.coDesignSessionId && s.id === activeProto.coDesignSessionId) ||
          (!activeProto || s.targetId === activeProto.id),
      );
    return {
      session,
      matchingSessions:
        prototypes.length > 1
          ? protoSessions
          : scopedProtoSessions.length > 0
            ? scopedProtoSessions
            : protoSessions,
      activePrototypeId: activeProto?.id,
      activeCapabilityAgentId: undefined,
    };
  }

  if (surface.sessionKind === 'CAPABILITY') {
    const capAgents = data?.capabilityAgents ?? [];
    const explicitCapAgent = opts?.activeItemId
      ? capAgents.find((a) => a.id === opts.activeItemId)
      : undefined;
    const activeCapAgent =
      explicitCapAgent ??
      capAgents.find((a) => a.projectId === activeProjectId) ??
      capAgents[0];
    const allCapSessions = sessions
      .filter((s) => s.agentKind === 'CAPABILITY')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const projectCapSessions = allCapSessions.filter((s) => s.projectId === activeProjectId);
    const matching = explicitCapAgent
      ? allCapSessions.filter(
          (s) =>
            s.targetId === explicitCapAgent.id ||
            (!s.targetId && s.projectId === explicitCapAgent.projectId),
        )
      : projectCapSessions.length > 0
        ? projectCapSessions
        : activeCapAgent
          ? allCapSessions.filter(
              (s) =>
                s.targetId === activeCapAgent.id ||
                (!s.targetId && s.projectId === activeCapAgent.projectId),
            )
          : allCapSessions;
    const list = matching.length > 0 ? matching : allCapSessions;
    const rememberedCapId =
      opts?.rememberedSessionByScope?.[
        agentSessionScopeKey(activeProjectId, 'CAPABILITY', activeCapAgent?.id)
      ];
    const session =
      list.find((s) => s.id === opts?.activeSessionId) ??
      list.find((s) => s.id === rememberedCapId) ??
      list[0];
    return {
      session,
      matchingSessions: list,
      activePrototypeId: undefined,
      activeCapabilityAgentId: activeCapAgent?.id,
    };
  }

  const projectApps = surface.sessionKind === 'CODING'
    ? (data?.assembledApplications ?? []).filter((app) => app.projectId === activeProjectId)
    : [];
  const projectApplication = surface.sessionKind === 'CODING'
    ? projectApps.find((app) => app.id === opts?.activeItemId) ??
      (projectApps.length === 1 ? projectApps[0] : undefined)
    : undefined;
  const explicitApplicationSession = surface.sessionKind === 'CODING'
    ? sessions.find((session) => session.id === opts?.activeSessionId && session.agentKind === 'CODING'
      && session.projectId === activeProjectId && (!session.targetId || data?.assembledApplications.some(
        (app) => app.id === session.targetId && app.projectId === activeProjectId,
      )))
    : undefined;
  const applicationTargetId = projectApplication?.id
    ?? (opts?.activeItemId ? undefined : explicitApplicationSession?.targetId);
  const matching = sessions
    .filter((s) => {
      if (s.projectId !== activeProjectId || s.agentKind !== surface.sessionKind) return false;
      if (surface.sessionKind !== 'CODING') return true;
      return !s.targetId || s.targetId === applicationTargetId;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const rememberedId =
    opts?.rememberedSessionByScope?.[agentSessionScopeKey(activeProjectId, surface.sessionKind)];
  const session =
    matching.find((s) => s.id === opts?.activeSessionId) ??
    matching.find((s) => s.id === rememberedId) ??
    matching[0];
  return {
    session,
    matchingSessions: matching,
    activePrototypeId: undefined,
    activeCapabilityAgentId: undefined,
  };
}

export function countSurfaceRunningRuns(
  surface: AgentPanelSurface | undefined,
  state: {
    data: BootstrapPayload | null;
    liveSessionDrafts: Record<string, SessionLiveDraft>;
    activePrototypeIdByProject?: Record<string, string>;
    activeItemId?: string | null;
    activeSessionId?: string | null;
  },
): number {
  if (!surface || !state.data?.activeProject?.id) return 0;
  const { session } = resolveSurfaceAgentSession(surface, state.data, {
    activePrototypeIdByProject: state.activePrototypeIdByProject,
    activeItemId: state.activeItemId,
    activeSessionId: state.activeSessionId,
  });
  return session &&
    (Boolean(state.liveSessionDrafts[session.id]) || session.status === 'RUNNING')
    ? 1
    : 0;
}

export function useAgentPanelOverlayMode(): boolean {
  const [overlay, setOverlay] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(AGENT_PANEL_OVERLAY_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(AGENT_PANEL_OVERLAY_QUERY);
    const onChange = (e: MediaQueryListEvent) => setOverlay(e.matches);
    setOverlay(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return overlay;
}

export interface ShellAgentPanelProps {
  surface: AgentPanelSurface;
  overlay: boolean;
  side?: 'left' | 'right';
  closable?: boolean;
  resizable?: boolean;
  defaultHistoryOpen?: boolean;
  onClose: () => void;
  onNavigate: (view: NavViewId) => void;
  composerHeaderSlot?: React.ReactNode;
}

/** Binds the Agent Panel to the workbench store for the module in view. */
export function ShellAgentPanel({
  surface,
  overlay,
  side = 'right',
  closable = true,
  resizable,
  defaultHistoryOpen,
  onClose,
  onNavigate,
  composerHeaderSlot,
}: ShellAgentPanelProps) {
  const { t } = usePreferences();
  const {
    data,
    activeItemId,
    activeSessionId,
    activePrototypeIdByProject,
    selectedModel,
    liveSessionDrafts,
    sessionQueues,
    patchData,
    showToast,
    setActiveNav,
    setActiveItemId,
    setActiveSessionId,
    setSelectedModel,
    setSelectedElementId,
    setActivePrototypeId,
    focusRequirementSection,
    focusBusinessModelTarget,
    focusPrototypeTarget,
    openPrototypeRevisionCompare,
    openArtifactHistoryDrawer,
    undoArtifactChange,
    ensureProjectAgentSession,
    updateAgentSessionExecutionConfig,
    startSessionAgentRun,
    cancelSessionAgentRun,
    retrySessionAgentRun,
    replaceLatestSessionTurnAndRun,
    acceptStepHandoff,
    declineStepHandoff,
    removeQueuedSessionPrompt,
  } = useWorkbenchStore();
  const width = useAgentPanelStore((s) => s.width);
  const wideMode = useAgentPanelStore((s) => s.wideMode);
  const setWidth = useAgentPanelStore((s) => s.setWidth);
  const toggleWideMode = useAgentPanelStore((s) => s.toggleWideMode);
  const setHoveredAnchor = useAgentPanelStore((s) => s.setHoveredAnchor);
  const sessionByScope = useAgentPanelStore((s) => s.sessionByScope);
  const rememberSession = useAgentPanelStore((s) => s.rememberSession);
  const activeProjectId = data?.activeProject?.id;

  const [reasoningMode, setReasoningMode] = useState<'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY'>(
    'ASK_POLICY',
  );
  const [localCodeMode, setLocalCodeMode] = useState<boolean>(true);
  const [localConcurrency, setLocalConcurrency] = useState<number>(3);
  const [undoingEntryId, setUndoingEntryId] = useState<string | null>(null);
  const [handoffBusyById, setHandoffBusyById] = useState<Record<string, 'accept' | 'decline'>>({});

  const {
    session: activeSession,
    matchingSessions,
    activePrototypeId,
    activeCapabilityAgentId,
  } = useMemo(
    () =>
      resolveSurfaceAgentSession(surface, data, {
        activePrototypeIdByProject,
        activeItemId,
        activeSessionId,
        rememberedSessionByScope: sessionByScope,
      }),
    [surface, data, activePrototypeIdByProject, activeItemId, activeSessionId, sessionByScope],
  );

  // Prototype sessions belong to their Interactive Prototype (ADR 0009); every other agent can hold several conversations.
  const sessionsOwnedByArtifact = surface.sessionKind === 'PROTOTYPE_CO_DESIGN';
  const sessionScopeKey = activeProjectId
    ? agentSessionScopeKey(
        activeProjectId,
        surface.sessionKind,
        surface.sessionKind === 'CAPABILITY' ? activeCapabilityAgentId : undefined,
      )
    : null;

  useEffect(() => {
    if (sessionsOwnedByArtifact || !sessionScopeKey || !activeSession) return;
    rememberSession(sessionScopeKey, activeSession.id);
  }, [sessionsOwnedByArtifact, sessionScopeKey, activeSession?.id, rememberSession]);

  useEffect(() => {
    if (activeSession?.reasoningMode) {
      setReasoningMode(activeSession.reasoningMode);
    }
    if (activeSession?.codeMode !== undefined) {
      setLocalCodeMode(activeSession.codeMode);
    }
    if (activeSession?.multiAgentConcurrency !== undefined) {
      setLocalConcurrency(activeSession.multiAgentConcurrency);
    }
  }, [
    activeSession?.id,
    activeSession?.reasoningMode,
    activeSession?.codeMode,
    activeSession?.multiAgentConcurrency,
  ]);

  const effectiveCodeMode = activeSession?.codeMode ?? localCodeMode;
  const effectiveConcurrency = activeSession?.multiAgentConcurrency ?? localConcurrency;

  const handleToggleCodeMode = () => {
    const next = !effectiveCodeMode;
    setLocalCodeMode(next);
    if (activeSession) {
      void updateAgentSessionExecutionConfig(activeSession.id, { codeMode: next });
    }
  };

  const handleSelectConcurrency = (next: number) => {
    setLocalConcurrency(next);
    if (activeSession) {
      void updateAgentSessionExecutionConfig(activeSession.id, {
        multiAgentConcurrency: next,
      });
    }
  };

  const liveDraft = activeSession ? liveSessionDrafts[activeSession.id] : undefined;
  const queuedItems = activeSession ? (sessionQueues[activeSession.id] ?? []) : [];

  const activeSuite = data?.activeProject?.suite;
  const runs = useMemo(
    () =>
      agentRunsFromSession(activeSession, liveDraft, {
        ...(activeSuite ? { suite: activeSuite } : {}),
      }),
    [activeSession, liveDraft, activeSuite],
  );

  const queuedPrompts = useMemo(
    () =>
      queuedItems.map((q) => {
        const title = summarizeUserPromptTitle(q.prompt, q.displayTitle);
        return { id: q.id, label: t(title.zh, title.en) };
      }),
    [queuedItems, t],
  );

  const resolvedVision = useMemo(
    () =>
      resolveActiveVisionCapability(data, activeSession?.providerId, activeSession?.modelOverride),
    [data, activeSession?.providerId, activeSession?.modelOverride],
  );
  const visionState = surface.usesVision ? resolvedVision : undefined;

  const prototypeSelectionAttachments = usePrototypeSelectionStore((s) =>
    activePrototypeId ? s.attachmentsByPrototype[activePrototypeId] : undefined,
  );

  const selectionSlot =
    composerHeaderSlot ??
    (surface.sessionKind === 'PROTOTYPE_CO_DESIGN' &&
    activePrototypeId &&
    prototypeSelectionAttachments &&
    prototypeSelectionAttachments.length > 0 ? (
      <SelectionAttachmentStrip prototypeId={activePrototypeId} />
    ) : undefined);

  const executionModeBar = (
    <div
      className="flex flex-wrap items-center justify-between gap-1.5 text-[11.5px]"
      data-testid="agent-execution-mode-bar"
    >
      <button
        type="button"
        data-testid="agent-codemode-toggle"
        aria-pressed={effectiveCodeMode}
        onClick={handleToggleCodeMode}
        className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-0.5 font-medium transition ${
          effectiveCodeMode
            ? 'border-primary/50 bg-primary-soft text-primary'
            : 'border-border bg-muted/40 text-muted-foreground hover:bg-accent'
        }`}
        title={t(
          '开启后允许助手编写脚本批量并行编排步骤动作',
          'Allow the assistant to write orchestration scripts for batch & parallel actions',
        )}
      >
        <span>{t('代码模式', 'Code Mode')}</span>
        <span className="font-mono text-[10.5px]">{effectiveCodeMode ? 'ON' : 'OFF'}</span>
      </button>

      <div
        className="inline-flex items-center gap-0.5 rounded border border-border bg-muted/35 p-0.5"
        role="group"
        aria-label={t('并行协作路数', 'Parallel assistants count')}
        data-testid="agent-concurrency-group"
      >
        <span className="px-1.5 text-[11px] text-muted-foreground">
          {t('并行', 'Multi')}
        </span>
        {([1, 2, 3, 4] as const).map((n) => {
          const active = effectiveConcurrency === n;
          return (
            <button
              key={n}
              type="button"
              data-testid={`agent-concurrency-btn-${n}`}
              aria-pressed={active}
              onClick={() => handleSelectConcurrency(n)}
              className={`cursor-pointer rounded px-1.5 py-0.2 font-mono text-[11px] transition ${
                active
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              ×{n}
            </button>
          );
        })}
      </div>
    </div>
  );

  const effectiveComposerHeaderSlot = selectionSlot ? (
    <div className="flex flex-col gap-1.5">
      {selectionSlot}
      {executionModeBar}
    </div>
  ) : (
    executionModeBar
  );

  const isProjectStepSurface =
    surface.sessionKind === 'REQUIREMENT' ||
    surface.sessionKind === 'PROTOTYPE_CO_DESIGN' ||
    surface.sessionKind === 'COPILOT' ||
    surface.sessionKind === 'CODING';

  const sessionOptions = useMemo(
    () =>
      matchingSessions.map((s) => {
        const updated = formatRelativeTime(s.updatedAt);
        const defaultTitle = t(NEW_AGENT_SESSION_TITLE.zh, NEW_AGENT_SESSION_TITLE.en);
        const displayTitle = isUntitledAgentSession(s.title)
          ? defaultTitle
          : isProjectStepSurface
            ? formatPrototypeLabelForBusinessView(s.title, defaultTitle)
            : s.title;
        return {
          id: s.id,
          title: displayTitle,
          isFork: Boolean(s.parentSessionId),
          turnCount: (s.messages ?? []).filter((m) => m.role === 'user').length,
          updatedLabel: t(updated.zh, updated.en),
          running: s.status === 'RUNNING' || Boolean(liveSessionDrafts[s.id]),
        };
      }),
    [matchingSessions, liveSessionDrafts, isProjectStepSurface, t],
  );

  const handleCreateSession = async () => {
    if (!activeProjectId || !data || sessionsOwnedByArtifact) return;
    // An untouched conversation is already "new": reuse it instead of piling up empty ones.
    const reusable = matchingSessions.find(
      (s) => (s.messages ?? []).length === 0 && !liveSessionDrafts[s.id] && s.status !== 'RUNNING',
    );
    if (reusable) {
      setActiveSessionId(reusable.id);
      return;
    }
    const capAgent =
      surface.sessionKind === 'CAPABILITY'
        ? data.capabilityAgents.find((a) => a.id === activeCapabilityAgentId) ??
          data.capabilityAgents[0]
        : undefined;
    try {
      const created = await apiCreateAgentSession({
        projectId: capAgent?.projectId ?? activeProjectId,
        agentKind: surface.sessionKind,
        ...(capAgent ? { targetId: capAgent.id } : {}),
        title: t(NEW_AGENT_SESSION_TITLE.zh, NEW_AGENT_SESSION_TITLE.en),
        ...(surface.sessionKind === 'REASONING' ? { reasoningMode } : {}),
      });
      patchData({ agentSessions: created.agentSessions });
      setActiveSessionId(created.session.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRenameSession = async (sessionId: string, title: string) => {
    try {
      const res = await apiPatchAgentSession(sessionId, { title });
      patchData({ agentSessions: res.agentSessions });
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      const res = await apiDeleteAgentSession(sessionId);
      patchData({ agentSessions: res.agentSessions });
      if (activeSession?.id === sessionId) {
        const next = matchingSessions.find((s) => s.id !== sessionId);
        setActiveSessionId(next?.id ?? null);
        if (sessionScopeKey) rememberSession(sessionScopeKey, next?.id ?? null);
      }
      showToast(t('对话已删除', 'Conversation deleted'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  /** The first thing said in a conversation becomes its name, so the switcher stays scannable. */
  const autoTitleSession = (session: AgentSession, prompt: string) => {
    if ((session.messages ?? []).length > 0 || !isUntitledAgentSession(session.title)) return;
    const firstLine = prompt.split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';
    if (!firstLine) return;
    const title = firstLine.length > 28 ? `${firstLine.slice(0, 27)}…` : firstLine;
    void apiPatchAgentSession(session.id, { title })
      .then((res) => {
        const latest = useWorkbenchStore.getState().data?.agentSessions ?? [];
        patchData({
          agentSessions: latest.map((s) => (s.id === session.id ? { ...s, title: res.session.title } : s)),
        });
      })
      .catch(() => undefined);
  };

  const handleChangeReasoningMode = async (nextMode: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY') => {
    setReasoningMode(nextMode);
    if (activeSession) {
      try {
        const res = await apiPatchAgentSession(activeSession.id, { reasoningMode: nextMode });
        patchData({ agentSessions: res.agentSessions });
      } catch {
        // Non-blocking mode sync
      }
    }
  };

  const headerContextSlot = useMemo(() => {
    if (surface.sessionKind === 'REASONING') {
      const modes: Array<{
        id: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
        zh: string;
        en: string;
      }> = [
        { id: 'ASK_DATA', zh: '1. 问数', en: '1. Ask Data' },
        { id: 'ASK_WHY', zh: '2. 问因', en: '2. Ask Why' },
        { id: 'ASK_POLICY', zh: '3. 问策', en: '3. Ask Policy' },
      ];
      return (
        <div className="agent-panel-mode-pills" role="group" aria-label={t('推理阶段', 'Reasoning stage')}>
          {modes.map((m) => (
            <Button
              key={m.id}
              type="button"
              variant="toggle"
              size="xs"
              data-testid={`reasoning-mode-${m.id}`}
              aria-pressed={reasoningMode === m.id}
              className={`agent-panel-mode-pill ${reasoningMode === m.id ? 'is-active' : ''}`}
              onClick={() => void handleChangeReasoningMode(m.id)}
            >
              {t(m.zh, m.en)}
            </Button>
          ))}
        </div>
      );
    }

    if (surface.sessionKind === 'CAPABILITY' && (data?.capabilityAgents?.length ?? 0) > 0) {
      const capAgents = data!.capabilityAgents;
      const selectedCap =
        capAgents.find((a) => a.id === activeCapabilityAgentId) ?? capAgents[0]!;
      return (
        <select
          className="agent-panel-session-select"
          data-testid="agent-panel-capability-select"
          aria-label={t('选择能力配置', 'Select capability profile')}
          value={selectedCap.id}
          onChange={(e) => setActiveItemId(e.target.value)}
        >
          {capAgents.map((ag) => (
            <option key={ag.id} value={ag.id}>
              {ag.name}
            </option>
          ))}
        </select>
      );
    }

    return undefined;
  }, [
    surface.sessionKind,
    reasoningMode,
    data?.capabilityAgents,
    activeCapabilityAgentId,
    t,
    setActiveItemId,
  ]);

  const handleAnswerAskUser = async (
    runId: string,
    promptId: string,
    selectedAnswers: string[],
    freeformText?: string,
  ) => {
    const target = runs.find((r) => r.id === runId);
    const sessionId = target?.sourceSessionId ?? activeSession?.id;
    if (!sessionId) return;
    await startSessionAgentRun({
      sessionId,
      prompt: '',
      askUserAnswer: {
        promptId,
        selectedAnswers,
        ...(freeformText ? { freeformText } : {}),
      },
      ...(surface.sessionKind === 'COPILOT' ? { activeModelCode: selectedModel } : {}),
      ...(surface.sessionKind === 'REASONING' ? { reasoningMode } : {}),
    });
  };

  const runHandoffAction = async (
    runId: string,
    handoffId: string,
    action: 'accept' | 'decline',
    task: (sessionId: string) => Promise<void>,
  ) => {
    const target = runs.find((r) => r.id === runId);
    const sessionId = target?.sourceSessionId ?? activeSession?.id;
    if (!sessionId) return;
    setHandoffBusyById((prev) => ({ ...prev, [handoffId]: action }));
    try {
      await task(sessionId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setHandoffBusyById((prev) => {
        const next = { ...prev };
        delete next[handoffId];
        return next;
      });
    }
  };

  const handleAcceptStepHandoff = (runId: string, handoffId: string) =>
    runHandoffAction(runId, handoffId, 'accept', async (sessionId) => {
      const res = await acceptStepHandoff(sessionId, handoffId);
      if (res) {
        onNavigate(res.targetNavView);
      }
    });

  const handleDeclineStepHandoff = (runId: string, handoffId: string) =>
    runHandoffAction(runId, handoffId, 'decline', async (sessionId) => {
      await declineStepHandoff(sessionId, handoffId);
    });

  const handleOpenHandoffTargetStep = (targetStep: ProjectStepId, targetSessionId?: string) => {
    const targetView = getDefaultViewForStep(targetStep);
    setActiveNav(targetView, {
      ...(targetSessionId ? { sessionId: targetSessionId } : {}),
    });
    onNavigate(targetView);
  };

  const handleTriggerWriteback = async (writebackInterfaceId: string, actionTitle: string) => {
    try {
      const res = await apiPostJson<{
        writeback: WritebackInterface;
        writebackInterfaces: WritebackInterface[];
      }>(`/api/analytics/writebacks/${encodeURIComponent(writebackInterfaceId)}/execute`, {
        payloadOverride: {
          source: 'agent-panel-reasoning',
          actionTitle,
        },
      });
      patchData({ writebackInterfaces: res.writebackInterfaces });
      showToast(
        t(
          `策略回写已执行 [${res.writeback.id}]：${res.writeback.name}（累计调用 ${res.writeback.executionCount} 次）`,
          `Policy write-back executed [${res.writeback.id}]: ${res.writeback.name} (${res.writeback.executionCount} calls)`,
        ),
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const resolveComposerTurnImages = async (
    imageRefs?: AgentImageAttachmentRef[],
  ): Promise<TransientTurnImageInput[] | undefined> => {
    if (!imageRefs || imageRefs.length === 0) return undefined;
    if (resolvedVision.visionSupported) {
      return resolveTurnImagesForRequest(imageRefs);
    }
    return imageRefs.map((ref) => ({
      id: ref.id,
      name: ref.name,
      mimeType: ref.mimeType,
      ...(ref.remoteUrl ? { remoteUrl: ref.remoteUrl } : {}),
      ...(ref.width !== undefined ? { width: ref.width } : {}),
      ...(ref.height !== undefined ? { height: ref.height } : {}),
      role: ref.role ?? 'user_upload',
      textFallbackNote: ref.name,
    }));
  };

  const handleSubmitPrompt = async (
    prompt: string,
    imageRefs?: AgentImageAttachmentRef[],
  ) => {
    if (!activeProjectId || !data) return;
    const turnImages = await resolveComposerTurnImages(imageRefs);
    if (surface.sessionKind === 'PROTOTYPE_CO_DESIGN') {
      if (activePrototypeId) {
        if (turnImages && turnImages.length > 0 && (!prototypeSelectionAttachments || prototypeSelectionAttachments.length === 0)) {
          await useWorkbenchStore.getState().startPrototypeRefinementRun({
            projectId: activeProjectId,
            prototypeId: activePrototypeId,
            instruction: prompt,
            images: turnImages,
          });
        } else {
          await submitPrototypeComposerTurnWithSelections({
            projectId: activeProjectId,
            prototypeId: activePrototypeId,
            instruction: prompt,
            visionSupported: resolvedVision.visionSupported,
          });
        }
      } else {
        const targetSession =
          activeSession ??
          (await ensureProjectAgentSession(activeProjectId, 'PROTOTYPE_CO_DESIGN'));
        setActiveSessionId(targetSession.id);
        autoTitleSession(targetSession, prompt);
        await startSessionAgentRun({
          sessionId: targetSession.id,
          prompt,
          ...(turnImages && turnImages.length > 0 ? { images: turnImages } : {}),
          codeMode: effectiveCodeMode,
          multiAgentConcurrency: effectiveConcurrency,
        });
      }
      return;
    }

    const capAgent =
      surface.sessionKind === 'CAPABILITY'
        ? data.capabilityAgents.find((a) => a.id === activeCapabilityAgentId) ??
          data.capabilityAgents[0]
        : undefined;
    const targetProjectId = capAgent?.projectId ?? activeProjectId;
    const projectCodingApps =
      surface.sessionKind === 'CODING'
        ? data.assembledApplications.filter((app) => app.projectId === activeProjectId)
        : [];
    const codingTargetApp =
      surface.sessionKind === 'CODING'
        ? projectCodingApps.find((app) => app.id === activeItemId) ??
          (projectCodingApps.length === 1 ? projectCodingApps[0] : undefined)
        : undefined;
    const targetSession =
      activeSession ??
      (await ensureProjectAgentSession(targetProjectId, surface.sessionKind, {
        ...(capAgent ? { targetId: capAgent.id } : {}),
        ...(codingTargetApp ? { targetId: codingTargetApp.id } : {}),
        ...(surface.sessionKind === 'REASONING' ? { reasoningMode } : {}),
      }));
    setActiveSessionId(targetSession.id);
    autoTitleSession(targetSession, prompt);
    await startSessionAgentRun({
      sessionId: targetSession.id,
      prompt:
        surface.sessionKind === 'CODING' && !targetSession.targetId && codingTargetApp
          ? `[Target application ID: ${codingTargetApp.id}]\n${prompt}`
          : prompt,
      ...(turnImages && turnImages.length > 0 ? { images: turnImages } : {}),
      codeMode: effectiveCodeMode,
      multiAgentConcurrency: effectiveConcurrency,
      ...(surface.sessionKind === 'COPILOT' ? { activeModelCode: selectedModel } : {}),
      ...(surface.sessionKind === 'REASONING' ? { reasoningMode } : {}),
    });
  };

  const handleCancelRun = (runId: string) => {
    const target = runs.find((r) => r.id === runId);
    const sessionId = target?.sourceSessionId ?? activeSession?.id;
    if (sessionId) {
      void cancelSessionAgentRun(sessionId);
    }
  };

  const handleCancelActiveRun = () => {
    const activeRun = [...runs].reverse().find((r) => r.status === 'RUNNING');
    const sessionId = activeRun?.sourceSessionId ?? activeSession?.id;
    if (sessionId) {
      void cancelSessionAgentRun(sessionId);
    }
  };

  const handleRetryRun = (runId: string) => {
    const target = runs.find((r) => r.id === runId);
    const sessionId = target?.sourceSessionId ?? activeSession?.id;
    if (sessionId) {
      void retrySessionAgentRun(
        sessionId,
        target?.sourceUserMessageId ?? runId,
        target?.retryPrompt,
      );
    }
  };

  const handleEditLatestTurn = async (runId: string, nextPrompt: string) => {
    const target = runs.find((r) => r.id === runId);
    const sessionId = target?.sourceSessionId ?? activeSession?.id;
    if (!sessionId) return;
    await replaceLatestSessionTurnAndRun({
      sessionId,
      prompt: nextPrompt,
      ...(target?.sourceUserMessageId
        ? { truncateFromUserMessageId: target.sourceUserMessageId }
        : {}),
      codeMode: effectiveCodeMode,
      multiAgentConcurrency: effectiveConcurrency,
      ...(surface.sessionKind === 'COPILOT' ? { activeModelCode: selectedModel } : {}),
      ...(surface.sessionKind === 'REASONING' ? { reasoningMode } : {}),
    });
  };

  const handleRetryLatestTurn = async (runId: string) => {
    const target = runs.find((r) => r.id === runId);
    const sessionId = target?.sourceSessionId ?? activeSession?.id;
    if (!sessionId) return;
    await replaceLatestSessionTurnAndRun({
      sessionId,
      ...(target?.retryPrompt !== undefined ? { prompt: target.retryPrompt } : {}),
      ...(target?.sourceUserMessageId
        ? { truncateFromUserMessageId: target.sourceUserMessageId }
        : {}),
      codeMode: effectiveCodeMode,
      multiAgentConcurrency: effectiveConcurrency,
      ...(surface.sessionKind === 'COPILOT' ? { activeModelCode: selectedModel } : {}),
      ...(surface.sessionKind === 'REASONING' ? { reasoningMode } : {}),
    });
  };

  const handleOpenArtifact = (runId: string) => {
    const target = runs.find((r) => r.id === runId);
    if (target?.prototypeRevision && activeProjectId) {
      setActivePrototypeId(activeProjectId, target.prototypeRevision.prototypeId);
      setActiveNav('app-prototype', { itemId: target.prototypeRevision.prototypeId });
      return;
    }
    const navTarget = target?.artifact ? resolveArtifactNavTarget(target.artifact) : null;
    if (!navTarget) return;
    if (navTarget.prototypeId && activeProjectId) {
      setActivePrototypeId(activeProjectId, navTarget.prototypeId);
    }
    if (navTarget.modelCode) {
      setSelectedModel(navTarget.modelCode);
    }
    if (navTarget.elementId) {
      setSelectedElementId(navTarget.elementId);
    }
    setActiveNav(navTarget.view, ...(navTarget.itemId ? [{ itemId: navTarget.itemId }] : []));
  };

  const handleSelectPrototypeSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    if (!activeProjectId || !data) return;
    const picked = matchingSessions.find((s) => s.id === sessionId);
    const matchedProto = data.prototypes.find(
      (p) => p.coDesignSessionId === sessionId || (picked?.targetId && p.id === picked.targetId),
    );
    if (matchedProto) {
      setActivePrototypeId(activeProjectId, matchedProto.id);
    }
  };

  const artifactHistoryByRunId = useMemo(() => {
    const map = new Map<string, NonNullable<BootstrapPayload['artifactHistory']>>();
    for (const entry of data?.artifactHistory ?? []) {
      if (entry.source.kind !== 'AGENT_RUN') continue;
      const list = map.get(entry.source.runId) ?? [];
      list.push(entry);
      map.set(entry.source.runId, list);
    }
    return map;
  }, [data?.artifactHistory]);

  const handleJumpToArtifactTarget = (target: ArtifactJumpTarget) => {
    if (target.kind === 'REQUIREMENTS_SECTION') {
      setActiveNav('app-requirements');
      onNavigate('app-requirements');
      focusRequirementSection(target.sectionHeading, target.docId);
      return;
    }
    if (target.kind === 'PROTOTYPE_ANCHOR') {
      focusPrototypeTarget(target);
      onNavigate('app-prototype');
      setHoveredAnchor({
        ...(target.screenId ? { screenId: target.screenId } : {}),
        ...(target.elementId ? { elementId: target.elementId } : {}),
      });
      return;
    }
    if (target.kind === 'BUSINESS_OBJECT') {
      focusBusinessModelTarget(target);
      onNavigate('app-ontology');
    }
  };

  const renderRunFooter = (run: (typeof runs)[number]): React.ReactNode => {
    if (run.status === 'RUNNING') return null;
    const matched =
      artifactHistoryByRunId.get(run.id) ??
      (run.sourceUserMessageId ? artifactHistoryByRunId.get(run.sourceUserMessageId) : undefined);
    if (!matched || matched.length === 0) return null;

    const visibleEntries = matched.filter((entry) => entry.changeSummary.items.length > 0);
    if (visibleEntries.length === 0) return null;

    return (
      <div className="space-y-2">
        {visibleEntries.map((entry) => (
          <ChangeSummaryCard
            key={entry.id}
            summary={entry.changeSummary}
            undoing={undoingEntryId === entry.id}
            onUndo={async (summary) => {
              setUndoingEntryId(entry.id);
              try {
                await undoArtifactChange(
                  summary.artifactKind,
                  entry.id,
                  summary.artifactKind === 'PROTOTYPE' ? summary.targetId : undefined,
                );
              } finally {
                setUndoingEntryId(null);
              }
            }}
            onJumpToTarget={handleJumpToArtifactTarget}
            onCompareRevisions={(pair) => {
              openPrototypeRevisionCompare(pair);
              onNavigate('app-prototype');
            }}
            onOpenHistory={(kind) => {
              if (kind === 'REQUIREMENTS_DOC') {
                setActiveNav('app-requirements');
                onNavigate('app-requirements');
              } else if (kind === 'ONTOLOGY_SUITE') {
                setActiveNav('app-ontology');
                onNavigate('app-ontology');
              } else if (kind === 'PROTOTYPE') {
                setActiveNav('app-prototype');
                onNavigate('app-prototype');
              }
              openArtifactHistoryDrawer(kind);
            }}
          />
        ))}
      </div>
    );
  };

  return (
    <AgentPanel
      title={surface.title}
      {...(surface.subtitle ? { subtitle: surface.subtitle } : {})}
      runs={runs}
      presentationMode={surface.sessionKind === 'REQUIREMENT' ? 'conversation' : 'run-cards'}
      width={width}
      wideMode={wideMode}
      onToggleWideMode={toggleWideMode}
      overlay={overlay}
      side={side}
      closable={closable}
      {...(resizable !== undefined ? { resizable } : {})}
      {...(defaultHistoryOpen !== undefined ? { defaultHistoryOpen } : {})}
      onClose={onClose}
      onResize={(next, opts) => setWidth(next, opts)}
      onCancelRun={handleCancelRun}
      onCancelActiveRun={handleCancelActiveRun}
      onRetryRun={handleRetryRun}
      onEditLatestTurn={handleEditLatestTurn}
      onRetryLatestTurn={handleRetryLatestTurn}
      onOpenRunArtifact={handleOpenArtifact}
      onOpenPlatformSettings={() => onNavigate('llm-center')}
      onOpenLlmCenter={() => onNavigate('llm-center')}
      onHoverAnchor={setHoveredAnchor}
      onAnswerAskUser={(runId, promptId, selectedAnswers, freeformText) =>
        void handleAnswerAskUser(runId, promptId, selectedAnswers, freeformText)
      }
      onAcceptStepHandoff={(runId, handoffId) => void handleAcceptStepHandoff(runId, handoffId)}
      onDeclineStepHandoff={(runId, handoffId) => void handleDeclineStepHandoff(runId, handoffId)}
      onOpenHandoffTargetStep={handleOpenHandoffTargetStep}
      handoffBusyById={handoffBusyById}
      onTriggerWriteback={(writebackId, actionTitle) =>
        void handleTriggerWriteback(writebackId, actionTitle)
      }
      renderRunFooter={renderRunFooter}
      {...(sessionsOwnedByArtifact
        ? {
            sessions: sessionOptions,
            sessionsOwnedByArtifact: true,
            onSelectSession: handleSelectPrototypeSession,
            onRenameSession: handleRenameSession,
          }
        : {
            sessions: sessionOptions,
            onSelectSession: setActiveSessionId,
            onCreateSession: handleCreateSession,
            onRenameSession: handleRenameSession,
            onDeleteSession: handleDeleteSession,
          })}
      {...(surface.starters ? { starterPrompts: surface.starters } : {})}
      {...(activeSession?.id ? { activeSessionId: activeSession.id } : {})}
      draftFallbackKey={sessionScopeKey ?? surface.sessionKind}
      isForkSession={Boolean(activeSession?.parentSessionId)}
      {...(headerContextSlot ? { headerContextSlot } : {})}
      onSubmitPrompt={handleSubmitPrompt}
      {...(surface.placeholder ? { composerPlaceholder: surface.placeholder } : {})}
      {...(effectiveComposerHeaderSlot
        ? { composerHeaderSlot: effectiveComposerHeaderSlot }
        : {})}
      {...(queuedPrompts.length > 0 ? { queuedPrompts } : {})}
      {...(activeSession
        ? {
            onRemoveQueuedPrompt: (queueId: string) =>
              removeQueuedSessionPrompt(activeSession.id, queueId),
          }
        : {})}
      composerVisionSupported={resolvedVision.visionSupported}
      {...(resolvedVision.providerLabel ? { visionProviderLabel: resolvedVision.providerLabel } : {})}
      {...(resolvedVision.modelLabel ? { visionModelLabel: resolvedVision.modelLabel } : {})}
      {...(visionState
        ? {
            visionSupported: visionState.visionSupported,
          }
        : {})}
    />
  );
}
