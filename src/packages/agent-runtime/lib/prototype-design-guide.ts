/**
 * The design side of a live prototype build (spec #87 decision 2, #91): the lead's
 * `define_style` tool, the design guide both the lead and the screen helpers follow, the
 * helpers' tool set and its runtime scope, and the context package each helper receives.
 *
 * The guide follows the mechanism of Doop's `guide.ts` (one doctrine embedded verbatim wherever
 * a design is made, so the lead and the helpers cannot drift apart); the text is our own.
 */

import type { Tool, ToolCall } from '@earendil-works/pi-ai';
import {
  PROTOTYPE_STYLE_VALUE_KEYS,
  PROTOTYPE_STYLE_VARIABLES,
  readPrototypeStyleValues,
  resolvePrototypeStyleValues,
  sanitizeStyleCss,
  splitPrototypeDocument,
  sanitizeStyleSampleHtml,
  type PrototypeBuildPlanItem,
  type PrototypeDocumentStyle,
  type PrototypeStyle,
  type PrototypeStyleValueKey,
  type PrototypeStyleValues,
} from '../../ontology-core/index.js';
import { FORBIDDEN_DIALOG_RE } from './prototype-anchor-tools.js';
import {
  CURATED_INSPO_CATALOG,
  inspoFullUrl,
  inspoHeroUrl,
  type AgentImageAttachmentRef,
  type DesignBrief,
  type VisualReferenceItem,
} from '../../workspace-store/index.js';
import { type AgentLocale, pickLocaleText } from './locale.js';
import type { OpenAiFunctionTool } from './tools.js';

export const DEFINE_STYLE_TOOL_NAME = 'define_style';

/** Short fields first, the long ones last, so the artboard knows its values before it draws. */
export const DEFINE_STYLE_OPENAI_TOOL: OpenAiFunctionTool = {
  type: 'function',
  function: {
    name: DEFINE_STYLE_TOOL_NAME,
    description:
      'Set the shared look of the whole prototype before any screen is drawn, and draw it on the first artboard (风格样张). Design values first (they become CSS variables --proto-*), then the CSS of the shared components written only with those variables, then a sample that shows each component with realistic content. Every screen helper receives these values and components and builds its screen from them. Values approved in the Design Brief are locked: pass them unchanged (other values for those keys are ignored).',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          description:
            'One sentence naming the single visual direction in business language, e.g. 沉稳的墨绿配暖纸底色，像门店里的木质货架',
        },
        values: {
          type: 'object',
          description: 'The design values (hex colours).',
          properties: {
            mode: { type: 'string', enum: ['light', 'dark'] },
            background: { type: 'string', description: 'page ground' },
            surface: { type: 'string', description: 'cards, panels, bars' },
            inset: { type: 'string', description: 'sunken areas, table heads' },
            accent: { type: 'string', description: 'the ONE accent: primary action, current state' },
            accentInk: { type: 'string', description: 'text on the accent' },
            border: { type: 'string' },
            ink: { type: 'string', description: 'body text' },
            mutedInk: { type: 'string', description: 'secondary text' },
            ok: { type: 'string' },
            warn: { type: 'string' },
            danger: { type: 'string' },
            fontFamily: { type: 'string' },
            radiusPx: { type: 'number' },
            density: { type: 'string', enum: ['compact', 'comfortable'] },
          },
        },
        componentCss: {
          type: 'string',
          description:
            'CSS of the shared components, using only var(--proto-*): buttons (primary, secondary, danger), cards, tables, form fields (input, select, textarea), tags/status badges, empty states, plus page/section layout helpers. Short class names (.btn, .card, .tag …). No fixed page widths.',
        },
        userRequested: {
          type: 'object',
          description:
            'ONLY when the user explicitly asked in their latest message to change an approved design value (e.g. 主色改成蓝色): the value keys they asked to change and their words quoted verbatim. Never use it to change approved values on your own.',
          properties: {
            keys: { type: 'array', items: { type: 'string' } },
            quote: { type: 'string', description: "The user's words, copied exactly from their message" },
          },
        },
        sampleHtml: {
          type: 'string',
          description:
            'The style sample drawn on the first artboard: a short heading naming the direction, colour swatches, then each shared component with realistic business content (buttons, a card, a small table, a form row, tags, an empty state). Plain HTML using the component classes; no data-* anchors, no scripts.',
        },
      },
      required: ['values', 'componentCss', 'sampleHtml'],
    },
  },
};

