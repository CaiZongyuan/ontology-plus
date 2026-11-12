import React, { useEffect, useMemo, useState } from 'react';
import type {
  AgentSession,
  AgentSessionKind,
  WritebackInterface,
} from '../../../packages/workspace-store/index.js';
import {
  apiPatchAgentSession,
  apiPostJson,
  getCurrentClientLocale,
  useWorkbenchStore,
  type BootstrapPayload,
  type SessionLiveDraft,
} from '../../api.js';
import { usePreferences, type NavViewId } from '../../i18n.js';
import { Button } from '../beautifui/index.js';
import { decideDesignBriefForMe } from '../prototype/DesignBriefAndStyleTile.js';
import { SelectionAttachmentStrip } from '../prototype/SelectionAttachmentStrip.js';
import {
  submitPrototypeComposerTurnWithSelections,
  usePrototypeSelectionStore,
} from '../prototype/prototypeSelectionStore.js';
import { AgentPanel } from './AgentPanel.js';
import { AGENT_PANEL_OVERLAY_QUERY, useAgentPanelStore } from './agentPanelStore.js';
import {
  agentRunsFromSession,
  summarizeUserPromptTitle,
  type LocalizedText,
} from './agentRun.js';
import { resolveActiveVisionCapability } from './VisionAttachmentControls.js';

export interface AgentPanelSurface {
  /** Name of the Agent Session this module shows. */
  title: LocalizedText;
  /** Durable Agent Session kind bound to this module's Agent Panel. */
  sessionKind: AgentSessionKind;
  /** Whether this module's agent uses visual references/uploads and should warn if vision is unsupported. */
  usesVision?: boolean;
  /** Whether conversation is the primary workflow on this page (auto-reveals Wide Mode). */
  conversationPrimary?: boolean;
  /** Contextual composer placeholder for this module. */
  placeholder?: LocalizedText;
}

/**
 * Every workbench view maps to its owning project specialist Agent Session (ADR 0009),
 * so the right-hand ShellAgentPanel stays available across all 24 views.
 */
