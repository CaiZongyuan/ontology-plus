import {
  BUSINESS_VOCABULARY,
  checkBusinessViewMarkup,
  formatToolProgress as formatVocabularyToolProgress,
  formatToolProgressLine,
  formatToolStepLabel as formatVocabularyToolStepLabel,
  getModelBusinessName,
  resolveToolProgressSpec,
} from '../../../packages/business-vocabulary/index.js';
import {
  MODEL_CODES,
  type ModelCode,
  type OntologySuite,
} from '../../../packages/ontology-core/index.js';
import type {
  AgentAskUserPrompt,
  AgentDomainArtifact,
  AgentImageAttachmentRef,
  AgentSession,
  AgentSessionMessage,
  AgentToolCallTrace,
  PrototypeTargetAnchor,
  StepHandoffOrigin,
  StepHandoffProposal,
} from '../../../packages/workspace-store/index.js';
import {
  formatAnchorBadgeLabel,
  formatToolStepLabel,
  type QueuedSessionPromptItem,
  type SessionLiveDraft,
} from '../../api.js';

export {
  formatAnchorBadgeLabel,
  formatToolProgressLine,
  formatToolStepLabel,
  type PrototypeTargetAnchor,
  type QueuedSessionPromptItem,
  type SessionLiveDraft,
};

/**
 * The one shape every piece of agent work takes in the Agent Panel (ADR 0009).
 * Every Agent Session turn adapts into this view model; `AgentRunCard` renders nothing else.
 */
export type AgentRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export type AgentRunStepStatus = 'RUNNING' | 'DONE' | 'FAILED' | 'STOPPED';

export interface LocalizedText {
  zh: string;
  en: string;
}

export interface AgentRunStep {
  id: string;
  label: LocalizedText;
  status: AgentRunStepStatus;
  /** Expandable detail: tool arguments, tool output, or a tail of streamed text. */
  detail?: string;
  /** ISO timestamp of when the step started. */
  at?: string;
  /** Semantic screen/element anchor targeted by a prototype tool call. */
  targetAnchor?: PrototypeTargetAnchor;
  /** Underlying tool name when adapted from a session tool call. */
  toolName?: string;
}

export interface AgentRunFailure {
  message: string;
  remediation?: string;
  code?: string;
  providerName?: string;
  baseUrl?: string;
  model?: string;
  statusCode?: number;
}

export interface AgentRunUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentRunVisionFallback {
  used: boolean;
  notice?: string;
  providerName?: string;
}

export type PlatformProblemKind =
  | 'UNCONFIGURED'
  | 'UNREACHABLE'
  | 'TIMEOUT'
  | 'VISION_UNSUPPORTED'
  | 'GATEWAY';

export const PLATFORM_UNAVAILABLE_COPY: LocalizedText = {
  zh: 'AI 服务暂不可用，请联系为你部署的人',
  en: 'The AI service is temporarily unavailable. Please contact the person who set this up for you.',
};

export interface AgentRunView {
  id: string;
  title: LocalizedText;
  status: AgentRunStatus;
  /** One line describing what the agent is doing right now. */
  liveStatus: LocalizedText;
  startedAt: number;
  completedAt?: number;
  model?: string;
  providerName?: string;
  usage?: AgentRunUsage;
  visionFallback?: AgentRunVisionFallback;
  steps: AgentRunStep[];
  thinking?: string;
  /**
   * What the user actually sent, shown as their side of the conversation.
   * Absent for structured action prompts, where `title` already says it all.
   */
  userPrompt?: string;
  /** Assistant Markdown, available during streaming and after completion. */
  text?: string;
  /** Source session metadata when adapted from an `AgentSession` turn. */
  sourceSessionId?: string;
  sourceUserMessageId?: string;
  sourceAssistantMessageId?: string;
  retryPrompt?: string;
  /** User-attached or visual-reference images submitted on this run (IndexedDB local or remote). */
  images?: AgentImageAttachmentRef[];
  /** Structured Scoped HITL question emitted by `ask_user` during this run. */
  askUser?: AgentAskUserPrompt;
  /** Structured cross-step hand-off proposal emitted by `propose_step_handoff` during this run. */
  stepHandoff?: StepHandoffProposal;
  /** Provenance when this turn's user message was delivered via an accepted Step Hand-off. */
  handoffFrom?: StepHandoffOrigin;
  /** Semantic anchors modified during this run (for canvas highlighting). */
  modifiedAnchors?: PrototypeTargetAnchor[];
  /** Immutable prototype revision created at the end of this run, when HTML changed. */
  prototypeRevision?: {
    prototypeId: string;
    revisionId: string;
    revisionNumber: number;
  };
  /** Primary structured domain artifact produced by this run (SRS, Ontology Suite, Tech Arch, Insight, Report, etc.). */
  artifact?: AgentDomainArtifact;
  /** Present once the run has succeeded. */
  result?: {
    summary: LocalizedText;
    /** Label of the link to the artifact the run produced, when there is one. */
    artifactLabel?: LocalizedText;
  };
  /** Present once the run has failed. Always the real cause, never a substitute result. */
  failure?: AgentRunFailure;
}

