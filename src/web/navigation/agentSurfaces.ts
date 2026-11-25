import {
  BUSINESS_VOCABULARY,
  type ProjectStepId,
} from '../../packages/business-vocabulary/index.js';
import type { ModelCode } from '../../packages/ontology-core/index.js';
import type {
  AgentDomainArtifact,
  AgentSessionKind,
} from '../../packages/workspace-store/index.js';
import {
  getProjectStepForView,
  resolveLegacyDeliveryTechTab,
  type CanonicalNavViewId,
  type DeliveryTechTab,
  type NavViewId,
} from './catalog.js';
import type { StepViewMode } from './stepViewMode.js';

export interface AgentSurfaceLocalizedText {
  zh: string;
  en: string;
}

export const AI_ASSISTANT_TITLE: AgentSurfaceLocalizedText = {
  zh: BUSINESS_VOCABULARY.AI_ASSISTANT.zh,
  en: BUSINESS_VOCABULARY.AI_ASSISTANT.en,
};

export interface AgentPanelSurface {
  /** User-facing title of the conversational counterpart (always `AI 助手` / `AI Assistant`). */
  title: AgentSurfaceLocalizedText;
  /** Optional contextual subtitle explaining what the AI Assistant handles in this view. */
  subtitle?: AgentSurfaceLocalizedText;
  /** Specialist AgentSessionKind bound to this view (ADR 0009). */
  sessionKind: AgentSessionKind;
  /** Whether this view's specialist uses visual references/uploads and should warn if vision is unsupported. */
  usesVision?: boolean;
  /** Whether conversation is the primary workflow on this page (auto-reveals Wide Mode). */
  conversationPrimary?: boolean;
  /** Contextual composer placeholder for this view. */
  placeholder?: AgentSurfaceLocalizedText;
  /** One-click openers offered while the conversation is still empty. */
  starters?: AgentSurfaceLocalizedText[];
}

export const STEP_SPECIALIST_AGENT_KINDS: Readonly<Record<ProjectStepId, AgentSessionKind>> = {
  REQUIREMENTS: 'REQUIREMENT',
  PROTOTYPE: 'PROTOTYPE_CO_DESIGN',
  BUSINESS_MODEL: 'COPILOT',
  DELIVERY: 'CODING',
};

const REQUIREMENTS_AGENT_SURFACE: AgentPanelSurface = {
  title: AI_ASSISTANT_TITLE,
  sessionKind: 'REQUIREMENT',
  conversationPrimary: true,
  placeholder: {
    zh: '描述想做的系统、参与角色或需要修改的需求（Enter 发送，Shift+Enter 换行）…',
    en: 'Describe your system, roles, or requirement updates (Enter to send)…',
  },
  starters: [
    {
      zh: '梳理核心业务对象、关键状态流转与审批准入条件',
      en: 'Identify core business objects, lifecycles, and approval rules',
    },
    {
      zh: '识别跨系统协作、对外接口与异常补偿方式',
      en: 'Clarify cross-system integrations, external interfaces, and compensations',
    },
    {
      zh: '核对当前尚未明确的业务边界并给出可点选方案',
      en: 'Review open business questions and propose selectable options',
    },
  ],
};

/**
 * Every workbench view presents the single `AI 助手` / `AI Assistant` in the UI
 * while binding to its owning specialist `AgentSessionKind` underneath (ADR 0009, amended).
 */
