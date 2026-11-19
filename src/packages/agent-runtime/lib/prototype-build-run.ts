/**
 * The engine side of the Build Plan (#90, ADR 0018): turns what really happens in a prototype
 * run — the lead's `plan_screens` arguments as they stream, each helper lane being queued,
 * taking, finishing or failing its screen, the run ending — into build events, and keeps the
 * state that is persisted with the run. It invents nothing: a phase whose work did not happen
 * is reported as not started or skipped.
 */

import {
  PROTOTYPE_BUILD_LOG_LIMIT,
  countWrittenElements,
  createPrototypeBuildTracker,
  hasPrototypeBuildPlan,
  prototypeBuildScreen,
  readStreamingBuildPlan,
  splitPrototypeDocument,
  type PrototypeBuildEvent,
  type PrototypeBuildPlanItem,
  type PrototypeBuildState,
} from '../../ontology-core/index.js';
import type { AgentSubagentLaneTrace } from '../../workspace-store/index.js';
import { type AgentLocale, pickLocaleText } from './locale.js';
import type { OpenAiFunctionTool } from './tools.js';

export const PLAN_SCREENS_TOOL_NAME = 'plan_screens';

export const PLAN_SCREENS_OPENAI_TOOL: OpenAiFunctionTool = {
  type: 'function',
  function: {
    name: PLAN_SCREENS_TOOL_NAME,
    description:
      'Declare the Build Plan before anything is drawn: one entry per screen with its id, business name and purpose in plain business language. Each entry puts a blank artboard on the canvas as soon as it is written. This tool draws and styles nothing; hand the screens to helpers with spawn_subagents afterwards, in the same order.',
    parameters: {
      type: 'object',
      properties: {
        screens: {
          type: 'array',
          description: 'The screens of the prototype, in the order they should appear (3–6 screens).',
          items: {
            type: 'object',
            properties: {
              screenId: { type: 'string', description: 'Stable screen anchor id, e.g. SCR-ORDER-LIST' },
              screenName: { type: 'string', description: 'Short business name, e.g. 订货单列表' },
              purpose: {
                type: 'string',
                description: 'One sentence: who uses this screen and what for, in business language',
              },
              screenType: {
                type: 'string',
                description: 'LIST | FORM | DETAIL | APPROVAL | REPORT | DASHBOARD',
              },
            },
            required: ['screenId', 'screenName', 'purpose'],
          },
        },
      },
      required: ['screens'],
    },
  },
};

/**
 * `init_prototype_shell` arguments with their screen list replaced by the committed plan's, so
 * the shared shell's sections can never disagree with the plan. Without a plan: unchanged.
 */
export function alignShellArgsWithPlan(
  args: Record<string, unknown>,
  planned: readonly PrototypeBuildPlanItem[] | null,
): Record<string, unknown> {
  if (!planned || planned.length === 0) return args;
  return {
    ...args,
    screens: planned.map((p) => ({
      screenId: p.screenId,
      screenName: p.screenName,
      screenType: p.screenType ?? 'LIST',
      summary: p.purpose,
    })),
  };
}

/** A Build Plan reconstructed from a saved document: its screens, the drawn ones done. */
function planFromDocument(documentHtml: string): PrototypeBuildState | null {
  const { screens } = splitPrototypeDocument(documentHtml);
  if (screens.length === 0) return null;
  const tracker = createPrototypeBuildTracker();
  tracker.start();
  tracker.plan(
    screens.map((s) => ({ screenId: s.screenId, screenName: s.screenName, purpose: '', screenType: s.screenType })),
    false,
  );
  tracker.phase('plan', 'done');
  for (const s of screens) {
    if (s.status === 'ready') {
      tracker.screen(s.screenId, { status: 'done', writtenElements: countWrittenElements(s.html) });
    }
  }
  return tracker.state();
}

export type PrototypeBuildRunOutcome = 'succeeded' | 'failed' | 'cancelled';

