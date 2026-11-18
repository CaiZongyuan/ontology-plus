// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPrototypeLiveEvent,
  buildPrototypeCanvasModel,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
  type PrototypeLiveState,
} from '../../../../packages/ontology-core/index.js';
import { checkBusinessViewMarkup } from '../../../../packages/business-vocabulary/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import { PrototypeLiveCanvas, type PrototypeLiveCanvasProps } from './PrototypeLiveCanvas.js';
import { PrototypeWebView, type PrototypeWebViewHandle } from './PrototypeWebView.js';
import { PROTOTYPE_VIEW_STORAGE_KEY } from './prototypeView.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function doc(screenC = '<h2>新建订货单</h2>', statusC = 'ready'): string {
  return `<!DOCTYPE html><html><head><style>.proto-screen{display:none}</style></head><body>
<header class="proto-topbar"><button type="button" data-nav-screen="SCR-A">首页</button><button type="button" data-nav-screen="SCR-B">订单</button></header>
<main id="proto-screens-root">
<section class="proto-screen" data-screen-id="SCR-A" data-screen-name="工作台首页" data-screen-type="DASHBOARD" data-screen-status="ready"><h1>早上好</h1><button type="button" data-element-id="EL-GO" data-navigate-to="SCR-B">去订单</button></section>
<section class="proto-screen" data-screen-id="SCR-B" data-screen-name="订货单列表" data-screen-type="LIST" data-screen-status="ready"><h2>订货单</h2><p data-element-id="EL-ROW">DH-1025</p></section>
<section class="proto-screen" data-screen-id="SCR-C" data-screen-name="新建订货单" data-screen-type="FORM" data-screen-status="${statusC}">${screenC}</section>
</main></body></html>`;
}
const SAVED = doc();

let host: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

async function render(props: PrototypeLiveCanvasProps) {
  await act(async () => {
    root.render(
      <PreferencesProvider>
        <PrototypeLiveCanvas {...props} />
      </PreferencesProvider>,
    );
  });
  await settle();
}

const q = <T extends Element = HTMLElement>(testId: string) => host.querySelector<T>(`[data-testid="${testId}"]`);
const webFrame = () => q<HTMLIFrameElement>('prototype-web-frame')!;
/** The screens the web page shows (the shell's `is-active` convention). */
const shown = () =>
  Array.from(webFrame().contentDocument!.querySelectorAll('[data-screen-id].is-active')).map((el) =>
    el.getAttribute('data-screen-id'),
  );
const webScreen = () => q('prototype-web-view')?.getAttribute('data-web-screen');

