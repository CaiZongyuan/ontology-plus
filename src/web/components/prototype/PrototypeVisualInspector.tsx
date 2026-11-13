import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Crosshair, Layers, Loader2, Plus, Sparkles, X } from 'lucide-react';
import type { PrototypeRefinementSelection } from '../../../packages/agent-runtime/index.js';
import type { PrototypeTargetAnchor } from '../../../packages/workspace-store/index.js';
import { Button } from '../beautifui/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';

export interface PrototypeSelectionCropPayload {
  mimeType: string;
  dataBase64: string;
  width: number;
  height: number;
}

export interface PrototypeSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PrototypeSelectionTarget {
  kind: 'ELEMENT' | 'REGION';
  tagName: string;
  cssSelector: string;
  label: string;
  textPreview: string;
  htmlSnippet: string;
  screenId?: string;
  screenName?: string;
  elementId?: string;
  elementType?: string;
  binding?: string;
  eventId?: string;
  matchedElementCount?: number;
  matchedElementsSummary?: string[];
  rect: PrototypeSelectionRect;
}

export interface PrototypeVisualAnnotation {
  id: string;
  index: number;
  target: PrototypeSelectionTarget;
  note: string;
}

export type PrototypeViewportPreset = 'DESKTOP' | 'TABLET' | 'MOBILE';
export type PrototypeZoomMode = 'FIT' | 'ACTUAL';

export const PROTOTYPE_VIEWPORT_WIDTHS: Record<PrototypeViewportPreset, number> = {
  DESKTOP: 1440,
  TABLET: 768,
  MOBILE: 390,
};

export function computeViewportFitScale(
  containerWidth: number,
  viewport: PrototypeViewportPreset,
  zoomMode: PrototypeZoomMode,
  paddingPx = 24,
): { targetWidth: number; scale: number; scaledWidth: number } {
  const targetWidth = PROTOTYPE_VIEWPORT_WIDTHS[viewport];
  if (zoomMode === 'ACTUAL' || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return { targetWidth, scale: 1, scaledWidth: targetWidth };
  }
  const availableWidth = Math.max(240, containerWidth - Math.max(0, paddingPx));
  const rawScale = availableWidth / targetWidth;
  const clamped = Math.max(0.25, Math.min(1, rawScale));
  const scale = Math.round(clamped * 1000) / 1000;
  const scaledWidth = Math.round(targetWidth * scale);
  return { targetWidth, scale, scaledWidth };
}

export function mapIframeRectToStageRect(
  rect: PrototypeSelectionRect,
  scale: number,
  offsetX = 0,
): PrototypeSelectionRect {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: Math.round(offsetX + rect.x * safeScale),
    y: Math.round(rect.y * safeScale),
    width: Math.max(8, Math.round(rect.width * safeScale)),
    height: Math.max(8, Math.round(rect.height * safeScale)),
  };
}

export function openCleanPrototypeInNewTab(
  rawHtml: string,
): { blobUrl: string; cleanHtml: string } | null {
  const cleanHtml = stripVisualInspectorFromHtml(rawHtml);
  if (!cleanHtml.trim()) return null;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return null;
  }
  const blob = new Blob([cleanHtml], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
  }
  if (typeof URL.revokeObjectURL === 'function') {
    setTimeout(() => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        // Ignore already revoked URLs
      }
    }, 60_000);
  }
  return { blobUrl, cleanHtml };
}

interface OriginInstanceLike {
  readonly opaque: boolean;
  isSameOrigin(other: OriginInstanceLike): boolean;
}

interface OriginConstructorLike {
  new (): OriginInstanceLike;
  from(value: unknown): OriginInstanceLike;
}

const INSPECTOR_NAMESPACE = 'ONTO_PROTO_INSPECTOR';

const INSPECTOR_SCRIPT_RE =
  /<script\b[^>]*\bdata-onto-visual-inspector=["']1["'][^>]*>[\s\S]*?<\/script>\s*/gi;

export function stripVisualInspectorFromHtml(html: string): string {
  if (!html) return '';
  return html.replace(INSPECTOR_SCRIPT_RE, '');
}

export function resolveParentTargetOrigin(): string {
  if (typeof window === 'undefined') return '*';
  const origin = window.location?.origin;
  if (!origin || origin === 'null' || origin.startsWith('file:')) {
    return '*';
  }
  return origin;
}

/**
 * Validates cross-document messages from the `<iframe sandbox="allow-scripts">` preview.
 * Uses the `Origin` API (`Origin.from(event)` opaque origin pinning) when available,
 * and falls back to `event.source === expectedWindow` + per-instance token matching
 * without ever comparing serialized `"null"` origin strings.
 */
export function createSandboxOriginValidator() {
  const OriginCtor = (globalThis as unknown as { Origin?: OriginConstructorLike }).Origin;
  let pinnedSandboxOrigin: OriginInstanceLike | null = OriginCtor ? new OriginCtor() : null;
  let isPinned = false;

  return {
    reset() {
      pinnedSandboxOrigin = OriginCtor ? new OriginCtor() : null;
      isPinned = false;
    },
    verify(
      event: MessageEvent,
      expectedWindow: WindowProxy | null | undefined,
      expectedToken: string,
    ): boolean {
      if (!expectedWindow || event.source !== expectedWindow) {
        return false;
      }
      const data = event.data as Record<string, unknown> | null;
      if (
        !data ||
        typeof data !== 'object' ||
        data.namespace !== INSPECTOR_NAMESPACE ||
        typeof data.token !== 'string' ||
        data.token !== expectedToken
      ) {
        return false;
      }

      if (OriginCtor && pinnedSandboxOrigin) {
        try {
          const senderOrigin = OriginCtor.from(event);
          if (!isPinned) {
            pinnedSandboxOrigin = senderOrigin;
            isPinned = true;
          }
          return senderOrigin.isSameOrigin(pinnedSandboxOrigin);
        } catch {
          // Synthetic MessageEvent instances in unit tests lack internal browser origin slots;
          // event.source === expectedWindow + secret channelToken already verified above.
          return true;
        }
      }

      return true;
    },
  };
}

function cleanShortString(val: unknown, maxLen: number): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

export function sanitizeInspectorSelectionPayload(raw: unknown): PrototypeSelectionTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind === 'REGION' ? 'REGION' : obj.kind === 'ELEMENT' ? 'ELEMENT' : null;
  const cssSelector = cleanShortString(obj.cssSelector, 260);
  if (!kind || !cssSelector) return null;

  const rectRaw = obj.rect as Record<string, unknown> | undefined;
  if (!rectRaw || typeof rectRaw !== 'object') return null;
  const x = Number(rectRaw.x);
  const y = Number(rectRaw.y);
  const width = Number(rectRaw.width);
  const height = Number(rectRaw.height);
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;

  const tagName = cleanShortString(obj.tagName, 32)?.toLowerCase() || 'div';
  const label = cleanShortString(obj.label, 80) || `<${tagName}>`;
  const textPreview = cleanShortString(obj.textPreview, 140) || '';
  const htmlSnippet =
    typeof obj.htmlSnippet === 'string' ? obj.htmlSnippet.trim().slice(0, 700) : '';

  const screenId = cleanShortString(obj.screenId, 80);
  const screenName = cleanShortString(obj.screenName, 80);
  const elementId = cleanShortString(obj.elementId, 80);
  const elementType = cleanShortString(obj.elementType, 40);
  const binding = cleanShortString(obj.binding, 100);
  const eventId = cleanShortString(obj.eventId, 80);
  const matchedElementCount =
    typeof obj.matchedElementCount === 'number' && Number.isFinite(obj.matchedElementCount)
      ? Math.max(1, Math.min(50, Math.round(obj.matchedElementCount)))
      : undefined;
  const matchedElementsSummary = Array.isArray(obj.matchedElementsSummary)
    ? obj.matchedElementsSummary
        .map((item) => cleanShortString(item, 100))
        .filter((item): item is string => Boolean(item))
        .slice(0, 8)
    : undefined;

  return {
    kind,
    tagName,
    cssSelector,
    label,
    textPreview,
    htmlSnippet,
    ...(screenId ? { screenId } : {}),
    ...(screenName ? { screenName } : {}),
    ...(elementId ? { elementId } : {}),
    ...(elementType ? { elementType } : {}),
    ...(binding ? { binding } : {}),
    ...(eventId ? { eventId } : {}),
    ...(matchedElementCount ? { matchedElementCount } : {}),
    ...(matchedElementsSummary && matchedElementsSummary.length > 0
      ? { matchedElementsSummary }
      : {}),
    rect: {
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: Math.max(8, width),
      height: Math.max(8, height),
    },
  };
}

