import React from 'react';
import type { ModelCallSummary } from '../../../../packages/workspace-store/index.js';
import { usePreferences } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import './context-inspector.css';

export const CONTEXT_OCCUPANCY_WARN_THRESHOLD_PCT = 70;

export interface ContextOccupancyState {
  readonly promptTokens: number;
  readonly contextWindow: number;
  readonly ratio: number;
  readonly pct: number;
  readonly warn: boolean;
}

export function computeContextOccupancy(
  latestCall?: Pick<ModelCallSummary, 'usage' | 'contextWindow'> | null,
): ContextOccupancyState {
  if (!latestCall || latestCall.contextWindow <= 0 || latestCall.usage.promptTokens <= 0) {
    return {
      promptTokens: 0,
      contextWindow: latestCall?.contextWindow && latestCall.contextWindow > 0 ? latestCall.contextWindow : 0,
      ratio: 0,
      pct: 0,
      warn: false,
    };
  }
  const promptTokens = Math.max(0, latestCall.usage.promptTokens);
  const contextWindow = latestCall.contextWindow;
  const ratio = Math.min(1, Math.max(0, promptTokens / contextWindow));
  const pct = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  return {
    promptTokens,
    contextWindow,
    ratio,
    pct,
    warn: pct >= CONTEXT_OCCUPANCY_WARN_THRESHOLD_PCT,
  };
}

export interface ContextOccupancyRingProps {
  latestCall?: Pick<ModelCallSummary, 'usage' | 'contextWindow'> | null;
  open?: boolean;
  onToggle?: () => void;
  size?: number;
}

/**
 * Circular SVG context-occupancy progress ring mounted beside Send/Stop in ConversationComposer (#82).
 * Renders ONLY the circular SVG progress ring (no visible text label), switches to warning token
 * colour at >=70%, and toggles the "对话记忆 / Conversation memory" overlay on click.
 */
export function ContextOccupancyRing({
  latestCall,
  open = false,
  onToggle,
  size = 18,
}: ContextOccupancyRingProps) {
  const { t } = usePreferences();
  const { promptTokens, ratio, pct, warn } = computeContextOccupancy(latestCall);

  const label = warn
    ? t(
        `对话记忆已用 ${pct}%：对话已较长，较早的内容可能被概括`,
        `Conversation memory ${pct}% used — conversation is getting long; earlier messages may be summarized`,
      )
    : t(`对话记忆已用 ${pct}%`, `Conversation memory ${pct}% used`);

  const strokeWidth = 2.4;
  const radius = (size - strokeWidth - 1) / 2;
  const circumference = 2 * Math.PI * radius;
  const visualRatio = promptTokens > 0 ? Math.max(0.03, ratio) : 0;
  const filledArc = circumference * visualRatio;

  return (
    <button
      type="button"
      className={cn(
        'context-occupancy-ring-btn',
        open && 'is-active',
        warn && 'is-warn',
      )}
      data-testid="context-occupancy-ring"
      data-occupancy-warn={warn ? 'true' : 'false'}
      data-occupancy-pct={String(pct)}
      aria-label={label}
      aria-expanded={open}
      title={label}
      onClick={onToggle}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="context-occupancy-ring-svg"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="context-occupancy-ring-track"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {filledArc > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className="context-occupancy-ring-value"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${filledArc} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeLinecap="round"
          />
        )}
      </svg>
    </button>
  );
}
