import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Database,
  FileCode2,
  GitBranch,
  Loader2,
  Sparkles,
  Wrench,
  Crosshair,
} from 'lucide-react';
import type { AgentToolCallTrace } from '../../../packages/workspace-store/index.js';
import type { ModelCode } from '../../../packages/ontology-core/index.js';
import { cn } from '../../lib/utils.js';

export interface ToolChipsProps {
  traces: AgentToolCallTrace[];
  testId?: string;
  onJumpToOntology?: (modelCode: ModelCode, elementId?: string) => void;
  className?: string;
}

function getToolIcon(name: string) {
  if (name.includes('sql') || name.includes('db') || name.includes('query')) return Database;
  if (name.includes('rule') || name.includes('scenario') || name.includes('element')) return GitBranch;
  if (name.includes('compile') || name.includes('package') || name.includes('skill')) return FileCode2;
  if (name.includes('ask_user')) return Sparkles;
  return Wrench;
}

export function ToolChips({
  traces,
  testId,
  onJumpToOntology,
  className,
}: ToolChipsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!traces || traces.length === 0) {
    return null;
  }

  return (
    <div className={cn('w-full space-y-1.5', className)} data-testid={testId}>
      <div className="flex flex-wrap items-center gap-1.5">
        {traces.map((trace) => {
          const Icon = getToolIcon(trace.toolName);
          const running = trace.durationMs === undefined && !trace.output;
          const isError = Boolean(trace.isError);
          const isExpanded = expandedId === trace.id;

          return (
            <button
              key={trace.id}
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : trace.id)}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded-chip px-2 font-mono text-[11.5px] cursor-pointer',
                'transition-[background-color,color,box-shadow] duration-150 ease-out-strong',
                running && 'bg-accent-tint text-accent shadow-hairline',
                isError && 'bg-red-tint text-red shadow-hairline',
                !running &&
                  !isError &&
                  'bg-surface text-ink-2 shadow-hairline hover:bg-hover hover:text-ink',
                isExpanded && 'ring-1 ring-accent/50',
              )}
            >
              {running ? (
                <Loader2 size={11.5} strokeWidth={2} className="animate-[spin_0.9s_linear_infinite]" />
              ) : isError ? (
                <AlertTriangle size={11.5} strokeWidth={2} />
              ) : (
                <Icon size={11.5} strokeWidth={1.75} className="text-ink-3" />
              )}
              <span>{trace.toolName}</span>
              {trace.targetModelCode && (
                <span className="rounded bg-inset px-1 py-0.2 text-[10px] text-ink-3">
                  {trace.targetModelCode}
                  {trace.targetElementId ? `:${trace.targetElementId}` : ''}
                </span>
              )}
              {trace.validatorRepair && (
                <span className="rounded bg-orange-tint px-1 text-[10px] text-orange">
                  Auto-Repair
                </span>
              )}
              {typeof trace.durationMs === 'number' && !running && (
                <span className="text-[10px] text-ink-3">{trace.durationMs}ms</span>
              )}
              {!running && !isError && (
                <Check
                  size={10.5}
                  strokeWidth={2.5}
                  className="text-green animate-[pop-in_180ms_var(--ease-out-strong)_both]"
                />
              )}
              <ChevronRight
                size={11}
                className={cn(
                  'text-ink-3 transition-transform duration-150',
                  isExpanded && 'rotate-90',
                )}
              />
            </button>
          );
        })}
      </div>

      {expandedId && (() => {
        const active = traces.find((t) => t.id === expandedId);
        if (!active) return null;
        return (
          <div className="rounded-card border border-line bg-inset/60 p-2.5 text-[11.5px] animate-[fade-up_160ms_var(--ease-out-strong)_both]">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="font-mono font-semibold text-ink">
                {active.toolName}{' '}
                <span className="font-normal text-ink-3">
                  ({active.isError ? 'ERROR' : active.output ? 'DONE' : 'RUNNING'})
                </span>
              </span>
              {active.targetModelCode && onJumpToOntology && (
                <button
                  type="button"
                  onClick={() =>
                    onJumpToOntology(
                      active.targetModelCode as ModelCode,
                      active.targetElementId,
                    )
                  }
                  className="cursor-pointer rounded-chip bg-accent-tint px-2 py-0.5 text-[11px] font-medium text-accent hover:opacity-85"
                >
                  <Crosshair size={12} aria-hidden="true" className="inline-block shrink-0 align-[-2px]" /> 定位 {active.targetModelCode}
                  {active.targetElementId ? ` · ${active.targetElementId}` : ''}
                </button>
              )}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <div className="mb-0.5 text-[10.5px] text-ink-3">Arguments</div>
                <pre className="max-h-36 overflow-auto rounded bg-surface p-2 font-mono text-[11px] text-ink-2 shadow-hairline">
                  {JSON.stringify(active.arguments ?? {}, null, 2)}
                </pre>
              </div>
              <div>
                <div className="mb-0.5 text-[10.5px] text-ink-3">Result / Validator Feedback</div>
                <pre className="max-h-36 overflow-auto rounded bg-surface p-2 font-mono text-[11px] text-ink-2 shadow-hairline whitespace-pre-wrap">
                  {active.output || 'Executing...'}
                </pre>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
