/**
 * How the prototype canvas shows the prototype (#97): artboards on a pan/zoom canvas, or one
 * page at its real width like a website. Remembered per device; the first time is artboards.
 */
export type PrototypeView = 'artboards' | 'web';

export const PROTOTYPE_VIEW_STORAGE_KEY = 'onto_prototype_view';

export function readPrototypeView(): PrototypeView {
  try {
    return localStorage.getItem(PROTOTYPE_VIEW_STORAGE_KEY) === 'web' ? 'web' : 'artboards';
  } catch {
    return 'artboards';
  }
}

export function writePrototypeView(view: PrototypeView): void {
  try {
    localStorage.setItem(PROTOTYPE_VIEW_STORAGE_KEY, view);
  } catch {
    // Storage can be unavailable (private mode, quota); the choice just is not remembered.
  }
}

/**
 * Opens the prototype as its own page in a new tab: the composed `界面原型.html` (the live
 * draft during a build, the saved revision after), starting on `screenId`. The document's own
 * shell script does the navigation, the same as in the saved file. False: nothing to open.
 */
export function openPrototypeStandalone(documentHtml: string, screenId?: string): boolean {
  if (!documentHtml.trim() || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([documentHtml], { type: 'text/html' }));
  // With `noopener` the call returns null even when the tab opened, so there is nothing to check.
  window.open(screenId ? `${url}#${encodeURIComponent(screenId)}` : url, '_blank', 'noopener');
  // The new tab has read the blob long before this; release it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
