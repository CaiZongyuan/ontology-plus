import { describe, expect, it } from 'vitest';
import { checkBusinessViewMarkup } from '../../business-vocabulary/index.js';
import {
  applyPrototypeLiveEvent,
  buildPrototypeCanvasModel,
  emptyPrototypeLiveState,
  splitPrototypeDocument,
  type PrototypeLiveEvent,
} from '../../ontology-core/index.js';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import { collectUnifiedAgentTurn } from '../index.js';

const SCREENS = ['SCR-HOME', 'SCR-ORDERS', 'SCR-NEW-ORDER', 'SCR-ORDER-DETAIL', 'SCR-REFUND'];

describe('Mock mode replays a recorded multi-screen prototype build through the real engine (#89)', () => {
  it('streams every screen from tool-call arguments, several lanes at once, as per-screen deltas', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      title: '首版原型生成',
    });

    const turn = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '按已确认的需求生成首版原型',
      prototypeName: '门店订货原型',
      mockMode: true,
    });
    expect(turn.events.some((e) => e.event === 'run_error')).toBe(false);

    // The lead lays out the shell and hands the screens to parallel subagents.
    const toolCalls = turn.events.filter((e) => e.event === 'tool_call');
    const names = toolCalls.map((e) => String(e.data.toolName));
    expect(names).toContain('init_prototype_shell');
    expect(names).toContain('spawn_subagents');
    const upserts = turn.events.filter(
      (e) => e.event === 'tool_result' && (e.data.trace as { toolName: string }).toolName === 'upsert_prototype_screen',
    );
    expect(upserts).toHaveLength(SCREENS.length);
    expect(upserts.every((e) => !(e.data.trace as { isError: boolean }).isError)).toBe(true);

    // Several lanes were running at the same time (real lane bookkeeping, not a browser trick).
    const peakRunning = Math.max(
      ...turn.events
        .filter((e) => e.event === 'subagent_update')
        .map((e) => (e.data.lanes as { status: string }[]).filter((l) => l.status === 'RUNNING').length),
    );
    expect(peakRunning).toBeGreaterThanOrEqual(2);

    // Every screen streamed in from its tool-call arguments before it landed.
    const live = turn.events.filter((e) => e.event === 'prototype_screen' || e.event === 'prototype_frame');
    for (const sid of SCREENS) {
      const statuses = live
        .filter((e) => e.event === 'prototype_screen' && e.data.screenId === sid)
        .map((e) => e.data.status);
      expect(statuses, sid).toContain('streaming');
      expect(statuses.at(-1), sid).toBe('ready');
    }
    // More than one screen was in flight before the first one landed.
    const firstReady = live.findIndex((e) => e.event === 'prototype_screen' && e.data.status === 'ready' && SCREENS.includes(String(e.data.screenId)));
    const inFlightBeforeFirstReady = new Set(
      live
        .slice(0, firstReady)
        .filter((e) => e.event === 'prototype_screen' && e.data.status === 'streaming')
        .map((e) => e.data.screenId),
    );
    expect(inFlightBeforeFirstReady.size).toBeGreaterThanOrEqual(2);

    // Each delta carries one screen only.
    for (const e of live.filter((ev) => ev.event === 'prototype_screen')) {
      const html = String(e.data.html);
      expect(html.match(/data-screen-id=/g)).toHaveLength(1);
      expect(html).not.toMatch(/<html|<head/i);
    }

    // Folding the deltas gives exactly what was saved.
    const state = live
      .map((e) => e.data as unknown as PrototypeLiveEvent)
      .reduce(applyPrototypeLiveEvent, emptyPrototypeLiveState());
    const created = store.listPrototypes('proj-contract').find((p) => p.name === '门店订货原型')!;
    expect(created.revisions).toHaveLength(1);
    const saved = splitPrototypeDocument(created.htmlContent);
    expect(saved.screens.map((s) => [s.screenId, s.status])).toEqual(SCREENS.map((s) => [s, 'ready']));
    const fromEvents = buildPrototypeCanvasModel('', state);
    const fromSaved = buildPrototypeCanvasModel(created.htmlContent);
    expect(fromEvents.screens.map((s) => s.bodyHtml)).toEqual(fromSaved.screens.map((s) => s.bodyHtml));

    // The lead's closing words are business language.
    const lastAssistant = turn.session.messages.filter((m) => m.role === 'assistant').at(-1)!;
    expect(lastAssistant.content).toContain('工作台首页');
    expect(checkBusinessViewMarkup(lastAssistant.content, { plainText: true })).toHaveLength(0);
  });
});
