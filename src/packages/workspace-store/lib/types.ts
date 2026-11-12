import type {
  CandidateDecision,
  ExtractionCandidate,
  ImpactAnalysisReport,
  KnowledgeGraphData,
  ModelCode,
  OntologySuite,
  SemanticAlignmentReport,
  ValidationDiagnostic,
  ValidationReport,
} from '../../ontology-core/index.js';

export interface ProjectSummary {
  id: string;
  name: string;
  code: string;
  center: 'APPLICATION' | 'CAPABILITY' | 'ANALYTICS';
  domain: string;
  description: string;
  currentStage: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  suite: OntologySuite;
  validation: ValidationReport;
  knowledgeGraph: KnowledgeGraphData;
  changelog: string;
}

export interface ProjectSnapshot {
  id: string;
  projectId: string;
  label: string;
  note: string;
  presentModels: ModelCode[];
  errorCount: number;
  warningCount: number;
  suite: OntologySuite;
  createdAt: string;
}

export type AgentSessionKind =
  | 'REQUIREMENT'
  | 'COPILOT'
  | 'CODING'
  | 'CAPABILITY'
  | 'REASONING';

export interface AgentToolCallTrace {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  output: string;
  isError?: boolean;
  validatorRepair?: boolean;
  durationMs?: number;
  targetElementId?: string;
  targetModelCode?: ModelCode;
}

export interface AgentAskUserPrompt {
  id: string;
  header?: string;
  question: string;
  options: string[];
  multiSelect?: boolean;
  allowFreeform?: boolean;
  answered?: boolean;
  selectedAnswers?: string[];
}

export type AgentDomainArtifact =
  | {
      kind: 'ONTOLOGY_DIFF';
      title: string;
      modelCode?: ModelCode;
      changes: {
        id: string;
        category: string;
        detail: string;
        action: 'ADDED' | 'MODIFIED' | 'REMOVED';
      }[];
    }
  | {
      kind: 'SQL_PREVIEW';
      sql: string;
      columns: string[];
      rows: Record<string, unknown>[];
      elapsedMs: number;
    }
  | {
      kind: 'REASONING_POLICY';
      mode: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
      dataSummary: { label: string; value: string; delta?: string }[];
      causalAnalysis: string[];
      policyRecommendations: {
        actionTitle: string;
        targetObject: string;
        expectedImpact: string;
        writebackInterfaceId: string;
      }[];
    }
  | {
      kind: 'REQUIREMENT_HINTS';
      aggregates: string[];
      rules: string[];
      decisions?: string[];
      openQuestions: string[];
    }
  | {
      kind: 'CODING_PACKAGE';
      appId: string;
      outputDir: string;
      files: string[];
    };

export type AgentImageAttachmentRole =
  | 'primary_ref'
  | 'borrowed_ref'
  | 'user_upload'
  | 'selection_crop';

export interface AgentImageAttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  source: 'local' | 'remote';
  remoteUrl?: string;
  width?: number;
  height?: number;
  role?: AgentImageAttachmentRole;
}

export interface AgentSessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  thinkingDurationMs?: number;
  timestamp: string;
  modelUsed?: string;
  providerName?: string;
  images?: AgentImageAttachmentRef[];
  visionFallbackUsed?: boolean;
  visionFallbackNotice?: string;
  toolCalls?: AgentToolCallTrace[];
  askUser?: AgentAskUserPrompt;
  artifacts?: AgentDomainArtifact[];
  errorDiagnostic?: {
    code: string;
    providerName?: string;
    baseUrl?: string;
    message: string;
    remediation: string;
  };
}

export interface AgentSession {
  id: string;
  projectId: string;
  agentKind: AgentSessionKind;
  targetId?: string;
  title: string;
  pinned?: boolean;
  status: 'IDLE' | 'RUNNING' | 'WAITING_INPUT' | 'ERROR';
  parentSessionId?: string;
  forkedFromMessageId?: string;
  providerId?: string;
  modelOverride?: string;
  reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
  compactedSummary?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  messages: AgentSessionMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface RequirementMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  extractedHints?: {
    aggregates?: string[];
    behaviors?: string[];
    rules?: string[];
    openQuestions?: string[];
  };
}

