/**
 * The Build Plan of a live prototype build and each screen's build state (spec #87, #90, ADR 0019).
 *
 * The engine records what really happens — the lead's plan, each helper taking, writing,
 * finishing or failing a screen, each phase starting and ending — as events. The browser folds
 * the same events with the same reducer, and the final state is persisted with the run, so the
 * plan, the screen states and the build log stay the same after the run ends and on reload.
 * Nothing here invents progress: a phase whose work did not happen is `not_started` or `skipped`.
 */

import type { PrototypeStyleValueKey } from './prototype-style.js';

export type PrototypeBuildScreenStatus = 'queued' | 'writing' | 'reviewing' | 'fixing' | 'done' | 'failed';

export const PROTOTYPE_BUILD_PHASES = ['plan', 'style', 'screens', 'review', 'tours'] as const;
export type PrototypeBuildPhaseId = (typeof PROTOTYPE_BUILD_PHASES)[number];
export type PrototypeBuildPhaseStatus = 'not_started' | 'now' | 'done' | 'skipped' | 'failed';

/** Why a screen was not finished; the business sentence for each lives in business-vocabulary. */
export type PrototypeBuildFailureCode =
  | 'not_written'
  | 'validation_failed'
  | 'timeout'
  | 'model_error'
  | 'cancelled'
  | 'interrupted';

/** Who did it: 0 is the lead assistant, 1..n are the helpers that build screens in parallel. */
export type PrototypeBuildAgent = number;

export interface PrototypeBuildPlanItem {
  screenId: string;
  screenName: string;
  /** What the screen is for, in business language. */
  purpose: string;
  screenType?: string;
}

export interface PrototypeBuildFixActivity {
  screenId: string;
  elementId?: string;
  /** Raw visual issue reported by `report_review` (formatted & sanitized in the active locale at render time). */
  issue?: string;
  /** Raw localized fix note from `edit_screen.note` (formatted & sanitized in the active locale at render time). */
  fixNote?: string;
  state: 'reviewing' | 'fixing';
}

export interface PrototypeBuildScreen {
  screenId: string;
  status: PrototypeBuildScreenStatus;
  /** The helper that owns this screen (known once the screens are handed out). */
  agent?: PrototypeBuildAgent;
  failure?: PrototypeBuildFailureCode;
  /** Anchored elements written so far (counted in the real tool-call stream). */
  writtenElements: number;
  /** Visual check outcome (#93), once screenshot review ran on this screen. */
  reviewed?: 'pass' | 'fixed';
  /** One business-language sentence naming the visual issue found during screenshot review (#93). */
  finding?: string;
  /** Live review/fix activity for the canvas cursor & narration layer (#92 / #93). */
  fixActivity?: Omit<PrototypeBuildFixActivity, 'screenId'>;
}

export type PrototypeBuildLogKind =
  | 'plan_ready'
  | 'style_started'
  | 'style_ready'
  | 'style_values_changed'
  | 'style_lock_unavailable'
  | 'screen_started'
  | 'screen_done'
  | 'screen_failed'
  | 'screen_resumed'
  | 'review_started'
  | 'review_passed'
  | 'review_finding'
  | 'screen_fixing'
  | 'screen_fixed'
  | 'tours_started'
  | 'tours_ready'
  | 'plan_rejected'
  | 'plan_from_dispatch'
  | 'screens_added'
  | 'phase_skipped'
  | 'build_finished';

export interface PrototypeBuildLogEntry {
  id: number;
  /** ISO time the engine recorded it. */
  at: string;
  agent: PrototypeBuildAgent;
  kind: PrototypeBuildLogKind;
  screenId?: string;
  phase?: PrototypeBuildPhaseId;
  failure?: PrototypeBuildFailureCode;
  /** plan_ready: screens planned; screen_done: elements written; build_finished: screens done. */
  count?: number;
  /** build_finished: screens not finished. */
  failedCount?: number;
  /** style_ready: the values are the approved Style Tile's (locked). */
  locked?: boolean;
  /** style_values_changed: the design values the user asked to change. */
  valueKeys?: PrototypeStyleValueKey[];
  /** review_finding / screen_fixing / screen_fixed: concise business-language note (#93). */
  detail?: string;
}

