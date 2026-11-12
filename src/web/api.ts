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
  AppendPrototypeRevisionInput,
  AssembledApplication,
  CapabilityAgent,
  CapabilityChatSession,
  ConfirmedPrototypeRevision,
  CreatePrototypeInput,
  CrossSystemFlow,
  DataDocument,
  DataMappingRule,
  DatabaseResource,
  DesignBrief,
  DesignBriefBorrowedReference,
  DesignBriefItem,
  ExtractionJob,
  FourLayerAsset,
  GeneratedSkill,
  InteractivePrototype,
  KnowledgeEntry,
  LegacySystemConfig,
  LlmProviderConfig,
  McpServerConfig,
  MetricDefinition,
  ProjectDetail,
  ProjectSnapshot,
  ProjectSummary,
  PrototypeArtifact,
  PrototypeRevision,
  PrototypeRevisionSource,
  PrototypeTargetAnchor,
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
  PipelineStageLogEntry,
  PipelineTaskProgressFrame,
  PipelineTaskSnapshot,
  PrototypeGenerationResult,
  PrototypeRefinementSelection,
  SrsSynthesisProgressPhase,
  TransientTurnImageInput,
} from '../packages/agent-runtime/index.js';
import type {
  CompiledDevelopmentPackage,
  McpResourceDefinition,
  McpToolDefinition,
} from '../packages/package-compiler/index.js';
import { useAgentPanelStore } from './components/agent/agentPanelStore.js';

export interface BootstrapPayload {
  projects: ProjectSummary[];
  activeProject: ProjectDetail;
  projectSnapshots: ProjectSnapshot[];
  agentSessions: AgentSession[];
  requirementSessions: RequirementSession[];
  requirementDocs: RequirementDoc[];
  prototypes: PrototypeArtifact[];
  confirmedPrototypeRevision?: ConfirmedPrototypeRevision | null;
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
  pipelineTasks?: PipelineTaskSnapshot[];
}

export type { PipelineStageLogEntry };

export interface ProjectLifecycleState {
  hasExploration: boolean;
  explorationCount: number;
  hasSrsDoc: boolean;
  srsDocCount: number;
  hasPrototype: boolean;
  prototypeCount: number;
  presentModelCount: number;
  hasOntology: boolean;
  hasForeignDemoTemplate: boolean;
  foreignTemplateNameZh?: string;
  foreignTemplateNameEn?: string;
  projectApps: AssembledApplication[];
  projectSkills: GeneratedSkill[];
  nextStep: {
    step: 1 | 2 | 3 | 4 | 5;
    targetView:
      | 'app-req-explore'
      | 'app-req-docs'
      | 'app-prototype'
      | 'app-ontology'
      | 'app-assembly-dev';
    labelZh: string;
    labelEn: string;
    hintZh: string;
    hintEn: string;
  };
}

export function getProjectLifecycleState(data: BootstrapPayload): ProjectLifecycleState {
  const active = data.activeProject;
  const reqAgentSessions = (data.agentSessions ?? []).filter(
    (s) => s.projectId === active.id && s.agentKind === 'REQUIREMENT' && s.messages.length > 0,
  );
  const explorationCount = Math.max(data.requirementSessions.length, reqAgentSessions.length);
  const hasExploration = explorationCount > 0;
  const srsDocCount = data.requirementDocs.length;
  const hasSrsDoc = srsDocCount > 0;
  const prototypeCount = data.prototypes.length;
  const hasPrototype = prototypeCount > 0;
  const presentModelCount = active.validation.presentModels.length;
  const hasOntology = presentModelCount > 0;

  const isContractForeign =
    active.id !== 'proj-contract' &&
    active.suite.M1?.domain === '合同全生命周期管理系统' &&
    active.domain !== '合同全生命周期管理系统';
  const isMftForeign =
    active.id !== 'proj-mft' &&
    active.suite.M1?.domain === '企业文件安全传输系统 (MFT)' &&
    active.domain !== '企业文件安全传输系统 (MFT)';
  const hasForeignDemoTemplate = isContractForeign || isMftForeign;

  const projectApps = (data.assembledApplications ?? []).filter((a) => a.projectId === active.id);
  const projectSkills = (data.generatedSkills ?? []).filter((s) => s.projectId === active.id);

  let nextStep: ProjectLifecycleState['nextStep'];
  if (!hasExploration) {
    nextStep = {
      step: 1,
      targetView: 'app-req-explore',
      labelZh: '前往第 1 步：开始需求探索',
      labelEn: 'Step 1: Start Requirement Exploration',
      hintZh: '先与 AI 澄清核心业务角色、单据与规则决策，再逐步自动生成规格书、原型与业务本体。',
      hintEn: 'Clarify domain roles, entities, and rules with AI first before generating downstream artifacts.',
    };
  } else if (!hasSrsDoc) {
    nextStep = {
      step: 2,
      targetView: 'app-req-explore',
      labelZh: '前往需求探索：合成《需求文档》',
      labelEn: 'Step 2: Synthesize SRS Document',
      hintZh: '您已完成需求探索对话，下一步请合成《软件需求说明书》，作为原型与本体的输入依据。',
      hintEn: 'Exploration session found. Next, synthesize the Software Requirements Specification (SRS).',
    };
  } else if (!hasPrototype) {
    nextStep = {
      step: 3,
      targetView: 'app-req-docs',
      labelZh: '前往需求文档：生成交互界面原型',
      labelEn: 'Step 3: Generate UI Prototype',
      hintZh: '《需求文档》已就绪，下一步请生成交互式 HTML 原型以确认页面布局与业务操作流。',
      hintEn: 'SRS is ready. Next, generate an interactive HTML prototype to confirm screens and actions.',
    };
  } else if (!hasOntology) {
    nextStep = {
      step: 4,
      targetView: 'app-prototype',
      labelZh: '前往界面原型：一键推导业务本体',
      labelEn: 'Step 4: Synthesize 11-Model Ontology',
      hintZh: '交互原型已就绪，现在可在「界面原型」中一键推导出本工程专属的 11 元模型业务本体。',
      hintEn: 'Prototype is ready. Synthesize your project-specific 11-model ontology from the prototype.',
    };
  } else {
    nextStep = {
      step: 5,
      targetView: 'app-assembly-dev',
      labelZh: '前往应用开发：组装四层开发资料包',
      labelEn: 'Step 5: Assemble 4-Layer Dev Package',
      hintZh: '业务本体已就绪，可绑定四层架构资产并编译导出《开发指导书》与开发资料包。',
      hintEn: 'Business ontology is ready. Bind 4-layer assets and compile the development package.',
    };
  }

  return {
    hasExploration,
    explorationCount,
    hasSrsDoc,
    srsDocCount,
    hasPrototype,
    prototypeCount,
    presentModelCount,
    hasOntology,
    hasForeignDemoTemplate,
    ...(isContractForeign
      ? {
          foreignTemplateNameZh: '合同全生命周期管理系统 (CLM)',
          foreignTemplateNameEn: 'Contract Lifecycle Management (CLM)',
        }
      : isMftForeign
        ? {
            foreignTemplateNameZh: '企业文件安全传输系统 (MFT)',
            foreignTemplateNameEn: 'Enterprise MFT Security',
          }
        : {}),
    projectApps,
    projectSkills,
    nextStep,
  };
}

// ─── URL Deep-Link State Sync (projectId / nav / itemId / sessionId) ─────────

export interface UrlNavState {
  projectId?: string;
  nav?: string;
  itemId?: string;
  sessionId?: string;
}

export function getCurrentClientLocale(): 'zh-CN' | 'en-US' {
  if (typeof window === 'undefined') return 'zh-CN';
  try {
    return window.localStorage.getItem('onto_locale') === 'en-US' ? 'en-US' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

function buildJsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Onto-Locale': getCurrentClientLocale(),
  };
}

function buildLocaleHeaders(): Record<string, string> {
  return {
    'X-Onto-Locale': getCurrentClientLocale(),
  };
}

const LAST_PROJECT_STORAGE_KEY = 'onto_last_project_id';

