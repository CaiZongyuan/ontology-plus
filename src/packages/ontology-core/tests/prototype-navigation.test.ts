import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ensurePrototypeNavigationRuntime, PROTOTYPE_NAVIGATION_RUNTIME_ATTR } from '../index.js';

type NavWindow = Window & typeof globalThis & { __selectProtoScreen: (screenId: string) => void };
// jsdom ships no type declarations in this repo; only its constructor is needed here.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (
    html: string,
    options: { runScripts: 'dangerously'; url: string; beforeParse: (window: NavWindow) => void },
  ) => { window: NavWindow };
};

/** A prototype saved before the navigation runtime existed: its shell only toggles tabs. */
const OLD_SHELL = `<!DOCTYPE html><html><head><style>.proto-screen{display:none}.proto-screen.is-active{display:block}</style></head><body>
<header><button type="button" class="is-active" data-nav-screen="SCR-A" onclick="window.__selectProtoScreen('SCR-A')">首页</button><button type="button" data-nav-screen="SCR-B" onclick="window.__selectProtoScreen('SCR-B')">订单</button></header>
<main>
<section class="proto-screen is-active" data-screen-id="SCR-A"><button type="button" id="to-b" data-navigate-to="SCR-B">去订单</button></section>
<section class="proto-screen" data-screen-id="SCR-B"><h2>订货单</h2></section>
</main>
<script id="proto-shell-script">
window.__selectProtoScreen = function(screenId) {
  var screens = document.querySelectorAll('[data-screen-id]');
  for (var i = 0; i < screens.length; i++) screens[i].classList.toggle('is-active', screens[i].getAttribute('data-screen-id') === screenId);
};
</script>
</body></html>`;

function open(html: string, url = 'https://prototype.test/') {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    beforeParse(window) {
      window.scrollTo = () => undefined; // jsdom has no layout
    },
  });
}

function active(win: NavWindow): string[] {
  return Array.from(win.document.querySelectorAll('[data-screen-id].is-active')).map(
    (el) => el.getAttribute('data-screen-id') ?? '',
  );
}

const tick = (win: NavWindow) => new Promise((resolve) => win.setTimeout(resolve, 20));

describe('ensurePrototypeNavigationRuntime', () => {
  it('adds the runtime once, at the end of the body', () => {
    const once = ensurePrototypeNavigationRuntime(OLD_SHELL);
    expect(once.split(PROTOTYPE_NAVIGATION_RUNTIME_ATTR)).toHaveLength(2);
    expect(once.indexOf(PROTOTYPE_NAVIGATION_RUNTIME_ATTR)).toBeGreaterThan(once.indexOf('proto-shell-script'));
    expect(once.trimEnd().endsWith('</body></html>')).toBe(true);
    expect(ensurePrototypeNavigationRuntime(once)).toBe(once);
    expect(ensurePrototypeNavigationRuntime('  ')).toBe('  ');
  });

  it('makes an old shell navigate on its own: deep link, in-screen link, back and forward', async () => {
    const html = ensurePrototypeNavigationRuntime(OLD_SHELL);

    const deep = open(html, 'https://prototype.test/#SCR-B').window;
    expect(active(deep)).toEqual(['SCR-B']);

    const win = open(html).window;
    expect(active(win)).toEqual(['SCR-A']);
    win.document.getElementById('to-b')!.click();
    await tick(win);
    expect(active(win)).toEqual(['SCR-B']);
    expect(win.document.querySelector('[data-nav-screen="SCR-B"]')!.classList.contains('is-active')).toBe(true);
    expect(win.location.hash).toBe('#SCR-B');

    win.history.back();
    await tick(win);
    expect(active(win)).toEqual(['SCR-A']);
    win.history.forward();
    await tick(win);
    expect(active(win)).toEqual(['SCR-B']);

    // the old tab buttons now go through the runtime too
    win.document.querySelector<HTMLElement>('[data-nav-screen="SCR-A"]')!.click();
    await tick(win);
    expect(active(win)).toEqual(['SCR-A']);
    expect(win.location.hash).toBe('#SCR-A');
  });
});
