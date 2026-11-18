import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { initPrototypeShell } from '../index.js';

/**
 * The saved `界面原型.html` is one standalone document (ADR 0005) and the shell's own script is
 * its navigation: the 「新标签页打开」 page (#97) is that same document, so the shell must
 * navigate on its own — tabs, in-screen `data-navigate-to` links, back/forward and deep links.
 */

function shellHtml(): string {
  const shell = initPrototypeShell({
    appTitle: '门店订货',
    screens: [
      { screenId: 'SCR-HOME', screenName: '工作台首页', screenType: 'DASHBOARD' },
      { screenId: 'SCR-ORDERS', screenName: '订货单列表', screenType: 'LIST' },
    ],
  });
  expect(shell.isError).toBe(false);
  // a screen with an in-page navigation link (what upsert_prototype_screen writes)
  return shell.nextHtml.replace(
    /(<section[^>]*data-screen-id="SCR-HOME"[^>]*>)/,
    '$1<button type="button" id="go-orders" data-navigate-to="SCR-ORDERS"><span id="go-orders-label">订货单</span></button>',
  );
}

type ShellWindow = Window & typeof globalThis & { __selectProtoScreen: (screenId: string) => void };
interface JSDOM {
  window: ShellWindow;
}
// jsdom ships no type declarations in this repo; only its constructor is needed here.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (
    html: string,
    options: { runScripts: 'dangerously'; url: string; beforeParse: (window: ShellWindow) => void },
  ) => JSDOM;
};

function open(url = 'https://prototype.test/'): JSDOM {
  return new JSDOM(shellHtml(), {
    runScripts: 'dangerously',
    url,
    beforeParse(window) {
      window.scrollTo = () => undefined; // jsdom has no layout
    },
  });
}

function active(dom: JSDOM): string[] {
  return Array.from(dom.window.document.querySelectorAll('[data-screen-id].is-active')).map(
    (el) => el.getAttribute('data-screen-id') ?? '',
  );
}

async function hashSettled(dom: JSDOM): Promise<void> {
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
}

describe('prototype shell navigation works standalone', () => {
  it('follows in-screen data-navigate-to links and marks the matching tab', async () => {
    const dom = open();
    expect(active(dom)).toEqual(['SCR-HOME']);
    dom.window.document
      .getElementById('go-orders-label')!
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await hashSettled(dom);
    expect(active(dom)).toEqual(['SCR-ORDERS']);
    const tab = dom.window.document.querySelector('[data-nav-screen="SCR-ORDERS"]')!;
    expect(tab.classList.contains('is-active')).toBe(true);
    expect(dom.window.location.hash).toBe('#SCR-ORDERS');
  });

  it('records each page in the URL hash, so back and forward move between pages', async () => {
    const dom = open();
    dom.window.document.querySelector<HTMLElement>('[data-nav-screen="SCR-ORDERS"]')!.click();
    await hashSettled(dom);
    expect(active(dom)).toEqual(['SCR-ORDERS']);
    dom.window.location.hash = '#SCR-HOME';
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
    expect(active(dom)).toEqual(['SCR-HOME']);
  });

  it('opens on the page named in the URL hash', () => {
    const dom = open('https://prototype.test/#SCR-ORDERS');
    expect(active(dom)).toEqual(['SCR-ORDERS']);
  });

  it('ignores a click another handler already took (the canvas try-out navigates itself)', async () => {
    const dom = open();
    const { document } = dom.window;
    document.addEventListener('click', (event) => event.preventDefault(), { capture: true });
    document.getElementById('go-orders')!.click();
    await hashSettled(dom);
    expect(active(dom)).toEqual(['SCR-HOME']);
  });

  it('does not write the hash when it runs inside a frame (artboards share the app’s history)', async () => {
    const dom = open();
    Object.defineProperty(dom.window, 'parent', { value: {}, configurable: true });
    dom.window.__selectProtoScreen('SCR-ORDERS');
    await hashSettled(dom);
    expect(active(dom)).toEqual(['SCR-ORDERS']);
    expect(dom.window.location.hash).toBe('');
  });
});
