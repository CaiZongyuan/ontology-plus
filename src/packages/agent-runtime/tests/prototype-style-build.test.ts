import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type ImageContent,
  type Message,
} from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
  applyPrototypeBuildEvent,
  emptyPrototypeBuildState,
  readPrototypeDocumentStyle,
  splitPrototypeDocument,
  type PrototypeBuildEvent,
  type PrototypeBuildState,
} from '../../ontology-core/index.js';
import { createWorkspaceStore, type DesignBrief } from '../../workspace-store/index.js';
import {
  DOCUMENT_LEVEL_TOOL_NAMES,
  buildScreenHelperContext,
  collectUnifiedAgentTurn,
  getToolsForAgentKind,
  initPrototypeShell,
  keepWithinOwnScreen,
  prototypeDesignGuide,
  prototypeLeadStyleInstructions,
  runParallelSubagents,
  screenHelperSystemPrompt,
  type UnifiedAgentSseEvent,
} from '../index.js';

const BUILD_EVENTS = new Set([
  'prototype_build_start',
  'prototype_plan',
  'prototype_build_screen',
  'prototype_phase',
  'prototype_build_log',
]);

function foldBuild(events: UnifiedAgentSseEvent[]): PrototypeBuildState {
  return events
    .filter((e) => BUILD_EVENTS.has(e.event))
    .map((e) => e.data as unknown as PrototypeBuildEvent)
    .reduce(applyPrototypeBuildEvent, emptyPrototypeBuildState());
}

const APPROVED_BRIEF: DesignBrief = {
  items: [{ id: 'b1', category: 'tone', statement: '冷静、专业的运营后台' }],
  userFeelNote: '要像真的门店系统',
  primaryReferenceTitle: '门店运营台',
  styleValues: {
    mode: 'light',
    background: '#f4f6f2',
    surface: '#ffffff',
    inset: '#e9ece6',
    accent: '#1f4e79',
    accentInk: '#ffffff',
    border: '#d5dbd0',
    ink: '#141a14',
    mutedInk: '#56605a',
    ok: '#2f7d4f',
    warn: '#9a5b12',
    danger: '#a3322b',
    fontFamily: "'Source Han Sans SC', sans-serif",
    radiusPx: 6,
    density: 'compact',
  },
  approvedAt: '2026-11-19T00:00:00.000Z',
  updatedAt: '2026-11-19T00:00:00.000Z',
};

async function mockBuild(designBrief?: DesignBrief, tokensPerSecond?: number) {
  // Slow enough that the style's arguments arrive over several 150 ms updates.
  const before = process.env.ONTOLOGY_MOCK_TOKENS_PER_SECOND;
  if (tokensPerSecond) process.env.ONTOLOGY_MOCK_TOKENS_PER_SECOND = String(tokensPerSecond);
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  store.updateSystemSettings({ mockLlmMode: true });
  const session = store.createAgentSession({
    projectId: 'proj-contract',
    agentKind: 'PROTOTYPE_CO_DESIGN',
    title: '风格样张原型',
  });
  const turn = await collectUnifiedAgentTurn(store, {
    sessionId: session.id,
    prompt: '按已确认的需求生成首版原型',
    prototypeName: '风格样张原型',
    mockMode: true,
    ...(designBrief ? { designBrief } : {}),
  }).finally(() => {
    if (before === undefined) delete process.env.ONTOLOGY_MOCK_TOKENS_PER_SECOND;
    else process.env.ONTOLOGY_MOCK_TOKENS_PER_SECOND = before;
  });
  const proto = store.listPrototypes(session.projectId).find((p) => p.id === turn.session.targetId)!;
  return { store, turn, html: proto.htmlContent };
}

