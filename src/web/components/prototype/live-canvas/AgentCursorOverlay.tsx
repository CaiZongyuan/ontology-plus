import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { Button } from '../../beautifui/index.js';
import type { ArtboardHandle } from './Artboard.js';
import {
  SCREEN_ENTRY_ANCHOR_RECT,
  agentThemePalette,
  computeCanvasCursorPlacement,
  computeWebCursorPlacement,
  type AgentCursorPrefs,
  type AgentCursorStyle,
  type AgentLiveActivity,
  type CursorPlacement,
} from './agentCursor.js';
import { agentName } from './buildView.js';
import { artboardRect, type Camera } from './camera.js';

/** Observes an element's `{ w, h }` client box via `ResizeObserver` with a `window.resize` fallback. */
export function useObservedElementSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref]);
  return size;
}

export function CursorGlyph({ style, color }: { style: AgentCursorStyle; color: string }) {
  if (style === 'dot') {
    return (
      <span
        className="mt-0.5 block h-3 w-3 shrink-0 rounded-full"
        aria-hidden="true"
        style={{
          color,
          backgroundColor: color,
          boxShadow: '0 0 0 4px color-mix(in srgb, currentColor 25%, transparent)',
        }}
      />
    );
  }
  if (style === 'nib') {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 22 22"
        className="block shrink-0"
        aria-hidden="true"
        style={{ color }}
      >
        <path
          d="M2 2 L10 5 L20 15 L15 20 L5 10 Z"
          fill="currentColor"
          stroke="var(--card)"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M2 2 L6.5 6.5" stroke="var(--card)" strokeWidth="1.3" fill="none" />
      </svg>
    );
  }
  return (
    <svg
      width="20"
      height="22"
      viewBox="0 0 20 22"
      className="block shrink-0"
      aria-hidden="true"
      style={{ color }}
    >
      <path
        d="M2 1.5 L2 18 L6.6 13.6 L9.8 20.2 L12.8 18.8 L9.7 12.4 L16 12.2 Z"
        fill="currentColor"
        stroke="var(--card)"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SingleAgentCursor({
  activity,
  placement,
  prefs,
  locale,
  testId,
  bubbleTestId,
}: {
  activity: AgentLiveActivity;
  placement: CursorPlacement;
  prefs: AgentCursorPrefs;
  locale: 'zh-CN' | 'en-US';
  testId: string;
  bubbleTestId: string;
}) {
  const palette = agentThemePalette(activity.agent);
  const isFixing = activity.state === 'fixing';
  const glyphColor = isFixing ? 'var(--warning)' : palette.color;
  const label = agentName(activity.agent, locale);

  return (
    <div
      className="pointer-events-none absolute z-10 flex items-start gap-1"
      style={{ left: placement.left, top: placement.top }}
      data-testid={testId}
      data-screen-id={activity.screenId}
      data-element-id={activity.elementId ?? ''}
      data-cursor-style={prefs.style}
      data-activity-state={activity.state}
      data-flip={placement.flipLeft ? 'left' : 'right'}
      data-agent={String(activity.agent)}
    >
      <CursorGlyph style={prefs.style} color={glyphColor} />
      <div
        className={cn(
          'flex flex-col gap-1.5',
          placement.flipLeft ? 'absolute right-full top-2 mr-1.5 items-end' : 'mt-3.5 items-start',
        )}
      >
        {prefs.showNames && label && (
          <span
            className={cn(
              'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold shadow-xs',
              isFixing && 'border border-warning bg-warning-soft text-warning',
            )}
            style={isFixing ? undefined : { backgroundColor: palette.color, color: palette.ink }}
            data-testid="prototype-cursor-name"
          >
            {label}
          </span>
        )}
        {placement.showBubble && activity.sentence && (
          <div
            className="w-max rounded-md border bg-popover px-2.5 py-1.5 text-left text-xs leading-snug text-popover-foreground shadow-md"
            style={{ borderColor: glyphColor, maxWidth: `${placement.bubbleMaxWidth}px` }}
            data-testid={bubbleTestId}
          >
            {activity.sentence}
          </div>
        )}
      </div>
    </div>
  );
}

export function CanvasAgentCursors({
  activities,
  indexById,
  getHandle,
  cam,
  viewportWidth,
  prefs,
  layoutVersion,
}: {
  activities: readonly AgentLiveActivity[];
  indexById: ReadonlyMap<string, number>;
  getHandle: (screenId: string) => ArtboardHandle | null;
  cam: Camera;
  viewportWidth: number;
  prefs: AgentCursorPrefs;
  /** Increments whenever an artboard morphs, scrolls, or resizes. */
  layoutVersion: number;
}) {
  const { locale } = usePreferences();
  const normLocale: 'zh-CN' | 'en-US' = locale === 'en-US' ? 'en-US' : 'zh-CN';
  void layoutVersion;

  return (
    <>
      {activities.map((activity) => {
        const slotIndex = indexById.get(activity.screenId);
        if (slotIndex === undefined) return null;
        const measuredRect = activity.elementId
          ? (getHandle(activity.screenId)?.rectOf(activity.elementId) ?? null)
          : null;
        const elRect = measuredRect ?? (activity.sentence ? SCREEN_ENTRY_ANCHOR_RECT : null);
        if (!elRect) return null;
        const placement = computeCanvasCursorPlacement(
          artboardRect(slotIndex),
          elRect,
          cam,
          viewportWidth,
        );
        return (
          <SingleAgentCursor
            key={activity.screenId}
            activity={activity}
            placement={placement}
            prefs={prefs}
            locale={normLocale}
            testId={`prototype-agent-cursor-${activity.screenId}`}
            bubbleTestId={`prototype-cursor-bubble-${activity.screenId}`}
          />
        );
      })}
    </>
  );
}

export function WebAgentCursor({
  activity,
  getHandle,
  pageWidth,
  pageHeight = 0,
  prefs,
  layoutVersion,
}: {
  activity: AgentLiveActivity | undefined;
  getHandle: () => ArtboardHandle | null;
  pageWidth: number;
  pageHeight?: number;
  prefs: AgentCursorPrefs;
  layoutVersion: number;
}) {
  const { locale } = usePreferences();
  const normLocale: 'zh-CN' | 'en-US' = locale === 'en-US' ? 'en-US' : 'zh-CN';
  void layoutVersion;
  if (!activity) return null;
  const measuredRect = activity.elementId
    ? (getHandle()?.rectOf(activity.elementId) ?? null)
    : null;
  const elRect = measuredRect ?? (activity.sentence ? SCREEN_ENTRY_ANCHOR_RECT : null);
  if (!elRect) return null;
  const placement = computeWebCursorPlacement(elRect, pageWidth, pageHeight);
  return (
    <SingleAgentCursor
      activity={activity}
      placement={placement}
      prefs={prefs}
      locale={normLocale}
      testId="prototype-web-agent-cursor"
      bubbleTestId="prototype-web-cursor-bubble"
    />
  );
}

export function AgentCursorDockControl({
  prefs,
  onChange,
}: {
  prefs: AgentCursorPrefs;
  onChange: (next: AgentCursorPrefs) => void;
}) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });

  const updateMenuPosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn || typeof window === 'undefined') return;
    const r = btn.getBoundingClientRect();
    const menuWidth = 208;
    const centeredLeft = r.left + r.width / 2 - menuWidth / 2;
    const maxLeft = Math.max(8, (window.innerWidth || 1024) - menuWidth - 8);
    setMenuPos({
      left: Math.max(8, Math.min(centeredLeft, maxLeft)),
      bottom: Math.max(8, (window.innerHeight || 768) - r.top + 8),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const options: readonly { style: AgentCursorStyle; label: string }[] = [
    { style: 'arrow', label: t('箭头', 'Arrow') },
    { style: 'nib', label: t('笔尖', 'Pen nib') },
    { style: 'dot', label: t('圆点', 'Dot') },
  ];

  return (
    <>
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
      <Button
        ref={triggerRef}
        type="button"
        variant="toggle"
        size="xs"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-pressed={open}
        data-testid="prototype-dock-cursor"
        title={t('选择当前设备的助手光标样式', 'Choose assistant cursor style for this device')}
        onClick={() => setOpen((v) => !v)}
      >
        {t('光标 ▾', 'Cursor ▾')}
      </Button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label={t('助手光标设置', 'Assistant cursor settings')}
            data-testid="prototype-cursor-menu"
            className="fixed z-50 flex w-[208px] flex-col gap-1 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg"
            style={{ left: menuPos.left, bottom: menuPos.bottom }}
          >
            <div className="px-1.5 pb-1 text-xs text-faint-foreground">
              {t('助手光标（只影响当前设备）', 'Assistant cursor (this device only)')}
            </div>
            {options.map((opt) => {
              const selected = prefs.style === opt.style;
              return (
                <button
                  key={opt.style}
                  type="button"
                  data-testid={`prototype-cursor-style-${opt.style}`}
                  aria-pressed={selected}
                  onClick={() => onChange({ ...prefs, style: opt.style })}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 rounded-sm border-0 px-2 py-1.5 text-left text-xs',
                    selected
                      ? 'bg-primary-soft font-semibold text-primary'
                      : 'bg-transparent text-popover-foreground hover:bg-accent',
                  )}
                >
                  <CursorGlyph style={opt.style} color="var(--model-m2)" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
            <label className="mt-1 flex cursor-pointer items-center gap-2 border-t border-border-subtle px-2 pt-2 pb-0.5 text-xs text-popover-foreground">
              <input
                type="checkbox"
                checked={prefs.showNames}
                data-testid="prototype-cursor-show-names"
                onChange={(event) => onChange({ ...prefs, showNames: event.target.checked })}
              />
              <span>{t('显示助手名字', 'Show assistant names')}</span>
            </label>
          </div>,
          document.body,
        )}
    </>
  );
}
