import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ARTBOARD_H, ARTBOARD_W } from './camera.js';
import { BORN_ATTR, morphChildren } from './morph.js';

/**
 * The document every artboard iframe loads, exactly once. After that, content arrives by
 * morphing the iframe's own DOM: `srcDoc` never changes, so the iframe never reloads.
 */
export const ARTBOARD_BOOTSTRAP =
  '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

const BORN_FADE_MS = 600;

function runtimeCss(): string {
  return [
    '[data-screen-id]{display:block!important;visibility:visible!important;opacity:1!important}',
    `[${BORN_ATTR}]{animation:onto-born .45s ease-out both}`,
    '@keyframes onto-born{from{opacity:0;transform:translateY(6px)}}',
  ].join('\n');
}

function ensureHeadStyle(doc: Document, marker: string): HTMLStyleElement {
  let el = doc.head.querySelector<HTMLStyleElement>(`style[${marker}]`);
  if (!el) {
    el = doc.createElement('style');
    el.setAttribute(marker, '');
    doc.head.appendChild(el);
  }
  return el;
}

function syncLinks(doc: Document, hrefs: readonly string[]): void {
  const existing = Array.from(doc.head.querySelectorAll<HTMLLinkElement>('link[data-onto-link]'));
  for (const link of existing) {
    if (!hrefs.includes(link.getAttribute('href') ?? '')) link.remove();
  }
  for (const href of hrefs) {
    if (existing.some((l) => l.getAttribute('href') === href)) continue;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-onto-link', '');
    doc.head.appendChild(link);
  }
}

interface ArtboardFrameProps {
  screenId: string;
  title: string;
  bodyHtml: string;
  css: string;
  extraCss?: string;
  /** Stylesheet hrefs joined with newlines (a string keeps memoisation simple). */
  linksKey: string;
  /** Head scripts' HTML joined by `\n\u0000\n`. */
  headScriptsKey: string;
  /** The screen has landed (or is saved): its scripts run, once each. */
  landed: boolean;
  interactive: boolean;
  onNavigate: (screenId: string) => void;
  onEscape: () => void;
}

type ProtoWindow = Window & { __selectProtoScreen?: (screenId: string) => void };

/**
 * One screen's iframe. Memoised on plain strings, so an artboard whose screen did not change
 * does not render again when another screen streams.
 */
