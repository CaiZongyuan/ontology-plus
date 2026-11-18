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
