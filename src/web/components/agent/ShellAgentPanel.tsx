import React, { useEffect, useMemo, useState } from 'react';
import type { AgentSession, AgentSessionKind } from '../../../packages/workspace-store/index.js';
import {
  useWorkbenchStore,
  type BackgroundPipelineTask,
  type BackgroundPipelineTaskKind,
  type BootstrapPayload,
  type SessionLiveDraft,
} from '../../api.js';
import type { NavViewId } from '../../i18n.js';
import { AgentPanel } from './AgentPanel.js';
import { AGENT_PANEL_OVERLAY_QUERY, useAgentPanelStore } from './agentPanelStore.js';
import {
  agentRunFromPipelineTask,
  agentRunsFromSession,
  summarizeUserPromptTitle,
  type LocalizedText,
} from './agentRun.js';
import { resolveActiveVisionCapability } from './VisionAttachmentControls.js';
import { SelectionAttachmentStrip } from '../prototype/SelectionAttachmentStrip.js';
import {
  submitPrototypeComposerTurnWithSelections,
  usePrototypeSelectionStore,
} from '../prototype/prototypeSelectionStore.js';

export interface AgentPanelSurface {
  /** Name of the Agent Session this module shows. */
  title: LocalizedText;
  /** Durable Agent Session kind bound to this module's Agent Panel. */
  sessionKind?: AgentSessionKind;
  /** Legacy pipeline tasks that belong to this module's agent until they become session runs. */
  taskKinds: BackgroundPipelineTaskKind[];
  /** Whether this module's agent uses visual references/uploads and should warn if vision is unsupported. */
  usesVision?: boolean;
}

/**
 * Modules that show the Agent Panel. A module joins by adding an entry here;
 * the rollout order is in ADR 0009's spec (Interactive Prototype first).
 */
const AGENT_PANEL_SURFACES: Partial<Record<NavViewId, AgentPanelSurface>> = {
  'app-prototype': {
    title: { zh: '原型共创', en: 'Prototype Co-Design' },
    sessionKind: 'PROTOTYPE_CO_DESIGN',
    taskKinds: ['PROTOTYPE_GEN'],
    usesVision: true,
  },
};

export function agentPanelSurfaceFor(view: NavViewId): AgentPanelSurface | undefined {
  return AGENT_PANEL_SURFACES[view];
}

export function resolveSurfaceAgentSession(
  surface: AgentPanelSurface,
  data: BootstrapPayload | null,
  opts?: {
    activePrototypeIdByProject?: Record<string, string>;
    activeItemId?: string | null;
    activeSessionId?: string | null;
  },
): {
  session: AgentSession | undefined;
  activePrototypeId: string | undefined;
} {
  const activeProjectId = data?.activeProject?.id;
  if (!activeProjectId || !surface.sessionKind) {
    return { session: undefined, activePrototypeId: undefined };
  }

  const sessions = data?.agentSessions ?? [];
  if (surface.sessionKind === 'PROTOTYPE_CO_DESIGN') {
    const prototypes = data?.prototypes ?? [];
    // If activeSessionId explicitly points to an unbound PROTOTYPE_CO_DESIGN session (e.g. Briefing Stage Revision #1 run), surface it immediately
    const explicitUnbound = opts?.activeSessionId
      ? sessions.find(
          (s) =>
            s.id === opts.activeSessionId &&
            s.projectId === activeProjectId &&
            s.agentKind === 'PROTOTYPE_CO_DESIGN' &&
            !s.targetId &&
            !prototypes.some((p) => p.coDesignSessionId === s.id),
        )
      : undefined;
    if (explicitUnbound) {
      return { session: explicitUnbound, activePrototypeId: undefined };
    }

    const preferredProtoId =
      opts?.activePrototypeIdByProject?.[activeProjectId] ||
      opts?.activeItemId ||
      data?.confirmedPrototypeRevision?.prototypeId;
    const activeProto =
      prototypes.find((p) => p.id === preferredProtoId) ?? prototypes[0];

    const session = sessions.find(
      (s) =>
        (activeProto?.coDesignSessionId && s.id === activeProto.coDesignSessionId) ||
        (s.projectId === activeProjectId &&
          s.agentKind === 'PROTOTYPE_CO_DESIGN' &&
          (!activeProto || s.targetId === activeProto.id)),
    );
    return { session, activePrototypeId: activeProto?.id };
  }

  const matching = sessions
    .filter((s) => s.projectId === activeProjectId && s.agentKind === surface.sessionKind)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const session =
    matching.find((s) => s.id === opts?.activeSessionId) ?? matching[0];
  return { session, activePrototypeId: undefined };
}

export function countSurfaceRunningRuns(
  surface: AgentPanelSurface | undefined,
  state: {
    data: BootstrapPayload | null;
    backgroundTasks: BackgroundPipelineTask[];
    liveSessionDrafts: Record<string, SessionLiveDraft>;
    activePrototypeIdByProject?: Record<string, string>;
    activeItemId?: string | null;
    activeSessionId?: string | null;
  },
): number {
  if (!surface || !state.data?.activeProject?.id) return 0;
  const projectId = state.data.activeProject.id;
  const pipelineRunning = state.backgroundTasks.filter(
    (tk) => tk.status === 'RUNNING' && tk.projectId === projectId && surface.taskKinds.includes(tk.kind),
  ).length;
  const { session } = resolveSurfaceAgentSession(surface, state.data, {
    activePrototypeIdByProject: state.activePrototypeIdByProject,
    activeItemId: state.activeItemId,
    activeSessionId: state.activeSessionId,
  });
  const sessionRunning =
    session && (Boolean(state.liveSessionDrafts[session.id]) || session.status === 'RUNNING')
      ? 1
      : 0;
  return pipelineRunning + sessionRunning;
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
  onClose: () => void;
  onNavigate: (view: NavViewId) => void;
  composerHeaderSlot?: React.ReactNode;
}

