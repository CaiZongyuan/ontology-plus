import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { PrototypeDemoTour, PrototypeDemoTourStep } from '../../../../packages/ontology-core/index.js';
import type { ArtboardRect } from './Artboard.js';

export interface DemoTourTiming {
  screenSwitchMs: number;
  cursorMoveMs: number;
  clickDelayMs: number;
  typeCharMs: number;
  lookDwellMs: number;
  actionDwellMs: number;
}

export const DEFAULT_DEMO_TOUR_TIMING: DemoTourTiming = {
  screenSwitchMs: 360,
  cursorMoveMs: 260,
  clickDelayMs: 160,
  typeCharMs: 42,
  lookDwellMs: 1500,
  actionDwellMs: 1100,
};

export interface DemoTourPlaybackState {
  tour: PrototypeDemoTour | null;
  stepIndex: number;
  paused: boolean;
  completed: boolean;
  screenId: string | null;
  /** Cursor position in the active screen's frame viewport coordinates. */
  cursor: { screenId: string; x: number; y: number; clickCount: number } | null;
  /** Spotlight cutout in the active screen's frame viewport coordinates. */
  spotlight: { screenId: string; rect: ArtboardRect } | null;
}

export interface DemoTourStageAdapter {
  mode: 'artboards' | 'web';
  currentScreenId: () => string | undefined;
  showScreen: (screenId: string) => void;
  documentFor: (screenId: string) => Document | null;
  screenViewportSize: (screenId: string) => { w: number; h: number };
  onDomMutated?: () => void;
}

const INITIAL_STATE: DemoTourPlaybackState = {
  tour: null,
  stepIndex: 0,
  paused: false,
  completed: false,
  screenId: null,
  cursor: null,
  spotlight: null,
};

