import {
  applyAlignment,
  buildAlignmentSkeleton,
  buildExtractionCandidates,
  candidateKey,
  checkSqlGrounding,
  extractMuFromPrototypeHtml,
  locateQuote,
  sanitizeAlignment,
  scanSourceStructure,
  type DataGrounding,
  type ExtractionEvidence,
  type OntologySuite,
  type SemanticAlignmentReport,
  type StructuralScanResult,
} from '../../ontology-core/index.js';
import {
  compileDevelopmentPackage,
  compileOntologySkill,
  handleOntologyMcpRequest,
  inspectOntologyMcpCapabilities,
  type McpToolDefinition,
} from '../../package-compiler/index.js';
import type {
  AssembledApplication,
  CapabilityChatMessage,
  CapabilityChatSession,
  ExtractionJob,
  ExtractionMergeResult,
  LlmProviderConfig,
  ProjectDetail,
  PrototypeArtifact,
  ReasoningSession,
  RequirementMessage,
  RequirementSession,
  WorkspaceStore,
} from '../../workspace-store/index.js';
import {
  applyLlmBlueprintToSuite,
  buildSemanticPrototypeHtmlForProject,
  collectMergedRequirementContext,
  type LlmSynthesizedDomainBlueprint,
} from './domain-run-tools.js';
import {
  type AgentLocale,
  normalizeAgentLocale,
  pickLocaleText,
  resolveEffectiveLocale,
} from './locale.js';
import {
  ONTOLOGY_DURABLE_TOOLS,
  durableMemoryStorage,
  ontologyToolRegistry,
  type OpenAiFunctionTool,
} from './tools.js';
import { LlmGatewayError, isMockLlmActive } from './pi-session-engine.js';
import {
  buildProjectDataGrounding,
  describeJoinWarnings,
  describeMissingModels,
} from './reasoning-grounding.js';

export { ONTOLOGY_DURABLE_TOOLS, LlmGatewayError, isMockLlmActive };

export interface LlmPingResult {
  ok: boolean;
  providerName: string;
  baseUrl: string;
  model: string;
  latencyMs: number;
  discoveredModels: string[];
  sampleReply?: string;
  errorMessage?: string;
}

export interface PrototypeRefinementSelection {
  kind: 'ELEMENT' | 'REGION';
  cssSelector: string;
  tagName?: string;
  label?: string;
  screenId?: string;
  elementId?: string;
  binding?: string;
  eventId?: string;
  htmlSnippet?: string;
  matchedElementsSummary?: string[];
  note?: string;
}

export interface PrototypeGenerationResult {
  prototype: PrototypeArtifact;
  project: ProjectDetail;
  prototypes: PrototypeArtifact[];
  providerUsed: string;
  summary?: string;
}

export interface AppCodingAgentResult {
  application: AssembledApplication;
  reply: string;
  generatedFilesCount: number;
  providerUsed: string;
}

export interface CapabilitySmartChatResult {
  session: CapabilityChatSession;
  message: CapabilityChatMessage;
  toolInvocations: NonNullable<CapabilityChatMessage['toolInvocations']>;
  citedSkillSlug: string;
  citedRules: string[];
  providerUsed: string;
}

export type SseEventType =
  | 'message_start'
  | 'delta'
  | 'tool_call'
  | 'tool_result'
  | 'render_payload'
  | 'message_end';

export interface SseAgentEvent {
  event: SseEventType;
  data: Record<string, unknown>;
  id?: string;
}

export const SSE_RESPONSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
} as const;

interface ParsedOpenAiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface OpenAiChatResponse {
  content: string;
  thinking?: string;
  toolCalls: ParsedOpenAiToolCall[];
  modelUsed: string;
  latencyMs: number;
}

function saveCheckpointSafe(
  store: WorkspaceStore,
  sessionId: string,
  workflow: string,
  state: Record<string, unknown>,
): void {
  void durableMemoryStorage;
  void ontologyToolRegistry;
  if (typeof store.saveAgentCheckpoint === 'function') {
    try {
      store.saveAgentCheckpoint(sessionId, workflow, JSON.stringify(state));
    } catch {
      // Non-fatal if store runs in read-only edge context
    }
  }
}

function resolvePreferredProvider(
  store: WorkspaceStore,
  projectId?: string,
  preferredProviderId?: string,
): LlmProviderConfig | undefined {
  const providers = store.listLlmProviders();
  const enabled = providers.filter((p) => p.enabled);
  if (preferredProviderId) {
    const direct = enabled.find((p) => p.id === preferredProviderId);
    if (direct) return direct;
  }
  if (projectId && typeof store.listAgentSessions === 'function') {
    const projectSessions = store.listAgentSessions({ projectId });
    for (const sess of projectSessions) {
      if (sess.providerId) {
        const match = enabled.find((p) => p.id === sess.providerId);
        if (match) return match;
      }
    }
  }
  return enabled[0] ?? providers[0];
}

function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

function extractFirstJsonObject<T = Record<string, unknown>>(raw: string): T | null {
  const unfenced = stripMarkdownFence(raw);
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(unfenced.slice(firstBrace, lastBrace + 1)) as T;
  } catch {
    return null;
  }
}

async function callOpenAiCompatibleChat(
  provider: LlmProviderConfig | undefined,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options: {
    store?: WorkspaceStore;
    mockMode?: boolean;
    timeoutMs?: number;
    idleTimeoutMs?: number;
    tools?: OpenAiFunctionTool[];
    maxTokens?: number;
    reasoningEffort?: 'low' | 'medium' | 'high';
    preserveWhitespace?: boolean;
    _isRetryWithoutReasoning?: boolean;
    signal?: AbortSignal;
    onThinkingDelta?: (delta: string, accumulatedThinking: string) => void;
    onStreamDelta?: (delta: string, accumulated: string) => void;
  } = {},
): Promise<OpenAiChatResponse | null> {
  if (options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const managedByStore = Boolean(options.store);
  if (options.store && isMockLlmActive(options.store, options.mockMode)) {
    return null;
  }

  if (managedByStore && (!provider || !provider.enabled)) {
    throw new LlmGatewayError({
      message: '当前没有已启用的 LLM 网关提供商（Live 模式禁止静默伪造回复）。',
      providerName: provider?.name ?? '未配置网关',
      baseUrl: provider?.baseUrl ?? '(none)',
      model: provider?.defaultModel ?? '(none)',
    });
  }

  if (!provider) return null;

  const idleTimeoutMs = managedByStore
    ? (options.idleTimeoutMs ?? options.timeoutMs ?? 180_000)
    : (options.timeoutMs ?? 6000);
  const maxWallMs = managedByStore ? Math.max(1_200_000, idleTimeoutMs * 4) : idleTimeoutMs;
  const start = Date.now();
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
  };
  const wallTimer = setTimeout(() => controller.abort(), maxWallMs);
  resetIdleTimer();

  const baseUrl = (provider.baseUrl || 'http://127.0.0.1:3425/v1').replace(/\/+$/, '');
  const modelName = provider.defaultModel || 'auto/glm-5.3-flash';
  const useStream = managedByStore && (!options.tools || options.tools.length === 0);

  try {
    const requestedMaxTokens = options.maxTokens ?? (managedByStore ? 16384 : 1200);
    const effectiveReasoningEffort =
      options._isRetryWithoutReasoning
        ? undefined
        : (options.reasoningEffort ?? (useStream ? 'low' : undefined));
    const payload: Record<string, unknown> = {
      model: modelName,
      messages,
      temperature: 0.2,
      max_tokens: options._isRetryWithoutReasoning
        ? Math.min(requestedMaxTokens, 8192)
        : requestedMaxTokens,
      ...(effectiveReasoningEffort ? { reasoning_effort: effectiveReasoningEffort } : {}),
      ...(useStream ? { stream: true } : {}),
    };
    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools;
      payload.tool_choice = 'auto';
    }

    let res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey || 'magpie'}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    // Compatibility fallback if an OpenAI-compatible proxy rejects `reasoning_effort` or high `max_tokens`
    if (
      res.status === 400 &&
      !options._isRetryWithoutReasoning &&
      (effectiveReasoningEffort || requestedMaxTokens > 8192)
    ) {
      const fallbackPayload: Record<string, unknown> = {
        model: modelName,
        messages,
        temperature: 0.2,
        max_tokens: Math.min(requestedMaxTokens, 8192),
        ...(useStream ? { stream: true } : {}),
        ...(options.tools && options.tools.length > 0
          ? { tools: options.tools, tool_choice: 'auto' }
          : {}),
      };
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey || 'magpie'}`,
        },
        body: JSON.stringify(fallbackPayload),
        signal: controller.signal,
      });
    }

    if (!res.ok) {
      if (managedByStore) {
        throw new LlmGatewayError({
          message: `LLM 网关返回 HTTP ${res.status} (${res.statusText || 'Gateway Error'})`,
          providerName: provider.name,
          baseUrl,
          model: modelName,
          statusCode: res.status,
        });
      }
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let accText = '';
      let accThinking = '';
      let resolvedModel = modelName;
      const toolCallAcc = new Map<number, { id: string; name: string; argsText: string }>();

      const handleSseBlock = (block: string) => {
        for (const rawLine of block.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;
          try {
            const chunk = JSON.parse(dataStr) as {
              model?: string;
              choices?: {
                delta?: {
                  content?: string | null;
                  reasoning_content?: string | null;
                  thinking?: string | null;
                  tool_calls?: {
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }[];
                };
              }[];
            };
            resetIdleTimer();
            if (chunk.model) resolvedModel = chunk.model;
            const delta = chunk.choices?.[0]?.delta;
            const reasoningDelta =
              typeof delta?.reasoning_content === 'string' && delta.reasoning_content.length > 0
                ? delta.reasoning_content
                : typeof delta?.thinking === 'string' && delta.thinking.length > 0
                  ? delta.thinking
                  : '';
            if (reasoningDelta) {
              accThinking += reasoningDelta;
              options.onThinkingDelta?.(reasoningDelta, accThinking);
            }
            if (typeof delta?.content === 'string' && delta.content.length > 0) {
              accText += delta.content;
              options.onStreamDelta?.(delta.content, accText);
            }
            for (const tc of delta?.tool_calls ?? []) {
              const idx = tc.index ?? 0;
              const prev = toolCallAcc.get(idx) ?? {
                id: tc.id || `tc-${idx + 1}`,
                name: '',
                argsText: '',
              };
              if (tc.id) prev.id = tc.id;
              if (tc.function?.name) prev.name += tc.function.name;
              if (tc.function?.arguments) prev.argsText += tc.function.arguments;
              toolCallAcc.set(idx, prev);
            }
          } catch {
            // Ignore non-JSON keepalive lines
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdleTimer();
        sseBuffer += decoder.decode(value, { stream: true });
        let sep = sseBuffer.indexOf('\n\n');
        while (sep !== -1) {
          handleSseBlock(sseBuffer.slice(0, sep));
          sseBuffer = sseBuffer.slice(sep + 2);
          sep = sseBuffer.indexOf('\n\n');
        }
      }
      if (sseBuffer.trim()) {
        handleSseBlock(sseBuffer);
      }

      const streamedToolCalls: ParsedOpenAiToolCall[] = [];
      for (const item of toolCallAcc.values()) {
        if (!item.name.trim()) continue;
        let parsedArgs: Record<string, unknown> = {};
        if (item.argsText.trim()) {
          try {
            const raw = JSON.parse(item.argsText) as unknown;
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
              parsedArgs = raw as Record<string, unknown>;
            }
          } catch {
            parsedArgs = {};
          }
        }
        streamedToolCalls.push({ id: item.id, name: item.name.trim(), args: parsedArgs });
      }

      const trimmedText = accText.trim();
      if (!trimmedText && streamedToolCalls.length === 0) {
        // Recovery: if a reasoning model exhausted its output token budget inside `reasoning_content`,
        // immediately run a single direct-output continuation so user generation never fails empty!
        if (accThinking.trim().length > 0 && !options._isRetryWithoutReasoning) {
          clearTimeout(wallTimer);
          if (idleTimer) clearTimeout(idleTimer);
          options.signal?.removeEventListener('abort', onExternalAbort);
          return callOpenAiCompatibleChat(
            provider,
            [
              ...messages,
              {
                role: 'user',
                content:
                  'IMPORTANT: Do NOT perform any further internal reasoning or drafting. Output ONLY the final document body directly right now.',
              },
            ],
            {
              ...options,
              maxTokens: Math.max(options.maxTokens ?? 16384, 32768),
              reasoningEffort: 'low',
              _isRetryWithoutReasoning: true,
            },
          );
        }
        if (managedByStore) {
          throw new LlmGatewayError({
            message: 'LLM 网关流式响应未返回有效文本内容。',
            providerName: provider.name,
            baseUrl,
            model: modelName,
          });
        }
        return null;
      }

      return {
        content: options.preserveWhitespace ? accText : trimmedText,
        ...(accThinking.trim() ? { thinking: accThinking.trim() } : {}),
        toolCalls: streamedToolCalls,
        modelUsed: resolvedModel,
        latencyMs: Date.now() - start,
      };
    }

    const data = (await res.json()) as {
      model?: string;
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: {
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
      }[];
    };
    const msg = data.choices?.[0]?.message;
    const text = msg?.content?.trim() ?? '';
    const parsedToolCalls: ParsedOpenAiToolCall[] = [];

    for (const tc of msg?.tool_calls ?? []) {
      const fnName = tc.function?.name?.trim();
      if (!fnName) continue;
      let parsedArgs: Record<string, unknown> = {};
      if (tc.function?.arguments) {
        try {
          const raw = JSON.parse(tc.function.arguments) as unknown;
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            parsedArgs = raw as Record<string, unknown>;
          }
        } catch {
          parsedArgs = {};
        }
      }
      parsedToolCalls.push({
        id: tc.id || `tc-${parsedToolCalls.length + 1}`,
        name: fnName,
        args: parsedArgs,
      });
    }

    if (!text && parsedToolCalls.length === 0) {
      if (managedByStore) {
        throw new LlmGatewayError({
          message: 'LLM 网关返回空响应（未包含文本或工具调用）。',
          providerName: provider.name,
          baseUrl,
          model: modelName,
        });
      }
      return null;
    }
    return {
      content: text,
      toolCalls: parsedToolCalls,
      modelUsed: data.model || modelName,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (err instanceof LlmGatewayError) throw err;
    if (managedByStore) {
      throw new LlmGatewayError({
        message: `无法连接 LLM 网关 (${baseUrl})：${err instanceof Error ? err.message : String(err)}`,
        providerName: provider.name,
        baseUrl,
        model: modelName,
      });
    }
    return null;
  } finally {
    options.signal?.removeEventListener('abort', onExternalAbort);
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(wallTimer);
  }
}

export function stitchContinuationText(
  prefix: string,
  rawAddition: string,
): { merged: string; delta: string; cutPrefixAt: number } {
  if (!prefix) {
    return { merged: rawAddition, delta: rawAddition, cutPrefixAt: 0 };
  }
  let addition = rawAddition.replace(/^```[a-zA-Z0-9_-]*\r?\n/, '');
  if (addition.endsWith('\n```')) {
    addition = addition.slice(0, -4);
  }
  if (!addition) {
    return { merged: prefix, delta: '', cutPrefixAt: prefix.length };
  }

  // 1. Exact suffix-of-prefix == prefix-of-addition overlap
  const maxOverlap = Math.min(prefix.length, addition.length, 600);
  for (let k = maxOverlap; k >= 3; k -= 1) {
    if (prefix.endsWith(addition.slice(0, k))) {
      const delta = addition.slice(k);
      return { merged: prefix + delta, delta, cutPrefixAt: prefix.length };
    }
  }

  // 2. Model backed up slightly to rewrite an unfinished line/statement near the tail of `prefix`
  const trimmedStart = addition.replace(/^[ \t]+/, '');
  if (trimmedStart.length >= 14) {
    const probe = trimmedStart.slice(0, Math.min(28, trimmedStart.length));
    const tailWindow = prefix.slice(-300);
    const idxInWindow = tailWindow.lastIndexOf(probe);
    if (idxInWindow >= 0) {
      const cutAt = prefix.length - tailWindow.length + idxInWindow;
      const merged = prefix.slice(0, cutAt) + trimmedStart;
      const delta = merged.length > prefix.length ? merged.slice(prefix.length) : '';
      return { merged, delta, cutPrefixAt: cutAt };
    }
  }

  return { merged: prefix + addition, delta: addition, cutPrefixAt: prefix.length };
}