export interface PrototypeBuildRun {
  /** True once this run has a Build Plan (declared, dispatched or resumed). */
  active(): boolean;
  /** `plan_screens` arguments parsed so far, while the model is still writing them. */
  observePlanStream(partialArgs: unknown): void;
  /** `plan_screens` finished: validate and record the plan; returns the tool result. */
  commitPlan(args: unknown): { isError: boolean; content: string; summary: string };
  /** The lead started writing `define_style`: the 风格样张 phase is now. */
  observeStyleStream(documentHtml?: string): void;
  /** `define_style` was accepted (done) or rejected (failed). */
  commitStyle(
    result:
      | { ok: true; locked: boolean; userChanged?: readonly string[]; lockUnavailable?: boolean }
      | { ok: false },
    documentHtml?: string,
  ): void;
  /** Orders dispatched tasks by the plan, and plans them when the lead skipped `plan_screens`. */
  prepareDispatch<T extends { screenId?: string; screenName?: string; instruction: string; screenType?: string }>(
    tasks: readonly T[],
  ): T[];
  /** A helper lane changed state. */
  observeLane(lane: AgentSubagentLaneTrace): void;
  /** A screen's HTML is streaming in. */
  observeScreenStream(screenId: string, partialHtml: string): void;
  /** A screen was written and passed the anchor check. */
  observeScreenWritten(screenId: string, html: string): void;
  /**
   * The user asked to continue one screen; returns its plan entry, or null if neither the
   * persisted plan nor the saved document has that screen. A prototype built before plans
   * existed gets its plan from the screens its document already has.
   */
  resumeScreen(screenId: string, documentHtml?: string): PrototypeBuildPlanItem | null;
  /** The run ended: unfinished screens fail with a reason; phases that did not happen are skipped. */
  finish(outcome: PrototypeBuildRunOutcome): void;
  /**
   * The state to persist with the run (undefined when this run had no plan), bound to the
   * revision the run left on screen, with only the newest log lines.
   */
  snapshot(options?: { revisionId?: string | undefined }): PrototypeBuildState | undefined;
  /** The committed plan's screens, which the shared shell must follow (null without a plan). */
  plannedScreens(): PrototypeBuildPlanItem[] | null;
  /** Anchored elements written for a screen so far (0 for a screen the plan does not have). */
  writtenElements(screenId: string): number;
}

