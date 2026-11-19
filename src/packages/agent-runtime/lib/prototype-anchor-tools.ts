import {
  PROTOTYPE_NOTE_ATTR,
  PROTOTYPE_SHELL_SKELETON_CSS,
  extractPrototypeArtboards,
  prototypeNavigationRuntimeScript,
  prototypeStyleHeadHtml,
  resolvePrototypeStyleValues,
  sanitizePrototypeNote,
  sanitizeStyleCss,
  stripInlineStyleValueOverrides,
  stripStyleValueOverrides,
  writePrototypeNote,
  type PrototypeArtboardSlice,
  type PrototypeStyle,
  type PrototypeStyleValues,
} from '../../ontology-core/index.js';
import type {
  AgentSession,
  PrototypeTargetAnchor,
  WorkspaceStore,
} from '../../workspace-store/index.js';
export { extractPrototypeArtboards, type PrototypeArtboardSlice };
import { type AgentLocale, pickLocaleText } from './locale.js';
import type { OpenAiFunctionTool } from './tools.js';

export const VALID_PROTOTYPE_SCREEN_TYPES = new Set([
  'LIST',
  'FORM',
  'DETAIL',
  'APPROVAL',
  'REPORT',
  'DASHBOARD',
  'MODAL',
  'SINGLE_FORM',
  'LIST_MAINTENANCE',
  'MASTER_DETAIL_FORM',
  'QUERY_LIST',
]);

export const VALID_PROTOTYPE_ELEMENT_TYPES = new Set([
  'INPUT',
  'SELECT',
  'DATE_PICKER',
  'DATEPICKER',
  'NUMBER',
  'TABLE',
  'BUTTON',
  'TAB',
  'BADGE',
  'VIEWER',
  'REPORT_VIEWER',
  'CONTAINER',
  'TEXTBOX',
  'TEXTAREA',
  'COMBO',
  'POPUP_SELECT',
  'CHECKBOX',
  'RADIO',
  'SWITCH',
  'TOOLBAR',
  'MENU',
  'LISTVIEW',
  'GRID',
  'TREEVIEW',
  'TREE',
  'TIMER',
  'MODAL',
  'LABEL',
  'IMAGE',
]);

const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const RAW_TEXT_TAGS = new Set(['script', 'style']);

const INTERACTIVE_CONTROL_TAGS = new Set(['button', 'input', 'select', 'textarea']);

export const FORBIDDEN_DIALOG_RE = /\b(?:window\s*\.\s*)?(?:alert|confirm|prompt)\s*\(/i;

interface HtmlSpanNode {
  tagName: string;
  attrs: Record<string, string>;
  openStart: number;
  openEnd: number;
  innerStart: number | null;
  innerEnd: number | null;
  closeEnd: number;
  parent?: HtmlSpanNode;
  children: HtmlSpanNode[];
}

function findTagEnd(html: string, startAfterTagName: number): { end: number; selfClosing: boolean } {
  let i = startAfterTagName;
  let quote: '"' | "'" | null = null;
  while (i < html.length) {
    const ch = html[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '>') {
      let back = i - 1;
      while (back >= startAfterTagName && /\s/.test(html[back]!)) back -= 1;
      const selfClosing = html[back] === '/';
      return { end: i + 1, selfClosing };
    }
    i += 1;
  }
  return { end: html.length, selfClosing: false };
}

function parseAttributes(attrRegion: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe =
    /([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(attrRegion)) !== null) {
    const name = match[1]!.toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = val;
  }
  return attrs;
}

function parseHtmlSpanTree(html: string): { roots: HtmlSpanNode[]; allNodes: HtmlSpanNode[] } {
  const roots: HtmlSpanNode[] = [];
  const allNodes: HtmlSpanNode[] = [];
  const stack: HtmlSpanNode[] = [];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;

    // HTML comment <!-- ... -->
    if (html.startsWith('<!--', lt)) {
      const commentEnd = html.indexOf('-->', lt + 4);
      i = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    // Declaration / doctype <! ... > or processing instruction <? ... >
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const gt = html.indexOf('>', lt + 2);
      i = gt === -1 ? html.length : gt + 1;
      continue;
    }

    // Closing tag </tagName ...>
    if (html[lt + 1] === '/') {
      const closeMatch = /^<\/\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(lt));
      if (!closeMatch) {
        i = lt + 2;
        continue;
      }
      const closeTag = closeMatch[1]!.toLowerCase();
      const { end: closeEnd } = findTagEnd(html, lt + closeMatch[0].length);
      for (let s = stack.length - 1; s >= 0; s -= 1) {
        if (stack[s]!.tagName === closeTag) {
          for (let k = stack.length - 1; k >= s; k -= 1) {
            const popped = stack.pop()!;
            popped.innerEnd = lt;
            popped.closeEnd = k === s ? closeEnd : lt;
          }
          break;
        }
      }
      i = closeEnd;
      continue;
    }

    // Opening tag <tagName ...>
    const openMatch = /^<([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>]|$)/.exec(html.slice(lt));
    if (!openMatch) {
      i = lt + 1;
      continue;
    }

    const tagName = openMatch[1]!.toLowerCase();
    const afterName = lt + openMatch[0].length;
    const { end: openEnd, selfClosing } = findTagEnd(html, afterName);
    const rawAttrSlice = html.slice(
      afterName,
      selfClosing ? Math.max(afterName, openEnd - 2) : openEnd - 1,
    );
    const attrs = parseAttributes(rawAttrSlice);
    const parent = stack[stack.length - 1];
    const isVoid = selfClosing || VOID_HTML_TAGS.has(tagName);

    const node: HtmlSpanNode = {
      tagName,
      attrs,
      openStart: lt,
      openEnd,
      innerStart: isVoid ? null : openEnd,
      innerEnd: null,
      closeEnd: openEnd,
      ...(parent ? { parent } : {}),
      children: [],
    };

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    allNodes.push(node);

    if (isVoid) {
      i = openEnd;
      continue;
    }

    if (RAW_TEXT_TAGS.has(tagName)) {
      const closeRe = new RegExp(`<\\/\\s*${tagName}\\s*>`, 'gi');
      closeRe.lastIndex = openEnd;
      const closeHit = closeRe.exec(html);
      if (closeHit) {
        node.innerEnd = closeHit.index;
        node.closeEnd = closeHit.index + closeHit[0].length;
        i = node.closeEnd;
      } else {
        node.innerEnd = html.length;
        node.closeEnd = html.length;
        i = html.length;
      }
      continue;
    }

    stack.push(node);
    i = openEnd;
  }

  // Close any unclosed trailing tags gracefully
  while (stack.length > 0) {
    const dangling = stack.pop()!;
    dangling.innerEnd = html.length;
    dangling.closeEnd = html.length;
  }

  return { roots, allNodes };
}

function findEnclosingScreenNode(node: HtmlSpanNode): HtmlSpanNode | undefined {
  let cur: HtmlSpanNode | undefined = node;
  while (cur) {
    if (cur.attrs['data-screen-id']) return cur;
    cur = cur.parent;
  }
  return undefined;
}

interface ParsedSimpleSelector {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: { name: string; value?: string }[];
  nthOfType?: number;
  nthChild?: number;
}

function parseSimpleSelector(raw: string): ParsedSimpleSelector {
  let rest = raw.trim();
  const parsed: ParsedSimpleSelector = { classes: [], attrs: [] };

  const nthTypeMatch = /:nth-of-type\(\s*(\d+)\s*\)/i.exec(rest);
  if (nthTypeMatch) {
    parsed.nthOfType = Number.parseInt(nthTypeMatch[1]!, 10);
    rest = rest.replace(nthTypeMatch[0], '');
  }
  const nthChildMatch = /:nth-child\(\s*(\d+)\s*\)/i.exec(rest);
  if (nthChildMatch) {
    parsed.nthChild = Number.parseInt(nthChildMatch[1]!, 10);
    rest = rest.replace(nthChildMatch[0], '');
  }

  const attrRe = /\[\s*([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\s*\]/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRe.exec(rest)) !== null) {
    const val = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4];
    parsed.attrs.push({
      name: attrMatch[1]!.toLowerCase(),
      ...(val !== undefined ? { value: val } : {}),
    });
  }
  rest = rest.replace(attrRe, '');

  const idMatch = /#([A-Za-z0-9_-]+)/.exec(rest);
  if (idMatch) {
    parsed.id = idMatch[1]!;
    rest = rest.replace(idMatch[0], '');
  }

  const classRe = /\.([A-Za-z0-9_-]+)/g;
  let clsMatch: RegExpExecArray | null;
  while ((clsMatch = classRe.exec(rest)) !== null) {
    parsed.classes.push(clsMatch[1]!);
  }
  rest = rest.replace(classRe, '').trim();

  if (rest && rest !== '*') {
    parsed.tag = rest.toLowerCase();
  }
  return parsed;
}

function matchesSimpleSelector(node: HtmlSpanNode, sel: ParsedSimpleSelector): boolean {
  if (sel.tag && node.tagName !== sel.tag) return false;
  if (sel.id && node.attrs.id !== sel.id) return false;
  if (sel.classes.length > 0) {
    const nodeClasses = new Set((node.attrs.class || '').split(/\s+/).filter(Boolean));
    for (const c of sel.classes) {
      if (!nodeClasses.has(c)) return false;
    }
  }
  for (const attr of sel.attrs) {
    if (!(attr.name in node.attrs)) return false;
    if (attr.value !== undefined && node.attrs[attr.name] !== attr.value) return false;
  }
  if (sel.nthOfType !== undefined && node.parent) {
    const sameTypeSiblings = node.parent.children.filter((c) => c.tagName === node.tagName);
    if (sameTypeSiblings.indexOf(node) + 1 !== sel.nthOfType) return false;
  }
  if (sel.nthChild !== undefined && node.parent) {
    if (node.parent.children.indexOf(node) + 1 !== sel.nthChild) return false;
  }
  return true;
}

