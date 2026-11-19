import { describe, expect, it } from 'vitest';
import {
  PROTOTYPE_TOURS_ATTR,
  applyPrototypeLiveEvent,
  applyPrototypeStyleToDocument,
  composePrototypeDocument,
  computeMuDiff,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
  ensurePrototypeNavigationRuntime,
  extractMuFromPrototypeHtml,
  prototypeFrameAssets,
  readPrototypeDemoTours,
  resolvePrototypeStyleValues,
  splitPrototypeDocument,
  validatePrototypeDemoTours,
  writePrototypeDemoTours,
  type PrototypeDemoTour,
} from '../index.js';

const SAMPLE_PROTOTYPE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>禾木烘焙 · 门店订货</title>
</head>
<body>
  <div class="proto-app-shell">
    <main id="proto-screens-root" class="proto-screens-stage">
      <section id="screen-SCR-HOME" class="proto-screen is-active" data-screen-id="SCR-HOME" data-screen-name="工作台首页" data-screen-type="DASHBOARD" data-screen-status="ready">
        <div data-element-id="EL-HOME-GREET" data-element-type="CONTAINER" data-element-label="问候语" data-note="问候语：告诉店长今天要处理什么。">早上好，王店长</div>
        <button data-element-id="EL-HOME-NEW-ORDER" data-element-type="BUTTON" data-element-label="新建订单" data-event-id="UIE-START-ORDER" data-navigate-to="SCR-NEW-ORDER">新建订单</button>
      </section>
      <section id="screen-SCR-NEW-ORDER" class="proto-screen" data-screen-id="SCR-NEW-ORDER" data-screen-name="新建订货单" data-screen-type="FORM" data-screen-status="ready">
        <input data-element-id="EL-NEW-SEARCH" data-element-type="INPUT" data-element-label="商品搜索" data-binding="StoreOrder.productName" />
        <button data-element-id="EL-NEW-INC" data-element-type="BUTTON" data-element-label="增加数量">+</button>
        <button data-element-id="EL-NEW-SUBMIT" data-element-type="BUTTON" data-element-label="提交订货" data-event-id="UIE-SUBMIT-ORDER">提交订货单</button>
      </section>
      <section id="screen-SCR-QUEUED" class="proto-screen" data-screen-id="SCR-QUEUED" data-screen-name="待画页面" data-screen-type="LIST" data-screen-status="queued"></section>
    </main>
  </div>
