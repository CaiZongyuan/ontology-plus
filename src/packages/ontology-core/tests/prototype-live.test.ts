import { describe, expect, it, vi } from 'vitest';
import {
  applyPrototypeLiveEvent,
  buildPrototypeCanvasModel,
  composeArtboardBody,
  composePrototypeDocument,
  createPartialScreenThrottle,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
  healPartialHtml,
  healPartialScreenSection,
  prototypeFrameAssets,
  splitPrototypeDocument,
  type PrototypeLiveEvent,
} from '../index.js';

const DOC = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>门店订货</title>
  <style id="proto-shell-styles">.proto-screen { display: none; } .proto-screen.is-active { display: block; }</style>
</head>
<body>
  <div class="proto-app-shell">
    <header class="proto-topbar"><nav>
      <button type="button" data-element-id="EL-TAB-A" data-element-type="TAB" data-nav-screen="SCR-A">首页</button>
      <button type="button" data-element-id="EL-TAB-B" data-element-type="TAB" data-nav-screen="SCR-B">订单</button>
    </nav></header>
    <main id="proto-screens-root">
      <section id="screen-SCR-A" class="proto-screen is-active" data-screen-id="SCR-A" data-screen-name="首页" data-screen-type="DASHBOARD" data-screen-status="ready"><h1>早上好</h1></section>
      <section id="screen-SCR-B" class="proto-screen" data-screen-id="SCR-B" data-screen-name="订单" data-screen-type="LIST" data-screen-status="queued"><p>排队中</p></section>
    </main>
  </div>
  <script id="proto-shell-script">window.__selectProtoScreen = function () {};</script>
</body>
</html>`;

function withScreenB(inner: string, status = 'ready'): string {
  return DOC.replace(
    /<section id="screen-SCR-B"[\s\S]*?<\/section>/,
    `<section id="screen-SCR-B" class="proto-screen" data-screen-id="SCR-B" data-screen-name="订单" data-screen-type="LIST" data-screen-status="${status}">${inner}</section>`,
  );
}

describe('healPartialHtml: a half-written stream becomes safe HTML', () => {
  it('drops a half-written trailing tag, even when a quoted attribute contains ">"', () => {
    expect(healPartialHtml('<div class="a">Hi</div><div cla')).toBe('<div class="a">Hi</div>');
    expect(healPartialHtml('<p>x</p><a title="a>b')).toBe('<p>x</p>');
    expect(healPartialHtml('<p>x</p><')).toBe('<p>x</p>');
  });

  it('closes elements left open, including a half-written closing tag, and never closes void elements', () => {
    expect(healPartialHtml('<section><div><h2>标题')).toBe('<section><div><h2>标题</h2></div></section>');
    expect(healPartialHtml('<div>abc</di')).toBe('<div>abc</div>');
    expect(healPartialHtml('<div><img src="x.png"><br>')).toBe('<div><img src="x.png"><br></div>');
  });

  it('drops an unfinished <script> but keeps a finished one', () => {
    expect(healPartialHtml('<div>a</div><script>window.x = 1; if (')).toBe('<div>a</div>');
    expect(healPartialHtml('<div>a</div><script>window.x = 1;</script><p>b')).toBe(
      '<div>a</div><script>window.x = 1;</script><p>b</p>',
    );
  });

  it('closes an unclosed <style> and does not read "<" inside it as a tag', () => {
    expect(healPartialHtml('<style>.a{color:red} .b > .c{margin:0')).toBe(
      '<style>.a{color:red} .b > .c{margin:0</style>',
    );
    expect(healPartialHtml('<div><style>a<b{}')).toBe('<div><style>a<b{}</style></div>');
  });

  it('never emits half an entity or half a comment', () => {
    expect(healPartialHtml('<p>A &am')).toBe('<p>A </p>');
    expect(healPartialHtml('<p>A &#12')).toBe('<p>A </p>');
    expect(healPartialHtml('<p>A &amp; B</p>')).toBe('<p>A &amp; B</p>');
    expect(healPartialHtml('<p>A</p><!-- note')).toBe('<p>A</p>');
  });

  it('leaves complete HTML untouched and strips a stray code fence', () => {
    const complete = '<section data-screen-id="S"><button type="button">Go</button></section>';
    expect(healPartialHtml(complete)).toBe(complete);
    expect(healPartialHtml('```html\n<div>x</div>')).toBe('<div>x</div>');
  });
});

