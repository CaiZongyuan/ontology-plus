import type {
  AgentDomainArtifact,
  AgentSession,
  AgentSessionMessage,
  AgentToolCallTrace,
  PrototypeTargetAnchor,
} from '../../../packages/workspace-store/index.js';
import {
  formatAnchorBadgeLabel,
  formatToolStepLabel,
  type BackgroundPipelineTask,
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
 * Sources of agent work (session turns, legacy pipeline tasks) adapt into this
 * view model; `AgentRunCard` renders nothing else.
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
  /** Source session metadata when adapted from an `AgentSession` turn. */
  sourceSessionId?: string;
  sourceUserMessageId?: string;
  retryPrompt?: string;
  /** Semantic anchors modified during this run (for canvas highlighting). */
  modifiedAnchors?: PrototypeTargetAnchor[];
  /** Immutable prototype revision created at the end of this run, when HTML changed. */
  prototypeRevision?: {
    prototypeId: string;
    revisionId: string;
    revisionNumber: number;
  };
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

const RUN_STATUS_BY_TASK_STATUS: Record<BackgroundPipelineTask['status'], AgentRunStatus> = {
  RUNNING: 'RUNNING',
  COMPLETED: 'SUCCEEDED',
  ERROR: 'FAILED',
  CANCELLED: 'CANCELLED',
};

/**
 * Adapts a legacy background pipeline task into an Agent Run. Pipeline tasks are
 * retired once their callers post to an Agent Session instead; until then this
 * keeps them on the same card as everything else.
 */
export function agentRunFromPipelineTask(task: BackgroundPipelineTask): AgentRunView {
  const status = RUN_STATUS_BY_TASK_STATUS[task.status];
  const lastIndex = task.stageLogs.length - 1;

  const steps: AgentRunStep[] = task.stageLogs.map((log, index) => {
    let stepStatus: AgentRunStepStatus = 'DONE';
    if (log.phase === 'ERROR') stepStatus = 'FAILED';
    else if (log.phase === 'CANCELLED') stepStatus = 'STOPPED';
    else if (index === lastIndex) {
      if (status === 'RUNNING') stepStatus = 'RUNNING';
      else if (status === 'FAILED') stepStatus = 'FAILED';
      else if (status === 'CANCELLED') stepStatus = 'STOPPED';
    }
    const tail = index === lastIndex && status === 'RUNNING' ? task.previewTail.trim() : '';
    return {
      id: log.id,
      label: { zh: log.messageZh, en: log.messageEn },
      status: stepStatus,
      at: log.timestamp,
      ...(tail ? { detail: tail } : {}),
    };
  });

  // A finished task logs its closing message as the last stage; the card already
  // shows that as the result, so it is not repeated as a step.
  const lastLog = task.stageLogs[lastIndex];
  if (
    status === 'SUCCEEDED' &&
    lastLog &&
    lastLog.messageZh === task.messageZh &&
    lastLog.messageEn === task.messageEn
  ) {
    steps.pop();
  }

  const thinking = task.thinkingText.trim();

  return {
    id: task.id,
    title: { zh: task.titleZh, en: task.titleEn },
    status,
    liveStatus: { zh: task.messageZh, en: task.messageEn },
    startedAt: task.startedAt,
    ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
    ...(task.providerModel ? { model: task.providerModel } : {}),
    steps,
    ...(thinking ? { thinking } : {}),
    ...(status === 'SUCCEEDED'
      ? {
          result: {
            summary: { zh: task.messageZh, en: task.messageEn },
            artifactLabel: {
              zh: task.resultLabelZh ?? task.resultLabelEn ?? '查看结果',
              en: task.resultLabelEn ?? task.resultLabelZh ?? 'View result',
            },
          },
        }
      : {}),
    ...(status === 'FAILED'
      ? {
      failure: {
        message: task.errorDiagnostic?.message ?? task.messageEn,
        ...(task.errorDiagnostic?.remediation
          ? { remediation: task.errorDiagnostic.remediation }
          : {}),
        ...(task.errorDiagnostic?.code ? { code: task.errorDiagnostic.code } : {}),
      },
    }
  : {}),
  };
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

function buildCompletedSessionRun(
  session: AgentSession,
  uMsg: AgentSessionMessage,
  aMsg: AgentSessionMessage,
): AgentRunView {
  const startedAt = parseIsoMs(uMsg.timestamp, Date.now());
  const completedAt = parseIsoMs(aMsg.timestamp, startedAt);
  const title = summarizeUserPromptTitle(uMsg.content);

  let status: AgentRunStatus = 'SUCCEEDED';
  if (aMsg.cancelled) {
    status = 'CANCELLED';
  } else if (aMsg.errorDiagnostic) {
    status = 'FAILED';
  }

  const steps = (aMsg.toolCalls ?? []).map((tc) => mapToolTraceToStep(tc, aMsg.cancelled));
  const thinking = aMsg.thinking?.trim();
  const revArtifact = extractRevisionArtifact(aMsg.artifacts);
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
    sourceSessionId: session.id,
    sourceUserMessageId: uMsg.id,
    retryPrompt: uMsg.content,
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
    ...(status === 'SUCCEEDED'
      ? {
          result: {
            summary: summaryText
              ? { zh: summaryText, en: summaryText }
              : { zh: '已完成本轮修改。', en: 'Completed refinement run.' },
            ...(revArtifact
              ? {
                  artifactLabel: {
                    zh: `查看修订 v${revArtifact.revisionNumber}`,
                    en: `Open revision v${revArtifact.revisionNumber}`,
                  },
                }
              : aMsg.artifacts && aMsg.artifacts.length > 0
                ? {
                    artifactLabel: { zh: '查看产物', en: 'View artifact' },
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
  const revArtifact = extractRevisionArtifact(draft.artifacts);
  return {
    id: uMsg?.id ?? draft.runId,
    title: summarizeUserPromptTitle(uMsg?.content ?? draft.userPrompt, draft.displayTitle),
    status: 'RUNNING',
    liveStatus: draft.liveStatus,
    startedAt,
    ...(draft.model ? { model: draft.model } : {}),
    steps: draft.steps,
    ...(thinking ? { thinking } : {}),
    sourceSessionId: draft.sessionId,
    ...(uMsg ? { sourceUserMessageId: uMsg.id } : {}),
    retryPrompt: uMsg?.content ?? draft.userPrompt,
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
      sourceSessionId: session.id,
      sourceUserMessageId: msg.id,
      retryPrompt: msg.content,
    });
  }

  if (liveDraft && !consumedLiveDraft) {
    runs.push(buildRunFromLiveDraft(liveDraft));
  }

  return runs;
}
