import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
  applyPrototypeBuildEvent,
  emptyPrototypeBuildState,
  prototypeBuildScreen,
  splitPrototypeDocument,
  type PrototypeBuildEvent,
  type PrototypeBuildState,
} from '../../ontology-core/index.js';
import { createWorkspaceStore, type AgentSessionMessage } from '../../workspace-store/index.js';
import {
  collectUnifiedAgentTurn,
  createPrototypeBuildRun,
  getToolsForAgentKind,
  runParallelSubagents,
  type UnifiedAgentSseEvent,
} from '../index.js';

const SCREENS = ['SCR-HOME', 'SCR-ORDERS', 'SCR-NEW-ORDER', 'SCR-ORDER-DETAIL', 'SCR-REFUND'];
const FAILING = 'SCR-REFUND';
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

function screenStatuses(events: UnifiedAgentSseEvent[], screenId: string): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.event !== 'prototype_build_screen') continue;
    const screen = e.data.screen as { screenId: string; status: string };
    if (screen.screenId === screenId && out.at(-1) !== screen.status) out.push(screen.status);
  }
  return out;
}

function lastAssistant(messages: AgentSessionMessage[]): AgentSessionMessage {
  return messages.filter((m) => m.role === 'assistant').at(-1)!;
}

async function firstBuild() {
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  store.updateSystemSettings({ mockLlmMode: true });
  const session = store.createAgentSession({
    projectId: 'proj-contract',
    agentKind: 'PROTOTYPE_CO_DESIGN',
    title: '首版原型生成',
  });
  const turn = await collectUnifiedAgentTurn(store, {
    sessionId: session.id,
    prompt: '按已确认的需求生成首版原型',
    prototypeName: '施工计划原型',
    mockMode: true,
  });
  return { store, session, turn };
}

