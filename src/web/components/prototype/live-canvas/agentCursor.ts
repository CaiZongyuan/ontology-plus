import {
  derivePrototypeLiveWriting,
  type PrototypeCanvasArtboard,
} from '../../../../packages/ontology-core/index.js';
import type { ArtboardRect } from './Artboard.js';
import { businessText, type ScreenBuildView } from './buildView.js';
import type { Camera, Rect } from './camera.js';

export type AgentActivityState = 'writing' | 'fixing';

/**
 * Live agent activity on a prototype screen (#92, reused by #93 targeted fixes):
 * identifies who is working, on which screen and anchored element, with what business sentence.
 */
export interface AgentLiveActivity {
  /** 0 = Lead assistant (主助手), 1..n = Helper 1..n (助手 1..n). */
  agent: number;
  /** Target screen id (or PROTOTYPE_STYLE_BOARD_ID). */
  screenId: string;
  /** Anchored element (`data-element-id`) inside the screen where the cursor lands. */
  elementId?: string;
  /** Business-language narration sentence; omitted when neither note nor heading exists. */
  sentence?: string;
  /** 'writing' while building a screen, 'fixing' during targeted screenshot repair (#93). */
  state: AgentActivityState;
}

export type AgentCursorStyle = 'arrow' | 'nib' | 'dot';

export interface AgentCursorPrefs {
  style: AgentCursorStyle;
  showNames: boolean;
}

export const PROTOTYPE_AGENT_CURSOR_STORAGE_KEY = 'onto_prototype_agent_cursor';

/** Right-edge clearance (px) inside which the narration bubble prefers flipping left when space allows. */
export const CURSOR_BUBBLE_FLIP_MARGIN = 320;
/** Maximum narration bubble width (px) before clamping to narrow viewports. */
export const MAX_CURSOR_BUBBLE_WIDTH = 290;
/** Minimum canvas zoom at which narration bubbles stay legible on the artboard overview. */
export const MIN_CURSOR_BUBBLE_ZOOM = 0.12;
/** Inset (px) keeping a clamped cursor inside the visible artboard / page bounds. */
export const ARTBOARD_CURSOR_INSET = 8;

/**
 * Default top-left content-area rect (just below the 56px app bar) used when a screen-level `note`
 * arrives before any `data-element-id` has mounted in the iframe DOM (spec #87 decision 6).
 */
export const SCREEN_ENTRY_ANCHOR_RECT: ArtboardRect = {
  x: 48,
  y: 88,
  w: 160,
  h: 28,
};

const HELPER_MODEL_COLORS = [
  'var(--model-m2)',
  'var(--model-m5)',
  'var(--model-m7)',
  'var(--model-m1)',
  'var(--model-m4)',
  'var(--model-m6)',
] as const;

export function agentThemePalette(agent: number): { color: string; ink: string } {
  if (agent <= 0) {
    return { color: 'var(--primary)', ink: 'var(--primary-foreground)' };
  }
  const color = HELPER_MODEL_COLORS[(agent - 1) % HELPER_MODEL_COLORS.length]!;
  return { color, ink: 'var(--model-foreground)' };
}

export function readAgentCursorPrefs(): AgentCursorPrefs {
  try {
    const raw = localStorage.getItem(PROTOTYPE_AGENT_CURSOR_STORAGE_KEY);
    if (!raw) return { style: 'arrow', showNames: true };
    const parsed = JSON.parse(raw) as Partial<AgentCursorPrefs>;
    const style: AgentCursorStyle =
      parsed.style === 'arrow' || parsed.style === 'nib' || parsed.style === 'dot'
        ? parsed.style
        : 'arrow';
    const showNames = typeof parsed.showNames === 'boolean' ? parsed.showNames : true;
    return { style, showNames };
  } catch {
    return { style: 'arrow', showNames: true };
  }
}

