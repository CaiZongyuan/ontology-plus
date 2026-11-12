import {
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  lazyApi,
  type Api,
  type AssistantMessage,
  type Context,
  type ImageContent,
  type JsonObject,
  type Message,
  type Model,
  type MutableModels,
  type TextContent,
  type Tool,
  type ToolCall,
  type ToolResultMessage,
} from '@earendil-works/pi-ai';
import {
  createRegistry,
  defineExtension,
  defineTool,
} from '@earendil-works/pi-durable';
import {
  MODEL_CODES,
  checkSqlGrounding,
  validateOntologySuite,
  type ModelCode,
  type OntologySuite,
} from '../../ontology-core/index.js';
import {
  compileDevelopmentPackage,
  handleOntologyMcpRequest,
  inspectOntologyMcpCapabilities,
} from '../../package-compiler/index.js';
import {
  doesProviderSupportVision,
  type AgentAskUserPrompt,
  type AgentDomainArtifact,
  type AgentImageAttachmentRef,
  type AgentImageAttachmentRole,
  type AgentSession,
  type AgentSessionKind,
  type AgentSessionMessage,
  type AgentToolCallTrace,
  type LlmProviderConfig,
  type ProjectDetail,
  type WorkspaceStore,
} from '../../workspace-store/index.js';
import {
  type AgentLocale,
  pickLocaleText,
  resolveEffectiveLocale,
} from './locale.js';
import {
  buildProjectDataGrounding,
  describeGroundingRefusal,
  describeJoinWarnings,
  renderDataGrounding,
} from './reasoning-grounding.js';
import {
  ONTOLOGY_DURABLE_TOOLS,
  ONTOLOGY_TOOL_NAMES,
  OPENAI_ONTOLOGY_TOOLS,
  applyOntologyToolCall,
  durableMemoryStorage,
  type OntologyToolName,
  type OpenAiFunctionTool,
} from './tools.js';

// ─── Gateway Error & Explicit Mock Boundary (ADR-0007) ───────────────────────

export class LlmGatewayError extends Error {
  readonly code = 'LLM_GATEWAY_ERROR' as const;
  readonly providerName: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly remediation: string;
  readonly statusCode?: number;

  constructor(input: {
    message: string;
    providerName: string;
    baseUrl: string;
    model: string;
    remediation?: string;
    statusCode?: number;
    locale?: AgentLocale;
  }) {
    super(input.message);
    this.name = 'LlmGatewayError';
    this.providerName = input.providerName;
    this.baseUrl = input.baseUrl;
    this.model = input.model;
    const loc = input.locale ?? 'zh-CN';
    this.remediation =
      input.remediation ??
      pickLocaleText(
        loc,
        '请前往「基础设施 → LLM 中心」检查网关地址、API Key 与在线状态，或在「系统设置」中显式开启「离线演示 Mock 模式」。',
        'Check the gateway URL, API key, and online status in Platform Governance → LLM Center, or enable Offline Demo Mock Mode in System Settings.',
      );
    if (input.statusCode !== undefined) {
      this.statusCode = input.statusCode;
    }
  }

  toDiagnostic(locale?: AgentLocale) {
    const defaultZh =
      '请前往「基础设施 → LLM 中心」检查网关地址、API Key 与在线状态，或在「系统设置」中显式开启「离线演示 Mock 模式」。';
    const remediation =
      locale === 'en-US' && this.remediation === defaultZh
        ? 'Check the gateway URL, API key, and online status in Platform Governance → LLM Center, or enable Offline Demo Mock Mode in System Settings.'
        : this.remediation;
    return {
      code: this.code,
      providerName: this.providerName,
      baseUrl: this.baseUrl,
      model: this.model,
      message: this.message,
      remediation,
      ...(this.statusCode !== undefined ? { statusCode: this.statusCode } : {}),
    };
  }
}

export function isMockLlmActive(store: WorkspaceStore, explicitMock?: boolean): boolean {
  if (explicitMock !== undefined) return explicitMock;
  if (process.env.ONTOLOGY_LIVE_LLM === '1') return false;
  if (process.env.ONTOLOGY_MOCK_LLM === '1' || process.env.VITEST === 'true') {
    return true;
  }
  try {
    return Boolean(store.getSystemSettings().mockLlmMode);
  } catch {
    return false;
  }
}

function resolveProjectDetail(
  store: WorkspaceStore,
  projectId: string,
): ProjectDetail | undefined {
  const direct = store.getProject(projectId);
  if (direct) return direct;
  const firstSummary = store.listProjects()[0];
  return firstSummary ? store.getProject(firstSummary.id) : undefined;
}

// ─── Unified Agent Workbench Extra Tools (YOLO + Scoped HITL) ────────────────

