// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPrototypeLiveEvent,
  createPrototypeBuildTracker,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
  type PrototypeBuildState,
  type PrototypeLiveState,
} from '../../../../packages/ontology-core/index.js';
import { checkBusinessViewMarkup } from '../../../../packages/business-vocabulary/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import { artboardRect } from './camera.js';
import { PrototypeLiveCanvas, type PrototypeLiveCanvasProps } from './PrototypeLiveCanvas.js';
import { PROTOTYPE_AGENT_CURSOR_STORAGE_KEY, type AgentLiveActivity } from './agentCursor.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLAN = [
  { screenId: 'SCR-HOME', screenName: '工作台首页', purpose: '店长看今日待办' },
  { screenId: 'SCR-ORDERS', screenName: '订货单列表', purpose: '查看和跟进订货单' },
];

const SHELL = `<!DOCTYPE html><html><head><style>.proto-screen{display:none}</style></head><body>
<header class="proto-topbar"><button type="button" data-element-id="EL-SHELL-TAB-SCR-HOME" data-nav-screen="SCR-HOME">首页</button></header>
<main id="proto-screens-root">
<section class="proto-screen" data-screen-id="SCR-HOME" data-screen-name="工作台首页" data-screen-type="DASHBOARD" data-screen-status="queued"></section>
<section class="proto-screen" data-screen-id="SCR-ORDERS" data-screen-name="订货单列表" data-screen-type="LIST" data-screen-status="queued"></section>
</main></body></html>`;

let host: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 35));
  });
}

function setViewportSize(w = 1200, h = 760) {
  const viewport = host.querySelector<HTMLElement>('[data-testid="prototype-canvas-viewport"]');
  if (viewport) {
    Object.defineProperty(viewport, 'clientWidth', { value: w, configurable: true });
    Object.defineProperty(viewport, 'clientHeight', { value: h, configurable: true });
  }
  const webPage = host.querySelector<HTMLElement>('[data-testid="prototype-web-page"]');
  if (webPage) {
    Object.defineProperty(webPage, 'clientWidth', { value: w, configurable: true });
    Object.defineProperty(webPage, 'clientHeight', { value: h, configurable: true });
  }
}

async function render(props: PrototypeLiveCanvasProps, viewportSize = { w: 1200, h: 760 }) {
  await act(async () => {
    root.render(
      <PreferencesProvider>
        <PrototypeLiveCanvas {...props} />
      </PreferencesProvider>,
    );
  });
  setViewportSize(viewportSize.w, viewportSize.h);
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
  });
  await settle();
}

/**
 * Installs realistic scroll-aware `getBoundingClientRect` on an element inside an iframe document:
 * just like a browser's layout engine, `top = docY - scrollingElement.scrollTop`,
 * `left = docX - scrollingElement.scrollLeft`.
 */