/** Binds the Agent Panel to the workbench store for the module in view. */
export function ShellAgentPanel({
  surface,
  overlay,
  onClose,
  onNavigate,
  composerHeaderSlot,
}: ShellAgentPanelProps) {
  const {
    data,
    activeItemId,
    activeSessionId,
    activePrototypeIdByProject,
    liveSessionDrafts,
    sessionQueues,
    backgroundTasks,
    setActiveNav,
    setActivePrototypeId,
    startPrototypeGenTask,
    startSessionAgentRun,
    cancelSessionAgentRun,
    retrySessionAgentRun,
    removeQueuedSessionPrompt,
    cancelBackgroundTask,
    retryBackgroundTask,
    openBackgroundTaskResult,
  } = useWorkbenchStore();
  const width = useAgentPanelStore((s) => s.width);
  const setWidth = useAgentPanelStore((s) => s.setWidth);
  const setHoveredAnchor = useAgentPanelStore((s) => s.setHoveredAnchor);
  const activeProjectId = data?.activeProject?.id;

  const { session: activeSession, activePrototypeId } = useMemo(
    () =>
      resolveSurfaceAgentSession(surface, data, {
        activePrototypeIdByProject,
        activeItemId,
        activeSessionId,
      }),
    [surface, data, activePrototypeIdByProject, activeItemId, activeSessionId],
  );

  const liveDraft = activeSession ? liveSessionDrafts[activeSession.id] : undefined;
  const queuedItems = activeSession ? (sessionQueues[activeSession.id] ?? []) : [];

  const runs = useMemo(() => {
    const pipelineRuns = backgroundTasks
      .filter((tk) => tk.projectId === activeProjectId && surface.taskKinds.includes(tk.kind))
      .map(agentRunFromPipelineTask);
    const sessionRuns = agentRunsFromSession(activeSession, liveDraft);
    return [...pipelineRuns, ...sessionRuns].sort((a, b) => a.startedAt - b.startedAt);
  }, [backgroundTasks, activeProjectId, surface, activeSession, liveDraft]);

  const queuedPrompts = useMemo(
    () =>
      queuedItems.map((q) => {
        const title = summarizeUserPromptTitle(q.prompt, q.displayTitle);
        return { id: q.id, label: title.zh };
      }),
    [queuedItems],
  );

  const visionState = useMemo(
    () => (surface.usesVision ? resolveActiveVisionCapability(data) : undefined),
    [data, surface.usesVision],
  );

  const prototypeSelectionAttachments = usePrototypeSelectionStore((s) =>
    activePrototypeId ? s.attachmentsByPrototype[activePrototypeId] : undefined,
  );

  const effectiveComposerHeaderSlot =
    composerHeaderSlot ??
    (surface.sessionKind === 'PROTOTYPE_CO_DESIGN' &&
    activePrototypeId &&
    prototypeSelectionAttachments &&
    prototypeSelectionAttachments.length > 0 ? (
      <SelectionAttachmentStrip prototypeId={activePrototypeId} />
    ) : undefined);

  const handleSubmitPrompt = async (prompt: string) => {
    if (!activeProjectId) return;
    if (surface.sessionKind === 'PROTOTYPE_CO_DESIGN') {
      if (activePrototypeId) {
        await submitPrototypeComposerTurnWithSelections({
          projectId: activeProjectId,
          prototypeId: activePrototypeId,
          instruction: prompt,
          visionSupported: visionState?.visionSupported ?? true,
        });
      } else if (activeSession) {
        await startSessionAgentRun({
          sessionId: activeSession.id,
          prompt,
        });
      } else {
        await startPrototypeGenTask({ prompt });
      }
      return;
    }
    if (activeSession) {
      await startSessionAgentRun({
        sessionId: activeSession.id,
        prompt,
      });
    }
  };

  const handleCancelRun = (runId: string) => {
    const target = runs.find((r) => r.id === runId);
    if (target?.sourceSessionId) {
      void cancelSessionAgentRun(target.sourceSessionId);
      return;
    }
    cancelBackgroundTask(runId);
  };

  const handleRetryRun = (runId: string) => {
    const target = runs.find((r) => r.id === runId);
    if (target?.sourceSessionId) {
      void retrySessionAgentRun(
        target.sourceSessionId,
        target.sourceUserMessageId ?? target.id,
      );
      return;
    }
    void retryBackgroundTask(runId);
  };

  const handleOpenArtifact = (runId: string) => {
    const target = runs.find((r) => r.id === runId);
    if (target?.prototypeRevision && activeProjectId) {
      setActivePrototypeId(activeProjectId, target.prototypeRevision.prototypeId);
      setActiveNav('app-prototype', { itemId: target.prototypeRevision.prototypeId });
      return;
    }
    void openBackgroundTaskResult(runId);
  };

  return (
    <AgentPanel
      title={surface.title}
      runs={runs}
      width={width}
      overlay={overlay}
      onClose={onClose}
      onResize={(next, opts) => setWidth(next, opts)}
      onCancelRun={handleCancelRun}
      onRetryRun={handleRetryRun}
      onOpenRunArtifact={handleOpenArtifact}
      onOpenLlmCenter={() => onNavigate('llm-center')}
      onHoverAnchor={setHoveredAnchor}
      {...(surface.sessionKind ? { onSubmitPrompt: handleSubmitPrompt } : {})}
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
      {...(visionState
        ? {
            visionSupported: visionState.visionSupported,
            ...(visionState.providerLabel ? { visionProviderLabel: visionState.providerLabel } : {}),
          }
        : {})}
    />
  );
}