function tokenizeCssSelector(selector: string): { combinator: 'DESCENDANT' | 'CHILD'; part: ParsedSimpleSelector }[] {
  const steps: { combinator: 'DESCENDANT' | 'CHILD'; part: ParsedSimpleSelector }[] = [];
  let i = 0;
  const s = selector.trim();
  let pendingCombinator: 'DESCENDANT' | 'CHILD' = 'DESCENDANT';

  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i += 1;
    if (i >= s.length) break;
    if (s[i] === '>') {
      pendingCombinator = 'CHILD';
      i += 1;
      while (i < s.length && /\s/.test(s[i]!)) i += 1;
    }
    const start = i;
    let bracketDepth = 0;
    let parenDepth = 0;
    let quote: '"' | "'" | null = null;
    while (i < s.length) {
      const ch = s[i]!;
      if (quote) {
        if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        i += 1;
        continue;
      }
      if (ch === '[') bracketDepth += 1;
      else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
      else if (ch === '(') parenDepth += 1;
      else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
      else if (bracketDepth === 0 && parenDepth === 0 && (/\s/.test(ch) || ch === '>')) {
        break;
      }
      i += 1;
    }
    const token = s.slice(start, i).trim();
    if (token) {
      steps.push({ combinator: pendingCombinator, part: parseSimpleSelector(token) });
      pendingCombinator = 'DESCENDANT';
    }
  }
  return steps;
}

function findNodeBySelector(allNodes: HtmlSpanNode[], selector: string): HtmlSpanNode | undefined {
  const firstBranch = selector.split(',')[0]?.trim() || '';
  if (!firstBranch) return undefined;
  const steps = tokenizeCssSelector(firstBranch);
  if (steps.length === 0) return undefined;

  for (const candidate of allNodes) {
    const lastStep = steps[steps.length - 1]!;
    if (!matchesSimpleSelector(candidate, lastStep.part)) continue;

    let current: HtmlSpanNode | undefined = candidate;
    let ok = true;
    for (let idx = steps.length - 2; idx >= 0; idx -= 1) {
      const requiredCombinator = steps[idx + 1]!.combinator;
      const targetPart = steps[idx]!.part;
      if (requiredCombinator === 'CHILD') {
        if (!current?.parent || !matchesSimpleSelector(current.parent, targetPart)) {
          ok = false;
          break;
        }
        current = current.parent;
      } else {
        let anc: HtmlSpanNode | undefined = current?.parent;
        while (anc && !matchesSimpleSelector(anc, targetPart)) {
          anc = anc.parent;
        }
        if (!anc) {
          ok = false;
          break;
        }
        current = anc;
      }
    }
    if (ok) return candidate;
  }
  return undefined;
}

function resolveTargetNode(
  allNodes: HtmlSpanNode[],
  target: { elementId?: string; screenId?: string; cssSelector?: string },
): HtmlSpanNode | undefined {
  if (target.elementId?.trim()) {
    const elId = target.elementId.trim();
    const byEl = allNodes.find((n) => n.attrs['data-element-id'] === elId);
    if (byEl) return byEl;
  }
  if (target.screenId?.trim()) {
    const scrId = target.screenId.trim();
    const byScr = allNodes.find((n) => n.attrs['data-screen-id'] === scrId);
    if (byScr) return byScr;
  }
  if (target.cssSelector?.trim()) {
    return findNodeBySelector(allNodes, target.cssSelector.trim());
  }
  return undefined;
}

function toTargetAnchor(
  node: HtmlSpanNode | undefined,
  fallback: { elementId?: string; screenId?: string; cssSelector?: string },
): PrototypeTargetAnchor {
  if (!node) {
    return {
      ...(fallback.screenId ? { screenId: fallback.screenId } : {}),
      ...(fallback.elementId ? { elementId: fallback.elementId } : {}),
      ...(fallback.cssSelector ? { cssSelector: fallback.cssSelector } : {}),
    };
  }
  const enclosingScreen = findEnclosingScreenNode(node);
  const screenId = node.attrs['data-screen-id'] || enclosingScreen?.attrs['data-screen-id'] || fallback.screenId;
  const elementId = node.attrs['data-element-id'] || fallback.elementId;
  const label =
    node.attrs['data-element-label'] ||
    node.attrs['data-screen-name'] ||
    undefined;
  return {
    ...(screenId ? { screenId } : {}),
    ...(elementId ? { elementId } : {}),
    ...(fallback.cssSelector ? { cssSelector: fallback.cssSelector } : {}),
    ...(label ? { label } : {}),
  };
}

export interface PrototypeScreenAnchorInfo {
  screenId: string;
  screenName: string;
  screenType: string;
  route?: string;
  elementCount: number;
}

export interface PrototypeElementAnchorInfo {
  elementId: string;
  screenId?: string;
  tagName: string;
  elementType: string;
  label: string;
  note?: string;
  binding?: string;
  eventId?: string;
  navigateTo?: string;
}

export interface PrototypeAnchorOverview {
  screens: PrototypeScreenAnchorInfo[];
  elements: PrototypeElementAnchorInfo[];
}

export function listPrototypeAnchors(html: string): PrototypeAnchorOverview {
  const { allNodes } = parseHtmlSpanTree(html);
  const screenCounts = new Map<string, number>();
  const elements: PrototypeElementAnchorInfo[] = [];

  for (const node of allNodes) {
    const elementId = node.attrs['data-element-id'];
    if (!elementId) continue;
    const screenNode = findEnclosingScreenNode(node);
    const screenId = screenNode?.attrs['data-screen-id'];
    if (screenId) {
      screenCounts.set(screenId, (screenCounts.get(screenId) ?? 0) + 1);
    }
    const note = sanitizePrototypeNote(node.attrs[PROTOTYPE_NOTE_ATTR]);
    elements.push({
      elementId,
      ...(screenId ? { screenId } : {}),
      tagName: node.tagName,
      elementType: (node.attrs['data-element-type'] || 'INPUT').toUpperCase(),
      label: node.attrs['data-element-label'] || elementId,
      ...(note ? { note } : {}),
      ...(node.attrs['data-binding'] ? { binding: node.attrs['data-binding'] } : {}),
      ...(node.attrs['data-event-id'] ? { eventId: node.attrs['data-event-id'] } : {}),
      ...(node.attrs['data-navigate-to'] ? { navigateTo: node.attrs['data-navigate-to'] } : {}),
    });
  }

  const screens: PrototypeScreenAnchorInfo[] = [];
  for (const node of allNodes) {
    const screenId = node.attrs['data-screen-id'];
    if (!screenId) continue;
    screens.push({
      screenId,
      screenName: node.attrs['data-screen-name'] || screenId,
      screenType: (node.attrs['data-screen-type'] || 'LIST').toUpperCase(),
      ...(node.attrs['data-route'] ? { route: node.attrs['data-route'] } : {}),
      elementCount: screenCounts.get(screenId) ?? 0,
    });
  }

  return { screens, elements };
}

export interface ReadPrototypeAnchorInput {
  screenId?: string;
  elementId?: string;
  cssSelector?: string;
  locale?: AgentLocale;
}

export interface ReadPrototypeAnchorResult {
  isError: boolean;
  fragment: string;
  targetAnchor?: PrototypeTargetAnchor;
  contextSummary?: {
    screenId?: string;
    screenName?: string;
    parentTag?: string;
    siblingElementIds: string[];
  };
  diagnostic?: string;
}

export function readPrototypeAnchor(
  html: string,
  input: ReadPrototypeAnchorInput,
): ReadPrototypeAnchorResult {
  const locale = input.locale ?? 'zh-CN';
  const { allNodes } = parseHtmlSpanTree(html);
  const node = resolveTargetNode(allNodes, input);

  if (!node) {
    const overview = listPrototypeAnchors(html);
    const availableScreens = overview.screens.map((s) => s.screenId).join(', ') || '(none)';
    const availableElements =
      overview.elements.slice(0, 24).map((e) => e.elementId).join(', ') || '(none)';
    return {
      isError: true,
      fragment: '',
      targetAnchor: toTargetAnchor(undefined, input),
      diagnostic: pickLocaleText(
        locale,
        `未找到目标锚点（elementId=${input.elementId ?? '-'}, screenId=${input.screenId ?? '-'}, cssSelector=${input.cssSelector ?? '-'}）。可用屏幕：[${availableScreens}]；可用元素：[${availableElements}]。`,
        `Target anchor not found (elementId=${input.elementId ?? '-'}, screenId=${input.screenId ?? '-'}, cssSelector=${input.cssSelector ?? '-'}). Available screens: [${availableScreens}]; available elements: [${availableElements}].`,
      ),
    };
  }

  const fragment = html.slice(node.openStart, node.closeEnd);
  const screenNode = findEnclosingScreenNode(node);
  const siblingElementIds = (node.parent?.children ?? [])
    .filter((sib) => sib !== node && Boolean(sib.attrs['data-element-id']))
    .map((sib) => sib.attrs['data-element-id']!);

  return {
    isError: false,
    fragment,
    targetAnchor: toTargetAnchor(node, input),
    contextSummary: {
      ...(screenNode?.attrs['data-screen-id']
        ? { screenId: screenNode.attrs['data-screen-id'] }
        : {}),
      ...(screenNode?.attrs['data-screen-name']
        ? { screenName: screenNode.attrs['data-screen-name'] }
        : {}),
      ...(node.parent ? { parentTag: node.parent.tagName } : {}),
      siblingElementIds,
    },
  };
}

export type PrototypeAnchorEditOperation =
  | 'replace_element'
  | 'insert_after_element'
  | 'append_to_screen'
  | 'update_attributes';

export interface EditPrototypeAnchorInput {
  screenId?: string;
  elementId?: string;
  operation: PrototypeAnchorEditOperation;
  /** Optional Prototype Note (`data-note`) in business language; ordered before `htmlFragment`. */
  note?: string;
  cssSelector?: string;
  attributes?: Record<string, string | null>;
  allowRemoveAnchors?: string[];
  htmlFragment?: string;
  locale?: AgentLocale;
}

export interface PrototypeHtmlMutationResult {
  isError: boolean;
  nextHtml: string;
  targetAnchor?: PrototypeTargetAnchor;
  summary: string;
  diagnostic?: string;
}