const ALLOWED_CROP_MIME_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg']);
const MAX_CROP_BASE64_LENGTH = 3_500_000;

export function sanitizeInspectorCropPayload(raw: unknown): PrototypeSelectionCropPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const rawData = typeof obj.dataBase64 === 'string' ? obj.dataBase64.trim() : '';
  if (!rawData || rawData.length > MAX_CROP_BASE64_LENGTH) return null;

  let mimeType = typeof obj.mimeType === 'string' ? obj.mimeType.trim().toLowerCase() : '';
  let cleanBase64 = rawData;
  const dataUriMatch = /^data:([^;]+);base64,([\s\S]+)$/i.exec(rawData);
  if (dataUriMatch) {
    if (!mimeType) mimeType = dataUriMatch[1]!.trim().toLowerCase();
    cleanBase64 = dataUriMatch[2]!;
  }
  cleanBase64 = cleanBase64.replace(/\s+/g, '');
  if (!cleanBase64 || !ALLOWED_CROP_MIME_TYPES.has(mimeType)) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) return null;

  const width = Number(obj.width);
  const height = Number(obj.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    mimeType,
    dataBase64: cleanBase64,
    width: Math.max(1, Math.min(2400, Math.round(width))),
    height: Math.max(1, Math.min(2400, Math.round(height))),
  };
}

function summarizeAnchorText(anchor: PrototypeTargetAnchor | null | undefined): string {
  if (!anchor) return '';
  if (anchor.screenId && anchor.elementId) {
    return `${anchor.screenId} · ${anchor.elementId}`;
  }
  return anchor.elementId || anchor.screenId || anchor.cssSelector || anchor.label || '';
}

export function computeFloatingPopoverPosition(
  rect: PrototypeSelectionRect,
  stageSize: { width: number; height: number },
  bannerOffset = 0,
): { left: number; top: number } {
  const stageW = Math.max(320, stageSize.width || 680);
  const stageH = Math.max(320, stageSize.height || 560);
  const popW = Math.min(388, stageW - 24);
  const estimatedPopH = 178;
  const pad = 12;

  const anchorLeft = rect.x;
  const left = Math.min(Math.max(pad, anchorLeft), Math.max(pad, stageW - popW - pad));

  const targetTopInStage = rect.y + bannerOffset;
  const targetBottomInStage = rect.y + rect.height + bannerOffset;

  let top = targetBottomInStage + 8;
  if (top + estimatedPopH > stageH - pad) {
    const flippedAbove = targetTopInStage - estimatedPopH - 8;
    if (flippedAbove >= bannerOffset + pad) {
      top = flippedAbove;
    } else {
      top = Math.max(bannerOffset + pad, stageH - estimatedPopH - pad);
    }
  }

  return {
    left: Math.round(left),
    top: Math.round(top),
  };
}

export function toRefinementSelections(
  annotations: PrototypeVisualAnnotation[],
  activeDraft?: { target: PrototypeSelectionTarget; note: string } | null,
): PrototypeRefinementSelection[] {
  const list: PrototypeRefinementSelection[] = annotations.map((ann) => ({
    kind: ann.target.kind,
    cssSelector: ann.target.cssSelector,
    tagName: ann.target.tagName,
    label: ann.target.label,
    ...(ann.target.screenId ? { screenId: ann.target.screenId } : {}),
    ...(ann.target.elementId ? { elementId: ann.target.elementId } : {}),
    ...(ann.target.binding ? { binding: ann.target.binding } : {}),
    ...(ann.target.eventId ? { eventId: ann.target.eventId } : {}),
    ...(ann.target.htmlSnippet ? { htmlSnippet: ann.target.htmlSnippet } : {}),
    ...(ann.target.matchedElementsSummary
      ? { matchedElementsSummary: ann.target.matchedElementsSummary }
      : {}),
    ...(ann.note.trim() ? { note: ann.note.trim() } : {}),
  }));

  if (activeDraft) {
    const t = activeDraft.target;
    const isDuplicate = annotations.some(
      (a) =>
        a.target.cssSelector === t.cssSelector &&
        a.target.kind === t.kind &&
        a.target.elementId === t.elementId,
    );
    if (!isDuplicate) {
      list.push({
        kind: t.kind,
        cssSelector: t.cssSelector,
        tagName: t.tagName,
        label: t.label,
        ...(t.screenId ? { screenId: t.screenId } : {}),
        ...(t.elementId ? { elementId: t.elementId } : {}),
        ...(t.binding ? { binding: t.binding } : {}),
        ...(t.eventId ? { eventId: t.eventId } : {}),
        ...(t.htmlSnippet ? { htmlSnippet: t.htmlSnippet } : {}),
        ...(t.matchedElementsSummary ? { matchedElementsSummary: t.matchedElementsSummary } : {}),
        ...(activeDraft.note.trim() ? { note: activeDraft.note.trim() } : {}),
      });
    }
  }

  return list;
}

