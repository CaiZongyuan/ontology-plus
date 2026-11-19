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
  type PrototypeStyleValueKey,
} from '../../ontology-core/index.js';
import type { AgentSubagentLaneTrace } from '../../workspace-store/index.js';
import { type AgentLocale, pickLocaleText } from './locale.js';
import type { OpenAiFunctionTool } from './tools.js';

export const PLAN_SCREENS_TOOL_NAME = 'plan_screens';
export const REPORT_REVIEW_TOOL_NAME = 'report_review';
export const WRITE_DEMO_TOURS_TOOL_NAME = 'write_demo_tours';

/**
 * Authors 2–4 playable Demo Tours (`演示路线`, never called Scenario) grounded in user goals and
 * roles from the confirmed Requirements document, after screens and visual checks finish (#95).
 */
export const WRITE_DEMO_TOURS_OPENAI_TOOL: OpenAiFunctionTool = {
  type: 'function',
  function: {
    name: WRITE_DEMO_TOURS_TOOL_NAME,
    description:
      'Author 2–4 playable Demo Tours (演示路线 — never call them Scenarios) grounded in real user goals and roles from the Confirmed Requirements Document, once screens and visual checks are done. Every step must reference an existing drawn `screenId` and, when targeting a control or section, an existing `data-element-id` inside that screen.',
    parameters: {
      type: 'object',
      properties: {
        tours: {
          type: 'array',
          description: '2–4 Demo Tours, each walking through one concrete user goal across the prototype screens.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable kebab-case tour id, e.g. first-order' },
              goal: {
                type: 'string',
                description: 'User goal in plain business language, e.g. 门店第一次订货',
              },
              audience: {
                type: 'string',
                description: 'Role or person in plain business language, e.g. 店长',
              },
              steps: {
                type: 'array',
                description: 'Ordered Demo Tour steps (typically 3–7 steps per tour).',
                items: {
                  type: 'object',
                  properties: {
                    screenId: {
                      type: 'string',
                      description: 'Existing drawn data-screen-id in the prototype, e.g. SCR-HOME',
                    },
                    elementId: {
                      type: 'string',
                      description: 'Existing data-element-id inside `screenId`, e.g. EL-HOME-NEW-ORDER',
                    },
                    action: {
                      type: 'string',
                      enum: ['look', 'click', 'type'],
                      description: 'look = spotlight & observe; click = click element/navigate; type = fill input/textarea/select',
                    },
                    caption: {
                      type: 'string',
                      description: 'One concise business-language narration sentence shown as subtitle while this step plays.',
                    },
                    text: {
                      type: 'string',
                      description: 'Text to type or option to select when action === "type".',
                    },
                    times: {
                      type: 'number',
                      description: 'Optional click repeat count (1–10), e.g. clicking a + quantity stepper 3 times.',
                    },
                  },
                  required: ['screenId', 'action', 'caption'],
                },
              },
            },
            required: ['id', 'goal', 'steps'],
          },
        },
      },
      required: ['tours'],
    },
  },
};

export interface PrototypeScreenReviewFinding {
  elementId?: string;
  issue: string;
}

/**
 * Reports the visual screenshot check verdict for one screen (#93). Short fields come first:
 * `screenId`, then `findings` (each with `elementId` and one concise business-language `issue`,
 * or empty `findings: []` when the screen passes cleanly).
 */