const SCREEN_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function createPrototypeBuildRun(options: {
  emit: (event: PrototypeBuildEvent) => void;
  locale: AgentLocale;
  /** The persisted build this run continues (for 「继续这一屏」). */
  base?: PrototypeBuildState | null;
  now?: () => Date;
}): PrototypeBuildRun {
  const tracker = createPrototypeBuildTracker(options.now ? { now: options.now } : {});
  const { emit, locale } = options;
  const send = (event: PrototypeBuildEvent | null) => {
    if (event) emit(event);
  };
  const startedScreens = new Set<string>();
  const startedLanes = new Set<string>();
  let screensPhaseStarted = false;

  const ensureStarted = (base?: PrototypeBuildState | null) => {
    if (!tracker.started()) send(tracker.start(base ?? null));
  };

  const beginScreensPhase = () => {
    if (screensPhaseStarted) return;
    screensPhaseStarted = true;
    // No style sample was drawn before the screens: the phase says so instead of pretending.
    const style = tracker.state().phases.style.status;
    if (style === 'not_started' || style === 'now') {
      send(tracker.phase('style', 'skipped'));
      send(tracker.log({ agent: 0, kind: 'phase_skipped', phase: 'style' }));
    }
    send(tracker.phase('screens', 'now'));
  };

  const planned = (screenId: string) => tracker.state().plan.some((p) => p.screenId === screenId);

  const ensureStyleRun = (documentHtml?: string) => {
    if (!hasPrototypeBuildPlan(tracker.state())) {
      const fromDoc = documentHtml ? planFromDocument(documentHtml) : null;
      if (fromDoc) {
        if (!tracker.started()) {
          send(tracker.start(fromDoc));
          return;
        }
        send(tracker.plan(fromDoc.plan, false));
        send(tracker.phase('plan', 'done'));
        for (const item of fromDoc.plan) {
          const scr = prototypeBuildScreen(fromDoc, item.screenId);
          if (scr.status === 'done') {
            send(tracker.screen(item.screenId, { status: 'done', writtenElements: scr.writtenElements }));
          }
        }
        return;
      }
    }
    ensureStarted();
  };

  return {
    active: () =>
      tracker.started() &&
      (hasPrototypeBuildPlan(tracker.state()) || tracker.state().phases.style.status !== 'not_started'),

    observePlanStream(partialArgs) {
      const items = readStreamingBuildPlan(partialArgs);
      if (items.length === 0) return;
      if (!tracker.started()) {
        send(tracker.start());
        send(tracker.phase('plan', 'now'));
      }
      send(tracker.plan(items, true));
    },

    commitPlan(args) {
      const items = readStreamingBuildPlan(args).filter((i) => i.screenName.trim());
      const invalid = items.filter((i) => !SCREEN_ID_RE.test(i.screenId));
      if (items.length === 0 || invalid.length > 0) {
        const diagnostic = pickLocaleText(
          locale,
          items.length === 0
            ? 'plan_screens 需要至少一屏，每屏都要有 screenId、screenName 和 purpose。'
            : `这些 screenId 不合法：${invalid.map((i) => i.screenId).join(', ')}（只能用字母、数字、- 和 _）。`,
          items.length === 0
            ? 'plan_screens needs at least one screen, each with screenId, screenName and purpose.'
            : `Invalid screenId: ${invalid.map((i) => i.screenId).join(', ')} (letters, digits, - and _ only).`,
        );
        // A rejected plan is not the plan: what streamed onto the canvas is taken back.
        if (tracker.started() && (tracker.state().plan.length > 0 || tracker.state().phases.plan.status === 'now')) {
          send(tracker.plan([], false));
          send(tracker.phase('plan', 'failed'));
          send(tracker.log({ agent: 0, kind: 'plan_rejected' }));
        }
        return { isError: true, content: JSON.stringify({ status: 'ERROR', diagnostic }), summary: diagnostic };
      }
      if (!tracker.started()) send(tracker.start());
      send(tracker.plan(items, false));
      send(tracker.phase('plan', 'done'));
      send(tracker.log({ agent: 0, kind: 'plan_ready', count: items.length }));
      const summary = pickLocaleText(
        locale,
        `施工计划已列好：共 ${items.length} 屏，画布上已放好对应的空白画板。`,
        `Build Plan recorded: ${items.length} screens, each with a blank artboard on the canvas.`,
      );
      return {
        isError: false,
        content: JSON.stringify({
          status: 'OK',
          summary,
          screens: items.map((i) => ({ screenId: i.screenId, screenName: i.screenName })),
          next: 'Dispatch these screens with spawn_subagents, one task per screen, in this order.',
        }),
        summary,
      };
    },

    observeStyleStream(documentHtml) {
      ensureStyleRun(documentHtml);
      if (tracker.state().phases.style.status === 'now') return;
      send(tracker.phase('style', 'now'));
      send(tracker.log({ agent: 0, kind: 'style_started' }));
    },

    commitStyle(result, documentHtml) {
      if (!result.ok) {
        if (!tracker.started() || !hasPrototypeBuildPlan(tracker.state())) return;
        send(tracker.phase('style', 'failed'));
        return;
      }
      ensureStyleRun(documentHtml);
      if (tracker.state().phases.style.status !== 'now') {
        send(tracker.log({ agent: 0, kind: 'style_started' }));
      }
      if (result.lockUnavailable) send(tracker.log({ agent: 0, kind: 'style_lock_unavailable' }));
      if (result.userChanged && result.userChanged.length > 0) {
        send(tracker.log({ agent: 0, kind: 'style_values_changed', valueKeys: [...result.userChanged] }));
      }
      send(tracker.phase('style', 'done'));
      send(tracker.log({ agent: 0, kind: 'style_ready', locked: result.locked }));
    },

    prepareDispatch(tasks) {
      const screenTasks = tasks.filter((t) => t.screenId?.trim());
      if (screenTasks.length === 0) return [...tasks];
      const asItem = (t: (typeof tasks)[number]): PrototypeBuildPlanItem => ({
        screenId: t.screenId!.trim(),
        screenName: t.screenName?.trim() || t.screenId!.trim(),
        purpose: t.instruction.split('\n')[0]!.slice(0, 120),
        ...(t.screenType ? { screenType: t.screenType } : {}),
      });
      if (!tracker.started() || !hasPrototypeBuildPlan(tracker.state())) {
        // The lead dispatched screens without an accepted plan: what it dispatched is the plan.
        ensureStarted();
        send(tracker.plan(screenTasks.map(asItem), false));
        send(tracker.phase('plan', 'done'));
        send(tracker.log({ agent: 0, kind: 'plan_from_dispatch', count: screenTasks.length }));
      } else {
        // Screens dispatched beyond the plan join it, and the log says so.
        const extra = screenTasks.filter((t) => !planned(t.screenId!.trim()));
        if (extra.length > 0) {
          send(tracker.plan([...tracker.state().plan, ...extra.map(asItem)], false));
          for (const t of extra) {
            send(tracker.log({ agent: 0, kind: 'screens_added', screenId: t.screenId!.trim() }));
          }
        }
      }
      const order = new Map(tracker.state().plan.map((p, i) => [p.screenId, i]));
      const rank = (t: (typeof tasks)[number]) => order.get(t.screenId?.trim() ?? '') ?? Number.MAX_SAFE_INTEGER;
      return tasks
        .map((t, i) => ({ t, i }))
        .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
        .map(({ t }) => t);
    },

    observeLane(lane) {
      const screenId = lane.targetAnchor?.screenId?.trim();
      if (!screenId || !tracker.started() || !planned(screenId)) return;
      // The owner is the helper that picked the screen up; a queued screen has none yet.
      const agent = lane.workerIndex;
      if (lane.status === 'QUEUED') {
        send(tracker.screen(screenId, { status: 'queued', writtenElements: 0 }));
        return;
      }
      if (lane.status === 'RUNNING') {
        startedLanes.add(lane.laneId);
        beginScreensPhase();
        send(tracker.screen(screenId, { status: 'writing', agent }));
        if (!startedScreens.has(lane.laneId)) {
          startedScreens.add(lane.laneId);
          send(tracker.log({ agent, kind: 'screen_started', screenId }));
        }
        return;
      }
      if (lane.status === 'DONE') {
        if (prototypeBuildScreen(tracker.state(), screenId).status === 'done') return;
        send(tracker.screen(screenId, { status: 'done', agent }));
        send(
          tracker.log({
            agent,
            kind: 'screen_done',
            screenId,
            count: prototypeBuildScreen(tracker.state(), screenId).writtenElements,
          }),
        );
        return;
      }
      // FAILED (a lane cancelled before any helper picked it up has no owner)
      if (prototypeBuildScreen(tracker.state(), screenId).status === 'failed') return;
      const failure = lane.failureCode ?? 'interrupted';
      const picked = startedLanes.has(lane.laneId);
      send(tracker.screen(screenId, { status: 'failed', failure, ...(picked ? { agent } : {}) }));
      send(tracker.log({ agent: picked ? agent : 0, kind: 'screen_failed', screenId, failure }));
    },

    observeScreenStream(screenId, partialHtml) {
      if (!tracker.started() || !planned(screenId)) return;
      const cur = prototypeBuildScreen(tracker.state(), screenId);
      const written = countWrittenElements(partialHtml);
      if (written !== cur.writtenElements) send(tracker.screen(screenId, { writtenElements: written }));
    },

    observeScreenWritten(screenId, html) {
      if (!tracker.started() || !planned(screenId)) return;
      send(tracker.screen(screenId, { writtenElements: countWrittenElements(html) }));
    },

    resumeScreen(screenId, documentHtml) {
      const base =
        options.base?.plan.some((p) => p.screenId === screenId) ? options.base : planFromDocument(documentHtml ?? '');
      const item = base?.plan.find((p) => p.screenId === screenId);
      if (!base || !item) return null;
      ensureStarted(base);
      send(tracker.screen(screenId, { status: 'queued', writtenElements: 0 }));
      send(tracker.log({ agent: 0, kind: 'screen_resumed', screenId }));
      screensPhaseStarted = true;
      send(tracker.phase('screens', 'now'));
      return { ...item };
    },

    finish(outcome) {
      if (!tracker.started() || !hasPrototypeBuildPlan(tracker.state())) return;
      const state = tracker.state();
      if (state.planStreaming) send(tracker.plan(state.plan, false));
      if (state.phases.plan.status === 'now') send(tracker.phase('plan', outcome === 'succeeded' ? 'done' : 'failed'));
      // A style sample still being written when the run ended was never set.
      if (state.phases.style.status === 'now') send(tracker.phase('style', 'failed'));
      const leftover =
        outcome === 'cancelled' ? 'cancelled' : outcome === 'failed' ? 'interrupted' : 'not_written';
      let done = 0;
      let failed = 0;
      for (const item of tracker.state().plan) {
        const screen = prototypeBuildScreen(tracker.state(), item.screenId);
        if (screen.status === 'done') {
          done += 1;
          continue;
        }
        failed += 1;
        if (screen.status !== 'failed') {
          send(tracker.screen(item.screenId, { status: 'failed', failure: leftover }));
          send(
            tracker.log({
              agent: screen.agent ?? 0,
              kind: 'screen_failed',
              screenId: item.screenId,
              failure: leftover,
            }),
          );
        }
      }
      if (screensPhaseStarted || tracker.state().phases.screens.status !== 'not_started') {
        send(tracker.phase('screens', failed > 0 ? 'failed' : 'done'));
        // The screenshot check (#93) and demo tours (#95) did not run in this build.
        for (const phase of ['review', 'tours'] as const) {
          const status = tracker.state().phases[phase].status;
          if (status === 'not_started' || status === 'now') {
            send(tracker.phase(phase, 'skipped'));
            if (phase === 'review') send(tracker.log({ agent: 0, kind: 'phase_skipped', phase }));
          }
        }
      }
      send(tracker.log({ agent: 0, kind: 'build_finished', count: done, failedCount: failed }));
    },

    snapshot(snapOptions) {
      if (!tracker.started() || !hasPrototypeBuildPlan(tracker.state())) return undefined;
      const state = tracker.state();
      return {
        ...state,
        log: state.log.slice(-PROTOTYPE_BUILD_LOG_LIMIT),
        ...(snapOptions?.revisionId ? { revisionId: snapOptions.revisionId } : {}),
      };
    },

    writtenElements(screenId) {
      if (!tracker.started()) return 0;
      return prototypeBuildScreen(tracker.state(), screenId).writtenElements;
    },

    plannedScreens() {
      const state = tracker.state();
      if (!tracker.started() || state.planStreaming || !hasPrototypeBuildPlan(state)) return null;
      return state.plan.map((p) => ({ ...p }));
    },
  };
}

