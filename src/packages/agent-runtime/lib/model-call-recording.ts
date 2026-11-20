/**
 * Records a Context Snapshot for every Model Call (ADR 0017): wraps a pi-ai event stream, and when
 * the call settles (done, error, abort, or the consumer leaving early) writes what was sent and the
 * usage the provider reported. Recording never fails the run it observes.
 */
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  Tool,
} from '@earendil-works/pi-ai';
import type {
  AgentSessionMessage,
  ContextItemInput,
  ModelCallPurpose,
  ModelCallStatus,
  ModelCallSummary,
  ToolDefinitionSource,
  WorkspaceStore,
} from '../../workspace-store/index.js';

/** A part of the system prompt that is not plain instructions. */
export interface PromptMark {
  kind: 'BUSINESS_CONTEXT' | 'COMPACTED_SUMMARY' | 'TOOL_GUIDE';
  text: string;
}

/**
 * Splits an assembled system prompt into items by locating the marked parts in it; whatever lies
 * between marked parts is instructions. Joining the items' content in order with the separators
 * that were trimmed away reproduces the prompt.
 */
export function segmentSystemPrompt(prompt: string, marks: readonly PromptMark[]): ContextItemInput[] {
  const located: { start: number; end: number; kind: PromptMark['kind'] }[] = [];
  for (const mark of marks) {
    const text = mark.text.trim();
    if (!text) continue;
    let from = 0;
    while (from <= prompt.length) {
      const start = prompt.indexOf(text, from);
      if (start < 0) break;
      const end = start + text.length;
      if (!located.some((l) => start < l.end && end > l.start)) {
        located.push({ start, end, kind: mark.kind });
        break;
      }
      from = start + 1;
    }
  }
  located.sort((a, b) => a.start - b.start);

  const items: ContextItemInput[] = [];
  const pushInstructions = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) items.push({ kind: 'INSTRUCTIONS', content: trimmed });
  };
  let cursor = 0;
  for (const part of located) {
    pushInstructions(prompt.slice(cursor, part.start));
    items.push({ kind: part.kind, content: prompt.slice(part.start, part.end) });
    cursor = part.end;
  }
  pushInstructions(prompt.slice(cursor));
  return items;
}

export function toolDefinitionSource(name: string): ToolDefinitionSource {
  if (name === 'codemode') return 'CODEMODE';
  if (name === 'invoke_mcp_tool') return 'MCP';
  return 'BUILTIN';
}

export function toolDefinitionItems(tools: readonly Tool[] | undefined): ContextItemInput[] {
  return (tools ?? []).map((tool) => ({
    kind: 'TOOL_DEFINITION',
    label: tool.name,
    source: toolDefinitionSource(tool.name),
    content: JSON.stringify(
      { name: tool.name, description: tool.description, parameters: tool.parameters },
      null,
      2,
    ),
  }));
}

function describeImage(mimeType: string, base64: string): string {
  const kb = Math.max(1, Math.round((base64.length * 3) / 4 / 1024));
  return `[image: ${mimeType}, ${kb} KB]`;
}

function blocksToText(
  content: string | readonly ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[],
): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => (block.type === 'text' ? block.text : describeImage(block.mimeType, block.data)))
    .join('\n');
}

function assistantItems(message: AssistantMessage, sessionMessageId?: string): ContextItemInput[] {
  const items: ContextItemInput[] = [];
  const idPart = sessionMessageId ? { sessionMessageId } : {};
  for (const block of message.content) {
    if (block.type === 'text') {
      if (block.text.trim()) items.push({ kind: 'ASSISTANT_MESSAGE', content: block.text, ...idPart });
    } else if (block.type === 'thinking') {
      if (block.thinking.trim()) items.push({ kind: 'REASONING', content: block.thinking, ...idPart });
    } else if (block.type === 'toolCall') {
      items.push({
        kind: 'TOOL_CALL',
        label: block.name,
        content: JSON.stringify(block.arguments ?? {}, null, 2),
        ...idPart,
      });
    }
  }
  return items;
}

/**
 * Turns the messages of a model context into snapshot items. `sessionMessageIds[i]`, when given,
 * names the Agent Session message that `messages[i]` was replayed from.
 */
export function messageItems(
  messages: readonly Message[],
  sessionMessageIds: readonly (string | undefined)[] = [],
): ContextItemInput[] {
  const items: ContextItemInput[] = [];
  messages.forEach((message, index) => {
    const sessionMessageId = sessionMessageIds[index];
    const idPart = sessionMessageId ? { sessionMessageId } : {};
    if (message.role === 'user') {
      items.push({ kind: 'USER_MESSAGE', content: blocksToText(message.content), ...idPart });
    } else if (message.role === 'assistant') {
      items.push(...assistantItems(message, sessionMessageId));
    } else if (message.role === 'toolResult') {
      items.push({
        kind: 'TOOL_RESULT',
        label: message.isError ? `${message.toolName} (error)` : message.toolName,
        content: blocksToText(message.content),
        ...idPart,
      });
    }
  });
  return items;
}

