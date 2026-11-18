import { describe, expect, it } from 'vitest';
import {
  applyPrototypeBuildEvent,
  applyPrototypeLiveEvent,
  buildPrototypeCanvasModel,
  countWrittenElements,
  createPrototypeBuildTracker,
  emptyPrototypeBuildState,
  emptyPrototypeLiveState,
  hasPrototypeBuildPlan,
  prototypeBuildScreen,
  readStreamingBuildPlan,
  type PrototypeBuildEvent,
  type PrototypeBuildState,
} from '../index.js';

const PLAN = [
  { screenId: 'SCR-A', screenName: '首页', purpose: '店长一进来就知道今天做什么' },
  { screenId: 'SCR-B', screenName: '订货单', purpose: '查找和跟进订货单' },
];

function fold(events: (PrototypeBuildEvent | null)[], from = emptyPrototypeBuildState()): PrototypeBuildState {
  let state = from;
  for (const ev of events) if (ev) state = applyPrototypeBuildEvent(state, ev);
  return state;
}

describe('readStreamingBuildPlan', () => {
  it('takes an item only once its id is complete', () => {
    expect(readStreamingBuildPlan({ screens: [{ screenId: 'SCR-OR' }] })).toEqual([]);
    expect(readStreamingBuildPlan({ screens: [{ screenId: 'SCR-ORDERS', screenName: '订' }] })).toEqual([
      { screenId: 'SCR-ORDERS', screenName: '订', purpose: '' },
    ]);
    expect(
      readStreamingBuildPlan({ screens: [{ screenId: 'SCR-A', screenName: '首页', purpose: 'x' }, { screenId: 'SCR' }] }),
    ).toEqual([{ screenId: 'SCR-A', screenName: '首页', purpose: 'x' }]);
  });

  it('ignores junk and duplicate ids', () => {
    expect(readStreamingBuildPlan(undefined)).toEqual([]);
    expect(readStreamingBuildPlan({ screens: 'x' })).toEqual([]);
    expect(
      readStreamingBuildPlan({ screens: [null, { screenId: 'A', screenName: '1' }, { screenId: 'A', screenName: '2' }] }),
    ).toEqual([{ screenId: 'A', screenName: '1', purpose: '' }]);
  });
});

