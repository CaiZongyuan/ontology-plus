/**
 * Demo Tours (`演示路线`, ADR 0005 2026-11-18 amendment, ADR 0019, spec #87 / #95).
 *
 * A prototype's Demo Tours travel inside `界面原型.html` as a `<script type="application/json" data-proto-tours>`
 * block. Every step references an existing `data-screen-id` and, when targeting a control or section,
 * an existing `data-element-id` inside that screen. Pure TypeScript (no DOM) so the server, agent
 * validator, and browser share one implementation. Demo Tours are presentation only and are never
 * extracted into the Ontology Suite (`MU`).
 */

import {
  RAW_TEXT_HTML_TAGS,
  VOID_HTML_TAGS,
  findHtmlTagClose,
  parseHtmlAttributes,
} from './html-scan.js';
import { sanitizePrototypeNote } from './prototype-notes.js';

export const PROTOTYPE_TOURS_ATTR = 'data-proto-tours';

export type PrototypeDemoTourAction = 'look' | 'click' | 'type';

export interface PrototypeDemoTourStep {
  screenId: string;
  elementId?: string;
  action: PrototypeDemoTourAction;
  caption: string;
  text?: string;
  times?: number;
}

export interface PrototypeDemoTour {
  id: string;
  goal: string;
  audience?: string;
  steps: PrototypeDemoTourStep[];
}

export type PrototypeDemoTourIssueCode =
  | 'empty_tours'
  | 'invalid_tour_count'
  | 'missing_goal'
  | 'empty_steps'
  | 'missing_screen_id'
  | 'unknown_screen'
  | 'screen_not_ready'
  | 'missing_element_id'
  | 'unknown_element'
  | 'missing_caption'
  | 'invalid_action'
  | 'missing_type_text';

export interface PrototypeDemoTourIssue {
  tourIndex: number;
  tourId?: string;
  stepIndex?: number;
  code: PrototypeDemoTourIssueCode;
  screenId?: string;
  elementId?: string;
  message: string;
}

export interface PrototypeDemoTourValidationResult {
  ok: boolean;
  tours: PrototypeDemoTour[];
  issues: PrototypeDemoTourIssue[];
  availableScreenIds: string[];
  availableElementsByScreen: Record<string, string[]>;
}

const VALID_ACTIONS: ReadonlySet<string> = new Set(['look', 'click', 'type']);