describe('splitPrototypeDocument / composeArtboardBody: one screen per artboard', () => {
  it('separates the shared frame from each screen, in document order', () => {
    const { frame, screens } = splitPrototypeDocument(DOC);
    expect(screens.map((s) => [s.screenId, s.screenName, s.screenType, s.status])).toEqual([
      ['SCR-A', '首页', 'DASHBOARD', 'ready'],
      ['SCR-B', '订单', 'LIST', 'queued'],
    ]);
    expect(screens[0]!.html).toContain('<h1>早上好</h1>');
    expect(screens[0]!.html.startsWith('<section')).toBe(true);
    expect(prototypeFrameAssets(frame).css).toContain('.proto-screen');
    expect(frame.bodyHtml).toContain('data-nav-screen="SCR-B"');
    expect(frame.bodyHtml).not.toContain('早上好');
    expect(frame.bodyHtml).not.toContain('排队中');
    expect(frame.screens.map((s) => s.screenId)).toEqual(['SCR-A', 'SCR-B']);
  });

  it('composes an artboard body that carries the shell and exactly one screen', () => {
    const { frame, screens } = splitPrototypeDocument(DOC);
    const body = composeArtboardBody(frame, 'SCR-B', screens[1]!.html);
    expect(body).toContain('排队中');
    expect(body).not.toContain('早上好');
    expect(body).toContain('proto-topbar');
  });

  it('treats a document without screens as one frame with no artboards', () => {
    const { frame, screens } = splitPrototypeDocument('<html><body><p>hello</p></body></html>');
    expect(screens).toEqual([]);
    expect(frame.bodyHtml).toContain('hello');
  });
});

describe('createPrototypeLiveTracker: per-screen deltas, never the whole document', () => {
  it('emits only the screen that changed after a document mutation', () => {
    const tracker = createPrototypeLiveTracker();
    tracker.reset(DOC);
    const events = tracker.observeDocument(withScreenB('<table><tr><td>DH-1025</td></tr></table>'));
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.kind).toBe('screen');
    if (ev.kind !== 'screen') return;
    expect(ev.screenId).toBe('SCR-B');
    expect(ev.status).toBe('ready');
    expect(ev.html).toContain('DH-1025');
    expect(ev.html).not.toContain('早上好');
    expect(JSON.stringify(ev)).not.toContain('早上好');
  });

  it('emits a frame event (without any screen HTML) when shared styles or the shell change', () => {
    const tracker = createPrototypeLiveTracker();
    tracker.reset(DOC);
    const events = tracker.observeDocument(DOC.replace('display: none;', 'display: none; color: red;'));
    expect(events.map((e) => e.kind)).toEqual(['frame']);
    expect(JSON.stringify(events)).not.toContain('早上好');
    expect(JSON.stringify(events)).not.toContain('排队中');
  });

  it('streams a healed partial screen with monotonically increasing seq', () => {
    const tracker = createPrototypeLiveTracker();
    tracker.reset(DOC);
    const first = tracker.observePartialScreen({
      screenId: 'SCR-B',
      screenName: '订单',
      partialHtml: '<div class="card"><h2>订货',
    });
    const second = tracker.observePartialScreen({
      screenId: 'SCR-B',
      partialHtml: '<div class="card"><h2>订货单</h2><table><tr><td cla',
    });
    expect(first?.kind).toBe('screen');
    expect(second && first && second.seq > first.seq).toBe(true);
    if (second?.kind !== 'screen') throw new Error('expected screen event');
    expect(second.status).toBe('streaming');
    expect(second.html).toContain('data-screen-id="SCR-B"');
    expect(second.html).toContain('data-screen-status="streaming"');
    expect(second.html).not.toContain('<td cla');
    expect(second.html).toContain('</table>');
    // unchanged partial is not re-sent
    expect(
      tracker.observePartialScreen({
        screenId: 'SCR-B',
        partialHtml: '<div class="card"><h2>订货单</h2><table><tr><td cla',
      }),
    ).toBeNull();
  });

  it('unwraps a section the model opened itself, and carries partial screen CSS', () => {
    const tracker = createPrototypeLiveTracker();
    const ev = tracker.observePartialScreen({
      screenId: 'SCR-NEW',
      screenName: '新屏',
      partialHtml: '<section data-screen-id="SCR-NEW" class="x"><div>内容',
      css: '.x { color: red; } .y {',
    });
    if (ev?.kind !== 'screen') throw new Error('expected screen event');
    expect(ev.html.match(/<section/g)).toHaveLength(1);
    expect(ev.html).toContain('<div>内容</div>');
    expect(ev.css).toContain('.x { color: red; }');
  });

  it('does not overwrite a screen that is still streaming when another screen lands', () => {
    const tracker = createPrototypeLiveTracker();
    tracker.reset(DOC);
    tracker.observePartialScreen({ screenId: 'SCR-A', partialHtml: '<h1>午安' });
    const events = tracker.observeDocument(withScreenB('<p>订单列表</p>'), {
      streamingScreenIds: ['SCR-A'],
    });
    expect(events.map((e) => (e.kind === 'screen' ? e.screenId : e.kind))).toEqual(['SCR-B']);
    // once SCR-A's write ends, the document version of SCR-A is re-asserted
    const settled = tracker.observeDocument(withScreenB('<p>订单列表</p>'));
    expect(settled.map((e) => (e.kind === 'screen' ? e.screenId : e.kind))).toEqual(['SCR-A']);
  });
});