export const AGENT_PANEL_SURFACES: Record<NavViewId, AgentPanelSurface> = {
  overview: {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问项目进展或发起下一步操作…',
      en: 'Ask about project progress or start the next action…',
    },
  },
  // The console's own assistant (asking for figures, approved actions) arrives in milestone M3;
  // until then the console is not given an Agent Panel (App.tsx renders none for it).
  'operations-console': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问经营情况…',
      en: 'Ask how the business is doing…',
    },
  },
  'app-requirements': REQUIREMENTS_AGENT_SURFACE,
  'app-prototype': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'PROTOTYPE_CO_DESIGN',
    usesVision: true,
    placeholder: {
      zh: '输入局部精修指令（Enter 发送，Shift+Enter 换行）…',
      en: 'Describe a prototype refinement (Enter to send, Shift+Enter for newline)…',
    },
  },
  'app-ontology': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '描述你想新增或修改的业务对象、业务操作或业务规则…',
      en: 'Describe a business object, action, or rule to add or refine…',
    },
  },
  'app-model-files': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问模型文件结构或处理需要修正的问题…',
      en: 'Inspect model files or resolve problems to fix…',
    },
  },
  'app-knowledge-graph': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问业务对象之间的关联、链路影响或补充关系…',
      en: 'Explore cross-object relationships, impact paths, or links…',
    },
  },
  'app-four-layer-assets': {
    title: AI_ASSISTANT_TITLE,
    subtitle: {
      zh: '编写与维护开发规范',
      en: 'Authoring development standards',
    },
    sessionKind: 'ARCHITECTURE',
    placeholder: {
      zh: '编写或完善可复用的界面、技术底座与技术架构规范…',
      en: 'Author or refine reusable UI, foundation, and architecture standards…',
    },
  },
  'app-assembly-dev': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'CODING',
    placeholder: {
      zh: '检查当前应用的输入缺项与冲突，完善实施规格和验收条件…',
      en: 'Inspect this application’s missing inputs and conflicts, or refine its implementation specification…',
    },
  },
  'app-skills': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'CODING',
    placeholder: {
      zh: '围绕当前项目的本体技能与交付物提出优化或核对问题…',
      en: 'Refine or inspect ontology skills and deliverables for this project…',
    },
  },
  'app-publish': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'CODING',
    placeholder: {
      zh: '检查当前应用的资料包输入与验收条件…',
      en: 'Inspect this application’s package inputs and acceptance criteria…',
    },
  },
  'cap-systems': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '询问存量系统接入方式、数据连接配置或发起本体萃取…',
      en: 'Ask about existing system connectors or ontology extraction…',
    },
  },
  'cap-extraction': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '解析存量系统结构萃取候选条目，或询问候选确认建议…',
      en: 'Extract ontology candidates from existing system sources or review alignment…',
    },
  },
  'cap-mcp': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '查看由业务模型发布的服务能力与工具定义…',
      en: 'Inspect published capability tools and resource definitions…',
    },
  },
  'cap-agents': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'CAPABILITY',
    conversationPrimary: true,
    placeholder: {
      zh: '输入业务指令以调用已挂载的服务能力与本体技能（Enter 发送）…',
      en: 'Send a business request using mounted capabilities and ontology skills…',
    },
  },
  'cap-cross-flows': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '梳理跨系统事件协同、调用顺序与异常补偿规则…',
      en: 'Design cross-system event coordination and compensation rules…',
    },
  },
  'cap-knowledge': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'CAPABILITY',
    placeholder: {
      zh: '结合领域知识条目进行检索与问答…',
      en: 'Query domain knowledge entries and business context…',
    },
  },
  'data-resources': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '分析数据表结构、字段约定或对齐业务对象…',
      en: 'Inspect table structures, metadata conventions, or business object alignment…',
    },
  },
  'data-mappings': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '核对业务对象属性与底层表字段之间的存储映射…',
      en: 'Verify storage mappings between business object fields and physical columns…',
    },
  },
  'data-metrics-reports': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'REASONING',
    placeholder: {
      zh: '输入指标异动追问或多维归因分析问题…',
      en: 'Ask about metric anomalies or multi-dimensional attribution…',
    },
  },
  'data-reasoning': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'REASONING',
    conversationPrimary: true,
    placeholder: {
      zh: '输入问数 / 问因 / 问策问题（结合业务对象、业务规则与策略回写）…',
      en: 'Ask Data / Why / Policy questions grounded in business objects, rules, and write-backs…',
    },
  },
  'data-writeback': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'REASONING',
    placeholder: {
      zh: '推演策略回写动作的影响范围并核对执行条件…',
      en: 'Evaluate policy write-back impact and execution conditions…',
    },
  },
  'llm-center': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问模型服务配置、多模态视觉支持或连接测试建议…',
      en: 'Ask about model gateway configuration, vision support, or connection checks…',
    },
  },
  'system-settings': {
    title: AI_ASSISTANT_TITLE,
    sessionKind: 'COPILOT',
    placeholder: {
      zh: '询问工作台设置、离线演示模式或项目治理约定…',
      en: 'Ask about workbench settings, demo mock mode, or governance conventions…',
    },
  },
};

export function agentPanelSurfaceFor(view: NavViewId): AgentPanelSurface {
  return AGENT_PANEL_SURFACES[view];
}

export function resolveWorkspaceAgentSurface(
  view: NavViewId,
  options?: {
    deliveryViewMode?: StepViewMode;
    deliveryTechTab?: DeliveryTechTab;
  },
): AgentPanelSurface {
  const legacyDeliveryTab = resolveLegacyDeliveryTechTab(view);
  if (legacyDeliveryTab === 'standards') {
    return AGENT_PANEL_SURFACES['app-four-layer-assets'];
  }
  if (getProjectStepForView(view) === 'DELIVERY') {
    const effectiveMode: StepViewMode = legacyDeliveryTab
      ? 'technical'
      : (options?.deliveryViewMode ?? 'business');
    const effectiveTab: DeliveryTechTab =
      legacyDeliveryTab ?? options?.deliveryTechTab ?? 'assembly';
    if (effectiveMode === 'technical' && effectiveTab === 'standards') {
      return AGENT_PANEL_SURFACES['app-four-layer-assets'];
    }
    return AGENT_PANEL_SURFACES['app-assembly-dev'];
  }
  return AGENT_PANEL_SURFACES[view];
}

export function defaultNavForSessionKind(kind: AgentSessionKind): CanonicalNavViewId {
  switch (kind) {
    case 'REQUIREMENT':
      return 'app-requirements';
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
  view: CanonicalNavViewId;
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
      return { view: 'app-requirements', itemId: artifact.docId };
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
