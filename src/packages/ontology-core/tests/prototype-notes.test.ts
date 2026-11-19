import { describe, expect, it } from 'vitest';
import {
  PROTOTYPE_NOTE_ATTR,
  applyPrototypeLiveEvent,
  computeMuDiff,
  createPrototypeLiveTracker,
  derivePrototypeLiveWriting,
  emptyPrototypeLiveState,
  extractMuFromPrototypeHtml,
  parsePrototypeNote,
  readPrototypeNotes,
  sanitizePrototypeNote,
  writePrototypeNote,
} from '../index.js';

const SAMPLE_SCREEN = `<section id="screen-SCR-HOME" class="proto-screen is-active" data-screen-id="SCR-HOME" data-screen-name="工作台首页" data-screen-type="DASHBOARD" data-screen-status="ready">
  <section class="page" data-element-id="EL-HOME-GREET" data-note="问候语：告诉店长今天最要紧的一件事。" data-element-type="CONTAINER" data-element-label="问候语">
    <div class="row">
      <h1>早上好，王店长</h1>
      <button class="btn primary" data-element-id="EL-HOME-NEW-ORDER" data-element-type="BUTTON" data-element-label="新建订单" data-note="新建订单：店长发现缺货时，从这里开始订货。">新建订单</button>
    </div>
  </section>
  <section class="page" data-element-id="EL-HOME-PLAIN" data-element-type="CONTAINER" data-element-label="底部栏">
    <button class="btn" data-element-id="EL-HOME-REFRESH" data-element-type="BUTTON" data-element-label="刷新">刷新</button>
  </section>
</section>`;