describe('Build Plan (#90): the lead declares the screens first, each screen reports its real state', () => {
  it('only the lead can declare the plan', () => {
    const lead = getToolsForAgentKind('PROTOTYPE_CO_DESIGN', { codeMode: false, multiAgentConcurrency: 3 });
    const helper = getToolsForAgentKind('PROTOTYPE_CO_DESIGN');
    expect(lead.map((t) => t.name)).toContain('plan_screens');
    expect(helper.map((t) => t.name)).not.toContain('plan_screens');
    // The plan carries screens only: no shell layout, colours or CSS.
    const planTool = lead.find((t) => t.name === 'plan_screens')!;
    const props = Object.keys(
      ((planTool.parameters as { properties: { screens: { items: { properties: object } } } }).properties.screens.items
        .properties),
    );
    expect(props).toEqual(['screenId', 'screenName', 'purpose', 'screenType']);
    expect(JSON.stringify(planTool.parameters)).not.toMatch(/css|color|colour|theme|layout/i);
  });

  it('streams the plan item by item before anything is drawn, then fails one screen with a reason', async () => {
    const { turn } = await firstBuild();
    const events = turn.events;
    expect(events.some((e) => e.event === 'run_error')).toBe(false);

    // The plan arrives while its arguments stream: several growing plan events, the first ones
    // before the lead has even finished the plan call, and before any frame or screen is drawn.
    const plans = events.filter((e) => e.event === 'prototype_plan');
    const sizes = plans.map((e) => (e.data.items as unknown[]).length);
    expect(sizes[0]).toBeLessThan(SCREENS.length);
    expect(sizes.at(-1)).toBe(SCREENS.length);
    expect(plans.some((e) => e.data.streaming === true)).toBe(true);
    expect(plans.at(-1)!.data.streaming).toBe(false);
    const firstPlan = events.indexOf(plans[0]!);
    const firstFrame = events.findIndex((e) => e.event === 'prototype_frame' || e.event === 'prototype_screen');
    const planToolCall = events.findIndex((e) => e.event === 'tool_result' && (e.data.trace as { toolName: string }).toolName === 'plan_screens');
    expect(firstPlan).toBeLessThan(planToolCall);
    expect(firstPlan).toBeLessThan(firstFrame);

    const build = foldBuild(events);
    expect(build.plan.map((p) => p.screenId)).toEqual(SCREENS);
    expect(build.plan.every((p) => p.screenName && p.purpose)).toBe(true);

    // Every screen ends in its real state, owned by the helper whose lane drew it. (Intermediate
    // states coalesce in the run log; the build-run unit tests below cover each transition.)
    const lanes = lastAssistant(turn.session.messages).subagentLanes!;
    for (const sid of SCREENS) {
      expect(prototypeBuildScreen(build, sid).status, sid).toBe(sid === FAILING ? 'failed' : 'done');
      const lane = lanes.find((l) => l.targetAnchor?.screenId === sid)!;
      expect(prototypeBuildScreen(build, sid).agent, sid).toBe(lane.workerIndex);
    }
    expect(new Set(lanes.map((l) => l.workerIndex)).size).toBe(3);
    // No screenshot check exists yet: nothing pretends to review.
    expect(events.some((e) => e.event === 'prototype_build_screen' && (e.data.screen as { status: string }).status === 'reviewing')).toBe(false);
    expect(prototypeBuildScreen(build, FAILING).failure).toBe('validation_failed');

    // Phases report what really happened.
    expect(build.phases.plan.status).toBe('done');
    expect(build.phases.style.status).toBe('skipped');
    expect(build.phases.screens.status).toBe('failed');
    expect(build.phases.review.status).toBe('skipped');
    expect(build.phases.tours.status).toBe('skipped');

    // The log, in order: plan, starts, done/failed lines, the skipped check, the end.
    const kinds = build.log.map((l) => l.kind);
    expect(kinds[0]).toBe('plan_ready');
    expect(kinds.filter((k) => k === 'screen_started')).toHaveLength(SCREENS.length);
    expect(kinds.filter((k) => k === 'screen_done')).toHaveLength(SCREENS.length - 1);
    expect(build.log.find((l) => l.kind === 'screen_failed')).toMatchObject({ screenId: FAILING, failure: 'validation_failed' });
    expect(build.log.some((l) => l.kind === 'phase_skipped' && l.phase === 'review')).toBe(true);
    expect(build.log.at(-1)).toMatchObject({ kind: 'build_finished', count: 4, failedCount: 1 });
    expect(build.log.find((l) => l.kind === 'screen_done')!.count).toBeGreaterThan(0);

    // What the browser folds is exactly what is persisted with the run.
    const persisted = lastAssistant(turn.session.messages).prototypeBuild!;
    expect(persisted).toEqual(build);

    // The helper lane is failed, not falsely done.
    expect(lanes.find((l) => l.targetAnchor?.screenId === FAILING)).toMatchObject({
      status: 'FAILED',
      failureCode: 'validation_failed',
    });
  });

  it('「继续这一屏」 redoes only that screen: one helper, no plan, no shell, other screens untouched', async () => {
    const { store, session, turn } = await firstBuild();
    const proto = store.listPrototypes('proj-contract').find((p) => p.name === '施工计划原型')!;
    const before = splitPrototypeDocument(proto.htmlContent);

    const resumed = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: `[ACTION:RESUME_PROTOTYPE_SCREEN ${JSON.stringify({ screenId: FAILING })}] 继续画「退款审批」`,
      mockMode: true,
    });
    const events = resumed.events;
    expect(events.some((e) => e.event === 'run_error')).toBe(false);

    const tools = events
      .filter((e) => e.event === 'tool_result')
      .map((e) => [(e.data.trace as { toolName: string }).toolName, (e.data.trace as { arguments: { screenId?: string } }).arguments.screenId]);
    expect(tools).toEqual([
      ['upsert_prototype_screen', FAILING],
      ['spawn_subagents', undefined],
    ]);

    // The run continues the persisted plan: the browser gets it whole, then the one screen moves.
    const start = events.find((e) => e.event === 'prototype_build_start')!;
    expect((start.data.base as PrototypeBuildState).plan.map((p) => p.screenId)).toEqual(SCREENS);
    expect(events.filter((e) => e.event === 'prototype_plan')).toHaveLength(0);
    expect(screenStatuses(events, FAILING).at(-1)).toBe('done');
    for (const sid of SCREENS.filter((s) => s !== FAILING)) expect(screenStatuses(events, sid)).toEqual([]);

    const build = foldBuild(events);
    expect(SCREENS.map((sid) => prototypeBuildScreen(build, sid).status)).toEqual(SCREENS.map(() => 'done'));
    expect(build.phases.screens.status).toBe('done');
    expect(build.log.slice(-4).map((l) => l.kind)).toEqual(['screen_resumed', 'screen_started', 'screen_done', expect.any(String)]);
    expect(build.log.at(-1)).toMatchObject({ kind: 'build_finished', count: 5, failedCount: 0 });
    // The earlier lines are still there: one continuous log.
    expect(build.log.length).toBeGreaterThan(lastAssistant(turn.session.messages).prototypeBuild!.log.length);
    expect(lastAssistant(resumed.session.messages).prototypeBuild).toEqual(build);

    // A new revision with the screen drawn; every other screen byte-for-byte unchanged.
    const after = store.listPrototypes('proj-contract').find((p) => p.id === proto.id)!;
    expect(after.revisions).toHaveLength(2);
    const afterDoc = splitPrototypeDocument(after.htmlContent);
    expect(afterDoc.screens.map((s) => [s.screenId, s.status])).toEqual(SCREENS.map((s) => [s, 'ready']));
    for (const sid of SCREENS.filter((s) => s !== FAILING)) {
      expect(afterDoc.screens.find((s) => s.screenId === sid)!.html).toBe(before.screens.find((s) => s.screenId === sid)!.html);
    }
    expect(lastAssistant(resumed.session.messages).content).toContain('退款审批');
  });
});

