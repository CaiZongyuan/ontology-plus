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
  type DesignBrief,
  type InteractivePrototype,
  type LlmProviderConfig,
  type ProjectDetail,
  type PrototypeTargetAnchor,
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
  type LlmSynthesizedDomainBlueprint,
} from './domain-run-tools.js';
import {
  PROTOTYPE_ANCHOR_OPENAI_TOOLS,
  editPrototypeAnchor,
  listPrototypeAnchors,
  readPrototypeAnchor,
  rewritePrototypePage,
  type PrototypeAnchorEditOperation,
} from './prototype-anchor-tools.js';
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

function buildMockGeneratedPrototypeHtml(
  project: ProjectDetail | undefined,
  prompt: string,
  locale: AgentLocale,
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
  const aggName = firstAgg?.name || 'BusinessOrder';
  const aggLabel =
    firstAgg?.alias ||
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
  if (overview.elements[0]?.elementId) {
    return {
      elementId: overview.elements[0].elementId,
      ...(overview.elements[0].screenId ? { screenId: overview.elements[0].screenId } : {}),
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
  readonly bufferedEvents: UnifiedAgentSseEvent[];
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
    bufferedEventCount: activeRun ? activeRun.bufferedEvents.length : 0,
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
): Promise<{ aborted: boolean; session: AgentSession | undefined }> {
  const slot = getSessionSlot(store, sessionId);
  const runningPromise =
    slot?.activeRun && !slot.activeRun.done ? slot.activeRun.completionPromise : undefined;
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
  return { aborted, session };
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

      if (session.agentKind === 'PROTOTYPE_CO_DESIGN') {
        const targetProto = resolveTargetPrototypeForSession(store, session);
        if (!targetProto) {
          return fauxAssistantMessage(
            [
              fauxThinking(
                pickLocaleText(
                  loc,
                  `正在根据已确认的设计简报、参考设计令牌与 7 组交互动效硬约束生成首版响应式原型（1440px / 768px / 390px），并挂载完整 MU 语义锚点。`,
                  `Generating initial responsive prototype (1440px / 768px / 390px) from the confirmed Design Brief, design tokens, and 7 motion constraints with full MU semantic anchors.`,
                ),
              ),
              fauxToolCall('rewrite_prototype_page', {
                htmlContent: buildMockGeneratedPrototypeHtml(project, userPrompt, loc),
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

      if (session.agentKind === 'CODING') {
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
          const applicationId =
            typeof parsedAction?.params.applicationId === 'string' &&
            parsedAction.params.applicationId.trim()
              ? parsedAction.params.applicationId.trim()
              : undefined;
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
                specMarkdown: buildMockTechArchMarkdown(name, stackTags, extraPrompt, loc),
                ...(applicationId ? { applicationId } : {}),
              }),
            ],
            { stopReason: 'toolUse' },
          );
        }

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
                status: 'CONFIRMED',
                content: srsContent,
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
        extraByName.get('save_synthesized_srs_doc')!,
        extraByName.get('inspect_ontology_model')!,
        extraByName.get('ask_user')!,
      ];
    case 'COPILOT':
      return [
        ...ontologyTools,
        extraByName.get('synthesize_ontology_suite')!,
        extraByName.get('inspect_ontology_model')!,
        extraByName.get('ask_user')!,
      ];
    case 'CODING':
      return [
        extraByName.get('compile_dev_package')!,
        extraByName.get('save_tech_architecture_spec')!,
        extraByName.get('inspect_ontology_model')!,
        ...ontologyTools,
        extraByName.get('ask_user')!,
      ];
    case 'CAPABILITY':
      return [
        extraByName.get('invoke_mcp_tool')!,
        extraByName.get('run_ontology_extraction')!,
        extraByName.get('inspect_ontology_model')!,
        extraByName.get('ask_user')!,
      ];
    case 'REASONING':
      return [
        extraByName.get('run_readonly_sql')!,
        extraByName.get('propose_policy_writeback')!,
        extraByName.get('save_metric_insight')!,
        extraByName.get('save_scenario_attribution_report')!,
        extraByName.get('inspect_ontology_model')!,
        extraByName.get('ask_user')!,
      ];
    case 'PROTOTYPE_CO_DESIGN':
      return [
        ...PROTOTYPE_ANCHOR_OPENAI_TOOLS.map(toPiTool),
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
    if (session.agentKind === 'CODING') {
      return `${baseHeaderEn}\nTarget assembled application ID: ${session.targetId ?? 'app-01'}. Call compile_dev_package to compile progressive-disclosure engineering artifacts, call save_tech_architecture_spec when asked to generate or persist a 4-layer technical architecture specification ([ACTION:GENERATE_TECH_ARCH ...]), or refine ontology elements.`;
    }
    if (session.agentKind === 'REQUIREMENT') {
      return `${baseHeaderEn}\nFollow Class-A/B progressive grilling: tag standard audit/engineering defaults with [AI Auto-Completed], tag confirmed business rules with [Confirmed], call ask_user for unresolved Class-B decisions (or tag [Pending]), call record_requirement_insights to persist candidate aggregates and rules, and when asked to synthesize the SRS ([ACTION:SYNTHESIZE_SRS ...] or user request), MUST call save_synthesized_srs_doc with the complete 9-chapter Markdown specification (## 1. through ## 9., including ### 9.1 through ### 9.7).`;
    }
    if (session.agentKind === 'PROTOTYPE_CO_DESIGN') {
      const proto = resolveTargetPrototypeForSession(store, session);
      if (!proto) {
        return [
          baseHeaderEn,
          `Target Interactive Prototype: Unbound initial generation (Revision #1 from Design Brief).`,
          `Initial Prototype Generation Rules:`,
          `1. Call \`rewrite_prototype_page\` with \`allowAnchorReset: true\` and a complete, self-contained HTML5 document.`,
          `2. Strictly follow the confirmed Design Brief, reference DESIGN.md tokens, 7 interactive motion specifications, and SRS scope.`,
          `3. Include semantic anchors (\`data-screen-id\`, \`data-screen-name\`, \`data-screen-type\`, \`data-element-id\`, \`data-element-type\`, \`data-binding\`, \`data-event-id\`) on every screen and interactive control, and NEVER use window.alert/confirm/prompt.`,
          `4. Ensure clean responsive layout across Desktop (1440px), Tablet (768px), and Mobile (390px) viewports.`,
          `5. If \`rewrite_prototype_page\` returns isError=true, fix the semantic anchors and retry in the same turn.`,
        ].join('\n');
      }
      const overview = listPrototypeAnchors(proto.htmlContent);
      const screensDesc =
        overview.screens
          .map((s) => `${s.screenId}(${s.screenName}:${s.screenType}, elements=${s.elementCount})`)
          .join(', ') || 'none';
      return [
        baseHeaderEn,
        `Target Interactive Prototype: ${proto.name} (ID: ${proto.id}, Version: ${proto.version}).`,
        `Screens in prototype: ${screensDesc}.`,
        `Prototype Co-Design Rules:`,
        `1. Always call \`read_prototype_anchor\` (or \`list_prototype_anchors\`) first to inspect ONLY the targeted element or screen without reading unrelated screens.`,
        `2. For localized refinements, ALWAYS call \`edit_prototype_anchor\` (\`replace_element\` | \`insert_after_element\` | \`append_to_screen\` | \`update_attributes\`) so untouched screens and sibling elements stay byte-for-byte identical.`,
        `3. Reserve \`rewrite_prototype_page\` strictly for whole-page visual restyling or brand-new prototype generation.`,
        `4. Preserve existing \`data-screen-id\`, \`data-element-id\`, \`data-binding\`, and \`data-event-id\` anchors, add valid \`data-element-id\` + \`data-element-type\` on every new <button>/<input>/<select>/<textarea>, and NEVER use window.alert/confirm/prompt.`,
        `5. If an edit tool returns isError=true, fix the semantic anchors and retry in the same turn.`,
      ].join('\n');
    }
    return `${baseHeaderEn}\nCurrent M1 aggregates: ${(project?.suite.M1?.aggregates ?? []).map((a) => `${a.name}(${a.id}:${a.alias})`).join(', ') || 'none'}; M3 rules count: ${project?.suite.M3?.rules.length ?? 0}. When asked to synthesize the 11-model Ontology Suite from the prototype ([ACTION:SYNTHESIZE_ONTOLOGY_SUITE ...] or user request), MUST call synthesize_ontology_suite.`;
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
      `优先调用 run_readonly_sql 获取真实表数据后再输出结论，结论中的每个数字都必须来自查询结果；收到 [ACTION:METRIC_INSIGHT ...] 时必须结合实查结果调用 save_metric_insight 输出指标异动洞察；收到 [ACTION:SCENARIO_ATTRIBUTION ...] 时必须结合实查结果调用 save_scenario_attribution_report 归档场景归因报告；在 ASK_POLICY 模式下可调用 propose_policy_writeback 生成策略建议。`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (session.agentKind === 'CAPABILITY') {
    const caps = project ? inspectOntologyMcpCapabilities(project) : null;
    const toolNames = caps?.tools.map((t) => `${t.name}(${t.sourceModel})`).join(', ') ?? '无';
    return `${baseHeader}\n当前工程可用 Ontology MCP 工具：${toolNames}。优先调用 invoke_mcp_tool 执行业务动作或查询；当收到本体萃取请求（如 [ACTION:RUN_ONTOLOGY_EXTRACTION ...] 或 DDL/OpenAPI/文档本体萃取）时，必须调用 run_ontology_extraction 工具。`;
  }
  if (session.agentKind === 'CODING') {
    return `${baseHeader}\n目标装配应用 ID：${session.targetId ?? 'app-01'}。可调用 compile_dev_package 编译渐进式披露开发包，收到生成四层技术架构规范请求（如 [ACTION:GENERATE_TECH_ARCH ...]）时必须调用 save_tech_architecture_spec 落库资产，或微调本体元素。`;
  }
  if (session.agentKind === 'REQUIREMENT') {
    return `${baseHeader}\n遵循 A/B 分级追问策略：A 类常规默认项标注 [AI自动补全]，B 类核心业务边界标注 [已确认] 或调用 ask_user 让用户选择确认，调用 record_requirement_insights 沉淀候选规则；当用户请求合成 SRS（如 [ACTION:SYNTHESIZE_SRS ...]）时，必须调用 save_synthesized_srs_doc 工具提交完整 9 章节《需求规格说明书.md》（含 ## 1. ~ ## 9. 及 ### 9.1 ~ ### 9.7）。`;
  }
  if (session.agentKind === 'PROTOTYPE_CO_DESIGN') {
    const proto = resolveTargetPrototypeForSession(store, session);
    if (!proto) {
      return [
        baseHeader,
        `当前共创目标交互原型：未绑定（按设计简报从零生成首版交互原型 Revision #1）。`,
        `首版原型生成准则：`,
        `1. 直接调用 \`rewrite_prototype_page\`（携带 \`allowAnchorReset: true\`）输出完整单文件可运行 HTML5 原型。`,
        `2. 严格落实设计简报条目、Inspo DESIGN.md 设计令牌、7 组交互动效硬性约束与 SRS 业务要素。`,
        `3. 每个业务屏幕必须声明合法 \`data-screen-id\`、\`data-screen-name\`、\`data-screen-type\`，所有 <button>/<input>/<select>/<textarea> 必须携带唯一合法 \`data-element-id\` 与 \`data-element-type\`（并合理挂载 \`data-binding\` 与 \`data-event-id\`），严禁使用 window.alert/confirm/prompt。`,
        `4. 页面必须原生支持响应式布局，在桌面端 (1440px)、平板端 (768px) 与手机端 (390px) 视口下均排版整洁无溢出。`,
        `5. 若锚点校验器返回 isError=true，请根据诊断在本轮内补齐语义锚点并自动重试。`,
      ].join('\n');
    }
    const overview = listPrototypeAnchors(proto.htmlContent);
    const screensDesc =
      overview.screens
        .map((s) => `${s.screenId}(${s.screenName}:${s.screenType}, 控件数=${s.elementCount})`)
        .join(', ') || '无';
    return [
      baseHeader,
      `当前共创目标交互原型：${proto.name}（ID: ${proto.id}，版本: ${proto.version}）。`,
      `当前原型包含屏幕锚点：${screensDesc}。`,
      `原型局部精修准则：`,
      `1. 先调用 \`read_prototype_anchor\`（或 \`list_prototype_anchors\`）精准读取目标控件或目标屏幕片段，严禁无故重写其他无关屏幕。`,
      `2. 局部改动一律调用 \`edit_prototype_anchor\`（\`replace_element\` | \`insert_after_element\` | \`append_to_screen\` | \`update_attributes\`），确保未选中的屏幕与兄弟控件保持逐字节一致。`,
      `3. \`rewrite_prototype_page\` 仅限明确要求“整页重做风格”或“从零生成整页原型”时调用。`,
      `4. 严格保留既有 \`data-screen-id\`、\`data-element-id\`、\`data-binding\`、\`data-event-id\` 语义锚点；任何新增 <button>/<input>/<select>/<textarea> 必须携带合法唯一的 \`data-element-id\` 与 \`data-element-type\`；严禁使用 window.alert/confirm/prompt。`,
      `5. 若锚点校验器返回 isError=true，请根据诊断在本轮内补齐语义锚点并自动重试。`,
    ].join('\n');
  }
  return `${baseHeader}\n当前 M1 聚合根：${(project?.suite.M1?.aggregates ?? []).map((a) => `${a.name}(${a.id}:${a.alias})`).join(', ') || '无'}；M3 规则数：${project?.suite.M3?.rules.length ?? 0}。当收到从确认原型合成 11 模型请求（如 [ACTION:SYNTHESIZE_ONTOLOGY_SUITE ...]）时，必须调用 synthesize_ontology_suite 工具并交由两级一致性校验门禁落库。`;
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
}

async function executeUnifiedToolCall(
  store: WorkspaceStore,
  session: AgentSession,
  tc: ToolCall,
  hadPreviousValidatorError: boolean,
  locale: AgentLocale = 'zh-CN',
  prototypeDraft?: PrototypeTurnDraft,
  options?: { isMock?: boolean; actionParams?: Record<string, unknown> },
): Promise<ExecutedToolStep> {
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
    tc.name === 'rewrite_prototype_page'
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
  images?: TransientTurnImageInput[];
  designBrief?: DesignBrief;
  prototypeName?: string;
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

  let sessionState: AgentSession = store.saveAgentSession({
    ...existing,
    title: nextTitle,
    ...(input.reasoningMode ? { reasoningMode: input.reasoningMode } : {}),
    status: 'RUNNING',
    messages: workingMessages,
    updatedAt: nowIso,
  });

  saveSessionCheckpointSafe(store, sessionState, {
    phase: 'TURN_STARTED',
    messageCount: sessionState.messages.length,
    toolCallsCount: 0,
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
  const prototypeTurnDraft: PrototypeTurnDraft | undefined =
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
            ...(input.designBrief ? { designBrief: input.designBrief } : {}),
            baselineHtml: '',
            workingHtml: '',
            modifiedAnchors: [],
          }
      : undefined;

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

    emit({
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

        const executed = await executeUnifiedToolCall(
          store,
          sessionState,
          tc,
          hadValidatorError,
          effectiveLocale,
          prototypeTurnDraft,
          {
            isMock: built.isMock,
            ...(structuredTurnAction ? { actionParams: structuredTurnAction.params } : {}),
          },
        );
        if (executed.isError) {
          hadValidatorError = true;
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
          { isMock: false, actionParams: structuredTurnAction.params },
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
            { isMock: false, actionParams: structuredTurnAction.params },
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
          { isMock: false, actionParams: structuredTurnAction.params },
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
      !pendingAskUser
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
          agentRunId: assistantMsgId,
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
            agentRunId: assistantMsgId,
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

    if (!accumulatedText.trim() && allToolTraces.length > 0) {
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

    saveSessionCheckpointSafe(store, sessionState, {
      phase: 'COMPLETED',
      messageCount: sessionState.messages.length,
      toolCallsCount: allToolTraces.length,
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
      data: buildSessionMessageEndPayload(store, sessionState),
    });
  } catch (err) {
    const currentActive = activeSessionAbortControllers.get(existing.id);
    const supersededByNewTurn = Boolean(currentActive && currentActive !== controller);
    if (
      supersededByNewTurn ||
      (err instanceof SessionStreamAbortedError && err.kind === 'STEER_SUPERSEDED')
    ) {
      return;
    }

    if (err instanceof SessionStreamAbortedError && err.kind === 'USER_ABORT') {
      const cancelledAssistantMsg: AgentSessionMessage = {
        id: assistantMsgId,
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
        messageCount: sessionState.messages.length,
        toolCallsCount: allToolTraces.length,
      });

      emit({
        id: nextEventId(),
        event: 'message_end',
        data: buildSessionMessageEndPayload(store, sessionState, { cancelled: true }),
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
      status: 'ERROR',
      messages: [...sessionState.messages, errorAssistantMsg],
      updatedAt: new Date().toISOString(),
    });

    saveSessionCheckpointSafe(store, sessionState, {
      phase: 'FAILED',
      messageCount: sessionState.messages.length,
      errorCode: diagnostic.code,
    });

    emit({
      id: nextEventId(),
      event: 'run_error',
      data: {
        diagnostic: errorAssistantMsg.errorDiagnostic,
        session: sessionState,
        ...(sessionState.agentKind === 'REQUIREMENT'
          ? { requirementDocs: store.listRequirementDocs(sessionState.projectId) }
          : {}),
      },
    });
  } finally {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
    }
    if (activeSessionAbortControllers.get(existing.id) === controller) {
      activeSessionAbortControllers.delete(existing.id);
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
  const run: ActiveBackgroundSessionRun = {
    runId: `srun-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
    controller,
    bufferedEvents: [],
    subscribers: new Set(),
    done: false,
    completionPromise: Promise.resolve(),
  };

  slot.activeRun = run;

  const emit = (ev: UnifiedAgentSseEvent) => {
    run.bufferedEvents.push(ev);
    notifyRunSubscribers(run);
  };

  run.completionPromise = executeUnifiedTurnCore(store, turnInput, emit, controller)
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
  let cursor = 0;
  if (afterEventId) {
    const idx = run.bufferedEvents.findIndex((e) => e.id === afterEventId);
    if (idx >= 0) {
      cursor = idx + 1;
    }
  }

  while (true) {
    if (signal?.aborted) {
      return;
    }
    while (cursor < run.bufferedEvents.length) {
      if (signal?.aborted) {
        return;
      }
      const ev = run.bufferedEvents[cursor++]!;
      yield ev;
    }
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
      if (cursor < run.bufferedEvents.length || run.done || signal?.aborted) {
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
    abortActiveAgentSession(input.sessionId, 'STEER_SUPERSEDED', store);
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
  extra?: { cancelled?: boolean },
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    session,
    ...(extra?.cancelled ? { cancelled: true } : {}),
    project: store.getProject(session.projectId),
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
  if (session.agentKind === 'CODING') {
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
  const nextMessages = alreadyMarked
    ? session.messages
    : [
        ...session.messages,
        {
          id: `amsg-${Date.now().toString(36)}-interrupted`,
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
