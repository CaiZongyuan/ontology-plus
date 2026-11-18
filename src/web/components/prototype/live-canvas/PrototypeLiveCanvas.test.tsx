// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyPrototypeLiveEvent,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
  type PrototypeLiveEvent,
  type PrototypeLiveState,
} from '../../../../packages/ontology-core/index.js';
import { checkBusinessViewMarkup } from '../../../../packages/business-vocabulary/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import { ARTBOARD_BOOTSTRAP } from './Artboard.js';
import { PrototypeLiveCanvas, type PrototypeLiveCanvasProps } from './PrototypeLiveCanvas.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function doc(screenB: string, statusB = 'ready'): string {
  return `<!DOCTYPE html><html><head><style>.proto-screen{display:none}</style></head><body>
<header class="proto-topbar"><button type="button" data-nav-screen="SCR-A" onclick="window.__selectProtoScreen('SCR-A')">首页</button><button type="button" data-nav-screen="SCR-B">订单</button></header>
<main id="proto-screens-root">
<section class="proto-screen" data-screen-id="SCR-A" data-screen-name="工作台首页" data-screen-type="DASHBOARD" data-screen-status="ready"><h1>早上好</h1><button type="button" data-navigate-to="SCR-B">去订单</button></section>
<section class="proto-screen" data-screen-id="SCR-B" data-screen-name="订货单列表" data-screen-type="LIST" data-screen-status="${statusB}">${screenB}</section>
</main></body></html>`;
}

const SAVED = doc('<h2>订货单</h2><table><tbody><tr><td>DH-1025</td></tr></tbody></table>');

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
  // let jsdom deliver the iframes' load events
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

function frame(screenId: string): HTMLIFrameElement {
  const el = host.querySelector<HTMLIFrameElement>(`[data-testid="prototype-artboard-frame-${screenId}"]`);
  if (!el) throw new Error(`no artboard for ${screenId}`);
  return el;
}