interface AnchorInventory {
  screenIds: Set<string>;
  elementIds: Set<string>;
  bindings: Set<string>;
  eventIds: Set<string>;
  duplicateScreenIds: string[];
  duplicateElementIds: string[];
}

function collectAnchorInventory(nodes: HtmlSpanNode[]): AnchorInventory {
  const screenIds = new Set<string>();
  const elementIds = new Set<string>();
  const bindings = new Set<string>();
  const eventIds = new Set<string>();
  const duplicateScreenIds: string[] = [];
  const duplicateElementIds: string[] = [];

  for (const node of nodes) {
    const sId = node.attrs['data-screen-id']?.trim();
    if (sId) {
      if (screenIds.has(sId)) duplicateScreenIds.push(sId);
      screenIds.add(sId);
    }
    const eId = node.attrs['data-element-id']?.trim();
    if (eId) {
      if (elementIds.has(eId)) duplicateElementIds.push(eId);
      elementIds.add(eId);
    }
    const bind = node.attrs['data-binding']?.trim();
    if (bind) bindings.add(bind);
    const evId = node.attrs['data-event-id']?.trim();
    if (evId) eventIds.add(evId);
  }

  return {
    screenIds,
    elementIds,
    bindings,
    eventIds,
    duplicateScreenIds,
    duplicateElementIds,
  };
}

function validateInteractiveControlNodes(
  nodes: HtmlSpanNode[],
  rawHtml: string,
  exemptOpenTagSet: Set<string>,
  locale: AgentLocale,
): string[] {
  const issues: string[] = [];
  for (const node of nodes) {
    if (!INTERACTIVE_CONTROL_TAGS.has(node.tagName)) continue;
    if (node.tagName === 'input' && (node.attrs.type || '').toLowerCase() === 'hidden') {
      continue;
    }
    const rawOpenTag = rawHtml.slice(node.openStart, node.openEnd).trim();
    if (exemptOpenTagSet.has(rawOpenTag)) {
      continue;
    }

    const elId = node.attrs['data-element-id']?.trim();
    const rawType = node.attrs['data-element-type']?.trim();
    if (!elId) {
      issues.push(
        pickLocaleText(
          locale,
          `新增交互控件 <${node.tagName}> 缺少必填语义锚点 data-element-id（片段：${rawOpenTag.slice(0, 80)}）`,
          `Interactive control <${node.tagName}> is missing required data-element-id (${rawOpenTag.slice(0, 80)})`,
        ),
      );
      continue;
    }
    if (!rawType) {
      issues.push(
        pickLocaleText(
          locale,
          `控件 <${node.tagName} data-element-id="${elId}"> 缺少必填 data-element-type（如 BUTTON / INPUT / SELECT / TEXTAREA）`,
          `Control <${node.tagName} data-element-id="${elId}"> is missing required data-element-type (e.g. BUTTON, INPUT, SELECT, TEXTAREA)`,
        ),
      );
      continue;
    }
    if (!VALID_PROTOTYPE_ELEMENT_TYPES.has(rawType.toUpperCase())) {
      issues.push(
        pickLocaleText(
          locale,
          `控件 <${node.tagName} data-element-id="${elId}"> 的 data-element-type="${rawType}" 非法；合法值示例：BUTTON, INPUT, SELECT, TEXTAREA, DATE_PICKER, NUMBER, CHECKBOX, SWITCH`,
          `Control <${node.tagName} data-element-id="${elId}"> has invalid data-element-type="${rawType}"; use BUTTON, INPUT, SELECT, TEXTAREA, DATE_PICKER, NUMBER, CHECKBOX, or SWITCH`,
        ),
      );
    }
  }
  return issues;
}

function validateAnchorPreservation(params: {
  beforeNodes: HtmlSpanNode[];
  afterNodes: HtmlSpanNode[];
  allowRemoveAnchors?: string[];
  locale: AgentLocale;
}): string[] {
  const allowed = new Set((params.allowRemoveAnchors ?? []).map((s) => s.trim()).filter(Boolean));
  const beforeInv = collectAnchorInventory(params.beforeNodes);
  const afterInv = collectAnchorInventory(params.afterNodes);
  const issues: string[] = [];

  for (const sId of beforeInv.screenIds) {
    if (!afterInv.screenIds.has(sId) && !allowed.has(sId)) {
      issues.push(
        pickLocaleText(
          params.locale,
          `丢失了既有屏幕锚点 data-screen-id="${sId}"`,
          `Dropped existing screen anchor data-screen-id="${sId}"`,
        ),
      );
    }
  }
  for (const eId of beforeInv.elementIds) {
    if (!afterInv.elementIds.has(eId) && !allowed.has(eId)) {
      issues.push(
        pickLocaleText(
          params.locale,
          `丢失了既有元素锚点 data-element-id="${eId}"`,
          `Dropped existing element anchor data-element-id="${eId}"`,
        ),
      );
    }
  }
  for (const bind of beforeInv.bindings) {
    if (!afterInv.bindings.has(bind) && !allowed.has(bind)) {
      issues.push(
        pickLocaleText(
          params.locale,
          `丢失了既有数据绑定锚点 data-binding="${bind}"`,
          `Dropped existing data-binding="${bind}"`,
        ),
      );
    }
  }
  for (const evId of beforeInv.eventIds) {
    if (!afterInv.eventIds.has(evId) && !allowed.has(evId)) {
      issues.push(
        pickLocaleText(
          params.locale,
          `丢失了既有事件锚点 data-event-id="${evId}"`,
          `Dropped existing event anchor data-event-id="${evId}"`,
        ),
      );
    }
  }

  for (const dupScr of afterInv.duplicateScreenIds) {
    if (!beforeInv.duplicateScreenIds.includes(dupScr)) {
      issues.push(
        pickLocaleText(
          params.locale,
          `产生了重复的 data-screen-id="${dupScr}"`,
          `Introduced duplicate data-screen-id="${dupScr}"`,
        ),
      );
    }
  }
  for (const dupEl of afterInv.duplicateElementIds) {
    if (!beforeInv.duplicateElementIds.includes(dupEl)) {
      issues.push(
        pickLocaleText(
          params.locale,
          `产生了重复的 data-element-id="${dupEl}"（新增控件请使用唯一 ID）`,
          `Introduced duplicate data-element-id="${dupEl}" (new controls must use unique IDs)`,
        ),
      );
    }
  }

  return issues;
}

function escapeAttrValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function rewriteOpeningTagAttributes(
  openTagHtml: string,
  updates: Record<string, string | null>,
): string {
  let result = openTagHtml;
  for (const [rawKey, rawVal] of Object.entries(updates)) {
    const key = rawKey.trim();
    if (!key) continue;
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingRe = new RegExp(
      `(\\s+)${escapedKey}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>` + '`' + `]+))?`,
      'i',
    );
    if (rawVal === null) {
      result = result.replace(existingRe, '');
    } else if (existingRe.test(result)) {
      result = result.replace(existingRe, `$1${key}="${escapeAttrValue(rawVal)}"`);
    } else {
      const insertIdx = result.endsWith('/>') ? result.length - 2 : result.length - 1;
      result = `${result.slice(0, insertIdx)} ${key}="${escapeAttrValue(rawVal)}"${result.slice(insertIdx)}`;
    }
  }
  return result;
}

/**
 * Removes unscoped `<style>` / `<link>` tags and `--proto-*` inline style overrides from a screen
 * or anchor HTML fragment (shared across `upsert_prototype_screen`, `edit_prototype_anchor`, and
 * live partial screen streaming).
 */
export function sanitizePrototypeScreenFragment(html: string): string {
  return stripInlineStyleValueOverrides(
    html
      .replace(/<style\b[\s\S]*?(?:<\/style\s*>|$)/gi, '')
      .replace(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>?/gi, ''),
  );
}

/**
 * Checks that every interactive control inside `screenId` carries valid semantic anchors, and
 * marks a drawn `queued` screen stub as `ready` (used when a helper edits via `edit_prototype_anchor`).
 */
export function validatePrototypeScreenControls(
  html: string,
  screenId: string,
  locale: AgentLocale,
): { ok: true; nextHtml: string } | { ok: false; diagnostic: string } {
  const tree = parseHtmlSpanTree(html);
  const scrNode = tree.allNodes.find((n) => n.attrs['data-screen-id'] === screenId);
  if (!scrNode) return { ok: true, nextHtml: html };
  const sectionHtml = html.slice(scrNode.openStart, scrNode.closeEnd);
  const sectionNodes = parseHtmlSpanTree(sectionHtml).allNodes;
  const issues = validateInteractiveControlNodes(sectionNodes, sectionHtml, new Set(), locale);
  if (issues.length > 0) {
    return { ok: false, diagnostic: issues.join('；') };
  }
  const inner = scrNode.innerEnd !== null ? html.slice(scrNode.openEnd, scrNode.innerEnd).trim() : '';
  if (inner && (scrNode.attrs['data-screen-status'] ?? '').toLowerCase() === 'queued') {
    const updatedOpen = rewriteOpeningTagAttributes(html.slice(scrNode.openStart, scrNode.openEnd), {
      'data-screen-status': 'ready',
    });
    return { ok: true, nextHtml: `${html.slice(0, scrNode.openStart)}${updatedOpen}${html.slice(scrNode.openEnd)}` };
  }
  return { ok: true, nextHtml: html };
}

