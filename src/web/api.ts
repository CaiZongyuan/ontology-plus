import { create } from 'zustand';
import { reconcileSessionStream, waitForRecovery, withStreamWatchdog } from './lib/sessionRecovery.js';
import {
  formatToolProgress as formatVocabularyToolProgress,
  formatToolStepLabel as formatVocabularyToolStepLabel,
  type ProjectStepId,
  type ProjectStepStateId,
} from '../packages/business-vocabulary/index.js';
import {
  applyPrototypeLiveEvent,
  emptyPrototypeLiveState,
  splitPrototypeDocument,
  type ImpactAnalysisReport,
  type ModelCode,
  type OntologySuite,
  type PrototypeLiveEvent,
  type PrototypeLiveState,
} from '../packages/ontology-core/index.js';
import {
  doesProviderSupportVision,
  resolveCurrentProjectStep,
  type AgentAskUserPrompt,
  AgentDomainArtifact,
  AgentImageAttachmentRef,
  AgentSession,
  AgentSessionKind,
  AgentSubagentLaneTrace,
  AgentToolCallTrace,
  AnalyticsQueryResult,
  AnalyticsReport,
  AnalyticsScenario,
  AppendPrototypeRevisionInput,
  ArtifactHistoryEntryView,
  ArtifactHistorySurfaceKind,
  ArtifactJumpTarget,
  AssembledApplication,
  BusinessModelStepConfirmationRecord,
  CapabilityAgent,
  CapabilityChatSession,
  ChangeSummaryItemView,
  ChangeSummaryView,
  ConfirmedPrototypeRevision,
  ContextEventDetail,
  ContextEventSummary,
  ContextItem,
  ContextItemKind,
  CreatePrototypeInput,
  CrossSystemFlow,
  DataDocument,
  DataMappingRule,
  DatabaseResource,
  DesignBrief,
  DesignBriefBorrowedReference,
  DesignBriefItem,
  DevelopmentPackageSnapshot,
  ExtractionJob,
  FourLayerAsset,
  GeneratedSkill,
  InteractivePrototype,
  KnowledgeEntry,
  LegacySystemConfig,
  LlmProviderConfig,
  McpServerConfig,
  MetricDefinition,
  ModelCallDetail,
  ModelCallEstimate,
  ModelCallPurpose,
  ModelCallStatus,
  ModelCallSummary,
  ModelCallUsage,
  ModelCallUsageSource,
  PersistedArtifactHistoryKind,
  ProjectDetail,
  ProjectSnapshot,
  ProjectStepConfirmations,
  ProjectSummary,
  PrototypeArtifact,
  PrototypeCompareRevisionPair,
  PrototypeRevision,
  PrototypeRevisionSource,
  PrototypeTargetAnchor,
  ReasoningSession,
  RequirementDoc,
  RequirementSession,
  RequirementsStepConfirmationRecord,
  StepHandoffProposal,
  SystemSettingsState,
  TechnologyProfile,
  ToolDefinitionSource,
  WritebackInterface,
} from '../packages/workspace-store/index.js';
import type {
  LlmPingResult,
  PrototypeRefinementSelection,
  TransientTurnImageInput,
} from '../packages/agent-runtime/index.js';
import type {
  CompiledDevelopmentPackage,
  McpResourceDefinition,
  McpToolDefinition,
} from '../packages/package-compiler/index.js';
import {
  agentSessionScopeKey,
  useAgentPanelStore,
} from './components/agent/agentPanelStore.js';
import { resolveTurnImagesWithFallback } from './lib/localImageStore.js';
import {
  DEFAULT_NAV_VIEW,
  STEP_SPECIALIST_AGENT_KINDS,
  deriveProjectStepProgress,
  getDefaultViewForStep,
  getProjectLifecycleState,
  getProjectStepsFromBootstrap,
  normalizeNavViewAlias,
  readUrlNavState,
  writeStepViewMode,
  writeUrlNavState,
  type CanonicalNavViewId,
  type ProjectLifecycleState,
  type ProjectStepProgressInput,
  type UrlNavState,
} from './navigation/index.js';

export {
  deriveProjectStepProgress,
  getProjectLifecycleState,
  readUrlNavState,
  writeUrlNavState,
  type ProjectLifecycleState,
  type ProjectStepProgressInput,
  type UrlNavState,
};

export interface BootstrapPayload {
  technologyProfiles?: TechnologyProfile[];
  projects: ProjectSummary[];
  activeProject: ProjectDetail;
  projectSnapshots: ProjectSnapshot[];
  agentSessions: AgentSession[];
  requirementSessions: RequirementSession[];
  requirementDocs: RequirementDoc[];
  prototypes: PrototypeArtifact[];
  confirmedPrototypeRevision?: ConfirmedPrototypeRevision | null;
  stepConfirmations?: ProjectStepConfirmations;
  artifactHistory?: ArtifactHistoryEntryView[];
  fourLayerAssets: FourLayerAsset[];
  assembledApplications: AssembledApplication[];
  packageSnapshots?: DevelopmentPackageSnapshot[];
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

export function getCurrentClientLocale(): 'zh-CN' | 'en-US' {
  try {
    const storage =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage
        : typeof globalThis !== 'undefined' && 'localStorage' in globalThis
          ? globalThis.localStorage
          : undefined;
    return storage?.getItem('onto_locale') === 'en-US' ? 'en-US' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

type TurnInput = Parameters<WorkbenchStoreState['startSessionAgentRun']>[0];
type PendingTurn = { submissionId: string; input: Omit<TurnInput, 'images'>; imageRefs?: AgentImageAttachmentRef[] };
const pendingTurnKey = (sessionId: string) => `onto_pending_turn:${sessionId}`;
function readPendingTurn(sessionId: string): PendingTurn | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(pendingTurnKey(sessionId)) ?? 'null') as PendingTurn | null;
    return saved?.input.sessionId === sessionId && typeof saved.submissionId === 'string' ? saved : undefined;
  } catch { return undefined; }
}
function writePendingTurn(sessionId: string, value?: PendingTurn) {
  try {
    if (value) sessionStorage.setItem(pendingTurnKey(sessionId), JSON.stringify(value));
    else sessionStorage.removeItem(pendingTurnKey(sessionId));
  } catch {}
}

