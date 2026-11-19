import http from 'node:http';
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
  applyPrototypeLiveEvent,
  buildPrototypeCanvasModel,
  emptyPrototypeBuildState,
  emptyPrototypeLiveState,
  readPrototypeDocumentStyle,
  splitPrototypeDocument,
  type PrototypeBuildEvent,
  type PrototypeBuildState,
  type PrototypeLiveEvent,
} from '../../ontology-core/index.js';
import {
  CURATED_INSPO_CATALOG,
  approvedBriefStyleValues,
  createWorkspaceStore,
  type DesignBrief,
} from '../../workspace-store/index.js';
import {
  DOCUMENT_LEVEL_TOOL_NAMES,
  buildScreenHelperContext,
  collectUnifiedAgentTurn,
  commitDefineStyle,
  editPrototypeAnchor,
  getToolsForAgentKind,
  initPrototypeShell,
  keepWithinOwnScreen,
  prototypeDesignGuide,
  prototypeLeadStyleInstructions,
  runParallelSubagents,
  screenHelperSystemPrompt,
  upsertPrototypeScreen,
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

describe('Repair audit (#91): S1–S5 & PM decisions P3–P6', () => {
  it('S1/S2/P1/P3: scopes own-screen extraCss cleanly, replaces data-screen-css on re-upsert, and blocks CSS/HTML/JS escapes', () => {
    const shell = initPrototypeShell(
      {
        appTitle: '订货',
        screens: [
          { screenId: 'SCR-A', screenName: '首页', screenType: 'DASHBOARD' },
          { screenId: 'SCR-B', screenName: '订单', screenType: 'LIST' },
        ],
      },
      { locale: 'zh-CN' },
    ).nextHtml;

    // S1: extraCss targeting page, shell (current or legacy), other screens, or sibling combinators is rejected.
    for (const badCss of [
      'body { background: red; }',
      '.proto-app-bar { display: none; }',
      '.proto-topbar { display: none; }',
      '[data-screen-id="SCR-B"] .row { color: red; }',
      '[data-screen-id="SCR-A"] ~ section { display: none; }',
      '#screen-SCR-A + .proto-screen { opacity: 0; }',
      '[data-screen-id] { border: 2px solid red; }',
    ]) {
      const bad = upsertPrototypeScreen(shell, {
        screenId: 'SCR-A',
        screenHtml: '<p>首页</p>',
        extraCss: badCss,
      });
      expect(bad.isError).toBe(true);
    }

    // S2 + P1 + P3: legitimate own-screen extraCss succeeds, scopes to SCR-A, strips --proto-* overrides,
    // is accepted by keepWithinOwnScreen, and replaces cleanly on re-upsert.
    const firstWrite = upsertPrototypeScreen(shell, {
      screenId: 'SCR-A',
      screenHtml:
        '<style>body { background: #000 !important; }</style><div class="kpi-grid" style="--proto-accent: #ff0000; gap: 12px"><button data-element-id="EL-A-1" data-element-type="BUTTON">新建</button></div>',
      extraCss: [
        '.kpi-grid, .summary-strip { display: grid; --proto-accent: #ff0000; gap: var(--proto-gap); }',
        '@media (max-width: 760px) { .kpi-grid { grid-template-columns: 1fr; } }',
      ].join('\n'),
      extraJs: 'const label = "</script><section data-screen-id=\\"SCR-B\\">hack</section>"; void screen; void label;',
    });
    expect(firstWrite.isError).toBe(false);
    expect(firstWrite.nextHtml).toContain('<style data-screen-css="SCR-A">');
    expect(firstWrite.nextHtml).toContain('[data-screen-id="SCR-A"] .kpi-grid');
    expect(firstWrite.nextHtml).not.toContain('#ff0000');
    expect(firstWrite.nextHtml).not.toContain('background: #000');
    // </script> inside extraJs was neutralized so it never broke out of the script element or touched SCR-B.
    expect(keepWithinOwnScreen(shell, firstWrite.nextHtml, 'SCR-A', 'zh-CN')).toEqual({
      html: firstWrite.nextHtml,
      diagnostic: null,
    });

    const secondWrite = upsertPrototypeScreen(firstWrite.nextHtml, {
      screenId: 'SCR-A',
      screenHtml: '<div class="kpi-grid"><button data-element-id="EL-A-1" data-element-type="BUTTON">新建</button></div>',
      extraCss: '.kpi-grid { gap: 8px; }',
    });
    expect(secondWrite.isError).toBe(false);
    expect(secondWrite.nextHtml.match(/data-screen-css="SCR-A"/g)).toHaveLength(1);
    expect(secondWrite.nextHtml).not.toContain('summary-strip');

    // S1: editPrototypeAnchor strips inline --proto-* overrides and <style>, and keepWithinOwnScreen undoes shell edits.
    const shellTabEdit = editPrototypeAnchor(secondWrite.nextHtml, {
      elementId: 'EL-SHELL-TAB-SCR-A',
      operation: 'update_attributes',
      attributes: { class: 'hacked-tab', style: '--proto-accent: #ff00ff; font-weight: 700' },
    });
    expect(shellTabEdit.isError).toBe(false);
    expect(shellTabEdit.nextHtml).not.toContain('#ff00ff');
    const reverted = keepWithinOwnScreen(secondWrite.nextHtml, shellTabEdit.nextHtml, 'SCR-A', 'zh-CN');
    expect(reverted.html).toBe(secondWrite.nextHtml);
    expect(reverted.diagnostic).toContain('外壳、导航或风格');
  });

  it('S3: requireScreen rejects spawn_subagents tasks missing screenId without invoking the model', async () => {
    let modelCalls = 0;
    const faux = fauxProvider({
      provider: 'faux-s3',
      models: [{ id: 'faux-s3', name: 'Faux', input: ['text'], reasoning: false, contextWindow: 8000, maxTokens: 2000 }],
      tokensPerSecond: 100000,
    });
    faux.setResponses([
      () => {
        modelCalls += 1;
        return fauxAssistantMessage([fauxText('should never run')]);
      },
    ]);
    const models = createModels();
    models.setProvider(faux.provider);

    const res = await runParallelSubagents({
      tasks: [{ title: '无屏号任务', instruction: '随便改整页' }],
      concurrency: 2,
      locale: 'en-US',
      models,
      selectedModel: faux.getModel()!,
      baseSystemPrompt: '',
      subagentTools: [],
      requireScreen: true,
      signal: new AbortController().signal,
      stepTimeoutMs: 5_000,
      maxTokens: 1000,
      onActivity: () => undefined,
      onLaneUpdate: () => undefined,
      executeSubagentToolCall: async () => ({ toolResultContent: '{}', isError: false }),
    });
    expect(modelCalls).toBe(0);
    expect(res.allSucceeded).toBe(false);
    expect(res.lanes[0]).toMatchObject({ status: 'FAILED', failureCode: 'not_written' });
    expect(res.lanes[0]!.error).toContain('screenId');
  });

  it('S4: commitDefineStyle rejects window.alert / confirm / prompt in CSS or sampleHtml', () => {
    const badSample = commitDefineStyle(
      {
        direction: '清爽',
        values: {},
        componentCss: '.btn { padding: 8px; }',
        sampleHtml: '<button class="btn" onclick="window.confirm(\'sure?\')">确认</button>',
      },
      null,
      'en-US',
    );
    expect(badSample.isError).toBe(true);
    expect(badSample.summary).toContain('alert/confirm/prompt');

    const badCss = commitDefineStyle(
      {
        direction: '清爽',
        values: {},
        componentCss: '/* alert(1) */ .btn { padding: 8px; }',
        sampleHtml: '<button class="btn">确认</button>',
      },
      null,
      'zh-CN',
    );
    expect(badCss.isError).toBe(true);
    expect(badCss.summary).toContain('alert/confirm/prompt');
  });

  it('P4/P5/P6/S5: end-to-end engine handles pre-#91 brief derivation & unavailable fallback, rejected restyles, helper references, and user value changes', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: false });

    // Minimal valid 1x1 PNG for testing real HTTP vision attachment resolution on follow-up turns.
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const seenBodies: { messages: unknown[] }[] = [];
    const scriptedReplies: {
      toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
      text?: string;
    }[] = [];

    const server = http.createServer(async (req, res) => {
      if (req.url === '/ref.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(pngBytes);
        return;
      }
      const chunks: Buffer[] = [];
      for await (const ch of req) chunks.push(Buffer.from(ch));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages: unknown[] };
      seenBodies.push(body);

      const next = scriptedReplies.shift() ?? { text: '完成。' };
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
      if (next.toolCalls && next.toolCalls.length > 0) {
        const chunk = {
          id: `cmpl-${seenBodies.length}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'test-vision-model',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: next.toolCalls.map((tc, index) => ({
                  index,
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                })),
              },
              finish_reason: 'tool_calls',
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      } else {
        const chunk = {
          id: `cmpl-${seenBodies.length}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'test-vision-model',
          choices: [{ index: 0, delta: { role: 'assistant', content: next.text ?? '完成。' }, finish_reason: 'stop' }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      for (const p of store.listLlmProviders()) store.saveLlmProvider({ ...p, enabled: false });
      const setVisionProvider = (supportsVision: boolean) => {
        store.saveLlmProvider({
          id: 'llm-test-91',
          name: 'Test 91 Gateway',
          providerType: 'OPENAI_COMPATIBLE',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: 'test-key',
          defaultModel: 'test-vision-model',
          availableModels: ['test-vision-model'],
          supportsVision,
          enabled: true,
        });
      };
      setVisionProvider(true);

      // ── 1) P4 unavailable-reference fallback: logs style_lock_unavailable and runs unlocked ──
      const unavailSession = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'PROTOTYPE_CO_DESIGN',
        title: 'P4 Unavailable Lock',
      });
      scriptedReplies.push(
        {
          toolCalls: [
            {
              id: 'tc-plan-u',
              name: 'plan_screens',
              args: { screens: [{ screenId: 'SCR-A', screenName: '首页', purpose: '总览', screenType: 'DASHBOARD' }] },
            },
            {
              id: 'tc-style-u',
              name: 'define_style',
              args: {
                direction: '助手自定深青色',
                values: { accent: '#0f766e' },
                componentCss: '.card { padding: var(--proto-pad); }',
                sampleHtml: '<div class="card">样张</div>',
              },
            },
            {
              id: 'tc-scr-u',
              name: 'upsert_prototype_screen',
              args: {
                screenId: 'SCR-A',
                screenName: '首页',
                screenHtml: '<div class="card"><button data-element-id="EL-U1" data-element-type="BUTTON">查看</button></div>',
              },
            },
          ],
        },
        { text: '已生成。' },
      );
      const unavailTurn = await collectUnifiedAgentTurn(store, {
        sessionId: unavailSession.id,
        prompt: '生成首版原型',
        mockMode: false,
        designBrief: {
          items: [],
          primaryReferenceId: 'removed-catalog-slug',
          approvedAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      });
      const unavailBuild = foldBuild(unavailTurn.events);
      expect(unavailBuild.log.some((l) => l.kind === 'style_lock_unavailable')).toBe(true);
      expect(unavailBuild.log.find((l) => l.kind === 'style_ready')).toMatchObject({ locked: false });
      const unavailProto = store.getPrototype(unavailTurn.session.targetId!)!;
      expect(readPrototypeDocumentStyle(unavailProto.htmlContent)!.css).toContain('--proto-accent: #0f766e');

      // ── 2) P4 derived lock + P6 non-bypass on compiled Design Brief submission ──
      const primaryRef = CURATED_INSPO_CATALOG[0]!;
      const derivedExpected = approvedBriefStyleValues({
        items: [],
        primaryReferenceId: primaryRef.slug,
        approvedAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
      expect(derivedExpected.values).not.toBeNull();
      const lockedAccent = derivedExpected.values!.accent;

      const mainSession = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'PROTOTYPE_CO_DESIGN',
        title: 'P4/P5/P6/S5 Full Lifecycle',
      });
      const legacyBriefWithRefImage: DesignBrief = {
        items: [{ id: 'i1', category: 'tone', statement: '稳重清晰' }],
        primaryReferenceId: primaryRef.slug,
        userImageRefs: [
          {
            id: 'user-ref-1',
            name: '门店现场图.png',
            mimeType: 'image/png',
            source: 'remote',
            remoteUrl: `http://127.0.0.1:${port}/ref.png`,
            role: 'user_upload',
          },
        ],
        approvedAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      };

      // Turn 1: compiled wizard prompt contains "主强调色"; model tries quoting it to bypass lock -> MUST fail to bypass!
      scriptedReplies.push(
        {
          toolCalls: [
            {
              id: 'tc-plan-1',
              name: 'plan_screens',
              args: { screens: [{ screenId: 'SCR-A', screenName: '首页', purpose: '总览', screenType: 'DASHBOARD' }] },
            },
            {
              id: 'tc-style-1',
              name: 'define_style',
              args: {
                direction: '稳重原版样张',
                values: { accent: '#ff0000' },
                userRequested: { keys: ['accent'], quote: '主强调色' },
                componentCss: '.card { padding: var(--proto-pad); }',
                sampleHtml: '<section class="card">原版风格样张</section>',
              },
            },
            {
              id: 'tc-scr-1',
              name: 'upsert_prototype_screen',
              args: {
                screenId: 'SCR-A',
                screenName: '首页',
                screenHtml: '<div class="card"><button data-element-id="EL-A1" data-element-type="BUTTON">订货</button></div>',
              },
            },
          ],
        },
        { text: '首版完成。' },
      );

      const turn1 = await collectUnifiedAgentTurn(store, {
        sessionId: mainSession.id,
        prompt: `【已确认设计简报 · 生成首版可交互原型 Revision #1】\n风格样张核心令牌：主强调色 ${lockedAccent}`,
        mockMode: false,
        designBrief: legacyBriefWithRefImage,
      });
      const protoId = turn1.session.targetId!;
      const protoAfterT1 = store.getPrototype(protoId)!;
      expect(readPrototypeDocumentStyle(protoAfterT1.htmlContent)!.locked).toBe(true);
      expect(readPrototypeDocumentStyle(protoAfterT1.htmlContent)!.css).toContain(`--proto-accent: ${lockedAccent}`);
      expect(readPrototypeDocumentStyle(protoAfterT1.htmlContent)!.css).not.toContain('#ff0000');
      expect(foldBuild(turn1.events).log.some((l) => l.kind === 'style_values_changed')).toBe(false);

      // ── 3) S5: rejected define_style restyle on Turn 2 restores Turn 1's style artboard ──
      scriptedReplies.push(
        {
          toolCalls: [
            {
              id: 'tc-style-bad',
              name: 'define_style',
              args: {
                direction: '坏掉的样张',
                values: {},
                componentCss: '.card { padding: 8px; }',
                sampleHtml: '<button onclick="alert(1)">违规弹窗</button>',
              },
            },
          ],
        },
        { text: '未改动。' },
      );
      const turn2Rejected = await collectUnifiedAgentTurn(store, {
        sessionId: mainSession.id,
        prompt: '微调组件样张',
        mockMode: false,
      });
      const liveEventsT2 = turn2Rejected.events
        .filter((e) => e.event === 'prototype_style' || e.event === 'prototype_frame' || e.event === 'prototype_screen')
        .map((e) => e.data as unknown as PrototypeLiveEvent);
      const foldedLiveT2 = liveEventsT2.reduce(applyPrototypeLiveEvent, emptyPrototypeLiveState());
      const modelAfterReject = buildPrototypeCanvasModel(store.getPrototype(protoId)!.htmlContent, foldedLiveT2);
      expect(modelAfterReject.style).toBeDefined();
      expect(modelAfterReject.style!.bodyHtml).toContain('原版风格样张');

      // ── 4) P6: explicit user chat request changes accent, logs style_values_changed & persists to store ──
      // Notice: NO plan_screens call in this restyle turn!
      scriptedReplies.push(
        {
          toolCalls: [
            {
              id: 'tc-style-p6',
              name: 'define_style',
              args: {
                direction: '深蓝专业版',
                values: { accent: '#1e3a8a' },
                userRequested: { keys: ['accent'], quote: '把主色改成深蓝' },
                componentCss: '.card { padding: var(--proto-pad); }',
                sampleHtml: '<section class="card">深蓝风格样张</section>',
              },
            },
          ],
        },
        { text: '已按要求把主色改成深蓝。' },
      );
      const turn3P6 = await collectUnifiedAgentTurn(store, {
        sessionId: mainSession.id,
        prompt: '请把主色改成深蓝，其他保持不变',
        mockMode: false,
      });
      const protoAfterP6 = store.getPrototype(protoId)!;
      expect(readPrototypeDocumentStyle(protoAfterP6.htmlContent)!.css).toContain('--proto-accent: #1e3a8a');
      expect(protoAfterP6.designBrief?.styleValues?.accent).toBe('#1e3a8a');
      const buildP6 = foldBuild(turn3P6.events);
      expect(buildP6.log.find((l) => l.kind === 'style_values_changed')).toMatchObject({
        valueKeys: ['accent'],
      });

      // Turn 4: user does NOT ask to change main colour -> newly approved #1e3a8a stays locked!
      scriptedReplies.push(
        {
          toolCalls: [
            {
              id: 'tc-style-t4',
              name: 'define_style',
              args: {
                direction: '深蓝专业版（重排样张）',
                values: { accent: '#f94c05' },
                userRequested: { keys: ['accent'], quote: '把主色改成橙色' },
                componentCss: '.card { padding: var(--proto-pad); }',
                sampleHtml: '<section class="card">深蓝样张二版</section>',
              },
            },
          ],
        },
        { text: '已调整样张排版。' },
      );
      await collectUnifiedAgentTurn(store, {
        sessionId: mainSession.id,
        prompt: '调整一下样张卡片排版',
        mockMode: false,
      });
      expect(readPrototypeDocumentStyle(store.getPrototype(protoId)!.htmlContent)!.css).toContain(
        '--proto-accent: #1e3a8a',
      );

      // ── 5) P5: follow-up resume WITHOUT re-attached images still sends brief's Visual References to helpers ──
      // Point the stored brief's primary reference at the local test image server so offline CI never waits on external CDN.
      store.updatePrototypeDesignBrief(protoId, {
        ...store.getPrototype(protoId)!.designBrief!,
        primaryReferenceId: undefined,
        primaryReferenceTitle: primaryRef.title,
        primaryReferenceSourceUrl: `http://127.0.0.1:${port}/ref.png`,
      });
      const beforeResumeIdx = seenBodies.length;
      scriptedReplies.push({
        toolCalls: [
          {
            id: 'tc-sub-scr-a',
            name: 'upsert_prototype_screen',
            args: {
              screenId: 'SCR-A',
              screenName: '首页',
              screenHtml: '<div class="card"><button data-element-id="EL-A1" data-element-type="BUTTON">继续订货</button></div>',
              extraCss: '.card { gap: var(--proto-gap); }',
            },
          },
        ],
      });
      const resumeVisionTurn = await collectUnifiedAgentTurn(store, {
        sessionId: mainSession.id,
        prompt: '[ACTION:RESUME_PROTOTYPE_SCREEN {"screenId":"SCR-A"}] 继续这一屏',
        mockMode: false,
      });
      expect(resumeVisionTurn.session.messages.at(-1)!.content).toContain('其他屏没有改动');
      const helperVisionReq = seenBodies[beforeResumeIdx]!;
      const helperVisionJson = JSON.stringify(helperVisionReq.messages);
      expect(helperVisionJson).toContain('image_url');
      expect(helperVisionJson).toContain('门店现场图.png');
      // 2 unique visual references (brief-primary + user-ref-1).
      expect(helperVisionJson.match(/"type":"image_url"/g)).toHaveLength(2);

      // Deduplication: when the turn already attaches `user-ref-1`, helpers still see 2 images (not 3).
      const beforeDedupIdx = seenBodies.length;
      scriptedReplies.push({
        toolCalls: [
          {
            id: 'tc-sub-scr-dedup',
            name: 'upsert_prototype_screen',
            args: {
              screenId: 'SCR-A',
              screenName: '首页',
              screenHtml: '<div class="card"><button data-element-id="EL-A1" data-element-type="BUTTON">去重校验</button></div>',
            },
          },
        ],
      });
      await collectUnifiedAgentTurn(store, {
        sessionId: mainSession.id,
        prompt: '[ACTION:RESUME_PROTOTYPE_SCREEN {"screenId":"SCR-A"}] 继续这一屏',
        mockMode: false,
        images: [
          {
            id: 'user-ref-1',
            name: '门店现场图.png',
            mimeType: 'image/png',
            dataBase64: pngBytes.toString('base64'),
          },
        ],
      });
      expect(JSON.stringify(seenBodies[beforeDedupIdx]!.messages).match(/"type":"image_url"/g)).toHaveLength(2);

      // And when the model does NOT support vision, helpers still get the text fallback notes from the brief.
      setVisionProvider(false);
      const beforeFallbackIdx = seenBodies.length;
      scriptedReplies.push({
        toolCalls: [
          {
            id: 'tc-sub-scr-a2',
            name: 'upsert_prototype_screen',
            args: {
              screenId: 'SCR-A',
              screenName: '首页',
              screenHtml: '<div class="card"><button data-element-id="EL-A1" data-element-type="BUTTON">无图回退订货</button></div>',
            },
          },
        ],
      });
      await collectUnifiedAgentTurn(store, {
        sessionId: mainSession.id,
        prompt: '[ACTION:RESUME_PROTOTYPE_SCREEN {"screenId":"SCR-A"}] 继续这一屏',
        mockMode: false,
      });
      const helperFallbackJson = JSON.stringify(seenBodies[beforeFallbackIdx]!.messages);
      expect(helperFallbackJson).toContain('门店现场图.png');
      expect(helperFallbackJson).toContain(primaryRef.title);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