async function streamWithCheckpointContinuation(
  provider: LlmProviderConfig | undefined,
  baseSystemPrompt: string,
  baseUserPrompt: string,
  options: {
    store: WorkspaceStore;
    maxTokens: number;
    reasoningEffort?: 'low' | 'medium' | 'high';
    resumePrefix?: string;
    isDocumentComplete: (text: string) => boolean;
    maxContinuations?: number;
    signal?: AbortSignal;
    onThinkingDelta?: (delta: string, accumulatedThinking: string) => void;
    onStreamDelta?: (delta: string, accumulated: string) => void;
    onContinuationNotice?: (currentChars: number, attempt: number) => void;
  },
): Promise<OpenAiChatResponse | null> {
  const maxContinuations = options.maxContinuations ?? 3;
  let combined = options.resumePrefix ?? '';
  let combinedThinking = '';
  let lastModelUsed = provider?.defaultModel || 'auto/glm-5.3-flash';
  let totalLatencyMs = 0;

  let continuationsUsed = 0;
  let isContinuationTurn = combined.trim().length >= 200;
  if (!isContinuationTurn) {
    combined = '';
  }

  while (true) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const baseBeforeSegment = combined;
    let seamResolved = !isContinuationTurn;
    let effectivePrefix = baseBeforeSegment;
    let segSkipChars = 0;

    if (isContinuationTurn) {
      continuationsUsed += 1;
      options.onContinuationNotice?.(baseBeforeSegment.length, continuationsUsed);
    }

    const sysPrompt = isContinuationTurn
      ? `${baseSystemPrompt}\n\n【断点续写模式 / CHECKPOINT CONTINUATION】\n前序流式输出在末尾处中断。你必须严格紧接已生成内容的最后一个字符继续输出剩余部分，直至完整闭合全文！\n硬性禁止事项：严禁从头重写、严禁大段重复前文、严禁添加 \`\`\` 代码块围栏、严禁输出任何解释说明文字。`
      : baseSystemPrompt;

    const usrPrompt = isContinuationTurn
      ? [
          baseUserPrompt,
          '',
          `=== 已生成前序内容（共 ${baseBeforeSegment.length} 字符，请勿从头重写，直接从末尾断点处紧接续写剩余部分直至全文完整结束） ===`,
          baseBeforeSegment.slice(-24000),
          '=== 前序末尾断点锚点（请紧接此片段最后一个字符继续往下写） ===',
          baseBeforeSegment.slice(-180),
        ].join('\n')
      : baseUserPrompt;

    try {
      const segRes = await callOpenAiCompatibleChat(
        provider,
        [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: usrPrompt },
        ],
        {
          store: options.store,
          maxTokens: options.maxTokens,
          preserveWhitespace: isContinuationTurn,
          ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.onThinkingDelta
            ? {
                onThinkingDelta: (tDelta) => {
                  combinedThinking += tDelta;
                  options.onThinkingDelta?.(tDelta, combinedThinking);
                },
              }
            : {}),
          onStreamDelta: (cDelta, segAcc) => {
            if (!isContinuationTurn) {
              combined = segAcc;
              options.onStreamDelta?.(cDelta, combined);
              return;
            }
            if (!seamResolved) {
              if (segAcc.length < 120) {
                return;
              }
              const stitched = stitchContinuationText(baseBeforeSegment, segAcc);
              effectivePrefix = baseBeforeSegment.slice(0, stitched.cutPrefixAt);
              segSkipChars = segAcc.length - (stitched.merged.length - effectivePrefix.length);
              seamResolved = true;
              combined = stitched.merged;
              if (stitched.delta) {
                options.onStreamDelta?.(stitched.delta, combined);
              }
              return;
            }
            const cleanAddition = segAcc.slice(Math.max(0, segSkipChars));
            combined = effectivePrefix + cleanAddition;
            options.onStreamDelta?.(cDelta, combined);
          },
        },
      );

      if (!segRes) {
        return combined
          ? {
              content: combined,
              ...(combinedThinking ? { thinking: combinedThinking } : {}),
              toolCalls: [],
              modelUsed: lastModelUsed,
              latencyMs: totalLatencyMs,
            }
          : null;
      }

      lastModelUsed = segRes.modelUsed || lastModelUsed;
      totalLatencyMs += segRes.latencyMs;

      if (isContinuationTurn) {
        const finalStitched = stitchContinuationText(baseBeforeSegment, segRes.content);
        const prevLen = combined.length;
        combined = finalStitched.merged;
        if (!seamResolved && finalStitched.delta) {
          options.onStreamDelta?.(finalStitched.delta, combined);
        } else if (combined.length > prevLen) {
          options.onStreamDelta?.(combined.slice(prevLen), combined);
        }
        // Guard against infinite loop if model produced negligible new content
        if (combined.length - baseBeforeSegment.length < 25) {
          break;
        }
      } else {
        combined = segRes.content;
      }

      if (options.isDocumentComplete(combined) || continuationsUsed >= maxContinuations) {
        break;
      }
      if (combined.trim().length < 500) {
        break;
      }
      // Document ended before closing sentinel (e.g. token cap reached before </html> or ## 9.) — continue seamlessly!
      isContinuationTurn = true;
    } catch (err) {
      if (
        options.signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const gainedInThisSegment = combined.length - baseBeforeSegment.length;
      const canRecoverMidStream =
        combined.trim().length >= 400 &&
        continuationsUsed < maxContinuations &&
        (!isContinuationTurn || gainedInThisSegment >= 100);

      if (!canRecoverMidStream) {
        throw err;
      }
      // Brief backoff then auto-continue from the partial checkpoint in `combined`
      await new Promise((resolve) => setTimeout(resolve, 600));
      isContinuationTurn = true;
    }
  }

  return {
    content: combined.trim(),
    ...(combinedThinking.trim() ? { thinking: combinedThinking.trim() } : {}),
    toolCalls: [],
    modelUsed: lastModelUsed,
    latencyMs: totalLatencyMs,
  };
}

