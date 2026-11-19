// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPrototypeLiveEvent,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
  type PrototypeLiveState,
} from '../../../../packages/ontology-core/index.js';
import { checkBusinessViewMarkup } from '../../../../packages/business-vocabulary/index.js';
import { contrastRatio } from '../../../../packages/workbench-theme/index.js';
import { PreferencesProvider, usePreferences } from '../../../i18n.js';
import { PrototypeLiveCanvas, type PrototypeLiveCanvasProps } from './PrototypeLiveCanvas.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ANNOTATED_DOC = `<!DOCTYPE html><html><head><style>.proto-screen{display:none}</style></head><body>
<header class="proto-topbar"><button type="button" data-nav-screen="SCR-PLAIN">无说明屏</button><button type="button" data-nav-screen="SCR-HOME">首页</button></header>
<main id="proto-screens-root">
<section class="proto-screen" data-screen-id="SCR-PLAIN" data-screen-name="空白封面" data-screen-type="DASHBOARD" data-screen-status="ready">
  <h1 data-element-id="EL-PLAIN-TITLE">欢迎进入系统</h1>
</section>
<section class="proto-screen" data-screen-id="SCR-HOME" data-screen-name="工作台首页" data-screen-type="DASHBOARD" data-screen-status="ready">
  <section class="page" data-element-id="EL-HOME-GREET" data-note="问候语：告诉店长今天最要紧的一件事。">
    <h1 id="greet-heading">早上好，王店长</h1>
    <button type="button" data-element-id="EL-HOME-NEW-ORDER" data-note="新建订单：店长发现缺货时，从这里开始订货。" onclick="document.body.setAttribute('data-clicked', 'yes')">新建订单</button>
  </section>
