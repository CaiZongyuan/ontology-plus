import React from 'react';
import { Edit3, LayoutList } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export interface ViewModeHeaderProps {
  mode: 'WORKSPACE' | 'REGISTRY';
  onChange: (next: 'WORKSPACE' | 'REGISTRY') => void;
  workspaceLabel: string;
  registryLabel: string;
  count: number;
  testIdPrefix: string;
  /** Identity of the thing being edited (picker, title, version), kept on the same bar as the mode switch. */
  centerSlot?: React.ReactNode;
  rightActions?: React.ReactNode;
}

// ─── Reusable Two-Level Workspace ↔ Registry Switcher Bar ───────────────────
export function ViewModeHeader({
  mode,
  onChange,
  workspaceLabel,
  registryLabel,
  count,
  testIdPrefix,
  centerSlot,
  rightActions,
}: ViewModeHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 overflow-hidden rounded-window border border-border bg-card px-3.5 py-2 shadow-xs">
      <div className="inline-flex shrink-0 items-center rounded-md border border-border bg-muted p-0.5">
        <button
          type="button"
          data-testid={`${testIdPrefix}-mode-workspace`}
          onClick={() => onChange('WORKSPACE')}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-[12.5px] font-medium cursor-pointer',
            mode === 'WORKSPACE' ? 'bg-card text-foreground shadow-hairline' : 'text-foreground-soft hover:text-foreground',
          )}
        >
          <Edit3 size={12.5} />
          {workspaceLabel}
        </button>
        <button
          type="button"
          data-testid={`${testIdPrefix}-mode-registry`}
          onClick={() => onChange('REGISTRY')}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-[12.5px] font-medium cursor-pointer',
            mode === 'REGISTRY' ? 'bg-card text-foreground shadow-hairline' : 'text-foreground-soft hover:text-foreground',
          )}
        >
          <LayoutList size={12.5} />
          {registryLabel}
          <span
            className={cn(
              'rounded-full px-1.5 font-mono text-xs tabular-nums',
              mode === 'REGISTRY' ? 'bg-muted text-muted-foreground' : 'bg-card text-faint-foreground',
            )}
          >
            {count}
          </span>
        </button>
      </div>
      {rightActions && (
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{rightActions}</div>
      )}
      {centerSlot && (
        <div className="-mx-3.5 -mb-2 flex min-w-0 basis-[calc(100%+1.75rem)] flex-wrap items-center gap-2 border-t bg-muted/40 px-3.5 py-2">
          {centerSlot}
        </div>
      )}
    </div>
  );
}
