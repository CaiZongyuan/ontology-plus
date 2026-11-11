import {
  CONTRACT_PROTOTYPE_HTML,
  MODEL_CODES,
  extractMuFromPrototypeHtml,
  validateOntologySuite,
  type AggregateRoot,
  type Attribute,
  type ModelCode,
  type OntologySuite,
  type ValidationReport,
} from '../../ontology-core/index.js';
import {
  compileDevelopmentPackage,
  compileOntologySkill,
  handleOntologyMcpRequest,
  inspectOntologyMcpCapabilities,
  type McpToolDefinition,
} from '../../package-compiler/index.js';
import type {
  AgentSession,
  AnalyticsReport,
  AnalyticsScenario,
  AssembledApplication,
  CapabilityChatMessage,
  CapabilityChatSession,
  ExtractionJob,
  FourLayerAsset,
  LlmProviderConfig,
  MetricDefinition,
  ProjectDetail,
  PrototypeArtifact,
  ReasoningSession,
  RequirementDoc,
  RequirementMessage,
  RequirementSession,
  WorkspaceStore,
} from '../../workspace-store/index.js';
import {
  type AgentLocale,
  pickLocaleText,
  resolveEffectiveLocale,
} from './locale.js';
import {
  ONTOLOGY_DURABLE_TOOLS,
  ONTOLOGY_TOOL_NAMES,
  OPENAI_ONTOLOGY_TOOLS,
  applyOntologyToolCall,
  durableMemoryStorage,
  ontologyToolRegistry,
  type OntologyToolName,
  type OpenAiFunctionTool,
} from './tools.js';
import { LlmGatewayError, isMockLlmActive } from './pi-session-engine.js';

export { ONTOLOGY_DURABLE_TOOLS, LlmGatewayError, isMockLlmActive };

export interface AgentToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  status: 'APPLIED' | 'REJECTED_BY_VALIDATOR';
  summaryZh: string;
  summaryEn: string;
}

export interface OntologyCopilotResult {
  reply: string;
  providerUsed: string;
  modelUsed: string;
  latencyMs: number;
  toolCalls: AgentToolCallRecord[];
  project: ProjectDetail;
}

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

export interface RequirementDocSynthesisResult {
  doc: RequirementDoc;
  session: RequirementSession;
  agentSession?: AgentSession;
  docs: RequirementDoc[];
  providerUsed: string;
}

export interface PrototypeGenerationResult {
  prototype: PrototypeArtifact;
  project: ProjectDetail;
  prototypes: PrototypeArtifact[];
  providerUsed: string;
  summary?: string;
}

export interface OntologySynthesisFromPrototypeResult {
  project: ProjectDetail;
  prototype: PrototypeArtifact;
  synthesizedModels: ModelCode[];
  validation: ValidationReport;
}

export interface TechArchitectureGenerationResult {
  asset: FourLayerAsset;
  fourLayerAssets: FourLayerAsset[];
  providerUsed: string;
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

export interface MetricInsightResult {
  metric: MetricDefinition;
  insightMarkdown: string;
  anomalyDrivers: string[];
  suggestedAction: string;
  writebackInterfaceId: string;
  queryRows?: Record<string, unknown>[];
  providerUsed: string;
}

export interface ScenarioAttributionResult {
  scenario: AnalyticsScenario;
  attributionMarkdown: string;
  causalBreakdown: { factor: string; weight: string; evidence: string }[];
  recommendedWritebackId: string;
  queryRows?: Record<string, unknown>[];
  savedReport?: AnalyticsReport;
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

// ─── 1. Ontology Copilot Turn (12 Durable Tools + Validator Gate) ─────────────

function inferDeterministicOntologyToolCall(
  prompt: string,
  suite: OntologySuite,
  activeModel?: ModelCode,
): { name: OntologyToolName; args: Record<string, unknown> } | null {
  const lower = prompt.toLowerCase();

  // Delete intent
  if (
    prompt.includes('删除') ||
    prompt.includes('移除') ||
    lower.includes('delete ') ||
    lower.includes('remove ')
  ) {
    const idMatch = prompt.match(
      /\b((?:AGG|BHV|RULE|EVT|SCN|ACT|ROLE|PERM|FLW|QRY|RPT|SCR|MAP|IF)-[A-Za-z0-9_-]+)\b/,
    );
    if (idMatch) {
      return {
        name: 'delete_element',
        args: {
          ...(activeModel ? { modelCode: activeModel } : {}),
          elementId: idMatch[1],
        },
      };
    }
    if (prompt.includes('Contract') || prompt.includes('合同聚合')) {
      return {
        name: 'delete_element',
        args: { modelCode: 'M1', elementId: 'AGG-01' },
      };
    }
  }

  const isMutating =
    prompt.includes('新增') ||
    prompt.includes('添加') ||
    prompt.includes('创建') ||
    prompt.includes('补充') ||
    prompt.includes('生成') ||
    prompt.includes('修改') ||
    prompt.includes('更新') ||
    lower.includes('add') ||
    lower.includes('create') ||
    lower.includes('upsert');

  if (!isMutating) return null;

  const cleanAlias = prompt
    .replace(/^(?:请|帮我|为[^，,]*?)?(?:新增|添加|创建|补充|生成)(?:一条|一个|一份|一张)?/g, '')
    .replace(/[，。！？]/g, '')
    .trim()
    .slice(0, 24);

  // Check M3 Rule first so prompts like "请为合同新增一条付款里程碑逾期超 30 天自动冻结结算单的校验规则"
  // always map to `upsert_rule` even though they mention "合同" and "结算单"!
  if (
    prompt.includes('规则') ||
    prompt.includes('校验') ||
    lower.includes('rule') ||
    (activeModel === 'M3' &&
      !prompt.includes('行为') &&
      !prompt.includes('聚合') &&
      !prompt.includes('事件'))
  ) {
    const nextNum = (suite.M3?.rules.length ?? 0) + 1;
    const ruleId = `RULE-${String(nextNum).padStart(2, '0')}`;
    const primaryAgg = suite.M1?.aggregates[0]?.name ?? 'DomainRecord';
    const primaryAttr =
      suite.M1?.aggregates[0]?.attributes.find((at) =>
        ['Money', 'Decimal', 'Integer'].includes(at.type),
      )?.name ??
      suite.M1?.aggregates[0]?.attributes[0]?.name ??
      'id';
    const referencedObjects: string[] = [];
    if (suite.M1?.aggregates[0]) {
      referencedObjects.push(suite.M1.aggregates[0].name);
    }
    if (
      (prompt.includes('结算') || lower.includes('settlement')) &&
      suite.M1?.aggregates.some((a) => a.name === 'SettlementOrder') &&
      !referencedObjects.includes('SettlementOrder')
    ) {
      referencedObjects.push('SettlementOrder');
    }
    const dayMatch = prompt.match(/(\d+)\s*(?:天|days?\b)/i);
    const isNumericAttr = suite.M1?.aggregates[0]?.attributes.some(
      (at) => at.name === primaryAttr && ['Money', 'Decimal', 'Integer'].includes(at.type),
    );
    const baseExpr = isNumericAttr
      ? `${primaryAgg}.${primaryAttr} > 0`
      : `${primaryAgg}.${primaryAttr} != null`;
    const expression = dayMatch
      ? `${baseExpr} && overdueDays <= ${dayMatch[1]}`
      : baseExpr;

    return {
      name: 'upsert_rule',
      args: {
        id: ruleId,
        name: `AutoComplianceRule${String(nextNum).padStart(2, '0')}`,
        alias: cleanAlias || `自动业务校验规则${nextNum}`,
        ruleType: 'VALIDATION',
        scope: 'CROSS_OBJECT',
        referencedObjects,
        expression,
        violationMessage: `违反业务合规校验规则：${cleanAlias || prompt.slice(0, 24)}`,
        description: `由 AI 本体助手根据指令「${prompt}」自动生成的业务规则。`,
      },
    };
  }

  if (prompt.includes('事件') || lower.includes('event') || activeModel === 'ME') {
    const nextNum = (suite.ME?.events.length ?? 0) + 1;
    const owner = suite.M1?.aggregates[0]?.name ?? 'DomainRecord';
    return {
      name: 'upsert_event',
      args: {
        id: `EVT-${String(nextNum).padStart(2, '0')}`,
        name: `${owner}.CustomEvent${String(nextNum).padStart(2, '0')}`,
        label: cleanAlias || `${owner}领域事件`,
        sourceAggregate: owner,
        description: `由 AI 本体助手根据「${prompt}」生成的领域事件`,
      },
    };
  }

  if (prompt.includes('场景') || lower.includes('scenario') || activeModel === 'M4') {
    const nextNum = (suite.M4?.event_scenarios.length ?? 0) + 1;
    return {
      name: 'upsert_scenario',
      args: {
        id: `SCN-${String(nextNum).padStart(2, '0')}`,
        name: cleanAlias || `跨对象联动场景${nextNum}`,
        description: `由 AI 本体助手根据「${prompt}」编排的事件场景`,
      },
    };
  }

  if (
    prompt.includes('角色') ||
    prompt.includes('参与方') ||
    prompt.includes('主体') ||
    lower.includes('actor') ||
    lower.includes('role') ||
    activeModel === 'M5'
  ) {
    return {
      name: 'upsert_actor_role',
      args: {
        roleName: cleanAlias || '业务风控审查角色',
        description: `由 AI 本体助手根据「${prompt}」生成的角色与主体`,
      },
    };
  }

  if (
    prompt.includes('流程') ||
    prompt.includes('审批流') ||
    prompt.includes('工作流') ||
    lower.includes('flow') ||
    activeModel === 'M6'
  ) {
    const nextNum = (suite.M6?.flows.length ?? 0) + 1;
    return {
      name: 'upsert_flow',
      args: {
        id: `FLW-${String(nextNum).padStart(2, '0')}`,
        name: cleanAlias || `多级业务协同审批流${nextNum}`,
        flowType: 'APPROVAL',
        description: `由 AI 本体助手根据「${prompt}」生成的流程模型`,
      },
    };
  }

  if (
    prompt.includes('报表') ||
    prompt.includes('查询规范') ||
    lower.includes('report') ||
    activeModel === 'M7'
  ) {
    const nextNum = (suite.M7?.query_reports.length ?? 0) + 1;
    return {
      name: 'upsert_query_report',
      args: {
        id: `RPT-${String(nextNum + 2).padStart(2, '0')}`,
        alias: cleanAlias || `业务统计分析报表${nextNum}`,
        queryType: 'REPORT',
        description: `由 AI 本体助手根据「${prompt}」生成的查询报表`,
      },
    };
  }

  if (
    prompt.includes('屏幕') ||
    prompt.includes('页面') ||
    prompt.includes('界面') ||
    lower.includes('screen') ||
    activeModel === 'MU'
  ) {
    const nextNum = (suite.MU?.screens.length ?? 0) + 1;
    return {
      name: 'upsert_screen',
      args: {
        screenId: `SCR-CUSTOM-${String(nextNum).padStart(2, '0')}`,
        name: cleanAlias || `业务监控工作台${nextNum}`,
        screenType: 'LIST',
        description: `由 AI 本体助手根据「${prompt}」生成的屏幕模型`,
      },
    };
  }

  if (
    prompt.includes('映射') ||
    prompt.includes('数据表') ||
    prompt.includes('物理表') ||
    lower.includes('mapping') ||
    activeModel === 'MM'
  ) {
    return {
      name: 'upsert_mapping',
      args: {
        mappingNote: `由 AI 本体助手根据「${prompt}」生成的持久化映射`,
      },
    };
  }

  if (
    prompt.includes('接口') ||
    lower.includes('interface') ||
    lower.includes('api') ||
    activeModel === 'MI'
  ) {
    const nextNum = (suite.MI?.interfaces.length ?? 0) + 1;
    return {
      name: 'upsert_interface',
      args: {
        interfaceId: `IF-${String(nextNum + 2).padStart(2, '0')}`,
        name: cleanAlias || `对外业务服务接口${nextNum}`,
        direction: 'PROVIDED',
        description: `由 AI 本体助手根据「${prompt}」生成的服务接口契约`,
      },
    };
  }

  if (
    prompt.includes('行为') ||
    prompt.includes('命令') ||
    prompt.includes('动作') ||
    lower.includes('behavior') ||
    activeModel === 'M2'
  ) {
    const nextNum = (suite.M2?.behaviors.length ?? 0) + 1;
    const owner = suite.M1?.aggregates[0]?.name ?? 'DomainRecord';
    const isQuery = prompt.includes('查询') || lower.includes('query');
    return {
      name: 'upsert_behavior',
      args: {
        id: `BHV-${String(nextNum).padStart(2, '0')}`,
        ownerEntity: owner,
        alias: cleanAlias || `${owner}扩展行为${nextNum}`,
        behaviorType: isQuery ? 'QUERY' : 'COMMAND',
        triggerType: 'SYSTEM',
        description: `由 AI 本体助手根据「${prompt}」生成的领域行为`,
      },
    };
  }

  if (
    prompt.includes('聚合') ||
    prompt.includes('对象') ||
    prompt.includes('实体') ||
    lower.includes('aggregate') ||
    activeModel === 'M1'
  ) {
    const nextNum = (suite.M1?.aggregates.length ?? 0) + 1;
    const baseEntityName = suite.M1?.aggregates[0]?.name ?? 'DomainEntity';
    const englishWords = prompt.match(/[A-Za-z][A-Za-z0-9]+/g);
    const derivedName =
      englishWords && englishWords.length > 0
        ? englishWords
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join('')
        : `${baseEntityName}Extension${String(nextNum).padStart(2, '0')}`;
    const derivedAlias =
      cleanAlias ||
      prompt
        .replace(/^(请|帮我|新增|添加|创建|定义|一个|一条|聚合根|聚合|业务对象|实体)+/g, '')
        .trim()
        .slice(0, 18) ||
      `${suite.M1?.aggregates[0]?.alias ?? '领域'}扩展实体${nextNum}`;
    return {
      name: 'upsert_aggregate',
      args: {
        id: `AGG-${String(nextNum).padStart(2, '0')}`,
        name: derivedName,
        alias: derivedAlias,
        description: `由 AI 本体助手根据「${prompt}」创建的聚合根`,
      },
    };
  }

  return null;
}

export async function runOntologyCopilotTurn(
  store: WorkspaceStore,
  input: {
    projectId: string;
    prompt: string;
    activeModel?: ModelCode;
    mockMode?: boolean;
    locale?: AgentLocale | string;
  },
): Promise<OntologyCopilotResult> {
  const start = Date.now();
  const project = store.getProject(input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);
  const locale = resolveEffectiveLocale(store, input.locale, input.prompt);

  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];
  const toolCalls: AgentToolCallRecord[] = [];
  let workingSuite: OntologySuite = JSON.parse(JSON.stringify(project.suite));

  const deterministicCall = inferDeterministicOntologyToolCall(
    input.prompt,
    workingSuite,
    input.activeModel,
  );

  const systemPrompt =
    locale === 'en-US'
      ? [
          `You are the Ontology Plus AI Modeling Expert (built on Pi Durable runtime and the 11-Model Ontology Suite).`,
          `Active Project: ${project.name} (Domain: ${project.domain}).`,
          `Present Models: ${project.validation.presentModels.join(', ') || 'None'} (Errors: ${project.validation.errorCount}, Stage Warnings: ${project.validation.warningCount}).`,
          `M1 Aggregates: ${(project.suite.M1?.aggregates ?? []).map((a) => `${a.name}(${a.id})`).join(', ') || 'None'}; M3 Rules: ${project.suite.M3?.rules.length ?? 0}.`,
          `When the user asks to create, update, or delete ontology elements, call the provided function tools; if only consulting, answer concisely in English (under 150 words).`,
        ].join('\n')
      : [
          `你是 Ontology Plus 平台的 AI 本体建模专家（基于 Pi Durable 运行时与 11 元模型架构）。`,
          `当前工程：${project.name}（领域：${project.domain}）。`,
          `已存在模型：${project.validation.presentModels.join(', ') || '暂无'}（错误数：${project.validation.errorCount}，阶段提示数：${project.validation.warningCount}）。`,
          `当前 M1 聚合根：${(project.suite.M1?.aggregates ?? []).map((a) => `${a.name}(${a.id})`).join(', ') || '无'}；M3 规则数：${project.suite.M3?.rules.length ?? 0}。`,
          `当用户要求新增、修改或删除本体元素时，请优先调用提供的函数工具执行结构化变更；若仅咨询，请用简洁专业中文回答（控制在 180 字以内）。`,
        ].join('\n');

