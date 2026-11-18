/**
 * The event log of one background Agent Run. Every event is kept in order, except that an
 * event carrying a coalesce key replaces the previous event with the same key: the earlier
 * slot keeps only its id. A client reconnecting with `afterEventId` therefore receives each
 * prototype screen's current state once, not every delta that led to it, and the log holds
 * at most one payload per screen.
 */

export interface RunEventLike {
  id: string;
  event: string;
  data: Record<string, unknown>;
}

export interface CoalescingRunEventBuffer<E extends RunEventLike> {
  push(event: E): void;
  /** Cursor to start reading at: just after `afterEventId`, or the beginning. */
  startAfter(afterEventId: string | undefined): number;
  /** The next live event at or after `cursor`, skipping superseded ones; undefined at the end. */
  read(cursor: number): { event: E; nextCursor: number } | undefined;
  /** Total slots, including superseded ones (a cursor at `size()` has read everything). */
  size(): number;
  retainedPayloadCount(): number;
}

export function createCoalescingRunEventBuffer<E extends RunEventLike>(
  keyOf: (event: E) => string | undefined,
): CoalescingRunEventBuffer<E> {
  const ids: string[] = [];
  const slots: (E | null)[] = [];
  const lastIndexByKey = new Map<string, number>();
  let retained = 0;

  return {
    push(event) {
      const key = keyOf(event);
      if (key !== undefined) {
        const prev = lastIndexByKey.get(key);
        if (prev !== undefined && slots[prev]) {
          slots[prev] = null;
          retained -= 1;
        }
        lastIndexByKey.set(key, slots.length);
      }
      ids.push(event.id);
      slots.push(event);
      retained += 1;
    },
    startAfter(afterEventId) {
      if (!afterEventId) return 0;
      const idx = ids.lastIndexOf(afterEventId);
      return idx >= 0 ? idx + 1 : 0;
    },
    read(cursor) {
      for (let i = cursor; i < slots.length; i += 1) {
        const ev = slots[i];
        if (ev) return { event: ev, nextCursor: i + 1 };
      }
      return undefined;
    },
    size: () => slots.length,
    retainedPayloadCount: () => retained,
  };
}

/**
 * Prototype live deltas coalesce per screen; the frame coalesces with itself. Build Plan events
 * (#90) coalesce the same way — the plan with itself, each screen's build state per screen, each
 * phase per phase — while build log lines are all kept.
 */
export function prototypeLiveCoalesceKey(event: RunEventLike): string | undefined {
  if (event.event === 'prototype_frame') return 'prototype_frame';
  if (event.event === 'prototype_build_start') return 'prototype_build_start';
  if (event.event === 'prototype_plan') return 'prototype_plan';
  if (event.event === 'prototype_phase' && typeof event.data.phase === 'string') {
    return `prototype_phase:${event.data.phase}`;
  }
  if (event.event === 'prototype_build_screen') {
    const screen = event.data.screen as { screenId?: unknown } | undefined;
    if (typeof screen?.screenId === 'string') return `prototype_build_screen:${screen.screenId}`;
  }
  if (event.event === 'prototype_screen' && typeof event.data.screenId === 'string') {
    return `prototype_screen:${event.data.screenId}`;
  }
  return undefined;
}
