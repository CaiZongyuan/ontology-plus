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
  PROJECT_STEP_NAMES,
  type ProjectStepId,
} from '../../business-vocabulary/index.js';
import {
  MODEL_CODES,
  checkSqlGrounding,
  createPrototypeLiveTracker,
  validateOntologySuite,
  type ModelCode,
  type OntologySuite,
  type PrototypeLiveEvent,
} from '../../ontology-core/index.js';
import {
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
  type AgentSubagentLaneTrace,
  type AgentToolCallTrace,
  type DesignBrief,
  type InteractivePrototype,
  type LlmProviderConfig,
  type ProjectDetail,
  type PrototypeTargetAnchor,
  type StepHandoffOrigin,
  type StepHandoffProposal,
  type WorkspaceStore,
} from '../../workspace-store/index.js';
import {
  type AgentLocale,
  pickLocaleText,
  resolveEffectiveLocale,
} from './locale.js';
import {
  DOMAIN_RUN_OPENAI_TOOLS,
  buildDeterministicSrsMarkdown,
  buildMockMetricInsightToolArgs,
  buildMockScenarioAttributionToolArgs,
  buildMockTechArchMarkdown,
  executeDomainRunToolCall,
  extractJsonObjectFromText,
  findRequirementSessionOptional,
  parseStructuredActionFromPrompt,
  resolveAgentTurnRunId,
  type LlmSynthesizedDomainBlueprint,
} from './domain-run-tools.js';
import {
  PROTOTYPE_ANCHOR_OPENAI_TOOLS,
  editPrototypeAnchor,
  initPrototypeShell,
  listPrototypeAnchors,
  readPrototypeAnchor,
  rewritePrototypePage,
  upsertPrototypeScreen,
  type InitPrototypeShellInput,
  type PartialPrototypeScreenInput,
  type PrototypeAnchorEditOperation,
  type PrototypeShellScreenStub,
} from './prototype-anchor-tools.js';
import {
  CODEMODE_OPENAI_TOOL,
  SPAWN_SUBAGENTS_OPENAI_TOOL,
  renderCodemodePromptSection,
  resolveSessionCodeModeEnabled,
  resolveSessionMultiAgentConcurrency,
  runCodemodeScript,
  runParallelSubagents,
  type SubagentTaskSpec,
} from './codemode-subagent.js';
import {
  MOCK_PROTOTYPE_BUILD_TOKENS_PER_SECOND,
  createMockPrototypeBuildReplay,
} from './mock-prototype-build.js';
import {
  createCoalescingRunEventBuffer,
  prototypeLiveCoalesceKey,
  type CoalescingRunEventBuffer,
} from './run-event-buffer.js';
import {
  buildProjectDataGrounding,
  describeGroundingRefusal,
  describeJoinWarnings,
  renderDataGrounding,
} from './reasoning-grounding.js';
import {
  readApplicationSpecificationInputs,
  resolveSessionApplication,
} from './application-specification.js';
import {
  ONTOLOGY_DURABLE_TOOLS,
  ONTOLOGY_TOOL_NAMES,
  OPENAI_ONTOLOGY_TOOLS,
  applyOntologyToolCall,
  durableMemoryStorage,
  type OntologyToolName,
  type OpenAiFunctionTool,
} from './tools.js';
import {
  allocateTurnRunIdentity,
  deriveProjectStepForSessionKind,
  invokeAgentRunEndHooks,
  invokeAgentRunStartHooks,
  nextAgentMessageId,
  type AgentRunContext,
  type AgentRunFailureInfo,
  type AgentRunLifecycleHooks,
  type AgentRunOutcome,
  type AllocatedTurnRunIdentity,
} from './run-lifecycle.js';

// ─── Gateway Error & Explicit Mock Boundary (ADR-0007) ───────────────────────

import { LlmGatewayError, isMockLlmActive } from './gateway-boundary.js';
export { LlmGatewayError, isMockLlmActive };

function resolveProjectDetail(
  store: WorkspaceStore,
  projectId: string,
): ProjectDetail | undefined {
  const direct = store.getProject(projectId);
  if (direct) return direct;
  const firstSummary = store.listProjects()[0];
  return firstSummary ? store.getProject(firstSummary.id) : undefined;
}

function resolveTargetPrototypeForSession(
  store: WorkspaceStore,
  session: AgentSession,
): InteractivePrototype | undefined {
  if (session.targetId) {
    const direct = store.getPrototype(session.targetId);
    if (direct && direct.projectId === session.projectId) {
      return direct;
    }
  }
  const list = store.listPrototypes(session.projectId);
  return list.find((p) => p.coDesignSessionId === session.id);
}

/** Mock mode's first prototype generation replays the recorded multi-screen build. */
function isMockInitialPrototypeBuild(store: WorkspaceStore, session: AgentSession): boolean {
  return (
    session.agentKind === 'PROTOTYPE_CO_DESIGN' &&
    !resolveTargetPrototypeForSession(store, session) &&
    resolveSessionMultiAgentConcurrency(session) > 1
  );
}

function isBriefRestylePrompt(prompt: string): boolean {
  return /\[PROTOTYPE_BRIEF_RESTYLE\]|按新简报重做风格|Restyle from updated brief/i.test(prompt);
}

function escapeMockHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractPrimaryObjectFromRequirements(
  markdown: string | undefined,
): { name?: string; label?: string } {
  if (!markdown) return {};
  // Match "**中文名**（EnglishName）" or "**中文名** (`EnglishName`)" while skipping generic placeholders
  const biBoldRe =
    /\*\*([^*\n]{2,24})\*\*\s*[（(]\s*`?([A-Za-z][A-Za-z0-9_]*)`?(?:\s*\/[^)）]*)?[)）]/g;
  let biBoldMatch: RegExpExecArray | null;
  while ((biBoldMatch = biBoldRe.exec(markdown)) !== null) {
    const label = biBoldMatch[1]!.trim();
    const name = biBoldMatch[2]!.trim();
    if (name === 'PrimaryEntity' || label === '核心业务对象') continue;
    return { label, name };
  }
  const plainBoldRe = /\*\*([^*\n]{2,24})\*\*/g;
  let plainBoldMatch: RegExpExecArray | null;
  while ((plainBoldMatch = plainBoldRe.exec(markdown)) !== null) {
    const label = plainBoldMatch[1]!.trim();
    if (
      /^(?:来源会话|生成版本|核心诉求摘要|业务主流程|异常处理路径|11 元模型业务本体)/.test(label)
    ) {
      continue;
    }
    const ascii = /^[A-Za-z][A-Za-z0-9_]*$/.exec(label);
    return {
      label,
      ...(ascii ? { name: ascii[0] } : {}),
    };
  }
  return {};
}

function inferPrimaryObjectFromProject(
  project: ProjectDetail | undefined,
): { name?: string; label?: string } {
  const hay = `${project?.name ?? ''} ${project?.domain ?? ''} ${project?.description ?? ''}`;
  if (/合同|contract/i.test(hay)) return { name: 'Contract', label: '合同' };
  if (/供应商|supplier/i.test(hay)) return { name: 'SupplierApplication', label: '供应商准入申请' };
  if (/工单|售后|ticket/i.test(hay)) return { name: 'ServiceTicket', label: '售后工单' };
  return {};
}

