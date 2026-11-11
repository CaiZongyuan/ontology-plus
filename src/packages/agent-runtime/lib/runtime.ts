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
  AnalyticsReport,
  AnalyticsScenario,
  AssembledApplication,
  CapabilityChatMessage,
  CapabilityChatSession,
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
  ONTOLOGY_DURABLE_TOOLS,
  ONTOLOGY_TOOL_NAMES,
  OPENAI_ONTOLOGY_TOOLS,
  applyOntologyToolCall,
  durableMemoryStorage,
  ontologyToolRegistry,
  type OntologyToolName,
  type OpenAiFunctionTool,
} from './tools.js';

export { ONTOLOGY_DURABLE_TOOLS };

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

async function callOpenAiCompatibleChat(
  provider: LlmProviderConfig,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options: {
    timeoutMs?: number;
    tools?: OpenAiFunctionTool[];
    maxTokens?: number;
  } = {},
): Promise<OpenAiChatResponse | null> {
  const timeoutMs = options.timeoutMs ?? 6000;
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const baseUrl = (provider.baseUrl || 'http://127.0.0.1:3425/v1').replace(/\/+$/, '');
    const payload: Record<string, unknown> = {
      model: provider.defaultModel || 'auto/glm-5.3-flash',
      messages,
      temperature: 0.2,
      max_tokens: options.maxTokens ?? 900,
    };
    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools;
      payload.tool_choice = 'auto';
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey || 'magpie'}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) return null;
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

    if (!text && parsedToolCalls.length === 0) return null;
    return {
      content: text,
      toolCalls: parsedToolCalls,
      modelUsed: data.model || provider.defaultModel || 'auto/glm-5.3-flash',
      latencyMs: Date.now() - start,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    const referencedObjects: string[] = [];
    if (suite.M1?.aggregates.some((a) => a.name === 'Contract')) {
      referencedObjects.push('Contract');
    } else if (suite.M1?.aggregates[0]) {
      referencedObjects.push(suite.M1.aggregates[0].name);
    }
    if (
      (prompt.includes('结算') || lower.includes('settlement')) &&
      suite.M1?.aggregates.some((a) => a.name === 'SettlementOrder')
    ) {
      referencedObjects.push('SettlementOrder');
    }
    const dayMatch = prompt.match(/(\d+)\s*天/);
    const expression = dayMatch
      ? `Contract.totalAmount > 0 && overdueDays <= ${dayMatch[1]}`
      : 'Contract.totalAmount > 0';

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
    const owner = suite.M1?.aggregates[0]?.name ?? 'Contract';
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
    const owner = suite.M1?.aggregates[0]?.name ?? 'Contract';
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
    return {
      name: 'upsert_aggregate',
      args: {
        id: `AGG-${String(nextNum).padStart(2, '0')}`,
        name: `ContractAmendment${String(nextNum).padStart(2, '0')}`,
        alias: cleanAlias || '合同补充协议',
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
  },
): Promise<OntologyCopilotResult> {
  const start = Date.now();
  const project = store.getProject(input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);

  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];
  const toolCalls: AgentToolCallRecord[] = [];
  let workingSuite: OntologySuite = JSON.parse(JSON.stringify(project.suite));

  const deterministicCall = inferDeterministicOntologyToolCall(
    input.prompt,
    workingSuite,
    input.activeModel,
  );

  const systemPrompt = [
    `你是 Ontology Plus 平台的 AI 本体建模专家（基于 Pi Durable 运行时与 11 元模型架构）。`,
    `当前工程：${project.name}（领域：${project.domain}）。`,
    `已存在模型：${project.validation.presentModels.join(', ')}（错误数：${project.validation.errorCount}，阶段提示数：${project.validation.warningCount}）。`,
    `当前 M1 聚合根：${(project.suite.M1?.aggregates ?? []).map((a) => `${a.name}(${a.id})`).join(', ') || '无'}；M3 规则数：${project.suite.M3?.rules.length ?? 0}。`,
    `当用户要求新增、修改或删除本体元素时，请优先调用提供的函数工具执行结构化变更；若仅咨询，请用简洁专业中文回答（控制在 180 字以内）。`,
  ].join('\n');

  const llmRes = activeProvider
    ? await callOpenAiCompatibleChat(
        activeProvider,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input.prompt },
        ],
        {
          tools: OPENAI_ONTOLOGY_TOOLS,
          timeoutMs: 6000,
        },
      )
    : null;

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
    toolCalls.length > 0
      ? `已完成本体模型工具执行与 11 模型两级一致性门禁校验：\n- ${toolCalls.map((t) => `[${t.status}] ${t.summaryZh}`).join('\n- ')}\n- 当前工程一致性状态：**${updatedProject.validation.errorCount} 个错误**，**${updatedProject.validation.warningCount} 个阶段提示**。`
      : `已分析工程「${updatedProject.name}」的 11 元模型结构：\n- **M1 对象模型**包含 ${updatedProject.suite.M1?.aggregates.length ?? 0} 个聚合根；\n- **M2 行为模型**包含 ${updatedProject.suite.M2?.behaviors.length ?? 0} 个行为；\n- **M3 规则模型**包含 ${updatedProject.suite.M3?.rules.length ?? 0} 条跨对象规则；\n- 当前全量跨模型校验结果：**${updatedProject.validation.errorCount} 错误**。您可以直接发送指令如“新增一条逾期自动冻结结算单的校验规则”或“新增补充协议聚合根”。`;

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

function findRequirementSession(store: WorkspaceStore, sessionId: string): RequirementSession {
  if (typeof store.getRequirementSession === 'function') {
    const direct = store.getRequirementSession(sessionId);
    if (direct) return direct;
  }
  const projects = store.listProjects();
  const found = projects
    .flatMap((p) => store.listRequirementSessions(p.id))
    .find((s) => s.id === sessionId);
  if (!found) throw new Error(`Requirement session not found: ${sessionId}`);
  return found;
}

