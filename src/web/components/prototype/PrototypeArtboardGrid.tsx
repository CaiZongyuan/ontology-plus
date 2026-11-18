import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Maximize2,
  MousePointer2,
  RefreshCw,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { sanitizeBusinessText } from '../../../packages/business-vocabulary/index.js';
import {
  extractPrototypeArtboards,
  type PrototypeArtboardSlice,
} from '../../../packages/ontology-core/index.js';
import type {
  AgentSubagentCursorZone,
  AgentSubagentLaneTrace,
  PrototypeTargetAnchor,
} from '../../../packages/workspace-store/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../beautifui/index.js';

const CURSOR_COLOR_VARS = [
  'var(--model-mu)',
  'var(--model-m1)',
  'var(--model-m2)',
  'var(--model-m4)',
  'var(--model-m6)',
  'var(--model-m7)',
] as const;

export interface PrototypeArtboardGridProps {
  htmlContent: string;
  projectName?: string;
  busy?: boolean;
  reconnecting?: boolean;
  liveStreamedChars?: number;
  subagentLanes?: readonly AgentSubagentLaneTrace[];
  activeRunningAnchor?: PrototypeTargetAnchor | null;
  highlightedScreenId?: string | null;
  highlightedSelector?: string | null;
  onFocusScreen?: (screenId: string) => void;
  onRetryScreen?: (screenId: string, screenName: string) => void;
  viewMode?: 'business' | 'technical';
}

interface LocalArtboardPoint {
  xPct: number;
  yPct: number;
}

interface PositionedCursor {
  id: string;
  workerSlot: number;
  targetScreenId?: string;
  colorVar: string;
  workerLabel: string;
  actionLabel: string;
  phase: 'THINKING' | 'STREAMING' | 'VALIDATING';
  zone: AgentSubagentCursorZone;
  chars?: number;
  clicking: boolean;
  topPercent: number;
  leftPercent: number;
}

const ZONE_WAYPOINTS: Record<AgentSubagentCursorZone, readonly LocalArtboardPoint[]> = {
  header: [
    { xPct: 18, yPct: 17 },
    { xPct: 48, yPct: 16 },
    { xPct: 76, yPct: 17 },
    { xPct: 32, yPct: 21 },
  ],
  kpi: [
    { xPct: 20, yPct: 33 },
    { xPct: 49, yPct: 33 },
    { xPct: 77, yPct: 33 },
    { xPct: 35, yPct: 35 },
  ],
  toolbar: [
    { xPct: 22, yPct: 47 },
    { xPct: 54, yPct: 47 },
    { xPct: 79, yPct: 47 },
    { xPct: 38, yPct: 48 },
  ],
  body: [
    { xPct: 24, yPct: 60 },
    { xPct: 58, yPct: 62 },
    { xPct: 32, yPct: 74 },
    { xPct: 68, yPct: 75 },
    { xPct: 46, yPct: 67 },
  ],
  drawer: [
    { xPct: 73, yPct: 36 },
    { xPct: 78, yPct: 56 },
    { xPct: 74, yPct: 77 },
    { xPct: 69, yPct: 48 },
  ],
  footer: [
    { xPct: 30, yPct: 86 },
    { xPct: 68, yPct: 86 },
    { xPct: 52, yPct: 85 },
  ],
};

const PATROL_ZONE_CYCLE: readonly AgentSubagentCursorZone[] = [
  'header',
  'kpi',
  'kpi',
  'toolbar',
  'body',
  'body',
  'footer',
];

const ZONE_BOX_STYLE: Record<
  AgentSubagentCursorZone,
  { top: string; left: string; width: string; height: string }
