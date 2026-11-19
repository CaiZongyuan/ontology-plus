import { describe, expect, it } from 'vitest';
import {
  PROTOTYPE_NOTE_ATTR,
  applyPrototypeLiveEvent,
  computeMuDiff,
  createPrototypeLiveTracker,
  derivePrototypeLiveWriting,
  emptyPrototypeLiveState,
  extractMuFromPrototypeHtml,
  parseModelYaml,
  parsePrototypeNote,
  readPrototypeNotes,
  sanitizePrototypeNote,
  serializeModelYaml,
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

  it('supports screen-root data-note in readPrototypeNotes/writePrototypeNote and never corrupts data-note* prefixes or quoted attributes', () => {
    const tricky = `<section data-screen-id="SCR-1" data-notes="keep-screen"><div data-element-id="EL-1" data-notes="x" title="a data-note=b">正文</div></section>`;
    const withElemNote = writePrototypeNote(tricky, { elementId: 'EL-1' }, '说明');
    expect(withElemNote).toBe(
      `<section data-screen-id="SCR-1" data-notes="keep-screen"><div data-element-id="EL-1" data-notes="x" title="a data-note=b" data-note="说明">正文</div></section>`,
    );

    const updatedElemNote = writePrototypeNote(withElemNote, { elementId: 'EL-1' }, '新说明');
    expect(updatedElemNote).toBe(
      `<section data-screen-id="SCR-1" data-notes="keep-screen"><div data-element-id="EL-1" data-notes="x" title="a data-note=b" data-note="新说明">正文</div></section>`,
    );

    const withScreenNote = writePrototypeNote(
      updatedElemNote,
      { screenId: 'SCR-1' },
      '整屏说明：先看今日待办。',
    );
    expect(withScreenNote).toContain('data-notes="keep-screen"');
    expect(readPrototypeNotes(withScreenNote, { screenId: 'SCR-1' })).toEqual([
      {
        screenId: 'SCR-1',
        note: '整屏说明：先看今日待办。',
        title: '整屏说明',
        body: '先看今日待办。',
      },
      {
        elementId: 'EL-1',
        screenId: 'SCR-1',
        note: '新说明',
        body: '新说明',
      },
    ]);

    const removedBoth = writePrototypeNote(
      writePrototypeNote(withScreenNote, { elementId: 'EL-1' }, null),
      { screenId: 'SCR-1' },
      null,
    );
    expect(removedBoth).toBe(tricky);
  });

  it('extracts MU elements when data-note or screen attributes contain > inside quotes', () => {
    const htmlWithGt = `<section data-screen-id="SCR-APPROVAL" data-screen-name="审批" data-screen-type="APPROVAL" data-note="流向：提交 > 审批">
      <button data-note="金额 > 5000 时审批" data-element-id="EL-HIGH-AMOUNT" data-element-type="BUTTON" data-element-label="大额审批">审批</button>
    </section>`;
    const mu = extractMuFromPrototypeHtml(htmlWithGt, '门店订货');
    expect(mu.screens).toHaveLength(1);
    expect(mu.screens[0]!.elements).toHaveLength(1);
    expect(mu.screens[0]!.elements[0]).toMatchObject({
      elementId: 'EL-HIGH-AMOUNT',
      label: '大额审批',
      description: '金额 > 5000 时审批',
    });

    // Sibling attribute text like title="a data-note='fake'" or data-notes="other" must never shadow real data-note,
    // and extracted descriptions round-trip losslessly through MU YAML (#94).
    const baseHtml = `<section data-screen-id="SCR-CONFIRM" data-screen-name="订货确认" data-screen-type="FORM">
      <button data-element-id="EL-SUBMIT" data-element-type="BUTTON" data-element-label="确认提交" data-notes="ignore" title="hint data-note='fake'">确认提交</button>
    </section>`;
    const annotatedHtml = writePrototypeNote(
      baseHtml,
      { elementId: 'EL-SUBMIT', screenId: 'SCR-CONFIRM' },
      '确认提交：核对 "可颂" 数量 & 到店时间无误后发给供应商。',
    );
    const extracted = extractMuFromPrototypeHtml(annotatedHtml, '门店订货');
    expect(extracted.screens[0]!.elements[0]?.description).toBe(
      '确认提交：核对 "可颂" 数量 & 到店时间无误后发给供应商。',
    );
    const roundTripped = parseModelYaml('MU', serializeModelYaml('MU', extracted));
    expect(roundTripped.screens[0]!.elements[0]?.description).toBe(
      '确认提交：核对 "可颂" 数量 & 到店时间无误后发给供应商。',
    );
  });

  it('tracks the active open element at the streaming frontier, picks nearest preceding headings, and checks screenRoot headings', () => {
    const tracker = createPrototypeLiveTracker();

    // Case A: inner button closed while trailing content continues inside open EL-CARD (raw + healed)
    const caseARaw = `<div data-element-id="EL-CARD" data-note="详情卡：展示退款原因与照片。"><button data-element-id="EL-BTN" data-note="跳单：查看原订单。">看</button><p>流式正文`;
    expect(derivePrototypeLiveWriting(caseARaw)).toEqual({
      elementId: 'EL-CARD',
      narration: '正在画「详情卡」：展示退款原因与照片。',
    });
    const evA = tracker.observePartialScreen({ screenId: 'SCR-1', partialHtml: caseARaw });
    if (evA?.kind !== 'screen') throw new Error('expected screen event');
    expect(derivePrototypeLiveWriting(evA.html, { screenId: 'SCR-1' })).toEqual({
      elementId: 'EL-CARD',
      narration: '正在画「详情卡」：展示退款原因与照片。',
    });

    const caseAPlainText = `<div data-element-id="EL-CARD" data-note="详情卡：展示退款原因与照片。"><button data-element-id="EL-BTN" data-note="跳单：查看原订单。">看</button>流式正文`;
    expect(derivePrototypeLiveWriting(caseAPlainText)).toEqual({
      elementId: 'EL-CARD',
      narration: '正在画「详情卡」：展示退款原因与照片。',
    });

    // Case B: EL-1 closed and subsequent unanchored section is streaming -> do NOT freeze on "旧块"
    const caseBWithHeading = `<div data-element-id="EL-1" data-note="旧块">完</div><section><h2>待办</h2><p>流式正文`;
    expect(derivePrototypeLiveWriting(caseBWithHeading)).toEqual({
      narration: '正在画「待办」',
    });
    const evB = tracker.observePartialScreen({ screenId: 'SCR-1', partialHtml: caseBWithHeading });
    if (evB?.kind !== 'screen') throw new Error('expected screen event');
    expect(derivePrototypeLiveWriting(evB.html, { screenId: 'SCR-1' })).toEqual({
      narration: '正在画「待办」',
    });

    const caseBNoHeading = `<div data-element-id="EL-1" data-note="旧块">完</div><section><p>流式正文`;
    expect(derivePrototypeLiveWriting(caseBNoHeading)).toEqual({});

    // Nearest preceding heading (EL-2 picks "地址", not "基本")
    const twoHeadings = `<div><h2>基本</h2><input data-element-id="EL-1"/><h2>地址</h2><input data-element-id="EL-2"/></div>`;
    expect(derivePrototypeLiveWriting(twoHeadings)).toEqual({
      elementId: 'EL-2',
      narration: '正在画「地址」',
    });

    // Heading directly inside screenRoot (<section data-screen-id="...">)
    const screenRootHeading = `<section data-screen-id="SCR-ORDERS"><h1>订货总览</h1><div class="toolbar"><input data-element-id="EL-Q"/></div></section>`;
    expect(derivePrototypeLiveWriting(screenRootHeading, { screenId: 'SCR-ORDERS' })).toEqual({
      elementId: 'EL-Q',
      narration: '正在画「订货总览」',
    });
  });
});
