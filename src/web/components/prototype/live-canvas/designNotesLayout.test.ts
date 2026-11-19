// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  OUTSIDE_GUTTER_GAP,
  OUTSIDE_MAX_NOTE_W,
  computeDesignNotesFrameBounds,
  measureScreenDesignNotes,
  placeCanvasArtboardsDesignNotes,
  placeDesignNotes,
  segmentIntersectsRect,
  type DesignNoteTarget,
} from './designNotesLayout.js';
import type { Rect } from './camera.js';

describe('designNotesLayout: deterministic blank-space placement and DOM measurement (#94)', () => {
  it('places notes in nearby blank space while avoiding text runs, filled/bordered blocks, controls, and other placed notes', () => {
    const targets: DesignNoteTarget[] = [
      {
        id: 'EL-BTN-ORDER',
        note: '新建订单：店长发现缺货时，从这里开始订货。',
        rect: { x: 1120, y: 84, w: 120, h: 36 },
      },
      {
        id: 'EL-SEARCH',
        note: '商品搜索：输入名称就能找到要订的商品。',
        rect: { x: 40, y: 200, w: 260, h: 36 },
      },
    ];
    // Obstacles: greeting text on top-left and a filled card right beside EL-SEARCH (forcing EL-SEARCH note further right or below)
    const occupied: Rect[] = [
      { x: 28, y: 76, w: 340, h: 56 }, // greeting text run
      { x: 1120, y: 84, w: 120, h: 36 }, // button control
      { x: 40, y: 200, w: 260, h: 36 }, // search input
      { x: 320, y: 185, w: 280, h: 66 }, // bordered filter block immediately to the right of EL-SEARCH
    ];

    const placed = placeDesignNotes(targets, occupied, { width: 1280, height: 860, allowOutside: true });
    expect(placed).toHaveLength(2);

    for (const p of placed) {
      expect(p.outside).toBe(false);
      expect(p.skipOutline).toBe(false);
      // Inside artboard bounds
      expect(p.box.x).toBeGreaterThanOrEqual(14);
      expect(p.box.y).toBeGreaterThanOrEqual(14);
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(1280 - 14);
      expect(p.box.y + p.box.h).toBeLessThanOrEqual(860 - 14);
      // Never overlaps any occupied obstacle
      for (const obs of occupied) {
        const overlaps =
          p.box.x < obs.x + obs.w &&
          p.box.x + p.box.w > obs.x &&
          p.box.y < obs.y + obs.h &&
          p.box.y + p.box.h > obs.y;
        expect(overlaps).toBe(false);
      }
      // Curved quadratic Bézier path + arrowhead, no numbered prefix
      expect(p.arrowPath).toMatch(/^M [\d.-]+ [\d.-]+ Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+$/);
      expect(p.arrowHead).toMatch(/^M [\d.-]+ [\d.-]+ L [\d.-]+ [\d.-]+ L [\d.-]+ [\d.-]+$/);
      expect(p.text).not.toMatch(/^\d+[.、\s]/);
    }

    // Placed notes never overlap each other
    const [a, b] = placed;
    const notesOverlap =
      a!.box.x < b!.box.x + b!.box.w &&
      a!.box.x + a!.box.w > b!.box.x &&
      a!.box.y < b!.box.y + b!.box.h &&
      a!.box.y + a!.box.h > b!.box.y;
    expect(notesOverlap).toBe(false);
  });

  it('falls back to outer gutters within the 200px inter-artboard corridor on canvas, and inner margins in web mode', () => {
    // Entire 1280x860 page covered by dense cards so no interior blank space exists
    const denseOccupied: Rect[] = [{ x: 12, y: 12, w: 1256, h: 836 }];
    const targets: DesignNoteTarget[] = [
      {
        id: 'EL-LEFT-1',
        note: '左侧说明一：订单筛选条件。',
        rect: { x: 40, y: 140, w: 200, h: 40 },
      },
      {
        id: 'EL-LEFT-2',
        note: '左侧说明二：按门店切换库存视图。',
        rect: { x: 40, y: 155, w: 200, h: 40 },
      },
      {
        id: 'EL-RIGHT-1',
        note: '右侧说明：提交后通知供应商备货。',
        rect: { x: 980, y: 220, w: 220, h: 44 },
      },
    ];

    const canvasPlaced = placeDesignNotes(targets, denseOccupied, {
      width: 1280,
      height: 860,
      allowOutside: true,
    });
    expect(canvasPlaced.every((p) => p.outside)).toBe(true);
    const [left1, left2, right1] = canvasPlaced;
    // Left gutter notes sit to the left of x=0 and stay inside the 200px corridor (-200 < x)
    expect(left1!.box.x + left1!.box.w).toBeLessThanOrEqual(-OUTSIDE_GUTTER_GAP);
    expect(left1!.box.w).toBeLessThanOrEqual(OUTSIDE_MAX_NOTE_W);
    expect(left1!.box.x).toBeGreaterThan(-200);
    // Stacked vertically without overlap
    expect(left2!.box.y).toBeGreaterThanOrEqual(left1!.box.y + left1!.box.h + 12);
    // Right gutter note sits to the right of x=1280 and stays inside 1280..1480
    expect(right1!.box.x).toBeGreaterThanOrEqual(1280 + OUTSIDE_GUTTER_GAP);
    expect(right1!.box.x + right1!.box.w).toBeLessThan(1480);

    // Camera framing bounds expand to include outer-gutter notes so they are never clipped off-viewport
    const frameBounds = computeDesignNotesFrameBounds({ x: 1480, y: 0, w: 1280, h: 860 }, canvasPlaced);
    expect(frameBounds.x).toBeLessThan(1480);
    expect(frameBounds.x + frameBounds.w).toBeGreaterThan(1480 + 1280);

    // Web mode (allowOutside: false) keeps every note inside [0, width] near the left/right edges
    const webPlaced = placeDesignNotes(targets, denseOccupied, {
      width: 1024,
      height: 760,
      allowOutside: false,
    });
    expect(webPlaced.every((p) => p.outside)).toBe(true);
    for (const p of webPlaced) {
      expect(p.box.x).toBeGreaterThanOrEqual(16);
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(1024 - 16);
    }
    expect(webPlaced[1]!.box.y).toBeGreaterThanOrEqual(webPlaced[0]!.box.y + webPlaced[0]!.box.h + 10);
  });

  it('skips dashed outlines on full-row-width blocks (>= 85% width) and allows placing inside transparent full-width wrappers', () => {
    const targets: DesignNoteTarget[] = [
      {
        id: 'EL-FULL-ROW',
        note: '问候语：告诉店长今天最要紧的一件事。',
        rect: { x: 0, y: 56, w: 1280, h: 108 },
        anchorRect: { x: 28, y: 76, w: 300, h: 64 },
        transparentContainer: true,
      },
      {
        id: 'EL-NARROW-BTN',
        note: '新建订单：缺货时立即补货。',
        rect: { x: 1140, y: 88, w: 112, h: 36 },
      },
    ];
    const occupied: Rect[] = [
      { x: 28, y: 76, w: 300, h: 64 },
      { x: 1140, y: 88, w: 112, h: 36 },
    ];

    const placed = placeDesignNotes(targets, occupied, { width: 1280, height: 860, allowOutside: true });
    expect(placed[0]!.skipOutline).toBe(true);
    expect(placed[0]!.outside).toBe(false);
    // Placed inside the wide blank middle of the 1280px greeting row!
    expect(placed[0]!.box.x).toBeGreaterThanOrEqual(328);
    expect(placed[0]!.box.x + placed[0]!.box.w).toBeLessThanOrEqual(1140);
    expect(placed[1]!.skipOutline).toBe(false);
  });

  it('is 100% deterministic across repeated invocations and measures only the active screen in stable document coordinates', () => {
    const parsed = new DOMParser().parseFromString(
      `<!DOCTYPE html><html><body>
        <header class="bar" style="background: rgb(255, 255, 255); border-bottom: 1px solid rgb(220, 220, 220);">顶栏</header>
        <section data-screen-id="SCR-A" class="is-active">
          <div data-element-id="EL-A1" data-note="首屏摘要：展示今日待收货与退款数。">今日待收货 3 单</div>
          <button data-element-id="EL-A2" data-note="发起订货：点击挑商品。">新建订单</button>
          <div data-element-id="EL-EMPTY" data-note="   ">空白说明忽略</div>
        </section>
        <section data-screen-id="SCR-B" style="display: none;">
          <div data-element-id="EL-B1" data-note="隐藏屏说明：不应出现在首屏。">隐藏内容</div>
        </section>
      </body></html>`,
      'text/html',
    );

    const header = parsed.querySelector<HTMLElement>('header.bar')!;
    const a1 = parsed.querySelector<HTMLElement>('[data-element-id="EL-A1"]')!;
    const a2 = parsed.querySelector<HTMLElement>('[data-element-id="EL-A2"]')!;
    const emptyNote = parsed.querySelector<HTMLElement>('[data-element-id="EL-EMPTY"]')!;
    const b1 = parsed.querySelector<HTMLElement>('[data-element-id="EL-B1"]')!;

    let scrollTop = 0;
    Object.defineProperty(parsed.documentElement, 'scrollTop', {
      get: () => scrollTop,
      configurable: true,
    });
    Object.defineProperty(parsed.documentElement, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(parsed.documentElement, 'scrollHeight', { value: 1400, configurable: true });

    const installBox = (el: HTMLElement, docBox: Rect) => {
      el.getBoundingClientRect = () =>
        ({
          x: docBox.x,
          y: docBox.y - scrollTop,
          left: docBox.x,
          top: docBox.y - scrollTop,
          right: docBox.x + docBox.w,
          bottom: docBox.y - scrollTop + docBox.h,
          width: docBox.w,
          height: docBox.h,
        }) as DOMRect;
    };
    installBox(header, { x: 0, y: 0, w: 1000, h: 56 });
    installBox(a1, { x: 32, y: 96, w: 280, h: 72 });
    installBox(a2, { x: 840, y: 104, w: 120, h: 36 });
    installBox(emptyNote, { x: 32, y: 220, w: 180, h: 30 });
    installBox(b1, { x: 32, y: 96, w: 280, h: 72 });

    const m1 = measureScreenDesignNotes(parsed, 'SCR-A', { scrollMode: 'document' });
    expect(m1.targets.map((t) => t.id)).toEqual(['EL-A1', 'EL-A2']);
    const p1 = placeDesignNotes(m1.targets, m1.occupied, {
      width: m1.docWidth,
      height: m1.docHeight,
      allowOutside: false,
    });

    // Simulate user scrolling 240px down in web mode: document-space placement stays bit-for-bit identical!
    scrollTop = 240;
    const m2 = measureScreenDesignNotes(parsed, 'SCR-A', { scrollMode: 'document' });
    expect(m2.scrollTop).toBe(240);
    const p2 = placeDesignNotes(m2.targets, m2.occupied, {
      width: m2.docWidth,
      height: m2.docHeight,
      allowOutside: false,
    });
    expect(p2).toEqual(p1);
  });

  it('clips canvas targets to [0, 1280] × [0, 860], skips below-fold and scrolled-above elements, and clamps outer-gutter Y within artboard height', () => {
    const denseOccupied: Rect[] = [{ x: 10, y: 10, w: 1260, h: 840 }];
    const targets: DesignNoteTarget[] = [
      // Scrolled completely above the 860px viewport -> skipped
      { id: 'EL-ABOVE', note: '已滚出顶部：不应悬浮在标题上方。', rect: { x: 40, y: -170, w: 200, h: 40 } },
      // Below the 860px fold -> skipped
      { id: 'EL-BELOW', note: '折页下方：不应落到下一行画板上。', rect: { x: 40, y: 1020, w: 200, h: 48 } },
      // Partially visible at top (y = -18..30 -> clipped to y = 0..30)
      { id: 'EL-PARTIAL-TOP', note: '半露顶部：按可见区域画框。', rect: { x: 60, y: -18, w: 180, h: 48 } },
      // Partially visible near bottom (y = 832..900 -> clipped to y = 832..860), outer gutter Y clamped <= 860 - h
      { id: 'EL-PARTIAL-BOT', note: '底部控件：外侧说明不超出画板底边。', rect: { x: 60, y: 832, w: 180, h: 68 } },
    ];

    const placed = placeDesignNotes(targets, denseOccupied, {
      width: 1280,
      height: 860,
      allowOutside: true,
    });
    expect(placed.map((p) => p.id)).toEqual(['EL-PARTIAL-TOP', 'EL-PARTIAL-BOT']);

    const [topNote, botNote] = placed;
    expect(topNote!.targetRect).toEqual({ x: 60, y: 0, w: 180, h: 30 });
    expect(topNote!.box.y).toBeGreaterThanOrEqual(0);
    expect(botNote!.targetRect).toEqual({ x: 60, y: 832, w: 180, h: 28 });
    expect(botNote!.box.y).toBeGreaterThanOrEqual(0);
    expect(botNote!.box.y + botNote!.box.h).toBeLessThanOrEqual(860);
  });

  it('coordinates shared 200px outer gutters across adjacent artboard columns so col 0 right gutter and col 1 left gutter never collide', () => {
    const dense: Rect[] = [{ x: 10, y: 10, w: 1260, h: 840 }];
    const byScreen = placeCanvasArtboardsDesignNotes([
      {
        screenId: 'SCR-COL0',
        slotIndex: 0, // world x = 0..1280, right gutter = 1298..1462
        targets: [
          {
            id: 'EL-COL0-RIGHT',
            note: '左屏右侧说明：占用走廊上半段。',
            rect: { x: 1040, y: 160, w: 180, h: 40 },
          },
        ],
        occupied: dense,
      },
      {
        screenId: 'SCR-COL1',
        slotIndex: 1, // world x = 1480..2760, left gutter = 1298..1462 (same 200px corridor!)
        targets: [
          {
            id: 'EL-COL1-LEFT',
            note: '右屏左侧说明：在同一走廊自动错开不重叠。',
            rect: { x: 40, y: 160, w: 180, h: 40 },
          },
        ],
        occupied: dense,
      },
    ]);

    const n0 = byScreen.get('SCR-COL0')![0]!;
    const n1 = byScreen.get('SCR-COL1')![0]!;
    const world0: Rect = { x: 0 + n0.box.x, y: n0.box.y, w: n0.box.w, h: n0.box.h };
    const world1: Rect = { x: 1480 + n1.box.x, y: n1.box.y, w: n1.box.w, h: n1.box.h };

    const overlaps =
      world0.x < world1.x + world1.w &&
      world0.x + world0.w > world1.x &&
      world0.y < world1.y + world1.h &&
      world0.y + world0.h > world1.y;
    expect(overlaps).toBe(false);
  });

  it('detects nearest-opaque-ancestor card fills, boxShadow surfaces, <a href> and ARIA controls, avoids arrow-box crossings, and uses locale punctuation', () => {
    // body is white, screenRoot is #f4f5f7, inner card is white (#fff) + boxShadow surface + <a href> + role="tab"
    const parsed = new DOMParser().parseFromString(
      `<!DOCTYPE html><html><body style="background: rgb(255, 255, 255);">
        <section data-screen-id="SCR-1" class="is-active" style="background: rgb(244, 245, 247);">
          <div id="white-card" style="background: rgb(255, 255, 255);">Card</div>
          <div id="shadow-box" style="box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);">Shadow</div>
          <a id="nav-link" href="#detail">查看详情</a>
          <div id="aria-tab" role="tab">待收货</div>
          <button data-element-id="EL-1" data-note="Order: Submit to supplier.">Submit</button>
        </section>
      </body></html>`,
      'text/html',
    );
    const assign = (sel: string, r: Rect) => {
      const el = parsed.querySelector<HTMLElement>(sel)!;
      el.getBoundingClientRect = () =>
        ({ x: r.x, y: r.y, left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h, width: r.w, height: r.h }) as DOMRect;
    };
    assign('[data-screen-id="SCR-1"]', { x: 0, y: 0, w: 1280, h: 860 });
    assign('#white-card', { x: 40, y: 80, w: 300, h: 160 });
    assign('#shadow-box', { x: 380, y: 80, w: 260, h: 160 });
    assign('#nav-link', { x: 680, y: 90, w: 90, h: 28 });
    assign('#aria-tab', { x: 800, y: 90, w: 80, h: 32 });
    assign('[data-element-id="EL-1"]', { x: 960, y: 90, w: 100, h: 36 });

    const m = measureScreenDesignNotes(parsed, 'SCR-1');
    expect(m.groundColor).toBe('rgb(244, 245, 247)');
    // #white-card and #shadow-box are both treated as occupied obstacles!
    expect(m.occupied).toContainEqual({ x: 40, y: 80, w: 300, h: 160 });
    expect(m.occupied).toContainEqual({ x: 380, y: 80, w: 260, h: 160 });
    // <a href> and role="tab" are both treated as interactive controls in inkOccupied!
    expect(m.inkOccupied).toContainEqual({ x: 680, y: 90, w: 90, h: 28 });
    expect(m.inkOccupied).toContainEqual({ x: 800, y: 90, w: 80, h: 32 });

    // Locale-aware ': ' separator in en-US
    const enPlaced = placeDesignNotes(m.targets, m.occupied, { locale: 'en-US' });
    expect(enPlaced[0]!.text).toBe('Order: Submit to supplier.');

    // Arrow-crossing avoidance: two close targets where a naive placement of target 2 would shoot an arrow across note 1's box
    const crossTargets: DesignNoteTarget[] = [
      { id: 'EL-TOP-BTN', note: '新建订单：从这里发起补货。', rect: { x: 580, y: 70, w: 110, h: 36 } },
      { id: 'EL-CARD-BELOW', note: '待审批退款：店长决定是否退回。', rect: { x: 520, y: 180, w: 190, h: 110 } },
    ];
    const crossOccupied: Rect[] = [
      { x: 28, y: 65, w: 280, h: 60 },
      { x: 580, y: 70, w: 110, h: 36 },
      { x: 28, y: 180, w: 470, h: 110 },
      { x: 520, y: 180, w: 190, h: 110 },
    ];
    const webNotes = placeDesignNotes(crossTargets, crossOccupied, {
      width: 740,
      height: 680,
      allowOutside: false,
      inkOccupied: crossOccupied.slice(0, 2),
    });
    expect(webNotes).toHaveLength(2);
    const parseEndpoints = (arrowPath: string) => {
      const nums = arrowPath.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      return { p1: { x: nums[0]!, y: nums[1]! }, p2: { x: nums[4]!, y: nums[5]! } };
    };
    const e0 = parseEndpoints(webNotes[0]!.arrowPath);
    const e1 = parseEndpoints(webNotes[1]!.arrowPath);
    expect(segmentIntersectsRect(e1.p1, e1.p2, webNotes[0]!.box, 0)).toBe(false);
    expect(segmentIntersectsRect(e0.p1, e0.p2, webNotes[1]!.box, 0)).toBe(false);
  });
});
