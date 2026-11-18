// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPrototypeLiveEvent,
  createPrototypeBuildTracker,
  emptyPrototypeLiveState,
  type PrototypeBuildState,
  type PrototypeLiveState,
} from '../../../../packages/ontology-core/index.js';
import { checkBusinessViewMarkup } from '../../../../packages/business-vocabulary/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import { PrototypeLiveCanvas, type PrototypeLiveCanvasProps } from './PrototypeLiveCanvas.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLAN = [
  { screenId: 'SCR-HOME', screenName: '工作台首页', purpose: '店长一进来就知道今天要处理什么' },
  { screenId: 'SCR-ORDERS', screenName: '订货单列表', purpose: '查找和跟进订货单（SCR-ORDERS）' },
  { screenId: 'SCR-REFUND', screenName: '退款审批', purpose: '店长决定是否同意退款' },
];

const DOC = `<!DOCTYPE html><html><head><style>.x{}</style></head><body><main id="proto-screens-root">
<section class="proto-screen" data-screen-id="SCR-HOME" data-screen-name="工作台首页" data-screen-status="ready"><h1>早上好</h1></section>
</main></body></html>`;

/** A build in the middle of things: plan done, home drawn, orders being written, refund failed. */
function midBuild(): PrototypeBuildState {
  const t = createPrototypeBuildTracker({ now: () => new Date('2026-11-19T09:30:05') });
  t.start();
  t.plan(PLAN, false);
  t.phase('plan', 'done');
  t.log({ agent: 0, kind: 'plan_ready', count: 3 });
  t.phase('style', 'skipped');
  t.phase('screens', 'now');
  t.screen('SCR-HOME', { status: 'done', agent: 1, writtenElements: 4 });
  t.log({ agent: 1, kind: 'screen_done', screenId: 'SCR-HOME', count: 4 });
  t.screen('SCR-ORDERS', { status: 'writing', agent: 2, writtenElements: 3 });
  t.log({ agent: 2, kind: 'screen_started', screenId: 'SCR-ORDERS' });
  t.screen('SCR-REFUND', { status: 'failed', agent: 3, failure: 'validation_failed' });
  t.log({ agent: 3, kind: 'screen_failed', screenId: 'SCR-REFUND', failure: 'validation_failed' });
  return t.state();
}

let host: HTMLDivElement;
let root: Root;

