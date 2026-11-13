import { create } from 'zustand';
import type { PrototypeTargetAnchor } from '../../../packages/workspace-store/index.js';

export const AGENT_PANEL_MIN_WIDTH = 320;
export const AGENT_PANEL_MAX_WIDTH = 640;
export const AGENT_PANEL_DEFAULT_WIDTH = 384;
/** Wide Mode leaves the module canvas at least half of the remaining shell, so it never collapses. */
export const AGENT_PANEL_WIDE_CSS_WIDTH = 'clamp(400px, 38vw, 600px)';
/** Below this viewport width the panel is an overlay instead of a shell column. */
export const AGENT_PANEL_OVERLAY_QUERY = '(max-width: 1100px)';

const STORAGE_KEY = 'onto_agent_panel';
const SESSION_SCOPE_STORAGE_KEY = 'onto_agent_panel_sessions';

/** Identifies "this agent in this project", the scope a user picks a conversation within. */
export function agentSessionScopeKey(projectId: string, agentKind: string, targetId?: string): string {
  return [projectId, agentKind, targetId ?? ''].join('::');
}

export function parseAgentSessionScopeMap(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function readSessionScopeMap(): Record<string, string> {
  try {
    return parseAgentSessionScopeMap(localStorage.getItem(SESSION_SCOPE_STORAGE_KEY));
  } catch {
    return {};
  }
}

export interface AgentPanelPrefs {
  open: boolean;
  width: number;
  wideMode: boolean;
}

export function clampAgentPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return AGENT_PANEL_DEFAULT_WIDTH;
  return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, Math.round(width)));
}

export function parseAgentPanelPrefs(raw: string | null | undefined): AgentPanelPrefs {
  const fallback: AgentPanelPrefs = {
    open: true,
    width: AGENT_PANEL_DEFAULT_WIDTH,
    wideMode: false,
  };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentPanelPrefs> | null;
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : fallback.open,
      width:
        typeof parsed.width === 'number' ? clampAgentPanelWidth(parsed.width) : fallback.width,
      wideMode: typeof parsed.wideMode === 'boolean' ? parsed.wideMode : fallback.wideMode,
    };
  } catch {
    return fallback;
  }
}

function readPrefs(): AgentPanelPrefs {
  try {
    return parseAgentPanelPrefs(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseAgentPanelPrefs(null);
  }
}

function writePrefs(prefs: AgentPanelPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage write errors in restricted contexts
  }
}

interface AgentPanelState extends AgentPanelPrefs {
  /** Overlay visibility on narrow viewports. Never persisted, so the overlay cannot cover a page on load. */
  overlayOpen: boolean;
  /** Semantic anchor currently hovered inside an AgentRunCard step (for canvas highlight). */
  hoveredAnchor: PrototypeTargetAnchor | null;
  /** The conversation last opened per agent scope, so leaving a module does not lose your place. */
  sessionByScope: Record<string, string>;
  rememberSession: (scopeKey: string, sessionId: string | null) => void;
  setOpen: (open: boolean) => void;
  setOverlayOpen: (open: boolean) => void;
  /** Opens the Agent Panel in whichever presentation mode (docked or overlay) matches the viewport. */
  revealPanel: () => void;
  setHoveredAnchor: (anchor: PrototypeTargetAnchor | null) => void;
  /** `commit: false` while dragging, so storage is written once when the drag ends. */
  setWidth: (width: number, opts?: { commit?: boolean }) => void;
  setWideMode: (wideMode: boolean, opts?: { commit?: boolean }) => void;
  toggleWideMode: () => void;
}

/**
 * Shell-level Agent Panel state. It lives outside any view so that collapse
 * state and width survive navigation between modules (ADR 0009).
 */
export const useAgentPanelStore = create<AgentPanelState>((set, get) => ({
  ...readPrefs(),
  overlayOpen: false,
  hoveredAnchor: null,
  sessionByScope: readSessionScopeMap(),
  rememberSession: (scopeKey, sessionId) => {
    const current = get().sessionByScope;
    if ((current[scopeKey] ?? null) === sessionId) return;
    const next = { ...current };
    if (sessionId) next[scopeKey] = sessionId;
    else delete next[scopeKey];
    set({ sessionByScope: next });
    try {
      localStorage.setItem(SESSION_SCOPE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage write errors in restricted contexts
    }
  },
  setOpen: (open) => {
    set({ open });
    writePrefs({ open, width: get().width, wideMode: get().wideMode });
  },
  setOverlayOpen: (overlayOpen) => set({ overlayOpen }),
  revealPanel: () => {
    const isNarrow =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(AGENT_PANEL_OVERLAY_QUERY).matches;
    if (isNarrow) {
      set({ overlayOpen: true, open: true });
    } else {
      set({ open: true });
    }
    writePrefs({ open: true, width: get().width, wideMode: get().wideMode });
  },
  setHoveredAnchor: (hoveredAnchor) => set({ hoveredAnchor }),
  setWidth: (width, opts) => {
    const next = clampAgentPanelWidth(width);
    set({ width: next, wideMode: false });
    if (opts?.commit !== false) writePrefs({ open: get().open, width: next, wideMode: false });
  },
  setWideMode: (wideMode, opts) => {
    set({ wideMode });
    if (opts?.commit !== false) {
      writePrefs({ open: get().open, width: get().width, wideMode });
    }
  },
  toggleWideMode: () => {
    const next = !get().wideMode;
    set({ wideMode: next, open: true });
    writePrefs({ open: true, width: get().width, wideMode: next });
  },
}));
