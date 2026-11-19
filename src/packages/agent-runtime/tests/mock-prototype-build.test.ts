import { describe, expect, it } from 'vitest';
import { checkBusinessViewMarkup } from '../../business-vocabulary/index.js';
import {
  applyPrototypeLiveEvent,
  buildPrototypeCanvasModel,
  emptyPrototypeLiveState,
  splitPrototypeDocument,
  type PrototypeLiveEvent,
} from '../../ontology-core/index.js';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import {
  attachUnifiedAgentSessionLiveStream,
  collectUnifiedAgentTurn,
  startUnifiedAgentSessionTurn,
  type UnifiedAgentSseEvent,
} from '../index.js';

const SCREENS = ['SCR-HOME', 'SCR-ORDERS', 'SCR-NEW-ORDER', 'SCR-ORDER-DETAIL', 'SCR-REFUND'];
/** The recording gets this screen wrong the first time (#90): the anchor check rejects it. */
const FAILING = 'SCR-REFUND';

describe('Mock mode replays a recorded multi-screen prototype build through the real engine (#89)', () => {
  it('streams every screen from tool-call arguments, several lanes at once, as per-screen deltas', async () => {
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
      prototypeName: '门店订货原型',
      mockMode: true,
    });
    expect(turn.events.some((e) => e.event === 'run_error')).toBe(false);

    // The lead lays out the shell and hands the screens to parallel subagents.
    const toolCalls = turn.events.filter((e) => e.event === 'tool_call');
    const names = toolCalls.map((e) => String(e.data.toolName));
    expect(names[0]).toBe('plan_screens');
    expect(names).toContain('init_prototype_shell');
    expect(names).toContain('spawn_subagents');
    const upserts = turn.events.filter(
      (e) => e.event === 'tool_result' && (e.data.trace as { toolName: string }).toolName === 'upsert_prototype_screen',
    );
    expect(upserts).toHaveLength(SCREENS.length);
    expect(
      upserts.map((e) => [(e.data.trace as { arguments: { screenId: string } }).arguments.screenId, (e.data.trace as { isError: boolean }).isError]),
    ).toEqual(expect.arrayContaining(SCREENS.map((sid) => [sid, sid === FAILING])));

    // Several lanes were running at the same time (real lane bookkeeping, not a browser trick).
    const peakRunning = Math.max(
      ...turn.events
        .filter((e) => e.event === 'subagent_update')
        .map((e) => (e.data.lanes as { status: string }[]).filter((l) => l.status === 'RUNNING').length),
    );
    expect(peakRunning).toBeGreaterThanOrEqual(2);

    // Every screen streamed in from its tool-call arguments before it landed.
    const live = turn.events.filter((e) => e.event === 'prototype_screen' || e.event === 'prototype_frame');
    for (const sid of SCREENS) {
      const statuses = live
        .filter((e) => e.event === 'prototype_screen' && e.data.screenId === sid)
        .map((e) => e.data.status);
      expect(statuses, sid).toContain('streaming');
      // The rejected screen falls back to the document's version: still empty, still queued.
      expect(statuses.at(-1), sid).toBe(sid === FAILING ? 'queued' : 'ready');
    }
    // More than one screen was in flight before the first one landed.
    const firstReady = live.findIndex((e) => e.event === 'prototype_screen' && e.data.status === 'ready' && SCREENS.includes(String(e.data.screenId)));
    const inFlightBeforeFirstReady = new Set(
      live
        .slice(0, firstReady)
        .filter((e) => e.event === 'prototype_screen' && e.data.status === 'streaming')
        .map((e) => e.data.screenId),
    );
    expect(inFlightBeforeFirstReady.size).toBeGreaterThanOrEqual(2);

    // Each delta carries one screen only.
    for (const e of live.filter((ev) => ev.event === 'prototype_screen')) {
      const html = String(e.data.html);
      expect(html.match(/data-screen-id=/g)).toHaveLength(1);
      expect(html).not.toMatch(/<html|<head/i);
    }

    // Folding the deltas gives exactly what was saved.
    const state = live
      .map((e) => e.data as unknown as PrototypeLiveEvent)
      .reduce(applyPrototypeLiveEvent, emptyPrototypeLiveState());
    const created = store.listPrototypes('proj-contract').find((p) => p.name === '门店订货原型')!;
    expect(created.revisions).toHaveLength(1);
    const saved = splitPrototypeDocument(created.htmlContent);
    expect(saved.screens.map((s) => [s.screenId, s.status])).toEqual(
      SCREENS.map((s) => [s, s === FAILING ? 'queued' : 'ready']),
    );
    const fromEvents = buildPrototypeCanvasModel('', state);
    const fromSaved = buildPrototypeCanvasModel(created.htmlContent);
    expect(fromEvents.screens.map((s) => s.bodyHtml)).toEqual(fromSaved.screens.map((s) => s.bodyHtml));

    // The lead's closing words are business language.
    const lastAssistant = turn.session.messages.filter((m) => m.role === 'assistant').at(-1)!;
    expect(lastAssistant.content).toContain('退款审批');
    expect(checkBusinessViewMarkup(lastAssistant.content, { plainText: true })).toHaveLength(0);
  });
});

