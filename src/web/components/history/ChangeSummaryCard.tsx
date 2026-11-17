import React from 'react';
import { ArrowUpRight, History, Minus, Pencil, Plus, Undo2 } from 'lucide-react';
import {
  BUSINESS_VOCABULARY,
  checkBusinessViewMarkup,
  type BilingualText,
} from '../../../packages/business-vocabulary/index.js';
import type {
  ArtifactJumpTarget,
  ChangeSummaryItemView,
  ChangeSummaryView,
} from '../../../packages/workspace-store/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../beautifui/index.js';

export interface ChangeSummaryCardProps {
  summary: ChangeSummaryView;
  undoing?: boolean;
  onUndo?: (summary: ChangeSummaryView) => void | Promise<void>;
  onJumpToTarget?: (target: ArtifactJumpTarget) => void;
  onOpenHistory?: (artifactKind: ChangeSummaryView['artifactKind']) => void;
  className?: string;
}

function ChangeTypeGlyph({ kind }: { kind: ChangeSummaryItemView['changeType'] }) {
  if (kind === 'ADDED') {
    return <Plus size={12} className="shrink-0 text-success" aria-hidden="true" />;
  }
  if (kind === 'REMOVED') {
    return <Minus size={12} className="shrink-0 text-warning" aria-hidden="true" />;
  }
  return <Pencil size={12} className="shrink-0 text-primary" aria-hidden="true" />;
}

interface ItemGroup {
  key: string;
  label?: BilingualText;
  items: ChangeSummaryItemView[];
}

function groupChangeSummaryItems(items: readonly ChangeSummaryItemView[]): ItemGroup[] {
  const groups: ItemGroup[] = [];
  const byKey = new Map<string, ItemGroup>();

  for (const item of items) {
    const key = item.groupLabel ? `${item.groupLabel.zh}::${item.groupLabel.en}` : '__ungrouped__';
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        ...(item.groupLabel ? { label: item.groupLabel } : {}),
        items: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export function ChangeSummaryCard({
  summary,
  undoing = false,
  onUndo,
  onJumpToTarget,
  onOpenHistory,
  className,
}: ChangeSummaryCardProps) {
  const { t } = usePreferences();

  if (summary.items.length === 0) {
    return null;
  }

  const rawReason = summary.reason ? t(summary.reason.zh, summary.reason.en).trim() : '';
  const safeReason =
    rawReason && checkBusinessViewMarkup(rawReason, { plainText: true }).length === 0
      ? rawReason
      : '';

  const groups = groupChangeSummaryItems(summary.items);

  return (
    <section
      className={cn(
        'space-y-2 rounded-md border border-border bg-muted/40 p-3 text-[12.5px] text-foreground',
        className,
      )}
      data-testid="run-change-summary"
      data-artifact-kind={summary.artifactKind}
      data-entry-id={summary.entryId}
      aria-label={t(
        BUSINESS_VOCABULARY.CHANGE_SUMMARY.zh,
        BUSINESS_VOCABULARY.CHANGE_SUMMARY.en,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-foreground">
          {t(BUSINESS_VOCABULARY.CHANGE_SUMMARY.zh, BUSINESS_VOCABULARY.CHANGE_SUMMARY.en)}
        </span>

        <div className="flex items-center gap-1.5">
          {summary.isUndone && (
            <span
              className="rounded-sm border border-border bg-background px-2 py-0.5 text-[12px] text-muted-foreground"
              data-testid="change-summary-undone-badge"
            >
              {t('已撤销', 'Undone')}
            </span>
          )}

          {summary.canUndo && onUndo ? (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              data-testid="change-summary-undo-btn"
              disabled={undoing}
              onClick={() => void onUndo(summary)}
            >
              <Undo2 size={11} aria-hidden="true" />
              {undoing ? t('正在撤销…', 'Undoing…') : t('撤销', 'Undo')}
            </Button>
          ) : !summary.canUndo && onOpenHistory ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="change-summary-open-history-btn"
              onClick={() => onOpenHistory(summary.artifactKind)}
            >
              <History size={11} aria-hidden="true" />
              {t('查看历史', 'History')}
            </Button>
          ) : null}
        </div>
      </div>

      {safeReason && (
        <p
          className="m-0 text-[12.5px] leading-relaxed text-muted-foreground"
          data-testid="change-summary-reason"
        >
          {safeReason}
        </p>
      )}

      <div className="space-y-2">
        {groups.map((group) => (
          <div key={group.key} className="space-y-1">
            {group.label && (
              <div className="text-[12px] font-medium text-muted-foreground">
                {t(group.label.zh, group.label.en)}
              </div>
            )}
            <ul className="m-0 list-none space-y-1 p-0">
              {group.items.map((item) => {
                const labelText = t(item.label.zh, item.label.en);
                const detailText = item.detail ? t(item.detail.zh, item.detail.en) : '';
                const safeDetail =
                  detailText &&
                  checkBusinessViewMarkup(detailText, { plainText: true }).length === 0
                    ? detailText
                    : '';
                const clickable = Boolean(item.jumpTarget && onJumpToTarget);

                if (clickable) {
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        data-testid="change-summary-item"
                        data-change-type={item.changeType}
                        onClick={() => onJumpToTarget!(item.jumpTarget!)}
                        className="flex w-full cursor-pointer items-start gap-2 rounded-sm border border-transparent bg-background/75 px-2.5 py-1.5 text-left text-[12.5px] text-foreground hover:border-border hover:bg-background"
                      >
                        <span className="mt-0.5">
                          <ChangeTypeGlyph kind={item.changeType} />
                        </span>
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="block font-medium text-foreground">{labelText}</span>
                          {safeDetail && (
                            <span className="block truncate text-[12px] text-muted-foreground">
                              {safeDetail}
                            </span>
                          )}
                        </span>
                        <ArrowUpRight
                          size={13}
                          className="mt-0.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  );
                }

                return (
                  <li
                    key={item.id}
                    data-testid="change-summary-item"
                    data-change-type={item.changeType}
                    className="flex items-start gap-2 rounded-sm bg-background/55 px-2.5 py-1.5 text-[12.5px] text-foreground"
                  >
                    <span className="mt-0.5">
                      <ChangeTypeGlyph kind={item.changeType} />
                    </span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="block font-medium text-foreground">{labelText}</span>
                      {safeDetail && (
                        <span className="block truncate text-[12px] text-muted-foreground">
                          {safeDetail}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
