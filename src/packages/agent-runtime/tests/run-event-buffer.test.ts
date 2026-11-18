import { describe, expect, it } from 'vitest';
import { createCoalescingRunEventBuffer, prototypeLiveCoalesceKey } from '../index.js';

type Ev = { id: string; event: string; data: Record<string, unknown> };

function screen(id: string, screenId: string, html: string): Ev {
  return { id, event: 'prototype_screen', data: { screenId, html } };
}

function drain(buffer: ReturnType<typeof createCoalescingRunEventBuffer<Ev>>, afterEventId?: string): Ev[] {
  const out: Ev[] = [];
  let cursor = buffer.startAfter(afterEventId);
  for (;;) {
    const next = buffer.read(cursor);
    if (!next) break;
    out.push(next.event);
    cursor = next.nextCursor;
  }
  return out;
}

describe('createCoalescingRunEventBuffer: reconnect catches up with each screen’s current state', () => {
  it('replays only the latest delta of each screen, never every superseded one', () => {
    const buffer = createCoalescingRunEventBuffer<Ev>(prototypeLiveCoalesceKey);
    buffer.push({ id: 'e1', event: 'session_meta', data: {} });
    buffer.push(screen('e2', 'SCR-A', 'a1'));
    buffer.push(screen('e3', 'SCR-B', 'b1'));
    buffer.push(screen('e4', 'SCR-A', 'a2'));
    buffer.push({ id: 'e5', event: 'tool_call', data: {} });
    buffer.push(screen('e6', 'SCR-A', 'a3'));
    buffer.push({ id: 'e7', event: 'prototype_frame', data: { frame: 1 } });
    buffer.push({ id: 'e8', event: 'prototype_frame', data: { frame: 2 } });

    expect(drain(buffer).map((e) => e.id)).toEqual(['e1', 'e3', 'e5', 'e6', 'e8']);
    expect(buffer.retainedPayloadCount()).toBe(5);
  });

  it('resumes after an event id even when that event was later superseded', () => {
    const buffer = createCoalescingRunEventBuffer<Ev>(prototypeLiveCoalesceKey);
    buffer.push(screen('e1', 'SCR-A', 'a1'));
    buffer.push(screen('e2', 'SCR-B', 'b1'));
    buffer.push(screen('e3', 'SCR-A', 'a2'));
    buffer.push(screen('e4', 'SCR-B', 'b2'));
    // the client saw e1 and e2 before it dropped
    expect(drain(buffer, 'e2').map((e) => e.id)).toEqual(['e3', 'e4']);
    expect(drain(buffer, 'e1').map((e) => e.id)).toEqual(['e3', 'e4']);
  });

  it('lets a live reader that already passed an event keep going without losing newer ones', () => {
    const buffer = createCoalescingRunEventBuffer<Ev>(prototypeLiveCoalesceKey);
    buffer.push(screen('e1', 'SCR-A', 'a1'));
    let cursor = buffer.startAfter(undefined);
    const first = buffer.read(cursor)!;
    expect(first.event.id).toBe('e1');
    cursor = first.nextCursor;
    buffer.push(screen('e2', 'SCR-A', 'a2'));
    expect(buffer.read(cursor)?.event.id).toBe('e2');
  });
});
