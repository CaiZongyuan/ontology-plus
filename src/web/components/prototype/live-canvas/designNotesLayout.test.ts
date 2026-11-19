// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  OUTSIDE_GUTTER_GAP,
  OUTSIDE_MAX_NOTE_W,
  computeDesignNotesFrameBounds,
  measureScreenDesignNotes,
  placeDesignNotes,
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
});