export interface PrototypeBuildState {
  /** Sequence of the `start` event this state descends from. */
  startSeq: number;
  plan: PrototypeBuildPlanItem[];
  planStreaming: boolean;
  planSeq: number;
  screens: Record<string, PrototypeBuildScreen & { seq: number }>;
  phases: Record<PrototypeBuildPhaseId, { status: PrototypeBuildPhaseStatus; seq: number }>;
  log: PrototypeBuildLogEntry[];
  /**
   * The prototype revision this build left on screen (set when the run's state is persisted).
   * A saved plan is shown only while that revision is the current one, so an undo, a restore
   * or a later edit never brings back the states of screens that are no longer there.
   */
  revisionId?: string;
}

export type PrototypeBuildEvent =
  | { kind: 'build_start'; seq: number; base: PrototypeBuildState }
  | { kind: 'build_plan'; seq: number; items: PrototypeBuildPlanItem[]; streaming: boolean }
  | { kind: 'build_screen'; seq: number; screen: PrototypeBuildScreen }
  | { kind: 'build_phase'; seq: number; phase: PrototypeBuildPhaseId; status: PrototypeBuildPhaseStatus }
  | { kind: 'build_log'; seq: number; entry: PrototypeBuildLogEntry };

export const PROTOTYPE_BUILD_EVENT_KINDS: ReadonlySet<string> = new Set([
  'build_start',
  'build_plan',
  'build_screen',
  'build_phase',
  'build_log',
]);

export function isPrototypeBuildEvent(event: { kind: string }): event is PrototypeBuildEvent {
  return PROTOTYPE_BUILD_EVENT_KINDS.has(event.kind);
}

export function emptyPrototypeBuildState(): PrototypeBuildState {
  const phases = {} as PrototypeBuildState['phases'];
  for (const phase of PROTOTYPE_BUILD_PHASES) phases[phase] = { status: 'not_started', seq: 0 };
  return { startSeq: 0, plan: [], planStreaming: false, planSeq: 0, screens: {}, phases, log: [] };
}

/** Folds one build event; stale (lower-sequence) events and replayed log lines are ignored. */
export function applyPrototypeBuildEvent(
  state: PrototypeBuildState,
  event: PrototypeBuildEvent,
): PrototypeBuildState {
  if (event.seq <= state.startSeq && event.kind !== 'build_start') return state;
  switch (event.kind) {
    case 'build_start':
      if (event.seq <= state.startSeq) return state;
      return { ...cloneBuildState(event.base), startSeq: event.seq };
    case 'build_plan':
      if (event.seq <= state.planSeq) return state;
      return { ...state, plan: event.items.map((i) => ({ ...i })), planStreaming: event.streaming, planSeq: event.seq };
    case 'build_screen': {
      const prev = state.screens[event.screen.screenId];
      if (prev && prev.seq >= event.seq) return state;
      return {
        ...state,
        screens: { ...state.screens, [event.screen.screenId]: { ...event.screen, seq: event.seq } },
      };
    }
    case 'build_phase': {
      const prev = state.phases[event.phase];
      if (prev && prev.seq >= event.seq) return state;
      return { ...state, phases: { ...state.phases, [event.phase]: { status: event.status, seq: event.seq } } };
    }
    case 'build_log':
      if (state.log.some((e) => e.id === event.entry.id)) return state;
      return { ...state, log: [...state.log, { ...event.entry }] };
    default:
      return state;
  }
}

function cloneBuildState(state: PrototypeBuildState): PrototypeBuildState {
  return JSON.parse(JSON.stringify(state)) as PrototypeBuildState;
}

