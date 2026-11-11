import React, { useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Button } from './Button.js';

export interface RegistryStatusFilter<S extends string = string> {
  value: S | 'ALL';
  label: string;
}

export interface RegistryColumn<T> {
  key: string;
  header: string;
  width?: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => React.ReactNode;
}

export interface RegistryTableProps<T> {
  title: string;
  subtitle?: string;
  rows: T[];
  getRowKey: (row: T) => string;
  activeRowKey?: string | null;
  columns: RegistryColumn<T>[];
  searchPlaceholder?: string;
  matchesSearch?: (row: T, query: string) => boolean;
  statusFilters?: RegistryStatusFilter[];
  getRowStatus?: (row: T) => string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  primaryActionTestId?: string;
  headerExtra?: React.ReactNode;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  testId?: string;
  className?: string;
}

/**
 * Management Registry Table adapted from `beautifului.dev` `FilterTable` & `RecordsTable`
 * with `modern-web-guidance` `responsive-table` scroll container (`role="region"` + `tabIndex={0}`).
 */
export function RegistryTable<T>({
  title,
  subtitle,
  rows,
  getRowKey,
  activeRowKey,
  columns,
  searchPlaceholder = '搜索 ID、名称或标签…',
  matchesSearch,
  statusFilters,
  getRowStatus,
  primaryActionLabel,
  onPrimaryAction,
  primaryActionTestId,
  headerExtra,
  onRowClick,
  emptyMessage = '当前筛选条件下暂无记录',
  testId = 'registry-table',
  className,
}: RegistryTableProps<T>) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string>('ALL');

  const counts = useMemo(() => {
    const map: Record<string, number> = { ALL: rows.length };
    if (getRowStatus) {
      for (const r of rows) {
        const s = getRowStatus(r);
        map[s] = (map[s] ?? 0) + 1;
      }
    }
    return map;
  }, [rows, getRowStatus]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== 'ALL' && getRowStatus && getRowStatus(row) !== status) {
        return false;
      }
      if (q && matchesSearch) {
        return matchesSearch(row, q);
      }
      return true;
    });
  }, [rows, query, status, getRowStatus, matchesSearch]);

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-window bg-surface shadow-card text-[13px]',
        className,
      )}
      data-testid={testId}
    >
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="m-0 text-[14px] font-semibold text-ink">{title}</h3>
            <span className="rounded-full bg-inset px-2 py-0.5 font-mono text-[11.5px] text-ink-3 tabular-nums">
              {filtered.length}/{rows.length}
            </span>
          </div>
          {subtitle && <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">{subtitle}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {headerExtra}
          {primaryActionLabel && onPrimaryAction && (
            <Button
              variant="accent"
              size="sm"
              onClick={onPrimaryAction}
              data-testid={primaryActionTestId}
            >
              <Plus size={13} strokeWidth={2.2} />
              {primaryActionLabel}
            </Button>
          )}
        </div>
      </div>

      {/* Search & Status Filter Bar */}
      {(matchesSearch || (statusFilters && statusFilters.length > 0)) && (
        <div className="primitive-card-bar flex flex-wrap items-center gap-2 border-b border-line bg-inset/35">
          {matchesSearch && (
            <div className="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-control bg-surface px-2.5 py-1 shadow-hairline">
              <Search size={13} strokeWidth={1.75} className="shrink-0 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full bg-transparent text-[12.5px] text-ink placeholder:text-ink-3 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="cursor-pointer rounded-full p-0.5 text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <X size={11} strokeWidth={2} />
                </button>
              )}
            </div>
          )}

          {statusFilters && statusFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {statusFilters.map((f) => {
                const active = status === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setStatus(f.value)}
                    className={cn(
                      'inline-flex h-6 items-center gap-1.5 rounded-[5px] px-2.5 text-[11.5px] font-medium cursor-pointer transition-colors duration-150',
                      active
                        ? 'bg-surface text-ink shadow-hairline'
                        : 'text-ink-3 hover:bg-hover hover:text-ink-2',
                    )}
                  >
                    {f.label}
                    <span
                      className={cn(
                        'font-mono text-[10.5px] tabular-nums',
                        active ? 'opacity-75' : 'text-ink-3',
                      )}
                    >
                      {counts[f.value] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Accessible Responsive Scroll Region (modern-web-guidance: responsive-table) */}
      <div
        className="responsive-table-region"
        role="region"
        aria-label={title}
        tabIndex={0}
      >
        <table>
          <thead>
            <tr className="border-b border-line bg-inset/50 text-[11.5px] font-semibold text-ink-3">
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    'primitive-table-cell select-none whitespace-nowrap',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    (!col.align || col.align === 'left') && 'text-left',
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-10 text-center text-[12.5px] text-ink-3"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const key = getRowKey(row);
                const isActive = activeRowKey === key;
                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      'transition-colors duration-120',
                      onRowClick && 'cursor-pointer hover:bg-hover',
                      isActive && 'bg-accent-tint/55',
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          'primitive-table-cell align-middle',
                          col.align === 'right' && 'text-right',
                          col.align === 'center' && 'text-center',
                        )}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

