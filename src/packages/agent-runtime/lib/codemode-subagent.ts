import type {
  Api,
  AssistantMessage,
  Context,
  ImageContent,
  JsonObject,
  Message,
  Model,
  MutableModels,
  Tool,
  ToolCall,
  ToolResultMessage,
} from '@earendil-works/pi-ai';
import {
  InlineCodemodeSandbox,
  loadQuickJSWasm,
  renderDeclarations,
  type CodemodeTool,
  type CodemodeWasmModule,
} from '@earendil-works/pi-codemode';
import {
  DEFAULT_MULTI_AGENT_CONCURRENCY,
  type AgentSession,
  type AgentSubagentCursorZone,
  type AgentSubagentLaneTrace,
  type PrototypeTargetAnchor,
} from '../../workspace-store/index.js';
import type { PrototypeBuildFailureCode } from '../../ontology-core/index.js';
import { type AgentLocale, pickLocaleText } from './locale.js';
import {
  extractLatestHtmlWritingSignal,
  type PartialPrototypeScreenInput,
} from './prototype-anchor-tools.js';
import type { OpenAiFunctionTool } from './tools.js';
import { DOCUMENT_LEVEL_TOOL_NAMES, checkScreenHelperCall, screenHelperTools } from './prototype-design-guide.js';

let cachedWasmPromise: Promise<CodemodeWasmModule> | undefined;

function getSharedQuickJsWasm(): Promise<CodemodeWasmModule> {
  if (!cachedWasmPromise) {
    cachedWasmPromise = loadQuickJSWasm();
  }
  return cachedWasmPromise;
}

export function resolveSessionCodeModeEnabled(
  session: Pick<AgentSession, 'codeMode'>,
  override?: boolean,
): boolean {
  if (override !== undefined) return Boolean(override);
  if (session.codeMode !== undefined) return Boolean(session.codeMode);
  return true;
}

export function resolveSessionMultiAgentConcurrency(
  session: Pick<AgentSession, 'multiAgentConcurrency'>,
  override?: number,
): number {
  const raw = override ?? session.multiAgentConcurrency ?? DEFAULT_MULTI_AGENT_CONCURRENCY;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_MULTI_AGENT_CONCURRENCY;
  }
  return Math.max(1, Math.min(6, Math.round(raw)));
}

export const CODEMODE_OPENAI_TOOL: OpenAiFunctionTool = {
  type: 'function',
  function: {
    name: 'codemode',
    description:
      'Execute an async JavaScript orchestration script in a deterministic QuickJS sandbox. Inside `code`, call any available session tool via `await tools.<tool_name>(args)` and fan out independent work in parallel with `await Promise.all([...])`. Use `text(...)` or `return ...` to report concise results.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Async JavaScript function body using `await tools.<name>(args)` and `Promise.all` (no imports/fetch/process needed).',
        },
      },
      required: ['code'],
    },
  },
};

export const SPAWN_SUBAGENTS_OPENAI_TOOL: OpenAiFunctionTool = {
  type: 'function',
  function: {
    name: 'spawn_subagents',
    description:
      'Dispatch multiple independent sub-tasks to parallel specialist subagents (bounded by the session concurrency limit, default 3 running simultaneously). Ideal for building multiple prototype screens (`upsert_prototype_screen`) or synthesizing multiple domain modules in parallel.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'Independent subagent assignments to execute in parallel',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Short plain-business-language title of this sub-task (e.g. 绘制会员储值台账分屏)',
              },
              roleLabel: {
                type: 'string',
                description: 'Optional specialist label shown on the live cursor (e.g. 会员设计师)',
              },
              instruction: {
                type: 'string',
                description: 'Detailed self-contained instructions and context for this subagent',
              },
              screenId: {
                type: 'string',
                description: 'Optional target data-screen-id when this subagent builds or refines a prototype screen',
              },
              screenName: {
                type: 'string',
                description: 'Optional human-readable screen name for live artboard cursor tracking',
              },
              screenType: {
                type: 'string',
                description: 'Optional screen type (LIST | FORM | DETAIL | APPROVAL | REPORT | DASHBOARD)',
              },
            },
            required: ['title', 'instruction'],
          },
        },
      },
      required: ['tasks'],
    },
  },
};

