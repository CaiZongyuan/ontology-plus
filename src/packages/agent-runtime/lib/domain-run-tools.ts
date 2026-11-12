import {
  CONTRACT_PROTOTYPE_HTML,
  MODEL_CODES,
  extractMuFromPrototypeHtml,
  validateOntologySuite,
  type AggregateRoot,
  type Attribute,
  type OntologySuite,
} from '../../ontology-core/index.js';
import type {
  AgentDomainArtifact,
  AgentSession,
  AgentToolCallTrace,
  AnalyticsReport,
  ProjectDetail,
  PrototypeArtifact,
  RequirementDoc,
  RequirementSession,
  WorkspaceStore,
} from '../../workspace-store/index.js';
import { type AgentLocale, pickLocaleText } from './locale.js';
import { applyOntologyToolCall, type OpenAiFunctionTool } from './tools.js';

export type StructuredDomainActionKind =
  | 'SYNTHESIZE_SRS'
  | 'SYNTHESIZE_ONTOLOGY_SUITE'
  | 'GENERATE_TECH_ARCH'
  | 'METRIC_INSIGHT'
  | 'SCENARIO_ATTRIBUTION';

export interface ParsedStructuredDomainAction {
  kind: StructuredDomainActionKind;
  params: Record<string, unknown>;
  cleanPrompt: string;
}

const ACTION_HEADER_RE =
  /^\[ACTION:(SYNTHESIZE_SRS|SYNTHESIZE_ONTOLOGY_SUITE|GENERATE_TECH_ARCH|METRIC_INSIGHT|SCENARIO_ATTRIBUTION)(?:\s+(\{[^\r\n]*\}))?\]\s*/i;

export function parseStructuredActionFromPrompt(
  prompt: string,
): ParsedStructuredDomainAction | null {
  const match = ACTION_HEADER_RE.exec(prompt.trim());
  if (!match) return null;
  const kind = match[1]!.toUpperCase() as StructuredDomainActionKind;
  let params: Record<string, unknown> = {};
  if (match[2]) {
    try {
      const parsed = JSON.parse(match[2]) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        params = parsed as Record<string, unknown>;
      }
    } catch {
      params = {};
    }
  }
  const cleanPrompt = prompt.trim().slice(match[0].length).trim();
  return { kind, params, cleanPrompt };
}

function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\s*\r?\n([\s\S]*?)\r?\n```$/);
  return match ? match[1]!.trim() : trimmed;
}

export function extractJsonObjectFromText<T = Record<string, unknown>>(raw: string): T | null {
  const cleaned = stripMarkdownFence(raw);
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
  } catch {
    return null;
  }
}

const AUTO_TAG_RE = /\[(?:AI自动补全|AI Auto-Completed)\]/i;

export function hasForeignDemoTemplate(project: ProjectDetail): boolean {
  return (
    project.id !== 'proj-contract' &&
    project.id !== 'proj-mft' &&
    ((project.suite.M1?.domain === '合同全生命周期管理系统' &&
      project.domain !== '合同全生命周期管理系统') ||
      (project.suite.M1?.domain === '企业文件安全传输系统 (MFT)' &&
        project.domain !== '企业文件安全传输系统 (MFT)'))
  );
}

export function findRequirementSessionOptional(
  store: WorkspaceStore,
  sessionId?: string,
): RequirementSession | undefined {
  if (!sessionId) return undefined;
  if (typeof store.getRequirementSession === 'function') {
    const direct = store.getRequirementSession(sessionId);
    if (direct) return direct;
  }
  return store
    .listProjects()
    .flatMap((p) => store.listRequirementSessions(p.id))
    .find((s) => s.id === sessionId);
}

export function collectMergedRequirementContext(
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
        const parsedAction = parseStructuredActionFromPrompt(m.content);
        if (parsedAction?.kind === 'SYNTHESIZE_SRS') continue;
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

export function ensureCanonicalNineChapterSrsStructure(
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

  const resultLines = [cleaned];
  for (let idx = 1; idx <= 9; idx += 1) {
    if (!new RegExp(`^##\\s+${idx}\\.\\s+`, 'm').test(resultLines.join('\n'))) {
      const sectionMatch = fallbackMarkdown.match(
        new RegExp(`(^##\\s+${idx}\\.\\s+[\\s\\S]*?)(?=^##\\s+\\d+\\.\\s+|$)`, 'm'),
      );
      if (sectionMatch) {
        resultLines.push('', sectionMatch[1]!.trim());
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
        resultLines.push('', subMatch[1]!.trim());
      }
    }
  }
  return resultLines.join('\n');
}

export function buildDeterministicSrsMarkdown(
  store: WorkspaceStore,
  project: ProjectDetail,
  reqSession: RequirementSession | undefined,
  agentSession: AgentSession | undefined,
  locale: AgentLocale,
): string {
  const mergedCtx = collectMergedRequirementContext(store, project.id, reqSession, agentSession);
  const suite: OntologySuite = hasForeignDemoTemplate(project) ? {} : project.suite;
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
  const sessionIdRef = agentSession?.id ?? reqSession?.id ?? project.id;
  const sessionTitleRef = agentSession?.title ?? reqSession?.title ?? project.name;

  return locale === 'en-US'
    ? [
        `# ${project.name} — Software Requirements Specification (SRS.md)`,
        '',
        `> **Source Session**: \`${sessionIdRef}\` (${sessionTitleRef}) | **Domain**: ${project.domain} | **Standard**: Ontology Plus 11-Model Suite`,
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
          : [
              `- **Primary Domain Entity (\`${primaryAggName}\` / \`AGG-01\`)**: Governs core "${project.domain}" lifecycle states and invariants.`,
            ]),
        '',
        `## 4. Business Capabilities & Command/Query Behavior Specs (Aligned with M2)`,
        ...behaviorsList,
        '',
        `## 5. Cross-Object Business Rules, Validations & Calculations (Aligned with M3)`,
        ...(rulesList.length > 0
          ? rulesList
          : [
              `- **RULE-01**: Core \`${primaryAggName}\` domain invariants must be satisfied prior to state transition.`,
            ]),
        '',
        `## 6. Domain Events & Cross-Aggregate Scenarios (Aligned with ME / M4)`,
        ...(eventsAndScenarios.length > 0
          ? eventsAndScenarios
          : [
              `- **EVT-01 (\`${primaryAggName}.Completed\`)**: Published upon state transition to trigger downstream coordination.`,
            ]),
        '',
        `## 7. End-to-End Business Flows & Routing Branches (Aligned with M6)`,
        ...flowsList,
        '',
        `## 8. Analytical Query Reports & UI Screen Contracts (Aligned with M7 / MU)`,
        ...(reportsAndScreens.length > 0
          ? reportsAndScreens
          : [
              `- **QRY-01 / SCR-MAIN-LIST**: Multi-dimensional operational list query and status dashboard for "${project.domain}".`,
            ]),
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
          : [
              '- `[Confirmed]` Enforces two-tier 11-model ontology validation (Consistency Errors block release; Stage Warnings guide progressive completion).',
            ]),
        '',
      ].join('\n')
    : [
        `# ${project.name} — 需求规格说明书 (需求规格说明书.md)`,
        '',
        `> **来源会话**：\`${sessionIdRef}\`（${sessionTitleRef}） | **所属领域**：${project.domain} | **架构基准**：Ontology Plus 11 元模型标准`,
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
          : [
              `- **核心业务对象 (\`${primaryAggName}\` / \`AGG-01\`)**：承载「${project.domain}」全生命周期状态流转与核心不变式约束。`,
            ]),
        '',
        `## 4. 业务功能清单与命令/查询行为规约 (对齐 M2)`,
        ...behaviorsList,
        '',
        `## 5. 跨对象业务规则、校验与计算逻辑 (对齐 M3)`,
        ...(rulesList.length > 0
          ? rulesList
          : [
              `- **RULE-01**：核心对象 \`${primaryAggName}\` 关键业务属性与状态转换必须满足业务规则约束。`,
            ]),
        '',
        `## 6. 领域事件与跨聚合联动场景 (对齐 ME / M4)`,
        ...(eventsAndScenarios.length > 0
          ? eventsAndScenarios
          : [
              `- **EVT-01 (\`${primaryAggName}.Completed\`)**：关键业务动作完成后发布领域事件并触发下游业务联动（如库存扣减、积分累加或通知）。`,
            ]),
        '',
        `## 7. 端到端业务流程与网关分支 (对齐 M6)`,
        ...flowsList,
        '',
        `## 8. 统计查询报表与关键界面交互契约 (对齐 M7 / MU)`,
        ...(reportsAndScreens.length > 0
          ? reportsAndScreens
          : [
              `- **QRY-01 / SCR-MAIN-LIST**：提供「${project.domain}」多维筛选业务台账分页检索与运营看板。`,
            ]),
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
}