describe('Reconnecting with afterEventId mid-build (#89)', () => {
  it('catches up with each screen’s current state, one delta per screen, not every delta in between', async () => {
    const previousPace = process.env.ONTOLOGY_MOCK_TOKENS_PER_SECOND;
    process.env.ONTOLOGY_MOCK_TOKENS_PER_SECOND = '1500';
    try {
      const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
      store.updateSystemSettings({ mockLlmMode: true });
      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'PROTOTYPE_CO_DESIGN',
        title: '首版原型生成',
      });
      await startUnifiedAgentSessionTurn(
        store,
        { sessionId: session.id, prompt: '按已确认的需求生成首版原型', prototypeName: '重连原型', mockMode: true },
        { awaitCompletion: false },
      );

      // First connection: read until one screen has landed, then drop the connection.
      const first: UnifiedAgentSseEvent[] = [];
      const dropped = new AbortController();
      for await (const ev of attachUnifiedAgentSessionLiveStream(store, session.id, { signal: dropped.signal })) {
        first.push(ev);
        if (ev.event === 'prototype_screen' && ev.data.status === 'ready' && String(ev.data.screenId).startsWith('SCR-')) {
          dropped.abort();
          break;
        }
      }
      const lastSeen = first.at(-1)!.id;

      // While disconnected, the other screens keep streaming several deltas each.
      await new Promise((r) => setTimeout(r, 450));

      // The backlog is replayed from the run's log without waiting on any timer, so everything
      // that arrives before the first macrotask turn is backlog; later events are live.
      const second: { ev: UnifiedAgentSseEvent; backlog: boolean }[] = [];
      let inBacklog = true;
      setImmediate(() => {
        inBacklog = false;
      });
      for await (const ev of attachUnifiedAgentSessionLiveStream(store, session.id, { afterEventId: lastSeen })) {
        second.push({ ev, backlog: inBacklog });
      }
      expect(second.length).toBeGreaterThan(0);

      // The backlog delivered on reconnect holds at most one delta per screen.
      const backlog = second.filter((x) => x.backlog && x.ev.event === 'prototype_screen');
      expect(backlog.length).toBeGreaterThan(0);
      const perScreen = new Map<string, number>();
      for (const { ev } of backlog) {
        const id = String(ev.data.screenId);
        perScreen.set(id, (perScreen.get(id) ?? 0) + 1);
      }
      expect(Math.max(...perScreen.values())).toBe(1);

      // What the client folds from both connections is exactly what was saved.
      const state = [...first, ...second.map((x) => x.ev)]
        .filter((e) => e.event === 'prototype_screen' || e.event === 'prototype_frame')
        .map((e) => e.data as unknown as PrototypeLiveEvent)
        .reduce(applyPrototypeLiveEvent, emptyPrototypeLiveState());
      const saved = store.listPrototypes('proj-contract').find((p) => p.name === '重连原型')!;
      expect(buildPrototypeCanvasModel('', state).screens.map((s) => s.bodyHtml)).toEqual(
        buildPrototypeCanvasModel(saved.htmlContent).screens.map((s) => s.bodyHtml),
      );
    } finally {
      if (previousPace === undefined) delete process.env.ONTOLOGY_MOCK_TOKENS_PER_SECOND;
      else process.env.ONTOLOGY_MOCK_TOKENS_PER_SECOND = previousPace;
    }
  });

  it('post-generation modification plans ONLY the affected screen, updates it visibly with notes/tours, keeps other screens intact, and records a Change Summary (#96)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      title: '首版原型生成与修改',
    });

    // 1. Initial build
    const r1 = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '按已确认的需求生成首版原型',
      prototypeName: '门店订货修改测试原型',
      mockMode: true,
    });
    expect(r1.events.some((e) => e.event === 'run_error')).toBe(false);
    const created = store.listPrototypes('proj-contract').find((p) => p.name === '门店订货修改测试原型')!;
    expect(created).toBeDefined();
    const beforeScreens = new Map(
      splitPrototypeDocument(created.htmlContent).screens.map((s) => [s.screenId, s.html]),
    );

    // 2. Post-generation modification turn
    const r2 = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '把订单列表的筛选改成按客户',
      mockMode: true,
    });
    expect(r2.events.some((e) => e.event === 'run_error')).toBe(false);

    // Build Plan lists ONLY the affected screen (SCR-ORDERS)
    const planResult = r2.events.find(
      (e) => e.event === 'tool_result' && (e.data.trace as { toolName?: string })?.toolName === 'plan_screens',
    );
    expect(planResult).toBeDefined();
    const plannedScreens = ((planResult!.data.trace as { arguments?: { screens?: { screenId: string }[] } })?.arguments?.screens ?? []);
    expect(plannedScreens).toHaveLength(1);
    expect(plannedScreens[0]!.screenId).toBe('SCR-ORDERS');

    // Only SCR-ORDERS was updated; unaffected screens remain byte-for-byte identical
    const updated = store.getPrototype(created.id)!;
    expect(updated.revisions).toHaveLength(2);
    const afterScreens = new Map(
      splitPrototypeDocument(updated.htmlContent).screens.map((s) => [s.screenId, s.html]),
    );
    expect(afterScreens.get('SCR-ORDERS')).toContain('EL-FILTER-CUSTOMER');
    expect(afterScreens.get('SCR-ORDERS')).toContain('data-note="按客户筛选');
    expect(afterScreens.get('SCR-HOME')).toBe(beforeScreens.get('SCR-HOME'));
    expect(afterScreens.get('SCR-NEW-ORDER')).toBe(beforeScreens.get('SCR-NEW-ORDER'));
    expect(afterScreens.get('SCR-ORDER-DETAIL')).toBe(beforeScreens.get('SCR-ORDER-DETAIL'));

    // Artifact History + Change Summary recorded (ADR 0016)
    const history = store.listArtifactHistoryViews('proj-contract', { artifactKind: 'PROTOTYPE' });
    const latestHistory = history.find((h) => h.id === updated.revisions.at(-1)!.id);
    expect(latestHistory).toBeDefined();
    expect(latestHistory!.changeSummary.canUndo).toBe(true);
    expect(latestHistory!.changeSummary.compareRevisionPair).toBeDefined();
  });

  it('concurrency=1 mock initial build & post-generation modification use the unified live pipeline and never emit rewrite_prototype_page', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      title: '单智能体统一流水线',
      multiAgentConcurrency: 1,
    });

    const r1 = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '按已确认的需求生成首版原型',
      prototypeName: '单路统一流水线原型',
      multiAgentConcurrency: 1,
      mockMode: true,
    });
    expect(r1.events.some((e) => e.event === 'run_error')).toBe(false);
    const r1Tools = r1.events
      .filter((e) => e.event === 'tool_call')
      .map((e) => String(e.data.toolName));
    expect(r1Tools).not.toContain('rewrite_prototype_page');
    expect(r1Tools).not.toContain('spawn_subagents');
    expect(r1Tools).toContain('plan_screens');
    expect(r1Tools).toContain('define_style');
    expect(r1Tools).toContain('upsert_prototype_screen');
    expect(r1Tools).toContain('write_demo_tours');

    const r2 = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '把订单列表的筛选改成按客户',
      multiAgentConcurrency: 1,
      mockMode: true,
    });
    expect(r2.events.some((e) => e.event === 'run_error')).toBe(false);
    const r2Tools = r2.events
      .filter((e) => e.event === 'tool_call')
      .map((e) => String(e.data.toolName));
    expect(r2Tools).not.toContain('rewrite_prototype_page');
    expect(r2Tools).not.toContain('spawn_subagents');
    expect(r2Tools).toContain('plan_screens');
    expect(r2Tools).toContain('upsert_prototype_screen');

    const created = store.listPrototypes('proj-contract').find((p) => p.name === '单路统一流水线原型')!;
    expect(created.revisions).toHaveLength(2);
    expect(created.htmlContent).toContain('EL-FILTER-CUSTOMER');
  });
});