export function renderCodemodePromptSection(
  callableTools: readonly Tool[],
  locale: AgentLocale,
  concurrency: number,
): string {
  const codemodeDecls: CodemodeTool[] = callableTools
    .filter((t) => t.name !== 'codemode')
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters as Record<string, unknown>,
      execute: () => undefined,
    }));

  let renderedTypes = '';
  try {
    renderedTypes = renderDeclarations({ tools: codemodeDecls });
  } catch {
    renderedTypes = codemodeDecls.map((t) => `// tools.${t.name}(args)`).join('\n');
  }

  if (locale === 'en-US') {
    return [
      `[Code Mode & Parallel Multi-Agent Execution]`,
      `- \`codemode\` is ENABLED: you can call \`codemode\` with an async JS body using \`await tools.<tool_name>(args)\` and \`await Promise.all([...])\` to batch multiple tool operations in one round-trip.`,
      concurrency > 1
        ? `- \`spawn_subagents\` is ENABLED (concurrency = ${concurrency} parallel subagents): for multi-screen prototype generation or multi-module modeling, declare the Build Plan first (\`plan_screens\`), set up the shared look (\`init_prototype_shell\`), then call \`spawn_subagents\` (directly or inside \`codemode\`) so ${concurrency} subagents build screens simultaneously without hitting single-call output limits.`
        : `- Running in single-agent mode (concurrency = 1).`,
      `<codemode_declarations>\n${renderedTypes}\n</codemode_declarations>`,
    ].join('\n');
  }

  return [
    `【Code Mode 代码编排与多智能体并行执行（已开启）】`,
    `- \`codemode\` 已启用：你可以调用 \`codemode\` 工具编写异步 JS 脚本，通过 \`await tools.<工具名>(参数)\` 与 \`await Promise.all([...])\` 在单轮内批量组合多个工具调用，减少往返等待。`,
    concurrency > 1
      ? `- \`spawn_subagents\` 多智能体并行已启用（默认同时运行 **${concurrency}** 个子智能体）：生成首版多屏原型或整页重做时，**严禁把所有屏幕塞进单次巨型 HTML 调用**；请先调用 \`plan_screens\` 列出施工计划（画布随之放好空白画板），再调用 \`init_prototype_shell\` 设定共享外观，然后调用 \`spawn_subagents\` 将各分屏并行交给子智能体分别调用 \`upsert_prototype_screen\` 完成！`
      : `- 当前并发度设为 1（单智能体串行模式）。`,
    `<codemode_declarations>\n${renderedTypes}\n</codemode_declarations>`,
  ].join('\n');
}

export interface RunCodemodeScriptOptions {
  code: string;
  callableTools: readonly Tool[];
  signal: AbortSignal;
  timeoutMs?: number;
  executeNestedTool: (
    toolName: string,
    args: Record<string, unknown>,
    nestedCallIndex: number,
  ) => Promise<{ outputJson: unknown; isError: boolean; errorText?: string }>;
}

export interface CodemodeExecutionSummary {
  isError: boolean;
  outputText: string;
  callsCount: number;
  failedCallsCount: number;
}