export function injectVisualInspectorIntoHtml(
  rawHtml: string,
  options: {
    token: string;
    targetOrigin: string;
    initialActive: boolean;
    locale: 'zh-CN' | 'en-US';
  },
): string {
  const cleanHtml = stripVisualInspectorFromHtml(rawHtml);
  if (!cleanHtml.trim()) return '';

  const serializedConfig = JSON.stringify({
    namespace: INSPECTOR_NAMESPACE,
    token: options.token,
    targetOrigin: options.targetOrigin,
    initialActive: options.initialActive,
    locale: options.locale,
  }).replace(/</g, '\\u003c');

  const scriptTag = `<script data-onto-visual-inspector="1">
(function () {
  var CFG = ${serializedConfig};
  if (window.__ONTO_VISUAL_INSPECTOR_BOOTED__) return;
  window.__ONTO_VISUAL_INSPECTOR_BOOTED__ = true;

  var isActive = Boolean(CFG.initialActive);
  var pointerDown = false;
  var isDragging = false;
  var suppressNextClick = false;
  var startX = 0;
  var startY = 0;
  var activeElements = [];
  var pins = [];
  var highlightedSelector = '';
  var activeRunningAnchor = null;
  var flashedAnchors = [];
  var flashKey = '';
  var lastFlashedKey = '';
  var rafPending = false;

  function postToHost(type, extra) {
    if (!window.parent || window.parent === window) return;
    var payload = { namespace: CFG.namespace, token: CFG.token, type: type };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
      }
    }
    window.parent.postMessage(payload, CFG.targetOrigin || '*');
  }

  var styleEl = document.createElement('style');
  styleEl.setAttribute('data-onto-inspector-ignore', '1');
  styleEl.textContent = [
    'html[data-onto-inspecting="1"], html[data-onto-inspecting="1"] * { cursor: crosshair !important; user-select: none !important; -webkit-user-select: none !important; }',
    '.onto-vi-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483640; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "IBM Plex Sans", "Noto Sans SC", sans-serif; }',
    '.onto-vi-hover { position: fixed; left: var(--vi-x, 0px); top: var(--vi-y, 0px); width: var(--vi-w, 0px); height: var(--vi-h, 0px); border: 1.5px dashed #4c50c4; background: rgba(76, 80, 196, 0.06); border-radius: 5px; box-sizing: border-box; display: none; transition: all 60ms cubic-bezier(0.22, 1, 0.36, 1); }',
    '.onto-vi-selected { position: fixed; left: var(--vi-x, 0px); top: var(--vi-y, 0px); width: var(--vi-w, 0px); height: var(--vi-h, 0px); border: 2px solid #4c50c4; background: rgba(76, 80, 196, 0.10); box-shadow: 0 0 0 3px rgba(76, 80, 196, 0.16); border-radius: 6px; box-sizing: border-box; display: none; }',
    '.onto-vi-marquee { position: fixed; left: var(--vi-x, 0px); top: var(--vi-y, 0px); width: var(--vi-w, 0px); height: var(--vi-h, 0px); border: 1.5px solid #4c50c4; background: rgba(76, 80, 196, 0.13); border-radius: 4px; box-sizing: border-box; display: none; }',
    '.onto-vi-highlight { position: fixed; left: var(--vi-x, 0px); top: var(--vi-y, 0px); width: var(--vi-w, 0px); height: var(--vi-h, 0px); border: 2px solid #4c50c4; background: rgba(76, 80, 196, 0.09); border-radius: 6px; box-sizing: border-box; display: none; pointer-events: none; }',
    '.onto-vi-running { position: fixed; left: var(--vi-x, 0px); top: var(--vi-y, 0px); width: var(--vi-w, 0px); height: var(--vi-h, 0px); border: 2px solid #4c50c4; background: rgba(76, 80, 196, 0.12); box-shadow: 0 0 0 4px rgba(76, 80, 196, 0.22); border-radius: 6px; box-sizing: border-box; display: none; pointer-events: none; animation: onto-vi-running-pulse 1.3s ease-in-out infinite; }',
    '.onto-vi-flash { position: fixed; left: var(--vi-x, 0px); top: var(--vi-y, 0px); width: var(--vi-w, 0px); height: var(--vi-h, 0px); border: 2px solid #2e7d5b; background: rgba(46, 125, 91, 0.16); border-radius: 6px; box-sizing: border-box; pointer-events: none; animation: onto-vi-flash-once 1.7s cubic-bezier(0.22, 1, 0.36, 1) 1 forwards; }',
    '.onto-vi-tag { position: absolute; left: -1px; top: -22px; max-width: 320px; padding: 2px 6px; border-radius: 4px; background: #4c50c4; color: #ffffff; font-size: 10.5px; font-weight: 600; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 2px 6px rgba(26, 26, 24, 0.18); }',
    '.onto-vi-tag.is-inside { top: 4px; left: 4px; }',
    '.onto-vi-pin { position: fixed; left: var(--vi-x, 0px); top: var(--vi-y, 0px); min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: #4c50c4; color: #ffffff; border: 2px solid #fdfdfb; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(26, 26, 24, 0.25); transform: translate(-35%, -35%); }',
    '@keyframes onto-vi-running-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.48; } }',
    '@keyframes onto-vi-flash-once { 0% { opacity: 0.96; box-shadow: 0 0 0 0 rgba(46, 125, 91, 0.42); } 45% { opacity: 1; box-shadow: 0 0 0 8px rgba(46, 125, 91, 0.16); } 100% { opacity: 0; box-shadow: 0 0 0 12px rgba(46, 125, 91, 0); } }',
    '@media (prefers-reduced-motion: reduce) { .onto-vi-hover { transition: none; } .onto-vi-running, .onto-vi-flash { animation: none; } }'
  ].join('\\n');

  var rootEl = document.createElement('div');
  rootEl.className = 'onto-vi-root';
  rootEl.setAttribute('data-onto-inspector-ignore', '1');
  rootEl.setAttribute('aria-hidden', 'true');

  var hoverBox = document.createElement('div');
  hoverBox.className = 'onto-vi-hover';
  var hoverTag = document.createElement('span');
  hoverTag.className = 'onto-vi-tag';
  hoverBox.appendChild(hoverTag);

  var selectedBox = document.createElement('div');
  selectedBox.className = 'onto-vi-selected';
  var selectedTag = document.createElement('span');
  selectedTag.className = 'onto-vi-tag';
  selectedBox.appendChild(selectedTag);

  var marqueeBox = document.createElement('div');
  marqueeBox.className = 'onto-vi-marquee';

  var highlightBox = document.createElement('div');
  highlightBox.className = 'onto-vi-highlight';

  var runningBox = document.createElement('div');
  runningBox.className = 'onto-vi-running';
  var runningTag = document.createElement('span');
  runningTag.className = 'onto-vi-tag';
  runningBox.appendChild(runningTag);

  var flashLayer = document.createElement('div');
  flashLayer.setAttribute('data-onto-inspector-ignore', '1');

  var pinsLayer = document.createElement('div');
  pinsLayer.setAttribute('data-onto-inspector-ignore', '1');

  rootEl.appendChild(hoverBox);
  rootEl.appendChild(selectedBox);
  rootEl.appendChild(marqueeBox);
  rootEl.appendChild(highlightBox);
  rootEl.appendChild(runningBox);
  rootEl.appendChild(flashLayer);
  rootEl.appendChild(pinsLayer);

  function mountOverlay() {
    if (!styleEl.parentNode && (document.head || document.documentElement)) {
      (document.head || document.documentElement).appendChild(styleEl);
    }
    if (!rootEl.parentNode && (document.body || document.documentElement)) {
      (document.body || document.documentElement).appendChild(rootEl);
    }
    syncRootModeAttr();
  }

  function syncRootModeAttr() {
    if (!document.documentElement) return;
    if (isActive) {
      document.documentElement.setAttribute('data-onto-inspecting', '1');
    } else {
      document.documentElement.removeAttribute('data-onto-inspecting');
      hoverBox.style.display = 'none';
      marqueeBox.style.display = 'none';
    }
  }

  function setBoxVars(box, tagEl, rect, labelText) {
    box.style.setProperty('--vi-x', Math.round(rect.left) + 'px');
    box.style.setProperty('--vi-y', Math.round(rect.top) + 'px');
    box.style.setProperty('--vi-w', Math.max(4, Math.round(rect.width)) + 'px');
    box.style.setProperty('--vi-h', Math.max(4, Math.round(rect.height)) + 'px');
    if (tagEl && typeof labelText === 'string') {
      tagEl.textContent = labelText;
      if (rect.top < 26) tagEl.classList.add('is-inside');
      else tagEl.classList.remove('is-inside');
    }
  }

  function isIgnored(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el === document.documentElement || el === document.body) return true;
    var tag = el.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD' || tag === 'META' || tag === 'LINK') return true;
    if (el.closest && el.closest('[data-onto-inspector-ignore="1"]')) return true;
    return false;
  }

  function resolveTargetAtPoint(cx, cy) {
    var raw = document.elementFromPoint(cx, cy);
    if (!raw || isIgnored(raw)) return null;
    var el = raw;
    if (el.namespaceURI === 'http://www.w3.org/2000/svg' && el.closest) {
      var hostCtrl = el.closest('button, a, label, [data-element-id]');
      el = hostCtrl || el.closest('svg') || el;
    }
    var inlineTags = { SPAN: 1, STRONG: 1, EM: 1, B: 1, I: 1, SMALL: 1, CODE: 1 };
    if (inlineTags[el.tagName.toUpperCase()] && !el.hasAttribute('data-element-id') && el.parentElement && !isIgnored(el.parentElement)) {
      var pTag = el.parentElement.tagName.toUpperCase();
      if (pTag === 'BUTTON' || pTag === 'A' || pTag === 'LABEL' || pTag === 'TH' || el.parentElement.hasAttribute('data-element-id')) {
        el = el.parentElement;
      }
    }
    return isIgnored(el) ? null : el;
  }

  function escapeAttr(v) {
    return String(v).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  }

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return 'body';
    var dataElId = el.getAttribute('data-element-id');
    if (dataElId) return el.tagName.toLowerCase() + '[data-element-id="' + escapeAttr(dataElId) + '"]';
    if (el.id) {
      return '#' + (window.CSS && window.CSS.escape ? window.CSS.escape(el.id) : escapeAttr(el.id));
    }
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && depth < 5) {
      var scrId = cur.getAttribute('data-screen-id');
      if (scrId) {
        parts.unshift('[data-screen-id="' + escapeAttr(scrId) + '"]');
        break;
      }
      var curElId = cur.getAttribute('data-element-id');
      if (curElId) {
        parts.unshift(cur.tagName.toLowerCase() + '[data-element-id="' + escapeAttr(curElId) + '"]');
        break;
      }
      var tag = cur.tagName.toLowerCase();
      var parent = cur.parentElement;
      if (parent) {
        var siblings = [];
        for (var i = 0; i < parent.children.length; i++) {
          var sib = parent.children[i];
          if (!isIgnored(sib) && sib.tagName === cur.tagName) siblings.push(sib);
        }
        if (siblings.length > 1) {
          tag += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
        }
      }
      parts.unshift(tag);
      cur = parent;
      depth++;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  function cleanText(s) {
    return String(s || '').replace(/\\s+/g, ' ').trim();
  }

  function describeElementBadge(el) {
    var screenEl = el.closest ? el.closest('[data-screen-id]') : null;
    var screenId = screenEl ? screenEl.getAttribute('data-screen-id') : '';
    var anchorEl = (el.closest && el.closest('[data-element-id]')) || el;
    var elId = el.getAttribute('data-element-id') || (anchorEl ? anchorEl.getAttribute('data-element-id') : '');
    var binding = el.getAttribute('data-binding') || (anchorEl ? anchorEl.getAttribute('data-binding') : '');
    var label = el.getAttribute('data-element-label') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || cleanText(el.textContent).slice(0, 22);
    var segs = [];
    if (screenId) segs.push(screenId);
    if (elId) segs.push(elId);
    else segs.push('<' + el.tagName.toLowerCase() + '>');
    if (binding) segs.push(binding);
    else if (label) segs.push(label);
    return segs.join(' · ');
  }

  function buildElementSelection(el) {
    var r = el.getBoundingClientRect();
    var screenEl = el.closest ? el.closest('[data-screen-id]') : null;
    var anchorEl = (el.closest && el.closest('[data-element-id]')) || el;
    var screenId = screenEl ? screenEl.getAttribute('data-screen-id') : undefined;
    var screenName = screenEl ? screenEl.getAttribute('data-screen-name') : undefined;
    var elementId = el.getAttribute('data-element-id') || (anchorEl ? anchorEl.getAttribute('data-element-id') : undefined);
    var elementType = el.getAttribute('data-element-type') || (anchorEl ? anchorEl.getAttribute('data-element-type') : undefined);
    var binding = el.getAttribute('data-binding') || (anchorEl ? anchorEl.getAttribute('data-binding') : undefined);
    var eventHost = el.closest ? el.closest('[data-event-id]') : null;
    var eventId = el.getAttribute('data-event-id') || (eventHost ? eventHost.getAttribute('data-event-id') : undefined);
    var textPreview = cleanText(el.textContent).slice(0, 90);
    var label =
      el.getAttribute('data-element-label') ||
      (anchorEl && anchorEl.getAttribute('data-element-label')) ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      textPreview.slice(0, 28) ||
      '<' + el.tagName.toLowerCase() + '>';

    return {
      kind: 'ELEMENT',
      tagName: el.tagName.toLowerCase(),
      cssSelector: buildSelector(el),
      label: label,
      textPreview: textPreview,
      htmlSnippet: String(el.outerHTML || '').slice(0, 560),
      screenId: screenId || undefined,
      screenName: screenName || undefined,
      elementId: elementId || undefined,
      elementType: elementType || undefined,
      binding: binding || undefined,
      eventId: eventId || undefined,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height }
    };
  }

  function computeUnionRect(els) {
    var minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.left < minL) minL = r.left;
      if (r.top < minT) minT = r.top;
      if (r.right > maxR) maxR = r.right;
      if (r.bottom > maxB) maxB = r.bottom;
    }
    if (!isFinite(minL)) return null;
    return { left: minL, top: minT, width: Math.max(8, maxR - minL), height: Math.max(8, maxB - minT) };
  }

  function findRegionMatches(box) {
    var candidates = document.querySelectorAll(
      '[data-element-id], button, input, select, textarea, a, table, h1, h2, h3, h4, [role="button"]'
    );
    var hits = [];
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (isIgnored(el)) continue;
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      var ix1 = Math.max(box.left, r.left);
      var iy1 = Math.max(box.top, r.top);
      var ix2 = Math.min(box.right, r.right);
      var iy2 = Math.min(box.bottom, r.bottom);
      if (ix2 <= ix1 || iy2 <= iy1) continue;
      var interArea = (ix2 - ix1) * (iy2 - iy1);
      var elArea = r.width * r.height;
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var centerInside = cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom;
      if (centerInside || interArea / elArea >= 0.35) {
        hits.push(el);
      }
    }
    var filtered = [];
    for (var j = 0; j < hits.length; j++) {
      var candidate = hits[j];
      var hasSpecificDescendant = false;
      for (var k = 0; k < hits.length; k++) {
        if (j !== k && candidate.contains(hits[k]) && !candidate.hasAttribute('data-element-id')) {
          hasSpecificDescendant = true;
          break;
        }
      }
      if (!hasSpecificDescendant) filtered.push(candidate);
    }
    return filtered;
  }

  function renderPinsAndSelection() {
    rafPending = false;
    if (activeElements.length > 0) {
      var u = computeUnionRect(activeElements);
      if (u) {
        setBoxVars(selectedBox, selectedTag, u, selectedTag.textContent || '');
        selectedBox.style.display = 'block';
        postToHost('SELECTION_RECT', {
          rect: { x: u.left, y: u.top, width: u.width, height: u.height }
        });
      }
    } else {
      selectedBox.style.display = 'none';
    }

    while (pinsLayer.firstChild) {
      pinsLayer.removeChild(pinsLayer.firstChild);
    }
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      var target = null;
      if (p.elementId) {
        target = document.querySelector('[data-element-id="' + escapeAttr(p.elementId) + '"]');
      }
      if (!target && p.cssSelector) {
        try { target = document.querySelector(p.cssSelector); } catch (_e) {}
      }
      if (!target) continue;
      var tr = target.getBoundingClientRect();
      if (tr.width <= 0 && tr.height <= 0) continue;
      var badge = document.createElement('span');
      badge.className = 'onto-vi-pin';
      badge.textContent = String(p.index);
      badge.style.setProperty('--vi-x', Math.max(10, Math.round(tr.left)) + 'px');
      badge.style.setProperty('--vi-y', Math.max(10, Math.round(tr.top)) + 'px');
      pinsLayer.appendChild(badge);
    }

    if (highlightedSelector) {
      var hlTarget = resolveAnchorTarget(highlightedSelector);
      if (hlTarget) {
        var hlr = hlTarget.getBoundingClientRect();
        if (hlr.width > 0 && hlr.height > 0) {
          setBoxVars(highlightBox, null, hlr, '');
          highlightBox.style.display = 'block';
        } else {
          highlightBox.style.display = 'none';
        }
      } else {
        highlightBox.style.display = 'none';
      }
    } else {
      highlightBox.style.display = 'none';
    }

    if (activeRunningAnchor) {
      var runTarget = resolveAnchorTarget(activeRunningAnchor);
      if (runTarget) {
        var rr = runTarget.getBoundingClientRect();
        if (rr.width > 0 && rr.height > 0) {
          var anchorText = formatAnchorShort(activeRunningAnchor);
          var prefix = CFG.locale === 'en-US' ? 'Modifying...' : 'Agent 正在修改';
          setBoxVars(
            runningBox,
            runningTag,
            rr,
            anchorText ? (prefix + ' · ' + anchorText) : prefix
          );
          runningBox.style.display = 'block';
        } else {
          runningBox.style.display = 'none';
        }
      } else {
        runningBox.style.display = 'none';
      }
    } else {
      runningBox.style.display = 'none';
    }

    if (flashKey && flashKey !== lastFlashedKey && Array.isArray(flashedAnchors) && flashedAnchors.length > 0) {
      lastFlashedKey = flashKey;
      while (flashLayer.firstChild) {
        flashLayer.removeChild(flashLayer.firstChild);
      }
      for (var f = 0; f < flashedAnchors.length; f++) {
        var fTarget = resolveAnchorTarget(flashedAnchors[f]);
        if (!fTarget) continue;
        var fr = fTarget.getBoundingClientRect();
        if (fr.width <= 0 || fr.height <= 0) continue;
        var fBox = document.createElement('div');
        fBox.className = 'onto-vi-flash';
        setBoxVars(fBox, null, fr, '');
        flashLayer.appendChild(fBox);
      }
      setTimeout(function () {
        while (flashLayer.firstChild) {
          flashLayer.removeChild(flashLayer.firstChild);
        }
      }, 1900);
    }
  }

  function formatAnchorShort(anchor) {
    if (!anchor || typeof anchor !== 'object') return '';
    if (anchor.screenId && anchor.elementId) return anchor.screenId + ' · ' + anchor.elementId;
    return anchor.elementId || anchor.screenId || anchor.cssSelector || anchor.label || '';
  }

  function resolveAnchorTarget(anchorOrSelector) {
    if (!anchorOrSelector) return null;
    if (typeof anchorOrSelector === 'string') {
      try {
        return (
          document.querySelector('[data-element-id="' + escapeAttr(anchorOrSelector) + '"]') ||
          document.querySelector('[data-screen-id="' + escapeAttr(anchorOrSelector) + '"]') ||
          document.querySelector(anchorOrSelector)
        );
      } catch (_err) {
        return null;
      }
    }
    if (typeof anchorOrSelector === 'object') {
      var scr = anchorOrSelector.screenId ? String(anchorOrSelector.screenId) : '';
      var elId = anchorOrSelector.elementId ? String(anchorOrSelector.elementId) : '';
      var sel = anchorOrSelector.cssSelector ? String(anchorOrSelector.cssSelector) : '';
      try {
        if (scr && elId) {
          var scoped = document.querySelector(
            '[data-screen-id="' + escapeAttr(scr) + '"] [data-element-id="' + escapeAttr(elId) + '"]'
          );
          if (scoped) return scoped;
        }
        if (elId) {
          var byEl = document.querySelector('[data-element-id="' + escapeAttr(elId) + '"]');
          if (byEl) return byEl;
        }
        if (sel) {
          var bySel = document.querySelector(sel);
          if (bySel) return bySel;
        }
        if (scr) {
          var byScr = document.querySelector('[data-screen-id="' + escapeAttr(scr) + '"]');
          if (byScr) return byScr;
        }
      } catch (_err2) {
        return null;
      }
    }
    return null;
  }

  function resolveOpaqueAncestorBg(el) {
    var cur = el;
    while (cur && cur.nodeType === 1) {
      var bg = window.getComputedStyle(cur).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
      cur = cur.parentElement;
    }
    return '#f7f5f0';
  }

  function encodeCanvasCrop(canvas, w, h) {
    try {
      var dataUrl = canvas.toDataURL('image/webp', 0.84);
      var mime = 'image/webp';
      if (!dataUrl || dataUrl.indexOf('data:image/webp') !== 0) {
        dataUrl = canvas.toDataURL('image/png');
        mime = 'image/png';
      }
      var comma = dataUrl.indexOf(',');
      if (comma < 0) return null;
      return {
        mimeType: mime,
        dataBase64: dataUrl.slice(comma + 1),
        width: w,
        height: h
      };
    } catch (_encErr) {
      return null;
    }
  }

  function renderDirectCanvasCrop(els, rectObj) {
    if (!els || els.length === 0 || !rectObj) return null;
    var pad = 4;
    var rx = Math.max(0, Math.round(rectObj.x - pad));
    var ry = Math.max(0, Math.round(rectObj.y - pad));
    var rw = Math.max(24, Math.round(rectObj.width + pad * 2));
    var rh = Math.max(24, Math.round(rectObj.height + pad * 2));
    var maxEdge = 560;
    var scale = Math.max(rw, rh) > maxEdge ? maxEdge / Math.max(rw, rh) : 1;
    var cw = Math.max(24, Math.round(rw * scale));
    var ch = Math.max(24, Math.round(rh * scale));

    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.scale(scale, scale);
    ctx.fillStyle = resolveOpaqueAncestorBg(els[0]);
    ctx.fillRect(0, 0, rw, rh);

    var queue = [];
    for (var i = 0; i < els.length; i++) {
      queue.push(els[i]);
      if (els[i].querySelectorAll) {
        var desc = els[i].querySelectorAll('*');
        for (var d = 0; d < desc.length && queue.length < 48; d++) {
          if (!isIgnored(desc[d])) queue.push(desc[d]);
        }
      }
    }

    for (var q = 0; q < queue.length; q++) {
      var node = queue[q];
      var nr = node.getBoundingClientRect();
      if (nr.width < 2 || nr.height < 2) continue;
      var st = window.getComputedStyle(node);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
      var lx = nr.left - rx;
      var ly = nr.top - ry;
      var bg = st.backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        ctx.fillStyle = bg;
        ctx.fillRect(lx, ly, nr.width, nr.height);
      }
      var bw = parseFloat(st.borderTopWidth || '0');
      if (bw > 0 && st.borderTopColor && st.borderTopColor !== 'transparent') {
        ctx.strokeStyle = st.borderTopColor;
        ctx.lineWidth = Math.min(3, bw);
        ctx.strokeRect(lx, ly, nr.width, nr.height);
      }
      if (node.children.length === 0) {
        var txt = cleanText(node.textContent || node.value || node.getAttribute('placeholder') || '');
        if (txt) {
          ctx.fillStyle = st.color || '#1a1a18';
          var fs = Math.max(10, Math.min(22, parseFloat(st.fontSize || '13')));
          ctx.font = (st.fontWeight || '500') + ' ' + fs + 'px sans-serif';
          ctx.textBaseline = 'middle';
          ctx.fillText(txt.slice(0, 36), lx + 6, ly + nr.height / 2, Math.max(16, nr.width - 12));
        }
      }
    }

    return encodeCanvasCrop(canvas, cw, ch);
  }

  function cloneWithInlineStyles(srcEl, budget) {
    if (!srcEl || srcEl.nodeType !== 1 || budget.count > 90) return null;
    var tag = srcEl.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME') return null;
    budget.count++;
    if (tag === 'IMG') {
      var ph = document.createElement('div');
      var ir = srcEl.getBoundingClientRect();
      ph.style.width = Math.max(8, Math.round(ir.width)) + 'px';
      ph.style.height = Math.max(8, Math.round(ir.height)) + 'px';
      ph.style.background = '#ece9e1';
      return ph;
    }
    var clone = srcEl.cloneNode(false);
    var cs = window.getComputedStyle(srcEl);
    var props = ['display', 'boxSizing', 'backgroundColor', 'color', 'border', 'borderRadius', 'padding', 'margin', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'textAlign', 'gap', 'alignItems', 'justifyContent', 'flexDirection'];
    for (var p = 0; p < props.length; p++) {
      var k = props[p];
      if (cs[k]) clone.style[k] = cs[k];
    }
    for (var c = 0; c < srcEl.childNodes.length; c++) {
      var child = srcEl.childNodes[c];
      if (child.nodeType === 3) {
        clone.appendChild(document.createTextNode(child.textContent || ''));
      } else if (child.nodeType === 1 && !isIgnored(child)) {
        var cc = cloneWithInlineStyles(child, budget);
        if (cc) clone.appendChild(cc);
      }
    }
    return clone;
  }

  function captureSelectionCrop(els, rectObj, cssSelector) {
    var immediateCrop = renderDirectCanvasCrop(els, rectObj);
    try {
      if (els && els.length === 1 && rectObj && typeof XMLSerializer !== 'undefined') {
        var w = Math.max(24, Math.min(560, Math.round(rectObj.width)));
        var h = Math.max(24, Math.min(360, Math.round(rectObj.height)));
        var cloned = cloneWithInlineStyles(els[0], { count: 0 });
        if (cloned) {
          cloned.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
          cloned.style.margin = '0';
          var serialized = new XMLSerializer().serializeToString(cloned);
          var bg = resolveOpaqueAncestorBg(els[0]);
          var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
            '<rect width="100%" height="100%" fill="' + escapeAttr(bg) + '"/>' +
            '<foreignObject width="100%" height="100%">' + serialized + '</foreignObject></svg>';
          var img = new Image();
          img.onload = function () {
            var c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            var cx = c.getContext('2d');
            if (!cx) return;
            cx.drawImage(img, 0, 0, w, h);
            var upgraded = encodeCanvasCrop(c, w, h);
            if (upgraded && cssSelector) {
              postToHost('SELECTION_CROP', { cssSelector: cssSelector, crop: upgraded });
            }
          };
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        }
      }
    } catch (_foErr) {}
    return immediateCrop;
  }

  function scheduleSyncVisuals() {
    if (rafPending) return;
    rafPending = true;
    window.requestAnimationFrame(renderPinsAndSelection);
  }

  document.addEventListener('pointerdown', function (e) {
    if (!isActive || e.button !== 0) return;
    pointerDown = true;
    isDragging = false;
    startX = e.clientX;
    startY = e.clientY;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.addEventListener('pointermove', function (e) {
    if (!isActive) return;
    if (pointerDown) {
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (!isDragging && Math.hypot(dx, dy) >= 6) {
        isDragging = true;
        hoverBox.style.display = 'none';
      }
      if (isDragging) {
        var left = Math.min(startX, e.clientX);
        var top = Math.min(startY, e.clientY);
        var width = Math.abs(dx);
        var height = Math.abs(dy);
        setBoxVars(marqueeBox, null, { left: left, top: top, width: width, height: height }, '');
        marqueeBox.style.display = 'block';
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    var hovered = resolveTargetAtPoint(e.clientX, e.clientY);
    if (!hovered) {
      hoverBox.style.display = 'none';
      return;
    }
    var hr = hovered.getBoundingClientRect();
    setBoxVars(hoverBox, hoverTag, hr, describeElementBadge(hovered));
    hoverBox.style.display = 'block';
  }, true);

  document.addEventListener('pointerup', function (e) {
    if (!isActive || !pointerDown) return;
    pointerDown = false;
    suppressNextClick = true;
    marqueeBox.style.display = 'none';
    e.preventDefault();
    e.stopPropagation();

    if (!isDragging) {
      var clicked = resolveTargetAtPoint(e.clientX, e.clientY);
      if (!clicked) return;
      activeElements = [clicked];
      var sel = buildElementSelection(clicked);
      setBoxVars(selectedBox, selectedTag, clicked.getBoundingClientRect(), describeElementBadge(clicked));
      selectedBox.style.display = 'block';
      hoverBox.style.display = 'none';
      var clickedCrop = captureSelectionCrop([clicked], sel.rect, sel.cssSelector);
      postToHost('SELECT', { selection: sel, crop: clickedCrop });
      return;
    }

    isDragging = false;
    var box = {
      left: Math.min(startX, e.clientX),
      top: Math.min(startY, e.clientY),
      right: Math.max(startX, e.clientX),
      bottom: Math.max(startY, e.clientY)
    };
    var matches = findRegionMatches(box);
    if (matches.length === 0) {
      var centerTarget = resolveTargetAtPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
      if (centerTarget) matches = [centerTarget];
    }
    if (matches.length === 0) return;

    if (matches.length === 1) {
      var single = matches[0];
      activeElements = [single];
      var singleSel = buildElementSelection(single);
      setBoxVars(selectedBox, selectedTag, single.getBoundingClientRect(), describeElementBadge(single));
      selectedBox.style.display = 'block';
      var singleCrop = captureSelectionCrop([single], singleSel.rect, singleSel.cssSelector);
      postToHost('SELECT', { selection: singleSel, crop: singleCrop });
      return;
    }

    activeElements = matches;
    var union = computeUnionRect(matches) || {
      left: box.left,
      top: box.top,
      width: box.right - box.left,
      height: box.bottom - box.top
    };
    var firstScreenEl = matches[0].closest ? matches[0].closest('[data-screen-id]') : null;
    var regionScreenId = firstScreenEl ? firstScreenEl.getAttribute('data-screen-id') : undefined;
    var regionScreenName = firstScreenEl ? firstScreenEl.getAttribute('data-screen-name') : undefined;
    var summaries = [];
    var snippets = [];
    for (var m = 0; m < matches.length && m < 8; m++) {
      summaries.push(describeElementBadge(matches[m]));
      if (m < 4) snippets.push(String(matches[m].outerHTML || '').slice(0, 180));
    }
    var regionTitle = CFG.locale === 'en-US'
      ? ('Boxed ' + matches.length + ' controls' + (regionScreenId ? ' · ' + regionScreenId : ''))
      : ('框选 ' + matches.length + ' 个控件' + (regionScreenId ? ' · ' + regionScreenId : ''));
    setBoxVars(selectedBox, selectedTag, union, regionTitle);
    selectedBox.style.display = 'block';

    var containerEl = firstScreenEl || matches[0].parentElement || matches[0];
    var regionRect = { x: union.left, y: union.top, width: union.width, height: union.height };
    var regionSel = buildSelector(containerEl);
    var regionCrop = captureSelectionCrop(matches, regionRect, regionSel);
    postToHost('SELECT', {
      selection: {
        kind: 'REGION',
        tagName: containerEl.tagName.toLowerCase(),
        cssSelector: regionSel,
        label: regionTitle,
        textPreview: summaries.slice(0, 3).join(' / '),
        htmlSnippet: snippets.join('\\n'),
        screenId: regionScreenId || undefined,
        screenName: regionScreenName || undefined,
        matchedElementCount: matches.length,
        matchedElementsSummary: summaries,
        rect: regionRect
      },
      crop: regionCrop
    });
  }, true);

  function blockWhenInspecting(e) {
    if (!isActive && !suppressNextClick) return;
    if (suppressNextClick && e.type === 'click') {
      suppressNextClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (isActive) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  document.addEventListener('click', blockWhenInspecting, true);
  document.addEventListener('dblclick', blockWhenInspecting, true);
  document.addEventListener('submit', blockWhenInspecting, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (isActive) {
        e.preventDefault();
        activeElements = [];
        selectedBox.style.display = 'none';
        postToHost('ESCAPE', { inspecting: true });
      } else {
        postToHost('ESCAPE', { inspecting: false });
      }
    }
  }, true);

  window.addEventListener('scroll', scheduleSyncVisuals, true);
  window.addEventListener('resize', scheduleSyncVisuals);

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var msg = e.data;
    if (!msg || typeof msg !== 'object' || msg.namespace !== CFG.namespace || msg.token !== CFG.token) return;
    if (msg.type === 'SYNC_STATE') {
      isActive = Boolean(msg.active);
      if (Array.isArray(msg.pins)) pins = msg.pins;
      highlightedSelector = typeof msg.highlightedSelector === 'string' ? msg.highlightedSelector : '';
      activeRunningAnchor = msg.activeRunningAnchor && typeof msg.activeRunningAnchor === 'object' ? msg.activeRunningAnchor : null;
      flashedAnchors = Array.isArray(msg.flashedAnchors) ? msg.flashedAnchors : [];
      flashKey = typeof msg.flashKey === 'string' ? msg.flashKey : '';
      if (msg.clearSelection) {
        activeElements = [];
        selectedBox.style.display = 'none';
      }
      syncRootModeAttr();
      scheduleSyncVisuals();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      mountOverlay();
      postToHost('READY', {});
    });
  } else {
    mountOverlay();
    postToHost('READY', {});
  }
})();
</script>`;

  const bodyCloseIdx = cleanHtml.lastIndexOf('</body>');
  if (bodyCloseIdx >= 0) {
    return `${cleanHtml.slice(0, bodyCloseIdx)}${scriptTag}\n${cleanHtml.slice(bodyCloseIdx)}`;
  }
  return `${cleanHtml}\n${scriptTag}`;
}

