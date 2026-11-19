import React, { useRef } from 'react';
import { NotebookPen } from 'lucide-react';
import type { PrototypeCanvasArtboard } from '../../../../packages/ontology-core/index.js';
import { themePrototypeMarkColor } from '../../../../packages/workbench-theme/index.js';
import { usePreferences } from '../../../i18n.js';
import { Button } from '../../beautifui/index.js';
import type { ArtboardHandle } from './Artboard.js';
import { businessText } from './buildView.js';
import { ARTBOARD_H, ARTBOARD_W, artboardRect } from './camera.js';
import {
  CANVAS_FONT_SIZE,
  CANVAS_LINE_HEIGHT,
  WEB_FONT_SIZE,
  WEB_LINE_HEIGHT,
  measureScreenDesignNotes,
  noteTitleSeparator,
  placeCanvasArtboardsDesignNotes,
  placeDesignNotes,
  type CanvasArtboardNotesInput,
  type PlacedDesignNote,
} from './designNotesLayout.js';

function DesignNotesScene({
  placed,
  width,
  height,
  markColor,
  locale,
  web = false,
}: {
  placed: readonly PlacedDesignNote[];
  width: number;
  height: number;
  markColor: string;
  locale: 'zh-CN' | 'en-US';
  web?: boolean;
}) {
  const fontSize = `${web ? WEB_FONT_SIZE : CANVAS_FONT_SIZE}px`;
  const lineHeight = `${web ? WEB_LINE_HEIGHT : CANVAS_LINE_HEIGHT}px`;
  const sep = noteTitleSeparator(locale);

  return (
    <>
      {placed
        .filter((note) => !note.skipOutline)
        .map((note) => (
          <div
            key={`outline-${note.id}`}
            data-testid={`prototype-design-note-outline-${note.id}`}
            className="pointer-events-none absolute rounded-sm border border-dashed"
            style={{
              left: note.targetRect.x - 4,
              top: note.targetRect.y - 4,
              width: note.targetRect.w + 8,
              height: note.targetRect.h + 8,
              borderColor: markColor,
              boxShadow: '0 0 0 1px color-mix(in srgb, var(--card) 72%, transparent)',
            }}
          />
        ))}
      <svg
        className="pointer-events-none absolute inset-0 overflow-visible"
        width={width}
        height={height}
        aria-hidden="true"
      >
        {placed.map((note) => (
          <g key={`arrow-${note.id}`} data-testid={`prototype-design-note-arrow-${note.id}`}>
            <path
              data-role="arrow-halo"
              d={note.arrowPath}
              fill="none"
              stroke="var(--card)"
              strokeOpacity="0.78"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              data-role="arrow-halo"
              d={note.arrowHead}
              fill="none"
              stroke="var(--card)"
              strokeOpacity="0.78"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              data-role="arrow-stroke"
              d={note.arrowPath}
              fill="none"
              stroke={markColor}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              data-role="arrow-stroke"
              d={note.arrowHead}
              fill="none"
              stroke={markColor}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}
      </svg>
      {placed.map((note) => {
        const strongBacking = web && note.outside;
        return (
          <div
            key={`note-${note.id}`}
            data-testid={`prototype-design-note-${note.id}`}
            data-element-id={note.id}
            data-outside={note.outside ? 'true' : 'false'}
            className="pointer-events-none absolute rounded-md px-2 py-1 font-annotation text-foreground"
            style={{
              left: note.box.x,
              top: note.box.y,
              width: note.box.w,
              fontSize,
              lineHeight,
              backgroundColor: strongBacking
                ? 'color-mix(in srgb, var(--card) 92%, transparent)'
                : 'color-mix(in srgb, var(--card) 88%, transparent)',
              boxShadow: strongBacking ? 'var(--shadow-card)' : 'var(--shadow-hairline)',
            }}
          >
            {note.title ? (
              <>
                <span className="font-semibold">
                  {note.title}
                  {sep}
                </span>
                {note.body}
              </>
            ) : (
              note.body
            )}
          </div>
        );
      })}
    </>
  );
}

export function CanvasDesignNotesOverlay({
  enabled,
  screens,
  indexById,
  getHandle,
  isBusiness,
  locale,
  layoutVersion,
}: {
  enabled: boolean;
  screens: readonly PrototypeCanvasArtboard[];
  indexById: ReadonlyMap<string, number>;
  getHandle: (screenId: string) => ArtboardHandle | null;
  isBusiness: boolean;
  locale: 'zh-CN' | 'en-US';
  layoutVersion: number;
}) {
  const { workbenchTheme } = usePreferences();
  void layoutVersion;
  if (!enabled) return null;

  const formatText = isBusiness ? (raw: string) => businessText(raw, locale) : undefined;
  const inputs: CanvasArtboardNotesInput[] = [];
  const groundByScreen = new Map<string, string | null>();

  for (const board of screens) {
    const slotIndex = indexById.get(board.screenId);
    if (slotIndex === undefined) continue;
    const doc = getHandle(board.screenId)?.document() ?? null;
    const measured = measureScreenDesignNotes(doc, board.screenId, {
      scrollMode: 'viewport',
      fallbackWidth: ARTBOARD_W,
      fallbackHeight: ARTBOARD_H,
    });
    groundByScreen.set(board.screenId, measured.groundColor);
    inputs.push({
      screenId: board.screenId,
      slotIndex,
      targets: measured.targets,
      occupied: measured.occupied,
    });
  }

  const placedByScreen = placeCanvasArtboardsDesignNotes(inputs, {
    allSlotIndices: Array.from(indexById.values()),
    locale,
    ...(formatText ? { formatText } : {}),
  });

  return (
    <>
      {screens.map((board) => {
        const slotIndex = indexById.get(board.screenId);
        const placed = placedByScreen.get(board.screenId);
        if (slotIndex === undefined || !placed || placed.length === 0) return null;
        const worldRect = artboardRect(slotIndex);
        const markColor = themePrototypeMarkColor(
          workbenchTheme,
          groundByScreen.get(board.screenId) ?? null,
        );

        return (
          <div
            key={`notes-${board.screenId}`}
            data-testid={`prototype-design-notes-overlay-${board.screenId}`}
            data-screen-id={board.screenId}
            aria-hidden="true"
            className="pointer-events-none absolute select-none transition-opacity duration-200 motion-reduce:transition-none"
            style={{
              left: worldRect.x,
              top: worldRect.y,
              width: ARTBOARD_W,
              height: ARTBOARD_H,
            }}
          >
            <DesignNotesScene
              placed={placed}
              width={ARTBOARD_W}
              height={ARTBOARD_H}
              markColor={markColor}
              locale={locale}
            />
          </div>
        );
      })}
    </>
  );
}

interface WebNotesCache {
  doc: Document;
  key: string;
  placed: PlacedDesignNote[];
  groundColor: string | null;
  docWidth: number;
  docHeight: number;
  lastScrollLeft: number;
  lastScrollTop: number;
}

export function WebDesignNotesOverlay({
  enabled,
  screenId,
  bodySignature,
  getHandle,
  pageWidth,
  pageHeight,
  isBusiness,
  locale,
  layoutVersion,
}: {
  enabled: boolean;
  screenId: string | undefined;
  bodySignature: string;
  getHandle: () => ArtboardHandle | null;
  pageWidth: number;
  pageHeight: number;
  isBusiness: boolean;
  locale: 'zh-CN' | 'en-US';
  layoutVersion: number;
}) {
  const { workbenchTheme } = usePreferences();
  const cacheRef = useRef<WebNotesCache | null>(null);
  void layoutVersion;
  if (!enabled || !screenId) return null;

  const doc = getHandle()?.document() ?? null;
  if (!doc || !doc.body) return null;

  const scroller = doc.scrollingElement ?? doc.documentElement;
  const scrollLeft = scroller?.scrollLeft ?? 0;
  const scrollTop = scroller?.scrollTop ?? 0;
  const fallbackW = pageWidth > 0 ? pageWidth : ARTBOARD_W;
  const fallbackH = pageHeight > 0 ? pageHeight : ARTBOARD_H;
  const cacheKey = `${screenId}|${bodySignature}|${fallbackW}|${fallbackH}|${isBusiness ? 'b' : 't'}|${locale}`;

  const prev = cacheRef.current;
  const onlyScrolled =
    prev !== null &&
    prev.doc === doc &&
    prev.key === cacheKey &&
    (scrollLeft !== prev.lastScrollLeft || scrollTop !== prev.lastScrollTop);

  let placed: PlacedDesignNote[];
  let groundColor: string | null;
  let docWidth: number;
  let docHeight: number;

  if (onlyScrolled && prev) {
    placed = prev.placed;
    groundColor = prev.groundColor;
    docWidth = prev.docWidth;
    docHeight = prev.docHeight;
    prev.lastScrollLeft = scrollLeft;
    prev.lastScrollTop = scrollTop;
  } else {
    const measured = measureScreenDesignNotes(doc, screenId, {
      scrollMode: 'document',
      fallbackWidth: fallbackW,
      fallbackHeight: fallbackH,
    });
    const formatText = isBusiness ? (raw: string) => businessText(raw, locale) : undefined;
    placed =
      measured.targets.length > 0
        ? placeDesignNotes(measured.targets, measured.occupied, {
            width: measured.docWidth,
            height: measured.docHeight,
            allowOutside: false,
            inkOccupied: measured.inkOccupied,
            locale,
            ...(formatText ? { formatText } : {}),
          })
        : [];
    groundColor = measured.groundColor;
    docWidth = measured.docWidth;
    docHeight = measured.docHeight;
    cacheRef.current = {
      doc,
      key: cacheKey,
      placed,
      groundColor,
      docWidth,
      docHeight,
      lastScrollLeft: scrollLeft,
      lastScrollTop: scrollTop,
    };
  }

  if (placed.length === 0) return null;
  const markColor = themePrototypeMarkColor(workbenchTheme, groundColor);

  return (
    <div
      data-testid="prototype-web-design-notes-overlay"
      data-screen-id={screenId}
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0 select-none transition-opacity duration-200 motion-reduce:transition-none"
      style={{
        width: docWidth,
        height: docHeight,
        transform: `translate3d(${-scrollLeft}px, ${-scrollTop}px, 0)`,
      }}
    >
      <DesignNotesScene
        placed={placed}
        width={docWidth}
        height={docHeight}
        markColor={markColor}
        locale={locale}
        web
      />
    </div>
  );
}

export function DesignNotesDockControl({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { t } = usePreferences();
  return (
    <>
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
      <Button
        type="button"
        variant="toggle"
        size="xs"
        aria-pressed={enabled}
        data-testid="prototype-dock-design-notes"
        title={t('在画面空白处显示元素的业务说明', 'Show handwritten business notes on the prototype')}
        onClick={() => onToggle(!enabled)}
      >
        <NotebookPen size={12} aria-hidden="true" />
        {t('设计说明', 'Design Notes')}
      </Button>
    </>
  );
}