/** The design guide, embedded in the lead's and every helper's instructions. */
export function prototypeDesignGuide(locale: AgentLocale): string {
  return pickLocaleText(
    locale,
    [
      '【设计守则】',
      '1. 先设计值，后组件，再屏幕：颜色、字体、圆角和疏密先定成设计值（CSS 变量 --proto-*）；共用组件只用这些变量；每一屏都用这些组件拼出来。某一屏需要新的组件时，按同一套设计值补，不在某一屏里另起一套颜色和样式。',
      '2. 整套原型只走一种视觉方向：先用一句话说出方向（像什么场景、什么材质），每个颜色都能说出它来自这个场景里的什么东西。一种底色、一个强调色，其余是同一场景里的辅助色；强调色只给主要操作和当前状态。',
      '3. 避开一眼就像 AI 做的俗套：白底紫色渐变、深蓝或炭黑配荧光青/紫/黄绿、暖白底配陶土橙、处处加阴影、玻璃拟态、满屏大图标卡片、一排三个长得一模一样的数字卡。',
      '4. 留白是设计的一部分：组内紧、组间松；主次靠字号和字重拉开，而不是靠颜色和边框堆。',
      '5. 内容要像真的：真实的人名、单号、金额、日期和状态，条数合理；不写“示例文本”“Lorem ipsum”“XXX”“张三李四”。',
      '6. 页面宽度自适应：不写死 1280、1440 之类的页面宽度或 max-width 外框；用 flex/grid、百分比和 minmax 让内容随宽度伸缩，窄了就折行。',
    ].join('\n'),
    [
      '[Design guide]',
      '1. Values first, then components, then screens: colours, type, radius and density become design values (CSS variables --proto-*) first; shared components use only those variables; every screen is composed from those components. When a screen needs a new component, build it on the same values — never start a second palette or style on one screen.',
      '2. One visual direction for the whole prototype: name it in one sentence (what scene, what material), and be able to say which object in that scene each colour comes from. One ground, ONE accent, supporting tones from the same scene; the accent is only for primary actions and current state.',
      '3. Avoid the clichés that read as AI output: purple gradients on white, navy or charcoal with neon teal/purple/lime, warm off-white with terracotta, shadows on everything, glassmorphism, walls of big-icon cards, a row of three identical number cards.',
      '4. White space is part of the design: tight inside groups, generous between them; hierarchy comes from size and weight, not from piling up colour and borders.',
      '5. Realistic content: real names, order numbers, amounts, dates and states, in plausible quantities; never "sample text", lorem ipsum, "XXX" or "John Doe".',
      '6. Width-adaptive pages: no fixed 1280/1440 page widths or max-width frames; flex/grid, percentages and minmax let content follow the width and wrap when narrow.',
    ].join('\n'),
  );
}

/** The lead's build order, with the approved values it must keep (if any). */
export function prototypeLeadStyleInstructions(
  locale: AgentLocale,
  locked: PrototypeStyleValues | null,
): string {
  const lockedLine = locked
    ? pickLocaleText(
        locale,
        `【已确认的设计值（锁定，不能改）】调用 \`define_style\` 时原样传入：${JSON.stringify(locked)}。只有用户在消息里明确要求改某个设计值时，才把它的键写进 \`userRequested.keys\`，并在 \`userRequested.quote\` 里原样引用用户的话。`,
        `[Approved design values (locked, do not change)] Pass these unchanged to \`define_style\`: ${JSON.stringify(locked)}. Only when the user explicitly asks in their message to change one of them, put its key in \`userRequested.keys\` and quote the user's words verbatim in \`userRequested.quote\`.`,
      )
    : pickLocaleText(
        locale,
        '【设计值】用户没有确认风格样张：由你按设计守则提出一整套设计值（每个键都给）。',
        '[Design values] The user has not approved a Style Tile: propose a complete set of values (every key) following the design guide.',
      );
  return [prototypeDesignGuide(locale), lockedLine].join('\n');
}

/** Tools that act on the whole document: the lead's alone, never a screen helper's. */
export const DOCUMENT_LEVEL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'init_prototype_shell',
  'rewrite_prototype_page',
  DEFINE_STYLE_TOOL_NAME,
  'plan_screens',
  'spawn_subagents',
  'codemode',
]);