function mockElementLayout(
  frame: HTMLIFrameElement,
  elementId: string,
  box: { docX: number; docY: number; w: number; h: number },
): HTMLElement {
  const doc = frame.contentDocument!;
  const el = doc.querySelector<HTMLElement>(`[data-element-id="${elementId}"]`);
  if (!el) throw new Error(`Missing element ${elementId} in frame`);
  el.getBoundingClientRect = () => {
    const scroller = doc.scrollingElement ?? doc.documentElement;
    const left = box.docX - (scroller?.scrollLeft ?? 0);
    const top = box.docY - (scroller?.scrollTop ?? 0);
    return {
      x: left,
      y: top,
      left,
      top,
      width: box.w,
      height: box.h,
      right: left + box.w,
      bottom: top + box.h,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return el;
}

function buildStateForWriting(): { live: PrototypeLiveState; build: PrototypeBuildState; tracker: ReturnType<typeof createPrototypeLiveTracker> } {
  const tracker = createPrototypeLiveTracker();
  const bTracker = createPrototypeBuildTracker({ now: () => new Date('2026-11-19T10:00:00Z') });
  let live = emptyPrototypeLiveState();
  for (const ev of tracker.observeDocument(SHELL)) live = applyPrototypeLiveEvent(live, ev);
  for (const ev of [
    bTracker.start(),
    bTracker.plan(PLAN, false),
    bTracker.phase('plan', 'done'),
    bTracker.phase('screens', 'now'),
    bTracker.screen('SCR-HOME', { status: 'writing', agent: 1, writtenElements: 1 }),
    bTracker.screen('SCR-ORDERS', { status: 'writing', agent: 2, writtenElements: 1 }),
  ]) {
    if (ev) live = applyPrototypeLiveEvent(live, ev);
  }
  return { live, build: live.build!, tracker };
}

function readCam(): { x: number; y: number; k: number } {
  const world = host.querySelector<HTMLElement>('[data-testid="prototype-canvas-world"]')!;
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(world.style.transform);
  if (!m) throw new Error(`Unexpected world transform: ${world.style.transform}`);
  return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
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

describe('Real agent cursor, narration bubble, build log "现在" rows, and cursor menu (#92)', () => {
  it('places arrow cursor in theme colour + name tag + narration bubble on noted element, mirrors sentence into BuildLog "现在", and omits bubble when neither note nor heading exists', async () => {
    const { live: baseLive, tracker } = buildStateForWriting();
    let live = applyPrototypeLiveEvent(
      baseLive,
      tracker.observePartialScreen({
        screenId: 'SCR-HOME',
        screenName: '工作台首页',
        partialHtml: `<section class="page" data-element-id="EL-HOME-GREET" data-note="问候语：告诉店长今天最要紧的一件事。"><p>今天有 3 单货`,
      })!,
    );
    // SCR-ORDERS has an anchored button with NEITHER data-note NOR section heading
    live = applyPrototypeLiveEvent(
      live,
      tracker.observePartialScreen({
        screenId: 'SCR-ORDERS',
        screenName: '订货单列表',
        partialHtml: `<div class="toolbar"><button data-element-id="EL-PLAIN-ACT" data-element-type="BUTTON" data-element-label="导出">导出</button>`,
      })!,
    );

    await render({ documentHtml: '', live, build: live.build ?? null, busy: true });

    const homeFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-artboard-frame-SCR-HOME"]')!;
    const ordersFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-artboard-frame-SCR-ORDERS"]')!;
    mockElementLayout(homeFrame, 'EL-HOME-GREET', { docX: 40, docY: 80, w: 600, h: 60 });
    mockElementLayout(ordersFrame, 'EL-PLAIN-ACT', { docX: 60, docY: 50, w: 120, h: 36 });

    await act(async () => {
      homeFrame.contentWindow!.dispatchEvent(new Event('resize'));
      ordersFrame.contentWindow!.dispatchEvent(new Event('resize'));
    });
    await settle();

    // SCR-HOME cursor: default arrow, Helper 1 theme colour (var(--model-m2)), name tag "助手 1", narration bubble
    const homeCursor = host.querySelector<HTMLElement>('[data-testid="prototype-agent-cursor-SCR-HOME"]')!;
    expect(homeCursor).not.toBeNull();
    expect(homeCursor.getAttribute('data-cursor-style')).toBe('arrow');
    expect(homeCursor.textContent).toContain('助手 1');
    const homeBubble = host.querySelector<HTMLElement>('[data-testid="prototype-cursor-bubble-SCR-HOME"]')!;
    expect(homeBubble.textContent).toBe('正在画「问候语」：告诉店长今天最要紧的一件事。');

    // Exact same sentence appears in BuildLog "现在" row!
    const liveLogRows = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="prototype-build-log-live"]'));
    expect(liveLogRows).toHaveLength(1);
    expect(liveLogRows[0]!.textContent).toContain('现在');
    expect(liveLogRows[0]!.textContent).toContain('助手 1');
    expect(liveLogRows[0]!.textContent).toContain('正在画「问候语」：告诉店长今天最要紧的一件事。');

    // SCR-ORDERS cursor: lands on EL-PLAIN-ACT, has NO narration bubble and NO "现在" row!
    const ordersCursor = host.querySelector<HTMLElement>('[data-testid="prototype-agent-cursor-SCR-ORDERS"]')!;
    expect(ordersCursor).not.toBeNull();
    expect(host.querySelector('[data-testid="prototype-cursor-bubble-SCR-ORDERS"]')).toBeNull();

    expect(checkBusinessViewMarkup(host.innerHTML, { ignoreTestIds: ['prototype-canvas-world'] })).toEqual([]);
  });

  it('tracks the exact element position under canvas zoom, pan, AND iframe scroll (both canvas and web mode), and flips bubble left near right edge', async () => {
    const { live: baseLive, tracker } = buildStateForWriting();
    const live = applyPrototypeLiveEvent(
      baseLive,
      tracker.observePartialScreen({
        screenId: 'SCR-ORDERS',
        screenName: '订货单列表',
        partialHtml: `<section class="page" data-element-id="EL-ORDERS-TABLE" data-note="订货单表格：点任意一行查看明细。"><table><tr><td>DH-1025`,
      })!,
    );

    await render({ documentHtml: '', live, build: live.build ?? null, busy: true }, { w: 1200, h: 760 });
    setViewportSize(1200, 760);

    const ordersFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-artboard-frame-SCR-ORDERS"]')!;
    mockElementLayout(ordersFrame, 'EL-ORDERS-TABLE', { docX: 100, docY: 300, w: 400, h: 50 });

    await act(async () => {
      ordersFrame.contentWindow!.dispatchEvent(new Event('resize'));
    });
    await settle();

    // Expected anchor in frame coordinates: x = 100 + min(400*0.35, 220) = 240, y = 300 + (50 - 6) = 344
    const board = artboardRect(1); // SCR-ORDERS is slot 1
    const assertCanvasCoords = (expectedScrollTop: number) => {
      const cam = readCam();
      const cursor = host.querySelector<HTMLElement>('[data-testid="prototype-agent-cursor-SCR-ORDERS"]')!;
      const expectedLeft = cam.x + (board.x + 240) * cam.k;
      const expectedTop = cam.y + (board.y + (344 - expectedScrollTop)) * cam.k;
      expect(Number.parseFloat(cursor.style.left)).toBeCloseTo(expectedLeft, 2);
      expect(Number.parseFloat(cursor.style.top)).toBeCloseTo(expectedTop, 2);
    };

    assertCanvasCoords(0);

    // 1. Zoom in & pan the canvas via wheel events -> cursor coordinates scale and translate accurately
    const viewport = host.querySelector<HTMLElement>('[data-testid="prototype-canvas-viewport"]')!;
    await act(async () => {
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, ctrlKey: true, clientX: 600, clientY: 380, bubbles: true, cancelable: true }));
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaX: -120, deltaY: 50, bubbles: true, cancelable: true }));
    });
    await settle();
    assertCanvasCoords(0);

    // 2. Scroll inside the artboard iframe -> cursor moves by -scrollTop * cam.k
    const ordersDoc = ordersFrame.contentDocument!;
    ordersDoc.documentElement.scrollTop = 120;
    await act(async () => {
      ordersFrame.contentWindow!.dispatchEvent(new ordersDoc.defaultView!.Event('scroll'));
    });
    await settle();
    assertCanvasCoords(120);

    // 3. Pan cursor near the right edge of the 1200px viewport -> narration bubble flips left!
    const camNow = readCam();
    const currentLeft = camNow.x + (board.x + 240) * camNow.k;
    const shiftRight = 1050 - currentLeft; // puts cursor at x = 1050 (> 1200 - 320 = 880)
    await act(async () => {
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaX: -shiftRight, deltaY: 0, bubbles: true, cancelable: true }));
    });
    await settle();
    const cursorNearRight = host.querySelector<HTMLElement>('[data-testid="prototype-agent-cursor-SCR-ORDERS"]')!;
    expect(cursorNearRight.getAttribute('data-flip')).toBe('left');

    // 4. Switch to Web Mode -> cursor renders on SCR-ORDERS, tracks iframe scroll, and flips near right edge!
    await act(async () => {
      host.querySelector<HTMLElement>('[data-testid="prototype-dock-view-web"]')!.click();
    });
    await settle();
    setViewportSize(1000, 700);
    const select = host.querySelector<HTMLSelectElement>('[data-testid="prototype-web-page-select"]')!;
    await act(async () => {
      select.value = 'SCR-ORDERS';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();

    const webFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-web-frame"]')!;
    mockElementLayout(webFrame, 'EL-ORDERS-TABLE', { docX: 720, docY: 260, w: 200, h: 46 });
    await act(async () => {
      webFrame.contentWindow!.dispatchEvent(new Event('resize'));
    });
    await settle();

    // Anchor x = 720 + min(200*0.35, 220) = 790 (> 1000 - 320 = 680 -> flip left!), y = 260 + 40 = 300
    let webCursor = host.querySelector<HTMLElement>('[data-testid="prototype-web-agent-cursor"]')!;
    expect(webCursor).not.toBeNull();
    expect(Number.parseFloat(webCursor.style.left)).toBeCloseTo(790, 2);
    expect(Number.parseFloat(webCursor.style.top)).toBeCloseTo(300, 2);
    expect(webCursor.getAttribute('data-flip')).toBe('left');
    expect(host.querySelector('[data-testid="prototype-web-cursor-bubble"]')?.textContent).toBe(
      '正在画「订货单表格」：点任意一行查看明细。',
    );

    // Scroll the web page down by 90px -> cursor top moves from 300 to 210!
    webFrame.contentDocument!.documentElement.scrollTop = 90;
    await act(async () => {
      webFrame.contentWindow!.dispatchEvent(new webFrame.contentDocument!.defaultView!.Event('scroll'));
    });
    await settle();
    webCursor = host.querySelector<HTMLElement>('[data-testid="prototype-web-agent-cursor"]')!;
    expect(Number.parseFloat(webCursor.style.top)).toBeCloseTo(210, 2);
  });

  it('portals 「光标 ▾」 menu outside overflow-hidden viewport, persists style/names per device with storage fault tolerance, and supports #93 fixing activities', async () => {
    const { live: baseLive, tracker } = buildStateForWriting();
    let live = baseLive;
    for (const ev of tracker.observeDocument(
      SHELL.replace(
        'data-screen-id="SCR-HOME" data-screen-name="工作台首页" data-screen-type="DASHBOARD" data-screen-status="queued"></section>',
        'data-screen-id="SCR-HOME" data-screen-name="工作台首页" data-screen-type="DASHBOARD" data-screen-status="ready"><h1>早上好</h1><table data-element-id="EL-HOME-TBL"></table></section>',
      ),
    )) {
      live = applyPrototypeLiveEvent(live, ev);
    }

    const fixingActivity: AgentLiveActivity = {
      agent: 0,
      screenId: 'SCR-HOME',
      elementId: 'EL-HOME-TBL',
      sentence: '发现问题：表格右侧被截断，正在收窄列宽。',
      state: 'fixing',
    };

    await render({ documentHtml: '', live, build: live.build ?? null, busy: true, liveActivities: [fixingActivity] });

    const homeFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-artboard-frame-SCR-HOME"]')!;
    mockElementLayout(homeFrame, 'EL-HOME-TBL', { docX: 80, docY: 140, w: 500, h: 80 });
    await act(async () => {
      homeFrame.contentWindow!.dispatchEvent(new Event('resize'));
    });
    await settle();

    // #93 fixing state renders cursor with state="fixing", Lead assistant name, and "现在" row in BuildLog
    const fixCursor = host.querySelector<HTMLElement>('[data-testid="prototype-agent-cursor-SCR-HOME"]')!;
    expect(fixCursor.getAttribute('data-activity-state')).toBe('fixing');
    expect(fixCursor.textContent).toContain('主助手');
    expect(host.querySelector('[data-testid="prototype-cursor-bubble-SCR-HOME"]')?.textContent).toBe(
      '发现问题：表格右侧被截断，正在收窄列宽。',
    );
    expect(host.querySelector('[data-testid="prototype-build-log-live"]')?.textContent).toContain(
      '发现问题：表格右侧被截断，正在收窄列宽。',
    );

    // Open 「光标 ▾」 menu -> portaled to document.body, NOT inside prototype-canvas-viewport!
    const menuBtn = host.querySelector<HTMLElement>('[data-testid="prototype-dock-cursor"]')!;
    expect(menuBtn.textContent).toContain('光标');
    await act(async () => {
      menuBtn.click();
    });
    await settle();

    const viewport = host.querySelector<HTMLElement>('[data-testid="prototype-canvas-viewport"]')!;
    const menu = document.body.querySelector<HTMLElement>('[data-testid="prototype-cursor-menu"]')!;
    expect(menu).not.toBeNull();
    expect(viewport.contains(menu)).toBe(false);

    // Switch to pen nib and hide names
    await act(async () => {
      document.body.querySelector<HTMLElement>('[data-testid="prototype-cursor-style-nib"]')!.click();
    });
    await act(async () => {
      document.body.querySelector<HTMLElement>('[data-testid="prototype-cursor-show-names"]')!.click();
    });
    await settle();

    expect(fixCursor.getAttribute('data-cursor-style')).toBe('nib');
    expect(fixCursor.querySelector('[data-testid="prototype-cursor-name"]')).toBeNull();
    expect(JSON.parse(localStorage.getItem(PROTOTYPE_AGENT_CURSOR_STORAGE_KEY) ?? '{}')).toEqual({
      style: 'nib',
      showNames: false,
    });

    // Storage fault tolerance: throws on getItem / setItem without crashing
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    await act(async () => {
      document.body.querySelector<HTMLElement>('[data-testid="prototype-cursor-style-dot"]')!.click();
    });
    await settle();
    expect(fixCursor.getAttribute('data-cursor-style')).toBe('dot');
  });

  it('shows early screen-level note cursor before HTML arrives, clamps tall elements inside artboards, prevents narrow-viewport flip clipping, and meets 12px/mark-contrast rules', async () => {
    const { live: baseLive, tracker } = buildStateForWriting();
    // 1. SCR-HOME has ONLY a screen-level `note` and empty `partialHtml` (before HTML starts!)
    let live = applyPrototypeLiveEvent(
      baseLive,
      tracker.observePartialScreen({
        screenId: 'SCR-HOME',
        screenName: '工作台首页',
        note: '首页总览：店长一进门先看今日待办。',
        partialHtml: '',
      })!,
    );
    // 2. SCR-ORDERS has an element below the 860px artboard clip boundary (docY = 1120)
    live = applyPrototypeLiveEvent(
      live,
      tracker.observePartialScreen({
        screenId: 'SCR-ORDERS',
        screenName: '订货单列表',
        partialHtml: `<footer data-element-id="EL-DEEP-FOOTER" data-note="底部汇总：显示本月累计订货金额。">合计</footer>`,
      })!,
    );

    await render({ documentHtml: '', live, build: live.build ?? null, busy: true }, { w: 1200, h: 760 });
    const ordersFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-artboard-frame-SCR-ORDERS"]')!;
    mockElementLayout(ordersFrame, 'EL-DEEP-FOOTER', { docX: 200, docY: 1120, w: 300, h: 48 });
    await act(async () => {
      ordersFrame.contentWindow!.dispatchEvent(new Event('resize'));
    });
    await settle();

    // Early screen-level note renders cursor + bubble on SCR-HOME BEFORE any data-element-id exists!
    const earlyHomeCursor = host.querySelector<HTMLElement>('[data-testid="prototype-agent-cursor-SCR-HOME"]')!;
    expect(earlyHomeCursor).not.toBeNull();
    expect(host.querySelector('[data-testid="prototype-cursor-bubble-SCR-HOME"]')?.textContent).toBe(
      '正在画「首页总览」：店长一进门先看今日待办。',
    );

    // Tall element on SCR-ORDERS is clamped inside the 860px artboard height (never floating below the artboard!)
    const cam = readCam();
    const ordersBoard = artboardRect(1);
    const ordersCursor = host.querySelector<HTMLElement>('[data-testid="prototype-agent-cursor-SCR-ORDERS"]')!;
    const ordersTop = Number.parseFloat(ordersCursor.style.top);
    const maxArtboardBottom = cam.y + (ordersBoard.y + ordersBoard.h - 8) * cam.k;
    const minArtboardTop = cam.y + (ordersBoard.y + 8) * cam.k;
    expect(ordersTop).toBeLessThanOrEqual(maxArtboardBottom + 0.5);
    expect(ordersTop).toBeGreaterThanOrEqual(minArtboardTop - 0.5);

    // S-1, S-2, S-3 checks on BuildLogLiveRows and AgentCursor:
    // - Assistant name in BuildLogLiveRows uses a mark dot, NEVER inline `color` on text
    // - No `text-[11px]` in cursor or live log rows; no `font-mono` on "现在"
    const liveRow = host.querySelector<HTMLElement>('[data-testid="prototype-build-log-live"]')!;
    expect(liveRow.innerHTML).not.toContain('text-[11px]');
    expect(earlyHomeCursor.innerHTML).not.toContain('text-[11px]');
    const coloredSpansInLog = Array.from(liveRow.querySelectorAll<HTMLElement>('span')).filter(
      (s) => Boolean(s.style.color),
    );
    expect(coloredSpansInLog).toHaveLength(0);
    const nowLabel = Array.from(liveRow.querySelectorAll<HTMLElement>('span')).find(
      (s) => s.textContent?.trim() === '现在',
    )!;
    expect(nowLabel.className).not.toContain('font-mono');

    // Narrow viewport (360px) in web mode:
    // - Early screen-level note on SCR-HOME also renders in web mode!
    // - Cursor at left ~104 (< 360 - 104 = 256) does NOT flip left (`data-flip="right"`) and constrains maxWidth <= 360 - left - 32
    await act(async () => {
      host.querySelector<HTMLElement>('[data-testid="prototype-dock-view-web"]')!.click();
    });
    await settle();
    const select = host.querySelector<HTMLSelectElement>('[data-testid="prototype-web-page-select"]')!;
    await act(async () => {
      select.value = 'SCR-HOME';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    setViewportSize(360, 640);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    await settle();

    const webEarlyCursor = host.querySelector<HTMLElement>('[data-testid="prototype-web-agent-cursor"]')!;
    expect(webEarlyCursor).not.toBeNull();
    expect(webEarlyCursor.getAttribute('data-flip')).toBe('right');
    const webEarlyBubble = host.querySelector<HTMLElement>('[data-testid="prototype-web-cursor-bubble"]')!;
    expect(webEarlyBubble.textContent).toBe('正在画「首页总览」：店长一进门先看今日待办。');
    const leftPx = Number.parseFloat(webEarlyCursor.style.left);
    const maxW = Number.parseFloat(webEarlyBubble.style.maxWidth);
    expect(leftPx + 24 + maxW).toBeLessThanOrEqual(360 - 8 + 0.5);

    // Switch to SCR-ORDERS on the same 360px narrow viewport with element near right (docX = 240 -> anchorX = 282 > 360 - 282):
    // flips left (`data-flip="left"`) and constrains maxWidth so left edge >= 8!
    await act(async () => {
      select.value = 'SCR-ORDERS';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    const webFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-web-frame"]')!;
    mockElementLayout(webFrame, 'EL-DEEP-FOOTER', { docX: 240, docY: 160, w: 120, h: 36 });
    await act(async () => {
      webFrame.contentWindow!.dispatchEvent(new Event('resize'));
    });
    await settle();

    const webRightCursor = host.querySelector<HTMLElement>('[data-testid="prototype-web-agent-cursor"]')!;
    expect(webRightCursor.getAttribute('data-flip')).toBe('left');
    const webRightBubble = host.querySelector<HTMLElement>('[data-testid="prototype-web-cursor-bubble"]')!;
    const rightAnchorPx = Number.parseFloat(webRightCursor.style.left);
    const flippedMaxW = Number.parseFloat(webRightBubble.style.maxWidth);
    expect(rightAnchorPx - 6 - flippedMaxW).toBeGreaterThanOrEqual(8 - 0.5);
  });
});