export function writeAgentCursorPrefs(prefs: AgentCursorPrefs): void {
  try {
    localStorage.setItem(PROTOTYPE_AGENT_CURSOR_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Per-device preference only; storage may be unavailable in private mode or under quota.
  }
}

/**
 * Anchor point on an element in the iframe's own viewport coordinates (already accounting for
 * iframe scroll): lower-third horizontally (capped at 220px) and 6px above its bottom edge.
 */
export function elementCursorAnchor(elRect: ArtboardRect): { x: number; y: number } {
  return {
    x: elRect.x + Math.min(Math.max(elRect.w * 0.35, 0), 220),
    y: elRect.y + Math.max(0, elRect.h - 6),
  };
}

export interface CursorPlacement {
  left: number;
  top: number;
  flipLeft: boolean;
  bubbleMaxWidth: number;
  showBubble: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeBubbleLayout(
  left: number,
  containerWidth: number,
): { flipLeft: boolean; bubbleMaxWidth: number } {
  if (containerWidth <= 0) {
    return { flipLeft: false, bubbleMaxWidth: MAX_CURSOR_BUBBLE_WIDTH };
  }
  const spaceRight = containerWidth - left;
  const flipLeft = spaceRight < CURSOR_BUBBLE_FLIP_MARGIN && left > spaceRight;
  const available = flipLeft ? left - 14 : spaceRight - 32;
  const bubbleMaxWidth = Math.max(0, Math.min(MAX_CURSOR_BUBBLE_WIDTH, Math.floor(available)));
  return { flipLeft, bubbleMaxWidth };
}

export function computeCanvasCursorPlacement(
  boardRect: Rect,
  elRect: ArtboardRect,
  cam: Camera,
  viewportWidth: number,
): CursorPlacement {
  const rawAnchor = elementCursorAnchor(elRect);
  const clampedX = clamp(
    rawAnchor.x,
    ARTBOARD_CURSOR_INSET,
    Math.max(ARTBOARD_CURSOR_INSET, boardRect.w - ARTBOARD_CURSOR_INSET),
  );
  const clampedY = clamp(
    rawAnchor.y,
    ARTBOARD_CURSOR_INSET,
    Math.max(ARTBOARD_CURSOR_INSET, boardRect.h - ARTBOARD_CURSOR_INSET),
  );
  const left = cam.x + (boardRect.x + clampedX) * cam.k;
  const top = cam.y + (boardRect.y + clampedY) * cam.k;
  const { flipLeft, bubbleMaxWidth } = computeBubbleLayout(left, viewportWidth);
  return {
    left,
    top,
    flipLeft,
    bubbleMaxWidth,
    showBubble: cam.k > MIN_CURSOR_BUBBLE_ZOOM && bubbleMaxWidth >= 48,
  };
}

export function computeWebCursorPlacement(
  elRect: ArtboardRect,
  pageWidth: number,
  pageHeight = 0,
): CursorPlacement {
  const rawAnchor = elementCursorAnchor(elRect);
  const left =
    pageWidth > ARTBOARD_CURSOR_INSET * 2
      ? clamp(rawAnchor.x, ARTBOARD_CURSOR_INSET, pageWidth - ARTBOARD_CURSOR_INSET)
      : Math.max(ARTBOARD_CURSOR_INSET, rawAnchor.x);
  const top =
    pageHeight > ARTBOARD_CURSOR_INSET * 2
      ? clamp(rawAnchor.y, ARTBOARD_CURSOR_INSET, pageHeight - ARTBOARD_CURSOR_INSET)
      : Math.max(ARTBOARD_CURSOR_INSET, rawAnchor.y);
  const { flipLeft, bubbleMaxWidth } = computeBubbleLayout(left, pageWidth);
  return {
    left,
    top,
    flipLeft,
    bubbleMaxWidth,
    showBubble: bubbleMaxWidth >= 48,
  };
}

/**
 * Combines live `writing` activities derived from streaming screens with any explicit
 * `externalActivities` (such as #93's targeted `fixing` activities).
 */
export function resolveLiveActivities(options: {
  screens: readonly PrototypeCanvasArtboard[];
  views: readonly ScreenBuildView[];
  locale: 'zh-CN' | 'en-US';
  isBusiness: boolean;
  externalActivities?: readonly AgentLiveActivity[] | undefined;
}): AgentLiveActivity[] {
  const { screens, views, locale, isBusiness, externalActivities } = options;
  const viewById = new Map(views.map((v) => [v.screenId, v] as const));
  const byScreen = new Map<string, AgentLiveActivity>();

  for (const board of screens) {
    if (board.status !== 'streaming') continue;
    const view = viewById.get(board.screenId);
    const agent = view?.agent ?? 0;
    const derived = derivePrototypeLiveWriting(board.screenHtml ?? board.bodyHtml, {
      screenId: board.screenId,
      locale,
    });
    const rawSentence = derived.narration;
    const sentence = rawSentence
      ? isBusiness
        ? businessText(rawSentence, locale)
        : rawSentence.trim()
      : undefined;
    byScreen.set(board.screenId, {
      agent,
      screenId: board.screenId,
      ...(derived.elementId ? { elementId: derived.elementId } : {}),
      ...(sentence ? { sentence } : {}),
      state: 'writing',
    });
  }

  for (const ext of externalActivities ?? []) {
    if (!ext.screenId) continue;
    const cleanedSentence = ext.sentence
      ? isBusiness
        ? businessText(ext.sentence, locale)
        : ext.sentence.trim()
      : undefined;
    byScreen.set(ext.screenId, {
      ...ext,
      ...(cleanedSentence ? { sentence: cleanedSentence } : {}),
    });
  }

  return Array.from(byScreen.values());
}