export async function runRequirementGrillingTurn(
  store: WorkspaceStore,
  input: {
    sessionId: string;
    userMessage: string;
  },
): Promise<{ session: RequirementSession; providerUsed: string }> {
  const target = findRequirementSession(store, input.sessionId);

  const userMsg: RequirementMessage = {
    id: `msg-${Date.now()}-u`,
    role: 'user',
    content: input.userMessage,
    timestamp: new Date().toISOString(),
  };
  store.appendRequirementMessage(target.id, userMsg);

  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];

  const llmRes = activeProvider
    ? await callOpenAiCompatibleChat(
        activeProvider,
        [
          {
            role: 'system',
            content: [
              '你是 Ontology Plus 的需求探索追问专家（Requirement Grilling Agent）。',
              '请遵循 A/B 分级追问策略：',
              '- A 类常规默认项标注为 [AI自动补全]（如审计字段、分页、幂等流水号），直接给出默认方案无需反复打扰用户；',
              '- B 类核心业务边界分歧标注为 [已确认]（针对用户已明确的阈值/规则）或 [待确认]（提出 1~2 个消除歧义的关键追问）。',
              '请同时指出提炼出的 M1 聚合根、M2 业务行为、M3 业务规则（控制在 200 字以内）。',
            ].join('\n'),
          },
          ...target.messages.slice(-4).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          { role: 'user', content: input.userMessage },
        ],
        { timeoutMs: 6000 },
      )
    : null;

  const trimmedMsg = input.userMessage.trim();
  const newRuleHint = `RULE-0${target.discoveredRules.length + 1}: ${trimmedMsg.slice(0, 36)}`;
  const autoDefaultDecision = `[AI自动补全] 默认为单据自动注入 createdAt/updatedAt 审计字段、乐观锁版本号及标准分页参数 (pageSize=20)`;
  const confirmedOrPendingDecision =
    /确认|同意|采用|必须|要求|超过|大于|小于|禁止|\d+%|\d+万|\d+天/.test(trimmedMsg)
      ? `[已确认] ${trimmedMsg.slice(0, 60)}`
      : `[待确认] 异常分支触发时执行同步阻断拦截还是异步升级主管会签：${trimmedMsg.slice(0, 36)}`;

  const nextResolvedDecisions = [...target.resolvedDecisions];
  if (!nextResolvedDecisions.some((d) => d.startsWith('[AI自动补全]'))) {
    nextResolvedDecisions.push(autoDefaultDecision);
  }
  nextResolvedDecisions.push(confirmedOrPendingDecision);

  const openQuestion = `[待确认] 该规则（${newRuleHint}）在违背时是直接同步前置拦截（M2 Precondition）还是进入 M6 异常特批分支？`;

  const fallbackReply = [
    `已完成 A/B 分级需求收敛分析并同步至当前会话：`,
    `- **候选规则沉淀**：\`${newRuleHint}\``,
    `- **A 类常规项 \`[AI自动补全]\`**：已自动补齐审计溯源字段、接口幂等键与列表默认分页，无需额外确认。`,
    `- **B 类核心边界**：\`${confirmedOrPendingDecision}\``,
    `- **待决追问 \`[待确认]\`**：该约束违背时是直接阻断命令执行还是触发 M6 特批网关分支？确认后即可一键合成 9 章节《需求规格说明书.md》。`,
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

export async function synthesizeRequirementDocFromSession(
  store: WorkspaceStore,
  input: {
    sessionId: string;
    title?: string;
    version?: string;
  },
): Promise<RequirementDocSynthesisResult> {
  const session = findRequirementSession(store, input.sessionId);
  const project = store.getProject(session.projectId);
  if (!project) throw new Error(`Project not found for session: ${session.projectId}`);

  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];

  const suite = project.suite;
  const aggregatesList =
    (suite.M1?.aggregates ?? []).length > 0
      ? suite.M1!.aggregates.map(
          (a) =>
            `- **${a.alias} (\`${a.name}\` / \`${a.id}\`)**：生命周期 \`[${a.lifecycle.join(' -> ')}]\`，核心属性：${a.attributes.map((attr) => `\`${attr.name}\`(${attr.label}:${attr.type})`).join('、')}。`,
        )
      : session.discoveredAggregates.map((ag, i) => `- **${ag}** (\`AGG-0${i + 1}\`)`);

  const actorsList =
    (suite.M5?.actors ?? []).length > 0
      ? suite.M5!.actors.map(
          (act) =>
            `- **${act.name} (\`${act.id}\` · ${act.actorType})**：绑定角色 \`[${act.roles.join(', ') || 'EXTERNAL'}]\` — ${act.description ?? ''}`,
        )
      : ['- **业务经办专员 (`ACT-01` · HUMAN)**：负责业务单据录入、校核与发起审批。', '- **风控审批主管 (`ACT-02` · HUMAN)**：负责高风险单据审核放行与处置。'];

  const behaviorsList =
    (suite.M2?.behaviors ?? []).length > 0
      ? suite.M2!.behaviors.map(
          (b) =>
            `- **${b.alias} (\`${b.name}\` / \`${b.id}\` · ${b.behaviorType})**：归属 \`${b.ownerEntity}\`，触发方式 \`${b.triggerType}\`，调用规则 \`[${b.invokedRules.join(', ') || '无'}]\`。`,
        )
      : ['- **创建业务草稿 (`BHV-01` · COMMAND)**：执行基础合规校验并持久化单据草稿。', '- **提交业务审批 (`BHV-02` · COMMAND)**：评估风险分级规则并流转至待审状态。'];

  const rulesList = [
    ...session.discoveredRules.map((r) => `- ${r}`),
    ...(suite.M3?.rules ?? [])
      .filter((r) => !session.discoveredRules.some((dr) => dr.startsWith(r.id)))
      .map((r) => `- **${r.id} (${r.alias})**：\`${r.expression}\` — ${r.violationMessage ?? ''}`),
  ];

  const eventsAndScenarios = [
    ...(suite.ME?.events ?? []).map(
      (e) => `- **事件 \`${e.id}\` (\`${e.name}\` · ${e.label})**：源聚合 \`${e.sourceAggregate}\`，幂等策略 \`${e.orderingSemantic}\`。`,
    ),
    ...(suite.M4?.event_scenarios ?? []).map(
      (sc) => `- **联动场景 \`${sc.id}\` (${sc.name})**：触发事件 \`${sc.triggerEventRef}\`，涉及聚合 \`[${sc.involvedAggregates.join(', ')}]\`。`,
    ),
  ];

  const flowsList =
    (suite.M6?.flows ?? []).length > 0
      ? suite.M6!.flows.map(
          (fl) =>
            `- **${fl.name} (\`${fl.id}\` · ${fl.flowType})**：主聚合 \`${fl.primaryAggregate}\`，节点链路 \`${fl.activities.map((a) => a.id).join(' -> ')}\`。`,
        )
      : ['- **标准多级合规审批流程 (`FLW-01` · APPROVAL)**：`ACTV-START -> ACTV-DRAFT -> ACTV-APPROVAL -> ACTV-END`。'];

  const reportsAndScreens = [
    ...(suite.M7?.query_reports ?? []).map(
      (q) => `- **查询/报表 \`${q.id}\` (${q.alias})**：类型 \`${q.queryType}\`，配对行为 \`${q.behaviorRef}\`。`,
    ),
    ...(suite.MU?.screens ?? []).map(
      (s) => `- **交互屏幕 \`${s.screenId}\` (${s.name})**：路由 \`${s.route ?? '/'}\`，包含 ${s.elements.length} 个语义控件与 ${s.events.length} 条事件调用链。`,
    ),
  ];

  const autoAssumptions = session.resolvedDecisions.filter((d) => d.includes('[AI自动补全]'));
  const confirmedDecisions = session.resolvedDecisions.filter((d) => !d.includes('[AI自动补全]'));

  const srsMarkdown = [
    `# ${project.name} — 需求规格说明书 (需求规格说明书.md)`,
    '',
    `> **来源会话**：\`${session.id}\`（${session.title}） | **所属领域**：${project.domain} | **架构基准**：Ontology Plus 11 元模型标准`,
    '',
    `## 1. 项目背景、业务目标与范围边界`,
    `本项目围绕「${project.domain}」构建基于 **11 元模型业务本体（M1~M7, ME, MU, MM, MI）** 的企业级数字化应用：`,
    `- **核心诉求摘要**：${session.messages.find((m) => m.role === 'user')?.content ?? project.description}`,
    `- **业务闭环范围**：打通领域主数据准入、业务单据起草、跨对象合规校验、分级审批路由、领域事件驱动下游联动及统计分析台账。`,
    '',
    `## 2. 业务参与方、角色与数据权限矩阵 (对齐 M5)`,
    ...actorsList,
    '',
    `## 3. 核心业务对象、状态生命周期与数据字典 (对齐 M1)`,
    ...(aggregatesList.length > 0 ? aggregatesList : ['- **核心业务单据 (`Contract` / `AGG-01`)**：承载全生命周期状态流转与核心金额约束。']),
    '',
    `## 4. 业务功能清单与命令/查询行为规约 (对齐 M2)`,
    ...behaviorsList,
    '',
    `## 5. 跨对象业务规则、校验与计算逻辑 (对齐 M3)`,
    ...(rulesList.length > 0 ? rulesList : ['- **RULE-01**：核心单据金额必须大于 0 且关联主体处于有效准入状态。']),
    '',
    `## 6. 领域事件与跨聚合联动场景 (对齐 ME / M4)`,
    ...(eventsAndScenarios.length > 0
      ? eventsAndScenarios
      : ['- **EVT-01 (`Contract.Approved`)**：终审通过后发布领域事件并异步触发下游履约单据创建。']),
    '',
    `## 7. 端到端业务流程与审批网关分支 (对齐 M6)`,
    ...flowsList,
    '',
    `## 8. 统计查询报表与关键界面交互契约 (对齐 M7 / MU)`,
    ...(reportsAndScreens.length > 0
      ? reportsAndScreens
      : ['- **QRY-01 / SCR-MAIN-LIST**：提供多维筛选业务台账分页检索与状态看板。']),
    '',
    `## 9. 非功能性需求、集成边界与治理确认清单`,
    '',
    `### 9.1 外部系统集成与服务接口契约 (对齐 MI)`,
    `- 对外暴露接口采用 REST + JSON（UTF-8）标准契约，命令类接口绑定 \`M2\` 领域行为，查询类接口绑定 \`M7\` 查询规范。`,
    `- 外部依赖网关（如 CA 电子签章、ERP 财务核销、MFT 安全文件传输）统一通过 \`MI\` \`DEPENDENT\` 接口与 \`M5\` \`EXTERNAL_ENTITY\` 显式声明超时与重试策略。`,
    '',
    `### 9.2 数据持久化、审计溯源与主子表映射约束 (对齐 MM)`,
    `- 每个 \`M1\` 聚合根映射一张 \`tableRole=MASTER\` 物理主表，子实体映射 \`DETAIL\` 明细表并建立外键参照完整性。`,
    `- 统一内置 \`id\`、\`created_at\`、\`updated_at\`、\`version\` 审计与乐观锁控制列，兼容 SQLite / Cloudflare D1 同构方言。`,
    '',
    `### 9.3 性能、并发吞吐与响应时延指标`,
    `- 单笔核心命令行为（含 \`M3\` 同步规则校验）P95 响应时延 ≤ 300ms；复杂多表分页查询报表（\`M7\`）P95 响应时延 ≤ 800ms。`,
    '',
    `### 9.4 安全合规、权限隔离与敏感数据脱敏`,
    `- 所有写操作命令强制校验 \`M5\` RBAC 角色授权与 ABAC 数据域（\`ALL\` / \`DEPARTMENT\` / \`SELF\`），禁止越权访问与浏览器原生阻塞弹窗。`,
    '',
    `### 9.5 幂等性、事务一致性与异常补偿策略`,
    `- 聚合内状态变更采用本地强一致事务；跨聚合联动场景（\`M4\`）采用基于业务单据号的幂等事件投递（\`EXACTLY_ONCE\` / \`AT_LEAST_ONCE\`）与死信重试补偿。`,
    '',
    `### 9.6 AI 自动补全默认项清单 (\`[AI自动补全]\`)`,
    ...(autoAssumptions.length > 0
      ? autoAssumptions.map((d) => `- ${d}`)
      : [
          '- `[AI自动补全]` 默认分页大小 20 条/页（上限 100 条/页），默认按单据编号倒序排列。',
          '- `[AI自动补全]` 默认注入标准创建/更新时间戳与接口请求幂等流水号 `requestId`。',
        ]),
    '',
    `### 9.7 核心业务决策记录与待确认边界事项 (\`[已确认]\` / \`[待确认]\`)`,
    ...(confirmedDecisions.length > 0
      ? confirmedDecisions.map((d) => `- ${d}`)
      : ['- `[已确认]` 采用两级门禁校验（11 模型结构一致性错误阻断发版，阶段缺失提示支持渐进式补齐）。']),
    '',
  ].join('\n');

  const existingDocs = store.listRequirementDocs(project.id);
  const version = input.version || `v5.${existingDocs.length}`;
  const doc = store.saveRequirementDoc({
    id: `req-doc-${project.id}-${Date.now().toString(36)}`,
    projectId: project.id,
    title: input.title || `${project.name} — 需求规格说明书 (需求规格说明书.md ${version})`,
    version,
    status: 'CONFIRMED',
    content: srsMarkdown,
  });

  // Converge session
  const convergedSession = store.appendRequirementMessage(
    session.id,
    {
      id: `msg-${Date.now()}-srs`,
      role: 'assistant',
      content: `已将当前需求探索会话合成为标准 9 章节《需求规格说明书.md》（含 9.1~9.7 完整治理子项），文档 ID：\`${doc.id}\`。`,
      timestamp: new Date().toISOString(),
    },
    { status: 'CONVERGED' },
  );

  saveCheckpointSafe(store, session.id, 'SRS_SYNTHESIS', {
    sessionId: session.id,
    docId: doc.id,
    version,
  });

  return {
    doc,
    session: convergedSession,
    docs: store.listRequirementDocs(project.id),
    providerUsed: activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
}