</section>
</main><script>window.__ready = true;</script></body></html>`;

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

function LocaleHarness({
  locale = 'zh-CN',
  workbenchTheme,
  theme,
  props,
}: {
  locale?: 'zh-CN' | 'en-US';
  workbenchTheme?: 'default' | 'warm-paper';
  theme?: 'light' | 'dark' | 'system';
  props: PrototypeLiveCanvasProps;
}) {
  const { setLocale, setWorkbenchTheme, setTheme } = usePreferences();
  React.useLayoutEffect(() => {
    setLocale(locale);
    if (workbenchTheme) setWorkbenchTheme(workbenchTheme);
    if (theme) setTheme(theme);
  }, [locale, setLocale, setTheme, setWorkbenchTheme, theme, workbenchTheme]);
  return <PrototypeLiveCanvas {...props} />;
}

async function render(
  props: PrototypeLiveCanvasProps,
  options: {
    locale?: 'zh-CN' | 'en-US';
    workbenchTheme?: 'default' | 'warm-paper';
    theme?: 'light' | 'dark' | 'system';
    viewport?: { w: number; h: number };
  } = {},
) {
  await act(async () => {
    root.render(
      <PreferencesProvider>
        <LocaleHarness
          locale={options.locale ?? 'zh-CN'}
          {...(options.workbenchTheme ? { workbenchTheme: options.workbenchTheme } : {})}
          {...(options.theme ? { theme: options.theme } : {})}
          props={props}
        />
      </PreferencesProvider>,
    );
  });
  const vp = options.viewport ?? { w: 1200, h: 760 };
  setViewportSize(vp.w, vp.h);
  await act(async () => {
    window.dispatchEvent(new Event('resize'));
  });
  await settle();
}

function installHomeBoxes(doc: Document) {
  const assign = (selector: string, box: { x: number; y: number; w: number; h: number }) => {
    const el = doc.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.getBoundingClientRect = () => {
      const scroller = doc.scrollingElement ?? doc.documentElement;
      const left = box.x - (scroller?.scrollLeft ?? 0);
      const top = box.y - (scroller?.scrollTop ?? 0);
      return {
        x: left,
        y: top,
        left,
        top,
        right: left + box.w,
        bottom: top + box.h,
        width: box.w,
        height: box.h,
      } as DOMRect;
    };
  };
  assign('[data-element-id="EL-HOME-GREET"]', { x: 0, y: 56, w: 1280, h: 112 });
  assign('#greet-heading', { x: 28, y: 78, w: 260, h: 40 });
  assign('[data-element-id="EL-HOME-NEW-ORDER"]', { x: 1130, y: 88, w: 112, h: 36 });
}

beforeEach(() => {
  localStorage.clear();
  // Enable reduced motion by default in jsdom so camera moves settle deterministically in 0ms
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('DesignNotesOverlay (#94): 设计说明 / Design Notes in canvas and web modes', () => {
  it('toggles 设计说明 / Design Notes on the dock, frames the first screen with notes, renders unnumbered handwritten callouts + arrows + selective outlines, and keeps prototype interactive', async () => {
    await render({ documentHtml: ANNOTATED_DOC, live: null, viewMode: 'business' });

    const homeFrame = host.querySelector<HTMLIFrameElement>(
      '[data-testid="prototype-artboard-frame-SCR-HOME"]',
    )!;
    installHomeBoxes(homeFrame.contentDocument!);

    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="prototype-dock-design-notes"]')!;
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toContain('设计说明');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('[data-testid="prototype-design-notes-overlay-SCR-HOME"]')).toBeNull();

    const viewport = host.querySelector<HTMLElement>('[data-testid="prototype-canvas-viewport"]')!;
    const overviewZoom = Number(viewport.getAttribute('data-zoom'));

    // Turn Design Notes ON: camera frames SCR-HOME (skipping SCR-PLAIN which has no notes!)
    await act(async () => {
      toggle.click();
    });
    await settle();

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const framedZoom = Number(viewport.getAttribute('data-zoom'));
    expect(framedZoom).toBeGreaterThan(overviewZoom);
    expect(viewport.getAttribute('data-following')).toBe('false');

    const overlay = host.querySelector<HTMLElement>(
      '[data-testid="prototype-design-notes-overlay-SCR-HOME"]',
    )!;
    expect(overlay).not.toBeNull();
    expect(overlay.className).toContain('pointer-events-none');

    // Full-row EL-HOME-GREET (w=1280) gets NO dashed outline; compact button EL-HOME-NEW-ORDER DOES get one
    expect(host.querySelector('[data-testid="prototype-design-note-outline-EL-HOME-GREET"]')).toBeNull();
    expect(
      host.querySelector('[data-testid="prototype-design-note-outline-EL-HOME-NEW-ORDER"]'),
    ).not.toBeNull();

    // Handwritten callouts & curved arrows exist, with zero numbered badges
    const greetNote = host.querySelector<HTMLElement>(
      '[data-testid="prototype-design-note-EL-HOME-GREET"]',
    )!;
    const orderNote = host.querySelector<HTMLElement>(
      '[data-testid="prototype-design-note-EL-HOME-NEW-ORDER"]',
    )!;
    expect(greetNote.textContent).toContain('告诉店长今天最要紧的一件事');
    expect(orderNote.textContent).toContain('店长发现缺货时，从这里开始订货');
    expect(greetNote.className).toContain('font-annotation');
    expect(
      host.querySelector('[data-testid="prototype-design-note-arrow-EL-HOME-NEW-ORDER"] path'),
    ).not.toBeNull();
    expect(checkBusinessViewMarkup(host.innerHTML)).toHaveLength(0);

    const firstCoords = {
      greet: { left: greetNote.style.left, top: greetNote.style.top, width: greetNote.style.width },
      order: { left: orderNote.style.left, top: orderNote.style.top, width: orderNote.style.width },
    };

    // Toggle OFF and back ON -> coordinates are 100% deterministic
    await act(async () => toggle.click());
    expect(host.querySelector('[data-testid="prototype-design-notes-overlay-SCR-HOME"]')).toBeNull();
    await act(async () => toggle.click());
    const greetNoteAgain = host.querySelector<HTMLElement>(
      '[data-testid="prototype-design-note-EL-HOME-GREET"]',
    )!;
    const orderNoteAgain = host.querySelector<HTMLElement>(
      '[data-testid="prototype-design-note-EL-HOME-NEW-ORDER"]',
    )!;
    expect({
      greet: {
        left: greetNoteAgain.style.left,
        top: greetNoteAgain.style.top,
        width: greetNoteAgain.style.width,
      },
      order: {
        left: orderNoteAgain.style.left,
        top: orderNoteAgain.style.top,
        width: orderNoteAgain.style.width,
      },
    }).toEqual(firstCoords);

    // Enter try-out mode while Design Notes stays ON: prototype buttons remain clickable!
    await act(async () => {
      host
        .querySelector<HTMLElement>('[data-testid="prototype-artboard-SCR-HOME"]')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(homeFrame.style.pointerEvents).toBe('auto');
    await act(async () => {
      homeFrame.contentDocument!
        .querySelector<HTMLElement>('[data-element-id="EL-HOME-NEW-ORDER"]')!
        .click();
    });
    expect(homeFrame.contentDocument!.body.getAttribute('data-clicked')).toBe('yes');

    // Bilingual en-US label check
    await render({ documentHtml: ANNOTATED_DOC, live: null }, { locale: 'en-US' });
    expect(
      host.querySelector('[data-testid="prototype-dock-design-notes"]')?.textContent,
    ).toContain('Design Notes');
  });

  it('updates Design Notes live during streaming generation and works in Web mode (#97) with scroll translation', async () => {
    const shell = `<!DOCTYPE html><html><head><style>.proto-screen{display:none}</style></head><body>
      <main id="proto-screens-root">
        <section class="proto-screen" data-screen-id="SCR-HOME" data-screen-name="工作台首页" data-screen-status="queued"></section>
      </main></body></html>`;
    const tracker = createPrototypeLiveTracker();
    let state: PrototypeLiveState = emptyPrototypeLiveState();
    for (const ev of tracker.observeDocument(shell)) state = applyPrototypeLiveEvent(state, ev);

    await render({ documentHtml: '', live: state, busy: true, building: true });

    // Turn Design Notes ON mid-build BEFORE any element has streamed in
    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="prototype-dock-design-notes"]')!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    // Stream an annotated element into SCR-HOME
    state = applyPrototypeLiveEvent(
      state,
      tracker.observePartialScreen({
        screenId: 'SCR-HOME',
        partialHtml: `<div class="row"><button data-element-id="EL-STREAM-BTN" data-note="实时按钮：边生成就能看到说明。">立即补货</button>`,
      })!,
    );
    await render({ documentHtml: '', live: state, busy: true, building: true });

    const frame = host.querySelector<HTMLIFrameElement>(
      '[data-testid="prototype-artboard-frame-SCR-HOME"]',
    )!;
    const streamBtn = frame.contentDocument!.querySelector<HTMLElement>(
      '[data-element-id="EL-STREAM-BTN"]',
    )!;
    streamBtn.getBoundingClientRect = () =>
      ({ x: 80, y: 120, left: 80, top: 120, right: 200, bottom: 156, width: 120, height: 36 }) as DOMRect;
    await act(async () => {
      frame.contentWindow!.dispatchEvent(new Event('resize'));
    });
    await settle();

    expect(
      host.querySelector('[data-testid="prototype-design-note-EL-STREAM-BTN"]')?.textContent,
    ).toContain('边生成就能看到说明');

    // Save the build and switch to Web mode while Design Notes stays ON!
    await render({ documentHtml: ANNOTATED_DOC, live: null });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="prototype-dock-view-web"]')!.click();
    });
    await settle();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    const select = host.querySelector<HTMLSelectElement>('[data-testid="prototype-web-page-select"]')!;
    await act(async () => {
      select.value = 'SCR-HOME';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();

    const webFrame = host.querySelector<HTMLIFrameElement>('[data-testid="prototype-web-frame"]')!;
    Object.defineProperty(webFrame.contentDocument!.documentElement, 'clientWidth', {
      value: 1100,
      configurable: true,
    });
    Object.defineProperty(webFrame.contentDocument!.documentElement, 'scrollHeight', {
      value: 1600,
      configurable: true,
    });
    installHomeBoxes(webFrame.contentDocument!);
    await act(async () => {
      webFrame.contentWindow!.dispatchEvent(new Event('resize'));
    });
    await settle();

    const webOverlay = host.querySelector<HTMLElement>(
      '[data-testid="prototype-web-design-notes-overlay"]',
    )!;
    expect(webOverlay).not.toBeNull();
    expect(webOverlay.className).toContain('pointer-events-none');
    expect(webOverlay.textContent).toContain('店长发现缺货时，从这里开始订货');

    // Scroll web document by 180px: overlay translates by -180px while prototype stays interactive
    webFrame.contentDocument!.documentElement.scrollTop = 180;
    await act(async () => {
      webFrame.contentDocument!.dispatchEvent(new Event('scroll'));
    });
    await settle();
    expect(webOverlay.style.transform).toBe('translate3d(0px, -180px, 0)');
  });

  it('refreshes Design Notes on in-page DOM visibility mutations (tabs/modals) and keeps >= 3:1 mark contrast in warm-paper dark mode', async () => {
    const tabDoc = `<!DOCTYPE html><html><body style="background: rgb(255, 255, 255);">
      <main id="proto-screens-root">
        <section class="proto-screen" data-screen-id="SCR-TABS" data-screen-name="订货与退款" data-screen-status="ready">
          <button type="button" id="open-refund-tab" onclick="document.getElementById('refund-panel').style.display='block'">切换到退款</button>
          <button type="button" data-element-id="EL-ALWAYS-BTN" data-note="常驻操作：随时新建订货。">新建订货</button>
          <div id="refund-panel" style="display: none;">
            <button type="button" data-element-id="EL-REFUND-APPROVE" data-note="同意退款：确认后 3 个工作日原路退回。">同意退款</button>
          </div>
        </section>
      </main></body></html>`;

    await render(
      { documentHtml: tabDoc, live: null },
      { workbenchTheme: 'warm-paper', theme: 'dark' },
    );

    const frame = host.querySelector<HTMLIFrameElement>(
      '[data-testid="prototype-artboard-frame-SCR-TABS"]',
    )!;
    const innerDoc = frame.contentDocument!;
    const alwaysBtn = innerDoc.querySelector<HTMLElement>('[data-element-id="EL-ALWAYS-BTN"]')!;
    const refundBtn = innerDoc.querySelector<HTMLElement>('[data-element-id="EL-REFUND-APPROVE"]')!;
    alwaysBtn.getBoundingClientRect = () =>
      ({ x: 80, y: 90, left: 80, top: 90, right: 200, bottom: 126, width: 120, height: 36 }) as DOMRect;
    refundBtn.getBoundingClientRect = () => {
      const panel = innerDoc.getElementById('refund-panel')!;
      if (panel.style.display === 'none') {
        return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
      }
      return { x: 80, y: 210, left: 80, top: 210, right: 210, bottom: 246, width: 130, height: 36 } as DOMRect;
    };

    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="prototype-dock-design-notes"]')!;
    await act(async () => toggle.click());
    await settle();

    // Initially hidden tab panel note is absent; visible button note is rendered
    expect(host.querySelector('[data-testid="prototype-design-note-EL-ALWAYS-BTN"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="prototype-design-note-EL-REFUND-APPROVE"]')).toBeNull();

    // Verify >= 3:1 mark contrast on the light (#ffffff) prototype surface even in warm-paper dark mode!
    const outline = host.querySelector<HTMLElement>(
      '[data-testid="prototype-design-note-outline-EL-ALWAYS-BTN"]',
    )!;
    const arrowMainPath = host
      .querySelectorAll<SVGPathElement>(
        '[data-testid="prototype-design-note-arrow-EL-ALWAYS-BTN"] path[data-role="arrow-stroke"]',
      )[0]!;
    expect(contrastRatio(outline.style.borderColor, '#ffffff')!).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(arrowMainPath.getAttribute('stroke') ?? '', '#ffffff')!).toBeGreaterThanOrEqual(3);

    // Click in-page tab (no scroll or resize event fired!): MutationObserver triggers layout refresh
    await act(async () => {
      innerDoc.getElementById('open-refund-tab')!.click();
    });
    await settle();

    expect(
      host.querySelector('[data-testid="prototype-design-note-EL-REFUND-APPROVE"]')?.textContent,
    ).toContain('确认后 3 个工作日原路退回');
  });
});