export const AGENT_PANEL_SURFACES: Record<NavViewId, AgentPanelSurface> = {
  overview: {
    title: { zh: '工程概览与全流程助手', en: 'Project Overview Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问工程阶段进展或发起本体协同操作…',
      en: 'Ask about project lifecycle status or run ontology copilot actions…',
    },
  },
  'app-req-explore': {
    title: { zh: '需求探索与 SRS 合成', en: 'Requirement & SRS Agent' },
    sessionKind: 'REQUIREMENT',
    conversationPrimary: true,
    placeholder: {
      zh: '描述业务场景、核心角色或规则阈值（Enter 发送，Shift+Enter 换行）…',
      en: 'Describe domain workflows, roles, or rule thresholds (Enter to send)…',
    },
  },
  'app-req-docs': {
    title: { zh: '需求规格合成助手', en: 'SRS Synthesis Agent' },
    sessionKind: 'REQUIREMENT',
    placeholder: {
      zh: '输入需求补充说明或触发九章节 SRS 合成…',
      en: 'Add requirement notes or synthesize the 9-chapter SRS…',
    },
  },
  'app-prototype': {
    title: { zh: '原型共创', en: 'Prototype Co-Design' },
    sessionKind: 'PROTOTYPE_CO_DESIGN',
    usesVision: true,
    placeholder: {
      zh: '输入局部精修指令（Enter 发送，Shift+Enter 换行）…',
      en: 'Describe a prototype refinement (Enter to send, Shift+Enter for newline)…',
    },
  },
  'app-ontology': {
    title: { zh: '本体建模与 11 模型合成', en: 'Ontology Copilot & Synthesis' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '输入本体建模指令（如：新增 M3 业务规则或从原型合成 11 模型）…',
      en: 'Describe an ontology change (e.g. upsert M3 rule or synthesize 11-model suite)…',
    },
  },
  'app-model-files': {
    title: { zh: '本体模型文件与校验助手', en: 'Model Files & Validation Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问模型 YAML 契约或修复一致性校验问题…',
      en: 'Inspect YAML contracts or resolve consistency validation findings…',
    },
  },
  'app-knowledge-graph': {
    title: { zh: '本体知识图谱助手', en: 'Knowledge Graph Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问聚合根跨层关联、血缘影响或补充模型映射…',
      en: 'Explore cross-model lineage, impact paths, or ontology links…',
    },
  },
  'app-four-layer-assets': {
    title: { zh: '技术架构规范生成助手', en: 'Tech Architecture Agent' },
    sessionKind: 'CODING',
    placeholder: {
      zh: '描述技术栈约束或生成四层技术架构规范…',
      en: 'Specify stack constraints or generate a 4-layer tech architecture spec…',
    },
  },
  'app-assembly-dev': {
    title: { zh: '应用装配与开发包编译', en: 'Assembly & Coding Agent' },
    sessionKind: 'CODING',
    placeholder: {
      zh: '输入研发装配、接口契约检查或编译《开发指导书》指令…',
      en: 'Ask the Coding Agent to inspect bindings or compile the Dev Guidebook…',
    },
  },
  'app-skills': {
    title: { zh: '领域 SKILL 资产助手', en: 'Domain SKILL Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '围绕本体派生 SKILL 指令集提出优化或校验问题…',
      en: 'Refine or inspect ontology-derived SKILL assets…',
    },
  },
  'app-publish': {
    title: { zh: '研发资料包与发布助手', en: 'Package & Release Agent' },
    sessionKind: 'CODING',
    placeholder: {
      zh: '检查交付资料包清单或编译导出研发指导资产…',
      en: 'Check release artifacts or compile progressive-disclosure dev guides…',
    },
  },
  'cap-systems': {
    title: { zh: '存量系统接入与能力助手', en: 'Legacy Systems Capability Agent' },
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '询问存量系统接入契约、数据源配置或发起能力萃取…',
      en: 'Ask about legacy system contracts, connectors, or capability extraction…',
    },
  },
  'cap-extraction': {
    title: { zh: '存量系统本体萃取智能体', en: 'Ontology Extraction Agent' },
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '解析 DDL / OpenAPI 萃取本体候选，或询问候选对齐策略…',
      en: 'Extract ontology candidates from DDL / OpenAPI or align candidates…',
    },
  },
  'cap-mcp': {
    title: { zh: '本体 MCP 服务助手', en: 'Ontology MCP Capability Agent' },
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '探查本体编译生成的 MCP 工具契约与资源端点…',
      en: 'Inspect compiled Ontology MCP tool schemas and resource endpoints…',
    },
  },
  'cap-agents': {
    title: { zh: '能力智能体对话 (MCP + SKILL)', en: 'Capability Smart Chat (MCP + SKILL)' },
    sessionKind: 'CAPABILITY',
    conversationPrimary: true,
    placeholder: {
      zh: '输入业务指令以调用本体 MCP 工具与领域 SKILL（Enter 发送）…',
      en: 'Send a business query to invoke Ontology MCP tools & SKILL rules…',
    },
  },
  'cap-cross-flows': {
    title: { zh: '跨系统编排能力助手', en: 'Cross-System Flow Agent' },
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '梳理跨系统事件编排、接口调用链与补偿规则…',
      en: 'Design cross-system event orchestration and compensation rules…',
    },
  },
  'cap-knowledge': {
    title: { zh: '领域知识库与能力助手', en: 'Domain Knowledge Agent' },
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '结合领域知识条目与 MCP 能力进行检索问答…',
      en: 'Query domain knowledge entries alongside Ontology MCP capabilities…',
    },
  },
  'data-resources': {
    title: { zh: '数据资源与数据本体助手', en: 'Data Resource Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '分析数据库表结构、元数据约定或发起数据本体抽取…',
      en: 'Inspect database schemas, metadata conventions, or data ontology alignment…',
    },
  },
  'data-mappings': {
    title: { zh: '语义映射与字段对齐助手', en: 'Semantic Mapping Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '检查 M1 聚合属性与物理库表字段之间的 ME/MM 语义映射…',
      en: 'Verify ME/MM semantic mappings between M1 attributes and physical columns…',
    },
  },
  'data-metrics-reports': {
    title: { zh: '指标洞察与场景归因', en: 'Metric Insight & Attribution' },
    sessionKind: 'REASONING',
    placeholder: {
      zh: '输入指标异动追问或多维场景归因指令…',
      en: 'Ask about metric anomalies or multi-dimensional scenario attribution…',
    },
  },
  'data-reasoning': {
    title: { zh: '三段式数据本体推理', en: '3-Stage Data Ontology Reasoning' },
    sessionKind: 'REASONING',
    conversationPrimary: true,
    placeholder: {
      zh: '输入问数 / 问因 / 问策问题（结合 M1 对象关联、M3 规则阈值与回写接口）…',
      en: 'Ask Data / Why / Policy questions grounded in M1 objects, M3 rules & write-backs…',
    },
  },
  'data-writeback': {
    title: { zh: '策略回写与闭环推理助手', en: 'Policy Write-Back Reasoning Agent' },
    sessionKind: 'REASONING',
    placeholder: {
      zh: '推演策略回写动作影响并校验 M7/ME 执行契约…',
      en: 'Evaluate policy write-back impact and M7/ME execution contracts…',
    },
  },
  'llm-center': {
    title: { zh: '模型网关与工作台助手', en: 'LLM Gateway & Workbench Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问网关配置要求、多模态视觉支持或测试建议…',
      en: 'Ask about gateway configuration, vision support, or model routing…',
    },
  },
  'system-settings': {
    title: { zh: '平台治理与工作台助手', en: 'Platform Governance Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问工作区设置、离线演示模式或本体治理规范…',
      en: 'Ask about workspace settings, demo mock mode, or governance rules…',
    },
  },
};

