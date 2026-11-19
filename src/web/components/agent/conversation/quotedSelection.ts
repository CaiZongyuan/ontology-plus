export type QuotableSelectionSource = 'reply' | 'canvas';

export interface ActiveQuotableSelection {
  readonly text: string;
  readonly source: QuotableSelectionSource;
  readonly top: number;
  readonly left: number;
}

const EXCLUDED_INTERACTIVE_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  '[role="button"]',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[contenteditable="plaintext-only"]',
  '[data-testid="agent-panel-composer"]',
  '[data-testid="selection-quote-btn"]',
].join(', ');

const ACTIVE_EDITABLE_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
].join(', ');

const ASSISTANT_REPLY_SELECTOR = '[data-testid="conversation-assistant-markdown"]';

const CANVAS_CONTAINER_SELECTOR = [
  '[data-testid="workbench-canvas"]',
  '.wb-canvas',
  '.workbench-canvas-pane',
  '[data-testid$="-canvas"]',
  '.wb-secondary-content',
].join(', ');

export function normalizeQuotedSnippet(raw: string, maxChars: number = 600): string {
  const cleaned = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function summarizeQuoteChipLabel(quote: string, maxChars: number = 72): string {
  const flat = quote.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function formatQuotedBlockquote(quote: string): string {
  const normalized = normalizeQuotedSnippet(quote, 2000);
  if (!normalized) return '';
  return normalized
    .split('\n')
    .map((line) => (line.trim().length > 0 ? `> ${line}` : '>'))
    .join('\n');
}

export function appendUniqueQuote(
  existing: readonly string[],
  rawSnippet: string,
  maxQuotes: number = 6,
): string[] {
  const normalized = normalizeQuotedSnippet(rawSnippet);
  if (!normalized) return [...existing];
  if (existing.includes(normalized)) return [...existing];
  return [...existing, normalized].slice(-maxQuotes);
}

export function composePromptWithQuotes(quotes: readonly string[], body: string): string {
  const formattedQuotes = quotes
    .map((q) => formatQuotedBlockquote(q))
    .filter((block) => block.length > 0);
  const trimmedBody = body.trim();

  if (formattedQuotes.length === 0) return trimmedBody;
  if (!trimmedBody) return formattedQuotes.join('\n\n');
  return `${formattedQuotes.join('\n\n')}\n\n${trimmedBody}`;
}

export function resolveQuotableSourceFromElement(
  target: { closest?: (selector: string) => unknown } | null | undefined,
): QuotableSelectionSource | null {
  if (!target || typeof target.closest !== 'function') return null;
  if (target.closest(EXCLUDED_INTERACTIVE_SELECTOR)) return null;
  if (target.closest(ASSISTANT_REPLY_SELECTOR)) return 'reply';
  if (target.closest('[data-testid="agent-panel"]')) return null;
  if (target.closest(CANVAS_CONTAINER_SELECTOR)) return 'canvas';
  return null;
}

function resolveElementFromNode(node: Node | null | undefined): Element | null {
  if (!node) return null;
  if (node.nodeType === 1) return node as Element;
  return node.parentElement ?? null;
}

export function computeFloatingQuoteButtonPosition(
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
    bottom?: number;
  },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const bottom = rect.bottom ?? rect.top + rect.height;
  const buttonHeight = 32;
  const approxHalfWidth = 58;
  const preferredAboveTop = Math.round(rect.top - buttonHeight - 6);
  const top =
    preferredAboveTop >= 48
      ? preferredAboveTop
      : Math.min(Math.max(8, viewport.height - 44), Math.round(bottom + 8));

  const centerX = rect.left + Math.max(0, rect.width) / 2;
  const maxLeft = Math.max(12, viewport.width - 140);
  const left = Math.min(maxLeft, Math.max(12, Math.round(centerX - approxHalfWidth)));
  return { top, left };
}

export function isEditableElementFocused(
  doc: Pick<Document, 'activeElement'> | null | undefined = typeof document !== 'undefined'
    ? document
    : null,
): boolean {
  const active = doc?.activeElement as
    | (Element & {
        isContentEditable?: boolean;
        tagName?: string;
        selectionStart?: number | null;
        selectionEnd?: number | null;
      })
    | null
    | undefined;
  if (!active) return false;

  const isInsideComposer =
    typeof active.closest === 'function' &&
    Boolean(active.closest('[data-testid="agent-panel-composer"]'));
  if (isInsideComposer) {
    return (
      typeof active.selectionStart === 'number' &&
      typeof active.selectionEnd === 'number' &&
      active.selectionStart !== active.selectionEnd
    );
  }

  if (active.isContentEditable) return true;
  const tag = typeof active.tagName === 'string' ? active.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (typeof active.closest === 'function' && active.closest(ACTIVE_EDITABLE_SELECTOR)) {
    return true;
  }
  return false;
}

export function readWindowQuotableSelection(): ActiveQuotableSelection | null {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return null;
  if (isEditableElementFocused()) return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const text = normalizeQuotedSnippet(selection.toString());
  if (!text) return null;

  const range = selection.getRangeAt(0);
  const anchorEl = resolveElementFromNode(selection.anchorNode);
  const focusEl = resolveElementFromNode(selection.focusNode);
  const commonEl = resolveElementFromNode(range.commonAncestorContainer);

  const anchorSource = resolveQuotableSourceFromElement(anchorEl);
  const focusSource = resolveQuotableSourceFromElement(focusEl);
  const commonSource = resolveQuotableSourceFromElement(commonEl);

  const source =
    anchorSource && focusSource && anchorSource === focusSource
      ? anchorSource
      : commonSource ?? anchorSource ?? focusSource;
  if (!source) return null;

  const rawRect = range.getBoundingClientRect();
  const fallbackRect =
    rawRect.width === 0 && rawRect.height === 0 && commonEl
      ? commonEl.getBoundingClientRect()
      : rawRect;

  const pos = computeFloatingQuoteButtonPosition(fallbackRect, {
    width: window.innerWidth || 1280,
    height: window.innerHeight || 800,
  });

  return {
    text,
    source,
    top: pos.top,
    left: pos.left,
  };
}
