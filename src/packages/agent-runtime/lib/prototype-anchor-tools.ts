import type {
  AgentSession,
  PrototypeTargetAnchor,
  WorkspaceStore,
} from '../../workspace-store/index.js';
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

const FORBIDDEN_DIALOG_RE = /\b(?:window\s*\.\s*)?(?:alert|confirm|prompt)\s*\(/i;

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
    elements.push({
      elementId,
      ...(screenId ? { screenId } : {}),
      tagName: node.tagName,
      elementType: (node.attrs['data-element-type'] || 'INPUT').toUpperCase(),
      label: node.attrs['data-element-label'] || elementId,
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
  elementId?: string;
  screenId?: string;
  cssSelector?: string;
  operation: PrototypeAnchorEditOperation;
  htmlFragment?: string;
  attributes?: Record<string, string | null>;
  allowRemoveAnchors?: string[];
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
  const fragment = (input.htmlFragment ?? '').trim();

  if (fragment && FORBIDDEN_DIALOG_RE.test(fragment)) {
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
    let updates: Record<string, string | null> | undefined = input.attributes;
    if ((!updates || Object.keys(updates).length === 0) && fragment) {
      const parsedFrag = parseHtmlSpanTree(fragment).roots[0];
      if (parsedFrag) {
        updates = parsedFrag.attrs;
      }
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
    const origOpenTag = html.slice(targetNode.openStart, targetNode.openEnd);
    const updatedOpenTag = rewriteOpeningTagAttributes(origOpenTag, updates);
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
        'Apply a surgical local edit to a single anchored element or screen while keeping all other screens and untouched elements byte-for-byte identical. Preserves existing data-screen-id / data-element-id / data-binding / data-event-id anchors and requires valid data-element-id + data-element-type on any newly added <button>, <input>, <select>, or <textarea>. Never use window.alert/confirm/prompt.',
      parameters: {
        type: 'object',
        properties: {
          elementId: {
            type: 'string',
            description: 'Target data-element-id (e.g. EL-BTN-APPROVE)',
          },
          screenId: {
            type: 'string',
            description: 'Target data-screen-id (e.g. SCR-CONTRACT-APPROVAL)',
          },
          cssSelector: {
            type: 'string',
            description: 'Optional CSS selector for targeting a specific container',
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
          htmlFragment: {
            type: 'string',
            description:
              'HTML fragment for replace_element, insert_after_element, or append_to_screen',
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
];

export const PROTOTYPE_ANCHOR_TOOL_NAMES = [
  'list_prototype_anchors',
  'read_prototype_anchor',
  'edit_prototype_anchor',
  'rewrite_prototype_page',
] as const;

export type PrototypeAnchorToolName = (typeof PROTOTYPE_ANCHOR_TOOL_NAMES)[number];