export async function runCodemodeScript(
  options: RunCodemodeScriptOptions,
): Promise<CodemodeExecutionSummary> {
  const wasm = await getSharedQuickJsWasm();
  let nestedSeq = 0;

  const sandboxTools: CodemodeTool[] = options.callableTools
    .filter((t) => t.name !== 'codemode')
    .map((spec) => ({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.parameters as Record<string, unknown>,
      async execute(rawArgs) {
        if (options.signal.aborted) {
          throw new Error('Execution aborted');
        }
        nestedSeq += 1;
        const safeArgs =
          rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : {};
        const res = await options.executeNestedTool(spec.name, safeArgs, nestedSeq);
        if (res.isError && res.errorText) {
          throw new Error(res.errorText);
        }
        return res.outputJson;
      },
    }));

  const sandbox = new InlineCodemodeSandbox({
    wasm,
    tools: sandboxTools,
    timeoutMs: options.timeoutMs ?? 240_000,
    memoryLimitBytes: 128 * 1024 * 1024,
  });

  try {
    const cleanCode = options.code
      .replace(/^```(?:javascript|js|ts|typescript)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const result = await sandbox.execute(cleanCode, { signal: options.signal });
    const textLines = result.output
      .filter((item): item is Extract<typeof item, { type: 'text' }> => item.type === 'text')
      .map((item) => item.text);

    const failedCallsCount = result.calls.filter((c) => c.status !== 'ok').length;

    if (!result.ok) {
      const partial = textLines.length > 0 ? `\nOutput before error:\n${textLines.join('\n')}` : '';
      return {
        isError: true,
        outputText: `Codemode ${result.error.kind} error: ${result.error.message}${partial}`,
        callsCount: result.calls.length,
        failedCallsCount: failedCallsCount + 1,
      };
    }

    const returnStr =
      result.value !== undefined
        ? typeof result.value === 'string'
          ? result.value
          : JSON.stringify(result.value)
        : '';

    const combined = [...textLines, ...(returnStr ? [returnStr] : [])].filter(Boolean).join('\n');
    return {
      isError: false,
      outputText:
        combined ||
        `Completed ${result.calls.length} nested tool call(s) in QuickJS Code Mode sandbox.`,
      callsCount: result.calls.length,
      failedCallsCount,
    };
  } finally {
    await sandbox.close().catch(() => {});
  }
}

export interface SubagentTaskSpec {
  title: string;
  roleLabel?: string;
  instruction: string;
  screenId?: string;
  screenName?: string;
  screenType?: string;
}

export interface RunParallelSubagentsOptions {
  tasks: readonly SubagentTaskSpec[];
  concurrency: number;
  locale: AgentLocale;
  models: MutableModels;
  selectedModel: Model<Api>;
  baseSystemPrompt: string;
  subagentTools: readonly Tool[];
  signal: AbortSignal;
  stepTimeoutMs: number;
  maxTokens: number;
  onActivity: () => void;
  onLaneUpdate: (lane: AgentSubagentLaneTrace, allLanes: AgentSubagentLaneTrace[]) => void;
  /**
   * The context package of a screen helper (#91): Design Brief, design values, shared
   * components, Visual Reference manifest, requirements summary, other screens.
   */
  screenContext?: (spec: SubagentTaskSpec) => string;
  /** Visual Reference images sent to every screen helper as vision input. */
  contextImages?: readonly ImageContent[];
  /**
   * During a prototype build every helper owns exactly one screen: a task without a screenId is
   * not run (it would have no scope to keep it on its own screen).
   */
  requireScreen?: boolean;
  onPartialScreenStream?: (
    partial: PartialPrototypeScreenInput,
    lane: AgentSubagentLaneTrace,
  ) => void;
  executeSubagentToolCall: (
    tc: ToolCall,
    lane: AgentSubagentLaneTrace,
    hadValidatorError: boolean,
  ) => Promise<{
    toolResultContent: string;
    isError: boolean;
  }>;
}

function defaultWorkerLabel(slotIndex: number, roleHint?: string): { zh: string; en: string } {
  const cleanHint = roleHint?.trim();
  if (cleanHint) {
    return { zh: cleanHint, en: cleanHint };
  }
  const presets: readonly { zh: string; en: string }[] = [
    { zh: '1 号智能体', en: 'Worker #1' },
    { zh: '2 号智能体', en: 'Worker #2' },
    { zh: '3 号智能体', en: 'Worker #3' },
    { zh: '4 号智能体', en: 'Worker #4' },
    { zh: '5 号智能体', en: 'Worker #5' },
    { zh: '6 号智能体', en: 'Worker #6' },
  ];
  return presets[(slotIndex - 1) % presets.length]!;
}

function inferThinkingCursorSignal(
  thinkingText: string,
  taskIndex: number,
): { cursorZone: AgentSubagentCursorZone; liveAction: { zh: string; en: string } } {
  const tail = thinkingText.slice(-450);
  if (/(?:drawer|抽屉|侧滑|弹窗|详情栏)/i.test(tail)) {
    return {
      cursorZone: 'drawer',
      liveAction: { zh: '构思侧滑抽屉与录入动线…', en: 'Designing slide-over drawer…' },
    };
  }
  if (/(?:confirm|submit|锁账|提交|底部|审批按钮|保存栏)/i.test(tail)) {
    return {
      cursorZone: 'footer',
      liveAction: { zh: '设计底部确认与反馈交互…', en: 'Planning footer actions & feedback…' },
    };
  }
  if (/(?:table|row|ledger|表格|台账|明细|列表|流水)/i.test(tail)) {
    return {
      cursorZone: 'body',
      liveAction: { zh: '编排业务明细表与状态徽章…', en: 'Structuring data rows & badges…' },
    };
  }
  if (/(?:filter|search|select|筛选|搜索|日期|工具栏)/i.test(tail)) {
    return {
      cursorZone: 'toolbar',
      liveAction: { zh: '布局筛选工具栏与快捷操作…', en: 'Laying out filter toolbar…' },
    };
  }
  if (/(?:kpi|stat|metric|指标|营业额|汇总|卡片)/i.test(tail)) {
    return {
      cursorZone: 'kpi',
      liveAction: { zh: '构思核心指标卡与字号层级…', en: 'Sizing summary metric cards…' },
    };
  }

  const zones: readonly { zone: AgentSubagentCursorZone; zh: string; en: string }[] = [
    { zone: 'header', zh: '规划页面顶栏与视觉焦点…', en: 'Planning header hierarchy…' },
    { zone: 'kpi', zh: '测算顶部汇总指标卡网格…', en: 'Arranging top summary cards…' },
    { zone: 'toolbar', zh: '排布查询筛选与动作按钮…', en: 'Positioning filters & actions…' },
    { zone: 'body', zh: '设计主体内容区与示例数据…', en: 'Drafting main content & records…' },
    { zone: 'footer', zh: '串联跨屏跳转与内联反馈…', en: 'Wiring inline state & navigation…' },
  ];
  const stepIdx = (Math.floor(thinkingText.length / 260) + taskIndex) % zones.length;
  const picked = zones[stepIdx]!;
  return {
    cursorZone: picked.zone,
    liveAction: { zh: picked.zh, en: picked.en },
  };
}

function stripHeavyFieldsForLiveSse(lanes: readonly AgentSubagentLaneTrace[]): AgentSubagentLaneTrace[] {
  return lanes.map(({ thinking: _omitThinking, ...rest }) => ({ ...rest }));
}

/** A screen lane ended without its own screen written and checked. */
class ScreenNotFinishedError extends Error {
  constructor(readonly code: 'validation_failed' | 'not_written') {
    super(code === 'validation_failed' ? 'Screen did not pass the anchor check' : 'Screen was not written');
  }
}

const SCREEN_WRITE_TOOLS = new Set(['upsert_prototype_screen', 'edit_prototype_anchor']);

/** What the lead learns about each screen a helper built: written, and did it pass the check. */
export interface SubagentScreenResult {
  screenId: string;
  screenName: string;
  status: 'DONE' | 'FAILED';
  /** passed: written and checked; failed: every write was rejected; not_written: never written. */
  check: 'passed' | 'failed' | 'not_written';
  failure?: PrototypeBuildFailureCode;
  /** The validator's diagnostic of the last rejected write of this screen. */
  diagnostic?: string;
}

function diagnosticOf(toolResultContent: string): string {
  try {
    const parsed = JSON.parse(toolResultContent) as { diagnostic?: unknown; summary?: unknown };
    if (typeof parsed.diagnostic === 'string') return parsed.diagnostic;
    if (typeof parsed.summary === 'string') return parsed.summary;
  } catch {
    // plain text result
  }
  return toolResultContent.slice(0, 600);
}

function writesOwnScreen(tc: ToolCall, spec: SubagentTaskSpec): boolean {
  if (!SCREEN_WRITE_TOOLS.has(tc.name)) return false;
  const target = spec.screenId?.trim();
  if (!target) return true;
  const written = (tc.arguments as Record<string, unknown> | undefined)?.screenId;
  if (tc.name === 'edit_prototype_anchor' && (typeof written !== 'string' || !written.trim())) {
    return true;
  }
  return typeof written === 'string' && written.trim() === target;
}

function classifySubagentFailure(err: unknown, signal: AbortSignal): PrototypeBuildFailureCode {
  if (err instanceof ScreenNotFinishedError) return err.code;
  if (signal.aborted) return 'cancelled';
  const text = err instanceof Error ? err.message : String(err);
  // The run was not cancelled, so a stream that stopped on its own clock timed out.
  if (/timed?\s*out|timeout|aborted/i.test(text)) return 'timeout';
  return 'model_error';
}

export async function runParallelSubagents(
  options: RunParallelSubagentsOptions,
): Promise<{
  lanes: AgentSubagentLaneTrace[];
  inputTokens: number;
  outputTokens: number;
  allSucceeded: boolean;
  summaryText: string;
  screenResults: SubagentScreenResult[];
}> {
  const { tasks, concurrency, locale, signal } = options;
  const lastDiagnostics = new Map<number, string>();
  const nowIso = new Date().toISOString();

  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, tasks.length));
  const lanes: AgentSubagentLaneTrace[] = tasks.map((task, idx) => {
    const workerSlot = (idx % workerCount) + 1;
    const targetAnchor: PrototypeTargetAnchor | undefined = task.screenId?.trim()
      ? {
          screenId: task.screenId.trim(),
          ...(task.screenName?.trim()
            ? { label: task.screenName.trim() }
            : { label: task.title.trim() }),
        }
      : undefined;

    return {
      laneId: `sublane-${Date.now().toString(36)}-${idx + 1}`,
      workerIndex: workerSlot,
      workerLabel: defaultWorkerLabel(workerSlot, task.roleLabel),
      taskTitle: {
        zh: task.title.trim(),
        en: task.title.trim(),
      },
      ...(targetAnchor ? { targetAnchor } : {}),
      status: 'QUEUED',
      phase: 'QUEUED',
      cursorZone: 'header',
      liveAction: {
        zh: '等待空闲智能体接手…',
        en: 'Queued for next available worker…',
      },
      progressChars: 0,
      startedAt: nowIso,
    };
  });

  for (const lane of lanes) {
    options.onLaneUpdate({ ...lane }, stripHeavyFieldsForLiveSse(lanes));
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const runSingleTask = async (taskIdx: number, workerSlot: number): Promise<void> => {
    const spec = tasks[taskIdx]!;
    const lane = lanes[taskIdx]!;
    if (signal.aborted) {
      lane.status = 'FAILED';
      lane.phase = 'FAILED';
      lane.error = pickLocaleText(locale, '已取消', 'Cancelled');
      lane.completedAt = new Date().toISOString();
      options.onLaneUpdate({ ...lane }, stripHeavyFieldsForLiveSse(lanes));
      return;
    }

    if (options.requireScreen && !spec.screenId?.trim()) {
      lane.status = 'FAILED';
      lane.phase = 'FAILED';
      lane.failureCode = 'not_written';
      lane.error = pickLocaleText(
        locale,
        '原型施工里每个任务都要指定一屏（screenId），这个任务没有指定，没有执行。',
        'In a prototype build every task must name one screen (screenId); this task did not and was not run.',
      );
      lane.completedAt = new Date().toISOString();
      options.onLaneUpdate({ ...lane }, stripHeavyFieldsForLiveSse(lanes));
      return;
    }

    lane.workerIndex = workerSlot;
    lane.workerLabel = defaultWorkerLabel(workerSlot, spec.roleLabel);
    lane.status = 'RUNNING';
    lane.phase = 'THINKING';
    lane.cursorZone = 'header';
    lane.liveAction = {
      zh: '正在勘测画板网格与版式结构…',
      en: 'Inspecting artboard grid & layout…',
    };
    lane.startedAt = new Date().toISOString();
    options.onLaneUpdate({ ...lane }, stripHeavyFieldsForLiveSse(lanes));
    options.onActivity();

    try {
      const hasExplicitElementIds = /\bEL-[A-Za-z0-9_-]+/.test(spec.instruction);
      const idRuleZh = hasExplicitElementIds
        ? `2. 严格沿用上述要求中指定的 \`EL-*\` / \`EV-*\` 锚点 ID，确保所有 <button>/<input>/<select>/<textarea> 具备唯一 \`data-element-id\` 与合法 \`data-element-type\`，严禁使用 alert/confirm/prompt。`
        : `2. 所有 <button>/<input>/<select>/<textarea> 必须附带以 \`EL-${spec.screenId?.trim().replace(/[^A-Za-z0-9]/g, '') || 'SCR'}-\` 为前缀的全局唯一 \`data-element-id\` 与合法 \`data-element-type\`，严禁使用 alert/confirm/prompt。`;

      const subPrompt = spec.screenId?.trim()
        ? pickLocaleText(
            locale,
            [
              `你是并行专职子智能体（${lane.workerLabel.zh}），只负责构建 **1 个** 指定分屏，严禁重写其他屏幕：`,
              `- 目标分屏 ID: \`${spec.screenId.trim()}\``,
              `- 目标分屏名称: ${spec.screenName?.trim() || spec.title.trim()}`,
              `- 目标分屏类型: ${spec.screenType?.trim() || 'LIST'}`,
              `- 具体设计要求:\n${spec.instruction}`,
              ``,
              `极速流式出图要求（禁止冗长思考打草稿，思考请控制在 5 句话内直接落笔调用工具！）：`,
              `1. 立即调用 \`upsert_prototype_screen\` 流式输出该分屏的紧凑高保真 HTML（约 70～160 行，含真实业务数据与内联交互）。`,
              idRuleZh,
              `3. 若校验器报错，在同一轮内立即修正锚点重试。`,
            ].join('\n'),
            [
              `You are parallel specialist subagent (${lane.workerLabel.en}), responsible strictly for building **1** target screen:`,
              `- Target screenId: \`${spec.screenId.trim()}\``,
              `- Target screenName: ${spec.screenName?.trim() || spec.title.trim()}`,
              `- Target screenType: ${spec.screenType?.trim() || 'LIST'}`,
              `- Instructions:\n${spec.instruction}`,
              ``,
              `Keep reasoning brief (<5 sentences) and call \`upsert_prototype_screen\` immediately with clean HTML (~70-160 lines), unique \`data-element-id\`s, valid \`data-element-type\`s, and zero alert/confirm/prompt.`,
            ].join('\n'),
          )
        : spec.instruction;

      const ownScreenId = spec.screenId?.trim() ?? '';
      const context = ownScreenId ? options.screenContext?.(spec)?.trim() : undefined;
      const promptText = context ? `${subPrompt}\n\n${context}` : subPrompt;
      const images = ownScreenId ? (options.contextImages ?? []) : [];
      const subMessages: Message[] = [
        {
          role: 'user',
          content: images.length > 0 ? [{ type: 'text', text: promptText }, ...images] : promptText,
          timestamp: Date.now(),
        },
      ];
      // A screen helper gets only the screen-level tools; no helper ever gets a document-level one.
      const taskTools = ownScreenId
        ? screenHelperTools(options.subagentTools)
        : options.subagentTools.filter((t) => !DOCUMENT_LEVEL_TOOL_NAMES.has(t.name));

      let subThinking = '';
      let subText = '';
      let hadValidatorError = false;
      let ownWriteRejected = false;
      let lastEmitMs = 0;
      let lastPartialStreamLen = 0;

      const MAX_SUB_ROUNDS = 4;
      for (let round = 0; round < MAX_SUB_ROUNDS; round += 1) {
        if (signal.aborted) throw new Error('Subagent aborted');
        options.onActivity();

        const ctx: Context = {
          systemPrompt: options.baseSystemPrompt,
          messages: subMessages,
          tools: taskTools,
        };

        const stream = options.models.streamSimple(options.selectedModel, ctx, {
          signal,
          timeoutMs: options.stepTimeoutMs,
          temperature: 0.2,
          reasoning: 'low',
          maxTokens: options.maxTokens,
        });

        let finalMsg: AssistantMessage | undefined;
        let streamedArgChars = 0;

        for await (const ev of stream) {
          if (ev.type !== 'error') {
            options.onActivity();
          }
          if (ev.type === 'thinking_delta') {
            subThinking += ev.delta;
            if (lane.phase !== 'STREAMING') {
              lane.phase = 'THINKING';
              const sig = inferThinkingCursorSignal(subThinking, taskIdx);
              lane.cursorZone = sig.cursorZone;
              lane.liveAction = sig.liveAction;
            }
          } else if (ev.type === 'text_delta') {
            subText += ev.delta;
          } else if (ev.type === 'toolcall_delta') {
            streamedArgChars += ev.delta.length;
            const partialBlock = ev.partial.content[ev.contentIndex];
            if (
              partialBlock?.type === 'toolCall' &&
              partialBlock.name === 'upsert_prototype_screen'
            ) {
              lane.phase = 'STREAMING';
              const pArgs = (partialBlock.arguments ?? {}) as Record<string, unknown>;
              const partialHtml = typeof pArgs.screenHtml === 'string' ? pArgs.screenHtml : '';
              const extraCss = typeof pArgs.extraCss === 'string' ? pArgs.extraCss : undefined;
              const resolvedSid =
                (typeof pArgs.screenId === 'string' && pArgs.screenId.trim()) ||
                spec.screenId?.trim() ||
                '';
              const resolvedSname =
                (typeof pArgs.screenName === 'string' && pArgs.screenName.trim()) ||
                spec.screenName?.trim() ||
                spec.title.trim();
              const resolvedStype =
                (typeof pArgs.screenType === 'string' && pArgs.screenType.trim()) ||
                spec.screenType?.trim();

              if (partialHtml.length >= 24) {
                lane.streamedHtmlChars = partialHtml.length;
                const sig = extractLatestHtmlWritingSignal(partialHtml);
                lane.cursorZone = sig.cursorZone;
                lane.liveAction = sig.activeLabel
                  ? {
                      zh: `正在绘制 · ${sig.activeLabel}`,
                      en: `Painting · ${sig.activeLabel}`,
                    }
                  : {
                      zh: '正在实时写入界面区块…',
                      en: 'Streaming screen blocks…',
                    };
                const allowedStreamScreen = !ownScreenId || resolvedSid === ownScreenId;
                if (resolvedSid && allowedStreamScreen && partialHtml.length - lastPartialStreamLen >= 90) {
                  lastPartialStreamLen = partialHtml.length;
                  options.onPartialScreenStream?.(
                    {
                      screenId: resolvedSid,
                      screenName: resolvedSname,
                      ...(resolvedStype ? { screenType: resolvedStype } : {}),
                      partialScreenHtml: partialHtml,
                      ...(extraCss ? { extraCss } : {}),
                    },
                    { ...lane },
                  );
                }
              }
            }
          } else if (ev.type === 'done') {
            finalMsg = ev.message;
          } else if (ev.type === 'error') {
            throw new Error(ev.error.errorMessage || `Subagent stream failed (${ev.reason})`);
          }

          const now = Date.now();
          if (now - lastEmitMs >= 260) {
            lastEmitMs = now;
            lane.progressChars = subThinking.length + subText.length + streamedArgChars;
            const { thinking: _t, ...slimLane } = lane;
            options.onLaneUpdate(slimLane, stripHeavyFieldsForLiveSse(lanes));
          }
        }

        if (!finalMsg) break;
        if (finalMsg.stopReason === 'error' || finalMsg.errorMessage) {
          throw new Error(finalMsg.errorMessage || 'Subagent upstream error');
        }

        totalInputTokens += finalMsg.usage?.input ?? 0;
        totalOutputTokens += finalMsg.usage?.output ?? 0;
        subMessages.push(finalMsg);

        const toolCalls = finalMsg.content.filter(
          (b): b is ToolCall => b.type === 'toolCall',
        );
        if (toolCalls.length === 0) {
          break;
        }

        lane.phase = 'VALIDATING';
        lane.liveAction = {
          zh: '正在校验交互控件并保存分屏…',
          en: 'Validating controls & saving screen…',
        };
        const { thinking: _tv, ...slimValidating } = lane;
        options.onLaneUpdate(slimValidating, stripHeavyFieldsForLiveSse(lanes));

        let roundAllOk = true;
        for (const tc of toolCalls) {
          options.onActivity();
          // The runtime keeps a screen helper on its own screen, whatever the model asks for.
          const outOfScope = ownScreenId ? checkScreenHelperCall(tc, ownScreenId, locale) : null;
          const exec = outOfScope
            ? {
                isError: true,
                toolResultContent: JSON.stringify({ status: 'REJECTED_OUT_OF_SCOPE', diagnostic: outOfScope }),
              }
            : await options.executeSubagentToolCall(tc, lane, hadValidatorError);
          if (writesOwnScreen(tc, spec)) {
            if (exec.isError) {
              ownWriteRejected = true;
              lastDiagnostics.set(taskIdx, diagnosticOf(exec.toolResultContent));
            } else {
              lane.wroteScreen = true;
              lastDiagnostics.delete(taskIdx);
            }
          }
          if (exec.isError) {
            hadValidatorError = true;
            roundAllOk = false;
            lane.phase = 'THINKING';
            lane.liveAction = {
              zh: '正在自动修正控件属性…',
              en: 'Auto-repairing control attributes…',
            };
          }
          const tr: ToolResultMessage<JsonObject> = {
            role: 'toolResult',
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{ type: 'text', text: exec.toolResultContent }],
            isError: exec.isError,
            timestamp: Date.now(),
          };
          subMessages.push(tr);
        }

        // For focused screen subagents, once upsert_prototype_screen succeeds cleanly, no extra summary round is needed!
        if (
          spec.screenId?.trim() &&
          roundAllOk &&
          toolCalls.some((t) => t.name === 'upsert_prototype_screen')
        ) {
          break;
        }
      }

      lane.thinking = subThinking.slice(-4000);
      // A screen lane is finished only when its own screen was written and passed the check.
      if (spec.screenId?.trim() && !lane.wroteScreen) {
        // "Did not pass the check" only when this lane's own screen write was rejected.
        throw new ScreenNotFinishedError(ownWriteRejected ? 'validation_failed' : 'not_written');
      }
      lane.output =
        subText.trim() ||
        pickLocaleText(
          locale,
          `已完成「${spec.title}」`,
          `Completed "${spec.title}"`,
        );
      lane.progressChars = Math.max(lane.progressChars ?? 0, subThinking.length + subText.length);
      lane.status = 'DONE';
      lane.phase = 'DONE';
      lane.cursorZone = 'footer';
      lane.liveAction = {
        zh: '已完成绘制并落盘 ✓',
        en: 'Screen rendered & saved ✓',
      };
      lane.completedAt = new Date().toISOString();
      const { thinking: _td, ...slimDone } = lane;
      options.onLaneUpdate(slimDone, stripHeavyFieldsForLiveSse(lanes));
    } catch (err) {
      lane.status = 'FAILED';
      lane.phase = 'FAILED';
      lane.error = err instanceof Error ? err.message : String(err);
      lane.failureCode = classifySubagentFailure(err, signal);
      lane.completedAt = new Date().toISOString();
      const { thinking: _tf, ...slimFailed } = lane;
      options.onLaneUpdate(slimFailed, stripHeavyFieldsForLiveSse(lanes));
    }
  };

  // A shared pool: whichever helper is free picks up the next task (its owner from then on).
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async (_, idx) => {
    const workerSlot = idx + 1;
    while (cursor < tasks.length) {
      const myTaskIdx = cursor;
      cursor += 1;
      await runSingleTask(myTaskIdx, workerSlot);
    }
  });

  await Promise.all(workers);

  const succeededCount = lanes.filter((l) => l.status === 'DONE').length;
  const failedCount = lanes.filter((l) => l.status === 'FAILED').length;
  const summaryText = pickLocaleText(
    locale,
    `并行子智能体执行完毕：${succeededCount}/${lanes.length} 路成功${failedCount > 0 ? `，${failedCount} 路失败（已完成分屏均已落盘保留）` : ''}`,
    `Parallel subagents finished: ${succeededCount}/${lanes.length} succeeded${failedCount > 0 ? `, ${failedCount} failed (completed screens preserved)` : ''}`,
  );

  const screenResults: SubagentScreenResult[] = [];
  tasks.forEach((task, idx) => {
    const screenId = task.screenId?.trim();
    if (!screenId) return;
    const lane = lanes[idx]!;
    const diagnostic = lastDiagnostics.get(idx);
    screenResults.push({
      screenId,
      screenName: task.screenName?.trim() || task.title.trim(),
      status: lane.status === 'DONE' ? 'DONE' : 'FAILED',
      check: lane.status === 'DONE' ? 'passed' : lane.failureCode === 'validation_failed' ? 'failed' : 'not_written',
      ...(lane.status !== 'DONE' && lane.failureCode ? { failure: lane.failureCode } : {}),
      ...(lane.status !== 'DONE' && diagnostic ? { diagnostic } : {}),
    });
  });

  return {
    lanes,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    allSucceeded: failedCount === 0,
    summaryText,
    screenResults,
  };
}
