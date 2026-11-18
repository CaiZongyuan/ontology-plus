/**
 * The navigation runtime of a prototype document (`界面原型.html`, ADR 0005).
 *
 * A prototype is one document whose screens are `[data-screen-id]` sections; the visible one
 * carries `is-active`, and so does its shell tab (`[data-nav-screen]`). This script is the one
 * navigation convention for that document wherever it runs: the shell writes it into every new
 * prototype, and opening a prototype on its own (「新标签页打开」) adds it to documents written
 * before it existed. A document's own `window.__selectProtoScreen` (one that switches screens
 * some other way, say `style.display`) is kept and called first. It follows tab clicks (through `window.__selectProtoScreen`), in-screen
 * `data-navigate-to` links, and — only when it runs top-level, never inside a frame that shares
 * the app's history — records each page in the URL hash, so back, forward and deep links work.
 */

export const PROTOTYPE_NAVIGATION_RUNTIME_ATTR = 'data-proto-nav-runtime';

export const PROTOTYPE_NAVIGATION_RUNTIME = `(function () {
  if (window.__protoNavRuntime) return;
  window.__protoNavRuntime = true;
  function screens() { return document.querySelectorAll('[data-screen-id]'); }
  function known(id) {
    if (!id) return false;
    var all = screens();
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-screen-id') === id) return true;
    return false;
  }
  // A document's own screen switcher keeps working: the runtime calls it, then marks is-active.
  var own = typeof window.__selectProtoScreen === 'function' ? window.__selectProtoScreen : null;
  var first = document.querySelector('[data-screen-id].is-active') ||
    document.querySelector('[data-screen-id]:not([style*="display:none"]):not([style*="display: none"])') ||
    document.querySelector('[data-screen-id]');
  var initial = first ? first.getAttribute('data-screen-id') : '';
  function hashId() {
    try { return decodeURIComponent(location.hash.slice(1)); } catch (_) { return location.hash.slice(1); }
  }
  function show(id, record) {
    if (own) { try { own(id); } catch (_) {} }
    var all = screens();
    for (var i = 0; i < all.length; i++) all[i].classList.toggle('is-active', all[i].getAttribute('data-screen-id') === id);
    var tabs = document.querySelectorAll('[data-nav-screen]');
    for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle('is-active', tabs[j].getAttribute('data-nav-screen') === id);
    if (record && window.parent === window && hashId() !== id) location.hash = encodeURIComponent(id);
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }
  window.__selectProtoScreen = function (id) { if (known(id)) show(id, true); };
  function fromHash() {
    var id = hashId() || initial;
    if (known(id)) show(id, false);
  }
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented) return;
    var target = event.target;
    var link = target && target.closest ? target.closest('[data-navigate-to]') : null;
    var id = link && link.getAttribute('data-navigate-to');
    if (!known(id)) return;
    event.preventDefault();
    window.__selectProtoScreen(id);
  });
  window.addEventListener('hashchange', fromHash);
  if (location.hash) fromHash();
})();`;

/** The runtime as a `<script>` element (the shell writes this). */
export function prototypeNavigationRuntimeScript(id?: string): string {
  return `<script${id ? ` id="${id}"` : ''} ${PROTOTYPE_NAVIGATION_RUNTIME_ATTR}>\n${PROTOTYPE_NAVIGATION_RUNTIME}\n</script>`;
}

/**
 * The document with the navigation runtime at the end of its body, unless it already has it or
 * has no screens (`data-screen-id`) to navigate.
 * The runtime goes last so it replaces an older shell's own `__selectProtoScreen`.
 */
export function ensurePrototypeNavigationRuntime(html: string): string {
  if (!html.trim() || html.includes(PROTOTYPE_NAVIGATION_RUNTIME_ATTR) || !/\bdata-screen-id\s*=/.test(html)) {
    return html;
  }
  const script = prototypeNavigationRuntimeScript();
  const bodyEnd = html.toLowerCase().lastIndexOf('</body>');
  return bodyEnd >= 0 ? `${html.slice(0, bodyEnd)}${script}\n${html.slice(bodyEnd)}` : `${html}\n${script}`;
}