async function resolveSavedTurnImages(
  data: BootstrapPayload | null,
  session: AgentSession | undefined,
  images: AgentImageAttachmentRef[] | undefined,
): Promise<TransientTurnImageInput[] | undefined> {
  if (!images?.length) return undefined;
  const providers = data?.llmProviders ?? [];
  const provider = session?.providerId
    ? providers.find((item) => item.id === session.providerId && item.enabled) ??
      providers.find((item) => item.id === session.providerId)
    : providers.find((item) => item.enabled) ?? providers[0];
  return resolveTurnImagesWithFallback(images, {
    visionSupported: provider ? doesProviderSupportVision(provider, session?.modelOverride) : true,
    defaultRole: 'user_upload',
    fallbackNoteToName: true,
  });
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

export interface SessionLiveStep {
  id: string;
  label: { zh: string; en: string };
  status: 'RUNNING' | 'DONE' | 'FAILED' | 'STOPPED';
  detail?: string;
  at?: string;
  targetAnchor?: PrototypeTargetAnchor;
  toolName?: string;
  arguments?: Record<string, unknown>;
}

export interface SessionLiveDraft {
  runId: string;
  submissionId?: string;
  cancellationPending?: boolean;
  serverRunId?: string;
  sessionId: string;
  userPrompt: string;
  displayTitle?: string;
  images?: AgentImageAttachmentRef[];
  startedAt: number;
  liveStatus: { zh: string; en: string };
  model?: string;
  providerName?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  visionFallbackUsed?: boolean;
  visionFallbackNotice?: string;
  thinking: string;
  text: string;
  steps: SessionLiveStep[];
  subagentLanes?: AgentSubagentLaneTrace[];
  /** Per-screen live prototype state of this run, folded from prototype_frame/prototype_screen. */
  prototypeLive?: PrototypeLiveState;
  liveStreamedChars?: number;
  lastHeartbeatAt?: number;
  reconnecting?: boolean;
  artifacts?: AgentDomainArtifact[];
  askUser?: AgentAskUserPrompt;
  stepHandoff?: StepHandoffProposal;
  activeAnchor?: PrototypeTargetAnchor;
}

export interface AcceptStepHandoffResult {
  handoff: StepHandoffProposal;
  sourceSession: AgentSession;
  targetSession: AgentSession;
  targetStep: ProjectStepId;
  targetNavView: CanonicalNavViewId;
  targetSessionId: string;
  targetRunId: string;
  targetItemId?: string;
  agentSessions: AgentSession[];
  project?: ProjectDetail;
  stepConfirmations?: ProjectStepConfirmations;
}

export interface QueuedSessionPromptItem {
  id: string;
  prompt: string;
  displayTitle?: string;
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
  enqueuedAt: number;
}

export function formatAnchorBadgeLabel(anchor: PrototypeTargetAnchor | undefined): string {
  if (!anchor) return '';
  if (anchor.screenId && anchor.elementId) {
    return `${anchor.screenId} · ${anchor.elementId}`;
  }
  return anchor.elementId || anchor.screenId || anchor.cssSelector || anchor.label || '';
}

export function formatToolStepLabel(
  toolName: string,
  args?: Record<string, unknown>,
  targetAnchor?: PrototypeTargetAnchor,
): { zh: string; en: string } {
  const { zh, en } = formatVocabularyToolStepLabel(
    toolName,
    args,
    targetAnchor?.label ? { targetLabel: targetAnchor.label } : undefined,
  );
  return { zh, en };
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
type CancelTarget = { submissionId: string } | { runId: string };
const cancellationJobs = new Map<string, Promise<void>>();
const cancellationCache = new Map<string, CancelTarget>();
const cancellationKey = (sessionId: string) => `onto_pending_cancel:${sessionId}`;

function pendingCancellation(sessionId: string): CancelTarget | undefined {
  const cached = cancellationCache.get(sessionId);
  if (cached) return cached;
  try {
    const saved = JSON.parse(sessionStorage.getItem(cancellationKey(sessionId)) ?? 'null');
    if (typeof saved?.submissionId === 'string' || typeof saved?.runId === 'string') return saved;
  } catch {}
  return undefined;
}

export function restorePendingCancellation(sessionId: string): boolean {
  if (!pendingCancellation(sessionId)) return false;
  void useWorkbenchStore.getState().cancelSessionAgentRun(sessionId);
  return true;
}

export interface OntologyUndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  latestEntryId: string | null;
}

export function getOntologyUndoRedoState(
  artifactHistory?: readonly ArtifactHistoryEntryView[],
): OntologyUndoRedoState {
  const ontEntries = (artifactHistory ?? []).filter(
    (entry) => entry.artifactKind === 'ONTOLOGY_SUITE',
  );
  if (ontEntries.length === 0) {
    return { canUndo: false, canRedo: false, latestEntryId: null };
  }
  const byId = new Map(ontEntries.map((entry) => [entry.id, entry]));
  const latest = ontEntries[0]!;
  let undoDepth = 0;
  let cursor: ArtifactHistoryEntryView | undefined = latest;
  while (cursor && cursor.source.kind === 'UNDO') {
    undoDepth += 1;
    cursor = byId.get(cursor.source.undoneEntryId);
  }
  const isUndoneHead = undoDepth % 2 === 1;
  return {
    canUndo: !isUndoneHead,
    canRedo: isUndoneHead,
    latestEntryId: latest.id,
  };
}

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
  selectedModel: ModelCode;
  selectedElementId: string | null;
  highlightedRequirementSection: { heading: string; docId?: string; seq: number } | null;
  highlightedBusinessModelTarget: { pageId?: string; anchorId: string; seq: number } | null;
  highlightedPrototypeTarget: {
    prototypeId: string;
    revisionId?: string;
    screenId?: string;
    elementId?: string;
    seq: number;
  } | null;
  highlightedPrototypeComparePair: {
    prototypeId: string;
    leftRevisionId: string;
    rightRevisionId: string;
    seq: number;
  } | null;
  historyDrawerArtifactKind: ArtifactHistorySurfaceKind | null;
  liveAnnouncement: string;
  setActiveNav: (nav: string, opts?: { itemId?: string | null; sessionId?: string | null }) => void;
  setActiveItemId: (itemId: string | null) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setActivePrototypeId: (projectId: string, prototypeId: string) => void;
  setSelectedModel: (code: ModelCode, elementId?: string | null) => void;
  setSelectedElementId: (elementId: string | null) => void;
  focusRequirementSection: (sectionHeading: string, docId?: string) => void;
  focusBusinessModelTarget: (
    target: Extract<ArtifactJumpTarget, { kind: 'BUSINESS_OBJECT' }>,
  ) => void;
  focusPrototypeTarget: (
    target: Extract<ArtifactJumpTarget, { kind: 'PROTOTYPE_ANCHOR' }>,
  ) => void;
  openPrototypeRevisionCompare: (pair: PrototypeCompareRevisionPair) => void;
  clearPrototypeRevisionCompare: () => void;
  openArtifactHistoryDrawer: (kind: ArtifactHistorySurfaceKind) => void;
  closeArtifactHistoryDrawer: () => void;
  refreshArtifactHistory: (
    projectId?: string,
    kind?: ArtifactHistorySurfaceKind,
    prototypeId?: string,
  ) => Promise<ArtifactHistoryEntryView[]>;
  undoArtifactChange: (
    artifactKind: ArtifactHistorySurfaceKind,
    expectedEntryId?: string,
    prototypeId?: string,
  ) => Promise<boolean>;
  restoreArtifactBeforeChange: (
    artifactKind: ArtifactHistorySurfaceKind,
    entryId: string,
  ) => Promise<boolean>;
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
  createProjectFromDescription: (description: string) => Promise<{
    project: ProjectDetail;
    session: AgentSession;
    runPromise: Promise<void>;
  }>;
  saveSuiteWithUndo: (suite: OntologySuite, note?: string) => Promise<void>;
  applyBusinessModelEdit: (
    payload: PatchBusinessModelInput,
  ) => Promise<BusinessModelEditResult>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  patchData: (patch: Partial<BootstrapPayload>) => void;
  confirmRequirementsStep: (
    docId?: string,
  ) => Promise<RequirementsStepConfirmationRecord | null>;
  confirmBusinessModelStep: () => Promise<BusinessModelStepConfirmationRecord | null>;
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
  updateAgentSessionExecutionConfig: (
    sessionId: string,
    patch: Pick<AgentSession, 'codeMode' | 'multiAgentConcurrency' | 'providerId' | 'modelOverride'>,
  ) => Promise<AgentSession | null>;
  attachLiveSessionStream: (sessionId: string) => Promise<void>;
  startSessionAgentRun: (input: {
    sessionId: string;
    recoveringSubmissionId?: string;
    prompt: string;
    displayTitle?: string;
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
    codeMode?: boolean;
    multiAgentConcurrency?: number;
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
    mode?: 'synthesize' | 'update' | 'fix_problems' | 'complete_missing';
    instruction?: string;
    displayTitle?: string;
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
  startOntologyExtractionRun: (input: {
    systemId: string;
    projectId?: string;
    title: string;
    sourceType: 'DDL_ONLY' | 'OPENAPI_ONLY' | 'DDL_AND_OPENAPI';
    sourceSnippet: string;
    applyImmediately?: boolean;
    mockMode?: boolean;
  }) => Promise<{ sessionId: string } | null>;
  startPrototypeRefinementRun: (input: {
    projectId: string;
    prototypeId: string;
    instruction: string;
    selections?: PrototypeRefinementSelection[];
    images?: TransientTurnImageInput[];
    mockMode?: boolean;
  }) => Promise<{ sessionId: string }>;
  cancelSessionAgentRun: (sessionId: string) => Promise<void>;
  retrySessionAgentRun: (
    input: Parameters<WorkbenchStoreState['replaceLatestSessionTurnAndRun']>[0],
  ) => Promise<void>;
  replaceLatestSessionTurnAndRun: (input: {
    sessionId: string;
    prompt?: string;
    truncateFromUserMessageId?: string;
    activeModelCode?: ModelCode;
    reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
    codeMode?: boolean;
    multiAgentConcurrency?: number;
    mockMode?: boolean;
  }) => Promise<void>;
  acceptStepHandoff: (
    sessionId: string,
    handoffId: string,
  ) => Promise<AcceptStepHandoffResult | null>;
  declineStepHandoff: (
    sessionId: string,
    handoffId: string,
  ) => Promise<StepHandoffProposal | null>;
  removeQueuedSessionPrompt: (sessionId: string, queueId: string) => void;
}

const initialUrl = readUrlNavState();

function syncActiveProjectSummaryInBootstrap(nextData: BootstrapPayload): BootstrapPayload {
  const projectId = nextData.activeProject?.id;
  if (!projectId) return nextData;
  const derivedSteps = getProjectStepsFromBootstrap(nextData);
  const stepStates = Object.fromEntries(
    derivedSteps.map((st) => [st.id, st.state]),
  ) as Record<ProjectStepId, ProjectStepStateId>;
  const currentStep = resolveCurrentProjectStep(stepStates);
  return {
    ...nextData,
    projects: nextData.projects.map((p) =>
      p.id === projectId
        ? {
            ...p,
            currentStage: nextData.activeProject.currentStage,
            currentStep,
            currentStepState: stepStates[currentStep],
            stepStates,
            updatedAt: nextData.activeProject.updatedAt,
          }
        : p,
    ),
  };
}

function applyArtifactHistoryMutationToStore(
  projectId: string,
  res: ArtifactHistoryMutationResponse,
  set: (partial: Partial<WorkbenchStoreState>) => void,
  get: () => WorkbenchStoreState,
): void {
  const latest = get().data;
  if (!latest || latest.activeProject.id !== projectId) return;
  const nextData = syncActiveProjectSummaryInBootstrap({
    ...latest,
    activeProject: res.project,
    requirementDocs: res.requirementDocs,
    ...(res.prototypes !== undefined ? { prototypes: res.prototypes } : {}),
    ...(res.confirmedPrototypeRevision !== undefined
      ? { confirmedPrototypeRevision: res.confirmedPrototypeRevision }
      : {}),
    ...(res.agentSessions !== undefined ? { agentSessions: res.agentSessions } : {}),
    stepConfirmations: res.stepConfirmations,
    artifactHistory: res.artifactHistory,
  });
  const activeProtoId = get().activePrototypeIdByProject[projectId];
  const shouldClearActiveProto = Boolean(
    activeProtoId &&
      res.prototypes !== undefined &&
      !res.prototypes.some((p) => p.id === activeProtoId),
  );
  if (shouldClearActiveProto) {
    const nextProtoMap = { ...get().activePrototypeIdByProject };
    delete nextProtoMap[projectId];
    set({ data: nextData, activePrototypeIdByProject: nextProtoMap });
  } else {
    set({ data: nextData });
  }
}

export const useWorkbenchStore = create<WorkbenchStoreState>((set, get) => ({
  data: null,
  loading: true,
  toast: null,
  activeNav: initialUrl.nav || DEFAULT_NAV_VIEW,
  activeItemId: initialUrl.itemId || null,
  activeSessionId: initialUrl.sessionId || null,
  activePrototypeIdByProject: {},
  liveSessionDrafts: {},
  sessionQueues: {},
  selectedModel: 'M1',
  selectedElementId: null,
  highlightedRequirementSection: null,
  highlightedBusinessModelTarget: null,
  highlightedPrototypeTarget: null,
  highlightedPrototypeComparePair: null,
  historyDrawerArtifactKind: null,
  liveAnnouncement: '',

  setActiveNav: (nav, opts) => {
    const canonicalNav = normalizeNavViewAlias(nav) ?? nav;
    const nextItem = opts?.itemId !== undefined ? opts.itemId : get().activeItemId;
    const nextSess = opts?.sessionId !== undefined ? opts.sessionId : get().activeSessionId;
    set({
      activeNav: canonicalNav,
      activeItemId: nextItem,
      activeSessionId: nextSess,
    });
    writeUrlNavState({
      nav: canonicalNav,
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

  focusRequirementSection: (sectionHeading, docId) => {
    const nextSeq = (get().highlightedRequirementSection?.seq ?? 0) + 1;
    set({
      highlightedRequirementSection: {
        heading: sectionHeading,
        ...(docId ? { docId } : {}),
        seq: nextSeq,
      },
    });
  },

  focusBusinessModelTarget: (target) => {
    writeStepViewMode('BUSINESS_MODEL', 'business');
    const targetPage = target.pageId ?? target.objectId ?? null;
    if (target.modelCode) {
      set({
        selectedModel: target.modelCode,
        selectedElementId: target.elementId ?? target.objectId ?? null,
      });
    } else if (target.elementId || target.objectId) {
      set({ selectedElementId: target.elementId ?? target.objectId ?? null });
    }
    get().setActiveNav('app-ontology', { itemId: targetPage });
    const nextSeq = (get().highlightedBusinessModelTarget?.seq ?? 0) + 1;
    set({
      highlightedBusinessModelTarget: {
        ...(targetPage ? { pageId: targetPage } : {}),
        anchorId: target.anchorId ?? target.elementId ?? target.objectId ?? '',
        seq: nextSeq,
      },
    });
  },

  focusPrototypeTarget: (target) => {
    const projectId = get().data?.activeProject.id;
    if (projectId) {
      get().setActivePrototypeId(projectId, target.prototypeId);
    }
    get().setActiveNav('app-prototype', { itemId: target.prototypeId });
    const nextSeq = (get().highlightedPrototypeTarget?.seq ?? 0) + 1;
    set({
      highlightedPrototypeTarget: {
        prototypeId: target.prototypeId,
        ...(target.revisionId ? { revisionId: target.revisionId } : {}),
        ...(target.screenId ? { screenId: target.screenId } : {}),
        ...(target.elementId ? { elementId: target.elementId } : {}),
        seq: nextSeq,
      },
    });
  },

  openPrototypeRevisionCompare: (pair) => {
    const projectId = get().data?.activeProject.id;
    if (projectId) {
      get().setActivePrototypeId(projectId, pair.prototypeId);
    }
    get().setActiveNav('app-prototype', { itemId: pair.prototypeId });
    const nextSeq = (get().highlightedPrototypeComparePair?.seq ?? 0) + 1;
    set({
      highlightedPrototypeComparePair: {
        ...pair,
        seq: nextSeq,
      },
    });
  },

  clearPrototypeRevisionCompare: () => set({ highlightedPrototypeComparePair: null }),

  openArtifactHistoryDrawer: (kind) => set({ historyDrawerArtifactKind: kind }),

  closeArtifactHistoryDrawer: () => set({ historyDrawerArtifactKind: null }),

  refreshArtifactHistory: async (projectId, kind, prototypeId) => {
    const cur = get().data;
    const targetProjectId = projectId ?? cur?.activeProject.id;
    if (!targetProjectId) return [];
    const res = await apiListArtifactHistory(targetProjectId, kind, prototypeId);
    const latest = get().data;
    if (latest && latest.activeProject.id === targetProjectId) {
      const merged = kind
        ? [
            ...res.entries,
            ...(latest.artifactHistory ?? []).filter(
              (e) =>
                e.artifactKind !== kind ||
                (kind === 'PROTOTYPE' && prototypeId && e.targetId !== prototypeId),
            ),
          ]
        : res.entries;
      set({ data: { ...latest, artifactHistory: merged } });
    }
    return res.entries;
  },

  undoArtifactChange: async (artifactKind, expectedEntryId, prototypeId) => {
    const cur = get().data;
    if (!cur?.activeProject.id) return false;
    const projectId = cur.activeProject.id;
    const locale = getCurrentClientLocale();
    try {
      const res = await apiUndoArtifactChange(
        projectId,
        artifactKind,
        expectedEntryId,
        prototypeId,
      );
      applyArtifactHistoryMutationToStore(projectId, res, set, get);
      get().showToast(locale === 'en-US' ? 'Undid latest change' : '已撤销最近一次改动');
      return true;
    } catch (err) {
      get().showToast(err instanceof Error ? err.message : String(err));
      void get()
        .refreshArtifactHistory(projectId, artifactKind, prototypeId)
        .catch(() => undefined);
      return false;
    }
  },

  restoreArtifactBeforeChange: async (artifactKind, entryId) => {
    const cur = get().data;
    if (!cur?.activeProject.id) return false;
    const projectId = cur.activeProject.id;
    const locale = getCurrentClientLocale();
    try {
      const res = await apiRestoreArtifactBeforeChange(projectId, artifactKind, entryId);
      applyArtifactHistoryMutationToStore(projectId, res, set, get);
      get().showToast(
        locale === 'en-US'
          ? 'Restored to the state before that change (undoable)'
          : '已恢复到该次改动之前的状态（本次恢复也可撤销）',
      );
      return true;
    } catch (err) {
      get().showToast(err instanceof Error ? err.message : String(err));
      return false;
    }
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
    const merged: BootstrapPayload = { ...cur, ...patch };
    const shouldSyncSummary =
      patch.projects === undefined &&
      ('stepConfirmations' in patch ||
        'confirmedPrototypeRevision' in patch ||
        'prototypes' in patch ||
        'requirementDocs' in patch ||
        'activeProject' in patch ||
        'assembledApplications' in patch ||
        'packageSnapshots' in patch);
    set({
      data: shouldSyncSummary ? syncActiveProjectSummaryInBootstrap(merged) : merged,
    });
  },

  bootstrap: async (projectId) => {
    set({ loading: true });
    const targetId = projectId || readUrlNavState().projectId || readLastProjectIdFromStorage();
    const qs = targetId ? `?projectId=${encodeURIComponent(targetId)}` : '';
    const res = await fetch(`/api/bootstrap${qs}`, {
      headers: buildLocaleHeaders(),
    });
    const payload = (await res.json()) as BootstrapPayload;

    set({
      data: payload,
      loading: false,
      selectedElementId: null,
      highlightedRequirementSection: null,
      highlightedBusinessModelTarget: null,
      highlightedPrototypeTarget: null,
      highlightedPrototypeComparePair: null,
      historyDrawerArtifactKind: null,
    });
    writeLastProjectIdToStorage(payload.activeProject.id);
    writeUrlNavState({ projectId: payload.activeProject.id });

    // Reconnect live SSE streams for any durable background Agent Sessions still running on the server
    for (const sess of payload.agentSessions ?? []) {
      if (restorePendingCancellation(sess.id)) continue;
      if (readPendingTurn(sess.id) || sess.status === 'RUNNING') {
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
      headers: buildJsonHeaders(),
      body: JSON.stringify(input),
    });
    const { project } = (await res.json()) as { project: ProjectDetail };
    await get().bootstrap(project.id);
    get().showToast(
      getCurrentClientLocale() === 'en-US'
        ? `Created project "${project.name}"`
        : `已创建项目「${project.name}」`,
    );
    return project;
  },

  createProjectFromDescription: async (description) => {
    const trimmed = description.trim();
    if (!trimmed) {
      throw new Error('Project description is required.');
    }
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: buildJsonHeaders(),
      body: JSON.stringify({ description: trimmed }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Create project failed');
    }
    const { project } = (await res.json()) as { project: ProjectDetail };
    await get().bootstrap(project.id);

    const session = await get().ensureProjectAgentSession(project.id, 'REQUIREMENT', {
      title: project.name,
    });
    useAgentPanelStore
      .getState()
      .rememberSession(agentSessionScopeKey(project.id, 'REQUIREMENT'), session.id);
    useAgentPanelStore.getState().revealPanel();

    const targetView = getDefaultViewForStep('REQUIREMENTS');
    get().setActiveNav(targetView, { itemId: null, sessionId: session.id });

    const runPromise = get().startSessionAgentRun({
      sessionId: session.id,
      prompt: trimmed,
    });

    return { project, session, runPromise };
  },

  saveSuiteWithUndo: async (suite, note) => {
    const cur = get().data;
    if (!cur) return;
    const res = await fetch(`/api/projects/${cur.activeProject.id}/suite`, {
      method: 'PUT',
      headers: buildJsonHeaders(),
      body: JSON.stringify({ suite, changelogNote: note }),
    });
    const { project, artifactHistory } = (await res.json()) as {
      project: ProjectDetail;
      artifactHistory?: ArtifactHistoryEntryView[];
    };
    const latest = get().data ?? cur;
    set({
      data: {
        ...latest,
        activeProject: project,
        ...(artifactHistory ? { artifactHistory } : {}),
        projects: latest.projects.map((p) =>
          p.id === project.id
            ? { ...p, currentStage: project.currentStage, updatedAt: project.updatedAt }
            : p,
        ),
      },
    });
  },

  applyBusinessModelEdit: async (payload) => {
    const cur = get().data;
    if (!cur) {
      return {
        ok: false,
        rejection: {
          code: 'SUITE_VALIDATION_REJECTED',
          reasonZh: '当前未加载项目，无法保存修改。',
          reasonEn: 'No active project is loaded.',
          assistantPromptZh: '',
          assistantPromptEn: '',
          newErrorCount: 0,
        },
      };
    }
    const result = await apiPatchBusinessModel(cur.activeProject.id, payload);
    if (!result.ok) {
      return result;
    }

    const latest = get().data ?? cur;
    set({
      data: {
        ...latest,
        activeProject: result.project,
        ...(result.artifactHistory ? { artifactHistory: result.artifactHistory } : {}),
        projects: result.projects ?? latest.projects.map((p) =>
          p.id === result.project.id
            ? {
                ...p,
                currentStage: result.project.currentStage,
                updatedAt: result.project.updatedAt,
              }
            : p,
        ),
      },
    });
    return result;
  },

  undo: async () => {
    const cur = get().data;
    if (!cur?.activeProject.id) return;
    const { canUndo, latestEntryId } = getOntologyUndoRedoState(cur.artifactHistory);
    if (!canUndo || !latestEntryId) return;
    await get().undoArtifactChange('ONTOLOGY_SUITE', latestEntryId);
  },

  redo: async () => {
    const cur = get().data;
    if (!cur?.activeProject.id) return;
    const { canRedo, latestEntryId } = getOntologyUndoRedoState(cur.artifactHistory);
    if (!canRedo || !latestEntryId) return;
    const projectId = cur.activeProject.id;
    const locale = getCurrentClientLocale();
    try {
      const res = await apiUndoArtifactChange(projectId, 'ONTOLOGY_SUITE', latestEntryId);
      applyArtifactHistoryMutationToStore(projectId, res, set, get);
      get().showToast(locale === 'en-US' ? 'Redid latest change' : '已重做最近一次改动');
    } catch (err) {
      get().showToast(err instanceof Error ? err.message : String(err));
      void get().refreshArtifactHistory(projectId, 'ONTOLOGY_SUITE').catch(() => undefined);
    }
  },

  confirmRequirementsStep: async (docId) => {
    const cur = get().data;
    if (!cur) return null;
    const projectId = cur.activeProject.id;
    const res = await apiPostJson<{
      confirmation: RequirementsStepConfirmationRecord;
      doc: RequirementDoc;
      docs: RequirementDoc[];
      stepConfirmations: ProjectStepConfirmations;
    }>(
      `/api/projects/${encodeURIComponent(projectId)}/steps/requirements/confirm`,
      docId ? { docId } : {},
    );
    const latest = get().data;
    if (latest && latest.activeProject.id === projectId) {
      set({
        data: syncActiveProjectSummaryInBootstrap({
          ...latest,
          requirementDocs: res.docs,
          stepConfirmations: res.stepConfirmations,
        }),
      });
    }
    return res.confirmation;
  },

  confirmBusinessModelStep: async () => {
    const cur = get().data;
    if (!cur) return null;
    const projectId = cur.activeProject.id;
    const res = await apiPostJson<{
      confirmation: BusinessModelStepConfirmationRecord;
      project: ProjectDetail;
      stepConfirmations: ProjectStepConfirmations;
    }>(`/api/projects/${encodeURIComponent(projectId)}/steps/business-model/confirm`, {});
    const latest = get().data;
    if (latest && latest.activeProject.id === projectId) {
      set({
        data: syncActiveProjectSummaryInBootstrap({
          ...latest,
          activeProject: res.project,
          stepConfirmations: res.stepConfirmations,
        }),
      });
    }
    return res.confirmation;
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
    // Canvas actions land in the conversation the Agent Panel is showing for this agent.
    const rememberedId =
      useAgentPanelStore.getState().sessionByScope[
        agentSessionScopeKey(projectId, agentKind, opts?.targetId)
      ];
    const existing =
      (preferredId ? candidates.find((s) => s.id === preferredId) : undefined) ??
      (rememberedId ? candidates.find((s) => s.id === rememberedId) : undefined) ??
      candidates[0];
    if (existing) {
      return existing;
    }

    const locale = getCurrentClientLocale();
    const defaultTitleByKind: Record<AgentSessionKind, { zh: string; en: string }> = {
      REQUIREMENT: { zh: '需求梳理对话', en: 'Requirements conversation' },
      COPILOT: { zh: '业务模型对话', en: 'Business model conversation' },
      PROTOTYPE_CO_DESIGN: { zh: '原型共创对话', en: 'Prototype conversation' },
      ARCHITECTURE: { zh: '开发规范编写对话', en: 'Standards authoring conversation' },
      CODING: { zh: '应用交付对话', en: 'Delivery conversation' },
      CAPABILITY: { zh: '能力中心对话', en: 'Capability conversation' },
      REASONING: { zh: '数据分析对话', en: 'Data analysis conversation' },
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
      // The server answers with every project's sessions, so replacing avoids duplicate rows.
      set({ data: { ...latest, agentSessions: created.agentSessions } });
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

  updateAgentSessionExecutionConfig: async (sessionId, patch) => {
    try {
      const res = await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PATCH',
        headers: buildJsonHeaders(),
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        session: AgentSession;
        agentSessions?: AgentSession[];
      };
      const latest = get().data;
      if (latest) {
        const { providerId, modelOverride, multiAgentConcurrency, codeMode } = body.session;
        set({ data: { ...latest, agentSessions: latest.agentSessions.map((session) =>
          session.id === sessionId
            ? { ...session, providerId, modelOverride, multiAgentConcurrency, codeMode }
            : session),
        } });
      }
      return body.session;
    } catch {
      return null;
    }
  },

  attachLiveSessionStream: async (sessionId) => {
    if (restorePendingCancellation(sessionId)) return;
    if (activeSessionStreamAborters.has(sessionId)) return;
    const pending = readPendingTurn(sessionId);
    if (pending) {
      await get().startSessionAgentRun({ ...pending.input, recoveringSubmissionId: pending.submissionId });
      return;
    }
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
            ...(lastUser?.images && lastUser.images.length > 0 ? { images: lastUser.images } : {}),
            startedAt: lastUser ? Date.parse(lastUser.timestamp) || Date.now() : Date.now(),
            liveStatus: { zh: '正在同步后台运行进展…', en: 'Reconnecting to live run…' },
            thinking: '',
            text: '',
            steps: [],
          },
        },
      });
    }

    let terminalSeen = false;
    let lastEventId: string | undefined;
    const baseCallbacks = buildStoreSessionStreamCallbacks(sessionId, set, get);
    const trackedCallbacks: StreamAgentSessionCallbacks = {
      ...baseCallbacks,
      onEventId: (id) => {
        lastEventId = id;
      },
      onRunError: (p) => {
        terminalSeen = true;
        baseCallbacks.onRunError?.(p);
      },
      onMessageEnd: (p) => {
        terminalSeen = true;
        baseCallbacks.onMessageEnd?.(p);
      },
    };

    try {
      await reconcileSessionStream({
        signal: controller.signal,
        ended: () => terminalSeen,
        onWaiting: () => {
          const curDraft = get().liveSessionDrafts[sessionId];
          if (curDraft) {
            set({
              liveSessionDrafts: {
                ...get().liveSessionDrafts,
                [sessionId]: {
                  ...curDraft,
                  reconnecting: true,
                  liveStatus: {
                    zh: '连接闪断，正在自动接回后台进展…',
                    en: 'Connection interrupted — reconnecting to live run…',
                  },
                },
              },
            });
          }
        },
        attach: () => attachAgentSessionLiveStream(sessionId, trackedCallbacks, {
            ...(lastEventId ? { afterEventId: lastEventId } : {}),
            signal: controller.signal,
        }),
      });
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
    if (restorePendingCancellation(sessionId)) return;
    const pending = input.recoveringSubmissionId ? readPendingTurn(sessionId) : undefined;
    const answerSummary = input.askUserAnswer
      ? [input.askUserAnswer.selectedAnswers.join(', '), input.askUserAnswer.freeformText]
          .filter(Boolean)
          .join(' · ')
      : '';
    const imageCount = input.images?.length ?? pending?.imageRefs?.length ?? 0;
    const hasTurnImages = imageCount > 0;
    const fallbackImagePrompt =
      hasTurnImages && !prompt.trim() && !answerSummary
        ? getCurrentClientLocale() === 'en-US'
          ? `Please inspect the ${imageCount} attached reference image(s).`
          : `请结合附带的 ${imageCount} 张参考图进行分析。`
        : '';
    const effectivePrompt = prompt.trim() || answerSummary || fallbackImagePrompt;
    if (!effectivePrompt && !input.askUserAnswer && !hasTurnImages) return;

    if (activeSessionStreamAborters.has(sessionId) || Boolean(get().liveSessionDrafts[sessionId])) {
      const existingQueue = get().sessionQueues[sessionId] ?? [];
      const item: QueuedSessionPromptItem = {
        id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        prompt: effectivePrompt,
        ...(input.displayTitle ? { displayTitle: input.displayTitle } : {}),
        ...(input.askUserAnswer ? { askUserAnswer: input.askUserAnswer } : {}),
        ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
        ...(input.designBrief ? { designBrief: input.designBrief } : {}),
        ...(input.prototypeName ? { prototypeName: input.prototypeName } : {}),
        ...(input.activeModelCode ? { activeModelCode: input.activeModelCode } : {}),
        ...(input.reasoningMode ? { reasoningMode: input.reasoningMode } : {}),
        ...(input.mockMode !== undefined ? { mockMode: input.mockMode } : {}),
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

    const draftRunId = pending?.submissionId ?? (typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join(''));
    const draftImages: AgentImageAttachmentRef[] | undefined =
      input.images && input.images.length > 0
        ? input.images.map((img) => ({
            id: img.id,
            name: img.name,
            mimeType: img.mimeType,
            source: img.remoteUrl ? 'remote' : 'local',
            ...(img.remoteUrl ? { remoteUrl: img.remoteUrl } : {}),
            ...(img.width !== undefined ? { width: img.width } : {}),
            ...(img.height !== undefined ? { height: img.height } : {}),
            ...(img.role ? { role: img.role } : {}),
          }))
        : pending?.imageRefs;
    const { images, recoveringSubmissionId, ...persistable } = input;
    if (!pending) writePendingTurn(sessionId, { submissionId: draftRunId, input: persistable, imageRefs: draftImages });
    set({
      liveSessionDrafts: {
        ...get().liveSessionDrafts,
        [sessionId]: {
          runId: draftRunId,
          submissionId: draftRunId,
          sessionId,
          userPrompt: effectivePrompt,
          ...(input.displayTitle ? { displayTitle: input.displayTitle } : {}),
          ...(draftImages ? { images: draftImages } : {}),
          startedAt: Date.now(),
          liveStatus: { zh: '正在读取指令…', en: 'Reading your instruction…' },
          thinking: '',
          text: '',
          steps: [],
        },
      },
    });

    let terminalSeen = false;
    let lastEventId: string | undefined;
    const baseCallbacks = buildStoreSessionStreamCallbacks(sessionId, set, get);
    const trackedCallbacks: StreamAgentSessionCallbacks = {
      ...baseCallbacks,
      onEventId: (id) => {
        lastEventId = id;
      },
      onRunError: (p) => {
        terminalSeen = true;
        baseCallbacks.onRunError?.(p);
      },
      onMessageEnd: (p) => {
        terminalSeen = true;
        baseCallbacks.onMessageEnd?.(p);
      },
    };

    const send = async () => {
        const restoredImages = images ?? await resolveSavedTurnImages(get().data, get().data?.agentSessions.find(session => session.id === sessionId), pending?.imageRefs);
        await streamAgentSessionTurn(
          sessionId,
          {
            submissionId: draftRunId,
            ...(prompt.trim() ? { prompt } : {}),
            ...(input.askUserAnswer ? { askUserAnswer: input.askUserAnswer } : {}),
            ...(restoredImages?.length ? { images: restoredImages } : {}),
            ...(input.designBrief ? { designBrief: input.designBrief } : {}),
            ...(input.prototypeName ? { prototypeName: input.prototypeName } : {}),
            ...(input.activeModelCode ? { activeModelCode: input.activeModelCode } : {}),
            ...(input.reasoningMode ? { reasoningMode: input.reasoningMode } : {}),
            ...(input.codeMode !== undefined ? { codeMode: input.codeMode } : {}),
            ...(input.multiAgentConcurrency !== undefined
              ? { multiAgentConcurrency: input.multiAgentConcurrency }
              : {}),
            ...(input.mockMode !== undefined ? { mockMode: input.mockMode } : {}),
          },
          trackedCallbacks,
          controller.signal,
        );
    };
    try {
      if (!recoveringSubmissionId) {
        try { await send(); } catch {}
      }
      await reconcileSessionStream({
        signal: controller.signal,
        ended: () => terminalSeen,
        resend: send,
        onAbsentAfterResend: () => trackedCallbacks.onRunError?.({ diagnostic: {
          code: 'TURN_NOT_DELIVERED',
          message: getCurrentClientLocale() === 'en-US' ? 'The instruction was not delivered. No work started.' : '指令未送达，没有启动任务。',
          remediation: getCurrentClientLocale() === 'en-US' ? 'Retry this message.' : '可重试这条消息。',
        } }),
        onWaiting: () => {
          const curDraft = get().liveSessionDrafts[sessionId];
          if (curDraft) {
            set({
              liveSessionDrafts: {
                ...get().liveSessionDrafts,
                [sessionId]: {
                  ...curDraft,
                  reconnecting: true,
                  liveStatus: {
                    zh: '正在确认指令送达状态并同步进展…',
                    en: 'Checking delivery and syncing progress…',
                  },
                },
              },
            });
          }
        },
        attach: () => attachAgentSessionLiveStream(sessionId, trackedCallbacks, {
          submissionId: draftRunId, afterEventId: lastEventId, signal: controller.signal,
        }),
      });
    } finally {
      if (activeSessionStreamAborters.get(sessionId) === controller) {
        if (terminalSeen) writePendingTurn(sessionId);
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
                ...(nextItem.askUserAnswer ? { askUserAnswer: nextItem.askUserAnswer } : {}),
                ...(nextItem.images ? { images: nextItem.images } : {}),
                ...(nextItem.designBrief ? { designBrief: nextItem.designBrief } : {}),
                ...(nextItem.prototypeName ? { prototypeName: nextItem.prototypeName } : {}),
                ...(nextItem.activeModelCode ? { activeModelCode: nextItem.activeModelCode } : {}),
                ...(nextItem.reasoningMode ? { reasoningMode: nextItem.reasoningMode } : {}),
                ...(nextItem.mockMode !== undefined ? { mockMode: nextItem.mockMode } : {}),
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
          ? `${curData.activeProject.name} Business Model`
          : `${curData.activeProject.name} 业务模型对话`,
    });
    get().setActiveSessionId(session.id);

    const payload: Record<string, unknown> = {
      ...(opts?.prototypeId ? { prototypeId: opts.prototypeId } : {}),
      ...(opts?.docId ? { docId: opts.docId } : {}),
      ...(opts?.mode ? { mode: opts.mode } : {}),
    };
    const header = `[ACTION:SYNTHESIZE_ONTOLOGY_SUITE ${JSON.stringify(payload)}]`;
    const defaultInstruction =
      locale === 'en-US'
        ? 'Synthesize and validate the 11-model Ontology Suite from the confirmed UI prototype and SRS context via synthesize_ontology_suite.'
        : '请从已确认的界面原型锚点与需求规格上下文推导并校验完整的 11 模型本体套件，通过 synthesize_ontology_suite 工具保存。';
    const instruction = opts?.instruction?.trim() || defaultInstruction;

    await get().startSessionAgentRun({
      sessionId: session.id,
      prompt: `${header}\n${instruction}`,
      ...(opts?.displayTitle?.trim() ? { displayTitle: opts.displayTitle.trim() } : {}),
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
    const session = await get().ensureProjectAgentSession(projectId, 'ARCHITECTURE');
    get().setActiveSessionId(session.id);

    const payload: Record<string, unknown> = {
      name: input.name.trim(),
      ...(input.stackTags && input.stackTags.length > 0 ? { stackTags: input.stackTags } : {}),
      ...(input.prompt?.trim() ? { prompt: input.prompt.trim() } : {}),
    };
    const header = `[ACTION:GENERATE_TECH_ARCH ${JSON.stringify(payload)}]`;
    const instruction =
      locale === 'en-US'
        ? `Generate a production technical architecture specification "${input.name}"${input.prompt?.trim() ? ` (${input.prompt.trim()})` : ''} and save it via save_tech_architecture_spec.`
        : `请编写可复用的技术架构规范「${input.name}」${input.prompt?.trim() ? `（补充要求：${input.prompt.trim()}）` : ''}，并通过 save_tech_architecture_spec 工具保存为仓库规范。`;
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

  startOntologyExtractionRun: async (input) => {
    const curData = get().data;
    if (!curData) return null;
    const targetProjectId = input.projectId || curData.activeProject.id;
    const locale = getCurrentClientLocale();
    const sys = curData.legacySystems.find((s) => s.id === input.systemId);
    const sysName = sys?.name || input.systemId;
    const session = await get().ensureProjectAgentSession(targetProjectId, 'CAPABILITY', {
      title:
        locale === 'en-US'
          ? `${curData.activeProject.name} Capability & Extraction Agent`
          : `${curData.activeProject.name} 能力与本体萃取智能体`,
    });
    get().setActiveSessionId(session.id);
    useAgentPanelStore.getState().revealPanel();

    const payload = {
      systemId: input.systemId,
      title: input.title.trim() || `${sysName} Ontology Extraction`,
      sourceType: input.sourceType,
      sourceSnippet: input.sourceSnippet,
      applyImmediately: Boolean(input.applyImmediately),
    };
    const header = `[ACTION:RUN_ONTOLOGY_EXTRACTION ${JSON.stringify(payload)}]`;
    const instruction =
      locale === 'en-US'
        ? `Extract ontology candidates (M1 objects, M3 rules, M7 commands, ME mappings) from legacy system "${sysName}" (${input.sourceType}) and record the extraction job.`
        : `请解析存量系统「${sysName}」的 ${input.sourceType} 契约片段，智能萃取 M1 业务对象、M3 业务规则、M7 接口指令与 ME 外部映射候选并记录萃取任务。`;
    const displayTitle =
      locale === 'en-US'
        ? `Ontology Extraction: ${payload.title}`
        : `本体萃取：${payload.title}`;

    await get().startSessionAgentRun({
      sessionId: session.id,
      prompt: `${header}\n${instruction}`,
      displayTitle,
      ...(input.mockMode !== undefined ? { mockMode: input.mockMode } : {}),
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
    const existingJob = cancellationJobs.get(sessionId);
    if (existingJob) return existingJob;
    const draft = get().liveSessionDrafts[sessionId];
    const session = get().data?.agentSessions.find(item => item.id === sessionId);
    const latest = session?.messages.at(-1);
    const submissionId = readPendingTurn(sessionId)?.submissionId ?? draft?.submissionId;
    const runId = draft?.serverRunId ?? (latest?.role === 'user' ? latest.runId ?? latest.id : undefined);
    const target = pendingCancellation(sessionId) ?? (submissionId ? { submissionId } : runId ? { runId } : undefined);
    if (!target) return;
    cancellationCache.set(sessionId, target);
    try { sessionStorage.setItem(cancellationKey(sessionId), JSON.stringify(target)); } catch {}
    cancelledSessionIds.add(sessionId);
    const aborter = activeSessionStreamAborters.get(sessionId);
    if (aborter) {
      aborter.abort();
      activeSessionStreamAborters.delete(sessionId);
    }

    const nextQueues = { ...get().sessionQueues };
    delete nextQueues[sessionId];
    const stoppedDraft: SessionLiveDraft = {
      ...(draft ?? {runId: runId ?? ('submissionId' in target ? target.submissionId : target.runId), sessionId,
      userPrompt: readPendingTurn(sessionId)?.input.prompt ?? latest?.content ?? '', startedAt: Date.now(),
      text: '', thinking: '', steps: []}),
      cancellationPending: true, liveStatus: { zh: '正在确认停止请求…', en: 'Waiting for the stop request to be confirmed…' },
    };
    set({ sessionQueues: nextQueues, liveSessionDrafts: { ...get().liveSessionDrafts, [sessionId]: stoppedDraft } });
    const job = (async () => {
      const signal = new AbortController().signal;
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await apiAbortAgentSession(sessionId, target);
          const data = get().data;
          const drafts = { ...get().liveSessionDrafts };
          delete drafts[sessionId];
          writePendingTurn(sessionId);
          try { sessionStorage.removeItem(cancellationKey(sessionId)); } catch {}
          cancellationCache.delete(sessionId);
          set({ liveSessionDrafts: drafts, ...(data && res.session ? { data: { ...data,
            agentSessions: data.agentSessions.map(item => item.id === sessionId ? res.session! : item),
          } } : {}) });
          if (res.session?.status === 'RUNNING') void get().attachLiveSessionStream(sessionId);
          return;
        } catch {
          await waitForRecovery(signal, attempt);
        }
      }
    })().finally(() => cancellationJobs.delete(sessionId));
    cancellationJobs.set(sessionId, job);
    return job;
  },

  retrySessionAgentRun: async (input) => {
    const { sessionId, truncateFromUserMessageId, prompt, ...options } = input;
    if (activeSessionStreamAborters.has(sessionId) || get().liveSessionDrafts[sessionId]) return;
    const data = get().data;
    const session = data?.agentSessions.find((item) => item.id === sessionId);
    if (!session || session.status === 'RUNNING') return;
    const userMessage = session.messages.findLast((message) => message.role === 'user');
    if (!userMessage || (truncateFromUserMessageId && truncateFromUserMessageId !== userMessage.id)) return;
    const reply = session.messages.at(-1);
    const build = reply?.prototypeBuild;
    const isPrototype = session.agentKind === 'PROTOTYPE_CO_DESIGN';
    const prototype = isPrototype
      ? data?.prototypes.find((item) => item.id === session.targetId || item.coDesignSessionId === sessionId)
      : undefined;
    const originalPrompt = (prompt ?? userMessage.content).trim();
    const interrupted = Boolean(reply?.errorDiagnostic || reply?.cancelled);
    const revisionId = prototype?.currentRevisionId;
    const resumeBuild = revisionId && !originalPrompt.startsWith('[ACTION:RESUME_PROTOTYPE_SCREEN ') && (
      build?.revisionId === revisionId
        ? build.plan.some(({ screenId }) => build.screens[screenId]?.status !== 'done')
        : interrupted && splitPrototypeDocument(prototype.htmlContent).screens.some(({ status }) => status === 'queued')
    );
    if (!resumeBuild && !interrupted) {
      return get().replaceLatestSessionTurnAndRun(input);
    }
    const locale = getCurrentClientLocale();
    const title = locale === 'en-US' ? 'Continue unfinished screens' : '继续未完成的页面';
    const nextPrompt = resumeBuild
      ? `[ACTION:RESUME_PROTOTYPE_BUILD ${JSON.stringify({ revisionId })}] ${title}`
      : originalPrompt;
    const images = resumeBuild ? undefined : await resolveSavedTurnImages(data, session, userMessage.images);
    if (activeSessionStreamAborters.has(sessionId) || get().liveSessionDrafts[sessionId]) return;
    await get().startSessionAgentRun({
      ...options,
      sessionId,
      prompt: nextPrompt,
      ...(resumeBuild ? { displayTitle: title } : {}),
      ...(isPrototype && !prototype && session.designBrief ? { prototypeName: session.title } : {}),
      ...(images?.length ? { images } : {}),
    });
  },

  replaceLatestSessionTurnAndRun: async (input) => {
    const { sessionId } = input;
    if (activeSessionStreamAborters.has(sessionId) || Boolean(get().liveSessionDrafts[sessionId])) {
      return;
    }
    const cur = get().data;
    const sess = cur?.agentSessions.find((s) => s.id === sessionId);
    let lastUserMsg: AgentSession['messages'][number] | undefined;
    if (sess) {
      for (let i = sess.messages.length - 1; i >= 0; i -= 1) {
        const m = sess.messages[i]!;
        if (m.role === 'user') {
          lastUserMsg = m;
          break;
        }
      }
    }
    const nextPrompt =
      input.prompt !== undefined ? input.prompt.trim() : (lastUserMsg?.content ?? '').trim();
    const preservedRefs = lastUserMsg?.images;
    if (!nextPrompt && (!preservedRefs || preservedRefs.length === 0)) return;

    const preservedTurnImages = await resolveSavedTurnImages(cur, sess, preservedRefs);

    const hasUserTurns = Boolean(sess?.messages.some((m) => m.role === 'user'));
    const targetMessageId = input.truncateFromUserMessageId ?? lastUserMsg?.id;
    const hasTargetInSession = Boolean(
      targetMessageId && sess?.messages.some((m) => m.id === targetMessageId && m.role === 'user'),
    );
    if (hasUserTurns || input.truncateFromUserMessageId !== undefined) {
      try {
        const patched = await apiPatchAgentSession(sessionId, {
          dropLatestTurn: true,
          ...(hasTargetInSession || input.truncateFromUserMessageId
            ? { truncateFromUserMessageId: targetMessageId }
            : {}),
        });
        const latestData = get().data;
        if (latestData) {
          set({
            data: {
              ...latestData,
              agentSessions: patched.agentSessions,
            },
          });
        }
      } catch (err) {
        const locale = getCurrentClientLocale();
        const code = (err as { code?: string } | null)?.code;
        if (
          code === 'SESSION_RUNNING' ||
          code === 'ONLY_LATEST_TURN_ALLOWED' ||
          code === 'TURN_NOT_FOUND' ||
          code === 'SESSION_NOT_FOUND'
        ) {
          get().showToast((err as Error).message);
        } else {
          get().showToast(
            locale === 'en-US'
              ? 'Could not resend the latest message. Please try again.'
              : '重发最后一条消息失败，请稍后重试。',
          );
        }
        return;
      }
    }

    await get().startSessionAgentRun({
      sessionId,
      prompt: nextPrompt,
      ...(preservedTurnImages && preservedTurnImages.length > 0
        ? { images: preservedTurnImages }
        : {}),
      ...(input.activeModelCode ? { activeModelCode: input.activeModelCode } : {}),
      ...(input.reasoningMode ? { reasoningMode: input.reasoningMode } : {}),
      ...(input.codeMode !== undefined ? { codeMode: input.codeMode } : {}),
      ...(input.multiAgentConcurrency !== undefined
        ? { multiAgentConcurrency: input.multiAgentConcurrency }
        : {}),
      ...(input.mockMode !== undefined ? { mockMode: input.mockMode } : {}),
    });
  },

  acceptStepHandoff: async (sessionId, handoffId) => {
    const cur = get().data;
    const sourceSession = cur?.agentSessions.find((s) => s.id === sessionId);
    const proposal = sourceSession?.messages
      .slice()
      .reverse()
      .find((m) => m.stepHandoff?.id === handoffId)?.stepHandoff;
    const projectId = sourceSession?.projectId ?? cur?.activeProject.id;

    let preferredTargetSessionId: string | undefined;
    let preferredPrototypeId: string | undefined;
    let preferredApplicationId: string | undefined;

    if (projectId && proposal) {
      const targetKind = STEP_SPECIALIST_AGENT_KINDS[proposal.targetStep];
      if (proposal.targetStep === 'PROTOTYPE') {
        preferredPrototypeId = get().activePrototypeIdByProject[projectId];
      } else {
        if (proposal.targetStep === 'DELIVERY') {
          const activeApp = cur?.assembledApplications.find(
            (a) => a.id === get().activeItemId && a.projectId === projectId,
          );
          preferredApplicationId = activeApp?.id;
        }
        preferredTargetSessionId =
          useAgentPanelStore.getState().sessionByScope[
            agentSessionScopeKey(projectId, targetKind)
          ];
      }
    }

    const res = await apiAcceptStepHandoff(sessionId, handoffId, {
      runInBackground: true,
      ...(preferredTargetSessionId ? { preferredTargetSessionId } : {}),
      ...(preferredPrototypeId ? { preferredPrototypeId } : {}),
      ...(preferredApplicationId ? { preferredApplicationId } : {}),
    });

    const latest = get().data;
    if (latest) {
      const isSameProject = projectId && latest.activeProject.id === projectId;
      set({
        data: {
          ...latest,
          agentSessions: res.agentSessions,
          ...(isSameProject && res.project ? { activeProject: res.project } : {}),
          ...(isSameProject && res.stepConfirmations
            ? { stepConfirmations: res.stepConfirmations }
            : {}),
        },
      });
    }

    if (projectId) {
      if (res.targetStep === 'PROTOTYPE' && res.targetItemId) {
        get().setActivePrototypeId(projectId, res.targetItemId);
      } else if (res.targetStep !== 'PROTOTYPE') {
        const targetKind = STEP_SPECIALIST_AGENT_KINDS[res.targetStep];
        useAgentPanelStore
          .getState()
          .rememberSession(agentSessionScopeKey(projectId, targetKind), res.targetSessionId);
      }
    }

    useAgentPanelStore.getState().revealPanel();
    get().setActiveNav(res.targetNavView, {
      itemId: res.targetItemId ?? null,
      sessionId: res.targetSessionId,
    });
    void get().attachLiveSessionStream(res.targetSessionId);

    return res;
  },

  declineStepHandoff: async (sessionId, handoffId) => {
    const res = await apiDeclineStepHandoff(sessionId, handoffId);
    const latest = get().data;
    if (latest) {
      set({
        data: {
          ...latest,
          agentSessions: res.agentSessions,
        },
      });
    }
    return res.handoff;
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
    dropLatestTurn?: boolean;
    truncateFromUserMessageId?: string;
  },
): Promise<{ session: AgentSession; agentSessions: AgentSession[] }> {
  const res = await fetch(`/api/agent-sessions/${sessionId}`, {
    method: 'PATCH',
    headers: buildJsonHeaders(),
    body: JSON.stringify(patch),
  });
  const payload = (await res.json()) as {
    session: AgentSession;
    agentSessions: AgentSession[];
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    const locale = getCurrentClientLocale();
    let message: string;
    if (payload.code === 'SESSION_RUNNING') {
      message =
        locale === 'en-US'
          ? 'Cannot edit or retry while a reply is still in progress.'
          : '当前正在回复中，请稍候再修改或重发。';
    } else if (payload.code === 'ONLY_LATEST_TURN_ALLOWED') {
      message =
        locale === 'en-US'
          ? 'Only the latest message can be edited or retried.'
          : '仅支持修改或重发最后一条消息。';
    } else if (payload.code === 'TURN_NOT_FOUND' || payload.code === 'SESSION_NOT_FOUND') {
      message =
        locale === 'en-US'
          ? 'This message or conversation is no longer available.'
          : '未找到对应的消息或对话。';
    } else {
      message =
        locale === 'en-US'
          ? 'Could not update the conversation. Please try again.'
          : '更新对话失败，请稍后重试。';
    }
    const err = new Error(message) as Error & { code?: string; status?: number };
    if (payload.code) err.code = payload.code;
    err.status = res.status;
    throw err;
  }
  return payload;
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
  target: CancelTarget,
): Promise<{ acknowledged: true; aborted: boolean; session?: AgentSession }> {
  return withStreamWatchdog(undefined, async signal => {
    const res = await fetch(`/api/agent-sessions/${sessionId}/abort`, {
      method: 'POST', headers: buildJsonHeaders(), body: JSON.stringify(target), signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ack = await res.json();
    if (ack.acknowledged !== true) throw new Error('Stop request was not confirmed');
    return ack;
  });
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

export async function apiAcceptStepHandoff(
  sessionId: string,
  handoffId: string,
  input?: {
    preferredTargetSessionId?: string;
    preferredPrototypeId?: string;
    preferredApplicationId?: string;
    runInBackground?: boolean;
    mockMode?: boolean;
  },
): Promise<AcceptStepHandoffResult> {
  return apiPostJson<AcceptStepHandoffResult>(
    `/api/agent-sessions/${encodeURIComponent(sessionId)}/handoffs/${encodeURIComponent(handoffId)}/accept`,
    input ?? {},
  );
}

export async function apiDeclineStepHandoff(
  sessionId: string,
  handoffId: string,
): Promise<{
  handoff: StepHandoffProposal;
  sourceSession: AgentSession;
  agentSessions: AgentSession[];
}> {
  return apiPostJson(
    `/api/agent-sessions/${encodeURIComponent(sessionId)}/handoffs/${encodeURIComponent(handoffId)}/decline`,
    {},
  );
}

export interface StreamAgentSessionCallbacks {
  onEventId?: (id: string) => void;
  onSessionMeta?: (meta: {
    runId?: string;
    sessionId: string;
    title: string;
    provider: string;
    model: string;
    isMock: boolean;
    visionSupported?: boolean;
    visionFallbackNotice?: string;
    codeMode?: boolean;
    multiAgentConcurrency?: number;
  }) => void;
  onHeartbeat?: (hb: {
    runId?: string;
    elapsedMs: number;
    thinkingChars: number;
    textChars: number;
    toolArgChars: number;
    activeSubagents: number;
  }) => void;
  onThinkingDelta?: (delta: string, step: number) => void;
  onTextDelta?: (delta: string, step: number) => void;
  onToolDelta?: (delta: {
    step: number;
    toolName?: string;
    streamedChars: number;
  }) => void;
  onToolCall?: (call: {
    id: string;
    toolName: string;
    arguments: Record<string, unknown>;
    step: number;
    targetAnchor?: PrototypeTargetAnchor;
  }) => void;
  onToolResult?: (trace: AgentToolCallTrace, step: number) => void;
  onSubagentUpdate?: (payload: {
    lane: AgentSubagentLaneTrace;
    lanes: AgentSubagentLaneTrace[];
  }) => void;
  /** One per-screen (or frame) delta of a prototype being built live (#89). */
  onPrototypeLive?: (event: PrototypeLiveEvent) => void;
  onArtifact?: (artifact: AgentDomainArtifact) => void;
  onAskUser?: (askUser: AgentAskUserPrompt) => void;
  onStepHandoff?: (stepHandoff: StepHandoffProposal) => void;
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
      model?: string;
      statusCode?: number;
      message: string;
      remediation: string;
    };
    session?: AgentSession;
    prototypes?: InteractivePrototype[];
    artifactHistory?: ArtifactHistoryEntryView[];
    requirementDocs?: RequirementDoc[];
  }) => void;
  onMessageEnd?: (payload: {
    session: AgentSession;
    project?: ProjectDetail;
    requirementDocs?: RequirementDoc[];
    requirementSessions?: RequirementSession[];
    prototypes?: InteractivePrototype[];
    confirmedPrototypeRevision?: ConfirmedPrototypeRevision | null;
    stepConfirmations?: ProjectStepConfirmations;
    artifactHistory?: ArtifactHistoryEntryView[];
    fourLayerAssets?: FourLayerAsset[];
    assembledApplications?: AssembledApplication[];
    extractionJobs?: ExtractionJob[];
    metrics?: MetricDefinition[];
    analyticsReports?: AnalyticsReport[];
    reasoningSessions?: ReasoningSession[];
    cancelled?: boolean;
  }) => void;
}

function consumeAgentSessionSseBody(
  body: ReadableStream<Uint8Array>,
  callbacks: StreamAgentSessionCallbacks,
  activity: () => void,
): Promise<void> {
  return (async () => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processBlock = (rawBlock: string) => {
      const lines = rawBlock.split(/\r?\n/);
      let eventId = '';
      let eventName = '';
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('id:')) {
          eventId = line.slice(3).trim();
        } else if (line.startsWith('event:')) {
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
        case 'heartbeat':
          callbacks.onHeartbeat?.(parsed as never);
          break;
        case 'thinking_delta':
          callbacks.onThinkingDelta?.(String(parsed.delta ?? ''), Number(parsed.step ?? 1));
          break;
        case 'delta':
          callbacks.onTextDelta?.(String(parsed.text ?? ''), Number(parsed.step ?? 1));
          break;
        case 'tool_delta':
          callbacks.onToolDelta?.(parsed as never);
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
        case 'subagent_update':
          callbacks.onSubagentUpdate?.(parsed as never);
          break;
        case 'prototype_frame':
        case 'prototype_screen':
        case 'prototype_style':
        case 'prototype_build_start':
        case 'prototype_plan':
        case 'prototype_build_screen':
        case 'prototype_phase':
        case 'prototype_build_log':
          callbacks.onPrototypeLive?.(parsed as unknown as PrototypeLiveEvent);
          break;
        case 'artifact':
          callbacks.onArtifact?.(parsed.artifact as AgentDomainArtifact);
          break;
        case 'ask_user':
          callbacks.onAskUser?.(parsed.askUser as AgentAskUserPrompt);
          break;
        case 'step_handoff':
          callbacks.onStepHandoff?.(parsed.stepHandoff as StepHandoffProposal);
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
      if (eventId) callbacks.onEventId?.(eventId);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      activity();
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
    submissionId?: string;
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
    codeMode?: boolean;
    multiAgentConcurrency?: number;
    mockMode?: boolean;
    locale?: string;
  },
  callbacks: StreamAgentSessionCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const locale = body.locale || getCurrentClientLocale();
  return withStreamWatchdog(signal, async (signal, activity) => {
  const res = await fetch(`/api/agent-sessions/${sessionId}/stream`, {
      method: 'POST',
      headers: buildJsonHeaders(),
      body: JSON.stringify({ ...body, locale }),
      ...(signal ? { signal } : {}),
    });
  if (res.status >= 500 || res.status === 408 || res.status === 429) throw new Error(`HTTP ${res.status}`);

  if (!res.ok || !res.body) {
    const errJson = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (res.status === 409 && errJson.state === 'queued' && body.submissionId) return;
    callbacks.onRunError?.({
      diagnostic: errJson.diagnostic ?? {
        code: 'HTTP_ERROR',
        statusCode: res.status,
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

  await consumeAgentSessionSseBody(res.body, callbacks, activity);
  });
}

export async function attachAgentSessionLiveStream(
  sessionId: string,
  callbacks: StreamAgentSessionCallbacks,
  options?: { afterEventId?: string; submissionId?: string; signal?: AbortSignal },
): Promise<'absent' | void> {
  return withStreamWatchdog(options?.signal, async (signal, activity) => {
  const qs = new URLSearchParams();
  if (options?.afterEventId) qs.set('afterEventId', options.afterEventId);
  if (options?.submissionId) qs.set('submissionId', options.submissionId);
  const res = await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}/live${qs.size ? `?${qs}` : ''}`, {
    method: 'GET',
    headers: buildLocaleHeaders(),
    signal,
  });
  if (res.status === 404 && options?.submissionId) {
    const payload = await res.json();
    if (payload.state === 'absent') return 'absent';
  }
  if (res.status === 404 || res.status === 403 || res.status === 401) {
    callbacks.onRunError?.({ diagnostic: { code: 'SESSION_UNAVAILABLE', statusCode: res.status,
      message: getCurrentClientLocale() === 'en-US' ? 'This conversation is unavailable.' : '此会话已不可用。',
      remediation: getCurrentClientLocale() === 'en-US' ? 'Check access to this project.' : '请检查项目的访问权限。',
    } });
    return;
  }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  await consumeAgentSessionSseBody(res.body, callbacks, activity);
  });
}

/**
 * Folds one live prototype delta into a run's draft. The draft's active anchor follows the
 * screen being written and is released when that screen lands.
 */
export function applyPrototypeLiveEventToDraft(
  cur: SessionLiveDraft,
  event: PrototypeLiveEvent,
): SessionLiveDraft {
  const next: SessionLiveDraft = {
    ...cur,
    reconnecting: false,
    lastHeartbeatAt: Date.now(),
    prototypeLive: applyPrototypeLiveEvent(cur.prototypeLive ?? emptyPrototypeLiveState(), event),
  };
  if (event.kind !== 'screen') return next;
  if (event.status === 'streaming') {
    next.activeAnchor = { screenId: event.screenId, label: event.screenName };
  } else if (cur.activeAnchor?.screenId === event.screenId) {
    delete next.activeAnchor;
  }
  return next;
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
    stepConfirmations?: ProjectStepConfirmations;
    artifactHistory?: ArtifactHistoryEntryView[];
    fourLayerAssets?: FourLayerAsset[];
    assembledApplications?: AssembledApplication[];
    extractionJobs?: ExtractionJob[];
    metrics?: MetricDefinition[];
    analyticsReports?: AnalyticsReport[];
    reasoningSessions?: ReasoningSession[];
  }) => {
    const cur = get().data;
    if (!cur || !payload.session) return;
    const updatedSession = payload.session;
    if (cur.activeProject.id !== updatedSession.projectId) return;
    const exists = (cur.agentSessions ?? []).some((s) => s.id === updatedSession.id);
    const nextSessions = exists
      ? (cur.agentSessions ?? []).map((s) => (s.id === updatedSession.id ? updatedSession : s))
      : [updatedSession, ...(cur.agentSessions ?? [])];
    const isSameProject =
      cur.activeProject.id === (payload.project?.id ?? updatedSession.projectId);
    const nextData: BootstrapPayload = {
      ...cur,
      agentSessions: nextSessions,
      ...(isSameProject && payload.project
        ? {
            activeProject: payload.project,
            projects: cur.projects.map((p) =>
              p.id === payload.project!.id
                ? {
                    ...p,
                    currentStage: payload.project!.currentStage,
                    updatedAt: payload.project!.updatedAt,
                  }
                : p,
            ),
          }
        : {}),
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
      ...(isSameProject && payload.stepConfirmations !== undefined
        ? { stepConfirmations: payload.stepConfirmations }
        : {}),
      ...(isSameProject && payload.artifactHistory !== undefined
        ? { artifactHistory: payload.artifactHistory }
        : {}),
      ...(payload.fourLayerAssets ? { fourLayerAssets: payload.fourLayerAssets } : {}),
      ...(isSameProject && payload.assembledApplications
        ? { assembledApplications: payload.assembledApplications }
        : {}),
      ...(payload.extractionJobs ? { extractionJobs: payload.extractionJobs } : {}),
      ...(payload.metrics ? { metrics: payload.metrics } : {}),
      ...(payload.analyticsReports ? { analyticsReports: payload.analyticsReports } : {}),
      ...(isSameProject && payload.reasoningSessions
        ? { reasoningSessions: payload.reasoningSessions }
        : {}),
    };

    if (isSameProject && nextData.activeProject.id) {
      const derivedSteps = getProjectStepsFromBootstrap(nextData);
      const stepStates = Object.fromEntries(
        derivedSteps.map((st) => [st.id, st.state]),
      ) as Record<ProjectStepId, ProjectStepStateId>;
      const currentStep = resolveCurrentProjectStep(stepStates);
      const currentStepState = stepStates[currentStep];
      nextData.projects = nextData.projects.map((p) =>
        p.id === nextData.activeProject.id
          ? {
              ...p,
              currentStep,
              currentStepState,
              stepStates,
              updatedAt: updatedSession.updatedAt || p.updatedAt,
            }
          : p,
      );
    }

    set({ data: nextData });
  };

  return {
    onSessionMeta: (meta) => {
      patchDraft((cur) => ({
        ...cur,
        ...(meta.runId ? { serverRunId: meta.runId } : {}),
        reconnecting: false,
        lastHeartbeatAt: Date.now(),
        model: meta.model,
        providerName: meta.provider,
        ...(meta.visionSupported === false && cur.images && cur.images.length > 0
          ? {
              visionFallbackUsed: true,
              ...(meta.visionFallbackNotice
                ? { visionFallbackNotice: meta.visionFallbackNotice }
                : {}),
            }
          : {}),
      }));
    },
    onHeartbeat: (hb) => {
      patchDraft((cur) => ({
        ...cur,
        ...(hb.runId ? { serverRunId: hb.runId } : {}),
        reconnecting: false,
        lastHeartbeatAt: Date.now(),
        liveStreamedChars: hb.thinkingChars + hb.textChars + hb.toolArgChars,
      }));
    },
    onThinkingDelta: (delta) => {
      patchDraft((cur) => {
        const nextThinking = `${cur.thinking}${delta}`;
        return {
          ...cur,
          reconnecting: false,
          lastHeartbeatAt: Date.now(),
          thinking: nextThinking,
          liveStreamedChars: Math.max(cur.liveStreamedChars ?? 0, nextThinking.length + cur.text.length),
          liveStatus: cur.steps.some((s) => s.status === 'RUNNING')
            ? cur.liveStatus
            : { zh: '正在思考…', en: 'Thinking…' },
        };
      });
    },
    onTextDelta: (delta) => {
      patchDraft((cur) => {
        const nextText = `${cur.text}${delta}`;
        return {
          ...cur,
          reconnecting: false,
          lastHeartbeatAt: Date.now(),
          text: nextText,
          liveStreamedChars: Math.max(cur.liveStreamedChars ?? 0, cur.thinking.length + nextText.length),
          liveStatus: { zh: '正在回复…', en: 'Responding…' },
        };
      });
    },
    onToolDelta: (td) => {
      patchDraft((cur) => ({
        ...cur,
        reconnecting: false,
        lastHeartbeatAt: Date.now(),
        liveStreamedChars: cur.thinking.length + cur.text.length + td.streamedChars,
        liveStatus: td.toolName
          ? formatVocabularyToolProgress(td.toolName, undefined)
          : { zh: '正在持续生成内容…', en: 'Streaming generated content…' },
      }));
    },
    onSubagentUpdate: (sub) => {
      patchDraft((cur) => {
        const runningLanes = sub.lanes.filter((l) => l.status === 'RUNNING');
        const doneCount = sub.lanes.filter((l) => l.status === 'DONE').length;
        return {
          ...cur,
          reconnecting: false,
          lastHeartbeatAt: Date.now(),
          subagentLanes: sub.lanes,
          ...(sub.lane.targetAnchor ? { activeAnchor: sub.lane.targetAnchor } : {}),
          liveStatus:
            runningLanes.length > 0
              ? {
                  zh: `正在并行推进 ${runningLanes.length} 路子任务（已完成 ${doneCount}/${sub.lanes.length}）…`,
                  en: `Running ${runningLanes.length} parallel tasks (${doneCount}/${sub.lanes.length} done)…`,
                }
              : cur.liveStatus,
        };
      });
    },
    onPrototypeLive: (event) => {
      patchDraft((cur) => applyPrototypeLiveEventToDraft(cur, event));
    },
    onToolCall: (call) => {
      const progressLabel = formatVocabularyToolProgress(
        call.toolName,
        call.arguments,
        call.targetAnchor?.label ? { targetLabel: call.targetAnchor.label } : undefined,
      );
      patchDraft((cur) => {
        const existingIdx = cur.steps.findIndex((s) => s.id === call.id);
        const nextStep: SessionLiveStep = {
          id: call.id,
          label: { zh: progressLabel.zh, en: progressLabel.en },
          status: 'RUNNING',
          toolName: call.toolName,
          arguments: call.arguments,
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
          liveStatus: { zh: progressLabel.zh, en: progressLabel.en },
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
          label: formatToolStepLabel(trace.toolName, trace.arguments, trace.targetAnchor),
          status: stepStatus,
          toolName: trace.toolName,
          ...(trace.arguments ? { arguments: trace.arguments } : {}),
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
    onUsage: (usage) => {
      patchDraft((cur) => ({
        ...cur,
        ...(usage.tokenUsage ? { usage: usage.tokenUsage } : {}),
        ...(usage.providerName ? { providerName: usage.providerName } : {}),
        ...(usage.modelUsed ? { model: usage.modelUsed } : {}),
      }));
    },
    onAskUser: (askUser) => {
      patchDraft((cur) => ({
        ...cur,
        askUser,
        liveStatus: { zh: '等待确认关键业务决策…', en: 'Waiting for user decision…' },
      }));
    },
    onStepHandoff: (stepHandoff) => {
      patchDraft((cur) => ({
        ...cur,
        stepHandoff,
        liveStatus: { zh: '已准备步骤转交建议…', en: 'Prepared step hand-off…' },
      }));
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
      if (payload.session) {
        upsertCompletedSession(payload);
        return;
      }
      const cur = get().data;
      const draft = get().liveSessionDrafts[sessionId];
      const existing = cur?.agentSessions.find((s) => s.id === sessionId);
      if (!cur || !existing || !payload.diagnostic) return;
      const nowIso = new Date().toISOString();
      const startedIso = draft ? new Date(draft.startedAt).toISOString() : nowIso;
      const promptText = draft?.userPrompt ?? '';
      const lastMsg = existing.messages[existing.messages.length - 1];
      const needsUserMsg =
        Boolean(promptText.trim()) &&
        !(lastMsg?.role === 'user' && lastMsg.content === promptText);
      const nextMessages = [
        ...existing.messages,
        ...(needsUserMsg
          ? [
              {
                id: `${draft?.runId ?? 'err'}-u`,
                role: 'user' as const,
                content: promptText,
                timestamp: startedIso,
              },
            ]
          : []),
        {
          id: `${draft?.runId ?? 'err'}-a`,
          role: 'assistant' as const,
          content: draft?.text ?? '',
          ...(draft?.thinking ? { thinking: draft.thinking } : {}),
          errorDiagnostic: payload.diagnostic,
          timestamp: nowIso,
        },
      ];
      upsertCompletedSession({
        session: {
          ...existing,
          status: 'ERROR',
          messages: nextMessages,
          updatedAt: nowIso,
        },
      });
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
): Promise<{
  project: ProjectDetail;
  changedCount: number;
  changelogEntry: string;
  artifactHistory?: ArtifactHistoryEntryView[];
}> {
  const res = await fetch(`/api/projects/${projectId}/rename`, {
    method: 'POST',
    headers: buildJsonHeaders(),
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
  artifactHistory?: ArtifactHistoryEntryView[];
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
  artifactHistory?: ArtifactHistoryEntryView[];
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
  artifactHistory?: ArtifactHistoryEntryView[];
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
  artifactHistory?: ArtifactHistoryEntryView[];
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
  artifactHistory?: ArtifactHistoryEntryView[];
  stepConfirmations?: ProjectStepConfirmations;
}> {
  const res = await apiPostJson<{
    confirmed: ConfirmedPrototypeRevision;
    confirmedRevision: ConfirmedPrototypeRevision;
    prototype: InteractivePrototype;
    project: ProjectDetail;
    prototypes: InteractivePrototype[];
    artifactHistory?: ArtifactHistoryEntryView[];
    stepConfirmations?: ProjectStepConfirmations;
  }>(`/api/projects/${encodeURIComponent(projectId)}/prototypes/confirm-revision`, {
    revisionId,
  });
  const cur = useWorkbenchStore.getState().data;
  if (cur && cur.activeProject.id === projectId) {
    useWorkbenchStore.getState().patchData({
      activeProject: res.project,
      prototypes: res.prototypes,
      confirmedPrototypeRevision: res.confirmedRevision,
      ...(res.artifactHistory ? { artifactHistory: res.artifactHistory } : {}),
      ...(res.stepConfirmations ? { stepConfirmations: res.stepConfirmations } : {}),
    });
  }
  return res;
}

export async function apiClonePrototype(
  prototypeId: string,
  input?: { name?: string },
): Promise<{
  prototype: InteractivePrototype;
  prototypes: InteractivePrototype[];
  confirmedRevision: ConfirmedPrototypeRevision | null;
  agentSessions?: AgentSession[];
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
  artifactHistory?: ArtifactHistoryEntryView[];
  agentSessions?: AgentSession[];
}> {
  return apiDeleteResource(
    `/api/prototypes/${encodeURIComponent(prototypeId)}?projectId=${encodeURIComponent(projectId)}`,
  );
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

export type {
  ArtifactHistoryEntryView,
  ArtifactHistorySurfaceKind,
  ArtifactJumpTarget,
  BusinessModelInlineEditTarget,
  BusinessModelIntentSummary,
  ChangeSummaryItemView,
  ChangeSummaryView,
  PersistedArtifactHistoryKind,
  PrototypeCompareRevisionPair,
} from '../packages/workspace-store/index.js';

export interface ArtifactHistoryMutationResponse {
  entry: ArtifactHistoryEntryView;
  undoneEntryId?: string;
  restoredBeforeEntryId?: string;
  entries: ArtifactHistoryEntryView[];
  artifactHistory: ArtifactHistoryEntryView[];
  project: ProjectDetail;
  requirementDocs: RequirementDoc[];
  prototypes?: InteractivePrototype[];
  confirmedPrototypeRevision?: ConfirmedPrototypeRevision | null;
  agentSessions?: AgentSession[];
  stepConfirmations: ProjectStepConfirmations;
}

export async function apiListArtifactHistory(
  projectId: string,
  kind?: ArtifactHistorySurfaceKind,
  prototypeId?: string,
): Promise<{
  projectId: string;
  kind: ArtifactHistorySurfaceKind | null;
  entries: ArtifactHistoryEntryView[];
  latestEntryId: string | null;
}> {
  const params = new URLSearchParams();
  if (kind) params.set('kind', kind);
  if (prototypeId) params.set('prototypeId', prototypeId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/history${qs}`, {
    headers: buildLocaleHeaders(),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || 'Failed to load artifact history');
  }
  return body;
}

export async function apiUndoArtifactChange(
  projectId: string,
  artifactKind: ArtifactHistorySurfaceKind,
  expectedEntryId?: string,
  prototypeId?: string,
): Promise<ArtifactHistoryMutationResponse> {
  return apiPostJson<ArtifactHistoryMutationResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/history/${encodeURIComponent(artifactKind)}/undo`,
    {
      ...(expectedEntryId ? { expectedEntryId } : {}),
      ...(prototypeId ? { prototypeId } : {}),
    },
  );
}

export async function apiRestoreArtifactBeforeChange(
  projectId: string,
  artifactKind: ArtifactHistorySurfaceKind,
  entryId: string,
): Promise<ArtifactHistoryMutationResponse> {
  return apiPostJson<ArtifactHistoryMutationResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/history/${encodeURIComponent(artifactKind)}/${encodeURIComponent(entryId)}/restore`,
    {},
  );
}

export interface PatchBusinessModelInput {
  edit?: import('../packages/workspace-store/index.js').BusinessModelInlineEditTarget;
  suite?: OntologySuite;
  note?: string;
  intentSummary?: import('../packages/workspace-store/index.js').BusinessModelIntentSummary;
}

export interface BusinessModelEditRejection {
  code: 'SUITE_VALIDATION_REJECTED';
  reasonZh: string;
  reasonEn: string;
  assistantPromptZh: string;
  assistantPromptEn: string;
  newErrorCount: number;
}

export type BusinessModelEditResult =
  | {
      ok: true;
      project: ProjectDetail;
      projects?: ProjectSummary[];
      artifactHistory?: ArtifactHistoryEntryView[];
    }
  | {
      ok: false;
      rejection: BusinessModelEditRejection;
    };

export async function apiPatchBusinessModel(
  projectId: string,
  payload: PatchBusinessModelInput,
): Promise<BusinessModelEditResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/business-model`, {
    method: 'PATCH',
    headers: buildJsonHeaders(),
    body: JSON.stringify(payload),
  });
  if (res.status === 422 || res.status === 409) {
    const rejection = (await res.json()) as BusinessModelEditRejection;
    return { ok: false, rejection };
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Business model update failed (${res.status})`);
  }
  const data = (await res.json()) as {
    project: ProjectDetail;
    projects?: ProjectSummary[];
    artifactHistory?: ArtifactHistoryEntryView[];
  };
  return {
    ok: true,
    project: data.project,
    ...(data.projects ? { projects: data.projects } : {}),
    ...(data.artifactHistory ? { artifactHistory: data.artifactHistory } : {}),
  };
}

export async function apiCompileDevPackage(
  appId: string,
): Promise<{
  compiledPackage: CompiledDevelopmentPackage;
  application: AssembledApplication;
  assembledApplications: AssembledApplication[];
  packageSnapshots?: DevelopmentPackageSnapshot[];
}> {
  return apiPostJson(`/api/applications/${encodeURIComponent(appId)}/compile-package`, {});
}

export async function apiCompileProjectDevPackage(
  projectId: string,
): Promise<{
  compiledPackage: CompiledDevelopmentPackage;
  application: AssembledApplication;
  assembledApplications: AssembledApplication[];
  packageSnapshots?: DevelopmentPackageSnapshot[];
}> {
  return apiPostJson(`/api/projects/${encodeURIComponent(projectId)}/compile-package`, {});
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

// ─── Context Snapshots Client Helpers (ADR 0017, #82) ────────────────────────

export type {
  ContextEventDetail,
  ContextEventSummary,
  ContextItem,
  ContextItemKind,
  ModelCallDetail,
  ModelCallEstimate,
  ModelCallPurpose,
  ModelCallStatus,
  ModelCallSummary,
  ModelCallUsage,
  ModelCallUsageSource,
  ToolDefinitionSource,
} from '../packages/workspace-store/index.js';

export async function apiListSessionModelCalls(
  projectId: string,
  sessionId: string,
): Promise<{
  modelCalls: ModelCallSummary[];
  contextEvents: ContextEventSummary[];
}> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/agent-sessions/${encodeURIComponent(sessionId)}/model-calls`,
    { headers: buildLocaleHeaders() },
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || 'Failed to load session model calls');
  }
  return body as {
    modelCalls: ModelCallSummary[];
    contextEvents: ContextEventSummary[];
  };
}

export async function apiGetModelCall(
  projectId: string,
  callId: string,
): Promise<{ modelCall: ModelCallDetail }> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/model-calls/${encodeURIComponent(callId)}`,
    { headers: buildLocaleHeaders() },
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || 'Failed to load model call detail');
  }
  return body as { modelCall: ModelCallDetail };
}

export async function apiGetContextEvent(
  projectId: string,
  eventId: string,
): Promise<{ contextEvent: ContextEventDetail }> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/context-events/${encodeURIComponent(eventId)}`,
    { headers: buildLocaleHeaders() },
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || 'Failed to load context event detail');
  }
  return body as { contextEvent: ContextEventDetail };
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
