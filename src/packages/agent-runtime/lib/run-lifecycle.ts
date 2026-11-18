import type {
  AgentSession,
  AgentSessionKind,
  AgentSessionMessage,
  WorkspaceStore,
} from '../../workspace-store/index.js';

export type ProjectStep =
  | 'REQUIREMENTS'
  | 'PROTOTYPE'
  | 'BUSINESS_MODEL'
  | 'DELIVERY';

export type AgentRunOutcome =
  | 'COMPLETED'
  | 'AWAITING_USER'
  | 'FAILED'
  | 'ABORTED';

export interface AgentRunContext {
  /** Persistent identifier of this Agent Run (equals `userMessageId` whenever the turn appends or resumes a user message). */
  runId: string;
  /** Owning `AgentSession` identifier. */
  sessionId: string;
  /** Owning `Ontology Project` identifier, or `null` when a session is not scoped to a project. */
  projectId: string | null;
  /** Specialised agent kind of the `AgentSession`. */
  sessionKind: AgentSessionKind;
  /** `ProjectStep` mapped from `sessionKind`, or `null` for non-step sessions (`CAPABILITY`, `REASONING`). */
  projectStep: ProjectStep | null;
  /** Optional target entity ID bound to the session (such as prototypeId or applicationId). */
  targetId?: string;
  /** User message ID associated with this turn when present. */
  userMessageId?: string;
  /** ISO-8601 timestamp when the Agent Run started. */
  startedAt: string;
}

export interface AgentRunStartEvent extends AgentRunContext {
  /** Synthesized user prompt or structured turn instruction for this run. */
  prompt: string;
  /** Turn execution mode. */
  mode: 'PROMPT' | 'STEER' | 'FOLLOW_UP' | 'CONTINUE';
}

export interface AgentRunFailureInfo {
  code: string;
  message: string;
  providerName?: string;
  baseUrl?: string;
  remediation?: string;
}

export interface AgentRunEndEvent extends AgentRunContext {
  /** Terminal outcome of this Agent Run. */
  outcome: AgentRunOutcome;
  /** Persisted assistant `AgentSessionMessage` ID recorded for this run. */
  assistantMessageId: string;
  /** ISO-8601 timestamp when the Agent Run finished. */
  endedAt: string;
  /** Wall-clock duration in milliseconds (`>= 0`). */
  durationMs: number;
  /** Structured failure details when `outcome === 'FAILED'`. */
  error?: AgentRunFailureInfo;
}

export interface AgentRunLifecycleHooks {
  onRunStart?: (
    event: AgentRunStartEvent,
    store: WorkspaceStore,
  ) => void | Promise<void>;
  onRunEnd?: (
    event: AgentRunEndEvent,
    store: WorkspaceStore,
  ) => void | Promise<void>;
}

const storeLifecycleHooksMap = new WeakMap<
  WorkspaceStore,
  Set<AgentRunLifecycleHooks>
>();

export function registerAgentRunLifecycleHooks(
  store: WorkspaceStore,
  hooks: AgentRunLifecycleHooks,
): () => void {
  let registered = storeLifecycleHooksMap.get(store);
  if (!registered) {
    registered = new Set<AgentRunLifecycleHooks>();
    storeLifecycleHooksMap.set(store, registered);
  }
  registered.add(hooks);
  return () => {
    registered?.delete(hooks);
  };
}

function collectLifecycleHookListeners(
  store: WorkspaceStore,
  extraHooks?: AgentRunLifecycleHooks,
): AgentRunLifecycleHooks[] {
  const registered = storeLifecycleHooksMap.get(store);
  const listeners = registered ? Array.from(registered) : [];
  if (extraHooks && !registered?.has(extraHooks)) {
    listeners.push(extraHooks);
  }
  return listeners;
}

export async function invokeAgentRunStartHooks(
  store: WorkspaceStore,
  event: AgentRunStartEvent,
  extraHooks?: AgentRunLifecycleHooks,
): Promise<void> {
  const listeners = collectLifecycleHookListeners(store, extraHooks);
  for (const listener of listeners) {
    if (listener.onRunStart) {
      await listener.onRunStart(event, store);
    }
  }
}

export async function invokeAgentRunEndHooks(
  store: WorkspaceStore,
  event: AgentRunEndEvent,
  extraHooks?: AgentRunLifecycleHooks,
): Promise<void> {
  const listeners = collectLifecycleHookListeners(store, extraHooks);
  let firstError: unknown;
  for (const listener of listeners) {
    if (!listener.onRunEnd) continue;
    try {
      await listener.onRunEnd(event, store);
    } catch (err) {
      if (firstError === undefined) {
        firstError = err;
      }
    }
  }
  if (firstError !== undefined) {
    throw firstError;
  }
}

