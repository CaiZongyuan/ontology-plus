// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPrototypeLiveEvent,
  createPrototypeBuildTracker,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
  writePrototypeDemoTours,
  type PrototypeBuildState,
  type PrototypeDemoTour,
} from '../../../../packages/ontology-core/index.js';
import { checkBusinessViewMarkup } from '../../../../packages/business-vocabulary/index.js';
import { initPrototypeShell, upsertPrototypeScreen } from '../../../../packages/agent-runtime/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import { PrototypeLiveCanvas, type PrototypeLiveCanvasProps } from './PrototypeLiveCanvas.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOURS: PrototypeDemoTour[] = [
  {
    id: 'first-order',
    goal: '门店第一次订货',
    audience: '店长',
    steps: [
      {
        screenId: 'SCR-HOME',
        elementId: 'EL-HOME-GREET',
        action: 'look',
        caption: '王店长早上打开工作台，先看今天要处理什么。',
      },
      {
        screenId: 'SCR-HOME',
        elementId: 'EL-HOME-NEW-ORDER',
        action: 'click',
        caption: '发现可颂快卖完了，点「新建订单」开始订货。',
      },
      {
        screenId: 'SCR-NEW-ORDER',
        elementId: 'EL-NEW-SEARCH',
        action: 'type',
        text: '可颂',
        caption: '在商品搜索里输入要订的商品。',
      },
      {
        screenId: 'SCR-NEW-ORDER',
        elementId: 'EL-NEW-INC',
        action: 'click',
        times: 3,
        caption: '把黄油可颂加到 3 箱。',
      },
      {
        screenId: 'SCR-NEW-ORDER',
        elementId: 'EL-NEW-SUBMIT',
        action: 'click',
        caption: '确认无误，提交订货单。',
      },
    ],
  },
  {
    id: 'morning-check',
    goal: '早班核对待办',
    audience: '店长',
    steps: [
      {
        screenId: 'SCR-HOME',
        elementId: 'EL-HOME-GREET',
        action: 'look',
        caption: '查看今日待收货与退款提醒。',
      },
      {
        screenId: 'SCR-ORDER-DETAIL',
        elementId: 'EL-DETAIL-TIMELINE',
        action: 'look',
        caption: '跟踪配送进度。',
      },
    ],
  },
];

function createSamplePrototypeDocument(): string {
  const shell = initPrototypeShell({
    appTitle: '禾木烘焙 · 门店订货',
    screens: [
      { screenId: 'SCR-HOME', screenName: '工作台首页', screenType: 'DASHBOARD' },
      { screenId: 'SCR-NEW-ORDER', screenName: '新建订货单', screenType: 'FORM' },
      { screenId: 'SCR-ORDER-DETAIL', screenName: '订货单详情', screenType: 'DETAIL' },
    ],
  });
  const withHome = upsertPrototypeScreen(shell.nextHtml, {
    screenId: 'SCR-HOME',
    screenName: '工作台首页',
    screenType: 'DASHBOARD',
    screenHtml: `<div data-element-id="EL-HOME-GREET" data-element-type="CONTAINER" data-element-label="问候语">早上好，王店长</div>
      <button type="button" data-element-id="EL-HOME-NEW-ORDER" data-element-type="BUTTON" data-element-label="新建订单" data-navigate-to="SCR-NEW-ORDER">新建订单</button>`,
  });
  const withOrder = upsertPrototypeScreen(withHome.nextHtml, {
    screenId: 'SCR-NEW-ORDER',
    screenName: '新建订货单',
    screenType: 'FORM',
    extraJs: `document.addEventListener('click', function (event) {
      var btn = event.target && event.target.closest ? event.target.closest('[data-inc]') : null;
      if (!btn) return;
      var qty = screen.querySelector('[data-qty]');
      if (qty) qty.textContent = String(Number(qty.textContent || '0') + 1);
    });`,
    screenHtml: `<input data-element-id="EL-NEW-SEARCH" data-element-type="INPUT" data-element-label="商品搜索" placeholder="搜索商品" />
      <div class="stepper"><span data-qty>0</span><button type="button" data-inc data-element-id="EL-NEW-INC" data-element-type="BUTTON" data-element-label="增加数量">+</button></div>
      <button type="button" data-element-id="EL-NEW-SUBMIT" data-element-type="BUTTON" data-element-label="提交订货" data-navigate-to="SCR-ORDER-DETAIL">提交订货单</button>`,
  });
  const withDetail = upsertPrototypeScreen(withOrder.nextHtml, {
    screenId: 'SCR-ORDER-DETAIL',
    screenName: '订货单详情',
    screenType: 'DETAIL',
    screenHtml: `<div data-element-id="EL-DETAIL-TIMELINE" data-element-type="CONTAINER" data-element-label="进度">已发车 · 预计 09:30 到店</div>`,
  });
  return writePrototypeDemoTours(withDetail.nextHtml, TOURS);
}

