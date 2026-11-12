import type { BackgroundPipelineTask } from '../../api.js';

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
