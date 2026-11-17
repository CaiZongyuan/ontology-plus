import {
  DEFAULT_NAV_VIEW,
  getDefaultViewForStep,
  resolveAreaParamToView,
  resolveNavViewId,
  resolveStepParamToId,
  type NavViewId,
} from './catalog.js';

export interface UrlNavState {
  projectId?: string;
  nav?: string;
  itemId?: string;
  sessionId?: string;
}

function parseHashRoute(rawHash: string): { projectId?: string; nav?: string } {
  const cleaned = rawHash.replace(/^#\/?/, '').trim();
  if (!cleaned) return {};
  const parts = cleaned.split('/').filter(Boolean);
  if (parts[0] === 'p' && parts[1]) {
    const step = resolveStepParamToId(parts[2] ?? 'requirements');
    return {
      projectId: parts[1],
      nav: step ? getDefaultViewForStep(step) : 'app-req-explore',
    };
  }
  if (parts[0] === 'area' && parts[1]) {
    const areaView = resolveAreaParamToView(parts[1]);
    return areaView ? { nav: areaView } : { nav: cleaned };
  }
  if (parts.length === 1) {
    const aliasView = resolveAreaParamToView(parts[0]);
    if (aliasView) return { nav: aliasView };
  }
  return { nav: cleaned };
}

export function parseUrlNavState(location: { search: string; hash: string }): UrlNavState {
  const params = new URLSearchParams(location.search);
  const hashRoute = parseHashRoute(location.hash);
  const projectId = params.get('projectId') || hashRoute.projectId || undefined;
  const stepId = resolveStepParamToId(params.get('step'));
  const areaNav = resolveAreaParamToView(params.get('area'));
  const nav =
    params.get('mode') ||
    (stepId ? getDefaultViewForStep(stepId) : undefined) ||
    areaNav ||
    hashRoute.nav ||
    undefined;
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