/** What a screen helper may call: read anchors, write or locally edit its own screen. */
export const SCREEN_HELPER_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read_prototype_anchor',
  'upsert_prototype_screen',
  'edit_prototype_anchor',
]);

/** A screen helper's tool set: only the screen-level tools of what the session offers. */
export function screenHelperTools(tools: readonly Tool[]): Tool[] {
  return tools.filter((t) => SCREEN_HELPER_TOOL_NAMES.has(t.name));
}

/**
 * Runtime scope of a screen helper (checked before anything runs): a tool outside its set, or a
 * write naming another screen, is rejected with a diagnostic. Null when the call may run.
 * Edits that name no screen are checked after they run (see `screensChangedOutside`).
 */
export function checkScreenHelperCall(tc: ToolCall, ownScreenId: string, locale: AgentLocale): string | null {
  if (!SCREEN_HELPER_TOOL_NAMES.has(tc.name)) {
    return pickLocaleText(
      locale,
      `你只负责画「${ownScreenId}」这一屏，不能调用 ${tc.name}。请用 upsert_prototype_screen 写这一屏，或用 edit_prototype_anchor 局部修改这一屏。`,
      `You only build screen ${ownScreenId} and cannot call ${tc.name}. Use upsert_prototype_screen to write this screen, or edit_prototype_anchor to edit it locally.`,
    );
  }
  if (tc.name === 'read_prototype_anchor') return null;
  const args = (tc.arguments ?? {}) as Record<string, unknown>;
  const named = typeof args.screenId === 'string' ? args.screenId.trim() : '';
  if (tc.name === 'upsert_prototype_screen' && named !== ownScreenId) {
    return pickLocaleText(
      locale,
      `upsert_prototype_screen 只能写你自己的这一屏：screenId 必须是 ${ownScreenId}（收到的是 ${named || '空'}）。`,
      `upsert_prototype_screen may only write your own screen: screenId must be ${ownScreenId} (got ${named || 'none'}).`,
    );
  }
  if (tc.name === 'edit_prototype_anchor' && named && named !== ownScreenId) {
    return pickLocaleText(
      locale,
      `edit_prototype_anchor 只能改你自己的这一屏（${ownScreenId}），不能改 ${named}。`,
      `edit_prototype_anchor may only edit your own screen (${ownScreenId}), not ${named}.`,
    );
  }
  return null;
}

/** Names of the screens (other than `exceptScreenId`) that differ between two documents. */
export function screensChangedOutside(beforeHtml: string, afterHtml: string, exceptScreenId: string): string[] {
  const before = new Map(splitPrototypeDocument(beforeHtml).screens.map((sc) => [sc.screenId, sc]));
  const after = splitPrototypeDocument(afterHtml).screens;
  const changed: string[] = [];
  for (const sc of after) {
    if (sc.screenId === exceptScreenId) continue;
    if (before.get(sc.screenId)?.html !== sc.html) changed.push(sc.screenName);
  }
  for (const [id, sc] of before) {
    if (id !== exceptScreenId && !after.some((a) => a.screenId === id)) changed.push(sc.screenName);
  }
  return changed;
}

/** Everything in a document except one screen: its section, its CSS block and its scripts. */
function outsideOf(html: string, screenId: string): string {
  const id = screenId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markerId = screenId.replace(/--/g, '- -').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const { frame, screens } = splitPrototypeDocument(html);
  const strip = (part: string) =>
    part
      .replace(new RegExp(`<style\\b[^>]*data-screen-css="${id}"[^>]*>[\\s\\S]*?</style>\\s*`, 'gi'), '')
      .replace(new RegExp(`<script\\b[^>]*data-screen-js="${id}"[^>]*>[\\s\\S]*?</script>\\s*`, 'gi'), '')
      .replace(new RegExp(`<!--onto-screen:${markerId}-->\\s*`, 'g'), '')
      .replace(/\s+/g, ' ')
      .trim();
  const ownScreens = screens.filter((sc) => sc.screenId === screenId);
  return JSON.stringify({
    htmlAttrs: frame.htmlAttrs,
    head: strip(frame.headHtml),
    bodyAttrs: frame.bodyAttrs,
    body: strip(frame.bodyHtml),
    duplicateOwn: ownScreens.length > 1,
    screens: screens.filter((sc) => sc.screenId !== screenId).map((sc) => [sc.screenId, sc.html]),
  });
}