/** The highest sequence number a state carries (a tracker restored from it continues above). */
function maxSeq(state: PrototypeBuildState): number {
  let max = Math.max(state.startSeq, state.planSeq);
  for (const s of Object.values(state.screens)) max = Math.max(max, s.seq);
  for (const p of Object.values(state.phases)) max = Math.max(max, p.seq);
  return max;
}

/** True once the build has a plan: only then do the phase bar, the log and the strip apply. */
export function hasPrototypeBuildPlan(state: PrototypeBuildState | null | undefined): state is PrototypeBuildState {
  return Boolean(state && state.plan.length > 0);
}

/** A screen's state; a planned screen nobody has touched yet is queued. */
export function prototypeBuildScreen(
  state: PrototypeBuildState,
  screenId: string,
): PrototypeBuildScreen {
  const s = state.screens[screenId];
  if (s) {
    const { seq: _seq, ...screen } = s;
    return screen;
  }
  return { screenId, status: 'queued', writtenElements: 0 };
}

/** Active review/fix activities across planned screens, for live cursor/narration overlays (#92 / #93). */
export function activePrototypeBuildFixActivities(
  state: PrototypeBuildState | null | undefined,
): PrototypeBuildFixActivity[] {
  if (!state) return [];
  const order = state.plan.length > 0 ? state.plan.map((p) => p.screenId) : Object.keys(state.screens);
  const out: PrototypeBuildFixActivity[] = [];
  for (const screenId of order) {
    const s = state.screens[screenId];
    if (!s || (s.status !== 'reviewing' && s.status !== 'fixing') || !s.fixActivity) continue;
    out.push({ screenId, ...s.fixActivity });
  }
  return out;
}

export interface PrototypeBuildTracker {
  /** Begins (or continues, from a persisted state) a build; everything below needs it first. */
  start(base?: PrototypeBuildState | null): PrototypeBuildEvent;
  started(): boolean;
  /** The plan as parsed so far; null when nothing changed. */
  plan(items: readonly PrototypeBuildPlanItem[], streaming: boolean): PrototypeBuildEvent | null;
  /** Updates one screen; null when nothing changed. */
  screen(screenId: string, patch: Partial<Omit<PrototypeBuildScreen, 'screenId'>>): PrototypeBuildEvent | null;
  phase(phase: PrototypeBuildPhaseId, status: PrototypeBuildPhaseStatus): PrototypeBuildEvent | null;
  log(entry: Omit<PrototypeBuildLogEntry, 'id' | 'at'>): PrototypeBuildEvent;
  state(): PrototypeBuildState;
}

/**
 * The engine side: produces build events and keeps its own state by folding them with the same
 * reducer the browser uses, so what is persisted is exactly what the browser showed.
 */
