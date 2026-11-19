import http from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  describePrototypeBuildLogEntry,
} from '../../business-vocabulary/index.js';
import {
  applyPrototypeBuildEvent,
  emptyPrototypeBuildState,
  extractMuFromPrototypeHtml,
  readPrototypeDemoTours,
  validatePrototypeDemoTours,
  writePrototypeDemoTours,
  type PrototypeBuildEvent,
  type PrototypeBuildState,
} from '../../ontology-core/index.js';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import {
  DOCUMENT_LEVEL_TOOL_NAMES,
  collectUnifiedAgentTurn,
  createPrototypeBuildRun,
  editPrototypeScreen,
  getToolsForAgentKind,
  initPrototypeShell,
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

function foldBuild(events: UnifiedAgentSseEvent[], from = emptyPrototypeBuildState()): PrototypeBuildState {
  return events
    .filter((e) => BUILD_EVENTS.has(e.event))
    .map((e) => e.data as unknown as PrototypeBuildEvent)
    .reduce(applyPrototypeBuildEvent, from);
}

describe('Demo Tours in agent-runtime (#95): write_demo_tours tool, phase transitions, and Mock replay', () => {
  it('exposes write_demo_tours to the lead only and excludes it from screen helpers', () => {
    const leadTools = getToolsForAgentKind('PROTOTYPE_CO_DESIGN', {
      codeMode: false,
      multiAgentConcurrency: 3,
    });
    expect(leadTools.map((t) => t.name)).toContain('write_demo_tours');
    expect(DOCUMENT_LEVEL_TOOL_NAMES.has('write_demo_tours')).toBe(true);

    const helperTools = getToolsForAgentKind('PROTOTYPE_CO_DESIGN');
    expect(helperTools.map((t) => t.name)).not.toContain('write_demo_tours');
  });

  it('transitions tours phase not_started -> now -> done (or failed on rejected attempt) and logs 演示路线已就绪', () => {
    const emitted: PrototypeBuildEvent[] = [];
    const run = createPrototypeBuildRun({
      locale: 'zh-CN',
      emit: (ev) => emitted.push(ev),
    });

    run.commitPlan({
      screens: [{ screenId: 'SCR-HOME', screenName: '首页', purpose: '总览待办' }],
    });
    expect(foldBuild(emitted.map((e, i) => ({ id: String(i), event: 'prototype_phase', data: e as never }))).phases.tours.status).toBe(
      'not_started',
    );

    run.observeToursStream();
    let state = emitted.reduce(applyPrototypeBuildEvent, emptyPrototypeBuildState());
    expect(state.phases.tours.status).toBe('now');
    expect(state.log.some((e) => e.kind === 'tours_started')).toBe(true);

    run.commitTours({ ok: true, count: 3 });
    run.finish('succeeded');
    state = emitted.reduce(applyPrototypeBuildEvent, emptyPrototypeBuildState());
    expect(state.phases.tours.status).toBe('done');
    const readyEntry = state.log.find((e) => e.kind === 'tours_ready');
    expect(readyEntry).toMatchObject({ kind: 'tours_ready', count: 3 });
    expect(describePrototypeBuildLogEntry(readyEntry!, (id) => id, 'zh-CN')).toContain('演示路线已就绪');
    expect(describePrototypeBuildLogEntry(readyEntry!, (id) => id, 'en-US')).toContain('Demo tours ready');

    // Failed attempt without recovery marks tours phase failed instead of pretending done
    const failedEvents: PrototypeBuildEvent[] = [];
    const failedRun = createPrototypeBuildRun({
      locale: 'zh-CN',
      emit: (ev) => failedEvents.push(ev),
    });
    failedRun.commitPlan({
      screens: [{ screenId: 'SCR-HOME', screenName: '首页', purpose: '总览待办' }],
    });
    failedRun.observeLeadScreenWritten('SCR-HOME', '<section data-screen-id="SCR-HOME"><button data-element-id="EL-1">好</button></section>');
    failedRun.observeToursStream();
    failedRun.commitTours({ ok: false });
    failedRun.finish('succeeded');
    const failedState = failedEvents.reduce(applyPrototypeBuildEvent, emptyPrototypeBuildState());
    expect(failedState.phases.tours.status).toBe('failed');
  });

  it('preserves data-proto-tours across upsertPrototypeScreen and editPrototypeScreen', () => {
    const shell = initPrototypeShell({
      appTitle: '门店订货',
      screens: [{ screenId: 'SCR-HOME', screenName: '首页', screenType: 'DASHBOARD' }],
    });
    expect(shell.isError).toBe(false);
    const upserted = upsertPrototypeScreen(shell.nextHtml, {
      screenId: 'SCR-HOME',
      screenName: '首页',
      screenType: 'DASHBOARD',
      screenHtml: `<div data-element-id="EL-GREET" data-element-type="CONTAINER" data-element-label="问候">你好</div>
        <button data-element-id="EL-GO" data-element-type="BUTTON" data-element-label="开始">开始订货</button>`,
    });
    expect(upserted.isError).toBe(false);

    const tours = [
      {
        id: 't1',
        goal: '开始订货',
        audience: '店长',
        steps: [
          { screenId: 'SCR-HOME', elementId: 'EL-GREET', action: 'look' as const, caption: '查看问候。' },
          { screenId: 'SCR-HOME', elementId: 'EL-GO', action: 'click' as const, caption: '点开始订货。' },
        ],
      },
    ];
    const withTours = writePrototypeDemoTours(upserted.nextHtml, tours);

    const edited = editPrototypeScreen(withTours, {
      screenId: 'SCR-HOME',
      elementId: 'EL-GREET',
      note: '更新问候文案',
      find: '你好</div>',
      replace: '早上好，王店长</div>',
    });
    expect(edited.isError).toBe(false);
    expect(readPrototypeDemoTours(edited.nextHtml)).toEqual(tours);

    const reUpserted = upsertPrototypeScreen(edited.nextHtml, {
      screenId: 'SCR-HOME',
      screenName: '首页',
      screenType: 'DASHBOARD',
      screenHtml: `<div data-element-id="EL-GREET" data-element-type="CONTAINER" data-element-label="问候">下午好</div>
        <button data-element-id="EL-GO" data-element-type="BUTTON" data-element-label="开始">开始订货</button>`,
      extraCss: '.greet { padding: 8px; }',
    });
    expect(reUpserted.isError).toBe(false);
    expect(readPrototypeDemoTours(reUpserted.nextHtml)).toEqual(tours);
  });

  it('rejects invalid anchors in write_demo_tours with diagnostics and succeeds when retried in the same turn', async () => {
    let step = 0;
    const llmServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        step += 1;
        let toolCalls: { id: string; name: string; args: Record<string, unknown> }[] | null = null;
        if (step === 1) {
          toolCalls = [
            {
              id: 'tc-plan',
              name: 'plan_screens',
              args: {
                screens: [{ screenId: 'SCR-HOME', screenName: '工作台', purpose: '查看今日待办' }],
              },
            },
            {
              id: 'tc-shell',
              name: 'init_prototype_shell',
              args: {
                appTitle: '订货工作台',
                screens: [{ screenId: 'SCR-HOME', screenName: '工作台', screenType: 'DASHBOARD' }],
              },
            },
            {
              id: 'tc-home',
              name: 'upsert_prototype_screen',
              args: {
                screenId: 'SCR-HOME',
                screenName: '工作台',
                screenType: 'DASHBOARD',
                screenHtml: `<div data-element-id="EL-HOME-GREET" data-element-type="CONTAINER">早上好</div>
                  <button data-element-id="EL-HOME-ORDER" data-element-type="BUTTON">新建订单</button>`,
              },
            },
          ];
        } else if (step === 2) {
          toolCalls = [
            {
              id: 'tc-tours-bad',
              name: 'write_demo_tours',
              args: {
                tours: [
                  {
                    id: 'bad',
                    goal: '测试失败',
                    steps: [
                      { screenId: 'SCR-HOME', elementId: 'EL-DOES-NOT-EXIST', action: 'click', caption: '不存在的按钮' },
                    ],
                  },
                  {
                    id: 'ok',
                    goal: '查看首页',
                    steps: [
                      { screenId: 'SCR-HOME', elementId: 'EL-HOME-GREET', action: 'look', caption: '查看问候' },
                    ],
                  },
                ],
              },
            },
          ];
        } else if (step === 3) {
          expect(body).toContain('EL-DOES-NOT-EXIST');
          expect(body).toContain('EL-HOME-GREET');
          toolCalls = [
            {
              id: 'tc-tours-ok',
              name: 'write_demo_tours',
              args: {
                tours: [
                  {
                    id: 'start-order',
                    goal: '发起门店订货',
                    audience: '店长',
                    steps: [
                      { screenId: 'SCR-HOME', elementId: 'EL-HOME-GREET', action: 'look', caption: '查看早班提醒。' },
                      { screenId: 'SCR-HOME', elementId: 'EL-HOME-ORDER', action: 'click', caption: '点击新建订单。' },
                    ],
                  },
                  {
                    id: 'check-todo',
                    goal: '早班核对待办',
                    audience: '店长',
                    steps: [
                      { screenId: 'SCR-HOME', elementId: 'EL-HOME-GREET', action: 'look', caption: '确认今日待办事项。' },
                    ],
                  },
                ],
              },
            },
          ];
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        if (toolCalls) {
          res.write(
            `data: ${JSON.stringify({
              id: `cmpl-${step}`,
              object: 'chat.completion.chunk',
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    tool_calls: toolCalls.map((tc, index) => ({
                      index,
                      id: tc.id,
                      type: 'function',
                      function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                    })),
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            })}\n\n`,
          );
        } else {
          res.write(
            `data: ${JSON.stringify({
              id: `cmpl-${step}`,
              object: 'chat.completion.chunk',
              choices: [{ index: 0, delta: { role: 'assistant', content: '原型与演示路线已生成。' }, finish_reason: 'stop' }],
            })}\n\n`,
          );
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });

    await new Promise<void>((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
    const port = (llmServer.address() as { port: number }).port;
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      store.updateSystemSettings({ mockLlmMode: false });
      for (const p of store.listLlmProviders()) store.saveLlmProvider({ ...p, enabled: false });
      store.saveLlmProvider({
        id: 'llm-tours-test',
        name: 'Tours Test Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: 'test-key',
        defaultModel: 'auto/glm-5.3-flash',
        availableModels: ['auto/glm-5.3-flash'],
        supportsVision: false,
        enabled: true,
      });

      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'PROTOTYPE_CO_DESIGN',
        title: '演示路线自愈测试',
        providerId: 'llm-tours-test',
        codeMode: false,
        multiAgentConcurrency: 1,
      });

      const turn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '生成工作台与演示路线',
        prototypeName: '自愈演示原型',
        mockMode: false,
      });

      const writeTraces = turn.events
        .filter((e) => e.event === 'tool_result' && (e.data.trace as { toolName: string }).toolName === 'write_demo_tours')
        .map((e) => e.data.trace as { isError: boolean; output: string });
      expect(writeTraces).toHaveLength(2);
      expect(writeTraces[0]!.isError).toBe(true);
      expect(writeTraces[0]!.output).toContain('EL-DOES-NOT-EXIST');
      expect(writeTraces[1]!.isError).toBe(false);

      const saved = store.listPrototypes('proj-contract').find((p) => p.name === '自愈演示原型')!;
      const tours = readPrototypeDemoTours(saved.htmlContent);
      expect(tours).toHaveLength(2);
      expect(tours.map((t) => t.id)).toEqual(['start-order', 'check-todo']);

      const build = foldBuild(turn.events);
      expect(build.phases.tours.status).toBe('done');
      expect(build.log.some((e) => e.kind === 'tours_ready')).toBe(true);
    } finally {
      await new Promise<void>((resolve) => llmServer.close(() => resolve()));
      store.close();
    }
  });

  it('writes 2–4 valid Demo Tours at the end of Mock replay without extracting them into MU', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      title: '模拟回放演示路线测试',
    });
    const turn = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '按已确认的需求生成首版原型',
      prototypeName: '烘焙订货原型',
      mockMode: true,
    });

    expect(turn.events.some((e) => e.event === 'run_error')).toBe(false);
    const phaseTransitions = turn.events
      .filter((e) => e.event === 'prototype_phase' && e.data.phase === 'tours')
      .map((e) => e.data.status);
    expect(phaseTransitions).toEqual(['now', 'done']);

    const build = foldBuild(turn.events);
    expect(build.phases.tours.status).toBe('done');
    const readyEntry = build.log.find((e) => e.kind === 'tours_ready');
    expect(readyEntry).toBeDefined();
    expect(readyEntry!.count).toBeGreaterThanOrEqual(2);
    expect(readyEntry!.count).toBeLessThanOrEqual(4);

    const saved = store.listPrototypes('proj-contract').find((p) => p.name === '烘焙订货原型')!;
    const tours = readPrototypeDemoTours(saved.htmlContent);
    expect(tours.length).toBeGreaterThanOrEqual(2);
    expect(tours.length).toBeLessThanOrEqual(4);

    const validation = validatePrototypeDemoTours(saved.htmlContent, tours, { minTours: 2, maxTours: 4 });
    expect(validation.ok).toBe(true);

    const mu = extractMuFromPrototypeHtml(saved.htmlContent, '门店订货');
    expect(JSON.stringify(mu)).not.toContain(tours[0]!.id);
    expect(JSON.stringify(mu)).not.toContain(tours[0]!.steps[0]!.caption);
  });
});
