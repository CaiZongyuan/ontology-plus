import React, { memo, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
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

/** A box in the frame's own viewport (CSS pixels, before any canvas zoom). */
export interface ArtboardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What overlays drawn over a frame need from it (design notes #94, demo tours #95): where an
 * anchored element is, and a way to bring one into view.
 */
export interface ArtboardHandle {
  /** The frame's document, once loaded. */
  document: () => Document | null;
  /** The element's box in the frame's viewport, by its `data-element-id`. */
  rectOf: (elementId: string) => ArtboardRect | null;
  /** Scrolls the element into view (when it is off screen) and returns its new box. */
  reveal: (elementId: string) => ArtboardRect | null;
}

function cssAttrValue(raw: string): string {
  return raw.replace(/["\\]/g, '\\$&');
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
  /** Fill the parent at its real width (web mode) instead of the fixed artboard size. */
  fill?: boolean;
  /** Receives the frame's handle for overlays. */
  handleRef?: MutableRefObject<ArtboardHandle | null>;
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
  fill = false,
  handleRef,
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
  /** The load (document) for which DOMContentLoaded/load were replayed to the screen's scripts. */
  const lifecycleReplayedFor = useRef(0);

  const doc = (): Document | null => {
    const d = frameRef.current?.contentDocument ?? null;
    return d && d.head && d.body ? d : null;
  };
  /** The screen the body last showed: a different one (web mode page change) starts at the top. */
  const shownScreen = useRef<string | null>(null);

  useEffect(() => {
    if (!handleRef) return;
    const find = (elementId: string): Element | null =>
      doc()?.querySelector(`[data-element-id="${cssAttrValue(elementId)}"]`) ?? null;
    const box = (el: Element | null): ArtboardRect | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const handle: ArtboardHandle = {
      document: doc,
      rectOf: (elementId) => box(find(elementId)),
      reveal: (elementId) => {
        const el = find(elementId);
        if (!el) return null;
        const view = el.ownerDocument.defaultView;
        const r = el.getBoundingClientRect();
        const offScreen = view
          ? r.top < 0 || r.bottom > view.innerHeight || r.left < 0 || r.right > view.innerWidth
          : false;
        if (offScreen) (el as HTMLElement).scrollIntoView?.({ block: 'center', inline: 'nearest' });
        return box(el);
      },
    };
    handleRef.current = handle;
    return () => {
      if (handleRef.current === handle) handleRef.current = null;
    };
    // `doc` reads the frame ref at call time, so the handle is installed once per ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleRef]);

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
    if (shownScreen.current !== null && shownScreen.current !== screenId) {
      const scroller = d.scrollingElement ?? d.documentElement;
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
    }
    shownScreen.current = screenId;
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
    let ran = 0;
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
      ran += 1;
    }
    for (const script of Array.from(d.body.querySelectorAll('script'))) {
      const source = `${script.getAttribute('src') ?? ''}\u0000${script.textContent ?? ''}`;
      if (ranScripts.current.get(script) === source) continue;
      const fresh = recreate(script);
      ranScripts.current.set(fresh, source);
      script.replaceWith(fresh);
      ran += 1;
    }
    // The blank page loaded long before these scripts ran, so init code waiting for
    // DOMContentLoaded or load would never start: replay both once for this document.
    const view = d.defaultView;
    if (ran > 0 && view && lifecycleReplayedFor.current !== loadVersion) {
      lifecycleReplayedFor.current = loadVersion;
      d.dispatchEvent(new view.Event('DOMContentLoaded', { bubbles: true }));
      view.dispatchEvent(new view.Event('load'));
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
      style={{
        width: fill ? '100%' : ARTBOARD_W,
        height: fill ? '100%' : ARTBOARD_H,
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      onLoad={(event) => {
        loadCount.current += 1;
        event.currentTarget.setAttribute('data-load-count', String(loadCount.current));
        setLoadVersion((v) => v + 1);
      }}
    />
  );
});