function readLastProjectIdFromStorage(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function writeLastProjectIdToStorage(projectId: string): void {
  if (typeof window === 'undefined' || !projectId) return;
  try {
    window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, projectId);
  } catch {
    // Ignore storage quota errors
  }
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

export type BackgroundPipelineTaskKind =
  | 'SRS_SYNTHESIS'
  | 'PROTOTYPE_GEN'
  | 'ONTOLOGY_SYNTH';

export type BackgroundPipelineTaskStatus =
  | 'RUNNING'
  | 'COMPLETED'
  | 'ERROR'
  | 'CANCELLED';

export interface BackgroundPipelineTask {
  id: string;
  kind: BackgroundPipelineTaskKind;
  projectId: string;
  projectName: string;
  status: BackgroundPipelineTaskStatus;
  phase: SrsSynthesisProgressPhase | 'ERROR' | 'CANCELLED';
  step: 1 | 2 | 3 | 4;
  totalSteps: 4;
  titleZh: string;
  titleEn: string;
  messageZh: string;
  messageEn: string;
  currentChapter?: string;
  completedChapters: number;
  thinkingChars: number;
  thinkingText: string;
  streamedChars: number;
  streamedText: string;
  previewTail: string;
  providerModel?: string;
  draftDocId?: string;
  stageLogs: PipelineStageLogEntry[];
  startedAt: number;
  completedAt?: number;
  originNav: string;
  targetNav: string;
  resultItemId?: string;
  resultLabelZh?: string;
  resultLabelEn?: string;
  unreadCompletion: boolean;
  errorDiagnostic?: {
    code?: string;
    message: string;
    remediation?: string;
  };
  retrySessionId?: string;
  retryDocId?: string;
  retryPrototypeId?: string;
}

const activePipelineAborters = new Map<string, AbortController>();

function titlesAndNavForKind(kind: BackgroundPipelineTaskKind): {
  titleZh: string;
  titleEn: string;
  defaultOriginNav: string;
  targetNav: string;
} {
  if (kind === 'SRS_SYNTHESIS') {
    return {
      titleZh: '合成 9 章节《软件需求规格说明书》',
      titleEn: 'Synthesizing 9-Chapter SRS Document',
      defaultOriginNav: 'app-req-explore',
      targetNav: 'app-req-docs',
    };
  }
  if (kind === 'PROTOTYPE_GEN') {
    return {
      titleZh: '生成可交互 HTML 原型并同步 MU 模型',
      titleEn: 'Generating Interactive HTML Prototype & MU Sync',
      defaultOriginNav: 'app-req-docs',
      targetNav: 'app-prototype',
    };
  }
  return {
    titleZh: '反向收敛 11 元模型业务本体',
    titleEn: 'Synthesizing 11-Model Ontology Suite',
    defaultOriginNav: 'app-prototype',
    targetNav: 'app-ontology',
  };
}

function mapServerSnapshotToBackgroundTask(
  snap: PipelineTaskSnapshot,
  existing?: BackgroundPipelineTask,
): BackgroundPipelineTask {
  const meta = titlesAndNavForKind(snap.kind);
  const streamedText = snap.streamedText ?? existing?.streamedText ?? '';
  const thinkingText = snap.thinkingText ?? existing?.thinkingText ?? '';
  return {
    id: snap.id,
    kind: snap.kind,
    projectId: snap.projectId,
    projectName: snap.projectName,
    status: snap.status,
    phase: (snap.phase as BackgroundPipelineTask['phase']) || 'CONTEXT',
    step: snap.step,
    totalSteps: 4,
    titleZh: meta.titleZh,
    titleEn: meta.titleEn,
    messageZh: snap.messageZh,
    messageEn: snap.messageEn,
    ...(snap.currentChapter ? { currentChapter: snap.currentChapter } : {}),
    completedChapters: snap.completedChapters ?? existing?.completedChapters ?? 0,
    thinkingChars: snap.thinkingChars ?? thinkingText.length,
    thinkingText,
    streamedChars: snap.streamedChars ?? streamedText.length,
    streamedText,
    previewTail: snap.previewTail ?? existing?.previewTail ?? streamedText.slice(-1600),
    ...(snap.providerModel || existing?.providerModel
      ? { providerModel: snap.providerModel || existing?.providerModel }
      : {}),
    ...(snap.draftDocId || existing?.draftDocId
      ? { draftDocId: snap.draftDocId || existing?.draftDocId }
      : {}),
    stageLogs: snap.stageLogs?.length ? snap.stageLogs : (existing?.stageLogs ?? []),
    startedAt: snap.startedAt,
    ...(snap.finishedAt ? { completedAt: snap.finishedAt } : {}),
    originNav: existing?.originNav || meta.defaultOriginNav,
    targetNav: meta.targetNav,
    ...(snap.resultItemId ? { resultItemId: snap.resultItemId } : {}),
    ...(existing?.resultLabelZh ? { resultLabelZh: existing.resultLabelZh } : {}),
    ...(existing?.resultLabelEn ? { resultLabelEn: existing.resultLabelEn } : {}),
    unreadCompletion: snap.unreadCompletion,
    ...(snap.status === 'ERROR'
      ? {
          errorDiagnostic: {
            code: snap.errorMessage || 'PIPELINE_ERROR',
            message: snap.messageZh,
            remediation:
              streamedText.trim().length >= 200 && snap.kind === 'PROTOTYPE_GEN'
                ? getCurrentClientLocale() === 'en-US'
                  ? `Saved ${streamedText.length.toLocaleString()} chars in checkpoint — click "Resume from Checkpoint" to continue without starting over.`
                  : `已持久化保存前序 ${streamedText.length.toLocaleString()} 字内容，点击「断点续写」即可直接接着往下生成，无需从头重来。`
                : getCurrentClientLocale() === 'en-US'
                  ? 'Click Retry or check LLM gateway settings in LLM Center.'
                  : '可点击「重试」，或前往 LLM 中心检查大模型网关状态。',
          },
        }
      : {}),
    ...(snap.sessionId || existing?.retrySessionId
      ? { retrySessionId: snap.sessionId || existing?.retrySessionId }
      : {}),
    ...(snap.docId || existing?.retryDocId
      ? { retryDocId: snap.docId || existing?.retryDocId }
      : {}),
    ...(snap.prototypeId || existing?.retryPrototypeId
      ? { retryPrototypeId: snap.prototypeId || existing?.retryPrototypeId }
      : {}),
  };
}

export interface SessionLiveStep {
  id: string;
  label: { zh: string; en: string };
  status: 'RUNNING' | 'DONE' | 'FAILED' | 'STOPPED';
  detail?: string;
  at?: string;
  targetAnchor?: PrototypeTargetAnchor;
  toolName?: string;
}

export interface SessionLiveDraft {
  runId: string;
  sessionId: string;
  userPrompt: string;
  displayTitle?: string;
  startedAt: number;
  liveStatus: { zh: string; en: string };
  model?: string;
  thinking: string;
  text: string;
  steps: SessionLiveStep[];
  artifacts?: AgentDomainArtifact[];
  activeAnchor?: PrototypeTargetAnchor;
}

export interface QueuedSessionPromptItem {
  id: string;
  prompt: string;
  displayTitle?: string;
  images?: TransientTurnImageInput[];
  designBrief?: DesignBrief;
  prototypeName?: string;
  enqueuedAt: number;
}

export function formatAnchorBadgeLabel(anchor: PrototypeTargetAnchor | undefined): string {
  if (!anchor) return '';
  if (anchor.screenId && anchor.elementId) {
    return `${anchor.screenId} · ${anchor.elementId}`;
  }
  return anchor.elementId || anchor.screenId || anchor.cssSelector || anchor.label || '';
}

export function formatToolStepLabel(toolName: string): { zh: string; en: string } {
  switch (toolName) {
    case 'list_prototype_anchors':
      return { zh: '盘点原型屏幕与锚点清单', en: 'List prototype screens & anchors' };
    case 'read_prototype_anchor':
      return { zh: '读取锚点片段', en: 'Read anchor fragment' };
    case 'edit_prototype_anchor':
      return { zh: '局部修改锚点片段', en: 'Edit anchor fragment' };
    case 'rewrite_prototype_page':
      return { zh: '重写整页原型结构', en: 'Rewrite full prototype page' };
    case 'inspect_ontology_model':
      return { zh: '检视业务本体模型', en: 'Inspect ontology model' };
    case 'ask_user':
      return { zh: '请求确认业务决策', en: 'Ask user decision' };
    case 'save_synthesized_srs_doc':
      return { zh: '写入九章节 SRS 需求规格书', en: 'Save 9-chapter SRS document' };
    case 'synthesize_ontology_suite':
      return { zh: '校验并持久化 11 模型本体套件', en: 'Validate & save 11-model ontology suite' };
    case 'save_tech_architecture_spec':
      return { zh: '持久化技术架构规格资产', en: 'Save technical architecture spec' };
    case 'save_metric_insight':
      return { zh: '生成并保存指标波动解读', en: 'Generate & save metric insight' };
    case 'save_scenario_attribution_report':
      return { zh: '生成并保存多维场景归因报告', en: 'Generate & save scenario attribution report' };
    case 'record_requirement_insights':
      return { zh: '沉淀结构化需求追问洞察', en: 'Record requirement insights' };
    case 'compile_dev_package':
      return { zh: '编译本体驱动研发指导包', en: 'Compile development package' };
    case 'run_readonly_sql':
      return { zh: '执行只读 SQL 数据探查', en: 'Execute read-only SQL query' };
    case 'propose_policy_writeback':
      return { zh: '拟定策略回写动作草案', en: 'Propose policy writeback action' };
    case 'invoke_mcp_tool':
      return { zh: '调用本体 MCP 工具', en: 'Invoke ontology MCP tool' };
    case 'upsert_term':
    case 'upsert_aggregate':
    case 'upsert_process':
    case 'upsert_command':
    case 'upsert_rule':
    case 'upsert_agent':
    case 'upsert_event':
    case 'upsert_external_mapping':
    case 'upsert_ui_screen':
    case 'upsert_metadata_entry':
    case 'upsert_ai_binding':
      return { zh: `更新本体元素 (${toolName.replace('upsert_', '')})`, en: `Upsert ontology element (${toolName.replace('upsert_', '')})` };
    case 'delete_element':
      return { zh: '移除本体元素并校验一致性', en: 'Delete ontology element & validate' };
    default:
      return { zh: `执行工具 ${toolName}`, en: `Run ${toolName}` };
  }
}

export function formatPrototypeSelectionsForPrompt(
  instruction: string,
  selections?: PrototypeRefinementSelection[],
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
): string {
  const cleanInstruction = instruction.trim();
  if (!selections || selections.length === 0) return cleanInstruction;

  if (locale === 'en-US') {
    const lines = selections.map((s, idx) => {
      const anchorParts = [
        s.screenId ? `screen=${s.screenId}` : '',
        s.elementId ? `element=${s.elementId}` : '',
        s.binding ? `binding=${s.binding}` : '',
        s.eventId ? `event=${s.eventId}` : '',
        s.cssSelector ? `selector="${s.cssSelector}"` : '',
      ]
        .filter(Boolean)
        .join(', ');
      return [
        `#${idx + 1} [${anchorParts || s.tagName || s.kind}]${s.label ? ` "${s.label}"` : ''}`,
        s.note ? `   - Instruction: ${s.note}` : '',
        s.htmlSnippet ? `   - HTML snippet: ${s.htmlSnippet}` : '',
        s.matchedElementsSummary?.length
          ? `   - Matched elements: ${s.matchedElementsSummary.join('; ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    });
    return [
      `[Visual Element Annotations — modify ONLY the anchored fragments below while keeping untouched screens & elements unchanged]`,
      lines.join('\n'),
      cleanInstruction ? `\n[Additional Global Refinement Instruction]\n${cleanInstruction}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const lines = selections.map((s, idx) => {
    const anchorParts = [
      s.screenId ? `screen=${s.screenId}` : '',
      s.elementId ? `element=${s.elementId}` : '',
      s.binding ? `binding=${s.binding}` : '',
      s.eventId ? `event=${s.eventId}` : '',
      s.cssSelector ? `selector="${s.cssSelector}"` : '',
    ]
      .filter(Boolean)
      .join(', ');
    return [
      `#${idx + 1} [${anchorParts || s.tagName || s.kind}]${s.label ? `「${s.label}」` : ''}`,
      s.note ? `   - 修改要求: ${s.note}` : '',
      s.htmlSnippet ? `   - 当前片段: ${s.htmlSnippet}` : '',
      s.matchedElementsSummary?.length
        ? `   - 圈选内包含元素: ${s.matchedElementsSummary.join('；')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    `[用户可视化圈选的页面元素与逐条精修批注 — 请按语义锚点局部修改对应片段，其余未提及区域保持不变]`,
    lines.join('\n'),
    cleanInstruction ? `\n[全局补充精修要求]\n${cleanInstruction}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const activeSessionStreamAborters = new Map<string, AbortController>();
const cancelledSessionIds = new Set<string>();

interface WorkbenchStoreState {
  data: BootstrapPayload | null;
  loading: boolean;
  toast: string | null;
  activeNav: string;
  activeItemId: string | null;
  activeSessionId: string | null;
  activePrototypeIdByProject: Record<string, string>;
  liveSessionDrafts: Record<string, SessionLiveDraft>;
  sessionQueues: Record<string, QueuedSessionPromptItem[]>;
  undoStack: OntologySuite[];
  redoStack: OntologySuite[];
  selectedModel: ModelCode;
  selectedElementId: string | null;
  backgroundTasks: BackgroundPipelineTask[];
  expandedStreamTaskIds: Record<string, boolean>;
  liveAnnouncement: string;
  setActiveNav: (nav: string, opts?: { itemId?: string | null; sessionId?: string | null }) => void;
  setActiveItemId: (itemId: string | null) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setActivePrototypeId: (projectId: string, prototypeId: string) => void;
  setSelectedModel: (code: ModelCode, elementId?: string | null) => void;
  setSelectedElementId: (elementId: string | null) => void;
  setTaskStreamExpanded: (taskId: string, expanded: boolean) => void;
  showToast: (msg: string) => void;
  announcePolite: (msg: string) => void;
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
  attachPipelineTaskStream: (
    taskId: string,
    opts?: { autoNavigateOnComplete?: boolean; originNav?: string },
  ) => Promise<BackgroundPipelineTask | null>;
  startPrototypeGenTask: (opts?: { docId?: string; prompt?: string }) => Promise<void>;
  cancelBackgroundTask: (taskId: string) => void;
  dismissBackgroundTask: (taskId: string) => void;
  openBackgroundTaskResult: (
    taskId: string,
    opts?: { expandStream?: boolean; keepCard?: boolean },
  ) => Promise<void>;
  retryBackgroundTask: (taskId: string, opts?: { fromScratch?: boolean }) => Promise<void>;
  ensureProjectAgentSession: (
    projectId: string,
    agentKind: AgentSessionKind,
    opts?: {
      targetId?: string;
      preferredSessionId?: string;
      title?: string;
      reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
    },
  ) => Promise<AgentSession>;
  ensurePrototypeCoDesignSession: (
    projectId: string,
    prototypeId: string,
  ) => Promise<AgentSession>;
  attachLiveSessionStream: (sessionId: string) => Promise<void>;
  startSessionAgentRun: (input: {
    sessionId: string;
    prompt: string;
    displayTitle?: string;
    images?: TransientTurnImageInput[];
    designBrief?: DesignBrief;
    prototypeName?: string;
    activeModelCode?: ModelCode;
    reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
    mockMode?: boolean;
  }) => Promise<void>;
  startPrototypeBriefGenerationRun: (input: {
    projectId: string;
    prototypeName?: string;
    prompt: string;
    designBrief: DesignBrief;
    images?: TransientTurnImageInput[];
    mockMode?: boolean;
    awaitCompletion?: boolean;
  }) => Promise<{ sessionId: string }>;
  startPrototypeBriefRestyleRun: (input: {
    projectId: string;
    prototypeId: string;
    prompt: string;
    designBrief: DesignBrief;
    images?: TransientTurnImageInput[];
    mockMode?: boolean;
    awaitCompletion?: boolean;
  }) => Promise<{ sessionId: string }>;
  startSrsSynthesisRun: (opts?: {
    requirementSessionId?: string;
    agentSessionId?: string;
    title?: string;
    docId?: string;
    version?: string;
    mockMode?: boolean;
  }) => Promise<{ sessionId: string } | null>;
  startOntologySynthesisRun: (opts?: {
    prototypeId?: string;
    docId?: string;
    mockMode?: boolean;
  }) => Promise<{ sessionId: string } | null>;
  startOntologyCopilotRun: (
    prompt: string,
    opts?: {
      activeModel?: ModelCode;
      sessionId?: string;
      mockMode?: boolean;
    },
  ) => Promise<{ sessionId: string } | null>;
  startTechArchGenerationRun: (input: {
    name: string;
    stackTags?: string[];
    prompt?: string;
    applicationId?: string;
    mockMode?: boolean;
  }) => Promise<{ sessionId: string } | null>;
  startMetricInsightRun: (
    metricId: string,
    opts?: { mockMode?: boolean },
  ) => Promise<{ sessionId: string } | null>;
  startScenarioAttributionRun: (
    scenarioId: string,
    opts?: { question?: string; saveAsReport?: boolean; mockMode?: boolean },
  ) => Promise<{ sessionId: string } | null>;
  startPrototypeRefinementRun: (input: {
    projectId: string;
    prototypeId: string;
    instruction: string;
    selections?: PrototypeRefinementSelection[];
    images?: TransientTurnImageInput[];
    mockMode?: boolean;
  }) => Promise<{ sessionId: string }>;
  cancelSessionAgentRun: (sessionId: string) => Promise<void>;
  retrySessionAgentRun: (sessionId: string, runId?: string) => Promise<void>;
  removeQueuedSessionPrompt: (sessionId: string, queueId: string) => void;
}

const initialUrl = readUrlNavState();

export const useWorkbenchStore = create<WorkbenchStoreState>((set, get) => ({
  data: null,
  loading: true,
  toast: null,
  activeNav: initialUrl.nav || 'app-ontology',
  activeItemId: initialUrl.itemId || null,
  activeSessionId: initialUrl.sessionId || null,
  activePrototypeIdByProject: {},
  liveSessionDrafts: {},
  sessionQueues: {},
  undoStack: [],
  redoStack: [],
  selectedModel: 'M1',
  selectedElementId: null,
  backgroundTasks: [],
  expandedStreamTaskIds: {},
  liveAnnouncement: '',

  setActiveNav: (nav, opts) => {
    const nextItem = opts?.itemId !== undefined ? opts.itemId : get().activeItemId;
    const nextSess = opts?.sessionId !== undefined ? opts.sessionId : get().activeSessionId;
    const newlyReadIds: string[] = [];
    const updatedTasks = get().backgroundTasks.map((tk) => {
      if (tk.targetNav === nav && tk.unreadCompletion) {
        newlyReadIds.push(tk.id);
        return { ...tk, unreadCompletion: false };
      }
      return tk;
    });
    set({
      activeNav: nav,
      activeItemId: nextItem,
      activeSessionId: nextSess,
      backgroundTasks: updatedTasks,
    });
    for (const id of newlyReadIds) {
      void fetch(`/api/pipeline-tasks/${encodeURIComponent(id)}/read`, { method: 'POST' }).catch(
        () => undefined,
      );
    }
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

  setActivePrototypeId: (projectId, prototypeId) => {
    if (!projectId || !prototypeId) return;
    const prev = get().activePrototypeIdByProject[projectId];
    if (prev === prototypeId) return;
    set({
      activePrototypeIdByProject: {
        ...get().activePrototypeIdByProject,
        [projectId]: prototypeId,
      },
    });
  },

  setSelectedModel: (code, elementId = null) =>
    set({ selectedModel: code, selectedElementId: elementId }),

  setSelectedElementId: (elementId) => set({ selectedElementId: elementId }),

  setTaskStreamExpanded: (taskId, expanded) => {
    set({
      expandedStreamTaskIds: {
        ...get().expandedStreamTaskIds,
        [taskId]: expanded,
      },
    });
  },

  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => {
      if (get().toast === msg) set({ toast: null });
    }, 3800);
  },

  announcePolite: (msg) => {
    set({ liveAnnouncement: msg });
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
    const targetId = projectId || readUrlNavState().projectId || readLastProjectIdFromStorage();
    const qs = targetId ? `?projectId=${encodeURIComponent(targetId)}` : '';
    const res = await fetch(`/api/bootstrap${qs}`);
    const payload = (await res.json()) as BootstrapPayload;

    const existingMap = new Map(get().backgroundTasks.map((tk) => [tk.id, tk]));
    const hydratedTasks = (payload.pipelineTasks ?? []).map((snap) =>
      mapServerSnapshotToBackgroundTask(snap, existingMap.get(snap.id)),
    );

    set({
      data: payload,
      loading: false,
      undoStack: [],
      redoStack: [],
      selectedElementId: null,
      backgroundTasks: hydratedTasks,
    });
    writeLastProjectIdToStorage(payload.activeProject.id);
    writeUrlNavState({ projectId: payload.activeProject.id });

    // Reconnect live SSE streams for any durable background tasks still running on the server
    for (const tk of hydratedTasks) {
      if (tk.status === 'RUNNING') {
        void get().attachPipelineTaskStream(tk.id, { autoNavigateOnComplete: false });
      }
    }

    // Reconnect live SSE streams for any durable background Agent Sessions still running on the server
    for (const sess of payload.agentSessions ?? []) {
      if (sess.status === 'RUNNING') {
        void get().attachLiveSessionStream(sess.id);
      }
    }
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
    get().showToast(
      getCurrentClientLocale() === 'en-US'
        ? `Created ontology project "${project.name}"`
        : `已创建本体工程「${project.name}」`,
    );
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
      data: {
        ...cur,
        activeProject: project,
        projects: cur.projects.map((p) =>
          p.id === project.id
            ? { ...p, currentStage: project.currentStage, updatedAt: project.updatedAt }
            : p,
        ),
      },
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
      data: {
        ...data,
        activeProject: project,
        projects: data.projects.map((p) =>
          p.id === project.id
            ? { ...p, currentStage: project.currentStage, updatedAt: project.updatedAt }
            : p,
        ),
      },
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
      data: {
        ...data,
        activeProject: project,
        projects: data.projects.map((p) =>
          p.id === project.id
            ? { ...p, currentStage: project.currentStage, updatedAt: project.updatedAt }
            : p,
        ),
      },
      undoStack: [...undoStack, current],
      redoStack: redoStack.slice(0, -1),
    });
  },

  attachPipelineTaskStream: async (taskId, opts) => {
    if (activePipelineAborters.has(taskId)) {
      return get().backgroundTasks.find((tk) => tk.id === taskId) ?? null;
    }

    const controller = new AbortController();
    activePipelineAborters.set(taskId, controller);

    const refreshProjectArtifacts = async (projectId: string) => {
      try {
        const pRes = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
        if (!pRes.ok) return;
        const pData = (await pRes.json()) as {
          project: ProjectDetail;
          projectSnapshots: ProjectSnapshot[];
          agentSessions: AgentSession[];
          requirementSessions: RequirementSession[];
          requirementDocs: RequirementDoc[];
          prototypes: PrototypeArtifact[];
          extractionJobs: ExtractionJob[];
          pipelineTasks?: PipelineTaskSnapshot[];
        };
        const cur = get().data;
        if (cur && cur.activeProject.id === projectId) {
          const otherAgentSessions = (cur.agentSessions ?? []).filter(
            (s) => s.projectId !== projectId,
          );
          set({
            data: {
              ...cur,
              activeProject: pData.project,
              projectSnapshots: pData.projectSnapshots,
              agentSessions: [...pData.agentSessions, ...otherAgentSessions],
              requirementSessions: pData.requirementSessions,
              requirementDocs: pData.requirementDocs,
              prototypes: pData.prototypes,
            },
          });
        }
      } catch {
        // Non-blocking artifact refresh
      }
    };

    const upsertSnapshot = (snap: PipelineTaskSnapshot): BackgroundPipelineTask => {
      const existing = get().backgroundTasks.find((tk) => tk.id === snap.id);
      const mapped = mapServerSnapshotToBackgroundTask(snap, {
        ...existing,
        ...(opts?.originNav && !existing?.originNav ? { originNav: opts.originNav } : {}),
      } as BackgroundPipelineTask | undefined);
      const others = get().backgroundTasks.filter((tk) => tk.id !== snap.id);
      set({ backgroundTasks: [mapped, ...others].sort((a, b) => b.startedAt - a.startedAt) });
      return mapped;
    };

    let lastDraftSyncAt = 0;

    try {
      const res = await fetch(`/api/pipeline-tasks/${encodeURIComponent(taskId)}/stream`, {
        method: 'GET',
        headers: buildLocaleHeaders(),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        return get().backgroundTasks.find((tk) => tk.id === taskId) ?? null;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handleSseBlock = async (rawBlock: string) => {
        const lines = rawBlock.split(/\r?\n/);
        let eventName = '';
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }
        if (!eventName || dataLines.length === 0) return;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
        } catch {
          return;
        }

        if (eventName === 'snapshot' && payload.task) {
          upsertSnapshot(payload.task as PipelineTaskSnapshot);
          return;
        }

        if (eventName === 'progress') {
          const frame = payload as unknown as PipelineTaskProgressFrame;
          set({
            backgroundTasks: get().backgroundTasks.map((tk) => {
              if (tk.id !== taskId) return tk;
              const nextThinking = frame.thinkingDelta
                ? `${tk.thinkingText}${frame.thinkingDelta}`
                : tk.thinkingText;
              const nextStreamed =
                frame.replaceStreamedText ??
                (frame.contentDelta
                  ? `${tk.streamedText}${frame.contentDelta}`
                  : tk.streamedText);
              return {
                ...tk,
                status: frame.status,
                step: frame.step,
                phase: frame.phase as BackgroundPipelineTask['phase'],
                messageZh: frame.messageZh,
                messageEn: frame.messageEn,
                ...(frame.currentChapter ? { currentChapter: frame.currentChapter } : {}),
                completedChapters: frame.completedChapters ?? tk.completedChapters,
                thinkingText: nextThinking,
                thinkingChars: frame.thinkingChars ?? nextThinking.length,
                streamedText: nextStreamed,
                streamedChars: frame.streamedChars ?? nextStreamed.length,
                ...(frame.previewTail ? { previewTail: frame.previewTail } : {}),
                ...(frame.providerModel ? { providerModel: frame.providerModel } : {}),
                ...(frame.draftDocId ? { draftDocId: frame.draftDocId } : {}),
                stageLogs: frame.stageLogs?.length ? frame.stageLogs : tk.stageLogs,
              };
            }),
          });

          // Periodically sync incremental DRAFT doc to sidebar when user is watching req_docs
          const curTask = get().backgroundTasks.find((tk) => tk.id === taskId);
          if (
            curTask?.kind === 'SRS_SYNTHESIS' &&
            frame.draftDocId &&
            frame.streamedChars >= 200 &&
            Date.now() - lastDraftSyncAt >= 4000 &&
            get().data?.activeProject.id === curTask.projectId
          ) {
            lastDraftSyncAt = Date.now();
            void refreshProjectArtifacts(curTask.projectId);
          }
          return;
        }

        if (eventName === 'complete' && payload.task) {
          const snap = payload.task as PipelineTaskSnapshot;
          const mapped = upsertSnapshot(snap);
          await refreshProjectArtifacts(mapped.projectId);

          const sameProject = get().data?.activeProject.id === mapped.projectId;
          const curNav = get().activeNav;
          const stayed =
            sameProject && (curNav === mapped.originNav || curNav === mapped.targetNav);

          if (stayed) {
            set({
              backgroundTasks: get().backgroundTasks.map((tk) =>
                tk.id === mapped.id ? { ...tk, unreadCompletion: false } : tk,
              ),
            });
            void fetch(`/api/pipeline-tasks/${encodeURIComponent(mapped.id)}/read`, {
              method: 'POST',
            }).catch(() => undefined);

            const curLoc = getCurrentClientLocale();
            get().showToast(curLoc === 'en-US' ? mapped.messageEn : mapped.messageZh);

            if (
              opts?.autoNavigateOnComplete !== false &&
              (mapped.kind === 'SRS_SYNTHESIS' || mapped.kind === 'PROTOTYPE_GEN')
            ) {
              get().setActiveNav(mapped.targetNav, {
                ...(mapped.resultItemId ? { itemId: mapped.resultItemId } : {}),
              });
            }
          } else {
            const curLoc = getCurrentClientLocale();
            get().announcePolite(curLoc === 'en-US' ? mapped.messageEn : mapped.messageZh);
          }
          return;
        }

        if (eventName === 'cancelled' && payload.task) {
          upsertSnapshot(payload.task as PipelineTaskSnapshot);
          return;
        }

        if (eventName === 'run_error') {
          if (payload.task) {
            const snap = payload.task as PipelineTaskSnapshot;
            upsertSnapshot(snap);
            await refreshProjectArtifacts(snap.projectId);
          } else {
            const errMsg = String(payload.message || 'Pipeline task failed');
            set({
              backgroundTasks: get().backgroundTasks.map((tk) =>
                tk.id === taskId
                  ? {
                      ...tk,
                      status: 'ERROR',
                      completedAt: Date.now(),
                      messageZh: errMsg,
                      messageEn: errMsg,
                      errorDiagnostic: { code: 'PIPELINE_ERROR', message: errMsg },
                    }
                  : tk,
              ),
            });
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sepIdx = buffer.indexOf('\n\n');
        let crlfIdx = buffer.indexOf('\r\n\r\n');
        while (sepIdx !== -1 || crlfIdx !== -1) {
          const useCrlf = crlfIdx !== -1 && (sepIdx === -1 || crlfIdx < sepIdx);
          const cutAt = useCrlf ? crlfIdx : sepIdx;
          const sepLen = useCrlf ? 4 : 2;
          const rawBlock = buffer.slice(0, cutAt);
          buffer = buffer.slice(cutAt + sepLen);
          await handleSseBlock(rawBlock);
          sepIdx = buffer.indexOf('\n\n');
          crlfIdx = buffer.indexOf('\r\n\r\n');
        }
      }
      if (buffer.trim()) {
        await handleSseBlock(buffer);
      }
    } catch {
      // If SSE socket dropped unintentionally while task is still running on server, poll & reconnect
      if (!controller.signal.aborted) {
        try {
          const checkRes = await fetch(`/api/pipeline-tasks/${encodeURIComponent(taskId)}`);
          if (checkRes.ok) {
            const { task: latestSnap } = (await checkRes.json()) as { task: PipelineTaskSnapshot };
            upsertSnapshot(latestSnap);
            if (latestSnap.status === 'COMPLETED') {
              await refreshProjectArtifacts(latestSnap.projectId);
            } else if (latestSnap.status === 'RUNNING') {
              setTimeout(() => {
                void get().attachPipelineTaskStream(taskId, opts);
              }, 1500);
            }
          }
        } catch {
          // Ignore transient offline state
        }
      }
    } finally {
      activePipelineAborters.delete(taskId);
    }

    return get().backgroundTasks.find((tk) => tk.id === taskId) ?? null;
  },

  startPrototypeGenTask: async (opts) => {
    const curData = get().data;
    if (!curData) return;
    const projectId = curData.activeProject.id;
    const existingRunning = get().backgroundTasks.find(
      (tk) =>
        tk.projectId === projectId &&
        tk.kind === 'PROTOTYPE_GEN' &&
        tk.status === 'RUNNING',
    );
    if (existingRunning) {
      void get().attachPipelineTaskStream(existingRunning.id, { autoNavigateOnComplete: true });
      return;
    }

    const locale = getCurrentClientLocale();
    const originNav = get().activeNav;
    const started = await apiPostJson<{
      task: PipelineTaskSnapshot;
      reusedRunning: boolean;
      pipelineTasks: PipelineTaskSnapshot[];
    }>('/api/pipeline-tasks', {
      kind: 'PROTOTYPE_GEN',
      projectId,
      ...(opts?.docId ? { docId: opts.docId } : {}),
      ...(opts?.prompt ? { prompt: opts.prompt } : {}),
      locale,
    });

    const mapped = mapServerSnapshotToBackgroundTask(started.task, {
      originNav,
    } as BackgroundPipelineTask);

    set({
      backgroundTasks: [
        mapped,
        ...get().backgroundTasks.filter(
          (tk) => tk.id !== mapped.id && !(tk.projectId === projectId && tk.kind === 'PROTOTYPE_GEN'),
        ),
      ],
    });

    await get().attachPipelineTaskStream(mapped.id, {
      autoNavigateOnComplete: true,
      originNav,
    });
  },

  cancelBackgroundTask: (taskId) => {
    const aborter = activePipelineAborters.get(taskId);
    if (aborter) {
      aborter.abort();
      activePipelineAborters.delete(taskId);
    }
    void fetch(`/api/pipeline-tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
    }).catch(() => undefined);
    set({
      backgroundTasks: get().backgroundTasks.map((tk) =>
        tk.id === taskId && tk.status === 'RUNNING'
          ? {
              ...tk,
              status: 'CANCELLED',
              phase: 'CANCELLED',
              completedAt: Date.now(),
              messageZh: '已手动取消后台生成任务。',
              messageEn: 'Background generation task cancelled.',
            }
          : tk,
      ),
    });
  },

  dismissBackgroundTask: (taskId) => {
    void fetch(`/api/pipeline-tasks/${encodeURIComponent(taskId)}/dismiss`, {
      method: 'POST',
    }).catch(() => undefined);
    const nextExpanded = { ...get().expandedStreamTaskIds };
    delete nextExpanded[taskId];
    set({
      backgroundTasks: get().backgroundTasks.filter((tk) => tk.id !== taskId),
      expandedStreamTaskIds: nextExpanded,
    });
  },

  openBackgroundTaskResult: async (taskId, opts) => {
    const task = get().backgroundTasks.find((tk) => tk.id === taskId);
    if (!task) return;
    if (opts?.expandStream) {
      get().setTaskStreamExpanded(taskId, true);
    }
    if (get().data?.activeProject.id !== task.projectId) {
      await get().switchProject(task.projectId);
    }
    get().setActiveNav(task.targetNav, {
      ...(task.resultItemId ? { itemId: task.resultItemId } : {}),
    });
    if (task.status === 'COMPLETED' && !opts?.expandStream && !opts?.keepCard) {
      set({
        backgroundTasks: get().backgroundTasks.map((tk) =>
          tk.id === taskId ? { ...tk, unreadCompletion: false } : tk,
        ),
      });
    }
  },

  retryBackgroundTask: async (taskId, opts) => {
    const task = get().backgroundTasks.find((tk) => tk.id === taskId);
    if (!task) return;
    if (get().data?.activeProject.id !== task.projectId) {
      await get().switchProject(task.projectId);
    }

    const canResumeCheckpoint =
      !opts?.fromScratch &&
      task.streamedChars >= 200 &&
      task.kind === 'PROTOTYPE_GEN';

    if (canResumeCheckpoint) {
      const locale = getCurrentClientLocale();
      const originNav = get().activeNav;
      const resumed = await apiPostJson<{
        task: PipelineTaskSnapshot;
        reusedRunning: boolean;
        pipelineTasks: PipelineTaskSnapshot[];
      }>(`/api/pipeline-tasks/${encodeURIComponent(taskId)}/resume`, { locale });

      const mapped = mapServerSnapshotToBackgroundTask(resumed.task, task);
      set({
        backgroundTasks: [
          mapped,
          ...get().backgroundTasks.filter((tk) => tk.id !== mapped.id && tk.id !== taskId),
        ],
      });

      await get().attachPipelineTaskStream(mapped.id, {
        autoNavigateOnComplete: true,
        originNav,
      });
      return;
    }

    if (task.kind === 'PROTOTYPE_GEN') {
      await get().startPrototypeGenTask(
        task.retryDocId ? { docId: task.retryDocId } : undefined,
      );
    }
  },

  ensureProjectAgentSession: async (projectId, agentKind, opts) => {
    const cur = get().data;
    const candidates = (cur?.agentSessions ?? [])
      .filter(
        (s) =>
          s.projectId === projectId &&
          s.agentKind === agentKind &&
          (!opts?.targetId || s.targetId === opts.targetId),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const preferredId = opts?.preferredSessionId ?? get().activeSessionId ?? undefined;
    const existing =
      (preferredId ? candidates.find((s) => s.id === preferredId) : undefined) ?? candidates[0];
    if (existing) {
      return existing;
    }

    const locale = getCurrentClientLocale();
    const defaultTitleByKind: Record<AgentSessionKind, { zh: string; en: string }> = {
      REQUIREMENT: { zh: '需求探索与 SRS 合成会话', en: 'Requirement & SRS Session' },
      COPILOT: { zh: '本体智能助手会话', en: 'Ontology Copilot Session' },
      PROTOTYPE_CO_DESIGN: { zh: '原型协同精修会话', en: 'Prototype Co-Design Session' },
      CODING: { zh: '应用装配与技术架构会话', en: 'Assembly & Tech Arch Session' },
      CAPABILITY: { zh: '能力智能体会话', en: 'Capability Agent Session' },
      REASONING: { zh: '数据归因与指标洞察会话', en: 'Data Reasoning & Insight Session' },
    };
    const fallbackTitle = defaultTitleByKind[agentKind];
    const created = await apiCreateAgentSession({
      projectId,
      agentKind,
      ...(opts?.targetId ? { targetId: opts.targetId } : {}),
      title: opts?.title ?? (locale === 'en-US' ? fallbackTitle.en : fallbackTitle.zh),
      ...(opts?.reasoningMode ? { reasoningMode: opts.reasoningMode } : {}),
    });
    const latest = get().data;
    if (latest) {
      const otherSessions = (latest.agentSessions ?? []).filter((s) => s.projectId !== projectId);
      set({
        data: {
          ...latest,
          agentSessions: [...created.agentSessions, ...otherSessions],
        },
      });
    }
    return created.session;
  },

  ensurePrototypeCoDesignSession: async (projectId, prototypeId) => {
    const cur = get().data;
    const existingProto = cur?.prototypes.find((p) => p.id === prototypeId);
    const existingSess = cur?.agentSessions.find(
      (s) =>
        (existingProto?.coDesignSessionId && s.id === existingProto.coDesignSessionId) ||
        (s.projectId === projectId &&
          s.agentKind === 'PROTOTYPE_CO_DESIGN' &&
          s.targetId === prototypeId),
    );
    if (existingSess && existingProto?.coDesignSessionId === existingSess.id) {
      return existingSess;
    }

    const ensured = await apiEnsurePrototypeCoDesignSession(projectId, prototypeId);
    const latest = get().data;
    if (latest) {
      const otherSessions = (latest.agentSessions ?? []).filter(
        (s) => s.projectId !== projectId,
      );
      set({
        data: {
          ...latest,
          agentSessions: [...ensured.agentSessions, ...otherSessions],
          ...(latest.activeProject.id === projectId && ensured.prototypes
            ? { prototypes: ensured.prototypes }
            : {}),
        },
      });
    }
    return ensured.session;
  },

  attachLiveSessionStream: async (sessionId) => {
    if (activeSessionStreamAborters.has(sessionId)) return;
    const controller = new AbortController();
    activeSessionStreamAborters.set(sessionId, controller);

    const sess = get().data?.agentSessions.find((s) => s.id === sessionId);
    const lastUser = [...(sess?.messages ?? [])].reverse().find((m) => m.role === 'user');
    if (!get().liveSessionDrafts[sessionId]) {
      set({
        liveSessionDrafts: {
          ...get().liveSessionDrafts,
          [sessionId]: {
            runId: lastUser?.id ?? `live-${sessionId}`,
            sessionId,
            userPrompt: lastUser?.content ?? '',
            startedAt: lastUser ? Date.parse(lastUser.timestamp) || Date.now() : Date.now(),
            liveStatus: { zh: '正在同步后台运行进展…', en: 'Reconnecting to live run…' },
            thinking: '',
            text: '',
            steps: [],
          },
        },
      });
    }

    try {
      await attachAgentSessionLiveStream(
        sessionId,
        buildStoreSessionStreamCallbacks(sessionId, set, get),
        { signal: controller.signal },
      );
    } catch {
      // Ignore client SSE detach
    } finally {
      if (activeSessionStreamAborters.get(sessionId) === controller) {
        activeSessionStreamAborters.delete(sessionId);
        const nextDrafts = { ...get().liveSessionDrafts };
        delete nextDrafts[sessionId];
        set({ liveSessionDrafts: nextDrafts });
      }
    }
  },

  startSessionAgentRun: async (input) => {
    const { sessionId, prompt } = input;
    if (!prompt.trim()) return;

    if (activeSessionStreamAborters.has(sessionId) || Boolean(get().liveSessionDrafts[sessionId])) {
      const existingQueue = get().sessionQueues[sessionId] ?? [];
      const item: QueuedSessionPromptItem = {
        id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        prompt,
        ...(input.displayTitle ? { displayTitle: input.displayTitle } : {}),
        ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
        ...(input.designBrief ? { designBrief: input.designBrief } : {}),
        ...(input.prototypeName ? { prototypeName: input.prototypeName } : {}),
        enqueuedAt: Date.now(),
      };
      set({
        sessionQueues: {
          ...get().sessionQueues,
          [sessionId]: [...existingQueue, item],
        },
      });
      return;
    }

    cancelledSessionIds.delete(sessionId);
    const controller = new AbortController();
    activeSessionStreamAborters.set(sessionId, controller);

    const draftRunId = `lrun-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    set({
      liveSessionDrafts: {
        ...get().liveSessionDrafts,
        [sessionId]: {
          runId: draftRunId,
          sessionId,
          userPrompt: prompt,
          ...(input.displayTitle ? { displayTitle: input.displayTitle } : {}),
          startedAt: Date.now(),
          liveStatus: { zh: '正在理解指令并分析锚点…', en: 'Analyzing instruction & anchors…' },
          thinking: '',
          text: '',
          steps: [],
        },
      },
    });

    try {
      await streamAgentSessionTurn(
        sessionId,
        {
          prompt,
          ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
          ...(input.designBrief ? { designBrief: input.designBrief } : {}),
          ...(input.prototypeName ? { prototypeName: input.prototypeName } : {}),
          ...(input.activeModelCode ? { activeModelCode: input.activeModelCode } : {}),
          ...(input.reasoningMode ? { reasoningMode: input.reasoningMode } : {}),
          ...(input.mockMode !== undefined ? { mockMode: input.mockMode } : {}),
        },
        buildStoreSessionStreamCallbacks(sessionId, set, get),
        controller.signal,
      );
    } catch {
      // Detaching client SSE reader does not abort server run
    } finally {
      if (activeSessionStreamAborters.get(sessionId) === controller) {
        activeSessionStreamAborters.delete(sessionId);
        const nextDrafts = { ...get().liveSessionDrafts };
        delete nextDrafts[sessionId];
        set({ liveSessionDrafts: nextDrafts });

        if (!cancelledSessionIds.has(sessionId)) {
          const queue = get().sessionQueues[sessionId] ?? [];
          if (queue.length > 0) {
            const [nextItem, ...rest] = queue;
            const nextQueues = { ...get().sessionQueues };
            if (rest.length > 0) nextQueues[sessionId] = rest;
            else delete nextQueues[sessionId];
            set({ sessionQueues: nextQueues });
            if (nextItem) {
              void get().startSessionAgentRun({
                sessionId,
                prompt: nextItem.prompt,
                ...(nextItem.displayTitle ? { displayTitle: nextItem.displayTitle } : {}),
                ...(nextItem.images ? { images: nextItem.images } : {}),
                ...(nextItem.designBrief ? { designBrief: nextItem.designBrief } : {}),
                ...(nextItem.prototypeName ? { prototypeName: nextItem.prototypeName } : {}),
              });
            }
          }
        }
      }
    }
  },

  startPrototypeBriefGenerationRun: async (input) => {
    const locale = getCurrentClientLocale();
    const title =
      input.prototypeName?.trim() ||
      (locale === 'en-US' ? 'Confirm Brief & Generate Prototype' : '确认设计简报并生成原型');
    const created = await apiCreateUnboundPrototypeCoDesignSession(input.projectId, title);
    const cur = get().data;
    if (cur) {
      const exists = (cur.agentSessions ?? []).some((s) => s.id === created.session.id);
      set({
        data: {
          ...cur,
          agentSessions: exists
            ? (cur.agentSessions ?? []).map((s) =>
                s.id === created.session.id ? created.session : s,
              )
            : [created.session, ...(cur.agentSessions ?? [])],
        },
      });
    }
    get().setActiveSessionId(created.session.id);
    useAgentPanelStore.getState().revealPanel();

    const runPromise = get().startSessionAgentRun({
      sessionId: created.session.id,
      prompt: input.prompt,
      displayTitle:
        locale === 'en-US' ? 'Confirm Brief & Generate Prototype (R1)' : '确认设计简报并生成首版原型 (R1)',
      designBrief: input.designBrief,
      ...(input.prototypeName ? { prototypeName: input.prototypeName } : {}),
      ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
      ...(input.mockMode !== undefined ? { mockMode: input.mockMode } : {}),
    });

    if (input.awaitCompletion) {
      await runPromise;
    }
    return { sessionId: created.session.id };
  },

  startPrototypeBriefRestyleRun: async (input) => {
    const locale = getCurrentClientLocale();
    get().setActivePrototypeId(input.projectId, input.prototypeId);
    const savedBrief = await apiUpdatePrototypeDesignBrief(input.prototypeId, input.designBrief);
    const cur = get().data;
    if (cur && cur.activeProject.id === input.projectId) {
      set({
        data: {
          ...cur,
          prototypes: savedBrief.prototypes,
          ...(savedBrief.confirmedRevision !== undefined
            ? { confirmedPrototypeRevision: savedBrief.confirmedRevision }
            : {}),
        },
      });
    }

    const session = await get().ensurePrototypeCoDesignSession(
      input.projectId,
      input.prototypeId,
    );
    get().setActiveSessionId(session.id);
    useAgentPanelStore.getState().revealPanel();

    const runPromise = get().startSessionAgentRun({
      sessionId: session.id,
      prompt: input.prompt,
      displayTitle:
        locale === 'en-US' ? 'Restyle from updated brief' : '按新简报重做风格',
      designBrief: input.designBrief,
      ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
      ...(input.mockMode !== undefined ? { mockMode: input.mockMode } : {}),
    });

    if (input.awaitCompletion) {
      await runPromise;
    }
    return { sessionId: session.id };
  },

  startSrsSynthesisRun: async (opts) => {
    const curData = get().data;
    if (!curData) return null;
    const projectId = curData.activeProject.id;
    const locale = getCurrentClientLocale();
    const session = await get().ensureProjectAgentSession(projectId, 'REQUIREMENT', {
      ...(opts?.agentSessionId ? { preferredSessionId: opts.agentSessionId } : {}),
      title:
        locale === 'en-US'
          ? `${curData.activeProject.name} Requirement Session`
          : `${curData.activeProject.name} 需求探索会话`,
    });
    get().setActiveSessionId(session.id);

    const payload: Record<string, unknown> = {
      ...(opts?.requirementSessionId ? { requirementSessionId: opts.requirementSessionId } : {}),
      ...(opts?.docId ? { docId: opts.docId } : {}),
      ...(opts?.title ? { title: opts.title } : {}),
      ...(opts?.version ? { version: opts.version } : {}),
    };
    const header = `[ACTION:SYNTHESIZE_SRS ${JSON.stringify(payload)}]`;
    const instruction =
      locale === 'en-US'
        ? 'Synthesize a complete 9-chapter Software Requirements Specification (SRS) from the requirement exploration history and save it via save_synthesized_srs_doc.'
        : '请基于当前需求探索会话与项目上下文，合成完整的九章节《软件需求规格说明书 (SRS)》，并通过 save_synthesized_srs_doc 工具持久化保存。';
    const displayTitle =
      locale === 'en-US' ? 'Synthesize 9-Chapter SRS' : '合成九章节 SRS 规格书';

    await get().startSessionAgentRun({
      sessionId: session.id,
      prompt: `${header}\n${instruction}`,
      displayTitle,
      ...(opts?.mockMode !== undefined ? { mockMode: opts.mockMode } : {}),
    });

    return { sessionId: session.id };
  },

  startOntologySynthesisRun: async (opts) => {
    const curData = get().data;
    if (!curData) return null;
    const projectId = curData.activeProject.id;
    const locale = getCurrentClientLocale();
    const session = await get().ensureProjectAgentSession(projectId, 'COPILOT', {
      title:
        locale === 'en-US'
          ? `${curData.activeProject.name} Ontology Copilot`
          : `${curData.activeProject.name} 本体智能助手`,
    });
    get().setActiveSessionId(session.id);

    const payload: Record<string, unknown> = {
      ...(opts?.prototypeId ? { prototypeId: opts.prototypeId } : {}),
      ...(opts?.docId ? { docId: opts.docId } : {}),
    };
    const header = `[ACTION:SYNTHESIZE_ONTOLOGY_SUITE ${JSON.stringify(payload)}]`;
    const instruction =
      locale === 'en-US'
        ? 'Synthesize and validate the 11-model Ontology Suite from the confirmed UI prototype and SRS context via synthesize_ontology_suite.'
        : '请从已确认的界面原型锚点与需求规格上下文推导并校验完整的 11 模型本体套件，通过 synthesize_ontology_suite 工具保存。';
    const displayTitle =
      locale === 'en-US'
        ? 'Synthesize 11-Model Ontology Suite'
        : '从已确认原型合成 11 模型本体';

    await get().startSessionAgentRun({
      sessionId: session.id,
      prompt: `${header}\n${instruction}`,
      displayTitle,
      activeModelCode: get().selectedModel,
      ...(opts?.mockMode !== undefined ? { mockMode: opts.mockMode } : {}),
    });

    return { sessionId: session.id };
  },

  startOntologyCopilotRun: async (prompt, opts) => {
    const curData = get().data;
    if (!curData || !prompt.trim()) return null;
    const projectId = curData.activeProject.id;
    const session = await get().ensureProjectAgentSession(projectId, 'COPILOT', {
      ...(opts?.sessionId ? { preferredSessionId: opts.sessionId } : {}),
    });
    get().setActiveSessionId(session.id);

    await get().startSessionAgentRun({
      sessionId: session.id,
      prompt: prompt.trim(),
      activeModelCode: opts?.activeModel ?? get().selectedModel,
      ...(opts?.mockMode !== undefined ? { mockMode: opts.mockMode } : {}),
    });

    return { sessionId: session.id };
  },

  startTechArchGenerationRun: async (input) => {
    const curData = get().data;
    if (!curData) return null;
    const projectId = curData.activeProject.id;
    const locale = getCurrentClientLocale();
    const targetAppId = input.applicationId ?? curData.assembledApplications[0]?.id;
    const session = await get().ensureProjectAgentSession(projectId, 'CODING', {
      ...(targetAppId ? { targetId: targetAppId } : {}),
    });
    get().setActiveSessionId(session.id);

    const payload: Record<string, unknown> = {
      name: input.name.trim(),
      ...(input.stackTags && input.stackTags.length > 0 ? { stackTags: input.stackTags } : {}),
      ...(input.prompt?.trim() ? { prompt: input.prompt.trim() } : {}),
      ...(targetAppId ? { applicationId: targetAppId } : {}),
    };
    const header = `[ACTION:GENERATE_TECH_ARCH ${JSON.stringify(payload)}]`;
    const instruction =
      locale === 'en-US'
        ? `Generate a production technical architecture specification "${input.name}"${input.prompt?.trim() ? ` (${input.prompt.trim()})` : ''} and save it via save_tech_architecture_spec.`
        : `请基于当前项目本体与工程栈生成技术架构规范「${input.name}」${input.prompt?.trim() ? `（补充要求：${input.prompt.trim()}）` : ''}，并通过 save_tech_architecture_spec 工具保存为四层资产。`;
    const displayTitle =
      locale === 'en-US'
        ? `Generate Tech Arch: ${input.name}`
        : `生成技术架构：${input.name}`;

    await get().startSessionAgentRun({
      sessionId: session.id,
      prompt: `${header}\n${instruction}`,
      displayTitle,
      ...(input.mockMode !== undefined ? { mockMode: input.mockMode } : {}),
    });

    return { sessionId: session.id };
  },

  startMetricInsightRun: async (metricId, opts) => {
    const curData = get().data;
    if (!curData) return null;
    const projectId = curData.activeProject.id;
    const locale = getCurrentClientLocale();
    const metric = curData.metrics.find((m) => m.id === metricId);
    const session = await get().ensureProjectAgentSession(projectId, 'REASONING', {
      reasoningMode: 'ASK_WHY',
    });
    get().setActiveSessionId(session.id);

    const payload: Record<string, unknown> = {
      metricId,
      ...(metric?.code ? { metricCode: metric.code } : {}),
      ...(metric?.name ? { metricName: metric.name } : {}),
    };
    const header = `[ACTION:METRIC_INSIGHT ${JSON.stringify(payload)}]`;
    const metricLabel = metric?.name || metricId;
    const instruction =
      locale === 'en-US'
        ? `Query real business data and generate a root-cause fluctuation insight for metric "${metricLabel}" (${metricId}), then persist it via save_metric_insight.`
        : `请结合本体语义与业务数据库，对指标「${metricLabel}」(${metricId}) 执行波动归因解读，并通过 save_metric_insight 工具保存结论。`;
    const displayTitle =
      locale === 'en-US'
        ? `Metric Insight: ${metricLabel}`
        : `指标波动解读：${metricLabel}`;

    await get().startSessionAgentRun({
      sessionId: session.id,
      prompt: `${header}\n${instruction}`,
      displayTitle,
      reasoningMode: 'ASK_WHY',
      ...(opts?.mockMode !== undefined ? { mockMode: opts.mockMode } : {}),
    });

    return { sessionId: session.id };
  },

  startScenarioAttributionRun: async (scenarioId, opts) => {
    const curData = get().data;
    if (!curData) return null;
    const projectId = curData.activeProject.id;
    const locale = getCurrentClientLocale();
    const scenario = curData.analyticsScenarios.find((s) => s.id === scenarioId);
    const session = await get().ensureProjectAgentSession(projectId, 'REASONING', {
      reasoningMode: 'ASK_WHY',
    });
    get().setActiveSessionId(session.id);

    const payload: Record<string, unknown> = {
      scenarioId,
      ...(scenario?.name ? { scenarioName: scenario.name } : {}),
      ...(opts?.question?.trim() ? { question: opts.question.trim() } : {}),
      saveAsReport: opts?.saveAsReport ?? true,
    };
    const header = `[ACTION:SCENARIO_ATTRIBUTION ${JSON.stringify(payload)}]`;
    const scenarioLabel = scenario?.name || scenarioId;
    const instruction =
      locale === 'en-US'
        ? `Execute multi-dimensional root-cause attribution for scenario "${scenarioLabel}" (${scenarioId})${opts?.question?.trim() ? ` focusing on: ${opts.question.trim()}` : ''}, and persist the report via save_scenario_attribution_report.`
        : `请对分析场景「${scenarioLabel}」(${scenarioId}) 执行多维根因归因推演${opts?.question?.trim() ? `（重点追问：${opts.question.trim()}）` : ''}，并通过 save_scenario_attribution_report 工具持久化归因报告。`;
    const displayTitle =
      locale === 'en-US'
        ? `Scenario Attribution: ${scenarioLabel}`
        : `多维归因推演：${scenarioLabel}`;

    await get().startSessionAgentRun({
      sessionId: session.id,
      prompt: `${header}\n${instruction}`,
      displayTitle,
      reasoningMode: 'ASK_WHY',
      ...(opts?.mockMode !== undefined ? { mockMode: opts.mockMode } : {}),
    });

    return { sessionId: session.id };
  },

  startPrototypeRefinementRun: async (input) => {
    const locale = getCurrentClientLocale();
    get().setActivePrototypeId(input.projectId, input.prototypeId);
    const session = await get().ensurePrototypeCoDesignSession(
      input.projectId,
      input.prototypeId,
    );
    const formattedPrompt = formatPrototypeSelectionsForPrompt(
      input.instruction,
      input.selections,
      locale,
    );
    const displayTitle =
      input.instruction.trim() ||
      input.selections?.[0]?.note?.trim() ||
      (locale === 'en-US' ? 'Prototype localized refinement' : '原型局部精修');

    void get().startSessionAgentRun({
      sessionId: session.id,
      prompt: formattedPrompt,
      displayTitle,
      ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
      ...(input.mockMode !== undefined ? { mockMode: input.mockMode } : {}),
    });

    return { sessionId: session.id };
  },

  cancelSessionAgentRun: async (sessionId) => {
    cancelledSessionIds.add(sessionId);
    const aborter = activeSessionStreamAborters.get(sessionId);
    if (aborter) {
      aborter.abort();
      activeSessionStreamAborters.delete(sessionId);
    }

    const nextQueues = { ...get().sessionQueues };
    delete nextQueues[sessionId];
    const nextDrafts = { ...get().liveSessionDrafts };
    delete nextDrafts[sessionId];
    set({ sessionQueues: nextQueues, liveSessionDrafts: nextDrafts });

    try {
      const res = await apiAbortAgentSession(sessionId);
      const cur = get().data;
      if (cur && res.agentSessions) {
        const targetProjectId =
          res.session?.projectId ??
          cur.agentSessions.find((s) => s.id === sessionId)?.projectId ??
          cur.activeProject.id;
        const others = (cur.agentSessions ?? []).filter((s) => s.projectId !== targetProjectId);
        set({
          data: {
            ...cur,
            agentSessions: [...res.agentSessions, ...others],
          },
        });
      }
    } catch {
      // Ignore network errors during cancel cleanup
    }
  },

  retrySessionAgentRun: async (sessionId, runId) => {
    const sess = get().data?.agentSessions.find((s) => s.id === sessionId);
    if (!sess) return;
    let targetPrompt = '';
    if (runId) {
      const msg = sess.messages.find((m) => m.id === runId && m.role === 'user');
      if (msg) targetPrompt = msg.content;
    }
    if (!targetPrompt) {
      for (let i = sess.messages.length - 1; i >= 0; i -= 1) {
        const m = sess.messages[i]!;
        if (m.role === 'user' && m.content.trim()) {
          targetPrompt = m.content;
          break;
        }
      }
    }
    if (!targetPrompt.trim()) return;
    await get().startSessionAgentRun({
      sessionId,
      prompt: targetPrompt,
    });
  },

  removeQueuedSessionPrompt: (sessionId, queueId) => {
    const curQueue = get().sessionQueues[sessionId] ?? [];
    const filtered = curQueue.filter((item) => item.id !== queueId);
    const nextQueues = { ...get().sessionQueues };
    if (filtered.length > 0) nextQueues[sessionId] = filtered;
    else delete nextQueues[sessionId];
    set({ sessionQueues: nextQueues });
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
    headers: buildLocaleHeaders(),
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
    visionSupported?: boolean;
    visionFallbackNotice?: string;
  }) => void;
  onThinkingDelta?: (delta: string, step: number) => void;
  onTextDelta?: (delta: string, step: number) => void;
  onToolCall?: (call: {
    id: string;
    toolName: string;
    arguments: Record<string, unknown>;
    step: number;
    targetAnchor?: PrototypeTargetAnchor;
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
  onMessageEnd?: (payload: {
    session: AgentSession;
    project?: ProjectDetail;
    requirementDocs?: RequirementDoc[];
    requirementSessions?: RequirementSession[];
    prototypes?: InteractivePrototype[];
    confirmedPrototypeRevision?: ConfirmedPrototypeRevision | null;
    fourLayerAssets?: FourLayerAsset[];
    assembledApplications?: AssembledApplication[];
    metrics?: MetricDefinition[];
    analyticsReports?: AnalyticsReport[];
    reasoningSessions?: ReasoningSession[];
    cancelled?: boolean;
  }) => void;
}

function consumeAgentSessionSseBody(
  body: ReadableStream<Uint8Array>,
  callbacks: StreamAgentSessionCallbacks,
): Promise<void> {
  return (async () => {
    const reader = body.getReader();
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
  })();
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
    images?: TransientTurnImageInput[];
    designBrief?: DesignBrief;
    prototypeName?: string;
    activeModelCode?: ModelCode;
    reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
    mockMode?: boolean;
    locale?: string;
  },
  callbacks: StreamAgentSessionCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const locale = body.locale || getCurrentClientLocale();
  const res = await fetch(`/api/agent-sessions/${sessionId}/stream`, {
    method: 'POST',
    headers: buildJsonHeaders(),
    body: JSON.stringify({ ...body, locale }),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok || !res.body) {
    const errJson = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    callbacks.onRunError?.({
      diagnostic: errJson.diagnostic ?? {
        code: 'HTTP_ERROR',
        message:
          errJson.error ||
          (locale === 'en-US' ? `Request failed (${res.status})` : `请求失败 (${res.status})`),
        remediation:
          locale === 'en-US'
            ? 'Check backend server status or configure your gateway in LLM Center.'
            : '请检查后端服务状态或 LLM 中心网关配置。',
      },
    });
    return;
  }

  await consumeAgentSessionSseBody(res.body, callbacks);
}

export async function attachAgentSessionLiveStream(
  sessionId: string,
  callbacks: StreamAgentSessionCallbacks,
  options?: { afterEventId?: string; signal?: AbortSignal },
): Promise<void> {
  const qs = options?.afterEventId
    ? `?afterEventId=${encodeURIComponent(options.afterEventId)}`
    : '';
  const res = await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}/live${qs}`, {
    method: 'GET',
    headers: buildLocaleHeaders(),
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!res.ok || !res.body) return;
  await consumeAgentSessionSseBody(res.body, callbacks);
}

function buildStoreSessionStreamCallbacks(
  sessionId: string,
  set: (partial: Partial<WorkbenchStoreState>) => void,
  get: () => WorkbenchStoreState,
): StreamAgentSessionCallbacks {
  const patchDraft = (updater: (cur: SessionLiveDraft) => SessionLiveDraft) => {
    const cur = get().liveSessionDrafts[sessionId];
    if (!cur) return;
    set({
      liveSessionDrafts: {
        ...get().liveSessionDrafts,
        [sessionId]: updater(cur),
      },
    });
  };

  const upsertCompletedSession = (payload: {
    session?: AgentSession;
    project?: ProjectDetail;
    requirementDocs?: RequirementDoc[];
    requirementSessions?: RequirementSession[];
    prototypes?: InteractivePrototype[];
    confirmedPrototypeRevision?: ConfirmedPrototypeRevision | null;
    fourLayerAssets?: FourLayerAsset[];
    assembledApplications?: AssembledApplication[];
    metrics?: MetricDefinition[];
    analyticsReports?: AnalyticsReport[];
    reasoningSessions?: ReasoningSession[];
  }) => {
    const cur = get().data;
    if (!cur || !payload.session) return;
    const updatedSession = payload.session;
    const exists = (cur.agentSessions ?? []).some((s) => s.id === updatedSession.id);
    const nextSessions = exists
      ? (cur.agentSessions ?? []).map((s) => (s.id === updatedSession.id ? updatedSession : s))
      : [updatedSession, ...(cur.agentSessions ?? [])];
    const isSameProject = cur.activeProject.id === updatedSession.projectId;
    set({
      data: {
        ...cur,
        agentSessions: nextSessions,
        ...(isSameProject && payload.project ? { activeProject: payload.project } : {}),
        ...(isSameProject && payload.requirementDocs
          ? { requirementDocs: payload.requirementDocs }
          : {}),
        ...(isSameProject && payload.requirementSessions
          ? { requirementSessions: payload.requirementSessions }
          : {}),
        ...(isSameProject && payload.prototypes ? { prototypes: payload.prototypes } : {}),
        ...(isSameProject && payload.confirmedPrototypeRevision !== undefined
          ? { confirmedPrototypeRevision: payload.confirmedPrototypeRevision }
          : {}),
        ...(payload.fourLayerAssets ? { fourLayerAssets: payload.fourLayerAssets } : {}),
        ...(isSameProject && payload.assembledApplications
          ? { assembledApplications: payload.assembledApplications }
          : {}),
        ...(payload.metrics ? { metrics: payload.metrics } : {}),
        ...(payload.analyticsReports ? { analyticsReports: payload.analyticsReports } : {}),
        ...(isSameProject && payload.reasoningSessions
          ? { reasoningSessions: payload.reasoningSessions }
          : {}),
      },
    });
  };

  return {
    onSessionMeta: (meta) => {
      patchDraft((cur) => ({ ...cur, model: meta.model }));
    },
    onThinkingDelta: (delta) => {
      patchDraft((cur) => ({
        ...cur,
        thinking: `${cur.thinking}${delta}`,
        liveStatus: cur.activeAnchor
          ? cur.liveStatus
          : { zh: '正在思考修改方案…', en: 'Planning localized edits…' },
      }));
    },
    onTextDelta: (delta) => {
      patchDraft((cur) => ({
        ...cur,
        text: `${cur.text}${delta}`,
        liveStatus: { zh: '正在整理修改说明…', en: 'Summarizing changes…' },
      }));
    },
    onToolCall: (call) => {
      const anchorText = formatAnchorBadgeLabel(call.targetAnchor);
      const stepLabel = formatToolStepLabel(call.toolName);
      patchDraft((cur) => {
        const existingIdx = cur.steps.findIndex((s) => s.id === call.id);
        const nextStep: SessionLiveStep = {
          id: call.id,
          label: stepLabel,
          status: 'RUNNING',
          toolName: call.toolName,
          at: new Date().toISOString(),
          ...(call.targetAnchor ? { targetAnchor: call.targetAnchor } : {}),
        };
        const nextSteps =
          existingIdx >= 0
            ? cur.steps.map((s, idx) => (idx === existingIdx ? nextStep : s))
            : [...cur.steps, nextStep];
        return {
          ...cur,
          steps: nextSteps,
          ...(call.targetAnchor ? { activeAnchor: call.targetAnchor } : {}),
          liveStatus: anchorText
            ? {
                zh: `${stepLabel.zh} (${anchorText})…`,
                en: `${stepLabel.en} (${anchorText})…`,
              }
            : stepLabel,
        };
      });
    },
    onToolResult: (trace) => {
      const detailParts: string[] = [];
      if (trace.arguments && Object.keys(trace.arguments).length > 0) {
        try {
          detailParts.push(JSON.stringify(trace.arguments, null, 2));
        } catch {
          // Ignore debug stringify error
        }
      }
      if (trace.output?.trim()) detailParts.push(trace.output.trim());
      const detail = detailParts.length > 0 ? detailParts.join('\n\n') : undefined;

      patchDraft((cur) => {
        const stepStatus = trace.isError ? 'FAILED' : 'DONE';
        const existingIdx = cur.steps.findIndex((s) => s.id === trace.id);
        const updatedStep: SessionLiveStep = {
          id: trace.id,
          label: formatToolStepLabel(trace.toolName),
          status: stepStatus,
          toolName: trace.toolName,
          ...(trace.targetAnchor
            ? { targetAnchor: trace.targetAnchor }
            : existingIdx >= 0 && cur.steps[existingIdx]?.targetAnchor
              ? { targetAnchor: cur.steps[existingIdx]!.targetAnchor }
              : {}),
          ...(existingIdx >= 0 && cur.steps[existingIdx]?.at
            ? { at: cur.steps[existingIdx]!.at }
            : {}),
          ...(detail ? { detail } : {}),
        };
        const nextSteps =
          existingIdx >= 0
            ? cur.steps.map((s, idx) => (idx === existingIdx ? updatedStep : s))
            : [...cur.steps, updatedStep];
        return {
          ...cur,
          steps: nextSteps,
          ...(trace.targetAnchor ? { activeAnchor: trace.targetAnchor } : {}),
        };
      });
    },
    onArtifact: (artifact) => {
      patchDraft((cur) => ({
        ...cur,
        artifacts: [...(cur.artifacts ?? []), artifact],
      }));
      if (artifact.kind === 'PROTOTYPE_REVISION') {
        const curData = get().data;
        if (curData?.activeProject.id) {
          get().setActivePrototypeId(curData.activeProject.id, artifact.prototypeId);
        }
      }
    },
    onRunError: (payload) => {
      upsertCompletedSession(payload);
    },
    onMessageEnd: (payload) => {
      upsertCompletedSession(payload);
      if (
        payload.session?.agentKind === 'PROTOTYPE_CO_DESIGN' &&
        payload.session.targetId &&
        get().data?.activeProject.id === payload.session.projectId
      ) {
        get().setActivePrototypeId(payload.session.projectId, payload.session.targetId);
      }
    },
  };
}

// ─── Generic Asset Delete / Clone Helpers ────────────────────────────────────

export async function apiDeleteResource<T = Record<string, unknown>>(
  url: string,
): Promise<T> {
  const locale = getCurrentClientLocale();
  const res = await fetch(url, { method: 'DELETE', headers: buildLocaleHeaders() });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(
      body.error || (locale === 'en-US' ? 'Delete failed' : '删除失败'),
    ) as Error & { status?: number; code?: string };
    err.status = res.status;
    if (typeof body.code === 'string') err.code = body.code;
    throw err;
  }
  return body as T;
}

export async function apiPostJson<T = Record<string, unknown>>(
  url: string,
  payload: unknown = {},
): Promise<T> {
  const locale = getCurrentClientLocale();
  const res = await fetch(url, {
    method: 'POST',
    headers: buildJsonHeaders(),
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(
      body.error || (locale === 'en-US' ? 'Request failed' : '请求失败'),
    ) as Error & {
      status?: number;
      code?: string;
      diagnostic?: unknown;
      blockedBy?: unknown;
      extractionJobs?: unknown;
      project?: unknown;
    };
    err.status = res.status;
    err.code = body.code;
    err.diagnostic = body.diagnostic;
    err.blockedBy = body.blockedBy;
    err.extractionJobs = body.extractionJobs;
    err.project = body.project;
    throw err;
  }
  return body as T;
}

export async function apiPutJson<T = Record<string, unknown>>(
  url: string,
  payload: unknown,
): Promise<T> {
  const locale = getCurrentClientLocale();
  const res = await fetch(url, {
    method: 'PUT',
    headers: buildJsonHeaders(),
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || (locale === 'en-US' ? 'Save failed' : '保存失败'));
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

export type {
  AppendPrototypeRevisionInput,
  ConfirmedPrototypeRevision,
  CreatePrototypeInput,
  DesignBrief,
  DesignBriefBorrowedReference,
  DesignBriefItem,
  InteractivePrototype,
  PrototypeArtifact,
  PrototypeRefinementSelection,
  PrototypeRevision,
  PrototypeRevisionSource,
  PrototypeTargetAnchor,
  TransientTurnImageInput,
};

export async function apiListPrototypes(projectId: string): Promise<{
  prototypes: InteractivePrototype[];
  confirmedRevision: ConfirmedPrototypeRevision | null;
}> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/prototypes`, {
    headers: buildLocaleHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to list prototypes');
  return res.json();
}

export async function apiSavePrototype(
  projectId: string,
  input: CreatePrototypeInput,
): Promise<{
  prototype: InteractivePrototype;
  revision: PrototypeRevision;
  project: ProjectDetail;
  prototypes: InteractivePrototype[];
  confirmedRevision: ConfirmedPrototypeRevision | null;
}> {
  return apiPostJson(`/api/projects/${encodeURIComponent(projectId)}/prototypes`, input);
}

export async function apiAppendPrototypeRevision(
  prototypeId: string,
  input: AppendPrototypeRevisionInput,
): Promise<{
  prototype: InteractivePrototype;
  revision: PrototypeRevision;
  project: ProjectDetail;
  prototypes: InteractivePrototype[];
  confirmedRevision: ConfirmedPrototypeRevision | null;
}> {
  return apiPostJson(`/api/prototypes/${encodeURIComponent(prototypeId)}/revisions`, input);
}

export async function apiRestorePrototypeRevision(
  prototypeId: string,
  revisionId: string,
  input?: { title?: string },
): Promise<{
  prototype: InteractivePrototype;
  revision: PrototypeRevision;
  prototypes: InteractivePrototype[];
  confirmedRevision: ConfirmedPrototypeRevision | null;
}> {
  return apiPostJson(
    `/api/prototypes/${encodeURIComponent(prototypeId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
    input ?? {},
  );
}

export async function apiUpdatePrototypeRevisionMeta(
  prototypeId: string,
  revisionId: string,
  patch: { title?: string; starred?: boolean },
): Promise<{
  prototype: InteractivePrototype;
  revision: PrototypeRevision;
  prototypes: InteractivePrototype[];
  confirmedRevision: ConfirmedPrototypeRevision | null;
}> {
  const res = await fetch(
    `/api/prototypes/${encodeURIComponent(prototypeId)}/revisions/${encodeURIComponent(revisionId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...buildLocaleHeaders() },
      body: JSON.stringify(patch),
    },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Failed to update revision metadata');
  return body;
}

export async function apiUpdatePrototypeDesignBrief(
  prototypeId: string,
  designBrief: DesignBrief,
): Promise<{
  prototype: InteractivePrototype;
  prototypes: InteractivePrototype[];
  confirmedRevision: ConfirmedPrototypeRevision | null;
}> {
  const res = await fetch(`/api/prototypes/${encodeURIComponent(prototypeId)}/design-brief`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...buildLocaleHeaders() },
    body: JSON.stringify({ designBrief }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Failed to update design brief');
  return body;
}

export async function apiConfirmPrototypeRevision(
  projectId: string,
  revisionId: string,
): Promise<{
  confirmed: ConfirmedPrototypeRevision;
  confirmedRevision: ConfirmedPrototypeRevision;
  prototype: InteractivePrototype;
  project: ProjectDetail;
  prototypes: InteractivePrototype[];
}> {
  return apiPostJson(`/api/projects/${encodeURIComponent(projectId)}/prototypes/confirm-revision`, {
    revisionId,
  });
}

export async function apiClonePrototype(
  prototypeId: string,
  input?: { name?: string },
): Promise<{
  prototype: InteractivePrototype;
  prototypes: InteractivePrototype[];
  confirmedRevision: ConfirmedPrototypeRevision | null;
}> {
  return apiPostJson(`/api/prototypes/${encodeURIComponent(prototypeId)}/clone`, input ?? {});
}

export async function apiDeletePrototype(
  prototypeId: string,
  projectId: string,
): Promise<{
  deletedId: string;
  prototypes: InteractivePrototype[];
  confirmedRevision: ConfirmedPrototypeRevision | null;
}> {
  return apiDeleteResource(
    `/api/prototypes/${encodeURIComponent(prototypeId)}?projectId=${encodeURIComponent(projectId)}`,
  );
}

export async function apiGeneratePrototype(
  projectId: string,
  input: { docId?: string; prompt?: string },
): Promise<PrototypeGenerationResult> {
  return apiPostJson(`/api/projects/${projectId}/prototypes/generate`, input);
}

export async function apiCreateUnboundPrototypeCoDesignSession(
  projectId: string,
  title?: string,
): Promise<{
  session: AgentSession;
  agentSessions: AgentSession[];
  prototypes: InteractivePrototype[];
}> {
  return apiPostJson(
    `/api/projects/${encodeURIComponent(projectId)}/prototype-co-design-sessions`,
    title ? { title } : {},
  );
}

export async function apiEnsurePrototypeCoDesignSession(
  projectId: string,
  prototypeId: string,
): Promise<{
  session: AgentSession;
  prototype: InteractivePrototype;
  agentSessions: AgentSession[];
  prototypes: InteractivePrototype[];
}> {
  return apiPostJson(
    `/api/projects/${encodeURIComponent(projectId)}/prototypes/${encodeURIComponent(prototypeId)}/co-design-session`,
    {},
  );
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