/**
 * After a screen helper's tool ran: if anything outside its own screen changed — another
 * screen, the shell, the navigation, the style, the head — the document goes back to how it was
 * and the helper gets a diagnostic; otherwise the new document stands. The helper's own section,
 * its own CSS block and its own scripts are the only things it may change.
 */
export function keepWithinOwnScreen(
  beforeHtml: string,
  afterHtml: string,
  ownScreenId: string,
  locale: AgentLocale,
): { html: string; diagnostic: string | null } {
  if (outsideOf(beforeHtml, ownScreenId) === outsideOf(afterHtml, ownScreenId)) {
    return { html: afterHtml, diagnostic: null };
  }
  const others = screensChangedOutside(beforeHtml, afterHtml, ownScreenId);
  const what = others.length > 0 ? others : [pickLocaleText(locale, '外壳、导航或风格', 'the shell, navigation or style')];
  return { html: beforeHtml, diagnostic: outsideScreenDiagnostic(ownScreenId, what, locale) };
}

/** The diagnostic for an edit that reached beyond the helper's own screen (it is undone). */
export function outsideScreenDiagnostic(ownScreenId: string, others: readonly string[], locale: AgentLocale): string {
  return pickLocaleText(
    locale,
    `这次修改动到了别的屏（${others.join('、')}），已撤回。你只能改「${ownScreenId}」这一屏里的元素。`,
    `This edit reached other screens (${others.join(', ')}) and was undone. You may only edit elements inside screen ${ownScreenId}.`,
  );
}

/** The helper's own system prompt: its role, its scope and the design guide. */
export function screenHelperSystemPrompt(locale: AgentLocale): string {
  return [
    pickLocaleText(
      locale,
      [
        '你是 Ontology Plus 原型施工中的一位屏幕助手：主助手已经定好施工计划和整套原型的风格（设计值和共用组件），你只负责把分给你的那一屏画出来。',
        '规则：',
        '1. 只写自己这一屏：用 `upsert_prototype_screen` 写出整屏，或用 `edit_prototype_anchor` 局部修改；别的屏、外壳、风格和整份文件都不归你管，相应工具也不在你手里。',
        '2. 用风格样张里的共用组件类名和 var(--proto-*) 变量；`extraCss` 只写这一屏特有的布局，不重新定义颜色和组件。',
        '3. 先写元素的开始标签（带 data-element-id 和一句业务说明 data-note），再写内容。所有 <button>/<input>/<select>/<textarea> 都要有全局唯一的 data-element-id 和合法的 data-element-type；跳到别的屏用 data-navigate-to="屏幕 ID"；不用 window.alert/confirm/prompt。',
        '4. 校验没通过时，按诊断在同一轮里改好再写一次。写完并通过校验，这一屏才算完成。',
      ].join('\n'),
      [
        'You are a screen helper in an Ontology Plus prototype build: the lead has set the Build Plan and the shared look (design values and shared components); you only draw the one screen assigned to you.',
        'Rules:',
        '1. Write only your own screen: `upsert_prototype_screen` for the whole screen, or `edit_prototype_anchor` for a local edit. Other screens, the shell, the style and the whole document are not yours, and those tools are not available to you.',
        '2. Use the shared component classes and the var(--proto-*) variables from the style sample; `extraCss` is only for this screen\'s own layout, never new colours or components.',
        '3. Write each element\'s opening tag first (with data-element-id and a one-sentence business data-note), then its content. Every <button>/<input>/<select>/<textarea> needs a globally unique data-element-id and a valid data-element-type; link to other screens with data-navigate-to="SCREEN-ID"; never use window.alert/confirm/prompt.',
        '4. If the check fails, fix it from the diagnostic and write again in the same turn. The screen is done only when it is written and passes the check.',
      ].join('\n'),
    ),
    prototypeDesignGuide(locale),
  ].join('\n\n');
}