export function formatRunElapsed(startedAt: number, endedAt: number): string {
  const totalSec = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  const hh = Math.floor(totalSec / 3600);
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatStepClock(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 8);
}

export function summarizeUserPromptTitle(rawPrompt: string, explicitTitle?: string): LocalizedText {
  if (explicitTitle?.trim()) {
    const clean = explicitTitle.trim();
    return { zh: clean, en: clean };
  }
  const trimmed = rawPrompt.trim();
  if (!trimmed) {
    return { zh: '对话请求', en: 'Assistant request' };
  }

  const actionMatch = /^\[ACTION:([A-Z_]+)(?:\s+(\{[^\r\n]*\}))?\]/.exec(trimmed);
  if (actionMatch) {
    const actionKind = actionMatch[1]!;
    let params: Record<string, unknown> = {};
    if (actionMatch[2]) {
      try {
        params = JSON.parse(actionMatch[2]) as Record<string, unknown>;
      } catch {
        params = {};
      }
    }
    switch (actionKind) {
      case 'SYNTHESIZE_SRS':
        return { zh: '合成 9 章节需求规格书', en: 'Synthesize 9-Chapter SRS' };
      case 'SYNTHESIZE_ONTOLOGY_SUITE':
        return {
          zh: `生成${BUSINESS_VOCABULARY.ONTOLOGY_SUITE.zh}`,
          en: `Generate ${BUSINESS_VOCABULARY.ONTOLOGY_SUITE.en}`,
        };
      case 'GENERATE_TECH_ARCH': {
        const name = typeof params.name === 'string' && params.name.trim() ? params.name.trim() : '';
        return name
          ? { zh: `生成技术架构：${name}`, en: `Generate Tech Arch: ${name}` }
          : { zh: '生成四层技术架构规范', en: 'Generate Tech Architecture Spec' };
      }
      case 'METRIC_INSIGHT': {
        const rawLabel =
          (typeof params.metricName === 'string' && params.metricName.trim()) ||
          (typeof params.metricCode === 'string' && params.metricCode.trim()) ||
          '';
        const label =
          rawLabel && checkBusinessViewMarkup(rawLabel, { plainText: true }).length === 0
            ? rawLabel
            : '';
        return label
          ? { zh: `AI 指标洞察：${label}`, en: `AI Metric Insight: ${label}` }
          : { zh: 'AI 指标异动洞察', en: 'AI Metric Insight' };
      }
      case 'SCENARIO_ATTRIBUTION': {
        const name =
          typeof params.scenarioName === 'string' && params.scenarioName.trim()
            ? params.scenarioName.trim()
            : '';
        return name
          ? { zh: `AI 场景归因：${name}`, en: `AI Scenario Attribution: ${name}` }
          : { zh: 'AI 场景归因分析', en: 'AI Scenario Attribution' };
      }
      case 'RUN_ONTOLOGY_EXTRACTION': {
        const jobTitle =
          typeof params.title === 'string' && params.title.trim() ? params.title.trim() : '';
        return jobTitle
          ? { zh: `本体萃取：${jobTitle}`, en: `Ontology Extraction: ${jobTitle}` }
          : { zh: '执行存量系统本体萃取', en: 'Run Ontology Extraction' };
      }
    }
  }

  const globalMatch =
    /\[(?:全局补充精修要求|Additional Global Refinement Instruction)\]\s*\n+([^\n]+)/.exec(
      trimmed,
    );
  if (globalMatch?.[1]?.trim()) {
    const line = globalMatch[1].trim();
    const short = line.length > 68 ? `${line.slice(0, 67)}…` : line;
    return { zh: short, en: short };
  }

  const noteMatch = /(?:修改要求|Instruction):\s*([^\n]+)/.exec(trimmed);
  if (noteMatch?.[1]?.trim()) {
    const line = noteMatch[1].trim();
    const short = line.length > 68 ? `${line.slice(0, 67)}…` : line;
    return { zh: short, en: short };
  }

  const firstLine = trimmed.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? trimmed;
  const short = firstLine.length > 68 ? `${firstLine.slice(0, 67)}…` : firstLine;
  return { zh: short, en: short };
}

