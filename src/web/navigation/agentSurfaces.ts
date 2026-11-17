import type { ModelCode } from '../../packages/ontology-core/index.js';
import type {
  AgentDomainArtifact,
  AgentSessionKind,
} from '../../packages/workspace-store/index.js';
import type { NavViewId } from './catalog.js';

export interface AgentSurfaceLocalizedText {
  zh: string;
  en: string;
}

export interface AgentPanelSurface {
  /** Name of the Agent Session this module shows. */
  title: AgentSurfaceLocalizedText;
  /** Durable Agent Session kind bound to this module's Agent Panel. */
  sessionKind: AgentSessionKind;
  /** Whether this module's agent uses visual references/uploads and should warn if vision is unsupported. */
  usesVision?: boolean;
  /** Whether conversation is the primary workflow on this page (auto-reveals Wide Mode). */
  conversationPrimary?: boolean;
  /** Contextual composer placeholder for this module. */
  placeholder?: AgentSurfaceLocalizedText;
  /** One-click openers offered while the conversation is still empty. */
  starters?: AgentSurfaceLocalizedText[];
}

/**
 * Every workbench view maps to its owning project specialist Agent Session (ADR 0009),
 * so the right-hand ShellAgentPanel stays available across all 24 views.
 */
export const AGENT_PANEL_SURFACES: Record<NavViewId, AgentPanelSurface> = {
  overview: {
    title: { zh: '工程概览与全流程助手', en: 'Project Overview Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问工程阶段进展或发起本体协同操作…',
      en: 'Ask about project lifecycle status or run ontology copilot actions…',
    },
  },
  'app-req-explore': {
    title: { zh: '需求探索与 SRS 合成', en: 'Requirement & SRS Agent' },
    sessionKind: 'REQUIREMENT',
    conversationPrimary: true,
    placeholder: {
      zh: '描述业务场景、核心角色或规则阈值（Enter 发送，Shift+Enter 换行）…',
      en: 'Describe domain workflows, roles, or rule thresholds (Enter to send)…',
    },
    starters: [
      {
        zh: '梳理核心业务单据聚合根、关键状态流转与审批准入红线',
        en: 'Identify core domain aggregates, lifecycles, and approval gate rules',
      },
      {
        zh: '识别跨系统数据交换、外部准入接口与异常补偿策略',
        en: 'Clarify cross-system integrations, external credit checks, and compensations',
      },
      {
        zh: '核对当前未决 B 类业务边界并给出推荐决策方案',
        en: 'Review open Class-B business ambiguities and propose options',
      },
    ],
  },
  'app-req-docs': {
    title: { zh: '需求规格合成助手', en: 'SRS Synthesis Agent' },
    sessionKind: 'REQUIREMENT',
    placeholder: {
      zh: '输入需求补充说明或触发九章节 SRS 合成…',
      en: 'Add requirement notes or synthesize the 9-chapter SRS…',
    },
    starters: [
      {
        zh: '检查当前需求规格书还缺哪些章节或验收标准',
        en: 'Review the current SRS for missing chapters or acceptance criteria',
      },
      {
        zh: '把最近确认的业务规则补充进规格书对应章节',
        en: 'Fold the latest confirmed business rules into the SRS',
      },
    ],
  },
  'app-prototype': {
    title: { zh: '原型共创', en: 'Prototype Co-Design' },
    sessionKind: 'PROTOTYPE_CO_DESIGN',
    usesVision: true,
    placeholder: {
      zh: '输入局部精修指令（Enter 发送，Shift+Enter 换行）…',
      en: 'Describe a prototype refinement (Enter to send, Shift+Enter for newline)…',
    },
  },
  'app-ontology': {
    title: { zh: '本体建模与 11 模型合成', en: 'Ontology Copilot & Synthesis' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '输入本体建模指令（如：新增 M3 业务规则或从原型合成 11 模型）…',
      en: 'Describe an ontology change (e.g. upsert M3 rule or synthesize 11-model suite)…',
    },
  },
  'app-model-files': {
    title: { zh: '本体模型文件与校验助手', en: 'Model Files & Validation Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问模型 YAML 契约或修复一致性校验问题…',
      en: 'Inspect YAML contracts or resolve consistency validation findings…',
    },
  },
  'app-knowledge-graph': {
    title: { zh: '本体知识图谱助手', en: 'Knowledge Graph Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问聚合根跨层关联、血缘影响或补充模型映射…',
      en: 'Explore cross-model lineage, impact paths, or ontology links…',
    },
  },
  'app-four-layer-assets': {
    title: { zh: '架构资产智能体', en: 'Architecture Asset Agent' },
    sessionKind: 'ARCHITECTURE',
    placeholder: {
      zh: '编写或完善可复用的 UI、技术底座与技术架构规范…',
      en: 'Author or refine reusable UI, foundation and architecture standards…',
    },
  },
  'app-assembly-dev': {
    title: { zh: '应用开发规格助手', en: 'Application Specification Assistant' },
    sessionKind: 'CODING',
    placeholder: {
      zh: '检查当前应用的输入缺项与冲突，完善实施规格和验收条件…',
      en: 'Inspect this application’s missing inputs and conflicts, or refine its implementation specification…',
    },
  },
  'app-skills': {
    title: { zh: '领域 SKILL 资产助手', en: 'Domain SKILL Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '围绕本体派生 SKILL 指令集提出优化或校验问题…',
      en: 'Refine or inspect ontology-derived SKILL assets…',
    },
  },
  'app-publish': {
    title: { zh: '应用交付规格助手', en: 'Application Delivery Specification Assistant' },
    sessionKind: 'CODING',
    placeholder: {
      zh: '检查当前应用的资料包输入与验收条件…',
      en: 'Inspect this application’s package inputs and acceptance criteria…',
    },
  },
  'cap-systems': {
    title: { zh: '存量系统接入与能力助手', en: 'Legacy Systems Capability Agent' },
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '询问存量系统接入契约、数据源配置或发起能力萃取…',
      en: 'Ask about legacy system contracts, connectors, or capability extraction…',
    },
  },
  'cap-extraction': {
    title: { zh: '存量系统本体萃取智能体', en: 'Ontology Extraction Agent' },
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '解析 DDL / OpenAPI 萃取本体候选，或询问候选对齐策略…',
      en: 'Extract ontology candidates from DDL / OpenAPI or align candidates…',
    },
  },
  'cap-mcp': {
    title: { zh: '本体 MCP 服务助手', en: 'Ontology MCP Capability Agent' },
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '探查本体编译生成的 MCP 工具契约与资源端点…',
      en: 'Inspect compiled Ontology MCP tool schemas and resource endpoints…',
    },
  },
  'cap-agents': {
    title: { zh: '能力智能体对话 (MCP + SKILL)', en: 'Capability Smart Chat (MCP + SKILL)' },
    sessionKind: 'CAPABILITY',
    conversationPrimary: true,
    placeholder: {
      zh: '输入业务指令以调用本体 MCP 工具与领域 SKILL（Enter 发送）…',
      en: 'Send a business query to invoke Ontology MCP tools & SKILL rules…',
    },
  },
  'cap-cross-flows': {
    title: { zh: '跨系统编排能力助手', en: 'Cross-System Flow Agent' },
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '梳理跨系统事件编排、接口调用链与补偿规则…',
      en: 'Design cross-system event orchestration and compensation rules…',
    },
  },
  'cap-knowledge': {
    title: { zh: '领域知识库与能力助手', en: 'Domain Knowledge Agent' },
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '结合领域知识条目与 MCP 能力进行检索问答…',
      en: 'Query domain knowledge entries alongside Ontology MCP capabilities…',
    },
  },
  'data-resources': {
    title: { zh: '数据资源与数据本体助手', en: 'Data Resource Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '分析数据库表结构、元数据约定或发起数据本体抽取…',
      en: 'Inspect database schemas, metadata conventions, or data ontology alignment…',
    },
  },
  'data-mappings': {
    title: { zh: '语义映射与字段对齐助手', en: 'Semantic Mapping Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '检查 M1 聚合属性与物理库表字段之间的 ME/MM 语义映射…',
      en: 'Verify ME/MM semantic mappings between M1 attributes and physical columns…',
    },
  },
  'data-metrics-reports': {
    title: { zh: '指标洞察与场景归因', en: 'Metric Insight & Attribution' },
    sessionKind: 'REASONING',
    placeholder: {
      zh: '输入指标异动追问或多维场景归因指令…',
      en: 'Ask about metric anomalies or multi-dimensional scenario attribution…',
    },
  },
  'data-reasoning': {
    title: { zh: '三段式数据本体推理', en: '3-Stage Data Ontology Reasoning' },
    sessionKind: 'REASONING',
    conversationPrimary: true,
    placeholder: {
      zh: '输入问数 / 问因 / 问策问题（结合 M1 对象关联、M3 规则阈值与回写接口）…',
      en: 'Ask Data / Why / Policy questions grounded in M1 objects, M3 rules & write-backs…',
    },
  },
  'data-writeback': {
    title: { zh: '策略回写与闭环推理助手', en: 'Policy Write-Back Reasoning Agent' },
    sessionKind: 'REASONING',
    placeholder: {
      zh: '推演策略回写动作影响并校验 M7/ME 执行契约…',
      en: 'Evaluate policy write-back impact and M7/ME execution contracts…',
    },
  },
  'llm-center': {
    title: { zh: '模型网关与工作台助手', en: 'LLM Gateway & Workbench Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问网关配置要求、多模态视觉支持或测试建议…',
      en: 'Ask about gateway configuration, vision support, or model routing…',
    },
  },
  'system-settings': {
    title: { zh: '平台治理与工作台助手', en: 'Platform Governance Copilot' },
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问工作区设置、离线演示模式或本体治理规范…',
      en: 'Ask about workspace settings, demo mock mode, or governance rules…',
    },
  },
};