describe('createPrototypeBuildRun: from lane events to screen states', () => {
  type Lane = Parameters<ReturnType<typeof createPrototypeBuildRun>['observeLane']>[0];
  const lane = (screenId: string, workerIndex: number, status: Lane['status'], extra: Partial<Lane> = {}): Lane => ({
    laneId: `lane-${screenId}`,
    workerIndex,
    workerLabel: { zh: '', en: '' },
    taskTitle: { zh: screenId, en: screenId },
    targetAnchor: { screenId },
    status,
    startedAt: '',
    ...extra,
  });

  function setup(base?: PrototypeBuildState) {
    const events: PrototypeBuildEvent[] = [];
    const run = createPrototypeBuildRun({ locale: 'zh-CN', emit: (e) => events.push(e), ...(base ? { base } : {}) });
    const statuses = (sid: string) => {
      const out: string[] = [];
      for (const e of events) {
        if (e.kind === 'build_screen' && e.screen.screenId === sid && out.at(-1) !== e.screen.status) out.push(e.screen.status);
      }
      return out;
    };
    return { run, events, statuses };
  }

  const PLAN_ARGS = {
    screens: [
      { screenId: 'SCR-A', screenName: '首页', purpose: '看今天' },
      { screenId: 'SCR-B', screenName: '审批', purpose: '批退款' },
    ],
  };

  it('queued → writing → done with the same owner, counting written elements', () => {
    const { run, events, statuses } = setup();
    run.observePlanStream({ screens: [{ screenId: 'SCR-A', screenName: '首' }] });
    expect(run.commitPlan(PLAN_ARGS).isError).toBe(false);
    run.observeLane(lane('SCR-A', 1, 'QUEUED'));
    run.observeLane(lane('SCR-A', 1, 'RUNNING'));
    run.observeScreenStream('SCR-A', '<div data-element-id="X"><button data-element-id="Y">');
    run.observeScreenWritten('SCR-A', '<div data-element-id="X"><button data-element-id="Y"></button><i data-element-id="Z"></i></div>');
    run.observeLane(lane('SCR-A', 1, 'DONE', { wroteScreen: true }));
    run.observeLane(lane('SCR-B', 2, 'QUEUED'));
    run.observeLane(lane('SCR-B', 2, 'RUNNING'));
    run.observeLane(lane('SCR-B', 2, 'FAILED', { failureCode: 'not_written' }));
    run.finish('succeeded');

    expect(statuses('SCR-A')).toEqual(['queued', 'writing', 'done']);
    expect(statuses('SCR-B')).toEqual(['queued', 'writing', 'failed']);
    const state = run.snapshot()!;
    expect(prototypeBuildScreen(state, 'SCR-A')).toEqual({ screenId: 'SCR-A', status: 'done', agent: 1, writtenElements: 3 });
    expect(prototypeBuildScreen(state, 'SCR-B')).toMatchObject({ status: 'failed', agent: 2, failure: 'not_written' });
    expect(state.log.find((l) => l.kind === 'screen_done')).toMatchObject({ agent: 1, count: 3 });
    expect(events[0]!.kind).toBe('build_start');
  });

  it('a planned screen nobody drew fails when the run ends; a cancelled run says so', () => {
    const ok = setup();
    ok.run.commitPlan(PLAN_ARGS);
    ok.run.finish('succeeded');
    expect(prototypeBuildScreen(ok.run.snapshot()!, 'SCR-A').failure).toBe('not_written');
    // Nothing was drawn, so the later phases did not start rather than being "skipped".
    expect(ok.run.snapshot()!.phases.review.status).toBe('not_started');

    const cancelled = setup();
    cancelled.run.commitPlan(PLAN_ARGS);
    cancelled.run.observeLane(lane('SCR-A', 1, 'RUNNING'));
    cancelled.run.finish('cancelled');
    const s = cancelled.run.snapshot()!;
    expect(prototypeBuildScreen(s, 'SCR-A')).toMatchObject({ status: 'failed', failure: 'cancelled' });
    expect(s.phases.screens.status).toBe('failed');
    expect(s.phases.review.status).toBe('skipped');
  });

  it('rejects a plan without screens or with unusable ids, and records nothing', () => {
    const { run, events } = setup();
    expect(run.commitPlan({ screens: [] }).isError).toBe(true);
    expect(run.commitPlan({ screens: [{ screenId: 'SCR A!', screenName: 'x', purpose: 'y' }] }).isError).toBe(true);
    expect(events).toEqual([]);
    expect(run.snapshot()).toBeUndefined();
  });

  it('plans what the lead dispatched when it skipped plan_screens, and orders tasks by the plan', () => {
    const { run } = setup();
    const ordered = run.prepareDispatch([
      { screenId: 'SCR-B', screenName: '审批', instruction: '批退款' },
      { screenId: 'SCR-A', screenName: '首页', instruction: '看今天' },
    ]);
    expect(ordered.map((t) => t.screenId)).toEqual(['SCR-B', 'SCR-A']);
    expect(run.snapshot()!.plan.map((p) => [p.screenId, p.purpose])).toEqual([
      ['SCR-B', '批退款'],
      ['SCR-A', '看今天'],
    ]);

    const planned = setup();
    planned.run.commitPlan(PLAN_ARGS);
    expect(
      planned.run
        .prepareDispatch([
          { screenId: 'SCR-B', instruction: 'b' },
          { screenId: 'SCR-A', instruction: 'a' },
        ])
        .map((t) => t.screenId),
    ).toEqual(['SCR-A', 'SCR-B']);
  });

  it('continues a persisted build for exactly one planned screen', () => {
    const first = setup();
    first.run.commitPlan(PLAN_ARGS);
    first.run.observeLane(lane('SCR-A', 1, 'RUNNING'));
    first.run.observeLane(lane('SCR-A', 1, 'DONE'));
    first.run.observeLane(lane('SCR-B', 2, 'RUNNING'));
    first.run.observeLane(lane('SCR-B', 2, 'FAILED', { failureCode: 'validation_failed' }));
    first.run.finish('succeeded');

    const again = setup(first.run.snapshot());
    expect(again.run.resumeScreen('SCR-X')).toBeNull();
    expect(again.run.resumeScreen('SCR-B')).toMatchObject({ screenId: 'SCR-B', screenName: '审批' });
    expect(again.statuses('SCR-B')).toEqual(['queued']);
    expect(prototypeBuildScreen(again.run.snapshot()!, 'SCR-B').failure).toBeUndefined();
    expect(again.statuses('SCR-A')).toEqual([]);
  });
});

