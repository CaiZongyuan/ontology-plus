import { create } from 'zustand';
import type {
  ImpactAnalysisReport,
  ModelCode,
  OntologySuite,
} from '../packages/ontology-core/index.js';
import type {
  AgentAskUserPrompt,
  AgentDomainArtifact,
  AgentSession,
  AgentSessionKind,
  AgentToolCallTrace,
  AnalyticsQueryResult,
  AnalyticsReport,
  AnalyticsScenario,
  AssembledApplication,
  CapabilityAgent,
  CapabilityChatSession,
  CrossSystemFlow,
  DataDocument,
  DataMappingRule,
  DatabaseResource,
  ExtractionJob,
  FourLayerAsset,
  GeneratedSkill,
  KnowledgeEntry,
  LegacySystemConfig,
  LlmProviderConfig,
  McpServerConfig,
  MetricDefinition,
  ProjectDetail,
  ProjectSnapshot,
  ProjectSummary,
  PrototypeArtifact,
  ReasoningSession,
  RequirementDoc,
  RequirementSession,
  SystemSettingsState,
  WritebackInterface,
} from '../packages/workspace-store/index.js';
import type {
  AppCodingAgentResult,
  CapabilitySmartChatResult,
  LlmPingResult,
  MetricInsightResult,
  OntologyCopilotResult,
  OntologySynthesisFromPrototypeResult,
  PrototypeGenerationResult,
  RequirementDocSynthesisResult,
  ScenarioAttributionResult,
  TechArchitectureGenerationResult,
} from '../packages/agent-runtime/index.js';
import type {
  CompiledDevelopmentPackage,
  McpResourceDefinition,
  McpToolDefinition,
} from '../packages/package-compiler/index.js';

export interface BootstrapPayload {
  projects: ProjectSummary[];
  activeProject: ProjectDetail;
  projectSnapshots: ProjectSnapshot[];
  agentSessions: AgentSession[];
  requirementSessions: RequirementSession[];
  requirementDocs: RequirementDoc[];
  prototypes: PrototypeArtifact[];
  fourLayerAssets: FourLayerAsset[];
  assembledApplications: AssembledApplication[];
  generatedSkills: GeneratedSkill[];
  legacySystems: LegacySystemConfig[];
  extractionJobs: ExtractionJob[];
  mcpServers: McpServerConfig[];
  capabilityAgents: CapabilityAgent[];
  capabilityChatSessions: CapabilityChatSession[];
  crossSystemFlows: CrossSystemFlow[];
  knowledgeEntries: KnowledgeEntry[];
  databaseResources: DatabaseResource[];
  dataDocuments: DataDocument[];
  dataMappings: DataMappingRule[];
  metrics: MetricDefinition[];
  analyticsScenarios: AnalyticsScenario[];
  analyticsReports: AnalyticsReport[];
  reasoningSessions: ReasoningSession[];
  writebackInterfaces: WritebackInterface[];
  llmProviders: LlmProviderConfig[];
  systemSettings: SystemSettingsState;
}

// ─── URL Deep-Link State Sync (projectId / nav / itemId / sessionId) ─────────

export interface UrlNavState {
  projectId?: string;
  nav?: string;
  itemId?: string;
  sessionId?: string;
}