export async function testLlmGatewayConnection(
  provider: LlmProviderConfig,
): Promise<LlmPingResult> {
  const start = Date.now();
  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  try {
    const modelsRes = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${provider.apiKey || 'magpie'}` },
      signal: AbortSignal.timeout(6000),
    });
    let discoveredModels = provider.availableModels;
    if (modelsRes.ok) {
      const modelsJson = (await modelsRes.json()) as { data?: { id: string }[] };
      if (Array.isArray(modelsJson.data) && modelsJson.data.length > 0) {
        discoveredModels = modelsJson.data.map((m) => m.id).slice(0, 25);
      }
    }

    const chatRes = await callOpenAiCompatibleChat(
      provider,
      [
        {
          role: 'system',
          content: 'You are the Ontology Plus AI engine. Reply in one concise sentence.',
        },
        {
          role: 'user',
          content: '请确认本体建模智能体连接状态正常（控制在25字以内）。',
        },
      ],
      { timeoutMs: 6000 },
    );

    if (chatRes && chatRes.content) {
      return {
        ok: true,
        providerName: provider.name,
        baseUrl: provider.baseUrl,
        model: chatRes.modelUsed,
        latencyMs: Date.now() - start,
        discoveredModels,
        sampleReply: chatRes.content,
      };
    }

    if (modelsRes.ok) {
      return {
        ok: true,
        providerName: provider.name,
        baseUrl: provider.baseUrl,
        model: provider.defaultModel,
        latencyMs: Date.now() - start,
        discoveredModels,
        sampleReply: `网关已在线（发现 ${discoveredModels.length} 个模型），默认绑定 ${provider.defaultModel}`,
      };
    }

    return {
      ok: false,
      providerName: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.defaultModel,
      latencyMs: Date.now() - start,
      discoveredModels,
      errorMessage: `HTTP ${modelsRes.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      providerName: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.defaultModel,
      latencyMs: Date.now() - start,
      discoveredModels: provider.availableModels,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── 2. Requirement Grilling & Canonical 9-Part SRS Synthesis ─────────────────

function findRequirementSessionOptional(
  store: WorkspaceStore,
  sessionId: string,
): RequirementSession | undefined {
  if (typeof store.getRequirementSession === 'function') {
    const direct = store.getRequirementSession(sessionId);
    if (direct) return direct;
  }
  const projects = store.listProjects();
  return projects
    .flatMap((p) => store.listRequirementSessions(p.id))
    .find((s) => s.id === sessionId);
}

function findRequirementSession(store: WorkspaceStore, sessionId: string): RequirementSession {
  const found = findRequirementSessionOptional(store, sessionId);
  if (!found) throw new Error(`Requirement session not found: ${sessionId}`);
  return found;
}

const AUTO_TAG_RE = /\[(?:AI自动补全|AI Auto-Completed)\]/i;
const CONFIRMED_TAG_RE = /\[(?:已确认|Confirmed)\]/i;
const PENDING_TAG_RE = /\[(?:待确认|Pending)\]/i;
const BILINGUAL_ASSERTIVE_RE =
  /确认|同意|采用|必须|要求|超过|大于|小于|禁止|\d+%|\d+万|\d+天|\b(?:confirm|confirmed|agree|adopt|must|shall|require|exceed|over|under|forbid|prohibit)\b|\$\d+|\d+\s*(?:days?|hours?|mins?|k\b|m\b)/i;

export async function runRequirementGrillingTurn(
  store: WorkspaceStore,
  input: {
    sessionId: string;
    userMessage: string;
    locale?: AgentLocale | string;
  },
): Promise<{ session: RequirementSession; providerUsed: string }> {
  const target = findRequirementSession(store, input.sessionId);
  const project = store.getProject(target.projectId);
  const locale = resolveEffectiveLocale(store, input.locale, input.userMessage);

  const userMsg: RequirementMessage = {
    id: `msg-${Date.now()}-u`,
    role: 'user',
    content: input.userMessage,
    timestamp: new Date().toISOString(),
  };
  store.appendRequirementMessage(target.id, userMsg);

  const activeProvider = resolvePreferredProvider(store, target.projectId);

  const systemContent =
    locale === 'en-US'
      ? [
          `You are the Ontology Plus Requirement Grilling Agent for project "${project?.name ?? target.projectId}" (domain: ${project?.domain ?? 'Enterprise Domain'}).`,
          'Follow the Class-A/B progressive grilling strategy in English:',
          '- Tag Class-A standard engineering defaults with [AI Auto-Completed] (audit fields, pagination, idempotency keys) without bothering the user;',
          '- Tag Class-B business boundary rules with [Confirmed] (when user stated explicit rules/thresholds) or [Pending] (proposing 1-2 crisp disambiguation questions).',
          'Also highlight discovered M1 aggregates, M2 behaviors, and M3 business rules (within 200 words).',
        ].join('\n')
      : [
          `你是 Ontology Plus 的需求探索追问专家（Requirement Grilling Agent），当前服务工程：${project?.name ?? target.projectId}（领域：${project?.domain ?? '企业业务域'}）。`,
          '请遵循 A/B 分级追问策略：',
          '- A 类常规默认项标注为 [AI自动补全]（如审计字段、分页、幂等流水号），直接给出默认方案无需反复打扰用户；',
          '- B 类核心业务边界分歧标注为 [已确认]（针对用户已明确的阈值/规则）或 [待确认]（提出 1~2 个消除歧义的关键追问）。',
          '请同时指出提炼出的 M1 聚合根、M2 业务行为、M3 业务规则（控制在 200 字以内）。',
        ].join('\n');

  const llmRes = await callOpenAiCompatibleChat(
    activeProvider,
    [
      {
        role: 'system',
        content: systemContent,
      },
      ...target.messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: input.userMessage },
    ],
    { store },
  );

  const trimmedMsg = input.userMessage.trim();
  const llmText = llmRes?.content ?? '';

  const llmAutoLines = llmText
    .split('\n')
    .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
    .filter((l) => AUTO_TAG_RE.test(l));
  const llmDecisionLines = llmText
    .split('\n')
    .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
    .filter((l) => CONFIRMED_TAG_RE.test(l) || PENDING_TAG_RE.test(l));

  const newRuleHint = `RULE-0${target.discoveredRules.length + 1}: ${trimmedMsg.slice(0, 56)}`;
  const autoDefaultDecision =
    llmAutoLines[0] ||
    pickLocaleText(
      locale,
      `[AI自动补全] 默认为「${project?.domain ?? '当前领域'}」单据自动注入 createdAt/updatedAt 审计字段、乐观锁版本号及标准分页参数 (pageSize=20)`,
      `[AI Auto-Completed] Automatically include createdAt/updatedAt audit timestamps, optimistic lock version, and default pagination (pageSize=20) for "${project?.domain ?? 'domain'}" records`,
    );
  const confirmedOrPendingDecision =
    llmDecisionLines[0] ||
    (BILINGUAL_ASSERTIVE_RE.test(trimmedMsg)
      ? `${pickLocaleText(locale, '[已确认]', '[Confirmed]')} ${trimmedMsg.slice(0, 76)}`
      : pickLocaleText(
          locale,
          `[待确认] 异常条件触发时采用前置同步拦截还是异步人工复核：${trimmedMsg.slice(0, 42)}`,
          `[Pending] When an exception occurs, block synchronously via M2 precondition or route to M6 manual review: ${trimmedMsg.slice(0, 48)}`,
        ));

  const nextResolvedDecisions = [...target.resolvedDecisions];
  if (!nextResolvedDecisions.some((d) => AUTO_TAG_RE.test(d))) {
    nextResolvedDecisions.push(autoDefaultDecision);
  }
  if (!nextResolvedDecisions.includes(confirmedOrPendingDecision)) {
    nextResolvedDecisions.push(confirmedOrPendingDecision);
  }

  const openQuestion =
    llmDecisionLines.find((l) => PENDING_TAG_RE.test(l)) ||
    pickLocaleText(
      locale,
      `[待确认] 该规则（${newRuleHint}）违背时是直接同步前置拦截（M2 Precondition）还是进入 M6 异常复核分支？`,
      `[Pending] If (${newRuleHint}) fails, reject immediately via M2 Precondition or route into an M6 exception flow?`,
    );

  const fallbackReply =
    locale === 'en-US'
      ? [
          `Completed Class-A/B progressive requirement convergence:`,
          `- **Candidate Rule**: \`${newRuleHint}\``,
          `- **Class-A Default \`[AI Auto-Completed]\`**: ${autoDefaultDecision.replace(AUTO_TAG_RE, '').trim()}`,
          `- **Class-B Boundary**: \`${confirmedOrPendingDecision}\``,
          `- **Open Question \`[Pending]\`**: ${openQuestion.replace(PENDING_TAG_RE, '').trim()}`,
        ].join('\n')
      : [
          `已完成 A/B 分级需求收敛分析并同步至当前会话：`,
          `- **候选规则沉淀**：\`${newRuleHint}\``,
          `- **A 类常规项 \`[AI自动补全]\`**：${autoDefaultDecision.replace(AUTO_TAG_RE, '').trim()}`,
          `- **B 类核心边界**：\`${confirmedOrPendingDecision}\``,
          `- **待决追问 \`[待确认]\`**：${openQuestion.replace(PENDING_TAG_RE, '').trim()}`,
        ].join('\n');

  const assistantMsg: RequirementMessage = {
    id: `msg-${Date.now()}-a`,
    role: 'assistant',
    content: llmRes?.content || fallbackReply,
    timestamp: new Date().toISOString(),
    extractedHints: {
      rules: [newRuleHint],
      openQuestions: [openQuestion],
    },
  };

  const updated = store.appendRequirementMessage(target.id, assistantMsg, {
    discoveredRules: [...target.discoveredRules, newRuleHint],
    resolvedDecisions: nextResolvedDecisions,
  });

  saveCheckpointSafe(store, target.id, 'REQUIREMENT_GRILLING', {
    sessionId: target.id,
    projectId: target.projectId,
    rulesCount: updated.discoveredRules.length,
    decisionsCount: updated.resolvedDecisions.length,
  });

  return {
    session: updated,
    providerUsed: llmRes?.modelUsed || activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
}

export type SrsSynthesisProgressPhase =
  | 'CONTEXT'
  | 'MODEL_ALIGN'
  | 'GENERATING'
  | 'VALIDATING'
  | 'DONE';

export interface SrsSynthesisProgressEvent {
  phase: SrsSynthesisProgressPhase;
  step: 1 | 2 | 3 | 4;
  messageZh: string;
  messageEn: string;
  currentChapter?: string;
  completedChapters?: number;
  thinkingDelta?: string;
  thinkingText?: string;
  thinkingChars?: number;
  contentDelta?: string;
  streamedText?: string;
  streamedChars?: number;
  previewTail?: string;
  draftDocId?: string;
  providerModel?: string;
}


function sanitizeAndValidatePrototypeHtml(
  rawCandidate: string,
  domain: string,
): string | null {
  let html = stripMarkdownFence(rawCandidate);
  const docTypeIdx = html.search(/<!doctype\s+html/i);
  const htmlTagIdx = html.search(/<html[\s>]/i);
  const startIdx = docTypeIdx >= 0 ? docTypeIdx : htmlTagIdx;
  if (startIdx >= 0) {
    html = html.slice(startIdx);
  }
  const closeHtmlIdx = html.toLowerCase().lastIndexOf('</html>');
  if (closeHtmlIdx >= 0) {
    html = html.slice(0, closeHtmlIdx + '</html>'.length);
  }
  if (!html.includes('data-screen-id')) {
    return null;
  }

  // Enforce zero blocking browser dialogs per AGENTS.md contract
  html = html
    .replace(/\bwindow\.(?:alert|confirm|prompt)\s*\(/g, 'console.info(')
    .replace(/(?<![.\w])(?:alert|confirm|prompt)\s*\(/g, 'console.info(');

  // Deduplicate semantic anchor IDs if LLM repeated an ID
  for (const attr of ['data-screen-id', 'data-element-id', 'data-event-id']) {
    const seen = new Set<string>();
    const re = new RegExp(`(${attr}\\s*=\\s*["'])([^"']+)(["'])`, 'gi');
    html = html.replace(re, (_m, p1: string, idVal: string, p3: string) => {
      let nextId = idVal.trim();
      let counter = 2;
      while (seen.has(nextId)) {
        nextId = `${idVal.trim()}-${counter++}`;
      }
      seen.add(nextId);
      return `${p1}${nextId}${p3}`;
    });
  }

  // Strip dangling data-navigate-to references pointing outside declared screens
  const declaredScreens = new Set<string>();
  const screenRe = /data-screen-id\s*=\s*["']([^"']+)["']/gi;
  let sm: RegExpExecArray | null;
  while ((sm = screenRe.exec(html)) !== null) {
    declaredScreens.add(sm[1].trim());
  }
  html = html.replace(
    /\s+data-navigate-to\s*=\s*["']([^"']+)["']/gi,
    (full, target: string) => (declaredScreens.has(target.trim()) ? full : ''),
  );

  try {
    const extracted = extractMuFromPrototypeHtml(html, domain);
    const totalElements = extracted.screens.reduce((acc, s) => acc + s.elements.length, 0);
    if (extracted.screens.length < 2 || totalElements < 3) {
      return null;
    }
    return html;
  } catch {
    return null;
  }
}

export async function generatePrototypeFromDoc(
  store: WorkspaceStore,
  input: {
    projectId: string;
    docId?: string;
    prompt?: string;
    resumeFromText?: string;
    locale?: AgentLocale | string;
    signal?: AbortSignal;
    onProgress?: (event: SrsSynthesisProgressEvent) => void;
  },
): Promise<PrototypeGenerationResult> {
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const project = store.getProject(input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);

  const docs = store.listRequirementDocs(input.projectId);
  const doc = input.docId ? docs.find((d) => d.id === input.docId) : docs[0];
  const mergedReqCtx = collectMergedRequirementContext(store, input.projectId);
  const locale = resolveEffectiveLocale(
    store,
    input.locale,
    input.prompt || doc?.content || mergedReqCtx.userMessagesSummary || project.description,
  );
  const activeProvider = resolvePreferredProvider(store, input.projectId);

  let htmlContent = buildSemanticPrototypeHtmlForProject(project, doc, input.prompt);
  let modelUsed = activeProvider?.defaultModel || 'auto/glm-5.3-flash';
  let lastThinkingText = '';
  const resumeProtoPrefix =
    input.resumeFromText && input.resumeFromText.trim().length >= 200
      ? input.resumeFromText
      : '';

  if (!resumeProtoPrefix) {
    input.onProgress?.({
      phase: 'CONTEXT',
      step: 1,
      messageZh: '正在读取需求规格说明书与 M1/M2/M3 领域绑定约束…',
      messageEn: 'Loading SRS specification and M1/M2/M3 domain binding constraints…',
      streamedChars: 0,
      providerModel: modelUsed,
    });
  }

  const isContractProject = /合同|contract|clm/i.test(`${project.name} ${project.domain}`);
  const hasStaleContractTemplate =
    !isContractProject &&
    Boolean(
      project.suite.M1?.aggregates.some(
        (a) => a.name === 'Contract' && a.uiBindings?.includes('SCR-CONTRACT-LIST'),
      ),
    );

  if (!resumeProtoPrefix) {
    input.onProgress?.({
      phase: 'MODEL_ALIGN',
      step: 2,
      messageZh: '正在规划业务屏幕路由（LIST / FORM / DETAIL / DASHBOARD）与 MU 语义锚点…',
      messageEn: 'Planning screen routes (LIST / FORM / DETAIL / DASHBOARD) and MU semantic anchors…',
      streamedChars: 0,
      providerModel: modelUsed,
    });
  }

  if (isMockLlmActive(store)) {
    input.onProgress?.({
      phase: 'GENERATING',
      step: 3,
      messageZh: '正在流式生成交互式 HTML5 原型与 MU 语义锚点…',
      messageEn: 'Streaming interactive HTML5 prototype with MU semantic anchors…',
      contentDelta: htmlContent,
      streamedText: htmlContent,
      streamedChars: htmlContent.length,
      previewTail: htmlContent.slice(-1600),
      providerModel: 'mock-deterministic',
    });
  } else {
    const m1Summary = hasStaleContractTemplate
      ? ''
      : (project.suite.M1?.aggregates ?? [])
          .map(
            (a) =>
              `${a.name}(${a.alias}): [${a.attributes.map((at) => `${at.name}:${at.type}`).join(', ')}]`,
          )
          .join('; ');
    const m2Summary = hasStaleContractTemplate
      ? ''
      : (project.suite.M2?.behaviors ?? [])
          .map((b) => `${b.id}:${b.name}(${b.behaviorType})`)
          .join(', ');
    const m3Summary = hasStaleContractTemplate
      ? ''
      : (project.suite.M3?.rules ?? [])
          .map((r) => `${r.id}:${r.alias}`)
          .join(', ');

    const protoSystemPrompt =
      locale === 'en-US'
        ? [
            'You are the Principal UI Prototype Engineer of Ontology Plus.',
            'Generate a complete, self-contained, interactive single-file HTML5 prototype (`<!DOCTYPE html>...</html>`) tailored strictly to the project domain and SRS.',
            'MANDATORY SEMANTIC ANCHOR CONTRACT (for deterministic MU model extraction):',
            '1. Define 3–4 `<section>` screens with `data-screen-id="SCR-..."`, `data-screen-name="..."`, `data-screen-type="LIST|FORM|DETAIL|DASHBOARD|APPROVAL"`, `data-route="/..."`, and `data-role-refs="ROLE-01"`.',
            '2. Every interactive input/select/table/button MUST carry unique `data-element-id="EL-..."`, `data-element-name="..."`, `data-element-label="..."`, `data-element-type="INPUT|SELECT|NUMBER|DATE_PICKER|TABLE|BUTTON|BADGE"`.',
            '3. Form/filter fields MUST carry `data-binding="AggregateName.fieldName"` using PascalCase domain aggregate names authentic to the project (NEVER use `Contract` unless the project is actually contract management).',
            '4. Action buttons MUST carry `data-event-id="UIE-..."`, `data-event-name="..."`, `data-behavior-ref="BHV-..."` (and optional `data-validate-ref="RULE-..."` or `data-navigate-to="SCR-..."`).',
            '5. If the User Prototype Prompt specifies Visual Reference DNA (preferred canvas/surface background hex, primary CTA/accent hex, dark/light mode, border-radius, typography, liked reasons) or Interaction/Motion Schematics (e.g., slide-over drawer vs centered modal vs split detail, filter chips, count-up KPIs, accordion, stepper, toast, skeleton, hover-lift), strictly implement those exact visual tokens and interactive CSS/JS behaviors! Only fall back to default warm-paper CSS (`#f6f4ef` background, `#ffffff` cards, `#4c50c4` accent) when no visual reference palette is specified. NEVER call `window.alert`, `window.confirm`, or `window.prompt`.',
            '6. Output raw HTML only without markdown fences.',
            '7. Keep internal reasoning ultra-brief (2 sentences max) and immediately stream raw HTML up to `</html>`.',
          ].join('\n')
        : [
            '你是 Ontology Plus 的首席交互原型架构师。',
            '请严格根据当前项目领域、SRS 需求规格说明书与会话决策，生成一份完整、可直接交互的单文件 HTML5 原型（`<!DOCTYPE html>...</html>`）。',
            '【MU 确定性语义锚点硬性契约】：',
            '1. 包含 3~4 个业务屏幕 `<section>`，每个必须携带 `data-screen-id="SCR-..."`、`data-screen-name="..."`、`data-screen-type="LIST|FORM|DETAIL|DASHBOARD|APPROVAL"`、`data-route="/..."`、`data-role-refs="ROLE-01"`。',
            '2. 所有输入框、下拉框、表格、按钮必须携带唯一的 `data-element-id="EL-..."`、`data-element-name="..."`、`data-element-label="..."`、`data-element-type="INPUT|SELECT|NUMBER|DATE_PICKER|TABLE|BUTTON|BADGE"`。',
            '3. 表单与筛选控件必须携带贴合真实业务领域的 `data-binding="AggregateName.fieldName"`（PascalCase 聚合名 + camelCase 属性名；若非合同项目，严禁出现 Contract 字样！例如咖啡店应为 Order.cupSize / Product.recipeId / Member.points）。',
            '4. 操作按钮必须携带 `data-event-id="UIE-..."`、`data-event-name="..."`、`data-behavior-ref="BHV-..."`（可按需配 `data-validate-ref="RULE-..."`、`data-navigate-to="SCR-..."`）。',
            '5. 若下方 User Prototype Prompt 中指定了「视觉参考与喜欢原因」（如指定的背景底色 Hex、主按钮强调色 Hex、深色/浅色模式、圆角与留白偏好）或「交互与动效示意图诉求」（如右侧滑出抽屉/居中弹窗/同屏双栏、胶囊筛选、数字跳动、手风琴展开、分步引导条、轻量状态横幅、骨架屏与行悬浮微抬升），必须严格兑现用户选定的配色、排版与原生 CSS/JS 交互动效！仅在用户未指定视觉参考色板时默认采用温润纸感（`#f6f4ef` 背景、`#ffffff` 卡片、`#4c50c4` 强调色）。严禁使用 `window.alert` / `confirm` / `prompt`！',
            '6. 直接输出纯 HTML 源码，不要包裹 ```html 代码块。',
            '7. 内部思考请极度精炼（不超过 2 句话），立即开始流式输出完整 HTML 直至闭合 `</html>`！',
          ].join('\n');

    input.onProgress?.({
      phase: 'GENERATING',
      step: 3,
      messageZh: resumeProtoPrefix
        ? `已恢复前序 ${resumeProtoPrefix.length.toLocaleString()} 字符 HTML，正在连接大模型 (${modelUsed}) 从断点继续续写…`
        : `正在连接大模型 (${modelUsed}) 流式编写交互式 HTML5 原型…`,
      messageEn: resumeProtoPrefix
        ? `Restored ${resumeProtoPrefix.length.toLocaleString()} HTML chars; resuming prototype stream from checkpoint via ${modelUsed}…`
        : `Streaming interactive HTML5 prototype via ${modelUsed}…`,
      streamedChars: resumeProtoPrefix.length,
      ...(resumeProtoPrefix
        ? { streamedText: resumeProtoPrefix, previewTail: resumeProtoPrefix.slice(-1600) }
        : {}),
      providerModel: modelUsed,
    });

    const protoUserPrompt = [
      `Project: ${project.name} (Domain: ${project.domain})`,
      input.prompt ? `User Prototype Prompt: ${input.prompt}` : '',
      m1Summary ? `Existing M1 Aggregates: ${m1Summary}` : '',
      m2Summary ? `Existing M2 Behaviors: ${m2Summary}` : '',
      m3Summary ? `Existing M3 Rules: ${m3Summary}` : '',
      doc ? `\n--- Requirement Specification (${doc.title}) ---\n${doc.content.slice(0, 10000)}` : '',
      !doc && mergedReqCtx.transcriptText
        ? `\n--- Requirement Session Context ---\n${mergedReqCtx.transcriptText.slice(0, 6000)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    let lastProtoEmitAt = 0;
    let lastProtoThinkEmitAt = 0;
    let pendingProtoDelta = '';
    let pendingProtoThinking = '';

    const llmProtoRes = await streamWithCheckpointContinuation(
      activeProvider,
      protoSystemPrompt,
      protoUserPrompt,
      {
        store,
        maxTokens: 32768,
        reasoningEffort: 'low',
        ...(resumeProtoPrefix ? { resumePrefix: resumeProtoPrefix } : {}),
        isDocumentComplete: (text) => /<\/html\s*>/i.test(text),
        ...(input.signal ? { signal: input.signal } : {}),
        onContinuationNotice: (currentChars, attempt) => {
          input.onProgress?.({
            phase: 'GENERATING',
            step: 3,
            messageZh: `正在从断点（已输出 ${currentChars.toLocaleString()} 字符）无缝续写剩余 HTML 代码（第 ${attempt} 段续传）…`,
            messageEn: `Continuing HTML5 prototype stream seamlessly from ${currentChars.toLocaleString()} chars (continuation #${attempt})…`,
            streamedChars: currentChars,
            providerModel: modelUsed,
          });
        },
        ...(input.onProgress
          ? {
              onThinkingDelta: (tDelta, accThinking) => {
                lastThinkingText = accThinking;
                pendingProtoThinking += tDelta;
                const now = Date.now();
                if (now - lastProtoThinkEmitAt < 150) return;
                lastProtoThinkEmitAt = now;
                const flushed = pendingProtoThinking;
                pendingProtoThinking = '';
                input.onProgress?.({
                  phase: 'GENERATING',
                  step: 3,
                  messageZh: '大模型正在构思交互屏幕结构与语义锚点…',
                  messageEn: 'Model designing screen layout & MU anchors…',
                  thinkingDelta: flushed,
                  thinkingText: accThinking,
                  thinkingChars: accThinking.length,
                  providerModel: modelUsed,
                });
              },
              onStreamDelta: (cDelta, accumulated) => {
                pendingProtoDelta += cDelta;
                const now = Date.now();
                if (now - lastProtoEmitAt < 100) return;
                lastProtoEmitAt = now;
                const flushed = pendingProtoDelta;
                pendingProtoDelta = '';
                const screenMatches = [...accumulated.matchAll(/data-screen-id="([^"]+)"/g)];
                const latestScreen = screenMatches[screenMatches.length - 1]?.[1];
                input.onProgress?.({
                  phase: 'GENERATING',
                  step: 3,
                  messageZh: latestScreen
                    ? `正在流式编写屏幕「${latestScreen}」（已输出 ${accumulated.length.toLocaleString()} 字符）…`
                    : `正在流式编写 HTML5 原型代码（已输出 ${accumulated.length.toLocaleString()} 字符）…`,
                  messageEn: latestScreen
                    ? `Streaming screen "${latestScreen}" (${accumulated.length.toLocaleString()} chars)…`
                    : `Streaming HTML5 prototype (${accumulated.length.toLocaleString()} chars)…`,
                  ...(latestScreen ? { currentChapter: latestScreen } : {}),
                  completedChapters: screenMatches.length,
                  ...(lastThinkingText
                    ? { thinkingText: lastThinkingText, thinkingChars: lastThinkingText.length }
                    : {}),
                  contentDelta: flushed,
                  streamedText: accumulated,
                  streamedChars: accumulated.length,
                  previewTail: accumulated.slice(-1600),
                  providerModel: modelUsed,
                });
              },
            }
          : {}),
      },
    );

    if (input.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (llmProtoRes?.content) {
      modelUsed = llmProtoRes.modelUsed || modelUsed;
      const validated = sanitizeAndValidatePrototypeHtml(llmProtoRes.content, project.domain);
      if (validated) {
        htmlContent = validated;
      }
    }
  }

  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  input.onProgress?.({
    phase: 'VALIDATING',
    step: 4,
    messageZh: '正在提取 MU 屏幕控件锚点并对齐本体绑定…',
    messageEn: 'Extracting MU screen anchors and aligning ontology bindings…',
    ...(lastThinkingText
      ? { thinkingText: lastThinkingText, thinkingChars: lastThinkingText.length }
      : {}),
    streamedText: htmlContent,
    streamedChars: htmlContent.length,
    previewTail: htmlContent.slice(-1600),
    providerModel: modelUsed,
  });

  const existingProtos = store.listPrototypes(input.projectId);
  const version = `v5.${existingProtos.length}`;
  const protoTitle =
    locale === 'en-US'
      ? `${project.name} · Interactive Prototype (prototype.html)`
      : `${project.name} · 语义交互原型 (界面原型.html)`;

  // Creating a prototype produces an immutable PrototypeRevision and NEVER mutates suite.MU (ADR 0010).
  const created = store.createPrototype(input.projectId, {
    name: protoTitle,
    version,
    htmlContent,
    instruction: input.prompt,
    source: 'GENERATED',
  });

  saveCheckpointSafe(store, `proto-${input.projectId}`, 'PROTOTYPE_GENERATION', {
    projectId: input.projectId,
    prototypeId: created.prototype.id,
    revisionId: created.revision.id,
    screens: created.prototype.extractedScreenCount,
  });

  return {
    prototype: created.prototype,
    project: created.project,
    prototypes: store.listPrototypes(input.projectId),
    providerUsed: modelUsed,
  };
}

export function formatSelectionsForPrompt(
  selections: PrototypeRefinementSelection[],
  locale: AgentLocale,
): string {
  if (selections.length === 0) return '';
  const header =
    locale === 'en-US'
      ? '--- Targeted Visual Selections & Annotations ---'
      : '--- 用户在界面原型上框选/点选的目标区域与批注 ---';
  const blocks = selections.map((sel, idx) => {
    const anchors = [
      sel.screenId ? `screen=${sel.screenId}` : '',
      sel.elementId ? `element=${sel.elementId}` : '',
      sel.binding ? `binding=${sel.binding}` : '',
      sel.eventId ? `event=${sel.eventId}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    const lines = [
      `#${idx + 1} [${sel.kind}] selector="${sel.cssSelector}"${sel.tagName ? ` tag=<${sel.tagName}>` : ''}${sel.label ? ` label="${sel.label}"` : ''}${anchors ? ` (${anchors})` : ''}`,
    ];
    if (sel.note?.trim()) {
      lines.push(`   Note: ${sel.note.trim()}`);
    }
    if (sel.matchedElementsSummary && sel.matchedElementsSummary.length > 0) {
      lines.push(`   Box-selected controls: ${sel.matchedElementsSummary.join(' | ')}`);
    }
    if (sel.htmlSnippet?.trim()) {
      lines.push(`   HTML snippet: ${sel.htmlSnippet.trim().slice(0, 600)}`);
    }
    return lines.join('\n');
  });
  return `${header}\n${blocks.join('\n')}\n\n`;
}

function extractExecutableTsFromLlmResponse(raw: string): {
  code: string | null;
  explanation: string;
} {
  const codeBlockMatch = raw.match(/```(?:ts|typescript|tsx|js|javascript)\s*\r?\n([\s\S]*?)\r?\n```/i);
  if (codeBlockMatch && codeBlockMatch[1].trim().length > 24) {
    const code = codeBlockMatch[1].trim();
    const explanation = raw.replace(codeBlockMatch[0], '').trim();
    return { code, explanation };
  }
  const stripped = stripMarkdownFence(raw);
  if (
    stripped.includes('export ') &&
    (stripped.includes('function ') || stripped.includes('interface ') || stripped.includes('class '))
  ) {
    return { code: stripped, explanation: '' };
  }
  return { code: null, explanation: raw.trim() };
}

export async function runAppCodingAgentTurn(
  store: WorkspaceStore,
  input: {
    appId: string;
    instruction: string;
    locale?: AgentLocale | string;
  },
): Promise<AppCodingAgentResult> {
  const appItem = store.listAssembledApplications().find((a) => a.id === input.appId);
  if (!appItem) throw new Error(`Assembled application not found: ${input.appId}`);

  const project = store.getProject(appItem.projectId);
  if (!project) throw new Error(`Project not found: ${appItem.projectId}`);

  if (project.validation.errorCount > 0) {
    throw new Error(
      `Ontology validation gate blocked coding turn: ${project.validation.errorCount} consistency error(s) in ${project.name}.`,
    );
  }

  const locale = resolveEffectiveLocale(store, input.locale, input.instruction);
  const assets = store.listFourLayerAssets();
  const uiAsset =
    assets.find((a) => a.id === appItem.uiUeAssetId) ?? assets.find((a) => a.layer === 'UI_UE')!;
  const foundationAsset =
    assets.find((a) => a.id === appItem.techFoundationAssetId) ??
    assets.find((a) => a.layer === 'TECH_FOUNDATION')!;
  const archAsset =
    assets.find((a) => a.id === appItem.techArchAssetId) ??
    assets.find((a) => a.layer === 'TECH_ARCH')!;
  const requirementDoc = store.listRequirementDocs(project.id)[0];
  const confirmedProto = store.getConfirmedPrototypeRevision(project.id);
  const prototype = confirmedProto
    ? {
        ...confirmedProto.prototype,
        htmlContent: confirmedProto.htmlContent,
        extractedScreenCount: confirmedProto.revision.extractedScreenCount,
      }
    : undefined;

  const activeProvider = resolvePreferredProvider(store, project.id);

  const aggsSummary = (project.suite.M1?.aggregates ?? [])
    .map(
      (a) =>
        `${a.name}(${a.alias})[${a.attributes.map((at) => `${at.name}:${at.type}`).join(',')}]`,
    )
    .join('; ');
  const behaviorsSummary = (project.suite.M2?.behaviors ?? [])
    .map((b) => `${b.id}:${b.name}(${b.behaviorType})`)
    .join(', ');
  const rulesSummary = (project.suite.M3?.rules ?? [])
    .map((r) => `${r.id}:${r.expression}`)
    .join('; ');

  const llmRes = await callOpenAiCompatibleChat(
    activeProvider,
    [
      {
        role: 'system',
        content:
          locale === 'en-US'
            ? [
                `You are the Ontology Plus 4-Layer App Coding Agent.`,
                `Active Project: ${project.name} (${project.domain}); M1 Aggregates: ${aggsSummary}; M2 Behaviors: ${behaviorsSummary}; M3 Rules: ${rulesSummary}.`,
                `Tech Foundation: ${foundationAsset.name}; Architecture: ${archAsset.name}; UI Spec: ${uiAsset.name}.`,
                `Provide a brief implementation summary followed by a complete, self-contained, executable TypeScript module inside a \`\`\`ts code block implementing the requested business logic (importing \`{ evaluateM3Rules }\` from \`./domain/rules\` if rule checks apply).`,
              ].join('\n')
            : [
                `你是 Ontology Plus 的四层资产应用开发智能体（App Coding Agent）。`,
                `当前工程：${project.name}（${project.domain}），M1 聚合根：${aggsSummary}，M2 行为：${behaviorsSummary}，M3 规则：${rulesSummary}。`,
                `技术底座：${foundationAsset.name}，架构规范：${archAsset.name}，UI 规范：${uiAsset.name}。`,
                `请先用简明要点说明实现方案，随后在一个 \`\`\`ts 代码块中输出完整、可编译执行的 TypeScript 业务模块源码（可按需 \`import { evaluateM3Rules } from './domain/rules';\` 执行规则门禁校验）。`,
              ].join('\n'),
      },
      {
        role: 'user',
        content: input.instruction,
      },
    ],
    { store, maxTokens: 6144 },
  );

  const parsedCode = llmRes?.content
    ? extractExecutableTsFromLlmResponse(llmRes.content)
    : { code: null, explanation: '' };

  const generatedFeatureSource = parsedCode.code
    ? [
        `// Generated by Ontology Plus AI Coding Agent for ${appItem.name}`,
        `// Instruction: ${input.instruction.replace(/\r?\n/g, ' ')}`,
        `// Timestamp: ${new Date().toISOString()}`,
        ``,
        parsedCode.code,
        ``,
      ].join('\n')
    : [
        `// Generated by Ontology Plus AI Coding Agent for ${appItem.name}`,
        `// Instruction: ${input.instruction.replace(/\r?\n/g, ' ')}`,
        `// Timestamp: ${new Date().toISOString()}`,
        `import { evaluateM3Rules } from './domain/rules';`,
        ``,
        `export interface AgentFeatureExecutionContext {`,
        `  instruction: string;`,
        `  operatorId: string;`,
        `  payload: Record<string, unknown>;`,
        `}`,
        ``,
        `export function executeAgentGeneratedFeature(ctx: AgentFeatureExecutionContext) {`,
        `  const violations = evaluateM3Rules(ctx.payload);`,
        `  if (violations.length > 0) {`,
        `    return { ok: false, blockedByRules: violations };`,
        `  }`,
        `  return {`,
        `    ok: true,`,
        `    appId: ${JSON.stringify(appItem.id)},`,
        `    instruction: ctx.instruction,`,
        `    executedAt: new Date().toISOString(),`,
        `  };`,
        `}`,
        ``,
      ].join('\n');

  const compiled = compileDevelopmentPackage({
    app: appItem,
    project,
    uiUeAsset: uiAsset,
    techFoundationAsset: foundationAsset,
    techArchAsset: archAsset,
    requirementDoc,
    prototype,
    extraSourceFiles: [
      {
        relativePath: '应用源码/src/agent-generated-feature.ts',
        content: generatedFeatureSource,
      },
    ],
    writeToDisk: true,
  });

  const now = new Date().toISOString();
  const updatedApp = store.saveAssembledApplication({
    ...appItem,
    status: appItem.status === 'PUBLISHED' ? 'PUBLISHED' : 'PACKAGE_READY',
    packageOutputDir:
      compiled.outputDir || appItem.packageOutputDir || `.onto-cs/packages/${appItem.id}`,
    agentDevLogs: [
      ...appItem.agentDevLogs,
      {
        timestamp: now,
        phase: 'AI_CODING_AGENT',
        detail: pickLocaleText(
          locale,
          `已按指令「${input.instruction}」生成可执行领域与服务层源码并同步开发包（共 ${compiled.files.length} 个制品文件，0 一致性错误）。`,
          `Generated executable domain/service TypeScript modules per "${input.instruction}" and synced dev package (${compiled.files.length} files, 0 consistency errors).`,
        ),
      },
    ],
  });

  const reply =
    locale === 'en-US'
      ? [
          `Completed App Coding Agent turn for **${updatedApp.name}**:`,
          `- **Instruction**: ${input.instruction}`,
          `- **Ontology Gate**: ${project.validation.presentModels.length} models active, **0 consistency errors**`,
          `- **Compiled Artifacts**: Generated \`应用源码/db/schema.sql\`, \`src/domain/entities.ts\`, \`src/domain/rules.ts\`, \`src/application/services.ts\`, and \`src/agent-generated-feature.ts\` (**${compiled.files.length}** files total).`,
          ...(llmRes?.content ? [`\n${llmRes.content}`] : []),
        ].join('\n')
      : [
          `已针对组装应用「${updatedApp.name}」执行开发智能体回合：`,
          `- **指令解析**：${input.instruction}`,
          `- **本体门禁校验**：${project.validation.presentModels.length} 个模型在线，**0 错误**`,
          `- **动态编译源码**：已生成 \`应用源码/db/schema.sql\`、\`src/domain/entities.ts\`、\`src/domain/rules.ts\`、\`src/application/services.ts\` 与 \`src/agent-generated-feature.ts\`（共 **${compiled.files.length}** 个文件）。`,
          ...(llmRes?.content ? [`\n${llmRes.content}`] : []),
        ].join('\n');

  saveCheckpointSafe(store, `app-dev-${input.appId}`, 'APP_CODING_AGENT', {
    appId: input.appId,
    instruction: input.instruction,
    filesCount: compiled.files.length,
  });

  return {
    application: updatedApp,
    reply,
    generatedFilesCount: compiled.files.length,
    providerUsed: llmRes?.modelUsed || activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
}

/**
 * Semantic alignment: one LLM call over the structural-scan skeleton. The LLM
 * labels what was read and picks reference targets from listed candidates; it
 * cannot add structure. A failed or unusable call leaves the scan untouched
 * and says so in the report (ADR-0007).
 */
async function runSemanticAlignment(
  store: WorkspaceStore,
  scan: StructuralScanResult,
  input: { projectId: string; source: string; locale: AgentLocale },
): Promise<{ scan: StructuralScanResult; report: SemanticAlignmentReport }> {
  const skeleton = buildAlignmentSkeleton(scan);
  const omitted = skeleton.omitted ? { omitted: skeleton.omitted } : {};
  const provider = resolvePreferredProvider(store, input.projectId);

  let content: string | undefined;
  try {
    const res = await callOpenAiCompatibleChat(
      provider,
      [
        {
          role: 'system',
          content: [
            'You are the semantic alignment step of Ontology Extraction in Ontology Plus (always "Ontology Extraction", never "reverse engineering").',
            'A deterministic structural scan already read the tables below from the source. Do not add, rename, or remove tables or columns.',
            `For each table give a short business alias and a one-sentence description, and a short business label for each column, written in ${input.locale === 'en-US' ? 'English' : 'Simplified Chinese'}.`,
            'A column that lists "refCandidates" may be an undeclared reference. Answer "refTable" with exactly one of the listed table names, or null when it is not a reference or you are not sure. Never answer a name that is not listed. A column without "refCandidates" must not get a "refTable".',
            'Return ONLY JSON: {"tables":[{"table":"<name>","alias":"...","description":"...","columns":[{"column":"<name>","label":"...","refTable":null}]}]}',
          ].join('\n'),
        },
        { role: 'user', content: JSON.stringify(skeleton) },
      ],
      { store, maxTokens: 6144 },
    );
    content = res?.content;
  } catch (err) {
    if (!(err instanceof LlmGatewayError)) throw err;
    const diag = err.toDiagnostic(input.locale);
    return {
      scan,
      report: {
        status: 'FAILED',
        reason: 'GATEWAY_ERROR',
        diagnostic: {
          message: diag.message,
          providerName: diag.providerName,
          baseUrl: diag.baseUrl,
          model: diag.model,
          remediation: diag.remediation,
        },
        ...omitted,
      },
    };
  }

  const parsed = content ? extractFirstJsonObject(content) : null;
  const hasTablesArray = Array.isArray((parsed as { tables?: unknown } | null)?.tables);
  const sanitized = sanitizeAlignment(skeleton, parsed);
  if (!hasTablesArray) {
    return {
      scan,
      report: {
        status: 'FAILED',
        reason: 'UNUSABLE_RESPONSE',
        dropped: sanitized.dropped,
        ...omitted,
      },
    };
  }
  const applied = applyAlignment(scan, sanitized, input.source);
  return {
    scan: applied.scan,
    report: {
      status: 'DONE',
      ...(applied.dropped.length > 0 ? { dropped: applied.dropped } : {}),
      ...omitted,
    },
  };
}

/** Evidence for blueprint-derived elements: the LLM's quote, kept only if it is really in the source. */
function collectBlueprintEvidence(
  suite: OntologySuite,
  blueprint: LlmSynthesizedDomainBlueprint,
  source: string,
  locale: AgentLocale,
): Record<string, ExtractionEvidence[]> {
  const evidenceByKey: Record<string, ExtractionEvidence[]> = {};
  const clean = (name: string | undefined) => (name ?? '').replace(/[^A-Za-z0-9_]/g, '');
  const cite = (key: string, quote: string | undefined) => {
    const located = locateQuote(source, quote);
    const snippet = quote?.trim().slice(0, 80) ?? '';
    const noteZhLocated = 'LLM 依据此段原文归纳';
    const noteEnLocated = 'Inferred by the LLM from this passage';
    const noteZhUnverified = snippet
      ? `LLM 给出的引用在源材料中核对不到：「${snippet}」`
      : 'LLM 未给出原文引用';
    const noteEnUnverified = snippet
      ? `The quote the LLM cited is not in the source: "${snippet}"`
      : 'The LLM cited no passage';
    evidenceByKey[key] = [
      located
        ? {
            origin: 'INFERRED',
            note: pickLocaleText(locale, noteZhLocated, noteEnLocated),
            noteEn: noteEnLocated,
            lines: located.lines,
            excerpt: located.excerpt,
          }
        : {
            origin: 'INFERRED',
            note: pickLocaleText(locale, noteZhUnverified, noteEnUnverified),
            noteEn: noteEnUnverified,
            unverified: true,
          },
    ];
  };

  for (const agg of suite.M1?.aggregates ?? []) {
    const item = blueprint.aggregates?.find((a) => clean(a.name) === agg.name);
    if (item) cite(candidateKey('M1', 'aggregates', agg.id), item.sourceQuote);
  }
  for (const act of suite.M5?.actors ?? []) {
    const item = blueprint.actors?.find(
      (a) =>
        (a.actorId && a.actorId === act.id) ||
        (a.actorName && a.actorName.trim() === act.name) ||
        (!a.actorName && a.roleName && a.roleName.trim().replace(/角色$/, '') === act.name),
    );
    if (item) cite(candidateKey('M5', 'actors', act.id), item.sourceQuote);
  }
  for (const role of suite.M5?.roles ?? []) {
    const item = blueprint.actors?.find(
      (a) =>
        (a.roleId && a.roleId === role.id) ||
        (a.roleName && a.roleName.trim() === role.name) ||
        (!a.roleName && a.actorName && a.actorName.trim() === role.name),
    );
    if (item) cite(candidateKey('M5', 'roles', role.id), item.sourceQuote);
  }
  for (const bhv of suite.M2?.behaviors ?? []) {
    const item = blueprint.behaviors?.find((b) => clean(b.name) === bhv.name);
    if (item) cite(candidateKey('M2', 'behaviors', bhv.id), item.sourceQuote);
  }
  for (const rule of suite.M3?.rules ?? []) {
    const item = blueprint.rules?.find(
      (r) => (r.name && clean(r.name) === rule.name) || (r.alias && r.alias === rule.alias),
    );
    if (item) cite(candidateKey('M3', 'rules', rule.id), item.sourceQuote);
  }
  for (const evt of suite.ME?.events ?? []) {
    const item = blueprint.events?.find((e) => e.name === evt.name);
    if (item) cite(candidateKey('ME', 'events', evt.id), item.sourceQuote);
  }
  for (const flow of suite.M6?.flows ?? []) {
    const item = blueprint.flows?.find((f) => f.name === flow.name);
    if (item) cite(candidateKey('M6', 'flows', flow.id), item.sourceQuote);
  }
  for (const itf of suite.MI?.interfaces ?? []) {
    const item = blueprint.interfaces?.find((i) => i.name === itf.name);
    if (item) cite(candidateKey('MI', 'interfaces', itf.interfaceId), item.sourceQuote);
  }
  return evidenceByKey;
}

/**
 * Ontology Extraction in two rounds. Round one, the structural scan, is
 * deterministic. Round two is the LLM: semantic alignment when the scan read
 * tables, a quoted blueprint when the source is prose. Either way the result
 * is a set of Extraction Candidates, never a replacement suite.
 */
export async function runSmartOntologyExtractionJob(
  store: WorkspaceStore,
  input: {
    systemId: string;
    projectId: string;
    title: string;
    sourceType: ExtractionJob['sourceType'];
    sourceSnippet: string;
    applyImmediately?: boolean;
    locale?: AgentLocale | string;
  },
): Promise<ExtractionMergeResult> {
  const project = store.getProject(input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);
  const source = input.sourceSnippet;
  const locale =
    normalizeAgentLocale(input.locale) ?? resolveEffectiveLocale(store, undefined, input.title);
  const sys = store.listLegacySystems().find((s) => s.id === input.systemId);
  const systemName = sys?.name ?? input.systemId;
  const mock = isMockLlmActive(store);

  const scan = scanSourceStructure({ baseSuite: project.suite, source, domain: project.domain });
  const jobBase = {
    systemId: input.systemId,
    projectId: input.projectId,
    title: input.title,
    sourceType: input.sourceType,
    sourceSnippet: source,
    ...(input.applyImmediately !== undefined ? { applyImmediately: input.applyImmediately } : {}),
  };
  const fromScan = (
    result: StructuralScanResult,
    semanticAlignment: SemanticAlignmentReport,
  ): ExtractionMergeResult => {
    const candidates = buildExtractionCandidates(project.suite, result.suite, result.evidenceByKey);
    const tableList = scan.tables.map((t) => t.tableName).join(', ');
    const scope =
      semanticAlignment.status === 'DONE'
        ? pickLocaleText(locale, '结构扫描 + 语义对齐', 'structural scan + semantic alignment')
        : pickLocaleText(locale, '仅结构扫描', 'structural scan only');
    return store.runOntologyExtractionJob({
      ...jobBase,
      extraction: {
        candidates,
        semanticAlignment,
        tablesCount: scan.tables.length,
        summary: pickLocaleText(
          locale,
          `本体萃取完成（${scope}）：${tableList ? `识别物理表 [${tableList}]，` : ''}${scan.operations.length > 0 ? `解析服务接口 ${scan.operations.length} 个，` : ''}产出 ${candidates.length} 个萃取候选。`,
          `Ontology Extraction finished (${scope}): ${tableList ? `read tables [${tableList}], ` : ''}${scan.operations.length > 0 ? `${scan.operations.length} service operations, ` : ''}${candidates.length} extraction candidates.`,
        ),
      },
    });
  };

  if (mock) {
    if (scan.tables.length === 0 && scan.operations.length === 0 && source.trim().length >= 4) {
      const domainLabel = project.domain || `${systemName}业务域`;
      const firstLine =
        source
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length >= 2) ?? source.trim().slice(0, 80);
      const heading =
        firstLine.replace(/^#+\s*/, '').trim().slice(0, 20) || input.title.trim().slice(0, 20) || '文档规范';
      const primaryAgg = project.suite.M1?.aggregates[0];
      const demoBlueprint: LlmSynthesizedDomainBlueprint = primaryAgg
        ? {
            rules: [
              {
                name: 'DocExtractedComplianceRule',
                alias: `${heading}合规规则`,
                ruleType: 'VALIDATION',
                referencedObjects: [primaryAgg.name],
                violationMessage: `违反「${heading}」源文档合规要求`,
              },
            ],
          }
        : {
            aggregates: [
              {
                name: 'DocExtractedRecord',
                alias: heading,
                attributes: [{ name: 'recordCode', label: '单据编号', type: 'String', required: true }],
              },
            ],
          };
      const demoSuite = applyLlmBlueprintToSuite(
        JSON.parse(JSON.stringify(project.suite)) as OntologySuite,
        demoBlueprint,
        domainLabel,
        { nonCollidingDocIds: true },
      );
      const located = locateQuote(source, firstLine.slice(0, 80));
      const noteZh = 'Mock 演示：提取自源文档片段（Mock 模式下跳过 LLM 语义归纳）';
      const noteEn = 'Mock demo: extracted from source document snippet (LLM semantic synthesis skipped in Mock mode)';
      const rawCandidates = buildExtractionCandidates(project.suite, demoSuite, {});
      const evidenceByKey = Object.fromEntries(
        rawCandidates.map((cand) => [
          cand.key,
          [
            {
              origin: 'INFERRED',
              note: pickLocaleText(locale, noteZh, noteEn),
              noteEn,
              ...(located ? { lines: located.lines, excerpt: located.excerpt } : {}),
            } satisfies ExtractionEvidence,
          ],
        ]),
      );
      const candidates = buildExtractionCandidates(project.suite, demoSuite, evidenceByKey);
      return store.runOntologyExtractionJob({
        ...jobBase,
        extraction: {
          candidates,
          semanticAlignment: { status: 'SKIPPED', reason: 'MOCK_MODE' },
          tablesCount: 0,
          summary: pickLocaleText(
            locale,
            `本体萃取完成（Mock 演示 · LLM 已跳过）：产出 ${candidates.length} 个文档候选供审阅。`,
            `Ontology Extraction finished (Mock demo · LLM skipped): ${candidates.length} document candidate(s) ready for review.`,
          ),
        },
      });
    }
    return fromScan(scan, { status: 'SKIPPED', reason: 'MOCK_MODE' });
  }

  if (scan.tables.length > 0) {
    const aligned = await runSemanticAlignment(store, scan, {
      projectId: input.projectId,
      source,
      locale,
    });
    return fromScan(aligned.scan, aligned.report);
  }

  // No table structure to align: the source is prose (or bare endpoints), so
  // the LLM proposes the elements and must quote the passage each one rests on.
  const domainLabel = project.domain || `${systemName}业务域`;
  const provider = resolvePreferredProvider(store, input.projectId);
  const hasScannedStructure = scan.operations.length > 0;

  let blueprint: LlmSynthesizedDomainBlueprint | null = null;
  try {
    const res = await callOpenAiCompatibleChat(
      provider,
      [
        {
          role: 'system',
          content: [
            'You are the Ontology Extraction Engine of Ontology Plus (strictly "Ontology Extraction", never "reverse engineering").',
            'Extract structured domain aggregates, behaviors, business rules, events, flows, and service interfaces from the provided source code, API spec, SOP document, or runtime logs.',
            'Every item MUST carry "sourceQuote": a short passage (at most 120 characters) copied verbatim from the artifact that the item rests on. Do not paraphrase the quote. Leave out anything you cannot quote.',
            'Return ONLY valid JSON matching:',
            '{"aggregates":[{"sourceQuote":"...","name":"PascalCase","alias":"...","lifecycle":["CREATED","COMPLETED"],"attributes":[{"name":"camelCase","label":"...","type":"String|Integer|Decimal|Money|Boolean|Date","required":true}]}],"behaviors":[{"sourceQuote":"...","name":"camelCase","alias":"...","ownerEntity":"PascalCase","behaviorType":"COMMAND|QUERY"}],"rules":[{"sourceQuote":"...","name":"PascalRule","alias":"...","ruleType":"VALIDATION","referencedObjects":["PascalCase"],"expression":"...","violationMessage":"..."}],"events":[{"sourceQuote":"...","name":"PascalCase.Completed","label":"...","sourceAggregate":"PascalCase"}],"interfaces":[{"sourceQuote":"...","name":"...","direction":"PROVIDED","interfaceCategory":"COMMAND|QUERY","protocol":"REST","relatedEntityRef":"PascalCase"}]}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `System: ${systemName} (Source Type: ${input.sourceType})\n\n--- Raw Artifact ---\n${source.trim().slice(0, 12000)}`,
        },
      ],
      { store, maxTokens: 6144 },
    );
    blueprint = res?.content
      ? extractFirstJsonObject<LlmSynthesizedDomainBlueprint>(res.content)
      : null;
  } catch (err) {
    // What the structural scan read is still true; with nothing read there is
    // no honest result to return, so the failure surfaces (ADR-0007).
    if (!hasScannedStructure || !(err instanceof LlmGatewayError)) throw err;
    const diag = err.toDiagnostic(locale);
    return fromScan(scan, {
      status: 'FAILED',
      reason: 'GATEWAY_ERROR',
      diagnostic: {
        message: diag.message,
        providerName: diag.providerName,
        baseUrl: diag.baseUrl,
        model: diag.model,
        remediation: diag.remediation,
      },
    });
  }

  if (!blueprint || !(blueprint.aggregates?.length || blueprint.interfaces?.length)) {
    if (hasScannedStructure) return fromScan(scan, { status: 'FAILED', reason: 'UNUSABLE_RESPONSE' });
    throw new LlmGatewayError({
      message: pickLocaleText(
        locale,
        'LLM 未返回可用的萃取结果：响应中解析不出任何聚合根或接口。',
        'The LLM returned no usable extraction: no aggregate or interface could be parsed from its response.',
      ),
      providerName: provider?.name ?? '未配置网关',
      baseUrl: provider?.baseUrl ?? '(none)',
      model: provider?.defaultModel ?? '(none)',
      locale,
    });
  }

  const seeded = applyLlmBlueprintToSuite(
    JSON.parse(JSON.stringify(project.suite)) as OntologySuite,
    blueprint,
    domainLabel,
    { nonCollidingDocIds: true },
  );
  const candidates = buildExtractionCandidates(
    project.suite,
    seeded,
    collectBlueprintEvidence(seeded, blueprint, source, locale),
  );
  const aggsCount = candidates.filter((c) => c.collection === 'aggregates').length;
  const rulesCount = candidates.filter((c) => c.collection === 'rules').length;
  const ifCount = candidates.filter((c) => c.collection === 'interfaces').length;

  return store.runOntologyExtractionJob({
    ...jobBase,
    extraction: {
      candidates,
      semanticAlignment: { status: 'DONE' },
      tablesCount: 0,
      summary: pickLocaleText(
        locale,
        `已完成「${systemName}」语义本体萃取：产出 ${candidates.length} 个萃取候选（聚合根 ${aggsCount}、业务规则 ${rulesCount}、服务接口 ${ifCount}），每项附原文引用供核对。`,
        `Completed semantic Ontology Extraction for "${systemName}": ${candidates.length} extraction candidates (${aggsCount} aggregates, ${rulesCount} rules, ${ifCount} interfaces), each citing the source passage it rests on.`,
      ),
    },
  });
}

// ─── 5. Capability Center Smart Chat (Dynamic MCP + SKILL.md Citation) ────────

function selectCapabilityMcpToolAndArgs(
  tools: McpToolDefinition[],
  userMessage: string,
  primaryAggregateName = 'Contract',
): { tool: McpToolDefinition; args: Record<string, unknown>; isExplicitIntent: boolean } {
  const lower = userMessage.toLowerCase();

  // Parse numeric amounts in both Chinese ("150万") and English ("$50k", "1.5m", "$1,200,000")
  let parsedAmount: number | undefined;
  const wanMatch = userMessage.match(/(\d+(?:\.\d+)?)\s*万/);
  const kMatch = userMessage.match(/\$?\s*(\d+(?:\.\d+)?)\s*k\b/i);
  const mMatch = userMessage.match(/\$?\s*(\d+(?:\.\d+)?)\s*m(?:illion)?\b/i);
  const commaMoneyMatch = userMessage.match(/\$\s*(\d{1,3}(?:,\d{3})+)/);
  if (wanMatch) {
    parsedAmount = Math.round(Number(wanMatch[1]) * 10000);
  } else if (mMatch) {
    parsedAmount = Math.round(Number(mMatch[1]) * 1_000_000);
  } else if (kMatch) {
    parsedAmount = Math.round(Number(kMatch[1]) * 1000);
  } else if (commaMoneyMatch) {
    parsedAmount = Number(commaMoneyMatch[1].replace(/,/g, ''));
  } else {
    const rawNumMatch = userMessage.match(/\b(\d{5,10})\b/);
    if (rawNumMatch) parsedAmount = Number(rawNumMatch[1]);
  }
  const ratingMatch = userMessage.match(/\b(AAA|AA|A|B|C)\b/);
  const contractNoMatch = userMessage.match(/\b(CT-\d{4}-\d{4,})\b/);
  const cpIdMatch = userMessage.match(/\b(CP-\d{2,})\b/);

  let selected: McpToolDefinition | undefined;

  if (
    userMessage.includes('起草') ||
    userMessage.includes('新建') ||
    userMessage.includes('创建') ||
    /\b(?:draft|create|new)\b/.test(lower)
  ) {
    selected = tools.find(
      (t) =>
        t.name.includes('draftContract') ||
        t.name.toLowerCase().includes('create') ||
        t.sourceElementId === 'BHV-01',
    );
    if (selected) {
      return {
        tool: selected,
        args: {
          title: userMessage.slice(0, 28),
          contractType: 'OUTSOURCING',
          counterpartyId: cpIdMatch?.[1] ?? 'CP-01',
          totalAmount: parsedAmount ?? 680000,
          ...(ratingMatch ? { creditRating: ratingMatch[1] } : {}),
        },
        isExplicitIntent: true,
      };
    }
  }

  if (userMessage.includes('提交审批') || /\bsubmit\b/.test(lower)) {
    selected = tools.find(
      (t) => t.name.includes('submitContract') || t.sourceElementId === 'BHV-02',
    );
    if (selected) {
      return {
        tool: selected,
        args: { contractId: contractNoMatch?.[1] ?? 'CT-2026-0002' },
        isExplicitIntent: true,
      };
    }
  }

  if (
    userMessage.includes('审批') ||
    userMessage.includes('终审') ||
    userMessage.includes('放行') ||
    /\b(?:approve|signoff)\b/.test(lower)
  ) {
    selected = tools.find(
      (t) => t.name.includes('approveContract') || t.sourceElementId === 'BHV-03',
    );
    if (selected) {
      return {
        tool: selected,
        args: {
          contractId: contractNoMatch?.[1] ?? 'CT-2026-0002',
          approvalOpinion: 'Verified and approved per domain M3 guard rules',
          ...(cpIdMatch ? { counterpartyId: cpIdMatch[1] } : {}),
          ...(parsedAmount !== undefined ? { totalAmount: parsedAmount } : {}),
          ...(ratingMatch ? { creditRating: ratingMatch[1] } : {}),
        },
        isExplicitIntent: true,
      };
    }
  }

  if (userMessage.includes('结算') || /\bsettlement\b/.test(lower)) {
    selected = tools.find(
      (t) => t.name.includes('Settlement') || t.sourceElementId === 'BHV-04',
    );
    if (selected) {
      return {
        tool: selected,
        args: {
          contractId: contractNoMatch?.[1] ?? 'CT-2026-0001',
          initialAmount: parsedAmount ?? 360000,
        },
        isExplicitIntent: true,
      };
    }
  }

  if (
    (userMessage.includes('风险') || lower.includes('risk')) &&
    (userMessage.includes('报表') || userMessage.includes('统计') || lower.includes('report'))
  ) {
    selected = tools.find((t) => t.sourceElementId === 'RPT-02' || t.sourceElementId === 'BHV-06');
    if (selected) {
      return { tool: selected, args: { riskLevel: 'HIGH' }, isExplicitIntent: true };
    }
  }

  if (userMessage.includes('影响') || /\bimpact\b/.test(lower)) {
    selected = tools.find((t) => t.name === 'ontology_analyze_impact');
    if (selected) {
      return {
        tool: selected,
        args: { symbolId: primaryAggregateName },
        isExplicitIntent: true,
      };
    }
  }

  if (userMessage.includes('校验') || /\bvalidate\b/.test(lower)) {
    selected = tools.find((t) => t.name === 'ontology_validate_suite');
    if (selected) {
      return { tool: selected, args: {}, isExplicitIntent: true };
    }
  }

  selected =
    tools.find((t) => t.sourceModel === 'M7') ??
    tools.find((t) => t.sourceModel === 'M2') ??
    tools[0];

  return {
    tool: selected,
    args: contractNoMatch ? { keyword: contractNoMatch[1] } : {},
    isExplicitIntent: false,
  };
}

export async function runCapabilitySmartChatTurn(
  store: WorkspaceStore,
  input: {
    agentId: string;
    sessionId?: string;
    userMessage: string;
    locale?: AgentLocale | string;
  },
): Promise<CapabilitySmartChatResult> {
  const agents = store.listCapabilityAgents();
  const agent = agents.find((a) => a.id === input.agentId) ?? agents[0];
  if (!agent) throw new Error(`Capability agent not found: ${input.agentId}`);

  const locale = resolveEffectiveLocale(store, input.locale, input.userMessage);

  // Switch to secondary MCP server project if user explicitly asks about MFT file transfer
  let targetProject = store.getProject(agent.projectId);
  if (
    (input.userMessage.toUpperCase().includes('MFT') ||
      input.userMessage.includes('文件传输') ||
      input.userMessage.toLowerCase().includes('file transfer')) &&
    agent.mcpIds.some((id) => id.includes('mft'))
  ) {
    const mftProj = store.getProject('proj-mft');
    if (mftProj) targetProject = mftProj;
  }
  if (!targetProject) throw new Error(`Project not found for agent: ${agent.projectId}`);

  const caps = inspectOntologyMcpCapabilities(targetProject);
  if (caps.tools.length === 0) {
    throw new Error(`No MCP tools exposed by project: ${targetProject.id}`);
  }

  const activeProvider = resolvePreferredProvider(store, targetProject.id);
  const primaryAggName = targetProject.suite.M1?.aggregates[0]?.name ?? 'Contract';

  const heuristic = selectCapabilityMcpToolAndArgs(
    caps.tools,
    input.userMessage,
    primaryAggName,
  );
  let selectedTool = heuristic.tool;
  let toolArgs = { ...heuristic.args };

  if (!heuristic.isExplicitIntent) {
    const openAiMcpTools: OpenAiFunctionTool[] = caps.tools.slice(0, 10).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description.slice(0, 200),
        parameters: t.inputSchema,
      },
    }));
    const toolPickRes = await callOpenAiCompatibleChat(
      activeProvider,
      [
        {
          role: 'system',
          content: pickLocaleText(
            locale,
            `${agent.systemPrompt}\n请根据用户指令选择最合适的 MCP 工具调用。`,
            `${agent.systemPrompt}\nSelect the most appropriate MCP tool for the user's request.`,
          ),
        },
        { role: 'user', content: input.userMessage },
      ],
      { store, tools: openAiMcpTools },
    );
    if (toolPickRes && toolPickRes.toolCalls.length > 0) {
      const picked = caps.tools.find((t) => t.name === toolPickRes.toolCalls[0].name);
      if (picked) {
        selectedTool = picked;
        toolArgs = { ...toolPickRes.toolCalls[0].args, ...toolArgs };
      }
    }
  }

  const mcpResponse = handleOntologyMcpRequest(
    targetProject,
    {
      jsonrpc: '2.0',
      id: `cap-rpc-${Date.now()}`,
      method: 'tools/call',
      params: {
        name: selectedTool.name,
        arguments: toolArgs,
      },
    },
    {
      sqlExecutor: store.executeReadOnlyAnalyticsSql
        ? (s, p) => store.executeReadOnlyAnalyticsSql(s, p)
        : undefined,
    },
  );

  const rpcResult = mcpResponse.result as
    | { isError?: boolean; content?: { type: string; text: string }[] }
    | undefined;
  const outputText =
    rpcResult?.content?.[0]?.text ??
    (mcpResponse.error ? JSON.stringify(mcpResponse.error) : '{}');
  const isError = Boolean(rpcResult?.isError || mcpResponse.error);

  const toolInvocations: NonNullable<CapabilityChatMessage['toolInvocations']> = [
    {
      toolName: selectedTool.name,
      arguments: toolArgs,
      output: outputText,
      isError,
    },
  ];

  const skills = store.listGeneratedSkills(targetProject.id);
  const activeSkill = skills[0] ?? compileOntologySkill(targetProject);
  const citedSkillSlug = activeSkill.slug || 'ontology-domain-skill';
  const citedRules = (targetProject.suite.M3?.rules ?? []).map((r) => `${r.id} (${r.alias})`);

  const llmRes = await callOpenAiCompatibleChat(
    activeProvider,
    [
      {
        role: 'system',
        content: pickLocaleText(
          locale,
          `${agent.systemPrompt}\n你已挂载技能包 ${citedSkillSlug}/SKILL.md 与 MCP 工具 ${selectedTool.name}。请在回复中明确引用 SKILL.md 中的业务规则编号（如 RULE-01 / RULE-03）并总结工具返回结果（控制在 220 字以内）。`,
          `${agent.systemPrompt}\nYou have mounted skill package ${citedSkillSlug}/SKILL.md and MCP tool ${selectedTool.name}. Reply in English, explicitly citing SKILL.md and relevant M3 rule IDs while summarizing the tool result (within 200 words).`,
        ),
      },
      {
        role: 'user',
        content:
          locale === 'en-US'
            ? `User Message: ${input.userMessage}\nMCP Tool ${selectedTool.name} Output: ${outputText.slice(0, 600)}`
            : `用户消息：${input.userMessage}\nMCP 工具 ${selectedTool.name} 返回：${outputText.slice(0, 600)}`,
      },
    ],
    { store },
  );

  const fallbackContent =
    locale === 'en-US'
      ? [
          `Executed capability per skill spec **\`${citedSkillSlug}/SKILL.md\`** and M3 rule gate (${citedRules.slice(0, 3).join(', ') || 'M3 Rules'}):`,
          `- **Invoked MCP Tool**: \`${selectedTool.name}\` (source: \`${selectedTool.sourceModel}\` · \`${selectedTool.sourceElementId}\`)`,
          `- **Rule Gate Status**: ${isError ? 'Blocked by `M3` rule violation (`RULE_VIOLATION`)' : 'Passed `SKILL.md` & `M3` rule checks (200 OK)'}`,
          `- **Execution Output**: \`\`\`json\n${outputText.slice(0, 360)}\n\`\`\``,
        ].join('\n')
      : [
          `已依据技能规范 **\`${citedSkillSlug}/SKILL.md\`** 及领域规则门禁（${citedRules.slice(0, 3).join('、') || 'M3 合规规则'}）完成能力调用：`,
          `- **调用 MCP 工具**：\`${selectedTool.name}\`（来源模型：\`${selectedTool.sourceModel}\` · \`${selectedTool.sourceElementId}\`）`,
          `- **规则门禁状态**：${isError ? '触发 `M3` 规则拦截（`RULE_VIOLATION`），已阻断违规操作' : '通过 `SKILL.md` 与 `M3` 业务规则校验（200 OK）'}`,
          `- **执行摘要**：\`\`\`json\n${outputText.slice(0, 360)}\n\`\`\``,
        ].join('\n');

  const finalContent =
    llmRes?.content && llmRes.content.includes('SKILL.md')
      ? llmRes.content
      : llmRes?.content
        ? pickLocaleText(
            locale,
            `${llmRes.content}\n\n> 规范依据：\`${citedSkillSlug}/SKILL.md\` · 校验规则：${citedRules.slice(0, 2).join('、') || 'RULE-01'}`,
            `${llmRes.content}\n\n> Reference: \`${citedSkillSlug}/SKILL.md\` · Guard Rules: ${citedRules.slice(0, 2).join(', ') || 'RULE-01'}`,
          )
        : fallbackContent;

  const existingSessions =
    typeof store.listCapabilityChatSessions === 'function'
      ? store.listCapabilityChatSessions(agent.id)
      : [];
  const existingSession = input.sessionId
    ? existingSessions.find((s) => s.id === input.sessionId)
    : undefined;

  const now = new Date().toISOString();
  const userChatMsg: CapabilityChatMessage = {
    id: `cmsg-${Date.now()}-u`,
    role: 'user',
    content: input.userMessage,
    timestamp: now,
  };
  const assistantChatMsg: CapabilityChatMessage = {
    id: `cmsg-${Date.now()}-a`,
    role: 'assistant',
    content: finalContent,
    timestamp: now,
    toolInvocations,
  };

  const sessionPayload: Omit<CapabilityChatSession, 'updatedAt'> = {
    id: existingSession?.id || input.sessionId || `cap-sess-${Date.now().toString(36)}`,
    agentId: agent.id,
    projectId: targetProject.id,
    title: existingSession?.title || input.userMessage.slice(0, 28),
    messages: [...(existingSession?.messages ?? []), userChatMsg, assistantChatMsg],
  };

  const savedSession: CapabilityChatSession =
    typeof store.saveCapabilityChatSession === 'function'
      ? store.saveCapabilityChatSession(sessionPayload)
      : { ...sessionPayload, updatedAt: now };

  saveCheckpointSafe(store, savedSession.id, 'CAPABILITY_SMART_CHAT', {
    agentId: agent.id,
    toolCalled: selectedTool.name,
    isError,
  });

  return {
    session: savedSession,
    message: assistantChatMsg,
    toolInvocations,
    citedSkillSlug,
    citedRules,
    providerUsed: llmRes?.modelUsed || activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
}

// ─── 6. Data Analytics Center Reasoning, Metric Insight & Scenario Attribution ─

interface GroundedQueryResult {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  referenceQueryId?: string;
  referencedTables: string[];
  warnings: string[];
}

/**
 * Queries the reasoning endpoint may run, most specific first: tables the
 * question names, M7 reference queries that fit the question, then a plain
 * read of the first mapped table. All of it comes from the grounding; nothing
 * is written for a particular domain.
 */
function groundedSqlCandidates(
  grounding: DataGrounding,
  question: string,
): { sql: string; referenceQueryId?: string }[] {
  const lowerQuestion = question.toLowerCase();
  const candidates: { sql: string; referenceQueryId?: string }[] = [];
  for (const table of grounding.tables) {
    if (lowerQuestion.includes(table.table.toLowerCase())) {
      candidates.push({ sql: `SELECT * FROM ${table.table} LIMIT 20` });
    }
  }
  for (const query of grounding.referenceQueries) {
    if (query.score > 0) candidates.push({ sql: query.sql, referenceQueryId: query.id });
  }
  const firstMapped = grounding.tables.find((t) => t.mapped);
  if (firstMapped) candidates.push({ sql: `SELECT * FROM ${firstMapped.table} LIMIT 20` });
  return candidates;
}

/** Run candidates in order; prefer the first that returns rows. Ungrounded SQL never runs. */
function runGroundedCandidates(
  store: WorkspaceStore,
  grounding: DataGrounding,
  candidates: { sql: string; referenceQueryId?: string }[],
  locale: AgentLocale,
): GroundedQueryResult | null {
  let firstEmpty: GroundedQueryResult | null = null;
  for (const candidate of candidates) {
    const report = checkSqlGrounding(grounding, candidate.sql);
    if (report.unknownTables.length > 0) continue;
    let res: ReturnType<WorkspaceStore['executeReadOnlyAnalyticsSql']>;
    try {
      res = store.executeReadOnlyAnalyticsSql(candidate.sql);
    } catch {
      // The suite describes a table or column the workspace database does not hold.
      continue;
    }
    const result: GroundedQueryResult = {
      sql: res.sql || candidate.sql,
      columns: res.columns,
      rows: res.rows,
      ...(candidate.referenceQueryId ? { referenceQueryId: candidate.referenceQueryId } : {}),
      referencedTables: report.referencedTables,
      warnings: describeJoinWarnings(report, locale, grounding),
    };
    if (res.rows.length > 0) return result;
    firstEmpty ??= result;
  }
  return firstEmpty;
}

/** Figures read straight off the result rows: a row count and sums of numeric columns. */
function summarizeQueryRows(
  result: GroundedQueryResult,
  locale: AgentLocale,
): ReasoningSession['dataSummary'] {
  const summary: ReasoningSession['dataSummary'] = [
    {
      label: pickLocaleText(locale, '实时命中数据行', 'Live Matched Rows'),
      value: pickLocaleText(locale, `${result.rows.length} 行`, `${result.rows.length} rows`),
      delta: pickLocaleText(locale, 'SQLite 实查', 'Live SQLite'),
    },
  ];
  for (const column of result.columns) {
    if (summary.length >= 3) break;
    if (column === 'id' || column.endsWith('_id') || column.endsWith('__label')) continue;
    const values = result.rows.map((row) => row[column]).filter((v) => v !== null && v !== undefined);
    if (values.length === 0 || !values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      continue;
    }
    const total = (values as number[]).reduce((sum, v) => sum + v, 0);
    summary.push({
      label: pickLocaleText(locale, `${column} 合计`, `Sum of ${column}`),
      value: Number.isInteger(total) ? String(total) : total.toFixed(2),
      delta: pickLocaleText(
        locale,
        `${values.length} 行求和`,
        `summed over ${values.length} rows`,
      ),
    });
  }
  return summary;
}

/**
 * One-shot Data Ontology Reasoning. Shares its grounding with the REASONING
 * Agent Session: SQL comes from `M7` reference queries and `MM` tables, and
 * every figure in the answer is read off rows that a query returned. With
 * nothing to query it says which model is missing instead of filling in.
 */
export async function runDataOntologyReasoning(
  store: WorkspaceStore,
  input: {
    question: string;
    mode: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
    projectId?: string;
    locale?: AgentLocale | string;
  },
): Promise<ReasoningSession> {
  const locale = resolveEffectiveLocale(store, input.locale, input.question);
  const project = input.projectId
    ? store.getProject(input.projectId)
    : store.getProject(store.listProjects()[0]?.id ?? 'proj-contract');
  const activeProvider = resolvePreferredProvider(store, project?.id);

  const grounding = buildProjectDataGrounding(store, project, input.question);
  const liveQuery = runGroundedCandidates(
    store,
    grounding,
    groundedSqlCandidates(grounding, input.question),
    locale,
  );
  const missingNotes = describeMissingModels(grounding, locale);
  const hasRows = Boolean(liveQuery && liveQuery.rows.length > 0);

  const basis = !liveQuery
    ? pickLocaleText(
        locale,
        '未能执行任何有据查询，因此不给出统计数字。',
        'No grounded query could be run, so no figures are reported.',
      )
    : liveQuery.referenceQueryId
      ? pickLocaleText(
          locale,
          `取数口径：复用 M7 参考查询 ${liveQuery.referenceQueryId}，涉及表 ${liveQuery.referencedTables.join(', ')}。`,
          `Basis: M7 reference query ${liveQuery.referenceQueryId}, reading ${liveQuery.referencedTables.join(', ')}.`,
        )
      : pickLocaleText(
          locale,
          `取数口径：直接读取 ${liveQuery.referencedTables.join(', ')}（没有与问题匹配的 M7 参考查询）。`,
          `Basis: a direct read of ${liveQuery.referencedTables.join(', ')} (no M7 reference query matches the question).`,
        );
  const causalAnalysis = [basis, ...(liveQuery?.warnings ?? []), ...missingNotes];

  const aggNames = (project?.suite.M1?.aggregates ?? [])
    .map((a) => `${a.name}(${a.alias})`)
    .join(', ');
  const defaultWb = store.listWritebackInterfaces()[0];
  const primaryAgg = project?.suite.M1?.aggregates[0]?.name;

  const llmRes = await callOpenAiCompatibleChat(
    activeProvider,
    [
      {
        role: 'system',
        content: pickLocaleText(
          locale,
          `你是数据分析中心的数据本体推理引擎，支持智能问数(ASK_DATA)、智能问因(ASK_WHY)、智能问策(ASK_POLICY)。只依据下面给出的查询结果${aggNames ? `与当前工程本体模型（${aggNames}）` : ''}作答，给出简洁、结构化的 Markdown 结论（220 字以内）。结论中的每个数字都必须出自查询结果；没有查询结果时，说明缺少哪个模型或哪份数据，不要给出任何数字。`,
          `You are the Data Ontology Reasoning Engine supporting ASK_DATA, ASK_WHY, and ASK_POLICY modes. Answer only from the query result below${aggNames ? ` and the active domain aggregates (${aggNames})` : ''}, as a concise structured Markdown conclusion within 200 words. Every figure must come from the query result; with no query result, say which model or data is missing and state no figures.`,
        ),
      },
      {
        role: 'user',
        content: [
          `[Mode: ${input.mode}] ${input.question}`,
          liveQuery
            ? `Query (${liveQuery.sql}) returned ${liveQuery.rows.length} rows: ${JSON.stringify(liveQuery.rows.slice(0, 5))}`
            : 'No query was run.',
          ...causalAnalysis,
        ].join('\n'),
      },
    ],
    { store },
  );

  const fallbackAnswer = [
    pickLocaleText(
      locale,
      `### 本体推理结论 (${input.mode})\n针对问题「${input.question}」：`,
      `### Ontology Reasoning Conclusion (${input.mode})\nFor **"${input.question}"**:`,
    ),
    liveQuery
      ? pickLocaleText(
          locale,
          `- 有据查询返回 **${liveQuery.rows.length}** 行。${basis}`,
          `- The grounded query returned **${liveQuery.rows.length}** rows. ${basis}`,
        )
      : `- ${basis}`,
    ...[...(liveQuery?.warnings ?? []), ...missingNotes].map((note) => `- ${note}`),
    ...(defaultWb && input.mode === 'ASK_POLICY'
      ? [
          pickLocaleText(
            locale,
            `- 如需处置，可调用回写接口 **\`${defaultWb.id}\`** 执行受控闭环。`,
            `- To act on it, invoke writeback interface **\`${defaultWb.id}\`** for governed closed-loop handling.`,
          ),
        ]
      : []),
  ].join('\n');

  const session = store.saveReasoningSession({
    id: `reas-${Date.now().toString(36)}`,
    question: input.question,
    mode: input.mode,
    sqlGenerated: liveQuery?.sql ?? '',
    ...(liveQuery
      ? {
          queryColumns: liveQuery.columns,
          queryRows: liveQuery.rows,
        }
      : {}),
    dataSummary: liveQuery ? summarizeQueryRows(liveQuery, locale) : [],
    causalAnalysis,
    policyRecommendations: defaultWb
      ? [
          {
            actionTitle: defaultWb.name,
            targetObject: primaryAgg ?? defaultWb.boundBehaviorRef,
            expectedImpact: hasRows
              ? pickLocaleText(
                  locale,
                  `对本次查询命中的 ${liveQuery!.rows.length} 行记录执行受控回写并留存审计流水`,
                  `Governed writeback over the ${liveQuery!.rows.length} rows this query matched, with an audit trail`,
                )
              : pickLocaleText(
                  locale,
                  '执行受控回写并留存审计流水（本次没有查询到可处置的记录）',
                  'Governed writeback with an audit trail (this query matched no records to act on)',
                ),
            writebackInterfaceId: defaultWb.id,
          },
        ]
      : [],
    answerMarkdown: llmRes?.content || fallbackAnswer,
    grounding: {
      ...(liveQuery?.referenceQueryId ? { referenceQueryId: liveQuery.referenceQueryId } : {}),
      tables: liveQuery?.referencedTables ?? [],
      missingModels: grounding.missing,
      warnings: liveQuery?.warnings ?? [],
    },
  });

  saveCheckpointSafe(store, session.id, 'DATA_ONTOLOGY_REASONING', {
    mode: input.mode,
    rowCount: liveQuery?.rows.length ?? 0,
  });

  return session;
}

// ─── 7. Standard SSE Streaming Helper ─────────────────────────────────────────

export function buildTurnSseEvents(input: {
  sessionId: string;
  reply: string;
  toolCalls?: { toolName: string; args: Record<string, unknown>; output?: unknown; status?: string }[];
  renderPayload?: Record<string, unknown>;
  modelUsed?: string;
}): SseAgentEvent[] {
  const events: SseAgentEvent[] = [
    {
      event: 'message_start',
      id: `${input.sessionId}-start`,
      data: {
        sessionId: input.sessionId,
        model: input.modelUsed ?? 'auto/glm-5.3-flash',
        startedAt: new Date().toISOString(),
      },
    },
  ];

  // Emit reply text delta frames before tool_call / tool_result / render_payload / message_end
  const text = input.reply || '';
  const chunkSize = Math.max(48, Math.ceil(text.length / 3));
  if (text.length === 0) {
    events.push({
      event: 'delta',
      id: `${input.sessionId}-delta-1`,
      data: { text: '' },
    });
  } else {
    for (let i = 0; i < text.length; i += chunkSize) {
      events.push({
        event: 'delta',
        id: `${input.sessionId}-delta-${Math.floor(i / chunkSize) + 1}`,
        data: {
          text: text.slice(i, i + chunkSize),
        },
      });
    }
  }

  for (const [idx, tc] of (input.toolCalls ?? []).entries()) {
    events.push({
      event: 'tool_call',
      id: `${input.sessionId}-tc-${idx + 1}`,
      data: {
        toolName: tc.toolName,
        arguments: tc.args,
      },
    });
    events.push({
      event: 'tool_result',
      id: `${input.sessionId}-tr-${idx + 1}`,
      data: {
        toolName: tc.toolName,
        status: tc.status ?? 'OK',
        output: tc.output ?? null,
      },
    });
  }

  if (input.renderPayload) {
    events.push({
      event: 'render_payload',
      id: `${input.sessionId}-payload`,
      data: input.renderPayload,
    });
  }

  events.push({
    event: 'message_end',
    id: `${input.sessionId}-end`,
    data: {
      sessionId: input.sessionId,
      completedAt: new Date().toISOString(),
    },
  });

  return events;
}

export function createSseEventStream(
  events: SseAgentEvent[] | AsyncIterable<SseAgentEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let seq = 1;
        if (Array.isArray(events)) {
          for (const ev of events) {
            const idLine = `id: ${ev.id ?? `evt-${seq++}`}\n`;
            const eventLine = `event: ${ev.event}\n`;
            const dataLine = `data: ${JSON.stringify(ev.data)}\n\n`;
            controller.enqueue(encoder.encode(`${idLine}${eventLine}${dataLine}`));
          }
        } else {
          for await (const ev of events) {
            const idLine = `id: ${ev.id ?? `evt-${seq++}`}\n`;
            const eventLine = `event: ${ev.event}\n`;
            const dataLine = `data: ${JSON.stringify(ev.data)}\n\n`;
            controller.enqueue(encoder.encode(`${idLine}${eventLine}${dataLine}`));
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