export function createPrototypeBuildTracker(options: { now?: () => Date } = {}): PrototypeBuildTracker {
  const now = options.now ?? (() => new Date());
  let state = emptyPrototypeBuildState();
  let seq = 0;
  let isStarted = false;
  let logId = 0;

  const fold = (event: PrototypeBuildEvent): PrototypeBuildEvent => {
    state = applyPrototypeBuildEvent(state, event);
    return event;
  };

  return {
    start(base) {
      const from = base ? cloneBuildState(base) : emptyPrototypeBuildState();
      // Which revision a persisted build belonged to is not part of the live build.
      delete from.revisionId;
      seq = Math.max(seq, maxSeq(from)) + 1;
      logId = Math.max(logId, ...from.log.map((e) => e.id), 0);
      isStarted = true;
      return fold({ kind: 'build_start', seq, base: from });
    },
    started: () => isStarted,
    plan(items, streaming) {
      const clean = items
        .map((i) => ({
          screenId: i.screenId.trim(),
          screenName: i.screenName.trim(),
          purpose: i.purpose.trim(),
          ...(i.screenType?.trim() ? { screenType: i.screenType.trim() } : {}),
        }))
        .filter((i) => i.screenId);
      if (state.planStreaming === streaming && JSON.stringify(clean) === JSON.stringify(state.plan)) return null;
      seq += 1;
      return fold({ kind: 'build_plan', seq, items: clean, streaming });
    },
    screen(screenId, patch) {
      const prev = prototypeBuildScreen(state, screenId);
      const next: PrototypeBuildScreen = { ...prev, ...patch, screenId };
      if (next.status !== 'failed') delete next.failure;
      // A screen nobody has picked up yet has no owner.
      if (next.status === 'queued') delete next.agent;
      // Live review/fix activity clears once the screen leaves reviewing/fixing.
      if (next.status !== 'reviewing' && next.status !== 'fixing') delete next.fixActivity;
      if (next.status === 'queued' || next.status === 'writing') {
        delete next.reviewed;
        delete next.finding;
      }
      if (JSON.stringify(next) === JSON.stringify(prev) && state.screens[screenId]) return null;
      seq += 1;
      return fold({ kind: 'build_screen', seq, screen: next });
    },
    phase(phase, status) {
      if (state.phases[phase].status === status && state.phases[phase].seq > 0) return null;
      seq += 1;
      return fold({ kind: 'build_phase', seq, phase, status });
    },
    log(entry) {
      seq += 1;
      logId += 1;
      return fold({ kind: 'build_log', seq, entry: { ...entry, id: logId, at: now().toISOString() } });
    },
    state: () => cloneBuildState(state),
  };
}

/**
 * Reads a plan out of `plan_screens` arguments that may still be streaming: an item is taken
 * once its id is complete (a later field has started, or a later item exists), so a half-typed
 * id never puts a stray artboard on the canvas.
 */
export function readStreamingBuildPlan(args: unknown): PrototypeBuildPlanItem[] {
  const raw = args && typeof args === 'object' ? (args as Record<string, unknown>).screens : undefined;
  if (!Array.isArray(raw)) return [];
  const items: PrototypeBuildPlanItem[] = [];
  raw.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') return;
    const rec = entry as Record<string, unknown>;
    const screenId = typeof rec.screenId === 'string' ? rec.screenId.trim() : '';
    if (!screenId) return;
    const idSettled = idx < raw.length - 1 || 'screenName' in rec || 'purpose' in rec || 'screenType' in rec;
    if (!idSettled) return;
    items.push({
      screenId,
      screenName: typeof rec.screenName === 'string' ? rec.screenName : '',
      purpose: typeof rec.purpose === 'string' ? rec.purpose : '',
      ...(typeof rec.screenType === 'string' && rec.screenType.trim() ? { screenType: rec.screenType } : {}),
    });
  });
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.screenId) ? false : (seen.add(i.screenId), true)));
}

/** Counts the anchored elements a screen's HTML has written so far. */
export function countWrittenElements(html: string): number {
  return (html.match(/\sdata-element-id\s*=/g) ?? []).length;
}

/**
 * The latest Build Plan persisted with a session's runs. With `revisionId`, only a build that
 * left exactly that revision on screen counts: once the prototype has moved on (undo, restore,
 * a later edit) there is no saved plan to show.
 */
export function latestPrototypeBuild(
  messages: readonly { prototypeBuild?: PrototypeBuildState }[] | null | undefined,
  revisionId?: string | null,
): PrototypeBuildState | undefined {
  const list = messages ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const build = list[i]!.prototypeBuild;
    if (!hasPrototypeBuildPlan(build)) continue;
    if (revisionId === undefined) return build;
    return build.revisionId && build.revisionId === revisionId ? build : undefined;
  }
  return undefined;
}

/** How many build log lines are kept with a run (the newest ones). */
export const PROTOTYPE_BUILD_LOG_LIMIT = 200;