export interface RequirementSession {
  id: string;
  projectId: string;
  title: string;
  status: 'EXPLORING' | 'CONVERGED' | 'ARCHIVED';
  messages: RequirementMessage[];
  discoveredAggregates: string[];
  discoveredRules: string[];
  resolvedDecisions: string[];
  updatedAt: string;
}

export interface RequirementDoc {
  id: string;
  projectId: string;
  title: string;
  version: string;
  status: 'DRAFT' | 'CONFIRMED' | 'PUBLISHED';
  content: string;
  updatedAt: string;
}

export interface PrototypeArtifact {
  id: string;
  projectId: string;
  name: string;
  version: string;
  htmlContent: string;
  extractedScreenCount: number;
  updatedAt: string;
}

export interface FourLayerAsset {
  id: string;
  layer: 'UI_UE' | 'TECH_FOUNDATION' | 'TECH_ARCH';
  name: string;
  version: string;
  summary: string;
  tags: string[];
  specMarkdown: string;
  updatedAt: string;
}

export interface AssembledApplication {
  id: string;
  name: string;
  projectId: string;
  uiUeAssetId: string;
  techFoundationAssetId: string;
  techArchAssetId: string;
  status: 'ASSEMBLED' | 'DEVELOPING' | 'PACKAGE_READY' | 'PUBLISHED';
  packageOutputDir?: string;
  publishedEndpoint?: string;
  publishedVersion?: string;
  agentDevLogs: { timestamp: string; phase: string; detail: string }[];
  updatedAt: string;
}

export interface GeneratedSkill {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  version: string;
  description: string;
  skillMarkdown: string;
  isCustomRefined?: boolean;
  updatedAt: string;
}

export interface LegacySystemConfig {
  id: string;
  name: string;
  code: string;
  category: string;
  baseUrl: string;
  dbDialect: string;
  dbConnectionUri: string;
  status: 'CONNECTED' | 'EXTRACTED' | 'MCP_ACTIVE';
  linkedProjectId: string;
  description: string;
}

export interface ExtractionJob {
  id: string;
  systemId: string;
  projectId: string;
  title: string;
  sourceType: 'DDL_AND_OPENAPI' | 'SOURCE_CODE' | 'LOG_AND_DOC';
  sourceSnippet: string;
  extractedModels: ModelCode[];
  status: 'COMPLETED' | 'RUNNING' | 'REVIEWED';
  summary: string;
  /** What this extraction proposes. A delta, never a copy of the suite. */
  candidates: ExtractionCandidate[];
  /** Confirmations so far, keyed by candidate key. No entry means undecided. */
  decisions: Record<string, CandidateDecision>;
  semanticAlignment: SemanticAlignmentReport;
  extractedEntitiesCount?: number;
  extractedTablesCount?: number;
  extractedInterfacesCount?: number;
  appliedToProject?: boolean;
  /** How many candidates the merge wrote into the project. */
  appliedCandidateCount?: number;
  createdAt: string;
}

/** What a caller that already ran an extraction (structural scan plus an LLM round) hands over. */
export interface ExtractionResultInput {
  candidates: ExtractionCandidate[];
  semanticAlignment: SemanticAlignmentReport;
  tablesCount: number;
  summary?: string;
}

/**
 * Outcome of merging candidates into a project. `blockedBy` lists the
 * Consistency Errors the merge would have introduced; non-empty means nothing
 * was written.
 */
export interface ExtractionMergeResult {
  job: ExtractionJob;
  project: ProjectDetail;
  blockedBy: ValidationDiagnostic[];
}

export interface McpServerConfig {
  id: string;
  projectId: string;
  name: string;
  endpoint: string;
  transport: 'HTTP_JSON_RPC' | 'SSE';
  status: 'ONLINE' | 'STOPPED';
  toolsCount: number;
  resourcesCount: number;
  updatedAt: string;
}

export interface CapabilityAgent {
  id: string;
  name: string;
  role: string;
  projectId: string;
  mcpIds: string[];
  skillIds: string[];
  modelId: string;
  systemPrompt: string;
  status: 'ACTIVE' | 'DRAFT';
}

