import {
  CONTRACT_LIFECYCLE_SUITE,
  CONTRACT_PROTOTYPE_HTML,
  MFT_ENTERPRISE_SUITE,
} from '../../ontology-core/index.js';
import type {
  AnalyticsReport,
  AnalyticsScenario,
  AssembledApplication,
  CapabilityAgent,
  CrossSystemFlow,
  DataDocument,
  DataMappingRule,
  DatabaseResource,
  ExtractionJob,
  FourLayerAsset,
  GeneratedSkill,
  KnowledgeEntry,
  LegacySystemConfig,
  LlmProviderConfig,
  McpServerConfig,
  MetricDefinition,
  PrototypeArtifact,
  ReasoningSession,
  RequirementDoc,
  RequirementSession,
  SystemSettingsState,
  WritebackInterface,
} from './types.js';

export const SEED_PROJECTS = [
  {
    id: 'proj-contract',
    name: '合同全生命周期管理系统',
    code: 'CONTRACT-CLM',
    center: 'APPLICATION' as const,
    domain: '合同全生命周期管理系统',
    description:
      '覆盖合同起草、相对方资信准入、金额分级法务会签、电子签章与首期履约结算联动的全套 11 模型标杆工程。',
    currentStage: 11,
    suite: CONTRACT_LIFECYCLE_SUITE,
    changelog: [
      '# Ontology Change Log - 合同全生命周期管理系统',
      '',
      '## [2026-11-10T09:00:00.000Z] Initial 11-Model Baseline',
      '- Authoring completed for M1, M2, M3, ME, M4, M5, M6, M7, MU, MM, MI.',
      '- Verified 0 consistency errors across all 11 ontology meta-models.',
      '',
    ].join('\n'),
  },
  {
    id: 'proj-mft',
    name: '企业文件安全传输系统 (MFT)',
    code: 'MFT-SEC',
    center: 'CAPABILITY' as const,
    domain: '企业文件安全传输系统 (MFT)',
    description:
      '通过存量系统本体萃取（Ontology Extraction）从既有 MFT 跨网文件传输系统 DDL 与接口规范提炼的领域本体工程。',
    currentStage: 6,
    suite: MFT_ENTERPRISE_SUITE,
    changelog: [
      '# Ontology Change Log - 企业文件安全传输系统 (MFT)',
      '',
      '## [2026-11-10T10:00:00.000Z] Ontology Extraction Baseline',
      '- Extracted M1, M2, M3, ME, M5 from MFT database DDL and OpenAPI 3.0 specification.',
      '',
    ].join('\n'),
  },
];

export const SEED_REQUIREMENT_SESSIONS: RequirementSession[] = [
  {
    id: 'req-sess-contract-01',
    projectId: 'proj-contract',
    title: '商务合同起草、资信准入与多级会签需求探索',
    status: 'CONVERGED',
    discoveredAggregates: ['Contract (合同)', 'Counterparty (签约相对方)', 'SettlementOrder (履约结算单)'],
    discoveredRules: [
      'RULE-01: 超过 100 万元的大额合同仅允许与 AA/AAA 级资信相对方签署',
      'RULE-02: 合同金额 >= 200万自动定级 HIGH，>= 50万定级 MEDIUM，其余 LOW',
      'RULE-03: 同一合同下所有履约结算单累计金额不得超过合同总金额',
    ],
    resolvedDecisions: [
      '采用两级校验：草稿保存时校验 RULE-01 资信准入，提交审批时根据 RULE-02 自动判定风险等级',
      '法务审批放行后通过 EVT-03 事件异步联动生成首期履约结算单（SCN-01）',
    ],
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content:
          '我们需要建设一套企业级合同全生命周期管理系统，支持商务专员起草采购和销售合同，关联客户/供应商资信，并根据合同金额走不同的法务审批流，审批通过后自动生成首期结算单。',
        timestamp: '2026-11-10T08:15:00.000Z',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content:
          '已识别核心聚合根：`Contract`（合同）、`Counterparty`（签约相对方）、`SettlementOrder`（履约结算单）。为了收敛 M3 规则模型与 M6 审批流程分支，请确认以下两个边界问题：\n1. 大额合同对签约相对方的资信等级（如 AAA/AA/A）是否有硬性准入拦截阈值？\n2. 合同审批通过后，首期结算单是同步阻塞生成还是通过领域事件（ME）触发生成？',
        timestamp: '2026-11-10T08:15:18.000Z',
        extractedHints: {
          aggregates: ['Contract', 'Counterparty', 'SettlementOrder'],
          behaviors: ['draftContract', 'submitContractApproval', 'approveContract'],
          openQuestions: ['大额合同资信准入阈值', '首期结算单触发机制'],
        },
      },
      {
        id: 'msg-3',
        role: 'user',
        content:
          '1. 合同总金额超过 100 万元时，相对方资信必须是 AA 或 AAA 级，黑名单相对方一律禁止起草。2. 审批通过后发送领域事件 Contract.ApprovedAndSigned，校验结算总额不超过合同金额后自动创建首期结算单。',
        timestamp: '2026-11-10T08:17:00.000Z',
      },
      {
        id: 'msg-4',
        role: 'assistant',
        content:
          '需求边界已全部澄清！已为您同步生成结构化《软件需求说明书 (SRS)》并沉淀至 M1~MI 11 个业务本体模型。',
        timestamp: '2026-11-10T08:17:22.000Z',
        extractedHints: {
          rules: ['RULE-01', 'RULE-02', 'RULE-03'],
        },
      },
    ],
    updatedAt: '2026-11-10T08:18:00.000Z',
  },
];