> = {
  header: { top: '8%', left: '4%', width: '92%', height: '14%' },
  kpi: { top: '24%', left: '4%', width: '92%', height: '18%' },
  toolbar: { top: '42%', left: '4%', width: '92%', height: '12%' },
  body: { top: '54%', left: '4%', width: '92%', height: '30%' },
  drawer: { top: '16%', left: '62%', width: '35%', height: '76%' },
  footer: { top: '82%', left: '4%', width: '92%', height: '13%' },
};

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function projectCardLocalToGridPercent(
  cardIndex: number,
  totalCards: number,
  localPoint: LocalArtboardPoint,
): { topPercent: number; leftPercent: number } {
  const cols = totalCards <= 1 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(totalCards / cols));
  const col = cardIndex % cols;
  const row = Math.floor(cardIndex / cols);

  const colStart = cols === 1 ? 4 : col === 0 ? 2 : 52;
  const colSpan = cols === 1 ? 82 : 44;
  const rowSpan = 100 / rows;
  const rowStart = row * rowSpan + rowSpan * 0.14;
  const rowUsable = rowSpan * 0.78;

  return {
    leftPercent: Number(clamp(colStart + (localPoint.xPct / 100) * colSpan, 4, 88).toFixed(1)),
    topPercent: Number(clamp(rowStart + (localPoint.yPct / 100) * rowUsable, 6, 91).toFixed(1)),
  };
}

/**
 * Sandboxed Artboard Iframe that patches incoming streaming DOM in-place (zero reload flicker)
 * and measures the real (x, y) coordinates of `[data-live-writing="true"]` for `doop` cursor tracking.
 */
function LiveArtboardFrame({
  board,
  titleText,
  onMeasuredWritingPoint,
}: {
  board: PrototypeArtboardSlice;
  titleText: string;
  onMeasuredWritingPoint: (screenId: string, point: LocalArtboardPoint) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [srcDocHtml, setSrcDocHtml] = useState<string>(() => board.isolatedHtml);
  const prevStatusRef = useRef(board.status);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = board.status;

    // When transitioning to 'ready' (or initial queued shell), refresh full srcDoc once so inline <script>s bind cleanly
    if (board.status === 'ready' && prevStatus !== 'ready') {
      setSrcDocHtml(board.isolatedHtml);
      return;
    }

    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc || !doc.body || typeof DOMParser === 'undefined') {
      setSrcDocHtml(board.isolatedHtml);
      return;
    }

    const escScreenId = board.screenId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const liveSection = doc.querySelector(`[data-screen-id="${escScreenId}"]`);
    if (!liveSection) {
      setSrcDocHtml(board.isolatedHtml);
      return;
    }

    try {
      const parsed = new DOMParser().parseFromString(board.isolatedHtml, 'text/html');
      const incomingSection = parsed.querySelector(`[data-screen-id="${escScreenId}"]`);
      if (!incomingSection) {
        setSrcDocHtml(board.isolatedHtml);
        return;
      }

      // Sync styles in-place without reloading the iframe document
      const incomingStyles = Array.from(parsed.querySelectorAll('style'))
        .map((s) => s.textContent ?? '')
        .join('\n');
      let liveStyleEl = doc.getElementById('__onto-live-stream-styles') as HTMLStyleElement | null;
      if (!liveStyleEl) {
        liveStyleEl = doc.createElement('style');
        liveStyleEl.id = '__onto-live-stream-styles';
        doc.head?.appendChild(liveStyleEl);
      }
      if (liveStyleEl.textContent !== incomingStyles) {
        liveStyleEl.textContent = incomingStyles;
      }

      for (const attrName of incomingSection.getAttributeNames()) {
        const val = incomingSection.getAttribute(attrName);
        if (val !== null) liveSection.setAttribute(attrName, val);
      }
      liveSection.innerHTML = incomingSection.innerHTML;

      // Measure the exact element currently being written to guide the AI cursor!
      const writingEl =
        (liveSection.querySelector('[data-live-writing="true"]') as HTMLElement | null) ??
        (liveSection.lastElementChild as HTMLElement | null);
      if (writingEl && typeof writingEl.getBoundingClientRect === 'function') {
        const rect = writingEl.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          if (rect.bottom > 640 && doc.documentElement) {
            doc.documentElement.scrollTop += rect.bottom - 580;
          }
          const targetX = rect.left + Math.min(Math.max(rect.width * 0.36, 28), 260);
          const targetY = rect.top + Math.min(Math.max(rect.height * 0.52, 16), 48);
          onMeasuredWritingPoint(board.screenId, {
            xPct: clamp((targetX / 1280) * 100, 10, 86),
            yPct: clamp((targetY / 680) * 100, 12, 88),
          });
        }
      }
    } catch {
      setSrcDocHtml(board.isolatedHtml);
    }
  }, [board.isolatedHtml, board.screenId, board.status, onMeasuredWritingPoint]);

  return (
    <iframe
      ref={iframeRef}
      title={titleText}
      srcDoc={srcDocHtml}
      sandbox="allow-scripts allow-same-origin"
      className="origin-top-left border-0"
      style={{
        width: '1280px',
        height: '680px',
        transform: 'scale(0.5)',
      }}
    />
  );
}