export interface CrossSystemFlow {
  id: string;
  name: string;
  description: string;
  involvedSystems: string[];
  triggerEvent: string;
  steps: {
    stepOrder: number;
    systemName: string;
    mcpToolName: string;
    description: string;
    status: 'READY' | 'SUCCESS';
  }[];
  lastRunAt: string;
  lastRunStatus: 'SUCCESS' | 'IDLE';
  executionLogs: string[];
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  category: 'DOMAIN_GLOSSARY' | 'MODELING_STANDARD' | 'BUSINESS_POLICY' | 'EXTRACTION_GUIDE';
  tags: string[];
  content: string;
  linkedProjectId?: string;
  updatedAt: string;
}

export interface DatabaseResource {
  id: string;
  name: string;
  dialect: 'SQLite' | 'PostgreSQL' | 'MySQL' | 'ClickHouse';
  connectionUri: string;
  status: 'ONLINE' | 'SYNCED';
  tables: {
    tableName: string;
    comment: string;
    rowCount: number;
    columns: { name: string; type: string; comment: string }[];
  }[];
}

export interface DataDocument {
  id: string;
  title: string;
  category: 'WAREHOUSE_SPEC' | 'METRIC_DICT' | 'GOVERNANCE_RULE';
  content: string;
  updatedAt: string;
}

export interface DataMappingRule {
  id: string;
  ontologyObject: string;
  ontologyAttribute: string;
  sourceDatabaseId: string;
  sourceTable: string;
  sourceColumn: string;
  transformExpr: string;
  qualityRule: string;
}

export interface MetricDefinition {
  id: string;
  code: string;
  name: string;
  category: string;
  formula: string;
  unit: string;
  currentValue: string;
  yoYChange: string;
  status: 'NORMAL' | 'WARNING' | 'CRITICAL';
  dimensions: string[];
  linkedAggregate: string;
}

export interface AnalyticsScenario {
  id: string;
  name: string;
  domain: string;
  triggerCondition: string;
  relatedMetrics: string[];
  causalFactors: string[];
  recommendedActions: string[];
  writebackInterfaceId: string;
}

export interface AnalyticsReport {
  id: string;
  title: string;
  period: string;
  author: string;
  summary: string;
  markdownContent: string;
  createdAt: string;
}

export interface CapabilityChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolInvocations?: {
    toolName: string;
    arguments: Record<string, unknown>;
    output: string;
    isError?: boolean;
  }[];
}

export interface CapabilityChatSession {
  id: string;
  agentId: string;
  projectId: string;
  title: string;
  messages: CapabilityChatMessage[];
  updatedAt: string;
}

export interface AnalyticsQueryResult {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  elapsedMs: number;
}

export interface AgentCheckpointRecord {
  sessionId: string;
  workflow: string;
  stateJson: string;
  updatedAt: string;
}

export interface ReasoningSession {
  id: string;
  question: string;
  mode: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
  sqlGenerated: string;
  queryColumns?: string[];
  queryRows?: Record<string, unknown>[];
  dataSummary: { label: string; value: string; delta?: string }[];
  causalAnalysis: string[];
  policyRecommendations: {
    actionTitle: string;
    targetObject: string;
    expectedImpact: string;
    writebackInterfaceId: string;
  }[];
  answerMarkdown: string;
  /** What the answer was grounded on; absent on sessions saved before grounding existed. */
  grounding?: {
    referenceQueryId?: string;
    tables: string[];
    /** Models whose absence limited what could be queried. */
    missingModels: ModelCode[];
    warnings: string[];
  };
  createdAt: string;
}

export interface WritebackInterface {
  id: string;
  name: string;
  targetSystem: string;
  protocol: 'REST_POST' | 'MCP_TOOL' | 'WEBHOOK';
  endpoint: string;
  boundBehaviorRef: string;
  payloadTemplate: Record<string, unknown>;
  executionCount: number;
  lastExecutedAt?: string;
  lastExecutionResult?: string;
}

