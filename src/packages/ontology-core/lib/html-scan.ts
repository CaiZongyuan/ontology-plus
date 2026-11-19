/**
 * Internal quote-aware HTML tag & attribute scanner shared across `ontology-core/lib/`
 * (`prototype-live.ts`, `prototype-notes.ts`, `knowledge-graph-and-owl.ts`).
 */

export const VOID_HTML_TAGS = new Set([
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

export const RAW_TEXT_HTML_TAGS = new Set(['script', 'style', 'textarea', 'title']);

/** Index just past the `>` that ends a tag starting at `from`, honouring quotes; -1 if unfinished. */
export function findHtmlTagClose(html: string, from: number): number {
  let quote: string | null = null;
  let lastSignificant = '';
  for (let i = from; i < html.length; i += 1) {
    const ch = html[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    // A quote only opens an attribute value right after `=`; in `title=it's` it is text.
    if ((ch === '"' || ch === "'") && lastSignificant === '=') {
      quote = ch;
    } else if (ch === '>') {
      return i + 1;
    }
    if (!/\s/.test(ch)) lastSignificant = ch;
  }
  return -1;
}

export interface HtmlAttributeSpan {
  /** Start index in `region` including preceding whitespace. */
  leadingStart: number;
  /** Start index of the attribute name in `region`. */
  nameStart: number;
  /** Exclusive end index of the attribute (including its value/quotes) in `region`. */
  spanEnd: number;
  name: string;
  nameLower: string;
  rawValue: string;
}

const NAME_CHAR_RE = /[A-Za-z0-9_.:@-]/;
const NAME_START_RE = /[A-Za-z_:@]/;

/** Scans all attributes inside an opening tag's attribute slice `[0, region.length)` left-to-right. */
export function scanHtmlAttributeSpans(region: string): HtmlAttributeSpan[] {
  const spans: HtmlAttributeSpan[] = [];
  let i = 0;
  const n = region.length;

  while (i < n) {
    const leadingStart = i;
    while (i < n && /\s/.test(region[i]!)) i += 1;
    if (i >= n) break;

    if (!NAME_START_RE.test(region[i]!)) {
      i += 1;
      continue;
    }

    const nameStart = i;
    i += 1;
    while (i < n && NAME_CHAR_RE.test(region[i]!)) i += 1;
    const name = region.slice(nameStart, i);
    const nameLower = name.toLowerCase();

    let afterName = i;
    while (afterName < n && /\s/.test(region[afterName]!)) afterName += 1;

    if (region[afterName] !== '=') {
      spans.push({
        leadingStart,
        nameStart,
        spanEnd: i,
        name,
        nameLower,
        rawValue: '',
      });
      continue;
    }

    let valPos = afterName + 1;
    while (valPos < n && /\s/.test(region[valPos]!)) valPos += 1;
    if (valPos >= n) {
      spans.push({
        leadingStart,
        nameStart,
        spanEnd: valPos,
        name,
        nameLower,
        rawValue: '',
      });
      i = valPos;
      continue;
    }

    const quote = region[valPos]!;
    if (quote === '"' || quote === "'") {
      const closeQuote = region.indexOf(quote, valPos + 1);
      const rawValue = closeQuote === -1 ? region.slice(valPos + 1) : region.slice(valPos + 1, closeQuote);
      const spanEnd = closeQuote === -1 ? n : closeQuote + 1;
      spans.push({ leadingStart, nameStart, spanEnd, name, nameLower, rawValue });
      i = spanEnd;
    } else {
      let endVal = valPos;
      while (endVal < n && !/[\s"'=<>`]/.test(region[endVal]!)) endVal += 1;
      const rawValue = region.slice(valPos, endVal);
      spans.push({ leadingStart, nameStart, spanEnd: endVal, name, nameLower, rawValue });
      i = endVal;
    }
  }

  return spans;
}

export function parseHtmlAttributes(
  region: string,
  decodeValue?: (raw: string) => string,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const span of scanHtmlAttributeSpans(region)) {
    attrs[span.nameLower] = decodeValue ? decodeValue(span.rawValue) : span.rawValue;
  }
  return attrs;
}

function escapeDoubleQuotedAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sets, updates, or removes (`value === null`) an exact attribute on an HTML opening tag without
 * matching attribute prefixes (`data-notes`) or quoted text inside other attributes.
 */
export function rewriteHtmlTagAttribute(
  openTag: string,
  attrName: string,
  value: string | null,
): string {
  const openMatch = /^<([A-Za-z][A-Za-z0-9:-]*)/.exec(openTag);
  if (!openMatch || !openTag.endsWith('>')) return openTag;
  const selfClosing = /\/\s*>$/.test(openTag);
  const closeSuffixStart = selfClosing ? openTag.lastIndexOf('/') : openTag.length - 1;
  const afterTagName = openMatch[0].length;
  const attrRegion = openTag.slice(afterTagName, closeSuffixStart);
  const targetLower = attrName.trim().toLowerCase();
  const spans = scanHtmlAttributeSpans(attrRegion);
  const hit = spans.find((s) => s.nameLower === targetLower);

  if (value === null) {
    if (!hit) return openTag;
    const nextRegion = `${attrRegion.slice(0, hit.leadingStart)}${attrRegion.slice(hit.spanEnd)}`;
    return `${openTag.slice(0, afterTagName)}${nextRegion}${openTag.slice(closeSuffixStart)}`;
  }

  const encoded = `${attrName}="${escapeDoubleQuotedAttr(value)}"`;
  if (hit) {
    const nextRegion = `${attrRegion.slice(0, hit.nameStart)}${encoded}${attrRegion.slice(hit.spanEnd)}`;
    return `${openTag.slice(0, afterTagName)}${nextRegion}${openTag.slice(closeSuffixStart)}`;
  }

  const sep = attrRegion.endsWith(' ') ? '' : ' ';
  return `${openTag.slice(0, closeSuffixStart)}${sep}${encoded}${openTag.slice(closeSuffixStart)}`;
}