describe('prototype build tracker', () => {
  it('produces events that fold in the browser to the same state the engine keeps', () => {
    const tracker = createPrototypeBuildTracker({ now: () => new Date('2026-11-19T10:00:00Z') });
    const events = [
      tracker.start(),
      tracker.phase('plan', 'now'),
      tracker.plan(PLAN.slice(0, 1), true),
      tracker.plan(PLAN, false),
      tracker.phase('plan', 'done'),
      tracker.log({ agent: 0, kind: 'plan_ready', count: 2 }),
      tracker.screen('SCR-A', { status: 'writing', agent: 1 }),
      tracker.screen('SCR-A', { writtenElements: 3 }),
      tracker.screen('SCR-A', { status: 'done' }),
      tracker.screen('SCR-B', { status: 'failed', agent: 2, failure: 'validation_failed' }),
    ];
    const browser = fold(events);
    expect(browser).toEqual(tracker.state());
    expect(browser.plan.map((p) => p.screenId)).toEqual(['SCR-A', 'SCR-B']);
    expect(browser.planStreaming).toBe(false);
    expect(prototypeBuildScreen(browser, 'SCR-A')).toEqual({
      screenId: 'SCR-A',
      status: 'done',
      agent: 1,
      writtenElements: 3,
    });
    expect(prototypeBuildScreen(browser, 'SCR-B').failure).toBe('validation_failed');
    expect(browser.phases.plan.status).toBe('done');
    expect(browser.phases.style.status).toBe('not_started');
    expect(browser.log).toEqual([
      { id: 1, at: '2026-11-19T10:00:00.000Z', agent: 0, kind: 'plan_ready', count: 2 },
    ]);
    expect(hasPrototypeBuildPlan(browser)).toBe(true);
  });

  it('emits nothing when nothing changed, and clears a failure once the screen is retried', () => {
    const tracker = createPrototypeBuildTracker();
    tracker.start();
    expect(tracker.plan(PLAN, false)).not.toBeNull();
    expect(tracker.plan(PLAN, false)).toBeNull();
    tracker.screen('SCR-B', { status: 'failed', failure: 'not_written' });
    expect(tracker.screen('SCR-B', { status: 'failed', failure: 'not_written' })).toBeNull();
    tracker.screen('SCR-B', { status: 'writing' });
    expect(tracker.state().screens['SCR-B']!.failure).toBeUndefined();
    tracker.phase('style', 'skipped');
    expect(tracker.phase('style', 'skipped')).toBeNull();
  });

  it('continues a persisted build: the restart replaces the browser state and later events apply on top', () => {
    const first = createPrototypeBuildTracker();
    first.start();
    first.plan(PLAN, false);
    first.screen('SCR-A', { status: 'done', agent: 1 });
    first.screen('SCR-B', { status: 'failed', agent: 2, failure: 'validation_failed' });
    first.log({ agent: 2, kind: 'screen_failed', screenId: 'SCR-B', failure: 'validation_failed' });
    const persisted = first.state();

    const resumed = createPrototypeBuildTracker();
    const start = resumed.start(persisted);
    const retry = resumed.screen('SCR-B', { status: 'writing', agent: 1 });
    const log = resumed.log({ agent: 0, kind: 'screen_resumed', screenId: 'SCR-B' });

    // A browser holding some unrelated older build adopts the persisted base wholesale.
    const stale = fold([createPrototypeBuildTracker().start(), null]);
    const browser = fold([start, retry, log], stale);
    expect(browser.plan).toEqual(PLAN);
    expect(prototypeBuildScreen(browser, 'SCR-A').status).toBe('done');
    expect(prototypeBuildScreen(browser, 'SCR-B').status).toBe('writing');
    expect(browser.log.map((e) => [e.id, e.kind])).toEqual([
      [1, 'screen_failed'],
      [2, 'screen_resumed'],
    ]);
    expect(browser).toEqual(resumed.state());
  });

  it('ignores stale and replayed events (reconnect catch-up)', () => {
    const tracker = createPrototypeBuildTracker();
    const start = tracker.start();
    const early = tracker.screen('SCR-A', { status: 'writing' });
    const late = tracker.screen('SCR-A', { status: 'done' });
    const log = tracker.log({ agent: 1, kind: 'screen_done', screenId: 'SCR-A', count: 4 });
    const state = fold([start, late, early, log, log]);
    expect(state.screens['SCR-A']!.status).toBe('done');
    expect(state.log).toHaveLength(1);
  });
});

describe('build events in the live state and the canvas', () => {
  it('folds through applyPrototypeLiveEvent and puts each planned screen on the canvas at once, in plan order', () => {
    const tracker = createPrototypeBuildTracker();
    let live = emptyPrototypeLiveState();
    for (const ev of [tracker.start(), tracker.plan(PLAN, true)]) if (ev) live = applyPrototypeLiveEvent(live, ev);
    expect(live.build?.plan).toHaveLength(2);

    const model = buildPrototypeCanvasModel('', live, live.build);
    expect(model.screens.map((s) => [s.screenId, s.screenName, s.status, s.bodyHtml])).toEqual([
      ['SCR-A', '首页', 'queued', ''],
      ['SCR-B', '订货单', 'queued', ''],
    ]);
  });

  it('keeps plan order when screens land in a different order, and shows written screens', () => {
    const doc = `<!DOCTYPE html><html><head><style>.x{}</style></head><body><main>
<section data-screen-id="SCR-B" data-screen-name="订货单" data-screen-status="ready"><p>订单</p></section>
</main></body></html>`;
    const tracker = createPrototypeBuildTracker();
    tracker.start();
    tracker.plan(PLAN, false);
    const model = buildPrototypeCanvasModel(doc, null, tracker.state());
    expect(model.screens.map((s) => s.screenId)).toEqual(['SCR-A', 'SCR-B']);
    expect(model.screens[0]!.bodyHtml).toBe('');
    expect(model.screens[1]!.bodyHtml).toContain('<p>订单</p>');
  });
});

describe('countWrittenElements', () => {
  it('counts anchored elements', () => {
    expect(countWrittenElements('<div data-element-id="A"><button data-element-id="B">x</button></div>')).toBe(2);
    expect(countWrittenElements('<div>')).toBe(0);
  });
});