export interface LlmProviderConfig {
  id: string;
  name: string;
  providerType: 'OPENAI_COMPATIBLE' | 'ANTHROPIC' | 'GOOGLE_GEMINI' | 'CLOUDFLARE_AI';
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  availableModels: string[];
  enabled: boolean;
  /** Whether this provider/model accepts multimodal image input (Visual References, uploads, selection crops). */
  supportsVision?: boolean;
  lastTestedStatus?: 'OK' | 'ERROR';
  lastTestedMessage?: string;
}

const KNOWN_VISION_MODEL_PATTERN =
  /(?:glm-5\.3-flash|glm-4(?:\.\d+)?v|gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|\bo1\b|\bo3\b|\bo4-mini\b|claude-3|claude-sonnet-4|claude-opus-4|claude-haiku-4|gemini-|qwen(?:\d+(?:\.\d+)?)?-vl|pixtral|llava|vision|-vl\b)/i;

/**
 * Determine whether a configured LLM provider (and optional target model ID) supports vision input.
 * Always honors an explicit boolean saved on `provider.supportsVision`; otherwise falls back to
 * verified provider/model defaults (`auto/glm-5.3-flash`, Anthropic, Google Gemini, OpenAI vision models).
 */
export function doesProviderSupportVision(
  provider: Pick<LlmProviderConfig, 'providerType' | 'defaultModel' | 'supportsVision'>,
  modelId?: string,
): boolean {
  if (typeof provider.supportsVision === 'boolean') {
    return provider.supportsVision;
  }
  if (provider.providerType === 'ANTHROPIC' || provider.providerType === 'GOOGLE_GEMINI') {
    return true;
  }
  const targetModel = (modelId || provider.defaultModel || '').trim();
  return KNOWN_VISION_MODEL_PATTERN.test(targetModel);
}

export interface SystemSettingsState {
  workspaceDir: string;
  defaultLanguage: 'zh-CN' | 'en-US';
  defaultTheme: 'system' | 'light' | 'dark';
  strictValidation: boolean;
  autoMirrorYaml: boolean;
  autoSyncPrototypeMu: boolean;
  mockLlmMode?: boolean;
}

export interface WorkspaceStore {
  // Projects & 11-Model Ontology Suite
  listProjects(): ProjectSummary[];
  getProject(projectId: string): ProjectDetail | undefined;
  createProject(input: {
    name: string;
    code: string;
    center?: 'APPLICATION' | 'CAPABILITY' | 'ANALYTICS';
    domain: string;
    description?: string;
    template?: 'CONTRACT' | 'MFT' | 'EMPTY';
  }): ProjectDetail;
  updateProjectMeta(
    projectId: string,
    patch: Partial<Pick<ProjectSummary, 'name' | 'code' | 'center' | 'domain' | 'description'>>,
  ): ProjectDetail;
  cloneProject(
    projectId: string,
    overrides?: { name?: string; code?: string },
  ): ProjectDetail;
  deleteProject(
    projectId: string,
    force?: boolean,
  ): { deletedId: string; remainingProjectId: string };
  listProjectSnapshots(projectId: string): ProjectSnapshot[];
  createProjectSnapshot(
    projectId: string,
    input: { label: string; note?: string },
  ): ProjectSnapshot;
  restoreProjectSnapshot(projectId: string, snapshotId: string): ProjectDetail;
  deleteProjectSnapshot(snapshotId: string): void;
  updateModel<K extends ModelCode>(
    projectId: string,
    modelCode: K,
    modelData: NonNullable<OntologySuite[K]>,
  ): ProjectDetail;
  updateSuite(projectId: string, suite: OntologySuite, changelogNote?: string): ProjectDetail;
  importYamlFiles(
    projectId: string,
    files: Partial<Record<ModelCode | string, string>>,
  ): { project: ProjectDetail; parseErrors: { model: ModelCode; message: string }[] };
  exportYamlFiles(
    projectId: string,
  ): Partial<Record<ModelCode, { fileName: string; content: string }>>;
  exportManifestJson(projectId: string): string;
  analyzeSymbolImpact(projectId: string, targetId: string): ImpactAnalysisReport;
  renameSymbol(
    projectId: string,
    oldId: string,
    newId: string,
  ): { project: ProjectDetail; changedCount: number; changelogEntry: string };