function createFinishedBuild(): PrototypeBuildState {
  const t = createPrototypeBuildTracker({ now: () => new Date('2026-11-19T10:00:00Z') });
  t.start();
  t.plan(
    [
      { screenId: 'SCR-HOME', screenName: '工作台首页', purpose: '查看今日待办' },
      { screenId: 'SCR-NEW-ORDER', screenName: '新建订货单', purpose: '挑选商品并提交' },
      { screenId: 'SCR-ORDER-DETAIL', screenName: '订货单详情', purpose: '查看配送进度' },
    ],
    false,
  );
  t.phase('plan', 'done');
  t.phase('style', 'done');
  t.phase('screens', 'done');
  t.screen('SCR-HOME', { status: 'done', agent: 1, writtenElements: 2, reviewed: 'pass' });
  t.screen('SCR-NEW-ORDER', { status: 'done', agent: 2, writtenElements: 3, reviewed: 'pass' });
  t.screen('SCR-ORDER-DETAIL', { status: 'done', agent: 3, writtenElements: 1, reviewed: 'pass' });
  t.phase('review', 'done');
  t.phase('tours', 'done');
  t.log({ agent: 0, kind: 'tours_ready', count: 2 });
  t.log({ agent: 0, kind: 'build_finished', count: 3, failedCount: 0 });
  return t.state();
}

const FAST_TIMING = {
  screenSwitchMs: 10,
  cursorMoveMs: 0,
  clickDelayMs: 8,
  typeCharMs: 4,
  lookDwellMs: 25,
  actionDwellMs: 25,
};

let host: HTMLDivElement;
let root: Root;