export const UNIFIED_AGENT_EXTRA_TOOLS: OpenAiFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        'Scoped Human-in-the-Loop tool: ONLY call when collecting missing business parameters or resolving ambiguous business choices (e.g., Class-B [待确认] requirement options). Never call to ask permission for normal tool execution.',
      parameters: {
        type: 'object',
        properties: {
          header: {
            type: 'string',
            description: 'Short category badge such as B类业务决策待确认',
          },
          question: {
            type: 'string',
            description: 'Clear question asking the user to choose or fill a business value',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: '2-5 concrete business option strings for the user to choose from',
          },
          multiSelect: { type: 'boolean' },
          allowFreeform: { type: 'boolean' },
        },
        required: ['question', 'options'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_ontology_model',
      description:
        'Inspect a model (M1..MI) or cross-model validation diagnostics in the active Ontology Suite.',
      parameters: {
        type: 'object',
        properties: {
          modelCode: {
            type: 'string',
            enum: ['ALL', 'M1', 'M2', 'M3', 'ME', 'M4', 'M5', 'M6', 'M7', 'MU', 'MM', 'MI'],
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_requirement_insights',
      description:
        'Record extracted M3 business rule candidates and Class-A [AI自动补全] / Class-B [已确认] / [待确认] decisions into the Requirement Session.',
      parameters: {
        type: 'object',
        properties: {
          discoveredAggregates: { type: 'array', items: { type: 'string' } },
          discoveredRules: { type: 'array', items: { type: 'string' } },
          resolvedDecisions: { type: 'array', items: { type: 'string' } },
          openQuestions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compile_dev_package',
      description:
        'Compile the progressive-disclosure development package (SKILL.md, 开发指导书.md, 本体模型业务功能开发指导书.md, 界面原型.html, models/*.yaml) for the target AssembledApplication.',
      parameters: {
        type: 'object',
        properties: {
          applicationId: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'invoke_mcp_tool',
      description:
        'Invoke a compiled Ontology MCP tool (query/command/rule check) against the active project ontology.',
      parameters: {
        type: 'object',
        properties: {
          toolName: { type: 'string' },
          arguments: { type: 'object', properties: {} },
        },
        required: ['toolName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_readonly_sql',
      description:
        'Execute a safe read-only SQLite SELECT query against analytical and business tables mapped in MM or registered in the Data Analytics Center.',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'Read-only SELECT SQL query',
          },
        },
        required: ['sql'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_policy_writeback',
      description:
        'Propose a governed policy writeback action linked to an MI/Analytics WritebackInterface.',
      parameters: {
        type: 'object',
        properties: {
          writebackInterfaceId: { type: 'string' },
          actionTitle: { type: 'string' },
          targetObject: { type: 'string' },
          expectedImpact: { type: 'string' },
        },
        required: ['writebackInterfaceId', 'actionTitle'],
      },
    },
  },
];

export const agentWorkbenchRegistry = createRegistry();
agentWorkbenchRegistry.install(
  defineExtension({
    name: 'ontology-plus-unified-workbench',
    tools: [
      ...Object.values(ONTOLOGY_DURABLE_TOOLS),
      ...UNIFIED_AGENT_EXTRA_TOOLS.map((spec) =>
        defineTool({
          name: spec.function.name,
          label: spec.function.name,
          description: spec.function.description,
          parameters: spec.function.parameters,
          replay: 'safe',
          async execute(args: Record<string, unknown>) {
            return {
              output: [{ type: 'text', text: JSON.stringify({ tool: spec.function.name, args }) }],
            };
          },
        } as never),
      ),
    ],
  }),
);

// ─── Active Session Abort Registry ───────────────────────────────────────────

type SessionAbortKind = 'IDLE_TIMEOUT' | 'USER_ABORT' | 'STEER_SUPERSEDED' | 'CLIENT_DISCONNECT';

interface SessionAbortReason {
  readonly kind: SessionAbortKind;
  readonly message: string;
}

class SessionStreamAbortedError extends Error {
  readonly kind: SessionAbortKind;

  constructor(kind: SessionAbortKind, message: string) {
    super(message);
    this.name = 'SessionStreamAbortedError';
    this.kind = kind;
  }
}

const activeSessionAbortControllers = new Map<string, AbortController>();

export function abortActiveAgentSession(
  sessionId: string,
  kind: 'USER_ABORT' | 'STEER_SUPERSEDED' = 'USER_ABORT',
): boolean {
  const controller = activeSessionAbortControllers.get(sessionId);
  if (!controller) return false;
  const reason: SessionAbortReason =
    kind === 'STEER_SUPERSEDED'
      ? { kind: 'STEER_SUPERSEDED', message: '当前流式推演已被新指令接管' }
      : { kind: 'USER_ABORT', message: '已由用户手动停止生成' };
  controller.abort(reason);
  activeSessionAbortControllers.delete(sessionId);
  return true;
}

// ─── SSE Event Protocol ──────────────────────────────────────────────────────

export type UnifiedAgentSseEventType =
  | 'session_meta'
  | 'thinking_delta'
  | 'delta'
  | 'tool_call'
  | 'tool_result'
  | 'artifact'
  | 'ask_user'
  | 'usage'
  | 'run_error'
  | 'message_end';

export interface UnifiedAgentSseEvent {
  id: string;
  event: UnifiedAgentSseEventType;
  data: Record<string, unknown>;
}

export function createUnifiedSseStream(
  events: AsyncIterable<UnifiedAgentSseEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of events) {
          const payload = `id: ${ev.id}\nevent: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        }
        controller.close();
      } catch (err) {
        const errPayload = `id: evt-fatal\nevent: run_error\ndata: ${JSON.stringify({
          code: 'STREAM_ABORTED',
          message: err instanceof Error ? err.message : String(err),
        })}\n\n`;
        try {
          controller.enqueue(encoder.encode(errPayload));
          controller.close();
        } catch {
          // Stream already closed
        }
      }
    },
  });
}

// ─── Dynamic Pi-AI Models Registry Builder ───────────────────────────────────

const ZERO_MODEL_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const ZERO_USAGE_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

function mapProviderApi(providerType: LlmProviderConfig['providerType']): Api {
  if (providerType === 'ANTHROPIC') return 'anthropic-messages';
  if (providerType === 'GOOGLE_GEMINI') return 'google-generative-ai';
  return 'openai-completions';
}

const lazyOpenAiCompletions = lazyApi(() => import('@earendil-works/pi-ai/api/openai-completions'));
const lazyAnthropicMessages = lazyApi(() => import('@earendil-works/pi-ai/api/anthropic-messages'));
const lazyGoogleGenAi = lazyApi(() => import('@earendil-works/pi-ai/api/google-generative-ai'));

function getLazyApiForType(providerType: LlmProviderConfig['providerType']) {
  if (providerType === 'ANTHROPIC') return lazyAnthropicMessages;
  if (providerType === 'GOOGLE_GEMINI') return lazyGoogleGenAi;
  return lazyOpenAiCompletions;
}

function extractUserMessageText(msg: Extract<Message, { role: 'user' }> | undefined): string {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function buildFauxMockModels(
  store: WorkspaceStore,
  session: AgentSession,
  activeModelCode?: ModelCode,
  explicitLocale?: AgentLocale,
): {
  models: MutableModels;
  selectedModel: Model<Api>;
  providerLabel: string;
  visionSupported: boolean;
} {
  const project = resolveProjectDetail(store, session.projectId);
  const modelId = session.modelOverride || 'faux/ontology-pi-durable-v1';
  const allProviders = store.listLlmProviders();
  const selectedProvider = session.providerId
    ? allProviders.find((p) => p.id === session.providerId)
    : allProviders.find((p) => p.enabled) ?? allProviders[0];
  const visionSupported = selectedProvider?.supportsVision === false ? false : true;

  const faux = fauxProvider({
    provider: 'faux-mock',
    models: [
      {
        id: modelId,
        name: 'Ontology Pi Durable Mock Engine',
        input: visionSupported ? ['text', 'image'] : ['text'],
        reasoning: true,
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
    tokensPerSecond: process.env.VITEST === 'true' ? 50000 : 900,
    tokenSize: { min: 6, max: 18 },
  });

  faux.setResponses([
    // Step 1: Reasoning + Domain Tool Execution (or Scoped HITL ask_user)
    (context) => {
      const lastUserMsg = [...context.messages]
        .reverse()
        .find((m): m is Extract<Message, { role: 'user' }> => m.role === 'user');
      const userPrompt = extractUserMessageText(lastUserMsg);
      const lower = userPrompt.toLowerCase();
      const loc = resolveEffectiveLocale(store, explicitLocale, userPrompt);

      // Explicit Scoped HITL ask_user trigger when ambiguous choice is requested
      const hasResolvedChoice =
        userPrompt.includes('[用户已确认选择]') ||
        userPrompt.includes('[User Confirmed Choice]') ||
        userPrompt.includes('已选择：');
      if (
        !hasResolvedChoice &&
        (userPrompt.includes('待确认选项') ||
          userPrompt.includes('让我选择') ||
          lower.includes('ask_user') ||
          lower.includes('give me options') ||
          lower.includes('let me choose') ||
          (session.agentKind === 'REQUIREMENT' &&
            (userPrompt.includes('不确定') ||
              userPrompt.includes('哪种方案') ||
              userPrompt.includes('怎么处理') ||
              lower.includes('not sure') ||
              lower.includes('unsure') ||
              lower.includes('which option'))))
      ) {
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                loc,
                `识别到 B 类核心业务边界存在多方案分歧，按照 Scoped HITL 规范，常规只读与建模工具自动执行，针对业务分歧调用 ask_user 卡片邀请用户确认。`,
                `Detected a Class-B business boundary ambiguity. Following Scoped HITL rules, invoking ask_user so the user can choose the preferred policy.`,
              ),
            ),
            fauxToolCall(
              'ask_user',
              loc === 'en-US'
                ? {
                    header: 'Class-B Decision Pending',
                    question: `For "${userPrompt.slice(0, 48)}", select the exception & approval policy:`,
                    options: [
                      'Synchronous Precondition Block (M2): reject invalid submissions immediately',
                      'Escalated M6 Approval Flow: keep draft and route to dual sign-off',
                      'Async Risk Hold (Writeback): accept order and hold downstream settlement',
                    ],
                    multiSelect: false,
                    allowFreeform: true,
                  }
                : {
                    header: 'B类业务边界待确认',
                    question: `针对「${userPrompt.slice(0, 36)}」，请选择异常处理与审批流转策略：`,
                    options: [
                      '同步前置阻断 (M2 Precondition)：提交时实时拦截零脏数据落库',
                      '进入 M6 特批会签流：保留草稿并自动升级至法务与财务总监双签',
                      '异步风控冻结 (WB-01)：允许登记单据但自动冻结下游结算批次',
                    ],
                    multiSelect: false,
                    allowFreeform: true,
                  },
            ),
          ],
          { stopReason: 'toolUse' },
        );
      }

      if (session.agentKind === 'REASONING') {
        const mappedTables = (project?.suite.MM?.mappings ?? []).flatMap((m) =>
          m.tableMappings.map((tm) => tm.tableName),
        );
        const dbTables = store
          .listDatabaseResources()
          .flatMap((d) => d.tables.map((t) => t.tableName));
        const primaryTable = mappedTables[0] ?? dbTables[0] ?? 't_contract';
        const hasContractTables =
          primaryTable === 't_contract' || dbTables.includes('t_contract');
        const sql = hasContractTables
          ? userPrompt.includes('供应商') ||
            userPrompt.includes('相对方') ||
            lower.includes('counterparty') ||
            lower.includes('vendor')
            ? 'SELECT cp.company_name, cp.credit_rating, COUNT(c.id) AS contract_cnt, SUM(c.total_amount) AS total_amount FROM t_contract c JOIN t_counterparty cp ON c.counterparty_id = cp.id GROUP BY cp.id, cp.company_name, cp.credit_rating ORDER BY total_amount DESC'
            : 'SELECT risk_level, status, COUNT(id) AS contract_count, SUM(total_amount) AS total_amount FROM t_contract GROUP BY risk_level, status ORDER BY total_amount DESC'
          : `SELECT * FROM ${primaryTable} LIMIT 20`;

        const blocks = [
          fauxThinking(
            pickLocaleText(
              loc,
              `正在沿数据本体映射链路 M1 -> MM -> SQLite 执行实时穿透查询，并结合 M3 规则评估策略回写接口。`,
              `Querying live SQLite data along the M1 -> MM ontology mapping chain and evaluating M3 policy writeback options.`,
            ),
          ),
          fauxToolCall('run_readonly_sql', { sql }),
        ];
        if (
          session.reasoningMode === 'ASK_POLICY' ||
          userPrompt.includes('问策') ||
          userPrompt.includes('回写') ||
          userPrompt.includes('冻结') ||
          lower.includes('policy') ||
          lower.includes('writeback')
        ) {
          const wb = store.listWritebackInterfaces()[0];
          const primaryAgg = project?.suite.M1?.aggregates[0]?.name ?? 'PrimaryAggregate';
          blocks.push(
            fauxToolCall('propose_policy_writeback', {
              writebackInterfaceId: wb?.id ?? 'WB-01',
              actionTitle: pickLocaleText(
                loc,
                wb?.name ?? `执行 ${primaryAgg} 风险策略回写管控`,
                wb?.name ?? `Execute ${primaryAgg} policy writeback control`,
              ),
              targetObject: primaryAgg,
              expectedImpact: pickLocaleText(
                loc,
                `针对高风险 ${primaryAgg} 实例执行受控状态更新并写入审计日志`,
                `Apply governed state update on high-risk ${primaryAgg} records with audit logging`,
              ),
            }),
          );
        }
        return fauxAssistantMessage(blocks, { stopReason: 'toolUse' });
      }

      if (session.agentKind === 'CAPABILITY') {
        const caps = project ? inspectOntologyMcpCapabilities(project) : null;
        const matchedTool =
          caps?.tools.find((t) =>
            userPrompt.includes('规则') || lower.includes('rule')
              ? t.sourceModel === 'M3'
              : t.sourceModel === 'M7' || t.sourceModel === 'M2',
          ) ?? caps?.tools[0];
        if (matchedTool) {
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `正在根据业务语义匹配当前工程编译出的 MCP 工具 \`${matchedTool.name}\` 并自动执行。`,
                  `Matching compiled Ontology MCP tool \`${matchedTool.name}\` against user intent and invoking automatically.`,
                ),
              ),
              fauxToolCall('invoke_mcp_tool', {
                toolName: matchedTool.name,
                arguments: { filter: userPrompt.slice(0, 32), limit: 10 },
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }
      }

      if (session.agentKind === 'CODING') {
        const appId = session.targetId || store.listAssembledApplications()[0]?.id || 'app-01';
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                loc,
                `正在读取四层架构资产与 11 模型本体快照，重编译应用「${appId}」的渐进式披露开发包。`,
                `Reading 4-layer architecture assets and 11-model ontology snapshot to recompile progressive-disclosure dev package for "${appId}".`,
              ),
            ),
            fauxToolCall('compile_dev_package', { applicationId: appId }),
          ],
          { stopReason: 'toolUse' },
        );
      }

      if (session.agentKind === 'REQUIREMENT') {
        const ruleCode = `RULE-REQ-${Date.now().toString(36).slice(-3).toUpperCase()}`;
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                loc,
                `正在按 A/B 分级追问策略拆解用户需求，自动补全常规审计默认项并沉淀候选规则。`,
                `Decomposing requirements using Class-A/B progressive grilling, auto-completing standard audit defaults, and recording candidate domain rules.`,
              ),
            ),
            fauxToolCall('record_requirement_insights', {
              discoveredAggregates: (project?.suite.M1?.aggregates ?? [])
                .slice(0, 2)
                .map((a) => `${a.name} (${a.alias})`),
              discoveredRules: [`${ruleCode}: ${userPrompt.slice(0, 48)}`],
              resolvedDecisions:
                loc === 'en-US'
                  ? [
                      `[AI Auto-Completed] Automatically include createdAt/updatedAt audit fields and optimistic locking version`,
                      `[Confirmed] ${userPrompt.slice(0, 64)}`,
                    ]
                  : [
                      `[AI自动补全] 自动补充 createdAt/updatedAt 审计字段与幂等乐观锁版本号`,
                      `[已确认] ${userPrompt.slice(0, 64)}`,
                    ],
              openQuestions:
                loc === 'en-US'
                  ? [
                      `[Pending] When "${userPrompt.slice(0, 28)}" threshold triggers, should downstream fulfillment also pause?`,
                    ]
                  : [
                      `[待确认] 当触发「${userPrompt.slice(0, 24)}」阈值时是否同步联动管控下游单据？`,
                    ],
            }),
          ],
          { stopReason: 'toolUse' },
        );
      }

      // COPILOT default: inspect or mutate Ontology Suite
      const firstAgg = project?.suite.M1?.aggregates[0];
      if (
        (userPrompt.includes('删除') || lower.includes('delete')) &&
        (userPrompt.includes('Contract') ||
          userPrompt.includes('AGG-01') ||
          (firstAgg && userPrompt.includes(firstAgg.name)))
      ) {
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                loc,
                `用户请求删除核心聚合根 ${firstAgg?.id ?? 'AGG-01'}，尝试调用 delete_element 并交由 11 模型一致性门禁校验。`,
                `User requested deleting aggregate ${firstAgg?.id ?? 'AGG-01'}; calling delete_element under 11-model consistency gate.`,
              ),
            ),
            fauxToolCall('delete_element', {
              modelCode: 'M1',
              elementId: firstAgg?.id ?? 'AGG-01',
            }),
          ],
          { stopReason: 'toolUse' },
        );
      }

      if (userPrompt.includes('悬空自修复测试') || lower.includes('self-repair')) {
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                loc,
                `尝试直接移除 AGG-01 以重建场景，交由 11 模型一致性门禁验证安全性。`,
                `Attempting to delete AGG-01 directly to verify 11-model validator gate and automatic self-repair.`,
              ),
            ),
            fauxToolCall('delete_element', {
              modelCode: 'M1',
              elementId: 'AGG-01',
            }),
          ],
          { stopReason: 'toolUse' },
        );
      }

      if (
        userPrompt.includes('新增') ||
        userPrompt.includes('添加') ||
        userPrompt.includes('创建') ||
        lower.includes('add ') ||
        lower.includes('create ')
      ) {
        const explicitlyRule =
          userPrompt.includes('规则') ||
          userPrompt.includes('校验') ||
          lower.includes('rule');

        if (
          !explicitlyRule &&
          (userPrompt.includes('聚合') ||
            userPrompt.includes('实体') ||
            lower.includes('aggregate') ||
            lower.includes('entity') ||
            (activeModelCode === 'M1' &&
              !userPrompt.includes('行为') &&
              !userPrompt.includes('流程') &&
              !userPrompt.includes('事件') &&
              !userPrompt.includes('屏幕') &&
              !lower.includes('behavior') &&
              !lower.includes('flow') &&
              !lower.includes('event') &&
              !lower.includes('screen')))
        ) {
          const nextIdx = (project?.suite.M1?.aggregates.length ?? 0) + 1;
          const explicitPascal =
            /\b(?:aggregate|entity)\s+([A-Z][A-Za-z0-9]+)/.exec(userPrompt)?.[1] ??
            /\b([A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*)\b/.exec(userPrompt)?.[1];
          const derivedName = explicitPascal || `DomainEntity0${nextIdx}`;
          const derivedAlias =
            explicitPascal ||
            userPrompt
              .replace(
                /^(?:please\s+)?(?:请|帮我|新增|添加|创建|一个|一条|add|create|an?|the|aggregate|entity)\s*/gi,
                '',
              )
              .replace(/^(?:an?\s+|the\s+)?(?:aggregate|entity)\s*/i, '')
              .trim()
              .slice(0, 22) ||
            pickLocaleText(loc, `业务实体0${nextIdx}`, `Domain Entity 0${nextIdx}`);
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `解析到 M1 领域对象建模意图，调用 upsert_aggregate 写入 AST 并触发两级校验门禁。`,
                  `Parsed M1 domain aggregate modeling intent; calling upsert_aggregate via typed AST and two-tier validator.`,
                ),
              ),
              fauxToolCall('upsert_aggregate', {
                id: `AGG-0${nextIdx}`,
                name: derivedName,
                alias: derivedAlias,
                description: pickLocaleText(
                  loc,
                  `由 Pi Durable 本体助手根据「${userPrompt}」建模的聚合根`,
                  `Aggregate root modeled by Pi Durable assistant from "${userPrompt}"`,
                ),
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }

        const nextRuleIdx = (project?.suite.M3?.rules.length ?? 3) + 1;
        const refObj = project?.suite.M1?.aggregates[0]?.name ?? 'DomainEntity';
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                loc,
                `解析到 M3 跨对象业务规则建模意图，调用 upsert_rule 写入结构化规则并执行一致性门禁检查。`,
                `Parsed M3 cross-object business rule intent; calling upsert_rule and validating 11-model consistency.`,
              ),
            ),
            fauxToolCall('upsert_rule', {
              id: `RULE-0${nextRuleIdx}`,
              name: `DomainGuardRule0${nextRuleIdx}`,
              alias:
                userPrompt
                  .replace(/^(请|帮我|新增|添加|创建|一条|一个|add|create|an?|the)\s*/gi, '')
                  .slice(0, 24) ||
                pickLocaleText(loc, `业务管控规则0${nextRuleIdx}`, `Domain Guard Rule 0${nextRuleIdx}`),
              ruleType: 'VALIDATION',
              referencedObjects: [refObj],
              expression: `${refObj}.id != null`,
              violationMessage: pickLocaleText(
                loc,
                '触发 M3 规则拦截：不满足业务准入约束禁止继续流转',
                'M3 rule violation: guard condition failed; transition blocked',
              ),
            }),
          ],
          { stopReason: 'toolUse' },
        );
      }

      return fauxAssistantMessage(
        [
          fauxThinking(
            pickLocaleText(
              loc,
              `正在检索当前工程「${project?.name ?? session.projectId}」的 11 模型结构与两级校验状态。`,
              `Inspecting 11-model ontology snapshot and validation diagnostics for project "${project?.name ?? session.projectId}".`,
            ),
          ),
          fauxToolCall('inspect_ontology_model', {
            modelCode: activeModelCode ?? 'ALL',
          }),
        ],
        { stopReason: 'toolUse' },
      );
    },
    // Step 2: Check toolResult; if validator rejected a repairable call, self-repair! Otherwise synthesize final Markdown!
    (context) => {
      const lastUserMsg = [...context.messages]
        .reverse()
        .find((m): m is Extract<Message, { role: 'user' }> => m.role === 'user');
      const userPrompt = extractUserMessageText(lastUserMsg);
      const loc = resolveEffectiveLocale(store, explicitLocale, userPrompt);

      const toolResults = context.messages.filter(
        (m): m is ToolResultMessage => m.role === 'toolResult',
      );
      const lastResult = toolResults[toolResults.length - 1];
      const lastResultText =
        lastResult?.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('\n') ?? '';

      // Validator Self-Repair when Step 1 delete_element was rejected by 11-model consistency gate!
      if (
        lastResult?.isError &&
        lastResult.toolName === 'delete_element' &&
        lastResultText.includes('REJECTED_BY_VALIDATOR')
      ) {
        const validEvtId = project?.suite.ME?.events[0]?.id ?? 'EVT-01';
        const targetAgg = project?.suite.M1?.aggregates[0]?.name ?? 'DomainEntity';
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                loc,
                `检测到上一轮 delete_element 因跨模型引用约束被 11 模型一致性校验器拦截，自动自修复改为调用 upsert_scenario 安全挂载在现有事件 ${validEvtId} 上。`,
                `Previous delete_element was blocked by the 11-model consistency gate due to cross-model references; self-repairing via upsert_scenario bound to ${validEvtId}.`,
              ),
            ),
            fauxToolCall('upsert_scenario', {
              id: 'SCN-99',
              name: pickLocaleText(loc, '跨聚合联动管控场景', 'Cross-Aggregate Coordination Scenario'),
              triggerEventRef: validEvtId,
              involvedAggregates: [targetAgg],
              description: pickLocaleText(
                loc,
                '经 11 模型校验器反馈自动自修复创建的跨聚合场景',
                'Cross-aggregate scenario created via automatic 11-model validator self-repair',
              ),
            }),
          ],
          { stopReason: 'toolUse' },
        );
      }

      const freshProject = resolveProjectDetail(store, session.projectId) ?? project;
      const summaryLines = toolResults.slice(-3).map((tr) => {
        const txt = tr.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join(' ');
        const statusTxt = tr.isError
          ? pickLocaleText(loc, '一致性门禁拦截', 'Blocked by Validator')
          : pickLocaleText(loc, '执行成功', 'Applied');
        return `- **\`${tr.toolName}\`** (${statusTxt}): ${txt.slice(0, 180)}`;
      });

      return fauxAssistantMessage([
        fauxThinking(
          pickLocaleText(
            loc,
            `工具执行与一致性校验已完成，正在汇总结构化结论与下一步指引。`,
            `Tool execution and consistency validation finished; summarizing structured results.`,
          ),
        ),
        fauxText(
          loc === 'en-US'
            ? [
                `### Completed (${freshProject?.name ?? 'Current Project'})`,
                '',
                ...(summaryLines.length > 0 ? summaryLines : ['- Context analysis complete.']),
                '',
                `> 11-Model Gate Status: **${freshProject?.validation.errorCount ?? 0} Consistency Errors** · **${freshProject?.validation.warningCount ?? 0} Stage Warnings** (*Offline Demo Mock Engine*).`,
              ].join('\n')
            : [
                `### 处理完成（${freshProject?.name ?? '当前本体工程'}）`,
                '',
                ...(summaryLines.length > 0 ? summaryLines : ['- 已完成上下文分析。']),
                '',
                `> 当前 11 模型门禁状态：**${freshProject?.validation.errorCount ?? 0} 个一致性错误** · **${freshProject?.validation.warningCount ?? 0} 个阶段提示**（*离线演示 Mock 引擎*）。`,
              ].join('\n'),
        ),
      ]);
    },
    // Step 3 (if Step 2 performed self-repair tool call): Final summary after repair!
    (context) => {
      const lastUserMsg = [...context.messages]
        .reverse()
        .find((m): m is Extract<Message, { role: 'user' }> => m.role === 'user');
      const userPrompt = extractUserMessageText(lastUserMsg);
      const loc = resolveEffectiveLocale(store, explicitLocale, userPrompt);

      const toolResults = context.messages.filter(
        (m): m is ToolResultMessage => m.role === 'toolResult',
      );
      const freshProject = resolveProjectDetail(store, session.projectId) ?? project;
      return fauxAssistantMessage([
        fauxThinking(
          pickLocaleText(
            loc,
            `自修复工具调用已通过 11 模型门禁校验，输出最终确认报告。`,
            `Self-repair tool call passed the 11-model consistency gate; emitting final report.`,
          ),
        ),
        fauxText(
          loc === 'en-US'
            ? [
                `### Self-Repair & Consistency Gate Passed`,
                '',
                `- After the initial call was blocked by dangling references, the agent automatically rebound to a valid \`ME\` event and persisted cleanly (**${toolResults.length}** tool steps).`,
                `- Project Consistency Status: **${freshProject?.validation.errorCount ?? 0} Consistency Errors**.`,
              ].join('\n')
            : [
                `### 自修复与一致性门禁验证通过`,
                '',
                `- 首轮提交因悬空事件引用被校验器拦截后，已在同一轮对话内自动改绑合法 \`ME\` 领域事件并成功落库（共执行 **${toolResults.length}** 步工具闭环）。`,
                `- 当前工程一致性状态：**${freshProject?.validation.errorCount ?? 0} 个一致性错误**。`,
              ].join('\n'),
        ),
      ]);
    },
  ]);

  const models = createModels();
  models.setProvider(faux.provider);
  const selectedModel = faux.getModel(modelId) ?? faux.getModel();
  return {
    models,
    selectedModel,
    providerLabel: 'Pi Durable Mock Engine (fauxProvider)',
    visionSupported,
  };
}