describe('Prototype Notes in ontology-core (#92)', () => {
  it('sanitizes and parses Prototype Notes into optional title and business body', () => {
    expect(PROTOTYPE_NOTE_ATTR).toBe('data-note');
    expect(sanitizePrototypeNote('  新建订单：\n  店长<b>缺货</b>时，从这里开始 &amp; 提交。 ')).toBe(
      '新建订单： 店长缺货时，从这里开始 & 提交。',
    );
    expect(sanitizePrototypeNote('   ')).toBe('');

    expect(parsePrototypeNote('新建订单：店长发现缺货时，从这里开始订货。')).toEqual({
      title: '新建订单',
      body: '店长发现缺货时，从这里开始订货。',
    });
    expect(parsePrototypeNote("Manager's queue: orders waiting for approval.")).toEqual({
      title: "Manager's queue",
      body: 'orders waiting for approval.',
    });
    expect(parsePrototypeNote('按等待时间从长到短排列。')).toEqual({
      body: '按等待时间从长到短排列。',
    });
    expect(parsePrototypeNote('')).toBeNull();
  });

  it('reads, writes, updates, and removes data-note on anchored elements without disturbing surrounding HTML', () => {
    const initial = readPrototypeNotes(SAMPLE_SCREEN);
    expect(initial).toEqual([
      {
        elementId: 'EL-HOME-GREET',
        screenId: 'SCR-HOME',
        note: '问候语：告诉店长今天最要紧的一件事。',
        title: '问候语',
        body: '告诉店长今天最要紧的一件事。',
      },
      {
        elementId: 'EL-HOME-NEW-ORDER',
        screenId: 'SCR-HOME',
        note: '新建订单：店长发现缺货时，从这里开始订货。',
        title: '新建订单',
        body: '店长发现缺货时，从这里开始订货。',
      },
    ]);

    // Add a note with quotes & apostrophes to an element that had none
    const withRefreshNote = writePrototypeNote(
      SAMPLE_SCREEN,
      { elementId: 'EL-HOME-REFRESH', screenId: 'SCR-HOME' },
      '刷新数据：重新拉取门店 "最新" 库存 & 店长\'s 待办。',
    );
    const afterAdd = readPrototypeNotes(withRefreshNote, { screenId: 'SCR-HOME' });
    expect(afterAdd).toHaveLength(3);
    expect(afterAdd[2]).toEqual({
      elementId: 'EL-HOME-REFRESH',
      screenId: 'SCR-HOME',
      note: '刷新数据：重新拉取门店 "最新" 库存 & 店长\'s 待办。',
      title: '刷新数据',
      body: '重新拉取门店 "最新" 库存 & 店长\'s 待办。',
    });

    // Update an existing note
    const updated = writePrototypeNote(
      withRefreshNote,
      { elementId: 'EL-HOME-NEW-ORDER' },
      '发起订货：选择商品并提交给供应商。',
    );
    expect(readPrototypeNotes(updated).find((n) => n.elementId === 'EL-HOME-NEW-ORDER')?.note).toBe(
      '发起订货：选择商品并提交给供应商。',
    );

    // Remove a note by passing null
    const removed = writePrototypeNote(updated, { elementId: 'EL-HOME-REFRESH' }, null);
    expect(readPrototypeNotes(removed).map((n) => n.elementId)).toEqual([
      'EL-HOME-GREET',
      'EL-HOME-NEW-ORDER',
    ]);
    // Untouched inner text stays intact
    expect(removed).toContain('>刷新</button>');
  });

  it('extracts data-note as UIElement.description in MU extraction and tracks note changes in computeMuDiff', () => {
    const htmlWithApostrophe = `<section data-screen-id="SCR-ORDERS" data-screen-name="订货单列表" data-screen-type="LIST">
      <button data-element-id="EL-APPROVE" data-element-type="BUTTON" data-element-label="审批" data-note="Store manager's approval: releases payment to supplier.">审批</button>
      <input data-element-id="EL-SEARCH" data-element-type="INPUT" data-element-label="搜索" />
    </section>`;
    const mu1 = extractMuFromPrototypeHtml(htmlWithApostrophe, '门店订货');
    const els = mu1.screens[0]!.elements;
    expect(els.find((e) => e.elementId === 'EL-APPROVE')?.description).toBe(
      "Store manager's approval: releases payment to supplier.",
    );
    expect(els.find((e) => e.elementId === 'EL-SEARCH')?.description).toBeUndefined();

    const updatedHtml = writePrototypeNote(
      htmlWithApostrophe,
      { elementId: 'EL-APPROVE' },
      '审批通过：通知财务在 3 个工作日内打款。',
    );
    const mu2 = extractMuFromPrototypeHtml(updatedHtml, '门店订货');
    const diff = computeMuDiff(mu1, mu2);
    expect(diff.summary.modifiedElements).toBe(1);
    const approveDiff = diff.screens[0]!.elements.find((e) => e.elementId === 'EL-APPROVE')!;
    expect(approveDiff.changedFields).toContainEqual({
      field: 'description',
      before: "Store manager's approval: releases payment to supplier.",
      after: '审批通过：通知财务在 3 个工作日内打款。',
    });
  });

  it('derives live cursor target and narration strictly from data-note or enclosing section heading, never guessing when neither exists', () => {
    const shell = `<!DOCTYPE html><html><body>
      <header><button data-element-id="EL-SHELL-TAB-SCR-ORDERS">订货单</button></header>
      <main id="proto-screens-root">
        <section data-screen-id="SCR-ORDERS" data-screen-name="订货单列表" data-screen-status="queued"></section>
      </main>
    </body></html>`;
    const tracker = createPrototypeLiveTracker();
    let state = emptyPrototypeLiveState();
    for (const ev of tracker.observeDocument(shell)) state = applyPrototypeLiveEvent(state, ev);

    // 1. Opening tag with data-element-id + data-note arrives BEFORE inner content (实现决策 · 6)
    const evOpening = tracker.observePartialScreen({
      screenId: 'SCR-ORDERS',
      screenName: '订货单列表',
      partialHtml: `<section class="page" data-element-id="EL-ORDERS-FILTER" data-note="筛选区：按状态切换，也可以按订单号搜索。"><div class="row`,
    })!;
    state = applyPrototypeLiveEvent(state, evOpening);
    expect(derivePrototypeLiveWriting(state.screens['SCR-ORDERS']!.html, { screenId: 'SCR-ORDERS' })).toEqual({
      elementId: 'EL-ORDERS-FILTER',
      narration: '正在画「筛选区」：按状态切换，也可以按订单号搜索。',
    });

    // 2. Nested child without its own data-note inherits the enclosing element's data-note while cursor moves to the child
    const evNested = tracker.observePartialScreen({
      screenId: 'SCR-ORDERS',
      screenName: '订货单列表',
      partialHtml: `<section class="page" data-element-id="EL-ORDERS-FILTER" data-note="筛选区：按状态切换，也可以按订单号搜索。"><input data-element-id="EL-ORDERS-INPUT" data-element-label="订单号">`,
    })!;
    state = applyPrototypeLiveEvent(state, evNested);
    expect(derivePrototypeLiveWriting(state.screens['SCR-ORDERS']!.html, { screenId: 'SCR-ORDERS' })).toEqual({
      elementId: 'EL-ORDERS-INPUT',
      narration: '正在画「筛选区」：按状态切换，也可以按订单号搜索。',
    });

    // 3. Section with a heading (<h2>) and no data-note narrates from the section heading
    const evHeading = tracker.observePartialScreen({
      screenId: 'SCR-ORDERS',
      screenName: '订货单列表',
      partialHtml: `<section class="page"><div class="card"><h2>商品明细</h2><table data-element-id="EL-DETAIL-LINES" data-element-label="明细表"><tr><td>法棍`,
    })!;
    state = applyPrototypeLiveEvent(state, evHeading);
    expect(derivePrototypeLiveWriting(state.screens['SCR-ORDERS']!.html, { screenId: 'SCR-ORDERS' })).toEqual({
      elementId: 'EL-DETAIL-LINES',
      narration: '正在画「商品明细」',
    });
    expect(
      derivePrototypeLiveWriting(state.screens['SCR-ORDERS']!.html, {
        screenId: 'SCR-ORDERS',
        locale: 'en-US',
      }),
    ).toEqual({
      elementId: 'EL-DETAIL-LINES',
      narration: 'Drawing "商品明细"',
    });

    // 4. Element with NEITHER data-note NOR section heading -> elementId is measured, narration is undefined!
    const evNoNoteNoHeading = tracker.observePartialScreen({
      screenId: 'SCR-ORDERS',
      screenName: '订货单列表',
      partialHtml: `<div class="actions"><button data-element-id="EL-PLAIN-BTN" data-element-type="BUTTON" data-element-label="提交订单">提交订单</button>`,
    })!;
    state = applyPrototypeLiveEvent(state, evNoNoteNoHeading);
    expect(derivePrototypeLiveWriting(state.screens['SCR-ORDERS']!.html, { screenId: 'SCR-ORDERS' })).toEqual({
      elementId: 'EL-PLAIN-BTN',
    });

    // 5. Shell header anchors outside the target screen are never mistaken for live elements of an empty screen
    expect(derivePrototypeLiveWriting(shell, { screenId: 'SCR-ORDERS' })).toEqual({});
  });
});