export interface ScreenHelperContextInput {
  locale: AgentLocale;
  /** The screen this helper owns. */
  screenId: string;
  plan: readonly PrototypeBuildPlanItem[];
  /**
   * The shared look: this run's `define_style`, or the one the document already carries (its
   * stylesheet holds the values as --proto-* variables, then the component CSS).
   */
  style: PrototypeDocumentStyle | null;
  designBrief?: DesignBrief | null;
  requirements?: { title: string; content: string } | null;
  /** One line per Visual Reference image sent with the helper's message (or its text notes). */
  referenceLines: readonly string[];
}

const REQUIREMENTS_SUMMARY_CHARS = 1800;

/**
 * The context package of one screen helper: the full Design Brief, the design values and the
 * shared components (CSS and samples), the Visual Reference manifest, the requirements summary
 * and the other planned screens (for links). Images travel separately as vision input.
 */
export function buildScreenHelperContext(input: ScreenHelperContextInput): string {
  const { locale } = input;
  const zh = locale !== 'en-US';
  const sections: string[] = [];

  const brief = input.designBrief;
  if (brief && (brief.items.length > 0 || brief.userFeelNote)) {
    const lines = brief.items.map((item) => `- [${item.category}] ${item.statement}`);
    if (brief.userFeelNote) lines.push(zh ? `- 用户的感受：${brief.userFeelNote}` : `- The user's feel: ${brief.userFeelNote}`);
    if (brief.primaryReferenceTitle) {
      lines.push(zh ? `- 主视觉参考：${brief.primaryReferenceTitle}` : `- Primary visual reference: ${brief.primaryReferenceTitle}`);
    }
    for (const b of brief.borrowedReferences ?? []) {
      lines.push(zh ? `- 借鉴「${b.title ?? b.referenceId}」的 ${b.aspect}` : `- Borrow ${b.aspect} from "${b.title ?? b.referenceId}"`);
    }
    sections.push(`${zh ? '【设计简报】' : '[Design Brief]'}${brief.approvedAt ? (zh ? '（用户已确认）' : ' (approved by the user)') : ''}\n${lines.join('\n')}`);
  }

  if (input.style) {
    const s = input.style;
    const vars = PROTOTYPE_STYLE_VARIABLES.map((v) => `${v.name} (${v.role})`).join('; ');
    sections.push(
      [
        `${zh ? '【设计值与共用组件样式】' : '[Design values and shared component CSS]'}${s.locked ? (zh ? '（设计值是用户确认的，锁定）' : ' (values approved by the user, locked)') : ''}${s.direction ? ` ${zh ? '方向：' : 'Direction: '}${s.direction}` : ''}`,
        zh
          ? '下面的样式已经在文档里：直接用这些类名和变量，不要重写。'
          : 'This stylesheet is already in the document: use these classes and variables, do not redefine them.',
        `${zh ? '变量' : 'Variables'}: ${vars}`,
        sanitizeStyleCss(s.css).trim(),
      ].join('\n'),
    );
    const sample = sanitizeStyleSampleHtml(s.sampleHtml).trim();
    if (sample) {
      sections.push(`${zh ? '【组件示例】（风格样张上的写法）' : '[Component examples] (as drawn on the style sample)'}\n${sample}`);
    }
  } else {
    sections.push(
      zh
        ? '【设计值】这份原型还没有风格样张：用 var(--proto-*) 变量和文档里已有的类名，不要另起颜色。'
        : '[Design values] This prototype has no style sample yet: use the var(--proto-*) variables and the classes already in the document; do not introduce new colours.',
    );
  }

  if (input.referenceLines.length > 0) {
    sections.push(`${zh ? '【视觉参考】' : '[Visual References]'}\n${input.referenceLines.join('\n')}`);
  }

  if (input.requirements?.content.trim()) {
    const body = input.requirements.content.trim();
    const summary = body.length > REQUIREMENTS_SUMMARY_CHARS ? `${body.slice(0, REQUIREMENTS_SUMMARY_CHARS)}…` : body;
    sections.push(`${zh ? '【需求摘要】' : '[Requirements summary]'}（${input.requirements.title}）\n${summary}`);
  }

  // The other screens, without backticks: the helper's own id is the first quoted one.
  const others = input.plan.filter((p) => p.screenId !== input.screenId);
  if (others.length > 0) {
    sections.push(
      `${zh ? '【其他屏（可用 data-navigate-to 链接过去，但不要画它们）】' : '[Other screens (link with data-navigate-to, do not draw them)]'}\n${others
        .map((p) => `- ${p.screenId} · ${p.screenName}${p.purpose ? ` — ${p.purpose}` : ''}`)
        .join('\n')}`,
    );
  }
  return sections.join('\n\n');
}