const STRUCTURED_PROMPT_PATTERN =
  /^\[ACTION:[A-Z_]+|\[(?:全局补充精修要求|Additional Global Refinement Instruction)\]|(?:^|\n)(?:修改要求|Instruction):\s/;

/**
 * The user's own words for a turn, or `undefined` when the prompt is a compiled
 * instruction (canvas action, selection refinement) that reads as noise in a conversation.
 */
export function resolveUserPromptDisplay(
  rawPrompt: string | undefined,
  explicitTitle?: string,
): string | undefined {
  const trimmed = rawPrompt?.trim();
  if (!trimmed || explicitTitle?.trim()) return undefined;
  if (STRUCTURED_PROMPT_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

/** Compact "how long ago" label for session lists. */
export function formatRelativeTime(iso: string | undefined, now: number = Date.now()): LocalizedText {
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(at)) return { zh: '', en: '' };
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 60) return { zh: '刚刚', en: 'just now' };
  const min = Math.floor(sec / 60);
  if (min < 60) return { zh: `${min} 分钟前`, en: `${min}m ago` };
  const hr = Math.floor(min / 60);
  if (hr < 24) return { zh: `${hr} 小时前`, en: `${hr}h ago` };
  const day = Math.floor(hr / 24);
  if (day < 30) return { zh: `${day} 天前`, en: `${day}d ago` };
  const d = new Date(at);
  const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { zh: label, en: label };
}

function parseIsoMs(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? fallback : parsed;
}

interface SuiteElementLabelEntry {
  alias?: string;
  name?: string;
}

function collectSuiteElementsForModel(
  suite: OntologySuite,
  modelCode: ModelCode,
): Array<Record<string, unknown>> {
  switch (modelCode) {
    case 'M1':
      return [
        ...(suite.M1?.aggregates ?? []),
        ...(suite.M1?.data_dictionaries ?? []),
        ...(suite.M1?.aggregate_associations ?? []),
      ] as unknown as Array<Record<string, unknown>>;
    case 'M2':
      return (suite.M2?.behaviors ?? []) as unknown as Array<Record<string, unknown>>;
    case 'M3':
      return (suite.M3?.rules ?? []) as unknown as Array<Record<string, unknown>>;
    case 'ME':
      return (suite.ME?.events ?? []) as unknown as Array<Record<string, unknown>>;
    case 'M4':
      return (suite.M4?.event_scenarios ?? []) as unknown as Array<Record<string, unknown>>;
    case 'M5':
      return [
        ...(suite.M5?.roles ?? []),
        ...(suite.M5?.actors ?? []),
        ...(suite.M5?.permissionGroups ?? []),
        ...(suite.M5?.permissions ?? []),
      ] as unknown as Array<Record<string, unknown>>;
    case 'M6':
      return (suite.M6?.flows ?? []) as unknown as Array<Record<string, unknown>>;
    case 'M7':
      return (suite.M7?.query_reports ?? []) as unknown as Array<Record<string, unknown>>;
    case 'MU':
      return [
        ...(suite.MU?.screens ?? []),
        ...(suite.MU?.navigation_edges ?? []),
        ...(suite.MU?.cross_cutting_ui ?? []),
      ] as unknown as Array<Record<string, unknown>>;
    case 'MM':
      return (suite.MM?.mappings ?? []) as unknown as Array<Record<string, unknown>>;
    case 'MI':
      return (suite.MI?.interfaces ?? []) as unknown as Array<Record<string, unknown>>;
  }
}

function lookupSuiteElementById(
  suite: OntologySuite,
  targetId: string,
  preferredModel?: ModelCode,
): SuiteElementLabelEntry | undefined {
  const orderedModels = preferredModel
    ? [preferredModel, ...MODEL_CODES.filter((m) => m !== preferredModel)]
    : MODEL_CODES;

  for (const code of orderedModels) {
    for (const item of collectSuiteElementsForModel(suite, code)) {
      const itemId =
        (typeof item.id === 'string' && item.id) ||
        (typeof item.screenId === 'string' && item.screenId) ||
        (typeof item.interfaceId === 'string' && item.interfaceId) ||
        '';
      if (itemId !== targetId) continue;
      const alias =
        (typeof item.alias === 'string' && item.alias.trim()) ||
        (typeof item.label === 'string' && item.label.trim()) ||
        undefined;
      const name = (typeof item.name === 'string' && item.name.trim()) || undefined;
      if (alias || name) {
        return {
          ...(alias ? { alias } : {}),
          ...(name ? { name } : {}),
        };
      }
    }
  }
  return undefined;
}

/**
 * Resolves human-friendly `alias` / `name` from the active project's Ontology Suite when
 * a tool call only carries raw element IDs (such as `AGG-01` or `BHV-02`).
 */
export function enrichToolArgsFromSuite(
  toolName: string,
  args: Record<string, unknown> | undefined,
  suite: OntologySuite | undefined,
): Record<string, unknown> | undefined {
  if (!args || !suite) return args;
  if (typeof args.alias === 'string' && args.alias.trim() && typeof args.name === 'string' && args.name.trim()) {
    return args;
  }

  const candidateId =
    (typeof args.id === 'string' && args.id.trim()) ||
    (typeof args.elementId === 'string' && args.elementId.trim()) ||
    (typeof args.screenId === 'string' && args.screenId.trim()) ||
    (typeof args.interfaceId === 'string' && args.interfaceId.trim()) ||
    '';
  if (!candidateId) return args;

  const spec = resolveToolProgressSpec(toolName);
  const preferredModel =
    spec.modelCode ??
    (typeof args.modelCode === 'string' && MODEL_CODES.includes(args.modelCode as ModelCode)
      ? (args.modelCode as ModelCode)
      : undefined);

  const found = lookupSuiteElementById(suite, candidateId, preferredModel);
  if (!found) return args;

  return {
    ...args,
    ...(!args.alias && found.alias ? { alias: found.alias } : {}),
    ...(!args.name && found.name ? { name: found.name } : {}),
  };
}

/**
 * Deterministically formats a single tool call into bilingual Business View progress copy
 * (`正在更新业务操作「提交审批」` while active, `更新业务操作「提交审批」` once done).
 * Never uses LLM free-text narration.
 */
export function formatRunToolProgress(
  toolName: string,
  args?: Record<string, unknown>,
  opts?: {
    active?: boolean;
    targetAnchor?: PrototypeTargetAnchor;
    suite?: OntologySuite;
  },
): LocalizedText {
  const enrichedArgs = enrichToolArgsFromSuite(toolName, args, opts?.suite);
  const formatOptions = opts?.targetAnchor?.label
    ? { targetLabel: opts.targetAnchor.label }
    : undefined;
  const pair = opts?.active
    ? formatVocabularyToolProgress(toolName, enrichedArgs, formatOptions)
    : formatVocabularyToolStepLabel(toolName, enrichedArgs, formatOptions);
  return { zh: pair.zh, en: pair.en };
}

export const MAX_VISIBLE_PROGRESS_LINES = 5;

/**
 * Selects a concise slice of progress steps for the Business View surface, deduplicating
 * consecutive identical labels while keeping all raw tool traces available for "查看细节".
 */
export function selectVisibleProgressSteps(
  steps: readonly AgentRunStep[],
  status: AgentRunStatus,
  maxLines: number = MAX_VISIBLE_PROGRESS_LINES,
): {
  visibleSteps: AgentRunStep[];
  hiddenStepCount: number;
} {
  if (steps.length === 0) {
    return { visibleSteps: [], hiddenStepCount: 0 };
  }
  const deduped: AgentRunStep[] = [];
  for (const step of steps) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.label.zh === step.label.zh &&
      prev.label.en === step.label.en &&
      prev.status === step.status
    ) {
      deduped[deduped.length - 1] = step;
    } else {
      deduped.push(step);
    }
  }
  if (deduped.length <= maxLines) {
    return {
      visibleSteps: deduped,
      hiddenStepCount: Math.max(0, steps.length - deduped.length),
    };
  }
  const visibleSteps =
    status === 'RUNNING' ? deduped.slice(-maxLines) : [...deduped.slice(0, maxLines - 1), deduped[deduped.length - 1]!];
  return {
    visibleSteps,
    hiddenStepCount: Math.max(0, steps.length - visibleSteps.length),
  };
}