export function editPrototypeAnchor(
  html: string,
  input: EditPrototypeAnchorInput,
): PrototypeHtmlMutationResult {
  const locale = input.locale ?? 'zh-CN';
  const beforeTree = parseHtmlSpanTree(html);
  const targetNode = resolveTargetNode(beforeTree.allNodes, input);

  if (!targetNode) {
    const overview = listPrototypeAnchors(html);
    return {
      isError: true,
      nextHtml: html,
      targetAnchor: toTargetAnchor(undefined, input),
      summary: pickLocaleText(locale, '未找到目标锚点', 'Target anchor not found'),
      diagnostic: pickLocaleText(
        locale,
        `未找到目标锚点（elementId=${input.elementId ?? '-'}, screenId=${input.screenId ?? '-'}, cssSelector=${input.cssSelector ?? '-'}）。可用屏幕：[${overview.screens.map((s) => s.screenId).join(', ')}]，可用元素：[${overview.elements.slice(0, 20).map((e) => e.elementId).join(', ')}]。`,
        `Target anchor not found (elementId=${input.elementId ?? '-'}, screenId=${input.screenId ?? '-'}, cssSelector=${input.cssSelector ?? '-'}). Available screens: [${overview.screens.map((s) => s.screenId).join(', ')}], available elements: [${overview.elements.slice(0, 20).map((e) => e.elementId).join(', ')}].`,
      ),
    };
  }

  const targetAnchor = toTargetAnchor(targetNode, input);
  const rawAnchorFragment = (input.htmlFragment ?? '').trim();

  if (rawAnchorFragment && FORBIDDEN_DIALOG_RE.test(rawAnchorFragment)) {
    return {
      isError: true,
      nextHtml: html,
      targetAnchor,
      summary: pickLocaleText(locale, '禁止使用浏览器阻塞弹窗', 'Blocking browser dialogs are forbidden'),
      diagnostic: pickLocaleText(
        locale,
        '检测到 window.alert / confirm / prompt 调用，违反工作台无阻塞交互契约；请改用内联提示条、状态徽标或非阻塞抽屉/模态框后重试。',
        'Detected window.alert / confirm / prompt, which is forbidden. Use inline banners, status badges, or non-blocking modals/drawers and retry.',
      ),
    };
  }
  const cleanNoteInput = input.note !== undefined ? sanitizePrototypeNote(input.note) : undefined;
  let fragment = rawAnchorFragment ? sanitizePrototypeScreenFragment(rawAnchorFragment).trim() : '';
  if (fragment && cleanNoteInput !== undefined && input.operation !== 'update_attributes') {
    const rootNode = parseHtmlSpanTree(fragment).roots[0];
    const rootElId = rootNode?.attrs['data-element-id']?.trim();
    if (rootElId && !rootNode?.attrs[PROTOTYPE_NOTE_ATTR]?.trim()) {
      fragment = writePrototypeNote(fragment, { elementId: rootElId }, cleanNoteInput || null);
    }
  }

  if (input.attributes) {
    for (const val of Object.values(input.attributes)) {
      if (typeof val === 'string' && FORBIDDEN_DIALOG_RE.test(val)) {
        return {
          isError: true,
          nextHtml: html,
          targetAnchor,
          summary: pickLocaleText(locale, '禁止使用浏览器阻塞弹窗', 'Blocking browser dialogs are forbidden'),
          diagnostic: pickLocaleText(
            locale,
            '属性值中检测到 window.alert / confirm / prompt 调用；请改用内联状态反馈后重试。',
            'Attribute value contains window.alert / confirm / prompt; replace with inline state feedback and retry.',
          ),
        };
      }
    }
  }

  const exemptOpenTags = new Set<string>();
  const collectSubtreeOpenTags = (n: HtmlSpanNode) => {
    exemptOpenTags.add(html.slice(n.openStart, n.openEnd).trim());
    for (const child of n.children) collectSubtreeOpenTags(child);
  };
  collectSubtreeOpenTags(targetNode);

  let candidateHtml = html;
  let fragmentNodesToCheck: HtmlSpanNode[] = [];

  if (input.operation === 'replace_element') {
    if (!fragment) {
      return {
        isError: true,
        nextHtml: html,
        targetAnchor,
        summary: pickLocaleText(locale, '缺少 htmlFragment', 'Missing htmlFragment'),
        diagnostic: pickLocaleText(
          locale,
          'replace_element 操作必须提供非空的 htmlFragment。',
          'replace_element requires a non-empty htmlFragment.',
        ),
      };
    }
    fragmentNodesToCheck = parseHtmlSpanTree(fragment).allNodes;
    const controlIssues = validateInteractiveControlNodes(
      fragmentNodesToCheck,
      fragment,
      exemptOpenTags,
      locale,
    );
    if (controlIssues.length > 0) {
      return {
        isError: true,
        nextHtml: html,
        targetAnchor,
        summary: controlIssues[0]!,
        diagnostic: controlIssues.join('；'),
      };
    }
    candidateHtml = `${html.slice(0, targetNode.openStart)}${fragment}${html.slice(targetNode.closeEnd)}`;
  } else if (input.operation === 'insert_after_element') {
    if (!fragment) {
      return {
        isError: true,
        nextHtml: html,
        targetAnchor,
        summary: pickLocaleText(locale, '缺少 htmlFragment', 'Missing htmlFragment'),
        diagnostic: pickLocaleText(
          locale,
          'insert_after_element 操作必须提供非空的 htmlFragment。',
          'insert_after_element requires a non-empty htmlFragment.',
        ),
      };
    }
    fragmentNodesToCheck = parseHtmlSpanTree(fragment).allNodes;
    const controlIssues = validateInteractiveControlNodes(
      fragmentNodesToCheck,
      fragment,
      new Set(),
      locale,
    );
    if (controlIssues.length > 0) {
      return {
        isError: true,
        nextHtml: html,
        targetAnchor,
        summary: controlIssues[0]!,
        diagnostic: controlIssues.join('；'),
      };
    }
    candidateHtml = `${html.slice(0, targetNode.closeEnd)}\n${fragment}${html.slice(targetNode.closeEnd)}`;
  } else if (input.operation === 'append_to_screen') {
    if (!fragment) {
      return {
        isError: true,
        nextHtml: html,
        targetAnchor,
        summary: pickLocaleText(locale, '缺少 htmlFragment', 'Missing htmlFragment'),
        diagnostic: pickLocaleText(
          locale,
          'append_to_screen 操作必须提供非空的 htmlFragment。',
          'append_to_screen requires a non-empty htmlFragment.',
        ),
      };
    }
    const screenNode = targetNode.attrs['data-screen-id']
      ? targetNode
      : findEnclosingScreenNode(targetNode) ?? targetNode;
    if (screenNode.innerEnd === null) {
      return {
        isError: true,
        nextHtml: html,
        targetAnchor,
        summary: pickLocaleText(locale, '目标屏幕不是闭合容器', 'Target screen is not a container element'),
        diagnostic: pickLocaleText(
          locale,
          'append_to_screen 需要指向具备闭合标签的屏幕容器（如 <section data-screen-id="...">...</section>）。',
          'append_to_screen must target a paired container element such as <section data-screen-id="...">...</section>.',
        ),
      };
    }
    fragmentNodesToCheck = parseHtmlSpanTree(fragment).allNodes;
    const controlIssues = validateInteractiveControlNodes(
      fragmentNodesToCheck,
      fragment,
      new Set(),
      locale,
    );
    if (controlIssues.length > 0) {
      return {
        isError: true,
        nextHtml: html,
        targetAnchor: toTargetAnchor(screenNode, input),
        summary: controlIssues[0]!,
        diagnostic: controlIssues.join('；'),
      };
    }
    candidateHtml = `${html.slice(0, screenNode.innerEnd)}\n  ${fragment}\n${html.slice(screenNode.innerEnd)}`;
  } else if (input.operation === 'update_attributes') {
    let updates: Record<string, string | null> | undefined = input.attributes
      ? { ...input.attributes }
      : undefined;
    if ((!updates || Object.keys(updates).length === 0) && fragment) {
      const parsedFrag = parseHtmlSpanTree(fragment).roots[0];
      if (parsedFrag) {
        updates = { ...parsedFrag.attrs };
      }
    }
    if (cleanNoteInput !== undefined) {
      updates = { ...(updates ?? {}), [PROTOTYPE_NOTE_ATTR]: cleanNoteInput || null };
    }
    if (!updates || Object.keys(updates).length === 0) {
      return {
        isError: true,
        nextHtml: html,
        targetAnchor,
        summary: pickLocaleText(locale, '缺少待更新属性', 'Missing attributes to update'),
        diagnostic: pickLocaleText(
          locale,
          'update_attributes 操作必须提供 attributes 字典（如 {"class": "...", "data-element-label": "..."}）。',
          'update_attributes requires a non-empty attributes object.',
        ),
      };
    }
    const sanitizedUpdates: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (k.toLowerCase() === 'style' && typeof v === 'string') {
        const cleaned = stripStyleValueOverrides(sanitizeStyleCss(v)).trim();
        sanitizedUpdates[k] = cleaned || null;
      } else {
        sanitizedUpdates[k] = v;
      }
    }
    const origOpenTag = html.slice(targetNode.openStart, targetNode.openEnd);
    const updatedOpenTag = rewriteOpeningTagAttributes(origOpenTag, sanitizedUpdates);
    const reparsedOpen = parseHtmlSpanTree(updatedOpenTag).allNodes;
    const controlIssues = validateInteractiveControlNodes(
      reparsedOpen,
      updatedOpenTag,
      new Set(),
      locale,
    );
    if (controlIssues.length > 0) {
      return {
        isError: true,
        nextHtml: html,
        targetAnchor,
        summary: controlIssues[0]!,
        diagnostic: controlIssues.join('；'),
      };
    }
    candidateHtml = `${html.slice(0, targetNode.openStart)}${updatedOpenTag}${html.slice(targetNode.openEnd)}`;
  } else {
    return {
      isError: true,
      nextHtml: html,
      targetAnchor,
      summary: pickLocaleText(locale, `未知局部编辑操作：${String(input.operation)}`, `Unknown operation: ${String(input.operation)}`),
      diagnostic: pickLocaleText(
        locale,
        'operation 仅支持 replace_element | insert_after_element | append_to_screen | update_attributes。',
        'operation must be replace_element | insert_after_element | append_to_screen | update_attributes.',
      ),
    };
  }

  const afterTree = parseHtmlSpanTree(candidateHtml);
  const preservationIssues = validateAnchorPreservation({
    beforeNodes: beforeTree.allNodes,
    afterNodes: afterTree.allNodes,
    ...(input.allowRemoveAnchors ? { allowRemoveAnchors: input.allowRemoveAnchors } : {}),
    locale,
  });

  if (preservationIssues.length > 0) {
    return {
      isError: true,
      nextHtml: html,
      targetAnchor,
      summary: preservationIssues[0]!,
      diagnostic: pickLocaleText(
        locale,
        `语义锚点一致性校验未通过：${preservationIssues.join('；')}。请保留所有既有 data-screen-id / data-element-id / data-binding / data-event-id 锚点后重试。`,
        `Semantic anchor validation failed: ${preservationIssues.join('; ')}. Preserve all existing data-screen-id, data-element-id, data-binding, and data-event-id anchors and retry.`,
      ),
    };
  }

  const anchorBadge = targetAnchor.elementId || targetAnchor.screenId || targetAnchor.cssSelector || 'anchor';
  return {
    isError: false,
    nextHtml: candidateHtml,
    targetAnchor,
    summary: pickLocaleText(
      locale,
      `已完成锚点 ${anchorBadge} 的局部精修（${input.operation}）`,
      `Applied anchored edit (${input.operation}) on ${anchorBadge}`,
    ),
  };
}