export const SEED_REQUIREMENT_DOCS: RequirementDoc[] = [
  {
    id: 'req-doc-contract-srs',
    projectId: 'proj-contract',
    title: '合同全生命周期管理系统软件需求说明书 (SRS v5.0)',
    version: 'v5.0',
    status: 'CONFIRMED',
    content: `# 合同全生命周期管理系统 — 软件需求说明书 (SRS)

## 1. 业务目标与范围
构建基于 **11 元模型业务本体** 的企业级合同全生命周期管理系统（CLM），实现从相对方资信核验、合同起草、风险定级会签、CA 电子签章到首期履约结算的端到端闭环。

## 2. 核心领域对象 (对应 M1 对象模型)
- **合同 (\`Contract\` / \`AGG-01\`)**：包含合同编号、名称、合同类型、相对方引用、合同总金额、状态、履约有效期（\`SignPeriod\`）及风险等级；下辖子实体 \`ContractLineItem\`（标的明细）与 \`PaymentMilestone\`（收付款里程碑）。
- **签约相对方 (\`Counterparty\` / \`AGG-02\`)**：维护统一社会信用代码、企业全称、资信等级（AAA~C）与准入状态。
- **履约结算单 (\`SettlementOrder\` / \`AGG-03\`)**：关联执行中合同，记录每期结算金额与核销状态。

## 3. 关键业务行为与规则 (对应 M2 / M3 / ME / M4)
1. **起草合同 (\`BHV-01\`)**：前置检查相对方状态必须为 \`ACTIVE\`，调用 \`RULE-01\` 校验百万级合同资信门槛，发布 \`EVT-01 (Contract.DraftCreated)\`。
2. **提交合同审批 (\`BHV-02\`)**：调用 \`RULE-02\` 按金额阈值（50万/200万）自动判定风险等级，发布 \`EVT-02 (Contract.SubmittedForApproval)\`。
3. **法务终审与结算联动 (\`BHV-03\` / \`SCN-01\`)**：法务审批放行后发布 \`EVT-03 (Contract.ApprovedAndSigned)\`，触发 \`RULE-03\` 结算总额守恒校验并调用 \`BHV-04\` 自动生成首期结算单。
`,
    updatedAt: '2026-11-10T08:30:00.000Z',
  },
];

export const SEED_PROTOTYPES: PrototypeArtifact[] = [
  {
    id: 'proto-contract-v1',
    projectId: 'proj-contract',
    name: '合同台账、起草与法务会签交互原型 (界面原型.html)',
    version: 'v5.0',
    htmlContent: CONTRACT_PROTOTYPE_HTML,
    extractedScreenCount: 3,
    updatedAt: '2026-11-10T08:45:00.000Z',
  },
];