export function buildSemanticPrototypeHtmlForProject(
  project: ProjectDetail,
  doc?: RequirementDoc,
  prompt?: string,
): string {
  const isContractProject = /合同|contract|clm/i.test(`${project.name} ${project.domain}`);
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
    .map(
      (a) =>
        `<td>${a.type === 'Decimal' || a.type === 'Integer' || a.type === 'Money' ? '100,000' : a.label}</td>`,
    )
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
  const ruleAttr = pureValidationRule
    ? ` data-validate-ref="${pureValidationRule.id}"`
    : ' data-validate-ref="RULE-01"';

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

export interface LlmSynthesizedDomainBlueprint {
  aggregates?: {
    sourceQuote?: string;
    id?: string;
    name: string;
    alias?: string;
    lifecycle?: string[];
    attributes?: { name: string; label?: string; type?: string; required?: boolean }[];
  }[];
  behaviors?: {
    sourceQuote?: string;
    id?: string;
    name: string;
    alias?: string;
    ownerEntity?: string;
    behaviorType?: 'COMMAND' | 'QUERY';
  }[];
  rules?: {
    sourceQuote?: string;
    id?: string;
    name?: string;
    alias?: string;
    ruleType?: 'VALIDATION' | 'CALCULATION' | 'STATE_TRANSITION' | 'COORDINATION';
    referencedObjects?: string[];
    expression?: string;
    violationMessage?: string;
  }[];
  events?: {
    sourceQuote?: string;
    id?: string;
    name: string;
    label?: string;
    sourceAggregate?: string;
  }[];
  actors?: {
    sourceQuote?: string;
    actorId?: string;
    actorName?: string;
    actorType?: 'HUMAN' | 'SYSTEM' | 'EXTERNAL_ENTITY' | 'TIMER';
    roleId?: string;
    roleName?: string;
    roleCode?: string;
  }[];
  flows?: {
    sourceQuote?: string;
    id?: string;
    name: string;
    flowType?: 'APPROVAL' | 'COLLABORATION' | 'SCHEDULED';
    primaryAggregate?: string;
  }[];
  interfaces?: {
    sourceQuote?: string;
    interfaceId?: string;
    name: string;
    direction?: 'PROVIDED' | 'DEPENDENT';
    interfaceCategory?: 'COMMAND' | 'QUERY' | 'EVENT_SUB' | 'EXTERNAL_GATEWAY';
    protocol?: 'REST' | 'RPC' | 'MQ' | 'MCP';
    relatedEntityRef?: string;
  }[];
}

export function applyLlmBlueprintToSuite(
  baseSuite: OntologySuite,
  blueprint: LlmSynthesizedDomainBlueprint,
  domain: string,
  options?: { nonCollidingDocIds?: boolean },
): OntologySuite {
  let working: OntologySuite = JSON.parse(JSON.stringify(baseSuite));
  const docMode = Boolean(options?.nonCollidingDocIds);
  const nextDocId = (prefix: string, usedIds: Set<string>): string => {
    let n = 1;
    while (usedIds.has(`${prefix}-${String(n).padStart(2, '0')}`)) n += 1;
    const id = `${prefix}-${String(n).padStart(2, '0')}`;
    usedIds.add(id);
    return id;
  };
  const usedAggIds = new Set((baseSuite.M1?.aggregates ?? []).map((a) => a.id));
  const usedActorIds = new Set((baseSuite.M5?.actors ?? []).map((a) => a.id));
  const usedRoleIds = new Set((baseSuite.M5?.roles ?? []).map((r) => r.id));
  const usedBehIds = new Set((baseSuite.M2?.behaviors ?? []).map((b) => b.id));
  const usedRuleIds = new Set((baseSuite.M3?.rules ?? []).map((r) => r.id));
  const usedEvtIds = new Set((baseSuite.ME?.events ?? []).map((e) => e.id));
  const usedFlwIds = new Set((baseSuite.M6?.flows ?? []).map((f) => f.id));
  const usedIfIds = new Set((baseSuite.MI?.interfaces ?? []).map((i) => i.interfaceId));

  for (const [idx, agg] of (blueprint.aggregates ?? []).slice(0, 8).entries()) {
    if (!agg?.name) continue;
    const cleanName = agg.name.replace(/[^A-Za-z0-9_]/g, '');
    let aggId = agg.id || `AGG-0${idx + 1}`;
    if (docMode) {
      const existingByName = baseSuite.M1?.aggregates.find((a) => a.name === cleanName);
      if (existingByName) {
        aggId = existingByName.id;
      } else if (agg.id && !usedAggIds.has(agg.id)) {
        aggId = agg.id;
        usedAggIds.add(aggId);
      } else {
        aggId = nextDocId('AGG-DOC', usedAggIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_aggregate',
        {
          id: aggId,
          name: cleanName,
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
    const targetActorName = (act.actorName || act.roleName || '').trim();
    const targetRoleName = (act.roleName || act.actorName || '').trim();
    let actorId = act.actorId || `ACT-0${idx + 1}`;
    let roleId = act.roleId || `ROLE-0${idx + 1}`;
    if (docMode) {
      const existingActor = baseSuite.M5?.actors.find(
        (a) => a.name === targetActorName && (!act.actorId || a.id === act.actorId),
      );
      if (existingActor) {
        actorId = existingActor.id;
      } else if (act.actorId && !usedActorIds.has(act.actorId)) {
        actorId = act.actorId;
        usedActorIds.add(actorId);
      } else {
        actorId = nextDocId('ACT-DOC', usedActorIds);
      }

      const existingRole = baseSuite.M5?.roles.find(
        (r) => r.name === targetRoleName && (!act.roleId || r.id === act.roleId),
      );
      if (existingRole) {
        roleId = existingRole.id;
      } else if (act.roleId && !usedRoleIds.has(act.roleId)) {
        roleId = act.roleId;
        usedRoleIds.add(roleId);
      } else {
        roleId = nextDocId('ROLE-DOC', usedRoleIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_actor_role',
        {
          actorId,
          actorName: act.actorName || act.roleName,
          actorType: act.actorType || 'HUMAN',
          roleId,
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
    const cleanBehName = beh.name.replace(/[^A-Za-z0-9_]/g, '');
    let behId = beh.id || `BHV-0${idx + 1}`;
    if (docMode) {
      const existingBeh = baseSuite.M2?.behaviors.find(
        (b) => b.name === cleanBehName && (!beh.id || b.id === beh.id),
      );
      if (existingBeh) {
        behId = existingBeh.id;
      } else if (beh.id && !usedBehIds.has(beh.id)) {
        behId = beh.id;
        usedBehIds.add(behId);
      } else {
        behId = nextDocId('BHV-DOC', usedBehIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_behavior',
        {
          id: behId,
          name: cleanBehName,
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
    const cleanRuleName = (rl.name || `DomainRule0${idx + 1}`).replace(/[^A-Za-z0-9_]/g, '');
    let ruleId = rl.id || `RULE-0${idx + 1}`;
    if (docMode) {
      const existingRule = baseSuite.M3?.rules.find(
        (r) =>
          ((rl.name && r.name === cleanRuleName) || (rl.alias && r.alias === rl.alias)) &&
          (!rl.id || r.id === rl.id),
      );
      if (existingRule) {
        ruleId = existingRule.id;
      } else if (rl.id && !usedRuleIds.has(rl.id)) {
        ruleId = rl.id;
        usedRuleIds.add(ruleId);
      } else {
        ruleId = nextDocId('RULE-DOC', usedRuleIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_rule',
        {
          id: ruleId,
          name: cleanRuleName,
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
    let evtId = ev.id || `EVT-0${idx + 1}`;
    if (docMode) {
      const existingEv = baseSuite.ME?.events.find(
        (e) => e.name === ev.name && (!ev.id || e.id === ev.id),
      );
      if (existingEv) {
        evtId = existingEv.id;
      } else if (ev.id && !usedEvtIds.has(ev.id)) {
        evtId = ev.id;
        usedEvtIds.add(evtId);
      } else {
        evtId = nextDocId('EVT-DOC', usedEvtIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_event',
        {
          id: evtId,
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
    let flwId = fl.id || `FLW-0${idx + 1}`;
    if (docMode) {
      const existingFl = baseSuite.M6?.flows.find(
        (f) => f.name === fl.name && (!fl.id || f.id === fl.id),
      );
      if (existingFl) {
        flwId = existingFl.id;
      } else if (fl.id && !usedFlwIds.has(fl.id)) {
        flwId = fl.id;
        usedFlwIds.add(flwId);
      } else {
        flwId = nextDocId('FLW-DOC', usedFlwIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_flow',
        {
          id: flwId,
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
    let ifId = itf.interfaceId || `IF-0${idx + 1}`;
    if (docMode) {
      const existingItf = baseSuite.MI?.interfaces.find(
        (i) => i.name === itf.name && (!itf.interfaceId || i.interfaceId === itf.interfaceId),
      );
      if (existingItf) {
        ifId = existingItf.interfaceId;
      } else if (itf.interfaceId && !usedIfIds.has(itf.interfaceId)) {
        ifId = itf.interfaceId;
        usedIfIds.add(ifId);
      } else {
        ifId = nextDocId('IF-DOC', usedIfIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_interface',
        {
          interfaceId: ifId,
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

export function alignSuiteWithExtractedMu(
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
    suite.M5 = {
      model_type: 'ACTOR',
      version: '5.0',
      domain,
      actors: [],
      roles: [],
      permissions: [],
    };
  }
  if (!suite.M7) {
    suite.M7 = { model_type: 'QUERY_REPORT', version: '5.0', domain, query_reports: [] };
  }

  for (const screen of extractedMu.screens) {
    for (const el of screen.elements) {
      if (el.dataBinding && el.dataBinding.includes('.')) {
        const [aggName, attrRaw] = el.dataBinding.split('.');
        const attrName = (attrRaw ?? '').replace(/\[\d*\]/g, '').trim();
        const safeAggName = aggName ?? 'BusinessOrder';
        let agg = suite.M1.aggregates.find((a) => a.name === safeAggName || a.id === safeAggName);
        if (!agg) {
          agg = {
            id: `AGG-0${suite.M1.aggregates.length + 1}`,
            name: safeAggName,
            alias: `${safeAggName}聚合`,
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
      name: `${suite.M1.aggregates[0]!.name}AuditLog`,
      alias: `${suite.M1.aggregates[0]!.alias}履约记录`,
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

  const primaryAgg = suite.M1.aggregates[0]!;
  const secondaryAgg = suite.M1.aggregates[1] ?? primaryAgg;

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
                ? suite.M2.behaviors.find(
                    (b) =>
                      b.id === lastBehInChain &&
                      (!b.queryReportRef || b.queryReportRef === step.refId),
                  )
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
                  outputParameters: [
                    { name: 'rows', label: '列表', type: 'Array', required: true },
                  ],
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
                {
                  name: firstCol,
                  label: '单据编号',
                  sourceExpr: `t.${firstCol}`,
                  dataType: 'String',
                },
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

  for (const b of suite.M2.behaviors) {
    if (b.triggerType === 'USER_ACTION' && !muCalledBehaviorIds.has(b.id)) {
      b.triggerType = 'SYSTEM';
    }
  }

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

  if (!suite.M4 || suite.M4.event_scenarios.length === 0) {
    const firstEv = suite.ME.events[0]!;
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

  suite.MU = extractedMu;

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
                columnType:
                  at.type === 'Money' || at.type === 'Decimal' ? 'DECIMAL(18,2)' : 'VARCHAR(128)',
              })),
          },
        ],
      })),
    };
  }

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

export interface LiveAnalyticsComputedStats {
  totalContracts: number;
  totalAmount: number;
  settlementCompletionRatePct: string;
  highRiskOverdueRatePct: string;
  outsourcingHighRiskSharePct: string;
  midThresholdSharePct: string;
  residualSharePct: string;
}

export function computeLiveAnalyticsStats(store: WorkspaceStore): LiveAnalyticsComputedStats {
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

// ─── Domain Run OpenAI Function Tool Specs ───────────────────────────────────

export const DOMAIN_RUN_TOOL_NAMES = [
  'save_synthesized_srs_doc',
  'synthesize_ontology_suite',
  'save_tech_architecture_spec',
  'save_metric_insight',
  'save_scenario_attribution_report',
] as const;

export type DomainRunToolName = (typeof DOMAIN_RUN_TOOL_NAMES)[number];

export const DOMAIN_RUN_OPENAI_TOOLS: OpenAiFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'save_synthesized_srs_doc',
      description:
        'Persist a synthesized 9-chapter Software Requirements Specification (SRS.md / 需求规格说明书.md) into the project RequirementDoc registry, keeping canonical headings ## 1..9 and ### 9.1..9.7.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Document title (e.g. "Project Name — 需求规格说明书 v5.0")',
          },
          version: {
            type: 'string',
            description: 'Document version (e.g. "v5.0")',
          },
          docId: {
            type: 'string',
            description: 'Optional existing RequirementDoc ID to update',
          },
          status: {
            type: 'string',
            enum: ['DRAFT', 'CONFIRMED', 'PUBLISHED'],
          },
          content: {
            type: 'string',
            description:
              'Full 9-chapter Markdown SRS body strictly tailored to the project domain and session decisions (headings ## 1. through ## 9. and ### 9.1 through ### 9.7).',
          },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'synthesize_ontology_suite',
      description:
        'Synthesize, align, validate (via ontology-core two-tier validator), and persist the 11-model Ontology Suite (M1–M7, ME, MU, MM, MI) from the confirmed interactive prototype HTML and SRS/session blueprint.',
      parameters: {
        type: 'object',
        properties: {
          prototypeId: {
            type: 'string',
            description:
              'Optional target prototype ID; omit to synthesize from the project Confirmed Prototype Revision.',
          },
          docId: {
            type: 'string',
            description: 'Optional RequirementDoc ID providing domain specifications.',
          },
          aggregates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                alias: { type: 'string' },
                lifecycle: { type: 'array', items: { type: 'string' } },
                attributes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      label: { type: 'string' },
                      type: { type: 'string' },
                      required: { type: 'boolean' },
                    },
                    required: ['name'],
                  },
                },
              },
              required: ['name'],
            },
          },
          behaviors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                alias: { type: 'string' },
                ownerEntity: { type: 'string' },
                behaviorType: { type: 'string', enum: ['COMMAND', 'QUERY'] },
              },
              required: ['name'],
            },
          },
          rules: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                alias: { type: 'string' },
                ruleType: {
                  type: 'string',
                  enum: ['VALIDATION', 'CALCULATION', 'STATE_TRANSITION', 'COORDINATION'],
                },
                referencedObjects: { type: 'array', items: { type: 'string' } },
                expression: { type: 'string' },
                violationMessage: { type: 'string' },
              },
            },
          },
          events: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                label: { type: 'string' },
                sourceAggregate: { type: 'string' },
              },
              required: ['name'],
            },
          },
          actors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                actorId: { type: 'string' },
                actorName: { type: 'string' },
                actorType: {
                  type: 'string',
                  enum: ['HUMAN', 'SYSTEM', 'EXTERNAL_ENTITY', 'TIMER'],
                },
                roleId: { type: 'string' },
                roleName: { type: 'string' },
                roleCode: { type: 'string' },
              },
            },
          },
          flows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                flowType: { type: 'string', enum: ['APPROVAL', 'COLLABORATION', 'SCHEDULED'] },
                primaryAggregate: { type: 'string' },
              },
              required: ['name'],
            },
          },
          interfaces: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                interfaceId: { type: 'string' },
                name: { type: 'string' },
                direction: { type: 'string', enum: ['PROVIDED', 'DEPENDENT'] },
                interfaceCategory: {
                  type: 'string',
                  enum: ['COMMAND', 'QUERY', 'EVENT_SUB', 'EXTERNAL_GATEWAY'],
                },
                protocol: { type: 'string', enum: ['REST', 'RPC', 'MQ', 'MCP'] },
                relatedEntityRef: { type: 'string' },
              },
              required: ['name'],
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_tech_architecture_spec',
      description:
        'Persist a generated Technical Architecture Specification Markdown asset (layer=TECH_ARCH) into the 4-layer architecture library and optionally bind it to an AssembledApplication.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Architecture asset name' },
          stackTags: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
          version: { type: 'string' },
          applicationId: {
            type: 'string',
            description: 'Optional AssembledApplication ID whose techArchAssetId should be updated',
          },
          specMarkdown: {
            type: 'string',
            description:
              'Complete Markdown technical architecture specification mapping M1–MI to domain/application/infrastructure/interface layers.',
          },
        },
        required: ['name', 'specMarkdown'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_metric_insight',
      description:
        'Persist an AI anomaly driver insight grounded in live SQLite query rows for a registered MetricDefinition.',
      parameters: {
        type: 'object',
        properties: {
          metricId: { type: 'string', description: 'Metric ID or code (e.g. MET-01)' },
          insightMarkdown: {
            type: 'string',
            description: 'Concise Markdown insight grounded in live SQLite query rows',
          },
          anomalyDrivers: {
            type: 'array',
            items: { type: 'string' },
            description: '2-4 concrete anomaly driver bullets citing queried figures',
          },
          suggestedAction: {
            type: 'string',
            description: 'Concrete closed-loop remediation action',
          },
          writebackInterfaceId: {
            type: 'string',
            description: 'Bound WritebackInterface ID (e.g. WB-01)',
          },
        },
        required: ['metricId', 'insightMarkdown', 'anomalyDrivers', 'suggestedAction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_scenario_attribution_report',
      description:
        'Persist a multi-factor scenario attribution report grounded in live SQLite query results and M3/M4 ontology chains into the AnalyticsReport registry.',
      parameters: {
        type: 'object',
        properties: {
          scenarioId: { type: 'string', description: 'AnalyticsScenario ID (e.g. ASCN-01)' },
          title: { type: 'string' },
          summary: { type: 'string' },
          attributionMarkdown: {
            type: 'string',
            description: 'Complete Markdown attribution report',
          },
          causalBreakdown: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                factor: { type: 'string' },
                weight: { type: 'string' },
                evidence: { type: 'string' },
              },
              required: ['factor', 'weight', 'evidence'],
            },
          },
          recommendedWritebackId: { type: 'string' },
          saveAsReport: { type: 'boolean' },
        },
        required: ['scenarioId', 'attributionMarkdown', 'causalBreakdown'],
      },
    },
  },
];

// ─── Deterministic Mock Tool Argument Builders (ONLY used when isMock === true) ─

export function buildMockTechArchMarkdown(
  name: string,
  stackTags: string[],
  extraPrompt: string | undefined,
  locale: AgentLocale,
): string {
  const tags =
    stackTags.length > 0
      ? stackTags
      : ['DDD', 'Deep Modules', '11-Model Mapping', 'SQLite / D1'];
  return locale === 'en-US'
    ? [
        `# Technical Architecture Specification — ${name}`,
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
        `- ${extraPrompt || 'Enforces deep-module entry boundaries (dependency-cruiser) and evaluates M3 compliance rules prior to every mutation.'}`,
      ].join('\n')
    : [
        `# 技术架构设计文档 — ${name}`,
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
        `- ${extraPrompt || '强制执行深模块入口边界检查（dependency-cruiser），所有写操作前置执行 M3 合规门禁。'}`,
      ].join('\n');
}

export function buildMockMetricInsightToolArgs(
  store: WorkspaceStore,
  metricIdParam: string | undefined,
  locale: AgentLocale,
): Record<string, unknown> {
  const metrics = store.listMetrics();
  const metric =
    (metricIdParam
      ? metrics.find((m) => m.id === metricIdParam || m.code === metricIdParam)
      : undefined) ?? metrics[0];
  if (!metric) {
    return {
      metricId: metricIdParam || 'MET-01',
      insightMarkdown: '',
      anomalyDrivers: [],
      suggestedAction: '',
    };
  }
  const defaultWbId = store.listWritebackInterfaces()[0]?.id ?? 'WB-01';
  const liveStats = computeLiveAnalyticsStats(store);
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
    locale === 'en-US'
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
        ].join('\n');

  return {
    metricId: metric.id,
    insightMarkdown,
    anomalyDrivers,
    suggestedAction,
    writebackInterfaceId: defaultWbId,
  };
}

export function buildMockScenarioAttributionToolArgs(
  store: WorkspaceStore,
  scenarioIdParam: string | undefined,
  questionParam: string | undefined,
  saveAsReport: boolean,
  locale: AgentLocale,
): Record<string, unknown> {
  const scenarios = store.listAnalyticsScenarios();
  const scenario =
    (scenarioIdParam ? scenarios.find((s) => s.id === scenarioIdParam) : undefined) ?? scenarios[0];
  if (!scenario) {
    return {
      scenarioId: scenarioIdParam || 'ASCN-01',
      attributionMarkdown: '',
      causalBreakdown: [],
      saveAsReport,
    };
  }
  const liveStats = computeLiveAnalyticsStats(store);
  const defaultWbId = store.listWritebackInterfaces()[0]?.id ?? 'WB-01';
  const writebackId = scenario.writebackInterfaceId || defaultWbId;
  const focusQuestion =
    questionParam?.trim() ||
    pickLocaleText(
      locale,
      `分析「${scenario.name}」的触发根因与闭环处置方案`,
      `Analyze root causes and closed-loop remediation for "${scenario.name}"`,
    );
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
        `SQLite 实查交叉统计（共 ${liveStats.totalContracts} 份合同分群）`,
        `Live SQLite cross-tabulation (${liveStats.totalContracts} contract records)`,
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
          '',
          `## 二、闭环策略建议与业务回写`,
          ...scenario.recommendedActions.map((act) => `- ${act}`),
          `- **绑定回写接口**：\`${writebackId}\``,
        ].join('\n');

  return {
    scenarioId: scenario.id,
    title: pickLocaleText(
      locale,
      `${scenario.name} — 智能归因报告`,
      `${scenario.name} — Attribution Report`,
    ),
    summary: pickLocaleText(
      locale,
      `针对触发条件 ${scenario.triggerCondition} 完成实查穿透，主因贡献度 ${liveStats.outsourcingHighRiskSharePct}，建议通过 ${writebackId} 执行业务回写。`,
      `Completed live root-cause drill-down for ${scenario.triggerCondition}; top driver accounts for ${liveStats.outsourcingHighRiskSharePct}; recommend writeback via ${writebackId}.`,
    ),
    attributionMarkdown,
    causalBreakdown,
    recommendedWritebackId: writebackId,
    saveAsReport,
  };
}