const VISION_ERROR_RE =
  /不支持.*(?:看图|图片|图像|视觉)|看不了图|does\s+not\s+support\s+(?:vision|image)|cannot\s+view\s+images|vision\s+(?:is\s+)?not\s+supported|image_url.*not\s+supported/i;

const UNCONFIGURED_ERROR_RE =
  /没有已启用.*网关|未配置.*(?:网关|模型|提供商|密钥)|未声明可用模型|no\s+enabled\s+llm|not\s+configured|no\s+declared\s+models|missing\s+api\s*key/i;

const TIMEOUT_ERROR_RE = /timed?\s*out|timeout|超时/i;

const UNREACHABLE_HOST_RE =
  /econnrefused|enotfound|ehostunreach|fetch\s+failed|connection\s+refused|unreachable|不可达|连接失败|连接被拒绝/i;

const UNREACHABLE_OR_GATEWAY_RE =
  /econnrefused|enotfound|ehostunreach|etimedout|fetch\s+failed|network\s*error|connection\s+refused|gateway|unreachable|不可达|连接失败|连接被拒绝|网关|api\s*key|unauthorized|forbidden|\bhttp\s*(?:401|403|404|429|5\d\d)\b|\bstatus\s*(?:code\s*)?[=:]?\s*(?:401|403|404|429|5\d\d)\b/i;

/**
 * Classifies whether a run failure (or vision capability fallback) is a platform-level
 * AI service problem that requires deployer configuration rather than business user troubleshooting.
 */
export function classifyRunPlatformProblem(
  failure?: AgentRunFailure,
  visionFallback?: AgentRunVisionFallback,
): PlatformProblemKind | null {
  if (!failure && visionFallback?.used) {
    return 'VISION_UNSUPPORTED';
  }
  if (!failure) return null;

  const code = (failure.code ?? '').trim().toUpperCase();
  const message = failure.message ?? '';
  const statusCode = failure.statusCode;

  if (
    code === 'VISION_UNSUPPORTED' ||
    code === 'LLM_VISION_UNSUPPORTED' ||
    VISION_ERROR_RE.test(message)
  ) {
    return 'VISION_UNSUPPORTED';
  }

  if (
    code === 'LLM_NOT_CONFIGURED' ||
    failure.baseUrl === '(none)' ||
    UNCONFIGURED_ERROR_RE.test(message) ||
    (failure.providerName && /未配置|no\s+provider\s+configured/i.test(failure.providerName))
  ) {
    return 'UNCONFIGURED';
  }

  if (
    code === 'LLM_TIMEOUT' ||
    statusCode === 408 ||
    statusCode === 504 ||
    TIMEOUT_ERROR_RE.test(message)
  ) {
    return 'TIMEOUT';
  }

  if (
    code === 'LLM_UNREACHABLE' ||
    code === 'LLM_GATEWAY_ERROR' ||
    code === 'HTTP_ERROR' ||
    code === 'GATEWAY' ||
    code === 'GATEWAY_ERROR' ||
    code === 'PROVIDER_ERROR' ||
    (statusCode !== undefined &&
      (statusCode === 401 ||
        statusCode === 403 ||
        statusCode === 404 ||
        statusCode === 429 ||
        statusCode >= 500)) ||
    UNREACHABLE_OR_GATEWAY_RE.test(message)
  ) {
    return code === 'LLM_UNREACHABLE' ||
      (statusCode !== undefined && statusCode >= 500) ||
      UNREACHABLE_HOST_RE.test(message)
      ? 'UNREACHABLE'
      : 'GATEWAY';
  }

  return null;
}

