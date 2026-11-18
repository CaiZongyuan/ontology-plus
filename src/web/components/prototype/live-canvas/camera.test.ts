import { describe, expect, it } from 'vitest';
import {
  ARTBOARD_H,
  ARTBOARD_W,
  artboardRect,
  artboardsBounds,
  decideFollow,
  fitRect,
  zoomAt,
} from './camera.js';

describe('canvas camera', () => {
  it('lays artboards out in rows of three, left to right', () => {
    const a = artboardRect(0);
    const b = artboardRect(1);
    const d = artboardRect(3);
    expect(a).toMatchObject({ x: 0, y: 0, w: ARTBOARD_W, h: ARTBOARD_H });
    expect(b.x).toBeGreaterThan(a.x + ARTBOARD_W);
    expect(d.x).toBe(0);
    expect(d.y).toBeGreaterThan(a.y + ARTBOARD_H);
    const all = artboardsBounds(5);
    expect(all.x).toBeLessThanOrEqual(0);
    expect(all.x + all.w).toBeGreaterThanOrEqual(artboardRect(2).x + ARTBOARD_W);
    expect(all.y + all.h).toBeGreaterThanOrEqual(d.y + ARTBOARD_H);
  });

  it('fits a rectangle centred in the viewport within the zoom limits', () => {
    const cam = fitRect({ x: 0, y: 0, w: 1000, h: 500 }, { w: 1000, h: 1000 }, { padding: 0, maxK: 2 });
    expect(cam.k).toBe(1);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(250);
    const capped = fitRect({ x: 0, y: 0, w: 10, h: 10 }, { w: 1000, h: 1000 }, { padding: 0, maxK: 1.2 });
    expect(capped.k).toBe(1.2);
  });

  it('zooms around a point so that point stays put', () => {
    const cam = { x: 100, y: 50, k: 0.5 };
    const next = zoomAt(cam, 2, { x: 300, y: 250 });
    expect(next.k).toBe(1);
    // world point under the cursor before and after
    expect((300 - cam.x) / cam.k).toBeCloseTo((300 - next.x) / next.k);
    expect((250 - cam.y) / cam.k).toBeCloseTo((250 - next.y) / next.k);
  });
});

describe('decideFollow: the follow camera dwells instead of jittering', () => {
  it('aims at the first focus at once', () => {
    expect(decideFollow({ since: 0 }, 'SCR-A', 1000, 1500)).toEqual({ target: 'SCR-A', since: 1000, changed: true });
  });

  it('stays on the current screen until the dwell has passed, then moves', () => {
    const state = { target: 'SCR-A', since: 1000 };
    const early = decideFollow(state, 'SCR-B', 1600, 1500);
    expect(early).toEqual({ target: 'SCR-A', since: 1000, changed: false, retryInMs: 900 });
    const late = decideFollow(state, 'SCR-B', 2600, 1500);
    expect(late).toEqual({ target: 'SCR-B', since: 2600, changed: true });
  });

  it('does nothing without a focus or when the focus is the current target', () => {
    expect(decideFollow({ since: 0 }, undefined, 10, 1500).changed).toBe(false);
    expect(decideFollow({ target: 'SCR-A', since: 0 }, 'SCR-A', 10, 1500).changed).toBe(false);
  });
});