async function click(el: Element | null) {
  if (!el) throw new Error('missing element');
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

async function selectPage(screenId: string) {
  const select = q<HTMLSelectElement>('prototype-web-page-select')!;
  await act(async () => {
    select.value = screenId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
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

describe('画板 / 网页 switch', () => {
  it('starts on artboards the first time, switches to web, and remembers the choice on this device', async () => {
    await render({ documentHtml: SAVED, live: null });
    const viewport = q('prototype-canvas-viewport')!;
    expect(viewport.getAttribute('data-view')).toBe('artboards');
    expect(q('prototype-dock-view-artboards')!.getAttribute('aria-pressed')).toBe('true');
    expect(q('prototype-web-view')).toBeNull();

    await click(q('prototype-dock-view-web'));
    expect(viewport.getAttribute('data-view')).toBe('web');
    expect(q('prototype-dock-view-web')!.getAttribute('aria-pressed')).toBe('true');
    expect(q('prototype-web-view')).not.toBeNull();
    expect(q('prototype-dock-zoom-in')).toBeNull(); // canvas-only controls step aside
    expect(localStorage.getItem(PROTOTYPE_VIEW_STORAGE_KEY)).toBe('web');
    expect(checkBusinessViewMarkup(host.innerHTML)).toHaveLength(0);

    // the artboards stay loaded underneath: switching back reloads nothing
    const artboard = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-artboard-frame-SCR-A"]')!;
    await click(q('prototype-dock-view-artboards'));
    expect(host.querySelector('[data-testid="prototype-artboard-frame-SCR-A"]')).toBe(artboard);
    expect(artboard.getAttribute('data-load-count')).toBe('1');

    // a fresh canvas on this device opens the way it was left
    await click(q('prototype-dock-view-web'));
    await act(async () => root.unmount());
    root = createRoot(host);
    await render({ documentHtml: SAVED, live: null });
    expect(q('prototype-canvas-viewport')!.getAttribute('data-view')).toBe('web');
  });

  it('still works when the browser refuses storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    await render({ documentHtml: SAVED, live: null });
    expect(q('prototype-canvas-viewport')!.getAttribute('data-view')).toBe('artboards');
    await click(q('prototype-dock-view-web'));
    expect(q('prototype-canvas-viewport')!.getAttribute('data-view')).toBe('web');
  });
});

describe('web mode pages', () => {
  it('changes pages in one load-once frame: links, page select, back and forward; each page starts at the top', async () => {
    localStorage.setItem(PROTOTYPE_VIEW_STORAGE_KEY, 'web');
    await render({ documentHtml: SAVED, live: null });
    const frame = webFrame();
    expect(frame.style.width).toBe('100%');
    expect(webScreen()).toBe('SCR-A');
    const inner = frame.contentDocument!;
    expect(shown()).toEqual(['SCR-A']);
    // the web frame has its own test id; the hidden canvas keeps its artboard frames
    expect(host.querySelectorAll('[data-testid="prototype-artboard-frame-SCR-A"]')).toHaveLength(1);
    expect(q('prototype-web-back')!.hasAttribute('disabled')).toBe(true);

    // a link inside the prototype
    inner.documentElement.scrollTop = 400;
    await act(async () => {
      inner.querySelector<HTMLElement>('[data-navigate-to="SCR-B"]')!.dispatchEvent(
        new inner.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    await settle();
    expect(webScreen()).toBe('SCR-B');
    expect(webFrame()).toBe(frame);
    expect(frame.contentDocument).toBe(inner);
    expect(frame.getAttribute('data-load-count')).toBe('1');
    expect(shown()).toEqual(['SCR-B']);
    expect(inner.documentElement.scrollTop).toBe(0);
    expect(inner.querySelector('[data-nav-screen="SCR-B"]')!.classList.contains('is-active')).toBe(true);

    // the page select
    await selectPage('SCR-C');
    expect(webScreen()).toBe('SCR-C');
    expect(shown()).toEqual(['SCR-C']);

    // back, back, forward
    await click(q('prototype-web-back'));
    expect(webScreen()).toBe('SCR-B');
    await click(q('prototype-web-back'));
    expect(webScreen()).toBe('SCR-A');
    expect(q('prototype-web-back')!.hasAttribute('disabled')).toBe(true);
    await click(q('prototype-web-forward'));
    expect(webScreen()).toBe('SCR-B');
    // a new page drops the forward history
    await selectPage('SCR-A');
    expect(q('prototype-web-forward')!.hasAttribute('disabled')).toBe(true);
    expect(frame.getAttribute('data-load-count')).toBe('1');
  });

  it('during a build follows the page being drawn, says it is being drawn, and stops following on a manual page change', async () => {
    localStorage.setItem(PROTOTYPE_VIEW_STORAGE_KEY, 'web');
    const tracker = createPrototypeLiveTracker();
    let state: PrototypeLiveState = emptyPrototypeLiveState();
    for (const ev of tracker.observeDocument(doc('<p>排队中</p>', 'queued'))) state = applyPrototypeLiveEvent(state, ev);
    state = applyPrototypeLiveEvent(state, tracker.observePartialScreen({ screenId: 'SCR-C', partialHtml: '<h2>新建订' })!);
    await render({ documentHtml: '', live: state, busy: true, building: true });

    expect(webScreen()).toBe('SCR-C');
    expect(q('prototype-web-drawing')).not.toBeNull();
    expect(webFrame().contentDocument!.body.textContent).toContain('新建订');
    expect(q('prototype-canvas-viewport')!.getAttribute('data-following')).toBe('true');

    await selectPage('SCR-A');
    expect(webScreen()).toBe('SCR-A');
    expect(q('prototype-web-drawing')).toBeNull();
    expect(q('prototype-canvas-viewport')!.getAttribute('data-following')).toBe('false');

    // following again from the dock brings the page being drawn back
    await click(q('prototype-dock-follow'));
    expect(webScreen()).toBe('SCR-C');
  });

  it('offers 继续这一屏 on a page that was not finished once nothing is running', async () => {
    localStorage.setItem(PROTOTYPE_VIEW_STORAGE_KEY, 'web');
    const onRetryScreen = vi.fn();
    const unfinished = doc('<p>排队中</p>', 'queued');
    await render({ documentHtml: unfinished, live: null, busy: true, onRetryScreen });
    await selectPage('SCR-C');
    expect(q('prototype-web-retry-SCR-C')).toBeNull();
    await render({ documentHtml: unfinished, live: null, busy: false, onRetryScreen });
    await click(q('prototype-web-retry-SCR-C'));
    expect(onRetryScreen).toHaveBeenCalledWith('SCR-C', '新建订货单');
  });

  it('opens the composed document (live draft included) in a new tab on the page shown', async () => {
    localStorage.setItem(PROTOTYPE_VIEW_STORAGE_KEY, 'web');
    const onOpenStandalone = vi.fn(() => true);
    const tracker = createPrototypeLiveTracker();
    let state: PrototypeLiveState = emptyPrototypeLiveState();
    for (const ev of tracker.observeDocument(doc('<p>排队中</p>', 'queued'))) state = applyPrototypeLiveEvent(state, ev);
    state = applyPrototypeLiveEvent(
      state,
      tracker.observePartialScreen({ screenId: 'SCR-C', partialHtml: '<h2>新建订货单</h2><p>挑选商品</p>' })!,
    );
    await render({ documentHtml: '', live: state, busy: true, onOpenStandalone });
    await click(q('prototype-web-open-standalone'));
    expect(onOpenStandalone).toHaveBeenCalledTimes(1);
    const [html, screenId] = onOpenStandalone.mock.calls[0]! as unknown as [string, string];
    expect(screenId).toBe('SCR-C');
    // one document with every screen and the shell's own navigation
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('挑选商品');
    expect(html).toContain('data-screen-id="SCR-A"');
    expect(html).toContain('data-screen-id="SCR-B"');
    expect(html).toContain('data-nav-screen="SCR-B"');
  });

  it('suggests web mode in the build log when a build finishes', async () => {
    const tracker = createPrototypeLiveTracker();
    let state: PrototypeLiveState = emptyPrototypeLiveState();
    for (const ev of tracker.observeDocument(doc('<p>排队中</p>', 'queued'))) state = applyPrototypeLiveEvent(state, ev);
    state = applyPrototypeLiveEvent(state, tracker.observePartialScreen({ screenId: 'SCR-C', partialHtml: '<h2>新' })!);
    await render({ documentHtml: '', live: state, busy: true, building: true });
    expect(q('prototype-web-mode-hint')).toBeNull();
    await render({ documentHtml: SAVED, live: null, busy: false });
    const log = q('prototype-build-log')!;
    expect(log.querySelector('[data-testid="prototype-web-mode-hint"]')).not.toBeNull();
    await click(q('prototype-web-mode-hint-try'));
    expect(q('prototype-canvas-viewport')!.getAttribute('data-view')).toBe('web');
    expect(q('prototype-web-mode-hint')).toBeNull();
  });
});

describe('web mode handle (for design notes and demo tours)', () => {
  it('reports element boxes on the page and scrolls an off-screen element into view', async () => {
    const model = buildPrototypeCanvasModel(SAVED, null);
    const ref = createRef<PrototypeWebViewHandle>();
    await act(async () => {
      root.render(
        <PreferencesProvider>
          <PrototypeWebView
            ref={ref}
            screens={model.screens}
            css={model.css}
            linksKey=""
            headScriptsKey=""
            nameOf={(b) => b.screenName}
            composeDocument={() => SAVED}
            pageBodyHtml={model.pageBodyHtml}
            pageCss={model.pageCss}
            onOpenStandalone={() => true}
          />
        </PreferencesProvider>,
      );
    });
    await settle();
    expect(ref.current!.screenId()).toBe('SCR-A');
    expect(ref.current!.rectOf('EL-GO')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(ref.current!.rectOf('EL-MISSING')).toBeNull();

    await act(async () => ref.current!.show('SCR-B'));
    await settle();
    expect(ref.current!.screenId()).toBe('SCR-B');
    const row = webFrame().contentDocument!.querySelector<HTMLElement>('[data-element-id="EL-ROW"]')!;
    row.getBoundingClientRect = () => ({ top: 2000, bottom: 2040, left: 10, right: 200, width: 190, height: 40 }) as DOMRect;
    const scrolled = vi.fn();
    row.scrollIntoView = scrolled;
    expect(ref.current!.reveal('EL-ROW')).toEqual({ x: 10, y: 2000, w: 190, h: 40 });
    expect(scrolled).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
  });
});

describe('#97 review fixes', () => {
  /** Page B's script binds directly to its own button when the document loads. */
  const WITH_SCRIPT = SAVED.replace('<p data-element-id="EL-ROW">DH-1025</p>', '<p data-element-id="EL-ROW">DH-1025</p><button type="button" id="b-btn">筛选</button><span id="b-count">0</span><input id="b-input">').replace(
    '</main>',
    '</main><script data-screen-js="SCR-B">document.getElementById("b-btn").addEventListener("click", function () { document.body.setAttribute("data-filtered", "yes"); document.getElementById("b-count").textContent = "1"; });</script>',
  );

  it('a script bound directly on page B works after navigating A → B, and what was typed stays with its page', async () => {
    localStorage.setItem(PROTOTYPE_VIEW_STORAGE_KEY, 'web');
    await render({ documentHtml: WITH_SCRIPT, live: null });
    const frame = webFrame();
    const inner = frame.contentDocument!;
    expect(shown()).toEqual(['SCR-A']);
    await act(async () => {
      inner.querySelector<HTMLElement>('[data-navigate-to="SCR-B"]')!.dispatchEvent(
        new inner.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    await settle();
    expect(shown()).toEqual(['SCR-B']);
    inner.getElementById('b-btn')!.click();
    expect(inner.body.getAttribute('data-filtered')).toBe('yes');
    (inner.getElementById('b-input') as HTMLInputElement).value = 'DH-10';
    await selectPage('SCR-A');
    expect(inner.querySelector('[data-screen-id="SCR-A"] #b-input')).toBeNull(); // nothing carried onto A
    await click(q('prototype-web-back'));
    expect(shown()).toEqual(['SCR-B']);
    expect((inner.getElementById('b-input') as HTMLInputElement).value).toBe('DH-10');
    expect(inner.getElementById('b-count')!.textContent).toBe('1'); // a page change re-renders nothing
    expect(inner.body.getAttribute('data-filtered')).toBe('yes');
    expect(frame.getAttribute('data-load-count')).toBe('1');
  });

  it('one click on a shell tab with an inline onclick is one history entry; back and forward go A ↔ B', async () => {
    localStorage.setItem(PROTOTYPE_VIEW_STORAGE_KEY, 'web');
    const withOnclick = SAVED.replace(
      '<button type="button" data-nav-screen="SCR-B">',
      `<button type="button" data-nav-screen="SCR-B" onclick="window.__selectProtoScreen('SCR-B')">`,
    );
    await render({ documentHtml: withOnclick, live: null });
    const inner = webFrame().contentDocument!;
    await act(async () => {
      inner.querySelector<HTMLElement>('[data-nav-screen="SCR-B"]')!.click();
    });
    await settle();
    expect(webScreen()).toBe('SCR-B');
    await click(q('prototype-web-back'));
    expect(webScreen()).toBe('SCR-A');
    expect(q('prototype-web-back')!.hasAttribute('disabled')).toBe(true); // exactly one entry
    await click(q('prototype-web-forward'));
    expect(webScreen()).toBe('SCR-B');
    expect(q('prototype-web-forward')!.hasAttribute('disabled')).toBe(true);
  });

  it('in web mode a screen-strip card shows that page (one history entry) and the shown page’s card is highlighted', async () => {
    localStorage.setItem(PROTOTYPE_VIEW_STORAGE_KEY, 'web');
    await render({ documentHtml: SAVED, live: null });
    const card = (sid: string) => q(`prototype-strip-card-${sid}`)!;
    expect(card('SCR-A').className).toContain('border-primary');
    await click(card('SCR-C').querySelector('button'));
    expect(webScreen()).toBe('SCR-C');
    expect(card('SCR-C').className).toContain('border-primary');
    expect(card('SCR-A').className).not.toContain('border-primary');
    await click(q('prototype-web-back'));
    expect(webScreen()).toBe('SCR-A');
    expect(q('prototype-web-back')!.hasAttribute('disabled')).toBe(true);
  });

  it('does not suggest web mode when a run ends with screens left unfinished', async () => {
    const tracker = createPrototypeLiveTracker();
    let state: PrototypeLiveState = emptyPrototypeLiveState();
    for (const ev of tracker.observeDocument(doc('<p>排队中</p>', 'queued'))) state = applyPrototypeLiveEvent(state, ev);
    state = applyPrototypeLiveEvent(state, tracker.observePartialScreen({ screenId: 'SCR-C', partialHtml: '<h2>新' })!);
    await render({ documentHtml: '', live: state, busy: true, building: true });
    const partway = doc('<p>排队中</p>', 'queued');
    await render({ documentHtml: partway, live: null, busy: false });
    expect(q('prototype-web-mode-hint')).toBeNull();
    // finishing that screen later (继续这一屏) does
    await render({ documentHtml: partway, live: state, busy: true });
    await render({ documentHtml: SAVED, live: null, busy: false });
    expect(q('prototype-web-mode-hint')?.getAttribute('role')).toBe('status');
  });

  it('switching to web while trying a screen opens that screen', async () => {
    await render({ documentHtml: SAVED, live: null });
    await act(async () => {
      q('prototype-artboard-SCR-B')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(q('prototype-canvas-viewport')!.getAttribute('data-trying')).toBe('SCR-B');
    await click(q('prototype-dock-view-web'));
    expect(webScreen()).toBe('SCR-B');
  });

  it('holds the hidden artboards while web mode is open and catches them up on return', async () => {
    const tracker = createPrototypeLiveTracker();
    let state: PrototypeLiveState = emptyPrototypeLiveState();
    for (const ev of tracker.observeDocument(doc('<p>排队中</p>', 'queued'))) state = applyPrototypeLiveEvent(state, ev);
    state = applyPrototypeLiveEvent(state, tracker.observePartialScreen({ screenId: 'SCR-C', partialHtml: '<h2>新建' })!);
    await render({ documentHtml: '', live: state, busy: true });
    const boardC = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-artboard-frame-SCR-C"]')!;
    await click(q('prototype-dock-view-web'));
    state = applyPrototypeLiveEvent(
      state,
      tracker.observePartialScreen({ screenId: 'SCR-C', partialHtml: '<h2>新建订货单</h2><p>挑选商品</p>' })!,
    );
    await render({ documentHtml: '', live: state, busy: true });
    expect(webFrame().contentDocument!.body.textContent).toContain('挑选商品');
    expect(boardC.contentDocument!.body.textContent).not.toContain('挑选商品');
    await click(q('prototype-dock-view-artboards'));
    expect(boardC.contentDocument!.body.textContent).toContain('挑选商品');
    expect(boardC.getAttribute('data-load-count')).toBe('1');
  });

  it('says so when there is nothing to open in a new tab', async () => {
    localStorage.setItem(PROTOTYPE_VIEW_STORAGE_KEY, 'web');
    await render({ documentHtml: SAVED, live: null, onOpenStandalone: () => false });
    expect(q('prototype-web-open-failed')).toBeNull();
    await click(q('prototype-web-open-standalone'));
    expect(q('prototype-web-open-failed')?.getAttribute('role')).toBe('status');
  });
});