export function rewritePrototypePage(
  beforeHtml: string,
  nextHtmlRaw: string,
  options?: { allowAnchorReset?: boolean; locale?: AgentLocale },
): PrototypeHtmlMutationResult {
  const locale = options?.locale ?? 'zh-CN';
  const cleaned = nextHtmlRaw
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!cleaned) {
    return {
      isError: true,
      nextHtml: beforeHtml,
      summary: pickLocaleText(locale, '整页 HTML 为空', 'Full-page HTML is empty'),
      diagnostic: pickLocaleText(
        locale,
        'rewrite_prototype_page 需要提供完整的 HTML5 原型文档。',
        'rewrite_prototype_page requires a non-empty HTML5 prototype document.',
      ),
    };
  }

  if (FORBIDDEN_DIALOG_RE.test(cleaned)) {
    return {
      isError: true,
      nextHtml: beforeHtml,
      summary: pickLocaleText(locale, '禁止使用浏览器阻塞弹窗', 'Blocking browser dialogs are forbidden'),
      diagnostic: pickLocaleText(
        locale,
        '整页 HTML 中检测到 window.alert / confirm / prompt 调用；请改用内联反馈后重试。',
        'Full-page HTML contains window.alert / confirm / prompt; replace with non-blocking UI feedback and retry.',
      ),
    };
  }

  const beforeTree = parseHtmlSpanTree(beforeHtml);
  const afterTree = parseHtmlSpanTree(cleaned);
  const afterInv = collectAnchorInventory(afterTree.allNodes);

  if (afterInv.screenIds.size === 0) {
    return {
      isError: true,
      nextHtml: beforeHtml,
      summary: pickLocaleText(locale, '缺少屏幕锚点 data-screen-id', 'Missing data-screen-id screen anchors'),
      diagnostic: pickLocaleText(
        locale,
        '整页原型必须至少包含一个带 data-screen-id 的业务屏幕（如 <section data-screen-id="SCR-...">）。',
        'Prototype HTML must include at least one screen container with data-screen-id.',
      ),
    };
  }

  const exemptOpenTags = new Set(
    beforeTree.allNodes.map((n) => beforeHtml.slice(n.openStart, n.openEnd).trim()),
  );
  const screenControlNodes = afterTree.allNodes.filter((n) => Boolean(findEnclosingScreenNode(n)));
  const controlIssues = validateInteractiveControlNodes(
    screenControlNodes,
    cleaned,
    exemptOpenTags,
    locale,
  );
  if (controlIssues.length > 0) {
    return {
      isError: true,
      nextHtml: beforeHtml,
      summary: controlIssues[0]!,
      diagnostic: controlIssues.join('；'),
    };
  }

  if (!options?.allowAnchorReset && beforeHtml.trim().length > 0) {
    const preservationIssues = validateAnchorPreservation({
      beforeNodes: beforeTree.allNodes,
      afterNodes: afterTree.allNodes,
      locale,
    });
    if (preservationIssues.length > 0) {
      return {
        isError: true,
        nextHtml: beforeHtml,
        summary: preservationIssues[0]!,
        diagnostic: pickLocaleText(
          locale,
          `整页重写的语义锚点校验未通过：${preservationIssues.join('；')}。整体换风格时仍须保留既有 data-screen-id / data-element-id / data-binding / data-event-id 锚点。`,
          `Full-page rewrite anchor validation failed: ${preservationIssues.join('; ')}. Restyling must preserve existing semantic anchors.`,
        ),
      };
    }
  }

  return {
    isError: false,
    nextHtml: cleaned,
    targetAnchor: { screenId: Array.from(afterInv.screenIds)[0] },
    summary: pickLocaleText(
      locale,
      `已完成整页原型重写（共 ${afterInv.screenIds.size} 个屏幕、${afterInv.elementIds.size} 个锚点控件）`,
      `Rewrote prototype page (${afterInv.screenIds.size} screens, ${afterInv.elementIds.size} anchored elements)`,
    ),
  };
}

export interface PrototypeShellScreenStub {
  screenId: string;
  screenName: string;
  screenType: string;
  summary?: string;
}

export interface InitPrototypeShellInput {
  appTitle: string;
  subtitle?: string;
  themeTokens?: {
    mode?: 'light' | 'dark';
    canvasBg?: string;
    cardBg?: string;
    accentColor?: string;
    borderColor?: string;
    textColor?: string;
    fontFamily?: string;
    borderRadius?: string;
  };
  sharedCss?: string;
  screens: PrototypeShellScreenStub[];
}

export interface UpsertPrototypeScreenInput {
  screenId: string;
  screenName?: string;
  screenType?: string;
  /** Optional business-language note ordered before `screenHtml` (spec #87 decision 6). */
  note?: string;
  screenHtml: string;
  extraCss?: string;
  extraJs?: string;
}

function escapeHtmlAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeScreenType(raw: string | undefined): string {
  const upper = (raw ?? 'LIST').trim().toUpperCase();
  return VALID_PROTOTYPE_SCREEN_TYPES.has(upper) ? upper : 'LIST';
}

/**
 * The style the shell's own `themeTokens` describe (the lead's proposal, no samples); approved
 * values, when given, win over the tokens.
 */
export function styleFromShellTokens(
  tokens: unknown,
  locked?: Partial<PrototypeStyleValues> | null,
): PrototypeStyle {
  const tk = tokens && typeof tokens === 'object' ? (tokens as Record<string, unknown>) : {};
  const resolved = resolvePrototypeStyleValues(
    {
      mode: tk.mode,
      background: tk.canvasBg,
      surface: tk.cardBg,
      accent: tk.accentColor,
      border: tk.borderColor,
      ink: tk.textColor,
      fontFamily: tk.fontFamily,
      radiusPx: tk.borderRadius,
    },
    locked ?? null,
  );
  return { direction: '', values: resolved.values, componentCss: '', sampleHtml: '', locked: resolved.locked };
}

/**
 * The document skeleton (spec #87 decision 3): head, an app bar with the title and one link
 * per screen, and one empty section per screen. It has no look of its own: every colour, font
 * and radius comes from the build's style (`define_style`, ADR 0018 / #91), or — when the lead
 * set none — from the shell's `themeTokens`. No fixed page width: the pages follow the viewport.
 */
export function initPrototypeShell(
  input: InitPrototypeShellInput,
  options?: { locale?: AgentLocale; style?: PrototypeStyle | null },
): PrototypeHtmlMutationResult {
  const locale = options?.locale ?? 'zh-CN';
  const screens = Array.isArray(input.screens) ? input.screens.filter((s) => s?.screenId?.trim()) : [];
  if (screens.length === 0) {
    return {
      isError: true,
      nextHtml: '',
      summary: pickLocaleText(locale, '缺少分屏清单 screens', 'Missing screens list'),
      diagnostic: pickLocaleText(
        locale,
        'init_prototype_shell 需要至少声明 1 个业务屏幕（含 screenId、screenName、screenType）。',
        'init_prototype_shell requires at least one screen stub (screenId, screenName, screenType).',
      ),
    };
  }

  if (input.sharedCss && FORBIDDEN_DIALOG_RE.test(input.sharedCss)) {
    return {
      isError: true,
      nextHtml: '',
      summary: pickLocaleText(locale, '禁止使用浏览器阻塞弹窗', 'Blocking browser dialogs are forbidden'),
      diagnostic: pickLocaleText(
        locale,
        'sharedCss 中不得包含 alert/confirm/prompt。',
        'sharedCss must not contain alert/confirm/prompt.',
      ),
    };
  }

  const style = options?.style ?? styleFromShellTokens(input.themeTokens);

  const navItemsHtml = screens
    .map((scr, idx) => {
      const sid = escapeHtmlAttr(scr.screenId.trim());
      const sname = escapeHtmlAttr(scr.screenName?.trim() || scr.screenId.trim());
      const navElId = `EL-SHELL-TAB-${sid.replace(/[^A-Za-z0-9_-]/g, '-')}`;
      return `        <button type="button" class="proto-app-nav-link${idx === 0 ? ' is-active' : ''}" data-element-id="${navElId}" data-element-type="TAB" data-element-label="${sname}" data-nav-screen="${sid}" onclick="window.__selectProtoScreen('${sid}')">${sname}</button>`;
    })
    .join('\n');

  // Each planned screen gets an empty section: nothing is drawn until a helper really writes
  // it (no skeleton or "building" badge standing in for work that has not happened, ADR 0018).
  const sectionsHtml = screens
    .map((scr, idx) => {
      const sid = escapeHtmlAttr(scr.screenId.trim());
      const sname = escapeHtmlAttr(scr.screenName?.trim() || scr.screenId.trim());
      const stype = normalizeScreenType(scr.screenType);
      return `      <section id="screen-${sid}" class="proto-screen${idx === 0 ? ' is-active' : ''}" data-screen-id="${sid}" data-screen-name="${sname}" data-screen-type="${stype}" data-screen-status="queued"></section>`;
    })
    .join('\n');

  const appTitle = escapeHtmlAttr(input.appTitle?.trim() || 'Interactive Prototype');
  const subtitle = input.subtitle?.trim() ? escapeHtmlAttr(input.subtitle.trim()) : '';

  // Structure only, at zero specificity (:where), so the style's components restyle any of it.
  const html = `<!DOCTYPE html>
<html lang="${locale === 'en-US' ? 'en' : 'zh-CN'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${appTitle}</title>
  ${prototypeStyleHeadHtml(style)}
  <style id="proto-shell-styles">
    ${PROTOTYPE_SHELL_SKELETON_CSS}
    ${stripStyleValueOverrides(sanitizeStyleCss(input.sharedCss?.trim() ?? ''))}
  </style>
</head>
<body>
  <div class="proto-app-shell">
    <header class="proto-app-bar">
      <div class="proto-app-brand">
        <h1 class="proto-app-title">${appTitle}</h1>
        ${subtitle ? `<span class="proto-app-subtitle">${subtitle}</span>` : ''}
      </div>
      <nav class="proto-app-nav" aria-label="Screens">
${navItemsHtml}
      </nav>
    </header>
    <main id="proto-screens-root" class="proto-screens-stage">
${sectionsHtml}
    </main>
  </div>
  ${prototypeNavigationRuntimeScript('proto-shell-script')}
</body>
</html>`;

  return {
    isError: false,
    nextHtml: html,
    targetAnchor: {
      screenId: screens[0]!.screenId.trim(),
      label: screens[0]!.screenName?.trim() || screens[0]!.screenId.trim(),
    },
    summary: pickLocaleText(
      locale,
      `已搭建原型应用外壳与 ${screens.length} 个分屏画板骨架`,
      `Initialized prototype shell with ${screens.length} artboard screens`,
    ),
  };
}

