export interface PrototypeArtboardSlice {
  screenId: string;
  screenName: string;
  screenType: string;
  status: 'queued' | 'streaming' | 'ready';
  elementCount: number;
  activeWritingLabel?: string;
  isolatedHtml: string;
}

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

interface HtmlSpanNode {
  tagName: string;
  attrs: Record<string, string>;
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

function parseHtmlSpanNodes(html: string): HtmlSpanNode[] {
  const allNodes: HtmlSpanNode[] = [];
  const stack: HtmlSpanNode[] = [];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;

    if (html.startsWith('<!--', lt)) {
      const commentEnd = html.indexOf('-->', lt + 4);
      i = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }

    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const gt = html.indexOf('>', lt + 2);
      i = gt === -1 ? html.length : gt + 1;
      continue;
    }

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
          stack.splice(s);
          break;
        }
      }
      i = closeEnd;
      continue;
    }

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
      ...(parent ? { parent } : {}),
      children: [],
    };
    if (parent) {
      parent.children.push(node);
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
      i = closeHit ? closeHit.index + closeHit[0].length : html.length;
      continue;
    }

    stack.push(node);
    i = openEnd;
  }

  return allNodes;
}

function findEnclosingScreenNode(node: HtmlSpanNode): HtmlSpanNode | undefined {
  let cur: HtmlSpanNode | undefined = node;
  while (cur) {
    if (cur.attrs['data-screen-id']) return cur;
    cur = cur.parent;
  }
  return undefined;
}

function escapeHtmlAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function extractPrototypeArtboards(html: string): PrototypeArtboardSlice[] {
  if (!html?.trim()) return [];
  const allNodes = parseHtmlSpanNodes(html);
  const screenNodes = allNodes.filter((n) => Boolean(n.attrs['data-screen-id']));
  if (screenNodes.length === 0) return [];

  return screenNodes.map((scrNode) => {
    const screenId = scrNode.attrs['data-screen-id']!;
    const screenName = scrNode.attrs['data-screen-name'] || screenId;
    const screenType = scrNode.attrs['data-screen-type'] || 'LIST';
    const rawStatus = (scrNode.attrs['data-screen-status'] || '').toLowerCase();
    const status: 'queued' | 'streaming' | 'ready' =
      rawStatus === 'queued'
        ? 'queued'
        : rawStatus === 'streaming'
          ? 'streaming'
          : 'ready';
    const activeWritingLabel = scrNode.attrs['data-live-writing-label'] || undefined;

    let elementCount = 0;
    for (const node of allNodes) {
      if (node === scrNode) continue;
      const enc = findEnclosingScreenNode(node);
      if (enc === scrNode && node.attrs['data-element-id']) {
        elementCount += 1;
      }
    }

    const cssEscapedId = screenId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const jsEscapedId = JSON.stringify(screenId);
    const isolationBlock = [
      `<style data-artboard-isolation="${escapeHtmlAttr(screenId)}">`,
      `  [data-screen-id]:not([data-screen-id="${cssEscapedId}"]) { display: none !important; }`,
      `  [data-screen-id="${cssEscapedId}"], [data-screen-id="${cssEscapedId}"] [data-screen-id] {`,
      `    display: block !important;`,
      `    visibility: visible !important;`,
      `    opacity: 1 !important;`,
      `    transform: none !important;`,
      `  }`,
      `  .proto-topbar [data-nav-screen]:not([data-nav-screen="${cssEscapedId}"]) { opacity: 0.55; }`,
      `  [data-live-writing="true"] {`,
      `    outline: 2px solid var(--proto-accent, #c2410c) !important;`,
      `    outline-offset: 3px !important;`,
      `    box-shadow: 0 0 0 4px rgba(194, 65, 12, 0.14) !important;`,
      `    transition: outline-color 0.25s ease, box-shadow 0.25s ease !important;`,
      `  }`,
      `</style>`,
      `<script data-artboard-activate="${escapeHtmlAttr(screenId)}">`,
      `  window.addEventListener('DOMContentLoaded', function() {`,
      `    if (typeof window.__selectProtoScreen === 'function') {`,
      `      try { window.__selectProtoScreen(${jsEscapedId}); } catch (_) {}`,
      `    }`,
      `  });`,
      `</script>`,
    ].join('\n');

    const headCloseIdx = html.indexOf('</head>');
    const isolatedHtml =
      headCloseIdx !== -1
        ? `${html.slice(0, headCloseIdx)}${isolationBlock}\n${html.slice(headCloseIdx)}`
        : `${isolationBlock}\n${html}`;

    return {
      screenId,
      screenName,
      screenType,
      status,
      elementCount,
      ...(activeWritingLabel ? { activeWritingLabel } : {}),
      isolatedHtml,
    };
  });
}