function buildMockGeneratedPrototypeHtml(
  project: ProjectDetail | undefined,
  prompt: string,
  locale: AgentLocale,
  confirmedRequirementsContent?: string,
): string {
  const hexMatches = prompt.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  const wantsDark = /深色|暗色|dark\s*mode|dark\s*cockpit|交易风|#0[0-9a-f]{5}|#1[0-9a-f]{5}/i.test(
    prompt,
  );
  const bg = hexMatches[0] ?? (wantsDark ? '#0f172a' : '#f8f5ef');
  const surface = wantsDark ? '#162033' : '#ffffff';
  const ink = wantsDark ? '#f1f5f9' : '#1c1917';
  const muted = wantsDark ? '#94a3b8' : '#64748b';
  const border = wantsDark ? 'rgba(255,255,255,0.14)' : '#e2ddd3';
  const accent = hexMatches[1] ?? (wantsDark ? '#38bdf8' : '#2563eb');
  const firstAgg = project?.suite.M1?.aggregates?.[0];
  const fromRequirements = extractPrimaryObjectFromRequirements(confirmedRequirementsContent);
  const fromProject = inferPrimaryObjectFromProject(project);
  const aggName = firstAgg?.name || fromRequirements.name || fromProject.name || 'BusinessOrder';
  const aggLabel =
    firstAgg?.alias ||
    fromRequirements.label ||
    fromProject.label ||
    project?.name?.replace(/管理系统|平台|工作台|系统|工程/g, '').trim() ||
    (locale === 'en-US' ? 'Business Record' : '核心业务单据');
  const titleText =
    project?.name || (locale === 'en-US' ? 'Interactive Prototype' : '业务交互原型');

  return `<!doctype html>
<html lang="${locale === 'en-US' ? 'en' : 'zh-CN'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeMockHtml(titleText)}</title>
  <style>
    :root {
      --bg: ${bg};
      --surface: ${surface};
      --ink: ${ink};
      --muted: ${muted};
      --line: ${border};
      --accent: ${accent};
      --radius: 10px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .workspace-grid {
      display: grid;
      grid-template-columns: 1.45fr 0.95fr;
      gap: 16px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 16px;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .btn-primary {
      background: var(--accent);
      color: #ffffff;
      border: 0;
      border-radius: 8px;
      padding: 8px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    input, select {
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      border-radius: 8px;
      padding: 7px 10px;
    }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); }
    @media (max-width: 768px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .workspace-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 390px) {
      body { padding: 12px; }
      .kpi-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header style="margin-bottom:16px;">
    <h1 style="margin:0;font-size:20px;">${escapeMockHtml(titleText)}</h1>
    <p style="margin:4px 0 0;font-size:12.5px;color:var(--muted);">${escapeMockHtml(aggLabel)} · 1440px / 768px / 390px</p>
  </header>
  <div class="kpi-grid">
    <div class="card"><div style="font-size:12px;color:var(--muted);">本月累计单据</div><strong style="font-size:22px;font-variant-numeric:tabular-nums;">28</strong></div>
    <div class="card"><div style="font-size:12px;color:var(--muted);">待审批金额</div><strong style="font-size:22px;color:var(--accent);font-variant-numeric:tabular-nums;">¥265,000</strong></div>
    <div class="card"><div style="font-size:12px;color:var(--muted);">准时办结率</div><strong style="font-size:22px;font-variant-numeric:tabular-nums;">98.6%</strong></div>
  </div>
  <main class="workspace-grid">
    <section
      data-screen-id="SCR-MAIN-LIST"
      data-screen-name="${escapeMockHtml(aggLabel)}台账"
      data-screen-type="LIST"
      class="card"
    >
      <div class="toolbar">
        <input
          type="search"
          placeholder="搜索编号或名称…"
          data-element-id="EL-SEARCH-KW"
          data-element-type="INPUT"
          data-element-label="关键词检索"
          data-binding="${escapeMockHtml(aggName)}.title"
        />
        <button
          type="button"
          class="btn-primary"
          data-element-id="EL-OPEN-CREATE"
          data-element-type="BUTTON"
          data-element-label="新建${escapeMockHtml(aggLabel)}"
          data-event-id="UIE-OPEN-CREATE"
        >
          + 新建${escapeMockHtml(aggLabel)}
        </button>
      </div>
      <table data-element-id="EL-MAIN-TABLE" data-element-type="TABLE" data-binding="${escapeMockHtml(aggName)}">
        <thead>
          <tr><th>编号</th><th>名称</th><th>金额</th><th>状态</th></tr>
        </thead>
        <tbody>
          <tr><td>DOC-2026-01</td><td>${escapeMockHtml(aggLabel)}重点批次 A</td><td>¥265,000</td><td>PENDING_APPROVAL</td></tr>
          <tr><td>DOC-2026-02</td><td>${escapeMockHtml(aggLabel)}标准执行单</td><td>¥42,000</td><td>APPROVED</td></tr>
        </tbody>
      </table>
    </section>
    <section
      data-screen-id="SCR-MAIN-FORM"
      data-screen-name="新建${escapeMockHtml(aggLabel)}"
      data-screen-type="FORM"
      class="card"
    >
      <h2 style="margin-top:0;font-size:15px;">新建 / 审批提交</h2>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <input
          type="text"
          value="DOC-2026-03"
          data-element-id="EL-FORM-CODE"
          data-element-type="INPUT"
          data-element-label="单据编码"
          data-binding="${escapeMockHtml(aggName)}.code"
        />
        <input
          type="number"
          value="128000"
          data-element-id="EL-FORM-AMOUNT"
          data-element-type="NUMBER"
          data-element-label="业务金额"
          data-binding="${escapeMockHtml(aggName)}.amount"
        />
        <button
          type="button"
          class="btn-primary"
          data-element-id="EL-SUBMIT-CREATE"
          data-element-type="BUTTON"
          data-element-label="提交保存"
          data-event-id="UIE-SUBMIT-CREATE"
        >
          提交保存
        </button>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function applyMockBriefRestyleToHtml(existingHtml: string, prompt: string): string {
  const hexMatches = prompt.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  const wantsDark = /深色|暗色|dark\s*mode|dark\s*cockpit|交易风|#0[0-9a-f]{5}|#1[0-9a-f]{5}/i.test(
    prompt,
  );
  const bg = hexMatches[0] ?? (wantsDark ? '#0b1120' : '#f8f5ef');
  const accent = hexMatches[1] ?? (wantsDark ? '#38bdf8' : '#2563eb');
  const ink = wantsDark ? '#f1f5f9' : '#1c1917';
  const styleBlock = `<style data-brief-restyle="true">:root { --bg: ${bg}; --accent: ${accent}; --ink: ${ink}; } body { background: ${bg}; color: ${ink}; }</style>`;

  const stripped = existingHtml.replace(
    /<style\s+data-brief-restyle="true">[\s\S]*?<\/style>/gi,
    '',
  );
  if (/<\/head>/i.test(stripped)) {
    return stripped.replace(/<\/head>/i, `  ${styleBlock}\n</head>`);
  }
  return `${styleBlock}\n${stripped}`;
}

function stripSelectionBlockFromPrompt(prompt: string): string {
  return (
    prompt
      .replace(
        /^---\s*(?:Targeted Visual Selections & Annotations|用户在界面原型上框选\/点选的目标区域与批注)\s*---[\s\S]*?\n\n/m,
        '',
      )
      .replace(/\[TEST_[A-Z0-9_]+\]/g, '')
      .trim() || prompt.trim()
  );
}

function parseMockPrototypeTargetFromPrompt(
  prompt: string,
  proto: InteractivePrototype | undefined,
): { elementId?: string; screenId?: string; cssSelector?: string } {
  const explicitEl =
    /\belement=([A-Za-z0-9_-]+)/.exec(prompt)?.[1] ??
    /\b(EL-[A-Za-z0-9_-]+)\b/.exec(prompt)?.[1];
  const explicitScr =
    /\bscreen=([A-Za-z0-9_-]+)/.exec(prompt)?.[1] ??
    /\b(SCR-[A-Za-z0-9_-]+)\b/.exec(prompt)?.[1];
  const explicitSelector = /\bselector="([^"]+)"/.exec(prompt)?.[1];

  if (explicitEl || explicitScr || explicitSelector) {
    return {
      ...(explicitEl ? { elementId: explicitEl } : {}),
      ...(explicitScr ? { screenId: explicitScr } : {}),
      ...(explicitSelector ? { cssSelector: explicitSelector } : {}),
    };
  }

  const overview = listPrototypeAnchors(proto?.htmlContent ?? '');
  // Prefer a control inside a screen over the shell's navigation tabs.
  const firstElement = overview.elements.find((el) => el.screenId) ?? overview.elements[0];
  if (firstElement?.elementId) {
    return {
      elementId: firstElement.elementId,
      ...(firstElement.screenId ? { screenId: firstElement.screenId } : {}),
    };
  }
  if (overview.screens[0]?.screenId) {
    return { screenId: overview.screens[0].screenId };
  }
  return {};
}

function extractTargetAnchorFromArgs(
  toolName: string,
  args: Record<string, unknown>,
): PrototypeTargetAnchor | undefined {
  if (toolName === 'init_prototype_shell') {
    const screens = Array.isArray(args.screens) ? args.screens : [];
    const first = screens[0] as Record<string, unknown> | undefined;
    const firstId = typeof first?.screenId === 'string' && first.screenId.trim() ? first.screenId.trim() : undefined;
    const firstName =
      typeof first?.screenName === 'string' && first.screenName.trim() ? first.screenName.trim() : undefined;
    return firstId ? { screenId: firstId, ...(firstName ? { label: firstName } : {}) } : undefined;
  }
  if (toolName === 'upsert_prototype_screen') {
    const screenId = typeof args.screenId === 'string' && args.screenId.trim() ? args.screenId.trim() : undefined;
    const screenName =
      typeof args.screenName === 'string' && args.screenName.trim() ? args.screenName.trim() : undefined;
    return screenId ? { screenId, ...(screenName ? { label: screenName } : {}) } : undefined;
  }
  if (
    toolName !== 'read_prototype_anchor' &&
    toolName !== 'edit_prototype_anchor' &&
    toolName !== 'rewrite_prototype_page'
  ) {
    return undefined;
  }
  const screenId = typeof args.screenId === 'string' && args.screenId.trim() ? args.screenId.trim() : undefined;
  const elementId = typeof args.elementId === 'string' && args.elementId.trim() ? args.elementId.trim() : undefined;
  const cssSelector =
    typeof args.cssSelector === 'string' && args.cssSelector.trim() ? args.cssSelector.trim() : undefined;
  if (!screenId && !elementId && !cssSelector) return undefined;
  return {
    ...(screenId ? { screenId } : {}),
    ...(elementId ? { elementId } : {}),
    ...(cssSelector ? { cssSelector } : {}),
  };
}

// ─── Unified Agent Workbench Extra Tools (YOLO + Scoped HITL) ────────────────

export const UNIFIED_AGENT_EXTRA_TOOLS: OpenAiFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        'Ask the user ONE clear business question at a time with 2-4 clickable plain-language options and freeform input allowed. ONLY call when resolving an ambiguous business choice or missing business parameter; never call to ask permission for normal tool execution, and never bundle multiple questions in one call.',
      parameters: {
        type: 'object',
        properties: {
          header: {
            type: 'string',
            description: 'Short plain-language badge such as 需要你的业务选择 / Your choice needed',
          },
          question: {
            type: 'string',
            description: 'One concise business question in plain language (no model codes or IDs)',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: '2-4 concrete business-language option strings for the user to click',
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
  {
    type: 'function',
    function: {
      name: 'propose_step_handoff',
      description:
        'Propose handing off a cross-step user request to the Project Step that owns it (REQUIREMENTS, PROTOTYPE, BUSINESS_MODEL, or DELIVERY). Call this instead of attempting cross-step mutations whenever the user asks for work belonging to another step.',
      parameters: {
        type: 'object',
        properties: {
          targetStep: {
            type: 'string',
            enum: ['REQUIREMENTS', 'PROTOTYPE', 'BUSINESS_MODEL', 'DELIVERY'],
            description: 'Destination Project Step that owns the user request',
          },
          request: {
            type: 'string',
            description:
              'Plain-language request to carry over verbatim as a user message in targetStep if accepted',
          },
          reason: {
            type: 'string',
            description:
              'Concise plain-language explanation of why this request belongs in targetStep',
          },
        },
        required: ['targetStep', 'request'],
      },
    },
  },
  ...DOMAIN_RUN_OPENAI_TOOLS,
];

export const agentWorkbenchRegistry = createRegistry();
agentWorkbenchRegistry.install(
  defineExtension({
    name: 'ontology-plus-unified-workbench',
    tools: [
      ...Object.values(ONTOLOGY_DURABLE_TOOLS),
      ...[...UNIFIED_AGENT_EXTRA_TOOLS, ...PROTOTYPE_ANCHOR_OPENAI_TOOLS].map((spec) =>
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

// ─── Active Session Runner & Abort Registry ─────────────────────────────────

type SessionAbortKind = 'IDLE_TIMEOUT' | 'USER_ABORT' | 'STEER_SUPERSEDED';

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

interface ActiveBackgroundSessionRun {
  readonly runId: string;
  readonly sessionId: string;
  readonly controller: AbortController;
  readonly bufferedEvents: CoalescingRunEventBuffer<UnifiedAgentSseEvent>;
  readonly subscribers: Set<() => void>;
  done: boolean;
  completionPromise: Promise<void>;
}

interface QueuedSessionTurnEntry {
  readonly queueId: string;
  readonly input: Omit<UnifiedAgentStreamInput, 'signal'>;
  cancelled: boolean;
  resolveRun: (run: ActiveBackgroundSessionRun | null) => void;
}

interface SessionRunnerSlot {
  activeRun: ActiveBackgroundSessionRun | null;
  queue: QueuedSessionTurnEntry[];
}

const storeSessionRunnerMap = new WeakMap<WorkspaceStore, Map<string, SessionRunnerSlot>>();
const activeSessionAbortControllers = new Map<string, AbortController>();
const globalSlotsBySessionId = new Map<string, Set<SessionRunnerSlot>>();

function getOrCreateSessionSlot(store: WorkspaceStore, sessionId: string): SessionRunnerSlot {
  let bySession = storeSessionRunnerMap.get(store);
  if (!bySession) {
    bySession = new Map<string, SessionRunnerSlot>();
    storeSessionRunnerMap.set(store, bySession);
  }
  let slot = bySession.get(sessionId);
  if (!slot) {
    slot = { activeRun: null, queue: [] };
    bySession.set(sessionId, slot);
    let setForId = globalSlotsBySessionId.get(sessionId);
    if (!setForId) {
      setForId = new Set();
      globalSlotsBySessionId.set(sessionId, setForId);
    }
    setForId.add(slot);
  }
  return slot;
}

function getSessionSlot(store: WorkspaceStore, sessionId: string): SessionRunnerSlot | undefined {
  return storeSessionRunnerMap.get(store)?.get(sessionId);
}

export interface LiveAgentSessionStatus {
  active: boolean;
  queuedCount: number;
  runId?: string;
  bufferedEventCount: number;
}

export function getLiveAgentSessionStatus(
  store: WorkspaceStore,
  sessionId: string,
): LiveAgentSessionStatus {
  const slot = getSessionSlot(store, sessionId);
  const activeRun = slot?.activeRun && !slot.activeRun.done ? slot.activeRun : undefined;
  return {
    active: Boolean(activeRun),
    queuedCount: slot ? slot.queue.filter((q) => !q.cancelled).length : 0,
    ...(activeRun ? { runId: activeRun.runId } : {}),
    bufferedEventCount: activeRun ? activeRun.bufferedEvents.size() : 0,
  };
}

function cancelSlotQueue(slot: SessionRunnerSlot): void {
  if (slot.queue.length === 0) return;
  const drained = slot.queue.splice(0, slot.queue.length);
  for (const item of drained) {
    item.cancelled = true;
    item.resolveRun(null);
  }
}

export function abortActiveAgentSession(
  sessionId: string,
  kind: 'USER_ABORT' | 'STEER_SUPERSEDED' = 'USER_ABORT',
  store?: WorkspaceStore,
): boolean {
  const reason: SessionAbortReason =
    kind === 'STEER_SUPERSEDED'
      ? { kind: 'STEER_SUPERSEDED', message: '当前流式推演已被新指令接管' }
      : { kind: 'USER_ABORT', message: '已由用户手动停止生成' };

  let aborted = false;
  if (store) {
    const slot = getSessionSlot(store, sessionId);
    if (slot) {
      if (kind === 'USER_ABORT') {
        cancelSlotQueue(slot);
      }
      if (slot.activeRun && !slot.activeRun.done && !slot.activeRun.controller.signal.aborted) {
        slot.activeRun.controller.abort(reason);
        aborted = true;
      }
    }
  } else {
    const slots = globalSlotsBySessionId.get(sessionId);
    if (slots) {
      for (const slot of slots) {
        if (kind === 'USER_ABORT') {
          cancelSlotQueue(slot);
        }
        if (slot.activeRun && !slot.activeRun.done && !slot.activeRun.controller.signal.aborted) {
          slot.activeRun.controller.abort(reason);
          aborted = true;
        }
      }
    }
  }

  const legacyCtrl = activeSessionAbortControllers.get(sessionId);
  if (legacyCtrl && !legacyCtrl.signal.aborted) {
    legacyCtrl.abort(reason);
    aborted = true;
  }
  activeSessionAbortControllers.delete(sessionId);
  return aborted;
}

export async function abortActiveAgentSessionAsync(
  store: WorkspaceStore,
  sessionId: string,
): Promise<{ aborted: boolean; runId?: string; session: AgentSession | undefined }> {
  const slot = getSessionSlot(store, sessionId);
  const activeRun = slot?.activeRun && !slot.activeRun.done ? slot.activeRun : undefined;
  const runningPromise = activeRun?.completionPromise;
  const aborted = abortActiveAgentSession(sessionId, 'USER_ABORT', store);
  if (runningPromise) {
    await Promise.race([runningPromise, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
  }
  const cur = store.getAgentSession(sessionId);
  const session =
    cur && cur.status === 'RUNNING'
      ? store.saveAgentSession({
          ...cur,
          status: 'IDLE',
          updatedAt: new Date().toISOString(),
        })
      : cur;
  return {
    aborted,
    ...(activeRun ? { runId: activeRun.runId } : {}),
    session,
  };
}

// ─── SSE Event Protocol ──────────────────────────────────────────────────────

export type UnifiedAgentSseEventType =
  | 'session_meta'
  | 'heartbeat'
  | 'thinking_delta'
  | 'delta'
  | 'tool_delta'
  | 'tool_call'
  | 'tool_result'
  | 'subagent_update'
  | 'prototype_frame'
  | 'prototype_screen'
  | 'artifact'
  | 'ask_user'
  | 'step_handoff'
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

function getBlockedStepExplanation(
  store: WorkspaceStore,
  session: AgentSession,
  locale: AgentLocale,
): string | null {
  if (!session.projectId) return null;
  const stepConfs = store.getProjectStepConfirmations(session.projectId);
  const hasConfirmedProto = Boolean(
    stepConfs.prototype ?? store.getConfirmedPrototypeRevision(session.projectId),
  );

  if (session.agentKind === 'PROTOTYPE_CO_DESIGN') {
    const hasPrototype = store.listPrototypes(session.projectId).length > 0;
    if (!stepConfs.requirements && !hasConfirmedProto && !hasPrototype) {
      return pickLocaleText(
        locale,
        '原型步骤还不能开始：已收到你的请求。请先在「需求」步骤完成并确认需求文档，确认后我会依据该需求文档为你生成并调整界面原型。',
        'Prototype cannot start yet: I have noted your request here. Please confirm the requirements document in the Requirements step first, and I will generate and refine the prototype from that confirmed version.',
      );
    }
    return null;
  }

  if (session.agentKind === 'COPILOT') {
    const project = store.getProject(session.projectId);
    const hasOntology = (project?.validation.presentModels.length ?? 0) > 0;
    if (project && !hasConfirmedProto && !stepConfs.businessModel && !hasOntology) {
      return pickLocaleText(
        locale,
        '业务模型步骤还不能开始：已收到你的请求。请先在「原型」步骤确认界面原型，确认后我会结合这份请求为你整理业务模型。',
        'Business Model cannot start yet: I have noted your request here. Please confirm the interactive prototype in the Prototype step first, and I will incorporate this into the Business Model once ready.',
      );
    }
    return null;
  }

  if (session.agentKind === 'CODING') {
    const hasApps = store
      .listAssembledApplications()
      .some((app) => app.projectId === session.projectId);
    const hasSkills = store.listGeneratedSkills(session.projectId).length > 0;
    if (!stepConfs.businessModel && !hasApps && !hasSkills) {
      return pickLocaleText(
        locale,
        '交付步骤还不能开始：已收到你的请求。请先在「业务模型」步骤完成并确认业务模型，确认后即可在这里完善交付说明并生成开发资料包。',
        'Delivery cannot start yet: I have noted your request here. Please confirm the Business Model in the Business Model step first before preparing deliverables and generating the development package.',
      );
    }
    return null;
  }

  return null;
}

function detectMockStepHandoff(
  kind: AgentSessionKind,
  userPrompt: string,
  locale: AgentLocale,
): { targetStep: ProjectStepId; reason: string } | null {
  const clean = userPrompt.trim();
  if (!clean || clean.length > 240 || /\n#\s/.test(clean)) return null;
  if (
    /^\[ACTION:[A-Z_]+/.test(clean) ||
    /\[(?:用户已确认选择|User Confirmed Choice|Visual Element Annotations|用户可视化圈选|PROTOTYPE_BRIEF_RESTYLE|Target application ID:|TEST_)/.test(
      clean,
    ) ||
    /确认设计简报|Confirm Brief|更新当前原型|Update the existing prototype|\belement=[A-Za-z0-9_-]+|\bscreen=[A-Za-z0-9_-]+/i.test(
      clean,
    )
  ) {
    return null;
  }

  if (
    kind !== 'CODING' &&
    kind !== 'ARCHITECTURE' &&
    /(?:生成|下载|导出|打包|编译).*(?:开发资料包|开发包|交付包|交付资料包)|(?:generate|download|compile|export)\s+(?:the\s+)?(?:dev(?:elopment)?\s+package|deliverable\s+package)/i.test(
      clean,
    )
  ) {
    return {
      targetStep: 'DELIVERY',
      reason: pickLocaleText(
        locale,
        '开发资料包的生成与交付准备属于「交付」步骤的范围',
        'Generating and preparing the development package belongs in the Delivery step',
      ),
    };
  }

  if (
    kind !== 'PROTOTYPE_CO_DESIGN' &&
    (/(?:在|给|把|调整|修改).*(?:界面原型|原型(?:页面|台账|表格|卡片|按钮)?).*(?:加一列|增加一列|新增一列|按钮|配色|颜色|间距|布局|筛选|字段|列)|(?:界面原型|原型表格|原型页面).*(?:加一列|增加|新增|修改|调整)|(?:add|insert|change|update|restyle)\b.*\b(?:column|button|color|layout|spacing|filter)\b.*\bprototype\b|\bprototype\s+(?:screen|page|table|button|layout)\b/i.test(
      clean,
    ))
  ) {
    return {
      targetStep: 'PROTOTYPE',
      reason: pickLocaleText(
        locale,
        '界面布局、表格列与页面控件调整属于「原型」步骤的范围',
        'Screen layout, table columns, and visual controls belong in the Prototype step',
      ),
    };
  }

  if (
    kind !== 'REQUIREMENT' &&
    (/(?:修改|更新|补充|重写).*(?:需求文档|需求规格书)|(?:在|往)(?:需求文档|需求规格书)(?:里|中)|(?:update|edit|revise|rewrite)\s+(?:the\s+)?requirements\s+document/i.test(
      clean,
    ))
  ) {
    return {
      targetStep: 'REQUIREMENTS',
      reason: pickLocaleText(
        locale,
        '修改需求文档章节与整体业务范围属于「需求」步骤的范围',
        'Editing the requirements document and overall scope belongs in the Requirements step',
      ),
    };
  }

  if (
    kind === 'PROTOTYPE_CO_DESIGN' &&
    !/原型|界面|页面|屏幕|按钮|配色|背景色|字号|间距|文案|徽章|三屏|响应式|列宽|筛选|表格|表单|字段|布局|视觉风格|prototype|screen|page|button|color|spacing|font|badge|column|filter|table|form|field|layout|style/i.test(
      clean,
    ) &&
    (/(?:总经理|总监|主管|副总|法务|财务|会签|分级|多级)?审批|(?:业务|校验|准入|风控|权限)规则|角色权限|超过\s*\d+.*(?:审批|拦截|复核)|(?:approval|validation|permission)\s+rule|require.*approval|over\s+\$?\d+.*approv/i.test(
      clean,
    ))
  ) {
    return {
      targetStep: 'BUSINESS_MODEL',
      reason: pickLocaleText(
        locale,
        '业务规则、审批条件与角色权限属于「业务模型」步骤的范围',
        'Business rules, approval thresholds, and role permissions belong in the Business Model step',
      ),
    };
  }

  if (
    (kind === 'CODING' || kind === 'ARCHITECTURE') &&
    !/验收条件|开发规格|实施规格|开发说明|补充说明|技术规范|acceptance\s+criteria|implementation\s+spec/i.test(
      clean,
    ) &&
    (/(?:在业务模型|去业务模型|业务模型里|业务模型中)|(?:新增|添加|修改)(?:一条|一个)?(?:业务规则|业务对象|角色权限)|(?:in|to)\s+the\s+business\s+model/i.test(
      clean,
    ))
  ) {
    return {
      targetStep: 'BUSINESS_MODEL',
      reason: pickLocaleText(
        locale,
        '业务对象、业务规则与角色权限属于「业务模型」步骤的范围',
        'Business objects, business rules, and role permissions belong in the Business Model step',
      ),
    };
  }

  return null;
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
    tokensPerSecond:
      process.env.VITEST === 'true'
        ? 50000
        : isMockInitialPrototypeBuild(store, session)
          ? MOCK_PROTOTYPE_BUILD_TOKENS_PER_SECOND
          : 900,
    tokenSize: { min: 6, max: 18 },
  });

  faux.setResponses([
    // Step 1: Reasoning + Domain Tool Execution (or Scoped HITL ask_user)
    (context) => {
      const lastUserMsg = [...context.messages]
        .reverse()
        .find((m): m is Extract<Message, { role: 'user' }> => m.role === 'user');
      const userPrompt = extractUserMessageText(lastUserMsg);
      const parsedAction = resolveEffectiveStructuredAction(session.messages, userPrompt);
      const lower = userPrompt.toLowerCase();
      const loc = resolveEffectiveLocale(store, explicitLocale, parsedAction?.cleanPrompt || userPrompt);

      // Explicit Scoped HITL ask_user trigger when ambiguous choice is requested
      const hasResolvedChoice =
        userPrompt.includes('[用户已确认选择]') ||
        userPrompt.includes('[User Confirmed Choice]') ||
        userPrompt.includes('已选择：');
      if (
        !parsedAction &&
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
                    header: 'Your choice needed',
                    question: `For "${userPrompt.slice(0, 48)}", how should exceptions and approvals be handled?`,
                    options: [
                      'Block submission immediately until all conditions are met',
                      'Keep as draft and route to joint legal and finance approval',
                      'Allow registration first while pausing downstream settlement',
                    ],
                    multiSelect: false,
                    allowFreeform: true,
                  }
                : {
                    header: '需要你的业务选择',
                    question: `针对「${userPrompt.slice(0, 36)}」，你希望采用哪种处理方式？`,
                    options: [
                      '提交时直接拦截，补齐条件后再允许提交',
                      '保留草稿并进入特批会签，由法务与财务共同审批',
                      '先允许登记，同时自动暂停后续结算付款',
                    ],
                    multiSelect: false,
                    allowFreeform: true,
                  },
            ),
          ],
          { stopReason: 'toolUse' },
        );
      }

      // Cross-step handoff check (when not already executing a handed-off turn)
      const latestSessionRecord = store.getAgentSession(session.id) ?? session;
      const lastPersistedUser = [...latestSessionRecord.messages]
        .reverse()
        .find((m) => m.role === 'user');
      const isHandedOffTurn = Boolean(lastPersistedUser?.handoffFrom);
      if (!parsedAction && !hasResolvedChoice && !isHandedOffTurn) {
        const handoffCandidate = detectMockStepHandoff(session.agentKind, userPrompt, loc);
        if (handoffCandidate) {
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `识别到跨步骤请求，当前步骤不做跨界改动，调用 propose_step_handoff 提供一键步骤转交卡片。`,
                  `Detected a cross-step request; preserving strict step isolation and calling propose_step_handoff.`,
                ),
              ),
              fauxToolCall('propose_step_handoff', {
                targetStep: handoffCandidate.targetStep,
                request: userPrompt.trim(),
                reason: handoffCandidate.reason,
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }
      }

      // Blocked-step check (#48 Decision #3): if this step cannot start yet, explain what upstream step confirmation is needed without mutating
      const blockedStepMessage = !parsedAction
        ? getBlockedStepExplanation(store, latestSessionRecord, loc)
        : null;
      if (
        blockedStepMessage &&
        (isHandedOffTurn ||
          session.agentKind !== 'COPILOT' ||
          !/\b(?:aggregate|entity)\s+[A-Z][A-Za-z0-9]+/.test(userPrompt))
      ) {
        return fauxAssistantMessage([fauxText(blockedStepMessage)]);
      }

      if (session.agentKind === 'PROTOTYPE_CO_DESIGN') {
        const targetProto = resolveTargetPrototypeForSession(store, session);
        if (!targetProto) {
          const confirmedReq = store.getProjectStepConfirmations(session.projectId).requirements;
          if (!confirmedReq) {
            return fauxAssistantMessage([
              fauxText(
                pickLocaleText(
                  loc,
                  '原型步骤还不能开始：请先在「需求」步骤完成并确认需求文档，确认后我会依据该需求文档为你生成界面原型。',
                  'Prototype cannot start yet: please confirm the requirements document in the Requirements step first, and I will generate the prototype from that confirmed version.',
                ),
              ),
            ]);
          }
          if (resolveSessionMultiAgentConcurrency(session) > 1) {
            // Replay the recorded multi-screen build through the real engine: the lead plans the
            // shell and hands one screen to each subagent; every subagent call below is answered
            // by the same faux provider, so its tool-call arguments stream token by token.
            const requirementsObject = extractPrimaryObjectFromRequirements(confirmedReq.content);
            const replay = createMockPrototypeBuildReplay(loc, {
              businessObject:
                project?.suite.M1?.aggregates?.[0]?.name ||
                requirementsObject.name ||
                inferPrimaryObjectFromProject(project).name,
            });
            faux.setResponses(
              Array.from({ length: replay.responseBudget }, () => replay.respond),
            );
            return replay.leadOpening(
              confirmedReq.title,
              requirementsObject.label ?? requirementsObject.name,
            );
          }
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `正在根据已确认的需求文档「${confirmedReq.title}」与设计简报生成首版响应式原型（1440px / 768px / 390px），并挂载完整语义锚点。`,
                  `Generating initial responsive prototype (1440px / 768px / 390px) from confirmed requirements "${confirmedReq.title}" and the Design Brief.`,
                ),
              ),
              fauxToolCall('rewrite_prototype_page', {
                htmlContent: buildMockGeneratedPrototypeHtml(
                  project,
                  userPrompt,
                  loc,
                  confirmedReq.content,
                ),
                allowAnchorReset: true,
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }
        if (isBriefRestylePrompt(userPrompt)) {
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `收到「按新简报重做风格」指令，先调用 \`list_prototype_anchors\` 盘点现有屏幕与控件锚点，确保整页重做风格时 100% 保留既有语义锚点。`,
                  `Received brief restyle instruction; calling \`list_prototype_anchors\` first so whole-page restyling preserves 100% of existing semantic anchors.`,
                ),
              ),
              fauxToolCall('list_prototype_anchors', {}),
            ],
            { stopReason: 'toolUse' },
          );
        }
        const target = parseMockPrototypeTargetFromPrompt(userPrompt, targetProto);
        const anchorName = target.elementId || target.screenId || target.cssSelector || 'SCR-01';
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                loc,
                `正在定位目标锚点 \`${anchorName}\`，先调用 \`read_prototype_anchor\` 读取局部片段，避免改动其他未选中的业务屏幕。`,
                `Locating target anchor \`${anchorName}\` via \`read_prototype_anchor\` to inspect only the targeted fragment without touching unrelated screens.`,
              ),
            ),
            fauxToolCall('read_prototype_anchor', {
              ...(target.elementId ? { elementId: target.elementId } : {}),
              ...(target.screenId ? { screenId: target.screenId } : {}),
              ...(!target.elementId && !target.screenId && target.cssSelector
                ? { cssSelector: target.cssSelector }
                : {}),
            }),
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

        if (parsedAction?.kind === 'METRIC_INSIGHT') {
          const metricArgs = buildMockMetricInsightToolArgs(
            store,
            typeof parsedAction.params.metricId === 'string'
              ? parsedAction.params.metricId
              : undefined,
            loc,
          );
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `正在实查 SQLite 业务表并结合数据本体指标口径生成异动洞察与策略建议。`,
                  `Querying live SQLite tables and evaluating metric formula & M3 thresholds to synthesize anomaly insight.`,
                ),
              ),
              fauxToolCall('run_readonly_sql', { sql }),
              fauxToolCall('save_metric_insight', metricArgs as never),
            ],
            { stopReason: 'toolUse' },
          );
        }

        if (parsedAction?.kind === 'SCENARIO_ATTRIBUTION') {
          const attrArgs = buildMockScenarioAttributionToolArgs(
            store,
            typeof parsedAction.params.scenarioId === 'string'
              ? parsedAction.params.scenarioId
              : undefined,
            typeof parsedAction.params.question === 'string'
              ? parsedAction.params.question
              : parsedAction.cleanPrompt || undefined,
            parsedAction.params.saveAsReport !== false,
            loc,
          );
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `正在沿 M1 -> MM -> SQLite 实查多因子交叉统计，拆解归因权重并持久化专题分析报告。`,
                  `Executing multi-factor SQLite cross-tabulation along M1 -> MM to compute causal weights and archive attribution report.`,
                ),
              ),
              fauxToolCall('run_readonly_sql', { sql }),
              fauxToolCall('save_scenario_attribution_report', attrArgs as never),
            ],
            { stopReason: 'toolUse' },
          );
        }

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
        if (parsedAction?.kind === 'RUN_ONTOLOGY_EXTRACTION') {
          const snippetFromParams =
            typeof parsedAction.params.sourceSnippet === 'string' &&
            parsedAction.params.sourceSnippet.trim()
              ? parsedAction.params.sourceSnippet.trim()
              : parsedAction.cleanPrompt;
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `正在对源系统 DDL / OpenAPI / 文档执行两轮本体萃取扫描（结构扫描 + 语义对齐），并生成待审阅候选集。`,
                  `Executing Ontology Extraction structural scan on source DDL / OpenAPI / document artifacts to produce reviewable candidates.`,
                ),
              ),
              fauxToolCall('run_ontology_extraction', {
                ...parsedAction.params,
                sourceSnippet: snippetFromParams,
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }

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

      if (session.agentKind === 'ARCHITECTURE') {
        if (
          parsedAction?.kind === 'GENERATE_TECH_ARCH' ||
          /生成技术架构|技术架构规范|generate\s+tech(?:nical)?\s+arch/i.test(userPrompt)
        ) {
          const name =
            (typeof parsedAction?.params.name === 'string' && parsedAction.params.name.trim()) ||
            pickLocaleText(
              loc,
              `${project?.name ?? '当前工程'} 四层技术架构规范`,
              `${project?.name ?? 'Project'} 4-Layer Tech Architecture Spec`,
            );
          const rawTags = parsedAction?.params.stackTags;
          const stackTags = Array.isArray(rawTags)
            ? rawTags.filter((t): t is string => typeof t === 'string' && Boolean(t.trim()))
            : ['TypeScript', 'Hono', 'Drizzle SQLite', '11-Model DDD'];
          const version =
            typeof parsedAction?.params.version === 'string' && parsedAction.params.version.trim()
              ? parsedAction.params.version.trim()
              : 'v5.0';
          const extraPrompt =
            (typeof parsedAction?.params.extraPrompt === 'string' &&
              parsedAction.params.extraPrompt.trim()) ||
            (typeof parsedAction?.params.prompt === 'string' &&
              parsedAction.params.prompt.trim()) ||
            parsedAction?.cleanPrompt ||
            undefined;
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `正在根据技术栈标签与 11 元模型契约生成四层技术架构规范文档并写入资产中心。`,
                  `Synthesizing 4-layer technical architecture specification from stack tags and 11-model contracts.`,
                ),
              ),
              fauxToolCall('save_tech_architecture_spec', {
                name,
                version,
                stackTags,
                specMarkdown: buildMockTechArchMarkdown(name, stackTags, extraPrompt, 'en-US'),
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }

        return fauxAssistantMessage(
          [fauxToolCall('read_architecture_assets', {})],
          { stopReason: 'toolUse' },
        );
      }

      if (session.agentKind === 'CODING') {
        const explicitApplicationId = /^\[Target application ID: ([^\]\r\n]+)\]/.exec(userPrompt)?.[1]
          ?? store.listAssembledApplications().find((app) => app.projectId === session.projectId
            && userPrompt.includes(`(${app.id})`))?.id;
        const resolved = resolveSessionApplication(store, session, explicitApplicationId);
        if (!resolved.application) {
          const applications = store.listAssembledApplications().filter((app) => app.projectId === session.projectId);
          if (!applications.length) {
            return fauxAssistantMessage([fauxText(pickLocaleText(loc, '请先在当前工程创建并选择一个应用，再检查其开发规格。', 'Create and select an application in this project before reviewing its implementation specification.'))]);
          }
          return fauxAssistantMessage(
            [fauxToolCall('ask_user', {
              question: pickLocaleText(loc, '请选择要完善开发规格的应用。', 'Which application should the implementation specification describe?'),
              options: applications.map((app) => `${app.name} (${app.id})`),
            })],
            { stopReason: 'toolUse' },
          );
        }
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                loc,
                `正在读取应用「${resolved.application.name}」的已选输入，检查开发规格缺项与冲突。`,
                `Reading selected inputs for "${resolved.application.name}" to inspect missing or conflicting implementation requirements.`,
              ),
            ),
            fauxToolCall('read_application_inputs', { applicationId: resolved.application.id }),
          ],
          { stopReason: 'toolUse' },
        );
      }

      if (session.agentKind === 'REQUIREMENT') {
        const existingPrimaryDoc = store.listRequirementDocs(session.projectId)[0];
        if (
          existingPrimaryDoc &&
          !parsedAction &&
          /更新需求文档|修改需求文档|在需求文档(?:里|中)|补充到需求文档|(?:update|revise)\s+requirements\s+document/i.test(
            userPrompt,
          )
        ) {
          const cleanNote = userPrompt
            .replace(/^(?:请|麻烦)?(?:帮我)?(?:更新需求文档|修改需求文档|补充到需求文档)\s*[:：，,]?\s*/i, '')
            .trim() || userPrompt.trim();
          const updatedMarkdown = `${existingPrimaryDoc.content.trimEnd()}\n\n## 补充业务约定\n- ${cleanNote}\n`;
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `正在按用户最新说明更新当前需求文档的相关章节。`,
                  `Updating the requirements document sections with your latest instructions.`,
                ),
              ),
              fauxToolCall('save_synthesized_srs_doc', {
                docId: existingPrimaryDoc.id,
                title: existingPrimaryDoc.title,
                status: 'DRAFT',
                content: updatedMarkdown,
                reason: pickLocaleText(
                  loc,
                  '按你补充的业务说明在需求文档中增加了相应章节与约定。',
                  'Added the requested business conventions to the requirements document.',
                ),
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }

        if (
          parsedAction?.kind === 'SYNTHESIZE_SRS' ||
          /合成\s*SRS|合成需求规格|生成\s*SRS|synthesize\s+(?:9[- ]chapter\s+)?srs/i.test(userPrompt)
        ) {
          const reqSessionId =
            typeof parsedAction?.params.requirementSessionId === 'string'
              ? parsedAction.params.requirementSessionId
              : session.targetId;
          const reqSession =
            findRequirementSessionOptional(store, reqSessionId) ??
            store.listRequirementSessions(session.projectId)[0];
          const srsContent = project
            ? buildDeterministicSrsMarkdown(store, project, reqSession, session, loc)
            : '# 需求规格说明书\n\n## 1. 引言与业务目标 (Introduction & Business Goals)\n';
          const reason = existingPrimaryDoc
            ? pickLocaleText(
                loc,
                '结合最新对话中的业务要点重新整理并更新了需求文档各章节。',
                'Refreshed the requirements document sections from your latest conversation points.',
              )
            : pickLocaleText(
                loc,
                '根据对话中确认的业务对象、规则与约定整理出首版需求文档。',
                'Organized the initial requirements document from your confirmed business objects and rules.',
              );
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `正在汇总需求探索会话上下文、已沉淀候选规则与领域边界，合成标准 9 章节《需求规格说明书.md》并落库。`,
                  `Synthesizing canonical 9-chapter Software Requirements Specification from requirement session context and candidate domain rules.`,
                ),
              ),
              fauxToolCall('save_synthesized_srs_doc', {
                ...(typeof parsedAction?.params.docId === 'string' && parsedAction.params.docId
                  ? { docId: parsedAction.params.docId }
                  : {}),
                ...(typeof parsedAction?.params.title === 'string' && parsedAction.params.title
                  ? { title: parsedAction.params.title }
                  : {}),
                status: 'DRAFT',
                content: srsContent,
                reason,
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }

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

      // COPILOT default: inspect, synthesize 11-model suite, or mutate Ontology Suite
      if (
        parsedAction?.kind === 'SYNTHESIZE_ONTOLOGY_SUITE' ||
        /合成\s*11\s*(?:元)?模型|一键推导\s*11\s*模型|synthesize\s+(?:11[- ]model\s+)?ontology/i.test(
          userPrompt,
        )
      ) {
        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                loc,
                `正在从已确认交互原型确定性提取 MU 界面模型，联动补齐 M1~M7 / ME / MM / MI 共 11 个元模型并执行两级一致性门禁校验。`,
                `Extracting MU UI model from confirmed prototype HTML, aligning all 11 ontology models (M1–M7, ME, MU, MM, MI), and validating through the two-tier consistency gate.`,
              ),
            ),
            fauxToolCall('synthesize_ontology_suite', {
              ...(typeof parsedAction?.params.prototypeId === 'string' &&
              parsedAction.params.prototypeId
                ? { prototypeId: parsedAction.params.prototypeId }
                : {}),
              ...(typeof parsedAction?.params.docId === 'string' && parsedAction.params.docId
                ? { docId: parsedAction.params.docId }
                : {}),
            }),
          ],
          { stopReason: 'toolUse' },
        );
      }

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
        const explicitlyBehavior =
          !explicitlyRule &&
          (userPrompt.includes('业务操作') ||
            userPrompt.includes('操作') ||
            userPrompt.includes('行为') ||
            lower.includes('behavior') ||
            lower.includes('action') ||
            activeModelCode === 'M2');

        if (explicitlyBehavior) {
          const nextBehIdx = (project?.suite.M2?.behaviors.length ?? 4) + 1;
          const targetOwner = project?.suite.M1?.aggregates[0]?.name ?? 'Contract';
          const bracketMatch = /[『「"']([^』」"']+)[』」"']/.exec(userPrompt)?.[1]?.trim();
          const afterKeywordMatch = /(?:业务操作|操作|行为|action|behavior)\s*[:：]?\s*([^\s，,。.!！;；]+)/i
            .exec(userPrompt)?.[1]
            ?.trim();
          const behAlias =
            bracketMatch ||
            afterKeywordMatch ||
            pickLocaleText(loc, '提交审批', 'Submit for Approval');
          const behName =
            behAlias === '提交审批' || /submit\s+for\s+approval/i.test(behAlias)
              ? 'SubmitForApproval'
              : `BusinessAction0${nextBehIdx}`;
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `解析到业务操作建模意图，调用 upsert_behavior 写入结构化操作并执行一致性校验。`,
                  `Parsed action modeling intent; calling upsert_behavior and validating suite consistency.`,
                ),
              ),
              fauxToolCall('upsert_behavior', {
                id: `BHV-0${nextBehIdx}`,
                name: behName,
                alias: behAlias,
                ownerEntity: targetOwner,
                behaviorType: 'COMMAND',
                triggerType: 'USER_ACTION',
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }

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

      if (lastResult?.toolName === 'propose_step_handoff' && !lastResult.isError) {
        const parsedHandoff = extractJsonObjectFromText<{
          targetStep?: ProjectStepId;
          reason?: string;
        }>(lastResultText);
        const stepId = parsedHandoff?.targetStep ?? 'BUSINESS_MODEL';
        const stepName = PROJECT_STEP_NAMES[stepId];
        const reasonText = parsedHandoff?.reason?.trim();
        return fauxAssistantMessage([
          fauxText(
            loc === 'en-US'
              ? `${reasonText ? `${reasonText}. ` : `This request belongs in the ${stepName.en} step. `}I kept the current step unchanged and prepared a hand-off card below so you can continue in ${stepName.en} or stay here.`
              : `${reasonText ? `${reasonText}。` : `这项内容属于「${stepName.zh}」步骤的范围。`}我不会在当前步骤直接改动，已在下方准备好转交卡片，你可以转到该步骤继续，也可以选择留在这里。`,
          ),
        ]);
      }

      if (session.agentKind === 'REQUIREMENT') {
        if (lastResult?.isError) {
          return fauxAssistantMessage([
            fauxText(
              pickLocaleText(
                loc,
                '需求整理过程中遇到问题，请补充描述或重试。',
                'Could not update the requirements document; please add more detail or retry.',
              ),
            ),
          ]);
        }
        if (lastResult?.toolName === 'save_synthesized_srs_doc') {
          return fauxAssistantMessage([
            fauxText(
              pickLocaleText(
                loc,
                '已整理并更新需求文档，你可以在右侧逐章核对内容，确认无误后点击「确认需求文档」。',
                'Updated the requirements document. Review the sections on the right and click Confirm requirements when ready.',
              ),
            ),
          ]);
        }
        return fauxAssistantMessage([
          fauxText(
            pickLocaleText(
              loc,
              '已记录你提到的业务对象、规则与约定。你可以继续补充流程细节，或整理成完整需求文档。',
              'Recorded the business objects, rules, and choices from your message. Continue adding details or generate the full requirements document.',
            ),
          ),
        ]);
      }

      if (session.agentKind === 'ARCHITECTURE' || session.agentKind === 'CODING') {
        const result = extractJsonObjectFromText<Record<string, unknown>>(lastResultText);
        if (session.agentKind === 'CODING' && lastResult?.toolName === 'read_application_inputs' && !lastResult.isError) {
          const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics.map(String) : [];
          const application = result?.application as { id?: string; developmentInstructions?: string } | undefined;
          if (/完善|补充|修改|更新|保存|同步|refine|save|update|add|include/i.test(userPrompt) && application?.id) {
            const instruction = userPrompt.replace(/^\[Target application ID: [^\]\r\n]+\]\s*/, '');
            const quoteSource = (text: string) => text.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
            const existingInstructions = application.developmentInstructions?.trim();
            const existingContent = existingInstructions && /[\u3400-\u9fff]/.test(existingInstructions)
              ? ['# Application Implementation Specification', '## Existing instructions (quoted source)', quoteSource(existingInstructions)]
              : [existingInstructions || '# Application Implementation Specification'];
            return fauxAssistantMessage([fauxToolCall('save_application_instructions', {
              applicationId: application.id,
              developmentInstructions: [
                ...existingContent,
                '## Requested refinement',
                'Use the quoted business source to refine implementation steps and acceptance criteria against the saved application inputs. Preserve confirmed UI intent and ontology semantics, and record unresolved contradictions.',
                '### Original user business request (quoted source)', quoteSource(instruction),
                ...(diagnostics.length ? ['## Open input diagnostics', ...diagnostics.map((item) => `- ${item}`)] : []),
              ].join('\n\n'),
            })], { stopReason: 'toolUse' });
          }
          return fauxAssistantMessage([fauxText([
            pickLocaleText(loc, '### 应用规格输入检查', '### Application specification input review'),
            ...diagnostics.map((item) => `- ${item}`),
            application?.developmentInstructions || pickLocaleText(loc, '尚未保存应用专属开发指令。', 'No application-specific implementation instructions have been saved.'),
          ].join('\n\n'))]);
        }
        return fauxAssistantMessage([fauxText(lastResult?.isError
          ? lastResultText
          : session.agentKind === 'ARCHITECTURE' && lastResult?.toolName !== 'read_architecture_assets'
            ? pickLocaleText(loc, `### 已保存仓库规范\n\n${String(result?.name ?? '')}`, `### Repository standard saved\n\n${String(result?.name ?? '')}`)
            : session.agentKind === 'CODING'
              ? pickLocaleText(loc, '请选择当前工程的目标应用，再完善开发规格。', 'Select the target application in this project before refining its implementation specification.')
              : pickLocaleText(loc, '### 已读取仓库规范目录\n\n请选择要完善的规范。', '### Repository standards inspected\n\nSelect a standard to refine.'))]);
      }

      if (
        session.agentKind === 'PROTOTYPE_CO_DESIGN' &&
        !(lastResult?.toolName === 'rewrite_prototype_page' && !lastResult.isError)
      ) {
        const targetProto = resolveTargetPrototypeForSession(store, session);
        if (targetProto && isBriefRestylePrompt(userPrompt)) {
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `已盘点现有语义锚点，现调用 \`rewrite_prototype_page\` 按更新后的设计简报整页重做视觉令牌与布局风格，同时完整保留所有既有屏幕与控件锚点。`,
                  `Semantic anchors verified; calling \`rewrite_prototype_page\` to apply the updated Design Brief style tokens while preserving all existing screen and element anchors.`,
                ),
              ),
              fauxToolCall('rewrite_prototype_page', {
                htmlContent: applyMockBriefRestyleToHtml(targetProto.htmlContent, userPrompt),
                allowAnchorReset: false,
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }
        const target = parseMockPrototypeTargetFromPrompt(userPrompt, targetProto);
        const cleanInstruction = stripSelectionBlockFromPrompt(userPrompt);
        const safeLabel =
          cleanInstruction
            .replace(/[<>&"'`\n]/g, ' ')
            .trim()
            .slice(0, 16) || pickLocaleText(loc, '辅助操作', 'Quick Action');
        const uid = Date.now().toString(36).slice(-4).toUpperCase();

        if (userPrompt.includes('[TEST_ANCHOR_SELF_REPAIR]')) {
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `尝试向目标屏幕追加控件并交由语义锚点一致性校验器检查。`,
                  `Attempting anchored edit and verifying semantic anchor gate.`,
                ),
              ),
              fauxToolCall('edit_prototype_anchor', {
                ...(target.screenId ? { screenId: target.screenId } : {}),
                ...(target.elementId && !target.screenId ? { elementId: target.elementId } : {}),
                operation: target.screenId ? 'append_to_screen' : 'insert_after_element',
                htmlFragment: `<button type="button" class="btn-secondary">${safeLabel}</button>`,
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }

        const wantsInput = /输入|筛选|搜索|字段|文本框|filter|input|search|field/i.test(
          cleanInstruction,
        );
        const fragment = wantsInput
          ? `<input type="text" placeholder="${safeLabel}" data-element-id="EL-CO-INP-${uid}" data-element-type="INPUT" data-element-label="${safeLabel}" />`
          : `<button type="button" class="btn-secondary" data-element-id="EL-CO-BTN-${uid}" data-element-type="BUTTON" data-element-label="${safeLabel}">${safeLabel}</button>`;

        return fauxAssistantMessage(
          [
            fauxThinking(
              pickLocaleText(
                loc,
                `已读取目标锚点上下文，现调用 \`edit_prototype_anchor\` 执行局部手术式修改，保持其余屏幕与兄弟节点逐字节不变。`,
                `Target anchor context inspected; calling \`edit_prototype_anchor\` for surgical modification while preserving untouched screens byte-for-byte.`,
              ),
            ),
            fauxToolCall('edit_prototype_anchor', {
              ...(target.elementId
                ? { elementId: target.elementId, operation: 'insert_after_element' }
                : target.screenId
                  ? { screenId: target.screenId, operation: 'append_to_screen' }
                  : {
                      cssSelector: target.cssSelector || 'section',
                      operation: 'append_to_screen',
                    }),
              htmlFragment: fragment,
            }),
          ],
          { stopReason: 'toolUse' },
        );
      }

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
      if (session.agentKind === 'COPILOT') {
        const isInspectionOnly =
          toolResults.length > 0 &&
          toolResults.every((tr) => tr.toolName === 'inspect_ontology_model');
        return fauxAssistantMessage([
          fauxThinking(
            pickLocaleText(
              loc,
              `工具执行与一致性校验已完成，正在汇总业务模型说明。`,
              `Tool execution and consistency validation finished; summarizing business model update.`,
            ),
          ),
          fauxText(
            isInspectionOnly
              ? pickLocaleText(
                  loc,
                  `已检查当前业务模型的结构与状态，目前共有 ${freshProject?.validation.errorCount ?? 0} 个需要修正的问题。`,
                  `Reviewed the current business model; ${freshProject?.validation.errorCount ?? 0} problems to fix.`,
                )
              : lastResult?.isError
                ? pickLocaleText(
                    loc,
                    `由于与其他业务对象或规则存在关联约束，本次改动未生效，请确认关联影响后再试。`,
                    `This change could not be applied because other business objects or rules depend on it.`,
                  )
                : pickLocaleText(
                    loc,
                    `已按你的说明更新业务模型，具体调整已列在下方变更说明中，点击任意条目即可定位到对应业务对象。`,
                    `Updated the business model according to your request; review the change summary below or click any item to locate it on the canvas.`,
                  ),
          ),
        ]);
      }

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
    // Step 3 (if Step 2 performed a tool call or triggered validator self-repair):
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

      if (session.agentKind === 'CODING') {
        return fauxAssistantMessage([fauxText(lastResult?.isError
          ? pickLocaleText(loc, '应用规格保存失败，请查看工具诊断。', 'Application specification could not be saved; review the tool diagnostic.')
          : pickLocaleText(loc, '### 已保存应用专属开发规格\n\n可继续检查输入与验收条件。', '### Application implementation instructions saved\n\nContinue reviewing inputs and acceptance criteria.'))]);
      }

      if (session.agentKind === 'PROTOTYPE_CO_DESIGN') {
        if (lastResult?.isError && lastResult.toolName === 'edit_prototype_anchor') {
          const targetProto = resolveTargetPrototypeForSession(store, session);
          const target = parseMockPrototypeTargetFromPrompt(userPrompt, targetProto);
          const cleanInstruction = stripSelectionBlockFromPrompt(userPrompt);
          const safeLabel =
            cleanInstruction
              .replace(/[<>&"'`\n]/g, ' ')
              .trim()
              .slice(0, 16) || pickLocaleText(loc, '加急操作', 'Quick Action');
          const uid = Date.now().toString(36).slice(-4).toUpperCase();
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `检测到上一轮局部编辑因缺少必填语义锚点被拦截，立即补齐合法的 \`data-element-id\` 与 \`data-element-type\` 在同一轮完成自修复。`,
                  `Previous anchored edit was rejected for missing semantic anchors; self-repairing in the same turn with valid \`data-element-id\` and \`data-element-type\`.`,
                ),
              ),
              fauxToolCall('edit_prototype_anchor', {
                ...(target.screenId ? { screenId: target.screenId } : {}),
                ...(target.elementId && !target.screenId ? { elementId: target.elementId } : {}),
                operation: target.screenId ? 'append_to_screen' : 'insert_after_element',
                htmlFragment: `<button type="button" class="btn-secondary" data-element-id="EL-CO-REPAIR-${uid}" data-element-type="BUTTON" data-element-label="${safeLabel}">${safeLabel}</button>`,
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }

        const targetProto = resolveTargetPrototypeForSession(store, session);
        const target = parseMockPrototypeTargetFromPrompt(userPrompt, targetProto);
        const anchorLabel = target.elementId || target.screenId || 'target-anchor';
        return fauxAssistantMessage([
          fauxThinking(
            pickLocaleText(
              loc,
              `锚点 \`${anchorLabel}\` 局部精修与语义锚点校验已通过，正在汇总本次原型修订。`,
              `Anchored edit on \`${anchorLabel}\` passed semantic validation; summarizing prototype revision.`,
            ),
          ),
          fauxText(
            loc === 'en-US'
              ? `Completed surgical refinement on anchor \`${anchorLabel}\` while keeping all other screens and sibling controls unchanged.`
              : `已完成目标锚点 \`${anchorLabel}\` 的局部精修，其余业务屏幕与未触碰控件均保持逐字节不变。`,
          ),
        ]);
      }

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
    // Step 4 (final summary after PROTOTYPE_CO_DESIGN self-repair in Step 3):
    (context) => {
      const lastUserMsg = [...context.messages]
        .reverse()
        .find((m): m is Extract<Message, { role: 'user' }> => m.role === 'user');
      const userPrompt = extractUserMessageText(lastUserMsg);
      const loc = resolveEffectiveLocale(store, explicitLocale, userPrompt);
      return fauxAssistantMessage([
        fauxThinking(
          pickLocaleText(
            loc,
            `语义锚点自修复已通过校验，生成修订总结。`,
            `Semantic anchor self-repair succeeded; emitting revision summary.`,
          ),
        ),
        fauxText(
          loc === 'en-US'
            ? `Self-repaired semantic anchor attributes and applied the localized prototype edit cleanly.`
            : `已自动补齐控件语义锚点并完成局部精修。`,
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
      maxTokens: 32768,
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

export function getToolsForAgentKind(
  kind: AgentSessionKind,
  options?: { codeMode?: boolean; multiAgentConcurrency?: number },
): Tool[] {
  const toPiTool = (spec: OpenAiFunctionTool): Tool => ({
    name: spec.function.name,
    description: spec.function.description,
    parameters: spec.function.parameters,
  });

  const ontologyTools = OPENAI_ONTOLOGY_TOOLS.map(toPiTool);
  const extraByName = new Map(
    UNIFIED_AGENT_EXTRA_TOOLS.map((t) => [t.function.name, toPiTool(t)]),
  );
  const stepHandoffTool = extraByName.get('propose_step_handoff')!;

  const baseTools = ((): Tool[] => {
    switch (kind) {
      case 'REQUIREMENT':
        return [
          extraByName.get('record_requirement_insights')!,
          extraByName.get('save_synthesized_srs_doc')!,
          extraByName.get('inspect_ontology_model')!,
          extraByName.get('ask_user')!,
          stepHandoffTool,
        ];
      case 'COPILOT':
        return [
          ...ontologyTools,
          extraByName.get('synthesize_ontology_suite')!,
          extraByName.get('inspect_ontology_model')!,
          extraByName.get('ask_user')!,
          stepHandoffTool,
        ];
      case 'ARCHITECTURE':
        return [
          extraByName.get('read_architecture_assets')!,
          extraByName.get('save_architecture_asset')!,
          extraByName.get('save_tech_architecture_spec')!,
          extraByName.get('ask_user')!,
          stepHandoffTool,
        ];
      case 'CODING':
        return [
          extraByName.get('read_application_inputs')!,
          extraByName.get('save_application_instructions')!,
          extraByName.get('inspect_ontology_model')!,
          extraByName.get('ask_user')!,
          stepHandoffTool,
        ];
      case 'CAPABILITY':
        return [
          extraByName.get('invoke_mcp_tool')!,
          extraByName.get('run_ontology_extraction')!,
          extraByName.get('inspect_ontology_model')!,
          extraByName.get('ask_user')!,
          stepHandoffTool,
        ];
      case 'REASONING':
        return [
          extraByName.get('run_readonly_sql')!,
          extraByName.get('propose_policy_writeback')!,
          extraByName.get('save_metric_insight')!,
          extraByName.get('save_scenario_attribution_report')!,
          extraByName.get('inspect_ontology_model')!,
          extraByName.get('ask_user')!,
          stepHandoffTool,
        ];
      case 'PROTOTYPE_CO_DESIGN':
        return [
          ...PROTOTYPE_ANCHOR_OPENAI_TOOLS.map(toPiTool),
          extraByName.get('inspect_ontology_model')!,
          extraByName.get('ask_user')!,
          stepHandoffTool,
        ];
    }
  })();

  if (!options) return baseTools;

  const extras: Tool[] = [];
  if ((options.multiAgentConcurrency ?? 1) > 1) {
    extras.push(toPiTool(SPAWN_SUBAGENTS_OPENAI_TOOL));
  }
  if (options.codeMode) {
    extras.push(toPiTool(CODEMODE_OPENAI_TOOL));
  }
  return extras.length > 0 ? [...baseTools, ...extras] : baseTools;
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
  execOptions?: {
    codeMode?: boolean;
    multiAgentConcurrency?: number;
    offeredTools?: readonly Tool[];
  },
): string {
  const withExecFooter = (corePrompt: string): string => {
    if (!execOptions?.codeMode || !execOptions.offeredTools) {
      return corePrompt;
    }
    return `${corePrompt}\n\n${renderCodemodePromptSection(
      execOptions.offeredTools,
      locale,
      execOptions.multiAgentConcurrency ?? 3,
    )}`;
  };
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
  const applicationContext = session.agentKind === 'CODING'
    ? JSON.stringify(
        readApplicationSpecificationInputs(store, session),
        (key, value: unknown) => ['suite', 'htmlContent', 'specMarkdown'].includes(key) ? undefined : value,
      )
    : '';
  const architectureContext = session.agentKind === 'ARCHITECTURE'
    ? JSON.stringify({
        assets: store.listFourLayerAssets().map(({ specMarkdown: _body, ...metadata }) => metadata),
        technologyProfiles: store.listTechnologyProfiles(),
      })
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
      `1. Execute the routine tools provided to this specialist automatically. Never ask permission before calling routine tools.`,
      `2. ONLY call \`ask_user\` when required business parameters are missing or a Class-B business boundary ambiguity requires a human decision.`,
      `3. If an ontology mutation returns an 11-model consistency error (isError=true), read the diagnostics and self-repair in the same turn.`,
      `4. Always use the term "Ontology Extraction" — never "reverse engineering".`,
      `5. Step Isolation & Hand-off: NEVER execute mutations belonging to another Project Step (REQUIREMENTS=scope & requirements doc; PROTOTYPE=screen layout, table columns, buttons & visual styling; BUSINESS_MODEL=business objects, actions, business/approval rules, roles & permissions, flows, reports, storage & integrations; DELIVERY=application implementation specs & development package). When the user asks for work belonging to another step, explain briefly in plain business language and call \`propose_step_handoff\` with \`targetStep\`, \`request\`, and \`reason\`.`,
      getBlockedStepExplanation(store, session, 'en-US')
        ? `[Current Step Status — Cannot Start Yet] ${getBlockedStepExplanation(store, session, 'en-US')} Do NOT call any mutation or synthesis tools until the upstream step is confirmed.`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    if (session.agentKind === 'REASONING') {
      return [
        baseHeaderEn,
        `Current reasoning mode: ${session.reasoningMode ?? 'ASK_DATA'} (ASK_DATA=data query, ASK_WHY=root-cause attribution, ASK_POLICY=policy writeback).`,
        renderedGrounding,
        writebacks ? `Registered writeback interfaces: ${writebacks}.` : '',
        `Call run_readonly_sql first to inspect live SQLite data before drawing conclusions; every figure you state must come from a query result. When requested via [ACTION:METRIC_INSIGHT ...], MUST call save_metric_insight with live SQLite evidence. When requested via [ACTION:SCENARIO_ATTRIBUTION ...], MUST call save_scenario_attribution_report with causalBreakdown weights grounded in SQLite results. In ASK_POLICY mode, call propose_policy_writeback to propose governed actions.`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    if (session.agentKind === 'CAPABILITY') {
      const caps = project ? inspectOntologyMcpCapabilities(project) : null;
      const toolNames = caps?.tools.map((t) => `${t.name}(${t.sourceModel})`).join(', ') ?? 'none';
      return `${baseHeaderEn}\nCompiled Ontology MCP tools: ${toolNames}. Prefer calling invoke_mcp_tool to execute domain queries or behaviors; when asked to perform Ontology Extraction ([ACTION:RUN_ONTOLOGY_EXTRACTION ...] or DDL/OpenAPI/source extraction), MUST call run_ontology_extraction.`;
    }
    if (session.agentKind === 'ARCHITECTURE') {
      return `${baseHeaderEn}\nYou are the Architecture Asset Agent. Author and maintain reusable repository-owned UI, technical foundation and technical architecture standards. Write platform-generated development standards in English; conversation follows the user's language, and original business references retain their source language. Repository files are authoritative; use read_architecture_assets to inspect current sources and save_architecture_asset (or save_tech_architecture_spec for TECH_ARCH) to persist authored standards with the chosen technologyProfileId. Standards are shared assets; this session does not select or change a target application's inputs. Do not claim to implement code, run a build or execute tests.\nRepository standards catalog: ${architectureContext}`;
    }
    if (session.agentKind === 'CODING') {
      return `${baseHeaderEn}\nYou are the Application Development Agent, helping refine an application implementation specification. Conversation follows the user's language. Author application implementation instructions saved via save_application_instructions in English; original Chinese business material may remain only as clearly quoted source. Target application ID: ${session.targetId ?? '(unselected)'}. Read read_application_inputs before recommending changes; inspect the requirements, confirmed prototype, Ontology Suite, selected Technology Profile and standards, and existing application instructions. Ontology defines business semantics, the confirmed prototype defines UI intent, and the selected standards define engineering constraints. Diagnose missing inputs and explicit contradictions, and ask_user for unresolved choices. Preserve Stage Warnings as non-blocking. Save the complete refined application-specific Markdown with save_application_instructions. Record unresolved explicit contradictions in developmentBlockers to block formal package generation; omission preserves the previous list, and [] is allowed only after resolving those contradictions with the user. An explicit application must belong to this session project; never substitute an unrelated application or standard. Shared standards are authored in the Architecture Asset Agent. Development Package generation is an ordinary explicit action after inputs are resolved. Your tools refine specifications; do not claim code implementation, build or test execution.\nSaved target inputs (use read_application_inputs for full references): ${applicationContext}`;
    }
    if (session.agentKind === 'REQUIREMENT') {
      return `${baseHeaderEn}\nFollow progressive business requirement clarification: auto-complete standard defaults with [AI Auto-Completed], tag confirmed business rules with [Confirmed], and when a business choice is needed, call ask_user to ask ONLY ONE question at a time with 2-4 plain business-language options (no model codes or IDs) and allowFreeform: true. Call record_requirement_insights to persist candidate business objects and rules, and when asked to synthesize the requirements document ([ACTION:SYNTHESIZE_SRS ...] or user request), MUST call save_synthesized_srs_doc with the complete 9-chapter Markdown specification (## 1. through ## 9., including ### 9.1 through ### 9.7).`;
    }
    if (session.agentKind === 'PROTOTYPE_CO_DESIGN') {
      const confirmedReq = store.getProjectStepConfirmations(session.projectId).requirements;
      const confirmedReqSection = confirmedReq
        ? `Confirmed Requirements Document (${confirmedReq.title} ${confirmedReq.version}):\n${confirmedReq.content.slice(0, 3000)}`
        : `Confirmed Requirements Document: NOT YET CONFIRMED. If asked to generate a new prototype before Requirements are confirmed, explain in plain business language that the user must confirm the requirements document in the Requirements step first.`;
      const proto = resolveTargetPrototypeForSession(store, session);
      if (!proto) {
        const useParallel = (execOptions?.multiAgentConcurrency ?? 1) > 1;
        return withExecFooter(
          [
            baseHeaderEn,
            confirmedReqSection,
            `Target Interactive Prototype: Unbound initial generation (Revision #1 from Design Brief).`,
            `Initial Prototype Generation Rules:`,
            useParallel
              ? `1. ONLY when a Confirmed Requirements Document is present above: FIRST call \`init_prototype_shell\` with 3–4 screen artboards matching the requirements and Design Brief tokens so the user sees live artboards immediately; THEN call \`spawn_subagents\` (directly or inside \`codemode\`) so ${execOptions?.multiAgentConcurrency ?? 3} parallel subagents build each screen simultaneously via \`upsert_prototype_screen\` (~80–180 lines per screen). Do NOT dump all screens into one giant \`rewrite_prototype_page\` call.`
              : `1. Call \`rewrite_prototype_page\` with \`allowAnchorReset: true\` (or \`init_prototype_shell\` + \`upsert_prototype_screen\`) ONLY when a Confirmed Requirements Document is present above.`,
            `2. Strictly follow the confirmed Design Brief, reference DESIGN.md tokens, interactive motion specifications, and the Confirmed Requirements Document scope (never unconfirmed drafts).`,
            `3. Include semantic anchors (\`data-screen-id\`, \`data-screen-name\`, \`data-screen-type\`, \`data-element-id\`, \`data-element-type\`, \`data-binding\`, \`data-event-id\`) on every screen and interactive control, and NEVER use window.alert/confirm/prompt.`,
            `4. Ensure clean responsive layout across Desktop (1440px), Tablet (768px), and Mobile (390px) viewports.`,
            `5. If an anchor validator returns isError=true, fix the semantic anchors and retry in the same turn.`,
          ].join('\n'),
        );
      }
      const overview = listPrototypeAnchors(proto.htmlContent);
      const screensDesc =
        overview.screens
          .map((s) => `${s.screenId}(${s.screenName}:${s.screenType}, elements=${s.elementCount})`)
          .join(', ') || 'none';
      return withExecFooter(
        [
          baseHeaderEn,
          `Target Interactive Prototype: ${proto.name} (ID: ${proto.id}, Version: ${proto.version}).`,
          `Screens in prototype: ${screensDesc}.`,
          `Prototype Co-Design Rules:`,
          `1. Always call \`read_prototype_anchor\` (or \`list_prototype_anchors\`) first to inspect ONLY the targeted element or screen without reading unrelated screens.`,
          `2. For localized refinements, ALWAYS call \`edit_prototype_anchor\` (\`replace_element\` | \`insert_after_element\` | \`append_to_screen\` | \`update_attributes\`) or \`upsert_prototype_screen\` so untouched screens stay intact.`,
          `3. For whole-page visual restyling across multiple screens, prefer \`spawn_subagents\` with \`upsert_prototype_screen\` per screen.`,
          `4. Preserve existing \`data-screen-id\`, \`data-element-id\`, \`data-binding\`, and \`data-event-id\` anchors, add valid \`data-element-id\` + \`data-element-type\` on every new <button>/<input>/<select>/<textarea>, and NEVER use window.alert/confirm/prompt.`,
          `5. If an edit tool returns isError=true, fix the semantic anchors and retry in the same turn.`,
        ].join('\n'),
      );
    }
    return withExecFooter(
      `${baseHeaderEn}\nCurrent M1 aggregates: ${(project?.suite.M1?.aggregates ?? []).map((a) => `${a.name}(${a.id}:${a.alias})`).join(', ') || 'none'}; M3 rules count: ${project?.suite.M3?.rules.length ?? 0}. When asked to synthesize the 11-model Ontology Suite from the prototype ([ACTION:SYNTHESIZE_ONTOLOGY_SUITE ...] or user request), MUST call synthesize_ontology_suite.`,
    );
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
    `1. 当前专职智能体可用的常规工具均直接自动调用，严禁在调用常规工具前向用户索要权限许可。`,
    `2. 仅当缺少必填业务参数或存在 B 类业务规则分歧需要用户拍板时，才调用 \`ask_user\` 工具弹出结构化单选/多选卡片。`,
    `3. 若本体变更工具返回 11 模型一致性错误（isError=true），请仔细阅读错误诊断并在本轮自动修正参数重试。`,
    `4. 严禁使用“逆向”或“逆向工程”字眼，统一使用“本体萃取 (Ontology Extraction)”。`,
    `5. 跨步骤隔离与步骤转交准则：严禁在当前会话中执行其他步骤的改动（REQUIREMENTS=需求范围与需求文档；PROTOTYPE=页面布局、表格列、按钮与视觉样式；BUSINESS_MODEL=业务对象、业务操作、审批与校验等业务规则、角色权限、流程、报表、存储与接口；DELIVERY=应用实施说明与开发资料包）。当用户提出属于其他步骤的请求时，请用通俗业务语言简要说明原因，并调用 \`propose_step_handoff\` 工具（传入 \`targetStep\`、原样携带的 \`request\` 与 \`reason\`）生成转交卡片。`,
    getBlockedStepExplanation(store, session, 'zh-CN')
      ? `【当前步骤状态：还不能开始】${getBlockedStepExplanation(store, session, 'zh-CN')} 在上游步骤确认前，严禁调用任何写入或合成工具。`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  if (session.agentKind === 'REASONING') {
    return [
      baseHeader,
      `当前分析推理模式：${session.reasoningMode ?? 'ASK_DATA'}（ASK_DATA=智能问数，ASK_WHY=智能问因，ASK_POLICY=智能问策）。`,
      renderedGrounding,
      writebacks ? `当前已注册闭环回写接口：${writebacks}。` : '',
      `优先调用 run_readonly_sql 获取真实表数据后再输出结论，结论中的每个数字都必须来自查询结果；收到 [ACTION:METRIC_INSIGHT ...] 时必须结合实查结果调用 save_metric_insight 输出指标异动洞察；收到 [ACTION:SCENARIO_ATTRIBUTION ...] 时必须结合实查结果调用 save_scenario_attribution_report 归档场景归因报告；在 ASK_POLICY 模式下可调用 propose_policy_writeback 生成策略建议。`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (session.agentKind === 'CAPABILITY') {
    const caps = project ? inspectOntologyMcpCapabilities(project) : null;
    const toolNames = caps?.tools.map((t) => `${t.name}(${t.sourceModel})`).join(', ') ?? '无';
    return withExecFooter(
      `${baseHeader}\n当前工程可用 Ontology MCP 工具：${toolNames}。优先调用 invoke_mcp_tool 执行业务动作或查询；当收到本体萃取请求（如 [ACTION:RUN_ONTOLOGY_EXTRACTION ...] 或 DDL/OpenAPI/文档本体萃取）时，必须调用 run_ontology_extraction 工具。`,
    );
  }
  if (session.agentKind === 'ARCHITECTURE') {
    return withExecFooter(
      `${baseHeader}\n你是架构资产智能体，编写和维护仓库拥有的可复用 UI、技术底座和技术架构规范。平台生成的开发规范正文使用英文；对话跟随用户语言，原始业务参考保留来源语言。仓库文件是权威来源；先用 read_architecture_assets 读取规范与来源，再通过 save_architecture_asset 保存并声明选定的 technologyProfileId，TECH_ARCH 也可用 save_tech_architecture_spec。规范是共享资产，本会话不选择或修改目标应用的输入。不得声称已经实现代码、运行构建或执行测试。\n仓库规范目录：${architectureContext}`,
    );
  }
  if (session.agentKind === 'CODING') {
    return withExecFooter(
      `${baseHeader}\n你是应用开发智能体，负责完善应用的实施规格。对话跟随用户语言。通过 save_application_instructions 编写并保存的应用实施指令必须使用英文；原始中文业务材料可保留为明确标注的引用来源。目标应用 ID：${session.targetId ?? '（未选择）'}。先通过 read_application_inputs 读取需求、已确认原型、本体套件、选定技术方案与规范、现有应用指令，再诊断缺项和明确冲突。本体定义业务语义，已确认原型定义 UI 意图，选定规范定义工程约束；存在未决选择时用 ask_user 澄清，阶段提示保持非阻断。通过 save_application_instructions 保存完整的应用专属 Markdown 实施指令；将未解决的明确矛盾写入 developmentBlockers，阻断正式开发包生成。省略该参数保留已有清单；只有与用户解决这些矛盾后才可传 [] 清空。明确应用必须属于当前会话工程，不得用其他应用或规范代替缺失输入。共享规范由架构资产智能体维护。开发包在输入问题解决后由普通显式生成操作产出。你的工具负责完善规格，不得声称已经实现代码、运行构建或执行测试。\n目标已保存输入（完整引用请调用 read_application_inputs）：${applicationContext}`,
    );
  }
  if (session.agentKind === 'REQUIREMENT') {
    return withExecFooter(
      `${baseHeader}\n遵循渐进式业务需求梳理准则：常规默认项标注 [AI自动补全]，已明确的业务规则标注 [已确认]；需要用户拍板时调用 ask_user 工具，每次只问一个问题，附 2～4 个通俗业务语言的可点选方案（严禁出现模型代号或内部标识符）并允许自由输入；调用 record_requirement_insights 沉淀业务对象与规则；当用户请求整理或合成需求文档（如 [ACTION:SYNTHESIZE_SRS ...]）时，必须调用 save_synthesized_srs_doc 工具提交完整 9 章节《需求规格说明书.md》（含 ## 1. ~ ## 9. 及 ### 9.1 ~ ### 9.7）。`,
    );
  }
  if (session.agentKind === 'PROTOTYPE_CO_DESIGN') {
    const confirmedReq = store.getProjectStepConfirmations(session.projectId).requirements;
    const confirmedReqSection = confirmedReq
      ? `【已确认需求文档快照】（${confirmedReq.title} ${confirmedReq.version}）：\n${confirmedReq.content.slice(0, 3000)}`
      : `【已确认需求文档快照】：尚未确认。若用户在需求确认前请求生成新原型，请用业务语言说明需先在「需求」步骤确认需求文档后再生成原型。`;
    const proto = resolveTargetPrototypeForSession(store, session);
    if (!proto) {
      const useParallel = (execOptions?.multiAgentConcurrency ?? 1) > 1;
      return withExecFooter(
        [
          baseHeader,
          confirmedReqSection,
          `当前共创目标交互原型：未绑定（按设计简报与已确认需求文档从零生成首版交互原型 Revision #1）。`,
          `首版原型生成准则（快速上屏，禁止在 thinking 中默写整页长代码）：`,
          useParallel
            ? `1. 仅在已存在【已确认需求文档快照】时：**严禁在 thinking 中默写整页代码，也严禁调用单次巨型 \`rewrite_prototype_page\`**！请立即在 \`codemode\` 中或分步执行：① 先调用 \`init_prototype_shell\` 声明共享视觉令牌与 3～4 个核心业务分屏骨架（使画布 0 秒点亮所有画板）；② 紧接着调用 \`spawn_subagents\` 派发分屏任务（系统将按并发度 ${execOptions?.multiAgentConcurrency ?? 3} 并行运行子智能体，每个子智能体各自调用 \`upsert_prototype_screen\` 输出单屏紧凑 HTML，每屏控制在 80～180 行）。`
            : `1. 仅在已存在【已确认需求文档快照】时，调用 \`init_prototype_shell\` + \`upsert_prototype_screen\`（或 \`rewrite_prototype_page\` 携带 \`allowAnchorReset: true\`）输出可运行 HTML5 原型。`,
          `2. 严格落实设计简报条目、Inspo DESIGN.md 设计令牌、交互动效约束与【已确认需求文档快照】（严禁读取未确认草稿）。`,
          `3. 每个业务屏幕必须声明合法 \`data-screen-id\`、\`data-screen-name\`、\`data-screen-type\`，所有 <button>/<input>/<select>/<textarea> 必须携带全局唯一合法 \`data-element-id\` 与 \`data-element-type\`（并合理挂载 \`data-binding\` 与 \`data-event-id\`），严禁使用 window.alert/confirm/prompt。`,
          `4. 页面必须原生支持响应式布局，在桌面端 (1440px)、平板端 (768px) 与手机端 (390px) 视口下均排版整洁无溢出。`,
          `5. 若锚点校验器返回 isError=true，请根据诊断在本轮内补齐语义锚点并自动重试。`,
        ].join('\n'),
      );
    }
    const overview = listPrototypeAnchors(proto.htmlContent);
    const screensDesc =
      overview.screens
        .map((s) => `${s.screenId}(${s.screenName}:${s.screenType}, 控件数=${s.elementCount})`)
        .join(', ') || '无';
    return withExecFooter(
      [
        baseHeader,
        `当前共创目标交互原型：${proto.name}（ID: ${proto.id}，版本: ${proto.version}）。`,
        `当前原型包含屏幕锚点：${screensDesc}。`,
        `原型局部精修与分屏补全准则：`,
        `1. 针对尚未绘制完成的分屏（或单独重绘某一分屏），直接调用 \`upsert_prototype_screen\`（多屏调整可调用 \`spawn_subagents\` 并行处理），严禁无故重写其他无关屏幕。`,
        `2. 控件级局部改动一律先 \`read_prototype_anchor\` 再 \`edit_prototype_anchor\`（\`replace_element\` | \`insert_after_element\` | \`append_to_screen\` | \`update_attributes\`），确保未选中的屏幕与兄弟控件保持逐字节一致。`,
        `3. 严格保留既有 \`data-screen-id\`、\`data-element-id\`、\`data-binding\`、\`data-event-id\` 语义锚点；任何新增 <button>/<input>/<select>/<textarea> 必须携带合法唯一的 \`data-element-id\` 与 \`data-element-type\`；严禁使用 window.alert/confirm/prompt。`,
        `4. 若锚点校验器返回 isError=true，请根据诊断在本轮内补齐语义锚点并自动重试。`,
      ].join('\n'),
    );
  }
  return withExecFooter(
    `${baseHeader}\n当前 M1 聚合根：${(project?.suite.M1?.aggregates ?? []).map((a) => `${a.name}(${a.id}:${a.alias})`).join(', ') || '无'}；M3 规则数：${project?.suite.M3?.rules.length ?? 0}。当收到从确认原型合成 11 模型请求（如 [ACTION:SYNTHESIZE_ONTOLOGY_SUITE ...]）时，必须调用 synthesize_ontology_suite 工具并交由两级一致性校验门禁落库。`,
  );
}

// ─── Execute Single Tool Call (YOLO + Validator Gate + Scoped HITL) ──────────

interface PrototypeTurnDraft {
  prototypeId?: string;
  prototypeName: string;
  designBrief?: DesignBrief;
  baselineHtml: string;
  workingHtml: string;
  modifiedAnchors: PrototypeTargetAnchor[];
}

function recordModifiedAnchor(
  draft: PrototypeTurnDraft,
  anchor: PrototypeTargetAnchor | undefined,
): void {
  if (!anchor) return;
  const key = `${anchor.screenId ?? ''}::${anchor.elementId ?? ''}::${anchor.cssSelector ?? ''}`;
  if (
    !draft.modifiedAnchors.some(
      (a) => `${a.screenId ?? ''}::${a.elementId ?? ''}::${a.cssSelector ?? ''}` === key,
    )
  ) {
    draft.modifiedAnchors.push(anchor);
  }
}

interface ExecutedToolStep {
  trace: AgentToolCallTrace;
  toolResultContent: string;
  isError: boolean;
  artifact?: AgentDomainArtifact;
  askUserPrompt?: AgentAskUserPrompt;
  stepHandoffProposal?: StepHandoffProposal;
}

async function executeUnifiedToolCall(
  store: WorkspaceStore,
  session: AgentSession,
  tc: ToolCall,
  hadPreviousValidatorError: boolean,
  locale: AgentLocale = 'zh-CN',
  prototypeDraft?: PrototypeTurnDraft,
  options?: { isMock?: boolean; actionParams?: Record<string, unknown>; runId?: string },
): Promise<ExecutedToolStep> {
  const started = Date.now();
  const args = (tc.arguments ?? {}) as Record<string, unknown>;
  const ontologyToolSet = new Set<string>(ONTOLOGY_TOOL_NAMES);
  if (!getToolsForAgentKind(session.agentKind).some((tool) => tool.name === tc.name)) {
    const message = pickLocaleText(locale, `当前智能体不提供工具 ${tc.name}。`, `Tool ${tc.name} is unavailable to this specialist.`);
    return {
      trace: { id: tc.id, toolName: tc.name, arguments: args, output: message, isError: true, durationMs: Date.now() - started },
      toolResultContent: JSON.stringify({ error: message }),
      isError: true,
    };
  }

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

  // 1b. Cross-step hand-off proposal (#72)
  if (tc.name === 'propose_step_handoff') {
    const rawTarget = typeof args.targetStep === 'string' ? args.targetStep.trim() : '';
    const normalizedKey = rawTarget.toUpperCase().replace(/-/g, '_');
    const stepMap: Record<string, ProjectStepId> = {
      REQUIREMENTS: 'REQUIREMENTS',
      REQUIREMENT: 'REQUIREMENTS',
      PROTOTYPE: 'PROTOTYPE',
      BUSINESS_MODEL: 'BUSINESS_MODEL',
      MODEL: 'BUSINESS_MODEL',
      DELIVERY: 'DELIVERY',
    };
    const targetStep = stepMap[normalizedKey];
    if (!targetStep) {
      const errMsg = pickLocaleText(
        locale,
        `无效的目标步骤「${rawTarget}」，可选值：REQUIREMENTS、PROTOTYPE、BUSINESS_MODEL、DELIVERY。`,
        `Invalid targetStep "${rawTarget}"; expected REQUIREMENTS, PROTOTYPE, BUSINESS_MODEL, or DELIVERY.`,
      );
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: errMsg,
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({ status: 'ERROR', message: errMsg }),
        isError: true,
      };
    }

    const sourceStep = deriveProjectStepForSessionKind(session.agentKind);
    if (sourceStep && sourceStep === targetStep) {
      const sameMsg = pickLocaleText(
        locale,
        `当前已经在「${PROJECT_STEP_NAMES[targetStep].zh}」步骤，无需发起跨步骤转交。`,
        `Already in the ${PROJECT_STEP_NAMES[targetStep].en} step; no hand-off needed.`,
      );
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: sameMsg,
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({ status: 'ERROR', message: sameMsg }),
        isError: true,
      };
    }

    const rawRequest = typeof args.request === 'string' ? args.request.trim() : '';
    const cleanRequest = rawRequest || (latestUserPrompt(session)?.trim() ?? '');
    if (!cleanRequest) {
      const emptyMsg = pickLocaleText(
        locale,
        '转交请求内容不能为空。',
        'Hand-off request text cannot be empty.',
      );
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: emptyMsg,
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({ status: 'ERROR', message: emptyMsg }),
        isError: true,
      };
    }

    const cleanReason =
      typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim() : undefined;
    const proposal: StepHandoffProposal = {
      id: `handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sourceStep,
      targetStep,
      request: cleanRequest,
      ...(cleanReason ? { reason: cleanReason } : {}),
      status: 'PENDING',
    };
    const stepName = PROJECT_STEP_NAMES[targetStep];

    return {
      trace: {
        id: tc.id,
        toolName: tc.name,
        arguments: {
          targetStep,
          request: cleanRequest,
          ...(cleanReason ? { reason: cleanReason } : {}),
        },
        output: pickLocaleText(
          locale,
          `已准备转交到「${stepName.zh}」步骤：${cleanRequest}`,
          `Prepared hand-off to ${stepName.en}: ${cleanRequest}`,
        ),
        isError: false,
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify({
        status: 'HANDOFF_PROPOSED',
        handoffId: proposal.id,
        sourceStep,
        targetStep,
        request: cleanRequest,
        ...(cleanReason ? { reason: cleanReason } : {}),
      }),
      isError: false,
      stepHandoffProposal: proposal,
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

      const effectiveRunId = resolveAgentTurnRunId(session.messages, options?.runId, tc.id);
      const saved = store.commitSuite(project.id, mutation.nextSuite, {
        source: {
          kind: 'AGENT_RUN',
          runId: effectiveRunId,
          sessionId: session.id,
          toolName: tc.name,
        },
        note: `Pi Session (${session.title}) executed ${tc.name} -> ${mutation.elementId}`,
      });

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

  // 8b. Domain Synthesis & Analytics Agent Run Tools (Tickets #33 & #34)
  const domainToolResult = await executeDomainRunToolCall(
    store,
    session,
    tc.id,
    tc.name,
    args,
    locale,
    {
      ...(options?.isMock !== undefined ? { isMock: options.isMock } : {}),
      ...(options?.actionParams ? { actionParams: options.actionParams } : {}),
      ...(options?.runId ? { runId: options.runId } : {}),
    },
  );
  if (domainToolResult) {
    return domainToolResult;
  }

  // 9. Prototype Semantic-Anchor Tools (PROTOTYPE_CO_DESIGN)
  if (
    tc.name === 'list_prototype_anchors' ||
    tc.name === 'read_prototype_anchor' ||
    tc.name === 'edit_prototype_anchor' ||
    tc.name === 'rewrite_prototype_page' ||
    tc.name === 'init_prototype_shell' ||
    tc.name === 'upsert_prototype_screen'
  ) {
    const activeHtml =
      prototypeDraft?.workingHtml ?? resolveTargetPrototypeForSession(store, session)?.htmlContent;
    if (activeHtml === undefined) {
      const noProtoMsg = pickLocaleText(
        locale,
        '当前会话未找到可精修的交互原型',
        'No target interactive prototype found for this session',
      );
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: noProtoMsg,
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({ status: 'ERROR', diagnostic: noProtoMsg }),
        isError: true,
      };
    }

    if (tc.name === 'init_prototype_shell' || tc.name === 'upsert_prototype_screen') {
      if (
        !resolveTargetPrototypeForSession(store, session) &&
        !store.getProjectStepConfirmations(session.projectId).requirements
      ) {
        const unconfirmedMsg = pickLocaleText(
          locale,
          '需要先完成并确认需求文档，才能生成首版界面原型。',
          'Confirm the requirements document first before generating an initial prototype.',
        );
        return {
          trace: {
            id: tc.id,
            toolName: tc.name,
            arguments: args,
            output: unconfirmedMsg,
            isError: true,
            durationMs: Date.now() - started,
          },
          toolResultContent: JSON.stringify({
            status: 'REQUIREMENTS_NOT_CONFIRMED',
            diagnostic: unconfirmedMsg,
          }),
          isError: true,
        };
      }

      if (tc.name === 'init_prototype_shell') {
        const rawScreens = Array.isArray(args.screens) ? args.screens : [];
        const screens: PrototypeShellScreenStub[] = rawScreens
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            screenId: String(item.screenId ?? '').trim(),
            screenName: String(item.screenName ?? item.screenId ?? '').trim(),
            screenType: String(item.screenType ?? 'LIST').trim(),
            ...(typeof item.summary === 'string' ? { summary: item.summary } : {}),
          }))
          .filter((s) => Boolean(s.screenId));

        const shellInput: InitPrototypeShellInput = {
          appTitle: String(args.appTitle || prototypeDraft?.prototypeName || 'Interactive Prototype'),
          ...(typeof args.subtitle === 'string' ? { subtitle: args.subtitle } : {}),
          ...(args.themeTokens && typeof args.themeTokens === 'object'
            ? { themeTokens: args.themeTokens as NonNullable<InitPrototypeShellInput['themeTokens']> }
            : {}),
          ...(typeof args.sharedCss === 'string' ? { sharedCss: args.sharedCss } : {}),
          screens,
        };
        const shellRes = initPrototypeShell(shellInput, { locale });
        if (shellRes.isError) {
          return {
            trace: {
              id: tc.id,
              toolName: tc.name,
              arguments: args,
              output: shellRes.diagnostic || shellRes.summary,
              isError: true,
              durationMs: Date.now() - started,
            },
            toolResultContent: JSON.stringify({
              status: 'REJECTED_BY_ANCHOR_VALIDATOR',
              diagnostic: shellRes.diagnostic || shellRes.summary,
            }),
            isError: true,
          };
        }
        if (prototypeDraft) {
          prototypeDraft.workingHtml = shellRes.nextHtml;
          for (const scr of screens) {
            recordModifiedAnchor(prototypeDraft, {
              screenId: scr.screenId,
              label: scr.screenName || scr.screenId,
            });
          }
        }
        return {
          trace: {
            id: tc.id,
            toolName: tc.name,
            arguments: args,
            output: shellRes.summary,
            isError: false,
            ...(shellRes.targetAnchor ? { targetAnchor: shellRes.targetAnchor } : {}),
            durationMs: Date.now() - started,
          },
          toolResultContent: JSON.stringify({
            status: 'APPLIED',
            summary: shellRes.summary,
            screenIds: screens.map((s) => s.screenId),
          }),
          isError: false,
        };
      }

      // upsert_prototype_screen
      const screenRes = upsertPrototypeScreen(
        activeHtml,
        {
          screenId: String(args.screenId ?? ''),
          ...(typeof args.screenName === 'string' ? { screenName: args.screenName } : {}),
          ...(typeof args.screenType === 'string' ? { screenType: args.screenType } : {}),
          screenHtml: String(args.screenHtml ?? ''),
          ...(typeof args.extraCss === 'string' ? { extraCss: args.extraCss } : {}),
          ...(typeof args.extraJs === 'string' ? { extraJs: args.extraJs } : {}),
        },
        { locale },
      );
      if (screenRes.isError) {
        return {
          trace: {
            id: tc.id,
            toolName: tc.name,
            arguments: args,
            output: screenRes.diagnostic || screenRes.summary,
            isError: true,
            ...(screenRes.targetAnchor ? { targetAnchor: screenRes.targetAnchor } : {}),
            durationMs: Date.now() - started,
          },
          toolResultContent: JSON.stringify({
            status: 'REJECTED_BY_ANCHOR_VALIDATOR',
            diagnostic: screenRes.diagnostic || screenRes.summary,
            targetAnchor: screenRes.targetAnchor,
          }),
          isError: true,
        };
      }
      if (prototypeDraft) {
        prototypeDraft.workingHtml = screenRes.nextHtml;
        recordModifiedAnchor(prototypeDraft, screenRes.targetAnchor);
      }
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: screenRes.summary,
          isError: false,
          ...(hadPreviousValidatorError ? { validatorRepair: true } : {}),
          ...(screenRes.targetAnchor ? { targetAnchor: screenRes.targetAnchor } : {}),
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({
          status: 'APPLIED',
          summary: screenRes.summary,
          targetAnchor: screenRes.targetAnchor,
        }),
        isError: false,
      };
    }

    if (tc.name === 'list_prototype_anchors') {
      const overview = listPrototypeAnchors(activeHtml);
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: pickLocaleText(
            locale,
            `已枚举 ${overview.screens.length} 个屏幕锚点与 ${overview.elements.length} 个交互控件锚点`,
            `Listed ${overview.screens.length} screen anchors and ${overview.elements.length} element anchors`,
          ),
          isError: false,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify(overview),
        isError: false,
      };
    }

    if (tc.name === 'read_prototype_anchor') {
      const elementId = typeof args.elementId === 'string' ? args.elementId : undefined;
      const screenId = typeof args.screenId === 'string' ? args.screenId : undefined;
      const cssSelector = typeof args.cssSelector === 'string' ? args.cssSelector : undefined;
      const readRes = readPrototypeAnchor(activeHtml, {
        ...(elementId ? { elementId } : {}),
        ...(screenId ? { screenId } : {}),
        ...(cssSelector ? { cssSelector } : {}),
        locale,
      });
      const anchorBadge =
        readRes.targetAnchor?.elementId ||
        readRes.targetAnchor?.screenId ||
        readRes.targetAnchor?.cssSelector ||
        'anchor';
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: readRes.isError
            ? readRes.diagnostic || pickLocaleText(locale, '未找到锚点', 'Anchor not found')
            : pickLocaleText(
                locale,
                `已读取锚点 ${anchorBadge} 局部片段（${readRes.fragment.length} 字符）`,
                `Read localized HTML fragment for ${anchorBadge} (${readRes.fragment.length} chars)`,
              ),
          isError: readRes.isError,
          ...(readRes.targetAnchor ? { targetAnchor: readRes.targetAnchor } : {}),
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify(
          readRes.isError
            ? {
                status: 'ANCHOR_NOT_FOUND',
                diagnostic: readRes.diagnostic,
                targetAnchor: readRes.targetAnchor,
              }
            : {
                status: 'OK',
                targetAnchor: readRes.targetAnchor,
                contextSummary: readRes.contextSummary,
                fragment: readRes.fragment,
              },
        ),
        isError: readRes.isError,
      };
    }

    if (tc.name === 'edit_prototype_anchor') {
      const elementId = typeof args.elementId === 'string' ? args.elementId : undefined;
      const screenId = typeof args.screenId === 'string' ? args.screenId : undefined;
      const cssSelector = typeof args.cssSelector === 'string' ? args.cssSelector : undefined;
      const operation = String(args.operation || 'replace_element') as PrototypeAnchorEditOperation;
      const htmlFragment = typeof args.htmlFragment === 'string' ? args.htmlFragment : undefined;
      const attributes =
        args.attributes && typeof args.attributes === 'object'
          ? (args.attributes as Record<string, string | null>)
          : undefined;
      const allowRemoveAnchors = Array.isArray(args.allowRemoveAnchors)
        ? args.allowRemoveAnchors.map(String)
        : undefined;

      const editRes = editPrototypeAnchor(activeHtml, {
        ...(elementId ? { elementId } : {}),
        ...(screenId ? { screenId } : {}),
        ...(cssSelector ? { cssSelector } : {}),
        operation,
        ...(htmlFragment !== undefined ? { htmlFragment } : {}),
        ...(attributes ? { attributes } : {}),
        ...(allowRemoveAnchors ? { allowRemoveAnchors } : {}),
        locale,
      });

      if (editRes.isError) {
        return {
          trace: {
            id: tc.id,
            toolName: tc.name,
            arguments: args,
            output: editRes.diagnostic || editRes.summary,
            isError: true,
            ...(editRes.targetAnchor ? { targetAnchor: editRes.targetAnchor } : {}),
            durationMs: Date.now() - started,
          },
          toolResultContent: JSON.stringify({
            status: 'REJECTED_BY_ANCHOR_VALIDATOR',
            diagnostic: editRes.diagnostic || editRes.summary,
            targetAnchor: editRes.targetAnchor,
          }),
          isError: true,
        };
      }

      if (prototypeDraft) {
        prototypeDraft.workingHtml = editRes.nextHtml;
        recordModifiedAnchor(prototypeDraft, editRes.targetAnchor);
      }

      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: editRes.summary,
          isError: false,
          ...(hadPreviousValidatorError ? { validatorRepair: true } : {}),
          ...(editRes.targetAnchor ? { targetAnchor: editRes.targetAnchor } : {}),
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({
          status: 'APPLIED',
          summary: editRes.summary,
          targetAnchor: editRes.targetAnchor,
        }),
        isError: false,
      };
    }

    // rewrite_prototype_page
    if (
      !resolveTargetPrototypeForSession(store, session) &&
      !store.getProjectStepConfirmations(session.projectId).requirements
    ) {
      const unconfirmedMsg = pickLocaleText(
        locale,
        '需要先完成并确认需求文档，才能生成首版界面原型。',
        'Confirm the requirements document first before generating an initial prototype.',
      );
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: unconfirmedMsg,
          isError: true,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({
          status: 'REQUIREMENTS_NOT_CONFIRMED',
          diagnostic: unconfirmedMsg,
        }),
        isError: true,
      };
    }
    const htmlContent = String(args.htmlContent || '');
    const rewriteRes = rewritePrototypePage(activeHtml, htmlContent, {
      allowAnchorReset: Boolean(args.allowAnchorReset) || activeHtml.trim().length === 0,
      locale,
    });
    if (rewriteRes.isError) {
      return {
        trace: {
          id: tc.id,
          toolName: tc.name,
          arguments: args,
          output: rewriteRes.diagnostic || rewriteRes.summary,
          isError: true,
          ...(rewriteRes.targetAnchor ? { targetAnchor: rewriteRes.targetAnchor } : {}),
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({
          status: 'REJECTED_BY_ANCHOR_VALIDATOR',
          diagnostic: rewriteRes.diagnostic || rewriteRes.summary,
        }),
        isError: true,
      };
    }

    if (prototypeDraft) {
      prototypeDraft.workingHtml = rewriteRes.nextHtml;
      recordModifiedAnchor(prototypeDraft, rewriteRes.targetAnchor);
    }

    return {
      trace: {
        id: tc.id,
        toolName: tc.name,
        arguments: args,
        output: rewriteRes.summary,
        isError: false,
        ...(hadPreviousValidatorError ? { validatorRepair: true } : {}),
        ...(rewriteRes.targetAnchor ? { targetAnchor: rewriteRes.targetAnchor } : {}),
        durationMs: Date.now() - started,
      },
      toolResultContent: JSON.stringify({
        status: 'APPLIED',
        summary: rewriteRes.summary,
      }),
      isError: false,
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
  handoffFrom?: StepHandoffOrigin;
  images?: TransientTurnImageInput[];
  designBrief?: DesignBrief;
  prototypeName?: string;
  activeModelCode?: ModelCode;
  reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
  codeMode?: boolean;
  multiAgentConcurrency?: number;
  locale?: AgentLocale | string;
  mockMode?: boolean;
  signal?: AbortSignal;
  idleTimeoutMs?: number;
  stepTimeoutMs?: number;
  hooks?: AgentRunLifecycleHooks;
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
  isMock = false,
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

    const trimmedRemote = typeof img.remoteUrl === 'string' ? img.remoteUrl.trim() : '';
    const isLocalHttp = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(trimmedRemote);
    if (trimmedRemote && /^https?:\/\//i.test(trimmedRemote) && (!isMock || isLocalHttp)) {
      try {
        const resp = await fetch(trimmedRemote, {
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

function saveSessionCheckpointSafe(
  store: WorkspaceStore,
  session: AgentSession,
  payload: Record<string, unknown>,
): void {
  void durableMemoryStorage;
  if (typeof store.saveAgentCheckpoint !== 'function') return;
  try {
    store.saveAgentCheckpoint(
      session.id,
      `PI_UNIFIED_${session.agentKind}`,
      JSON.stringify({
        sessionId: session.id,
        status: session.status,
        ...payload,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Non-fatal in read-only edge contexts
  }
}

async function executeUnifiedTurnCore(
  store: WorkspaceStore,
  input: Omit<UnifiedAgentStreamInput, 'signal'>,
  emit: (ev: UnifiedAgentSseEvent) => void,
  controller: AbortController,
  preallocatedIdentity?: AllocatedTurnRunIdentity,
): Promise<void> {
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
    const answerSummary = pickLocaleText(
      effectiveLocale,
      `[用户已确认选择] ${combinedAnswers.join('；') || input.askUserAnswer.promptId}`,
      `[User Confirmed Choice] ${combinedAnswers.join('; ') || input.askUserAnswer.promptId}`,
    );

    let matchedAskUser = false;
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
        matchedAskUser = true;
        break;
      }
    }
    if (matchedAskUser || !synthesizedPrompt) {
      synthesizedPrompt = synthesizedPrompt
        ? `${answerSummary}\n${synthesizedPrompt}`
        : answerSummary;
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

  const turnIdentity = preallocatedIdentity ?? allocateTurnRunIdentity(existing, input);
  let currentTurnUserMsgId: string | undefined;
  if (synthesizedPrompt) {
    currentTurnUserMsgId = turnIdentity.allocatedUserMessageId ?? nextAgentMessageId('u');
    workingMessages.push({
      id: currentTurnUserMsgId,
      runId: turnIdentity.runId,
      role: 'user',
      content: synthesizedPrompt,
      ...(input.handoffFrom ? { handoffFrom: input.handoffFrom } : {}),
      ...(turnAttachmentRefs.length > 0 ? { images: turnAttachmentRefs } : {}),
      timestamp: nowIso,
    });
  } else if (workingMessages.at(-1)?.role === 'user') {
    const trailingIdx = workingMessages.length - 1;
    const trailingUser = workingMessages[trailingIdx]!;
    if (!trailingUser.runId) {
      workingMessages[trailingIdx] = {
        ...trailingUser,
        runId: turnIdentity.runId,
      };
    }
  }

  const structuredTurnAction = resolveEffectiveStructuredAction(
    existing.messages,
    synthesizedPrompt,
  );
  const cleanTitleSource =
    structuredTurnAction?.cleanPrompt || synthesizedPrompt;

  const nextTitle =
    existing.messages.length === 0 &&
    cleanTitleSource &&
    (existing.title.startsWith('新会话') ||
      existing.title.startsWith('新建') ||
      existing.title.startsWith('New '))
      ? cleanTitleSource.replace(/\s+/g, ' ').slice(0, 26)
      : existing.title;

  const effectiveCodeMode = resolveSessionCodeModeEnabled(existing, input.codeMode);
  const effectiveConcurrency = resolveSessionMultiAgentConcurrency(
    existing,
    input.multiAgentConcurrency,
  );

  let sessionState: AgentSession = store.saveAgentSession({
    ...existing,
    title: nextTitle,
    ...(input.reasoningMode ? { reasoningMode: input.reasoningMode } : {}),
    codeMode: effectiveCodeMode,
    multiAgentConcurrency: effectiveConcurrency,
    status: 'RUNNING',
    messages: workingMessages,
    updatedAt: nowIso,
  });

  const turnStartMs = Date.now();
  const assistantMsgId = nextAgentMessageId('a');
  const turnRunId = turnIdentity.runId;

  saveSessionCheckpointSafe(store, sessionState, {
    phase: 'TURN_STARTED',
    runId: turnRunId,
    messageCount: sessionState.messages.length,
    toolCallsCount: 0,
  });
  let built: ReturnType<typeof buildPiModelsForStore> | undefined;
  let accumulatedThinking = '';
  let accumulatedText = '';
  let streamedToolArgChars = 0;
  let lastCodeModeScript: string | undefined;
  const allToolTraces: AgentToolCallTrace[] = [];
  const allSubagentLanes: AgentSubagentLaneTrace[] = [];
  const allArtifacts: AgentDomainArtifact[] = [];
  let pendingAskUser: AgentAskUserPrompt | undefined;
  let pendingStepHandoff: StepHandoffProposal | undefined;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let hadValidatorError = false;

  const heartbeatInterval = setInterval(() => {
    if (controller.signal.aborted) return;
    const activeSubs = allSubagentLanes.filter((l) => l.status === 'RUNNING').length;
    emit({
      id: nextEventId(),
      event: 'heartbeat',
      data: {
        runId: turnRunId,
        elapsedMs: Date.now() - turnStartMs,
        thinkingChars: accumulatedThinking.length,
        textChars: accumulatedText.length,
        toolArgChars: streamedToolArgChars,
        activeSubagents: activeSubs,
      },
    });
  }, 4_000);

  const turnUserMessageId =
    currentTurnUserMsgId ??
    (workingMessages.at(-1)?.role === 'user' ? workingMessages.at(-1)!.id : undefined);

  const buildRunContext = (curSession: AgentSession): AgentRunContext => ({
    runId: turnRunId,
    sessionId: curSession.id,
    projectId: curSession.projectId?.trim() ? curSession.projectId : null,
    sessionKind: curSession.agentKind,
    projectStep: deriveProjectStepForSessionKind(curSession.agentKind),
    ...(curSession.targetId ? { targetId: curSession.targetId } : {}),
    ...(turnUserMessageId ? { userMessageId: turnUserMessageId } : {}),
    startedAt: nowIso,
  });

  let didInvokeRunStart = false;
  let runEndInvoked = false;
  const invokeRunEndOnce = async (params: {
    outcome: AgentRunOutcome;
    assistantMessageId: string;
    endedAt: string;
    error?: AgentRunFailureInfo;
  }): Promise<void> => {
    if (!didInvokeRunStart || runEndInvoked) return;
    runEndInvoked = true;
    await invokeAgentRunEndHooks(
      store,
      {
        ...buildRunContext(sessionState),
        outcome: params.outcome,
        assistantMessageId: params.assistantMessageId,
        endedAt: params.endedAt,
        durationMs: Math.max(0, Date.now() - turnStartMs),
        ...(params.error ? { error: params.error } : {}),
      },
      input.hooks,
    );
  };

  let usedVisionFallback = false;
  let activeVisionFallbackNotice: string | undefined;
  let prototypeTurnDraft: PrototypeTurnDraft | undefined;

  try {
    didInvokeRunStart = true;
    await invokeAgentRunStartHooks(
      store,
      {
        ...buildRunContext(sessionState),
        prompt: synthesizedPrompt,
        mode: input.mode ?? 'PROMPT',
      },
      input.hooks,
    );

    const initialTargetProto =
      sessionState.agentKind === 'PROTOTYPE_CO_DESIGN'
        ? resolveTargetPrototypeForSession(store, sessionState)
        : undefined;
    const fallbackProtoName =
      input.prototypeName?.trim() ||
      pickLocaleText(
        effectiveLocale,
        `${resolveProjectDetail(store, sessionState.projectId)?.name ?? '业务'}交互原型`,
        `${resolveProjectDetail(store, sessionState.projectId)?.name ?? 'Interactive'} Prototype`,
      );
    prototypeTurnDraft =
      sessionState.agentKind === 'PROTOTYPE_CO_DESIGN'
        ? initialTargetProto
          ? {
              prototypeId: initialTargetProto.id,
              prototypeName: initialTargetProto.name,
              ...(input.designBrief ? { designBrief: input.designBrief } : {}),
              baselineHtml: initialTargetProto.htmlContent,
              workingHtml: initialTargetProto.htmlContent,
              modifiedAnchors: [],
            }
          : {
              prototypeName: fallbackProtoName,
              ...(input.designBrief
                ? { designBrief: input.designBrief }
                : sessionState.designBrief
                  ? { designBrief: sessionState.designBrief }
                  : {}),
              baselineHtml: '',
              workingHtml: '',
              modifiedAnchors: [],
            }
        : undefined;

    if (controller.signal.aborted) {
      throw toAbortedError();
    }

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

    emit({
      id: nextEventId(),
      event: 'session_meta',
      data: {
        runId: turnRunId,
        sessionId: sessionState.id,
        title: sessionState.title,
        provider: built.providerLabel,
        model: built.selectedModel.id,
        isMock: built.isMock,
        visionSupported: built.visionSupported,
        codeMode: effectiveCodeMode,
        multiAgentConcurrency: effectiveConcurrency,
        ...(activeVisionFallbackNotice ? { visionFallbackNotice: activeVisionFallbackNotice } : {}),
      },
    });

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
            built.isMock,
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

    const baseSpecialistTools = getToolsForAgentKind(sessionState.agentKind);
    const tools = getToolsForAgentKind(sessionState.agentKind, {
      codeMode: effectiveCodeMode,
      multiAgentConcurrency: effectiveConcurrency,
    });
    const resolvedMaxTokens = Math.min(built.selectedModel.maxTokens || 32768, 32768);
    // Live prototype building (spec #87): per-screen deltas, never the whole document. The
    // tracker starts from what the client already shows (the saved revision being edited).
    const prototypeLiveTracker = createPrototypeLiveTracker();
    prototypeLiveTracker.reset(prototypeTurnDraft?.workingHtml ?? '');
    const streamingPrototypeScreens = new Set<string>();
    const lastPartialScreenEmitMs = new Map<string, number>();
    const PARTIAL_SCREEN_THROTTLE_MS = 150;

    const emitPrototypeLiveEvents = (events: readonly PrototypeLiveEvent[]) => {
      if (!prototypeTurnDraft) return;
      for (const liveEvent of events) {
        emit({
          id: nextEventId(),
          event: liveEvent.kind === 'frame' ? 'prototype_frame' : 'prototype_screen',
          data: {
            runId: turnRunId,
            ...(prototypeTurnDraft.prototypeId ? { prototypeId: prototypeTurnDraft.prototypeId } : {}),
            ...liveEvent,
          },
        });
      }
    };

    /** After a tool changed the working document: send what changed, screen by screen. */
    const syncPrototypeLiveDocument = () => {
      if (!prototypeTurnDraft) return;
      emitPrototypeLiveEvents(
        prototypeLiveTracker.observeDocument(prototypeTurnDraft.workingHtml, {
          streamingScreenIds: streamingPrototypeScreens,
        }),
      );
    };

    /** While a screen's HTML streams in as tool-call arguments: heal and send that one screen. */
    const streamPartialPrototypeScreen = (partial: PartialPrototypeScreenInput) => {
      if (!prototypeTurnDraft) return;
      const screenId = partial.screenId.trim();
      if (!screenId) return;
      streamingPrototypeScreens.add(screenId);
      const nowMs = Date.now();
      if (nowMs - (lastPartialScreenEmitMs.get(screenId) ?? 0) < PARTIAL_SCREEN_THROTTLE_MS) return;
      lastPartialScreenEmitMs.set(screenId, nowMs);
      const liveEvent = prototypeLiveTracker.observePartialScreen({
        screenId,
        ...(partial.screenName ? { screenName: partial.screenName } : {}),
        ...(partial.screenType ? { screenType: partial.screenType } : {}),
        partialHtml: partial.partialScreenHtml,
        ...(partial.extraCss ? { css: partial.extraCss } : {}),
      });
      if (liveEvent) emitPrototypeLiveEvents([liveEvent]);
    };

    /** A screen's write ended (landed or rejected): the document version is the truth again. */
    const endPartialPrototypeScreen = (screenId: string | undefined) => {
      const sid = screenId?.trim();
      if (!sid) return;
      streamingPrototypeScreens.delete(sid);
      lastPartialScreenEmitMs.delete(sid);
    };

    const runSpawnSubagentsTool = async (
      parentCallId: string,
      rawArgs: Record<string, unknown>,
      stepNum: number,
    ): Promise<ExecutedToolStep> => {
      const started = Date.now();
      const rawTasks = Array.isArray(rawArgs.tasks) ? rawArgs.tasks : [];
      const parsedTasks: SubagentTaskSpec[] = rawTasks
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          title: String(item.title ?? item.screenName ?? 'Sub-task').trim(),
          ...(typeof item.roleLabel === 'string' ? { roleLabel: item.roleLabel } : {}),
          instruction: String(item.instruction ?? item.task ?? '').trim(),
          ...(typeof item.screenId === 'string' ? { screenId: item.screenId } : {}),
          ...(typeof item.screenName === 'string' ? { screenName: item.screenName } : {}),
          ...(typeof item.screenType === 'string' ? { screenType: item.screenType } : {}),
        }))
        .filter((t) => Boolean(t.title && t.instruction));

      if (parsedTasks.length === 0) {
        const msg = pickLocaleText(
          effectiveLocale,
          'spawn_subagents 需要提供非空的 tasks 子任务数组。',
          'spawn_subagents requires a non-empty tasks array.',
        );
        return {
          trace: {
            id: parentCallId,
            toolName: 'spawn_subagents',
            arguments: rawArgs,
            output: msg,
            isError: true,
            durationMs: Date.now() - started,
          },
          toolResultContent: JSON.stringify({ status: 'ERROR', diagnostic: msg }),
          isError: true,
        };
      }

      const subBaseSystemPrompt = buildSystemPromptForSession(
        store,
        sessionState,
        input.activeModelCode,
        effectiveLocale,
      );

      const batchStartIdx = allSubagentLanes.length;
      const parallelRes = await runParallelSubagents({
        tasks: parsedTasks,
        concurrency: effectiveConcurrency,
        locale: effectiveLocale,
        isMock: built!.isMock,
        models: built!.models,
        selectedModel: built!.selectedModel,
        baseSystemPrompt: subBaseSystemPrompt,
        subagentTools: baseSpecialistTools,
        signal: controller.signal,
        stepTimeoutMs,
        maxTokens: resolvedMaxTokens,
        onActivity: resetIdleTimer,
        onLaneUpdate: (lane, batchLanes) => {
          allSubagentLanes.splice(batchStartIdx, batchLanes.length, ...batchLanes);
          emit({
            id: nextEventId(),
            event: 'subagent_update',
            data: {
              runId: turnRunId,
              lane,
              lanes: [...allSubagentLanes],
            },
          });
        },
        onPartialScreenStream: (partial) => {
          streamPartialPrototypeScreen(partial);
        },
        executeSubagentToolCall: async (subTc, lane, subHadErr) => {
          resetIdleTimer();
          const subArgs = (subTc.arguments ?? {}) as Record<string, unknown>;
          const subAnchor = extractTargetAnchorFromArgs(subTc.name, subArgs) ?? lane.targetAnchor;
          emit({
            id: nextEventId(),
            event: 'tool_call',
            data: {
              id: subTc.id,
              toolName: subTc.name,
              arguments: subArgs,
              ...(subAnchor ? { targetAnchor: subAnchor } : {}),
              step: stepNum,
            },
          });
          const subExec = await executeUnifiedToolCall(
            store,
            sessionState,
            subTc,
            subHadErr,
            effectiveLocale,
            prototypeTurnDraft,
            {
              isMock: built!.isMock,
              runId: turnRunId,
              ...(structuredTurnAction ? { actionParams: structuredTurnAction.params } : {}),
            },
          );
          if (subTc.name === 'upsert_prototype_screen') {
            endPartialPrototypeScreen(
              (typeof subArgs.screenId === 'string' && subArgs.screenId.trim()) ||
                lane.targetAnchor?.screenId,
            );
          }
          allToolTraces.push(subExec.trace);
          emit({
            id: nextEventId(),
            event: 'tool_result',
            data: {
              trace: subExec.trace,
              step: stepNum,
            },
          });
          syncPrototypeLiveDocument();
          if (subExec.artifact) {
            allArtifacts.push(subExec.artifact);
            emit({
              id: nextEventId(),
              event: 'artifact',
              data: { artifact: subExec.artifact },
            });
          }
          return {
            toolResultContent: subExec.toolResultContent,
            isError: subExec.isError,
          };
        },
      });

      totalInputTokens += parallelRes.inputTokens;
      totalOutputTokens += parallelRes.outputTokens;

      return {
        trace: {
          id: parentCallId,
          toolName: 'spawn_subagents',
          arguments: rawArgs,
          output: parallelRes.summaryText,
          isError: !parallelRes.allSucceeded,
          durationMs: Date.now() - started,
        },
        toolResultContent: JSON.stringify({
          status: parallelRes.allSucceeded ? 'OK' : 'PARTIAL_FAILURE',
          summary: parallelRes.summaryText,
          lanes: parallelRes.lanes.map((l) => ({
            title: l.taskTitle.zh,
            status: l.status,
            ...(l.output ? { output: l.output } : {}),
            ...(l.error ? { error: l.error } : {}),
          })),
        }),
        isError: !parallelRes.allSucceeded,
      };
    };

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
        {
          codeMode: effectiveCodeMode,
          multiAgentConcurrency: effectiveConcurrency,
          offeredTools: tools,
        },
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
        maxTokens: resolvedMaxTokens,
      });

      let finalMessage: AssistantMessage | undefined;
      const announcedToolCallIds = new Set<string>();
      let lastToolDeltaEmitMs = 0;

      for await (const ev of eventStream) {
        if (ev.type !== 'error') {
          resetIdleTimer();
        }

        if (ev.type === 'thinking_delta') {
          accumulatedThinking += ev.delta;
          emit({
            id: nextEventId(),
            event: 'thinking_delta',
            data: { step: step + 1, delta: ev.delta },
          });
        } else if (ev.type === 'text_delta') {
          accumulatedText += ev.delta;
          emit({
            id: nextEventId(),
            event: 'delta',
            data: { step: step + 1, text: ev.delta },
          });
        } else if (
          ev.type === 'toolcall_start' ||
          ev.type === 'toolcall_delta' ||
          ev.type === 'toolcall_end'
        ) {
          if (ev.type === 'toolcall_delta') {
            streamedToolArgChars += ev.delta.length;
            const nowMs = Date.now();
            const partialCall = ev.partial.content[ev.contentIndex];
            if (
              partialCall?.type === 'toolCall' &&
              partialCall.name === 'upsert_prototype_screen' &&
              prototypeTurnDraft
            ) {
              const pArgs = (partialCall.arguments ?? {}) as Record<string, unknown>;
              const pSid = typeof pArgs.screenId === 'string' ? pArgs.screenId.trim() : '';
              const pHtml = typeof pArgs.screenHtml === 'string' ? pArgs.screenHtml : '';
              if (pSid && pHtml.length >= 24) {
                streamPartialPrototypeScreen({
                  screenId: pSid,
                  ...(typeof pArgs.screenName === 'string' ? { screenName: pArgs.screenName } : {}),
                  ...(typeof pArgs.screenType === 'string' ? { screenType: pArgs.screenType } : {}),
                  partialScreenHtml: pHtml,
                  ...(typeof pArgs.extraCss === 'string' ? { extraCss: pArgs.extraCss } : {}),
                });
              }
            }
            if (nowMs - lastToolDeltaEmitMs >= 250) {
              lastToolDeltaEmitMs = nowMs;
              emit({
                id: nextEventId(),
                event: 'tool_delta',
                data: {
                  step: step + 1,
                  toolName: partialCall?.type === 'toolCall' ? partialCall.name : undefined,
                  streamedChars: streamedToolArgChars,
                },
              });
            }
          }
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
            const candidateArgs = (candidate.arguments ?? {}) as Record<string, unknown>;
            const candidateAnchor = extractTargetAnchorFromArgs(candidate.name, candidateArgs);
            emit({
              id: nextEventId(),
              event: 'tool_call',
              data: {
                id: candidate.id,
                toolName: candidate.name,
                arguments: candidateArgs,
                ...(candidateAnchor ? { targetAnchor: candidateAnchor } : {}),
                step: step + 1,
              },
            });
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
          const isStepTimeout =
            !/connect\s*timeout|connection\s*error/i.test(errText) &&
            (ev.reason === 'aborted' ||
              (/timed?\s*out|timeout/i.test(errText) &&
                Date.now() - turnStartMs >= Math.min(idleTimeoutMs, stepTimeoutMs) * 0.5));
          if (isStepTimeout) {
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

      if (finalMessage.stopReason === 'error' || finalMessage.errorMessage) {
        if (controller.signal.aborted) {
          throw toAbortedError();
        }
        throw new LlmGatewayError({
          message:
            finalMessage.errorMessage ||
            pickLocaleText(
              effectiveLocale,
              '上游模型网关返回错误响应',
              'Upstream LLM gateway returned an error response',
            ),
          providerName: built.providerConfig?.name ?? built.providerLabel,
          baseUrl: built.providerConfig?.baseUrl ?? built.selectedModel.baseUrl,
          model: built.selectedModel.id,
          locale: effectiveLocale,
        });
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
        const tcArgs = (tc.arguments ?? {}) as Record<string, unknown>;
        const tcAnchor = extractTargetAnchorFromArgs(tc.name, tcArgs);
        emit({
          id: nextEventId(),
          event: 'tool_call',
          data: {
            id: tc.id,
            toolName: tc.name,
            arguments: tcArgs,
            ...(tcAnchor ? { targetAnchor: tcAnchor } : {}),
            step: step + 1,
          },
        });

        const executed: ExecutedToolStep =
          tc.name === 'spawn_subagents'
            ? await runSpawnSubagentsTool(tc.id, tcArgs, step + 1)
            : tc.name === 'codemode'
              ? await (async (): Promise<ExecutedToolStep> => {
                  const startedCm = Date.now();
                  const scriptCode = String(tcArgs.code ?? '');
                  if (scriptCode.trim()) {
                    lastCodeModeScript = scriptCode;
                  }
                  const cmRes = await runCodemodeScript({
                    code: scriptCode,
                    callableTools: tools.filter((t) => t.name !== 'codemode'),
                    signal: controller.signal,
                    timeoutMs: stepTimeoutMs,
                    executeNestedTool: async (nestedToolName, nestedArgs, nestedIdx) => {
                      resetIdleTimer();
                      const nestedCallId = `${tc.id}/c${nestedIdx}`;
                      const nestedAnchor = extractTargetAnchorFromArgs(nestedToolName, nestedArgs);
                      emit({
                        id: nextEventId(),
                        event: 'tool_call',
                        data: {
                          id: nestedCallId,
                          toolName: nestedToolName,
                          arguments: nestedArgs,
                          ...(nestedAnchor ? { targetAnchor: nestedAnchor } : {}),
                          step: step + 1,
                        },
                      });

                      const nestedOut =
                        nestedToolName === 'spawn_subagents'
                          ? await runSpawnSubagentsTool(nestedCallId, nestedArgs, step + 1)
                          : await executeUnifiedToolCall(
                              store,
                              sessionState,
                              {
                                type: 'toolCall',
                                id: nestedCallId,
                                name: nestedToolName,
                                arguments: nestedArgs as JsonObject,
                              },
                              hadValidatorError,
                              effectiveLocale,
                              prototypeTurnDraft,
                              {
                                isMock: built!.isMock,
                                runId: turnRunId,
                                ...(structuredTurnAction
                                  ? { actionParams: structuredTurnAction.params }
                                  : {}),
                              },
                            );

                      if (nestedOut.isError) {
                        hadValidatorError = true;
                      }
                      allToolTraces.push(nestedOut.trace);
                      emit({
                        id: nextEventId(),
                        event: 'tool_result',
                        data: {
                          trace: nestedOut.trace,
                          step: step + 1,
                        },
                      });
                      syncPrototypeLiveDocument();

                      if (nestedOut.artifact) {
                        allArtifacts.push(nestedOut.artifact);
                        emit({
                          id: nextEventId(),
                          event: 'artifact',
                          data: { artifact: nestedOut.artifact },
                        });
                      }
                      if (nestedOut.askUserPrompt) {
                        pendingAskUser = nestedOut.askUserPrompt;
                        emit({
                          id: nextEventId(),
                          event: 'ask_user',
                          data: { askUser: nestedOut.askUserPrompt },
                        });
                      }
                      if (nestedOut.stepHandoffProposal) {
                        pendingStepHandoff = nestedOut.stepHandoffProposal;
                        emit({
                          id: nextEventId(),
                          event: 'step_handoff',
                          data: { stepHandoff: nestedOut.stepHandoffProposal },
                        });
                      }

                      let parsedJson: unknown = nestedOut.toolResultContent;
                      try {
                        parsedJson = JSON.parse(nestedOut.toolResultContent);
                      } catch {
                        parsedJson = nestedOut.toolResultContent;
                      }
                      return {
                        outputJson: parsedJson,
                        isError: nestedOut.isError,
                        ...(nestedOut.isError ? { errorText: nestedOut.trace.output } : {}),
                      };
                    },
                  });

                  return {
                    trace: {
                      id: tc.id,
                      toolName: 'codemode',
                      arguments: tcArgs,
                      output: cmRes.outputText,
                      isError: cmRes.isError,
                      durationMs: Date.now() - startedCm,
                    },
                    toolResultContent: cmRes.outputText,
                    isError: cmRes.isError,
                  };
                })()
              : await executeUnifiedToolCall(
                  store,
                  sessionState,
                  tc,
                  hadValidatorError,
                  effectiveLocale,
                  prototypeTurnDraft,
                  {
                    isMock: built.isMock,
                    runId: turnRunId,
                    ...(structuredTurnAction ? { actionParams: structuredTurnAction.params } : {}),
                  },
                );
        if (executed.isError) {
          hadValidatorError = true;
        }
        if (tc.name === 'upsert_prototype_screen') {
          const doneSid = (tc.arguments as Record<string, unknown> | undefined)?.screenId;
          endPartialPrototypeScreen(typeof doneSid === 'string' ? doneSid : undefined);
        }
        allToolTraces.push(executed.trace);

        emit({
          id: nextEventId(),
          event: 'tool_result',
          data: {
            trace: executed.trace,
            step: step + 1,
          },
        });
        syncPrototypeLiveDocument();

        if (executed.artifact) {
          allArtifacts.push(executed.artifact);
          emit({
            id: nextEventId(),
            event: 'artifact',
            data: {
              artifact: executed.artifact,
            },
          });
        }

        if (executed.askUserPrompt) {
          pendingAskUser = executed.askUserPrompt;
          emit({
            id: nextEventId(),
            event: 'ask_user',
            data: {
              askUser: executed.askUserPrompt,
            },
          });
        }

        if (executed.stepHandoffProposal) {
          pendingStepHandoff = executed.stepHandoffProposal;
          emit({
            id: nextEventId(),
            event: 'step_handoff',
            data: {
              stepHandoff: executed.stepHandoffProposal,
            },
          });
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

      saveSessionCheckpointSafe(store, sessionState, {
        phase: 'STEP_PROGRESS',
        step: step + 1,
        toolCallsCount: allToolTraces.length,
        accumulatedChars: accumulatedText.length,
      });

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
          emit({
            id: nextEventId(),
            event: 'delta',
            data: { step: step + 1, text: accumulatedText },
          });
        }
        break;
      }
    }

    if (
      !built.isMock &&
      !accumulatedText.trim() &&
      allToolTraces.length === 0 &&
      !pendingAskUser
    ) {
      throw new LlmGatewayError({
        message: pickLocaleText(
          effectiveLocale,
          `模型网关「${built.providerLabel}」返回了空响应（未产生任何工具调用或内容）`,
          `LLM gateway "${built.providerLabel}" returned an empty response (no tool calls or content generated)`,
        ),
        providerName: built.providerConfig?.name ?? built.providerLabel,
        baseUrl: built.providerConfig?.baseUrl ?? built.selectedModel.baseUrl,
        model: built.selectedModel.id,
        locale: effectiveLocale,
      });
    }

    // Live LLM recovery & honest failure check for structured domain actions (ADR 0007 / ADR 0009)
    if (!built.isMock && structuredTurnAction && !pendingAskUser && !controller.signal.aborted) {
      if (
        structuredTurnAction.kind === 'SYNTHESIZE_SRS' &&
        !allArtifacts.some((a) => a.kind === 'REQUIREMENT_DOC') &&
        accumulatedText.trim().length >= 80
      ) {
        const autoSrs = await executeDomainRunToolCall(
          store,
          sessionState,
          `tc-auto-srs-${Date.now().toString(36)}`,
          'save_synthesized_srs_doc',
          {
            ...structuredTurnAction.params,
            status: 'CONFIRMED',
            content: accumulatedText,
          },
          effectiveLocale,
          { isMock: false, runId: turnRunId, actionParams: structuredTurnAction.params },
        );
        if (autoSrs) {
          allToolTraces.push(autoSrs.trace);
          emit({
            id: nextEventId(),
            event: 'tool_result',
            data: { trace: autoSrs.trace, step: 1 },
          });
          if (autoSrs.artifact) {
            allArtifacts.push(autoSrs.artifact);
            emit({
              id: nextEventId(),
              event: 'artifact',
              data: { artifact: autoSrs.artifact },
            });
          }
        }
      } else if (
        structuredTurnAction.kind === 'SYNTHESIZE_ONTOLOGY_SUITE' &&
        !allArtifacts.some((a) => a.kind === 'ONTOLOGY_SUITE') &&
        accumulatedText.trim().length > 0
      ) {
        const parsedBp = extractJsonObjectFromText<LlmSynthesizedDomainBlueprint>(accumulatedText);
        if (parsedBp && typeof parsedBp === 'object') {
          const autoOnto = await executeDomainRunToolCall(
            store,
            sessionState,
            `tc-auto-onto-${Date.now().toString(36)}`,
            'synthesize_ontology_suite',
            {
              ...structuredTurnAction.params,
              ...(parsedBp as Record<string, unknown>),
            },
            effectiveLocale,
            { isMock: false, runId: turnRunId, actionParams: structuredTurnAction.params },
          );
          if (autoOnto) {
            allToolTraces.push(autoOnto.trace);
            emit({
              id: nextEventId(),
              event: 'tool_result',
              data: { trace: autoOnto.trace, step: 1 },
            });
            if (autoOnto.artifact) {
              allArtifacts.push(autoOnto.artifact);
              emit({
                id: nextEventId(),
                event: 'artifact',
                data: { artifact: autoOnto.artifact },
              });
            }
          }
        }
      } else if (
        structuredTurnAction.kind === 'GENERATE_TECH_ARCH' &&
        !allArtifacts.some((a) => a.kind === 'TECH_ARCH_ASSET') &&
        accumulatedText.trim().length >= 60
      ) {
        const autoArch = await executeDomainRunToolCall(
          store,
          sessionState,
          `tc-auto-arch-${Date.now().toString(36)}`,
          'save_tech_architecture_spec',
          {
            ...structuredTurnAction.params,
            content: accumulatedText,
          },
          effectiveLocale,
          { isMock: false, runId: turnRunId, actionParams: structuredTurnAction.params },
        );
        if (autoArch) {
          allToolTraces.push(autoArch.trace);
          emit({
            id: nextEventId(),
            event: 'tool_result',
            data: { trace: autoArch.trace, step: 1 },
          });
          if (autoArch.artifact) {
            allArtifacts.push(autoArch.artifact);
            emit({
              id: nextEventId(),
              event: 'artifact',
              data: { artifact: autoArch.artifact },
            });
          }
        }
      }

      const expectedArtifactKindByAction: Record<
        typeof structuredTurnAction.kind,
        AgentDomainArtifact['kind']
      > = {
        SYNTHESIZE_SRS: 'REQUIREMENT_DOC',
        SYNTHESIZE_ONTOLOGY_SUITE: 'ONTOLOGY_SUITE',
        GENERATE_TECH_ARCH: 'TECH_ARCH_ASSET',
        METRIC_INSIGHT: 'METRIC_INSIGHT',
        SCENARIO_ATTRIBUTION: 'ANALYTICS_REPORT',
        RUN_ONTOLOGY_EXTRACTION: 'EXTRACTION_JOB',
      };
      const expectedKind = expectedArtifactKindByAction[structuredTurnAction.kind];
      if (!allArtifacts.some((a) => a.kind === expectedKind)) {
        const lastFailedTrace = [...allToolTraces].reverse().find((t) => t.isError);
        const detailSuffix = lastFailedTrace?.output ? ` — ${lastFailedTrace.output}` : '';
        throw new LlmGatewayError({
          message: pickLocaleText(
            effectiveLocale,
            `模型网关「${built.providerLabel}」未能完成结构化产物提交（期望产物：${expectedKind}）${detailSuffix}`,
            `LLM gateway "${built.providerLabel}" failed to produce required structured artifact (${expectedKind})${detailSuffix}`,
          ),
          providerName: built.providerConfig?.name ?? built.providerLabel,
          baseUrl: built.providerConfig?.baseUrl ?? built.selectedModel.baseUrl,
          model: built.selectedModel.id,
          locale: effectiveLocale,
        });
      }
    }

    if (
      !built.isMock &&
      prototypeTurnDraft &&
      !prototypeTurnDraft.prototypeId &&
      !prototypeTurnDraft.workingHtml.trim() &&
      !pendingAskUser &&
      !pendingStepHandoff &&
      Boolean(store.getProjectStepConfirmations(sessionState.projectId).requirements)
    ) {
      throw new LlmGatewayError({
        message: pickLocaleText(
          effectiveLocale,
          `模型网关「${built.providerLabel}」未生成有效的首版交互原型 HTML（禁止降级伪造模板）`,
          `LLM gateway "${built.providerLabel}" did not produce valid initial prototype HTML (template fabrication is disabled)`,
        ),
        providerName: built.providerConfig?.name ?? built.providerLabel,
        baseUrl: built.providerConfig?.baseUrl ?? built.selectedModel.baseUrl,
        model: built.selectedModel.id,
        locale: effectiveLocale,
      });
    }

    if (prototypeTurnDraft && !controller.signal.aborted) {
      const cleanRevisionNote = stripSelectionBlockFromPrompt(synthesizedPrompt);
      if (
        !prototypeTurnDraft.prototypeId &&
        prototypeTurnDraft.workingHtml.trim().length > 0
      ) {
        const createdProto = store.createPrototype(sessionState.projectId, {
          name: prototypeTurnDraft.prototypeName,
          title: cleanRevisionNote.slice(0, 48),
          instruction: cleanRevisionNote,
          htmlContent: prototypeTurnDraft.workingHtml,
          source: 'AGENT_RUN',
          coDesignSessionId: sessionState.id,
          ...(prototypeTurnDraft.designBrief
            ? { designBrief: prototypeTurnDraft.designBrief }
            : {}),
          agentRunId: turnRunId,
        });
        sessionState = {
          ...sessionState,
          targetId: createdProto.prototype.id,
        };
        const revisionArtifact: AgentDomainArtifact = {
          kind: 'PROTOTYPE_REVISION',
          prototypeId: createdProto.prototype.id,
          revisionId: createdProto.revision.id,
          revisionNumber: createdProto.revision.revisionNumber,
          modifiedAnchors: prototypeTurnDraft.modifiedAnchors,
        };
        allArtifacts.push(revisionArtifact);
        emit({
          id: nextEventId(),
          event: 'artifact',
          data: {
            artifact: revisionArtifact,
          },
        });
      } else if (prototypeTurnDraft.prototypeId) {
        if (prototypeTurnDraft.designBrief) {
          store.updatePrototypeDesignBrief(
            prototypeTurnDraft.prototypeId,
            prototypeTurnDraft.designBrief,
          );
        }
        if (prototypeTurnDraft.workingHtml !== prototypeTurnDraft.baselineHtml) {
          const appendedRevision = store.appendPrototypeRevision(prototypeTurnDraft.prototypeId, {
            title: cleanRevisionNote.slice(0, 48),
            instruction: cleanRevisionNote,
            htmlContent: prototypeTurnDraft.workingHtml,
            source: 'AGENT_RUN',
            agentRunId: turnRunId,
          });
          const revisionArtifact: AgentDomainArtifact = {
            kind: 'PROTOTYPE_REVISION',
            prototypeId: appendedRevision.prototype.id,
            revisionId: appendedRevision.revision.id,
            revisionNumber: appendedRevision.revision.revisionNumber,
            modifiedAnchors: prototypeTurnDraft.modifiedAnchors,
          };
          allArtifacts.push(revisionArtifact);
          emit({
            id: nextEventId(),
            event: 'artifact',
            data: {
              artifact: revisionArtifact,
            },
          });
        }
      }
    }

    if (!accumulatedText.trim() && pendingStepHandoff) {
      const stepName = PROJECT_STEP_NAMES[pendingStepHandoff.targetStep];
      const reasonPrefix = pendingStepHandoff.reason
        ? effectiveLocale === 'en-US'
          ? `${pendingStepHandoff.reason}. `
          : `${pendingStepHandoff.reason}。`
        : '';
      accumulatedText =
        effectiveLocale === 'en-US'
          ? `${reasonPrefix}I kept the current step unchanged and prepared a hand-off card below so you can continue in ${stepName.en} or stay here.`
          : `${reasonPrefix}我不会在当前步骤直接改动，已在下方准备好转交卡片，你可以转到该步骤继续，也可以选择留在这里。`;
      emit({
        id: nextEventId(),
        event: 'delta',
        data: { step: 1, text: accumulatedText },
      });
    } else if (!accumulatedText.trim() && allToolTraces.length > 0) {
      const sep = effectiveLocale === 'en-US' ? ': ' : '：';
      accumulatedText = allToolTraces.map((t) => `- **${t.toolName}**${sep}${t.output}`).join('\n');
      emit({
        id: nextEventId(),
        event: 'delta',
        data: { step: 1, text: accumulatedText },
      });
    }

    const assistantRecord: AgentSessionMessage = {
      id: assistantMsgId,
      runId: turnRunId,
      role: 'assistant',
      content: accumulatedText,
      ...(accumulatedThinking
        ? { thinking: accumulatedThinking, thinkingDurationMs: Date.now() - turnStartMs }
        : {}),
      ...(allToolTraces.length > 0 ? { toolCalls: allToolTraces } : {}),
      ...(allSubagentLanes.length > 0 ? { subagentLanes: allSubagentLanes } : {}),
      ...(lastCodeModeScript ? { codeModeScript: lastCodeModeScript } : {}),
      ...(pendingAskUser ? { askUser: pendingAskUser } : {}),
      ...(pendingStepHandoff ? { stepHandoff: pendingStepHandoff } : {}),
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

    saveSessionCheckpointSafe(store, sessionState, {
      phase: pendingAskUser ? 'AWAITING_USER' : 'COMPLETED',
      runId: turnRunId,
      messageCount: sessionState.messages.length,
      toolCallsCount: allToolTraces.length,
    });

    await invokeRunEndOnce({
      outcome: pendingAskUser ? 'AWAITING_USER' : 'COMPLETED',
      assistantMessageId: assistantRecord.id,
      endedAt: assistantRecord.timestamp,
    });

    emit({
      id: nextEventId(),
      event: 'usage',
      data: {
        tokenUsage: sessionState.tokenUsage,
        providerName: built.providerLabel,
        modelUsed: built.selectedModel.id,
      },
    });

    emit({
      id: nextEventId(),
      event: 'message_end',
      data: buildSessionMessageEndPayload(store, sessionState, { runId: turnRunId }),
    });
  } catch (err) {
    const currentActive = activeSessionAbortControllers.get(existing.id);
    const supersededByNewTurn = Boolean(currentActive && currentActive !== controller);
    if (
      supersededByNewTurn ||
      (err instanceof SessionStreamAbortedError && err.kind === 'STEER_SUPERSEDED')
    ) {
      await invokeRunEndOnce({
        outcome: 'ABORTED',
        assistantMessageId: assistantMsgId,
        endedAt: new Date().toISOString(),
      });
      return;
    }

    if (err instanceof SessionStreamAbortedError && err.kind === 'USER_ABORT') {
      const cancelledAssistantMsg: AgentSessionMessage = {
        id: assistantMsgId,
        runId: turnRunId,
        role: 'assistant',
        content: accumulatedText,
        cancelled: true,
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
      };

      sessionState = store.saveAgentSession({
        ...sessionState,
        status: 'IDLE',
        messages: [...sessionState.messages, cancelledAssistantMsg],
        updatedAt: new Date().toISOString(),
      });

      saveSessionCheckpointSafe(store, sessionState, {
        phase: 'CANCELLED',
        runId: turnRunId,
        messageCount: sessionState.messages.length,
        toolCallsCount: allToolTraces.length,
      });

      await invokeRunEndOnce({
        outcome: 'ABORTED',
        assistantMessageId: cancelledAssistantMsg.id,
        endedAt: cancelledAssistantMsg.timestamp,
      });

      emit({
        id: nextEventId(),
        event: 'message_end',
        data: buildSessionMessageEndPayload(store, sessionState, {
          cancelled: true,
          runId: turnRunId,
        }),
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

    if (
      structuredTurnAction?.kind === 'SYNTHESIZE_SRS' &&
      !allArtifacts.some((a) => a.kind === 'REQUIREMENT_DOC') &&
      accumulatedText.trim().length >= 120 &&
      /^#{1,3}\s+/m.test(accumulatedText)
    ) {
      const proj = store.getProject(sessionState.projectId);
      const draftDocId =
        typeof structuredTurnAction.params.docId === 'string' &&
        structuredTurnAction.params.docId.trim()
          ? structuredTurnAction.params.docId.trim()
          : `doc-draft-${sessionState.id}`;
      const draftTitle =
        typeof structuredTurnAction.params.title === 'string' &&
        structuredTurnAction.params.title.trim()
          ? structuredTurnAction.params.title.trim()
          : pickLocaleText(
              effectiveLocale,
              `${proj?.name ?? sessionState.projectId} — 软件需求规格说明书 (草稿)`,
              `${proj?.name ?? sessionState.projectId} — Software Requirements Specification (Draft)`,
            );
      store.saveRequirementDoc({
        id: draftDocId,
        projectId: sessionState.projectId,
        title: draftTitle,
        version:
          typeof structuredTurnAction.params.version === 'string' &&
          structuredTurnAction.params.version.trim()
            ? structuredTurnAction.params.version.trim()
            : 'v1.0-draft',
        content: accumulatedText.trim(),
        status: 'DRAFT',
      });
    }

    // Preserve completed screens in prototypeTurnDraft even if a later subagent/step timed out!
    if (
      prototypeTurnDraft &&
      prototypeTurnDraft.workingHtml.trim().length > 0 &&
      prototypeTurnDraft.workingHtml !== prototypeTurnDraft.baselineHtml &&
      /data-screen-id=/i.test(prototypeTurnDraft.workingHtml)
    ) {
      const cleanRevisionNote = stripSelectionBlockFromPrompt(synthesizedPrompt);
      if (!prototypeTurnDraft.prototypeId) {
        const savedPartial = store.createPrototype(sessionState.projectId, {
          name: prototypeTurnDraft.prototypeName,
          title: cleanRevisionNote.slice(0, 48),
          instruction: cleanRevisionNote,
          htmlContent: prototypeTurnDraft.workingHtml,
          source: 'AGENT_RUN',
          coDesignSessionId: sessionState.id,
          ...(prototypeTurnDraft.designBrief ? { designBrief: prototypeTurnDraft.designBrief } : {}),
          agentRunId: turnRunId,
        });
        prototypeTurnDraft.prototypeId = savedPartial.prototype.id;
        sessionState = {
          ...sessionState,
          targetId: savedPartial.prototype.id,
        };
        allArtifacts.push({
          kind: 'PROTOTYPE_REVISION',
          prototypeId: savedPartial.prototype.id,
          revisionId: savedPartial.revision.id,
          revisionNumber: savedPartial.revision.revisionNumber,
          modifiedAnchors: prototypeTurnDraft.modifiedAnchors,
        });
      } else {
        const appendedPartial = store.appendPrototypeRevision(prototypeTurnDraft.prototypeId, {
          title: cleanRevisionNote.slice(0, 48),
          instruction: cleanRevisionNote,
          htmlContent: prototypeTurnDraft.workingHtml,
          source: 'AGENT_RUN',
          agentRunId: turnRunId,
        });
        allArtifacts.push({
          kind: 'PROTOTYPE_REVISION',
          prototypeId: appendedPartial.prototype.id,
          revisionId: appendedPartial.revision.id,
          revisionNumber: appendedPartial.revision.revisionNumber,
          modifiedAnchors: prototypeTurnDraft.modifiedAnchors,
        });
      }
    }

    const errorAssistantMsg: AgentSessionMessage = {
      id: nextAgentMessageId('err'),
      runId: turnRunId,
      role: 'assistant',
      content: accumulatedText,
      ...(accumulatedThinking
        ? { thinking: accumulatedThinking, thinkingDurationMs: Date.now() - turnStartMs }
        : {}),
      ...(allToolTraces.length > 0 ? { toolCalls: allToolTraces } : {}),
      ...(allSubagentLanes.length > 0 ? { subagentLanes: allSubagentLanes } : {}),
      ...(lastCodeModeScript ? { codeModeScript: lastCodeModeScript } : {}),
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
      status: 'ERROR',
      messages: [...sessionState.messages, errorAssistantMsg],
      updatedAt: new Date().toISOString(),
    });

    saveSessionCheckpointSafe(store, sessionState, {
      phase: 'FAILED',
      runId: turnRunId,
      messageCount: sessionState.messages.length,
      errorCode: diagnostic.code,
    });

    await invokeRunEndOnce({
      outcome: 'FAILED',
      assistantMessageId: errorAssistantMsg.id,
      endedAt: errorAssistantMsg.timestamp,
      error: diagnostic,
    });

    emit({
      id: nextEventId(),
      event: 'run_error',
      data: {
        runId: turnRunId,
        diagnostic: errorAssistantMsg.errorDiagnostic,
        session: sessionState,
        ...(sessionState.projectId
          ? {
              artifactHistory: store.listArtifactHistoryViews(sessionState.projectId),
              prototypes: store.listPrototypes(sessionState.projectId),
            }
          : {}),
        ...(sessionState.agentKind === 'REQUIREMENT'
          ? { requirementDocs: store.listRequirementDocs(sessionState.projectId) }
          : {}),
      },
    });
  } finally {
    clearInterval(heartbeatInterval);
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
    }
    if (activeSessionAbortControllers.get(existing.id) === controller) {
      activeSessionAbortControllers.delete(existing.id);
    }
    if (didInvokeRunStart && !runEndInvoked) {
      await invokeRunEndOnce({
        outcome: 'FAILED',
        assistantMessageId: assistantMsgId,
        endedAt: new Date().toISOString(),
        error: {
          code: 'AGENT_RUNTIME_ERROR',
          message: 'Agent run terminated unexpectedly before recording completion.',
        },
      }).catch(() => {});
    }
  }
}

function notifyRunSubscribers(run: ActiveBackgroundSessionRun): void {
  for (const notify of Array.from(run.subscribers)) {
    notify();
  }
}

function launchActiveRunInSlot(
  store: WorkspaceStore,
  slot: SessionRunnerSlot,
  sessionId: string,
  turnInput: Omit<UnifiedAgentStreamInput, 'signal'>,
): ActiveBackgroundSessionRun {
  const controller = new AbortController();
  const existingSession = store.getAgentSession(sessionId);
  const turnIdentity = allocateTurnRunIdentity(existingSession, turnInput);
  const run: ActiveBackgroundSessionRun = {
    runId: turnIdentity.runId,
    sessionId,
    controller,
    bufferedEvents: createCoalescingRunEventBuffer<UnifiedAgentSseEvent>(prototypeLiveCoalesceKey),
    subscribers: new Set(),
    done: false,
    completionPromise: Promise.resolve(),
  };

  slot.activeRun = run;

  const emit = (ev: UnifiedAgentSseEvent) => {
    run.bufferedEvents.push(ev);
    notifyRunSubscribers(run);
  };

  run.completionPromise = executeUnifiedTurnCore(
    store,
    turnInput,
    emit,
    controller,
    turnIdentity,
  )
    .catch((err) => {
      emit({
        id: `${sessionId}-evt-fatal-${Date.now().toString(36)}`,
        event: 'run_error',
        data: {
          diagnostic: {
            code: 'AGENT_RUNTIME_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
          session: store.getAgentSession(sessionId),
        },
      });
    })
    .finally(() => {
      run.done = true;
      notifyRunSubscribers(run);
      if (slot.activeRun === run) {
        slot.activeRun = null;
        pumpNextQueuedTurn(store, slot, sessionId);
      }
    });

  return run;
}

function pumpNextQueuedTurn(
  store: WorkspaceStore,
  slot: SessionRunnerSlot,
  sessionId: string,
): void {
  while (slot.queue.length > 0) {
    const next = slot.queue.shift()!;
    if (next.cancelled) {
      next.resolveRun(null);
      continue;
    }
    if (!store.getAgentSession(sessionId)) {
      next.resolveRun(null);
      continue;
    }
    const launched = launchActiveRunInSlot(store, slot, sessionId, next.input);
    next.resolveRun(launched);
    return;
  }
}

async function* subscribeToBackgroundRun(
  run: ActiveBackgroundSessionRun,
  signal?: AbortSignal,
  afterEventId?: string,
): AsyncGenerator<UnifiedAgentSseEvent, void, unknown> {
  // Superseded prototype screen deltas are skipped, so a reconnecting client catches up with
  // each screen's current state instead of replaying every delta.
  let cursor = run.bufferedEvents.startAfter(afterEventId);

  while (true) {
    if (signal?.aborted) {
      return;
    }
    for (let next = run.bufferedEvents.read(cursor); next; next = run.bufferedEvents.read(cursor)) {
      if (signal?.aborted) {
        return;
      }
      cursor = next.nextCursor;
      yield next.event;
    }
    cursor = Math.max(cursor, run.bufferedEvents.size());
    if (run.done) {
      return;
    }
    await new Promise<void>((resolve) => {
      const onUpdate = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        run.subscribers.delete(onUpdate);
        signal?.removeEventListener('abort', onAbort);
      };
      run.subscribers.add(onUpdate);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (cursor < run.bufferedEvents.size() || run.done || signal?.aborted) {
        cleanup();
        resolve();
      }
    });
  }
}

export async function* runUnifiedAgentSessionStream(
  store: WorkspaceStore,
  input: UnifiedAgentStreamInput,
): AsyncGenerator<UnifiedAgentSseEvent, void, unknown> {
  const existing = store.getAgentSession(input.sessionId);
  if (!existing) {
    throw new Error(`Agent session not found: ${input.sessionId}`);
  }

  const { signal: clientSignal, ...turnInput } = input;
  const slot = getOrCreateSessionSlot(store, input.sessionId);

  if (input.mode === 'STEER' && slot.activeRun && !slot.activeRun.done) {
    const priorCompletion = slot.activeRun.completionPromise;
    abortActiveAgentSession(input.sessionId, 'STEER_SUPERSEDED', store);
    await Promise.race([
      priorCompletion,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
    const steerRun = launchActiveRunInSlot(store, slot, input.sessionId, turnInput);
    yield* subscribeToBackgroundRun(steerRun, clientSignal);
    return;
  }

  if (slot.activeRun && !slot.activeRun.done) {
    const queuedRunPromise = new Promise<ActiveBackgroundSessionRun | null>((resolve) => {
      slot.queue.push({
        queueId: `sq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        input: turnInput,
        cancelled: false,
        resolveRun: resolve,
      });
    });

    if (clientSignal?.aborted) {
      return;
    }

    const startedRun = await new Promise<ActiveBackgroundSessionRun | null>((resolve) => {
      const onClientDisconnect = () => {
        resolve(null);
      };
      clientSignal?.addEventListener('abort', onClientDisconnect, { once: true });
      void queuedRunPromise.then((run) => {
        clientSignal?.removeEventListener('abort', onClientDisconnect);
        resolve(run);
      });
    });

    if (!startedRun || clientSignal?.aborted) {
      return;
    }

    yield* subscribeToBackgroundRun(startedRun, clientSignal);
    return;
  }

  const run = launchActiveRunInSlot(store, slot, input.sessionId, turnInput);
  yield* subscribeToBackgroundRun(run, clientSignal);
}

function resolveEffectiveStructuredAction(
  messages: AgentSessionMessage[],
  currentPrompt: string,
): ReturnType<typeof parseStructuredActionFromPrompt> {
  const direct = parseStructuredActionFromPrompt(currentPrompt);
  if (direct) return direct;
  const trimmed = currentPrompt.trim();
  const isResumePrompt =
    !trimmed || /^(?:继续|重试|恢复|continue\b|resume\b|retry\b)/i.test(trimmed);
  if (!isResumePrompt) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]!;
    if (msg.role === 'assistant') {
      if (msg.cancelled || msg.errorDiagnostic) {
        continue;
      }
      return null;
    }
    if (msg.role === 'user') {
      const prior = parseStructuredActionFromPrompt(msg.content);
      if (prior) return prior;
    }
  }
  return null;
}

function buildSessionMessageEndPayload(
  store: WorkspaceStore,
  session: AgentSession,
  extra?: { cancelled?: boolean; runId?: string },
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...(extra?.runId ? { runId: extra.runId } : {}),
    session,
    ...(extra?.cancelled ? { cancelled: true } : {}),
    project: store.getProject(session.projectId),
    stepConfirmations: store.getProjectStepConfirmations(session.projectId),
    artifactHistory: session.projectId ? store.listArtifactHistoryViews(session.projectId) : [],
  };

  if (session.agentKind === 'PROTOTYPE_CO_DESIGN' || session.agentKind === 'COPILOT') {
    base.prototypes = store.listPrototypes(session.projectId);
    base.confirmedPrototypeRevision =
      store.getConfirmedPrototypeRevision(session.projectId) ?? null;
  }
  if (session.agentKind === 'REQUIREMENT') {
    base.requirementDocs = store.listRequirementDocs(session.projectId);
    base.requirementSessions = store.listRequirementSessions(session.projectId);
  }
  if (session.agentKind === 'ARCHITECTURE' || session.agentKind === 'CODING') {
    base.fourLayerAssets = store.listFourLayerAssets();
    base.assembledApplications = store.listAssembledApplications();
  }
  if (session.agentKind === 'CAPABILITY') {
    base.extractionJobs = store.listExtractionJobs();
  }
  if (session.agentKind === 'REASONING') {
    base.metrics = store.listMetrics();
    base.analyticsReports = store.listAnalyticsReports();
    base.reasoningSessions = store.listReasoningSessions();
  }
  return base;
}

function markOrphanedRunningSessionInterrupted(
  store: WorkspaceStore,
  session: AgentSession,
): {
  session: AgentSession;
  diagnostic: NonNullable<AgentSessionMessage['errorDiagnostic']>;
} {
  const lastUserMsg = [...session.messages].reverse().find((m) => m.role === 'user');
  const locale = resolveEffectiveLocale(store, undefined, lastUserMsg?.content ?? session.title);
  const diagnostic: NonNullable<AgentSessionMessage['errorDiagnostic']> = {
    code: 'AGENT_RUN_INTERRUPTED',
    message: pickLocaleText(
      locale,
      '服务端已重启或后台运行意外中断，本轮智能体执行未完成。',
      'Server restarted or the background agent run was interrupted before completion.',
    ),
    remediation: pickLocaleText(
      locale,
      '请点击「重试 / 继续」从最近的持久化检查点恢复执行。',
      'Click Retry / Continue to resume execution from the latest durable checkpoint.',
    ),
  };

  const lastMsg = session.messages[session.messages.length - 1];
  const alreadyMarked =
    lastMsg?.role === 'assistant' && lastMsg.errorDiagnostic?.code === 'AGENT_RUN_INTERRUPTED';

  const nowIso = new Date().toISOString();
  const interruptedRunId = lastUserMsg ? lastUserMsg.runId || lastUserMsg.id : undefined;
  const nextMessages = alreadyMarked
    ? session.messages
    : [
        ...session.messages,
        {
          id: nextAgentMessageId('interrupted'),
          ...(interruptedRunId ? { runId: interruptedRunId } : {}),
          role: 'assistant' as const,
          content: '',
          errorDiagnostic: diagnostic,
          timestamp: nowIso,
        },
      ];

  const updatedSession = store.saveAgentSession({
    ...session,
    status: 'ERROR',
    messages: nextMessages,
    updatedAt: nowIso,
  });

  saveSessionCheckpointSafe(store, updatedSession, {
    phase: 'INTERRUPTED',
    messageCount: updatedSession.messages.length,
    errorCode: diagnostic.code,
  });

  return { session: updatedSession, diagnostic };
}

export async function autoResumeInterruptedAgentSessions(
  store: WorkspaceStore,
): Promise<number> {
  const runningSessions = store
    .listAgentSessions()
    .filter((session) => session.status === 'RUNNING');

  let processedCount = 0;
  for (const session of runningSessions) {
    const slot = getSessionSlot(store, session.id);
    if (slot?.activeRun && !slot.activeRun.done) {
      continue;
    }

    const cp =
      typeof store.loadAgentCheckpoint === 'function'
        ? store.loadAgentCheckpoint(session.id)
        : undefined;

    let phase: string | undefined;
    if (cp?.stateJson) {
      try {
        const parsed = JSON.parse(cp.stateJson) as { phase?: unknown };
        if (typeof parsed.phase === 'string') {
          phase = parsed.phase;
        }
      } catch {
        phase = undefined;
      }
    }

    const resumableCheckpoint =
      Boolean(cp) &&
      Boolean(phase) &&
      phase !== 'COMPLETED' &&
      phase !== 'AWAITING_USER' &&
      phase !== 'CANCELLED' &&
      phase !== 'FAILED' &&
      phase !== 'INTERRUPTED';

    const hasLastUserMsg = session.messages.some(
      (msg) => msg.role === 'user' && Boolean(msg.content.trim()),
    );
    const hasRunnableBackend =
      isMockLlmActive(store) ||
      store.listLlmProviders().some((p) => p.enabled && Boolean(p.baseUrl?.trim()));

    if (resumableCheckpoint && hasLastUserMsg && hasRunnableBackend) {
      try {
        await collectUnifiedAgentTurn(store, {
          sessionId: session.id,
          mode: 'CONTINUE',
        });
        const refreshed = store.getAgentSession(session.id);
        if (!refreshed || refreshed.status === 'RUNNING') {
          markOrphanedRunningSessionInterrupted(store, refreshed ?? session);
        }
      } catch {
        const current = store.getAgentSession(session.id) ?? session;
        markOrphanedRunningSessionInterrupted(store, current);
      }
    } else {
      markOrphanedRunningSessionInterrupted(store, session);
    }

    processedCount += 1;
  }

  return processedCount;
}

export async function* attachUnifiedAgentSessionLiveStream(
  store: WorkspaceStore,
  sessionId: string,
  options?: {
    afterEventId?: string;
    signal?: AbortSignal;
  },
): AsyncGenerator<UnifiedAgentSseEvent, void, unknown> {
  const slot = getSessionSlot(store, sessionId);
  if (slot?.activeRun && !slot.activeRun.done) {
    yield* subscribeToBackgroundRun(slot.activeRun, options?.signal, options?.afterEventId);
    return;
  }

  const existing = store.getAgentSession(sessionId);
  if (!existing) {
    throw new Error(`Agent session not found: ${sessionId}`);
  }

  if (existing.status === 'RUNNING') {
    const { session: interruptedSession, diagnostic } =
      markOrphanedRunningSessionInterrupted(store, existing);
    if (options?.signal?.aborted) {
      return;
    }
    yield {
      id: `${sessionId}-evt-interrupted-${Date.now().toString(36)}`,
      event: 'run_error',
      data: {
        ...buildSessionMessageEndPayload(store, interruptedSession),
        diagnostic,
      },
    };
    return;
  }

  if (options?.signal?.aborted) {
    return;
  }

  yield {
    id: `${sessionId}-evt-snapshot-${Date.now().toString(36)}`,
    event: 'message_end',
    data: buildSessionMessageEndPayload(store, existing),
  };
}

export async function startUnifiedAgentSessionTurn(
  store: WorkspaceStore,
  input: Omit<UnifiedAgentStreamInput, 'signal'>,
  options?: { awaitCompletion?: boolean },
): Promise<{ runId: string; session: AgentSession }> {
  const existing = store.getAgentSession(input.sessionId);
  if (!existing) {
    throw new Error(`Agent session not found: ${input.sessionId}`);
  }
  if (options?.awaitCompletion !== false) {
    const collected = await collectUnifiedAgentTurn(store, input);
    const lastUser = [...collected.session.messages].reverse().find((m) => m.role === 'user');
    return {
      runId: lastUser?.runId ?? lastUser?.id ?? '',
      session: collected.session,
    };
  }

  const slot = getOrCreateSessionSlot(store, input.sessionId);
  if (slot.activeRun && !slot.activeRun.done) {
    const turnIdentity = allocateTurnRunIdentity(existing, input);
    slot.queue.push({
      queueId: `sq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      input,
      cancelled: false,
      resolveRun: () => undefined,
    });
    return {
      runId: turnIdentity.runId,
      session: store.getAgentSession(input.sessionId) ?? existing,
    };
  }

  const run = launchActiveRunInSlot(store, slot, input.sessionId, input);
  return {
    runId: run.runId,
    session: store.getAgentSession(input.sessionId) ?? existing,
  };
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