/** Drops this screen's own CSS block and page-level script blocks older writes left for it. */
function removeScreenCssBlock(html: string, screenId: string): string {
  const id = screenId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutCss = html.replace(new RegExp(`<style\\b[^>]*data-screen-css="${id}"[^>]*>[\\s\\S]*?</style>\\n?`, 'gi'), '');
  // A script inside a section is that section's (replaced with it); only page-level ones go here.
  return withoutCss.replace(
    new RegExp(`\\n?<script\\b[^>]*data-screen-js="${id}"[^>]*>[\\s\\S]*?</script>\\n?`, 'gi'),
    (match: string, offset: number, whole: string) => {
      const before = whole.slice(0, offset);
      const open = (before.match(/<section\b/gi) ?? []).length - (before.match(/<\/section>/gi) ?? []).length;
      return open > 0 ? match : '';
    },
  );
}

function skipCssString(css: string, fromQuote: number): number {
  const quote = css[fromQuote]!;
  let i = fromQuote + 1;
  while (i < css.length) {
    if (css[i] === '\\') {
      i += 2;
      continue;
    }
    if (css[i] === quote) return i + 1;
    i += 1;
  }
  return css.length;
}

/** Splits CSS into top-level chunks: `{ prelude, body }` for blocks, `{ statement }` otherwise. */
function splitCssBlocks(css: string): ({ prelude: string; body: string } | { statement: string })[] {
  const out: ({ prelude: string; body: string } | { statement: string })[] = [];
  let i = 0;
  let start = 0;
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === '"' || ch === "'") {
      i = skipCssString(css, i);
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (ch === ';') {
      const statement = css.slice(start, i + 1).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (statement && statement !== ';') out.push({ statement });
      start = i + 1;
    } else if (ch === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        const inner = css[j]!;
        if (inner === '"' || inner === "'") {
          j = skipCssString(css, j);
          continue;
        }
        if (inner === '/' && css[j + 1] === '*') {
          const end = css.indexOf('*/', j + 2);
          j = end === -1 ? css.length : end + 2;
          continue;
        }
        if (inner === '{') depth += 1;
        else if (inner === '}') depth -= 1;
        j += 1;
      }
      out.push({
        prelude: css.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, '').trim(),
        body: css.slice(i + 1, depth === 0 ? j - 1 : j),
      });
      i = j;
      start = j;
      continue;
    }
    i += 1;
  }
  const tail = css.slice(start).replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (tail) out.push({ statement: tail });
  return out;
}

