import { describe, expect, it } from 'vitest';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { readPrototypeNotes } from '../../ontology-core/index.js';
import type { AgentSubagentLaneTrace } from '../../workspace-store/index.js';
import {
  PROTOTYPE_ANCHOR_OPENAI_TOOLS,
  editPrototypeAnchor,
  initPrototypeShell,
  listPrototypeAnchors,
  runParallelSubagents,
  screenHelperSystemPrompt,
  upsertPrototypeScreen,
} from '../index.js';

describe('Prototype tool schemas, notes, and zero reasoning-regex cursor guessing (#92)', () => {
  it('orders short fields (screenId, elementId, note) strictly before HTML fields in upsert_prototype_screen and edit_prototype_anchor', () => {
    const upsertTool = PROTOTYPE_ANCHOR_OPENAI_TOOLS.find(
      (t) => t.function.name === 'upsert_prototype_screen',
    )!;
    const upsertKeys = Object.keys(
      (upsertTool.function.parameters as { properties: Record<string, unknown> }).properties,
    );
    const htmlIdx = upsertKeys.indexOf('screenHtml');
    expect(htmlIdx).toBeGreaterThan(0);
    expect(upsertKeys.indexOf('screenId')).toBeGreaterThanOrEqual(0);
    expect(upsertKeys.indexOf('screenId')).toBeLessThan(htmlIdx);
    expect(upsertKeys.indexOf('screenName')).toBeLessThan(htmlIdx);
    expect(upsertKeys.indexOf('screenType')).toBeLessThan(htmlIdx);
    expect(upsertKeys.indexOf('note')).toBeGreaterThanOrEqual(0);
    expect(upsertKeys.indexOf('note')).toBeLessThan(htmlIdx);

    const editTool = PROTOTYPE_ANCHOR_OPENAI_TOOLS.find(
      (t) => t.function.name === 'edit_prototype_anchor',
    )!;
    const editKeys = Object.keys(
      (editTool.function.parameters as { properties: Record<string, unknown> }).properties,
    );
    const fragIdx = editKeys.indexOf('htmlFragment');
    expect(fragIdx).toBeGreaterThan(0);
    expect(editKeys.indexOf('screenId')).toBeGreaterThanOrEqual(0);
    expect(editKeys.indexOf('screenId')).toBeLessThan(fragIdx);
    expect(editKeys.indexOf('elementId')).toBeGreaterThanOrEqual(0);
    expect(editKeys.indexOf('elementId')).toBeLessThan(fragIdx);
    expect(editKeys.indexOf('operation')).toBeLessThan(fragIdx);
    expect(editKeys.indexOf('note')).toBeGreaterThanOrEqual(0);
    expect(editKeys.indexOf('note')).toBeLessThan(fragIdx);
  });

  it('writes and updates Prototype Notes via upsertPrototypeScreen and editPrototypeAnchor, and surfaces notes in listPrototypeAnchors', () => {
    const shell = initPrototypeShell({
      appTitle: '门店订货',
      screens: [{ screenId: 'SCR-ORDERS', screenName: '订货单列表', screenType: 'LIST' }],
    });
    expect(shell.isError).toBe(false);

    const upserted = upsertPrototypeScreen(shell.nextHtml, {
      screenId: 'SCR-ORDERS',
      screenName: '订货单列表',
      note: '订货单列表：集中查看所有门店订货单的配送进度。',
      screenHtml: `<section class="page" data-element-id="EL-ORDERS-FILTER" data-element-type="CONTAINER" data-note="筛选区：按状态或单号检索。">
        <button type="button" data-element-id="EL-ORDERS-NEW" data-element-type="BUTTON" data-element-label="新建订单">新建订单</button>
      </section>`,
    });
    expect(upserted.isError).toBe(false);
    expect(readPrototypeNotes(upserted.nextHtml, { screenId: 'SCR-ORDERS' })).toEqual([
      {
        screenId: 'SCR-ORDERS',
        note: '订货单列表：集中查看所有门店订货单的配送进度。',
        title: '订货单列表',
        body: '集中查看所有门店订货单的配送进度。',
      },
      {
        elementId: 'EL-ORDERS-FILTER',
        screenId: 'SCR-ORDERS',
        note: '筛选区：按状态或单号检索。',
        title: '筛选区',
        body: '按状态或单号检索。',
      },
    ]);

    // editPrototypeAnchor can attach/update a note via the short `note` field
    const edited = editPrototypeAnchor(upserted.nextHtml, {
      screenId: 'SCR-ORDERS',
      elementId: 'EL-ORDERS-NEW',
      operation: 'update_attributes',
      note: '新建订单：库存不足时向供应商发起补货。',
    });
    expect(edited.isError).toBe(false);

    const replaced = editPrototypeAnchor(edited.nextHtml, {
      screenId: 'SCR-ORDERS',
      elementId: 'EL-ORDERS-NEW',
      operation: 'replace_element',
      note: '新建补货单：店长一键发起明日补货。',
      htmlFragment: `<button type="button" data-element-id="EL-ORDERS-NEW" data-element-type="BUTTON" data-element-label="新建补货单">新建补货单</button>`,
    });
    expect(replaced.isError).toBe(false);

    const anchors = listPrototypeAnchors(replaced.nextHtml);
    expect(anchors.elements.find((e) => e.elementId === 'EL-ORDERS-NEW')?.note).toBe(
      '新建补货单：店长一键发起明日补货。',
    );
  });

  it('instructs helpers in both languages to write opening tags with data-element-id and data-note before inner content', () => {
    const zh = screenHelperSystemPrompt('zh-CN');
    const en = screenHelperSystemPrompt('en-US');
    expect(zh).toContain('data-element-id');
    expect(zh).toContain('data-note');
    expect(zh).toMatch(/先写.*开始标签/);
    expect(en).toContain('data-element-id');
    expect(en).toContain('data-note');
    expect(en).toMatch(/opening tag first/i);
  });

  it('never guesses cursor zones or canned actions from reasoning text, and streams opening tags with data-note before inner content finishes', async () => {
    const faux = fauxProvider({
      provider: 'faux-notes-test',
      models: [{ id: 'faux-notes-test', name: 'Faux', input: ['text'], reasoning: true, contextWindow: 8000, maxTokens: 4096 }],
      tokensPerSecond: 1200,
    });
    const models = createModels();
    models.setProvider(faux.provider);

    const longThinking = [
      'Let us think about drawer 抽屉 and kpi 指标 and table 表格 and filter 筛选 and submit 提交. '.repeat(25),
    ].join('');
    const screenHtml = `<section class="page" data-element-id="EL-S1-HERO" data-note="今日概况：店长一眼看清待收货与待审批事项。">
      <div class="card"><h1>早上好</h1><p>今日共有 3 单货待收，2 笔退款待审批，请及时处理。</p><button type="button" data-element-id="EL-S1-BTN" data-element-type="BUTTON" data-element-label="去处理">去处理</button></div>
    </section>`;

    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxThinking(longThinking),
          fauxToolCall('upsert_prototype_screen', {
            screenId: 'SCR-S1',
            screenName: '工作台首页',
            screenType: 'DASHBOARD',
            note: '工作台首页：店长进门先看今日待办。',
            screenHtml,
          }),
        ],
        { stopReason: 'toolUse' },
      ),
    ]);

    const observedLanes: AgentSubagentLaneTrace[] = [];
    const streamedPartials: { note?: string; partialScreenHtml: string }[] = [];

    const res = await runParallelSubagents({
      tasks: [
        {
          title: '工作台首页',
          screenId: 'SCR-S1',
          screenName: '工作台首页',
          screenType: 'DASHBOARD',
          instruction: '展示今日待收货与待审批概况',
        },
      ],
      concurrency: 1,
      locale: 'zh-CN',
      models,
      selectedModel: faux.getModel()!,
      baseSystemPrompt: screenHelperSystemPrompt('zh-CN'),
      subagentTools: PROTOTYPE_ANCHOR_OPENAI_TOOLS.map((t) => ({
        name: t.function.name,
        description: t.function.description ?? '',
        parameters: t.function.parameters as never,
      })),
      requireScreen: true,
      signal: new AbortController().signal,
      stepTimeoutMs: 10_000,
      maxTokens: 4096,
      onActivity: () => undefined,
      onLaneUpdate: (lane) => {
        observedLanes.push(JSON.parse(JSON.stringify(lane)) as AgentSubagentLaneTrace);
      },
      onPartialScreenStream: (partial) => {
        streamedPartials.push({
          ...(partial.note ? { note: partial.note } : {}),
          partialScreenHtml: partial.partialScreenHtml,
        });
      },
      executeSubagentToolCall: async () => ({
        toolResultContent: JSON.stringify({ status: 'OK' }),
        isError: false,
      }),
    });

    expect(res.allSucceeded).toBe(true);
    expect(observedLanes.length).toBeGreaterThan(0);

    // Zero cursorZone and zero guessed reasoning / rotating canned lines!
    const forbiddenCanned = /(?:正在勘测画板|构思侧滑抽屉|设计底部确认|编排业务明细表|布局筛选工具栏|构思核心指标卡|规划页面顶栏|测算顶部汇总|排布查询筛选|设计主体内容区|串联跨屏跳转)/;
    for (const snap of observedLanes) {
      expect('cursorZone' in snap).toBe(false);
      if (snap.liveAction) {
        expect(snap.liveAction.zh).not.toMatch(forbiddenCanned);
      }
    }

    // 1) Screen-level `note` streams BEFORE `screenHtml` starts (partialScreenHtml === '')!
    expect(streamedPartials.length).toBeGreaterThan(0);
    const noteBeforeHtml = streamedPartials.find(
      (p) => Boolean(p.note && p.note.length >= 2) && p.partialScreenHtml === '',
    );
    expect(noteBeforeHtml).toBeDefined();

    // 2) Opening tag with data-element-id + data-note streamed BEFORE the closing </button> arrived!
    const earlyWithNote = streamedPartials.find(
      (p) => p.partialScreenHtml.includes('data-note="今日概况：') && !p.partialScreenHtml.includes('</button>'),
    );
    expect(earlyWithNote).toBeDefined();
  });
});
