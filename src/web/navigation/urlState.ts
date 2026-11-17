import { DEFAULT_NAV_VIEW, resolveNavViewId, type NavViewId } from './catalog.js';

export interface UrlNavState {
  projectId?: string;
  nav?: string;
  itemId?: string;
  sessionId?: string;
}

export function parseUrlNavState(location: { search: string; hash: string }): UrlNavState {
  const params = new URLSearchParams(location.search);
  const hashNav = location.hash.replace(/^#\/?/, '').trim();
  const projectId = params.get('projectId') || undefined;
  const nav = params.get('mode') || hashNav || undefined;
  const itemId = params.get('itemId') || undefined;
  const sessionId = params.get('sessionId') || undefined;
  return {
    ...(projectId ? { projectId } : {}),
    ...(nav ? { nav } : {}),
    ...(itemId ? { itemId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function applyUrlNavState(currentHref: string, patch: UrlNavState): string {
  const url = new URL(currentHref);
  if (patch.projectId !== undefined) {
    if (patch.projectId) url.searchParams.set('projectId', patch.projectId);
    else url.searchParams.delete('projectId');
  }
  if (patch.nav !== undefined) {
    if (patch.nav) {
      url.searchParams.set('mode', patch.nav);
      url.hash = `#/${patch.nav}`;
    } else {
      url.searchParams.delete('mode');
      url.hash = '';
    }
  }
  if (patch.itemId !== undefined) {
    if (patch.itemId) url.searchParams.set('itemId', patch.itemId);
    else url.searchParams.delete('itemId');
  }
  if (patch.sessionId !== undefined) {
    if (patch.sessionId) url.searchParams.set('sessionId', patch.sessionId);
    else url.searchParams.delete('sessionId');
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readUrlNavState(): UrlNavState {
  if (typeof window === 'undefined') return {};
  return parseUrlNavState(window.location);
}

export function writeUrlNavState(patch: UrlNavState): void {
  if (typeof window === 'undefined') return;
  const nextRelativeUrl = applyUrlNavState(window.location.href, patch);
  window.history.replaceState({}, '', nextRelativeUrl);
}

export function readHashView(location?: { search: string; hash: string }): NavViewId {
  if (!location && typeof window === 'undefined') return DEFAULT_NAV_VIEW;
  const urlState = location ? parseUrlNavState(location) : readUrlNavState();
  return resolveNavViewId(urlState.nav);
}
