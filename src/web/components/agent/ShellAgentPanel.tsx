import React, { useEffect, useMemo, useState } from 'react';
import { type BackgroundPipelineTaskKind, useWorkbenchStore } from '../../api.js';
import type { NavViewId } from '../../i18n.js';
import { AgentPanel } from './AgentPanel.js';
import { AGENT_PANEL_OVERLAY_QUERY, useAgentPanelStore } from './agentPanelStore.js';
import { agentRunFromPipelineTask, type LocalizedText } from './agentRun.js';

export interface AgentPanelSurface {
  /** Name of the Agent Session this module shows. */
  title: LocalizedText;
  /** Legacy pipeline tasks that belong to this module's agent until they become session runs. */
  taskKinds: BackgroundPipelineTaskKind[];
}

/**
 * Modules that show the Agent Panel. A module joins by adding an entry here;
 * the rollout order is in ADR 0009's spec (Interactive Prototype first).
 */
const AGENT_PANEL_SURFACES: Partial<Record<NavViewId, AgentPanelSurface>> = {
  'app-prototype': {
    title: { zh: '原型共创', en: 'Prototype Co-Design' },
    taskKinds: ['PROTOTYPE_GEN'],
  },
};

export function agentPanelSurfaceFor(view: NavViewId): AgentPanelSurface | undefined {
  return AGENT_PANEL_SURFACES[view];
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
}

/** Binds the Agent Panel to the workbench store for the module in view. */
export function ShellAgentPanel({ surface, overlay, onClose, onNavigate }: ShellAgentPanelProps) {
  const {
    data,
    backgroundTasks,
    cancelBackgroundTask,
    retryBackgroundTask,
    openBackgroundTaskResult,
  } = useWorkbenchStore();
  const width = useAgentPanelStore((s) => s.width);
  const setWidth = useAgentPanelStore((s) => s.setWidth);
  const activeProjectId = data?.activeProject.id;

  const runs = useMemo(
    () =>
      backgroundTasks
        .filter((tk) => tk.projectId === activeProjectId && surface.taskKinds.includes(tk.kind))
        .sort((a, b) => a.startedAt - b.startedAt)
        .map(agentRunFromPipelineTask),
    [backgroundTasks, activeProjectId, surface],
  );

  return (
    <AgentPanel
      title={surface.title}
      runs={runs}
      width={width}
      overlay={overlay}
      onClose={onClose}
      onResize={(next, opts) => setWidth(next, opts)}
      onCancelRun={cancelBackgroundTask}
      onRetryRun={(runId) => void retryBackgroundTask(runId)}
      onOpenRunArtifact={(runId) => void openBackgroundTaskResult(runId)}
      onOpenLlmCenter={() => onNavigate('llm-center')}
    />
  );
}