/**
 * The approved keys the user explicitly asked to change: the lead names them and quotes the
 * user's words, and the quote must really be in the user's message.
 */
function userRequestedKeys(
  raw: unknown,
  values: unknown,
  locked: Partial<PrototypeStyleValues> | null,
  userPrompt: string | undefined,
): PrototypeStyleValueKey[] {
  if (!locked || !raw || typeof raw !== 'object' || !userPrompt) return [];
  const rec = raw as { keys?: unknown; quote?: unknown };
  const quote = typeof rec.quote === 'string' ? rec.quote.trim() : '';
  if (quote.length < 2 || !userPrompt.includes(quote)) return [];
  const proposed = readPrototypeStyleValues(values);
  const keys = Array.isArray(rec.keys) ? rec.keys.filter((k): k is string => typeof k === 'string') : [];
  return PROTOTYPE_STYLE_VALUE_KEYS.filter(
    (k) => keys.includes(k) && k in locked && k in proposed && proposed[k] !== locked[k],
  );
}

export interface DefineStyleCommit {
  isError: boolean;
  style?: PrototypeStyle;
  /** Approved values the user asked to change in this message (the new values are approved). */
  userChanged?: PrototypeStyleValueKey[];
  content: string;
  summary: string;
}

/**
 * `define_style` finished: resolve the values against the approved ones (which win), and say in
 * the result which values were kept from the approved Style Tile.
 */
export function commitDefineStyle(
  args: unknown,
  locked: Partial<PrototypeStyleValues> | null,
  locale: AgentLocale,
  options: { userPrompt?: string } = {},
): DefineStyleCommit {
  const rec = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const rawCss = typeof rec.componentCss === 'string' ? rec.componentCss : '';
  const rawSample = typeof rec.sampleHtml === 'string' ? rec.sampleHtml : '';
  if (FORBIDDEN_DIALOG_RE.test(rawCss) || FORBIDDEN_DIALOG_RE.test(rawSample)) {
    const diagnostic = pickLocaleText(
      locale,
      'define_style 里不能出现 alert/confirm/prompt。',
      'define_style must not contain alert/confirm/prompt.',
    );
    return { isError: true, content: JSON.stringify({ status: 'ERROR', diagnostic }), summary: diagnostic };
  }
  const componentCss = sanitizeStyleCss(rawCss).trim();
  const sampleHtml = sanitizeStyleSampleHtml(rawSample).trim();
  if (!componentCss || !sampleHtml) {
    const diagnostic = pickLocaleText(
      locale,
      'define_style 需要 componentCss（共用组件样式）和 sampleHtml（风格样张）。',
      'define_style needs componentCss (shared component CSS) and sampleHtml (the style sample).',
    );
    return { isError: true, content: JSON.stringify({ status: 'ERROR', diagnostic }), summary: diagnostic };
  }
  // The lock stops the assistant from changing approved values on its own, not the user: values
  // the user asked for in this very message (quoted verbatim) replace the approved ones.
  const userChanged = userRequestedKeys(rec.userRequested, rec.values, locked, options.userPrompt);
  const effectiveLock = locked
    ? (Object.fromEntries(Object.entries(locked).filter(([k]) => !userChanged.includes(k as PrototypeStyleValueKey))) as Partial<PrototypeStyleValues>)
    : null;
  const resolved = resolvePrototypeStyleValues(rec.values, effectiveLock);
  const style: PrototypeStyle = {
    direction: typeof rec.direction === 'string' ? rec.direction.trim() : '',
    values: resolved.values,
    componentCss,
    sampleHtml,
    locked: resolved.locked,
  };
  const summary = resolved.locked
    ? pickLocaleText(
        locale,
        '风格样张已画好，设计值沿用用户确认过的风格样张。',
        'Style sample drawn, keeping the design values the user approved.',
      )
    : pickLocaleText(locale, '风格样张已画好，设计值由你提出。', 'Style sample drawn with the design values you proposed.');
  return {
    isError: false,
    style,
    ...(userChanged.length > 0 ? { userChanged } : {}),
    summary,
    content: JSON.stringify({
      status: 'OK',
      summary,
      values: resolved.values,
      ...(userChanged.length > 0 ? { changedAtUserRequest: userChanged } : {}),
      ...(resolved.overridden.length > 0
        ? {
            keptApprovedValues: resolved.overridden,
            note: 'These keys were locked by the approved Style Tile; your other values for them were ignored.',
          }
        : {}),
      next: 'Dispatch the planned screens with spawn_subagents; every helper receives these values, the component CSS and the samples.',
    }),
  };
}