function watch(target: Node): () => MutationRecord[] {
  const observer = new MutationObserver(() => undefined);
  observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
  return () => observer.takeRecords();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('PrototypeLiveCanvas: artboards load once and are updated in place', () => {
  it('morphs streamed deltas into each artboard without reloading it or redrawing finished screens', async () => {
    const tracker = createPrototypeLiveTracker();
    let state: PrototypeLiveState = emptyPrototypeLiveState();
    const apply = (events: (PrototypeLiveEvent | null)[]) => {
      for (const ev of events) if (ev) state = applyPrototypeLiveEvent(state, ev);
    };
    apply(tracker.observeDocument(doc('<p>排队中</p>', 'queued')));
    apply([tracker.observePartialScreen({ screenId: 'SCR-B', partialHtml: '<h2>订货单</h2><table><tbody><tr><td>DH-10' })]);

    await render({ documentHtml: '', live: state, busy: true });

    const canvas = host.querySelector('[data-testid="prototype-live-canvas"]')!;
    const frameA = frame('SCR-A');
    const frameB = frame('SCR-B');
    expect(frameA.getAttribute('srcdoc')).toBe(ARTBOARD_BOOTSTRAP);
    expect(frameA.getAttribute('data-load-count')).toBe('1');
    const bodyA = frameA.contentDocument!.body;
    const bodyB = frameB.contentDocument!.body;
    expect(bodyA.textContent).toContain('早上好');
    expect(bodyA.textContent).not.toContain('订货单');
    expect(bodyB.querySelector('h2')?.textContent).toBe('订货单');
    expect(bodyB.querySelector('[data-screen-id="SCR-B"]')?.getAttribute('data-screen-status')).toBe('streaming');
    // this artboard's own nav tab is the active one
    expect(bodyB.querySelector('[data-nav-screen="SCR-B"]')?.classList.contains('is-active')).toBe(true);
    expect(frameB.contentDocument!.head.querySelector('style[data-onto-frame]')?.textContent).toContain('.proto-screen');

    const headingB = bodyB.querySelector('h2')!;
    const takeA = watch(bodyA);

    // more of screen B streams in
    apply([
      tracker.observePartialScreen({
        screenId: 'SCR-B',
        partialHtml: '<h2>订货单</h2><table><tbody><tr><td>DH-1025</td></tr><tr><td>DH-1024</td></tr></tbody></table>',
      }),
    ]);
    await render({ documentHtml: '', live: state, busy: true });

    expect(frame('SCR-A')).toBe(frameA);
    expect(frame('SCR-B')).toBe(frameB);
    expect(frameB.getAttribute('srcdoc')).toBe(ARTBOARD_BOOTSTRAP);
    expect(frameB.getAttribute('data-load-count')).toBe('1');
    expect(frameB.contentDocument!.body).toBe(bodyB);
    expect(bodyB.querySelector('h2')).toBe(headingB);
    expect(bodyB.textContent).toContain('DH-1024');
    expect(takeA()).toHaveLength(0); // the finished screen was not touched at all

    // the run ends and the saved revision replaces the live state: same canvas, same iframes
    await render({ documentHtml: SAVED, live: null, busy: false });
    expect(host.querySelector('[data-testid="prototype-live-canvas"]')).toBe(canvas);
    expect(frame('SCR-A')).toBe(frameA);
    expect(frame('SCR-B')).toBe(frameB);
    expect(frameA.getAttribute('data-load-count')).toBe('1');
    expect(frameB.getAttribute('data-load-count')).toBe('1');
    expect(takeA()).toHaveLength(0);
    expect(bodyB.querySelector('[data-screen-id="SCR-B"]')?.getAttribute('data-screen-status')).toBe('ready');
    expect(bodyB.textContent).not.toContain('DH-1024');
  });

  it('shows the saved prototype with its screen strip, dock and build log in plain business language', async () => {
    await render({ documentHtml: SAVED, live: null, viewMode: 'business' });
    expect(host.querySelector('[data-testid="prototype-strip-card-SCR-A"]')?.textContent).toContain('工作台首页');
    expect(host.querySelector('[data-testid="prototype-strip-card-SCR-B"]')?.getAttribute('data-screen-status')).toBe('ready');
    expect(host.querySelector('[data-testid="prototype-canvas-dock"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="prototype-build-log"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="prototype-phase-bar"]')?.textContent).toContain('共 2 屏');
    expect(checkBusinessViewMarkup(host.innerHTML)).toHaveLength(0);
  });

  it('double-click enters try-out on one artboard, its navigation moves to the target screen, Esc exits', async () => {
    await render({ documentHtml: SAVED, live: null });
    const viewport = host.querySelector<HTMLElement>('[data-testid="prototype-canvas-viewport"]')!;
    const boardA = host.querySelector<HTMLElement>('[data-testid="prototype-artboard-SCR-A"]')!;
    expect(frame('SCR-A').style.pointerEvents).toBe('none');

    await act(async () => {
      boardA.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(viewport.getAttribute('data-trying')).toBe('SCR-A');
    expect(viewport.getAttribute('data-following')).toBe('false');
    expect(frame('SCR-A').style.pointerEvents).toBe('auto');
    expect(frame('SCR-B').style.pointerEvents).toBe('none');

    const innerDoc = frame('SCR-A').contentDocument!;
    await act(async () => {
      innerDoc.querySelector<HTMLElement>('[data-navigate-to="SCR-B"]')!.dispatchEvent(
        new innerDoc.defaultView!.MouseEvent('click', { bubbles: true }),
      );
    });
    expect(viewport.getAttribute('data-trying')).toBe('SCR-B');
    expect(frame('SCR-B').style.pointerEvents).toBe('auto');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(viewport.getAttribute('data-trying')).toBe('');
    expect(frame('SCR-B').style.pointerEvents).toBe('none');
  });

  it('follows the screen the latest event touched, stops on manual pan, and resumes from the dock', async () => {
    const tracker = createPrototypeLiveTracker();
    let state = emptyPrototypeLiveState();
    for (const ev of tracker.observeDocument(doc('<p>排队中</p>', 'queued'))) state = applyPrototypeLiveEvent(state, ev);
    state = applyPrototypeLiveEvent(state, tracker.observePartialScreen({ screenId: 'SCR-B', partialHtml: '<h2>订货' })!);
    await render({ documentHtml: '', live: state, busy: true });

    const viewport = host.querySelector<HTMLElement>('[data-testid="prototype-canvas-viewport"]')!;
    expect(viewport.getAttribute('data-following')).toBe('true');
    expect(viewport.getAttribute('data-follow-target')).toBe('SCR-B');

    await act(async () => {
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, deltaY: 10, bubbles: true, cancelable: true }));
    });
    expect(viewport.getAttribute('data-following')).toBe('false');

    await act(async () => {
      host.querySelector<HTMLElement>('[data-testid="prototype-dock-follow"]')!.click();
    });
    expect(viewport.getAttribute('data-following')).toBe('true');
    expect(viewport.getAttribute('data-follow-target')).toBe('SCR-B');
  });
});