export const REPORT_REVIEW_OPENAI_TOOL: OpenAiFunctionTool = {
  type: 'function',
  function: {
    name: REPORT_REVIEW_TOOL_NAME,
    description:
      'Report the screenshot visual check verdict for ONE screen (`screenId`). Pass `findings: []` when the screen looks clean; otherwise list real visual issues, each with its `elementId` and one concise business-language sentence (`issue`). At most one review round per screen.',
    parameters: {
      type: 'object',
      properties: {
        screenId: {
          type: 'string',
          description: 'Target screen id that was inspected (e.g. SCR-ORDERS).',
        },
        findings: {
          type: 'array',
          description: 'Visual issues spotted in the screenshot, or [] when clean.',
          items: {
            type: 'object',
            properties: {
              elementId: {
                type: 'string',
                description: 'Anchored data-element-id of the affected element (e.g. EL-ORDERS-TABLE).',
              },
              issue: {
                type: 'string',
                description: 'One concise business-language sentence saying what is wrong visually.',
              },
            },
            required: ['elementId', 'issue'],
          },
        },
      },
      required: ['screenId', 'findings'],
    },
  },
};

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
      | { ok: true; locked: boolean; userChanged?: readonly PrototypeStyleValueKey[]; lockUnavailable?: boolean }
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
  /** The lead directly wrote a planned screen in single-agent mode (`upsert_prototype_screen`). */
  observeLeadScreenWritten(screenId: string, html: string): void;
  /** True when `screenId` has not yet entered its single allowed screenshot review round (#93). */
  canReviewScreen(screenId: string): boolean;
  /** Starts screenshot review on `screenId` (`review` phase -> `now`, screen -> `reviewing`); false if disallowed. */
  beginScreenReview(screenId: string): boolean;
  /** Records `report_review` findings (≤ 1 review round per screen). */
  commitReportReview(args: unknown): {
    isError: boolean;
    findings: PrototypeScreenReviewFinding[];
    content: string;
    summary: string;
  };
  /** Updates live fix narration as `edit_screen`'s short fields (`screenId`, `elementId`, `note`) stream (#93). */
  observeEditScreenStream(partialArgs: unknown): void;
  /** Checks whether `edit_screen` is permitted under the ≤ 1 review+fix round cap; null when allowed. */
  checkEditScreenAllowed(screenId: string): string | null;
  /** Records a completed targeted `edit_screen` fix on `screenId` (#93). */
  commitEditScreen(screenId: string, input: { elementId?: string; note?: string; html: string }): void;
  /** Seals `screenId`'s single review round completed and restores its status to `done` if still in `reviewing`/`fixing`. */
  completeScreenReview(screenId: string): void;
  /** Marks the `截图检查` phase skipped (`未做视觉检查`) when no browser or vision model is available. */
  skipVisualReview(): void;
  /** Marks `逐屏施工` (`screens`) finished once all helper lanes have completed, even while `review` continues. */
  finishScreensPhase(): void;
  /** Marks `截图检查` (`review`) finished once all queued screen reviews have completed. */
  finishReviewPhase(): void;
  /** The lead started writing `write_demo_tours`: the `演示路线` (`tours`) phase is `now` (#95). */
  observeToursStream(documentHtml?: string): void;
  /** `write_demo_tours` was accepted (`done`) or rejected (#95). */
  commitTours(
    result: { ok: true; count: number } | { ok: false },
    documentHtml?: string,
  ): void;
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
  const reviewRecords = new Map<
    string,
    {
      phase: 'in_review' | 'completed';
      reported: boolean;
      findings: PrototypeScreenReviewFinding[];
      editsApplied: number;
      maxEditsAllowed: number;
    }
  >();
  let screensPhaseStarted = false;
  let reviewSkippedLogged = false;
  let toursAttempted = false;
  let toursSucceeded = false;

  const ensureStarted = (base?: PrototypeBuildState | null) => {
    if (!tracker.started()) send(tracker.start(base ?? null));
  };

  const beginScreensPhase = () => {
    if (screensPhaseStarted) return;
    screensPhaseStarted = true;
    // No Style Tile was drawn before the screens: the phase says so instead of pretending.
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

    observeLeadScreenWritten(screenId, html) {
      const sid = screenId.trim();
      if (!sid || !tracker.started() || !planned(sid)) return;
      beginScreensPhase();
      const writtenElements = countWrittenElements(html);
      const wasDone = prototypeBuildScreen(tracker.state(), sid).status === 'done';
      send(tracker.screen(sid, { status: 'done', agent: 0, writtenElements }));
      if (!wasDone) {
        send(tracker.log({ agent: 0, kind: 'screen_done', screenId: sid, count: writtenElements }));
      }
    },

    canReviewScreen(screenId) {
      const sid = screenId.trim();
      if (!sid || !tracker.started() || !planned(sid) || reviewSkippedLogged) return false;
      return !reviewRecords.has(sid);
    },

    beginScreenReview(screenId) {
      const sid = screenId.trim();
      if (!sid || !tracker.started() || !planned(sid) || reviewSkippedLogged) return false;
      if (reviewRecords.has(sid)) return false;
      reviewRecords.set(sid, {
        phase: 'in_review',
        reported: false,
        findings: [],
        editsApplied: 0,
        maxEditsAllowed: 0,
      });
      if (tracker.state().phases.review.status !== 'now') {
        send(tracker.phase('review', 'now'));
      }
      send(
        tracker.screen(sid, {
          status: 'reviewing',
          fixActivity: { state: 'reviewing' },
        }),
      );
      send(tracker.log({ agent: 0, kind: 'review_started', screenId: sid }));
      return true;
    },

    commitReportReview(args) {
      const recObj = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
      const sid = typeof recObj.screenId === 'string' ? recObj.screenId.trim() : '';
      if (!sid) {
        const diagnostic = pickLocaleText(
          locale,
          'report_review 需要指定 screenId。',
          'report_review requires a non-empty screenId.',
        );
        return { isError: true, findings: [], content: JSON.stringify({ status: 'ERROR', diagnostic }), summary: diagnostic };
      }
      const existingRec = reviewRecords.get(sid);
      if (existingRec?.reported || existingRec?.phase === 'completed') {
        const diagnostic = pickLocaleText(
          locale,
          `每屏最多做一轮截图检查，${sid} 已经检查过了。`,
          `At most one review round per screen; ${sid} has already been reviewed.`,
        );
        return {
          isError: true,
          findings: [],
          content: JSON.stringify({ status: 'REVIEW_CAP_REACHED', diagnostic }),
          summary: diagnostic,
        };
      }
      const rawFindings = Array.isArray(recObj.findings) ? recObj.findings : null;
      if (!rawFindings) {
        const diagnostic = pickLocaleText(
          locale,
          'report_review 需要传入 findings 数组（无问题传 []）。',
          'report_review requires a `findings` array (pass [] when clean).',
        );
        return { isError: true, findings: [], content: JSON.stringify({ status: 'ERROR', diagnostic }), summary: diagnostic };
      }
      const findings: PrototypeScreenReviewFinding[] = rawFindings
        .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'))
        .map((f) => {
          const elementId = typeof f.elementId === 'string' && f.elementId.trim() ? f.elementId.trim() : undefined;
          const issue = typeof f.issue === 'string' ? f.issue.trim() : '';
          return { ...(elementId ? { elementId } : {}), issue };
        })
        .filter((f) => f.issue.length > 0);

      ensureStyleRun();
      if (tracker.state().phases.review.status === 'not_started') {
        send(tracker.phase('review', 'now'));
      }
      const screenName = tracker.state().plan.find((p) => p.screenId === sid)?.screenName ?? sid;

      if (findings.length === 0) {
        reviewRecords.set(sid, {
          phase: 'completed',
          reported: true,
          findings: [],
          editsApplied: 0,
          maxEditsAllowed: 0,
        });
        if (planned(sid)) {
          send(tracker.screen(sid, { status: 'done', reviewed: 'pass' }));
          send(tracker.log({ agent: 0, kind: 'review_passed', screenId: sid }));
        }
        const summary = pickLocaleText(
          locale,
          `「${screenName}」视觉检查通过，无需修改。`,
          `"${screenName}" passed the visual check with no issues.`,
        );
        return {
          isError: false,
          findings: [],
          content: JSON.stringify({ status: 'PASS', screenId: sid, summary }),
          summary,
        };
      }

      reviewRecords.set(sid, {
        phase: 'in_review',
        reported: true,
        findings,
        editsApplied: 0,
        maxEditsAllowed: findings.length,
      });
      const first = findings[0]!;
      if (planned(sid)) {
        send(
          tracker.screen(sid, {
            status: 'fixing',
            finding: first.issue,
            fixActivity: {
              ...(first.elementId ? { elementId: first.elementId } : {}),
              issue: first.issue,
              state: 'fixing',
            },
          }),
        );
        for (const f of findings) {
          send(tracker.log({ agent: 0, kind: 'review_finding', screenId: sid, detail: f.issue }));
        }
      }
      const summary = pickLocaleText(
        locale,
        `「${screenName}」发现 ${findings.length} 处视觉问题：${first.issue}`,
        `Found ${findings.length} visual issue(s) on "${screenName}": ${first.issue}`,
      );
      return {
        isError: false,
        findings,
        content: JSON.stringify({
          status: 'NEEDS_FIX',
          screenId: sid,
          findings,
          next:
            findings.length === 1
              ? 'Call edit_screen once on this screen with an exact unique `find` snippet to fix the issue.'
              : `Call edit_screen (up to ${findings.length} targeted edits in this single review round) with exact unique \`find\` snippets to fix the reported issues.`,
        }),
        summary,
      };
    },

    observeEditScreenStream(partialArgs) {
      if (!partialArgs || typeof partialArgs !== 'object' || !tracker.started()) return;
      const rec = partialArgs as Record<string, unknown>;
      const sid = typeof rec.screenId === 'string' ? rec.screenId.trim() : '';
      if (!sid || !planned(sid)) return;
      const reviewRec = reviewRecords.get(sid);
      if (reviewRec?.phase === 'completed') return;
      const elementId = typeof rec.elementId === 'string' && rec.elementId.trim() ? rec.elementId.trim() : undefined;
      const note = typeof rec.note === 'string' ? rec.note.trim() : '';
      if (!note) return;
      const activeFinding = reviewRec?.findings[reviewRec.editsApplied];
      const issue = activeFinding?.issue ?? prototypeBuildScreen(tracker.state(), sid).finding;
      const targetElementId = elementId ?? activeFinding?.elementId;
      send(
        tracker.screen(sid, {
          status: 'fixing',
          fixActivity: {
            ...(targetElementId ? { elementId: targetElementId } : {}),
            ...(issue ? { issue } : {}),
            fixNote: note,
            state: 'fixing',
          },
        }),
      );
    },

    checkEditScreenAllowed(screenId) {
      const sid = screenId.trim();
      const rec = reviewRecords.get(sid);
      if (rec?.phase === 'completed' || (rec && rec.reported && rec.editsApplied >= rec.maxEditsAllowed)) {
        return pickLocaleText(
          locale,
          `每屏最多做一轮检查和局部修正，${sid} 本轮检查修正已经完成，不能重复修改。`,
          `At most one review and targeted-fix round per screen; ${sid} has already finished its review round.`,
        );
      }
      if (tracker.started() && hasPrototypeBuildPlan(tracker.state()) && (!rec || !rec.reported)) {
        return pickLocaleText(
          locale,
          `在施工计划流程中，edit_screen 只能在 report_review 报告该屏问题后用于本轮局部修正（${sid} 尚未报告检查问题）。`,
          `During a Build Plan run, edit_screen may only be used after report_review reports findings on ${sid}.`,
        );
      }
      return null;
    },

    commitEditScreen(screenId, input) {
      const sid = screenId.trim();
      const existing = reviewRecords.get(sid);
      if (existing) {
        existing.editsApplied += 1;
        if (existing.editsApplied >= existing.maxEditsAllowed) {
          existing.phase = 'completed';
        }
      } else {
        reviewRecords.set(sid, {
          phase: 'completed',
          reported: false,
          findings: [],
          editsApplied: 1,
          maxEditsAllowed: 1,
        });
      }
      if (!tracker.started() || !planned(sid)) return;
      const note = input.note?.trim();
      if (note) {
        send(tracker.log({ agent: 0, kind: 'screen_fixing', screenId: sid, detail: note }));
      }
      const updated = reviewRecords.get(sid)!;
      const hasMoreFixesInRound = updated.phase === 'in_review' && updated.editsApplied < updated.maxEditsAllowed;
      const nextFinding = hasMoreFixesInRound ? updated.findings[updated.editsApplied] : undefined;
      send(
        tracker.screen(sid, {
          status: hasMoreFixesInRound ? 'fixing' : 'done',
          reviewed: 'fixed',
          writtenElements: countWrittenElements(input.html),
          ...(nextFinding
            ? {
                finding: nextFinding.issue,
                fixActivity: {
                  ...(nextFinding.elementId ? { elementId: nextFinding.elementId } : {}),
                  issue: nextFinding.issue,
                  state: 'fixing',
                },
              }
            : {}),
        }),
      );
      send(tracker.log({ agent: 0, kind: 'screen_fixed', screenId: sid, ...(note ? { detail: note } : {}) }));
    },

    completeScreenReview(screenId) {
      const sid = screenId.trim();
      const rec = reviewRecords.get(sid);
      if (rec) rec.phase = 'completed';
      if (!sid || !tracker.started() || !planned(sid)) return;
      const cur = prototypeBuildScreen(tracker.state(), sid);
      if (cur.status === 'reviewing' || cur.status === 'fixing') {
        send(tracker.screen(sid, { status: 'done' }));
      }
    },

    skipVisualReview() {
      if (!tracker.started() || !hasPrototypeBuildPlan(tracker.state()) || reviewSkippedLogged) return;
      reviewSkippedLogged = true;
      send(tracker.phase('review', 'skipped'));
      send(tracker.log({ agent: 0, kind: 'phase_skipped', phase: 'review' }));
    },

    finishScreensPhase() {
      if (!tracker.started() || !hasPrototypeBuildPlan(tracker.state())) return;
      const state = tracker.state();
      if (state.phases.screens.status !== 'now') return;
      const anyFailed = state.plan.some((p) => prototypeBuildScreen(state, p.screenId).status === 'failed');
      const anyWritingOrQueued = state.plan.some((p) => {
        const st = prototypeBuildScreen(state, p.screenId).status;
        return st === 'queued' || st === 'writing';
      });
      if (!anyWritingOrQueued) {
        send(tracker.phase('screens', anyFailed ? 'failed' : 'done'));
      }
    },

    finishReviewPhase() {
      if (!tracker.started() || !hasPrototypeBuildPlan(tracker.state())) return;
      const anyReported = Array.from(reviewRecords.values()).some((r) => r.reported);
      if (anyReported) {
        for (const item of tracker.state().plan) {
          const cur = prototypeBuildScreen(tracker.state(), item.screenId);
          if (cur.status === 'reviewing' || cur.status === 'fixing') {
            send(tracker.screen(item.screenId, { status: 'done' }));
          }
        }
        send(tracker.phase('review', 'done'));
      }
    },

    observeToursStream(documentHtml) {
      ensureStyleRun(documentHtml);
      toursAttempted = true;
      const cur = tracker.state().phases.tours.status;
      if (cur === 'now') return;
      send(tracker.phase('tours', 'now'));
      if (cur === 'not_started' || cur === 'skipped') {
        send(tracker.log({ agent: 0, kind: 'tours_started' }));
      }
    },

    commitTours(result, documentHtml) {
      toursAttempted = true;
      if (!result.ok) {
        if (!tracker.started() || !hasPrototypeBuildPlan(tracker.state())) return;
        if (!toursSucceeded) {
          send(tracker.phase('tours', 'failed'));
        }
        return;
      }
      ensureStyleRun(documentHtml);
      toursSucceeded = true;
      const prevStatus = tracker.state().phases.tours.status;
      if (prevStatus === 'not_started' || prevStatus === 'skipped') {
        send(tracker.phase('tours', 'now'));
        send(tracker.log({ agent: 0, kind: 'tours_started' }));
      }
      send(tracker.phase('tours', 'done'));
      send(tracker.log({ agent: 0, kind: 'tours_ready', count: result.count }));
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
      // A Style Tile still being written when the run ended was never set.
      if (state.phases.style.status === 'now') send(tracker.phase('style', 'failed'));
      const leftover =
        outcome === 'cancelled' ? 'cancelled' : outcome === 'failed' ? 'interrupted' : 'not_written';
      let done = 0;
      let failed = 0;
      for (const item of tracker.state().plan) {
        const screen = prototypeBuildScreen(tracker.state(), item.screenId);
        if (screen.status === 'reviewing' || screen.status === 'fixing') {
          if (outcome === 'succeeded') {
            send(tracker.screen(item.screenId, { status: 'done' }));
            done += 1;
            continue;
          }
        }
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
        const anyReported = Array.from(reviewRecords.values()).some((r) => r.reported);
        const reviewStatus = tracker.state().phases.review.status;
        if (anyReported && reviewStatus === 'now') {
          send(tracker.phase('review', 'done'));
        } else if (!anyReported && (reviewStatus === 'not_started' || reviewStatus === 'now')) {
          send(tracker.phase('review', 'skipped'));
          if (!reviewSkippedLogged) {
            reviewSkippedLogged = true;
            send(tracker.log({ agent: 0, kind: 'phase_skipped', phase: 'review' }));
          }
        }
        // Demo tours (#95): failed if attempted without a valid write; skipped if never attempted.
        const toursStatus = tracker.state().phases.tours.status;
        if (toursStatus === 'now' || toursStatus === 'not_started') {
          send(tracker.phase('tours', toursAttempted && !toursSucceeded ? 'failed' : 'skipped'));
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