export function agentPanelSurfaceFor(view: NavViewId): AgentPanelSurface {
  return AGENT_PANEL_SURFACES[view];
}

export function defaultNavForSessionKind(kind: AgentSessionKind): NavViewId {
  switch (kind) {
    case 'REQUIREMENT':
      return 'app-req-explore';
    case 'PROTOTYPE_CO_DESIGN':
      return 'app-prototype';
    case 'COPILOT':
      return 'app-ontology';
    case 'CODING':
      return 'app-assembly-dev';
    case 'CAPABILITY':
      return 'cap-agents';
    case 'REASONING':
      return 'data-reasoning';
  }
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
    const session = list.find((s) => s.id === opts?.activeSessionId) ?? list[0];
    return {
      session,
      matchingSessions: list,
      activePrototypeId: undefined,
      activeCapabilityAgentId: activeCapAgent?.id,
    };
  }

  const matching = sessions
    .filter((s) => s.projectId === activeProjectId && s.agentKind === surface.sessionKind)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const session = matching.find((s) => s.id === opts?.activeSessionId) ?? matching[0];
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
    ensureProjectAgentSession,
    startPrototypeBriefGenerationRun,
    startSessionAgentRun,
    cancelSessionAgentRun,
    retrySessionAgentRun,
    removeQueuedSessionPrompt,
  } = useWorkbenchStore();
  const width = useAgentPanelStore((s) => s.width);
  const wideMode = useAgentPanelStore((s) => s.wideMode);
  const setWidth = useAgentPanelStore((s) => s.setWidth);
  const toggleWideMode = useAgentPanelStore((s) => s.toggleWideMode);
  const setHoveredAnchor = useAgentPanelStore((s) => s.setHoveredAnchor);
  const activeProjectId = data?.activeProject?.id;

  const [reasoningMode, setReasoningMode] = useState<'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY'>(
    'ASK_POLICY',
  );

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
      }),
    [surface, data, activePrototypeIdByProject, activeItemId, activeSessionId],
  );

  useEffect(() => {
    if (activeSession?.reasoningMode) {
      setReasoningMode(activeSession.reasoningMode);
    }
  }, [activeSession?.id, activeSession?.reasoningMode]);

  const liveDraft = activeSession ? liveSessionDrafts[activeSession.id] : undefined;
  const queuedItems = activeSession ? (sessionQueues[activeSession.id] ?? []) : [];

  const runs = useMemo(
    () => agentRunsFromSession(activeSession, liveDraft),
    [activeSession, liveDraft],
  );

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

  const sessionOptions = useMemo(
    () =>
      matchingSessions.map((s) => ({
        id: s.id,
        title: s.title,
        isFork: Boolean(s.parentSessionId),
      })),
    [matchingSessions],
  );

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
          aria-label={t('选择能力智能体', 'Select Capability Agent')}
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

  const handleSubmitPrompt = async (prompt: string) => {
    if (!activeProjectId || !data) return;
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
        const locale = getCurrentClientLocale();
        const decided = await decideDesignBriefForMe({
          project: data.activeProject,
          ...(data.requirementDocs[0] ? { doc: data.requirementDocs[0] } : {}),
          userFeelNote: prompt,
          locale,
        });
        await startPrototypeBriefGenerationRun({
          projectId: activeProjectId,
          prompt,
          designBrief: decided.brief,
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
    const targetSession =
      activeSession ??
      (await ensureProjectAgentSession(targetProjectId, surface.sessionKind, {
        ...(capAgent ? { targetId: capAgent.id } : {}),
        ...(surface.sessionKind === 'REASONING' ? { reasoningMode } : {}),
      }));
    setActiveSessionId(targetSession.id);
    await startSessionAgentRun({
      sessionId: targetSession.id,
      prompt,
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

  const handleRetryRun = (runId: string) => {
    const target = runs.find((r) => r.id === runId);
    const sessionId = target?.sourceSessionId ?? activeSession?.id;
    if (sessionId) {
      void retrySessionAgentRun(sessionId, target?.sourceUserMessageId ?? runId);
    }
  };

  const handleOpenArtifact = (runId: string) => {
    const target = runs.find((r) => r.id === runId);
    if (target?.prototypeRevision && activeProjectId) {
      setActivePrototypeId(activeProjectId, target.prototypeRevision.prototypeId);
      setActiveNav('app-prototype', { itemId: target.prototypeRevision.prototypeId });
      return;
    }
    const art = target?.artifact;
    if (!art) return;
    switch (art.kind) {
      case 'PROTOTYPE_REVISION':
        if (activeProjectId) {
          setActivePrototypeId(activeProjectId, art.prototypeId);
        }
        setActiveNav('app-prototype', { itemId: art.prototypeId });
        return;
      case 'REQUIREMENT_DOC':
        setActiveNav('app-req-docs', { itemId: art.docId });
        return;
      case 'ONTOLOGY_SUITE':
        setActiveNav('app-ontology');
        return;
      case 'ONTOLOGY_DIFF':
        if (art.modelCode) {
          setSelectedModel(art.modelCode);
        }
        if (art.changes[0]?.id) {
          setSelectedElementId(art.changes[0].id);
        }
        setActiveNav('app-ontology');
        return;
      case 'TECH_ARCH_ASSET':
        setActiveNav('app-four-layer-assets', { itemId: art.assetId });
        return;
      case 'CODING_PACKAGE':
        setActiveNav('app-assembly-dev', { itemId: art.appId });
        return;
      case 'METRIC_INSIGHT':
        setActiveNav('data-metrics-reports', { itemId: art.metricId });
        return;
      case 'ANALYTICS_REPORT':
        setActiveNav('data-metrics-reports', { itemId: art.reportId });
        return;
      case 'REASONING_POLICY':
      case 'SQL_PREVIEW':
        setActiveNav('data-reasoning');
        return;
      case 'EXTRACTION_JOB':
        setActiveNav('cap-extraction', { itemId: art.jobId });
        return;
      default:
        break;
    }
  };

  const allowPrototypeSessionSelect =
    surface.sessionKind === 'PROTOTYPE_CO_DESIGN' && (data?.prototypes?.length ?? 0) > 1;

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

  return (
    <AgentPanel
      title={surface.title}
      runs={runs}
      width={width}
      wideMode={wideMode}
      onToggleWideMode={toggleWideMode}
      overlay={overlay}
      onClose={onClose}
      onResize={(next, opts) => setWidth(next, opts)}
      onCancelRun={handleCancelRun}
      onRetryRun={handleRetryRun}
      onOpenRunArtifact={handleOpenArtifact}
      onOpenLlmCenter={() => onNavigate('llm-center')}
      onHoverAnchor={setHoveredAnchor}
      onAnswerAskUser={(runId, promptId, selectedAnswers, freeformText) =>
        void handleAnswerAskUser(runId, promptId, selectedAnswers, freeformText)
      }
      onTriggerWriteback={(writebackId, actionTitle) =>
        void handleTriggerWriteback(writebackId, actionTitle)
      }
      {...(allowPrototypeSessionSelect
        ? {
            sessions: sessionOptions,
            onSelectSession: handleSelectPrototypeSession,
          }
        : {})}
      {...(activeSession?.id ? { activeSessionId: activeSession.id } : {})}
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
      {...(visionState
        ? {
            visionSupported: visionState.visionSupported,
            ...(visionState.providerLabel ? { visionProviderLabel: visionState.providerLabel } : {}),
          }
        : {})}
    />
  );
}