const EMPTY_ANNOTATIONS: PrototypeVisualAnnotation[] = [];
const EMPTY_ANCHORS: PrototypeTargetAnchor[] = [];

export interface PrototypeVisualPreviewStageProps {
  htmlContent: string;
  inspectMode: boolean;
  onInspectModeChange: (next: boolean) => void;
  annotations?: PrototypeVisualAnnotation[];
  onAddAnnotation?: (target: PrototypeSelectionTarget, note: string) => void;
  onApplyImmediate?: (target: PrototypeSelectionTarget, note: string) => void;
  onSelectTarget?: (
    target: PrototypeSelectionTarget,
    crop?: PrototypeSelectionCropPayload | null,
  ) => void;
  onSelectionCropUpgrade?: (cssSelector: string, crop: PrototypeSelectionCropPayload) => void;
  onEscape?: () => void;
  highlightedSelector?: string | null;
  activeRunningAnchor?: PrototypeTargetAnchor | null;
  flashedAnchors?: PrototypeTargetAnchor[];
  flashKey?: string | null;
  busy?: boolean;
  allowInspectWhileBusy?: boolean;
  showInlinePopover?: boolean;
  viewport?: PrototypeViewportPreset;
  zoomMode?: PrototypeZoomMode;
  containerWidthOverride?: number;
  onScaleChange?: (info: { targetWidth: number; scale: number; scaledWidth: number }) => void;
  fillHeight?: boolean;
}