export function buildPiModelsForStore(
  store: WorkspaceStore,
  session: AgentSession,
  options?: {
    mockMode?: boolean;
    activeModelCode?: ModelCode;
    locale?: AgentLocale;
  },
): {
  models: MutableModels;
  selectedModel: Model<Api>;
  providerConfig?: LlmProviderConfig;
  providerLabel: string;
  isMock: boolean;
  visionSupported: boolean;
} {
  const loc = resolveEffectiveLocale(store, options?.locale);
  const isMock = isMockLlmActive(store, options?.mockMode);
  if (isMock) {
    const built = buildFauxMockModels(store, session, options?.activeModelCode, loc);
    return { ...built, isMock: true };
  }

  const allProviders = store.listLlmProviders();
  const explicitSelectedProvider = session.providerId
    ? allProviders.find((p) => p.id === session.providerId && p.enabled) ??
      allProviders.find((p) => p.id === session.providerId)
    : undefined;
  const enabledProviders = allProviders.filter(
    (p) => p.enabled || (explicitSelectedProvider && p.id === explicitSelectedProvider.id),
  );
  if (enabledProviders.length === 0) {
    throw new LlmGatewayError({
      message: pickLocaleText(
        loc,
        '当前没有已启用的 LLM 网关提供商（Live 模式禁止静默伪造回复）。',
        'No enabled LLM gateway provider is configured (silent fake fallback is forbidden in Live mode).',
      ),
      providerName: pickLocaleText(loc, '未配置网关', 'No Provider Configured'),
      baseUrl: '(none)',
      model: session.modelOverride || '(none)',
      locale: loc,
    });
  }

  const models = createModels();
  let preferredProvider: LlmProviderConfig = explicitSelectedProvider ?? enabledProviders[0]!;
  let preferredModelId = session.modelOverride || preferredProvider.defaultModel;

  for (const cfg of enabledProviders) {
    const api = mapProviderApi(cfg.providerType);
    const cleanBaseUrl = (cfg.baseUrl || '').replace(/\/+$/, '');
    const modelIds = Array.from(
      new Set(
        [
          cfg.defaultModel,
          ...cfg.availableModels,
          ...(session.modelOverride ? [session.modelOverride] : []),
        ].filter(Boolean),
      ),
    );

    const catalog: Model<Api>[] = modelIds.map((id) => ({
      id,
      name: id,
      api,
      provider: cfg.id,
      baseUrl: cleanBaseUrl,
      input: doesProviderSupportVision(cfg, id) ? ['text', 'image'] : ['text'],
      cost: ZERO_MODEL_COST,
      reasoning: true,
      contextWindow: 128000,
      maxTokens: 16384,
    }));

    const provider = createProvider({
      id: cfg.id,
      name: cfg.name,
      baseUrl: cleanBaseUrl,
      auth: {
        apiKey: {
          name: `${cfg.name} API Key`,
          async resolve() {
            return {
              auth: {
                apiKey: cfg.apiKey || 'magpie',
                baseUrl: cleanBaseUrl,
              },
              source: cfg.name,
            };
          },
        },
      },
      models: catalog,
      api: getLazyApiForType(cfg.providerType),
    });

    models.setProvider(provider);
    if (
      !explicitSelectedProvider &&
      session.modelOverride &&
      cfg.availableModels.includes(session.modelOverride)
    ) {
      preferredProvider = cfg;
      preferredModelId = session.modelOverride;
    }
  }

  const selectedModel =
    models.getModel(preferredProvider.id, preferredModelId) ??
    models.getModels(preferredProvider.id)[0] ??
    models.getModels()[0];

  if (!selectedModel) {
    throw new LlmGatewayError({
      message: pickLocaleText(
        loc,
        `提供商「${preferredProvider.name}」未声明可用模型。`,
        `Provider "${preferredProvider.name}" has no declared models.`,
      ),
      providerName: preferredProvider.name,
      baseUrl: preferredProvider.baseUrl,
      model: preferredModelId || '(empty)',
      locale: loc,
    });
  }

  return {
    models,
    selectedModel,
    providerConfig: preferredProvider,
    providerLabel: preferredProvider.name,
    isMock: false,
    visionSupported: selectedModel.input.includes('image'),
  };
}

// ─── System Prompt & Toolset Builder per Agent Kind ──────────────────────────

function getToolsForAgentKind(kind: AgentSessionKind): Tool[] {
  const toPiTool = (spec: OpenAiFunctionTool): Tool => ({
    name: spec.function.name,
    description: spec.function.description,
    parameters: spec.function.parameters,
  });

  const ontologyTools = OPENAI_ONTOLOGY_TOOLS.map(toPiTool);
  const extraByName = new Map(
    UNIFIED_AGENT_EXTRA_TOOLS.map((t) => [t.function.name, toPiTool(t)]),
  );

  switch (kind) {
    case 'REQUIREMENT':
      return [
        extraByName.get('record_requirement_insights')!,
        extraByName.get('inspect_ontology_model')!,
        extraByName.get('ask_user')!,
      ];
    case 'COPILOT':
      return [
        ...ontologyTools,
        extraByName.get('inspect_ontology_model')!,
        extraByName.get('ask_user')!,
      ];
    case 'CODING':
      return [
        extraByName.get('compile_dev_package')!,
        extraByName.get('inspect_ontology_model')!,
        ...ontologyTools,
        extraByName.get('ask_user')!,
      ];
    case 'CAPABILITY':
      return [
        extraByName.get('invoke_mcp_tool')!,
        extraByName.get('inspect_ontology_model')!,
        extraByName.get('ask_user')!,
      ];
    case 'REASONING':
      return [
        extraByName.get('run_readonly_sql')!,
        extraByName.get('propose_policy_writeback')!,
        extraByName.get('inspect_ontology_model')!,
        extraByName.get('ask_user')!,
      ];
  }
}

function latestUserPrompt(session: AgentSession): string | undefined {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const message = session.messages[i]!;
    if (message.role === 'user' && message.content.trim()) return message.content;
  }
  return undefined;
}