export const ArtboardFrame = memo(function ArtboardFrame({
  screenId,
  title,
  bodyHtml,
  css,
  extraCss,
  linksKey,
  headScriptsKey,
  landed,
  interactive,
  onNavigate,
  onEscape,
}: ArtboardFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const loadCount = useRef(0);
  const applied = useRef<{ version: number; html: string } | null>(null);
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  const selectRef = useRef<((screenId: string) => void) | null>(null);
  /** Script element → the source it last ran with; a script runs once per source. */
  const ranScripts = useRef(new WeakMap<Element, string>());
  const ranHeadScripts = useRef(new Set<string>());

  const doc = (): Document | null => {
    const d = frameRef.current?.contentDocument ?? null;
    return d && d.head && d.body ? d : null;
  };

  // Shared styles, this screen's in-progress styles, and the runtime rules.
  useLayoutEffect(() => {
    const d = doc();
    if (!d || loadVersion === 0) return;
    const runtime = ensureHeadStyle(d, 'data-onto-runtime');
    const nextRuntime = runtimeCss();
    if (runtime.textContent !== nextRuntime) runtime.textContent = nextRuntime;
    const frame = ensureHeadStyle(d, 'data-onto-frame');
    if (frame.textContent !== css) frame.textContent = css;
    const screenCss = ensureHeadStyle(d, 'data-onto-screen-css');
    if (screenCss.textContent !== (extraCss ?? '')) screenCss.textContent = extraCss ?? '';
    syncLinks(d, linksKey ? linksKey.split('\n') : []);
  }, [loadVersion, css, extraCss, linksKey]);

  // Morph the body in place; finished content keeps its nodes, new nodes fade in.
  useLayoutEffect(() => {
    const d = doc();
    if (!d || loadVersion === 0) return;
    if (applied.current?.version === loadVersion && applied.current.html === bodyHtml) return;
    applied.current = { version: loadVersion, html: bodyHtml };
    const parsed = new DOMParser().parseFromString(
      `<!doctype html><html><head></head><body>${bodyHtml}</body></html>`,
      'text/html',
    );
    for (const tab of Array.from(parsed.querySelectorAll('[data-nav-screen]'))) {
      tab.classList.toggle('is-active', tab.getAttribute('data-nav-screen') === screenId);
    }
    morphChildren(d.body, parsed.body);
    const stamp = String(Date.now());
    for (const el of Array.from(d.querySelectorAll(`[${BORN_ATTR}=""]`))) el.setAttribute(BORN_ATTR, stamp);
    const timer = setTimeout(() => {
      const now = Date.now();
      for (const el of Array.from(d.querySelectorAll(`[${BORN_ATTR}]`))) {
        if (now - Number(el.getAttribute(BORN_ATTR) || 0) >= BORN_FADE_MS) el.removeAttribute(BORN_ATTR);
      }
    }, BORN_FADE_MS + 50);
    return () => clearTimeout(timer);
  }, [loadVersion, bodyHtml, screenId]);

  // Scripts: parsed scripts never run, so once the screen has landed each one is recreated with
  // createElement and runs exactly once, without reloading the iframe.
  useLayoutEffect(() => {
    const d = doc();
    if (!d || loadVersion === 0 || !landed) return;
    const recreate = (source: Element): HTMLScriptElement => {
      const fresh = d.createElement('script');
      for (const attr of Array.from(source.attributes)) fresh.setAttribute(attr.name, attr.value);
      fresh.textContent = source.textContent;
      return fresh;
    };
    for (const html of headScriptsKey ? headScriptsKey.split('\n\u0000\n') : []) {
      if (ranHeadScripts.current.has(html)) continue;
      ranHeadScripts.current.add(html);
      const parsed = new DOMParser().parseFromString(`<!doctype html><html><head>${html}</head></html>`, 'text/html');
      const source = parsed.head.querySelector('script');
      if (!source) continue;
      const fresh = recreate(source);
      fresh.setAttribute('data-onto-head-script', '');
      d.head.appendChild(fresh);
    }
    for (const script of Array.from(d.body.querySelectorAll('script'))) {
      const source = `${script.getAttribute('src') ?? ''}\u0000${script.textContent ?? ''}`;
      if (ranScripts.current.get(script) === source) continue;
      const fresh = recreate(script);
      ranScripts.current.set(fresh, source);
      script.replaceWith(fresh);
    }
    // The prototype's own navigation helper must not replace the canvas's try-out navigation.
    const win = d.defaultView as ProtoWindow | null;
    if (win && selectRef.current) win.__selectProtoScreen = selectRef.current;
  }, [loadVersion, bodyHtml, landed, headScriptsKey]);

  // Try-out wiring: navigation anchors and Esc inside the prototype.
  useEffect(() => {
    const d = doc();
    if (!d || loadVersion === 0) return;
    const win = d.defaultView as ProtoWindow | null;
    const go = (target: string) => {
      if (interactiveRef.current && target) navigateRef.current(target);
    };
    selectRef.current = go;
    if (win) win.__selectProtoScreen = go;
    const onClick = (event: MouseEvent) => {
      if (!interactiveRef.current) return;
      const origin = event.target as { closest?: (s: string) => Element | null } | null;
      const anchor = origin?.closest?.('[data-navigate-to],[data-nav-screen]');
      const target = anchor?.getAttribute('data-navigate-to') || anchor?.getAttribute('data-nav-screen');
      if (target) {
        event.preventDefault();
        go(target);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escapeRef.current();
    };
    d.addEventListener('click', onClick);
    d.addEventListener('keydown', onKey);
    return () => {
      d.removeEventListener('click', onClick);
      d.removeEventListener('keydown', onKey);
      if (win && win.__selectProtoScreen === go) delete win.__selectProtoScreen;
    };
  }, [loadVersion]);

  return (
    <iframe
      ref={frameRef}
      title={title}
      srcDoc={ARTBOARD_BOOTSTRAP}
      sandbox="allow-scripts allow-same-origin"
      data-testid={`prototype-artboard-frame-${screenId}`}
      tabIndex={interactive ? 0 : -1}
      className="block border-0 bg-background"
      style={{ width: ARTBOARD_W, height: ARTBOARD_H, pointerEvents: interactive ? 'auto' : 'none' }}
      onLoad={(event) => {
        loadCount.current += 1;
        event.currentTarget.setAttribute('data-load-count', String(loadCount.current));
        setLoadVersion((v) => v + 1);
      }}
    />
  );
});
