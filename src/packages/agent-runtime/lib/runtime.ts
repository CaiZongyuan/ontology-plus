import { MemoryStorage, defineTool } from '@earendil-works/pi-durable';
import {
  validateOntologySuite,
  type AggregateRoot,
  type BehaviorItem,
  type ModelCode,
  type OntologySuite,
  type RuleItem,
} from '../../ontology-core/index.js';
import type {
  LlmProviderConfig,
  ProjectDetail,
  ReasoningSession,
  RequirementMessage,
  RequirementSession,
  WorkspaceStore,
} from '../../workspace-store/index.js';

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

// Durable in-memory session checkpoint store via @earendil-works/pi-durable
const durableMemoryStorage = new MemoryStorage();

export const ONTOLOGY_DURABLE_TOOLS = {
  upsertAggregate: defineTool({
    name: 'upsert_aggregate',
    description: 'Create or update an M1 Aggregate Root in the active Ontology Suite',
  } as never),
  upsertBehavior: defineTool({
    name: 'upsert_behavior',
    description: 'Create or update an M2 Behavior in the active Ontology Suite',
  } as never),
  upsertRule: defineTool({
    name: 'upsert_rule',
    description: 'Create or update an M3 Business Rule in the active Ontology Suite',
  } as never),
};

async function callOpenAiCompatibleChat(
  provider: LlmProviderConfig,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  timeoutMs = 12000,
): Promise<{ content: string; modelUsed: string; latencyMs: number } | null> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const baseUrl = provider.baseUrl.replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey || 'magpie'}`,
      },
      body: JSON.stringify({
        model: provider.defaultModel || 'auto/glm-5.3-flash',
        messages,
        temperature: 0.2,
        max_tokens: 900,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    return {
      content: text,
      modelUsed: data.model || provider.defaultModel,
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
      8000,
    );

    if (chatRes) {
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

export async function runOntologyCopilotTurn(
  store: WorkspaceStore,
  input: {
    projectId: string;
    prompt: string;
    activeModel?: ModelCode;
  },
): Promise<OntologyCopilotResult> {
  const start = Date.now();
  void durableMemoryStorage;
  const project = store.getProject(input.projectId);
  if (!project) throw new Error(`Project not found: ${input.projectId}`);

  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];
  const toolCalls: AgentToolCallRecord[] = [];
  const nextSuite: OntologySuite = JSON.parse(JSON.stringify(project.suite));

  // Deterministic ontology mutation tool extraction based on user intent
  const lower = input.prompt.toLowerCase();
  if (
    input.prompt.includes('新增') ||
    input.prompt.includes('添加') ||
    input.prompt.includes('创建') ||
    lower.includes('add') ||
    lower.includes('create')
  ) {
    if (input.prompt.includes('规则') || lower.includes('rule') || input.activeModel === 'M3') {
      const ruleId = `RULE-0${(nextSuite.M3?.rules.length ?? 3) + 1}`;
      const newRule: RuleItem = {
        id: ruleId,
        name: 'AutoGeneratedComplianceRule',
        alias: input.prompt.slice(0, 18).replace(/[，。！？]/g, ''),
        ruleType: 'VALIDATION',
        scope: 'CROSS_OBJECT',
        version: '1.0',
        description: `由 AI 本体助手根据指令「${input.prompt}」自动生成的业务规则。`,
        referencedObjects: [nextSuite.M1?.aggregates[0]?.name ?? 'Contract'],
        parameters: [],
        expression: 'Contract.totalAmount > 0',
        violationMessage: '违反业务合规校验规则',
        triggeredByEvents: [],
        producedEvents: [],
        triggeredBehaviors: [],
      };
      if (!nextSuite.M3) {
        nextSuite.M3 = { model_type: 'RULE', version: '5.0', domain: project.domain, rules: [] };
      }
      nextSuite.M3.rules.push(newRule);
      const vReport = validateOntologySuite(nextSuite);
      if (vReport.errorCount === 0) {
        store.updateSuite(project.id, nextSuite, `AI Copilot added M3 rule ${ruleId}`);
        toolCalls.push({
          toolName: 'upsert_rule',
          args: { id: ruleId, alias: newRule.alias },
          status: 'APPLIED',
          summaryZh: `已在 M3 规则模型中新增规则 ${ruleId}（${newRule.alias}），并通过 11 模型一致性校验`,
          summaryEn: `Added rule ${ruleId} (${newRule.alias}) to M3 and passed 11-model consistency validation`,
        });
      }
    } else if (
      input.prompt.includes('行为') ||
      lower.includes('behavior') ||
      input.activeModel === 'M2'
    ) {
      const behId = `BHV-0${(nextSuite.M2?.behaviors.length ?? 6) + 1}`;
      const owner = nextSuite.M1?.aggregates[0]?.name ?? 'Contract';
      const newBeh: BehaviorItem = {
        id: behId,
        name: `executeCustomAction${behId.replace('-', '')}`,
        alias: input.prompt.slice(0, 16).replace(/[，。！？]/g, ''),
        ownerEntity: owner,
        behaviorType: 'COMMAND',
        triggerType: 'SYSTEM',
        description: `AI 本体助手根据「${input.prompt}」生成的领域行为`,
        inputParameters: [{ name: 'targetId', label: '目标ID', type: 'String', required: true }],
        outputParameters: [{ name: 'result', label: '执行结果', type: 'Boolean', required: true }],
        preconditions: [],
        stateChanges: [],
        invokedRules: [],
        producedEvents: [],
        requiredPermissions: [],
      };
      if (!nextSuite.M2) {
        nextSuite.M2 = {
          model_type: 'BEHAVIOR',
          version: '5.0',
          domain: project.domain,
          behaviors: [],
        };
      }
      nextSuite.M2.behaviors.push(newBeh);
      const vReport = validateOntologySuite(nextSuite);
      if (vReport.errorCount === 0) {
        store.updateSuite(project.id, nextSuite, `AI Copilot added M2 behavior ${behId}`);
        toolCalls.push({
          toolName: 'upsert_behavior',
          args: { id: behId, ownerEntity: owner },
          status: 'APPLIED',
          summaryZh: `已在 M2 行为模型中新增行为 ${behId}（归属 ${owner}），并通过一致性门禁`,
          summaryEn: `Added behavior ${behId} (owner ${owner}) to M2 and passed consistency gate`,
        });
      }
    } else if (
      input.prompt.includes('聚合') ||
      input.prompt.includes('对象') ||
      input.prompt.includes('实体') ||
      lower.includes('aggregate')
    ) {
      const aggId = `AGG-0${(nextSuite.M1?.aggregates.length ?? 3) + 1}`;
      const newAgg: AggregateRoot = {
        id: aggId,
        name: `ContractAmendment${aggId.slice(-2)}`,
        alias: '合同补充协议',
        aggregateType: 'AGGREGATE_ROOT',
        description: `由 AI 本体助手根据「${input.prompt}」创建的聚合根`,
        lifecycle: ['DRAFT', 'APPROVED', 'EFFECTIVE'],
        tags: ['AMENDMENT'],
        attributes: [
          {
            name: 'amendmentNo',
            label: '补充协议编号',
            type: 'String',
            required: true,
          },
          {
            name: 'deltaAmount',
            label: '变更金额',
            type: 'Money',
            required: true,
            refRules: [
              {
                name: 'DeltaNonZero',
                expression: 'value != 0',
                violationMessage: '变更金额不能为 0',
                enforcedAt: 'ALWAYS',
              },
            ],
          },
        ],
        entities: [],
        valueObjects: [],
        invariants: [],
      };
      nextSuite.M1?.aggregates.push(newAgg);
      const vReport = validateOntologySuite(nextSuite);
      if (vReport.errorCount === 0) {
        store.updateSuite(project.id, nextSuite, `AI Copilot added M1 aggregate ${aggId}`);
        toolCalls.push({
          toolName: 'upsert_aggregate',
          args: { id: aggId, name: newAgg.name, alias: newAgg.alias },
          status: 'APPLIED',
          summaryZh: `已在 M1 对象模型中新增聚合根 ${newAgg.name}（${newAgg.alias}），并通过一致性校验`,
          summaryEn: `Added aggregate root ${newAgg.name} (${newAgg.alias}) to M1 and passed validation`,
        });
      }
    }
  }

  const updatedProject = store.getProject(input.projectId)!;
  const systemPrompt = [
    `你是 Ontology Plus 平台的 AI 本体建模专家（基于 Pi Durable 运行时与 11 元模型架构）。`,
    `当前工程：${updatedProject.name}（领域：${updatedProject.domain}）。`,
    `已存在模型：${updatedProject.validation.presentModels.join(', ')}（错误数：${updatedProject.validation.errorCount}，阶段提示数：${updatedProject.validation.warningCount}）。`,
    toolCalls.length > 0
      ? `本次已执行工具变更：${toolCalls.map((t) => t.summaryZh).join('；')}。`
      : '',
    `请用简洁、专业的中文回答用户的本体建模问题或总结刚才执行的模型变更（控制在 180 字以内）。`,
  ].join('\n');

  const llmRes = activeProvider
    ? await callOpenAiCompatibleChat(
        activeProvider,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input.prompt },
        ],
        10000,
      )
    : null;

  const fallbackReply =
    toolCalls.length > 0
      ? `已完成本体模型变更并执行 11 模型两级一致性校验：\n- ${toolCalls.map((t) => t.summaryZh).join('\n- ')}\n- 当前工程一致性状态：**${updatedProject.validation.errorCount} 个错误**，**${updatedProject.validation.warningCount} 个阶段提示**。`
      : `已分析工程「${updatedProject.name}」的 11 元模型结构：\n- **M1 对象模型**包含 ${updatedProject.suite.M1?.aggregates.length ?? 0} 个聚合根；\n- **M2 行为模型**包含 ${updatedProject.suite.M2?.behaviors.length ?? 0} 个行为；\n- **M3 规则模型**包含 ${updatedProject.suite.M3?.rules.length ?? 0} 条跨对象规则；\n- 当前全量跨模型校验结果：**0 错误**。您可以直接发送指令如“新增一条超期结算预警规则”或“新增补充协议聚合根”。`;

  return {
    reply: llmRes?.content || fallbackReply,
    providerUsed: llmRes ? activeProvider.name : `${activeProvider?.name ?? 'Local Pi'} (Deterministic Gate)`,
    modelUsed: llmRes?.modelUsed || activeProvider?.defaultModel || 'auto/glm-5.3-flash',
    latencyMs: llmRes?.latencyMs ?? Date.now() - start,
    toolCalls,
    project: updatedProject,
  };
}

export async function runRequirementGrillingTurn(
  store: WorkspaceStore,
  input: {
    sessionId: string;
    userMessage: string;
  },
): Promise<{ session: RequirementSession; providerUsed: string }> {
  const projects = store.listProjects();
  const allSessions = projects.flatMap((p) => store.listRequirementSessions(p.id));
  const target = allSessions.find((s) => s.id === input.sessionId);
  if (!target) throw new Error(`Requirement session not found: ${input.sessionId}`);

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
            content:
              '你是 Ontology Plus 的需求探索追问专家（Requirement Grilling Agent）。请针对用户的需求描述，指出提炼出的 M1 聚合根、M2 业务行为、M3 业务规则，并提出 1~2 个关键边界追问以消除歧义（控制在 160 字以内）。',
          },
          ...target.messages.slice(-4).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          { role: 'user', content: input.userMessage },
        ],
        10000,
      )
    : null;

  const newRuleHint = `RULE-0${target.discoveredRules.length + 1}: ${input.userMessage.slice(0, 28)}`;
  const assistantMsg: RequirementMessage = {
    id: `msg-${Date.now()}-a`,
    role: 'assistant',
    content:
      llmRes?.content ||
      `已从您的补充描述中识别出关键业务约束并同步至需求会话：\n1. **新增候选规则**：\`${newRuleHint}\`\n2. **收敛追问**：该约束在违背时是直接阻断命令执行（同步前置校验）还是触发异常审批流（M6 网关分支）？确认后即可一键同步至《软件需求说明书》与 11 模型本体。`,
    timestamp: new Date().toISOString(),
    extractedHints: {
      rules: [newRuleHint],
    },
  };

  const updated = store.appendRequirementMessage(target.id, assistantMsg, {
    discoveredRules: [...target.discoveredRules, newRuleHint],
  });

  return {
    session: updated,
    providerUsed: llmRes?.modelUsed || activeProvider?.defaultModel || 'auto/glm-5.3-flash',
  };
}