export function PrototypeVisualPreviewStage({
  htmlContent,
  inspectMode,
  onInspectModeChange,
  annotations = EMPTY_ANNOTATIONS,
  onAddAnnotation,
  onApplyImmediate,
  onSelectTarget,
  onSelectionCropUpgrade,
  onEscape,
  highlightedSelector = null,
  activeRunningAnchor = null,
  flashedAnchors = EMPTY_ANCHORS,
  flashKey = null,
  busy = false,
  allowInspectWhileBusy = true,
  showInlinePopover,
  viewport = 'DESKTOP',
  zoomMode = 'FIT',
  containerWidthOverride,
  onScaleChange,
  fillHeight = false,
}: PrototypeVisualPreviewStageProps) {
  const { locale, t } = usePreferences();
  const popoverInputId = useId();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewportHostRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const popoverInputRef = useRef<HTMLInputElement | null>(null);
  const lastCompositionEndRef = useRef<number | null>(null);

  const shouldShowPopover =
    showInlinePopover !== undefined
      ? showInlinePopover
      : Boolean(onAddAnnotation || onApplyImmediate);

  const channelToken = useMemo(() => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `onto-vi-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }, [htmlContent]);

  const originValidator = useMemo(() => createSandboxOriginValidator(), [channelToken]);

  const [activeSelection, setActiveSelection] = useState<PrototypeSelectionTarget | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: containerWidthOverride ?? 1200,
    height: 640,
  });

  const effectiveContainerWidth = containerWidthOverride ?? stageSize.width;
  const fitMetrics = useMemo(
    () => computeViewportFitScale(effectiveContainerWidth, viewport, zoomMode),
    [effectiveContainerWidth, viewport, zoomMode],
  );

  useEffect(() => {
    onScaleChange?.(fitMetrics);
  }, [fitMetrics.scale, fitMetrics.scaledWidth, fitMetrics.targetWidth, onScaleChange]);

  const inspectorActive = inspectMode && (!busy || allowInspectWhileBusy);

  // Stable preview srcDoc: only recomputes when htmlContent or locale changes so toggling
  // inspectMode never reloads the iframe or resets multi-screen prototype state!
  const initialInspectRef = useRef(inspectorActive);
  initialInspectRef.current = inspectorActive;

  const previewSrcDoc = useMemo(
    () =>
      injectVisualInspectorIntoHtml(htmlContent, {
        token: channelToken,
        targetOrigin: resolveParentTargetOrigin(),
        initialActive: initialInspectRef.current,
        locale,
      }),
    [htmlContent, channelToken, locale],
  );

  const syncIframeInspectorState = useCallback(
    (clearSelection = false) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage(
        {
          namespace: INSPECTOR_NAMESPACE,
          token: channelToken,
          type: 'SYNC_STATE',
          active: inspectorActive,
          clearSelection,
          highlightedSelector: highlightedSelector ?? '',
          activeRunningAnchor: activeRunningAnchor ?? null,
          flashedAnchors,
          flashKey: flashKey ?? '',
          pins: annotations.map((a) => ({
            index: a.index,
            cssSelector: a.target.cssSelector,
            ...(a.target.elementId ? { elementId: a.target.elementId } : {}),
          })),
        },
        '*',
      );
    },
    [
      activeRunningAnchor,
      annotations,
      channelToken,
      flashKey,
      flashedAnchors,
      highlightedSelector,
      inspectorActive,
    ],
  );

  useEffect(() => {
    syncIframeInspectorState(!inspectMode);
    if (!inspectMode) {
      setActiveSelection(null);
      setDraftNote('');
    }
  }, [
    inspectMode,
    inspectorActive,
    annotations,
    highlightedSelector,
    activeRunningAnchor,
    flashedAnchors,
    flashKey,
    syncIframeInspectorState,
  ]);

  useEffect(() => {
    setActiveSelection(null);
    setDraftNote('');
    originValidator.reset();
  }, [htmlContent, originValidator]);

  useEffect(() => {
    const el = viewportHostRef.current ?? stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setStageSize({ width: r.width, height: r.height });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!originValidator.verify(event, iframeRef.current?.contentWindow, channelToken)) {
        return;
      }
      const data = event.data as Record<string, unknown>;
      if (data.type === 'READY') {
        syncIframeInspectorState(false);
        return;
      }
      if (data.type === 'SELECT') {
        const parsed = sanitizeInspectorSelectionPayload(data.selection);
        if (!parsed) return;
        const parsedCrop = sanitizeInspectorCropPayload(data.crop);
        onSelectTarget?.(parsed, parsedCrop);
        if (shouldShowPopover) {
          setActiveSelection(parsed);
          setDraftNote('');
          if (viewportHostRef.current) {
            const r = viewportHostRef.current.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              setStageSize({ width: r.width, height: r.height });
            }
          }
          requestAnimationFrame(() => {
            popoverInputRef.current?.focus();
          });
        }
        return;
      }
      if (data.type === 'SELECTION_CROP') {
        const cssSelector = cleanShortString(data.cssSelector, 260);
        const parsedCrop = sanitizeInspectorCropPayload(data.crop);
        if (cssSelector && parsedCrop) {
          onSelectionCropUpgrade?.(cssSelector, parsedCrop);
        }
        return;
      }
      if (data.type === 'SELECTION_RECT') {
        const rectObj = data.rect as Record<string, unknown> | undefined;
        if (!rectObj) return;
        const x = Number(rectObj.x);
        const y = Number(rectObj.y);
        const width = Number(rectObj.width);
        const height = Number(rectObj.height);
        if ([x, y, width, height].every((n) => Number.isFinite(n))) {
          setActiveSelection((prev) =>
            prev ? { ...prev, rect: { x, y, width, height } } : prev,
          );
        }
        return;
      }
      if (data.type === 'ESCAPE') {
        if (data.inspecting === false) {
          onEscape?.();
          return;
        }
        if (activeSelection) {
          setActiveSelection(null);
          setDraftNote('');
          syncIframeInspectorState(true);
        } else {
          onInspectModeChange(false);
          onEscape?.();
        }
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [
    activeSelection,
    channelToken,
    onEscape,
    onInspectModeChange,
    onSelectTarget,
    onSelectionCropUpgrade,
    originValidator,
    shouldShowPopover,
    syncIframeInspectorState,
  ]);

  const dismissSelection = useCallback(() => {
    setActiveSelection(null);
    setDraftNote('');
    syncIframeInspectorState(true);
  }, [syncIframeInspectorState]);

  const handlePinCurrent = () => {
    if (!activeSelection) return;
    onAddAnnotation?.(activeSelection, draftNote.trim());
    setActiveSelection(null);
    setDraftNote('');
    syncIframeInspectorState(true);
  };

  const handleApplyCurrent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSelection || controlsDisabled) return;
    const target = activeSelection;
    const note = draftNote.trim();
    setActiveSelection(null);
    setDraftNote('');
    onApplyImmediate?.(target, note);
  };

  const quickPresets = useMemo(
    () => [
      {
        label: t('+ 增加筛选/字段', '+ Filter / Field'),
        fill: t('在此区域补充多条件筛选输入框与重置操作', 'Add filter input fields and reset control here'),
      },
      {
        label: t('优化紧凑布局', 'Compact Layout'),
        fill: t('优化此块排版间距，改为更紧凑清晰的双列对齐布局', 'Tighten spacing and align controls into a clean grid'),
      },
      {
        label: t('+ 业务操作按钮', '+ Action Button'),
        fill: t('在此处增加批量审批与导出操作按钮', 'Add batch approve and export action buttons here'),
      },
      {
        label: t('+ 规则校验提示', '+ Validation'),
        fill: t('补充内联必填规则校验与异常状态提示条', 'Add inline validation feedback and status hint'),
      },
    ],
    [t],
  );

  const bannerHeight = inspectMode ? 36 : 0;
  const horizontalOffset = Math.max(
    0,
    Math.round((effectiveContainerWidth - fitMetrics.scaledWidth) / 2),
  );
  const mappedSelectionRect = activeSelection
    ? mapIframeRectToStageRect(activeSelection.rect, fitMetrics.scale, horizontalOffset)
    : null;
  const popPos = mappedSelectionRect
    ? computeFloatingPopoverPosition(
        mappedSelectionRect,
        { width: effectiveContainerWidth, height: stageSize.height },
        bannerHeight,
      )
    : { left: 16, top: 48 };

  const nextPinNumber = annotations.length + 1;
  const visualHeight = fillHeight ? Math.max(480, stageSize.height - 16) : 560;
  const unscaledIframeHeight = Math.max(480, Math.round(visualHeight / fitMetrics.scale));
  const runningAnchorSummary = summarizeAnchorText(activeRunningAnchor);
  const flashedAnchorsSummary = flashedAnchors.map(summarizeAnchorText).filter(Boolean).join(', ');
  const controlsDisabled = busy && !allowInspectWhileBusy;

  return (
    <div
      ref={stageRef}
      data-testid="prototype-visual-stage"
      data-viewport={viewport}
      data-zoom-mode={zoomMode}
      data-scale={String(fitMetrics.scale)}
      data-highlighted-selector={highlightedSelector ?? ''}
      data-flashed-anchors={flashedAnchorsSummary}
      className={cn(
        'proto-inspector-stage flex flex-col',
        inspectorActive && 'is-inspecting',
        fillHeight && 'h-full min-h-0 flex-1',
      )}
    >
      {activeRunningAnchor && (
        <div
          data-testid="prototype-live-modifying-badge"
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-accent-tint/55 px-3 py-1.5 text-[12px] text-ink shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Loader2 size={13} className="agent-run-spin text-accent shrink-0" aria-hidden="true" />
            <span className="font-medium text-ink">
              {t('Agent 正在修改', 'Modifying...')}
            </span>
            {runningAnchorSummary && (
              <span className="badge badge-accent font-mono text-[10.5px]">
                {runningAnchorSummary}
              </span>
            )}
          </div>
          <span className="text-[11px] text-muted">
            {t('修改期间仍可自由浏览或框选下一轮目标', 'You can keep browsing or box-selecting for the next queued turn')}
          </span>
        </div>
      )}

      {inspectorActive && (
        <div className="proto-inspector-banner shrink-0" data-testid="visual-select-banner">
          <div className="flex flex-wrap items-center gap-2">
            <span className="proto-inspector-dot" aria-hidden="true" />
            <span className="font-medium text-ink">
              {t('框选精修已开启', 'Visual Select Active')}
            </span>
            <span className="text-muted">
              {t(
                '单击点选任意控件，或按住鼠标拖拽框选一块区域；支持打多个批注点一次性交给 AI',
                'Click any control or drag a box around a region; pin multiple spots or refine immediately',
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {annotations.length > 0 && (
              <span className="badge badge-accent">
                {t(`已标 ${annotations.length} 处`, `${annotations.length} Pinned`)}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onInspectModeChange(false)}
            >
              {t('退出框选 (Esc)', 'Done (Esc)')}
            </Button>
          </div>
        </div>
      )}

      <div
        ref={viewportHostRef}
        className={cn(
          'relative flex w-full justify-center bg-ground/60',
          zoomMode === 'ACTUAL' ? 'overflow-auto p-3' : 'overflow-x-hidden overflow-y-auto p-2',
          fillHeight && 'min-h-0 flex-1',
        )}
      >
        <div
          data-testid="prototype-viewport-frame"
          className="relative shrink-0 overflow-hidden rounded-[6px] border border-line bg-surface shadow-xs"
          style={{
            width: `${fitMetrics.scaledWidth}px`,
            height: `${visualHeight}px`,
          }}
        >
          <iframe
            ref={iframeRef}
            title={t('交互式 HTML 原型沙箱预览', 'Interactive Prototype Sandbox')}
            sandbox="allow-scripts"
            srcDoc={previewSrcDoc}
            className="block border-0 bg-surface"
            style={{
              width: `${fitMetrics.targetWidth}px`,
              height: `${unscaledIframeHeight}px`,
              transform: `scale(${fitMetrics.scale})`,
              transformOrigin: 'top left',
            }}
          />
        </div>
      </div>

      {inspectMode && shouldShowPopover && activeSelection && (
        <form
          role="dialog"
          aria-label={t('选中区域 AI 精修批注', 'Selected UI target AI refinement')}
          data-testid="visual-selection-popover"
          className="proto-inspector-popover"
          style={
            {
              ['--pop-left' as string]: `${popPos.left}px`,
              ['--pop-top' as string]: `${popPos.top}px`,
            } as React.CSSProperties
          }
          onSubmit={handleApplyCurrent}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              dismissSelection();
            }
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className="badge badge-accent inline-flex items-center gap-1">
                <Crosshair size={11} aria-hidden="true" />
                {activeSelection.kind === 'REGION'
                  ? t(
                      `框选区域 (${activeSelection.matchedElementCount ?? 2} 项)`,
                      `Region (${activeSelection.matchedElementCount ?? 2})`,
                    )
                  : `<${activeSelection.tagName}>`}
              </span>
              {activeSelection.screenId && (
                <span className="badge inline-flex items-center gap-1 font-mono text-[10.5px]">
                  <Layers size={10.5} aria-hidden="true" />
                  {activeSelection.screenId}
                </span>
              )}
              {activeSelection.elementId && (
                <span className="badge badge-ok font-mono text-[10.5px]">
                  {activeSelection.elementId}
                </span>
              )}
              {activeSelection.binding && (
                <span className="badge font-mono text-[10.5px]">{activeSelection.binding}</span>
              )}
            </div>
            <button
              type="button"
              aria-label={t('关闭当前选中框浮窗', 'Close selection composer')}
              onClick={dismissSelection}
              className="icon-btn -mt-1 -mr-1"
            >
              <X size={13.5} aria-hidden="true" />
            </button>
          </div>

          <div className="truncate font-mono text-[11px] text-muted">
            {activeSelection.label}
            {activeSelection.matchedElementsSummary &&
              activeSelection.matchedElementsSummary.length > 0 &&
              ` · ${activeSelection.matchedElementsSummary.slice(0, 2).join(', ')}`}
          </div>

          <label htmlFor={popoverInputId} className="sr-only">
            {t('针对当前选中元素输入修改指令', 'Refinement instruction for selected UI element')}
          </label>
          <input
            ref={popoverInputRef}
            id={popoverInputId}
            data-testid="visual-selection-note-input"
            className="input w-full text-[12.5px]"
            placeholder={t(
              '告诉 AI 怎么修改选中处（回车立即精修，或先加入批注队列）…',
              'Tell AI how to modify this selection (Enter to apply, or pin to queue)…',
            )}
            value={draftNote}
            disabled={controlsDisabled}
            onCompositionEnd={() => {
              lastCompositionEndRef.current = Date.now();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const justEndedIme =
                  lastCompositionEndRef.current !== null &&
                  Date.now() - lastCompositionEndRef.current < 80;
                if (e.nativeEvent.isComposing || justEndedIme) {
                  e.preventDefault();
                }
              }
            }}
            onChange={(e) => setDraftNote(e.target.value)}
          />

          <div className="flex flex-wrap items-center gap-1">
            {quickPresets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="proto-quick-pill"
                onClick={() => {
                  setDraftNote((prev) => (prev.trim() ? `${prev.trim()}；${preset.fill}` : preset.fill));
                  popoverInputRef.current?.focus();
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="pin-visual-annotation-btn"
              disabled={controlsDisabled}
              onClick={handlePinCurrent}
            >
              <Plus size={12.5} aria-hidden="true" />
              {t(`加入批注 #${nextPinNumber}`, `Pin #${nextPinNumber}`)}
            </Button>
            <Button
              type="submit"
              variant="accent"
              size="sm"
              data-testid="apply-visual-refine-btn"
              disabled={controlsDisabled || (!draftNote.trim() && annotations.length === 0)}
            >
              <Sparkles size={12.5} aria-hidden="true" />
              {annotations.length > 0
                ? t(
                    `连同 ${annotations.length} 处批注立即精修`,
                    `Apply (+${annotations.length} pinned)`,
                  )
                : t('立即 AI 精修', 'Refine Selection')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