async function render(props: PrototypeLiveCanvasProps) {
  await act(async () => {
    root.render(
      <PreferencesProvider>
        <PrototypeLiveCanvas {...props} />
      </PreferencesProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

const q = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('Build Plan on the live canvas (#90)', () => {
  it('puts a blank artboard for every planned screen as soon as the plan arrives, in plan order', async () => {
    const t = createPrototypeBuildTracker();
    let live: PrototypeLiveState = emptyPrototypeLiveState();
    for (const ev of [t.start(), t.phase('plan', 'now'), t.plan(PLAN.slice(0, 2), true)]) {
      if (ev) live = applyPrototypeLiveEvent(live, ev);
    }
    await render({ documentHtml: '', live, build: live.build ?? null, busy: true, building: true });
    expect(host.querySelectorAll('[data-testid^="prototype-artboard-SCR-"]')).toHaveLength(2);
    expect(q('prototype-phase-plan')?.getAttribute('data-phase-status')).toBe('now');
    expect(q('prototype-strip-card-SCR-HOME')?.getAttribute('data-build-status')).toBe('queued');

    const more = t.plan(PLAN, true)!;
    live = applyPrototypeLiveEvent(live, more);
    await render({ documentHtml: '', live, build: live.build ?? null, busy: true, building: true });
    const order = Array.from(host.querySelectorAll('[data-testid^="prototype-strip-card-"]')).map((el) =>
      el.getAttribute('data-testid')!.replace('prototype-strip-card-', ''),
    );
    expect(order).toEqual(['SCR-HOME', 'SCR-ORDERS', 'SCR-REFUND']);
    expect(host.textContent).not.toContain('SCR-');
  });

  it('phase bar, log and strip report the real state, in business language, in both languages', async () => {
    const build = midBuild();
    await render({ documentHtml: DOC, build, busy: false, onRetryScreen: () => undefined });

    expect(q('prototype-phase-plan')?.getAttribute('data-phase-status')).toBe('done');
    expect(q('prototype-phase-style')?.getAttribute('data-phase-status')).toBe('skipped');
    expect(q('prototype-phase-screens')?.getAttribute('data-phase-status')).toBe('now');
    expect(q('prototype-phase-review')?.getAttribute('data-phase-status')).toBe('not_started');
    expect(q('prototype-phase-tours')?.getAttribute('data-phase-status')).toBe('not_started');
    expect(q('prototype-phase-screens')?.textContent).toContain('1/3');

    const entries = Array.from(host.querySelectorAll('[data-testid="prototype-build-log-entry"]'));
    expect(entries.map((e) => e.getAttribute('data-kind'))).toEqual([
      'plan_ready',
      'screen_done',
      'screen_started',
      'screen_failed',
    ]);
    expect(entries[1]!.textContent).toContain('09:30:05');
    expect(entries[1]!.textContent).toContain('助手 1');
    expect(entries[3]!.textContent).toContain('「退款审批」没画完：这一屏有按钮或输入框没有标注好');

    expect(q('prototype-strip-status-SCR-ORDERS')?.textContent).toBe('施工中 · 助手 2');
    expect(q('prototype-strip-card-SCR-ORDERS')?.textContent).toContain('已写 3 处');
    expect(q('prototype-strip-failure-SCR-REFUND')?.textContent).toBe('这一屏有按钮或输入框没有标注好，没能通过检查。');
    expect(q('prototype-artboard-owner-SCR-REFUND')?.textContent).toBe('没画完 · 助手 3');
    expect(q('artboard-retry-btn-SCR-REFUND')).not.toBeNull();
    expect(q('artboard-retry-btn-SCR-ORDERS')).toBeNull();
    expect(q('prototype-build-log-resume-SCR-REFUND')).not.toBeNull();
    expect(checkBusinessViewMarkup(host.innerHTML, { ignoreTestIds: ['prototype-canvas-world'] })).toEqual([]);
  });

  it('a screen being written shows no fill that could read as a percentage; queued shows no owner', async () => {
    const t = createPrototypeBuildTracker();
    t.start();
    t.plan(PLAN, false);
    t.screen('SCR-HOME', { status: 'writing', agent: 1 });
    t.screen('SCR-ORDERS', { status: 'writing', agent: 2, writtenElements: 3 });
    t.screen('SCR-REFUND', { status: 'queued' });
    await render({ documentHtml: '', build: t.state(), busy: true });
    expect(q('prototype-strip-fill-SCR-HOME')).toBeNull();
    expect(q('prototype-strip-fill-SCR-ORDERS')).toBeNull();
    expect(q('prototype-strip-written-SCR-HOME')?.textContent).toBe('正在写');
    expect(q('prototype-strip-written-SCR-ORDERS')?.textContent).toBe('已写 3 处');
    expect(q('prototype-strip-status-SCR-REFUND')?.textContent).toBe('排队中');
    expect(q('prototype-artboard-owner-SCR-REFUND')?.textContent).toBe('排队中');
    // The purpose tooltip is business text too.
    expect(q('prototype-strip-card-SCR-ORDERS')?.getAttribute('title')).not.toContain('SCR-');
  });

  it('「继续这一屏」 from the strip and from the log asks for exactly that screen; none while a run is going', async () => {
    const onRetryScreen = vi.fn();
    await render({ documentHtml: DOC, build: midBuild(), busy: false, onRetryScreen });
    await act(async () => q('artboard-retry-btn-SCR-REFUND')!.click());
    await act(async () => q('prototype-build-log-resume-SCR-REFUND')!.click());
    expect(onRetryScreen.mock.calls).toEqual([
      ['SCR-REFUND', '退款审批'],
      ['SCR-REFUND', '退款审批'],
    ]);

    await render({ documentHtml: DOC, build: midBuild(), busy: true, onRetryScreen });
    expect(q('artboard-retry-btn-SCR-REFUND')).toBeNull();
    expect(q('prototype-build-log-resume-SCR-REFUND')).toBeNull();
  });

  it('clicking a log line or a card focuses that screen; double-clicking a card tries it', async () => {
    await render({ documentHtml: DOC, build: midBuild(), busy: false });
    const viewport = q('prototype-canvas-viewport')!;
    Object.defineProperty(viewport, 'clientWidth', { value: 1200, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: 700, configurable: true });
    window.dispatchEvent(new Event('resize'));

    const failLine = host.querySelector<HTMLElement>('[data-testid="prototype-build-log-entry"][data-kind="screen_failed"] button')!;
    await act(async () => failLine.click());
    expect(viewport.getAttribute('data-following')).toBe('false');

    await act(async () => {
      q('prototype-strip-card-SCR-HOME')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(viewport.getAttribute('data-trying')).toBe('SCR-HOME');
  });

  it('English labels', async () => {
    localStorage.setItem('onto_locale', 'en-US');
    try {
      await render({ documentHtml: DOC, build: midBuild(), busy: false, onRetryScreen: () => undefined });
      expect(q('prototype-phase-review')?.textContent).toContain('Screenshot check');
      expect(q('prototype-strip-status-SCR-ORDERS')?.textContent).toBe('Building · Helper 2');
      expect(q('artboard-retry-btn-SCR-REFUND')?.textContent).toContain('Continue this screen');
      expect(host.textContent).toContain('is not finished: Some buttons or fields');
    } finally {
      localStorage.removeItem('onto_locale');
    }
  });

  it('keyboard on a strip card: Enter tries the screen, Space focuses it', async () => {
    await render({ documentHtml: DOC, build: midBuild(), busy: false });
    const viewport = q('prototype-canvas-viewport')!;
    const cardEl = q('prototype-strip-card-SCR-HOME')!;
    expect(cardEl.getAttribute('tabindex')).toBe('0');
    await act(async () => {
      cardEl.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(viewport.getAttribute('data-following')).toBe('false');
    expect(viewport.getAttribute('data-trying')).toBe('');
    await act(async () => {
      cardEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(viewport.getAttribute('data-trying')).toBe('SCR-HOME');
  });

  it('in web mode a build log line opens that page, like a strip card', async () => {
    try {
      await render({ documentHtml: DOC, build: midBuild(), busy: false });
      await act(async () => q('prototype-dock-view-web')!.click());
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(q('prototype-canvas-viewport')?.getAttribute('data-view')).toBe('web');
      const homeLine = host.querySelector<HTMLElement>(
        '[data-testid="prototype-build-log-entry"][data-screen-id="SCR-HOME"] button',
      )!;
      await act(async () => homeLine.click());
      expect(q('prototype-web-view')?.getAttribute('data-web-screen')).toBe('SCR-HOME');
      const ordersLine = host.querySelector<HTMLElement>(
        '[data-testid="prototype-build-log-entry"][data-screen-id="SCR-ORDERS"] button',
      )!;
      await act(async () => ordersLine.click());
      expect(q('prototype-web-view')?.getAttribute('data-web-screen')).toBe('SCR-ORDERS');
    } finally {
      localStorage.clear();
    }
  });
});