export function agentPanelSurfaceFor(view: NavViewId): AgentPanelSurface {
  return AGENT_PANEL_SURFACES[view];
}

export function defaultNavForSessionKind(kind: AgentSessionKind): NavViewId {
  switch (kind) {
    case 'REQUIREMENT':
      return 'app-req-explore';
    case 'PROTOTYPE_CO_DESIGN':
      return 'app-prototype';
    case 'COPILOT':
      return 'app-ontology';
    case 'ARCHITECTURE':
      return 'app-four-layer-assets';
    case 'CODING':
      return 'app-assembly-dev';
    case 'CAPABILITY':
      return 'cap-agents';
    case 'REASONING':
      return 'data-reasoning';
  }
}

export interface ArtifactNavTarget {
  view: NavViewId;
  itemId?: string;
  prototypeId?: string;
  modelCode?: ModelCode;
  elementId?: string;
}

export function resolveArtifactNavTarget(artifact: AgentDomainArtifact): ArtifactNavTarget | null {
  switch (artifact.kind) {
    case 'PROTOTYPE_REVISION':
      return {
        view: 'app-prototype',
        itemId: artifact.prototypeId,
        prototypeId: artifact.prototypeId,
      };
    case 'REQUIREMENT_DOC':
      return { view: 'app-req-docs', itemId: artifact.docId };
    case 'ONTOLOGY_SUITE':
      return { view: 'app-ontology' };
    case 'ONTOLOGY_DIFF':
      return {
        view: 'app-ontology',
        ...(artifact.modelCode ? { modelCode: artifact.modelCode } : {}),
        ...(artifact.changes[0]?.id ? { elementId: artifact.changes[0].id } : {}),
      };
    case 'TECH_ARCH_ASSET':
      return { view: 'app-four-layer-assets', itemId: artifact.assetId };
    case 'CODING_PACKAGE':
      return { view: 'app-assembly-dev', itemId: artifact.appId };
    case 'METRIC_INSIGHT':
      return { view: 'data-metrics-reports', itemId: artifact.metricId };
    case 'ANALYTICS_REPORT':
      return { view: 'data-metrics-reports', itemId: artifact.reportId };
    case 'REASONING_POLICY':
    case 'SQL_PREVIEW':
      return { view: 'data-reasoning' };
    case 'EXTRACTION_JOB':
      return { view: 'cap-extraction', itemId: artifact.jobId };
    case 'REQUIREMENT_HINTS':
      return null;
  }
}