/** A Visual Reference image the engine can resolve for a model turn. */
export interface BriefReferenceImage {
  id: string;
  name: string;
  mimeType: string;
  remoteUrl?: string;
  role?: AgentImageAttachmentRef['role'];
  textFallbackNote: string;
}

/**
 * The Visual References a Design Brief keeps — the primary and borrowed references and the
 * user's own images — as images for screen helpers, on every run (not only the turn they were
 * attached to). The user's own images live only in their browser, so they travel as notes.
 */
export function briefReferenceImages(
  brief: DesignBrief | null | undefined,
  locale: AgentLocale,
  catalog: readonly VisualReferenceItem[] = CURATED_INSPO_CATALOG,
): BriefReferenceImage[] {
  if (!brief) return [];
  const zh = locale !== 'en-US';
  const out: BriefReferenceImage[] = [];
  const primary = brief.primaryReferenceId ? catalog.find((c) => c.slug === brief.primaryReferenceId) : undefined;
  if (primary) {
    out.push({
      id: `inspo-primary-${primary.slug}`,
      name: `${primary.title} (${primary.sourceDomain})`,
      mimeType: 'image/webp',
      remoteUrl: primary.fullPageUrl || inspoFullUrl(primary.slug) || primary.heroUrl || inspoHeroUrl(primary.slug),
      role: 'primary_ref',
      textFallbackNote: zh
        ? `主参考「${primary.title}」（底色 ${primary.surfaceHex}，调色盘 ${primary.palette.join(', ')}，字体 ${primary.fonts[0] ?? ''}，圆角 ${primary.radiusPx}px）`
        : `Primary reference "${primary.title}" (surface ${primary.surfaceHex}, palette ${primary.palette.join(', ')}, font ${primary.fonts[0] ?? ''}, radius ${primary.radiusPx}px)`,
    });
  } else if (brief.primaryReferenceTitle) {
    out.push({
      id: 'brief-primary',
      name: brief.primaryReferenceTitle,
      mimeType: 'image/webp',
      ...(brief.primaryReferenceSourceUrl ? { remoteUrl: brief.primaryReferenceSourceUrl } : {}),
      role: 'primary_ref',
      textFallbackNote: zh ? `主参考「${brief.primaryReferenceTitle}」` : `Primary reference "${brief.primaryReferenceTitle}"`,
    });
  }
  for (const b of brief.borrowedReferences ?? []) {
    const item = catalog.find((c) => c.slug === b.referenceId);
    const title = item?.title ?? b.title ?? b.referenceId;
    const remoteUrl = item ? item.heroUrl || inspoHeroUrl(item.slug) : undefined;
    out.push({
      id: `inspo-borrowed-${b.referenceId}`,
      name: `${title} [${b.aspect}]`,
      mimeType: 'image/webp',
      ...(remoteUrl ? { remoteUrl } : {}),
      role: 'borrowed_ref',
      textFallbackNote: zh
        ? `借鉴参考「${title}」——只借鉴它的 ${b.aspect}${item ? `（底色 ${item.surfaceHex}，调色盘 ${item.palette.join(', ')}）` : ''}`
        : `Borrowed reference "${title}" — borrow only its ${b.aspect}${item ? ` (surface ${item.surfaceHex}, palette ${item.palette.join(', ')})` : ''}`,
    });
  }
  for (const ref of brief.userImageRefs ?? []) {
    out.push({
      id: ref.id,
      name: ref.name,
      mimeType: ref.mimeType,
      ...(ref.source === 'remote' && ref.remoteUrl ? { remoteUrl: ref.remoteUrl } : {}),
      ...(ref.role ? { role: ref.role } : {}),
      textFallbackNote: zh ? `用户自己的参考图「${ref.name}」` : `The user's own reference image "${ref.name}"`,
    });
  }
  return out;
}