export function PrototypeArtboardGrid({
  htmlContent,
  projectName,
  busy = false,
  reconnecting = false,
  liveStreamedChars = 0,
  subagentLanes = [],
  activeRunningAnchor,
  highlightedScreenId,
  highlightedSelector,
  onFocusScreen,
  onRetryScreen,
  viewMode = 'business',
}: PrototypeArtboardGridProps) {
  const { locale, t } = usePreferences();
  const isBusiness = viewMode === 'business';

  const artboards = useMemo(() => extractPrototypeArtboards(htmlContent), [htmlContent]);
  const [patrolTick, setPatrolTick] = useState(0);
  const [measuredPoints, setMeasuredPoints] = useState<Record<string, LocalArtboardPoint>>({});

  const handleMeasuredWritingPoint = useCallback((screenId: string, point: LocalArtboardPoint) => {
    setMeasuredPoints((prev) => {
      const existing = prev[screenId];
      if (
        existing &&
        Math.abs(existing.xPct - point.xPct) < 1 &&
        Math.abs(existing.yPct - point.yPct) < 1
      ) {
        return prev;
      }
      return { ...prev, [screenId]: point };
    });
  }, []);

  // Continuous choreography clock while agents are working so cursors glide naturally across zones
  useEffect(() => {
    if (!busy && !subagentLanes.some((l) => l.status === 'RUNNING')) return;
    const timer = setInterval(() => {
      setPatrolTick((n) => n + 1);
    }, 820);
    return () => clearInterval(timer);
  }, [busy, subagentLanes]);

  const cleanLabel = useCallback(
    (raw: string, fallbackZh: string, fallbackEn: string): string => {
      const cleaned = isBusiness
        ? sanitizeBusinessText(raw, locale === 'en-US' ? 'en-US' : 'zh-CN').trim()
        : raw.trim();
      return cleaned || t(fallbackZh, fallbackEn);
    },
    [isBusiness, locale, t],
  );

  // Compute live cursors positioned over the exact zones / DOM elements they are actively building
  const liveCursors: PositionedCursor[] = useMemo(() => {
    const runningLanes = subagentLanes.filter((l) => l.status === 'RUNNING');
    const cardTotal = Math.max(4, artboards.length);

    if (runningLanes.length > 0) {
      return runningLanes.map((lane, idx) => {
        const targetScreenId = lane.targetAnchor?.screenId;
        const matchedBoardIdx = targetScreenId
          ? artboards.findIndex((b) => b.screenId === targetScreenId)
          : -1;
        const matchedBoard = matchedBoardIdx >= 0 ? artboards[matchedBoardIdx] : undefined;
        const targetIdx = matchedBoardIdx >= 0 ? matchedBoardIdx : idx % cardTotal;

        const workerSlot = Math.max(1, lane.workerIndex || idx + 1);
        const phase: PositionedCursor['phase'] =
          lane.phase === 'STREAMING' || matchedBoard?.status === 'streaming'
            ? 'STREAMING'
            : lane.phase === 'VALIDATING'
              ? 'VALIDATING'
              : 'THINKING';

        const effectiveZone: AgentSubagentCursorZone =
          lane.cursorZone ??
          PATROL_ZONE_CYCLE[(patrolTick + workerSlot * 2) % PATROL_ZONE_CYCLE.length]!;
        const zonePoints = ZONE_WAYPOINTS[effectiveZone];
        const waypoint =
          zonePoints[(patrolTick + workerSlot * 3 + idx) % zonePoints.length]!;

        const measured = targetScreenId ? measuredPoints[targetScreenId] : undefined;
        const localPoint: LocalArtboardPoint =
          phase === 'STREAMING' && measured
            ? {
                // Glide smoothly along the newly painted DOM element as characters stream in
                xPct: clamp(
                  measured.xPct + (((patrolTick + workerSlot) % 3) - 1) * 4.2,
                  10,
                  86,
                ),
                yPct: clamp(
                  measured.yPct + (((patrolTick + idx) % 2) === 0 ? -1.2 : 1.4),
                  12,
                  88,
                ),
              }
            : waypoint;

        const pos = projectCardLocalToGridPercent(targetIdx, cardTotal, localPoint);
        const colorVar = CURSOR_COLOR_VARS[(workerSlot - 1) % CURSOR_COLOR_VARS.length]!;

        const rawAction =
          matchedBoard?.activeWritingLabel && phase === 'STREAMING'
            ? locale === 'en-US'
              ? `Painting · ${matchedBoard.activeWritingLabel}`
              : `正在绘制 · ${matchedBoard.activeWritingLabel}`
            : lane.liveAction
              ? locale === 'en-US'
                ? lane.liveAction.en
                : lane.liveAction.zh
              : locale === 'en-US'
                ? lane.taskTitle.en
                : lane.taskTitle.zh;

        return {
          id: lane.laneId,
          workerSlot,
          ...(targetScreenId ? { targetScreenId } : {}),
          colorVar,
          workerLabel: cleanLabel(
            locale === 'en-US' ? lane.workerLabel.en : lane.workerLabel.zh,
            `${workerSlot} 号智能体`,
            `Assistant #${workerSlot}`,
          ),
          actionLabel: cleanLabel(
            rawAction,
            '正在绘制页面内容…',
            'Streaming screen layout…',
          ),
          phase,
          zone: effectiveZone,
          ...(lane.progressChars ? { chars: lane.progressChars } : {}),
          clicking: (patrolTick + workerSlot) % 2 === 0,
          ...pos,
        };
      });
    }

    if (busy) {
      const anchorScreenId = activeRunningAnchor?.screenId;
      const anchorBoardIdx = anchorScreenId
        ? artboards.findIndex((b) => b.screenId === anchorScreenId)
        : -1;
      const effectiveCardIdx =
        anchorBoardIdx >= 0 ? anchorBoardIdx : patrolTick % Math.max(1, artboards.length || 4);
      const effectiveZone = PATROL_ZONE_CYCLE[patrolTick % PATROL_ZONE_CYCLE.length]!;
      const zonePoints = ZONE_WAYPOINTS[effectiveZone];
      const waypoint = zonePoints[patrolTick % zonePoints.length]!;
      const measured = anchorScreenId ? measuredPoints[anchorScreenId] : undefined;

      const pos = projectCardLocalToGridPercent(
        effectiveCardIdx,
        Math.max(1, artboards.length || 4),
        measured ?? waypoint,
      );

      const planningPhaseHints: readonly { zh: string; en: string }[] = [
        { zh: '正在拆解需求并规划多屏画板结构…', en: 'Planning multi-artboard layout…' },
        { zh: '正在调配共享色彩与排版令牌…', en: 'Configuring shared style tokens…' },
        { zh: '正在搭建顶部导航壳与分屏骨架…', en: 'Assembling navigation shell & frames…' },
        { zh: '正在派发并行智能体分屏任务…', en: 'Dispatching parallel screen workers…' },
      ];
      const hint = planningPhaseHints[patrolTick % planningPhaseHints.length]!;

      return [
        {
          id: 'lead-coordinator-cursor',
          workerSlot: 1,
          ...(anchorScreenId ? { targetScreenId: anchorScreenId } : {}),
          colorVar: CURSOR_COLOR_VARS[0]!,
          workerLabel: t('主架构设计师', 'Lead Architect'),
          actionLabel:
            artboards.length === 0
              ? t(hint.zh, hint.en)
              : cleanLabel(
                  activeRunningAnchor?.label ?? '',
                  '正在实时更新画板内容…',
                  'Updating artboard live…',
                ),
          phase: measured ? 'STREAMING' : 'THINKING',
          zone: effectiveZone,
          ...(liveStreamedChars > 0 ? { chars: liveStreamedChars } : {}),
          clicking: patrolTick % 2 === 0,
          ...pos,
        },
      ];
    }

    return [];
  }, [
    activeRunningAnchor,
    artboards,
    busy,
    cleanLabel,
    liveStreamedChars,
    locale,
    measuredPoints,
    patrolTick,
    subagentLanes,
    t,
  ]);

  const cursorByScreenId = useMemo(() => {
    const map = new Map<string, PositionedCursor>();
    for (const c of liveCursors) {
      if (c.targetScreenId && !map.has(c.targetScreenId)) {
        map.set(c.targetScreenId, c);
      }
    }
    return map;
  }, [liveCursors]);

  const readyCount = artboards.filter((a) => a.status === 'ready').length;
  const streamingCount = artboards.filter((a) => a.status === 'streaming').length;

  return (
    <div
      className="relative flex min-h-[540px] flex-1 flex-col gap-3 overflow-auto bg-canvas p-4"
      data-testid="prototype-multi-artboard-grid"
      {...(highlightedSelector ? { 'data-highlighted-selector': highlightedSelector } : {})}
    >
      {/* Top Live Status & Multi-Agent Telemetry Strip */}
      {(busy || artboards.some((a) => a.status !== 'ready')) && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-[12px] shadow-xs"
          data-testid="prototype-live-modifying-badge"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            {reconnecting ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-warning">
                <WifiOff size={13.5} aria-hidden="true" />
                {t('连接波动，正在自动接回实时进度…', 'Reconnecting to live stream…')}
              </span>
            ) : busy ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-primary">
                <Wifi size={13.5} aria-hidden="true" />
                {t(
                  `实时预览在线 · ${Math.max(1, liveCursors.length)} 路智能体正在画板上并行施工`,
                  `Live preview active · ${Math.max(1, liveCursors.length)} assistant(s) building on canvas`,
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-warning">
                <AlertTriangle size={13.5} aria-hidden="true" />
                {t(
                  `已完成 ${readyCount}/${artboards.length} 个分屏并自动保存，剩余分屏可单独补全`,
                  `${readyCount}/${artboards.length} screens saved; remaining screens can be resumed individually`,
                )}
              </span>
            )}

            {artboards.length > 0 && (
              <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                {streamingCount > 0
                  ? t(
                      `已就绪 ${readyCount}/${artboards.length} · ${streamingCount} 屏实时长出中`,
                      `Ready ${readyCount}/${artboards.length} · ${streamingCount} streaming live`,
                    )
                  : t(`已就绪 ${readyCount}/${artboards.length}`, `Ready ${readyCount}/${artboards.length}`)}
              </span>
            )}
          </div>

          {liveStreamedChars > 0 && busy && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {t(`已实时流式接收 ${liveStreamedChars} 字`, `Streamed ${liveStreamedChars} chars`)}
            </span>
          )}
        </div>
      )}

      {/* Multi-Agent Floating Cursors Layer (keyed by workerSlot so cursors fly across artboards!) */}
      <div className="relative flex-1">
        {liveCursors.map((cursor) => (
          <div
            key={`worker-slot-${cursor.workerSlot}`}
            data-testid={`artboard-live-cursor-${cursor.id}`}
            data-cursor-phase={cursor.phase}
            data-cursor-zone={cursor.zone}
            className="pointer-events-none absolute z-30"
            style={{
              top: `${cursor.topPercent}%`,
              left: `${cursor.leftPercent}%`,
              transition:
                'top 760ms cubic-bezier(0.22, 1, 0.36, 1), left 760ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <div className="relative flex items-start">
              <MousePointer2
                size={19}
                className={cn(
                  '-mt-0.5 -ml-0.5 shrink-0 transition-transform duration-300',
                  cursor.clicking ? 'scale-90' : 'scale-100',
                )}
                style={{ color: cursor.colorVar, fill: cursor.colorVar }}
                aria-hidden="true"
              />
              {/* Click / Paint Ripple Ring */}
              <span
                className="absolute -top-1.5 -left-1.5 h-5 w-5 animate-ping rounded-full opacity-45"
                style={{ backgroundColor: cursor.colorVar }}
                aria-hidden="true"
              />
              {cursor.clicking && (
                <span
                  className="absolute -top-2 -left-2 h-6 w-6 rounded-full border-2 opacity-60 transition-all duration-300"
                  style={{ borderColor: cursor.colorVar }}
                  aria-hidden="true"
                />
              )}
              <div
                className="ml-1.5 mt-2 flex max-w-[252px] flex-col gap-0.5 rounded-md px-2.5 py-1 text-[11px] leading-snug shadow-md"
                style={{
                  backgroundColor: cursor.colorVar,
                  color: 'var(--model-foreground)',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 font-semibold">
                    {cursor.phase === 'STREAMING' && (
                      <Sparkles size={10.5} className="animate-pulse" aria-hidden="true" />
                    )}
                    {cursor.workerLabel}
                  </span>
                  {cursor.chars ? (
                    <span className="font-mono text-[10px] opacity-85">{cursor.chars}c</span>
                  ) : null}
                </div>
                <span className="truncate opacity-95">{cursor.actionLabel}</span>
              </div>
            </div>
          </div>
        ))}

        {/* Case A: 0-3s Initial Planning Skeleton Artboards (before init_prototype_shell emits HTML) */}
        {artboards.length === 0 ? (
          <div
            className="grid grid-cols-1 gap-4 lg:grid-cols-2"
            data-testid="prototype-skeleton-artboards"
          >
            {[1, 2, 3, 4].map((slotNum, idx) => {
              const isPatrolledSlot = busy && patrolTick % 4 === idx;
              return (
                <div
                  key={slotNum}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm transition-all duration-500',
                    isPatrolledSlot ? 'border-primary ring-2 ring-primary/20' : 'border-border',
                  )}
                >
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-medium text-foreground">
                      {projectName
                        ? t(`${projectName} · 分屏 0${slotNum}`, `${projectName} · Screen 0${slotNum}`)
                        : t(`分屏画板 0${slotNum}`, `Artboard 0${slotNum}`)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                      {t('搭建骨架中…', 'Preparing shell…')}
                    </span>
                  </div>
                  <div className="flex h-[250px] flex-col gap-3 rounded-md border border-dashed border-border bg-muted/35 p-4">
                    <div className="h-6 w-2/5 animate-pulse rounded bg-muted" />
                    <div className="grid grid-cols-3 gap-2.5">
                      <div className="h-16 animate-pulse rounded bg-muted" />
                      <div className="h-16 animate-pulse rounded bg-muted" />
                      <div className="h-16 animate-pulse rounded bg-muted" />
                    </div>
                    <div className="flex-1 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Case B: Live Sandboxed Artboard Frames Side-by-Side (Variant A `doop` Canvas) */
          <div
            className={cn(
              'grid gap-4',
              artboards.length === 1 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2',
            )}
          >
            {artboards.map((board, idx) => {
              const titleText = cleanLabel(
                board.screenName,
                `业务分屏 0${idx + 1}`,
                `Screen 0${idx + 1}`,
              );
              const assignedCursor = cursorByScreenId.get(board.screenId);
              const isHighlighted =
                highlightedScreenId === board.screenId ||
                activeRunningAnchor?.screenId === board.screenId ||
                Boolean(assignedCursor);
              const isQueued = board.status === 'queued';
              const isStreaming = board.status === 'streaming';
              const zoneBox = assignedCursor ? ZONE_BOX_STYLE[assignedCursor.zone] : null;

              return (
                <article
                  key={board.screenId}
                  data-testid={`prototype-artboard-card-${board.screenId}`}
                  data-artboard-status={board.status}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border bg-card p-2.5 shadow-sm transition-all duration-300',
                    isHighlighted ? 'border-primary ring-2 ring-primary/25' : 'border-border',
                  )}
                >
                  {/* Artboard Frame Header */}
                  <header className="flex flex-wrap items-center justify-between gap-2 px-1 text-[12px]">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-[11px] text-faint-foreground">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <strong className="truncate font-title text-[13px] text-foreground">
                        {titleText}
                      </strong>
                      {!isBusiness && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {board.screenId}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {isStreaming ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">
                          <Sparkles size={11.5} className="animate-pulse" aria-hidden="true" />
                          {t('实时落笔中…', 'Streaming live…')}
                        </span>
                      ) : isQueued ? (
                        busy ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                            {assignedCursor
                              ? t('构思布局中…', 'Wireframing…')
                              : t('排队等待中…', 'Queued…')}
                          </span>
                        ) : (
                          onRetryScreen && (
                            <Button
                              type="button"
                              variant="accent"
                              size="xs"
                              data-testid={`artboard-retry-btn-${board.screenId}`}
                              onClick={() => onRetryScreen(board.screenId, titleText)}
                            >
                              <RefreshCw size={11.5} aria-hidden="true" />
                              {t('继续生成此屏', 'Resume screen')}
                            </Button>
                          )
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-success">
                          <CheckCircle2 size={12} aria-hidden="true" />
                          {t('已落盘', 'Saved')}
                        </span>
                      )}

                      {onFocusScreen && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          data-testid={`artboard-focus-btn-${board.screenId}`}
                          onClick={() => onFocusScreen(board.screenId)}
                          title={t('放大单屏实操测试', 'Open in interactive single-screen view')}
                        >
                          <Maximize2 size={11.5} aria-hidden="true" />
                          <span>{t('单屏实操', 'Interact')}</span>
                        </Button>
                      )}
                    </div>
                  </header>

                  {/* Scaled Artboard Viewport Container + Active Wireframe Selection Box */}
                  <div className="relative h-[340px] w-full overflow-hidden rounded-md border border-border-subtle bg-background">
                    <LiveArtboardFrame
                      board={board}
                      titleText={titleText}
                      onMeasuredWritingPoint={handleMeasuredWritingPoint}
                    />

                    {/* `doop`-style Active Wireframe Region Marquee while agent is designing this board */}
                    {assignedCursor && zoneBox && assignedCursor.phase === 'THINKING' && (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute z-10 rounded-md border-2 border-dashed transition-all duration-700 ease-out"
                        style={{
                          top: zoneBox.top,
                          left: zoneBox.left,
                          width: zoneBox.width,
                          height: zoneBox.height,
                          borderColor: assignedCursor.colorVar,
                          backgroundColor: 'var(--primary-soft)',
                          opacity: 0.35,
                        }}
                      />
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