function splitSelectorList(prelude: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < prelude.length; i += 1) {
    const ch = prelude[i]!;
    if (ch === '"' || ch === "'") {
      const next = skipCssString(prelude, i);
      cur += prelude.slice(i, next);
      i = next - 1;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' && depth > 0) depth -= 1;
    if (ch === ']' && depth > 0) depth -= 1;
    if (ch === ',' && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/**
 * True when `afterOwn` (the remainder of a selector starting with `[data-screen-id="<own>"]` or
 * `#screen-<own>`) applies `+` or `~` to the screen root itself (including after compound
 * qualifiers such as `.proto-screen` or `:not(.x)`) before stepping inside a descendant or child.
 */
function escapesOwnRoot(afterOwn: string): boolean {
  let depth = 0;
  for (let i = 0; i < afterOwn.length; i += 1) {
    const ch = afterOwn[i]!;
    if (ch === '"' || ch === "'") {
      i = skipCssString(afterOwn, i) - 1;
      continue;
    }
    if (ch === '(' || ch === '[') {
      depth += 1;
      continue;
    }
    if ((ch === ')' || ch === ']') && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth > 0) continue;
    if (ch === '+' || ch === '~') return true;
    if (ch === '>' || /\s/.test(ch)) {
      let j = ch === '>' ? i + 1 : i;
      while (j < afterOwn.length && /\s/.test(afterOwn[j]!)) j += 1;
      const next = afterOwn[j];
      if (!next) return ch === '>';
      if (next === '+' || next === '~') return true;
      if (next === '>') {
        j += 1;
        while (j < afterOwn.length && /\s/.test(afterOwn[j]!)) j += 1;
        const afterChild = afterOwn[j];
        return !afterChild || afterChild === '+' || afterChild === '~' || afterChild === '>';
      }
      return false;
    }
  }
  return false;
}

/**
 * A screen's extraCss confined to its own section: every selector is prefixed with the section,
 * design values (--proto-*) cannot be redeclared, and selectors aimed at the page (:root, html,
 * body), the shell, the style or another screen are rejected.
 */
export function scopeScreenCss(css: string, screenId: string): { css: string; rejected: string[] } {
  const scope = `[data-screen-id="${screenId}"]`;
  const idSel = `#screen-${screenId}`;
  const rejected: string[] = [];
  const reaches = (sel: string): boolean => {
    if (/(^|[\s>+~,(])(?::root|:host|html|body)(?![\w-])/i.test(sel)) return true;
    if (/proto-app|proto-topbar|proto-brand|proto-nav|proto-screens-stage|data-proto-style|data-nav-screen|data-screen-css/i.test(sel)) {
      return true;
    }
    for (const m of sel.matchAll(/\[\s*data-screen-id(?:\s*([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/gi)) {
      const op = m[1];
      const val = m[2] ?? m[3] ?? m[4];
      if (op !== '=' || val !== screenId) return true;
    }
    for (const m of sel.matchAll(/#screen-([A-Za-z0-9_-]+)/g)) if (m[1] !== screenId) return true;
    const afterOwn = sel.startsWith(scope)
      ? sel.slice(scope.length)
      : sel.startsWith(idSel)
        ? sel.slice(idSel.length)
        : null;
    if (afterOwn !== null && escapesOwnRoot(afterOwn)) return true;
    return false;
  };
  const cleanedSource = css.replace(/<\/?(?:style|template|script)[^>]*>?/gi, '');
  const scopeBlocks = (source: string): string =>
    splitCssBlocks(source)
      .map((chunk) => {
        if ('statement' in chunk) {
          // @import, @charset and stray declarations do not belong to a screen.
          rejected.push(chunk.statement.slice(0, 60));
          return '';
        }
        const { prelude, body } = chunk;
        if (prelude.startsWith('@')) {
          if (/^@(media|supports|container|layer)\b/i.test(prelude)) {
            const inner = scopeBlocks(body);
            return inner ? `${prelude} {\n${inner}\n}` : '';
          }
          if (/^@(keyframes|-webkit-keyframes|font-face)\b/i.test(prelude)) {
            return `${prelude} {${stripStyleValueOverrides(sanitizeStyleCss(body))}}`;
          }
          rejected.push(prelude.slice(0, 60));
          return '';
        }
        const selectors = splitSelectorList(prelude);
        const bad = selectors.filter(reaches);
        if (bad.length > 0 || selectors.length === 0) {
          rejected.push(...(bad.length > 0 ? bad : [prelude.slice(0, 60)]));
          return '';
        }
        const scoped = selectors
          .map((sel) => (sel.startsWith(scope) || sel.startsWith(idSel) ? sel : `${scope} ${sel}`))
          .join(', ');
        return `${scoped} {${stripStyleValueOverrides(sanitizeStyleCss(body))}}`;
      })
      .filter(Boolean)
      .join('\n');
  const out = scopeBlocks(cleanedSource).trim();
  return { css: out, rejected };
}

export function upsertPrototypeScreen(
  beforeHtml: string,
  input: UpsertPrototypeScreenInput,
  options?: { locale?: AgentLocale; allowAnchorReset?: boolean },
): PrototypeHtmlMutationResult {
  const locale = options?.locale ?? 'zh-CN';
  const screenId = input.screenId?.trim();
  if (!screenId) {
    return {
      isError: true,
      nextHtml: beforeHtml,
      summary: pickLocaleText(locale, '缺少 screenId', 'Missing screenId'),
      diagnostic: pickLocaleText(
        locale,
        'upsert_prototype_screen 必须指定非空 screenId（如 SCR-MEMBER-LEDGER）。',
        'upsert_prototype_screen requires a non-empty screenId.',
      ),
    };
  }

  const rawFragmentBeforeStrip = (input.screenHtml ?? '')
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!rawFragmentBeforeStrip) {
    return {
      isError: true,
      nextHtml: beforeHtml,
      targetAnchor: { screenId, ...(input.screenName ? { label: input.screenName } : {}) },
      summary: pickLocaleText(locale, 'screenHtml 为空', 'screenHtml is empty'),
      diagnostic: pickLocaleText(
        locale,
        'upsert_prototype_screen 需要提供该分屏的 HTML 内容。',
        'upsert_prototype_screen requires non-empty screenHtml.',
      ),
    };
  }

  const combinedCheck = `${rawFragmentBeforeStrip}\n${input.extraCss ?? ''}\n${input.extraJs ?? ''}`;
  if (FORBIDDEN_DIALOG_RE.test(combinedCheck)) {
    return {
      isError: true,
      nextHtml: beforeHtml,
      targetAnchor: { screenId, ...(input.screenName ? { label: input.screenName } : {}) },
      summary: pickLocaleText(locale, '禁止使用浏览器阻塞弹窗', 'Blocking browser dialogs are forbidden'),
      diagnostic: pickLocaleText(
        locale,
        `分屏 ${screenId} 中检测到 window.alert / confirm / prompt；请改用内联提示条或抽屉反馈后重试。`,
        `Screen ${screenId} contains window.alert / confirm / prompt; replace with inline UI feedback and retry.`,
      ),
    };
  }

  // Screen HTML must not smuggle unscoped <style>/<link> or inline --proto-* overrides (use extraCss + var(--proto-*)).
  const rawFragment = sanitizePrototypeScreenFragment(rawFragmentBeforeStrip).trim();
  if (!rawFragment) {
    return {
      isError: true,
      nextHtml: beforeHtml,
      targetAnchor: { screenId, ...(input.screenName ? { label: input.screenName } : {}) },
      summary: pickLocaleText(locale, 'screenHtml 为空', 'screenHtml is empty'),
      diagnostic: pickLocaleText(
        locale,
        'upsert_prototype_screen 需要提供该分屏的 HTML 内容（样式请放在 extraCss 中）。',
        'upsert_prototype_screen requires non-empty screenHtml (put screen CSS in extraCss).',
      ),
    };
  }

  // Screen CSS stays on this screen: scoped to its section, never the page, the shell or the style.
  const scopedCss = scopeScreenCss(input.extraCss ?? '', screenId);
  if (scopedCss.rejected.length > 0) {
    return {
      isError: true,
      nextHtml: beforeHtml,
      targetAnchor: { screenId, ...(input.screenName ? { label: input.screenName } : {}) },
      summary: pickLocaleText(locale, 'extraCss 只能写这一屏的样式', 'extraCss may only style this screen'),
      diagnostic: pickLocaleText(
        locale,
        `分屏 ${screenId} 的 extraCss 里有作用到整页、外壳、风格或别的屏的选择器：${scopedCss.rejected.join('，')}。extraCss 只写这一屏内部元素的样式（会自动限定在这一屏里），颜色和字体用 var(--proto-*)。`,
        `Screen ${screenId}'s extraCss has selectors reaching the page, shell, style or other screens: ${scopedCss.rejected.join(', ')}. extraCss styles only elements inside this screen (it is scoped automatically); use var(--proto-*) for colours and type.`,
      ),
    };
  }

  // Ensure a base shell exists if called before init_prototype_shell
  let baseHtml = beforeHtml;
  if (!baseHtml.trim()) {
    const shellRes = initPrototypeShell(
      {
        appTitle: input.screenName?.trim() || screenId,
        screens: [
          {
            screenId,
            screenName: input.screenName?.trim() || screenId,
            screenType: normalizeScreenType(input.screenType),
          },
        ],
      },
      { locale },
    );
    baseHtml = shellRes.nextHtml;
  }

  const baseTree = parseHtmlSpanTree(baseHtml);
  const existingScreenNode = baseTree.allNodes.find(
    (n) => n.attrs['data-screen-id'] === screenId,
  );

  const resolvedName =
    input.screenName?.trim() ||
    existingScreenNode?.attrs['data-screen-name'] ||
    screenId;
  const resolvedType = normalizeScreenType(
    input.screenType ?? existingScreenNode?.attrs['data-screen-type'],
  );
  const preserveActiveClass = existingScreenNode
    ? /\bis-active\b/.test(existingScreenNode.attrs['class'] ?? '')
    : baseTree.allNodes.filter((n) => Boolean(n.attrs['data-screen-id'])).length === 0;

  // Wrap or normalize outer <section data-screen-id="...">
  const fragTree = parseHtmlSpanTree(rawFragment);
  const outerScreenRoot =
    fragTree.roots.length === 1 && fragTree.roots[0]?.attrs['data-screen-id'] === screenId
      ? fragTree.roots[0]
      : undefined;

  const cleanScreenNote = sanitizePrototypeNote(input.note);
  let normalizedSectionHtml: string;
  if (outerScreenRoot) {
    const origOpen = rawFragment.slice(outerScreenRoot.openStart, outerScreenRoot.openEnd);
    const existingClass = outerScreenRoot.attrs['class'] ?? '';
    const mergedClass = [
      'proto-screen',
      ...(preserveActiveClass ? ['is-active'] : []),
      ...existingClass.split(/\s+/).filter((c) => c && c !== 'proto-screen' && c !== 'is-active'),
    ].join(' ');
    const updatedOpen = rewriteOpeningTagAttributes(origOpen, {
      'data-screen-id': screenId,
      'data-screen-name': resolvedName,
      'data-screen-type': resolvedType,
      'data-screen-status': 'ready',
      class: mergedClass,
      ...(cleanScreenNote && !outerScreenRoot.attrs[PROTOTYPE_NOTE_ATTR]?.trim()
        ? { [PROTOTYPE_NOTE_ATTR]: cleanScreenNote }
        : {}),
    });
    normalizedSectionHtml = `${updatedOpen}${rawFragment.slice(outerScreenRoot.openEnd)}`;
  } else {
    const activeCls = preserveActiveClass ? ' is-active' : '';
    const noteAttr = cleanScreenNote ? ` data-note="${escapeHtmlAttr(cleanScreenNote)}"` : '';
    normalizedSectionHtml = `<section id="screen-${escapeHtmlAttr(screenId)}" class="proto-screen${activeCls}" data-screen-id="${escapeHtmlAttr(screenId)}" data-screen-name="${escapeHtmlAttr(resolvedName)}" data-screen-type="${resolvedType}" data-screen-status="ready"${noteAttr}>\n${rawFragment}\n</section>`;
  }

  // Validate interactive controls inside this screen
  const sectionNodes = parseHtmlSpanTree(normalizedSectionHtml).allNodes;
  const controlIssues = validateInteractiveControlNodes(
    sectionNodes,
    normalizedSectionHtml,
    new Set(),
    locale,
  );
  if (controlIssues.length > 0) {
    return {
      isError: true,
      nextHtml: beforeHtml,
      targetAnchor: { screenId, label: resolvedName },
      summary: controlIssues[0]!,
      diagnostic: pickLocaleText(
        locale,
        `分屏「${resolvedName}」(${screenId}) 控件锚点校验未通过：${controlIssues.join('；')}。请为每个 <button>/<input>/<select>/<textarea> 补齐唯一 data-element-id 与合法 data-element-type 后重试。`,
        `Screen "${resolvedName}" (${screenId}) control anchor validation failed: ${controlIssues.join('; ')}. Add unique data-element-id and valid data-element-type on every interactive control and retry.`,
      ),
    };
  }

  // Check that element IDs in this screen don't collide with element IDs in OTHER screens
  const otherScreenElementIds = new Set<string>();
  for (const node of baseTree.allNodes) {
    const enclosing = findEnclosingScreenNode(node);
    if (enclosing && enclosing.attrs['data-screen-id'] === screenId) continue;
    const eid = node.attrs['data-element-id'];
    if (eid) otherScreenElementIds.add(eid);
  }
  const duplicateAcrossScreens: string[] = [];
  const seenInSection = new Set<string>();
  for (const node of sectionNodes) {
    const eid = node.attrs['data-element-id'];
    if (!eid) continue;
    if (seenInSection.has(eid) || otherScreenElementIds.has(eid)) {
      duplicateAcrossScreens.push(eid);
    }
    seenInSection.add(eid);
  }
  if (duplicateAcrossScreens.length > 0) {
    return {
      isError: true,
      nextHtml: beforeHtml,
      targetAnchor: { screenId, label: resolvedName },
      summary: pickLocaleText(
        locale,
        `存在重复的 data-element-id：${duplicateAcrossScreens[0]}`,
        `Duplicate data-element-id: ${duplicateAcrossScreens[0]}`,
      ),
      diagnostic: pickLocaleText(
        locale,
        `分屏「${resolvedName}」中检测到重复的 data-element-id（${duplicateAcrossScreens.join(', ')}）；建议加屏幕前缀保持全局唯一。`,
        `Duplicate data-element-id detected in screen "${resolvedName}" (${duplicateAcrossScreens.join(', ')}); prefix element IDs per screen so each is globally unique.`,
      ),
    };
  }

  // The screen's own behaviour lives inside its section, handed the section as `screen`.
  if (input.extraJs?.trim()) {
    const sid = escapeHtmlAttr(screenId);
    const safeJs = input.extraJs.trim().replace(/<\/script/gi, '<\\/script');
    const script = `\n<script data-screen-js="${sid}">\n(function (screen) {\n${safeJs}\n})((document.currentScript && document.currentScript.closest('section')) || document.getElementById('screen-${sid}'));\n</script>\n`;
    const closeAt = normalizedSectionHtml.toLowerCase().lastIndexOf('</section>');
    normalizedSectionHtml =
      closeAt >= 0
        ? `${normalizedSectionHtml.slice(0, closeAt)}${script}${normalizedSectionHtml.slice(closeAt)}`
        : `${normalizedSectionHtml}${script}`;
  }

  let candidateHtml: string;
  if (existingScreenNode) {
    candidateHtml = `${baseHtml.slice(0, existingScreenNode.openStart)}${normalizedSectionHtml}${baseHtml.slice(existingScreenNode.closeEnd)}`;
  } else {
    const mainNode =
      baseTree.allNodes.find((n) => n.attrs['id'] === 'proto-screens-root') ??
      baseTree.allNodes.find((n) => n.tagName === 'main') ??
      baseTree.allNodes.find((n) => n.tagName === 'body');
    if (mainNode && mainNode.innerEnd !== null) {
      candidateHtml = `${baseHtml.slice(0, mainNode.innerEnd)}\n${normalizedSectionHtml}\n${baseHtml.slice(mainNode.innerEnd)}`;
    } else {
      candidateHtml = `${baseHtml}\n${normalizedSectionHtml}`;
    }
  }

  // The screen's own CSS: one block per screen at the end of <head>, replaced on every write.
  candidateHtml = removeScreenCssBlock(candidateHtml, screenId);
  if (scopedCss.css) {
    const headCloseIdx = candidateHtml.search(/<\/head>/i);
    const styleBlock = `<style data-screen-css="${escapeHtmlAttr(screenId)}">\n${scopedCss.css}\n</style>\n`;
    candidateHtml =
      headCloseIdx !== -1
        ? `${candidateHtml.slice(0, headCloseIdx)}${styleBlock}${candidateHtml.slice(headCloseIdx)}`
        : `${styleBlock}${candidateHtml}`;
  }

  return {
    isError: false,
    nextHtml: candidateHtml,
    targetAnchor: { screenId, label: resolvedName },
    summary: pickLocaleText(
      locale,
      `已完成分屏「${resolvedName}」(${screenId}) 绘制（共 ${seenInSection.size} 个交互控件）`,
      `Built screen "${resolvedName}" (${screenId}) with ${seenInSection.size} anchored controls`,
    ),
  };
}

export interface PartialPrototypeScreenInput {
  screenId: string;
  screenName?: string;
  screenType?: string;
  note?: string;
  partialScreenHtml: string;
  extraCss?: string;
}

export function ensurePrototypeCoDesignSession(
  store: WorkspaceStore,
  projectId: string,
  prototypeId: string,
): AgentSession {
  const proto = store.getPrototype(prototypeId);
  if (!proto || proto.projectId !== projectId) {
    throw new Error(`Prototype not found in project ${projectId}: ${prototypeId}`);
  }

  if (proto.coDesignSessionId) {
    const linked = store.getAgentSession(proto.coDesignSessionId);
    if (linked) {
      if (linked.targetId !== prototypeId) {
        return store.saveAgentSession({ ...linked, targetId: prototypeId });
      }
      return linked;
    }
  }

  const existingByTarget = store.listAgentSessions({
    projectId,
    agentKind: 'PROTOTYPE_CO_DESIGN',
    targetId: prototypeId,
  })[0];
  if (existingByTarget) {
    store.linkPrototypeCoDesignSession(prototypeId, existingByTarget.id);
    return existingByTarget;
  }

  const created = store.createAgentSession({
    projectId,
    agentKind: 'PROTOTYPE_CO_DESIGN',
    targetId: prototypeId,
    title: `原型共创 · ${proto.name}`,
  });
  store.linkPrototypeCoDesignSession(prototypeId, created.id);
  return created;
}

export const PROTOTYPE_ANCHOR_OPENAI_TOOLS: OpenAiFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_prototype_anchors',
      description:
        'List all screens (data-screen-id, data-screen-name, data-screen-type) and semantic-anchored UI elements (data-element-id, data-element-type, data-element-label, data-binding, data-event-id) in the active Interactive Prototype.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_prototype_anchor',
      description:
        'Read ONLY the targeted screen or UI element HTML fragment by elementId, screenId, or cssSelector (plus surrounding context summary) without dumping unrelated screens.',
      parameters: {
        type: 'object',
        properties: {
          elementId: {
            type: 'string',
            description: 'Target data-element-id to inspect (e.g. EL-BTN-APPROVE)',
          },
          screenId: {
            type: 'string',
            description: 'Target data-screen-id to inspect (e.g. SCR-CONTRACT-LIST)',
          },
          cssSelector: {
            type: 'string',
            description: 'Optional CSS selector when targeting an unanchored wrapper element',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_prototype_anchor',
      description:
        'Apply a surgical local edit to a single anchored element or screen while keeping all other screens and untouched elements byte-for-byte identical. Pass short fields (screenId, elementId, operation, note) BEFORE htmlFragment, and write each element opening tag with data-element-id + data-note before its inner content so narration arrives before content. Preserves existing data-screen-id / data-element-id / data-binding / data-event-id anchors and requires valid data-element-id + data-element-type on any newly added <button>, <input>, <select>, or <textarea>. Never use window.alert/confirm/prompt.',
      parameters: {
        type: 'object',
        properties: {
          screenId: {
            type: 'string',
            description: 'Target data-screen-id (e.g. SCR-CONTRACT-APPROVAL)',
          },
          elementId: {
            type: 'string',
            description: 'Target data-element-id (e.g. EL-BTN-APPROVE)',
          },
          operation: {
            type: 'string',
            enum: [
              'replace_element',
              'insert_after_element',
              'append_to_screen',
              'update_attributes',
            ],
            description: 'Surgical edit operation to perform on the target anchor',
          },
          note: {
            type: 'string',
            description:
              'Business-language Prototype Note (data-note) for the edited element (e.g. "筛选区：按客户或单号搜索。"), ordered before htmlFragment so narration arrives first',
          },
          cssSelector: {
            type: 'string',
            description: 'Optional CSS selector for targeting a specific container',
          },
          attributes: {
            type: 'object',
            description:
              'Attribute key/value map for update_attributes (set null to remove a non-semantic attribute)',
            properties: {},
          },
          allowRemoveAnchors: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Only provide when the user explicitly asked to delete specific anchor IDs',
          },
          htmlFragment: {
            type: 'string',
            description:
              'HTML fragment for replace_element, insert_after_element, or append_to_screen (write opening tag with data-element-id + data-note first, then inner content)',
          },
        },
        required: ['operation'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rewrite_prototype_page',
      description:
        'Full-page HTML5 prototype rewrite reserved STRICTLY for whole-page visual restyling or initial generation. Never use for local control/screen refinements. Must preserve existing semantic anchors unless allowAnchorReset is true, and must never use window.alert/confirm/prompt.',
      parameters: {
        type: 'object',
        properties: {
          htmlContent: {
            type: 'string',
            description: 'Complete valid HTML5 prototype document',
          },
          allowAnchorReset: {
            type: 'boolean',
            description: 'True only when generating a brand-new prototype structure from scratch',
          },
        },
        required: ['htmlContent'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'init_prototype_shell',
      description:
        'Initialize the document skeleton: app title, one navigation link per screen and an empty section per planned screen. It has no look of its own — colours, type and components come from define_style (set the style first); themeTokens are only used when no style was set. Never draws a screen.',
      parameters: {
        type: 'object',
        properties: {
          appTitle: {
            type: 'string',
            description: 'Application title displayed in the prototype header',
          },
          subtitle: {
            type: 'string',
            description: 'Optional domain or version subtitle',
          },
          themeTokens: {
            type: 'object',
            description: 'Design Brief visual tokens',
            properties: {
              mode: { type: 'string', enum: ['light', 'dark'] },
              canvasBg: { type: 'string' },
              cardBg: { type: 'string' },
              accentColor: { type: 'string' },
              borderColor: { type: 'string' },
              textColor: { type: 'string' },
              fontFamily: { type: 'string' },
              borderRadius: { type: 'string' },
            },
          },
          sharedCss: {
            type: 'string',
            description: 'Optional shared CSS utility classes injected into the shell stylesheet',
          },
          screens: {
            type: 'array',
            description: 'List of screens to create as artboards (typically 3-5 screens)',
            items: {
              type: 'object',
              properties: {
                screenId: { type: 'string', description: 'Unique screen ID such as SCR-MEMBER-LEDGER' },
                screenName: { type: 'string', description: 'Human-readable screen title' },
                screenType: {
                  type: 'string',
                  description: 'LIST | FORM | DETAIL | APPROVAL | REPORT | DASHBOARD | MODAL',
                },
                summary: { type: 'string', description: 'One-sentence summary of what this screen contains' },
              },
              required: ['screenId', 'screenName', 'screenType'],
            },
          },
        },
        required: ['appTitle', 'screens'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_prototype_screen',
      description:
        'Create or replace a single screen artboard (data-screen-id) inside the prototype without rewriting other screens. Pass short fields (screenId, screenName, screenType, note) BEFORE screenHtml, and write each section and key control opening tag with data-element-id + a one-sentence business data-note BEFORE its inner content so narration arrives before content. Every <button>, <input>, <select>, and <textarea> inside screenHtml MUST carry a globally unique data-element-id and valid data-element-type, and NEVER call window.alert/confirm/prompt.',
      parameters: {
        type: 'object',
        properties: {
          screenId: {
            type: 'string',
            description: 'Target data-screen-id (e.g. SCR-MEMBER-LEDGER)',
          },
          screenName: {
            type: 'string',
            description: 'Human-readable screen name (e.g. 会员储值台账)',
          },
          screenType: {
            type: 'string',
            description: 'LIST | FORM | DETAIL | APPROVAL | REPORT | DASHBOARD | MODAL',
          },
          note: {
            type: 'string',
            description:
              'Optional one-sentence business Prototype Note for this screen, ordered before screenHtml so narration arrives first',
          },
          screenHtml: {
            type: 'string',
            description:
              'HTML body for this single screen (~80-220 lines; write each section/control opening tag with data-element-id and data-note="<name>：<business note>" BEFORE its inner content)',
          },
          extraCss: {
            type: 'string',
            description: 'Optional scoped CSS rules specific to this screen',
          },
          extraJs: {
            type: 'string',
            description: 'Optional interactive JS handlers scoped to this screen (no alert/confirm/prompt)',
          },
        },
        required: ['screenId', 'screenHtml'],
      },
    },
  },
];

export const PROTOTYPE_ANCHOR_TOOL_NAMES = [
  'list_prototype_anchors',
  'read_prototype_anchor',
  'edit_prototype_anchor',
  'rewrite_prototype_page',
  'init_prototype_shell',
  'upsert_prototype_screen',
] as const;

export type PrototypeAnchorToolName = (typeof PROTOTYPE_ANCHOR_TOOL_NAMES)[number];