export function readUrlNavState(): UrlNavState {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const hashNav = window.location.hash.replace(/^#\/?/, '').trim();
  const projectId = params.get('projectId') || undefined;
  const nav = params.get('mode') || hashNav || undefined;
  const itemId = params.get('itemId') || undefined;
  const sessionId = params.get('sessionId') || undefined;
  return {
    ...(projectId ? { projectId } : {}),
    ...(nav ? { nav } : {}),
    ...(itemId ? { itemId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function writeUrlNavState(patch: UrlNavState): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (patch.projectId !== undefined) {
    if (patch.projectId) url.searchParams.set('projectId', patch.projectId);
    else url.searchParams.delete('projectId');
  }
  if (patch.nav !== undefined) {
    if (patch.nav) {
      url.searchParams.set('mode', patch.nav);
      url.hash = `#/${patch.nav}`;
    } else {
      url.searchParams.delete('mode');
    }
  }
  if (patch.itemId !== undefined) {
    if (patch.itemId) url.searchParams.set('itemId', patch.itemId);
    else url.searchParams.delete('itemId');
  }
  if (patch.sessionId !== undefined) {
    if (patch.sessionId) url.searchParams.set('sessionId', patch.sessionId);
    else url.searchParams.delete('sessionId');
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

interface WorkbenchStoreState {
  data: BootstrapPayload | null;
  loading: boolean;
  toast: string | null;
  activeNav: string;
  activeItemId: string | null;
  activeSessionId: string | null;
  undoStack: OntologySuite[];
  redoStack: OntologySuite[];
  selectedModel: ModelCode;
  selectedElementId: string | null;
  setActiveNav: (nav: string, opts?: { itemId?: string | null; sessionId?: string | null }) => void;
  setActiveItemId: (itemId: string | null) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setSelectedModel: (code: ModelCode, elementId?: string | null) => void;
  setSelectedElementId: (elementId: string | null) => void;
  showToast: (msg: string) => void;
  bootstrap: (projectId?: string) => Promise<void>;
  switchProject: (projectId: string) => Promise<void>;
  createNewProject: (input: {
    name: string;
    code: string;
    center: 'APPLICATION' | 'CAPABILITY' | 'ANALYTICS';
    domain: string;
    description?: string;
    template: 'CONTRACT' | 'MFT' | 'EMPTY';
  }) => Promise<ProjectDetail>;
  saveSuiteWithUndo: (suite: OntologySuite, note?: string) => Promise<void>;
  pushUndoSnapshot: (prevSuite: OntologySuite) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  patchData: (patch: Partial<BootstrapPayload>) => void;
}

const initialUrl = readUrlNavState();

export const useWorkbenchStore = create<WorkbenchStoreState>((set, get) => ({
  data: null,
  loading: true,
  toast: null,
  activeNav: initialUrl.nav || 'app-ontology',
  activeItemId: initialUrl.itemId || null,
  activeSessionId: initialUrl.sessionId || null,
  undoStack: [],
  redoStack: [],
  selectedModel: 'M1',
  selectedElementId: null,

  setActiveNav: (nav, opts) => {
    const nextItem = opts?.itemId !== undefined ? opts.itemId : get().activeItemId;
    const nextSess = opts?.sessionId !== undefined ? opts.sessionId : get().activeSessionId;
    set({
      activeNav: nav,
      activeItemId: nextItem,
      activeSessionId: nextSess,
    });
    writeUrlNavState({
      nav,
      itemId: nextItem ?? '',
      sessionId: nextSess ?? '',
    });
  },

  setActiveItemId: (itemId) => {
    set({ activeItemId: itemId });
    writeUrlNavState({ itemId: itemId ?? '' });
  },

  setActiveSessionId: (sessionId) => {
    set({ activeSessionId: sessionId });
    writeUrlNavState({ sessionId: sessionId ?? '' });
  },

  setSelectedModel: (code, elementId = null) =>
    set({ selectedModel: code, selectedElementId: elementId }),

  setSelectedElementId: (elementId) => set({ selectedElementId: elementId }),

  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => {
      if (get().toast === msg) set({ toast: null });
    }, 3800);
  },

  patchData: (patch) => {
    const cur = get().data;
    if (!cur) return;
    set({ data: { ...cur, ...patch } });
  },

  pushUndoSnapshot: (prevSuite) => {
    set({
      undoStack: [...get().undoStack, JSON.parse(JSON.stringify(prevSuite)) as OntologySuite],
      redoStack: [],
    });
  },

  bootstrap: async (projectId) => {
    set({ loading: true });
    const targetId = projectId || readUrlNavState().projectId;
    const qs = targetId ? `?projectId=${encodeURIComponent(targetId)}` : '';
    const res = await fetch(`/api/bootstrap${qs}`);
    const payload = (await res.json()) as BootstrapPayload;
    set({
      data: payload,
      loading: false,
      undoStack: [],
      redoStack: [],
      selectedElementId: null,
    });
    writeUrlNavState({ projectId: payload.activeProject.id });
  },

  switchProject: async (projectId) => {
    writeUrlNavState({ projectId });
    await get().bootstrap(projectId);
  },

  createNewProject: async (input) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const { project } = (await res.json()) as { project: ProjectDetail };
    await get().bootstrap(project.id);
    get().showToast(`已创建本体工程「${project.name}」`);
    return project;
  },

  saveSuiteWithUndo: async (suite, note) => {
    const cur = get().data;
    if (!cur) return;
    const prevSuite = JSON.parse(JSON.stringify(cur.activeProject.suite)) as OntologySuite;
    const res = await fetch(`/api/projects/${cur.activeProject.id}/suite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suite, changelogNote: note }),
    });
    const { project } = (await res.json()) as { project: ProjectDetail };
    set({
      data: { ...cur, activeProject: project },
      undoStack: [...get().undoStack, prevSuite],
      redoStack: [],
    });
  },

  undo: async () => {
    const { undoStack, redoStack, data } = get();
    if (!data || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1]!;
    const current = JSON.parse(JSON.stringify(data.activeProject.suite)) as OntologySuite;
    const res = await fetch(`/api/projects/${data.activeProject.id}/suite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suite: previous, changelogNote: 'Undo AST change' }),
    });
    const { project } = (await res.json()) as { project: ProjectDetail };
    set({
      data: { ...data, activeProject: project },
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, current],
    });
  },

  redo: async () => {
    const { undoStack, redoStack, data } = get();
    if (!data || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1]!;
    const current = JSON.parse(JSON.stringify(data.activeProject.suite)) as OntologySuite;
    const res = await fetch(`/api/projects/${data.activeProject.id}/suite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suite: next, changelogNote: 'Redo AST change' }),
    });
    const { project } = (await res.json()) as { project: ProjectDetail };
    set({
      data: { ...data, activeProject: project },
      undoStack: [...undoStack, current],
      redoStack: redoStack.slice(0, -1),
    });
  },
}));

// ─── Project Management & Snapshots API ──────────────────────────────────────

export async function apiUpdateProjectMeta(
  projectId: string,
  patch: Partial<Pick<ProjectSummary, 'name' | 'code' | 'center' | 'domain' | 'description'>>,
): Promise<{ project: ProjectDetail; projects: ProjectSummary[] }> {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Update project failed');
  return res.json();
}

export async function apiCloneProject(
  projectId: string,
  overrides?: { name?: string; code?: string },
): Promise<{ project: ProjectDetail; projects: ProjectSummary[] }> {
  const res = await fetch(`/api/projects/${projectId}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overrides ?? {}),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Clone project failed');
  return res.json();
}

export async function apiDeleteProject(
  projectId: string,
  force = false,
): Promise<{
  deletedId: string;
  remainingProjectId: string;
  projects: ProjectSummary[];
  assembledApplications: AssembledApplication[];
}> {
  const res = await fetch(`/api/projects/${projectId}${force ? '?force=1' : ''}`, {
    method: 'DELETE',
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body.error || 'Delete project failed') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body;
}

export async function apiCreateProjectSnapshot(
  projectId: string,
  input: { label: string; note?: string },
): Promise<{ snapshot: ProjectSnapshot; snapshots: ProjectSnapshot[] }> {
  const res = await fetch(`/api/projects/${projectId}/snapshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function apiRestoreProjectSnapshot(
  projectId: string,
  snapId: string,
): Promise<{ project: ProjectDetail; projects: ProjectSummary[]; snapshots: ProjectSnapshot[] }> {
  const res = await fetch(`/api/projects/${projectId}/snapshots/${snapId}/restore`, {
    method: 'POST',
  });
  return res.json();
}

export async function apiDeleteProjectSnapshot(
  projectId: string,
  snapId: string,
): Promise<{ snapshots: ProjectSnapshot[] }> {
  const res = await fetch(`/api/projects/${projectId}/snapshots/${snapId}`, {
    method: 'DELETE',
  });
  return res.json();
}

// ─── Unified Agent Sessions & Live SSE Streaming Client ──────────────────────

export async function apiCreateAgentSession(input: {
  projectId: string;
  agentKind: AgentSessionKind;
  targetId?: string;
  title?: string;
  providerId?: string;
  modelOverride?: string;
  reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
}): Promise<{ session: AgentSession; agentSessions: AgentSession[] }> {
  const res = await fetch('/api/agent-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function apiPatchAgentSession(
  sessionId: string,
  patch: {
    title?: string;
    pinned?: boolean;
    providerId?: string;
    modelOverride?: string;
    reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
    clearMessages?: boolean;
  },
): Promise<{ session: AgentSession; agentSessions: AgentSession[] }> {
  const res = await fetch(`/api/agent-sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return res.json();
}

export async function apiDeleteAgentSession(
  sessionId: string,
): Promise<{ deletedId: string; agentSessions: AgentSession[] }> {
  const res = await fetch(`/api/agent-sessions/${sessionId}`, {
    method: 'DELETE',
  });
  return res.json();
}

export async function apiForkAgentSession(
  sessionId: string,
  input?: { fromMessageId?: string; title?: string },
): Promise<{ session: AgentSession; agentSessions: AgentSession[] }> {
  const res = await fetch(`/api/agent-sessions/${sessionId}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  });
  return res.json();
}

export async function apiAbortAgentSession(
  sessionId: string,
): Promise<{ aborted: boolean; session?: AgentSession; agentSessions: AgentSession[] }> {
  const res = await fetch(`/api/agent-sessions/${sessionId}/abort`, {
    method: 'POST',
  });
  return res.json();
}

export async function apiCompactAgentSession(
  sessionId: string,
): Promise<{ session: AgentSession; agentSessions: AgentSession[] }> {
  const res = await fetch(`/api/agent-sessions/${sessionId}/compact`, {
    method: 'POST',
  });
  return res.json();
}

export interface StreamAgentSessionCallbacks {
  onSessionMeta?: (meta: {
    sessionId: string;
    title: string;
    provider: string;
    model: string;
    isMock: boolean;
  }) => void;
  onThinkingDelta?: (delta: string, step: number) => void;
  onTextDelta?: (delta: string, step: number) => void;
  onToolCall?: (call: {
    id: string;
    toolName: string;
    arguments: Record<string, unknown>;
    step: number;
  }) => void;
  onToolResult?: (trace: AgentToolCallTrace, step: number) => void;
  onArtifact?: (artifact: AgentDomainArtifact) => void;
  onAskUser?: (askUser: AgentAskUserPrompt) => void;
  onUsage?: (usage: {
    tokenUsage?: AgentSession['tokenUsage'];
    providerName?: string;
    modelUsed?: string;
  }) => void;
  onRunError?: (payload: {
    diagnostic?: {
      code: string;
      providerName?: string;
      baseUrl?: string;
      message: string;
      remediation: string;
    };
    session?: AgentSession;
  }) => void;
  onMessageEnd?: (payload: { session: AgentSession; project?: ProjectDetail }) => void;
}

export async function streamAgentSessionTurn(
  sessionId: string,
  body: {
    prompt?: string;
    mode?: 'PROMPT' | 'STEER' | 'FOLLOW_UP' | 'CONTINUE';
    askUserAnswer?: {
      promptId: string;
      selectedAnswers: string[];
      freeformText?: string;
    };
    activeModelCode?: ModelCode;
    reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
  },
  callbacks: StreamAgentSessionCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/agent-sessions/${sessionId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok || !res.body) {
    const errJson = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    callbacks.onRunError?.({
      diagnostic: errJson.diagnostic ?? {
        code: 'HTTP_ERROR',
        message: errJson.error || `请求失败 (${res.status})`,
        remediation: '请检查后端服务状态或 LLM 中心网关配置。',
      },
    });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processBlock = (rawBlock: string) => {
    const lines = rawBlock.split(/\r?\n/);
    let eventName = '';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (!eventName || dataLines.length === 0) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (eventName) {
      case 'session_meta':
        callbacks.onSessionMeta?.(parsed as never);
        break;
      case 'thinking_delta':
        callbacks.onThinkingDelta?.(String(parsed.delta ?? ''), Number(parsed.step ?? 1));
        break;
      case 'delta':
        callbacks.onTextDelta?.(String(parsed.text ?? ''), Number(parsed.step ?? 1));
        break;
      case 'tool_call':
        callbacks.onToolCall?.(parsed as never);
        break;
      case 'tool_result':
        callbacks.onToolResult?.(
          parsed.trace as AgentToolCallTrace,
          Number(parsed.step ?? 1),
        );
        break;
      case 'artifact':
        callbacks.onArtifact?.(parsed.artifact as AgentDomainArtifact);
        break;
      case 'ask_user':
        callbacks.onAskUser?.(parsed.askUser as AgentAskUserPrompt);
        break;
      case 'usage':
        callbacks.onUsage?.(parsed as never);
        break;
      case 'run_error':
        callbacks.onRunError?.(parsed as never);
        break;
      case 'message_end':
        callbacks.onMessageEnd?.(parsed as never);
        break;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIdx = buffer.indexOf('\n\n');
    while (sepIdx !== -1) {
      const block = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      processBlock(block);
      sepIdx = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) {
    processBlock(buffer);
  }
}

// ─── Generic Asset Delete / Clone Helpers ────────────────────────────────────

export async function apiDeleteResource<T = Record<string, unknown>>(
  url: string,
): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body.error || '删除失败') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export async function apiPostJson<T = Record<string, unknown>>(
  url: string,
  payload: unknown = {},
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body.error || '请求失败') as Error & {
      status?: number;
      diagnostic?: unknown;
    };
    err.status = res.status;
    err.diagnostic = body.diagnostic;
    throw err;
  }
  return body as T;
}

export async function apiPutJson<T = Record<string, unknown>>(
  url: string,
  payload: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || '保存失败');
  }
  return body as T;
}

// ─── Existing Domain Helpers (Preserved + Error Diagnostics) ─────────────────

export async function apiAnalyzeImpact(
  projectId: string,
  targetId: string,
): Promise<ImpactAnalysisReport> {
  const res = await fetch(`/api/projects/${projectId}/impact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId }),
  });
  const data = (await res.json()) as { impact: ImpactAnalysisReport };
  return data.impact;
}

export async function apiRenameSymbol(
  projectId: string,
  oldId: string,
  newId: string,
): Promise<{ project: ProjectDetail; changedCount: number; changelogEntry: string }> {
  const res = await fetch(`/api/projects/${projectId}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldId, newId }),
  });
  return res.json();
}

export async function apiRunCopilot(
  projectId: string,
  prompt: string,
  activeModel: ModelCode,
): Promise<OntologyCopilotResult> {
  return apiPostJson<OntologyCopilotResult>(`/api/projects/${projectId}/copilot`, {
    prompt,
    activeModel,
  });
}

export async function apiSynthesizeSrsDoc(
  sessionId: string,
): Promise<RequirementDocSynthesisResult & { requirementSessions: RequirementSession[] }> {
  return apiPostJson(`/api/requirements/${sessionId}/synthesize-doc`, {});
}

export async function apiGeneratePrototype(
  projectId: string,
  input: { docId?: string; prompt?: string },
): Promise<PrototypeGenerationResult> {
  return apiPostJson(`/api/projects/${projectId}/prototypes/generate`, input);
}

export async function apiRefinePrototype(
  projectId: string,
  prototypeId: string,
  instruction: string,
): Promise<PrototypeGenerationResult> {
  return apiPostJson(`/api/projects/${projectId}/prototypes/${prototypeId}/refine`, {
    instruction,
  });
}

export async function apiSynthesizeOntologyFromPrototype(
  projectId: string,
  input: { prototypeId?: string; docId?: string },
): Promise<OntologySynthesisFromPrototypeResult> {
  return apiPostJson(`/api/projects/${projectId}/prototypes/synthesize-ontology`, input);
}

export async function apiGenerateTechArch(input: {
  name: string;
  stackTags?: string[];
  prompt?: string;
}): Promise<TechArchitectureGenerationResult> {
  return apiPostJson('/api/assets/generate-tech-arch', input);
}

export async function apiRunAppCodingAgent(
  appId: string,
  instruction: string,
): Promise<AppCodingAgentResult & { assembledApplications: AssembledApplication[] }> {
  return apiPostJson(`/api/applications/${appId}/coding-agent`, { instruction });
}

export async function apiCompileDevPackage(
  appId: string,
): Promise<{
  compiledPackage: CompiledDevelopmentPackage;
  application: AssembledApplication;
  assembledApplications: AssembledApplication[];
}> {
  return apiPostJson(`/api/applications/${appId}/compile-package`, {});
}

export async function apiInspectMcp(projectId: string): Promise<{
  tools: McpToolDefinition[];
  resources: McpResourceDefinition[];
  clientConfigJson?: string;
}> {
  const res = await fetch(`/api/mcp/${projectId}/capabilities`);
  return res.json();
}

export async function apiCallMcpTool(
  projectId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`/api/mcp/${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });
  return res.json();
}

export async function apiSendCapabilityChat(
  agentId: string,
  input: { sessionId?: string; userMessage: string },
): Promise<CapabilitySmartChatResult & { capabilityChatSessions: CapabilityChatSession[] }> {
  return apiPostJson(`/api/capability/agents/${agentId}/chat`, input);
}

export async function apiExecuteAnalyticsSql(
  sql: string,
  params?: Record<string, unknown>,
): Promise<AnalyticsQueryResult> {
  return apiPostJson('/api/analytics/sql', { sql, params });
}

export async function apiGenerateMetricInsight(metricId: string): Promise<MetricInsightResult> {
  return apiPostJson(`/api/analytics/metrics/${metricId}/insight`, {});
}

export async function apiRunScenarioAttribution(
  scenarioId: string,
  input: { question?: string; saveAsReport?: boolean },
): Promise<ScenarioAttributionResult & { analyticsReports: AnalyticsReport[] }> {
  return apiPostJson(`/api/analytics/scenarios/${scenarioId}/attribute`, input);
}

export async function apiTestLlmProvider(
  providerId: string,
): Promise<{ ping: LlmPingResult; llmProviders: LlmProviderConfig[] }> {
  return apiPostJson(`/api/llm/providers/${providerId}/test`, {});
}

export function triggerBrowserDownload(
  fileName: string,
  content: string | Blob,
  mimeType = 'text/plain;charset=utf-8',
): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
