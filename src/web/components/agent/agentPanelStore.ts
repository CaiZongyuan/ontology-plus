import { create } from 'zustand';
import type { PrototypeTargetAnchor } from '../../../packages/workspace-store/index.js';

export const AGENT_PANEL_MIN_WIDTH = 320;
export const AGENT_PANEL_MAX_WIDTH = 640;
export const AGENT_PANEL_DEFAULT_WIDTH = 384;
/** Below this viewport width the panel is an overlay instead of a shell column. */
export const AGENT_PANEL_OVERLAY_QUERY = '(max-width: 1100px)';

const STORAGE_KEY = 'onto_agent_panel';

export interface AgentPanelPrefs {
  open: boolean;
  width: number;
}

export function clampAgentPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return AGENT_PANEL_DEFAULT_WIDTH;
  return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, Math.round(width)));
}

export function parseAgentPanelPrefs(raw: string | null | undefined): AgentPanelPrefs {
  const fallback: AgentPanelPrefs = { open: true, width: AGENT_PANEL_DEFAULT_WIDTH };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentPanelPrefs> | null;
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : fallback.open,
      width:
        typeof parsed.width === 'number' ? clampAgentPanelWidth(parsed.width) : fallback.width,
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
  setOpen: (open: boolean) => void;
  setOverlayOpen: (open: boolean) => void;
  /** Opens the Agent Panel in whichever presentation mode (docked or overlay) matches the viewport. */
  revealPanel: () => void;
  setHoveredAnchor: (anchor: PrototypeTargetAnchor | null) => void;
  /** `commit: false` while dragging, so storage is written once when the drag ends. */
  setWidth: (width: number, opts?: { commit?: boolean }) => void;
}

/**
 * Shell-level Agent Panel state. It lives outside any view so that collapse
 * state and width survive navigation between modules (ADR 0009).
 */
export const useAgentPanelStore = create<AgentPanelState>((set, get) => ({
  ...readPrefs(),
  overlayOpen: false,
  hoveredAnchor: null,
  setOpen: (open) => {
    set({ open });
    writePrefs({ open, width: get().width });
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
    writePrefs({ open: true, width: get().width });
  },
  setHoveredAnchor: (hoveredAnchor) => set({ hoveredAnchor }),
  setWidth: (width, opts) => {
    const next = clampAgentPanelWidth(width);
    set({ width: next });
    if (opts?.commit !== false) writePrefs({ open: get().open, width: next });
  },
}));
