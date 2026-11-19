import { describe, expect, it } from 'vitest';
import {
  PROTOTYPE_STYLE_BOARD_ID,
  applyPrototypeLiveEvent,
  applyPrototypeStyleToDocument,
  buildPrototypeCanvasModel,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
  readPrototypeDocumentStyle,
  readStreamingPrototypeStyle,
  resolvePrototypeStyleValues,
  splitPrototypeDocument,
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
