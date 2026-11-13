import type {
  AgentAskUserPrompt,
  AgentDomainArtifact,
  AgentImageAttachmentRef,
  AgentSession,
  AgentSessionMessage,
  AgentToolCallTrace,
  PrototypeTargetAnchor,
} from '../../../packages/workspace-store/index.js';
import {
  formatAnchorBadgeLabel,
  formatToolStepLabel,
  type QueuedSessionPromptItem,
  type SessionLiveDraft,
} from '../../api.js';

export {
  formatAnchorBadgeLabel,
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

export interface AgentRunView {
  id: string;
  title: LocalizedText;
  status: AgentRunStatus;
  /** One line describing what the agent is doing right now. */
  liveStatus: LocalizedText;
  startedAt: number;
  completedAt?: number;
  model?: string;
  steps: AgentRunStep[];
  thinking?: string;
  /**
   * What the user actually sent, shown as their side of the conversation.
   * Absent for structured action prompts, where `title` already says it all.
   */
  userPrompt?: string;
  /** Assistant reply streamed so far while the run is still in flight. */
  streamingText?: string;
  /** Source session metadata when adapted from an `AgentSession` turn. */
  sourceSessionId?: string;
  sourceUserMessageId?: string;
  sourceAssistantMessageId?: string;
  retryPrompt?: string;
  /** User-attached or visual-reference images submitted on this run (IndexedDB local or remote). */
  images?: AgentImageAttachmentRef[];
  /** Structured Scoped HITL question emitted by `ask_user` during this run. */
  askUser?: AgentAskUserPrompt;
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
  failure?: {
    message: string;
    remediation?: string;
    code?: string;
  };
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
    return { zh: '原型精修', en: 'Prototype refinement' };
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
        return { zh: '合成 11 元模型本体', en: 'Synthesize 11-Model Ontology' };
      case 'GENERATE_TECH_ARCH': {
        const name = typeof params.name === 'string' && params.name.trim() ? params.name.trim() : '';
        return name
          ? { zh: `生成技术架构：${name}`, en: `Generate Tech Arch: ${name}` }
          : { zh: '生成四层技术架构规范', en: 'Generate Tech Architecture Spec' };
      }
      case 'METRIC_INSIGHT': {
        const label =
          (typeof params.metricName === 'string' && params.metricName.trim()) ||
          (typeof params.metricCode === 'string' && params.metricCode.trim()) ||
          '';
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

function mapToolTraceToStep(trace: AgentToolCallTrace, parentCancelled?: boolean): AgentRunStep {
  const status: AgentRunStepStatus =
    trace.isError ? 'FAILED' : parentCancelled ? 'STOPPED' : 'DONE';
  const detail = formatToolTraceDetail(trace);
  return {
    id: trace.id,
    label: formatToolStepLabel(trace.toolName),
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
        zh: `查看 11 元模型 (${artifact.modelCount}/11)`,
        en: `Open 11-Model Suite (${artifact.modelCount}/11)`,
      };
    case 'ONTOLOGY_DIFF':
      return {
        zh: `查看 ${artifact.modelCode} 模型变更`,
        en: `Inspect ${artifact.modelCode} change`,
      };
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
    case 'METRIC_INSIGHT':
      return {
        zh: `查看指标洞察 (${artifact.metricCode})`,
        en: `View Insight (${artifact.metricCode})`,
      };
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
        zh: `查看 SQL 结果 (${artifact.rows.length} 行)`,
        en: `View SQL preview (${artifact.rows.length} rows)`,
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

  const steps = (aMsg.toolCalls ?? []).map((tc) => mapToolTraceToStep(tc, aMsg.cancelled));
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
    steps,
    ...(thinking ? { thinking } : {}),
    ...(userPrompt ? { userPrompt } : {}),
    sourceSessionId: session.id,
    sourceUserMessageId: uMsg.id,
    sourceAssistantMessageId: aMsg.id,
    retryPrompt: uMsg.content,
    ...(uMsg.images && uMsg.images.length > 0 ? { images: uMsg.images } : {}),
    ...(aMsg.askUser ? { askUser: aMsg.askUser } : {}),
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
              : { zh: '已完成本轮运行。', en: 'Completed agent run.' },
            ...(primaryArtifact
              ? {
                  artifactLabel: formatDomainArtifactLabel(primaryArtifact),
                }
              : {}),
          },
        }
      : {}),
    ...(status === 'FAILED' && aMsg.errorDiagnostic
      ? {
          failure: {
            message: aMsg.errorDiagnostic.message,
            ...(aMsg.errorDiagnostic.remediation
              ? { remediation: aMsg.errorDiagnostic.remediation }
              : {}),
            ...(aMsg.errorDiagnostic.code ? { code: aMsg.errorDiagnostic.code } : {}),
          },
        }
      : {}),
  };
}