describe('runParallelSubagents: a screen lane is done only when its screen was written and checked', () => {
  async function runOne(
    reply: (round: number) => ReturnType<typeof fauxAssistantMessage>,
    execResult: { isError: boolean },
  ) {
    const faux = fauxProvider({
      provider: 'faux-test',
      models: [{ id: 'faux-test', name: 'Faux', input: ['text'], reasoning: false, contextWindow: 8000, maxTokens: 2000 }],
      tokensPerSecond: 100000,
    });
    let round = 0;
    faux.setResponses(Array.from({ length: 6 }, () => () => reply(round++)));
    const models = createModels();
    models.setProvider(faux.provider);
    const res = await runParallelSubagents({
      tasks: [{ title: '退款审批', screenId: 'SCR-REFUND', screenName: '退款审批', instruction: '批退款' }],
      concurrency: 3,
      locale: 'zh-CN',
      models,
      selectedModel: faux.getModel()!,
      baseSystemPrompt: '',
      subagentTools: [],
      signal: new AbortController().signal,
      stepTimeoutMs: 10_000,
      maxTokens: 2000,
      onActivity: () => undefined,
      onLaneUpdate: () => undefined,
      executeSubagentToolCall: async () => ({ toolResultContent: '{}', ...execResult }),
    });
    return res.lanes[0]!;
  }

  it('fails with not_written when the helper only talks', async () => {
    const lane = await runOne(() => fauxAssistantMessage([fauxText('我觉得这一屏很简单。')]), { isError: false });
    expect(lane).toMatchObject({ status: 'FAILED', failureCode: 'not_written' });
  });

  it('fails with validation_failed when every write is rejected', async () => {
    const lane = await runOne(
      (round) =>
        round === 0
          ? fauxAssistantMessage([fauxToolCall('upsert_prototype_screen', { screenId: 'SCR-REFUND', screenHtml: '<button>x</button>' })], { stopReason: 'toolUse' })
          : fauxAssistantMessage([fauxText('放弃。')]),
      { isError: true },
    );
    expect(lane).toMatchObject({ status: 'FAILED', failureCode: 'validation_failed' });
  });

  it('is done when its own screen was written', async () => {
    const lane = await runOne(
      () =>
        fauxAssistantMessage([fauxToolCall('upsert_prototype_screen', { screenId: 'SCR-REFUND', screenHtml: '<p>x</p>' })], {
          stopReason: 'toolUse',
        }),
      { isError: false },
    );
    expect(lane).toMatchObject({ status: 'DONE', wroteScreen: true });
  });
});