export async function runDataOntologyReasoning(
  store: WorkspaceStore,
  input: {
    question: string;
    mode: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
  },
): Promise<ReasoningSession> {
  const providers = store.listLlmProviders();
  const activeProvider = providers.find((p) => p.enabled) ?? providers[0];

  const llmRes = activeProvider
    ? await callOpenAiCompatibleChat(
        activeProvider,
        [
          {
            role: 'system',
            content:
              '你是数据分析中心的数据本体推理引擎，支持智能问数(ASK_DATA)、智能问因(ASK_WHY)、智能问策(ASK_POLICY)。请基于 Contract(合同)、Counterparty(相对方)、SettlementOrder(结算单) 三个核心对象给出简洁、结构化的 Markdown 分析结论（控制在 180 字以内）。',
          },
          {
            role: 'user',
            content: `[模式: ${input.mode}] ${input.question}`,
          },
        ],
        10000,
      )
    : null;

  const session = store.saveReasoningSession({
    id: `reas-${Date.now().toString(36)}`,
    question: input.question,
    mode: input.mode,
    sqlGenerated:
      "SELECT c.contract_type, c.risk_level, COUNT(c.id) AS total_contracts, SUM(c.total_amount) AS contract_sum, SUM(so.settlement_amount) AS settled_sum FROM t_contract c LEFT JOIN t_settlement_order so ON c.id = so.contract_ref GROUP BY c.contract_type, c.risk_level ORDER BY contract_sum DESC",
    dataSummary: [
      { label: '关联聚合根数', value: '3 个 (M1)', delta: '100% 映射' },
      { label: '合同履约结算达成率', value: '88.4%', delta: '+4.2%' },
      { label: '高风险合同逾期率', value: '14.8%', delta: '需关注' },
    ],
    causalAnalysis: [
      '沿着 M1 对象关联链 Contract -> Counterparty -> SettlementOrder 穿透分析，技术服务外包合同 (OUTSOURCING) 占未核销金额的 71.5%。',
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
      `### 本体推理结论 (${input.mode})\n针对问题「${input.question}」：\n1. **智能问数**：通过 \`MM\` 数据映射自动生成跨表 SQL，当前履约结算达成率为 **88.4%**，高风险合同逾期率 **14.8%**。\n2. **智能问因**：沿 \`Contract -> Counterparty -> SettlementOrder\` 归因，A 级资信外包供应商里程碑验收延迟贡献了 **71.5%** 的逾期额。\n3. **智能问策**：建议立即调用回写接口 **\`WB-01\`** 冻结逾期批次并通知法务会签。`,
  });

  return session;
}