function buildRunFromLiveDraft(
  draft: SessionLiveDraft,
  uMsg?: AgentSessionMessage,
): AgentRunView {
  const startedAt = uMsg ? parseIsoMs(uMsg.timestamp, draft.startedAt) : draft.startedAt;
  const thinking = draft.thinking.trim();
  const streamingText = draft.text?.trim();
  const userPrompt = resolveUserPromptDisplay(uMsg?.content ?? draft.userPrompt, draft.displayTitle);
  const revArtifact = extractRevisionArtifact(draft.artifacts);
  const primaryArtifact = selectPrimaryDomainArtifact(draft.artifacts);
  const images =
    uMsg?.images && uMsg.images.length > 0
      ? uMsg.images
      : draft.images && draft.images.length > 0
        ? draft.images
        : undefined;
  return {
    id: uMsg?.id ?? draft.runId,
    title: summarizeUserPromptTitle(uMsg?.content ?? draft.userPrompt, draft.displayTitle),
    status: 'RUNNING',
    liveStatus: draft.liveStatus,
    startedAt,
    ...(draft.model ? { model: draft.model } : {}),
    steps: draft.steps,
    ...(thinking ? { thinking } : {}),
    ...(userPrompt ? { userPrompt } : {}),
    ...(streamingText ? { streamingText } : {}),
    sourceSessionId: draft.sessionId,
    ...(uMsg ? { sourceUserMessageId: uMsg.id } : {}),
    retryPrompt: uMsg?.content ?? draft.userPrompt,
    ...(images ? { images } : {}),
    ...(draft.askUser ? { askUser: draft.askUser } : {}),
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

/**
 * Adapts an `AgentSession` (and an optional in-flight `liveDraft` SSE state) into
 * chronological `AgentRunView` items for `AgentPanel` / `AgentRunCard`.
 */
export function agentRunsFromSession(
  session: AgentSession | undefined | null,
  liveDraft?: SessionLiveDraft | null,
): AgentRunView[] {
  if (!session) {
    return liveDraft ? [buildRunFromLiveDraft(liveDraft)] : [];
  }

  const runs: AgentRunView[] = [];
  const msgs = session.messages ?? [];
  let consumedLiveDraft = false;

  for (let i = 0; i < msgs.length; i += 1) {
    const msg = msgs[i]!;
    if (msg.role !== 'user') continue;

    const nextMsg = msgs[i + 1];
    if (nextMsg && nextMsg.role === 'assistant') {
      runs.push(buildCompletedSessionRun(session, msg, nextMsg));
      i += 1;
      continue;
    }

    const isTrailingUser = !msgs.slice(i + 1).some((m) => m.role === 'user');
    if (isTrailingUser && liveDraft) {
      runs.push(buildRunFromLiveDraft(liveDraft, msg));
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
      ...(msg.images && msg.images.length > 0 ? { images: msg.images } : {}),
    });
  }

  if (liveDraft && !consumedLiveDraft) {
    runs.push(buildRunFromLiveDraft(liveDraft));
  }

  return runs;
}