describe('applyPrototypeLiveEvent / buildPrototypeCanvasModel: the client side', () => {
  it('lays live screens over the saved document and ignores stale events', () => {
    const tracker = createPrototypeLiveTracker();
    tracker.reset(DOC);
    const ev1 = tracker.observePartialScreen({ screenId: 'SCR-B', partialHtml: '<p>订单 1' })!;
    const ev2 = tracker.observePartialScreen({ screenId: 'SCR-B', partialHtml: '<p>订单 1</p><p>订单 2' })!;
    let state = emptyPrototypeLiveState();
    state = applyPrototypeLiveEvent(state, ev2);
    state = applyPrototypeLiveEvent(state, ev1); // late, older seq: ignored
    expect(state.focusScreenId).toBe('SCR-B');

    const model = buildPrototypeCanvasModel(DOC, state);
    expect(model.screens.map((s) => s.screenId)).toEqual(['SCR-A', 'SCR-B']);
    const b = model.screens.find((s) => s.screenId === 'SCR-B')!;
    expect(b.status).toBe('streaming');
    expect(b.bodyHtml).toContain('订单 2');
    expect(b.bodyHtml).not.toContain('早上好');
    const a = model.screens.find((s) => s.screenId === 'SCR-A')!;
    expect(a.bodyHtml).toContain('早上好');
    expect(model.css).toContain('.proto-screen');
    expect(model.screens.find((s) => s.screenId === 'SCR-B')!.status).toBe('streaming');
  });

  it('builds artboards from live events alone when nothing has been saved yet', () => {
    const tracker = createPrototypeLiveTracker();
    const events: PrototypeLiveEvent[] = [
      ...tracker.observeDocument(DOC),
      tracker.observePartialScreen({ screenId: 'SCR-C', screenName: '退款', partialHtml: '<p>退款' })!,
    ];
    const state = events.reduce(applyPrototypeLiveEvent, emptyPrototypeLiveState());
    const model = buildPrototypeCanvasModel('', state);
    expect(model.screens.map((s) => [s.screenId, s.status])).toEqual([
      ['SCR-A', 'ready'],
      ['SCR-B', 'queued'],
      ['SCR-C', 'streaming'],
    ]);
    expect(model.screens[2]!.screenName).toBe('退款');
  });
});