describe('风格样张 (#91): the lead draws the shared look first, live, on the first artboard', () => {
  it('streams define_style onto the style artboard and finishes the phase before any screen is written', async () => {
    const { turn, html } = await mockBuild(undefined, 4000);
    const events = turn.events;
    expect(events.some((e) => e.event === 'run_error')).toBe(false);

    const styleEvents = events.filter((e) => e.event === 'prototype_style');
    const streaming = styleEvents.filter((e) => e.data.status === 'streaming');
    expect(streaming.length).toBeGreaterThan(1);
    // The samples grow while the arguments stream: the artboard is drawn piece by piece.
    const sizes = streaming.map((e) => String(e.data.sampleHtml).length);
    expect(sizes[0]).toBeLessThan(sizes.at(-1)!);
    expect(styleEvents.at(-1)!.data.status).toBe('ready');

    const styleDone = events.findIndex((e) => e.event === 'prototype_phase' && e.data.phase === 'style' && e.data.status === 'done');
    const firstWriting = events.findIndex(
      (e) => e.event === 'prototype_build_screen' && (e.data.screen as { status: string }).status === 'writing',
    );
    const firstStyle = events.indexOf(streaming[0]!);
    const planDone = events.findIndex((e) => e.event === 'prototype_phase' && e.data.phase === 'plan' && e.data.status === 'done');
    expect(planDone).toBeLessThan(firstStyle);
    expect(styleDone).toBeGreaterThan(firstStyle);
    expect(styleDone).toBeLessThan(firstWriting);

    const build = foldBuild(events);
    expect(build.phases.style.status).toBe('done');
    expect(build.log.find((l) => l.kind === 'style_ready')).toMatchObject({ agent: 0, locked: false });

    // The saved document carries the style (values, components, samples) — no hard-coded look.
    const style = readPrototypeDocumentStyle(html)!;
    expect(style.css).toContain('--proto-accent: #2e6a4e');
    expect(style.css).toContain('.btn.primary');
    expect(style.sampleHtml).toContain('提交订单');
    for (const part of ['button', 'card', 'table', 'input', 'tag', 'empty']) expect(style.sampleHtml).toContain(part);
    expect(html).not.toMatch(/#f94c05|max-width:\s*1380px|proto-nav-tab/);
    // The samples are not a screen.
    expect(splitPrototypeDocument(html).screens.map((s) => s.screenId)).not.toContain('style-tile');
  });

  it('keeps the approved Style Tile values whatever the lead proposes', async () => {
    const { turn, html } = await mockBuild(APPROVED_BRIEF);
    const style = readPrototypeDocumentStyle(html)!;
    expect(style.locked).toBe(true);
    expect(style.css).toContain('--proto-accent: #1f4e79');
    expect(style.css).toContain('--proto-radius: 6px');
    expect(style.css).not.toContain('#2e6a4e');
    // Even the first streamed update already used the approved values.
    const firstStyle = turn.events.find((e) => e.event === 'prototype_style')!;
    expect(String(firstStyle.data.css)).toContain('--proto-accent: #1f4e79');
    // The lead is told which of its values were overridden.
    const result = turn.events.find(
      (e) => e.event === 'tool_result' && (e.data.trace as { toolName: string }).toolName === 'define_style',
    )!;
    expect((result.data.trace as { isError: boolean }).isError).toBe(false);
    expect(foldBuild(turn.events).log.find((l) => l.kind === 'style_ready')).toMatchObject({ locked: true });
  });

  it('gives the lead each screen’s own check result, not just a summary', async () => {
    const { turn } = await mockBuild();
    // The recorded lead closes from the spawn result it got: it names the failed screen and why,
    // which it could only know from a per-screen result.
    const closing = turn.session.messages.filter((m) => m.role === 'assistant').at(-1)!.content;
    expect(closing).toContain('原型画好了 4 屏');
    expect(closing).toContain('「退款审批」没画完：这一屏有按钮或输入框没有标注好，没能通过检查。');
  });
});

describe('Screen helpers (#91): a full design context, only their own screen', () => {
  /** What a provider sees: tools and instructions travel in system messages. */
  interface Seen {
    tools: string[];
    systemPrompt: string;
    messages: Message[];
  }
  function seen(messages: Message[]): Seen {
    const system = messages.filter((m): m is Extract<Message, { role: 'system' }> => m.role === 'system');
    return {
      tools: system.flatMap((m) => (m.toolsAdded ?? []).map((t) => t.name)),
      systemPrompt: system
        .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((c) => c.text).join('')))
        .join('\n'),
      messages: messages.filter((m) => m.role !== 'system'),
    };
  }
  function fauxModels(reply: (round: number) => ReturnType<typeof fauxAssistantMessage>) {
    const faux = fauxProvider({
      provider: 'faux-test',
      models: [{ id: 'faux-test', name: 'Faux', input: ['text', 'image'], reasoning: false, contextWindow: 8000, maxTokens: 2000 }],
      tokensPerSecond: 100000,
    });
    let round = 0;
    const contexts: Seen[] = [];
    faux.setResponses(
      Array.from({ length: 8 }, () => (ctx: { messages: Message[] }) => {
        contexts.push(seen(ctx.messages));
        return reply(round++);
      }),
    );
    const models = createModels();
    models.setProvider(faux.provider);
    return { models, model: faux.getModel()!, contexts };
  }

  const IMAGE: ImageContent = { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' };

  it('the helper’s tool set has no document-level tool, and its first message carries the whole design context', async () => {
    const { models, model, contexts } = fauxModels(() =>
      fauxAssistantMessage([fauxToolCall('upsert_prototype_screen', { screenId: 'SCR-REFUND', screenHtml: '<p>退款</p>' })], {
        stopReason: 'toolUse',
      }),
    );
    const leadTools = getToolsForAgentKind('PROTOTYPE_CO_DESIGN', { codeMode: true, multiAgentConcurrency: 3 });
    // Even handed every tool the lead has, a screen helper only sees the screen-level ones.
    const context = buildScreenHelperContext({
      locale: 'zh-CN',
      screenId: 'SCR-REFUND',
      plan: [
        { screenId: 'SCR-REFUND', screenName: '退款审批', purpose: '店长审批退款' },
        { screenId: 'SCR-ORDERS', screenName: '订货单列表', purpose: '查订单' },
      ],
      style: { css: ':root { --proto-accent: #1f4e79; }\n.btn { color: var(--proto-accent); }', sampleHtml: '<button class="btn">提交订单</button>', direction: '冷静的运营后台', locked: true },
      designBrief: APPROVED_BRIEF,
      requirements: { title: '门店订货需求', content: '店长可以审批退款。' },
      referenceLines: ['- [Image #1] 门店运营台'],
    });
    await runParallelSubagents({
      tasks: [{ title: '退款审批', screenId: 'SCR-REFUND', screenName: '退款审批', instruction: '批退款' }],
      concurrency: 1,
      locale: 'zh-CN',
      models,
      selectedModel: model,
      baseSystemPrompt: screenHelperSystemPrompt('zh-CN'),
      subagentTools: leadTools,
      screenContext: () => context,
      contextImages: [IMAGE],
      signal: new AbortController().signal,
      stepTimeoutMs: 10_000,
      maxTokens: 2000,
      onActivity: () => undefined,
      onLaneUpdate: () => undefined,
      executeSubagentToolCall: async () => ({ toolResultContent: '{"status":"APPLIED"}', isError: false }),
    });
    const helper = contexts[0]!;
    const names = [...helper.tools].sort();
    expect(names).toEqual(['edit_prototype_anchor', 'read_prototype_anchor', 'upsert_prototype_screen']);
    for (const docTool of DOCUMENT_LEVEL_TOOL_NAMES) expect(names).not.toContain(docTool);
    expect(names).not.toContain('init_prototype_shell');
    expect(names).not.toContain('rewrite_prototype_page');

    const first = helper.messages[0]!;
    expect(first.role).toBe('user');
    const blocks = (first as { content: unknown }).content as { type: string; text?: string }[];
    expect(blocks.some((b) => b.type === 'image')).toBe(true);
    const text = blocks.find((b) => b.type === 'text')!.text!;
    expect(text).toMatch(/^你是并行专职子智能体/);
    expect(text).toContain('冷静、专业的运营后台'); // the Design Brief
    expect(text).toContain('--proto-accent: #1f4e79'); // the design values
    expect(text).toContain('.btn { color: var(--proto-accent); }'); // the shared components
    expect(text).toContain('<button class="btn">提交订单</button>'); // component examples
    expect(text).toContain('门店运营台'); // Visual References
    expect(text).toContain('店长可以审批退款'); // requirements summary
    expect(text).toContain('SCR-ORDERS · 订货单列表'); // the other screens, to link to
    // The helper's own screen is the first quoted screen id.
    expect(/`(SCR-[A-Za-z0-9_-]+)`/.exec(text)![1]).toBe('SCR-REFUND');
    expect(helper.systemPrompt).toContain('设计守则');
    expect(helper.systemPrompt).not.toContain('plan_screens');
  });

  it('the runtime rejects document-level tools and writes to other screens; they never run', async () => {
    const { models, model } = fauxModels((round) =>
      round === 0
        ? fauxAssistantMessage(
            [
              fauxToolCall('init_prototype_shell', { appTitle: 'x', screens: [{ screenId: 'SCR-X', screenName: 'x', screenType: 'LIST' }] }),
              fauxToolCall('rewrite_prototype_page', { htmlContent: '<html></html>', allowAnchorReset: true }),
              fauxToolCall('upsert_prototype_screen', { screenId: 'SCR-ORDERS', screenHtml: '<p>别人的屏</p>' }),
              fauxToolCall('edit_prototype_anchor', { screenId: 'SCR-ORDERS', operation: 'append_to_screen', htmlFragment: '<p>x</p>' }),
            ],
            { stopReason: 'toolUse' },
          )
        : round === 1
          ? fauxAssistantMessage([fauxToolCall('upsert_prototype_screen', { screenId: 'SCR-REFUND', screenHtml: '<p>退款</p>' })], {
              stopReason: 'toolUse',
            })
          : fauxAssistantMessage([fauxText('好了。')]),
    );
    const executed: string[] = [];
    const res = await runParallelSubagents({
      tasks: [{ title: '退款审批', screenId: 'SCR-REFUND', screenName: '退款审批', instruction: '批退款' }],
      concurrency: 1,
      locale: 'zh-CN',
      models,
      selectedModel: model,
      baseSystemPrompt: '',
      subagentTools: getToolsForAgentKind('PROTOTYPE_CO_DESIGN', { codeMode: true, multiAgentConcurrency: 3 }),
      signal: new AbortController().signal,
      stepTimeoutMs: 10_000,
      maxTokens: 2000,
      onActivity: () => undefined,
      onLaneUpdate: () => undefined,
      executeSubagentToolCall: async (tc) => {
        executed.push(`${tc.name}:${String((tc.arguments as { screenId?: string }).screenId ?? '')}`);
        return { toolResultContent: '{"status":"APPLIED"}', isError: false };
      },
    });
    expect(executed).toEqual(['upsert_prototype_screen:SCR-REFUND']);
    expect(res.lanes[0]).toMatchObject({ status: 'DONE', wroteScreen: true });
    expect(res.screenResults).toEqual([
      { screenId: 'SCR-REFUND', screenName: '退款审批', status: 'DONE', check: 'passed' },
    ]);
  });

  it('a screen whose every write fails the check is failed, and the lead gets the validator’s diagnostic', async () => {
    const { models, model } = fauxModels((round) =>
      round === 0
        ? fauxAssistantMessage([fauxToolCall('upsert_prototype_screen', { screenId: 'SCR-REFUND', screenHtml: '<button>驳回</button>' })], {
            stopReason: 'toolUse',
          })
        : fauxAssistantMessage([fauxText('先停下。')]),
    );
    const res = await runParallelSubagents({
      tasks: [{ title: '退款审批', screenId: 'SCR-REFUND', screenName: '退款审批', instruction: '批退款' }],
      concurrency: 1,
      locale: 'zh-CN',
      models,
      selectedModel: model,
      baseSystemPrompt: '',
      subagentTools: [],
      signal: new AbortController().signal,
      stepTimeoutMs: 10_000,
      maxTokens: 2000,
      onActivity: () => undefined,
      onLaneUpdate: () => undefined,
      executeSubagentToolCall: async () => ({
        toolResultContent: JSON.stringify({ status: 'REJECTED_BY_ANCHOR_VALIDATOR', diagnostic: '「驳回」按钮缺少 data-element-id' }),
        isError: true,
      }),
    });
    expect(res.screenResults).toEqual([
      {
        screenId: 'SCR-REFUND',
        screenName: '退款审批',
        status: 'FAILED',
        check: 'failed',
        failure: 'validation_failed',
        diagnostic: '「驳回」按钮缺少 data-element-id',
      },
    ]);
  });

  it('an edit that reaches another screen is undone with a diagnostic', () => {
    const doc = initPrototypeShell(
      {
        appTitle: '订货',
        screens: [
          { screenId: 'SCR-A', screenName: '首页', screenType: 'LIST' },
          { screenId: 'SCR-B', screenName: '订单', screenType: 'LIST' },
        ],
      },
      { locale: 'zh-CN' },
    ).nextHtml;
    const touchedB = doc.replace(/(<section[^>]*data-screen-id="SCR-B"[^>]*>)/, '$1<p>改了别人的屏</p>');
    const undone = keepWithinOwnScreen(doc, touchedB, 'SCR-A', 'zh-CN');
    expect(undone.html).toBe(doc);
    expect(undone.diagnostic).toContain('订单');
    const ownEdit = doc.replace(/(<section[^>]*data-screen-id="SCR-A"[^>]*>)/, '$1<p>自己的屏</p>');
    expect(keepWithinOwnScreen(doc, ownEdit, 'SCR-A', 'zh-CN')).toEqual({ html: ownEdit, diagnostic: null });
  });
});