export interface StoredSessionAgentRun {
  runId: string;
  sessionId: string;
  projectId: string | null;
  sessionKind: AgentSessionKind;
  projectStep: ProjectStep | null;
  userMessage?: AgentSessionMessage;
  assistantMessage?: AgentSessionMessage;
  outcome: AgentRunOutcome | 'RUNNING';
  startedAt: string;
  endedAt?: string;
}

export function deriveProjectStepForSessionKind(
  kind: AgentSessionKind,
): ProjectStep | null {
  switch (kind) {
    case 'REQUIREMENT':
      return 'REQUIREMENTS';
    case 'PROTOTYPE_CO_DESIGN':
      return 'PROTOTYPE';
    case 'COPILOT':
      return 'BUSINESS_MODEL';
    case 'ARCHITECTURE':
    case 'CODING':
      return 'DELIVERY';
    case 'CAPABILITY':
    case 'REASONING':
      return null;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

let agentMessageSeq = 0;

export function nextAgentMessageId(
  suffix: 'u' | 'a' | 'err' | 'interrupted' | 'run',
): string {
  agentMessageSeq += 1;
  return `amsg-${Date.now().toString(36)}-${agentMessageSeq.toString(36)}-${suffix}`;
}

export interface AllocatedTurnRunIdentity {
  runId: string;
  allocatedUserMessageId?: string;
}

export function allocateTurnRunIdentity(
  existing: AgentSession | undefined,
  turnInput: {
    prompt?: string;
    askUserAnswer?: unknown;
    images?: readonly unknown[];
  },
): AllocatedTurnRunIdentity {
  const willAppendUserMessage =
    Boolean(turnInput.prompt?.trim()) ||
    Boolean(turnInput.askUserAnswer) ||
    (Array.isArray(turnInput.images) && turnInput.images.length > 0);
  if (willAppendUserMessage) {
    const userMessageId = nextAgentMessageId('u');
    return { runId: userMessageId, allocatedUserMessageId: userMessageId };
  }
  const trailing = existing?.messages.at(-1);
  if (trailing?.role === 'user') {
    return { runId: trailing.runId || trailing.id };
  }
  return { runId: nextAgentMessageId('run') };
}

function deriveOutcomeFromAssistantMessage(
  msg: AgentSessionMessage,
): AgentRunOutcome {
  if (msg.cancelled) return 'ABORTED';
  if (msg.errorDiagnostic) return 'FAILED';
  if (msg.askUser && !msg.askUser.answered) return 'AWAITING_USER';
  return 'COMPLETED';
}

export function listSessionAgentRuns(
  session: AgentSession,
): StoredSessionAgentRun[] {
  const projectId = session.projectId?.trim() ? session.projectId : null;
  const projectStep = deriveProjectStepForSessionKind(session.agentKind);
  const messages = session.messages ?? [];
  const runs: StoredSessionAgentRun[] = [];

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]!;
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      const userRunId = msg.runId || msg.id;
      const nextMsg = messages[i + 1];
      const nextMatchesUserRun =
        nextMsg?.role === 'assistant' &&
        (!nextMsg.runId || nextMsg.runId === userRunId);

      if (nextMsg?.role === 'assistant' && nextMatchesUserRun) {
        runs.push({
          runId: nextMsg.runId || userRunId,
          sessionId: session.id,
          projectId,
          sessionKind: session.agentKind,
          projectStep,
          userMessage: msg,
          assistantMessage: nextMsg,
          outcome: deriveOutcomeFromAssistantMessage(nextMsg),
          startedAt: msg.timestamp,
          endedAt: nextMsg.timestamp,
        });
        i += 1;
        continue;
      }

      const isTrailingUser = !messages.slice(i + 1).some((m) => m.role === 'user');
      const fallbackOutcome: StoredSessionAgentRun['outcome'] =
        isTrailingUser && session.status === 'RUNNING'
          ? 'RUNNING'
          : session.status === 'ERROR'
            ? 'FAILED'
            : 'ABORTED';
      runs.push({
        runId: userRunId,
        sessionId: session.id,
        projectId,
        sessionKind: session.agentKind,
        projectStep,
        userMessage: msg,
        outcome: fallbackOutcome,
        startedAt: msg.timestamp,
        ...(fallbackOutcome !== 'RUNNING' ? { endedAt: msg.timestamp } : {}),
      });
      continue;
    }

    // Standalone assistant message (e.g. CONTINUE run when prior message was already assistant)
    runs.push({
      runId: msg.runId || msg.id,
      sessionId: session.id,
      projectId,
      sessionKind: session.agentKind,
      projectStep,
      assistantMessage: msg,
      outcome: deriveOutcomeFromAssistantMessage(msg),
      startedAt: msg.timestamp,
      endedAt: msg.timestamp,
    });
  }

  return runs;
}

export function findSessionAgentRun(
  session: AgentSession,
  runId: string,
): StoredSessionAgentRun | undefined {
  return listSessionAgentRuns(session).find((run) => run.runId === runId);
}