export const SEED_FOUR_LAYER_ASSETS: FourLayerAsset[] = [
  {
    id: 'asset-ui-spatial-paper',
    layer: 'UI_UE',
    name: 'Spatial-Sync 暖纸与胶片颗粒双模设计规范',
    version: 'v2.4',
    summary:
      '支持亮色暖纸纹理 (#f3f2ee) 与暗色胶片颗粒 (#121211)，采用 Noto Serif SC 标题 + IBM Plex Sans 正文 + IBM Plex Mono 本体编码的高密度专业工作台规范。',
    tags: ['Light/Dark', 'Warm Paper', 'IBM Plex', 'Bilingual i18n'],
    specMarkdown: `# UI/UE 界面设计规范 — Spatial-Sync 双模工作台

## 1. 色彩与表面令牌
- **亮色模式（Warm Paper）**：背景 \`#f3f2ee\`，工作台卡片 \`#fdfdfb\`，主墨色 \`#1a1a18\`，强调色 \`#4c50c4\`。
- **暗色模式（Film Grain）**：背景 \`#121211\`，工作台卡片 \`#181816\`，主墨色 \`#eceae3\`，强调色 \`#9ca4ff\`。

## 2. 排版与组件约束
- 禁止使用浏览器原生阻塞弹窗（\`alert\` / \`confirm\` / \`prompt\`），统一采用非阻塞抽屉或模态框。
- 所有本体模型 ID、规则表达式与 SQL 必须使用 \`IBM Plex Mono\` 等宽字体渲染。`,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'asset-ui-enterprise-dense',
    layer: 'UI_UE',
    name: '企业级高密度主子表与审批流交互规范',
    version: 'v1.8',
    summary: '针对 ERP / 合同 / 财务单据场景定制的主子表联编、状态徽章与审批时间轴设计规范。',
    tags: ['Master-Detail', 'Approval Flow', 'Enterprise Table'],
    specMarkdown: `# 企业级高密度主子表与审批流交互规范\n\n支持单屏同时展示主单据属性、子实体明细行与底部固定审批操作栏。`,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'asset-foundation-ts-edge',
    layer: 'TECH_FOUNDATION',
    name: 'TypeScript + Hono + Drizzle + SQLite/D1 轻量全栈技术底座',
    version: 'v5.0',
    summary:
      'Local-first 零外部数据库依赖，本地基于 Node.js 内置 SQLite 高速运行，边缘端无缝部署至 Cloudflare Workers + D1。',
    tags: ['TypeScript', 'Hono', 'Drizzle ORM', 'SQLite / D1', 'React 19'],
    specMarkdown: `# 技术底座说明 — TypeScript + Hono + SQLite/D1

- **前端框架**：Vite + React 19 + TanStack Query + Zustand + Base UI
- **服务端框架**：Hono REST/SSE API + MCP JSON-RPC Server
- **持久化引擎**：本地 \`node:sqlite\` 与 Cloudflare D1 同构 SQLite 方言`,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'asset-foundation-spring-cloud',
    layer: 'TECH_FOUNDATION',
    name: 'Spring Boot 3 + MyBatis-Plus + PostgreSQL 企业级底座',
    version: 'v3.2',
    summary: '适用于存量 Java 技术栈团队的标准脚手架底座，内置多租户、RBAC 权限拦截与分布式事务支持。',
    tags: ['Java 21', 'Spring Boot 3', 'PostgreSQL'],
    specMarkdown: `# 技术底座说明 — Spring Boot 3 企业级底座\n\n提供标准 Maven 多模块工程结构与统一异常处理。`,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'asset-arch-ddd-deep-module',
    layer: 'TECH_ARCH',
    name: 'DDD 11元模型驱动 + Deep Modules 深模块技术架构',
    version: 'v5.0',
    summary:
      '将 M1~MI 11 个业务本体模型确定性映射为领域聚合根、命令/查询应用服务、规则引擎、事件总线与持久化仓储。',
    tags: ['DDD', 'Deep Modules', '11-Model Mapping', 'Zero Drift'],
    specMarkdown: `# 技术架构设计文档 — DDD 11元模型驱动深模块架构

## 1. 四层架构映射契约
1. **领域层 (\`domain/\`)**：严格对应 \`M1\` 聚合根/实体/值对象、\`M3\` 领域规则与 \`ME\` 领域事件。
2. **应用层 (\`application/\`)**：严格对应 \`M2\` 行为命令、\`M4\` 事件场景与 \`M6\` 业务流程编排。
3. **基础设施层 (\`infrastructure/\`)**：严格对应 \`MM\` 对象-数据表映射与 \`M7\` 参考 SQL 查询实现。
4. **接口与表现层 (\`interfaces/\` & \`ui/\`)**：严格对应 \`MI\` 接口契约与 \`MU\` 屏幕控件调用链。`,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
];

export const SEED_ASSEMBLED_APPS: AssembledApplication[] = [
  {
    id: 'app-contract-clm',
    name: '合同全生命周期管理系统 (CLM v5.0)',
    projectId: 'proj-contract',
    uiUeAssetId: 'asset-ui-spatial-paper',
    techFoundationAssetId: 'asset-foundation-ts-edge',
    techArchAssetId: 'asset-arch-ddd-deep-module',
    status: 'PUBLISHED',
    packageOutputDir: '.onto-cs/packages/app-contract-clm',
    publishedEndpoint: 'http://127.0.0.1:4310/apps/contract-clm',
    publishedVersion: 'v5.0.0',
    agentDevLogs: [
      {
        timestamp: '2026-11-10T09:10:00.000Z',
        phase: 'ONTOLOGY_GATE_CHECK',
        detail: '11 模型一致性门禁通过（0 Error, 0 Warning）',
      },
      {
        timestamp: '2026-11-10T09:11:00.000Z',
        phase: 'PACKAGE_COMPILE',
        detail: '已编译渐进式披露《开发指导书.md》《本体模型业务功能开发指导书.md》及 11 份 YAML 模型元文件',
      },
      {
        timestamp: '2026-11-10T09:12:00.000Z',
        phase: 'APP_PUBLISH',
        detail: '应用已发布至运行态沙箱并同步挂载 MCP 服务与业务技能包',
      },
    ],
    updatedAt: '2026-11-10T09:12:00.000Z',
  },
];

export const SEED_SKILLS: GeneratedSkill[] = [
  {
    id: 'skill-contract-clm',
    projectId: 'proj-contract',
    name: '合同全生命周期业务本体技能 (contract-lifecycle-ontology)',
    slug: 'contract-lifecycle-ontology',
    version: '5.0.0',
    description:
      '提供合同起草、相对方资信准入核验（RULE-01）、风险分级会签（RULE-02）与首期履约结算单联动（SCN-01）的渐进式披露 Agent 技能包。',
    skillMarkdown: `---
name: contract-lifecycle-ontology
description: 合同全生命周期管理系统 (CLM) 业务本体技能包。当需要起草商务合同、核验签约相对方资信等级、执行多级法务风险会签、查询合同台账或触发首期履约结算时调用。
---

# 合同全生命周期业务本体技能 (Contract Lifecycle Ontology Skill)

## 1. 核心领域概念 (M1)
- \`Contract\` (AGG-01): 商务合同聚合根，包含 \`ContractLineItem\` 与 \`PaymentMilestone\`。
- \`Counterparty\` (AGG-02): 签约相对方，含资信等级 \`creditRating\` (\`AAA\`/\`AA\`/\`A\`/\`B\`/\`C\`)。
- \`SettlementOrder\` (AGG-03): 履约结算单。

## 2. 可调用业务行为与规则门禁 (M2 & M3)
- \`draftContract\` (\`BHV-01\`): 起草合同，自动执行 \`RULE-01\`（金额 > 100万要求相对方 AA/AAA 级）。
- \`submitContractApproval\` (\`BHV-02\`): 提交审批，自动执行 \`RULE-02\` 判定风险等级。
- \`approveContract\` (\`BHV-03\`): 法务终审通过，触发 \`EVT-03\` 与 \`SCN-01\` 自动生成首期结算单。
- \`queryContractLedger\` (\`BHV-05\` -> \`QRY-01\`): 分页检索合同台账。
`,
    updatedAt: '2026-11-10T09:05:00.000Z',
  },
];

export const SEED_LEGACY_SYSTEMS: LegacySystemConfig[] = [
  {
    id: 'sys-erp-contract',
    name: '存量 ERP 合同与客商主数据系统',
    code: 'ERP-CLM-LEGACY',
    category: 'ERP / 业财一体',
    baseUrl: 'http://127.0.0.1:4310/api/mock-legacy/erp',
    dbDialect: 'SQLite / PostgreSQL',
    dbConnectionUri: 'sqlite://.onto-cs/legacy-erp.db',
    status: 'MCP_ACTIVE',
    linkedProjectId: 'proj-contract',
    description: '存量企业合同与相对方管理系统，已完成本体萃取并封装为标准 MCP Server。',
  },
  {
    id: 'sys-mft-transfer',
    name: '企业跨网大文件安全传输平台 (MFT)',
    code: 'MFT-GATEWAY',
    category: '安全基础设施',
    baseUrl: 'http://127.0.0.1:4310/api/mock-legacy/mft',
    dbDialect: 'MySQL 8.0',
    dbConnectionUri: 'mysql://mft_ro@10.20.1.50:3306/mft_prod',
    status: 'EXTRACTED',
    linkedProjectId: 'proj-mft',
    description: '承载合同定稿 PDF 加密归档与跨安全域文件交换的存量系统。',
  },
];

export const SEED_EXTRACTION_JOBS: ExtractionJob[] = [
  {
    id: 'ext-job-01',
    systemId: 'sys-erp-contract',
    projectId: 'proj-contract',
    title: 'ERP 合同主子表 DDL 与 OpenAPI 接口本体萃取',
    sourceType: 'DDL_AND_OPENAPI',
    sourceSnippet: `CREATE TABLE t_contract (
  id VARCHAR(36) PRIMARY KEY,
  contract_no VARCHAR(32) NOT NULL UNIQUE,
  title VARCHAR(128) NOT NULL,
  counterparty_id VARCHAR(36) NOT NULL,
  total_amount DECIMAL(18,2) NOT NULL,
  risk_level VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL
);
-- POST /api/v1/contracts/draft -> BHV-01 draftContract
-- POST /api/v1/contracts/approve -> BHV-03 approveContract`,
    extractedModels: ['M1', 'M2', 'M3', 'ME', 'M7', 'MM', 'MI'],
    confidenceScore: 0.96,
    status: 'COMPLETED',
    summary:
      '成功从 3 张核心物理表与 6 个 REST 接口萃取生成 Contract、Counterparty、SettlementOrder 三个聚合根及完整映射模型 MM/MI。',
    createdAt: '2026-11-10T08:50:00.000Z',
  },
  {
    id: 'ext-job-02',
    systemId: 'sys-mft-transfer',
    projectId: 'proj-mft',
    title: 'MFT 跨网传输任务表与调度接口本体萃取',
    sourceType: 'DDL_AND_OPENAPI',
    sourceSnippet: `CREATE TABLE mft_transfer_task (
  task_no VARCHAR(32) PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  file_size_mb DECIMAL(12,2) NOT NULL,
  sha256_digest CHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL
);`,
    extractedModels: ['M1', 'M2', 'M3', 'ME', 'M5'],
    confidenceScore: 0.94,
    status: 'COMPLETED',
    summary: '成功从 MFT 存量库表与传输网关接口萃取出 TransferTask 聚合根与 10GB 体积校验规则 RULE-MFT-01。',
    createdAt: '2026-11-10T09:20:00.000Z',
  },
];

export const SEED_MCP_SERVERS: McpServerConfig[] = [
  {
    id: 'mcp-contract-server',
    projectId: 'proj-contract',
    name: '合同全生命周期业务本体 MCP Server',
    endpoint: '/api/mcp/proj-contract',
    transport: 'HTTP_JSON_RPC',
    status: 'ONLINE',
    toolsCount: 6,
    resourcesCount: 11,
    updatedAt: '2026-11-10T09:15:00.000Z',
  },
  {
    id: 'mcp-mft-server',
    projectId: 'proj-mft',
    name: 'MFT 跨网安全传输本体 MCP Server',
    endpoint: '/api/mcp/proj-mft',
    transport: 'HTTP_JSON_RPC',
    status: 'ONLINE',
    toolsCount: 2,
    resourcesCount: 5,
    updatedAt: '2026-11-10T09:25:00.000Z',
  },
];

export const SEED_CAPABILITY_AGENTS: CapabilityAgent[] = [
  {
    id: 'agent-contract-copilot',
    name: '合同合规审查与履约协同智能体',
    role: '法务风控与商务履约数字专家',
    projectId: 'proj-contract',
    mcpIds: ['mcp-contract-server', 'mcp-mft-server'],
    skillIds: ['skill-contract-clm'],
    modelId: 'auto/glm-5.3-flash',
    systemPrompt:
      '你是基于《合同全生命周期管理系统》11元模型驱动的智能体。在执行任何合同起草、审批或结算指令前，必须严格遵循 M3 规则模型（如 RULE-01 百万级合同相对方 AA/AAA 资信要求、RULE-03 结算总额上限守恒）。',
    status: 'ACTIVE',
  },
];

export const SEED_CROSS_SYSTEM_FLOWS: CrossSystemFlow[] = [
  {
    id: 'xflow-contract-seal-archive',
    name: '合同终审放行 -> CA电子签章 -> MFT跨网归档 -> ERP首期结算协同流',
    description:
      '打通合同管理系统 (CLM)、CA 电子签章网关、MFT 安全文件传输平台与财务结算模块的跨系统自动化流程协同。',
    involvedSystems: ['存量 ERP 合同与客商主数据系统', '电子签章服务网关', '企业跨网大文件安全传输平台 (MFT)'],
    triggerEvent: 'EVT-03 (Contract.ApprovedAndSigned)',
    steps: [
      {
        stepOrder: 1,
        systemName: '存量 ERP 合同与客商主数据系统',
        mcpToolName: 'm2_approveContract',
        description: '调用 BHV-03 完成法务终审状态流转并校验 RULE-03 结算额度守恒',
        status: 'SUCCESS',
      },
      {
        stepOrder: 2,
        systemName: '电子签章服务网关',
        mcpToolName: 'mi_IF-EXT-ESIGN-03',
        description: '调用外部 CA 电子签章接口固化合同 PDF 数字签名',
        status: 'SUCCESS',
      },
      {
        stepOrder: 3,
        systemName: '企业跨网大文件安全传输平台 (MFT)',
        mcpToolName: 'm2_dispatchSecureTransfer',
        description: '通过 MFT 将已签章合同加密归档至内网档案库',
        status: 'SUCCESS',
      },
      {
        stepOrder: 4,
        systemName: '存量 ERP 合同与客商主数据系统',
        mcpToolName: 'm2_createInitialSettlement',
        description: '触发 BHV-04 自动生成首期履约待核销结算单',
        status: 'SUCCESS',
      },
    ],
    lastRunAt: '2026-11-10T09:30:00.000Z',
    lastRunStatus: 'SUCCESS',
    executionLogs: [
      '[09:30:01] 收到触发事件 EVT-03 (Contract.ApprovedAndSigned) · 合同编号 CT-2026-0001',
      '[09:30:02] Step 1 [ERP-CLM] 调用 m2_approveContract 成功 -> 状态流转为 EXECUTING',
      '[09:30:03] Step 2 [CA-ESIGN] 调用 mi_IF-EXT-ESIGN-03 成功 -> 签章流水号 SEAL-20261110-8891',
      '[09:30:04] Step 3 [MFT-GATEWAY] 调用 m2_dispatchSecureTransfer 成功 -> 传输单号 MFT-2026-0412 (SHA256 校验一致)',
      '[09:30:05] Step 4 [ERP-CLM] 调用 m2_createInitialSettlement 成功 -> 首期结算单 STL-2026-0098 已生成 (¥ 720,000.00)',
    ],
  },
];

export const SEED_KNOWLEDGE_ENTRIES: KnowledgeEntry[] = [
  {
    id: 'know-01',
    title: '企业商务合同风险分级与资信准入管理办法 (2026版)',
    category: 'BUSINESS_POLICY',
    tags: ['法务合规', 'RULE-01', 'RULE-02'],
    content: `# 企业商务合同风险分级与资信准入管理办法

1. **百万级合同资信红线（映射 RULE-01）**：单笔合同总金额超过 ¥1,000,000 时，签约相对方资信评级必须为 \`AAA\` 或 \`AA\`。
2. **三级风险定级标准（映射 RULE-02）**：
   - \`HIGH\`（高风险）：合同金额 ≥ ¥2,000,000 或涉及跨境知识产权授权，必须经法务总监终审。
   - \`MEDIUM\`（中风险）：¥500,000 ≤ 合同金额 < ¥2,000,000，需部门主管与法务专员会签。
   - \`LOW\`（低风险）：合同金额 < ¥500,000 且采用标准合同模板，支持快速通道放行。`,
    linkedProjectId: 'proj-contract',
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'know-02',
    title: '存量业务系统本体萃取（Ontology Extraction）实施指南',
    category: 'EXTRACTION_GUIDE',
    tags: ['本体萃取', '存量系统本体化', 'MCP封装'],
    content: `# 存量业务系统本体萃取实施指南

针对企业既有 ERP、MFT、CRM 等存量系统，无需推倒重写，通过 **数据库表结构 (DDL) + 接口文档 (OpenAPI) + 业务制度文档** 三源融合萃取：
1. 从物理表主外键提炼 \`M1\` 聚合根与 \`MM\` 数据表映射模型；
2. 从服务接口提炼 \`M2\` 行为模型与 \`MI\` 接口模型；
3. 从校验逻辑与制度文档提炼 \`M3\` 规则模型与 \`ME\` 事件模型；
4. 一键发布为标准 **MCP Server** 与 **Skill 技能包**，赋能智能体跨系统协同。`,
    linkedProjectId: 'proj-mft',
    updatedAt: '2026-11-10T08:20:00.000Z',
  },
];

export const SEED_DATABASE_RESOURCES: DatabaseResource[] = [
  {
    id: 'db-clm-dw',
    name: '业财合同与履约分析主数仓 (SQLite / Cloudflare D1)',
    dialect: 'SQLite',
    connectionUri: 'sqlite://.onto-cs/workspace.sqlite',
    status: 'ONLINE',
    tables: [
      {
        tableName: 't_contract',
        comment: '商务合同主表 (映射 M1 Contract)',
        rowCount: 1280,
        columns: [
          { name: 'id', type: 'VARCHAR(36)', comment: '主键ID' },
          { name: 'contract_no', type: 'VARCHAR(32)', comment: '合同编号' },
          { name: 'title', type: 'VARCHAR(128)', comment: '合同名称' },
          { name: 'contract_type', type: 'VARCHAR(32)', comment: '合同类型' },
          { name: 'counterparty_id', type: 'VARCHAR(36)', comment: '相对方ID' },
          { name: 'total_amount', type: 'DECIMAL(18,2)', comment: '合同总金额' },
          { name: 'risk_level', type: 'VARCHAR(16)', comment: '风险等级' },
          { name: 'status', type: 'VARCHAR(24)', comment: '履约状态' },
        ],
      },
      {
        tableName: 't_counterparty',
        comment: '签约相对方资信表 (映射 M1 Counterparty)',
        rowCount: 340,
        columns: [
          { name: 'id', type: 'VARCHAR(36)', comment: '主键ID' },
          { name: 'credit_code', type: 'CHAR(18)', comment: '统一社会信用代码' },
          { name: 'company_name', type: 'VARCHAR(128)', comment: '企业全称' },
          { name: 'credit_rating', type: 'VARCHAR(8)', comment: '资信等级 AAA~C' },
          { name: 'status', type: 'VARCHAR(16)', comment: '准入状态' },
        ],
      },
      {
        tableName: 't_settlement_order',
        comment: '合同履约结算事实表 (映射 M1 SettlementOrder)',
        rowCount: 3920,
        columns: [
          { name: 'id', type: 'VARCHAR(36)', comment: '主键ID' },
          { name: 'settlement_no', type: 'VARCHAR(32)', comment: '结算单号' },
          { name: 'contract_ref', type: 'VARCHAR(36)', comment: '关联合同ID' },
          { name: 'settlement_amount', type: 'DECIMAL(18,2)', comment: '结算金额' },
          { name: 'settlement_status', type: 'VARCHAR(16)', comment: '结算状态' },
        ],
      },
    ],
  },
];

export const SEED_DATA_DOCUMENTS: DataDocument[] = [
  {
    id: 'ddoc-01',
    title: '业财合同主题域数仓分层与指标口径说明书',
    category: 'METRIC_DICT',
    content: `# 业财合同主题域指标口径说明

- **合同履约结算达成率**：\`SUM(已付结算单金额) / SUM(生效合同总金额)\`，正常阈值 ≥ 85%。
- **高风险合同占比**：\`COUNT(risk_level = 'HIGH') / COUNT(全部生效合同)\`，预警阈值 > 15%。
- **大额合同逾期未结算率**：超过里程碑计划付款日 15 天仍处于 \`PENDING\` 状态的结算金额占比。`,
    updatedAt: '2026-11-10T08:40:00.000Z',
  },
];

export const SEED_DATA_MAPPINGS: DataMappingRule[] = [
  {
    id: 'dmap-01',
    ontologyObject: 'Contract',
    ontologyAttribute: 'Contract.totalAmount',
    sourceDatabaseId: 'db-clm-dw',
    sourceTable: 't_contract',
    sourceColumn: 'total_amount',
    transformExpr: 'CAST(total_amount AS DECIMAL(18,2))',
    qualityRule: 'total_amount > 0 AND total_amount IS NOT NULL',
  },
  {
    id: 'dmap-02',
    ontologyObject: 'Counterparty',
    ontologyAttribute: 'Counterparty.creditRating',
    sourceDatabaseId: 'db-clm-dw',
    sourceTable: 't_counterparty',
    sourceColumn: 'credit_rating',
    transformExpr: 'UPPER(TRIM(credit_rating))',
    qualityRule: "credit_rating IN ('AAA', 'AA', 'A', 'B', 'C')",
  },
  {
    id: 'dmap-03',
    ontologyObject: 'SettlementOrder',
    ontologyAttribute: 'SettlementOrder.settlementAmount',
    sourceDatabaseId: 'db-clm-dw',
    sourceTable: 't_settlement_order',
    sourceColumn: 'settlement_amount',
    transformExpr: 'COALESCE(settlement_amount, 0)',
    qualityRule: 'settlement_amount > 0',
  },
];

export const SEED_METRICS: MetricDefinition[] = [
  {
    id: 'MET-01',
    code: 'CONTRACT_SETTLEMENT_RATE',
    name: '合同履约结算达成率',
    category: '履约效率',
    formula: 'SUM(SettlementOrder.settlementAmount) / SUM(Contract.totalAmount)',
    unit: '%',
    currentValue: '88.4%',
    yoYChange: '+4.2%',
    status: 'NORMAL',
    dimensions: ['合同类型 (contractType)', '风险等级 (riskLevel)', '相对方资信 (creditRating)'],
    linkedAggregate: 'Contract',
  },
  {
    id: 'MET-02',
    code: 'HIGH_RISK_OVERDUE_RATIO',
    name: '高风险合同逾期未结算率',
    category: '法务与资金风控',
    formula: "SUM(OverdueSettlement.amount WHERE Contract.riskLevel='HIGH') / SUM(HighRiskContract.totalAmount)",
    unit: '%',
    currentValue: '14.8%',
    yoYChange: '+3.1%',
    status: 'WARNING',
    dimensions: ['相对方资信 (creditRating)', '所属部门'],
    linkedAggregate: 'SettlementOrder',
  },
  {
    id: 'MET-03',
    code: 'AVG_APPROVAL_CYCLE_HOURS',
    name: '法务风险会签平均周期',
    category: '流程效能',
    formula: 'AVG(approvedAt - submittedAt)',
    unit: '小时',
    currentValue: '16.5h',
    yoYChange: '-28.0%',
    status: 'NORMAL',
    dimensions: ['风险等级 (riskLevel)'],
    linkedAggregate: 'Contract',
  },
];

export const SEED_ANALYTICS_SCENARIOS: AnalyticsScenario[] = [
  {
    id: 'ascn-01',
    name: '大额高风险合同逾期未结算归因与资信动态降级分析场景',
    domain: '合同全生命周期管理系统',
    triggerCondition: 'HIGH_RISK_OVERDUE_RATIO > 12%',
    relatedMetrics: ['MET-01', 'MET-02'],
    causalFactors: [
      'A 级资信外包服务商在 Q3 集中出现里程碑验收材料缺失（占比 62%）',
      '部分技术服务外包合同未绑定自动电子签章回执校验，导致财务核销挂起',
    ],
    recommendedActions: [
      '对连续 2 期逾期超过 15 天的相对方自动触发资信降级预警（AA -> A）',
      '调用回写接口 WB-01 冻结高风险逾期合同的后续批次付款并推送法务催告函',
    ],
    writebackInterfaceId: 'WB-01',
  },
];

export const SEED_ANALYTICS_REPORTS: AnalyticsReport[] = [
  {
    id: 'arpt-2026-q4',
    title: '2026 Q4 企业商务合同履约健康度与风险归因分析报告',
    period: '2026-Q4',
    author: '数据本体推理引擎 (Data Ontology Reasoner)',
    summary:
      '全公司生效合同总额 ¥1.42 亿，整体结算达成率 88.4%，但技术外包类高风险合同逾期率上升 3.1%，建议通过回写接口收紧 A 级相对方首付款比例。',
    markdownContent: `# 2026 Q4 企业商务合同履约健康度与风险归因分析报告

## 一、核心经营指标概览（智能问数结论）
- **生效合同总金额**：\`¥ 142,600,000.00\`（环比 \`+11.4%\`）
- **合同履约结算达成率 (\`MET-01\`)**：\`88.4%\`（处于健康区间）
- **高风险合同逾期未结算率 (\`MET-02\`)**：\`14.8%\`（触发黄色预警阈值 \`12.0%\`）

## 二、异常波动根因穿透（智能问因结论）
沿着 \`Contract -> Counterparty -> SettlementOrder\` 本体关联路径下钻发现：
1. **合同类型维度**：\`OUTSOURCING\`（技术服务外包合同）贡献了 \`71.5%\` 的逾期未结算金额；
2. **相对方资信维度**：资信等级为 \`A\` 级的 4 家供应商在二期里程碑交付物签署环节平均延误 \`19.2\` 天。

## 三、策略建议与业务回写（智能问策结论）
1. **立即执行**：调用 **\`WB-01 高风险逾期合同催收与结算冻结回写接口\`**，对逾期超 15 天的 3 份高风险合同自动锁定下期付款并发送法务催办通知。
2. **规则优化**：建议将 \`M3\` 中 \`RULE-01\` 的大额合同准入阈值从 \`100万\` 下调至 \`80万\`。`,
    createdAt: '2026-11-10T09:40:00.000Z',
  },
];

export const SEED_REASONING_SESSIONS: ReasoningSession[] = [
  {
    id: 'reas-01',
    question: '为什么本季度高风险合同逾期未结算率上升到了 14.8%？应该采取什么处置策略并回写业务系统？',
    mode: 'ASK_POLICY',
    sqlGenerated:
      "SELECT c.contract_type, cp.credit_rating, COUNT(c.id) AS cnt, SUM(so.settlement_amount) AS overdue_amt FROM t_contract c JOIN t_counterparty cp ON c.counterparty_id = cp.id JOIN t_settlement_order so ON so.contract_ref = c.id WHERE c.risk_level = 'HIGH' AND so.settlement_status = 'PENDING' GROUP BY c.contract_type, cp.credit_rating ORDER BY overdue_amt DESC",
    dataSummary: [
      { label: '高风险逾期总额', value: '¥ 4,820,000', delta: '+3.1%' },
      { label: '技术外包合同占比', value: '71.5%', delta: '+14.2%' },
      { label: 'A级资信相对方逾期笔数', value: '9 笔', delta: '主因' },
    ],
    causalAnalysis: [
      '【对象层 M1 关联穿透】Contract(OUTSOURCING) -> Counterparty(creditRating=A) 组合贡献了 71.5% 的未核销结算单。',
      '【规则层 M3 阈值对照】当前 RULE-01 仅对 >100万合同强制要求 AA/AAA 级资信，导致 80万~100万区间的高风险外包合同流入 A 级供应商。',
    ],
    policyRecommendations: [
      {
        actionTitle: '触发高风险逾期合同付款冻结与法务催办',
        targetObject: 'Contract / SettlementOrder',
        expectedImpact: '预计 7 日内追回逾期结算款 ¥320 万，降低逾期率至 8.5% 以下',
        writebackInterfaceId: 'WB-01',
      },
    ],
    answerMarkdown: `### 1. 智能问数 (Data Retrieval)\n检索 \`t_contract\` 与 \`t_settlement_order\` 发现，高风险合同待核销逾期总额为 **¥ 4,820,000**（逾期率 **14.8%**）。\n\n### 2. 智能问因 (Causal Attribution)\n沿本体知识图谱关系链 \`Contract -> Counterparty -> SettlementOrder\` 归因：\n- **71.5%** 的逾期金额集中在 \`OUTSOURCING\`（技术外包）类型且相对方资信为 \`A\` 级的合同；\n- \`RULE-01\` 资信门槛当前设定在 100 万元，80~100 万区间合同存在风控敞口。\n\n### 3. 智能问策 (Actionable Policy)\n建议立即调用回写接口 **\`WB-01\`** 批量冻结逾期结算单并推送法务催收待办。`,
    createdAt: '2026-11-10T09:42:00.000Z',
  },
];

export const SEED_WRITEBACK_INTERFACES: WritebackInterface[] = [
  {
    id: 'WB-01',
    name: '高风险逾期合同催收与结算冻结回写接口',
    targetSystem: '合同全生命周期管理系统 (CLM)',
    protocol: 'REST_POST',
    endpoint: '/api/mcp/proj-contract',
    boundBehaviorRef: 'BHV-03',
    payloadTemplate: {
      action: 'FREEZE_OVERDUE_SETTLEMENT_AND_NOTIFY_LEGAL',
      riskLevelFilter: 'HIGH',
      overdueDaysThreshold: 15,
      operatorRole: 'ROLE-DEPT-MGR',
    },
    executionCount: 2,
    lastExecutedAt: '2026-11-10T09:45:00.000Z',
    lastExecutionResult: '已成功回写业务系统：锁定 3 笔逾期结算单并向法务主管推送催收任务（状态码 200）',
  },
];

export const SEED_LLM_PROVIDERS: LlmProviderConfig[] = [
  {
    id: 'provider-magpie-local',
    name: 'Magpie Local Gateway (Pi · GLM-5.3-Flash)',
    providerType: 'OPENAI_COMPATIBLE',
    baseUrl: 'http://127.0.0.1:3425/v1',
    apiKey: 'magpie',
    defaultModel: 'auto/glm-5.3-flash',
    availableModels: [
      'auto/glm-5.3-flash',
      'zhipu/glm-5.3-flash',
      'workbuddy-ai/glm-5.3-flash',
      'auto/glm-5.2',
    ],
    enabled: true,
    lastTestedStatus: 'OK',
    lastTestedMessage: 'Connected to local Pi gateway (http://127.0.0.1:3425/v1 · auto/glm-5.3-flash)',
  },
];

export const SEED_SYSTEM_SETTINGS: SystemSettingsState = {
  workspaceDir: '.onto-cs',
  defaultLanguage: 'zh-CN',
  defaultTheme: 'light',
  strictValidation: true,
  autoMirrorYaml: true,
  autoSyncPrototypeMu: true,
};