/**
 * Builds the Business View one-sentence failure explanation while keeping all technical
 * ADR 0007 diagnostics intact for the "查看细节" / "View details" disclosure.
 */
export function formatRunFailurePresentation(
  failure?: AgentRunFailure,
  visionFallback?: AgentRunVisionFallback,
): {
  isPlatformProblem: boolean;
  platformKind: PlatformProblemKind | null;
  summary: LocalizedText;
} {
  const platformKind = classifyRunPlatformProblem(failure, visionFallback);
  if (platformKind === 'VISION_UNSUPPORTED') {
    return {
      isPlatformProblem: true,
      platformKind,
      summary: {
        zh: `${PLATFORM_UNAVAILABLE_COPY.zh}（当前模型不支持查看图片）。`,
        en: `${PLATFORM_UNAVAILABLE_COPY.en} (the current model cannot view images).`,
      },
    };
  }
  if (platformKind) {
    return {
      isPlatformProblem: true,
      platformKind,
      summary: {
        zh: `${PLATFORM_UNAVAILABLE_COPY.zh}。`,
        en: PLATFORM_UNAVAILABLE_COPY.en,
      },
    };
  }

  if (!failure || !failure.message.trim()) {
    return {
      isPlatformProblem: false,
      platformKind: null,
      summary: {
        zh: '运行失败，未返回原因。',
        en: 'The run failed without a reason.',
      },
    };
  }

  const code = (failure.code ?? '').trim().toUpperCase();
  if (code === 'AGENT_RUN_INTERRUPTED') {
    return {
      isPlatformProblem: false,
      platformKind: null,
      summary: {
        zh: '上次处理意外中断，请点击重试继续。',
        en: 'Processing was interrupted before finishing. Click Retry to continue.',
      },
    };
  }
  if (code === 'LLM_EMPTY_RESPONSE') {
    return {
      isPlatformProblem: false,
      platformKind: null,
      summary: {
        zh: 'AI 助手这次没有生成有效内容，请重试。',
        en: 'The AI Assistant returned an empty reply. Please retry.',
      },
    };
  }

  const cleanMsg = failure.message.replace(/\s+/g, ' ').trim();
  if (
    cleanMsg.length <= 120 &&
    checkBusinessViewMarkup(cleanMsg, { plainText: true }).length === 0
  ) {
    return {
      isPlatformProblem: false,
      platformKind: null,
      summary: { zh: cleanMsg, en: cleanMsg },
    };
  }

  return {
    isPlatformProblem: false,
    platformKind: null,
    summary: {
      zh: '处理过程中遇到问题，请重试。',
      en: 'Something went wrong while processing your request. Please retry.',
    },
  };
}