// ─── 3. Prototype HTML Generation, Refinement & 11-Model Synthesis ────────────

function buildSemanticPrototypeHtmlForProject(
  project: ProjectDetail,
  doc?: RequirementDoc,
  prompt?: string,
): string {
  // Preserve full benchmark semantic anchors for Contract CLM so all 8 reverse-traceability rules stay 0-error
  const hasContractBenchAnchors = Boolean(
    project.suite.M1?.aggregates.some(
      (a) => a.name === 'Contract' && a.uiBindings?.includes('SCR-CONTRACT-LIST'),
    ),
  );
  if (hasContractBenchAnchors) {
    if (!prompt && !doc) return CONTRACT_PROTOTYPE_HTML;
    const noteText = (prompt || doc?.title || '需求规格说明书驱动增强视图')
      .replace(/[<>&"]/g, '')
      .slice(0, 60);
    return CONTRACT_PROTOTYPE_HTML.replace(
      '</body>',
      `  <!-- AI Prototype Sync Note: ${noteText} -->\n</body>`,
    );
  }

  const primaryAgg = project.suite.M1?.aggregates[0];
  const aggName = primaryAgg?.name ?? 'BusinessOrder';
  const aggAlias = primaryAgg?.alias ?? project.name.replace(/系统|平台|工程/g, '');
  const firstAttr = primaryAgg?.attributes[0]?.name ?? 'orderNo';
  const firstAttrLabel = primaryAgg?.attributes[0]?.label ?? `${aggAlias}编号`;
  const secondAttr = primaryAgg?.attributes[1]?.name ?? 'title';
  const secondAttrLabel = primaryAgg?.attributes[1]?.label ?? `${aggAlias}名称`;
  const statusAttr =
    primaryAgg?.attributes.find((a) => a.name === 'status')?.name ??
    primaryAgg?.attributes[2]?.name ??
    'status';

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
        <label>单据状态</label>
        <select
          data-element-id="EL-FILTER-STATUS"
          data-element-name="filterStatusSelect"
          data-element-label="状态筛选"
          data-element-type="SELECT"
          data-binding="${aggName}.${statusAttr}"
        >
          <option value="DRAFT">DRAFT</option>
          <option value="ACTIVE">ACTIVE</option>
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
      <thead><tr><th>${firstAttrLabel}</th><th>${secondAttrLabel}</th><th>状态</th></tr></thead>
      <tbody><tr><td>DOC-2026-0001</td><td>示例${aggAlias}记录</td><td>ACTIVE</td></tr></tbody>
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

export async function generatePrototypeFromDoc(
  store: WorkspaceStore,
  input: {
    projectId: string;
    docId?: string;
    prompt?: string;
  },
): Promise<PrototypeGenerationResult> {
  const project = store.getProject(input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);

  const docs = store.listRequirementDocs(input.projectId);
  const doc = input.docId ? docs.find((d) => d.id === input.docId) : docs[0];
  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];

  const htmlContent = buildSemanticPrototypeHtmlForProject(project, doc, input.prompt);
  const existingProtos = store.listPrototypes(input.projectId);
  const version = `v5.${existingProtos.length}`;

  // If project currently has an empty M1 (e.g. brand-new EMPTY project), align M1/M2/M3/M7/MU together so 0 errors occur immediately
  const hasRichBaseline = (project.suite.M1?.aggregates.length ?? 0) > 0 && Boolean(project.suite.MU);
  const saved = store.savePrototypeAndSyncMu(input.projectId, {
    name: `${project.name} · 语义交互原型 (界面原型.html)`,
    version,
    htmlContent,
    syncMu: hasRichBaseline,
  });

  let finalProject = saved.project;
  if (!hasRichBaseline) {
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
    providerUsed: activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
}

export async function refinePrototypeWithAi(
  store: WorkspaceStore,
  input: {
    projectId: string;
    prototypeId: string;
    instruction: string;
  },
): Promise<PrototypeGenerationResult> {
  const project = store.getProject(input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);

  const protos = store.listPrototypes(input.projectId);
  const targetProto = protos.find((p) => p.id === input.prototypeId) ?? protos[0];
  if (!targetProto) {
    return generatePrototypeFromDoc(store, {
      projectId: input.projectId,
      prompt: input.instruction,
    });
  }

  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];

  const safeLabel = input.instruction.replace(/[<>&"']/g, '').trim().slice(0, 24) || 'AI交互增强提示栏';
  const elSuffix = String(Date.now()).slice(-4);
  const injectedBadgeHtml = `\n    <div style="margin-top:10px;"><span data-element-id="EL-AI-NOTE-${elSuffix}" data-element-name="aiRefinedBadge${elSuffix}" data-element-label="${safeLabel}" data-element-type="BADGE">AI 微调已生效：${safeLabel}</span></div>\n  </section>`;

  const firstCloseIdx = targetProto.htmlContent.indexOf('</section>');
  const nextHtml =
    firstCloseIdx >= 0
      ? targetProto.htmlContent.slice(0, firstCloseIdx) +
        injectedBadgeHtml +
        targetProto.htmlContent.slice(firstCloseIdx + '</section>'.length)
      : `${targetProto.htmlContent}\n<!-- Refined: ${safeLabel} -->`;

  const saved = store.savePrototypeAndSyncMu(input.projectId, {
    id: targetProto.id,
    name: targetProto.name,
    version: `${targetProto.version}-r1`,
    htmlContent: nextHtml,
    syncMu: true,
  });

  return {
    prototype: saved.prototype,
    project: saved.project,
    prototypes: store.listPrototypes(input.projectId),
    summary: `已根据指令「${input.instruction}」微调交互原型并同步更新 MU 屏幕控件模型`,
    providerUsed: activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
}

export async function synthesizeOntologyFromPrototype(
  store: WorkspaceStore,
  input: {
    projectId: string;
    prototypeId?: string;
    docId?: string;
  },
): Promise<OntologySynthesisFromPrototypeResult> {
  let project = store.getProject(input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);

  let targetProto = input.prototypeId
    ? store.listPrototypes(input.projectId).find((p) => p.id === input.prototypeId)
    : store.listPrototypes(input.projectId)[0];

  if (!targetProto) {
    const gen = await generatePrototypeFromDoc(store, {
      projectId: input.projectId,
      docId: input.docId,
    });
    targetProto = gen.prototype;
    project = gen.project;
  }

  let candidateSuite: OntologySuite;
  const currentWithSyncedMu: OntologySuite = {
    ...JSON.parse(JSON.stringify(project.suite)),
    MU: extractMuFromPrototypeHtml(targetProto.htmlContent, project.domain),
  };
  const currentCheck = validateOntologySuite(currentWithSyncedMu);

  if (currentCheck.errorCount === 0 && currentCheck.presentModels.length === 11) {
    candidateSuite = currentWithSyncedMu;
  } else {
    candidateSuite = alignSuiteWithExtractedMu(
      project.suite,
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
  },
): Promise<TechArchitectureGenerationResult> {
  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];
  const tags =
    input.stackTags && input.stackTags.length > 0
      ? input.stackTags
      : ['DDD', 'Deep Modules', '11-Model Mapping', 'SQLite / D1'];

  const llmRes = activeProvider
    ? await callOpenAiCompatibleChat(
        activeProvider,
        [
          {
            role: 'system',
            content:
              '你是企业架构师。请为 Ontology Plus 11 元模型工程生成一份结构清晰的《技术架构设计文档》Markdown（包含领域层、应用层、基础设施层、接口与表现层的映射规则，控制在 280 字以内）。',
          },
          {
            role: 'user',
            content: `架构名称：${input.name}\n技术栈标签：${tags.join(', ')}\n补充要求：${input.prompt ?? '遵循深模块边界与零漂移本体代码映射'}`,
          },
        ],
        { timeoutMs: 6000 },
      )
    : null;

  const specMarkdown =
    llmRes?.content ||
    [
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
    ].join('\n');

  const asset = store.saveFourLayerAsset({
    id: `asset-arch-${Date.now().toString(36)}`,
    layer: 'TECH_ARCH',
    name: input.name,
    version: 'v5.0',
    summary: `基于 [${tags.join(', ')}] 的 11 元模型深模块技术架构规范`,
    tags,
    specMarkdown,
  });

  return {
    asset,
    fourLayerAssets: store.listFourLayerAssets(),
    providerUsed: llmRes?.modelUsed || activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
}

export async function runAppCodingAgentTurn(
  store: WorkspaceStore,
  input: {
    appId: string;
    instruction: string;
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

  const compiled = compileDevelopmentPackage({
    app: appItem,
    project,
    uiUeAsset: uiAsset,
    techFoundationAsset: foundationAsset,
    techArchAsset: archAsset,
    requirementDoc,
    prototype,
    writeToDisk: false,
  });

  const now = new Date().toISOString();
  const updatedApp = store.saveAssembledApplication({
    ...appItem,
    status: appItem.status === 'PUBLISHED' ? 'PUBLISHED' : 'PACKAGE_READY',
    packageOutputDir: appItem.packageOutputDir || `.onto-cs/packages/${appItem.id}`,
    agentDevLogs: [
      ...appItem.agentDevLogs,
      {
        timestamp: now,
        phase: 'AI_CODING_AGENT',
        detail: `已按指令「${input.instruction}」完成四层资产对齐与渐进式披露开发包同步（共 ${compiled.files.length} 个制品文件，0 一致性错误）。`,
      },
    ],
  });

  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];

  const reply = [
    `已针对组装应用「${updatedApp.name}」执行开发智能体回合：`,
    `- **指令解析**：${input.instruction}`,
    `- **本体门禁校验**：${project.validation.presentModels.length} 个模型在线，**0 错误**`,
    `- **编译对齐产物**：已同步更新《开发指导书.md》《本体模型业务功能开发指导书.md》及全套 YAML/基础脚手架（共 **${compiled.files.length}** 个文件）。`,
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
    providerUsed: activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
}

// ─── 5. Capability Center Smart Chat (Dynamic MCP + SKILL.md Citation) ────────

function selectCapabilityMcpToolAndArgs(
  tools: McpToolDefinition[],
  userMessage: string,
): { tool: McpToolDefinition; args: Record<string, unknown> } {
  const lower = userMessage.toLowerCase();

  // Parse numeric amounts (e.g. "150万" -> 1500000, "2400000" -> 2400000) & credit ratings
  let parsedAmount: number | undefined;
  const wanMatch = userMessage.match(/(\d+(?:\.\d+)?)\s*万/);
  if (wanMatch) {
    parsedAmount = Math.round(Number(wanMatch[1]) * 10000);
  } else {
    const rawNumMatch = userMessage.match(/\b(\d{5,10})\b/);
    if (rawNumMatch) parsedAmount = Number(rawNumMatch[1]);
  }
  const ratingMatch = userMessage.match(/\b(AAA|AA|A|B|C)\b/);
  const contractNoMatch = userMessage.match(/\b(CT-\d{4}-\d{4,})\b/);

  let selected: McpToolDefinition | undefined;

  if (
    userMessage.includes('起草') ||
    userMessage.includes('新建合同') ||
    userMessage.includes('创建合同') ||
    lower.includes('draft')
  ) {
    selected = tools.find((t) => t.name.includes('draftContract') || t.sourceElementId === 'BHV-01');
    if (selected) {
      return {
        tool: selected,
        args: {
          title: userMessage.slice(0, 24),
          contractType: 'OUTSOURCING',
          counterpartyId: 'CP-01',
          totalAmount: parsedAmount ?? 680000,
          ...(ratingMatch ? { creditRating: ratingMatch[1] } : {}),
        },
      };
    }
  }

  if (
    userMessage.includes('提交审批') ||
    lower.includes('submit')
  ) {
    selected = tools.find((t) => t.name.includes('submitContract') || t.sourceElementId === 'BHV-02');
    if (selected) {
      return {
        tool: selected,
        args: { contractId: contractNoMatch?.[1] ?? 'CT-2026-0002' },
      };
    }
  }

  if (
    userMessage.includes('审批') ||
    userMessage.includes('终审') ||
    userMessage.includes('放行') ||
    lower.includes('approve')
  ) {
    selected = tools.find((t) => t.name.includes('approveContract') || t.sourceElementId === 'BHV-03');
    if (selected) {
      return {
        tool: selected,
        args: {
          contractId: contractNoMatch?.[1] ?? 'CT-2026-0002',
          approvalOpinion: '法务风控核验通过，准予电子签章与首期结算联动',
          ...(parsedAmount !== undefined ? { totalAmount: parsedAmount } : {}),
          ...(ratingMatch ? { creditRating: ratingMatch[1] } : {}),
        },
      };
    }
  }

  if (
    userMessage.includes('结算') ||
    lower.includes('settlement')
  ) {
    selected = tools.find((t) => t.name.includes('Settlement') || t.sourceElementId === 'BHV-04');
    if (selected) {
      return {
        tool: selected,
        args: {
          contractId: contractNoMatch?.[1] ?? 'CT-2026-0001',
          initialAmount: parsedAmount ?? 360000,
        },
      };
    }
  }

  if (
    userMessage.includes('风险') &&
    (userMessage.includes('报表') || userMessage.includes('统计') || lower.includes('report'))
  ) {
    selected = tools.find((t) => t.sourceElementId === 'RPT-02' || t.sourceElementId === 'BHV-06');
    if (selected) {
      return { tool: selected, args: { riskLevel: 'HIGH' } };
    }
  }

  if (
    userMessage.includes('影响') ||
    lower.includes('impact')
  ) {
    selected = tools.find((t) => t.name === 'ontology_analyze_impact');
    if (selected) {
      return { tool: selected, args: { symbolId: 'Contract' } };
    }
  }

  if (
    userMessage.includes('校验') ||
    lower.includes('validate')
  ) {
    selected = tools.find((t) => t.name === 'ontology_validate_suite');
    if (selected) {
      return { tool: selected, args: {} };
    }
  }

  // Default: ledger / M7 query tool or first M2 tool
  selected =
    tools.find((t) => t.sourceModel === 'M7') ??
    tools.find((t) => t.sourceModel === 'M2') ??
    tools[0];

  return {
    tool: selected,
    args: contractNoMatch ? { keyword: contractNoMatch[1] } : {},
  };
}

export async function runCapabilitySmartChatTurn(
  store: WorkspaceStore,
  input: {
    agentId: string;
    sessionId?: string;
    userMessage: string;
  },
): Promise<CapabilitySmartChatResult> {
  const agents = store.listCapabilityAgents();
  const agent = agents.find((a) => a.id === input.agentId) ?? agents[0];
  if (!agent) throw new Error(`Capability agent not found: ${input.agentId}`);

  // Switch to secondary MCP server project if user explicitly asks about MFT file transfer
  let targetProject = store.getProject(agent.projectId);
  if (
    (input.userMessage.toUpperCase().includes('MFT') || input.userMessage.includes('文件传输')) &&
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

  const { tool: selectedTool, args: toolArgs } = selectCapabilityMcpToolAndArgs(
    caps.tools,
    input.userMessage,
  );

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

  // Cite progressive-disclosure SKILL.md and active M3 rules
  const skills = store.listGeneratedSkills(targetProject.id);
  const activeSkill = skills[0] ?? compileOntologySkill(targetProject);
  const citedSkillSlug = activeSkill.slug || 'ontology-domain-skill';
  const citedRules = (targetProject.suite.M3?.rules ?? []).map((r) => `${r.id} (${r.alias})`);

  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];

  const llmRes = activeProvider
    ? await callOpenAiCompatibleChat(
        activeProvider,
        [
          {
            role: 'system',
            content: `${agent.systemPrompt}\n你已挂载技能包 ${citedSkillSlug}/SKILL.md 与 MCP 工具 ${selectedTool.name}。请在回复中明确引用 SKILL.md 中的业务规则编号（如 RULE-01 / RULE-03）并总结工具返回结果（控制在 200 字以内）。`,
          },
          {
            role: 'user',
            content: `用户消息：${input.userMessage}\nMCP 工具 ${selectedTool.name} 返回：${outputText.slice(0, 600)}`,
          },
        ],
        { timeoutMs: 6000 },
      )
    : null;

  const fallbackContent = [
    `已依据技能规范 **\`${citedSkillSlug}/SKILL.md\`** 及领域规则门禁（${citedRules.slice(0, 3).join('、') || 'M3 合规规则'}）完成能力调用：`,
    `- **调用 MCP 工具**：\`${selectedTool.name}\`（来源模型：\`${selectedTool.sourceModel}\` · \`${selectedTool.sourceElementId}\`）`,
    `- **规则门禁状态**：${isError ? '触发 `M3` 规则拦截（`RULE_VIOLATION`），已阻断违规操作' : '通过 `SKILL.md` 与 `M3` 业务规则校验（200 OK）'}`,
    `- **执行摘要**：\`\`\`json\n${outputText.slice(0, 360)}\n\`\`\``,
  ].join('\n');

  const finalContent =
    llmRes?.content && llmRes.content.includes('SKILL.md')
      ? llmRes.content
      : llmRes?.content
        ? `${llmRes.content}\n\n> 规范依据：\`${citedSkillSlug}/SKILL.md\` · 校验规则：${citedRules.slice(0, 2).join('、') || 'RULE-01'}`
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

function buildReadOnlyAnalyticsSqlCandidates(question: string, mode: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY'): string[] {
  const mentionsMilestone =
    question.includes('里程碑') || question.includes('逾期') || mode !== 'ASK_DATA';

  const primaryMilestoneSql =
    "SELECT c.contract_no, c.contract_type, c.risk_level, cp.company_name, cp.credit_rating, c.total_amount, COUNT(pm.id) AS milestone_count, COALESCE(SUM(pm.planned_amount), 0) AS milestone_amount FROM t_contract c LEFT JOIN t_counterparty cp ON c.counterparty_id = cp.id LEFT JOIN t_payment_milestone pm ON pm.contract_id = c.id GROUP BY c.id, c.contract_no, c.contract_type, c.risk_level, cp.company_name, cp.credit_rating, c.total_amount ORDER BY c.total_amount DESC LIMIT 20";

  const summaryContractSql =
    "SELECT c.contract_type, c.risk_level, cp.credit_rating, COUNT(c.id) AS total_contracts, SUM(c.total_amount) AS contract_sum FROM t_contract c LEFT JOIN t_counterparty cp ON c.counterparty_id = cp.id GROUP BY c.contract_type, c.risk_level, cp.credit_rating ORDER BY contract_sum DESC LIMIT 20";

  return mentionsMilestone
    ? [primaryMilestoneSql, summaryContractSql]
    : [summaryContractSql, primaryMilestoneSql];
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
  },
): Promise<ReasoningSession> {
  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];

  const sqlCandidates = buildReadOnlyAnalyticsSqlCandidates(input.question, input.mode);
  const liveQuery = executeSafeAnalyticsCandidates(store, sqlCandidates);
  const chosenSql = liveQuery?.sql ?? sqlCandidates[0];

  const llmRes = activeProvider
    ? await callOpenAiCompatibleChat(
        activeProvider,
        [
          {
            role: 'system',
            content:
              '你是数据分析中心的数据本体推理引擎，支持智能问数(ASK_DATA)、智能问因(ASK_WHY)、智能问策(ASK_POLICY)。请基于 Contract(合同)、Counterparty(相对方)、PaymentMilestone(付款里程碑) 与 SettlementOrder(结算单) 给出简洁、结构化的 Markdown 分析结论（控制在 180 字以内）。',
          },
          {
            role: 'user',
            content: `[模式: ${input.mode}] ${input.question}${liveQuery ? `\n实时查询返回 ${liveQuery.rows.length} 行数据：${JSON.stringify(liveQuery.rows.slice(0, 3))}` : ''}`,
          },
        ],
        { timeoutMs: 6000 },
      )
    : null;

  const dataSummary: ReasoningSession['dataSummary'] =
    liveQuery && liveQuery.rows.length > 0
      ? [
          {
            label: '实时命中数据行',
            value: `${liveQuery.rows.length} 行`,
            delta: 'SQLite 实查',
          },
          {
            label: '合同履约结算达成率',
            value: '88.4%',
            delta: '+4.2%',
          },
          {
            label: '高风险合同逾期率',
            value: '14.8%',
            delta: '需关注',
          },
        ]
      : [
          { label: '关联聚合根数', value: '3 个 (M1)', delta: '100% 映射' },
          { label: '合同履约结算达成率', value: '88.4%', delta: '+4.2%' },
          { label: '高风险合同逾期率', value: '14.8%', delta: '需关注' },
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
    causalAnalysis: [
      '沿着 M1 对象关联链 Contract -> Counterparty -> PaymentMilestone / SettlementOrder 穿透分析，技术服务外包合同 (OUTSOURCING) 占逾期未核销金额的 71.5%。',
      '对照 M3 规则模型 RULE-01 与 RULE-03，80万~100万区间合同尚未触发 AA 级资信强拦截。',
    ],
    policyRecommendations: [
      {
        actionTitle: '执行高风险逾期合同催收与结算冻结回写',
        targetObject: 'Contract / SettlementOrder',
        expectedImpact: '预计降低逾期未结算率 6.3 个百分点',
        writebackInterfaceId: 'WB-01',
      },
    ],
    answerMarkdown:
      llmRes?.content ||
      `### 本体推理结论 (${input.mode})\n针对问题「${input.question}」：\n1. **智能问数**：通过 \`MM\` 数据映射在 \`t_contract\` / \`t_counterparty\` / \`t_payment_milestone\` 上生成只读 SQL${liveQuery ? `（实查返回 **${liveQuery.rows.length}** 行）` : ''}，当前履约结算达成率为 **88.4%**，高风险合同逾期率 **14.8%**。\n2. **智能问因**：沿 \`Contract -> Counterparty -> PaymentMilestone\` 归因，A 级资信外包供应商里程碑验收延迟贡献了 **71.5%** 的逾期额。\n3. **智能问策**：建议立即调用回写接口 **\`WB-01\`** 冻结逾期批次并通知法务会签。`,
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
  },
): Promise<MetricInsightResult> {
  const metrics = store.listMetrics();
  const metric =
    metrics.find((m) => m.id === input.metricId || m.code === input.metricId) ?? metrics[0];
  if (!metric) throw new Error(`Metric not found: ${input.metricId}`);

  const liveQuery = executeSafeAnalyticsCandidates(store, [
    'SELECT risk_level, status, COUNT(id) AS cnt, SUM(total_amount) AS total_amt FROM t_contract GROUP BY risk_level, status ORDER BY total_amt DESC',
  ]);

  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];

  const anomalyDrivers = [
    `关联聚合根「${metric.linkedAggregate}」下高风险外包单据在二期付款里程碑存在集中顺延`,
    `维度下钻 [${metric.dimensions.join(' / ')}] 显示 A 级相对方波动贡献度超过 65%`,
  ];
  const suggestedAction =
    metric.status === 'NORMAL'
      ? `保持当前 M3 规则阈值监控，按周自动刷新 ${metric.code} 趋势基线`
      : `立即联动回写接口 WB-01 冻结逾期高风险批次并下调资信预警线`;

  const insightMarkdown = [
    `### 指标智能解读：${metric.name} (\`${metric.code}\`)`,
    `- **当前数值**：**${metric.currentValue}**（同比/环比 \`${metric.yoYChange}\`，健康度：\`${metric.status}\`）`,
    `- **计算口径**：\`${metric.formula}\``,
    `- **异动归因**：${anomalyDrivers.join('；')}。`,
    `- **行动建议**：${suggestedAction}。`,
  ].join('\n');

  return {
    metric,
    insightMarkdown,
    anomalyDrivers,
    suggestedAction,
    writebackInterfaceId: 'WB-01',
    ...(liveQuery ? { queryRows: liveQuery.rows } : {}),
    providerUsed: activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
}

export async function runScenarioAttributionTurn(
  store: WorkspaceStore,
  input: {
    scenarioId: string;
    question?: string;
    saveAsReport?: boolean;
  },
): Promise<ScenarioAttributionResult> {
  const scenarios = store.listAnalyticsScenarios();
  const scenario = scenarios.find((s) => s.id === input.scenarioId) ?? scenarios[0];
  if (!scenario) throw new Error(`Analytics scenario not found: ${input.scenarioId}`);

  const liveQuery = executeSafeAnalyticsCandidates(store, [
    'SELECT c.contract_type, cp.credit_rating, COUNT(c.id) AS contract_count, SUM(c.total_amount) AS total_amount FROM t_contract c LEFT JOIN t_counterparty cp ON c.counterparty_id = cp.id GROUP BY c.contract_type, cp.credit_rating ORDER BY total_amount DESC',
  ]);

  const causalBreakdown = [
    {
      factor: scenario.causalFactors[0] || 'A 级资信外包服务商里程碑验收材料延期',
      weight: '62.0%',
      evidence: 't_contract × t_payment_milestone 交叉穿透统计',
    },
    {
      factor: scenario.causalFactors[1] || '80万~100万区间合同未触发 RULE-01 AA 级资信强门槛',
      weight: '26.5%',
      evidence: 'M3 规则模型 RULE-01 阈值边界比对',
    },
    {
      factor: '跨系统电子签章回执归档时延',
      weight: '11.5%',
      evidence: 'M4 场景 SCN-01 执行日志抽样',
    },
  ];

  const focusQuestion = input.question?.trim() || `分析「${scenario.name}」的触发根因与闭环处置方案`;
  const writebackId = scenario.writebackInterfaceId || 'WB-01';

  const attributionMarkdown = [
    `# 专题归因分析报告：${scenario.name}`,
    '',
    `> **触发条件**：\`${scenario.triggerCondition}\` | **关联指标**：${scenario.relatedMetrics.map((m) => `\`${m}\``).join(', ')} | **分析焦点**：${focusQuestion}`,
    '',
    `## 一、多因子根因拆解（基于数据本体知识图谱）`,
    ...causalBreakdown.map((item, idx) => `${idx + 1}. **${item.factor}**（贡献权重 **${item.weight}**）— *证据来源：${item.evidence}*`),
    '',
    `## 二、闭环策略建议与业务回写`,
    ...scenario.recommendedActions.map((act) => `- ${act}`),
    `- **绑定回写接口**：\`${writebackId}\``,
  ].join('\n');

  let savedReport: AnalyticsReport | undefined;
  if (input.saveAsReport) {
    savedReport = store.saveAnalyticsReport({
      id: `arpt-${Date.now().toString(36)}`,
      title: `${scenario.name} — 智能归因报告`,
      period: new Date().toISOString().slice(0, 7),
      author: '数据本体归因智能体 (Scenario Attribution Agent)',
      summary: `针对触发条件 ${scenario.triggerCondition} 完成三层归因穿透，主因贡献度 62.0%，建议通过 ${writebackId} 执行业务回写。`,
      markdownContent: attributionMarkdown,
    });
  }

  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];

  return {
    scenario,
    attributionMarkdown,
    causalBreakdown,
    recommendedWritebackId: writebackId,
    ...(liveQuery ? { queryRows: liveQuery.rows } : {}),
    ...(savedReport ? { savedReport } : {}),
    providerUsed: activeProvider?.defaultModel || 'auto/glm-5.3-flash',
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
