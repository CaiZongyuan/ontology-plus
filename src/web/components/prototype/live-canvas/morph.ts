/**
 * Updates a live document in place from a freshly parsed target, the way the artboard iframe
 * receives each streamed delta: nodes that are already there stay (same identity, no reflow
 * of finished content), changed text and attributes are patched, new nodes are imported and
 * marked as just born so they can fade in, and nodes that disappeared are removed.
 */

export const BORN_ATTR = 'data-onto-born';

function syncAttributes(from: Element, to: Element): void {
  for (const attr of Array.from(from.attributes)) {
    if (attr.name !== BORN_ATTR && !to.hasAttribute(attr.name)) from.removeAttribute(attr.name);
  }
  for (const attr of Array.from(to.attributes)) {
    if (from.getAttribute(attr.name) !== attr.value) from.setAttribute(attr.name, attr.value);
  }
}

function born(doc: Document, node: Node): Node {
  const imported = doc.importNode(node, true);
  if (imported.nodeType === 1) (imported as Element).setAttribute(BORN_ATTR, '');
  return imported;
}

export function morphChildren(from: Node, to: Node): void {
  const doc = from.ownerDocument ?? (from as Document);
  const current = Array.from(from.childNodes);
  const target = Array.from(to.childNodes);
  for (let i = 0; i < target.length; i += 1) {
    const t = target[i]!;
    const f = current[i];
    if (!f) {
      from.appendChild(born(doc, t));
    } else if (f.nodeType !== t.nodeType || f.nodeName !== t.nodeName) {
      from.replaceChild(born(doc, t), f);
    } else if (t.nodeType === 3 || t.nodeType === 8) {
      if (f.nodeValue !== t.nodeValue) f.nodeValue = t.nodeValue;
    } else if (t.nodeType === 1) {
      syncAttributes(f as Element, t as Element);
      morphChildren(f, t);
    }
  }
  for (let i = current.length - 1; i >= target.length; i -= 1) {
    from.removeChild(current[i]!);
  }
}