const TOURS_SCRIPT_RE =
  /<script\b(?:[^>"']|"[^"]*"|'[^']*')*\bdata-proto-tours\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/script\s*>/gi;

function sanitizeShortField(raw: unknown, maxLen = 160): string {
  if (typeof raw !== 'string') return '';
  const cleaned = sanitizePrototypeNote(raw);
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1).trimEnd()}…` : cleaned;
}

function normalizeTourId(rawId: unknown, fallbackIndex: number, usedIds: Set<string>): string {
  const candidate =
    typeof rawId === 'string'
      ? rawId
          .trim()
          .replace(/[^A-Za-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 64)
      : '';
  const base = candidate || `tour-${fallbackIndex + 1}`;
  let unique = base;
  let suffix = 2;
  while (usedIds.has(unique)) {
    unique = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(unique);
  return unique;
}

function escapeJsonForScriptTag(json: string): string {
  return json
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

interface ScannedScreenInventory {
  screenIds: string[];
  readyScreens: Set<string>;
  elementsByScreen: Map<string, Set<string>>;
}

function scanDocumentAnchorInventory(html: string): ScannedScreenInventory {
  const screenIds: string[] = [];
  const seenScreens = new Set<string>();
  const readyScreens = new Set<string>();
  const elementsByScreen = new Map<string, Set<string>>();

  interface OpenItem {
    tag: string;
    screenId?: string;
    queued: boolean;
    hasInnerElement: boolean;
  }

  const stack: OpenItem[] = [];
  let i = 0;

  const activeScreenItem = (): OpenItem | undefined => {
    for (let s = stack.length - 1; s >= 0; s -= 1) {
      if (stack[s]!.screenId) return stack[s];
    }
    return undefined;
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    const next = html[lt + 1];
    if (!next) break;
    if (next === '!' || next === '?') {
      const end = findHtmlTagClose(html, lt + 2);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (next === '/') {
      const closeMatch = /^<\/\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(lt, lt + 64));
      const end = findHtmlTagClose(html, lt + 2);
      if (end === -1) break;
      const closeTag = closeMatch?.[1]?.toLowerCase();
      if (closeTag) {
        for (let s = stack.length - 1; s >= 0; s -= 1) {
          if (stack[s]!.tag === closeTag) {
            for (let k = stack.length - 1; k >= s; k -= 1) {
              const popped = stack.pop()!;
              if (popped.screenId && (!popped.queued || popped.hasInnerElement)) {
                readyScreens.add(popped.screenId);
              }
            }
            break;
          }
        }
      }
      i = end;
      continue;
    }

    const openMatch = /^<([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>]|$)/.exec(html.slice(lt, lt + 64));
    if (!openMatch) {
      i = lt + 1;
      continue;
    }
    const tag = openMatch[1]!.toLowerCase();
    const afterName = lt + openMatch[0].length;
    const openEnd = findHtmlTagClose(html, afterName);
    if (openEnd === -1) break;
    const selfClosing = /\/\s*>$/.test(html.slice(Math.max(afterName, openEnd - 3), openEnd));
    const attrSlice = html.slice(afterName, selfClosing ? Math.max(afterName, openEnd - 2) : openEnd - 1);
    const attrs = parseHtmlAttributes(attrSlice);

    if (tag === 'template' && 'data-proto-style-tile' in attrs) {
      const closeRe = /<\/template\s*>/gi;
      closeRe.lastIndex = openEnd;
      const hit = closeRe.exec(html);
      i = hit ? hit.index + hit[0].length : html.length;
      continue;
    }

    if (RAW_TEXT_HTML_TAGS.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
      closeRe.lastIndex = openEnd;
      const hit = closeRe.exec(html);
      i = hit ? hit.index + hit[0].length : html.length;
      continue;
    }

    const enclosing = activeScreenItem();
    if (enclosing) enclosing.hasInnerElement = true;

    const ownScreenId = attrs['data-screen-id']?.trim();
    if (ownScreenId && !seenScreens.has(ownScreenId)) {
      seenScreens.add(ownScreenId);
      screenIds.push(ownScreenId);
      elementsByScreen.set(ownScreenId, new Set());
    }

    const targetScreenId = ownScreenId || enclosing?.screenId;
    const elementId = attrs['data-element-id']?.trim();
    if (elementId && targetScreenId) {
      let bucket = elementsByScreen.get(targetScreenId);
      if (!bucket) {
        bucket = new Set();
        elementsByScreen.set(targetScreenId, bucket);
      }
      bucket.add(elementId);
    }

    const queued = (attrs['data-screen-status'] ?? '').trim().toLowerCase() === 'queued';
    if (selfClosing || VOID_HTML_TAGS.has(tag)) {
      if (ownScreenId && !queued) readyScreens.add(ownScreenId);
      i = openEnd;
      continue;
    }

    stack.push({
      tag,
      ...(ownScreenId ? { screenId: ownScreenId } : {}),
      queued,
      hasInnerElement: false,
    });
    i = openEnd;
  }

  while (stack.length > 0) {
    const popped = stack.pop()!;
    if (popped.screenId && (!popped.queued || popped.hasInnerElement)) {
      readyScreens.add(popped.screenId);
    }
  }

  return { screenIds, readyScreens, elementsByScreen };
}

interface RawTourHeader {
  id: string;
  goal: string;
  audience: string;
  rawSteps: unknown[];
}

interface RawStepFields {
  screenId: string;
  elementId?: string;
  rawAction: string;
  normalizedAction: string;
  caption: string;
  text?: string;
  rawTimes?: number;
}

function parseRawTourHeader(rec: Record<string, unknown>, index: number, usedIds: Set<string>): RawTourHeader {
  return {
    id: normalizeTourId(rec.id, index, usedIds),
    goal: sanitizeShortField(rec.goal ?? rec.title ?? rec.name, 120),
    audience: sanitizeShortField(rec.audience ?? rec.who ?? rec.role, 64),
    rawSteps: Array.isArray(rec.steps) ? rec.steps : [],
  };
}

function parseRawStepFields(stepRec: Record<string, unknown>, fallbackAction = ''): RawStepFields {
  const screenId =
    typeof (stepRec.screenId ?? stepRec.screen) === 'string'
      ? String(stepRec.screenId ?? stepRec.screen).trim()
      : '';
  const rawElement = stepRec.elementId ?? stepRec.element;
  const elementId = typeof rawElement === 'string' && rawElement.trim() ? rawElement.trim() : undefined;
  const rawAction = typeof stepRec.action === 'string' ? stepRec.action.trim().toLowerCase() : fallbackAction;
  const normalizedAction = rawAction === 'inc' ? 'click' : rawAction;
  const caption = sanitizeShortField(stepRec.caption ?? stepRec.narration, 240);
  const text = typeof stepRec.text === 'string' ? stepRec.text : undefined;
  const rawTimes = typeof stepRec.times === 'number' ? stepRec.times : undefined;
  return {
    screenId,
    ...(elementId ? { elementId } : {}),
    rawAction,
    normalizedAction,
    caption,
    ...(text !== undefined ? { text } : {}),
    ...(rawTimes !== undefined ? { rawTimes } : {}),
  };
}

function buildStepFromFields(fields: RawStepFields, action: PrototypeDemoTourAction): PrototypeDemoTourStep {
  const times =
    action === 'click' && fields.rawTimes !== undefined && Number.isFinite(fields.rawTimes) && Math.round(fields.rawTimes) > 1
      ? Math.min(10, Math.round(fields.rawTimes))
      : undefined;
  return {
    screenId: fields.screenId,
    ...(fields.elementId ? { elementId: fields.elementId } : {}),
    action,
    caption: fields.caption,
    ...(action === 'type' && fields.text ? { text: fields.text } : {}),
    ...(times ? { times } : {}),
  };
}

function coerceTourList(rawTours: unknown): PrototypeDemoTour[] {
  if (!Array.isArray(rawTours)) return [];
  const usedIds = new Set<string>();
  const out: PrototypeDemoTour[] = [];

  rawTours.forEach((rawTour, idx) => {
    if (!rawTour || typeof rawTour !== 'object') return;
    const { id, goal, audience, rawSteps } = parseRawTourHeader(rawTour as Record<string, unknown>, idx, usedIds);
    const steps: PrototypeDemoTourStep[] = [];

    for (const rawStep of rawSteps) {
      if (!rawStep || typeof rawStep !== 'object') continue;
      const fields = parseRawStepFields(rawStep as Record<string, unknown>, 'look');
      const action: PrototypeDemoTourAction = VALID_ACTIONS.has(fields.normalizedAction)
        ? (fields.normalizedAction as PrototypeDemoTourAction)
        : 'look';
      if (!fields.screenId || !fields.caption) continue;
      if ((action === 'click' || action === 'type') && !fields.elementId) continue;
      if (action === 'type' && (!fields.text || !fields.text.trim())) continue;
      steps.push(buildStepFromFields(fields, action));
    }

    if (goal && steps.length > 0) {
      out.push({
        id,
        goal,
        ...(audience ? { audience } : {}),
        steps,
      });
    }
  });

  return out;
}

/**
 * Reads embedded Demo Tours (`<script type="application/json" data-proto-tours>`) from a prototype
 * document or `<head>` / `<body>` fragment. Returns `[]` when none are present or malformed.
 */
export function readPrototypeDemoTours(html: string): PrototypeDemoTour[] {
  if (!html?.trim() || !html.includes(PROTOTYPE_TOURS_ATTR)) return [];
  const re = new RegExp(TOURS_SCRIPT_RE.source, 'gi');
  let match: RegExpExecArray | null;
  let lastValid: PrototypeDemoTour[] = [];
  while ((match = re.exec(html)) !== null) {
    const rawJson = (match[1] ?? '').trim();
    if (!rawJson) continue;
    try {
      const parsed: unknown = JSON.parse(rawJson);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { tours?: unknown }).tours)
          ? (parsed as { tours: unknown[] }).tours
          : [];
      lastValid = coerceTourList(list);
    } catch {
      // Ignore malformed JSON blocks
    }
  }
  return lastValid;
}

/**
 * Writes (or removes when `tours` is empty/null) the `<script type="application/json" data-proto-tours>`
 * block inside `界面原型.html`, escaping `<`, `>`, and `&` so `</script>` or `<!--` inside captions
 * or typed values can never close or corrupt the HTML document.
 */
export function writePrototypeDemoTours(
  html: string,
  tours: readonly PrototypeDemoTour[] | null | undefined,
): string {
  const source = html ?? '';
  const withoutExisting = source.replace(
    /\n?[ \t]*<script\b(?:[^>"']|"[^"]*"|'[^']*')*\bdata-proto-tours\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/script\s*>[ \t]*/gi,
    '',
  );
  const normalized = tours ? coerceTourList(tours) : [];
  if (normalized.length === 0) {
    return withoutExisting;
  }

  const safeJson = escapeJsonForScriptTag(JSON.stringify(normalized, null, 2));
  const block = `  <script type="application/json" ${PROTOTYPE_TOURS_ATTR}>\n${safeJson}\n  </script>`;

  const headClose = /<\/head\s*>/i.exec(withoutExisting);
  if (headClose) {
    return `${withoutExisting.slice(0, headClose.index)}${block}\n${withoutExisting.slice(headClose.index)}`;
  }
  const bodyClose = /<\/body\s*>/i.exec(withoutExisting);
  if (bodyClose) {
    return `${withoutExisting.slice(0, bodyClose.index)}${block}\n${withoutExisting.slice(bodyClose.index)}`;
  }
  return withoutExisting.trim() ? `${withoutExisting}\n${block}` : block;
}

/**
 * Validates Demo Tours against the screens and `data-element-id` anchors actually present in `html`.
 * Every step must reference an existing, ready `screenId` and — when `elementId` is provided — an
 * existing `data-element-id` inside that screen.
 */
export function validatePrototypeDemoTours(
  html: string,
  rawTours: unknown,
  options?: {
    minTours?: number;
    maxTours?: number;
    locale?: 'zh-CN' | 'en-US';
  },
): PrototypeDemoTourValidationResult {
  const locale = options?.locale === 'en-US' ? 'en-US' : 'zh-CN';
  const zh = locale !== 'en-US';
  const minTours = options?.minTours ?? 1;
  const maxTours = options?.maxTours ?? 8;

  const inv = scanDocumentAnchorInventory(html ?? '');
  const availableElementsByScreen: Record<string, string[]> = {};
  for (const [sid, set] of inv.elementsByScreen.entries()) {
    availableElementsByScreen[sid] = Array.from(set);
  }
  const screenSet = new Set(inv.screenIds);
  const readyScreenList = inv.screenIds.filter((sid) => inv.readyScreens.has(sid));
  const availableScreensText = readyScreenList.join(', ') || '(none)';

  const issues: PrototypeDemoTourIssue[] = [];
  if (!Array.isArray(rawTours) || rawTours.length === 0) {
    issues.push({
      tourIndex: 0,
      code: 'empty_tours',
      message: zh
        ? `演示路线不能为空（需要 ${minTours}～${maxTours} 条演示路线）。`
        : `Demo tours cannot be empty (expected ${minTours}–${maxTours} demo tours).`,
    });
    return {
      ok: false,
      tours: [],
      issues,
      availableScreenIds: readyScreenList,
      availableElementsByScreen,
    };
  }

  if (rawTours.length < minTours || rawTours.length > maxTours) {
    issues.push({
      tourIndex: 0,
      code: 'invalid_tour_count',
      message: zh
        ? `演示路线数量需要为 ${minTours}～${maxTours} 条（当前收到 ${rawTours.length} 条）。`
        : `Expected ${minTours}–${maxTours} demo tours, got ${rawTours.length}.`,
    });
  }

  const usedIds = new Set<string>();
  const validatedTours: PrototypeDemoTour[] = [];

  rawTours.forEach((rawTour, tourIndex) => {
    if (!rawTour || typeof rawTour !== 'object') {
      issues.push({
        tourIndex,
        code: 'missing_goal',
        message: zh
          ? `第 ${tourIndex + 1} 条演示路线格式不合法。`
          : `Demo tour #${tourIndex + 1} must be an object.`,
      });
      return;
    }

    const { id: tourId, goal, audience, rawSteps } = parseRawTourHeader(
      rawTour as Record<string, unknown>,
      tourIndex,
      usedIds,
    );

    if (!goal) {
      issues.push({
        tourIndex,
        tourId,
        code: 'missing_goal',
        message: zh
          ? `第 ${tourIndex + 1} 条演示路线缺少用户目标（goal）。`
          : `Demo tour #${tourIndex + 1} (${tourId}) is missing its user goal (\`goal\`).`,
      });
    }

    if (rawSteps.length === 0) {
      issues.push({
        tourIndex,
        tourId,
        code: 'empty_steps',
        message: zh
          ? `演示路线「${goal || tourId}」没有包含任何步骤（steps）。`
          : `Demo tour "${goal || tourId}" has no steps.`,
      });
      return;
    }

    const steps: PrototypeDemoTourStep[] = [];
    rawSteps.forEach((rawStep, stepIndex) => {
      if (!rawStep || typeof rawStep !== 'object') {
        issues.push({
          tourIndex,
          tourId,
          stepIndex,
          code: 'missing_screen_id',
          message: zh
            ? `路线「${goal || tourId}」第 ${stepIndex + 1} 步格式不合法。`
            : `Tour "${goal || tourId}" step #${stepIndex + 1} must be an object.`,
        });
        return;
      }

      const fields = parseRawStepFields(rawStep as Record<string, unknown>);
      const { screenId, elementId, rawAction, normalizedAction, caption, text } = fields;

      if (!screenId) {
        issues.push({
          tourIndex,
          tourId,
          stepIndex,
          code: 'missing_screen_id',
          message: zh
            ? `路线「${goal || tourId}」第 ${stepIndex + 1} 步缺少 screenId。可用屏幕：[${availableScreensText}]。`
            : `Tour "${goal || tourId}" step #${stepIndex + 1} is missing \`screenId\`. Available screens: [${availableScreensText}].`,
        });
        return;
      }

      if (!screenSet.has(screenId)) {
        issues.push({
          tourIndex,
          tourId,
          stepIndex,
          code: 'unknown_screen',
          screenId,
          message: zh
            ? `路线「${goal || tourId}」第 ${stepIndex + 1} 步引用了不存在的屏幕 "${screenId}"。已绘制屏幕：[${availableScreensText}]。`
            : `Tour "${goal || tourId}" step #${stepIndex + 1} references nonexistent screen "${screenId}". Drawn screens: [${availableScreensText}].`,
        });
        return;
      }

      if (!inv.readyScreens.has(screenId)) {
        issues.push({
          tourIndex,
          tourId,
          stepIndex,
          code: 'screen_not_ready',
          screenId,
          message: zh
            ? `路线「${goal || tourId}」第 ${stepIndex + 1} 步引用了尚未绘制完成的屏幕 "${screenId}"。仅可引用已绘制完成的屏幕：[${availableScreensText}]。`
            : `Tour "${goal || tourId}" step #${stepIndex + 1} references unfinished screen "${screenId}". Only drawn screens may be referenced: [${availableScreensText}].`,
        });
        return;
      }

      if (!VALID_ACTIONS.has(normalizedAction)) {
        issues.push({
          tourIndex,
          tourId,
          stepIndex,
          code: 'invalid_action',
          screenId,
          ...(elementId ? { elementId } : {}),
          message: zh
            ? `路线「${goal || tourId}」第 ${stepIndex + 1} 步的 action="${rawAction}" 不合法（仅支持 look | click | type）。`
            : `Tour "${goal || tourId}" step #${stepIndex + 1} has invalid action="${rawAction}" (expected look | click | type).`,
        });
        return;
      }

      const action = normalizedAction as PrototypeDemoTourAction;
      const screenElements = inv.elementsByScreen.get(screenId) ?? new Set<string>();
      const availableEls = Array.from(screenElements).slice(0, 24).join(', ') || '(none)';

      if ((action === 'click' || action === 'type') && !elementId) {
        issues.push({
          tourIndex,
          tourId,
          stepIndex,
          code: 'missing_element_id',
          screenId,
          message: zh
            ? `路线「${goal || tourId}」第 ${stepIndex + 1} 步动作是 ${action}，必须指定屏幕 "${screenId}" 内的元素锚点 elementId。可用 data-element-id：[${availableEls}]。`
            : `Tour "${goal || tourId}" step #${stepIndex + 1} uses action="${action}" and requires an \`elementId\` inside screen "${screenId}". Available data-element-id: [${availableEls}].`,
        });
        return;
      }

      if (elementId && !screenElements.has(elementId)) {
        issues.push({
          tourIndex,
          tourId,
          stepIndex,
          code: 'unknown_element',
          screenId,
          elementId,
          message: zh
            ? `路线「${goal || tourId}」第 ${stepIndex + 1} 步在屏幕 "${screenId}" 中未找到元素锚点 "${elementId}"。该屏可用 data-element-id：[${availableEls}]。`
            : `Tour "${goal || tourId}" step #${stepIndex + 1} references element "${elementId}" which does not exist in screen "${screenId}". Available data-element-id in "${screenId}": [${availableEls}].`,
        });
        return;
      }

      if (!caption) {
        issues.push({
          tourIndex,
          tourId,
          stepIndex,
          code: 'missing_caption',
          screenId,
          ...(elementId ? { elementId } : {}),
          message: zh
            ? `路线「${goal || tourId}」第 ${stepIndex + 1} 步缺少字幕解说（caption）。`
            : `Tour "${goal || tourId}" step #${stepIndex + 1} is missing \`caption\`.`,
        });
        return;
      }

      if (action === 'type' && (!text || !text.trim())) {
        issues.push({
          tourIndex,
          tourId,
          stepIndex,
          code: 'missing_type_text',
          screenId,
          ...(elementId ? { elementId } : {}),
          message: zh
            ? `路线「${goal || tourId}」第 ${stepIndex + 1} 步动作是 type，必须提供非空的输入内容 text。`
            : `Tour "${goal || tourId}" step #${stepIndex + 1} uses action="type" and requires a non-empty \`text\` string.`,
        });
        return;
      }

      steps.push(buildStepFromFields(fields, action));
    });

    if (goal && steps.length > 0) {
      validatedTours.push({
        id: tourId,
        goal,
        ...(audience ? { audience } : {}),
        steps,
      });
    }
  });

  return {
    ok: issues.length === 0 && validatedTours.length >= minTours && validatedTours.length <= maxTours,
    tours: issues.length === 0 ? validatedTours : [],
    issues,
    availableScreenIds: readyScreenList,
    availableElementsByScreen,
  };
}