// ─── Domain Run Tool Executor ────────────────────────────────────────────────

export interface DomainToolExecutionResult {
  trace: AgentToolCallTrace;
  toolResultContent: string;
  isError: boolean;
  artifact?: AgentDomainArtifact;
}

export function executeDomainRunToolCall(
  store: WorkspaceStore,
  session: AgentSession,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  locale: AgentLocale,
): DomainToolExecutionResult | null {
  const started = Date.now();

  // 1. SRS Synthesis (`REQUIREMENT` session)
  if (toolName === 'save_synthesized_srs_doc') {
    const project = store.getProject(session.projectId);
    if (!project) {
      throw new Error(`Project not found: ${session.projectId}`);
    }
    const rawContent = typeof args.content === 'string' ? stripMarkdownFence(args.content).trim() : '';
    if (!rawContent) {
      const msg = pickLocaleText(
        locale,
        'SRS 正文内容为空，请提供完整的 9 章节 Markdown 需求规格说明书。',
        'SRS content is empty; provide the full 9-chapter Markdown specification.',
      );
      return {
        trace: {
          id: toolCallId,
          toolName,
          arguments: args,
          output: msg,
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({ error: msg }),
        isError: true,
      };
    }

    let reqSession =
      findRequirementSessionOptional(store, session.targetId) ??
      store.listRequirementSessions(project.id)[0];
    if (!reqSession) {
      reqSession = store.createRequirementSession({
        projectId: project.id,
        title: session.title || pickLocaleText(locale, '需求探索会话', 'Requirement Session'),
      });
    }

    const mergedCtx = collectMergedRequirementContext(store, project.id, reqSession, session);
    const structuralBaseline = buildDeterministicSrsMarkdown(
      store,
      project,
      reqSession,
      session,
      locale,
    );
    const srsMarkdown = ensureCanonicalNineChapterSrsStructure(rawContent, structuralBaseline);

    const existingDocs = store.listRequirementDocs(project.id);
    const explicitDocId =
      typeof args.docId === 'string' && args.docId.trim() ? args.docId.trim() : undefined;
    const reusedExistingDoc = Boolean(
      explicitDocId && existingDocs.some((d) => d.id === explicitDocId),
    );
    const version =
      (typeof args.version === 'string' && args.version.trim()) ||
      `v5.${reusedExistingDoc ? Math.max(0, existingDocs.length - 1) : existingDocs.length}`;
    const defaultTitle =
      locale === 'en-US'
        ? `${project.name} — Software Requirements Specification (SRS.md ${version})`
        : `${project.name} — 需求规格说明书 (需求规格说明书.md ${version})`;
    const docId = explicitDocId || `req-doc-${project.id}-${Date.now().toString(36)}`;
    const resolvedTitle =
      (typeof args.title === 'string' && args.title.trim()) || defaultTitle;
    const resolvedStatus: RequirementDoc['status'] =
      args.status === 'DRAFT' || args.status === 'PUBLISHED' ? args.status : 'CONFIRMED';

    const doc = store.saveRequirementDoc({
      id: docId,
      projectId: project.id,
      title: resolvedTitle,
      version,
      status: resolvedStatus,
      content: srsMarkdown,
    });

    const confirmNote = pickLocaleText(
      locale,
      `已将当前需求探索会话合成为标准 9 章节《需求规格说明书.md》（含 9.1~9.7 完整治理子项），文档 ID：\`${doc.id}\`。`,
      `Synthesized canonical 9-chapter Software Requirements Specification (including 9.1–9.7 governance checklist), Doc ID: \`${doc.id}\`.`,
    );

    store.appendRequirementMessage(
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

    return {
      trace: {
        id: toolCallId,
        toolName,
        arguments: {
          docId: doc.id,
          title: doc.title,
          version: doc.version,
          status: doc.status,
          chars: srsMarkdown.length,
        },
        output: pickLocaleText(
          locale,
          `已落库标准 9 章节《${doc.title}》（${srsMarkdown.length.toLocaleString()} 字，状态 ${doc.status}）`,
          `Saved canonical 9-chapter "${doc.title}" (${srsMarkdown.length.toLocaleString()} chars, ${doc.status})`,
        ),
        isError: false,
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify({
        docId: doc.id,
        title: doc.title,
        version: doc.version,
        status: doc.status,
        chars: srsMarkdown.length,
      }),
      isError: false,
      artifact: {
        kind: 'REQUIREMENT_DOC',
        docId: doc.id,
        title: doc.title,
        version: doc.version,
        status: doc.status,
      },
    };
  }

  // 2. 11-Model Ontology Suite Synthesis (`COPILOT` session)
  if (toolName === 'synthesize_ontology_suite') {
    let project = store.getProject(session.projectId);
    if (!project) {
      throw new Error(`Project not found: ${session.projectId}`);
    }

    const explicitPrototypeId =
      typeof args.prototypeId === 'string' && args.prototypeId.trim()
        ? args.prototypeId.trim()
        : undefined;
    const explicitDocId =
      typeof args.docId === 'string' && args.docId.trim() ? args.docId.trim() : undefined;

    let targetProto: PrototypeArtifact | undefined;
    if (explicitPrototypeId) {
      targetProto = store.getPrototype(explicitPrototypeId);
      if (!targetProto) {
        throw new Error(`Prototype not found: ${explicitPrototypeId}`);
      }
    } else {
      const confirmed = store.getConfirmedPrototypeRevision(project.id);
      if (confirmed) {
        targetProto = {
          ...confirmed.prototype,
          htmlContent: confirmed.htmlContent,
          extractedScreenCount: confirmed.revision.extractedScreenCount,
        };
      } else if (store.listPrototypes(project.id).length > 0) {
        throw new Error(
          `Project "${project.name}" has unconfirmed prototype(s) but no Confirmed Revision. Confirm a prototype revision before synthesizing the Ontology Suite.`,
        );
      }
    }

    if (!targetProto) {
      const docs = store.listRequirementDocs(project.id);
      const doc = explicitDocId ? docs.find((d) => d.id === explicitDocId) : docs[0];
      const htmlContent = buildSemanticPrototypeHtmlForProject(project, doc);
      const protoTitle =
        locale === 'en-US'
          ? `${project.name} · Interactive Prototype (prototype.html)`
          : `${project.name} · 语义交互原型 (界面原型.html)`;
      const created = store.createPrototype(project.id, {
        name: protoTitle,
        version: 'v5.0',
        htmlContent,
        source: 'GENERATED',
      });
      const confirmedGen = store.confirmPrototypeRevision(
        project.id,
        created.prototype.currentRevisionId,
      );
      targetProto = {
        ...confirmedGen.prototype,
        htmlContent: confirmedGen.confirmed.htmlContent,
        extractedScreenCount: confirmedGen.confirmed.revision.extractedScreenCount,
      };
      project = confirmedGen.project;
    }

    let seedSuite: OntologySuite = hasForeignDemoTemplate(project)
      ? {}
      : JSON.parse(JSON.stringify(project.suite));

    const blueprint: LlmSynthesizedDomainBlueprint = {
      ...(Array.isArray(args.aggregates)
        ? { aggregates: args.aggregates as LlmSynthesizedDomainBlueprint['aggregates'] }
        : {}),
      ...(Array.isArray(args.behaviors)
        ? { behaviors: args.behaviors as LlmSynthesizedDomainBlueprint['behaviors'] }
        : {}),
      ...(Array.isArray(args.rules)
        ? { rules: args.rules as LlmSynthesizedDomainBlueprint['rules'] }
        : {}),
      ...(Array.isArray(args.events)
        ? { events: args.events as LlmSynthesizedDomainBlueprint['events'] }
        : {}),
      ...(Array.isArray(args.actors)
        ? { actors: args.actors as LlmSynthesizedDomainBlueprint['actors'] }
        : {}),
      ...(Array.isArray(args.flows)
        ? { flows: args.flows as LlmSynthesizedDomainBlueprint['flows'] }
        : {}),
      ...(Array.isArray(args.interfaces)
        ? { interfaces: args.interfaces as LlmSynthesizedDomainBlueprint['interfaces'] }
        : {}),
    };

    const hasBlueprintElements = Boolean(
      (blueprint.aggregates && blueprint.aggregates.length > 0) ||
        (blueprint.behaviors && blueprint.behaviors.length > 0) ||
        (blueprint.rules && blueprint.rules.length > 0) ||
        (blueprint.events && blueprint.events.length > 0) ||
        (blueprint.actors && blueprint.actors.length > 0) ||
        (blueprint.flows && blueprint.flows.length > 0) ||
        (blueprint.interfaces && blueprint.interfaces.length > 0),
    );

    if (hasBlueprintElements) {
      seedSuite = applyLlmBlueprintToSuite(seedSuite, blueprint, project.domain);
    }

    const currentWithSyncedMu: OntologySuite = {
      ...JSON.parse(JSON.stringify(seedSuite)),
      MU: extractMuFromPrototypeHtml(targetProto.htmlContent, project.domain),
    };
    const currentCheck = validateOntologySuite(currentWithSyncedMu);

    const candidateSuite: OntologySuite =
      currentCheck.errorCount === 0 && currentCheck.presentModels.length === 11
        ? currentWithSyncedMu
        : alignSuiteWithExtractedMu(seedSuite, targetProto.htmlContent, project.domain);

    const finalValidation = validateOntologySuite(candidateSuite);
    if (finalValidation.errorCount > 0) {
      const firstErr = finalValidation.diagnostics.find((d) => d.tier === 'ERROR');
      const rejectMsg = pickLocaleText(
        locale,
        `11 模型两级一致性校验拦截（${finalValidation.errorCount} 个错误）：${firstErr?.messageZh ?? '跨模型引用不一致'}`,
        `Rejected by 11-model validator (${finalValidation.errorCount} consistency errors): ${firstErr?.messageEn ?? 'cross-model reference mismatch'}`,
      );
      return {
        trace: {
          id: toolCallId,
          toolName,
          arguments: { prototypeId: targetProto.id },
          output: rejectMsg,
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({
          status: 'REJECTED_BY_VALIDATOR',
          errorCount: finalValidation.errorCount,
          diagnostics: finalValidation.diagnostics.filter((d) => d.tier === 'ERROR').slice(0, 6),
        }),
        isError: true,
      };
    }

    const updatedProject = store.updateSuite(
      project.id,
      candidateSuite,
      `Synthesized 11-model ontology suite from prototype ${targetProto.id}`,
    );
    const synthesizedModels = MODEL_CODES.filter((c) => Boolean(updatedProject.suite[c]));

    return {
      trace: {
        id: toolCallId,
        toolName,
        arguments: {
          prototypeId: targetProto.id,
          synthesizedModels,
        },
        output: pickLocaleText(
          locale,
          `已合成并通过两级门禁校验 ${synthesizedModels.length}/11 个元模型（${updatedProject.validation.errorCount} 错误，${updatedProject.validation.warningCount} 阶段提示）`,
          `Synthesized and validated ${synthesizedModels.length}/11 ontology models (${updatedProject.validation.errorCount} errors, ${updatedProject.validation.warningCount} stage warnings)`,
        ),
        isError: false,
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify({
        projectId: updatedProject.id,
        prototypeId: targetProto.id,
        synthesizedModels,
        errorCount: updatedProject.validation.errorCount,
        warningCount: updatedProject.validation.warningCount,
      }),
      isError: false,
      artifact: {
        kind: 'ONTOLOGY_SUITE',
        projectId: updatedProject.id,
        prototypeId: targetProto.id,
        modelCount: synthesizedModels.length,
        errorCount: updatedProject.validation.errorCount,
        warningCount: updatedProject.validation.warningCount,
      },
    };
  }

  // 3. Technical Architecture Specification (`CODING` session)
  if (toolName === 'save_tech_architecture_spec') {
    const project = store.getProject(session.projectId);
    const name =
      (typeof args.name === 'string' && args.name.trim()) ||
      `${project?.name ?? 'Ontology'} ${pickLocaleText(locale, '技术架构设计文档', 'Technical Architecture Spec')}`;
    const rawSpec =
      typeof args.specMarkdown === 'string' && args.specMarkdown.trim()
        ? args.specMarkdown
        : typeof args.content === 'string'
          ? args.content
          : '';
    const specMarkdown = rawSpec ? stripMarkdownFence(rawSpec).trim() : '';
    if (!specMarkdown) {
      const msg = pickLocaleText(
        locale,
        '技术架构规范正文 specMarkdown 不能为空。',
        'Technical architecture specMarkdown cannot be empty.',
      );
      return {
        trace: {
          id: toolCallId,
          toolName,
          arguments: args,
          output: msg,
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({ error: msg }),
        isError: true,
      };
    }

    const rawTags = Array.isArray(args.stackTags)
      ? args.stackTags.map(String).map((t) => t.trim()).filter(Boolean)
      : [];
    const tags =
      rawTags.length > 0
        ? rawTags
        : ['DDD', 'Deep Modules', '11-Model Mapping', 'SQLite / D1'];
    const version =
      (typeof args.version === 'string' && args.version.trim()) || 'v5.0';
    const summary =
      (typeof args.summary === 'string' && args.summary.trim()) ||
      pickLocaleText(
        locale,
        `基于 [${tags.join(', ')}] 的 11 元模型深模块技术架构规范`,
        `11-Model deep-module technical architecture based on [${tags.join(', ')}]`,
      );

    const asset = store.saveFourLayerAsset({
      id: `asset-arch-${Date.now().toString(36)}`,
      layer: 'TECH_ARCH',
      name,
      version,
      summary,
      tags,
      specMarkdown,
    });

    const explicitAppId =
      typeof args.applicationId === 'string' && args.applicationId.trim()
        ? args.applicationId.trim()
        : undefined;
    let boundAppId: string | undefined;
    if (explicitAppId) {
      const targetApp = store.listAssembledApplications().find((a) => a.id === explicitAppId);
      if (targetApp) {
        store.saveAssembledApplication({
          ...targetApp,
          techArchAssetId: asset.id,
        });
        boundAppId = targetApp.id;
      }
    }

    return {
      trace: {
        id: toolCallId,
        toolName,
        arguments: {
          assetId: asset.id,
          name: asset.name,
          tags: asset.tags,
          ...(boundAppId ? { applicationId: boundAppId } : {}),
        },
        output: pickLocaleText(
          locale,
          `已生成并入库 TECH_ARCH 四层资产《${asset.name}》（${asset.id}）`,
          `Saved TECH_ARCH 4-layer asset "${asset.name}" (${asset.id})`,
        ),
        isError: false,
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify({
        assetId: asset.id,
        name: asset.name,
        version: asset.version,
        tags: asset.tags,
        ...(boundAppId ? { applicationId: boundAppId } : {}),
      }),
      isError: false,
      artifact: {
        kind: 'TECH_ARCH_ASSET',
        assetId: asset.id,
        name: asset.name,
        version: asset.version,
        tags: asset.tags,
        ...(boundAppId ? { applicationId: boundAppId } : {}),
      },
    };
  }

  // 4. Metric Anomaly Insight (`REASONING` session)
  if (toolName === 'save_metric_insight') {
    const metricIdArg = typeof args.metricId === 'string' ? args.metricId.trim() : '';
    const metrics = store.listMetrics();
    const metric =
      (metricIdArg
        ? metrics.find((m) => m.id === metricIdArg || m.code === metricIdArg)
        : undefined) ?? metrics[0];
    if (!metric) {
      throw new Error(`Metric not found: ${metricIdArg || '(empty)'}`);
    }

    const insightMarkdown =
      typeof args.insightMarkdown === 'string' ? args.insightMarkdown.trim() : '';
    const anomalyDrivers = Array.isArray(args.anomalyDrivers)
      ? args.anomalyDrivers.map(String).map((d) => d.trim()).filter(Boolean)
      : [];
    const suggestedAction =
      typeof args.suggestedAction === 'string' ? args.suggestedAction.trim() : '';

    if (!insightMarkdown || anomalyDrivers.length === 0 || !suggestedAction) {
      const msg = pickLocaleText(
        locale,
        'save_metric_insight 缺少必填的实查洞察正文、异动驱动因子或建议动作。',
        'save_metric_insight requires non-empty insightMarkdown, anomalyDrivers, and suggestedAction.',
      );
      return {
        trace: {
          id: toolCallId,
          toolName,
          arguments: args,
          output: msg,
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({ error: msg }),
        isError: true,
      };
    }

    const defaultWbId = store.listWritebackInterfaces()[0]?.id ?? 'WB-01';
    const writebackInterfaceId =
      (typeof args.writebackInterfaceId === 'string' && args.writebackInterfaceId.trim()) ||
      defaultWbId;

    store.saveReasoningSession({
      id: `reas-metric-${metric.id.toLowerCase()}-${Date.now().toString(36)}`,
      question: pickLocaleText(
        locale,
        `指标异动洞察：${metric.name} (${metric.code})`,
        `Metric Insight: ${metric.name} (${metric.code})`,
      ),
      mode: 'ASK_WHY',
      sqlGenerated: '',
      dataSummary: [
        {
          label: metric.name,
          value: metric.currentValue,
          delta: metric.yoYChange,
        },
      ],
      causalAnalysis: anomalyDrivers,
      policyRecommendations: [
        {
          actionTitle: suggestedAction,
          targetObject: metric.linkedAggregate,
          expectedImpact: pickLocaleText(
            locale,
            `针对指标 ${metric.code} 关联聚合根执行闭环管控`,
            `Closed-loop governance for ${metric.code} linked aggregate`,
          ),
          writebackInterfaceId,
        },
      ],
      answerMarkdown: insightMarkdown,
    });

    return {
      trace: {
        id: toolCallId,
        toolName,
        arguments: {
          metricId: metric.id,
          metricCode: metric.code,
          driversCount: anomalyDrivers.length,
          writebackInterfaceId,
        },
        output: pickLocaleText(
          locale,
          `已生成指标「${metric.name} (${metric.code})」的 ${anomalyDrivers.length} 项实查异动归因与回写建议 (${writebackInterfaceId})`,
          `Saved ${anomalyDrivers.length} anomaly drivers and writeback recommendation (${writebackInterfaceId}) for metric ${metric.code}`,
        ),
        isError: false,
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify({
        metricId: metric.id,
        metricCode: metric.code,
        metricName: metric.name,
        anomalyDrivers,
        suggestedAction,
        writebackInterfaceId,
      }),
      isError: false,
      artifact: {
        kind: 'METRIC_INSIGHT',
        metricId: metric.id,
        metricCode: metric.code,
        metricName: metric.name,
        insightMarkdown,
        anomalyDrivers,
        suggestedAction,
        writebackInterfaceId,
      },
    };
  }

  // 5. Scenario Attribution Report (`REASONING` session)
  if (toolName === 'save_scenario_attribution_report') {
    const scenarioIdArg = typeof args.scenarioId === 'string' ? args.scenarioId.trim() : '';
    const scenarios = store.listAnalyticsScenarios();
    const scenario =
      (scenarioIdArg ? scenarios.find((s) => s.id === scenarioIdArg) : undefined) ?? scenarios[0];
    if (!scenario) {
      throw new Error(`Analytics scenario not found: ${scenarioIdArg || '(empty)'}`);
    }

    const attributionMarkdown =
      typeof args.attributionMarkdown === 'string'
        ? stripMarkdownFence(args.attributionMarkdown).trim()
        : '';
    const rawBreakdown = Array.isArray(args.causalBreakdown) ? args.causalBreakdown : [];
    const causalBreakdown: { factor: string; weight: string; evidence: string }[] = rawBreakdown
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const rec = item as Record<string, unknown>;
        const factor = typeof rec.factor === 'string' ? rec.factor.trim() : '';
        const weight = typeof rec.weight === 'string' ? rec.weight.trim() : '';
        const evidence = typeof rec.evidence === 'string' ? rec.evidence.trim() : '';
        return factor ? { factor, weight: weight || '—', evidence: evidence || 'SQLite' } : null;
      })
      .filter((x): x is { factor: string; weight: string; evidence: string } => Boolean(x));

    if (!attributionMarkdown || causalBreakdown.length === 0) {
      const msg = pickLocaleText(
        locale,
        'save_scenario_attribution_report 缺少归因报告正文 attributionMarkdown 或因果权重拆解 causalBreakdown。',
        'save_scenario_attribution_report requires non-empty attributionMarkdown and causalBreakdown.',
      );
      return {
        trace: {
          id: toolCallId,
          toolName,
          arguments: args,
          output: msg,
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({ error: msg }),
        isError: true,
      };
    }

    const defaultWbId = store.listWritebackInterfaces()[0]?.id ?? 'WB-01';
    const writebackId =
      (typeof args.recommendedWritebackId === 'string' && args.recommendedWritebackId.trim()) ||
      scenario.writebackInterfaceId ||
      defaultWbId;
    const reportTitle =
      (typeof args.title === 'string' && args.title.trim()) ||
      pickLocaleText(
        locale,
        `${scenario.name} — 智能归因报告`,
        `${scenario.name} — Attribution Report`,
      );
    const reportSummary =
      (typeof args.summary === 'string' && args.summary.trim()) ||
      pickLocaleText(
        locale,
        `针对触发条件 ${scenario.triggerCondition} 完成实查穿透，主因「${causalBreakdown[0]!.factor}」贡献权重 ${causalBreakdown[0]!.weight}，建议通过 ${writebackId} 执行业务回写。`,
        `Completed live root-cause drill-down for ${scenario.triggerCondition}; top driver "${causalBreakdown[0]!.factor}" accounts for ${causalBreakdown[0]!.weight}; recommend writeback via ${writebackId}.`,
      );

    const shouldSaveReport = args.saveAsReport !== false;
    let savedReport: AnalyticsReport | undefined;
    if (shouldSaveReport) {
      savedReport = store.saveAnalyticsReport({
        id: `arpt-${Date.now().toString(36)}`,
        title: reportTitle,
        period: new Date().toISOString().slice(0, 7),
        author: pickLocaleText(
          locale,
          '数据本体归因智能体 (Scenario Attribution Agent)',
          'Scenario Attribution Agent',
        ),
        summary: reportSummary,
        markdownContent: attributionMarkdown,
      });
    }

    const reportId = savedReport?.id ?? `arpt-preview-${scenario.id}`;

    return {
      trace: {
        id: toolCallId,
        toolName,
        arguments: {
          scenarioId: scenario.id,
          reportId,
          factorsCount: causalBreakdown.length,
          recommendedWritebackId: writebackId,
        },
        output: savedReport
          ? pickLocaleText(
              locale,
              `已完成场景「${scenario.name}」多因子归因并归档分析报告《${savedReport.title}》（${savedReport.id}）`,
              `Completed attribution for "${scenario.name}" and archived report "${savedReport.title}" (${savedReport.id})`,
            )
          : pickLocaleText(
              locale,
              `已完成场景「${scenario.name}」多因子归因拆解`,
              `Completed multi-factor attribution breakdown for "${scenario.name}"`,
            ),
        isError: false,
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        reportId,
        title: reportTitle,
        recommendedWritebackId: writebackId,
        causalBreakdown,
      }),
      isError: false,
      artifact: {
        kind: 'ANALYTICS_REPORT',
        reportId,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        title: reportTitle,
        recommendedWritebackId: writebackId,
        causalBreakdown,
      },
    };
  }

  return null;
}