/** The SSE event name of each build event (each coalesces on reconnect, except log lines). */
export type PrototypeBuildSseEventName =
  | 'prototype_build_start'
  | 'prototype_plan'
  | 'prototype_build_screen'
  | 'prototype_phase'
  | 'prototype_build_log';

export function prototypeBuildSseEventName(event: PrototypeBuildEvent): PrototypeBuildSseEventName {
  switch (event.kind) {
    case 'build_start':
      return 'prototype_build_start';
    case 'build_plan':
      return 'prototype_plan';
    case 'build_screen':
      return 'prototype_build_screen';
    case 'build_phase':
      return 'prototype_phase';
    case 'build_log':
      return 'prototype_build_log';
  }
}

/** `[ACTION:RESUME_PROTOTYPE_SCREEN {"screenId":"…"}]`: continue exactly one planned screen. */
const RESUME_PROTOTYPE_SCREEN_ACTION = 'RESUME_PROTOTYPE_SCREEN';

const RESUME_ACTION_RE = new RegExp(`^\\[ACTION:${RESUME_PROTOTYPE_SCREEN_ACTION}\\s+(\\{[^\\r\\n]*\\})\\]\\s*`);

export function parseResumePrototypeScreenAction(
  prompt: string,
): { screenId: string; cleanPrompt: string } | null {
  const match = RESUME_ACTION_RE.exec(prompt.trim());
  if (!match) return null;
  try {
    const params = JSON.parse(match[1]!) as { screenId?: unknown };
    const screenId = typeof params.screenId === 'string' ? params.screenId.trim() : '';
    if (!screenId) return null;
    return { screenId, cleanPrompt: prompt.trim().slice(match[0].length).trim() };
  } catch {
    return null;
  }
}