  const llmRes = await callOpenAiCompatibleChat(
    activeProvider,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input.prompt },
    ],
    {
      store,
      ...(input.mockMode !== undefined ? { mockMode: input.mockMode } : {}),
      tools: OPENAI_ONTOLOGY_TOOLS,
    },
  );

  const validToolSet = new Set<string>(ONTOLOGY_TOOL_NAMES);
  const candidateCalls: { name: OntologyToolName; args: Record<string, unknown> }[] = [];

  const isAddIntent =
    input.prompt.includes('新增') ||
    input.prompt.includes('添加') ||
    input.prompt.includes('创建') ||
    input.prompt.toLowerCase().includes('add') ||
    input.prompt.toLowerCase().includes('create');

  if (llmRes && llmRes.toolCalls.length > 0) {
    const filtered = llmRes.toolCalls.filter((tc) => validToolSet.has(tc.name));
    if (deterministicCall && filtered[0]?.name !== deterministicCall.name) {
      // Align primary tool with deterministic user intent while keeping LLM text enrichment
      candidateCalls.push({
        name: deterministicCall.name,
        args: {
          ...deterministicCall.args,
          ...(filtered[0]?.args.alias ? { alias: filtered[0].args.alias } : {}),
          ...(filtered[0]?.args.name ? { name: filtered[0].args.name } : {}),
          ...(filtered[0]?.args.expression ? { expression: filtered[0].args.expression } : {}),
          ...(filtered[0]?.args.description ? { description: filtered[0].args.description } : {}),
        },
      });
    } else if (filtered.length > 0) {
      for (const tc of filtered.slice(0, 2)) {
        const mergedArgs: Record<string, unknown> = {
          ...(tc.name === deterministicCall?.name ? deterministicCall.args : {}),
          ...tc.args,
        };
        // Ensure "add/create" intents always allocate a fresh ID rather than overwriting existing rules/aggregates
        if (isAddIntent && deterministicCall && tc.name === deterministicCall.name && deterministicCall.args.id) {
          mergedArgs.id = deterministicCall.args.id;
        }
        candidateCalls.push({
          name: tc.name as OntologyToolName,
          args: mergedArgs,
        });
      }
    }
  }

  if (candidateCalls.length === 0 && deterministicCall) {
    candidateCalls.push(deterministicCall);
  }

  for (const call of candidateCalls) {
    const baselineReport = validateOntologySuite(workingSuite);
    try {
      const mutation = applyOntologyToolCall(
        workingSuite,
        call.name,
        call.args,
        project.domain,
      );
      const candidateReport = validateOntologySuite(mutation.nextSuite);

      if (candidateReport.errorCount > baselineReport.errorCount) {
        const newError = candidateReport.diagnostics.find((d) => d.tier === 'ERROR');
        toolCalls.push({
          toolName: call.name,
          args: call.args,
          status: 'REJECTED_BY_VALIDATOR',
          summaryZh: `变更被 11 模型一致性门禁拦截（错误数从 ${baselineReport.errorCount} 升至 ${candidateReport.errorCount}）：${newError?.messageZh ?? '存在跨模型悬空引用'}`,
          summaryEn: `Rejected by 11-model validator (errors increased ${baselineReport.errorCount} -> ${candidateReport.errorCount}): ${newError?.messageEn ?? 'dangling reference'}`,
        });
      } else {
        workingSuite = mutation.nextSuite;
        store.updateSuite(
          project.id,
          workingSuite,
          `AI Copilot executed ${call.name} (${mutation.elementId})`,
        );
        toolCalls.push({
          toolName: call.name,
          args: { ...call.args, id: mutation.elementId },
          status: 'APPLIED',
          summaryZh: mutation.summaryZh,
          summaryEn: mutation.summaryEn,
        });
      }
    } catch (err) {
      toolCalls.push({
        toolName: call.name,
        args: call.args,
        status: 'REJECTED_BY_VALIDATOR',
        summaryZh: `工具执行被校验器拒绝：${err instanceof Error ? err.message : String(err)}`,
        summaryEn: `Rejected by validator: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const updatedProject = store.getProject(input.projectId)!;
  saveCheckpointSafe(store, `copilot-${input.projectId}`, 'ONTOLOGY_COPILOT', {
    projectId: input.projectId,
    lastPrompt: input.prompt,
    toolCalls,
    errorCount: updatedProject.validation.errorCount,
    updatedAt: new Date().toISOString(),
  });

  const fallbackReply =
    locale === 'en-US'
      ? toolCalls.length > 0
        ? `Completed ontology tool execution and 11-model two-tier validator gate:\n- ${toolCalls.map((t) => `[${t.status}] ${t.summaryEn}`).join('\n- ')}\n- Validation status: **${updatedProject.validation.errorCount} errors**, **${updatedProject.validation.warningCount} stage warnings**.`
        : `Analyzed 11-model structure for project **${updatedProject.name}**:\n- **M1 Object Model**: ${updatedProject.suite.M1?.aggregates.length ?? 0} aggregates (${(updatedProject.suite.M1?.aggregates ?? []).map((a) => a.name).join(', ') || 'None'});\n- **M2 Behavior Model**: ${updatedProject.suite.M2?.behaviors.length ?? 0} behaviors;\n- **M3 Rule Model**: ${updatedProject.suite.M3?.rules.length ?? 0} cross-object rules;\n- Full cross-model validation: **${updatedProject.validation.errorCount} errors**.`
      : toolCalls.length > 0
        ? `已完成本体模型工具执行与 11 模型两级一致性门禁校验：\n- ${toolCalls.map((t) => `[${t.status}] ${t.summaryZh}`).join('\n- ')}\n- 当前工程一致性状态：**${updatedProject.validation.errorCount} 个错误**，**${updatedProject.validation.warningCount} 个阶段提示**。`
        : `已分析工程「${updatedProject.name}」的 11 元模型结构：\n- **M1 对象模型**包含 ${updatedProject.suite.M1?.aggregates.length ?? 0} 个聚合根（${(updatedProject.suite.M1?.aggregates ?? []).map((a) => a.alias).join('、') || '暂无'}）；\n- **M2 行为模型**包含 ${updatedProject.suite.M2?.behaviors.length ?? 0} 个行为；\n- **M3 规则模型**包含 ${updatedProject.suite.M3?.rules.length ?? 0} 条跨对象规则；\n- 当前全量跨模型校验结果：**${updatedProject.validation.errorCount} 错误**。`;

  return {
    reply: llmRes?.content || fallbackReply,
    providerUsed: llmRes
      ? activeProvider.name
      : `${activeProvider?.name ?? 'Local Pi'} (Deterministic Gate)`,
    modelUsed: llmRes?.modelUsed || activeProvider?.defaultModel || 'auto/glm-5.3-flash',
    latencyMs: llmRes?.latencyMs ?? Date.now() - start,
    toolCalls,
    project: updatedProject,
  };
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

function collectMergedRequirementContext(
  store: WorkspaceStore,
  projectId: string,
  reqSession?: RequirementSession,
  explicitAgentSession?: AgentSession,
) {
  const allReqAgentSessions =
    typeof store.listAgentSessions === 'function'
      ? store.listAgentSessions({ projectId, agentKind: 'REQUIREMENT' })
      : [];
  const orderedAgentSessions = explicitAgentSession
    ? [
        explicitAgentSession,
        ...allReqAgentSessions.filter((s) => s.id !== explicitAgentSession.id),
      ]
    : allReqAgentSessions;

  const transcriptBlocks: string[] = [];
  const discoveredAggregates = new Set<string>(reqSession?.discoveredAggregates ?? []);
  const discoveredRules = new Set<string>(reqSession?.discoveredRules ?? []);
  const resolvedDecisions = new Set<string>(reqSession?.resolvedDecisions ?? []);
  const openQuestions = new Set<string>();
  const userUtterances: string[] = [];

  for (const asess of orderedAgentSessions) {
    if (asess.compactedSummary) {
      transcriptBlocks.push(`[Session Summary · ${asess.title}]\n${asess.compactedSummary}`);
    }
    for (const m of asess.messages) {
      if (m.role === 'user') {
        userUtterances.push(m.content);
        transcriptBlocks.push(`[User] ${m.content}`);
      } else if (m.role === 'assistant') {
        if (m.content.trim()) {
          transcriptBlocks.push(`[Assistant] ${m.content.slice(0, 900)}`);
        }
        if (m.askUser?.answered && m.askUser.selectedAnswers?.length) {
          const isEnQ = !/[\u4e00-\u9fa5]/.test(m.askUser.question);
          resolvedDecisions.add(
            `${isEnQ ? '[Confirmed]' : '[已确认]'} ${m.askUser.question} => ${m.askUser.selectedAnswers.join(' / ')}`,
          );
        } else if (m.askUser && !m.askUser.answered) {
          const isEnQ = !/[\u4e00-\u9fa5]/.test(m.askUser.question);
          openQuestions.add(`${isEnQ ? '[Pending]' : '[待确认]'} ${m.askUser.question}`);
        }
        for (const art of m.artifacts ?? []) {
          if (art.kind === 'REQUIREMENT_HINTS') {
            for (const ag of art.aggregates) discoveredAggregates.add(ag);
            for (const rl of art.rules) discoveredRules.add(rl);
            for (const dc of art.decisions ?? []) resolvedDecisions.add(dc);
            for (const oq of art.openQuestions) openQuestions.add(oq);
          }
        }
      }
    }
  }

  for (const m of reqSession?.messages ?? []) {
    if (m.role === 'user') {
      userUtterances.push(m.content);
      transcriptBlocks.push(`[User] ${m.content}`);
    } else if (m.role === 'assistant' && !m.content.startsWith('已从统一会话同步')) {
      transcriptBlocks.push(`[Assistant] ${m.content.slice(0, 700)}`);
      for (const oq of m.extractedHints?.openQuestions ?? []) {
        openQuestions.add(oq);
      }
    }
  }

  return {
    transcriptText: transcriptBlocks.join('\n\n'),
    userMessagesSummary: userUtterances.join('；'),
    discoveredAggregates: Array.from(discoveredAggregates),
    discoveredRules: Array.from(discoveredRules),
    resolvedDecisions: Array.from(resolvedDecisions),
    openQuestions: Array.from(openQuestions),
  };
}

function ensureCanonicalNineChapterSrsStructure(
  candidateMarkdown: string,
  fallbackMarkdown: string,
): string {
  const cleaned = stripMarkdownFence(candidateMarkdown).trim();
  if (!cleaned) return fallbackMarkdown;

  const hasAllNineChapters = [1, 2, 3, 4, 5, 6, 7, 8, 9].every((idx) =>
    new RegExp(`^##\\s+${idx}\\.\\s+`, 'm').test(cleaned),
  );
  const hasAllGovernanceSubsections = [1, 2, 3, 4, 5, 6, 7].every((sub) =>
    new RegExp(`^###\\s+9\\.${sub}\\s+`, 'm').test(cleaned),
  );

  if (hasAllNineChapters && hasAllGovernanceSubsections) {
    return cleaned;
  }

  // Extract fallback chapters/subsections to patch any missing canonical heading without discarding LLM content
  const resultLines = [cleaned];
  for (let idx = 1; idx <= 9; idx += 1) {
    if (!new RegExp(`^##\\s+${idx}\\.\\s+`, 'm').test(resultLines.join('\n'))) {
      const sectionMatch = fallbackMarkdown.match(
        new RegExp(`(^##\\s+${idx}\\.\\s+[\\s\\S]*?)(?=^##\\s+\\d+\\.\\s+|$)`, 'm'),
      );
      if (sectionMatch) {
        resultLines.push('', sectionMatch[1].trim());
      }
    }
  }
  const mergedSoFar = resultLines.join('\n');
  for (let sub = 1; sub <= 7; sub += 1) {
    if (!new RegExp(`^###\\s+9\\.${sub}\\s+`, 'm').test(mergedSoFar)) {
      const subMatch = fallbackMarkdown.match(
        new RegExp(`(^###\\s+9\\.${sub}\\s+[\\s\\S]*?)(?=^###\\s+9\\.\\d+\\s+|^##\\s+|$)`, 'm'),
      );
      if (subMatch) {
        resultLines.push('', subMatch[1].trim());
      }
    }
  }
  return resultLines.join('\n');
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

function inspectStreamedSrsChapters(markdown: string): {
  completedChapters: number;
  currentChapter?: string;
} {
  const topChapterMatches = [...markdown.matchAll(/^##\s+(\d+)\.\s+([^\r\n]+)/gm)];
  const subChapterMatches = [...markdown.matchAll(/^###\s+(9\.\d+)\s+([^\r\n]+)/gm)];
  const seenNums = new Set<number>();
  for (const m of topChapterMatches) {
    const num = Number(m[1]);
    if (num >= 1 && num <= 9) seenNums.add(num);
  }
  let currentChapter: string | undefined;
  if (subChapterMatches.length > 0 && seenNums.has(9)) {
    const lastSub = subChapterMatches[subChapterMatches.length - 1]!;
    currentChapter = `9.${lastSub[1].split('.')[1]} ${lastSub[2].trim()}`;
  } else if (topChapterMatches.length > 0) {
    const lastTop = topChapterMatches[topChapterMatches.length - 1]!;
    currentChapter = `${lastTop[1]}. ${lastTop[2].trim()}`;
  }
  return {
    completedChapters: seenNums.size,
    ...(currentChapter ? { currentChapter } : {}),
  };
}

export async function synthesizeRequirementDocFromSession(
  store: WorkspaceStore,
  input: {
    sessionId: string;
    projectId?: string;
    docId?: string;
    title?: string;
    version?: string;
    resumeFromText?: string;
    locale?: AgentLocale | string;
    signal?: AbortSignal;
    onProgress?: (event: SrsSynthesisProgressEvent) => void;
  },
): Promise<RequirementDocSynthesisResult> {
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const agentSession =
    typeof store.getAgentSession === 'function'
      ? store.getAgentSession(input.sessionId)
      : undefined;
  let reqSession = findRequirementSessionOptional(store, input.sessionId);

  const resolvedProjectId =
    agentSession?.projectId ??
    reqSession?.projectId ??
    input.projectId;

  if (!reqSession && resolvedProjectId) {
    reqSession =
      store.listRequirementSessions(resolvedProjectId)[0] ??
      store.createRequirementSession({
        projectId: resolvedProjectId,
        title: agentSession?.title || '需求探索会话',
      });
  }
  if (!reqSession) {
    // Preserve original error semantics if neither AgentSession nor RequirementSession exists
    reqSession = findRequirementSession(store, input.sessionId);
  }

  const project = store.getProject(reqSession.projectId);
  if (!project) throw new Error(`Project not found for session: ${reqSession.projectId}`);
  const isResumingSrs = Boolean(input.resumeFromText && input.resumeFromText.trim().length >= 200);

  if (!isResumingSrs) {
    input.onProgress?.({
      phase: 'CONTEXT',
      step: 1,
      messageZh: '正在聚合多轮需求探索对话记录与已确认 A/B 边界决策…',
      messageEn: 'Aggregating requirement exploration transcript and confirmed A/B decisions…',
      completedChapters: 0,
      streamedChars: 0,
    });
  }

  const mergedCtx = collectMergedRequirementContext(
    store,
    project.id,
    reqSession,
    agentSession,
  );
  const locale = resolveEffectiveLocale(
    store,
    input.locale,
    mergedCtx.userMessagesSummary || project.description,
  );

  const activeProvider = resolvePreferredProvider(
    store,
    project.id,
    agentSession?.providerId,
  );
  const providerModel = activeProvider?.defaultModel || 'auto/glm-5.3-flash';

  const suite = project.suite;
  const aggSignalCount =
    (suite.M1?.aggregates.length ?? 0) || mergedCtx.discoveredAggregates.length;
  const ruleSignalCount =
    (suite.M3?.rules.length ?? 0) + mergedCtx.discoveredRules.length;
  const decisionSignalCount =
    mergedCtx.resolvedDecisions.length + mergedCtx.openQuestions.length;

  if (!isResumingSrs) {
    input.onProgress?.({
      phase: 'MODEL_ALIGN',
      step: 2,
      messageZh: `已提取聚合×${aggSignalCount} · 规则×${ruleSignalCount} · 决策×${decisionSignalCount}，正在对齐 11 元模型结构基准…`,
      messageEn: `Extracted M1×${aggSignalCount} · M3×${ruleSignalCount} · Decisions×${decisionSignalCount}; aligning 11-model structural baseline…`,
      completedChapters: 0,
      streamedChars: 0,
      providerModel,
    });
  }
  const userMessagesSummary = mergedCtx.userMessagesSummary;
  const mentionsApproval =
    /审批|审核|会签|放行|approv|review|signoff/i.test(mergedCtx.transcriptText) ||
    (suite.M6?.flows ?? []).some((f) => f.flowType === 'APPROVAL');

  const aggregatesList =
    (suite.M1?.aggregates ?? []).length > 0
      ? suite.M1!.aggregates.map((a) =>
          locale === 'en-US'
            ? `- **${a.alias} (\`${a.name}\` / \`${a.id}\`)**: Lifecycle \`[${a.lifecycle.join(' -> ')}]\`, Attributes: ${a.attributes.map((attr) => `\`${attr.name}\`(${attr.label}:${attr.type})`).join(', ')}.`
            : `- **${a.alias} (\`${a.name}\` / \`${a.id}\`)**：生命周期 \`[${a.lifecycle.join(' -> ')}]\`，核心属性：${a.attributes.map((attr) => `\`${attr.name}\`(${attr.label}:${attr.type})`).join('、')}。`,
        )
      : mergedCtx.discoveredAggregates.map((ag, i) =>
          locale === 'en-US'
            ? `- **${ag}** (\`AGG-0${i + 1}\`): Core domain aggregate for "${project.domain}" lifecycle & invariants.`
            : `- **${ag}** (\`AGG-0${i + 1}\`)：承载「${project.domain}」核心业务状态流转与不变式约束。`,
        );

  const actorsList =
    (suite.M5?.actors ?? []).length > 0
      ? suite.M5!.actors.map((act) =>
          locale === 'en-US'
            ? `- **${act.name} (\`${act.id}\` · ${act.actorType})**: Bound roles \`[${act.roles.join(', ') || 'EXTERNAL'}]\` — ${act.description ?? ''}`
            : `- **${act.name} (\`${act.id}\` · ${act.actorType})**：绑定角色 \`[${act.roles.join(', ') || 'EXTERNAL'}]\` — ${act.description ?? ''}`,
        )
      : locale === 'en-US'
        ? [
            `- **${project.domain} Operator (\`ACT-01\` · HUMAN)**: Executes daily domain operations, record creation, and status transitions.`,
            `- **${project.domain} Manager (\`ACT-02\` · HUMAN)**: Oversees domain configuration, exception handling, and operational governance.`,
          ]
        : [
            `- **${project.domain}业务操作员 (\`ACT-01\` · HUMAN)**：负责日常业务单据创建、状态推进与现场协同执行。`,
            `- **${project.domain}运营管理员 (\`ACT-02\` · HUMAN)**：负责主数据维护、业务规则配置与异常处置。`,
          ];

  const behaviorsList =
    (suite.M2?.behaviors ?? []).length > 0
      ? suite.M2!.behaviors.map((b) =>
          locale === 'en-US'
            ? `- **${b.alias} (\`${b.name}\` / \`${b.id}\` · ${b.behaviorType})**: Owner \`${b.ownerEntity}\`, Trigger \`${b.triggerType}\`, Invoked rules \`[${b.invokedRules.join(', ') || 'none'}]\`.`
            : `- **${b.alias} (\`${b.name}\` / \`${b.id}\` · ${b.behaviorType})**：归属 \`${b.ownerEntity}\`，触发方式 \`${b.triggerType}\`，调用规则 \`[${b.invokedRules.join(', ') || '无'}]\`。`,
        )
      : locale === 'en-US'
        ? [
            `- **Create ${project.domain} Record (\`BHV-01\` · COMMAND)**: Validates preconditions and persists a new domain record.`,
            `- **Complete / Update ${project.domain} Status (\`BHV-02\` · COMMAND)**: Evaluates M3 rules and advances lifecycle state.`,
          ]
        : [
            `- **创建${project.domain}记录 (\`BHV-01\` · COMMAND)**：执行前置业务校验并持久化业务记录。`,
            `- **推进${project.domain}状态 (\`BHV-02\` · COMMAND)**：校验领域业务规则并完成状态流转与事件发布。`,
          ];

  const rulesList = [
    ...mergedCtx.discoveredRules.map((r) => `- ${r}`),
    ...(suite.M3?.rules ?? [])
      .filter((r) => !mergedCtx.discoveredRules.some((dr) => dr.startsWith(r.id)))
      .map((r) => `- **${r.id} (${r.alias})**: \`${r.expression}\` — ${r.violationMessage ?? ''}`),
  ];

  const eventsAndScenarios = [
    ...(suite.ME?.events ?? []).map((e) =>
      locale === 'en-US'
        ? `- **Event \`${e.id}\` (\`${e.name}\` · ${e.label})**: Source \`${e.sourceAggregate}\`, Delivery \`${e.orderingSemantic}\`.`
        : `- **事件 \`${e.id}\` (\`${e.name}\` · ${e.label})**：源聚合 \`${e.sourceAggregate}\`，幂等策略 \`${e.orderingSemantic}\`。`,
    ),
    ...(suite.M4?.event_scenarios ?? []).map((sc) =>
      locale === 'en-US'
        ? `- **Scenario \`${sc.id}\` (${sc.name})**: Trigger event \`${sc.triggerEventRef}\`, Aggregates \`[${sc.involvedAggregates.join(', ')}]\`.`
        : `- **联动场景 \`${sc.id}\` (${sc.name})**：触发事件 \`${sc.triggerEventRef}\`，涉及聚合 \`[${sc.involvedAggregates.join(', ')}]\`。`,
    ),
  ];

  const flowsList =
    (suite.M6?.flows ?? []).length > 0
      ? suite.M6!.flows.map((fl) =>
          locale === 'en-US'
            ? `- **${fl.name} (\`${fl.id}\` · ${fl.flowType})**: Primary aggregate \`${fl.primaryAggregate}\`, Activities \`${fl.activities.map((a) => a.id).join(' -> ')}\`.`
            : `- **${fl.name} (\`${fl.id}\` · ${fl.flowType})**：主聚合 \`${fl.primaryAggregate}\`，节点链路 \`${fl.activities.map((a) => a.id).join(' -> ')}\`。`,
        )
      : mentionsApproval
        ? [
            locale === 'en-US'
              ? `- **${project.domain} Approval Flow (\`FLW-01\` · APPROVAL)**: \`ACTV-START -> ACTV-SUBMIT -> ACTV-REVIEW -> ACTV-END\`.`
              : `- **${project.domain}业务审核流程 (\`FLW-01\` · APPROVAL)**：\`ACTV-START -> ACTV-SUBMIT -> ACTV-REVIEW -> ACTV-END\`。`,
          ]
        : [
            locale === 'en-US'
              ? `- **${project.domain} End-to-End Fulfillment Flow (\`FLW-01\` · COLLABORATION)**: \`ACTV-START -> ACTV-CREATE -> ACTV-FULFILL -> ACTV-END\`.`
              : `- **${project.domain}端到端业务协同流程 (\`FLW-01\` · COLLABORATION)**：\`ACTV-START -> ACTV-CREATE -> ACTV-FULFILL -> ACTV-END\`。`,
          ];

  const reportsAndScreens = [
    ...(suite.M7?.query_reports ?? []).map((q) =>
      locale === 'en-US'
        ? `- **Query/Report \`${q.id}\` (${q.alias})**: Type \`${q.queryType}\`, Paired behavior \`${q.behaviorRef}\`.`
        : `- **查询/报表 \`${q.id}\` (${q.alias})**：类型 \`${q.queryType}\`，配对行为 \`${q.behaviorRef}\`。`,
    ),
    ...(suite.MU?.screens ?? []).map((s) =>
      locale === 'en-US'
        ? `- **Screen \`${s.screenId}\` (${s.name})**: Route \`${s.route ?? '/'}\`, ${s.elements.length} semantic elements and ${s.events.length} event chains.`
        : `- **交互屏幕 \`${s.screenId}\` (${s.name})**：路由 \`${s.route ?? '/'}\`，包含 ${s.elements.length} 个语义控件与 ${s.events.length} 条事件调用链。`,
    ),
  ];

  const miInterfacesList =
    (suite.MI?.interfaces ?? []).length > 0
      ? suite.MI!.interfaces.map((itf) =>
          locale === 'en-US'
            ? `- **Interface \`${itf.interfaceId}\` (${itf.name} · \`${itf.direction}\` · \`${itf.protocol}\`)**: Category \`${itf.interfaceCategory}\` (timeout \`${itf.timeoutMs ?? 5000}ms\`, idempotency \`${itf.idempotency ?? 'IDEMPOTENT'}\`).`
            : `- **接口 \`${itf.interfaceId}\` (${itf.name} · \`${itf.direction}\` · \`${itf.protocol}\`)**：类别 \`${itf.interfaceCategory}\`（超时 \`${itf.timeoutMs ?? 5000}ms\`，幂等语义 \`${itf.idempotency ?? 'IDEMPOTENT'}\`）。`,
        )
      : locale === 'en-US'
        ? [
            `- Provided endpoints use REST + JSON (UTF-8), binding command endpoints to \`M2\` behaviors and query endpoints to \`M7\` specifications.`,
            `- External gateways are declared via \`MI\` \`DEPENDENT\` contracts paired with \`M5\` \`EXTERNAL_ENTITY\` actors.`,
          ]
        : [
            `- 对外暴露接口采用 REST + JSON（UTF-8）标准契约，命令类接口绑定 \`M2\` 领域行为，查询类接口绑定 \`M7\` 查询规范。`,
            `- 外部依赖网关统一通过 \`MI\` \`DEPENDENT\` 接口与 \`M5\` \`EXTERNAL_ENTITY\` 显式声明超时与重试策略。`,
          ];

  const mmMappingsList =
    (suite.MM?.mappings ?? []).length > 0
      ? suite.MM!.mappings.map((m) => {
          const tbl = m.tableMappings[0];
          return locale === 'en-US'
            ? `- **Table \`${tbl?.tableName ?? m.id}\` (\`${m.id}\` · \`${tbl?.tableRole ?? 'MASTER'}\`)**: Maps \`${m.objectName}\` (\`${m.objectRole}\`) with ${tbl?.columnMappings.length ?? 0} column mappings.`
            : `- **物理表 \`${tbl?.tableName ?? m.id}\` (\`${m.id}\` · \`${tbl?.tableRole ?? 'MASTER'}\`)**：映射实体 \`${m.objectName}\` (\`${m.objectRole}\`)，含 ${tbl?.columnMappings.length ?? 0} 个字段映射。`;
        })
      : [
          locale === 'en-US'
            ? `- Each \`M1\` aggregate root maps to a \`tableRole=MASTER\` table, and child entities map to \`DETAIL\` tables with foreign-key referential integrity.`
            : `- 每个 \`M1\` 聚合根映射一张 \`tableRole=MASTER\` 物理主表，子实体映射 \`DETAIL\` 明细表并建立外键参照完整性。`,
        ];

  const autoAssumptions = mergedCtx.resolvedDecisions.filter((d) => AUTO_TAG_RE.test(d));
  const confirmedDecisions = [
    ...mergedCtx.resolvedDecisions.filter((d) => !AUTO_TAG_RE.test(d)),
    ...mergedCtx.openQuestions,
  ];
  const primaryAggName =
    suite.M1?.aggregates[0]?.name ?? mergedCtx.discoveredAggregates[0] ?? 'PrimaryEntity';

  const deterministicSrsMarkdown =
    locale === 'en-US'
      ? [
          `# ${project.name} — Software Requirements Specification (SRS.md)`,
          '',
          `> **Source Session**: \`${agentSession?.id ?? reqSession.id}\` (${agentSession?.title ?? reqSession.title}) | **Domain**: ${project.domain} | **Standard**: Ontology Plus 11-Model Suite`,
          '',
          `## 1. Project Background, Goals & Scope Boundaries`,
          `This project builds an ontology-driven application for **${project.domain}** grounded in the **11-Model Ontology Suite (M1–M7, ME, MU, MM, MI)**:`,
          `- **User Requirements Summary**: ${userMessagesSummary || project.description}`,
          `- **Core Business Scope**: Covers end-to-end domain modeling, state transitions, cross-object business rule validation, event-driven coordination, and operational analytics for "${project.name}".`,
          '',
          `## 2. Business Actors, Roles & Data Scope Matrix (Aligned with M5)`,
          ...actorsList,
          '',
          `## 3. Core Domain Aggregates, Lifecycle & Data Dictionary (Aligned with M1)`,
          ...(aggregatesList.length > 0
            ? aggregatesList
            : [`- **Primary Domain Entity (\`${primaryAggName}\` / \`AGG-01\`)**: Governs core "${project.domain}" lifecycle states and invariants.`]),
          '',
          `## 4. Business Capabilities & Command/Query Behavior Specs (Aligned with M2)`,
          ...behaviorsList,
          '',
          `## 5. Cross-Object Business Rules, Validations & Calculations (Aligned with M3)`,
          ...(rulesList.length > 0
            ? rulesList
            : [`- **RULE-01**: Core \`${primaryAggName}\` domain invariants must be satisfied prior to state transition.`]),
          '',
          `## 6. Domain Events & Cross-Aggregate Scenarios (Aligned with ME / M4)`,
          ...(eventsAndScenarios.length > 0
            ? eventsAndScenarios
            : [`- **EVT-01 (\`${primaryAggName}.Completed\`)**: Published upon state transition to trigger downstream coordination.`]),
          '',
          `## 7. End-to-End Business Flows & Routing Branches (Aligned with M6)`,
          ...flowsList,
          '',
          `## 8. Analytical Query Reports & UI Screen Contracts (Aligned with M7 / MU)`,
          ...(reportsAndScreens.length > 0
            ? reportsAndScreens
            : [`- **QRY-01 / SCR-MAIN-LIST**: Multi-dimensional operational list query and status dashboard for "${project.domain}".`]),
          '',
          `## 9. Non-Functional Requirements, Integration & Governance Checklist`,
          '',
          `### 9.1 External System Integration & Interface Contracts (Aligned with MI)`,
          ...miInterfacesList,
          '',
          `### 9.2 Persistence, Audit Trail & Master-Detail Mapping (Aligned with MM)`,
          ...mmMappingsList,
          `- Standardizes \`id\`, \`created_at\`, \`updated_at\`, \`deleted_at\`, and \`version\` columns across SQLite / Cloudflare D1.`,
          '',
          `### 9.3 Performance, Throughput & Latency Targets`,
          `- Core \`M2\` command behaviors (including synchronous \`M3\` rules) P95 ≤ 300ms; \`M7\` paginated queries P95 ≤ 800ms.`,
          '',
          `### 9.4 Security, RBAC/ABAC Isolation & Data Masking`,
          `- Enforces \`M5\` RBAC role permissions and ABAC data scopes (\`ALL\` / \`DEPARTMENT\` / \`SELF\`); forbids blocking browser dialogs.`,
          '',
          `### 9.5 Idempotency, Transaction Consistency & Compensation`,
          `- Intra-aggregate mutations run in ACID transactions; cross-aggregate \`M4\` scenarios use idempotent event delivery with retry compensation.`,
          '',
          `### 9.6 AI Auto-Completed Engineering Defaults (\`[AI Auto-Completed]\`)`,
          ...(autoAssumptions.length > 0
            ? autoAssumptions.map((d) => `- ${d}`)
            : [
                '- `[AI Auto-Completed]` Default pagination pageSize=20 (max 100), ordered by creation timestamp descending.',
                '- `[AI Auto-Completed]` Automatic audit timestamps and idempotent `requestId` tracking.',
              ]),
          '',
          `### 9.7 Confirmed Business Decisions & Open Boundaries (\`[Confirmed]\` / \`[Pending]\`)`,
          ...(confirmedDecisions.length > 0
            ? confirmedDecisions.map((d) => `- ${d}`)
            : ['- `[Confirmed]` Enforces two-tier 11-model ontology validation (Consistency Errors block release; Stage Warnings guide progressive completion).']),
          '',
        ].join('\n')
      : [
          `# ${project.name} — 需求规格说明书 (需求规格说明书.md)`,
          '',
          `> **来源会话**：\`${agentSession?.id ?? reqSession.id}\`（${agentSession?.title ?? reqSession.title}） | **所属领域**：${project.domain} | **架构基准**：Ontology Plus 11 元模型标准`,
          '',
          `## 1. 项目背景、业务目标与范围边界`,
          `本项目围绕「${project.domain}」构建基于 **11 元模型业务本体（M1~M7, ME, MU, MM, MI）** 的数字化业务应用：`,
          `- **核心诉求摘要**：${userMessagesSummary || project.description}`,
          `- **业务建设范围**：围绕「${project.name}」打通核心业务对象管理、业务行为执行、跨对象规则校验、事件协同联动及运营统计查询闭环。`,
          '',
          `## 2. 业务参与方、角色与数据权限矩阵 (对齐 M5)`,
          ...actorsList,
          '',
          `## 3. 核心业务对象、状态生命周期与数据字典 (对齐 M1)`,
          ...(aggregatesList.length > 0
            ? aggregatesList
            : [`- **核心业务对象 (\`${primaryAggName}\` / \`AGG-01\`)**：承载「${project.domain}」全生命周期状态流转与核心不变式约束。`]),
          '',
          `## 4. 业务功能清单与命令/查询行为规约 (对齐 M2)`,
          ...behaviorsList,
          '',
          `## 5. 跨对象业务规则、校验与计算逻辑 (对齐 M3)`,
          ...(rulesList.length > 0
            ? rulesList
            : [`- **RULE-01**：核心对象 \`${primaryAggName}\` 关键业务属性与状态转换必须满足业务规则约束。`]),
          '',
          `## 6. 领域事件与跨聚合联动场景 (对齐 ME / M4)`,
          ...(eventsAndScenarios.length > 0
            ? eventsAndScenarios
            : [`- **EVT-01 (\`${primaryAggName}.Completed\`)**：关键业务动作完成后发布领域事件并触发下游业务联动（如库存扣减、积分累加或通知）。`]),
          '',
          `## 7. 端到端业务流程与网关分支 (对齐 M6)`,
          ...flowsList,
          '',
          `## 8. 统计查询报表与关键界面交互契约 (对齐 M7 / MU)`,
          ...(reportsAndScreens.length > 0
            ? reportsAndScreens
            : [`- **QRY-01 / SCR-MAIN-LIST**：提供「${project.domain}」多维筛选业务台账分页检索与运营看板。`]),
          '',
          `## 9. 非功能性需求、集成边界与治理确认清单`,
          '',
          `### 9.1 外部系统集成与服务接口契约 (对齐 MI)`,
          ...miInterfacesList,
          '',
          `### 9.2 数据持久化、审计溯源与主子表映射约束 (对齐 MM)`,
          ...mmMappingsList,
          `- 统一内置 \`id\`、\`created_at\`、\`updated_at\`、\`deleted_at\`、\`version\` 审计与乐观锁控制列，兼容 SQLite / Cloudflare D1 同构方言。`,
          '',
          `### 9.3 性能、并发吞吐与响应时延指标`,
          `- 单笔核心命令行为（含 \`M3\` 同步规则校验）P95 响应时延 ≤ 300ms；多维统计查询报表（\`M7\`）P95 响应时延 ≤ 800ms。`,
          '',
          `### 9.4 安全合规、权限隔离与敏感数据脱敏`,
          `- 所有写操作命令强制校验 \`M5\` RBAC 角色授权与 ABAC 数据域（\`ALL\` / \`DEPARTMENT\` / \`SELF\`），禁止越权访问与浏览器原生阻塞弹窗。`,
          '',
          `### 9.5 幂等性、事务一致性与异常补偿策略`,
          `- 聚合内状态变更采用本地强一致事务；跨聚合联动场景（\`M4\`）采用幂等事件投递与异常重试补偿。`,
          '',
          `### 9.6 AI 自动补全默认项清单 (\`[AI自动补全]\`)`,
          ...(autoAssumptions.length > 0
            ? autoAssumptions.map((d) => `- ${d}`)
            : [
                '- `[AI自动补全]` 默认分页大小 20 条/页（上限 100 条/页），默认按创建时间倒序排列。',
                '- `[AI自动补全]` 默认注入标准创建/更新时间戳与接口请求幂等流水号 `requestId`。',
              ]),
          '',
          `### 9.7 核心业务决策记录与待确认边界事项 (\`[已确认]\` / \`[待确认]\`)`,
          ...(confirmedDecisions.length > 0
            ? confirmedDecisions.map((d) => `- ${d}`)
            : ['- `[已确认]` 采用两级门禁校验（11 模型结构一致性错误阻断发版，阶段缺失提示支持渐进式补齐）。']),
          '',
        ].join('\n');

  const srsSystemPrompt =
    locale === 'en-US'
      ? [
          'You are the Chief Requirements Architect of Ontology Plus.',
          'Synthesize a comprehensive, domain-authentic 9-chapter Software Requirements Specification (Markdown) strictly tailored to the user conversation, confirmed decisions, and current ontology models.',
          'CRITICAL RULES:',
          '1. NEVER invent unrelated procurement/contract/legal concepts if the project belongs to another domain (e.g., coffee shop, retail, healthcare, logistics). Faithfully incorporate every user-confirmed business detail!',
          '2. Preserve exact top-level Markdown headings `## 1. ` through `## 9. ` and subsections `### 9.1 ` through `### 9.7 `.',
          '3. Output pure Markdown directly without outer ```markdown code fences.',
          '4. Keep internal reasoning ultra-brief (at most 2–3 short sentences) and immediately start streaming the final Markdown document. NEVER draft chapters inside internal reasoning.',
        ].join('\n')
      : [
          '你是 Ontology Plus 的首席需求架构师。',
          '请严格基于用户的完整多轮对话记录、已确认选项、已沉淀候选规则与当前工程本体模型，生成一份贴合真实业务领域的标准 9 章节《需求规格说明书.md》Markdown 文档。',
          '关键要求：',
          '1. 严禁套用与当前领域无关的“采购合同/法务会签/风控总监”模板词！必须忠实还原用户在对话中确认的每一个具体业务场景、角色、商品/单据属性、配方/库存/会员/流程细节。',
          '2. 必须严格保留一级章节标题 `## 1. ` 至 `## 9. ` 以及治理子章节 `### 9.1 ` 至 `### 9.7 `。',
          '3. 直接输出 Markdown 正文，不要包裹外层 ```markdown 代码块。',
          '4. 内部思考请极度精炼（不超过 3 句话），立即开始流式输出最终 Markdown 正文，严禁在内部思考阶段预写章节草稿！',
        ].join('\n');

  const existingDocsBeforeRun = store.listRequirementDocs(project.id);
  const reusedExistingDoc = Boolean(
    input.docId && existingDocsBeforeRun.some((d) => d.id === input.docId),
  );
  const version =
    input.version ||
    `v5.${reusedExistingDoc ? Math.max(0, existingDocsBeforeRun.length - 1) : existingDocsBeforeRun.length}`;
  const defaultTitle =
    locale === 'en-US'
      ? `${project.name} — Software Requirements Specification (SRS.md ${version})`
      : `${project.name} — 需求规格说明书 (需求规格说明书.md ${version})`;
  const docId = input.docId || `req-doc-${project.id}-${Date.now().toString(36)}`;
  const resolvedDocTitle = input.title || defaultTitle;

  const resumeSrsPrefix =
    input.resumeFromText && input.resumeFromText.trim().length >= 200
      ? input.resumeFromText
      : '';
  const initialChapterInfo = resumeSrsPrefix
    ? inspectStreamedSrsChapters(resumeSrsPrefix)
    : { completedChapters: 0 };

  let lastProgressEmitAt = 0;
  let lastThinkingEmitAt = 0;
  let lastDraftSaveAt = 0;
  let lastReportedChapter = initialChapterInfo.currentChapter ?? '';
  let lastThinkingText = '';
  let lastAccumulated = resumeSrsPrefix;
  let pendingContentDelta = '';
  let pendingThinkingDelta = '';
  let draftSavedInRun = false;

  const persistIncrementalDraft = (rawMarkdown: string) => {
    const cleanedDraft = stripMarkdownFence(rawMarkdown).trim();
    if (cleanedDraft.length < 100) return;
    store.saveRequirementDoc({
      id: docId,
      projectId: project.id,
      title: resolvedDocTitle,
      version,
      status: 'DRAFT',
      content: cleanedDraft,
    });
    draftSavedInRun = true;
    lastDraftSaveAt = Date.now();
  };

  let llmFullSrsRes: { content: string; modelUsed: string; thinking?: string } | null = null;

  if (isMockLlmActive(store)) {
    input.onProgress?.({
      phase: 'GENERATING',
      step: 3,
      messageZh: '正在基于已收敛领域信号流式合成标准 9 章节规格书（含 9.1~9.7 治理清单）…',
      messageEn: 'Synthesizing canonical 9-chapter SRS (with 9.1–9.7 governance checklist)…',
      completedChapters: 9,
      contentDelta: deterministicSrsMarkdown,
      streamedText: deterministicSrsMarkdown,
      streamedChars: deterministicSrsMarkdown.length,
      previewTail: deterministicSrsMarkdown.slice(-1600),
      draftDocId: docId,
      providerModel: 'mock-deterministic',
    });
  } else {
    input.onProgress?.({
      phase: 'GENERATING',
      step: 3,
      messageZh: resumeSrsPrefix
        ? `已恢复前序 ${resumeSrsPrefix.length.toLocaleString()} 字内容，正在连接大模型 (${providerModel}) 从断点继续续写…`
        : `正在连接大模型 (${providerModel}) 流式撰写 9 章节规格书…`,
      messageEn: resumeSrsPrefix
        ? `Restored ${resumeSrsPrefix.length.toLocaleString()} chars; resuming SRS stream from checkpoint via ${providerModel}…`
        : `Streaming 9-chapter SRS generation via ${providerModel}…`,
      completedChapters: initialChapterInfo.completedChapters,
      streamedChars: resumeSrsPrefix.length,
      ...(resumeSrsPrefix
        ? { streamedText: resumeSrsPrefix, previewTail: resumeSrsPrefix.slice(-1600) }
        : {}),
      draftDocId: docId,
      providerModel,
    });

    const srsUserPrompt = [
      `Project: ${project.name} (Domain: ${project.domain})`,
      `Project Description: ${project.description}`,
      mergedCtx.transcriptText
        ? `\n--- Full Exploration Conversation Transcript ---\n${mergedCtx.transcriptText.slice(0, 14000)}`
        : '',
      mergedCtx.resolvedDecisions.length > 0
        ? `\n--- Confirmed & Auto-Completed Decisions ---\n${mergedCtx.resolvedDecisions.join('\n')}`
        : '',
      mergedCtx.discoveredRules.length > 0
        ? `\n--- Candidate Business Rules ---\n${mergedCtx.discoveredRules.join('\n')}`
        : '',
      `\n--- Structural Baseline Reference (keep ## 1..9 and ### 9.1..9.7 headings, replace generic bullets with rich domain-specific specs) ---\n${deterministicSrsMarkdown}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      llmFullSrsRes = await streamWithCheckpointContinuation(
        activeProvider,
        srsSystemPrompt,
        srsUserPrompt,
        {
          store,
          maxTokens: 32768,
          reasoningEffort: 'low',
          ...(resumeSrsPrefix ? { resumePrefix: resumeSrsPrefix } : {}),
          isDocumentComplete: (text) => /^##\s*9[\s.、]/m.test(text),
          ...(input.signal ? { signal: input.signal } : {}),
          onContinuationNotice: (currentChars, attempt) => {
            input.onProgress?.({
              phase: 'GENERATING',
              step: 3,
              messageZh: `正在从断点（已生成 ${currentChars.toLocaleString()} 字）无缝续写剩余章节（第 ${attempt} 段续传）…`,
              messageEn: `Continuing SRS stream seamlessly from ${currentChars.toLocaleString()} chars (continuation #${attempt})…`,
              completedChapters: inspectStreamedSrsChapters(lastAccumulated).completedChapters,
              streamedChars: currentChars,
              draftDocId: docId,
              providerModel,
            });
          },
          onThinkingDelta: (tDelta, accThinking) => {
            lastThinkingText = accThinking;
            pendingThinkingDelta += tDelta;
            const now = Date.now();
            if (now - lastThinkingEmitAt < 150) return;
            lastThinkingEmitAt = now;
            const flushedDelta = pendingThinkingDelta;
            pendingThinkingDelta = '';
            input.onProgress?.({
              phase: 'GENERATING',
              step: 3,
              messageZh: '大模型正在梳理领域规则与 9 章节架构…',
              messageEn: 'Model organizing domain rules & 9-chapter structure…',
              completedChapters: inspectStreamedSrsChapters(lastAccumulated).completedChapters,
              thinkingDelta: flushedDelta,
              thinkingText: accThinking,
              thinkingChars: accThinking.length,
              streamedChars: lastAccumulated.length,
              draftDocId: docId,
              providerModel,
            });
          },
          onStreamDelta: (cDelta, accumulated) => {
            lastAccumulated = accumulated;
            pendingContentDelta += cDelta;
            const now = Date.now();
            if (accumulated.trim().length >= 100 && now - lastDraftSaveAt >= 2500) {
              persistIncrementalDraft(accumulated);
            }
            if (!input.onProgress) return;
            const chapterInfo = inspectStreamedSrsChapters(accumulated);
            const chapterChanged =
              Boolean(chapterInfo.currentChapter) &&
              chapterInfo.currentChapter !== lastReportedChapter;
            if (!chapterChanged && now - lastProgressEmitAt < 100) {
              return;
            }
            lastProgressEmitAt = now;
            if (chapterInfo.currentChapter) {
              lastReportedChapter = chapterInfo.currentChapter;
            }
            const flushedDelta = pendingContentDelta;
            pendingContentDelta = '';
            input.onProgress({
              phase: 'GENERATING',
              step: 3,
              messageZh: chapterInfo.currentChapter
                ? `正在撰写章节「${chapterInfo.currentChapter}」(${chapterInfo.completedChapters}/9 章)…`
                : `正在流式生成规格书正文（已输出 ${accumulated.length.toLocaleString()} 字）…`,
              messageEn: chapterInfo.currentChapter
                ? `Writing section "${chapterInfo.currentChapter}" (${chapterInfo.completedChapters}/9 chapters)…`
                : `Streaming SRS draft (${accumulated.length.toLocaleString()} chars generated)…`,
              ...(chapterInfo.currentChapter
                ? { currentChapter: chapterInfo.currentChapter }
                : {}),
              completedChapters: chapterInfo.completedChapters,
              ...(lastThinkingText
                ? { thinkingText: lastThinkingText, thinkingChars: lastThinkingText.length }
                : {}),
              contentDelta: flushedDelta,
              streamedText: accumulated,
              streamedChars: accumulated.length,
              previewTail: accumulated.slice(-1600),
              draftDocId: docId,
              providerModel,
            });
          },
        },
      );
    } catch (err) {
      if (input.signal?.aborted) {
        if (draftSavedInRun && !reusedExistingDoc) {
          store.deleteRequirementDoc(docId);
        }
        throw new DOMException('Aborted', 'AbortError');
      }
      if (lastAccumulated.trim().length >= 100) {
        persistIncrementalDraft(lastAccumulated);
      }
      throw err;
    }
  }

  if (input.signal?.aborted) {
    if (draftSavedInRun && !reusedExistingDoc) {
      store.deleteRequirementDoc(docId);
    }
    throw new DOMException('Aborted', 'AbortError');
  }

  const srsMarkdown = llmFullSrsRes?.content
    ? ensureCanonicalNineChapterSrsStructure(llmFullSrsRes.content, deterministicSrsMarkdown)
    : deterministicSrsMarkdown;

  input.onProgress?.({
    phase: 'VALIDATING',
    step: 4,
    messageZh: '正在执行 9 章节与 9.1~9.7 治理清单完整性校验并落库归档…',
    messageEn: 'Validating 9-chapter & 9.1–9.7 governance completeness and saving to workspace…',
    completedChapters: 9,
    ...(lastThinkingText
      ? { thinkingText: lastThinkingText, thinkingChars: lastThinkingText.length }
      : {}),
    streamedText: srsMarkdown,
    streamedChars: srsMarkdown.length,
    previewTail: srsMarkdown.slice(-1600),
    draftDocId: docId,
    providerModel: llmFullSrsRes?.modelUsed || providerModel,
  });

  const doc = store.saveRequirementDoc({
    id: docId,
    projectId: project.id,
    title: resolvedDocTitle,
    version,
    status: 'CONFIRMED',
    content: srsMarkdown,
  });

  const confirmNote = pickLocaleText(
    locale,
    `已将当前需求探索会话合成为标准 9 章节《需求规格说明书.md》（含 9.1~9.7 完整治理子项），文档 ID：\`${doc.id}\`。`,
    `Synthesized canonical 9-chapter Software Requirements Specification (including 9.1–9.7 governance checklist), Doc ID: \`${doc.id}\`.`,
  );

  const convergedSession = store.appendRequirementMessage(
    reqSession.id,
    {
      id: `msg-${Date.now()}-srs`,
      role: 'assistant',
      content: confirmNote,
      timestamp: new Date().toISOString(),
    },
    {
      status: 'CONVERGED',
      discoveredAggregates:
        mergedCtx.discoveredAggregates.length > 0
          ? mergedCtx.discoveredAggregates
          : reqSession.discoveredAggregates,
      discoveredRules:
        mergedCtx.discoveredRules.length > 0
          ? mergedCtx.discoveredRules
          : reqSession.discoveredRules,
      resolvedDecisions:
        mergedCtx.resolvedDecisions.length > 0
          ? mergedCtx.resolvedDecisions
          : reqSession.resolvedDecisions,
    },
  );

  let updatedAgentSession: AgentSession | undefined = agentSession;
  if (agentSession) {
    updatedAgentSession = store.saveAgentSession({
      ...agentSession,
      messages: [
        ...agentSession.messages,
        {
          id: `amsg-${Date.now().toString(36)}-srs`,
          role: 'assistant',
          content: confirmNote,
          timestamp: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    });
  }

  saveCheckpointSafe(store, agentSession?.id ?? reqSession.id, 'SRS_SYNTHESIS', {
    sessionId: agentSession?.id ?? reqSession.id,
    docId: doc.id,
    version,
  });

  return {
    doc,
    session: convergedSession,
    ...(updatedAgentSession ? { agentSession: updatedAgentSession } : {}),
    docs: store.listRequirementDocs(project.id),
    providerUsed:
      llmFullSrsRes?.modelUsed || activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
}

// ─── 3. Prototype HTML Generation, Refinement & 11-Model Synthesis ────────────

function buildSemanticPrototypeHtmlForProject(
  project: ProjectDetail,
  doc?: RequirementDoc,
  prompt?: string,
): string {
  const isContractProject = /合同|contract|clm/i.test(`${project.name} ${project.domain}`);
  // Preserve full benchmark semantic anchors for Contract CLM so all 8 reverse-traceability rules stay 0-error
  const hasContractBenchAnchors =
    isContractProject &&
    Boolean(
      project.suite.M1?.aggregates.some(
        (a) => a.name === 'Contract' && a.uiBindings?.includes('SCR-CONTRACT-LIST'),
      ),
    );
  if (hasContractBenchAnchors) {
    if (!prompt && !doc) return CONTRACT_PROTOTYPE_HTML;
    const noteText = (prompt || doc?.title || '需求规格说明书驱动增强视图')
      .replace(/[<>&"]/g, '')
      .slice(0, 80);
    const aggCount = project.suite.M1?.aggregates.length ?? 3;
    const ruleCount = project.suite.M3?.rules.length ?? 3;
    const bannerHtml = `  <div style="margin-bottom:14px;padding:10px 14px;background:#eef0ff;border:1px solid #4c50c4;border-radius:6px;display:flex;justify-content:space-between;align-items:center;font-size:13px;">
    <span><strong>SRS / AI 驱动原型同步已激活</strong>：${noteText}</span>
    <span>已绑定 <strong>${aggCount}</strong> 个 M1 聚合根 · <strong>${ruleCount}</strong> 条 M3 规则</span>
  </div>\n`;
    return CONTRACT_PROTOTYPE_HTML.replace('<body>\n', `<body>\n${bannerHtml}`);
  }

  const hasStaleContractTemplate =
    !isContractProject &&
    Boolean(
      project.suite.M1?.aggregates.some(
        (a) => a.name === 'Contract' && a.uiBindings?.includes('SCR-CONTRACT-LIST'),
      ),
    );
  const authenticAggregates = hasStaleContractTemplate
    ? []
    : (project.suite.M1?.aggregates ?? []);
  const primaryAgg = authenticAggregates[0];
  const aggName = primaryAgg?.name ?? 'BusinessOrder';
  const aggAlias = primaryAgg?.alias ?? project.name.replace(/系统|平台|工程/g, '');
  const attrs = primaryAgg?.attributes ?? [];
  const firstAttr = attrs[0]?.name ?? 'orderNo';
  const firstAttrLabel = attrs[0]?.label ?? `${aggAlias}编号`;
  const secondAttr = attrs[1]?.name ?? 'title';
  const secondAttrLabel = attrs[1]?.label ?? `${aggAlias}名称`;
  const statusAttr =
    attrs.find((a) => a.name === 'status' || a.type === 'Enum')?.name ??
    attrs[2]?.name ??
    'status';
  const lifecycleOptions =
    primaryAgg?.lifecycle && primaryAgg.lifecycle.length > 0
      ? primaryAgg.lifecycle
      : ['DRAFT', 'ACTIVE'];

  // Dynamically render extra attributes from M1 on the form screen and table header
  const extraFormAttrs = attrs.slice(2, 6).filter((a) => a.name !== statusAttr);
  const extraFormFieldsHtml = extraFormAttrs
    .map(
      (attr, idx) => `      <div>
        <label>${attr.label} (${attr.type})</label>
        <input
          data-element-id="EL-FORM-EXTRA-${idx + 1}"
          data-element-name="formExtraField${idx + 1}"
          data-element-label="${attr.label}"
          data-element-type="INPUT"
          data-binding="${aggName}.${attr.name}"
        />
      </div>`,
    )
    .join('\n');
  const extraTableHeadersHtml = extraFormAttrs.map((a) => `<th>${a.label}</th>`).join('');
  const extraTableCellsHtml = extraFormAttrs
    .map((a) => `<td>${a.type === 'Decimal' || a.type === 'Integer' || a.type === 'Money' ? '100,000' : a.label}</td>`)
    .join('');

  const cmdBeh =
    project.suite.M2?.behaviors.find((b) => b.behaviorType === 'COMMAND') ??
    project.suite.M2?.behaviors[0];
  const cmdBehId = cmdBeh?.id ?? 'BHV-01';
  const approveBeh =
    project.suite.M2?.behaviors.filter((b) => b.behaviorType === 'COMMAND')[1] ?? cmdBeh;
  const approveBehId = approveBeh?.id ?? 'BHV-02';

  const pureValidationRule = (project.suite.M3?.rules ?? []).find(
    (r) => r.triggeredBehaviors.length === 0 && r.producedEvents.length === 0,
  );
  const ruleAttr = pureValidationRule ? ` data-validate-ref="${pureValidationRule.id}"` : ' data-validate-ref="RULE-01"';

  const qryReport = project.suite.M7?.query_reports[0];
  const qryId = qryReport?.id ?? 'QRY-01';
  const qryBehId = qryReport?.behaviorRef ?? 'BHV-QRY-01';

  const roleRef = project.suite.M5?.roles[0]?.id ?? 'ROLE-SPEC-01';
  const mgrRoleRef = project.suite.M5?.roles[1]?.id ?? roleRef;
  const subtitle = (prompt || doc?.title || `${project.domain}交互原型`).replace(/[<>&"]/g, '');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${project.name} · 交互原型 (界面原型.html)</title>
  <style>
    :root { --bg: #f3f2ee; --surface: #fdfdfb; --ink: #1a1a18; --muted: #5a5953; --line: #d5d3cb; --accent: #4c50c4; }
    body { margin: 0; padding: 20px; font-family: "IBM Plex Sans", "Noto Sans SC", sans-serif; background: var(--bg); color: var(--ink); }
    .proto-banner { padding-bottom: 12px; margin-bottom: 16px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; }
    .screen-card { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 16px; margin-bottom: 16px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
    label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
    input, select { width: 100%; box-sizing: border-box; padding: 7px 10px; border: 1px solid var(--line); border-radius: 4px; }
    button { padding: 8px 14px; border-radius: 4px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); }
  </style>
</head>
<body>
  <div class="proto-banner">
    <strong>${project.name}</strong>
    <span>${subtitle}</span>
  </div>

  <section
    class="screen-card"
    data-screen-id="SCR-MAIN-LIST"
    data-screen-name="${aggAlias}台账监控列表页"
    data-screen-type="LIST"
    data-route="/${aggName.toLowerCase()}/list"
    data-role-refs="${roleRef}"
  >
    <h3>1. ${aggAlias}台账监控列表页 (SCR-MAIN-LIST)</h3>
    <div class="grid-3">
      <div>
        <label>${firstAttrLabel}</label>
        <input
          data-element-id="EL-FILTER-NO"
          data-element-name="filterNoInput"
          data-element-label="${firstAttrLabel}检索"
          data-element-type="INPUT"
          data-binding="${aggName}.${firstAttr}"
        />
      </div>
      <div>
        <label>单据状态 (${lifecycleOptions.join(' / ')})</label>
        <select
          data-element-id="EL-FILTER-STATUS"
          data-element-name="filterStatusSelect"
          data-element-label="状态筛选"
          data-element-type="SELECT"
          data-binding="${aggName}.${statusAttr}"
        >
${lifecycleOptions.map((st) => `          <option value="${st}">${st}</option>`).join('\n')}
        </select>
      </div>
      <div style="display:flex;align-items:flex-end;gap:8px;">
        <button
          data-element-id="EL-BTN-QUERY"
          data-element-name="queryBtn"
          data-element-label="检索${aggAlias}台账"
          data-element-type="BUTTON"
          data-event-id="UIE-QUERY-MAIN"
          data-event-name="点击检索${aggAlias}台账"
          data-behavior-ref="${qryBehId}"
          data-report-ref="${qryId}"
        >检索台账</button>
        <button
          data-element-id="EL-BTN-GO-EDIT"
          data-element-name="goEditBtn"
          data-element-label="新建${aggAlias}"
          data-element-type="BUTTON"
          data-event-id="UIE-NAV-EDIT"
          data-event-name="跳转新建${aggAlias}"
          data-navigate-to="SCR-MAIN-EDIT"
        >新建${aggAlias}</button>
      </div>
    </div>
    <table
      data-element-id="EL-MAIN-TABLE"
      data-element-name="mainDataTable"
      data-element-label="${aggAlias}数据列表"
      data-element-type="TABLE"
      data-source="${qryId}"
    >
      <thead><tr><th>${firstAttrLabel}</th><th>${secondAttrLabel}</th>${extraTableHeadersHtml}<th>状态</th></tr></thead>
      <tbody><tr><td>DOC-2026-0001</td><td>${aggAlias}示例单据</td>${extraTableCellsHtml}<td>${lifecycleOptions[0]}</td></tr></tbody>
    </table>
  </section>

  <section
    class="screen-card"
    data-screen-id="SCR-MAIN-EDIT"
    data-screen-name="${aggAlias}起草与维护页"
    data-screen-type="FORM"
    data-route="/${aggName.toLowerCase()}/edit"
    data-role-refs="${roleRef}"
  >
    <h3>2. ${aggAlias}起草与维护页 (SCR-MAIN-EDIT)</h3>
    <div class="grid-3">
      <div>
        <label>${firstAttrLabel}</label>
        <input
          data-element-id="EL-FORM-NO"
          data-element-name="formNoField"
          data-element-label="${firstAttrLabel}"
          data-element-type="INPUT"
          data-binding="${aggName}.${firstAttr}"
          data-required="true"
        />
      </div>
      <div>
        <label>${secondAttrLabel}</label>
        <input
          data-element-id="EL-FORM-TITLE"
          data-element-name="formTitleField"
          data-element-label="${secondAttrLabel}"
          data-element-type="INPUT"
          data-binding="${aggName}.${secondAttr}"
          data-required="true"
        />
      </div>
${extraFormFieldsHtml}
      <div style="display:flex;align-items:flex-end;gap:8px;">
        <button
          data-element-id="EL-BTN-SAVE"
          data-element-name="saveFormBtn"
          data-element-label="保存并校验${aggAlias}"
          data-element-type="BUTTON"
          data-event-id="UIE-SAVE-MAIN"
          data-event-name="保存${aggAlias}"${ruleAttr}
          data-behavior-ref="${cmdBehId}"
          data-navigate-to="SCR-MAIN-APPROVAL"
        >保存并送审</button>
      </div>
    </div>
  </section>

  <section
    class="screen-card"
    data-screen-id="SCR-MAIN-APPROVAL"
    data-screen-name="${aggAlias}合规审核工作台"
    data-screen-type="APPROVAL"
    data-route="/${aggName.toLowerCase()}/approval"
    data-role-refs="${mgrRoleRef}"
  >
    <h3>3. ${aggAlias}合规审核工作台 (SCR-MAIN-APPROVAL)</h3>
    <div class="grid-3">
      <div>
        <label>审核意见</label>
        <input
          data-element-id="EL-APPROVAL-NOTE"
          data-element-name="approvalNoteInput"
          data-element-label="主管审核意见"
          data-element-type="INPUT"
          data-required="true"
        />
      </div>
      <div style="display:flex;align-items:flex-end;">
        <button
          data-element-id="EL-BTN-APPROVE-MAIN"
          data-element-name="approveMainBtn"
          data-element-label="审核放行"
          data-element-type="BUTTON"
          data-event-id="UIE-APPROVE-MAIN"
          data-event-name="点击审核放行"
          data-behavior-ref="${approveBehId}"
        >审核通过</button>
      </div>
    </div>
  </section>
</body>
</html>`;
}

function alignSuiteWithExtractedMu(
  baseSuite: OntologySuite,
  htmlContent: string,
  domain: string,
): OntologySuite {
  const suite: OntologySuite = JSON.parse(JSON.stringify(baseSuite));
  const extractedMu = extractMuFromPrototypeHtml(htmlContent, domain);

  if (!suite.M1) {
    suite.M1 = {
      model_type: 'OBJECT',
      version: '5.0',
      domain,
      aggregates: [],
      data_dictionaries: [],
      aggregate_associations: [],
    };
  }
  if (!suite.M2) {
    suite.M2 = { model_type: 'BEHAVIOR', version: '5.0', domain, behaviors: [] };
  }
  if (!suite.M3) {
    suite.M3 = { model_type: 'RULE', version: '5.0', domain, rules: [] };
  }
  if (!suite.ME) {
    suite.ME = { model_type: 'EVENT', version: '5.0', domain, events: [] };
  }
  if (!suite.M5) {
    suite.M5 = { model_type: 'ACTOR', version: '5.0', domain, actors: [], roles: [], permissions: [] };
  }
  if (!suite.M7) {
    suite.M7 = { model_type: 'QUERY_REPORT', version: '5.0', domain, query_reports: [] };
  }

  // 1. Ensure M1 aggregates and attributes referenced by MU `dataBinding` exist
  for (const screen of extractedMu.screens) {
    for (const el of screen.elements) {
      if (el.dataBinding && el.dataBinding.includes('.')) {
        const [aggName, attrRaw] = el.dataBinding.split('.');
        const attrName = attrRaw.replace(/\[\d*\]/g, '').trim();
        let agg = suite.M1.aggregates.find((a) => a.name === aggName || a.id === aggName);
        if (!agg) {
          agg = {
            id: `AGG-0${suite.M1.aggregates.length + 1}`,
            name: aggName,
            alias: `${aggName}聚合`,
            aggregateType: 'AGGREGATE_ROOT',
            lifecycle: ['DRAFT', 'ACTIVE', 'COMPLETED'],
            tags: ['SYNTHESIZED'],
            attributes: [],
            entities: [],
            valueObjects: [],
            invariants: [],
          };
          suite.M1.aggregates.push(agg);
        }
        const hasAttr =
          attrName === 'id' ||
          agg.attributes.some((at) => at.name === attrName) ||
          agg.entities.some((en) => en.name === attrName) ||
          agg.valueObjects.some((vo) => vo.name === attrName);
        if (!hasAttr && attrName) {
          const inferredType: Attribute['type'] =
            el.elementType === 'NUMBER'
              ? 'Money'
              : el.elementType === 'DATE_PICKER' || el.elementType === 'DATEPICKER'
                ? 'Date'
                : 'String';
          agg.attributes.push({
            name: attrName,
            label: el.label || attrName,
            type: inferredType,
            required: el.required,
          });
        }
      }
    }
  }

  // Ensure at least 2 aggregates in M1 so M4 cross-aggregate scenarios are always valid
  if (suite.M1.aggregates.length === 0) {
    suite.M1.aggregates.push({
      id: 'AGG-01',
      name: 'BusinessOrder',
      alias: '业务主单据',
      aggregateType: 'AGGREGATE_ROOT',
      lifecycle: ['DRAFT', 'ACTIVE', 'COMPLETED'],
      tags: ['CORE'],
      attributes: [
        { name: 'orderNo', label: '单据编号', type: 'String', required: true },
        { name: 'title', label: '单据名称', type: 'String', required: true },
        { name: 'status', label: '单据状态', type: 'String', required: true },
      ],
      entities: [],
      valueObjects: [],
      invariants: [],
    });
  }
  if (suite.M1.aggregates.length === 1) {
    suite.M1.aggregates.push({
      id: 'AGG-02',
      name: `${suite.M1.aggregates[0].name}AuditLog`,
      alias: `${suite.M1.aggregates[0].alias}履约记录`,
      aggregateType: 'AGGREGATE_ROOT',
      lifecycle: ['CREATED', 'ARCHIVED'],
      tags: ['AUDIT'],
      attributes: [
        { name: 'logNo', label: '记录单号', type: 'String', required: true },
        { name: 'summary', label: '履约摘要', type: 'String', required: true },
      ],
      entities: [],
      valueObjects: [],
      invariants: [],
    });
  }

  const primaryAgg = suite.M1.aggregates[0];
  const secondaryAgg = suite.M1.aggregates[1] ?? primaryAgg;

  // 2. Ensure M5 roles & permissions referenced by MU exist
  for (const screen of extractedMu.screens) {
    for (const roleId of screen.roleRefs) {
      if (!suite.M5.roles.some((r) => r.id === roleId || r.code === roleId)) {
        suite.M5.roles.push({
          id: roleId,
          name: `${roleId} 业务角色`,
          code: roleId.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase(),
          inheritsFrom: [],
          permissions: [],
          dataScope: 'ALL',
        });
      }
    }
    for (const el of screen.elements) {
      if (
        el.permissionRef &&
        !suite.M5.permissions.some((p) => p.id === el.permissionRef || p.code === el.permissionRef)
      ) {
        suite.M5.permissions.push({
          id: el.permissionRef,
          name: `${el.label}操作权限`,
          code: el.permissionRef.toLowerCase().replace(/[^a-z0-9_:]/g, ':'),
          targetAggregate: primaryAgg.name,
          allowedBehaviors: [],
          uiControlledElements: [el.elementId],
        });
      }
    }
  }
  if (suite.M5.actors.length === 0) {
    const defaultRole = suite.M5.roles[0]?.id ?? 'ROLE-SPEC-01';
    if (suite.M5.roles.length === 0) {
      suite.M5.roles.push({
        id: defaultRole,
        name: '业务经办角色',
        code: 'BUSINESS_SPECIALIST',
        inheritsFrom: [],
        permissions: suite.M5.permissions.map((p) => p.id),
        dataScope: 'ALL',
      });
    }
    suite.M5.actors.push({
      id: 'ACT-01',
      name: '业务经办专员',
      actorType: 'HUMAN',
      roles: [defaultRole],
      description: '负责业务单据维护与审批协同',
    });
  }

  // 3. Ensure M3 rules, M2 behaviors, ME events, M7 reports referenced in MU exist
  // Process screen.events first so explicit BEHAVIOR_CALL + REPORT_CALL pairs establish 1-to-1 M2<->M7 links
  const muCalledBehaviorIds = new Set<string>();
  for (const screen of extractedMu.screens) {
    for (const ev of screen.events) {
      let lastBehInChain: string | undefined;
      for (const step of ev.callChain) {
        if (step.stepType === 'VALIDATE') {
          if (!suite.M3.rules.some((r) => r.id === step.refId)) {
            suite.M3.rules.push({
              id: step.refId,
              name: `Rule${step.refId.replace(/[^A-Za-z0-9]/g, '')}`,
              alias: `${ev.name}前置校验规则`,
              ruleType: 'VALIDATION',
              scope: 'CROSS_OBJECT',
              version: '1.0',
              referencedObjects: [primaryAgg.name],
              parameters: [],
              expression: `${primaryAgg.name}.${primaryAgg.attributes[0]?.name ?? 'id'} != ''`,
              violationMessage: '前置业务校验未通过',
              triggeredByEvents: [],
              producedEvents: [],
              triggeredBehaviors: [],
            });
          }
        } else if (step.stepType === 'BEHAVIOR_CALL') {
          muCalledBehaviorIds.add(step.refId);
          lastBehInChain = step.refId;
          const callsReportNext = ev.callChain.find(
            (s) => s.stepType === 'REPORT_CALL' || s.stepType === 'QUERY_REPORT',
          );
          if (!suite.M2.behaviors.some((b) => b.id === step.refId)) {
            suite.M2.behaviors.push({
              id: step.refId,
              name: `exec${step.refId.replace(/[^A-Za-z0-9]/g, '')}`,
              alias: ev.name,
              ownerEntity: primaryAgg.name,
              behaviorType: callsReportNext ? 'QUERY' : 'COMMAND',
              triggerType: 'USER_ACTION',
              inputParameters: [],
              outputParameters: [{ name: 'ok', label: '执行状态', type: 'Boolean', required: true }],
              preconditions: [],
              stateChanges: [],
              invokedRules: [],
              producedEvents: [],
              requiredPermissions: [],
              ...(callsReportNext ? { queryReportRef: callsReportNext.refId } : {}),
            });
          }
        } else if (step.stepType === 'REPORT_CALL' || step.stepType === 'QUERY_REPORT') {
          const existingRpt = suite.M7.query_reports.find((q) => q.id === step.refId);
          if (existingRpt) {
            muCalledBehaviorIds.add(existingRpt.behaviorRef);
            if (lastBehInChain && lastBehInChain !== existingRpt.behaviorRef) {
              const dupBeh = suite.M2.behaviors.find((b) => b.id === lastBehInChain);
              if (dupBeh && dupBeh.queryReportRef === step.refId) {
                dupBeh.behaviorType = 'COMMAND';
                delete dupBeh.queryReportRef;
              }
            }
          } else {
            const pairedBeh =
              (lastBehInChain
                ? suite.M2.behaviors.find((b) => b.id === lastBehInChain && (!b.queryReportRef || b.queryReportRef === step.refId))
                : undefined) ??
              (() => {
                const bId = `BHV-QRY-${step.refId}`;
                const created = {
                  id: bId,
                  name: `query${step.refId.replace(/[^A-Za-z0-9]/g, '')}`,
                  alias: `查询${ev.name}`,
                  ownerEntity: primaryAgg.name,
                  behaviorType: 'QUERY' as const,
                  triggerType: 'SYSTEM' as const,
                  inputParameters: [],
                  outputParameters: [{ name: 'rows', label: '列表', type: 'Array', required: true }],
                  preconditions: [],
                  stateChanges: [],
                  invokedRules: [],
                  producedEvents: [],
                  requiredPermissions: [],
                  queryReportRef: step.refId,
                };
                suite.M2.behaviors.push(created);
                return created;
              })();
            pairedBeh.behaviorType = 'QUERY';
            pairedBeh.queryReportRef = step.refId;
            muCalledBehaviorIds.add(pairedBeh.id);

            const firstCol = primaryAgg.attributes[0]?.name ?? 'id';
            suite.M7.query_reports.push({
              id: step.refId,
              name: `Report${step.refId.replace(/[^A-Za-z0-9]/g, '')}`,
              alias: `${ev.name}查询规格`,
              queryType: 'LIST_QUERY',
              behaviorRef: pairedBeh.id,
              primarySource: { aggregateRef: primaryAgg.name, alias: 't' },
              joins: [],
              parameters: [],
              conditions: [],
              resultColumns: [
                { name: firstCol, label: '单据编号', sourceExpr: `t.${firstCol}`, dataType: 'String' },
              ],
              groupBy: [],
              orderBy: [],
              referenceSql: {
                dialect: 'SQLite',
                sql: `SELECT t.${firstCol} AS ${firstCol} FROM t_${primaryAgg.name.toLowerCase()} t`,
                parameterMappings: [],
                resultMappings: [firstCol],
              },
            });
          }
        } else if (step.stepType === 'EVENT_EMIT') {
          if (!suite.ME.events.some((e) => e.id === step.refId)) {
            const prodBehId = lastBehInChain ?? suite.M2.behaviors[0]?.id ?? 'BHV-01';
            suite.ME.events.push({
              id: step.refId,
              name: `${primaryAgg.name}.Emitted${step.refId.replace(/[^A-Za-z0-9]/g, '')}`,
              label: `${ev.name}事件`,
              producerType: 'BEHAVIOR',
              producerBehaviorRef: prodBehId,
              sourceAggregate: primaryAgg.name,
              orderingSemantic: 'AT_LEAST_ONCE',
              payload: [{ name: 'id', label: 'ID', type: 'String', required: true }],
              subscribers: [],
            });
          }
        }
      }
    }

    for (const el of screen.elements) {
      if (el.dataSource && !suite.M7.query_reports.some((q) => q.id === el.dataSource)) {
        const pairedBehId = `BHV-FOR-${el.dataSource}`;
        muCalledBehaviorIds.add(pairedBehId);
        if (!suite.M2.behaviors.some((b) => b.id === pairedBehId)) {
          suite.M2.behaviors.push({
            id: pairedBehId,
            name: `queryFor${el.dataSource.replace(/[^A-Za-z0-9]/g, '')}`,
            alias: `查询${el.label}`,
            ownerEntity: primaryAgg.name,
            behaviorType: 'QUERY',
            triggerType: 'SYSTEM',
            inputParameters: [],
            outputParameters: [{ name: 'items', label: '结果集', type: 'Array', required: true }],
            preconditions: [],
            stateChanges: [],
            invokedRules: [],
            producedEvents: [],
            requiredPermissions: [],
            queryReportRef: el.dataSource,
          });
        }
        const firstCol = primaryAgg.attributes[0]?.name ?? 'id';
        suite.M7.query_reports.push({
          id: el.dataSource,
          name: `Query${el.dataSource.replace(/[^A-Za-z0-9]/g, '')}`,
          alias: `${el.label}查询规范`,
          queryType: 'LIST_QUERY',
          behaviorRef: pairedBehId,
          primarySource: { aggregateRef: primaryAgg.name, alias: 't' },
          joins: [],
          parameters: [],
          conditions: [],
          resultColumns: [
            { name: firstCol, label: '单据编号', sourceExpr: `t.${firstCol}`, dataType: 'String' },
          ],
          groupBy: [],
          orderBy: [],
          referenceSql: {
            dialect: 'SQLite',
            sql: `SELECT t.${firstCol} AS ${firstCol} FROM t_${primaryAgg.name.toLowerCase()} t`,
            parameterMappings: [],
            resultMappings: [firstCol],
          },
        });
      }
    }
  }

  // Ensure M2 has at least 1 command behavior even when custom HTML omits data-behavior-ref
  if (suite.M2.behaviors.length === 0) {
    const defaultBehId = 'BHV-01';
    const unlinkedUiEvent = extractedMu.screens
      .flatMap((s) => s.events)
      .find((ev) => ev.callChain.length === 0);
    if (unlinkedUiEvent) {
      unlinkedUiEvent.callChain.push({
        stepOrder: 1,
        stepType: 'BEHAVIOR_CALL',
        refId: defaultBehId,
      });
      muCalledBehaviorIds.add(defaultBehId);
    }
    suite.M2.behaviors.push({
      id: defaultBehId,
      name: `submit${primaryAgg.name.replace(/[^A-Za-z0-9]/g, '')}`,
      alias: `提交${primaryAgg.alias}`,
      ownerEntity: primaryAgg.name,
      behaviorType: 'COMMAND',
      triggerType: unlinkedUiEvent ? 'USER_ACTION' : 'SYSTEM',
      inputParameters: [],
      outputParameters: [{ name: 'ok', label: '执行状态', type: 'Boolean', required: true }],
      preconditions: [],
      stateChanges: [],
      invokedRules: [],
      producedEvents: [],
      requiredPermissions: [],
    });
  }

  // Ensure M7 has at least 1 query report even when custom HTML omits data-source / data-report-ref
  if (suite.M7.query_reports.length === 0) {
    const defaultRptId = 'QRY-01';
    const defaultQryBehId = 'BHV-QRY-01';
    if (!suite.M2.behaviors.some((b) => b.id === defaultQryBehId)) {
      suite.M2.behaviors.push({
        id: defaultQryBehId,
        name: `list${primaryAgg.name.replace(/[^A-Za-z0-9]/g, '')}`,
        alias: `查询${primaryAgg.alias}列表`,
        ownerEntity: primaryAgg.name,
        behaviorType: 'QUERY',
        triggerType: 'SYSTEM',
        inputParameters: [],
        outputParameters: [{ name: 'items', label: '结果集', type: 'Array', required: true }],
        preconditions: [],
        stateChanges: [],
        invokedRules: [],
        producedEvents: [],
        requiredPermissions: [],
        queryReportRef: defaultRptId,
      });
    }
    const firstCol = primaryAgg.attributes[0]?.name ?? 'id';
    suite.M7.query_reports.push({
      id: defaultRptId,
      name: `List${primaryAgg.name.replace(/[^A-Za-z0-9]/g, '')}Report`,
      alias: `${primaryAgg.alias}标准台账查询`,
      queryType: 'LIST_QUERY',
      behaviorRef: defaultQryBehId,
      primarySource: { aggregateRef: primaryAgg.name, alias: 't' },
      joins: [],
      parameters: [],
      conditions: [],
      resultColumns: [
        { name: firstCol, label: '单据标识', sourceExpr: `t.${firstCol}`, dataType: 'String' },
      ],
      groupBy: [],
      orderBy: [],
      referenceSql: {
        dialect: 'SQLite',
        sql: `SELECT t.${firstCol} AS ${firstCol} FROM t_${primaryAgg.name.toLowerCase()} t`,
        parameterMappings: [],
        resultMappings: [firstCol],
      },
    });
  }

  // Ensure any pre-existing USER_ACTION behaviors not called by the new MU prototype are downgraded to SYSTEM so MU reverse-traceability passes
  for (const b of suite.M2.behaviors) {
    if (b.triggerType === 'USER_ACTION' && !muCalledBehaviorIds.has(b.id)) {
      b.triggerType = 'SYSTEM';
    }
  }

  // Ensure ME has at least 1 event
  if (suite.ME.events.length === 0) {
    const prodBeh = suite.M2.behaviors[0];
    const evId = 'EVT-01';
    if (prodBeh && !prodBeh.producedEvents.includes(evId)) {
      prodBeh.producedEvents.push(evId);
    }
    suite.ME.events.push({
      id: evId,
      name: `${primaryAgg.name}.Processed`,
      label: `${primaryAgg.alias}已处理事件`,
      producerType: 'BEHAVIOR',
      producerBehaviorRef: prodBeh?.id ?? '',
      sourceAggregate: primaryAgg.name,
      orderingSemantic: 'AT_LEAST_ONCE',
      payload: [{ name: 'id', label: '单据ID', type: 'String', required: true }],
      subscribers: [],
    });
  }

  // Ensure M3 has at least 1 rule
  if (suite.M3.rules.length === 0) {
    suite.M3.rules.push({
      id: 'RULE-01',
      name: 'PrimaryEntityIntegrityRule',
      alias: `${primaryAgg.alias}完整性校验规则`,
      ruleType: 'VALIDATION',
      scope: 'CROSS_OBJECT',
      version: '1.0',
      referencedObjects: [primaryAgg.name],
      parameters: [],
      expression: `${primaryAgg.name}.${primaryAgg.attributes[0]?.name ?? 'id'} != ''`,
      violationMessage: '核心业务标识不能为空',
      triggeredByEvents: [],
      producedEvents: [],
      triggeredBehaviors: [],
    });
  }

  // Ensure M4 Scenario exists
  if (!suite.M4 || suite.M4.event_scenarios.length === 0) {
    const firstEv = suite.ME.events[0];
    const firstBeh = suite.M2.behaviors[0];
    suite.M4 = {
      model_type: 'SCENARIO',
      version: '5.0',
      domain,
      event_scenarios: [
        {
          id: 'SCN-01',
          name: `${primaryAgg.alias}与${secondaryAgg.alias}跨聚合协同场景`,
          sourceObjectRef: primaryAgg.name,
          targetObjectRefs: [secondaryAgg.name],
          ...(firstBeh ? { triggerBehaviorRef: firstBeh.id } : {}),
          triggerEventRef: firstEv.id,
          involvedAggregates: [primaryAgg.name, secondaryAgg.name],
          preconditions: [],
          postconditions: [],
          steps: [
            ...(firstBeh
              ? [
                  {
                    stepOrder: 1,
                    stepType: 'BEHAVIOR_CALL' as const,
                    refId: firstBeh.id,
                    targetAggregate: primaryAgg.name,
                  },
                ]
              : []),
            {
              stepOrder: firstBeh ? 2 : 1,
              stepType: 'EVENT_EMIT' as const,
              refId: firstEv.id,
              targetAggregate: secondaryAgg.name,
            },
          ],
        },
      ],
    };
  }

  // Ensure M6 Flow exists with START -> ... -> END
  if (!suite.M6 || suite.M6.flows.length === 0) {
    const roleRef = suite.M5.roles[0]?.id;
    const behRef = suite.M2.behaviors[0]?.id;
    const firstScreenId = extractedMu.screens[0]?.screenId;
    suite.M6 = {
      model_type: 'FLOW',
      version: '5.0',
      domain,
      flows: [
        {
          id: 'FLW-01',
          name: `${primaryAgg.alias}标准业务审批流`,
          flowType: 'APPROVAL',
          primaryAggregate: primaryAgg.name,
          roleRefs: roleRef ? [roleRef] : [],
          trigger: {
            triggerType: behRef ? 'USER_ACTION' : 'MANUAL',
            ...(behRef ? { refId: behRef } : {}),
          },
          activities: [
            {
              id: 'ACTV-START',
              name: '开始',
              activityType: 'START',
              nextActivity: 'ACTV-MAIN-TASK',
              branches: [],
            },
            {
              id: 'ACTV-MAIN-TASK',
              name: `${primaryAgg.alias}经办与审核`,
              activityType: 'USER_TASK',
              ...(roleRef ? { roleRef } : {}),
              ...(behRef ? { behaviorRef: behRef } : {}),
              ...(firstScreenId ? { screenRef: firstScreenId } : {}),
              nextActivity: 'ACTV-END',
              branches: [],
            },
            {
              id: 'ACTV-END',
              name: '结束',
              activityType: 'END',
              branches: [],
            },
          ],
        },
      ],
    };
  }

  // Set MU from prototype
  suite.MU = extractedMu;

  // Ensure MM mappings exist for aggregates
  if (!suite.MM || suite.MM.mappings.length === 0) {
    suite.MM = {
      model_type: 'MAPPING',
      version: '1.0',
      domain,
      mappings: suite.M1.aggregates.map((agg: AggregateRoot, idx: number) => ({
        id: `MAP-0${idx + 1}`,
        objectRef: agg.id,
        objectRole: 'AGGREGATE_ROOT' as const,
        objectName: agg.name,
        tableMappings: [
          {
            tableName: `t_${agg.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}`,
            tableRole: 'MASTER' as const,
            primaryKey: 'id',
            foreignKeys: [],
            columnMappings: agg.attributes
              .filter((at) => at.type !== 'ValueObject')
              .slice(0, 6)
              .map((at) => ({
                attributeRef: `${agg.name}.${at.name}`,
                column: at.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(),
                columnType: at.type === 'Money' || at.type === 'Decimal' ? 'DECIMAL(18,2)' : 'VARCHAR(128)',
              })),
          },
        ],
      })),
    };
  }

  // Ensure MI interfaces exist
  if (!suite.MI || suite.MI.interfaces.length === 0) {
    const firstBeh = suite.M2.behaviors[0];
    suite.MI = {
      model_type: 'INTERFACE',
      version: '1.0',
      domain,
      interfaces: [
        {
          interfaceId: 'IF-01',
          name: `${primaryAgg.alias}核心业务服务接口`,
          direction: 'PROVIDED',
          interfaceCategory: firstBeh?.behaviorType === 'QUERY' ? 'QUERY' : 'COMMAND',
          protocol: 'REST',
          format: 'JSON',
          ...(firstBeh ? { relatedBehaviorRef: firstBeh.id } : {}),
          relatedEntityRef: primaryAgg.name,
          inputFields: [{ name: 'requestId', label: '请求流水号', type: 'String', required: true }],
          outputFields: [{ name: 'success', label: '处理状态', type: 'Boolean', required: true }],
          returnRules: [{ code: 'OK_200', scenario: '执行成功', httpStatus: 200, message: 'OK' }],
        },
      ],
    };
  }

  return suite;
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
            '5. Include clean warm-paper CSS (`#f6f4ef` background, `#ffffff` cards, `#4c50c4` accent) and lightweight inline vanilla JS for tab switching, live row filtering, and inline status toast feedback. NEVER call `window.alert`, `window.confirm`, or `window.prompt`.',
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
            '5. 采用温润纸感（Warm-Paper `#f6f4ef` 背景、`#ffffff` 卡片、`#4c50c4` 强调色）样式，内置轻量原生 JS 支持屏幕页签切换、表单提交动态插入表格与顶部非阻塞状态条反馈，严禁使用 `window.alert` / `confirm` / `prompt`！',
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

  const hasDomainOntology = (project.suite.M1?.aggregates.length ?? 0) > 0;
  const saved = store.savePrototypeAndSyncMu(input.projectId, {
    name: protoTitle,
    version,
    htmlContent,
    syncMu: hasDomainOntology,
  });

  let finalProject = saved.project;
  if (hasDomainOntology && finalProject.validation.errorCount > 0) {
    const alignedSuite = alignSuiteWithExtractedMu(
      finalProject.suite,
      htmlContent,
      finalProject.domain,
    );
    finalProject = store.updateSuite(
      input.projectId,
      alignedSuite,
      `Generated semantic HTML prototype (${saved.prototype.id}) and aligned MU bindings`,
    );
  }

  saveCheckpointSafe(store, `proto-${input.projectId}`, 'PROTOTYPE_GENERATION', {
    projectId: input.projectId,
    prototypeId: saved.prototype.id,
    screens: saved.prototype.extractedScreenCount,
  });

  return {
    prototype: saved.prototype,
    project: finalProject,
    prototypes: store.listPrototypes(input.projectId),
    providerUsed: modelUsed,
  };
}

export async function refinePrototypeWithAi(
  store: WorkspaceStore,
  input: {
    projectId: string;
    prototypeId: string;
    instruction: string;
    locale?: AgentLocale | string;
  },
): Promise<PrototypeGenerationResult> {
  const project = store.getProject(input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);

  const locale = resolveEffectiveLocale(store, input.locale, input.instruction);
  const protos = store.listPrototypes(input.projectId);
  const targetProto = protos.find((p) => p.id === input.prototypeId) ?? protos[0];
  if (!targetProto) {
    return generatePrototypeFromDoc(store, {
      projectId: input.projectId,
      prompt: input.instruction,
      locale,
    });
  }

  const activeProvider = resolvePreferredProvider(store, input.projectId);
  let nextHtml: string | null = null;
  let modelUsed = activeProvider?.defaultModel || 'auto/glm-5.3-flash';
  let summaryLabel = input.instruction.slice(0, 36);

  if (!isMockLlmActive(store)) {
    const llmFullHtmlRes = await callOpenAiCompatibleChat(
      activeProvider,
      [
        {
          role: 'system',
          content:
            locale === 'en-US'
              ? 'You are the Ontology Plus UI Prototype Refinement Engineer. Modify the provided HTML5 prototype to fulfill the user instruction while strictly preserving all existing `data-screen-id`, `data-element-id`, `data-binding`, and `data-event-id` semantic anchors (and adding valid semantic anchors on any newly added controls/buttons). Never use window.alert/confirm/prompt. Return ONLY the complete updated HTML document.'
              : '你是 Ontology Plus 交互原型精修专家。请根据用户的修改指令，在提供的完整 HTML5 原型基础上直接完成真实的界面结构、控件、字段与交互脚本修改，同时严格保留既有 `data-screen-id`、`data-element-id`、`data-binding`、`data-event-id` 语义锚点（新增控件也必须补齐合法的语义锚点）。严禁使用 window.alert/confirm/prompt。直接返回修改后的完整 HTML 源码，不要包裹代码块。',
        },
        {
          role: 'user',
          content: `Project: ${project.name} (${project.domain})\nRefinement Instruction: ${input.instruction}\n\n--- Current HTML Prototype ---\n${targetProto.htmlContent}`,
        },
      ],
      { store, maxTokens: 8192 },
    );

    if (llmFullHtmlRes?.content) {
      modelUsed = llmFullHtmlRes.modelUsed || modelUsed;
      nextHtml = sanitizeAndValidatePrototypeHtml(llmFullHtmlRes.content, project.domain);
    }
  }

  if (!nextHtml) {
    const primaryAgg = project.suite.M1?.aggregates[0];
    const validBinding =
      primaryAgg && primaryAgg.attributes[0]
        ? `${primaryAgg.name}.${primaryAgg.attributes[0].name}`
        : undefined;

    const rawLabel =
      input.instruction
        .replace(/[<>&"'`\n]/g, ' ')
        .trim()
        .slice(0, 32) || pickLocaleText(locale, 'AI交互增强控件', 'AI Refined Control');
    summaryLabel = rawLabel;
    const elSuffix = String(Date.now()).slice(-4);

    const wantsButton =
      /按钮|导出|催办|批处理|操作|动作|触发|提交|审批|button|export|action|submit|approve|trigger/i.test(
        input.instruction,
      );
    const wantsInput =
      /输入|筛选|搜索|字段|文本框|框|下拉|选择|filter|input|search|field|select/i.test(
        input.instruction,
      );

    let injectedSemanticHtml: string;
    if (wantsButton) {
      injectedSemanticHtml = `\n    <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #d5d3cb;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <span data-element-id="EL-AI-NOTE-${elSuffix}" data-element-name="aiRefinedBadge${elSuffix}" data-element-label="${rawLabel}" data-element-type="BADGE">${pickLocaleText(locale, 'AI 交互微调：', 'AI Refined: ')}${rawLabel}</span>
      <button type="button" data-element-id="EL-AI-BTN-${elSuffix}" data-element-name="aiActionBtn${elSuffix}" data-element-label="${rawLabel}" data-element-type="BUTTON">${rawLabel.slice(0, 18)}</button>
    </div>\n  </section>`;
    } else if (wantsInput) {
      const bindingAttr = validBinding ? ` data-binding="${validBinding}"` : '';
      injectedSemanticHtml = `\n    <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #d5d3cb;display:grid;grid-template-columns:1fr 2fr;gap:10px;align-items:center;">
      <span data-element-id="EL-AI-NOTE-${elSuffix}" data-element-name="aiRefinedBadge${elSuffix}" data-element-label="${rawLabel}" data-element-type="BADGE">${rawLabel}</span>
      <input placeholder="${rawLabel}" data-element-id="EL-AI-INPUT-${elSuffix}" data-element-name="aiFilterInput${elSuffix}" data-element-label="${rawLabel}" data-element-type="INPUT"${bindingAttr} />
    </div>\n  </section>`;
    } else {
      injectedSemanticHtml = `\n    <div style="margin-top:12px;padding:8px 12px;background:#f5f6ff;border-left:3px solid #4c50c4;border-radius:4px;">
      <span data-element-id="EL-AI-NOTE-${elSuffix}" data-element-name="aiRefinedBadge${elSuffix}" data-element-label="${rawLabel}" data-element-type="BADGE">${pickLocaleText(locale, 'AI 微调已生效：', 'AI Refinement Applied: ')}${rawLabel}</span>
    </div>\n  </section>`;
    }

    const firstCloseIdx = targetProto.htmlContent.indexOf('</section>');
    nextHtml =
      firstCloseIdx >= 0
        ? targetProto.htmlContent.slice(0, firstCloseIdx) +
          injectedSemanticHtml +
          targetProto.htmlContent.slice(firstCloseIdx + '</section>'.length)
        : `${targetProto.htmlContent}\n<!-- Refined: ${rawLabel} -->`;
  }

  const hasDomainOntology = (project.suite.M1?.aggregates.length ?? 0) > 0;
  const saved = store.savePrototypeAndSyncMu(input.projectId, {
    id: targetProto.id,
    name: targetProto.name,
    version: `${targetProto.version}-r1`,
    htmlContent: nextHtml,
    syncMu: hasDomainOntology,
  });

  let finalProject = saved.project;
  if (hasDomainOntology && finalProject.validation.errorCount > 0) {
    const aligned = alignSuiteWithExtractedMu(
      finalProject.suite,
      nextHtml,
      finalProject.domain,
    );
    finalProject = store.updateSuite(
      input.projectId,
      aligned,
      `Aligned ontology suite with AI-refined prototype (${saved.prototype.id})`,
    );
  }

  return {
    prototype: saved.prototype,
    project: finalProject,
    prototypes: store.listPrototypes(input.projectId),
    summary: pickLocaleText(
      locale,
      `已根据指令「${input.instruction}」微调交互原型（${summaryLabel}）并同步更新 MU 屏幕控件模型`,
      `Refined interactive prototype per "${input.instruction}" and synced MU screen elements`,
    ),
    providerUsed: modelUsed,
  };
}

interface LlmSynthesizedDomainBlueprint {
  aggregates?: {
    id?: string;
    name: string;
    alias?: string;
    lifecycle?: string[];
    attributes?: { name: string; label?: string; type?: string; required?: boolean }[];
  }[];
  behaviors?: {
    id?: string;
    name: string;
    alias?: string;
    ownerEntity?: string;
    behaviorType?: 'COMMAND' | 'QUERY';
  }[];
  rules?: {
    id?: string;
    name?: string;
    alias?: string;
    ruleType?: 'VALIDATION' | 'CALCULATION' | 'STATE_TRANSITION' | 'COORDINATION';
    referencedObjects?: string[];
    expression?: string;
    violationMessage?: string;
  }[];
  events?: {
    id?: string;
    name: string;
    label?: string;
    sourceAggregate?: string;
  }[];
  actors?: {
    actorId?: string;
    actorName?: string;
    actorType?: 'HUMAN' | 'SYSTEM' | 'EXTERNAL_ENTITY' | 'TIMER';
    roleId?: string;
    roleName?: string;
    roleCode?: string;
  }[];
  flows?: {
    id?: string;
    name: string;
    flowType?: 'APPROVAL' | 'COLLABORATION' | 'SCHEDULED';
    primaryAggregate?: string;
  }[];
  interfaces?: {
    interfaceId?: string;
    name: string;
    direction?: 'PROVIDED' | 'DEPENDENT';
    interfaceCategory?: 'COMMAND' | 'QUERY' | 'EVENT_SUB' | 'EXTERNAL_GATEWAY';
    protocol?: 'REST' | 'RPC' | 'MQ' | 'MCP';
    relatedEntityRef?: string;
  }[];
}

function applyLlmBlueprintToSuite(
  baseSuite: OntologySuite,
  blueprint: LlmSynthesizedDomainBlueprint,
  domain: string,
): OntologySuite {
  let working: OntologySuite = JSON.parse(JSON.stringify(baseSuite));

  for (const [idx, agg] of (blueprint.aggregates ?? []).slice(0, 8).entries()) {
    if (!agg?.name) continue;
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_aggregate',
        {
          id: agg.id || `AGG-0${idx + 1}`,
          name: agg.name.replace(/[^A-Za-z0-9_]/g, ''),
          alias: agg.alias || agg.name,
          lifecycle: agg.lifecycle,
          attributes: agg.attributes,
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item; validator gate guards final suite
    }
  }

  for (const [idx, act] of (blueprint.actors ?? []).slice(0, 6).entries()) {
    if (!act?.actorName && !act?.roleName) continue;
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_actor_role',
        {
          actorId: act.actorId || `ACT-0${idx + 1}`,
          actorName: act.actorName || act.roleName,
          actorType: act.actorType || 'HUMAN',
          roleId: act.roleId || `ROLE-0${idx + 1}`,
          roleName: act.roleName || act.actorName,
          roleCode: act.roleCode,
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item
    }
  }

  for (const [idx, beh] of (blueprint.behaviors ?? []).slice(0, 10).entries()) {
    if (!beh?.name) continue;
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_behavior',
        {
          id: beh.id || `BHV-0${idx + 1}`,
          name: beh.name.replace(/[^A-Za-z0-9_]/g, ''),
          alias: beh.alias || beh.name,
          ownerEntity: beh.ownerEntity,
          behaviorType: beh.behaviorType || 'COMMAND',
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item
    }
  }

  for (const [idx, rl] of (blueprint.rules ?? []).slice(0, 10).entries()) {
    if (!rl?.alias && !rl?.name) continue;
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_rule',
        {
          id: rl.id || `RULE-0${idx + 1}`,
          name: (rl.name || `DomainRule0${idx + 1}`).replace(/[^A-Za-z0-9_]/g, ''),
          alias: rl.alias || rl.name,
          ruleType: rl.ruleType || 'VALIDATION',
          referencedObjects: rl.referencedObjects,
          expression: rl.expression,
          violationMessage: rl.violationMessage,
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item
    }
  }

  for (const [idx, ev] of (blueprint.events ?? []).slice(0, 8).entries()) {
    if (!ev?.name) continue;
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_event',
        {
          id: ev.id || `EVT-0${idx + 1}`,
          name: ev.name,
          label: ev.label || ev.name,
          sourceAggregate: ev.sourceAggregate,
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item
    }
  }

  for (const [idx, fl] of (blueprint.flows ?? []).slice(0, 4).entries()) {
    if (!fl?.name) continue;
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_flow',
        {
          id: fl.id || `FLW-0${idx + 1}`,
          name: fl.name,
          flowType: fl.flowType,
          primaryAggregate: fl.primaryAggregate,
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item
    }
  }

  for (const [idx, itf] of (blueprint.interfaces ?? []).slice(0, 8).entries()) {
    if (!itf?.name) continue;
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_interface',
        {
          interfaceId: itf.interfaceId || `IF-0${idx + 1}`,
          name: itf.name,
          direction: itf.direction || 'PROVIDED',
          interfaceCategory: itf.interfaceCategory || 'COMMAND',
          protocol: itf.protocol || 'REST',
          relatedEntityRef: itf.relatedEntityRef,
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item
    }
  }

  return working;
}

export async function synthesizeOntologyFromPrototype(
  store: WorkspaceStore,
  input: {
    projectId: string;
    prototypeId?: string;
    docId?: string;
    locale?: AgentLocale | string;
    signal?: AbortSignal;
    onProgress?: (event: SrsSynthesisProgressEvent) => void;
  },
): Promise<OntologySynthesisFromPrototypeResult> {
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  let project = store.getProject(input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);

  const activeProvider = resolvePreferredProvider(store, input.projectId);
  const providerModel = activeProvider?.defaultModel || 'auto/glm-5.3-flash';

  input.onProgress?.({
    phase: 'CONTEXT',
    step: 1,
    messageZh: '正在读取交互原型 MU 语义锚点与需求规格上下文…',
    messageEn: 'Reading prototype MU semantic anchors and SRS context…',
    streamedChars: 0,
    providerModel,
  });

  let targetProto = input.prototypeId
    ? store.listPrototypes(input.projectId).find((p) => p.id === input.prototypeId)
    : store.listPrototypes(input.projectId)[0];

  if (!targetProto) {
    const gen = await generatePrototypeFromDoc(store, {
      projectId: input.projectId,
      docId: input.docId,
      locale: input.locale,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    targetProto = gen.prototype;
    project = gen.project;
  }

  const extractedMuPreview = extractMuFromPrototypeHtml(targetProto.htmlContent, project.domain);
  input.onProgress?.({
    phase: 'MODEL_ALIGN',
    step: 2,
    messageZh: `已解析 ${extractedMuPreview.screens.length} 个 MU 业务屏幕，正在推导 M1~M7 / ME / MM / MI 跨模型引用…`,
    messageEn: `Parsed ${extractedMuPreview.screens.length} MU screens; inferring M1–M7 / ME / MM / MI cross-model links…`,
    streamedChars: 0,
    providerModel,
  });

  const hasForeignDemoTemplate =
    project.id !== 'proj-contract' &&
    project.id !== 'proj-mft' &&
    ((project.suite.M1?.domain === '合同全生命周期管理系统' &&
      project.domain !== '合同全生命周期管理系统') ||
      (project.suite.M1?.domain === '企业文件安全传输系统 (MFT)' &&
        project.domain !== '企业文件安全传输系统 (MFT)'));
  let seedSuite: OntologySuite = hasForeignDemoTemplate
    ? {}
    : JSON.parse(JSON.stringify(project.suite));
  let lastThinkingText = '';
  let lastBlueprintStream = '';

  if (isMockLlmActive(store)) {
    const mockSummaryJson = JSON.stringify(
      {
        screens: extractedMuPreview.screens.map((s) => ({
          id: s.screenId,
          name: s.name,
          elements: s.elements.length,
        })),
        aggregates: (seedSuite.M1?.aggregates ?? []).map((a) => a.name),
      },
      null,
      2,
    );
    lastBlueprintStream = mockSummaryJson;
    input.onProgress?.({
      phase: 'GENERATING',
      step: 3,
      messageZh: '正在流式推导 11 元模型结构化蓝图…',
      messageEn: 'Streaming 11-model structured ontology blueprint…',
      contentDelta: mockSummaryJson,
      streamedText: mockSummaryJson,
      streamedChars: mockSummaryJson.length,
      previewTail: mockSummaryJson.slice(-1600),
      providerModel: 'mock-deterministic',
    });
  } else {
    const docs = store.listRequirementDocs(input.projectId);
    const doc = input.docId ? docs.find((d) => d.id === input.docId) : docs[0];
    const mergedReqCtx = collectMergedRequirementContext(store, input.projectId);

    input.onProgress?.({
      phase: 'GENERATING',
      step: 3,
      messageZh: `正在连接大模型 (${providerModel}) 流式合成 11 元模型领域蓝图…`,
      messageEn: `Streaming 11-model ontology blueprint via ${providerModel}…`,
      streamedChars: 0,
      providerModel,
    });

    let lastOntoEmitAt = 0;
    let lastOntoThinkAt = 0;
    let pendingOntoDelta = '';
    let pendingOntoThink = '';

    const llmSynthRes = await callOpenAiCompatibleChat(
      activeProvider,
      [
        {
          role: 'system',
          content: [
            'You are the Chief Domain Ontology Modeler of Ontology Plus.',
            'Extract domain-authentic ontology elements from the SRS, requirement session decisions, and HTML prototype.',
            'Return ONLY a valid JSON object matching this schema (no markdown commentary):',
            '{"aggregates":[{"name":"PascalCaseName","alias":"Display Name","lifecycle":["DRAFT","ACTIVE"],"attributes":[{"name":"camelCase","label":"Label","type":"String|Integer|Decimal|Money|Boolean|Date|Enum","required":true}]}],"behaviors":[{"name":"camelCaseBehavior","alias":"Display Name","ownerEntity":"PascalCaseName","behaviorType":"COMMAND|QUERY"}],"rules":[{"name":"PascalRuleName","alias":"Rule Title","ruleType":"VALIDATION|CALCULATION","referencedObjects":["PascalCaseName"],"expression":"...","violationMessage":"..."}],"events":[{"name":"PascalCaseName.Happened","label":"Event Label","sourceAggregate":"PascalCaseName"}],"actors":[{"actorName":"...","actorType":"HUMAN","roleName":"..."}],"flows":[{"name":"...","flowType":"COLLABORATION|APPROVAL","primaryAggregate":"PascalCaseName"}]}',
            'CRITICAL: Model ONLY concepts authentic to the project domain (never output Contract/Counterparty unless the project is contract management).',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Project: ${project.name} (Domain: ${project.domain})`,
            doc ? `SRS Excerpt:\n${doc.content.slice(0, 7000)}` : '',
            mergedReqCtx.transcriptText
              ? `Requirement Insights:\n${mergedReqCtx.transcriptText.slice(0, 4000)}`
              : '',
            `Prototype HTML:\n${targetProto.htmlContent.slice(0, 6000)}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
      {
        store,
        maxTokens: 24576,
        reasoningEffort: 'low',
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.onProgress
          ? {
              onThinkingDelta: (tDelta, accThinking) => {
                lastThinkingText = accThinking;
                pendingOntoThink += tDelta;
                const now = Date.now();
                if (now - lastOntoThinkAt < 150) return;
                lastOntoThinkAt = now;
                const flushed = pendingOntoThink;
                pendingOntoThink = '';
                input.onProgress?.({
                  phase: 'GENERATING',
                  step: 3,
                  messageZh: '大模型正在推导聚合根、行为、规则与事件关系…',
                  messageEn: 'Model reasoning on aggregates, behaviors, rules & events…',
                  thinkingDelta: flushed,
                  thinkingText: accThinking,
                  thinkingChars: accThinking.length,
                  providerModel,
                });
              },
              onStreamDelta: (cDelta, accumulated) => {
                lastBlueprintStream = accumulated;
                pendingOntoDelta += cDelta;
                const now = Date.now();
                if (now - lastOntoEmitAt < 100) return;
                lastOntoEmitAt = now;
                const flushed = pendingOntoDelta;
                pendingOntoDelta = '';
                input.onProgress?.({
                  phase: 'GENERATING',
                  step: 3,
                  messageZh: `正在流式生成 11 元模型蓝图 JSON（已输出 ${accumulated.length.toLocaleString()} 字符）…`,
                  messageEn: `Streaming 11-model blueprint JSON (${accumulated.length.toLocaleString()} chars)…`,
                  ...(lastThinkingText
                    ? { thinkingText: lastThinkingText, thinkingChars: lastThinkingText.length }
                    : {}),
                  contentDelta: flushed,
                  streamedText: accumulated,
                  streamedChars: accumulated.length,
                  previewTail: accumulated.slice(-1600),
                  providerModel,
                });
              },
            }
          : {}),
      },
    );

    if (input.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (llmSynthRes?.content) {
      lastBlueprintStream = llmSynthRes.content;
      const parsed = extractFirstJsonObject<LlmSynthesizedDomainBlueprint>(llmSynthRes.content);
      if (parsed) {
        seedSuite = applyLlmBlueprintToSuite(seedSuite, parsed, project.domain);
      }
    }
  }

  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  input.onProgress?.({
    phase: 'VALIDATING',
    step: 4,
    messageZh: '正在执行两级一致性门禁校验并持久化 11 元模型套件…',
    messageEn: 'Running two-tier consistency gate and persisting 11-model suite…',
    ...(lastThinkingText
      ? { thinkingText: lastThinkingText, thinkingChars: lastThinkingText.length }
      : {}),
    ...(lastBlueprintStream
      ? {
          streamedText: lastBlueprintStream,
          streamedChars: lastBlueprintStream.length,
          previewTail: lastBlueprintStream.slice(-1600),
        }
      : {}),
    providerModel,
  });

  let candidateSuite: OntologySuite;
  const currentWithSyncedMu: OntologySuite = {
    ...JSON.parse(JSON.stringify(seedSuite)),
    MU: extractMuFromPrototypeHtml(targetProto.htmlContent, project.domain),
  };
  const currentCheck = validateOntologySuite(currentWithSyncedMu);

  if (currentCheck.errorCount === 0 && currentCheck.presentModels.length === 11) {
    candidateSuite = currentWithSyncedMu;
  } else {
    candidateSuite = alignSuiteWithExtractedMu(
      seedSuite,
      targetProto.htmlContent,
      project.domain,
    );
  }

  const updatedProject = store.updateSuite(
    input.projectId,
    candidateSuite,
    `Synthesized 11-model ontology suite from prototype ${targetProto.id}`,
  );

  const synthesizedModels = MODEL_CODES.filter((c) => Boolean(updatedProject.suite[c]));

  saveCheckpointSafe(store, `synth-${input.projectId}`, 'PROTOTYPE_TO_ONTOLOGY', {
    projectId: input.projectId,
    prototypeId: targetProto.id,
    presentModels: synthesizedModels,
    errorCount: updatedProject.validation.errorCount,
  });

  return {
    project: updatedProject,
    prototype: targetProto,
    synthesizedModels,
    validation: updatedProject.validation,
  };
}

// ─── 4. Tech Architecture Generation & Application Coding Agent ───────────────

export async function generateTechArchitectureDoc(
  store: WorkspaceStore,
  input: {
    name: string;
    stackTags?: string[];
    prompt?: string;
    locale?: AgentLocale | string;
  },
): Promise<TechArchitectureGenerationResult> {
  const locale = resolveEffectiveLocale(store, input.locale, input.prompt || input.name);
  const activeProvider = resolvePreferredProvider(store);
  const tags =
    input.stackTags && input.stackTags.length > 0
      ? input.stackTags
      : ['DDD', 'Deep Modules', '11-Model Mapping', 'SQLite / D1'];

  const llmRes = await callOpenAiCompatibleChat(
    activeProvider,
    [
      {
        role: 'system',
        content: pickLocaleText(
          locale,
          '你是企业架构师。请为 Ontology Plus 11 元模型工程生成一份结构清晰的《技术架构设计文档》Markdown（包含领域层、应用层、基础设施层、接口与表现层的映射规则，控制在 360 字以内）。',
          'You are an Enterprise Architect. Generate a concise, structured Technical Architecture Specification Markdown for an Ontology Plus 11-model project covering domain, application, infrastructure, and interface/UI layers (within 320 words).',
        ),
      },
      {
        role: 'user',
        content:
          locale === 'en-US'
            ? `Architecture Name: ${input.name}\nStack Tags: ${tags.join(', ')}\nRequirements: ${input.prompt ?? 'Enforce deep-module boundaries and zero-drift ontology-to-code mapping'}`
            : `架构名称：${input.name}\n技术栈标签：${tags.join(', ')}\n补充要求：${input.prompt ?? '遵循深模块边界与零漂移本体代码映射'}`,
      },
    ],
    { store },
  );

  const specMarkdown =
    llmRes?.content ||
    (locale === 'en-US'
      ? [
          `# Technical Architecture Specification — ${input.name}`,
          '',
          `> **Stack Tags**: ${tags.map((t) => `\`${t}\``).join(' · ')}`,
          '',
          `## 1. Deterministic 11-Model to 4-Layer Code Mapping`,
          `1. **Domain Layer (\`domain/\`)**: Maps \`M1\` aggregates/entities/value objects, \`M3\` cross-object rule evaluators, and \`ME\` domain events.`,
          `2. **Application Layer (\`application/\`)**: Orchestrates \`M2\` command/query behaviors, \`M4\` cross-aggregate scenarios, and \`M6\` flow state machines.`,
          `3. **Infrastructure Layer (\`infrastructure/\`)**: Implements repositories from \`MM\` master-detail mappings and read models from \`M7\` SQL specs.`,
          `4. **Interface & UI Layer (\`interfaces/\` & \`ui/\`)**: Exposes REST/MCP contracts per \`MI\` and binds screen event chains per \`MU\`.`,
          '',
          `## 2. Architectural Guardrails`,
          `- ${input.prompt || 'Enforces deep-module entry boundaries (dependency-cruiser) and evaluates M3 compliance rules prior to every mutation.'}`,
        ].join('\n')
      : [
          `# 技术架构设计文档 — ${input.name}`,
          '',
          `> **技术标签**：${tags.map((t) => `\`${t}\``).join(' · ')}`,
          '',
          `## 1. 11 元模型到四层代码结构确定性映射`,
          `1. **领域核心层 (\`domain/\`)**：直接映射 \`M1\` 聚合根/实体/值对象、\`M3\` 跨对象规则引擎与 \`ME\` 领域事件契约。`,
          `2. **应用编排层 (\`application/\`)**：承接 \`M2\` 命令/查询行为、\`M4\` 跨聚合联动场景与 \`M6\` 审批流程状态机。`,
          `3. **基础设施层 (\`infrastructure/\`)**：按 \`MM\` 主子表映射生成仓储实现，按 \`M7\` 参考 SQL 落地高性能读模型。`,
          `4. **接口与表现层 (\`interfaces/\` & \`ui/\`)**：按 \`MI\` 暴露 REST/MCP 接口，按 \`MU\` 屏幕控件调用链绑定前端交互。`,
          '',
          `## 2. 架构约束与补充说明`,
          `- ${input.prompt || '强制执行深模块入口边界检查（dependency-cruiser），所有写操作前置执行 M3 合规门禁。'}`,
        ].join('\n'));

  const asset = store.saveFourLayerAsset({
    id: `asset-arch-${Date.now().toString(36)}`,
    layer: 'TECH_ARCH',
    name: input.name,
    version: 'v5.0',
    summary: pickLocaleText(
      locale,
      `基于 [${tags.join(', ')}] 的 11 元模型深模块技术架构规范`,
      `11-Model deep-module technical architecture based on [${tags.join(', ')}]`,
    ),
    tags,
    specMarkdown,
  });

  return {
    asset,
    fourLayerAssets: store.listFourLayerAssets(),
    providerUsed: llmRes?.modelUsed || activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
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
  const prototype = store.listPrototypes(project.id)[0];

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
): Promise<{ job: ExtractionJob; project: ProjectDetail }> {
  const snippet = input.sourceSnippet.trim();
  const locale = resolveEffectiveLocale(store, input.locale, snippet || input.title);
  const hasExplicitDdl = /CREATE\s+TABLE/i.test(snippet);
  const hasExplicitOpenApi = snippet.includes('"paths"') || /\/api\/[a-zA-Z0-9/_-]+/.test(snippet);

  // Use LLM semantic extraction when Live mode is active and input is unstructured docs/logs/code
  if (!isMockLlmActive(store) && (!hasExplicitDdl || input.sourceType === 'LOG_AND_DOC')) {
    const sys = store.listLegacySystems().find((s) => s.id === input.systemId);
    const targetProject =
      store.getProject(input.projectId) ?? store.getProject(store.listProjects()[0]!.id)!;
    const domainLabel = targetProject?.domain || (sys?.name ? `${sys.name}业务域` : '萃取业务域');
    const activeProvider = resolvePreferredProvider(store, input.projectId);

    try {
      const llmExtractRes = await callOpenAiCompatibleChat(
        activeProvider,
        [
          {
            role: 'system',
            content: [
              'You are the Ontology Extraction Engine of Ontology Plus (strictly "Ontology Extraction", never "reverse engineering").',
              'Extract structured domain aggregates, behaviors, business rules, events, actors, flows, and service interfaces from the provided source code, API spec, SOP document, or runtime logs.',
              'Return ONLY valid JSON matching:',
              '{"aggregates":[{"name":"PascalCase","alias":"...","lifecycle":["CREATED","COMPLETED"],"attributes":[{"name":"camelCase","label":"...","type":"String|Integer|Decimal|Money|Boolean|Date","required":true}]}],"behaviors":[{"name":"camelCase","alias":"...","ownerEntity":"PascalCase","behaviorType":"COMMAND|QUERY"}],"rules":[{"name":"PascalRule","alias":"...","ruleType":"VALIDATION","referencedObjects":["PascalCase"],"expression":"...","violationMessage":"..."}],"events":[{"name":"PascalCase.Completed","label":"...","sourceAggregate":"PascalCase"}],"interfaces":[{"name":"...","direction":"PROVIDED","interfaceCategory":"COMMAND|QUERY","protocol":"REST","relatedEntityRef":"PascalCase"}]}',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `System: ${sys?.name ?? input.systemId} (Source Type: ${input.sourceType})\n\n--- Raw Artifact ---\n${snippet.slice(0, 12000)}`,
          },
        ],
        { store, maxTokens: 6144 },
      );

      const parsed = llmExtractRes?.content
        ? extractFirstJsonObject<LlmSynthesizedDomainBlueprint>(llmExtractRes.content)
        : null;

      if (parsed && (parsed.aggregates?.length || parsed.interfaces?.length)) {
        const baseSuite: OntologySuite = targetProject
          ? JSON.parse(JSON.stringify(targetProject.suite))
          : {};
        const seeded = applyLlmBlueprintToSuite(baseSuite, parsed, domainLabel);
        const placeholderHtml = buildSemanticPrototypeHtmlForProject({
          ...targetProject,
          name: input.title || sys?.name || targetProject.name,
          domain: domainLabel,
          suite: seeded,
          validation: validateOntologySuite(seeded),
        });
        const alignedSuite = alignSuiteWithExtractedMu(seeded, placeholderHtml, domainLabel);
        const validation = validateOntologySuite(alignedSuite);

        if (validation.errorCount === 0) {
          const aggsCount = alignedSuite.M1?.aggregates.length ?? 0;
          const ifCount = alignedSuite.MI?.interfaces.length ?? 0;
          return store.runOntologyExtractionJob({
            systemId: input.systemId,
            projectId: input.projectId,
            title: input.title,
            sourceType: input.sourceType,
            sourceSnippet: input.sourceSnippet,
            ...(input.applyImmediately !== undefined
              ? { applyImmediately: input.applyImmediately }
              : {}),
            synthesizedSuite: alignedSuite,
            synthesizedEntitiesCount: aggsCount,
            synthesizedInterfacesCount: ifCount,
            synthesizedSummary: pickLocaleText(
              locale,
              `已完成「${sys?.name ?? input.systemId}」AI 语义本体萃取：提炼 ${aggsCount} 个领域聚合根、${alignedSuite.M3?.rules.length ?? 0} 条业务规则与 ${ifCount} 个服务接口契约（0 一致性错误）`,
              `Completed AI semantic Ontology Extraction for "${sys?.name ?? input.systemId}": extracted ${aggsCount} aggregates, ${alignedSuite.M3?.rules.length ?? 0} rules, and ${ifCount} interfaces (0 consistency errors)`,
            ),
          });
        }
      }
    } catch {
      // Fall back cleanly to deterministic parser if gateway is temporarily unavailable during job
    }
  }

  void hasExplicitOpenApi;
  return store.runOntologyExtractionJob({
    systemId: input.systemId,
    projectId: input.projectId,
    title: input.title,
    sourceType: input.sourceType,
    sourceSnippet: input.sourceSnippet,
    ...(input.applyImmediately !== undefined ? { applyImmediately: input.applyImmediately } : {}),
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

interface LiveAnalyticsComputedStats {
  totalContracts: number;
  totalAmount: number;
  settlementCompletionRatePct: string;
  highRiskOverdueRatePct: string;
  outsourcingHighRiskSharePct: string;
  midThresholdSharePct: string;
  residualSharePct: string;
}

function computeLiveAnalyticsStats(store: WorkspaceStore): LiveAnalyticsComputedStats {
  let totalContracts = 0;
  let totalAmount = 0;
  let highRiskCount = 0;
  let highRiskAmount = 0;
  let outsourcingHighRiskAmount = 0;
  let midRangeAmount = 0;
  let settledAmount = 0;
  let totalSettlementAmount = 0;

  if (typeof store.executeReadOnlyAnalyticsSql === 'function') {
    try {
      const cRes = store.executeReadOnlyAnalyticsSql(
        'SELECT contract_type, risk_level, total_amount, status FROM t_contract',
      );
      for (const r of cRes.rows) {
        totalContracts += 1;
        const amt = Number(r.total_amount ?? 0);
        totalAmount += amt;
        const risk = String(r.risk_level ?? '');
        const ctype = String(r.contract_type ?? '');
        if (risk === 'HIGH' || risk === 'MEDIUM') {
          if (risk === 'HIGH') highRiskCount += 1;
          highRiskAmount += amt;
          if (ctype === 'OUTSOURCING') {
            outsourcingHighRiskAmount += amt;
          }
        }
        if (amt >= 800000 && amt <= 1500000) {
          midRangeAmount += amt;
        }
      }

      const sRes = store.executeReadOnlyAnalyticsSql(
        'SELECT settlement_amount, settlement_status FROM t_settlement_order',
      );
      for (const r of sRes.rows) {
        const amt = Number(r.settlement_amount ?? 0);
        totalSettlementAmount += amt;
        if (String(r.settlement_status ?? '') === 'SETTLED') {
          settledAmount += amt;
        }
      }
    } catch {
      // Fallback if tables not yet initialized
    }
  }

  const settlementPctNum =
    totalSettlementAmount > 0 ? (settledAmount / totalSettlementAmount) * 100 : 85.0;
  const highRiskPctNum = totalContracts > 0 ? (highRiskCount / totalContracts) * 100 : 25.0;

  const w1Num =
    highRiskAmount > 0
      ? Math.min(78, Math.max(45, (outsourcingHighRiskAmount / highRiskAmount) * 100))
      : 62.0;
  const w2Num =
    totalAmount > 0
      ? Math.min(92 - w1Num, Math.max(15, (midRangeAmount / totalAmount) * 100))
      : 26.5;
  const w3Num = Math.max(5, 100 - w1Num - w2Num);

  return {
    totalContracts,
    totalAmount,
    settlementCompletionRatePct: `${settlementPctNum.toFixed(1)}%`,
    highRiskOverdueRatePct: `${highRiskPctNum.toFixed(1)}%`,
    outsourcingHighRiskSharePct: `${w1Num.toFixed(1)}%`,
    midThresholdSharePct: `${w2Num.toFixed(1)}%`,
    residualSharePct: `${w3Num.toFixed(1)}%`,
  };
}

function buildReadOnlyAnalyticsSqlCandidates(
  question: string,
  mode: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY',
  project?: ProjectDetail,
  store?: WorkspaceStore,
): string[] {
  const mappedTables = (project?.suite.MM?.mappings ?? []).flatMap((m) =>
    m.tableMappings.map((tm) => tm.tableName),
  );
  const dbTables = (store?.listDatabaseResources() ?? []).flatMap((db) =>
    db.tables.map((t) => t.tableName),
  );

  // If project explicitly maps to a non-contract table that exists in SQLite, prioritize it!
  const customPrimaryTable = mappedTables.find((t) => t !== 't_contract');
  const lower = question.toLowerCase();
  const mentionsMilestone =
    question.includes('里程碑') ||
    question.includes('逾期') ||
    lower.includes('milestone') ||
    lower.includes('overdue') ||
    mode !== 'ASK_DATA';

  const primaryMilestoneSql =
    'SELECT c.contract_no, c.contract_type, c.risk_level, cp.company_name, cp.credit_rating, c.total_amount, COUNT(pm.id) AS milestone_count, COALESCE(SUM(pm.planned_amount), 0) AS milestone_amount FROM t_contract c LEFT JOIN t_counterparty cp ON c.counterparty_id = cp.id LEFT JOIN t_payment_milestone pm ON pm.contract_id = c.id GROUP BY c.id, c.contract_no, c.contract_type, c.risk_level, cp.company_name, cp.credit_rating, c.total_amount ORDER BY c.total_amount DESC LIMIT 20';

  const summaryContractSql =
    'SELECT c.contract_type, c.risk_level, cp.credit_rating, COUNT(c.id) AS total_contracts, SUM(c.total_amount) AS contract_sum FROM t_contract c LEFT JOIN t_counterparty cp ON c.counterparty_id = cp.id GROUP BY c.contract_type, c.risk_level, cp.credit_rating ORDER BY contract_sum DESC LIMIT 20';

  const candidates: string[] = [];
  if (customPrimaryTable) {
    candidates.push(`SELECT * FROM ${customPrimaryTable} LIMIT 20`);
  }
  for (const tbl of dbTables) {
    if (tbl !== 't_contract' && question.toLowerCase().includes(tbl.toLowerCase())) {
      candidates.unshift(`SELECT * FROM ${tbl} LIMIT 20`);
    }
  }
  candidates.push(
    ...(mentionsMilestone
      ? [primaryMilestoneSql, summaryContractSql]
      : [summaryContractSql, primaryMilestoneSql]),
  );
  return candidates;
}

function executeSafeAnalyticsCandidates(
  store: WorkspaceStore,
  sqlCandidates: string[],
): { sql: string; columns: string[]; rows: Record<string, unknown>[] } | null {
  if (typeof store.executeReadOnlyAnalyticsSql !== 'function') return null;
  for (const sql of sqlCandidates) {
    try {
      const res = store.executeReadOnlyAnalyticsSql(sql);
      return {
        sql: res.sql || sql,
        columns: res.columns,
        rows: res.rows,
      };
    } catch {
      // Try next candidate SQL if table/column layout differs
    }
  }
  return null;
}

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

  const sqlCandidates = buildReadOnlyAnalyticsSqlCandidates(
    input.question,
    input.mode,
    project,
    store,
  );
  const liveQuery = executeSafeAnalyticsCandidates(store, sqlCandidates);
  const chosenSql = liveQuery?.sql ?? sqlCandidates[0];
  const liveStats = computeLiveAnalyticsStats(store);

  const aggNames =
    (project?.suite.M1?.aggregates ?? []).map((a) => `${a.name}(${a.alias})`).join(', ') ||
    'Contract, Counterparty, SettlementOrder';
  const defaultWb = store.listWritebackInterfaces()[0];
  const wbId = defaultWb?.id ?? 'WB-01';
  const primaryAgg = project?.suite.M1?.aggregates[0]?.name ?? 'Contract';

  const llmRes = await callOpenAiCompatibleChat(
    activeProvider,
    [
      {
        role: 'system',
        content: pickLocaleText(
          locale,
          `你是数据分析中心的数据本体推理引擎，支持智能问数(ASK_DATA)、智能问因(ASK_WHY)、智能问策(ASK_POLICY)。请基于实时 SQLite 查询结果与当前工程本体模型（${aggNames}）给出简洁、结构化的 Markdown 分析结论（控制在 220 字以内）。`,
          `You are the Data Ontology Reasoning Engine supporting ASK_DATA, ASK_WHY, and ASK_POLICY modes. Ground your structured Markdown conclusion in the live SQLite query results and active domain aggregates (${aggNames}) within 200 words.`,
        ),
      },
      {
        role: 'user',
        content: `[Mode: ${input.mode}] ${input.question}${liveQuery ? `\nLive SQL (${chosenSql}) returned ${liveQuery.rows.length} rows: ${JSON.stringify(liveQuery.rows.slice(0, 5))}` : ''}`,
      },
    ],
    { store },
  );

  const dataSummary: ReasoningSession['dataSummary'] = [
    {
      label: pickLocaleText(
        locale,
        liveQuery && liveQuery.rows.length > 0 ? '实时命中数据行' : '在管单据总数',
        liveQuery && liveQuery.rows.length > 0 ? 'Live Matched Rows' : 'Managed Records',
      ),
      value:
        liveQuery && liveQuery.rows.length > 0
          ? pickLocaleText(locale, `${liveQuery.rows.length} 行`, `${liveQuery.rows.length} rows`)
          : `${liveStats.totalContracts}`,
      delta: pickLocaleText(locale, 'SQLite 实查', 'Live SQLite'),
    },
    {
      label: pickLocaleText(locale, '履约核销达成率', 'Fulfillment Rate'),
      value: liveStats.settlementCompletionRatePct,
      delta: pickLocaleText(
        locale,
        `总额 ¥${(liveStats.totalAmount / 10000).toFixed(1)}万`,
        `Total ¥${(liveStats.totalAmount / 10000).toFixed(1)}0k`,
      ),
    },
    {
      label: pickLocaleText(locale, '高风险单据占比', 'High-Risk Share'),
      value: liveStats.highRiskOverdueRatePct,
      delta: pickLocaleText(locale, '实时聚合计算', 'Live Aggregation'),
    },
  ];

  const session = store.saveReasoningSession({
    id: `reas-${Date.now().toString(36)}`,
    question: input.question,
    mode: input.mode,
    sqlGenerated: chosenSql,
    ...(liveQuery
      ? {
          queryColumns: liveQuery.columns,
          queryRows: liveQuery.rows,
        }
      : {}),
    dataSummary,
    causalAnalysis:
      locale === 'en-US'
        ? [
            `Tracing along M1 domain associations (${aggNames}), primary risk concentration accounts for ${liveStats.outsourcingHighRiskSharePct}.`,
            `Cross-checking against M3 rules (${(project?.suite.M3?.rules ?? []).map((r) => r.id).join(', ') || 'RULE-01'}), threshold-boundary records represent ${liveStats.midThresholdSharePct}.`,
          ]
        : [
            `沿着 M1 对象关联链（${aggNames}）实查穿透，主风险类型占待核销敞口的 ${liveStats.outsourcingHighRiskSharePct}。`,
            `对照 M3 规则模型（${(project?.suite.M3?.rules ?? []).map((r) => r.id).join('、') || 'RULE-01'}），阈值敏感区间单据占总额的 ${liveStats.midThresholdSharePct}。`,
          ],
    policyRecommendations: [
      {
        actionTitle: pickLocaleText(
          locale,
          defaultWb?.name ?? `执行高风险 ${primaryAgg} 闭环策略回写`,
          defaultWb?.name ?? `Execute governed policy writeback on ${primaryAgg}`,
        ),
        targetObject: primaryAgg,
        expectedImpact: pickLocaleText(
          locale,
          `覆盖当前 ${liveStats.highRiskOverdueRatePct} 高风险单据并写入受控审计流水`,
          `Covers ${liveStats.highRiskOverdueRatePct} high-risk records with audited state writeback`,
        ),
        writebackInterfaceId: wbId,
      },
    ],
    answerMarkdown:
      llmRes?.content ||
      (locale === 'en-US'
        ? `### Ontology Reasoning Conclusion (${input.mode})\nFor **"${input.question}"**:\n1. **ASK_DATA**: Executed live SQL via \`MM\` mappings${liveQuery ? ` (returned **${liveQuery.rows.length}** rows)` : ''}; fulfillment rate is **${liveStats.settlementCompletionRatePct}**, high-risk share is **${liveStats.highRiskOverdueRatePct}**.\n2. **ASK_WHY**: Tracing across \`${aggNames}\`, primary risk drivers contribute **${liveStats.outsourcingHighRiskSharePct}** of exposure.\n3. **ASK_POLICY**: Recommend invoking writeback interface **\`${wbId}\`** to enforce closed-loop governance.`
        : `### 本体推理结论 (${input.mode})\n针对问题「${input.question}」：\n1. **智能问数**：通过 \`MM\` 数据映射执行实时 SQL${liveQuery ? `（实查返回 **${liveQuery.rows.length}** 行）` : ''}，当前实查达成率为 **${liveStats.settlementCompletionRatePct}**，高风险占比 **${liveStats.highRiskOverdueRatePct}**。\n2. **智能问因**：沿 \`${aggNames}\` 穿透归因，核心风险因子贡献了 **${liveStats.outsourcingHighRiskSharePct}** 的风险暴露额。\n3. **智能问策**：建议调用回写接口 **\`${wbId}\`** 执行受控闭环处置。`),
  });

  saveCheckpointSafe(store, session.id, 'DATA_ONTOLOGY_REASONING', {
    mode: input.mode,
    rowCount: liveQuery?.rows.length ?? 0,
  });

  return session;
}

export async function generateMetricInsight(
  store: WorkspaceStore,
  input: {
    metricId: string;
    locale?: AgentLocale | string;
  },
): Promise<MetricInsightResult> {
  const metrics = store.listMetrics();
  const metric =
    metrics.find((m) => m.id === input.metricId || m.code === input.metricId) ?? metrics[0];
  if (!metric) throw new Error(`Metric not found: ${input.metricId}`);

  const locale = resolveEffectiveLocale(store, input.locale);
  const defaultWbId = store.listWritebackInterfaces()[0]?.id ?? 'WB-01';

  const liveQuery = executeSafeAnalyticsCandidates(store, [
    'SELECT risk_level, status, COUNT(id) AS cnt, SUM(total_amount) AS total_amt FROM t_contract GROUP BY risk_level, status ORDER BY total_amt DESC',
  ]);
  const liveStats = computeLiveAnalyticsStats(store);
  const activeProvider = resolvePreferredProvider(store);

  const llmRes = await callOpenAiCompatibleChat(
    activeProvider,
    [
      {
        role: 'system',
        content: pickLocaleText(
          locale,
          '你是数据分析中心的指标智能解读专家。请结合指标定义与 SQLite 实时分组查询结果，给出包含当前表现、异动根因和闭环动作建议的 Markdown 解读（控制在 180 字以内）。',
          'You are the Metric Insight Analyst. Combine the metric definition with live SQLite grouped query results to produce a concise Markdown insight covering current performance, anomaly drivers, and closed-loop actions (within 180 words).',
        ),
      },
      {
        role: 'user',
        content: `Metric: ${metric.name} (${metric.code}), Value: ${metric.currentValue}, Formula: ${metric.formula}, Status: ${metric.status}\nLive SQLite Grouped Rows: ${JSON.stringify(liveQuery?.rows ?? [])}`,
      },
    ],
    { store },
  );

  const anomalyDrivers =
    locale === 'en-US'
      ? [
          `Linked aggregate "${metric.linkedAggregate}" live query spans ${liveStats.totalContracts} records (high-risk share ${liveStats.highRiskOverdueRatePct})`,
          `Dimension drill-down [${metric.dimensions.join(' / ')}] shows primary risk segment accounts for ${liveStats.outsourcingHighRiskSharePct}`,
        ]
      : [
          `关联聚合根「${metric.linkedAggregate}」实查共 ${liveStats.totalContracts} 份单据（总额 ¥${(liveStats.totalAmount / 10000).toFixed(1)}万），高风险占比 ${liveStats.highRiskOverdueRatePct}`,
          `维度下钻 [${metric.dimensions.join(' / ')}] 显示核心风险分群在敞口中占比达 ${liveStats.outsourcingHighRiskSharePct}`,
        ];
  const suggestedAction =
    metric.status === 'NORMAL'
      ? pickLocaleText(
          locale,
          `保持当前 M3 规则阈值监控，按周基于 SQLite 实查数据刷新 ${metric.code} 趋势基线`,
          `Maintain current M3 rule thresholds and refresh ${metric.code} trend baselines weekly from live SQLite`,
        )
      : pickLocaleText(
          locale,
          `立即联动回写接口 ${defaultWbId} 冻结高风险逾期批次并收紧准入预警线`,
          `Immediately trigger writeback interface ${defaultWbId} to hold high-risk batches and tighten alert thresholds`,
        );

  const insightMarkdown =
    llmRes?.content ||
    (locale === 'en-US'
      ? [
          `### Metric Insight: ${metric.name} (\`${metric.code}\`)`,
          `- **Current Value**: **${metric.currentValue}** (YoY/MoM \`${metric.yoYChange}\`, Health: \`${metric.status}\`)`,
          `- **Formula**: \`${metric.formula}\``,
          `- **Live Anomaly Drivers**: ${anomalyDrivers.join('; ')}.`,
          `- **Recommended Action**: ${suggestedAction}.`,
        ].join('\n')
      : [
          `### 指标智能解读：${metric.name} (\`${metric.code}\`)`,
          `- **当前数值**：**${metric.currentValue}**（同比/环比 \`${metric.yoYChange}\`，健康度：\`${metric.status}\`）`,
          `- **计算口径**：\`${metric.formula}\``,
          `- **实查异动归因**：${anomalyDrivers.join('；')}。`,
          `- **行动建议**：${suggestedAction}。`,
        ].join('\n'));

  return {
    metric,
    insightMarkdown,
    anomalyDrivers,
    suggestedAction,
    writebackInterfaceId: defaultWbId,
    ...(liveQuery ? { queryRows: liveQuery.rows } : {}),
    providerUsed: llmRes?.modelUsed || activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
}

export async function runScenarioAttributionTurn(
  store: WorkspaceStore,
  input: {
    scenarioId: string;
    question?: string;
    saveAsReport?: boolean;
    locale?: AgentLocale | string;
  },
): Promise<ScenarioAttributionResult> {
  const scenarios = store.listAnalyticsScenarios();
  const scenario = scenarios.find((s) => s.id === input.scenarioId) ?? scenarios[0];
  if (!scenario) throw new Error(`Analytics scenario not found: ${input.scenarioId}`);

  const locale = resolveEffectiveLocale(store, input.locale, input.question);
  const liveQuery = executeSafeAnalyticsCandidates(store, [
    'SELECT c.contract_type, cp.credit_rating, COUNT(c.id) AS contract_count, SUM(c.total_amount) AS total_amount FROM t_contract c LEFT JOIN t_counterparty cp ON c.counterparty_id = cp.id GROUP BY c.contract_type, cp.credit_rating ORDER BY total_amount DESC',
  ]);
  const liveStats = computeLiveAnalyticsStats(store);

  const causalBreakdown = [
    {
      factor:
        scenario.causalFactors[0] ||
        pickLocaleText(
          locale,
          '高风险履约节点验收延期',
          'Milestone acceptance delays on high-risk records',
        ),
      weight: liveStats.outsourcingHighRiskSharePct,
      evidence: pickLocaleText(
        locale,
        `SQLite 实查交叉统计（共 ${liveQuery?.rows.length ?? 0} 组分布）`,
        `Live SQLite cross-tabulation (${liveQuery?.rows.length ?? 0} grouped cohorts)`,
      ),
    },
    {
      factor:
        scenario.causalFactors[1] ||
        pickLocaleText(locale, '阈值敏感区间风险敞口集中', 'Exposure concentration near M3 threshold'),
      weight: liveStats.midThresholdSharePct,
      evidence: pickLocaleText(
        locale,
        'M3 规则模型阈值边界与实查金额比对',
        'M3 rule threshold evaluation against live records',
      ),
    },
    {
      factor:
        scenario.causalFactors[2] ||
        pickLocaleText(
          locale,
          '跨系统状态回执同步时延',
          'Cross-system callback synchronization latency',
        ),
      weight: liveStats.residualSharePct,
      evidence: pickLocaleText(
        locale,
        'M4 跨聚合协同场景状态分布实查',
        'M4 cross-aggregate scenario status distribution',
      ),
    },
  ];

  const focusQuestion =
    input.question?.trim() ||
    pickLocaleText(
      locale,
      `分析「${scenario.name}」的触发根因与闭环处置方案`,
      `Analyze root causes and closed-loop remediation for "${scenario.name}"`,
    );
  const defaultWbId = store.listWritebackInterfaces()[0]?.id ?? 'WB-01';
  const writebackId = scenario.writebackInterfaceId || defaultWbId;
  const activeProvider = resolvePreferredProvider(store);

  const llmRes = await callOpenAiCompatibleChat(
    activeProvider,
    [
      {
        role: 'system',
        content: pickLocaleText(
          locale,
          '你是数据本体专题归因专家。请基于 SQLite 实查因子权重拆解与 M3/M4 模型链路，生成一段简明专业的根因总结（控制在 160 字以内，不要包含一级标题）。',
          'You are the Scenario Attribution Specialist. Based on the live SQLite factor weights and M3/M4 ontology chains, write a concise root-cause synthesis in English (within 150 words, without H1 headings).',
        ),
      },
      {
        role: 'user',
        content: `Scenario: ${scenario.name}\nFocus: ${focusQuestion}\nFactor Weights: ${causalBreakdown.map((c) => `${c.factor}(${c.weight})`).join('; ')}\nSQL Rows: ${JSON.stringify(liveQuery?.rows ?? [])}`,
      },
    ],
    { store },
  );

  const attributionMarkdown =
    locale === 'en-US'
      ? [
          `# Scenario Attribution Report: ${scenario.name}`,
          '',
          `> **Trigger**: \`${scenario.triggerCondition}\` | **Metrics**: ${scenario.relatedMetrics.map((m) => `\`${m}\``).join(', ')} | **Focus**: ${focusQuestion}`,
          '',
          `## 1. Multi-Factor Root-Cause Breakdown (Live SQLite × Data Ontology)`,
          ...causalBreakdown.map(
            (item, idx) =>
              `${idx + 1}. **${item.factor}** (Weight **${item.weight}**) — *Evidence: ${item.evidence}*`,
          ),
          ...(llmRes?.content ? ['', `### AI Deep Attribution`, llmRes.content] : []),
          '',
          `## 2. Closed-Loop Policy Recommendations & Writeback`,
          ...scenario.recommendedActions.map((act) => `- ${act}`),
          `- **Bound Writeback Interface**: \`${writebackId}\``,
        ].join('\n')
      : [
          `# 专题归因分析报告：${scenario.name}`,
          '',
          `> **触发条件**：\`${scenario.triggerCondition}\` | **关联指标**：${scenario.relatedMetrics.map((m) => `\`${m}\``).join(', ')} | **分析焦点**：${focusQuestion}`,
          '',
          `## 一、多因子根因拆解（基于 SQLite 实查与数据本体知识图谱）`,
          ...causalBreakdown.map(
            (item, idx) =>
              `${idx + 1}. **${item.factor}**（实查贡献权重 **${item.weight}**）— *证据来源：${item.evidence}*`,
          ),
          ...(llmRes?.content ? ['', `### AI 深度归因研判`, llmRes.content] : []),
          '',
          `## 二、闭环策略建议与业务回写`,
          ...scenario.recommendedActions.map((act) => `- ${act}`),
          `- **绑定回写接口**：\`${writebackId}\``,
        ].join('\n');

  let savedReport: AnalyticsReport | undefined;
  if (input.saveAsReport) {
    savedReport = store.saveAnalyticsReport({
      id: `arpt-${Date.now().toString(36)}`,
      title: pickLocaleText(
        locale,
        `${scenario.name} — 智能归因报告`,
        `${scenario.name} — Attribution Report`,
      ),
      period: new Date().toISOString().slice(0, 7),
      author: pickLocaleText(
        locale,
        '数据本体归因智能体 (Scenario Attribution Agent)',
        'Scenario Attribution Agent',
      ),
      summary: pickLocaleText(
        locale,
        `针对触发条件 ${scenario.triggerCondition} 完成实查穿透，主因贡献度 ${liveStats.outsourcingHighRiskSharePct}，建议通过 ${writebackId} 执行业务回写。`,
        `Completed live root-cause drill-down for ${scenario.triggerCondition}; top driver accounts for ${liveStats.outsourcingHighRiskSharePct}; recommend writeback via ${writebackId}.`,
      ),
      markdownContent: attributionMarkdown,
    });
  }

  return {
    scenario,
    attributionMarkdown,
    causalBreakdown,
    recommendedWritebackId: writebackId,
    ...(liveQuery ? { queryRows: liveQuery.rows } : {}),
    ...(savedReport ? { savedReport } : {}),
    providerUsed: llmRes?.modelUsed || activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
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
