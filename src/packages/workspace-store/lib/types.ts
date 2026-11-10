import type {
  ImpactAnalysisReport,
  KnowledgeGraphData,
  ModelCode,
  OntologySuite,
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
  confidenceScore: number;
  status: 'COMPLETED' | 'RUNNING' | 'REVIEWED';
  summary: string;
  createdAt: string;
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

export interface ReasoningSession {
  id: string;
  question: string;
  mode: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
  sqlGenerated: string;
  dataSummary: { label: string; value: string; delta?: string }[];
  causalAnalysis: string[];
  policyRecommendations: {
    actionTitle: string;
    targetObject: string;
    expectedImpact: string;
    writebackInterfaceId: string;
  }[];
  answerMarkdown: string;
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
  providerType: 'OPENAI_COMPATIBLE' | 'ANTHROPIC' | 'CLOUDFLARE_AI';
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  availableModels: string[];
  enabled: boolean;
  lastTestedStatus?: 'OK' | 'ERROR';
  lastTestedMessage?: string;
}

export interface SystemSettingsState {
  workspaceDir: string;
  defaultLanguage: 'zh-CN' | 'en-US';
  defaultTheme: 'light' | 'dark';
  strictValidation: boolean;
  autoMirrorYaml: boolean;
  autoSyncPrototypeMu: boolean;
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
  analyzeSymbolImpact(projectId: string, targetId: string): ImpactAnalysisReport;
  renameSymbol(
    projectId: string,
    oldId: string,
    newId: string,
  ): { project: ProjectDetail; changedCount: number; changelogEntry: string };

  // Application Center
  listRequirementSessions(projectId: string): RequirementSession[];
  appendRequirementMessage(
    sessionId: string,
    message: RequirementMessage,
    updates?: Partial<Pick<RequirementSession, 'discoveredAggregates' | 'discoveredRules' | 'resolvedDecisions' | 'status'>>,
  ): RequirementSession;
  listRequirementDocs(projectId: string): RequirementDoc[];
  saveRequirementDoc(doc: Omit<RequirementDoc, 'updatedAt'>): RequirementDoc;
  listPrototypes(projectId: string): PrototypeArtifact[];
  savePrototypeAndSyncMu(
    projectId: string,
    input: { id?: string; name: string; version?: string; htmlContent: string; syncMu?: boolean },
  ): { prototype: PrototypeArtifact; project: ProjectDetail };
  listFourLayerAssets(layer?: FourLayerAsset['layer']): FourLayerAsset[];
  saveFourLayerAsset(asset: Omit<FourLayerAsset, 'updatedAt'>): FourLayerAsset;
  listAssembledApplications(): AssembledApplication[];
  saveAssembledApplication(
    app: Omit<AssembledApplication, 'updatedAt' | 'agentDevLogs'> & {
      agentDevLogs?: AssembledApplication['agentDevLogs'];
    },
  ): AssembledApplication;
  listGeneratedSkills(projectId?: string): GeneratedSkill[];
  saveGeneratedSkill(skill: Omit<GeneratedSkill, 'updatedAt'>): GeneratedSkill;

  // Capability Center & Knowledge Center
  listLegacySystems(): LegacySystemConfig[];
  saveLegacySystem(sys: LegacySystemConfig): LegacySystemConfig;
  listExtractionJobs(projectId?: string): ExtractionJob[];
  runOntologyExtractionJob(input: {
    systemId: string;
    projectId: string;
    title: string;
    sourceType: ExtractionJob['sourceType'];
    sourceSnippet: string;
  }): { job: ExtractionJob; project: ProjectDetail };
  listMcpServers(): McpServerConfig[];
  saveMcpServer(mcp: Omit<McpServerConfig, 'updatedAt'>): McpServerConfig;
  listCapabilityAgents(): CapabilityAgent[];
  saveCapabilityAgent(agent: CapabilityAgent): CapabilityAgent;
  listCrossSystemFlows(): CrossSystemFlow[];
  executeCrossSystemFlow(flowId: string): CrossSystemFlow;
  listKnowledgeEntries(): KnowledgeEntry[];
  saveKnowledgeEntry(entry: Omit<KnowledgeEntry, 'updatedAt'>): KnowledgeEntry;

  // Data Analytics Center
  listDatabaseResources(): DatabaseResource[];
  listDataDocuments(): DataDocument[];
  saveDataDocument(doc: Omit<DataDocument, 'updatedAt'>): DataDocument;
  listDataMappings(): DataMappingRule[];
  saveDataMapping(rule: DataMappingRule): DataMappingRule;
  listMetrics(): MetricDefinition[];
  listAnalyticsScenarios(): AnalyticsScenario[];
  listAnalyticsReports(): AnalyticsReport[];
  saveAnalyticsReport(report: Omit<AnalyticsReport, 'createdAt'>): AnalyticsReport;
  listReasoningSessions(): ReasoningSession[];
  saveReasoningSession(session: Omit<ReasoningSession, 'createdAt'>): ReasoningSession;
  listWritebackInterfaces(): WritebackInterface[];
  executeWritebackInterface(
    interfaceId: string,
    payloadOverride?: Record<string, unknown>,
  ): WritebackInterface;

  // LLM Center & System Settings
  listLlmProviders(): LlmProviderConfig[];
  saveLlmProvider(provider: LlmProviderConfig): LlmProviderConfig;
  getSystemSettings(): SystemSettingsState;
  updateSystemSettings(patch: Partial<SystemSettingsState>): SystemSettingsState;
}