/** Snapshot items for Agent Session messages, as history replay would present them. */
export function sessionMessageItems(messages: readonly AgentSessionMessage[]): ContextItemInput[] {
  const items: ContextItemInput[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      items.push({ kind: 'USER_MESSAGE', content: message.content, sessionMessageId: message.id });
    } else if (message.role === 'assistant' && message.content.trim()) {
      items.push({ kind: 'ASSISTANT_MESSAGE', content: message.content, sessionMessageId: message.id });
    }
  }
  return items;
}

export interface ModelCallRecording {
  store: WorkspaceStore;
  projectId: string;
  sessionId: string;
  runId?: string;
  purpose: ModelCallPurpose;
  parentCallId?: string;
  laneLabel?: { zh: string; en: string };
  /** Mock mode (ADR 0007): usage is recorded as simulated. */
  simulated: boolean;
  /** Provider shown to people (its configured name), not the internal provider id. */
  providerLabel: string;
  model: { id: string; contextWindow: number; maxTokens: number };
  /** Requested output cap; defaults to the model's. */
  maxOutputTokens?: number;
  systemPrompt: string;
  /** Marked parts of `systemPrompt`; without them the prompt is recorded as instructions. */
  promptMarks?: readonly PromptMark[];
  tools?: readonly Tool[];
  messages: readonly Message[];
  /** `sessionMessageIds[i]` names the session message `messages[i]` was replayed from. */
  sessionMessageIds?: readonly (string | undefined)[];
  /** Session messages left out of this call. */
  excluded?: readonly AgentSessionMessage[];
  /** Fixed call id, so tool calls this call issues can name it as their subagents' parent. */
  callId?: string;
  /** Called with the stored summary, or with nothing if recording failed. */
  onRecorded?: (summary: ModelCallSummary | undefined) => void;
}

function statusOf(final: AssistantMessage | undefined, failed: AssistantMessage | undefined, aborted: boolean): ModelCallStatus {
  if (failed) return failed.stopReason === 'aborted' ? 'ABORTED' : 'ERROR';
  if (final) return final.stopReason === 'error' ? 'ERROR' : final.stopReason === 'aborted' ? 'ABORTED' : 'COMPLETED';
  return aborted ? 'ABORTED' : 'ERROR';
}

function writeRecord(
  rec: ModelCallRecording,
  startedAt: string,
  final: AssistantMessage | undefined,
  failed: AssistantMessage | undefined,
): void {
  const settled = final ?? failed;
  const systemItems = rec.promptMarks
    ? segmentSystemPrompt(rec.systemPrompt, rec.promptMarks)
    : rec.systemPrompt.trim()
      ? [{ kind: 'INSTRUCTIONS' as const, content: rec.systemPrompt.trim() }]
      : [];
  const usage = settled?.usage;
  let summary: ModelCallSummary | undefined;
  try {
    summary = rec.store.recordModelCall({
      ...(rec.callId ? { id: rec.callId } : {}),
      projectId: rec.projectId,
      sessionId: rec.sessionId,
      ...(rec.runId ? { runId: rec.runId } : {}),
      ...(rec.parentCallId ? { parentCallId: rec.parentCallId } : {}),
      ...(rec.laneLabel ? { laneLabel: rec.laneLabel } : {}),
      purpose: rec.purpose,
      provider: rec.providerLabel,
      model: rec.model.id,
      contextWindow: rec.model.contextWindow,
      maxOutputTokens: rec.maxOutputTokens ?? rec.model.maxTokens,
      startedAt,
      endedAt: new Date().toISOString(),
      status: statusOf(final, failed, !settled),
      ...(settled?.errorMessage ? { errorMessage: settled.errorMessage } : {}),
      ...(usage
        ? {
            providerUsage: {
              input: usage.input ?? 0,
              output: usage.output ?? 0,
              cacheRead: usage.cacheRead ?? 0,
              cacheWrite: usage.cacheWrite ?? 0,
            },
          }
        : {}),
      simulated: rec.simulated,
      included: [
        ...systemItems,
        ...toolDefinitionItems(rec.tools),
        ...messageItems(rec.messages, rec.sessionMessageIds),
      ],
      excluded: sessionMessageItems(rec.excluded ?? []),
      response: settled ? assistantItems(settled) : [],
    });
  } catch (error) {
    console.warn('[context-snapshot] failed to record model call:', error);
  }
  rec.onRecorded?.(summary);
}

/**
 * Passes every event of `stream` through unchanged and records the call once it settles. The
 * context is captured when the call starts, so later mutation of the message list by the caller
 * does not leak into the snapshot.
 */
export async function* recordModelCallStream(
  stream: AsyncIterable<AssistantMessageEvent>,
  rec: ModelCallRecording,
): AsyncGenerator<AssistantMessageEvent, void, undefined> {
  const startedAt = new Date().toISOString();
  const captured: ModelCallRecording = {
    ...rec,
    messages: [...rec.messages],
    ...(rec.tools ? { tools: [...rec.tools] } : {}),
    ...(rec.promptMarks ? { promptMarks: [...rec.promptMarks] } : {}),
  };
  let final: AssistantMessage | undefined;
  let failed: AssistantMessage | undefined;
  try {
    for await (const event of stream) {
      if (event.type === 'done') final = event.message;
      else if (event.type === 'error') failed = event.error;
      yield event;
    }
  } finally {
    writeRecord(captured, startedAt, final, failed);
  }
}