  // Unified Agent Sessions (across all 5 AI surfaces)
  listAgentSessions(filter?: {
    projectId?: string;
    agentKind?: AgentSessionKind;
    targetId?: string;
  }): AgentSession[];
  getAgentSession(sessionId: string): AgentSession | undefined;
  createAgentSession(input: {
    id?: string;
    projectId: string;
    agentKind: AgentSessionKind;
    targetId?: string;
    title?: string;
    providerId?: string;
    modelOverride?: string;
    reasoningMode?: AgentSession['reasoningMode'];
    initialMessages?: AgentSessionMessage[];
  }): AgentSession;
  saveAgentSession(session: AgentSession): AgentSession;
  forkAgentSession(
    sessionId: string,
    upToMessageId?: string,
    newTitle?: string,
  ): AgentSession;
  deleteAgentSession(sessionId: string): void;

  // Application Center
  listRequirementSessions(projectId: string): RequirementSession[];
  getRequirementSession(sessionId: string): RequirementSession | undefined;
  createRequirementSession(input: {
    projectId: string;
    title: string;
    initialPrompt?: string;
  }): RequirementSession;
  appendRequirementMessage(
    sessionId: string,
    message: RequirementMessage,
    updates?: Partial<
      Pick<
        RequirementSession,
        'discoveredAggregates' | 'discoveredRules' | 'resolvedDecisions' | 'status' | 'title'
      >
    >,
  ): RequirementSession;
  deleteRequirementSession(sessionId: string): void;
  listRequirementDocs(projectId: string): RequirementDoc[];
  saveRequirementDoc(doc: Omit<RequirementDoc, 'updatedAt'>): RequirementDoc;
  cloneRequirementDoc(docId: string): RequirementDoc;
  deleteRequirementDoc(docId: string): void;
  listPrototypes(projectId: string): PrototypeArtifact[];
  savePrototypeAndSyncMu(
    projectId: string,
    input: { id?: string; name: string; version?: string; htmlContent: string; syncMu?: boolean },
  ): { prototype: PrototypeArtifact; project: ProjectDetail };
  clonePrototype(protoId: string): PrototypeArtifact;
  deletePrototype(protoId: string): void;
  listFourLayerAssets(layer?: FourLayerAsset['layer']): FourLayerAsset[];
  saveFourLayerAsset(asset: Omit<FourLayerAsset, 'updatedAt'>): FourLayerAsset;
  deleteFourLayerAsset(assetId: string, force?: boolean): void;
  listAssembledApplications(): AssembledApplication[];
  saveAssembledApplication(
    app: Omit<AssembledApplication, 'updatedAt' | 'agentDevLogs'> & {
      agentDevLogs?: AssembledApplication['agentDevLogs'];
    },
  ): AssembledApplication;
  cloneAssembledApplication(appId: string): AssembledApplication;
  deleteAssembledApplication(appId: string): void;
  listGeneratedSkills(projectId?: string): GeneratedSkill[];
  saveGeneratedSkill(skill: Omit<GeneratedSkill, 'updatedAt'>): GeneratedSkill;
  deleteGeneratedSkill(skillId: string, force?: boolean): void;