function formatToolTraceDetail(trace: AgentToolCallTrace): string | undefined {
  const parts: string[] = [];
  if (trace.arguments && Object.keys(trace.arguments).length > 0) {
    try {
      parts.push(JSON.stringify(trace.arguments, null, 2));
    } catch {
      // Ignore non-serializable debug preview
    }
  }
  if (trace.output?.trim()) {
    parts.push(trace.output.trim());
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function mapToolTraceToStep(
  trace: AgentToolCallTrace,
  parentCancelled?: boolean,
  suite?: OntologySuite,
): AgentRunStep {
  const status: AgentRunStepStatus =
    trace.isError ? 'FAILED' : parentCancelled ? 'STOPPED' : 'DONE';
  const detail = formatToolTraceDetail(trace);
  return {
    id: trace.id,
    label: formatRunToolProgress(trace.toolName, trace.arguments, {
      active: false,
      ...(trace.targetAnchor ? { targetAnchor: trace.targetAnchor } : {}),
      ...(suite ? { suite } : {}),
    }),
    status,
    toolName: trace.toolName,
    ...(trace.targetAnchor ? { targetAnchor: trace.targetAnchor } : {}),
    ...(detail ? { detail } : {}),
  };
}

function extractRevisionArtifact(
  artifacts: AgentDomainArtifact[] | undefined,
): Extract<AgentDomainArtifact, { kind: 'PROTOTYPE_REVISION' }> | undefined {
  return artifacts?.find(
    (a): a is Extract<AgentDomainArtifact, { kind: 'PROTOTYPE_REVISION' }> =>
      a.kind === 'PROTOTYPE_REVISION',
  );
}

const ARTIFACT_PRIORITY: AgentDomainArtifact['kind'][] = [
  'PROTOTYPE_REVISION',
  'REQUIREMENT_DOC',
  'ONTOLOGY_SUITE',
  'EXTRACTION_JOB',
  'TECH_ARCH_ASSET',
  'ANALYTICS_REPORT',
  'METRIC_INSIGHT',
  'CODING_PACKAGE',
  'ONTOLOGY_DIFF',
  'REASONING_POLICY',
  'SQL_PREVIEW',
  'REQUIREMENT_HINTS',
];

function selectPrimaryDomainArtifact(
  artifacts: AgentDomainArtifact[] | undefined,
): AgentDomainArtifact | undefined {
  if (!artifacts || artifacts.length === 0) return undefined;
  for (const kind of ARTIFACT_PRIORITY) {
    const matched = [...artifacts].reverse().find((a) => a.kind === kind);
    if (matched) return matched;
  }
  return artifacts[artifacts.length - 1];
}

function formatDomainArtifactLabel(artifact: AgentDomainArtifact): LocalizedText {
  switch (artifact.kind) {
    case 'PROTOTYPE_REVISION':
      return {
        zh: `查看修订 v${artifact.revisionNumber}`,
        en: `Open revision v${artifact.revisionNumber}`,
      };
    case 'REQUIREMENT_DOC':
      return {
        zh: `打开需求规格书 (${artifact.version})`,
        en: `Open SRS (${artifact.version})`,
      };
    case 'ONTOLOGY_SUITE':
      return {
        zh: `查看${BUSINESS_VOCABULARY.ONTOLOGY_SUITE.zh}`,
        en: `Open ${BUSINESS_VOCABULARY.ONTOLOGY_SUITE.en}`,
      };
    case 'ONTOLOGY_DIFF': {
      const zhModel = artifact.modelCode
        ? getModelBusinessName(artifact.modelCode, 'zh-CN')
        : BUSINESS_VOCABULARY.ONTOLOGY_SUITE.zh;
      const enModel = artifact.modelCode
        ? getModelBusinessName(artifact.modelCode, 'en-US')
        : BUSINESS_VOCABULARY.ONTOLOGY_SUITE.en;
      return {
        zh: `查看${zhModel}变更`,
        en: `Inspect ${enModel} change`,
      };
    }
    case 'TECH_ARCH_ASSET':
      return {
        zh: `查看技术架构 (${artifact.version})`,
        en: `Open Tech Arch (${artifact.version})`,
      };
    case 'CODING_PACKAGE':
      return {
        zh: `查看开发包 (${artifact.files.length} 文件)`,
        en: `Open Dev Package (${artifact.files.length} files)`,
      };
    case 'METRIC_INSIGHT': {
      const cleanMetric =
        artifact.metricCode &&
        checkBusinessViewMarkup(artifact.metricCode, { plainText: true }).length === 0
          ? artifact.metricCode
          : '';
      return cleanMetric
        ? {
            zh: `查看指标洞察 (${cleanMetric})`,
            en: `View Insight (${cleanMetric})`,
          }
        : {
            zh: '查看指标洞察',
            en: 'View Metric Insight',
          };
    }
    case 'ANALYTICS_REPORT':
      return {
        zh: '打开归因分析报告',
        en: 'Open Attribution Report',
      };
    case 'REASONING_POLICY':
      return {
        zh: '查看三段式推理看板',
        en: 'View 3-stage reasoning',
      };
    case 'SQL_PREVIEW':
      return {
        zh: `查看查询结果 (${artifact.rows.length} 行)`,
        en: `View query results (${artifact.rows.length} rows)`,
      };
    case 'EXTRACTION_JOB':
      return {
        zh: `查看萃取候选 (${artifact.systemName} · ${artifact.candidateCount} 项)`,
        en: `Review Extraction (${artifact.systemName} · ${artifact.candidateCount} candidates)`,
      };
    default:
      return { zh: '查看产物', en: 'View artifact' };
  }
}

function buildCompletedSessionRun(
  session: AgentSession,
  uMsg: AgentSessionMessage,
  aMsg: AgentSessionMessage,
  opts?: { suite?: OntologySuite; isLatestTurn?: boolean },
): AgentRunView {
  const startedAt = parseIsoMs(uMsg.timestamp, Date.now());
  const completedAt = parseIsoMs(aMsg.timestamp, startedAt);
  const title = summarizeUserPromptTitle(uMsg.content);
  const userPrompt = resolveUserPromptDisplay(uMsg.content);

  let status: AgentRunStatus = 'SUCCEEDED';
  if (aMsg.cancelled) {
    status = 'CANCELLED';
  } else if (aMsg.errorDiagnostic) {
    status = 'FAILED';
  }

  const steps = (aMsg.toolCalls ?? []).map((tc) =>
    mapToolTraceToStep(tc, aMsg.cancelled, opts?.suite),
  );
  const thinking = aMsg.thinking?.trim();
  const revArtifact = extractRevisionArtifact(aMsg.artifacts);
  const primaryArtifact = selectPrimaryDomainArtifact(aMsg.artifacts);
  const summaryText = aMsg.content.trim();

  const modifiedAnchors =
    revArtifact?.modifiedAnchors ??
    (aMsg.toolCalls ?? [])
      .filter(
        (tc) =>
          !tc.isError &&
          (tc.toolName === 'edit_prototype_anchor' || tc.toolName === 'rewrite_prototype_page') &&
          tc.targetAnchor,
      )
      .map((tc) => tc.targetAnchor!);

  const visionUsed = Boolean(aMsg.visionFallbackUsed || uMsg.visionFallbackUsed);
  const visionNotice = aMsg.visionFallbackNotice ?? uMsg.visionFallbackNotice;
  const diag = aMsg.errorDiagnostic as
    | (NonNullable<AgentSessionMessage['errorDiagnostic']> & {
        model?: string;
        statusCode?: number;
      })
    | undefined;

  return {
    id: uMsg.id,
    title,
    status,
    liveStatus:
      status === 'SUCCEEDED'
        ? { zh: '已完成', en: 'Completed' }
        : status === 'CANCELLED'
          ? { zh: '已取消', en: 'Cancelled' }
          : { zh: '运行失败', en: 'Failed' },
    startedAt,
    completedAt,
    ...(aMsg.modelUsed ? { model: aMsg.modelUsed } : {}),
    ...(aMsg.providerName ? { providerName: aMsg.providerName } : {}),
    ...(opts?.isLatestTurn && session.tokenUsage ? { usage: session.tokenUsage } : {}),
    ...(visionUsed
      ? {
          visionFallback: {
            used: true,
            ...(visionNotice ? { notice: visionNotice } : {}),
            ...(aMsg.providerName ? { providerName: aMsg.providerName } : {}),
          },
        }
      : {}),
    steps,
    ...(thinking ? { thinking } : {}),
    ...(userPrompt ? { userPrompt } : {}),
    ...(aMsg.content ? { text: aMsg.content } : {}),
    sourceSessionId: session.id,
    sourceUserMessageId: uMsg.id,
    sourceAssistantMessageId: aMsg.id,
    retryPrompt: uMsg.content,
    ...(uMsg.images && uMsg.images.length > 0 ? { images: uMsg.images } : {}),
    ...(uMsg.handoffFrom ? { handoffFrom: uMsg.handoffFrom } : {}),
    ...(aMsg.askUser ? { askUser: aMsg.askUser } : {}),
    ...(aMsg.stepHandoff ? { stepHandoff: aMsg.stepHandoff } : {}),
    ...(modifiedAnchors.length > 0 ? { modifiedAnchors } : {}),
    ...(revArtifact
      ? {
          prototypeRevision: {
            prototypeId: revArtifact.prototypeId,
            revisionId: revArtifact.revisionId,
            revisionNumber: revArtifact.revisionNumber,
          },
        }
      : {}),
    ...(primaryArtifact ? { artifact: primaryArtifact } : {}),
    ...(status === 'SUCCEEDED'
      ? {
          result: {
            summary: summaryText
              ? { zh: summaryText, en: summaryText }
              : { zh: '已完成处理。', en: 'Completed.' },
            ...(primaryArtifact
              ? {
                  artifactLabel: formatDomainArtifactLabel(primaryArtifact),
                }
              : {}),
          },
        }
      : {}),
    ...(status === 'FAILED' && diag
      ? {
          failure: {
            message: diag.message,
            ...(diag.remediation ? { remediation: diag.remediation } : {}),
            ...(diag.code ? { code: diag.code } : {}),
            ...(diag.providerName ? { providerName: diag.providerName } : {}),
            ...(diag.baseUrl ? { baseUrl: diag.baseUrl } : {}),
            ...(diag.model ? { model: diag.model } : {}),
            ...(diag.statusCode !== undefined ? { statusCode: diag.statusCode } : {}),
          },
        }
      : {}),
  };
}

function buildRunFromLiveDraft(
  draft: SessionLiveDraft,
  uMsg?: AgentSessionMessage,
  suite?: OntologySuite,
): AgentRunView {
  const startedAt = uMsg ? parseIsoMs(uMsg.timestamp, draft.startedAt) : draft.startedAt;
  const thinking = draft.thinking.trim();
  const userPrompt = resolveUserPromptDisplay(uMsg?.content ?? draft.userPrompt, draft.displayTitle);
  const revArtifact = extractRevisionArtifact(draft.artifacts);
  const primaryArtifact = selectPrimaryDomainArtifact(draft.artifacts);
  const images =
    uMsg?.images && uMsg.images.length > 0
      ? uMsg.images
      : draft.images && draft.images.length > 0
        ? draft.images
        : undefined;
  const steps: AgentRunStep[] = draft.steps.map((step) => {
    if (!step.toolName) return step;
    const label = formatRunToolProgress(step.toolName, step.arguments, {
      active: step.status === 'RUNNING',
      ...(step.targetAnchor ? { targetAnchor: step.targetAnchor } : {}),
      ...(suite ? { suite } : {}),
    });
    return {
      ...step,
      label: step.arguments || step.targetAnchor?.label ? label : step.label,
    };
  });
  const activeStep = steps.find((s) => s.status === 'RUNNING');
  const liveStatus =
    activeStep && activeStep.toolName ? activeStep.label : draft.liveStatus;

  return {
    id: uMsg?.id ?? draft.runId,
    title: summarizeUserPromptTitle(uMsg?.content ?? draft.userPrompt, draft.displayTitle),
    status: 'RUNNING',
    liveStatus,
    startedAt,
    ...(draft.model ? { model: draft.model } : {}),
    ...(draft.providerName ? { providerName: draft.providerName } : {}),
    ...(draft.usage ? { usage: draft.usage } : {}),
    ...(draft.visionFallbackUsed
      ? {
          visionFallback: {
            used: true,
            ...(draft.visionFallbackNotice ? { notice: draft.visionFallbackNotice } : {}),
            ...(draft.providerName ? { providerName: draft.providerName } : {}),
          },
        }
      : {}),
    steps,
    ...(thinking ? { thinking } : {}),
    ...(userPrompt ? { userPrompt } : {}),
    ...(draft.text ? { text: draft.text } : {}),
    sourceSessionId: draft.sessionId,
    ...(uMsg ? { sourceUserMessageId: uMsg.id } : {}),
    retryPrompt: uMsg?.content ?? draft.userPrompt,
    ...(images ? { images } : {}),
    ...(uMsg?.handoffFrom ? { handoffFrom: uMsg.handoffFrom } : {}),
    ...(draft.askUser ? { askUser: draft.askUser } : {}),
    ...(draft.stepHandoff ? { stepHandoff: draft.stepHandoff } : {}),
    ...(draft.activeAnchor ? { modifiedAnchors: [draft.activeAnchor] } : {}),
    ...(revArtifact
      ? {
          prototypeRevision: {
            prototypeId: revArtifact.prototypeId,
            revisionId: revArtifact.revisionId,
            revisionNumber: revArtifact.revisionNumber,
          },
        }
      : {}),
    ...(primaryArtifact ? { artifact: primaryArtifact } : {}),
  };
}

export interface AgentRunsFromSessionOptions {
  suite?: OntologySuite;
}

/**
 * Adapts an `AgentSession` (and an optional in-flight `liveDraft` SSE state) into
 * chronological `AgentRunView` items for `AgentPanel` / `AgentRunCard`.
 */
export function agentRunsFromSession(
  session: AgentSession | undefined | null,
  liveDraft?: SessionLiveDraft | null,
  options?: AgentRunsFromSessionOptions,
): AgentRunView[] {
  const suite = options?.suite;
  if (!session) {
    return liveDraft ? [buildRunFromLiveDraft(liveDraft, undefined, suite)] : [];
  }

  const runs: AgentRunView[] = [];
  const msgs = session.messages ?? [];
  let consumedLiveDraft = false;

  for (let i = 0; i < msgs.length; i += 1) {
    const msg = msgs[i]!;
    if (msg.role !== 'user') continue;
    const isTrailingUser = !msgs.slice(i + 1).some((m) => m.role === 'user');

    const nextMsg = msgs[i + 1];
    if (nextMsg && nextMsg.role === 'assistant') {
      runs.push(
        buildCompletedSessionRun(session, msg, nextMsg, {
          ...(suite ? { suite } : {}),
          isLatestTurn: isTrailingUser && !liveDraft,
        }),
      );
      i += 1;
      continue;
    }

    if (isTrailingUser && liveDraft) {
      runs.push(buildRunFromLiveDraft(liveDraft, msg, suite));
      consumedLiveDraft = true;
      continue;
    }

    const fallbackStatus: AgentRunStatus =
      isTrailingUser && session.status === 'RUNNING'
        ? 'RUNNING'
        : session.status === 'ERROR'
          ? 'FAILED'
          : 'CANCELLED';
    const startedAt = parseIsoMs(msg.timestamp, Date.now());
    runs.push({
      id: msg.id,
      title: summarizeUserPromptTitle(msg.content),
      status: fallbackStatus,
      liveStatus:
        fallbackStatus === 'RUNNING'
          ? { zh: '正在后台执行…', en: 'Running in background…' }
          : fallbackStatus === 'FAILED'
            ? { zh: '运行失败', en: 'Failed' }
            : { zh: '已取消', en: 'Cancelled' },
      startedAt,
      ...(fallbackStatus !== 'RUNNING' ? { completedAt: startedAt } : {}),
      steps: [],
      ...(resolveUserPromptDisplay(msg.content)
        ? { userPrompt: resolveUserPromptDisplay(msg.content)! }
        : {}),
      sourceSessionId: session.id,
      sourceUserMessageId: msg.id,
      retryPrompt: msg.content,
      ...(msg.handoffFrom ? { handoffFrom: msg.handoffFrom } : {}),
      ...(msg.images && msg.images.length > 0 ? { images: msg.images } : {}),
    });
  }

  if (liveDraft && !consumedLiveDraft) {
    runs.push(buildRunFromLiveDraft(liveDraft, undefined, suite));
  }

  return runs;
}