function buildSystemPromptForSession(
  store: WorkspaceStore,
  session: AgentSession,
  activeModelCode?: ModelCode,
  locale: AgentLocale = 'zh-CN',
): string {
  const project = resolveProjectDetail(store, session.projectId);
  const writebacks =
    session.agentKind === 'REASONING'
      ? store
          .listWritebackInterfaces()
          .map((wb) => `${wb.id}(${wb.name} -> ${wb.boundBehaviorRef})`)
          .join(', ')
      : '';
  const renderedGrounding =
    session.agentKind === 'REASONING'
      ? renderDataGrounding(
          buildProjectDataGrounding(store, project, latestUserPrompt(session)),
          locale,
        )
      : '';

  if (locale === 'en-US') {
    const baseHeaderEn = [
      `You are the Pi Durable Agent of the Ontology Plus workbench (session kind: ${session.agentKind}).`,
      `LANGUAGE RULE: Always respond in English (matching the user's English interface/input), unless the user explicitly writes in Chinese.`,
      project
        ? `Active Ontology Project: ${project.name} (ID: ${project.id}, Domain: ${project.domain}, Present Models: ${project.validation.presentModels.join(', ')}, Consistency Errors: ${project.validation.errorCount}, Stage Warnings: ${project.validation.warningCount}).`
        : '',
      activeModelCode ? `Currently focused model tab: ${activeModelCode}.` : '',
      session.compactedSummary ? `[Compacted Conversation Summary]\n${session.compactedSummary}` : '',
      `Execution Rules (YOLO + Scoped HITL):`,
      `1. Execute routine modeling, read-only inspection, SQL queries, MCP calls, and dev-package compilation tools automatically (YOLO). Never ask permission before calling routine tools.`,
      `2. ONLY call \`ask_user\` when required business parameters are missing or a Class-B business boundary ambiguity requires a human decision.`,
      `3. If an ontology mutation returns an 11-model consistency error (isError=true), read the diagnostics and self-repair in the same turn.`,
      `4. Always use the term "Ontology Extraction" — never "reverse engineering".`,
    ]
      .filter(Boolean)
      .join('\n');

    if (session.agentKind === 'REASONING') {
      return [
        baseHeaderEn,
        `Current reasoning mode: ${session.reasoningMode ?? 'ASK_DATA'} (ASK_DATA=data query, ASK_WHY=root-cause attribution, ASK_POLICY=policy writeback).`,
        renderedGrounding,
        writebacks ? `Registered writeback interfaces: ${writebacks}.` : '',
        `Call run_readonly_sql first to inspect live SQLite data before drawing conclusions; every figure you state must come from a query result. In ASK_POLICY mode, call propose_policy_writeback to propose governed actions.`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    if (session.agentKind === 'CAPABILITY') {
      const caps = project ? inspectOntologyMcpCapabilities(project) : null;
      const toolNames = caps?.tools.map((t) => `${t.name}(${t.sourceModel})`).join(', ') ?? 'none';
      return `${baseHeaderEn}\nCompiled Ontology MCP tools: ${toolNames}. Prefer calling invoke_mcp_tool to execute domain queries or behaviors.`;
    }
    if (session.agentKind === 'CODING') {
      return `${baseHeaderEn}\nTarget assembled application ID: ${session.targetId ?? 'app-01'}. Call compile_dev_package to compile progressive-disclosure engineering artifacts or refine ontology elements.`;
    }
    if (session.agentKind === 'REQUIREMENT') {
      return `${baseHeaderEn}\nFollow Class-A/B progressive grilling: tag standard audit/engineering defaults with [AI Auto-Completed], tag confirmed business rules with [Confirmed], call ask_user for unresolved Class-B decisions (or tag [Pending]), and call record_requirement_insights to persist candidate aggregates and rules.`;
    }
    return `${baseHeaderEn}\nCurrent M1 aggregates: ${(project?.suite.M1?.aggregates ?? []).map((a) => `${a.name}(${a.id}:${a.alias})`).join(', ') || 'none'}; M3 rules count: ${project?.suite.M3?.rules.length ?? 0}.`;
  }

  const baseHeader = [
    `你是 Ontology Plus 工作台的 Pi Durable 智能体（会话类型：${session.agentKind}）。`,
    `语言准则：请始终与用户最新输入保持同一语言回复（中文提问用中文，英文提问用英文）。`,
    project
      ? `当前激活本体工程：${project.name}（ID: ${project.id}，领域：${project.domain}，已建模型：${project.validation.presentModels.join(', ')}，一致性错误：${project.validation.errorCount}，阶段提示：${project.validation.warningCount}）。`
      : '',
    activeModelCode ? `当前聚焦模型标签页：${activeModelCode}。` : '',
    session.compactedSummary ? `【历史会话压缩摘要】\n${session.compactedSummary}` : '',
    `执行准则（YOLO + Scoped HITL）：`,
    `1. 所有常规建模、只读检索、SQL 查询、MCP 调用、开发包重编译工具均直接自动调用（YOLO），严禁在调用常规工具前向用户索要权限许可。`,
    `2. 仅当缺少必填业务参数或存在 B 类业务规则分歧需要用户拍板时，才调用 \`ask_user\` 工具弹出结构化单选/多选卡片。`,
    `3. 若本体变更工具返回 11 模型一致性错误（isError=true），请仔细阅读错误诊断并在本轮自动修正参数重试。`,
    `4. 严禁使用“逆向”或“逆向工程”字眼，统一使用“本体萃取 (Ontology Extraction)”。`,
  ]
    .filter(Boolean)
    .join('\n');

  if (session.agentKind === 'REASONING') {
    return [
      baseHeader,
      `当前分析推理模式：${session.reasoningMode ?? 'ASK_DATA'}（ASK_DATA=智能问数，ASK_WHY=智能问因，ASK_POLICY=智能问策）。`,
      renderedGrounding,
      writebacks ? `当前已注册闭环回写接口：${writebacks}。` : '',
      `优先调用 run_readonly_sql 获取真实表数据后再输出结论，结论中的每个数字都必须来自查询结果；在 ASK_POLICY 模式下可调用 propose_policy_writeback 生成策略建议。`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (session.agentKind === 'CAPABILITY') {
    const caps = project ? inspectOntologyMcpCapabilities(project) : null;
    const toolNames = caps?.tools.map((t) => `${t.name}(${t.sourceModel})`).join(', ') ?? '无';
    return `${baseHeader}\n当前工程可用 Ontology MCP 工具：${toolNames}。优先调用 invoke_mcp_tool 执行业务动作或查询。`;
  }
  if (session.agentKind === 'CODING') {
    return `${baseHeader}\n目标装配应用 ID：${session.targetId ?? 'app-01'}。可调用 compile_dev_package 编译渐进式披露开发包或微调本体元素。`;
  }
  if (session.agentKind === 'REQUIREMENT') {
    return `${baseHeader}\n遵循 A/B 分级追问策略：A 类常规默认项标注 [AI自动补全]，B 类核心业务边界标注 [已确认] 或调用 ask_user 让用户选择确认，并调用 record_requirement_insights 沉淀候选规则。`;
  }
  return `${baseHeader}\n当前 M1 聚合根：${(project?.suite.M1?.aggregates ?? []).map((a) => `${a.name}(${a.id}:${a.alias})`).join(', ') || '无'}；M3 规则数：${project?.suite.M3?.rules.length ?? 0}。`;
}

// ─── Execute Single Tool Call (YOLO + Validator Gate + Scoped HITL) ──────────

interface ExecutedToolStep {
  trace: AgentToolCallTrace;
  toolResultContent: string;
  isError: boolean;
  artifact?: AgentDomainArtifact;
  askUserPrompt?: AgentAskUserPrompt;
}

function executeUnifiedToolCall(
  store: WorkspaceStore,
  session: AgentSession,
  tc: ToolCall,
  hadPreviousValidatorError: boolean,
  locale: AgentLocale = 'zh-CN',
): ExecutedToolStep {
  const started = Date.now();
  const args = (tc.arguments ?? {}) as Record<string, unknown>;
  const ontologyToolSet = new Set<string>(ONTOLOGY_TOOL_NAMES);

  // 1. Scoped HITL ask_user
  if (tc.name === 'ask_user') {
    const rawOptions = Array.isArray(args.options) ? args.options : [];
    const options = rawOptions
      .map((item) => {
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const lbl = String(
            obj.label || obj.id || pickLocaleText(locale, '默认选项', 'Default option'),
          );
          const desc = typeof obj.description === 'string' ? ` — ${obj.description}` : '';
          return `${lbl}${desc}`;
        }
        return String(item);
      })
      .filter(Boolean)
      .slice(0, 6);

    const promptCard: AgentAskUserPrompt = {
      id: `ask-${Date.now().toString(36)}`,
      header:
        typeof args.header === 'string'
          ? args.header
          : pickLocaleText(locale, '待确认业务决策', 'Decision Pending'),
      question: String(
        args.question ||
          pickLocaleText(locale, '请确认以下业务选项：', 'Please select your preferred business option:'),
      ),
      options:
        options.length > 0
          ? options
          : locale === 'en-US'
            ? ['Use recommended default option', 'Escalate to custom approval flow']
            : ['采用推荐默认方案', '转交特批审批流处理'],
      multiSelect: Boolean(args.multiSelect),
      allowFreeform: args.allowFreeform !== false,
      answered: false,
    };

    return {
      trace: {
        id: tc.id,
        toolName: tc.name,
        arguments: args,
        output: pickLocaleText(
          locale,
          `等待用户确认：${promptCard.question}`,
          `Awaiting user confirmation: ${promptCard.question}`,
        ),
        isError: false,
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify({
        status: 'WAITING_USER_INPUT',
        promptId: promptCard.id,
        question: promptCard.question,
      }),
      isError: false,
      askUserPrompt: promptCard,
    };
  }

  // 2. 12 Core Ontology Suite Tools (with Two-Tier Validator Self-Correction Gate)
  if (ontologyToolSet.has(tc.name)) {
    const project = store.getProject(session.projectId);
    if (!project) {
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: pickLocaleText(
            locale,
            `未找到工程 ${session.projectId}`,
            `Project not found: ${session.projectId}`,
          ),
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: `Project not found: ${session.projectId}`,
        isError: true,
      };
    }

    const workingSuite: OntologySuite = JSON.parse(JSON.stringify(project.suite));
    const baselineReport = validateOntologySuite(workingSuite);

    try {
      const mutation = applyOntologyToolCall(
        workingSuite,
        tc.name as OntologyToolName,
        args,
        project.domain,
      );
      const candidateReport = validateOntologySuite(mutation.nextSuite);

      if (candidateReport.errorCount > baselineReport.errorCount) {
        const addedErrors = candidateReport.diagnostics
          .filter((d) => d.tier === 'ERROR')
          .map(
            (d) =>
              `[${d.code}@${d.model}] ${locale === 'en-US' ? d.messageEn : d.messageZh} (${d.elementId ?? 'root'})`,
          );

        return {
          trace: {
            id: tc.id,
            toolName: tc.name,
            arguments: args,
            output: pickLocaleText(
              locale,
              `被 11 模型一致性门禁拦截（错误 ${baselineReport.errorCount} -> ${candidateReport.errorCount}）：${addedErrors[0] ?? '跨模型引用不一致'}`,
              `Blocked by 11-model consistency gate (errors ${baselineReport.errorCount} -> ${candidateReport.errorCount}): ${addedErrors[0] ?? 'cross-model reference inconsistency'}`,
            ),
            isError: true,
            targetModelCode: mutation.modelCode,
            targetElementId: mutation.elementId,
            durationMs: Date.now() - started,
          },
          toolResultContent: JSON.stringify({
            status: 'REJECTED_BY_VALIDATOR',
            baselineErrors: baselineReport.errorCount,
            candidateErrors: candidateReport.errorCount,
            diagnostics: addedErrors,
            hint: pickLocaleText(
              locale,
              '请根据 diagnostics 修正悬空引用或改用已存在的聚合根/行为/事件 ID 后重试。',
              'Fix dangling references per diagnostics or bind to existing Aggregate/Behavior/Event IDs and retry.',
            ),
          }),
          isError: true,
        };
      }

      const saved = store.updateSuite(
        project.id,
        mutation.nextSuite,
        `Pi Session (${session.title}) executed ${tc.name} -> ${mutation.elementId}`,
      );

      const actionType: 'ADDED' | 'MODIFIED' | 'REMOVED' =
        tc.name === 'delete_element' ? 'REMOVED' : 'ADDED';
      const localizedSummary = locale === 'en-US' ? mutation.summaryEn : mutation.summaryZh;

      const artifact: AgentDomainArtifact = {
        kind: 'ONTOLOGY_DIFF',
        title: `${mutation.modelCode} · ${mutation.elementId}`,
        modelCode: mutation.modelCode,
        changes: [
          {
            id: mutation.elementId,
            category: mutation.modelCode,
            detail: localizedSummary,
            action: actionType,
          },
        ],
      };

      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: { ...args, id: mutation.elementId },
          output: localizedSummary,
          isError: false,
          ...(hadPreviousValidatorError ? { validatorRepair: true } : {}),
          targetModelCode: mutation.modelCode,
          targetElementId: mutation.elementId,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({
          status: 'APPLIED',
          modelCode: mutation.modelCode,
          elementId: mutation.elementId,
          summary: localizedSummary,
          errorCount: saved.validation.errorCount,
          warningCount: saved.validation.warningCount,
        }),
        isError: false,
        artifact,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: pickLocaleText(
            locale,
            `本体变更被拦截：${msg}`,
            `Ontology mutation rejected: ${msg}`,
          ),
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({
          status: 'ERROR',
          message: msg,
        }),
        isError: true,
      };
    }
  }

  // 3. Inspect Ontology Model
  if (tc.name === 'inspect_ontology_model') {
    const project = resolveProjectDetail(store, session.projectId);
    if (!project) {
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: pickLocaleText(locale, '当前无可用本体工程', 'No active ontology project found'),
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: 'No project found',
        isError: true,
      };
    }
    const requested = String(args.modelCode || 'ALL');
    const isSpecific = (MODEL_CODES as readonly string[]).includes(requested);
    const snapshot = isSpecific
      ? {
          modelCode: requested,
          modelData: project.suite[requested as ModelCode] ?? null,
          diagnostics: project.validation.diagnostics.filter((d) => d.model === requested),
        }
      : {
          projectName: project.name,
          domain: project.domain,
          presentModels: project.validation.presentModels,
          errorCount: project.validation.errorCount,
          warningCount: project.validation.warningCount,
          aggregates: (project.suite.M1?.aggregates ?? []).map((a) => ({
            id: a.id,
            name: a.name,
            alias: a.alias,
          })),
          behaviorsCount: project.suite.M2?.behaviors.length ?? 0,
          rulesCount: project.suite.M3?.rules.length ?? 0,
          screensCount: project.suite.MU?.screens.length ?? 0,
        };

    return {
      trace: {
        id: tc.id,
        toolName: tc.name,
        arguments: args,
        output: pickLocaleText(
          locale,
          `已检视本体快照（${requested}）：${project.validation.errorCount} 错误 / ${project.validation.warningCount} 提示`,
          `Inspected ontology snapshot (${requested}): ${project.validation.errorCount} errors / ${project.validation.warningCount} warnings`,
        ),
        isError: false,
        ...(isSpecific ? { targetModelCode: requested as ModelCode } : {}),
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify(snapshot),
      isError: false,
    };
  }

  // 4. Record Requirement Insights
  if (tc.name === 'record_requirement_insights') {
    const reqSessions = store.listRequirementSessions(session.projectId);
    const targetReq =
      reqSessions.find((s) => s.id === session.targetId) ??
      reqSessions[0] ??
      store.createRequirementSession({
        projectId: session.projectId,
        title:
          session.title || pickLocaleText(locale, '需求探索会话', 'Requirement Session'),
      });
    const discoveredAggregates = Array.isArray(args.discoveredAggregates)
      ? args.discoveredAggregates.map(String)
      : [];
    const discoveredRules = Array.isArray(args.discoveredRules)
      ? args.discoveredRules.map(String)
      : [];
    const resolvedDecisions = Array.isArray(args.resolvedDecisions)
      ? args.resolvedDecisions.map(String)
      : [];
    const openQuestions = Array.isArray(args.openQuestions)
      ? args.openQuestions.map(String)
      : [];

    if (targetReq) {
      const mergedAggs = Array.from(
        new Set([...targetReq.discoveredAggregates, ...discoveredAggregates]),
      );
      const mergedRules = Array.from(
        new Set([...targetReq.discoveredRules, ...discoveredRules]),
      );
      const mergedDecisions = Array.from(
        new Set([...targetReq.resolvedDecisions, ...resolvedDecisions]),
      );
      store.appendRequirementMessage(
        targetReq.id,
        {
          id: `rmsg-${Date.now().toString(36)}`,
          role: 'assistant',
          content: pickLocaleText(
            locale,
            `已从统一会话同步 ${discoveredRules.length} 条候选规则与 ${resolvedDecisions.length} 项决策。`,
            `Synced ${discoveredRules.length} candidate rules and ${resolvedDecisions.length} decisions from unified session.`,
          ),
          timestamp: new Date().toISOString(),
          extractedHints: {
            aggregates: discoveredAggregates,
            rules: discoveredRules,
            openQuestions,
          },
        },
        {
          discoveredAggregates: mergedAggs,
          discoveredRules: mergedRules,
          resolvedDecisions: mergedDecisions,
        },
      );
    }

    return {
      trace: {
        id: tc.id,
        toolName: tc.name,
        arguments: args,
        output: pickLocaleText(
          locale,
          `已沉淀 ${discoveredRules.length} 条候选规则、${resolvedDecisions.length} 项分级决策`,
          `Recorded ${discoveredRules.length} candidate rules and ${resolvedDecisions.length} tiered decisions`,
        ),
        isError: false,
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify({
        recordedRules: discoveredRules,
        recordedDecisions: resolvedDecisions,
      }),
      isError: false,
      artifact: {
        kind: 'REQUIREMENT_HINTS',
        aggregates: discoveredAggregates,
        rules: discoveredRules,
        decisions: resolvedDecisions,
        openQuestions,
      },
    };
  }

  // 5. Compile Dev Package
  if (tc.name === 'compile_dev_package') {
    const appId = String(args.applicationId || session.targetId || 'app-01');
    const apps = store.listAssembledApplications();
    const app = apps.find((a) => a.id === appId) ?? apps[0];
    const project = app
      ? store.getProject(app.projectId)
      : resolveProjectDetail(store, session.projectId);
    if (!app || !project) {
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: pickLocaleText(
            locale,
            `未找到装配应用 ${appId}`,
            `Assembled application not found: ${appId}`,
          ),
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: `Application not found: ${appId}`,
        isError: true,
      };
    }
    const assets = store.listFourLayerAssets();
    const uiUeAsset =
      assets.find((a) => a.id === app.uiUeAssetId) ??
      assets.find((a) => a.layer === 'UI_UE') ??
      assets[0]!;
    const techFoundationAsset =
      assets.find((a) => a.id === app.techFoundationAssetId) ??
      assets.find((a) => a.layer === 'TECH_FOUNDATION') ??
      assets[0]!;
    const techArchAsset =
      assets.find((a) => a.id === app.techArchAssetId) ??
      assets.find((a) => a.layer === 'TECH_ARCH') ??
      assets[0]!;
    const requirementDoc = store.listRequirementDocs(project.id)[0];
    const confirmedProto = store.getConfirmedPrototypeRevision(project.id);
    const prototype = confirmedProto
      ? {
          ...confirmedProto.prototype,
          htmlContent: confirmedProto.htmlContent,
          extractedScreenCount: confirmedProto.revision.extractedScreenCount,
        }
      : undefined;
    const pkg = compileDevelopmentPackage({
      app,
      project,
      uiUeAsset,
      techFoundationAsset,
      techArchAsset,
      ...(requirementDoc ? { requirementDoc } : {}),
      ...(prototype ? { prototype } : {}),
    });
    const updatedApp = store.saveAssembledApplication({
      ...app,
      status: 'PACKAGE_READY',
      packageOutputDir: pkg.outputDir,
      agentDevLogs: [
        ...app.agentDevLogs,
        {
          timestamp: new Date().toISOString(),
          phase: 'PI_SESSION_COMPILE',
          detail: pickLocaleText(
            locale,
            `通过统一会话编译生成 ${pkg.files.length} 份渐进式披露开发包文件`,
            `Compiled ${pkg.files.length} progressive-disclosure dev package files via unified session`,
          ),
        },
      ],
    });

    return {
      trace: {
        id: tc.id,
        toolName: tc.name,
        arguments: args,
        output: pickLocaleText(
          locale,
          `已重编译应用「${updatedApp.name}」渐进式披露开发包（共 ${pkg.files.length} 个产物文件）`,
          `Recompiled progressive-disclosure dev package for "${updatedApp.name}" (${pkg.files.length} files)`,
        ),
        isError: false,
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify({
        applicationId: updatedApp.id,
        filesCount: pkg.files.length,
        paths: pkg.files.map((f) => f.relativePath),
      }),
      isError: false,
      artifact: {
        kind: 'CODING_PACKAGE',
        appId: updatedApp.id,
        outputDir: pkg.outputDir,
        files: pkg.files.map((f) => f.relativePath),
      },
    };
  }

  // 6. Invoke MCP Tool
  if (tc.name === 'invoke_mcp_tool') {
    const project = resolveProjectDetail(store, session.projectId);
    if (!project) {
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: pickLocaleText(locale, '未找到本体工程', 'Ontology project not found'),
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: 'No project found',
        isError: true,
      };
    }
    const toolName = String(args.toolName || '');
    const mcpArgs =
      args.arguments && typeof args.arguments === 'object'
        ? (args.arguments as Record<string, unknown>)
        : {};
    const rpcRes = handleOntologyMcpRequest(
      project,
      {
        jsonrpc: '2.0',
        id: tc.id,
        method: 'tools/call',
        params: { name: toolName, arguments: mcpArgs },
      },
      {
        sqlExecutor: (s, p) => store.executeReadOnlyAnalyticsSql(s, p),
      },
    );

    const isErr = Boolean(rpcRes.error);
    return {
      trace: {
        id: tc.id,
        toolName: tc.name,
        arguments: args,
        output: isErr
          ? pickLocaleText(
              locale,
              `MCP 工具 ${toolName} 调用失败：${rpcRes.error?.message}`,
              `MCP tool ${toolName} failed: ${rpcRes.error?.message}`,
            )
          : pickLocaleText(
              locale,
              `已调用 MCP 工具 ${toolName}：${JSON.stringify(rpcRes.result).slice(0, 160)}`,
              `Invoked MCP tool ${toolName}: ${JSON.stringify(rpcRes.result).slice(0, 160)}`,
            ),
        isError: isErr,
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify(rpcRes.result ?? rpcRes.error),
      isError: isErr,
    };
  }

  // 7. Run Read-Only SQLite Analytics Query
  if (tc.name === 'run_readonly_sql') {
    const project = resolveProjectDetail(store, session.projectId);
    const firstMappedTable =
      project?.suite.MM?.mappings[0]?.tableMappings[0]?.tableName ??
      store.listDatabaseResources()[0]?.tables[0]?.tableName ??
      't_contract';
    const sql = String(args.sql || `SELECT * FROM ${firstMappedTable} LIMIT 10`);

    // Grounding check before anything runs: a table outside the grounding is
    // refused with the list to choose from; a join the ontology does not back
    // runs, with a warning attached to the result.
    const grounding = buildProjectDataGrounding(store, project);
    const groundingReport = checkSqlGrounding(grounding, sql);
    if (groundingReport.unknownTables.length > 0) {
      const refusal = describeGroundingRefusal(grounding, groundingReport, locale);
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: refusal,
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({
          error: refusal,
          unknownTables: groundingReport.unknownTables,
          availableTables: grounding.tables.map((t) => t.table),
        }),
        isError: true,
      };
    }
    const groundingWarnings = describeJoinWarnings(groundingReport, locale, grounding);

    try {
      const queryResult = store.executeReadOnlyAnalyticsSql(sql);
      const rowsSummary = pickLocaleText(
        locale,
        `SQLite 实查返回 ${queryResult.rowCount} 行（${queryResult.columns.join(', ')}）`,
        `SQLite query returned ${queryResult.rowCount} rows (${queryResult.columns.join(', ')})`,
      );
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output:
            groundingWarnings.length > 0
              ? `${rowsSummary}\n${groundingWarnings.join('\n')}`
              : rowsSummary,
          isError: false,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify(
          groundingWarnings.length > 0 ? { ...queryResult, groundingWarnings } : queryResult,
        ),
        isError: false,
        artifact: {
          kind: 'SQL_PREVIEW',
          sql: queryResult.sql,
          columns: queryResult.columns,
          rows: queryResult.rows,
          elapsedMs: queryResult.elapsedMs,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: pickLocaleText(
            locale,
            `SQL 查询被拦截或语法错误：${msg}`,
            `SQL query rejected or syntax error: ${msg}`,
          ),
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({ error: msg }),
        isError: true,
      };
    }
  }

  // 8. Propose Policy Writeback
  if (tc.name === 'propose_policy_writeback') {
    const project = resolveProjectDetail(store, session.projectId);
    const defaultWb = store.listWritebackInterfaces()[0]?.id ?? 'WB-01';
    const defaultTarget = project?.suite.M1?.aggregates[0]?.name ?? 'PrimaryAggregate';
    const wbId = String(args.writebackInterfaceId || defaultWb);
    const actionTitle = String(
      args.actionTitle || pickLocaleText(locale, '执行策略回写闭环', 'Execute Policy Writeback'),
    );
    const targetObject = String(args.targetObject || defaultTarget);
    const expectedImpact = String(
      args.expectedImpact ||
        pickLocaleText(
          locale,
          '触发受控业务状态更新并记录回写审计流水',
          'Trigger governed state update with audit trail logging',
        ),
    );

    return {
      trace: {
        id: tc.id,
        toolName: tc.name,
        arguments: args,
        output: pickLocaleText(
          locale,
          `已生成策略回写建议：${actionTitle} (${wbId})`,
          `Generated policy writeback proposal: ${actionTitle} (${wbId})`,
        ),
        isError: false,
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify({
        writebackInterfaceId: wbId,
        actionTitle,
        targetObject,
        expectedImpact,
      }),
      isError: false,
      artifact: {
        kind: 'REASONING_POLICY',
        mode: session.reasoningMode ?? 'ASK_POLICY',
        dataSummary: [
          { label: pickLocaleText(locale, '绑定回写接口', 'Writeback Interface'), value: wbId },
        ],
        causalAnalysis: [
          pickLocaleText(
            locale,
            `针对核心对象 ${targetObject} 触发闭环回写动作`,
            `Trigger closed-loop writeback action against ${targetObject}`,
          ),
        ],
        policyRecommendations: [
          {
            actionTitle,
            targetObject,
            expectedImpact,
            writebackInterfaceId: wbId,
          },
        ],
      },
    };
  }

  return {
    trace: {
      id: tc.id,
      toolName: tc.name,
      arguments: args,
      output: pickLocaleText(locale, `未知工具：${tc.name}`, `Unknown tool: ${tc.name}`),
      isError: true,
      durationMs: Date.now() - started,
    },
    toolResultContent: `Unknown tool: ${tc.name}`,
    isError: true,
  };
}

// ─── Convert Stored AgentSession History into Pi-AI Transcript Messages ──────

function buildInitialPiMessages(session: AgentSession): Message[] {
  const recent = session.compactedSummary
    ? session.messages.slice(-8)
    : session.messages.slice(-18);

  const result: Message[] = [];
  for (const m of recent) {
    if (m.role === 'user') {
      result.push({
        role: 'user',
        content: m.content,
        timestamp: Date.parse(m.timestamp) || Date.now(),
      });
    } else if (m.role === 'assistant' && m.content.trim()) {
      result.push({
        role: 'assistant',
        content: [{ type: 'text', text: m.content }],
        api: 'openai-completions',
        provider: 'history',
        model: m.modelUsed || 'history',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: ZERO_USAGE_COST,
        },
        stopReason: 'stop',
        timestamp: Date.parse(m.timestamp) || Date.now(),
      });
    }
  }
  return result;
}

function estimateSessionTokens(session: AgentSession): number {
  const chars =
    (session.compactedSummary?.length ?? 0) +
    session.messages.reduce(
      (sum, m) => sum + m.content.length + (m.thinking?.length ?? 0),
      0,
    );
  return Math.max(64, Math.ceil(chars / 2.6));
}

// ─── Session Compaction ──────────────────────────────────────────────────────

function buildDeterministicCompactionBullets(
  older: AgentSession['messages'],
  locale: AgentLocale = 'zh-CN',
): string[] {
  return older.slice(-14).map((m) => {
    const snippet = m.content.replace(/\s+/g, ' ').trim().slice(0, 240);
    const answeredChoice =
      m.askUser?.answered && m.askUser.selectedAnswers?.length
        ? pickLocaleText(
            locale,
            ` [已确认选择: ${m.askUser.selectedAnswers.join(' / ')}]`,
            ` [Confirmed choice: ${m.askUser.selectedAnswers.join(' / ')}]`,
          )
        : '';
    const tools = (m.toolCalls ?? [])
      .map((t) => `${t.toolName}:${t.isError ? 'ERR' : 'OK'}`)
      .join(', ');
    const roleLabel =
      m.role === 'user' ? pickLocaleText(locale, '用户', 'User') : 'AI';
    const toolsSuffix = tools
      ? pickLocaleText(locale, ` (工具: ${tools})`, ` (Tools: ${tools})`)
      : '';
    return `- [${roleLabel}] ${snippet}${answeredChoice}${toolsSuffix}`;
  });
}

export function compactAgentSession(
  store: WorkspaceStore,
  sessionId: string,
  explicitLocale?: string,
): AgentSession {
  const session = store.getAgentSession(sessionId);
  if (!session) throw new Error(`Agent session not found: ${sessionId}`);
  if (session.messages.length <= 4) {
    return session;
  }

  const sample = session.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');
  const locale = resolveEffectiveLocale(store, explicitLocale, sample);

  const older = session.messages.slice(0, -4);
  const kept = session.messages.slice(-4);
  const bulletLines = buildDeterministicCompactionBullets(older, locale);

  const nextSummary = [
    session.compactedSummary ? `${session.compactedSummary}\n` : '',
    pickLocaleText(
      locale,
      `已压缩 ${older.length} 条早期对话消息（${new Date().toISOString()}）：`,
      `Compacted ${older.length} earlier messages (${new Date().toISOString()}):`,
    ),
    ...bulletLines,
  ]
    .filter(Boolean)
    .join('\n');

  const updated: AgentSession = {
    ...session,
    compactedSummary: nextSummary,
    messages: kept,
    updatedAt: new Date().toISOString(),
  };
  const estimated = estimateSessionTokens(updated);
  updated.tokenUsage = {
    inputTokens: Math.floor(estimated * 0.65),
    outputTokens: Math.ceil(estimated * 0.35),
    totalTokens: estimated,
  };
  return store.saveAgentSession(updated);
}

export async function compactAgentSessionWithLlm(
  store: WorkspaceStore,
  sessionId: string,
  explicitLocale?: string,
): Promise<AgentSession> {
  const session = store.getAgentSession(sessionId);
  if (!session) throw new Error(`Agent session not found: ${sessionId}`);
  if (session.messages.length <= 4) {
    return session;
  }
  const sample = session.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');
  const locale = resolveEffectiveLocale(store, explicitLocale, sample);

  if (isMockLlmActive(store)) {
    return compactAgentSession(store, sessionId, locale);
  }

  const older = session.messages.slice(0, -4);
  const kept = session.messages.slice(-4);
  const transcript = older
    .map((m) => {
      const choice =
        m.askUser?.answered && m.askUser.selectedAnswers?.length
          ? pickLocaleText(
              locale,
              `\n  用户确认选项：${m.askUser.selectedAnswers.join('；')}`,
              `\n  User confirmed choices: ${m.askUser.selectedAnswers.join('; ')}`,
            )
          : '';
      const tools = (m.toolCalls ?? []).map((t) => `${t.toolName}(${t.output})`).join('; ');
      const roleLabel =
        m.role === 'user' ? pickLocaleText(locale, '用户', 'User') : 'AI';
      return `[${roleLabel}] ${m.content}${choice}${tools ? `\n  Tools: ${tools}` : ''}`;
    })
    .join('\n\n');

  try {
    const built = buildPiModelsForStore(store, session, { mockMode: false, locale });
    const stream = built.models.streamSimple(
      built.selectedModel,
      {
        systemPrompt: pickLocaleText(
          locale,
          '你是 Ontology Plus 会话上下文压缩器。请将以下早期多轮对话提炼为高信息密度的结构化 Markdown 摘要（包含：1. 已确认业务目标与核心决策；2. 已识别领域对象/角色/业务规则；3. 已执行的工具变更与待推进事项）。严禁遗漏用户确认的具体业务参数，控制在 450 字以内。',
          'You are the Ontology Plus conversation context compactor. Condense the earlier multi-turn dialogue into a dense structured Markdown summary covering: (1) confirmed business goals & decisions, (2) discovered domain entities/roles/rules, and (3) executed tool mutations & open next steps. Never omit specific user-confirmed parameters; keep within 350 words.',
        ),
        messages: [
          {
            role: 'user',
            content: [
              session.compactedSummary
                ? pickLocaleText(
                    locale,
                    `既有历史摘要：\n${session.compactedSummary}\n`,
                    `Existing summary:\n${session.compactedSummary}\n`,
                  )
                : '',
              pickLocaleText(
                locale,
                `待压缩早期对话（共 ${older.length} 条）：\n${transcript}`,
                `Earlier messages to compact (${older.length} turns):\n${transcript}`,
              ),
            ]
              .filter(Boolean)
              .join('\n'),
            timestamp: Date.now(),
          },
        ],
      },
      {
        timeoutMs: 90_000,
        temperature: 0.1,
        maxTokens: 2048,
      },
    );

    let llmSummary = '';
    for await (const ev of stream) {
      if (ev.type === 'text_delta') {
        llmSummary += ev.delta;
      }
    }
    const cleanSummary = llmSummary.trim();
    if (!cleanSummary) {
      return compactAgentSession(store, sessionId, locale);
    }

    const updated: AgentSession = {
      ...session,
      compactedSummary: pickLocaleText(
        locale,
        `【AI 结构化会话摘要 · 已压缩 ${older.length} 条早期消息】\n${cleanSummary}`,
        `[AI Structured Summary · ${older.length} earlier messages compacted]\n${cleanSummary}`,
      ),
      messages: kept,
      updatedAt: new Date().toISOString(),
    };
    const estimated = estimateSessionTokens(updated);
    updated.tokenUsage = {
      inputTokens: Math.floor(estimated * 0.65),
      outputTokens: Math.ceil(estimated * 0.35),
      totalTokens: estimated,
    };
    return store.saveAgentSession(updated);
  } catch {
    return compactAgentSession(store, sessionId, locale);
  }
}

// ─── Unified Multi-Step Streaming Session Runner ─────────────────────────────

export interface TransientTurnImageInput {
  id: string;
  name: string;
  mimeType: string;
  dataBase64?: string;
  remoteUrl?: string;
  width?: number;
  height?: number;
  role?: AgentImageAttachmentRole;
  textFallbackNote?: string;
}

export interface UnifiedAgentStreamInput {
  sessionId: string;
  prompt?: string;
  mode?: 'PROMPT' | 'STEER' | 'FOLLOW_UP' | 'CONTINUE';
  askUserAnswer?: {
    promptId: string;
    selectedAnswers: string[];
    freeformText?: string;
  };
  images?: TransientTurnImageInput[];
  activeModelCode?: ModelCode;
  reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
  locale?: AgentLocale | string;
  mockMode?: boolean;
  signal?: AbortSignal;
  idleTimeoutMs?: number;
  stepTimeoutMs?: number;
}

function toPersistedImageRef(
  img: TransientTurnImageInput,
  index: number,
): AgentImageAttachmentRef {
  const hasSafeRemoteUrl =
    typeof img.remoteUrl === 'string' &&
    (/^https?:\/\//i.test(img.remoteUrl) ||
      (img.remoteUrl.startsWith('/') && !img.remoteUrl.startsWith('//'))) &&
    !/^(?:data|blob):/i.test(img.remoteUrl);
  const isRemote = hasSafeRemoteUrl && !img.dataBase64;
  return {
    id: img.id?.trim() || `img-${Date.now().toString(36)}-${index + 1}`,
    name: img.name?.trim() || `image-${index + 1}`,
    mimeType: img.mimeType?.trim() || 'image/webp',
    source: isRemote ? 'remote' : 'local',
    ...(isRemote && img.remoteUrl ? { remoteUrl: img.remoteUrl.trim() } : {}),
    ...(typeof img.width === 'number' && Number.isFinite(img.width) && img.width > 0
      ? { width: Math.round(img.width) }
      : {}),
    ...(typeof img.height === 'number' && Number.isFinite(img.height) && img.height > 0
      ? { height: Math.round(img.height) }
      : {}),
    ...(img.role ? { role: img.role } : {}),
  };
}

async function resolveTransientImagesForVisionTurn(
  images: TransientTurnImageInput[],
  locale: AgentLocale,
): Promise<{
  imageBlocks: ImageContent[];
  manifestLines: string[];
  fallbackNotes: string[];
}> {
  const imageBlocks: ImageContent[] = [];
  const manifestLines: string[] = [];
  const fallbackNotes: string[] = [];

  for (let i = 0; i < images.length; i += 1) {
    const img = images[i]!;
    const roleLabel = img.role ? ` (${img.role})` : '';
    const trimmedBase64 = typeof img.dataBase64 === 'string' ? img.dataBase64.trim() : '';

    if (trimmedBase64.length > 0) {
      const dataUriMatch = /^data:([^;]+);base64,([\s\S]+)$/i.exec(trimmedBase64);
      const rawBase64 = (dataUriMatch ? dataUriMatch[2]! : trimmedBase64).replace(/\s+/g, '');
      const resolvedMime = (dataUriMatch ? dataUriMatch[1]! : img.mimeType) || 'image/webp';
      if (rawBase64.length > 0) {
        imageBlocks.push({
          type: 'image',
          data: rawBase64,
          mimeType: resolvedMime,
        });
        manifestLines.push(
          `- [Image #${imageBlocks.length}] ${img.name}${roleLabel}${img.textFallbackNote ? ` — ${img.textFallbackNote}` : ''}`,
        );
        continue;
      }
    }

    if (typeof img.remoteUrl === 'string' && /^https?:\/\//i.test(img.remoteUrl.trim())) {
      try {
        const resp = await fetch(img.remoteUrl.trim(), {
          signal: AbortSignal.timeout(6000),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const headerMime = resp.headers.get('content-type')?.split(';')[0]?.trim();
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.byteLength > 0) {
          imageBlocks.push({
            type: 'image',
            data: buf.toString('base64'),
            mimeType: headerMime || img.mimeType || 'image/webp',
          });
          manifestLines.push(
            `- [Image #${imageBlocks.length}] ${img.name}${roleLabel}${img.textFallbackNote ? ` — ${img.textFallbackNote}` : ''}`,
          );
          continue;
        }
      } catch {
        // Fall through to text fallback note when remote screenshot cannot be fetched
      }
    }

    fallbackNotes.push(
      img.textFallbackNote?.trim() ||
        pickLocaleText(
          locale,
          `[参考图「${img.name}」未加载图像字节，仅使用文字说明]`,
          `[Reference image "${img.name}" bytes unavailable; using text description only]`,
        ),
    );
  }

  return { imageBlocks, manifestLines, fallbackNotes };
}

export async function* runUnifiedAgentSessionStream(
  store: WorkspaceStore,
  input: UnifiedAgentStreamInput,
): AsyncGenerator<UnifiedAgentSseEvent, void, unknown> {
  const existing = store.getAgentSession(input.sessionId);
  if (!existing) {
    throw new Error(`Agent session not found: ${input.sessionId}`);
  }

  const lastUserText = existing.messages.filter((m) => m.role === 'user').at(-1)?.content;
  const effectiveLocale = resolveEffectiveLocale(
    store,
    input.locale,
    input.prompt || input.askUserAnswer?.freeformText || lastUserText,
  );

  if (input.mode === 'STEER') {
    abortActiveAgentSession(existing.id, 'STEER_SUPERSEDED');
  }

  const controller = new AbortController();
  const idleTimeoutMs = input.idleTimeoutMs ?? 90_000;
  const stepTimeoutMs = input.stepTimeoutMs ?? Math.max(300_000, idleTimeoutMs * 2);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const resetIdleTimer = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
    }
    if (controller.signal.aborted) {
      return;
    }
    idleTimer = setTimeout(() => {
      if (!controller.signal.aborted) {
        const sec = Math.max(0.1, Math.round((idleTimeoutMs / 1000) * 10) / 10);
        const reason: SessionAbortReason = {
          kind: 'IDLE_TIMEOUT',
          message: pickLocaleText(
            effectiveLocale,
            `大模型流式推理响应超时（超过 ${sec} 秒未收到新分片）`,
            `LLM streaming response timed out (no new chunk received for ${sec}s)`,
          ),
        };
        controller.abort(reason);
      }
    }, idleTimeoutMs);
  };

  resetIdleTimer();

  const abortFromClient = () => {
    if (!controller.signal.aborted) {
      const reason: SessionAbortReason = {
        kind: 'CLIENT_DISCONNECT',
        message: pickLocaleText(
          effectiveLocale,
          '客户端流式连接已断开',
          'Client SSE connection closed',
        ),
      };
      controller.abort(reason);
    }
  };

  if (input.signal) {
    if (input.signal.aborted) {
      abortFromClient();
    } else {
      input.signal.addEventListener('abort', abortFromClient, {
        once: true,
      });
    }
  }
  activeSessionAbortControllers.set(existing.id, controller);

  const defaultAbortedMsg = pickLocaleText(
    effectiveLocale,
    '会话生成已中止',
    'Session generation aborted',
  );

  const toAbortedError = (): SessionStreamAbortedError => {
    const r = controller.signal.reason as Partial<SessionAbortReason> | Error | undefined;
    if (r && typeof r === 'object' && 'kind' in r && typeof r.kind === 'string') {
      return new SessionStreamAbortedError(
        r.kind as SessionAbortKind,
        typeof r.message === 'string' && r.message ? r.message : defaultAbortedMsg,
      );
    }
    if (r instanceof Error) {
      return new SessionStreamAbortedError('IDLE_TIMEOUT', r.message);
    }
    return new SessionStreamAbortedError('USER_ABORT', defaultAbortedMsg);
  };

  let seq = 1;
  const nextEventId = () => `${existing.id}-evt-${Date.now().toString(36)}-${seq++}`;
  const workingMessages: AgentSessionMessage[] = [...existing.messages];
  const nowIso = new Date().toISOString();

  // Resolve pending ask_user card if user submitted an answer
  let synthesizedPrompt = input.prompt?.trim() ?? '';
  if (input.askUserAnswer) {
    const combinedAnswers = [
      ...input.askUserAnswer.selectedAnswers,
      ...(input.askUserAnswer.freeformText ? [input.askUserAnswer.freeformText] : []),
    ].filter(Boolean);

    for (let i = workingMessages.length - 1; i >= 0; i -= 1) {
      const msg = workingMessages[i]!;
      if (msg.askUser && msg.askUser.id === input.askUserAnswer.promptId) {
        workingMessages[i] = {
          ...msg,
          askUser: {
            ...msg.askUser,
            answered: true,
            selectedAnswers: combinedAnswers,
          },
        };
        const answerSummary = pickLocaleText(
          effectiveLocale,
          `[用户已确认选择] ${combinedAnswers.join('；')}`,
          `[User Confirmed Choice] ${combinedAnswers.join('; ')}`,
        );
        synthesizedPrompt = synthesizedPrompt
          ? `${answerSummary}\n${synthesizedPrompt}`
          : answerSummary;
        break;
      }
    }
  }

  const incomingImages = Array.isArray(input.images) ? input.images : [];
  const turnAttachmentRefs: AgentImageAttachmentRef[] = incomingImages.map((img, idx) =>
    toPersistedImageRef(img, idx),
  );

  if (!synthesizedPrompt && turnAttachmentRefs.length > 0) {
    synthesizedPrompt = pickLocaleText(
      effectiveLocale,
      `请结合附带的 ${turnAttachmentRefs.length} 张参考图进行分析与设计调整。`,
      `Please inspect the ${turnAttachmentRefs.length} attached reference image(s) and apply appropriate design updates.`,
    );
  }

  let currentTurnUserMsgId: string | undefined;
  if (synthesizedPrompt) {
    currentTurnUserMsgId = `amsg-${Date.now().toString(36)}-u`;
    workingMessages.push({
      id: currentTurnUserMsgId,
      role: 'user',
      content: synthesizedPrompt,
      ...(turnAttachmentRefs.length > 0 ? { images: turnAttachmentRefs } : {}),
      timestamp: nowIso,
    });
  }

  const nextTitle =
    existing.messages.length === 0 &&
    synthesizedPrompt &&
    (existing.title.startsWith('新会话') ||
      existing.title.startsWith('新建') ||
      existing.title.startsWith('New '))
      ? synthesizedPrompt.replace(/\s+/g, ' ').slice(0, 26)
      : existing.title;

  let sessionState: AgentSession = store.saveAgentSession({
    ...existing,
    title: nextTitle,
    ...(input.reasoningMode ? { reasoningMode: input.reasoningMode } : {}),
    status: 'RUNNING',
    messages: workingMessages,
    updatedAt: nowIso,
  });

  const turnStartMs = Date.now();
  const assistantMsgId = `amsg-${Date.now().toString(36)}-a`;
  let built: ReturnType<typeof buildPiModelsForStore> | undefined;
  let accumulatedThinking = '';
  let accumulatedText = '';
  const allToolTraces: AgentToolCallTrace[] = [];
  const allArtifacts: AgentDomainArtifact[] = [];
  let pendingAskUser: AgentAskUserPrompt | undefined;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let hadValidatorError = false;

  let usedVisionFallback = false;
  let activeVisionFallbackNotice: string | undefined;

  try {
    built = buildPiModelsForStore(store, sessionState, {
      ...(input.mockMode !== undefined ? { mockMode: input.mockMode } : {}),
      ...(input.activeModelCode ? { activeModelCode: input.activeModelCode } : {}),
      locale: effectiveLocale,
    });

    if (!built.visionSupported) {
      activeVisionFallbackNotice = pickLocaleText(
        effectiveLocale,
        '当前模型看不了图，将只使用文字设计说明',
        'Current model cannot view images; only text design notes will be used',
      );
      if (incomingImages.length > 0) {
        usedVisionFallback = true;
      }
    }

    yield {
      id: nextEventId(),
      event: 'session_meta',
      data: {
        sessionId: sessionState.id,
        title: sessionState.title,
        provider: built.providerLabel,
        model: built.selectedModel.id,
        isMock: built.isMock,
        visionSupported: built.visionSupported,
        ...(activeVisionFallbackNotice ? { visionFallbackNotice: activeVisionFallbackNotice } : {}),
      },
    };

    const piMessages: Message[] = buildInitialPiMessages(sessionState);

    if (incomingImages.length > 0) {
      const lastPiUserIdx = (() => {
        for (let i = piMessages.length - 1; i >= 0; i -= 1) {
          if (piMessages[i]?.role === 'user') return i;
        }
        return -1;
      })();

      if (lastPiUserIdx >= 0) {
        const targetUserMsg = piMessages[lastPiUserIdx] as Extract<Message, { role: 'user' }>;
        const basePromptText = extractUserMessageText(targetUserMsg);

        if (built.visionSupported) {
          const resolvedVision = await resolveTransientImagesForVisionTurn(
            incomingImages,
            effectiveLocale,
          );
          const extraSections: string[] = [];
          if (resolvedVision.manifestLines.length > 0) {
            extraSections.push(
              pickLocaleText(
                effectiveLocale,
                `[视觉参考清单]\n${resolvedVision.manifestLines.join('\n')}`,
                `[Visual Reference Manifest]\n${resolvedVision.manifestLines.join('\n')}`,
              ),
            );
          }
          if (resolvedVision.fallbackNotes.length > 0) {
            extraSections.push(resolvedVision.fallbackNotes.join('\n'));
          }
          const combinedText = [basePromptText, ...extraSections].filter(Boolean).join('\n\n');
          if (resolvedVision.imageBlocks.length > 0) {
            piMessages[lastPiUserIdx] = {
              ...targetUserMsg,
              content: [{ type: 'text', text: combinedText }, ...resolvedVision.imageBlocks],
            };
          } else if (combinedText !== basePromptText) {
            piMessages[lastPiUserIdx] = {
              ...targetUserMsg,
              content: combinedText,
            };
          }
        } else {
          const fallbackLines = incomingImages.map((img, idx) => {
            const roleTag = img.role ? ` (${img.role})` : '';
            const detail =
              img.textFallbackNote?.trim() ||
              pickLocaleText(
                effectiveLocale,
                `图片「${img.name}」仅使用文字说明`,
                `Image "${img.name}" represented by text notes only`,
              );
            return `- [${idx + 1}] ${img.name}${roleTag}: ${detail}`;
          });
          const fallbackBlock = pickLocaleText(
            effectiveLocale,
            `[文字设计说明（当前模型不支持看图）]\n${fallbackLines.join('\n')}`,
            `[Text Design Notes (current model does not support vision input)]\n${fallbackLines.join('\n')}`,
          );
          piMessages[lastPiUserIdx] = {
            ...targetUserMsg,
            content: [basePromptText, fallbackBlock].filter(Boolean).join('\n\n'),
          };
        }
      }
    }

    const tools = getToolsForAgentKind(sessionState.agentKind);

    const MAX_TOOL_ROUNDS = 24;
    for (let step = 0; step < MAX_TOOL_ROUNDS; step += 1) {
      if (controller.signal.aborted) {
        throw toAbortedError();
      }
      resetIdleTimer();

      const systemPrompt = buildSystemPromptForSession(
        store,
        sessionState,
        input.activeModelCode,
        effectiveLocale,
      );
      const context: Context = {
        systemPrompt,
        messages: piMessages,
        tools,
      };

      const eventStream = built.models.streamSimple(built.selectedModel, context, {
        signal: controller.signal,
        timeoutMs: stepTimeoutMs,
        temperature: 0.2,
        maxTokens: 8192,
      });

      let finalMessage: AssistantMessage | undefined;
      const announcedToolCallIds = new Set<string>();

      for await (const ev of eventStream) {
        if (ev.type !== 'error') {
          resetIdleTimer();
        }

        if (ev.type === 'thinking_delta') {
          accumulatedThinking += ev.delta;
          yield {
            id: nextEventId(),
            event: 'thinking_delta',
            data: { step: step + 1, delta: ev.delta },
          };
        } else if (ev.type === 'text_delta') {
          accumulatedText += ev.delta;
          yield {
            id: nextEventId(),
            event: 'delta',
            data: { step: step + 1, text: ev.delta },
          };
        } else if (
          ev.type === 'toolcall_start' ||
          ev.type === 'toolcall_delta' ||
          ev.type === 'toolcall_end'
        ) {
          const candidate =
            ev.type === 'toolcall_end'
              ? ev.toolCall
              : ev.partial.content[ev.contentIndex];
          if (
            candidate &&
            candidate.type === 'toolCall' &&
            candidate.id &&
            candidate.name &&
            !announcedToolCallIds.has(candidate.id)
          ) {
            announcedToolCallIds.add(candidate.id);
            yield {
              id: nextEventId(),
              event: 'tool_call',
              data: {
                id: candidate.id,
                toolName: candidate.name,
                arguments: (candidate.arguments ?? {}) as Record<string, unknown>,
                step: step + 1,
              },
            };
          }
        } else if (ev.type === 'done') {
          finalMessage = ev.message;
        } else if (ev.type === 'error') {
          if (controller.signal.aborted) {
            throw toAbortedError();
          }
          const errText =
            ev.error.errorMessage ||
            pickLocaleText(
              effectiveLocale,
              `网关流式请求失败 (reason=${ev.reason})`,
              `Gateway streaming request failed (reason=${ev.reason})`,
            );
          if (ev.reason === 'aborted' || /timed?\s*out|timeout/i.test(errText)) {
            throw new SessionStreamAbortedError(
              'IDLE_TIMEOUT',
              pickLocaleText(
                effectiveLocale,
                `大模型单步推理超时（超过 ${Math.round(stepTimeoutMs / 1000)} 秒）`,
                `LLM single-step inference timed out (exceeded ${Math.round(stepTimeoutMs / 1000)}s)`,
              ),
            );
          }
          throw new LlmGatewayError({
            message: errText,
            providerName: built.providerConfig?.name ?? built.providerLabel,
            baseUrl: built.providerConfig?.baseUrl ?? built.selectedModel.baseUrl,
            model: built.selectedModel.id,
            locale: effectiveLocale,
          });
        }
      }

      if (!finalMessage) {
        break;
      }

      totalInputTokens += finalMessage.usage?.input ?? 0;
      totalOutputTokens += finalMessage.usage?.output ?? 0;
      piMessages.push(finalMessage);

      const toolCalls = finalMessage.content.filter(
        (block): block is ToolCall => block.type === 'toolCall',
      );

      if (toolCalls.length === 0) {
        break;
      }

      for (const tc of toolCalls) {
        if (controller.signal.aborted) {
          throw toAbortedError();
        }
        resetIdleTimer();
        yield {
          id: nextEventId(),
          event: 'tool_call',
          data: {
            id: tc.id,
            toolName: tc.name,
            arguments: tc.arguments as Record<string, unknown>,
            step: step + 1,
          },
        };

        const executed = executeUnifiedToolCall(
          store,
          sessionState,
          tc,
          hadValidatorError,
          effectiveLocale,
        );
        if (executed.isError) {
          hadValidatorError = true;
        }
        allToolTraces.push(executed.trace);

        yield {
          id: nextEventId(),
          event: 'tool_result',
          data: {
            trace: executed.trace,
            step: step + 1,
          },
        };

        if (executed.artifact) {
          allArtifacts.push(executed.artifact);
          yield {
            id: nextEventId(),
            event: 'artifact',
            data: {
              artifact: executed.artifact,
            },
          };
        }

        if (executed.askUserPrompt) {
          pendingAskUser = executed.askUserPrompt;
          yield {
            id: nextEventId(),
            event: 'ask_user',
            data: {
              askUser: executed.askUserPrompt,
            },
          };
        }

        const toolResultMsg: ToolResultMessage<JsonObject> = {
          role: 'toolResult',
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: 'text', text: executed.toolResultContent }],
          isError: executed.isError,
          timestamp: Date.now(),
        };
        piMessages.push(toolResultMsg);
      }

      if (pendingAskUser) {
        if (!accumulatedText.trim()) {
          const defaultHeader = pickLocaleText(
            effectiveLocale,
            '业务决策选项',
            'Business Decision Options',
          );
          accumulatedText = pickLocaleText(
            effectiveLocale,
            `请先在下方确认 **${pendingAskUser.header ?? defaultHeader}**，确认后我将立即继续执行。`,
            `Please confirm **${pendingAskUser.header ?? defaultHeader}** below so I can proceed immediately.`,
          );
          yield {
            id: nextEventId(),
            event: 'delta',
            data: { step: step + 1, text: accumulatedText },
          };
        }
        break;
      }
    }

    if (!accumulatedText.trim() && allToolTraces.length > 0) {
      const sep = effectiveLocale === 'en-US' ? ': ' : '：';
      accumulatedText = allToolTraces.map((t) => `- **${t.toolName}**${sep}${t.output}`).join('\n');
      yield {
        id: nextEventId(),
        event: 'delta',
        data: { step: 1, text: accumulatedText },
      };
    }

    const assistantRecord: AgentSessionMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: accumulatedText,
      ...(accumulatedThinking
        ? { thinking: accumulatedThinking, thinkingDurationMs: Date.now() - turnStartMs }
        : {}),
      ...(allToolTraces.length > 0 ? { toolCalls: allToolTraces } : {}),
      ...(pendingAskUser ? { askUser: pendingAskUser } : {}),
      ...(allArtifacts.length > 0 ? { artifacts: allArtifacts } : {}),
      ...(usedVisionFallback
        ? {
            visionFallbackUsed: true,
            ...(activeVisionFallbackNotice
              ? { visionFallbackNotice: activeVisionFallbackNotice }
              : {}),
          }
        : {}),
      modelUsed: built.selectedModel.id,
      providerName: built.providerLabel,
      timestamp: new Date().toISOString(),
    };

    const updatedPriorMessages =
      usedVisionFallback && currentTurnUserMsgId
        ? sessionState.messages.map((m) =>
            m.id === currentTurnUserMsgId
              ? {
                  ...m,
                  visionFallbackUsed: true,
                  ...(activeVisionFallbackNotice
                    ? { visionFallbackNotice: activeVisionFallbackNotice }
                    : {}),
                }
              : m,
          )
        : sessionState.messages;

    const nextMessages = [...updatedPriorMessages, assistantRecord];
    const finalStatus: AgentSession['status'] = pendingAskUser ? 'WAITING_INPUT' : 'IDLE';
    const completedSession: AgentSession = {
      ...sessionState,
      status: finalStatus,
      messages: nextMessages,
      updatedAt: new Date().toISOString(),
    };
    const estTotal =
      totalInputTokens + totalOutputTokens > 0
        ? totalInputTokens + totalOutputTokens
        : estimateSessionTokens(completedSession);
    completedSession.tokenUsage = {
      inputTokens: totalInputTokens || Math.floor(estTotal * 0.65),
      outputTokens: totalOutputTokens || Math.ceil(estTotal * 0.35),
      totalTokens: estTotal,
    };

    sessionState = store.saveAgentSession(completedSession);

    void durableMemoryStorage;
    if (typeof store.saveAgentCheckpoint === 'function') {
      try {
        store.saveAgentCheckpoint(
          sessionState.id,
          `PI_UNIFIED_${sessionState.agentKind}`,
          JSON.stringify({
            sessionId: sessionState.id,
            status: sessionState.status,
            messageCount: sessionState.messages.length,
            toolCallsCount: allToolTraces.length,
            updatedAt: sessionState.updatedAt,
          }),
        );
      } catch {
        // Non-fatal in read-only edge contexts
      }
    }

    yield {
      id: nextEventId(),
      event: 'usage',
      data: {
        tokenUsage: sessionState.tokenUsage,
        providerName: built.providerLabel,
        modelUsed: built.selectedModel.id,
      },
    };

    yield {
      id: nextEventId(),
      event: 'message_end',
      data: {
        session: sessionState,
        project: store.getProject(sessionState.projectId),
      },
    };
  } catch (err) {
    const currentActive = activeSessionAbortControllers.get(existing.id);
    const supersededByNewTurn = Boolean(currentActive && currentActive !== controller);
    if (
      supersededByNewTurn ||
      (err instanceof SessionStreamAbortedError && err.kind === 'STEER_SUPERSEDED')
    ) {
      return;
    }

    const hasPartialProgress = Boolean(
      accumulatedText.trim() ||
        accumulatedThinking.trim() ||
        allToolTraces.length > 0 ||
        allArtifacts.length > 0 ||
        pendingAskUser,
    );

    if (
      err instanceof SessionStreamAbortedError &&
      (err.kind === 'USER_ABORT' || err.kind === 'CLIENT_DISCONNECT')
    ) {
      const partialMessages = hasPartialProgress
        ? [
            ...sessionState.messages,
            {
              id: assistantMsgId,
              role: 'assistant' as const,
              content: accumulatedText,
              ...(accumulatedThinking
                ? {
                    thinking: accumulatedThinking,
                    thinkingDurationMs: Date.now() - turnStartMs,
                  }
                : {}),
              ...(allToolTraces.length > 0 ? { toolCalls: allToolTraces } : {}),
              ...(pendingAskUser ? { askUser: pendingAskUser } : {}),
              ...(allArtifacts.length > 0 ? { artifacts: allArtifacts } : {}),
              ...(built
                ? {
                    modelUsed: built.selectedModel.id,
                    providerName: built.providerLabel,
                  }
                : {}),
              timestamp: new Date().toISOString(),
            },
          ]
        : sessionState.messages;

      sessionState = store.saveAgentSession({
        ...sessionState,
        status: 'IDLE',
        messages: partialMessages,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    const isGatewayErr = err instanceof LlmGatewayError;
    const isTimeoutErr =
      err instanceof SessionStreamAbortedError && err.kind === 'IDLE_TIMEOUT';
    const errMsg = err instanceof Error ? err.message : String(err);
    const resolvedProviderName =
      built?.providerConfig?.name ?? built?.providerLabel ?? sessionState.modelOverride;

    const diagnostic: NonNullable<AgentSessionMessage['errorDiagnostic']> = isGatewayErr
      ? err.toDiagnostic(effectiveLocale)
      : isTimeoutErr
        ? {
            code: 'LLM_TIMEOUT',
            ...(resolvedProviderName ? { providerName: resolvedProviderName } : {}),
            ...(built
              ? {
                  baseUrl: built.providerConfig?.baseUrl ?? built.selectedModel.baseUrl,
                }
              : {}),
            message: err.message,
            remediation: pickLocaleText(
              effectiveLocale,
              '当前推理模型思考或生成耗时较长。可点击「重试 / 继续推演」恢复，或在底部切换响应更快的模型网关。',
              'The model took too long to think or respond. Click "Retry / Continue" to resume, or switch to a faster provider/model below.',
            ),
          }
        : {
            code: 'AGENT_RUNTIME_ERROR',
            ...(resolvedProviderName ? { providerName: resolvedProviderName } : {}),
            message: errMsg,
            remediation: pickLocaleText(
              effectiveLocale,
              '可点击「重试 / 继续推演」恢复，或检查 LLM 中心配置。',
              'Click "Retry / Continue" to resume, or inspect your gateway configuration in LLM Center.',
            ),
          };

    const errorAssistantMsg: AgentSessionMessage = {
      id: `amsg-${Date.now().toString(36)}-err`,
      role: 'assistant',
      content: accumulatedText,
      ...(accumulatedThinking
        ? { thinking: accumulatedThinking, thinkingDurationMs: Date.now() - turnStartMs }
        : {}),
      ...(allToolTraces.length > 0 ? { toolCalls: allToolTraces } : {}),
      ...(pendingAskUser ? { askUser: pendingAskUser } : {}),
      ...(allArtifacts.length > 0 ? { artifacts: allArtifacts } : {}),
      ...(built
        ? { modelUsed: built.selectedModel.id, providerName: built.providerLabel }
        : {}),
      errorDiagnostic: diagnostic,
      timestamp: new Date().toISOString(),
    };

    sessionState = store.saveAgentSession({
      ...sessionState,
      status: isGatewayErr ? 'ERROR' : 'IDLE',
      messages: [...sessionState.messages, errorAssistantMsg],
      updatedAt: new Date().toISOString(),
    });

    yield {
      id: nextEventId(),
      event: 'run_error',
      data: {
        diagnostic: errorAssistantMsg.errorDiagnostic,
        session: sessionState,
      },
    };
  } finally {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
    }
    if (input.signal) {
      input.signal.removeEventListener('abort', abortFromClient);
    }
    if (activeSessionAbortControllers.get(existing.id) === controller) {
      activeSessionAbortControllers.delete(existing.id);
    }
  }
}

export async function collectUnifiedAgentTurn(
  store: WorkspaceStore,
  input: UnifiedAgentStreamInput,
): Promise<{
  events: UnifiedAgentSseEvent[];
  session: AgentSession;
}> {
  const events: UnifiedAgentSseEvent[] = [];
  for await (const ev of runUnifiedAgentSessionStream(store, input)) {
    events.push(ev);
  }
  const session = store.getAgentSession(input.sessionId)!;
  return { events, session };
}