async function wait(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function installFrameBoxes(rootDoc: ParentNode) {
  const elements = rootDoc.querySelectorAll<HTMLElement>('[data-element-id]');
  elements.forEach((el, idx) => {
    const topBase = el.getAttribute('data-element-id') === 'EL-NEW-SUBMIT' ? 1400 : 80 + idx * 60;
    el.getBoundingClientRect = () => {
      const scroller = el.ownerDocument.scrollingElement ?? el.ownerDocument.documentElement;
      const top = topBase - (scroller?.scrollTop ?? 0);
      return {
        x: 64,
        y: top,
        left: 64,
        top,
        width: 180,
        height: 40,
        right: 244,
        bottom: top + 40,
        toJSON: () => ({}),
      } as DOMRect;
    };
  });
}

async function renderCanvas(props: PrototypeLiveCanvasProps) {
  await act(async () => {
    root.render(
      <PreferencesProvider>
        <PrototypeLiveCanvas {...props} demoTourTiming={FAST_TIMING} />
      </PreferencesProvider>,
    );
  });
  await wait(35);
  const viewport = host.querySelector<HTMLElement>('[data-testid="prototype-canvas-viewport"]');
  if (viewport) {
    Object.defineProperty(viewport, 'clientWidth', { value: 1200, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: 760, configurable: true });
  }
  for (const iframe of Array.from(host.querySelectorAll<HTMLIFrameElement>('iframe'))) {
    if (iframe.contentDocument) installFrameBoxes(iframe.contentDocument);
  }
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
  });
  await wait(20);
}

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('Demo Tour Player (#95, #88 verdict A + B combined)', () => {
  it('shows 演示路线已就绪 without autoplaying, portals the tour menu outside overflow containers, switches sidebar to script, performs real DOM actions, and restores BuildLog on exit', async () => {
    const html = createSamplePrototypeDocument();
    const build = createFinishedBuild();
    await renderCanvas({ documentHtml: html, build, viewMode: 'business' });

    // 1. Shows 演示路线已就绪 in both phase bar and build log; never autoplays
    expect(host.querySelector('[data-testid="prototype-phase-tours"]')?.textContent).toContain('演示路线已就绪');
    expect(host.querySelector('[data-testid="prototype-build-log"]')?.textContent).toContain('演示路线已就绪');
    expect(host.querySelector('[data-testid="demo-tour-player-bar"]')).toBeNull();
    expect(host.querySelector('[data-testid="demo-tour-script-panel"]')).toBeNull();

    // 2. Clicking ▶ 播放演示 opens the menu portaled onto document.body (outside host / phase bar!)
    const playBtn = host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-play-trigger"]')!;
    expect(playBtn).not.toBeNull();
    expect(playBtn.textContent).toContain('播放演示');

    await act(async () => {
      playBtn.click();
    });
    const menu = document.body.querySelector<HTMLElement>('[data-testid="demo-tour-menu"]')!;
    expect(menu).not.toBeNull();
    expect(host.contains(menu)).toBe(false); // strictly portaled outside the phase bar / canvas host!
    expect(menu.textContent).toContain('门店第一次订货');
    expect(menu.textContent).toContain('早班核对待办');
    expect(checkBusinessViewMarkup(menu.innerHTML)).toEqual([]);

    // 3. Pick the first tour -> plays through all 5 steps, mutating real iframe DOM
    const firstOption = menu.querySelector<HTMLButtonElement>('[data-testid="demo-tour-option-first-order"]')!;
    await act(async () => {
      firstOption.click();
    });
    await wait(15);

    // Right panel switched from BuildLog to step script
    expect(host.querySelector('[data-testid="prototype-build-log"]')).toBeNull();
    const scriptPanel = host.querySelector<HTMLElement>('[data-testid="demo-tour-script-panel"]')!;
    expect(scriptPanel).not.toBeNull();
    expect(scriptPanel.querySelectorAll('[data-testid^="demo-tour-step-"]')).toHaveLength(5);
    expect(host.querySelector('[data-testid="demo-tour-spotlight"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="demo-tour-caption"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="demo-tour-player-bar"]')).not.toBeNull();

    // Let the fast tour play to completion
    await wait(280);
    const playerBar = host.querySelector<HTMLElement>('[data-testid="demo-tour-player-bar"]')!;
    expect(playerBar.getAttribute('data-tour-completed')).toBe('true');
    expect(host.querySelector('[data-testid="demo-tour-progress"]')?.textContent).toContain('5 / 5');

    // Verify real DOM mutations happened on SCR-NEW-ORDER's iframe!
    const orderFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-artboard-frame-SCR-NEW-ORDER"]')!;
    const searchInput = orderFrame.contentDocument!.querySelector<HTMLInputElement>('[data-element-id="EL-NEW-SEARCH"]')!;
    const qtySpan = orderFrame.contentDocument!.querySelector<HTMLElement>('[data-qty]')!;
    expect(searchInput.value).toBe('可颂');
    expect(qtySpan.textContent).toBe('3');

    // 4. Replay resets DOM deterministically (`[data-qty]` stays '3', never '6'), and paused stepping preserves `paused`!
    const replayBtn = host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-pause-toggle"]')!;
    expect(replayBtn.textContent).toContain('重播');
    await act(async () => {
      replayBtn.click();
    });
    await wait(320);
    expect(playerBar.getAttribute('data-tour-completed')).toBe('true');
    expect(searchInput.value).toBe('可颂');
    expect(qtySpan.textContent).toBe('3');

    // Jump to step 2 (index 1, before typing/incrementing), pause, and verify DOM reset cleanly to initial state
    const step2Btn = scriptPanel.querySelector<HTMLButtonElement>('[data-testid="demo-tour-step-1"]')!;
    await act(async () => {
      step2Btn.click();
    });
    const pauseBtn = host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-pause-toggle"]')!;
    if (playerBar.getAttribute('data-tour-paused') !== 'true') {
      await act(async () => {
        pauseBtn.click();
      });
    }
    await wait(30);
    expect(playerBar.getAttribute('data-tour-paused')).toBe('true');
    expect(host.querySelector('[data-testid="demo-tour-progress"]')?.textContent).toContain('2 / 5');
    expect(searchInput.value).toBe('');
    expect(qtySpan.textContent).toBe('0');

    // Clicking `‹ 上一步` while paused keeps `data-tour-paused="true"` and does not auto-advance
    const prevBtn = host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-prev"]')!;
    await act(async () => {
      prevBtn.click();
    });
    await wait(80);
    expect(playerBar.getAttribute('data-tour-paused')).toBe('true');
    expect(host.querySelector('[data-testid="demo-tour-progress"]')?.textContent).toContain('1 / 5');

    // Clicking `下一步 ›` while paused also keeps `data-tour-paused="true"`
    const nextBtn = host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-next"]')!;
    await act(async () => {
      nextBtn.click();
    });
    await wait(80);
    expect(playerBar.getAttribute('data-tour-paused')).toBe('true');
    expect(host.querySelector('[data-testid="demo-tour-progress"]')?.textContent).toContain('2 / 5');

    // Jumping forward while paused fast-applies steps 0..3 (`可颂` + `3`) and stays paused on step 5!
    const step5Btn = scriptPanel.querySelector<HTMLButtonElement>('[data-testid="demo-tour-step-4"]')!;
    await act(async () => {
      step5Btn.click();
    });
    await wait(40);
    expect(playerBar.getAttribute('data-tour-paused')).toBe('true');
    expect(host.querySelector('[data-testid="demo-tour-progress"]')?.textContent).toContain('5 / 5');
    expect(searchInput.value).toBe('可颂');
    expect(qtySpan.textContent).toBe('3');

    // 5. Exiting restores BuildLog on the right sidebar
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-exit"]')!.click();
    });
    expect(host.querySelector('[data-testid="demo-tour-player-bar"]')).toBeNull();
    expect(host.querySelector('[data-testid="demo-tour-script-panel"]')).toBeNull();
    expect(host.querySelector('[data-testid="prototype-build-log"]')).not.toBeNull();
  });

  it('plays in web mode (#97): genuinely switches pages on navigation clicks and scrolls off-screen elements into view', async () => {
    const html = createSamplePrototypeDocument();
    const build = createFinishedBuild();
    await renderCanvas({ documentHtml: html, build, viewMode: 'business' });

    // Switch to web mode
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="prototype-dock-view-web"]')!.click();
    });
    await wait(35);

    const webFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-web-frame"]')!;
    installFrameBoxes(webFrame.contentDocument!);
    const submitBtn = webFrame.contentDocument!.querySelector<HTMLElement>('[data-element-id="EL-NEW-SUBMIT"]')!;
    const scrollSpy = vi.fn(function (this: HTMLElement) {
      const scroller = this.ownerDocument.scrollingElement ?? this.ownerDocument.documentElement;
      if (scroller) scroller.scrollTop = 1200;
    });
    submitBtn.scrollIntoView = scrollSpy;

    // Start first-order tour in web mode
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-play-trigger"]')!.click();
    });
    const option = document.body.querySelector<HTMLButtonElement>('[data-testid="demo-tour-option-first-order"]')!;
    await act(async () => {
      option.click();
    });

    await wait(320);

    // Clicking EL-NEW-SUBMIT (data-navigate-to="SCR-ORDER-DETAIL") genuinely navigated Web mode to SCR-ORDER-DETAIL!
    const webView = host.querySelector<HTMLElement>('[data-testid="prototype-web-view"]')!;
    expect(webView.getAttribute('data-web-screen')).toBe('SCR-ORDER-DETAIL');
    // Off-screen EL-NEW-SUBMIT (docY=1400 > innerHeight) triggered scrollIntoView!
    expect(scrollSpy).toHaveBeenCalled();
    expect(
      webFrame.contentDocument!.querySelector<HTMLInputElement>('[data-element-id="EL-NEW-SEARCH"]')!.value,
    ).toBe('可颂');
  });

  it('supports en-US locale, immediate live-frame tour availability before save, screen-level spotlight, and Escape exit', async () => {
    localStorage.setItem('onto_locale', 'en-US');
    const fullHtml = createSamplePrototypeDocument();
    const withoutTours = writePrototypeDemoTours(fullHtml, []);
    const screenLevelTours: PrototypeDemoTour[] = [
      {
        id: 'overview',
        goal: 'Morning Store Overview',
        audience: 'Store Manager',
        steps: [
          {
            screenId: 'SCR-HOME',
            action: 'look',
            caption: 'Open the morning dashboard to review urgent store tasks.',
          },
          {
            screenId: 'SCR-ORDER-DETAIL',
            elementId: 'EL-DETAIL-TIMELINE',
            action: 'look',
            caption: 'Check the cold-chain delivery ETA.',
          },
        ],
      },
      {
        id: 'quick-order',
        goal: 'Place First Order',
        steps: [
          {
            screenId: 'SCR-HOME',
            elementId: 'EL-HOME-NEW-ORDER',
            action: 'click',
            caption: 'Start a replenishment order.',
          },
        ],
      },
    ];
    const liveTracker = createPrototypeLiveTracker();
    liveTracker.reset(withoutTours);
    const liveEvents = liveTracker.observeDocument(writePrototypeDemoTours(withoutTours, screenLevelTours));
    const live = liveEvents.reduce(applyPrototypeLiveEvent, emptyPrototypeLiveState());
    const build = createFinishedBuild();

    await renderCanvas({ documentHtml: withoutTours, live, build, viewMode: 'business' });

    // English labels, never "Scenario"
    expect(host.querySelector('[data-testid="prototype-phase-tours"]')?.textContent).toContain('Demo tours ready');
    expect(host.querySelector('[data-testid="prototype-build-log"]')?.textContent).toContain('Demo tours ready');
    const playBtn = host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-play-trigger"]')!;
    expect(playBtn.textContent).toContain('Play Demo');
    expect(host.textContent).not.toContain('Scenario');

    await act(async () => {
      playBtn.click();
    });
    const menu = document.body.querySelector<HTMLElement>('[data-testid="demo-tour-menu"]')!;
    expect(menu.textContent).toContain('Pick a Demo Tour to play');
    expect(menu.textContent).not.toContain('Scenario');

    await act(async () => {
      menu.querySelector<HTMLButtonElement>('[data-testid="demo-tour-option-overview"]')!.click();
    });
    await wait(20);

    // Screen-level step (no elementId) frames the screen with spotlight & English chrome
    expect(host.querySelector('[data-testid="demo-tour-spotlight"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="demo-tour-script-panel"]')?.textContent).toContain('Demo Tour');
    expect(host.querySelector('[data-testid="demo-tour-player-bar"]')?.textContent).toContain('Previous');
    expect(host.querySelector('[data-testid="demo-tour-player-bar"]')?.textContent).toContain('Exit');
    expect(checkBusinessViewMarkup(host.innerHTML, { ignoreTestIds: ['prototype-canvas-world'] })).toEqual([]);

    // Pressing Escape exits the Demo Tour and restores BuildLog
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(host.querySelector('[data-testid="demo-tour-player-bar"]')).toBeNull();
    expect(host.querySelector('[data-testid="prototype-build-log"]')).not.toBeNull();
  });

  it('tracks live scroll/resize while paused, prevents [data-navigate-to] spotlight bleed, clamps canvas bounds, and meets contrast/single-accent/glossary rules', async () => {
    const rawHtml = createSamplePrototypeDocument();
    const edgeTours: PrototypeDemoTour[] = [
      ...TOURS,
      {
        id: 'id-guard',
        goal: 'SCR-HOME EL-RAW-ID',
        audience: 'EL-AUDIENCE-ID',
        steps: [
          {
            screenId: 'SCR-UNKNOWN-FALLBACK',
            action: 'look',
            caption: 'SCR-HOME EL-HOME-GREET 核对提醒',
          },
        ],
      },
    ];
    const html = writePrototypeDemoTours(rawHtml, edgeTours);
    const build = createFinishedBuild();
    await renderCanvas({ documentHtml: html, build, viewMode: 'business' });

    // S-2: Play trigger is NOT `accent` (`bg-primary text-primary-foreground`)
    const playBtn = host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-play-trigger"]')!;
    expect(playBtn.className).not.toContain('bg-primary ');

    // Start in Canvas mode with an oversized element on SCR-HOME and verify clamping within artboard bounds
    const homeFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-artboard-frame-SCR-HOME"]')!;
    const greetEl = homeFrame.contentDocument!.querySelector<HTMLElement>('[data-element-id="EL-HOME-GREET"]')!;
    greetEl.getBoundingClientRect = () =>
      ({
        x: -100,
        y: -50,
        left: -100,
        top: -50,
        width: 2000,
        height: 1500,
        right: 1900,
        bottom: 1450,
        toJSON: () => ({}),
      }) as DOMRect;

    await act(async () => {
      playBtn.click();
    });
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="demo-tour-option-first-order"]')!.click();
    });
    await wait(25);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-pause-toggle"]')!.click();
    });

    // S-4: Sidebar aria-label uses 演示路线步骤 (never 脚本 / script)
    const scriptAside = host.querySelector<HTMLElement>('[data-testid="demo-tour-script-panel"]')!;
    expect(scriptAside.getAttribute('aria-label')).toBe('演示路线步骤');
    // S-1: Selected step row on bg-primary-soft never uses text-muted-foreground
    const activeStepRow = scriptAside.querySelector<HTMLElement>('[data-testid="demo-tour-step-0"]')!;
    expect(activeStepRow.querySelector('.text-muted-foreground')).toBeNull();
    // S-2: Pause button is not `accent`
    expect(host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-pause-toggle"]')!.className).not.toContain(
      'bg-primary ',
    );

    // Canvas spotlight width/height clamped to artboard * zoom (`<= Math.round(1280 * k)` / `<= Math.round(860 * k)`)
    const zoom = Number(
      host.querySelector<HTMLElement>('[data-testid="prototype-canvas-viewport"]')!.getAttribute('data-zoom'),
    );
    const canvasSpot = host.querySelector<HTMLElement>('[data-testid="demo-tour-spotlight"]')!;
    expect(parseFloat(canvasSpot.style.width)).toBeLessThanOrEqual(Math.ceil(1280 * zoom));
    expect(parseFloat(canvasSpot.style.height)).toBeLessThanOrEqual(Math.ceil(860 * zoom));

    // S-3: Raw technical IDs never leak in menu or step panel
    await act(async () => {
      playBtn.click();
    });
    const menu = document.body.querySelector<HTMLElement>('[data-testid="demo-tour-menu"]')!;
    expect(menu.querySelector('[data-testid="demo-tour-option-first-order"] .text-muted-foreground')).toBeNull();
    expect(menu.textContent).not.toContain('SCR-HOME');
    expect(menu.textContent).not.toContain('EL-RAW-ID');
    await act(async () => {
      menu.querySelector<HTMLButtonElement>('[data-testid="demo-tour-option-id-guard"]')!.click();
    });
    await wait(20);
    expect(host.querySelector('[data-testid="demo-tour-script-panel"]')?.textContent).not.toContain(
      'SCR-UNKNOWN-FALLBACK',
    );

    // Switch to Web mode: verify live scroll tracking while paused AND zero [data-navigate-to] spotlight bleed!
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-dock-exit"]')?.click();
      host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-exit"]')!.click();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="prototype-dock-view-web"]')!.click();
    });
    await wait(30);
    const webFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-web-frame"]')!;
    installFrameBoxes(webFrame.contentDocument!);

    // Start first-order, pause on Step 2 (index 1, `[data-navigate-to="SCR-NEW-ORDER"]` on `SCR-HOME`)
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-play-trigger"]')!.click();
    });
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[data-testid="demo-tour-option-first-order"]')!.click();
    });
    await wait(15);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-pause-toggle"]')!.click();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-step-1"]')!.click();
    });
    await wait(30);

    // On Step 2 while paused: still on SCR-HOME before navigation click, spotlight matches active web screen!
    const webView = host.querySelector<HTMLElement>('[data-testid="prototype-web-view"]')!;
    expect(webView.getAttribute('data-web-screen')).toBe('SCR-HOME');
    expect(host.querySelector('[data-testid="demo-tour-spotlight"]')?.getAttribute('data-screen-id')).toBe('SCR-HOME');

    // Step to Step 3 (index 2: `EL-NEW-SEARCH` on `SCR-NEW-ORDER`) while paused, then scroll iframe and verify live tracking!
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="demo-tour-step-2"]')!.click();
    });
    await wait(35);
    expect(webView.getAttribute('data-web-screen')).toBe('SCR-NEW-ORDER');
    const spotBeforeScroll = host.querySelector<HTMLElement>('[data-testid="demo-tour-spotlight"]')!.style.transform;
    const cursorBeforeScroll = host.querySelector<HTMLElement>('[data-testid="demo-tour-cursor"]')!.style.transform;

    await act(async () => {
      const scroller = webFrame.contentDocument!.scrollingElement ?? webFrame.contentDocument!.documentElement;
      scroller.scrollTop = 60;
      webFrame.contentDocument!.dispatchEvent(new Event('scroll'));
    });
    await wait(15);

    const spotAfterScroll = host.querySelector<HTMLElement>('[data-testid="demo-tour-spotlight"]')!.style.transform;
    const cursorAfterScroll = host.querySelector<HTMLElement>('[data-testid="demo-tour-cursor"]')!.style.transform;
    expect(spotAfterScroll).not.toBe(spotBeforeScroll);
    expect(cursorAfterScroll).not.toBe(cursorBeforeScroll);
  });
});