describe('#89 review fixes', () => {
  it('healPartialHtml: an unquoted apostrophe does not swallow the rest; R&D is kept; a half end tag in a style is dropped', () => {
    expect(healPartialHtml("<p class=foo title=it's>ok</p><div>z")).toBe("<p class=foo title=it's>ok</p><div>z</div>");
    expect(healPartialHtml('<p>R&D')).toBe('<p>R&D</p>');
    expect(healPartialHtml('<p>A &nbs')).toBe('<p>A </p>');
    expect(healPartialHtml('<p>A &')).toBe('<p>A </p>');
    expect(healPartialHtml('<div><style>.a{color:red}</sty')).toBe('<div><style>.a{color:red}</style></div>');
  });

  it('a streamed screen has the same shape as the landed screen, so nodes keep their place', () => {
    const fragment = '<section class="page" data-element-id="EL-A"><h1>Hi</h1></section>\n<section class="page" data-element-id="EL-B"><p>two</p></section>';
    const streamed = healPartialScreenSection({ screenId: 'SCR-1', partialHtml: fragment }).html;
    const landed = `<section id="screen-SCR-1" class="proto-screen is-active" data-screen-id="SCR-1" data-screen-name="SCR-1" data-screen-type="LIST" data-screen-status="ready">\n${fragment}\n</section>`;
    const inner = (html: string) => html.slice(html.indexOf('>') + 1);
    expect(inner(streamed)).toBe(inner(landed));
  });

  it('shows only the frame’s screens plus screens still being written (no ghosts)', () => {
    const shell = (ids: string[]) =>
      `<!DOCTYPE html><html><head><style>.x{}</style></head><body><main id="proto-screens-root">${ids
        .map((i) => `<section data-screen-id="${i}" data-screen-name="${i}" data-screen-status="queued"></section>`)
        .join('')}</main></body></html>`;
    const tracker = createPrototypeLiveTracker();
    let state = emptyPrototypeLiveState();
    for (const e of tracker.observeDocument(shell(['SCR-A', 'SCR-B']))) state = applyPrototypeLiveEvent(state, e);
    for (const e of tracker.observeDocument(shell(['SCR-C']))) state = applyPrototypeLiveEvent(state, e);
    expect(buildPrototypeCanvasModel('', state).screens.map((s) => s.screenId)).toEqual(['SCR-C']);
    state = applyPrototypeLiveEvent(state, tracker.observePartialScreen({ screenId: 'SCR-D', partialHtml: '<p>新' })!);
    expect(buildPrototypeCanvasModel('', state).screens.map((s) => s.screenId)).toEqual(['SCR-C', 'SCR-D']);
  });

  it('focus follows screens being written, not queued placeholders, and clears when that screen lands', () => {
    const tracker = createPrototypeLiveTracker();
    let state = emptyPrototypeLiveState();
    for (const e of tracker.observeDocument(DOC)) state = applyPrototypeLiveEvent(state, e);
    expect(state.focusScreenId).toBeUndefined();
    state = applyPrototypeLiveEvent(state, tracker.observePartialScreen({ screenId: 'SCR-B', partialHtml: '<p>订' })!);
    expect(state.focusScreenId).toBe('SCR-B');
    for (const e of tracker.observeDocument(withScreenB('<p>订单</p>'))) state = applyPrototypeLiveEvent(state, e);
    expect(state.focusScreenId).toBeUndefined();
  });

  it('composes the whole live document for the single-page view, with head scripts kept', () => {
    const saved = DOC.replace('</head>', '<script id="head-js">window.ready = 1;</script></head>');
    const tracker = createPrototypeLiveTracker();
    tracker.reset(saved);
    let state = emptyPrototypeLiveState();
    state = applyPrototypeLiveEvent(state, tracker.observePartialScreen({ screenId: 'SCR-B', partialHtml: '<p>新订单' })!);
    const doc = composePrototypeDocument(saved, state);
    expect(doc).toContain('早上好');
    expect(doc).toContain('<p>新订单</p>');
    expect(doc).not.toContain('排队中');
    expect(doc).toContain('id="head-js"');
    expect(doc).toContain('<html lang="zh-CN">');
    const { frame } = splitPrototypeDocument(saved);
    expect(prototypeFrameAssets(frame).scripts).toEqual(['<script id="head-js">window.ready = 1;</script>']);
    expect(composePrototypeDocument(saved, null)).toBe(saved);
  });
});

describe('createPartialScreenThrottle: about one update per screen per interval, and the last one always arrives', () => {
  it('sends the first update at once, holds later ones, and flushes the latest after the interval', () => {
    vi.useFakeTimers();
    try {
      const sent: string[] = [];
      const throttle = createPartialScreenThrottle<string>({ intervalMs: 150, onFlush: (id, v) => sent.push(`${id}:${v}`) });
      throttle.push('A', 'a1');
      throttle.push('A', 'a2');
      throttle.push('B', 'b1');
      throttle.push('A', 'a3');
      expect(sent).toEqual(['A:a1', 'B:b1']);
      vi.advanceTimersByTime(160);
      expect(sent).toEqual(['A:a1', 'B:b1', 'A:a3']);
      throttle.push('B', 'b2'); // the interval has passed: sent at once
      throttle.push('B', 'b3'); // held
      throttle.end('B'); // the write ended: nothing pending is sent afterwards
      vi.advanceTimersByTime(500);
      expect(sent).toEqual(['A:a1', 'B:b1', 'A:a3', 'B:b2']);
      throttle.push('C', 'c1');
      throttle.push('C', 'c2');
      throttle.dispose();
      vi.advanceTimersByTime(500);
      expect(sent).toEqual(['A:a1', 'B:b1', 'A:a3', 'B:b2', 'C:c1']);
    } finally {
      vi.useRealTimers();
    }
  });
});