  // Capability Center & Knowledge Center
  listLegacySystems(): LegacySystemConfig[];
  saveLegacySystem(sys: LegacySystemConfig): LegacySystemConfig;
  deleteLegacySystem(systemId: string): void;
  listExtractionJobs(projectId?: string): ExtractionJob[];
  /**
   * Create an Ontology Extraction job. Without `extraction` the store runs the
   * structural scan itself. `applyImmediately` (default true) accepts every
   * candidate and merges through the same gate as a reviewed merge.
   */
  runOntologyExtractionJob(input: {
    systemId: string;
    projectId: string;
    title: string;
    sourceType: ExtractionJob['sourceType'];
    sourceSnippet: string;
    applyImmediately?: boolean;
    extraction?: ExtractionResultInput;
  }): ExtractionMergeResult;
  /** Record confirmations on an unmerged job; `null` clears one. */
  saveExtractionDecisions(
    jobId: string,
    decisions: Record<string, CandidateDecision | null>,
  ): ExtractionJob;
  /** Merge the accepted candidates into the project's suite as it is now. */
  applyExtractionJobToProject(jobId: string): ExtractionMergeResult;
  deleteExtractionJob(jobId: string): void;
  listMcpServers(): McpServerConfig[];
  saveMcpServer(mcp: Omit<McpServerConfig, 'updatedAt'>): McpServerConfig;
  deleteMcpServer(mcpId: string, force?: boolean): void;
  listCapabilityAgents(): CapabilityAgent[];
  saveCapabilityAgent(agent: CapabilityAgent): CapabilityAgent;
  deleteCapabilityAgent(agentId: string): void;
  listCapabilityChatSessions(agentId?: string): CapabilityChatSession[];
  saveCapabilityChatSession(session: Omit<CapabilityChatSession, 'updatedAt'>): CapabilityChatSession;
  deleteCapabilityChatSession(sessionId: string): void;
  listCrossSystemFlows(): CrossSystemFlow[];
  saveCrossSystemFlow(flow: CrossSystemFlow): CrossSystemFlow;
  executeCrossSystemFlow(flowId: string): CrossSystemFlow;
  deleteCrossSystemFlow(flowId: string): void;
  listKnowledgeEntries(): KnowledgeEntry[];
  saveKnowledgeEntry(entry: Omit<KnowledgeEntry, 'updatedAt'>): KnowledgeEntry;
  deleteKnowledgeEntry(entryId: string): void;

  // Data Analytics Center
  listDatabaseResources(): DatabaseResource[];
  saveDatabaseResource(res: DatabaseResource): DatabaseResource;
  deleteDatabaseResource(dbId: string): void;
  listDataDocuments(): DataDocument[];
  saveDataDocument(doc: Omit<DataDocument, 'updatedAt'>): DataDocument;
  deleteDataDocument(docId: string): void;
  listDataMappings(): DataMappingRule[];
  saveDataMapping(rule: DataMappingRule): DataMappingRule;
  deleteDataMapping(mappingId: string): void;
  listMetrics(): MetricDefinition[];
  saveMetric(metric: MetricDefinition): MetricDefinition;
  deleteMetric(metricId: string): void;
  listAnalyticsScenarios(): AnalyticsScenario[];
  saveAnalyticsScenario(scenario: AnalyticsScenario): AnalyticsScenario;
  deleteAnalyticsScenario(scenarioId: string): void;
  listAnalyticsReports(): AnalyticsReport[];
  saveAnalyticsReport(report: Omit<AnalyticsReport, 'createdAt'>): AnalyticsReport;
  deleteAnalyticsReport(reportId: string): void;
  listReasoningSessions(): ReasoningSession[];
  saveReasoningSession(session: Omit<ReasoningSession, 'createdAt'>): ReasoningSession;
  deleteReasoningSession(sessionId: string): void;
  executeReadOnlyAnalyticsSql(sql: string, params?: Record<string, unknown>): AnalyticsQueryResult;
  listWritebackInterfaces(): WritebackInterface[];
  saveWritebackInterface(wb: WritebackInterface): WritebackInterface;
  executeWritebackInterface(
    interfaceId: string,
    payloadOverride?: Record<string, unknown>,
  ): WritebackInterface;
  deleteWritebackInterface(wbId: string): void;

  // Durable Agent Checkpoints
  saveAgentCheckpoint(sessionId: string, workflow: string, stateJson: string): void;
  loadAgentCheckpoint(sessionId: string): AgentCheckpointRecord | undefined;
  listAgentCheckpoints(workflow?: string): AgentCheckpointRecord[];

  // LLM Center & System Settings
  listLlmProviders(): LlmProviderConfig[];
  saveLlmProvider(provider: LlmProviderConfig): LlmProviderConfig;
  deleteLlmProvider(providerId: string): void;
  getSystemSettings(): SystemSettingsState;
  updateSystemSettings(patch: Partial<SystemSettingsState>): SystemSettingsState;
}