describe('The shell is a skeleton (#91): its look comes from the style', () => {
  it('has no hard-coded orange, tab look or fixed page width', () => {
    const html = initPrototypeShell(
      { appTitle: '订货', screens: [{ screenId: 'SCR-A', screenName: '首页', screenType: 'LIST' }] },
      { locale: 'zh-CN' },
    ).nextHtml;
    expect(html).not.toMatch(/#f94c05|max-width:\s*1380px|proto-nav-tab|proto-topbar/);
    expect(readPrototypeDocumentStyle(html)).not.toBeNull();
    // Everything visual is a style variable.
    const shellCss = /<style id="proto-shell-styles">([\s\S]*?)<\/style>/.exec(html)![1]!;
    expect(shellCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('The design guide (#91) in the lead’s and the helpers’ instructions', () => {
  it('orders values, components, screens; one direction; no AI clichés; realistic content; adaptive width', () => {
    const zh = prototypeDesignGuide('zh-CN');
    expect(zh).toMatch(/先设计值，后组件，再屏幕/);
    expect(zh).toMatch(/只走一种视觉方向/);
    expect(zh).toMatch(/俗套/);
    expect(zh).toMatch(/内容要像真的/);
    expect(zh).toMatch(/宽度自适应/);
    const en = prototypeDesignGuide('en-US');
    expect(en).toMatch(/Values first, then components, then screens/);
    expect(en).toMatch(/One visual direction/);
    expect(en).toMatch(/clichés/);
    expect(en).toMatch(/Realistic content/);
    // Embedded verbatim in both places, so they cannot drift apart.
    expect(screenHelperSystemPrompt('zh-CN')).toContain(zh);
    expect(prototypeLeadStyleInstructions('zh-CN', null)).toContain(zh);
  });

  it('tells the lead the approved values are locked, or asks it to propose a full set', () => {
    const locked = prototypeLeadStyleInstructions('zh-CN', APPROVED_BRIEF.styleValues!);
    expect(locked).toContain('锁定');
    expect(locked).toContain('#1f4e79');
    expect(prototypeLeadStyleInstructions('en-US', null)).toMatch(/propose a complete set of values/);
  });
});