</body>
</html>`;

const VALID_TOURS: PrototypeDemoTour[] = [
  {
    id: 'first-order',
    goal: '门店第一次订货',
    audience: '店长',
    steps: [
      {
        screenId: 'SCR-HOME',
        elementId: 'EL-HOME-GREET',
        action: 'look',
        caption: '王店长早上打开工作台，先看今天要处理什么。',
      },
      {
        screenId: 'SCR-HOME',
        elementId: 'EL-HOME-NEW-ORDER',
        action: 'click',
        caption: '发现可颂快卖完了，点「新建订单」开始订货。',
      },
      {
        screenId: 'SCR-NEW-ORDER',
        elementId: 'EL-NEW-SEARCH',
        action: 'type',
        text: '可颂',
        caption: '在商品搜索里输入要订的商品。',
      },
      {
        screenId: 'SCR-NEW-ORDER',
        elementId: 'EL-NEW-INC',
        action: 'click',
        times: 3,
        caption: '把黄油可颂加到 3 箱。',
      },
      {
        screenId: 'SCR-NEW-ORDER',
        elementId: 'EL-NEW-SUBMIT',
        action: 'click',
        caption: '确认无误，提交订货单。',
      },
    ],
  },
  {
    id: 'morning-check',
    goal: '早班巡检待办',
    audience: '店长',
    steps: [
      {
        screenId: 'SCR-HOME',
        action: 'look',
        caption: '先整体浏览工作台首页的待办提醒。',
      },
      {
        screenId: 'SCR-HOME',
        elementId: 'EL-HOME-GREET',
        action: 'look',
        caption: '确认今日待收货与待审批事项。',
      },
    ],
  },
];

describe('Demo Tours in ontology-core (#95)', () => {
  it('round-trips Demo Tours inside 界面原型.html, safely escapes </script> and comments, and removes empty blocks', () => {
    expect(PROTOTYPE_TOURS_ATTR).toBe('data-proto-tours');
    expect(readPrototypeDemoTours(SAMPLE_PROTOTYPE_HTML)).toEqual([]);

    const trickyTours: PrototypeDemoTour[] = [
      {
        id: 'escape-check',
        goal: '测试特殊字符容错',
        audience: '店长',
        steps: [
          {
            screenId: 'SCR-NEW-ORDER',
            elementId: 'EL-NEW-SEARCH',
            action: 'type',
            text: '</script><script>window.__bad=1</script><!--comment-->',
            caption: '输入特殊符号 A & B 后继续核对。',
          },
          {
            screenId: 'SCR-NEW-ORDER',
            elementId: 'EL-NEW-SUBMIT',
            action: 'click',
            caption: '提交订货单。',
          },
        ],
      },
    ];

    const written = writePrototypeDemoTours(SAMPLE_PROTOTYPE_HTML, trickyTours);
    expect(written).toContain('<script type="application/json" data-proto-tours>');
    // Must never embed a raw closing </script> inside the JSON payload
    const scriptMatches = written.match(/<\/script>/gi) ?? [];
    expect(scriptMatches).toHaveLength(1);

    const parsed = readPrototypeDemoTours(written);
    expect(parsed).toEqual(trickyTours);

    // Replacing existing tours updates in place without duplicating blocks
    const replaced = writePrototypeDemoTours(written, VALID_TOURS);
    expect(replaced.match(/data-proto-tours/g)).toHaveLength(1);
    expect(readPrototypeDemoTours(replaced)).toEqual(VALID_TOURS);

    // Clearing tours removes the block cleanly
    const cleared = writePrototypeDemoTours(replaced, []);
    expect(cleared).not.toContain('data-proto-tours');
    expect(readPrototypeDemoTours(cleared)).toEqual([]);
  });

  it('validates screenId and elementId anchors against the document and rejects missing or cross-screen anchors', () => {
    const okResult = validatePrototypeDemoTours(SAMPLE_PROTOTYPE_HTML, VALID_TOURS, {
      minTours: 2,
      maxTours: 4,
    });
    expect(okResult.ok).toBe(true);
    expect(okResult.issues).toEqual([]);
    expect(okResult.tours).toEqual(VALID_TOURS);

    // Rejects missing screen, element on another screen, nonexistent element, queued empty screen, and missing type text
    const invalidResult = validatePrototypeDemoTours(
      SAMPLE_PROTOTYPE_HTML,
      [
        {
          id: 'bad-tour',
          goal: '错误锚点路线',
          steps: [
            {
              screenId: 'SCR-MISSING',
              elementId: 'EL-HOME-GREET',
              action: 'look',
              caption: '引用了不存在的屏幕。',
            },
            {
              screenId: 'SCR-HOME',
              elementId: 'EL-NEW-SEARCH',
              action: 'look',
              caption: '引用了另一屏的元素。',
            },
            {
              screenId: 'SCR-HOME',
              elementId: 'EL-GHOST',
              action: 'click',
              caption: '引用了不存在的元素。',
            },
            {
              screenId: 'SCR-QUEUED',
              action: 'look',
              caption: '引用了尚未绘制完成的空白屏幕。',
            },
            {
              screenId: 'SCR-NEW-ORDER',
              elementId: 'EL-NEW-SEARCH',
              action: 'type',
              caption: '输入动作缺少 text。',
            },
          ],
        },
      ],
      { minTours: 2, maxTours: 4, locale: 'zh-CN' },
    );

    expect(invalidResult.ok).toBe(false);
    const codes = invalidResult.issues.map((i) => i.code);
    expect(codes).toContain('invalid_tour_count');
    expect(codes).toContain('unknown_screen');
    expect(codes).toContain('unknown_element');
    expect(codes).toContain('screen_not_ready');
    expect(codes).toContain('missing_type_text');
    // Diagnostics list available anchors so the agent can self-correct
    const messages = invalidResult.issues.map((i) => i.message).join('\n');
    expect(messages).toContain('SCR-MISSING');
    expect(messages).toContain('EL-NEW-SEARCH');
    expect(messages).toContain('EL-HOME-GREET');
  });

  it('preserves data-proto-tours across splitPrototypeDocument, composePrototypeDocument, applyPrototypeStyleToDocument, and navigation runtime', () => {
    const withTours = writePrototypeDemoTours(SAMPLE_PROTOTYPE_HTML, VALID_TOURS);

    // 1. splitPrototypeDocument + prototypeFrameAssets + live tracker + composePrototypeDocument
    const split = splitPrototypeDocument(withTours);
    expect(readPrototypeDemoTours(split.frame.headHtml)).toEqual(VALID_TOURS);
    // JSON data block must NOT be injected as an executable <head> script on every artboard
    expect(prototypeFrameAssets(split.frame).scripts).toEqual([]);

    const tracker = createPrototypeLiveTracker();
    let live = emptyPrototypeLiveState();
    for (const ev of tracker.observeDocument(withTours)) {
      live = applyPrototypeLiveEvent(live, ev);
    }
    const composed = composePrototypeDocument(SAMPLE_PROTOTYPE_HTML, live);
    expect(readPrototypeDemoTours(composed)).toEqual(VALID_TOURS);

    // 2. applyPrototypeStyleToDocument
    const resolved = resolvePrototypeStyleValues({ mode: 'light', accent: '#2e6a4e' });
    const restyled = applyPrototypeStyleToDocument(withTours, {
      direction: '墨绿暖纸',
      values: resolved.values,
      componentCss: '.btn { border-radius: var(--proto-radius-sm); }',
      sampleHtml: '<div data-element-id="EL-FAKE">样张</div>',
      locked: false,
    });
    expect(readPrototypeDemoTours(restyled)).toEqual(VALID_TOURS);

    // 3. Standalone navigation runtime
    const standalone = ensurePrototypeNavigationRuntime(restyled);
    expect(readPrototypeDemoTours(standalone)).toEqual(VALID_TOURS);
  });

  it('never extracts Demo Tours into the MU UI Model', () => {
    const muBefore = extractMuFromPrototypeHtml(SAMPLE_PROTOTYPE_HTML, '门店订货');
    const htmlWithTours = writePrototypeDemoTours(SAMPLE_PROTOTYPE_HTML, VALID_TOURS);
    const muAfter = extractMuFromPrototypeHtml(htmlWithTours, '门店订货');

    expect(muAfter).toEqual(muBefore);
    const diff = computeMuDiff(muBefore, muAfter);
    expect(diff.summary.addedScreens).toBe(0);
    expect(diff.summary.removedScreens).toBe(0);
    expect(diff.summary.modifiedScreens).toBe(0);
    expect(diff.summary.addedElements).toBe(0);
    expect(diff.summary.modifiedElements).toBe(0);
    expect(JSON.stringify(muAfter)).not.toContain('first-order');
    expect(JSON.stringify(muAfter)).not.toContain('门店第一次订货');
  });
});
