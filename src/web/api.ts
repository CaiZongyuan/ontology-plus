import { create } from 'zustand';
import type {
  ImpactAnalysisReport,
  ModelCode,
  OntologySuite,
} from '../packages/ontology-core/index.js';
import type {
  AnalyticsReport,
  AnalyticsScenario,
  AssembledApplication,
  CapabilityAgent,
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
  ProjectSummary,
  PrototypeArtifact,
  ReasoningSession,
  RequirementDoc,
  RequirementSession,
  SystemSettingsState,
  WritebackInterface,
} from '../packages/workspace-store/index.js';
import type { OntologyCopilotResult, LlmPingResult } from '../packages/agent-runtime/index.js';
import type {
  CompiledDevelopmentPackage,
  McpResourceDefinition,
  McpToolDefinition,
} from '../packages/package-compiler/index.js';

export interface BootstrapPayload {
  projects: ProjectSummary[];
  activeProject: ProjectDetail;
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

interface WorkbenchStoreState {
  data: BootstrapPayload | null;
  loading: boolean;
  toast: string | null;
  undoStack: OntologySuite[];
  redoStack: OntologySuite[];
  selectedModel: ModelCode;
  setSelectedModel: (code: ModelCode) => void;
  showToast: (msg: string) => void;
  bootstrap: (projectId?: string) => Promise<void>;
  switchProject: (projectId: string) => Promise<void>;
  createNewProject: (input: {
    name: string;
    code: string;
    center: 'APPLICATION' | 'CAPABILITY' | 'ANALYTICS';
    domain: string;
    template: 'CONTRACT' | 'MFT' | 'EMPTY';
  }) => Promise<void>;
  saveSuiteWithUndo: (suite: OntologySuite, note?: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  patchData: (patch: Partial<BootstrapPayload>) => void;
}

export const useWorkbenchStore = create<WorkbenchStoreState>((set, get) => ({
  data: null,
  loading: true,
  toast: null,
  undoStack: [],
  redoStack: [],
  selectedModel: 'M1',

  setSelectedModel: (code) => set({ selectedModel: code }),

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

  bootstrap: async (projectId) => {
    set({ loading: true });
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const res = await fetch(`/api/bootstrap${qs}`);
    const payload = (await res.json()) as BootstrapPayload;
    set({ data: payload, loading: false, undoStack: [], redoStack: [] });
  },

  switchProject: async (projectId) => {
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
    const previous = undoStack[undoStack.length - 1];
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
    const next = redoStack[redoStack.length - 1];
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
  const res = await fetch(`/api/projects/${projectId}/copilot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, activeModel }),
  });
  return res.json();
}

export async function apiCompileDevPackage(
  appId: string,
): Promise<{ compiledPackage: CompiledDevelopmentPackage; application: AssembledApplication; assembledApplications: AssembledApplication[] }> {
  const res = await fetch(`/api/applications/${appId}/compile-package`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Compile failed');
  }
  return res.json();
}

export async function apiInspectMcp(
  projectId: string,
): Promise<{ tools: McpToolDefinition[]; resources: McpResourceDefinition[] }> {
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

export async function apiTestLlmProvider(
  providerId: string,
): Promise<{ ping: LlmPingResult; llmProviders: LlmProviderConfig[] }> {
  const res = await fetch(`/api/llm/providers/${providerId}/test`, {
    method: 'POST',
  });
  return res.json();
}

