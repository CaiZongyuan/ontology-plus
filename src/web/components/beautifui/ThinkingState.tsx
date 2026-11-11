import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export interface ThinkingRow {
  label: string;
  detail?: string;
}

export interface ThinkingStateProps {
  working: boolean;
  activeLabel?: string;
  doneLabel?: string;
  thinkingText?: string;
  rows?: ThinkingRow[];
  defaultOpen?: boolean;
  autoOpenWhileWorking?: boolean;
  className?: string;
}

export function ThinkingState({
  working,
  activeLabel = 'Thinking & checking 11-model constraints…',
  doneLabel = 'Reasoned through ontology context',
  thinkingText,
  rows = [],
  defaultOpen = false,
  autoOpenWhileWorking = false,
  className,
}: ThinkingStateProps) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const hasBody = Boolean((thinkingText && thinkingText.trim().length > 0) || rows.length > 0);
  const open =
    manualOpen !== null
      ? manualOpen
      : autoOpenWhileWorking
        ? working && hasBody
        : defaultOpen;

  useEffect(() => {
    if (working && open && bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = bodyScrollRef.current.scrollHeight;
    }
  }, [working, open, thinkingText]);

  if (!working && !hasBody) {
    return null;
  }

  return (
    <div className={cn('w-full text-[13px]', className)}>
      <button
        type="button"
        onClick={() => hasBody && setManualOpen(!open)}
        aria-expanded={open}
        className={cn(
          'group inline-flex items-center gap-1.5 rounded-chip py-1 text-left transition-colors duration-150',
          hasBody ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        <span
          className={cn(
            'inline-block font-medium',
            working
              ? 'bg-[linear-gradient(110deg,var(--muted)_35%,var(--ink)_50%,var(--muted)_65%)] bg-[length:220%_100%] bg-clip-text text-transparent animate-[shimmer-text_1.9s_linear_infinite]'
              : 'text-ink-3 group-hover:text-ink-2',
          )}
        >
          {working ? activeLabel : doneLabel}
        </span>
        {hasBody && (
          <ChevronRight
            size={13}
            strokeWidth={1.75}
            className={cn(
              'shrink-0 text-ink-3 transition-transform duration-200 ease-out-strong group-hover:text-ink-2',
              open && 'rotate-90',
            )}
          />
        )}
      </button>

      {hasBody && (
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-240 ease-out-strong',
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden">
            <div
              ref={bodyScrollRef}
              className={cn(
                'relative ml-1.5 mt-1 space-y-2 border-l border-line pl-4 pb-1 pt-0.5 text-[12.5px] leading-[1.55] text-ink-2',
                working && 'max-h-44 overflow-y-auto pr-1',
              )}
            >
              {rows.map((row, idx) => (
                <div key={`${row.label}-${idx}`} className="animate-[fade-up_220ms_var(--ease-out-strong)_both]">
                  <span className="text-ink-3">{row.label}</span>
                  {row.detail && <span className="ml-1.5 font-mono text-[11.5px] text-ink">{row.detail}</span>}
                </div>
              ))}
              {thinkingText && (
                <div className="whitespace-pre-wrap text-[12.5px] text-ink-3">{thinkingText}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

