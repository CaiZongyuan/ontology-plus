import { describe, expect, it } from 'vitest';
import {
  PROTOTYPE_STYLE_BOARD_ID,
  applyPrototypeLiveEvent,
  applyPrototypeStyleToDocument,
  buildPrototypeCanvasModel,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
  extractMuFromPrototypeHtml,
  prototypeStyleCss,
  readPrototypeDocumentStyle,
  readStreamingPrototypeStyle,
  resolvePrototypeStyleValues,
  sanitizeStyleCss,
  sanitizeStyleSampleHtml,
  splitPrototypeDocument,
  stripStyleValueOverrides,
  type PrototypeStyle,
} from '../index.js';

const APPROVED = {
  mode: 'light' as const,
  background: '#f5f3ee',
  surface: '#ffffff',
  accent: '#2e6a4e',
  ink: '#1d2621',
  fontFamily: '"PingFang SC", sans-serif',
  radiusPx: 10,
};

const DOC = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>订货</title>
  <style id="proto-shell-styles">body { margin: 0; }</style>
</head>
<body><main id="proto-screens-root"><section data-screen-id="SCR-A" data-screen-name="首页" class="proto-screen is-active"><button data-element-id="EL-A" data-element-type="BUTTON">去订货</button></section></main></body>
</html>`;

function style(over: Partial<PrototypeStyle> = {}): PrototypeStyle {
  return {
    direction: '墨绿配暖纸底色',
    values: resolvePrototypeStyleValues(APPROVED).values,
    componentCss: '.btn { height: var(--proto-control-h); background: var(--proto-accent); }',
    sampleHtml: '<section class="card"><button class="btn">提交订单</button><span class="tag">已收货</span></section>',
    locked: false,
    ...over,
  };
}

describe('Style values: approved Style Tile values are locked (#91)', () => {
  it('keeps every approved value whatever the lead proposes, and says which proposals were overridden', () => {
    const res = resolvePrototypeStyleValues({ accent: '#f94c05', ink: '#1d2621', warn: '#aa5500' }, APPROVED);
    expect(res.locked).toBe(true);
    expect(res.values.accent).toBe('#2e6a4e');
    expect(res.values.background).toBe('#f5f3ee');
    expect(res.values.radiusPx).toBe(10);
    // The lead may still fill what the approved tile does not say.
    expect(res.values.warn).toBe('#aa5500');
    expect(res.overridden).toEqual(['accent']);
  });

  it('without an approved tile the lead proposes the values; unusable ones are dropped, missing ones filled', () => {
    const res = resolvePrototypeStyleValues({ accent: 'url(javascript:x)', ink: '#222', radiusPx: '14px', mode: 'dark' });
    expect(res.locked).toBe(false);
    expect(res.values.ink).toBe('#222');
    expect(res.values.radiusPx).toBe(14);
    expect(res.values.mode).toBe('dark');
    expect(res.values.accent).toMatch(/^#/);
    expect(res.values.accent).not.toBe('#f94c05');
  });
});

describe('The style lives in the single prototype document (ADR 0005)', () => {
  it('goes first in <head>, round-trips, and is replaced (not duplicated) on a restyle', () => {
    const once = applyPrototypeStyleToDocument(DOC, style({ locked: true }));
    expect(once.indexOf('data-proto-style')).toBeLessThan(once.indexOf('proto-shell-styles'));
    const read = readPrototypeDocumentStyle(once)!;
    expect(read.direction).toBe('墨绿配暖纸底色');
    expect(read.locked).toBe(true);
    expect(read.css).toContain('--proto-accent: #2e6a4e');
    expect(read.css).toContain('.btn {');
    expect(read.sampleHtml).toContain('提交订单');

    const twice = applyPrototypeStyleToDocument(once, style({ direction: '换个方向', sampleHtml: '<p>新样张</p>' }));
    expect(twice.match(/<style data-proto-style/g)).toHaveLength(1);
    expect(twice.match(/data-proto-style-tile/g)).toHaveLength(1);
    expect(readPrototypeDocumentStyle(twice)!.sampleHtml).toBe('<p>新样张</p>');
    // Screens are untouched; the samples are never a screen.
    const { screens } = splitPrototypeDocument(twice);
    expect(screens.map((s) => s.screenId)).toEqual(['SCR-A']);
  });

  it('strips anchors and scripts from the samples: the style tile is not part of the UI model', () => {
    const doc = applyPrototypeStyleToDocument(
      DOC,
      style({ sampleHtml: '<button data-element-id="EL-X" data-screen-id="SCR-X">x</button><script>alert(1)</script>' }),
    );
    const read = readPrototypeDocumentStyle(doc)!;
    expect(read.sampleHtml).not.toMatch(/data-element-id|data-screen-id|<script/);
  });
});

describe('The 「风格样张」 artboard streams from define_style arguments', () => {
  it('heals half-written samples and CSS, applying the locked values from the first token', () => {
    const partial = readStreamingPrototypeStyle(
      {
        direction: '墨绿',
        values: { accent: '#ff0000' },
        componentCss: '.btn { color: red; }\n.tag { backgr',
        sampleHtml: '<section class="card"><button class="btn">提交</bu',
      },
      APPROVED,
    )!;
    expect(partial.locked).toBe(true);
    expect(partial.css).toContain('--proto-accent: #2e6a4e');
    expect(partial.css).toContain('.btn { color: red; }');
    expect(partial.css).not.toContain('.tag');
    expect(partial.sampleHtml).toBe('<section class="card"><button class="btn">提交</button></section>');
    expect(readStreamingPrototypeStyle({})).toBeNull();
  });

  it('folds into a first artboard that the follow camera aims at while it is written, and survives reload', () => {
    const tracker = createPrototypeLiveTracker();
    const streaming = tracker.observeStyle(readStreamingPrototypeStyle({ values: {}, sampleHtml: '<p>样张' })!, 'streaming')!;
    expect(tracker.observeStyle(readStreamingPrototypeStyle({ values: {}, sampleHtml: '<p>样张' })!, 'streaming')).toBeNull();
    let state = applyPrototypeLiveEvent(emptyPrototypeLiveState(), streaming);
    expect(state.focusScreenId).toBe(PROTOTYPE_STYLE_BOARD_ID);
    let model = buildPrototypeCanvasModel('', state);
    expect(model.style).toMatchObject({ status: 'streaming' });
    expect(model.style!.bodyHtml).toContain('<p>样张</p>');
    expect(model.screens).toHaveLength(0);

    const ready = tracker.observeStyle(readStreamingPrototypeStyle({ values: {}, sampleHtml: '<p>样张</p>' })!, 'ready')!;
    state = applyPrototypeLiveEvent(state, ready);
    expect(state.focusScreenId).toBeUndefined();

    // After the run, the saved document alone brings the same artboard back.
    const saved = applyPrototypeStyleToDocument(DOC, style());
    model = buildPrototypeCanvasModel(saved, null);
    expect(model.style).toMatchObject({ status: 'ready', direction: '墨绿配暖纸底色' });
    expect(model.style!.css).toContain('--proto-accent');
    expect(model.screens.map((s) => s.screenId)).toEqual(['SCR-A']);
    // Screens get the shared look through the frame's stylesheet.
    expect(model.css).toContain('.btn {');
    // A document without a style has no style artboard.
    expect(buildPrototypeCanvasModel(DOC, null).style).toBeUndefined();
  });
});

describe('Style lock protection, legacy shell restyling, sanitizers & MU extraction (#91)', () => {
  it('P1: strips --proto-* overrides in CSS blocks, CSS escapes/comments, and inline style attributes', () => {
    const css = prototypeStyleCss({
      values: resolvePrototypeStyleValues(APPROVED, APPROVED).values,
      componentCss: [
        ':root { --proto-accent: #ff0000; --c-accent: var(--proto-accent); }',
        'body, [data-screen-id] { --/**/proto-bg: #000000; --\\70 roto-text: #ffffff; color: var(--proto-text); }',
      ].join('\n'),
    });
    expect(css).toContain('--proto-accent: #2e6a4e');
    expect(css).not.toContain('#ff0000');
    expect(css).not.toContain('#000000');
    expect(css).toContain('--c-accent: var(--proto-accent)');

    const bypassDoc = `<!DOCTYPE html><html><head><style>:root { --proto-accent: #ff00ff; }</style></head><body style="--proto-bg: #111111; margin: 0"><main id="proto-screens-root"><section data-screen-id="SCR-A" style="--proto-accent: #ff00ff; padding: 12px"><button data-element-id="EL-A" data-element-type="BUTTON">提交</button></section></main></body></html>`;
    const restyled = applyPrototypeStyleToDocument(
      bypassDoc,
      style({
        locked: true,
        sampleHtml: '<div class="swatch" style="--proto-accent: #ff00ff; background: var(--proto-accent)">主色</div>',
      }),
    );
    expect(restyled).not.toContain('#ff00ff');
    expect(restyled).not.toContain('#111111');
    expect(restyled).toContain('padding: 12px');
    expect(readPrototypeDocumentStyle(restyled)!.sampleHtml).toContain('background: var(--proto-accent)');
    expect(readPrototypeDocumentStyle(restyled)!.sampleHtml).not.toContain('--proto-accent:');
    expect(stripStyleValueOverrides('--\\70 roto-accent: red; color: blue;').trim()).toBe('color: blue;');
  });

  it('P2: upgrades real pre-#91 initPrototypeShell HTML cleanly on restyle while keeping screen styles', () => {
    // Verbatim output shape of b5a6e7a initPrototypeShell (+ an appended screen CSS comment block).
    const legacyShellHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>门店订货</title>
  <style id="proto-shell-styles">
    :root {
      --proto-bg: #f6f4f0;
      --proto-card: #fffdf9;
      --proto-accent: #f94c05;
      --proto-border: #dfd6c7;
      --proto-text: #1f1d1a;
      --proto-muted: #6e675d;
      --proto-radius: 12px;
      --proto-font: 'Inter', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--proto-font);
      background: var(--proto-bg);
      color: var(--proto-text);
      line-height: 1.5;
      font-variant-numeric: tabular-nums;
    }
    .proto-app-shell {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .proto-topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 24px;
      background: var(--proto-card);
      border-bottom: 1px solid var(--proto-border);
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .proto-brand {
      display: flex;
      align-items: baseline;
      gap: 10px;
    }
    .proto-brand h1 {
      margin: 0;
      font-size: 17px;
      font-weight: 700;
    }
    .proto-brand span {
      font-size: 12px;
      color: var(--proto-muted);
    }
    .proto-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .proto-nav-tab {
      appearance: none;
      border: 1px solid transparent;
      background: transparent;
      color: var(--proto-muted);
      padding: 6px 13px;
      border-radius: calc(var(--proto-radius) - 4px);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 160ms ease-out;
    }
    .proto-nav-tab:hover {
      color: var(--proto-text);
      border-color: var(--proto-border);
    }
    .proto-nav-tab.is-active {
      background: var(--proto-accent);
      color: #ffffff;
      border-color: var(--proto-accent);
    }
    .proto-screens-stage {
      flex: 1;
      width: 100%;
      max-width: 1380px;
      margin: 0 auto;
      padding: 22px 24px 40px;
    }
    .proto-screen {
      display: none;
      animation: protoFadeIn 200ms ease-out;
    }
    .proto-screen.is-active {
      display: block;
    }
    @keyframes protoFadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .proto-card, .card {
      background: var(--proto-card);
      border: 1px solid var(--proto-border);
      border-radius: var(--proto-radius);
      padding: 18px;
    }
    @media (max-width: 768px) {
      .proto-topbar { padding: 12px 16px; }
      .proto-screens-stage { padding: 16px; }
    }
    /* [SCR-A] */
    .order-kpi { display: grid; gap: 10px; }
  </style>
  <style data-screen-css="SCR-A">[data-screen-id="SCR-A"] .summary { gap: var(--proto-gap); }</style>
</head>
<body>
  <div class="proto-app-shell">
    <header class="proto-topbar">
      <div class="proto-brand"><h1>门店订货</h1><span>旧版</span></div>
      <nav class="proto-nav">
        <button type="button" class="proto-nav-tab is-active" data-element-id="EL-SHELL-TAB-SCR-A" data-element-type="TAB" data-nav-screen="SCR-A">首页</button>
      </nav>
    </header>
    <main id="proto-screens-root" class="proto-screens-stage">
      <section id="screen-SCR-A" class="proto-screen is-active" data-screen-id="SCR-A" data-screen-name="首页" data-screen-type="DASHBOARD">
        <div class="card"><button data-element-id="EL-GO" data-element-type="BUTTON">开始订货</button></div>
      </section>
    </main>
  </div>
</body>
</html>`;

    const restyled = applyPrototypeStyleToDocument(
      legacyShellHtml,
      style({
        locked: true,
        componentCss: '.card { padding: var(--proto-pad); border-radius: var(--proto-radius); }',
      }),
    );
    expect(restyled).not.toMatch(/#f94c05|max-width:\s*1380px/);
    const shellCss = /<style id="proto-shell-styles">([\s\S]*?)<\/style>/.exec(restyled)![1]!;
    expect(shellCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(shellCss).not.toMatch(/\.proto-card,\s*\.card/);
    expect(shellCss).toContain(':where(');
    expect(shellCss).toContain('.proto-topbar');
    expect(shellCss).toContain('.proto-nav-tab');
    // Existing custom/screen styles survive the restyle.
    expect(shellCss).toContain('.order-kpi { display: grid; gap: 10px; }');
    expect(restyled).toContain('<style data-screen-css="SCR-A">');
    expect(readPrototypeDocumentStyle(restyled)!.css).toContain('--proto-accent: #2e6a4e');
  });

  it('S4: sanitizes style sample HTML and CSS against event attributes, javascript: URLs and leaking tags', () => {
    const dirtySample = [
      '<style>body{background:red}</style>',
      '<link rel="stylesheet" href="https://evil.example/x.css">',
      '<iframe src="https://evil.example/frame" />',
      '<iframe src="https://evil.example/paired">leak</iframe>',
      '<button class="btn"onclick="alert(1)" ONMOUSEOVER=\'evil()\' onfocus=run()>',
      '<a class="nav"href="java\n\tscript:alert(1)">链接1</a>',
      '<a href="&#106;avascript:alert(2)">链接2</a>',
      '<form action=javascript:evil()><button formaction="&#x6A;avascript:evil()">提交</button></form>',
      '</button>',
      '<div class="card">安全内容</div>',
    ].join('');
    const cleanSample = sanitizeStyleSampleHtml(dirtySample);
    expect(cleanSample).toContain('<div class="card">安全内容</div>');
    expect(cleanSample).not.toMatch(/<style|<link|<iframe|onclick|onmouseover|onfocus|javascript:/i);
    expect(cleanSample).not.toMatch(/&#106;|&#x6a;/i);

    const dirtyCss = [
      '@import url("https://evil.example/a.css");',
      '.btn { background-image: url("java\n\tscript:alert(1)"); list-style-image: url("java\\\nscript:alert(2)"); width: expression(alert(1)); }',
      '</style><script>alert(1)</script>',
    ].join('\n');
    const cleanCss = sanitizeStyleCss(dirtyCss);
    expect(cleanCss).not.toMatch(/@import|javascript:|expression\s*\(|<\/?style|<script/i);
  });

  it('extracts MU screens and elements from a styled document without picking up style-tile samples', () => {
    const docWithStyleAndScreenCss = applyPrototypeStyleToDocument(
      DOC.replace(
        '</head>',
        '  <style data-screen-css="SCR-A">[data-screen-id="SCR-A"] .kpi { display: grid; }</style>\n</head>',
      ),
      style({
        sampleHtml:
          '<section class="card" data-screen-id="SCR-SAMPLE"><button class="btn" data-element-id="EL-SAMPLE" data-event-id="UIE-SAMPLE">样张按钮</button><input data-element-id="EL-INPUT-SAMPLE" /></section>',
      }),
    );
    const mu = extractMuFromPrototypeHtml(docWithStyleAndScreenCss, 'store_order');
    expect(mu.screens.map((s) => s.screenId)).toEqual(['SCR-A']);
    expect(mu.screens[0]!.elements.map((e) => e.elementId)).toEqual(['EL-A']);
  });
});