function cssEscapeAttr(raw: string): string {
  return raw.replace(/["\\]/g, '\\$&');
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function findTourElement(doc: Document | null, screenId: string, elementId: string): HTMLElement | null {
  if (!doc || !elementId) return null;
  if (screenId) {
    const scoped = doc.querySelector<HTMLElement>(
      `[data-screen-id="${cssEscapeAttr(screenId)}"] [data-element-id="${cssEscapeAttr(elementId)}"]`,
    );
    if (scoped) return scoped;
  }
  return doc.querySelector<HTMLElement>(`[data-element-id="${cssEscapeAttr(elementId)}"]`);
}

function revealTourElement(
  doc: Document | null,
  screenId: string,
  elementId: string,
  safeBottomInsetPx: number,
): { el: HTMLElement; rect: ArtboardRect } | null {
  const el = findTourElement(doc, screenId, elementId);
  if (!el) return null;
  const win = el.ownerDocument.defaultView;
  const r1 = el.getBoundingClientRect();
  const maxVisibleBottom = win ? Math.max(120, (win.innerHeight || 760) - safeBottomInsetPx) : 640;
  const maxVisibleRight = win ? win.innerWidth || 1280 : 1280;
  const isOffScreen =
    r1.top < 12 || r1.bottom > maxVisibleBottom || r1.left < 0 || r1.right > maxVisibleRight;
  if (isOffScreen && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
  const r2 = el.getBoundingClientRect();
  return {
    el,
    rect: { x: r2.left, y: r2.top, w: r2.width, h: r2.height },
  };
}

function setFormControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const win = control.ownerDocument.defaultView;
  const proto =
    control.tagName === 'TEXTAREA'
      ? win?.HTMLTextAreaElement?.prototype
      : win?.HTMLInputElement?.prototype;
  const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : undefined;
  if (descriptor?.set) {
    descriptor.set.call(control, value);
  } else {
    control.value = value;
  }
  if (win) {
    control.dispatchEvent(new win.Event('input', { bubbles: true }));
  }
}

function clickRealElement(target: HTMLElement): void {
  target.focus?.({ preventScroll: true });
  if (typeof target.click === 'function') {
    target.click();
    return;
  }
  const win = target.ownerDocument.defaultView;
  if (win) {
    target.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  }
}

function padSpotlightRect(rect: ArtboardRect, pad = 6): ArtboardRect {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    w: Math.max(16, rect.w + pad * 2),
    h: Math.max(16, rect.h + pad * 2),
  };
}

export interface DemoTourController {
  state: DemoTourPlaybackState;
  play: (tour: PrototypeDemoTour) => void;
  goToStep: (index: number) => void;
  togglePause: () => void;
  stop: () => void;
}

export function useDemoTourController(
  adapterRef: MutableRefObject<DemoTourStageAdapter>,
  timingOverride?: Partial<DemoTourTiming>,
): DemoTourController {
  const [state, setState] = useState<DemoTourPlaybackState>(INITIAL_STATE);
  const tokenRef = useRef(0);
  const pausedRef = useRef(false);
  const cursorPosRef = useRef<{ screenId: string; x: number; y: number; clickCount: number } | null>(null);
  const timingRef = useRef<DemoTourTiming>({ ...DEFAULT_DEMO_TOUR_TIMING, ...timingOverride });
  timingRef.current = { ...DEFAULT_DEMO_TOUR_TIMING, ...timingOverride };

  const waitPausable = async (ms: number, runToken: number): Promise<void> => {
    if (ms <= 0 && !pausedRef.current) {
      if (runToken !== tokenRef.current) throw new Error('cancelled');
      return;
    }
    let remaining = Math.max(0, ms);
    const slice = Math.min(20, Math.max(4, remaining || 10));
    while (remaining > 0 || pausedRef.current) {
      if (runToken !== tokenRef.current) throw new Error('cancelled');
      await new Promise((r) => setTimeout(r, slice));
      if (runToken !== tokenRef.current) throw new Error('cancelled');
      if (!pausedRef.current) {
        remaining -= slice;
      }
    }
  };

  const glideCursor = async (
    screenId: string,
    aim: { x: number; y: number },
    durationMs: number,
    runToken: number,
  ): Promise<void> => {
    const prev = cursorPosRef.current;
    const reduce = prefersReducedMotion();
    if (reduce || durationMs <= 0 || !prev || prev.screenId !== screenId) {
      const next = { screenId, x: aim.x, y: aim.y, clickCount: prev?.clickCount ?? 0 };
      cursorPosRef.current = next;
      setState((s) => ({ ...s, cursor: next }));
      return;
    }
    const from = { x: prev.x, y: prev.y };
    const startedAt = performance.now();
    while (true) {
      if (runToken !== tokenRef.current) throw new Error('cancelled');
      if (pausedRef.current) {
        await waitPausable(20, runToken);
        continue;
      }
      const p = Math.min(1, (performance.now() - startedAt) / durationMs);
      const ease = 1 - Math.pow(1 - p, 3);
      const cur = {
        screenId,
        x: from.x + (aim.x - from.x) * ease,
        y: from.y + (aim.y - from.y) * ease,
        clickCount: cursorPosRef.current?.clickCount ?? 0,
      };
      cursorPosRef.current = cur;
      setState((s) => ({ ...s, cursor: cur }));
      if (p >= 1) return;
      await new Promise((r) =>
        typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r(undefined)) : setTimeout(r, 16),
      );
    }
  };

  const executeStep = async (
    step: PrototypeDemoTourStep,
    stepIndex: number,
    tour: PrototypeDemoTour,
    previousScreenId: string | null,
    runToken: number,
  ): Promise<string> => {
    const adapter = adapterRef.current;
    const timing = timingRef.current;
    const currentScreen = adapter.currentScreenId();
    const needsSwitch =
      adapter.mode === 'web'
        ? currentScreen !== step.screenId
        : previousScreenId !== step.screenId;

    setState((s) => ({
      ...s,
      tour,
      stepIndex,
      completed: false,
      screenId: step.screenId,
      spotlight: null,
    }));

    if (needsSwitch) {
      adapter.showScreen(step.screenId);
      await waitPausable(prefersReducedMotion() ? Math.min(40, timing.screenSwitchMs) : timing.screenSwitchMs, runToken);
    } else if (adapter.mode === 'artboards' && stepIndex === 0) {
      adapter.showScreen(step.screenId);
    }

    const doc = adapter.documentFor(step.screenId);
    const safeBottomInset = adapter.mode === 'web' ? 112 : 24;

    if (!step.elementId) {
      const vp = adapter.screenViewportSize(step.screenId);
      setState((s) => ({
        ...s,
        spotlight: {
          screenId: step.screenId,
          rect: { x: 8, y: 8, w: Math.max(120, vp.w - 16), h: Math.max(120, vp.h - 16) },
        },
      }));
      await waitPausable(timing.lookDwellMs, runToken);
      return step.screenId;
    }

    const revealed = revealTourElement(doc, step.screenId, step.elementId, safeBottomInset);
    if (!revealed) {
      await waitPausable(Math.min(200, timing.lookDwellMs), runToken);
      return step.screenId;
    }

    const { el, rect } = revealed;
    const aim = {
      x: rect.x + Math.min(Math.max(rect.w * 0.35, 14), 72),
      y: rect.y + rect.h * 0.5,
    };
    await glideCursor(step.screenId, aim, timing.cursorMoveMs, runToken);
    setState((s) => ({
      ...s,
      spotlight: { screenId: step.screenId, rect: padSpotlightRect(rect) },
    }));

    if (step.action === 'click') {
      const repeats = Math.max(1, Math.min(10, step.times ?? 1));
      const clickTarget =
        repeats > 1 && el.tagName !== 'BUTTON' && el.tagName !== 'A'
          ? (el.querySelector<HTMLElement>('[data-inc], button') ?? el)
          : el;
      for (let r = 0; r < repeats; r += 1) {
        const nextClick = (cursorPosRef.current?.clickCount ?? 0) + 1;
        if (cursorPosRef.current) {
          cursorPosRef.current = { ...cursorPosRef.current, clickCount: nextClick };
        }
        setState((s) => ({
          ...s,
          cursor: s.cursor ? { ...s.cursor, clickCount: nextClick } : null,
        }));
        await waitPausable(timing.clickDelayMs, runToken);
        clickRealElement(clickTarget);
        adapter.onDomMutated?.();
      }
    } else if (step.action === 'type') {
      const control =
        el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
          ? (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)
          : el.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
              'input, textarea, select',
            );
      const text = step.text ?? '';
      if (control) {
        const win = control.ownerDocument.defaultView;
        control.focus?.({ preventScroll: true });
        if (control.tagName === 'SELECT') {
          const selectEl = control as HTMLSelectElement;
          const match = Array.from(selectEl.options).find(
            (opt) => opt.value === text || opt.textContent?.trim() === text.trim(),
          );
          if (match) selectEl.value = match.value;
          if (win) {
            selectEl.dispatchEvent(new win.Event('input', { bubbles: true }));
            selectEl.dispatchEvent(new win.Event('change', { bubbles: true }));
          }
          adapter.onDomMutated?.();
        } else {
          const textControl = control as HTMLInputElement | HTMLTextAreaElement;
          const chars = Array.from(text);
          if (prefersReducedMotion() || timing.typeCharMs <= 0 || chars.length === 0) {
            setFormControlValue(textControl, text);
          } else {
            const perChar = Math.max(4, Math.min(timing.typeCharMs, Math.floor(320 / chars.length)));
            for (let c = 1; c <= chars.length; c += 1) {
              await waitPausable(perChar, runToken);
              setFormControlValue(textControl, chars.slice(0, c).join(''));
            }
          }
          if (win) {
            textControl.dispatchEvent(new win.Event('change', { bubbles: true }));
          }
          adapter.onDomMutated?.();
        }
      }
    }

    await waitPausable(step.action === 'look' ? timing.lookDwellMs : timing.actionDwellMs, runToken);
    return adapterRef.current.currentScreenId() ?? step.screenId;
  };

  const startFrom = useCallback((tour: PrototypeDemoTour, fromIndex: number, keepPaused = false) => {
    if (tour.steps.length === 0) return;
    const clamped = Math.max(0, Math.min(tour.steps.length - 1, fromIndex));
    const runToken = ++tokenRef.current;
    pausedRef.current = keepPaused;
    if (clamped === 0) {
      cursorPosRef.current = null;
    }
    const firstStep = tour.steps[clamped]!;
    setState({
      tour,
      stepIndex: clamped,
      paused: keepPaused,
      completed: false,
      screenId: firstStep.screenId,
      cursor: cursorPosRef.current,
      spotlight: null,
    });

    void (async () => {
      let prevScreen: string | null = null;
      for (let i = clamped; i < tour.steps.length; i += 1) {
        const step = tour.steps[i]!;
        prevScreen = await executeStep(step, i, tour, prevScreen, runToken);
      }
      if (runToken === tokenRef.current) {
        pausedRef.current = true;
        setState((s) => ({
          ...s,
          stepIndex: tour.steps.length - 1,
          paused: true,
          completed: true,
        }));
      }
    })().catch(() => {
      // Cancelled cleanly by stop / jump / unmount
    });
  }, []);

  const stop = useCallback(() => {
    tokenRef.current += 1;
    pausedRef.current = false;
    cursorPosRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  useEffect(() => {
    return () => {
      tokenRef.current += 1;
    };
  }, []);

  return {
    state,
    play: useCallback((tour: PrototypeDemoTour) => startFrom(tour, 0, false), [startFrom]),
    goToStep: useCallback(
      (index: number) => {
        if (!state.tour) return;
        startFrom(state.tour, index, false);
      },
      [startFrom, state.tour],
    ),
    togglePause: useCallback(() => {
      if (!state.tour) return;
      if (state.completed) {
        startFrom(state.tour, 0, false);
        return;
      }
      const next = !pausedRef.current;
      pausedRef.current = next;
      setState((s) => ({ ...s, paused: next }));
    }, [startFrom, state.completed, state.tour]),
    stop,
  };
}
