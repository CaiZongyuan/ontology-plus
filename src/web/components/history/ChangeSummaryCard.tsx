import React, { createContext, useContext, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Columns2,
  History,
  Minus,
  Pencil,
  Plus,
  Undo2,
} from 'lucide-react';
import {
  BUSINESS_VOCABULARY,
  checkBusinessViewMarkup,
  type BilingualText,
} from '../../../packages/business-vocabulary/index.js';
import type {
  ArtifactJumpTarget,
  ChangeSummaryItemView,
  ChangeSummaryView,
  PrototypeCompareRevisionPair,
} from '../../../packages/workspace-store/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../beautifui/index.js';

export type ChangeSummaryDisplayVariant = 'card' | 'strip';

export const ChangeSummaryDisplayVariantContext =
  createContext<ChangeSummaryDisplayVariant>('card');

const expandedChangeSummaries = new Set<string>();

export function isChangeSummaryExpanded(entryId: string | undefined): boolean {
  return entryId !== undefined && expandedChangeSummaries.has(entryId);
}

export function setChangeSummaryExpanded(entryId: string | undefined, expanded: boolean): void {
  if (!entryId) return;
  if (expanded) expandedChangeSummaries.add(entryId);
  else expandedChangeSummaries.delete(entryId);
}

export function clearChangeSummaryExpansionForTests(): void {
  expandedChangeSummaries.clear();
}

export interface ChangeSummaryCardProps {
  summary: ChangeSummaryView;
  variant?: ChangeSummaryDisplayVariant;
  defaultExpanded?: boolean;
  undoing?: boolean;
  onUndo?: (summary: ChangeSummaryView) => void | Promise<void>;
  onJumpToTarget?: (target: ArtifactJumpTarget) => void;
  onOpenHistory?: (artifactKind: ChangeSummaryView['artifactKind']) => void;
  onCompareRevisions?: (pair: PrototypeCompareRevisionPair) => void;
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

function formatStripHeadline(
  artifactKind: ChangeSummaryView['artifactKind'],
  count: number,
  t: (zh: string, en: string) => string,
): string {
  const enCount = count === 1 ? '1 change' : `${count} changes`;
  switch (artifactKind) {
    case 'REQUIREMENTS_DOC':
      return t(`需求文档改了 ${count} 处`, `Requirements document · ${enCount}`);
    case 'PROTOTYPE':
      return t(`界面原型改了 ${count} 处`, `Prototype · ${enCount}`);
    case 'ONTOLOGY_SUITE':
      return t(
        `${BUSINESS_VOCABULARY.ONTOLOGY_SUITE.zh}改了 ${count} 处`,
        `${BUSINESS_VOCABULARY.ONTOLOGY_SUITE.en} · ${enCount}`,
      );
  }
}

function ChangeSummaryGroupList({
  groups,
  onJumpToTarget,
}: {
  groups: readonly ItemGroup[];
  onJumpToTarget?: (target: ArtifactJumpTarget) => void;
}) {
  const { t } = usePreferences();

  return (
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
                detailText && checkBusinessViewMarkup(detailText, { plainText: true }).length === 0
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
  );
}

export function ChangeSummaryCard({
  summary,
  variant,
  defaultExpanded = false,
  undoing = false,
  onUndo,
  onJumpToTarget,
  onOpenHistory,
  onCompareRevisions,
  className,
}: ChangeSummaryCardProps) {
  const { t } = usePreferences();
  const contextVariant = useContext(ChangeSummaryDisplayVariantContext);
  const resolvedVariant = variant ?? contextVariant;

  const [stripExpanded, setStripExpanded] = useState<boolean>(
    () => defaultExpanded || isChangeSummaryExpanded(summary.entryId),
  );

  if (summary.items.length === 0) {
    return null;
  }

  const rawReason = summary.reason ? t(summary.reason.zh, summary.reason.en).trim() : '';
  const safeReason =
    rawReason && checkBusinessViewMarkup(rawReason, { plainText: true }).length === 0
      ? rawReason
      : '';

  const groups = groupChangeSummaryItems(summary.items);

  if (resolvedVariant === 'strip') {
    const headline = formatStripHeadline(summary.artifactKind, summary.items.length, t);

    const handleToggleStrip = () => {
      const next = !stripExpanded;
      setStripExpanded(next);
      setChangeSummaryExpanded(summary.entryId, next);
    };

    return (
      <section
        className={cn('mt-1 space-y-2 text-[12.5px] text-foreground', className)}
        data-testid="run-change-summary"
        data-variant="strip"
        data-expanded={stripExpanded ? 'true' : 'false'}
        data-artifact-kind={summary.artifactKind}
        data-entry-id={summary.entryId}
        aria-label={t(
          BUSINESS_VOCABULARY.CHANGE_SUMMARY.zh,
          BUSINESS_VOCABULARY.CHANGE_SUMMARY.en,
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-foreground-soft">
          <Check size={13} className="shrink-0 text-success" aria-hidden="true" />
          <span className="font-medium text-foreground-soft" data-testid="change-summary-headline">
            {headline}
          </span>

          {summary.isUndone && (
            <span
              className="rounded-sm border border-border bg-background px-1.5 py-0.5 text-[12px] text-muted-foreground"
              data-testid="change-summary-undone-badge"
            >
              {t('已撤销', 'Undone')}
            </span>
          )}

          <span className="text-faint-foreground" aria-hidden="true">
            ·
          </span>

          <button
            type="button"
            data-testid="change-summary-toggle-btn"
            aria-expanded={stripExpanded}
            onClick={handleToggleStrip}
            className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-medium text-primary hover:underline"
          >
            {stripExpanded ? t('收起', 'Hide') : t('查看', 'View')}
          </button>

          {summary.compareRevisionPair && onCompareRevisions && (
            <>
              <span className="text-faint-foreground" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                data-testid="change-summary-compare-btn"
                onClick={() => onCompareRevisions(summary.compareRevisionPair!)}
                className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12.5px] font-medium text-primary hover:underline"
              >
                <Columns2 size={12} aria-hidden="true" />
                {t('对比', 'Compare')}
              </button>
            </>
          )}

          {summary.canUndo && onUndo ? (
            <>
              <span className="text-faint-foreground" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                data-testid="change-summary-undo-btn"
                disabled={undoing}
                onClick={() => void onUndo(summary)}
                className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12.5px] font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Undo2 size={12} aria-hidden="true" />
                {undoing ? t('正在撤销…', 'Undoing…') : t('撤销', 'Undo')}
              </button>
            </>
          ) : !summary.canUndo && onOpenHistory ? (
            <>
              <span className="text-faint-foreground" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                data-testid="change-summary-open-history-btn"
                onClick={() => onOpenHistory(summary.artifactKind)}
                className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12.5px] font-medium text-primary hover:underline"
              >
                <History size={12} aria-hidden="true" />
                {t('查看历史', 'History')}
              </button>
            </>
          ) : null}
        </div>

        {stripExpanded && (
          <div
            className="space-y-2 rounded-md border border-border-subtle bg-muted/40 p-2.5"
            data-testid="change-summary-expanded-body"
          >
            {safeReason && (
              <p
                className="m-0 text-[12.5px] leading-relaxed text-muted-foreground"
                data-testid="change-summary-reason"
              >
                {safeReason}
              </p>
            )}
            <ChangeSummaryGroupList
              groups={groups}
              {...(onJumpToTarget ? { onJumpToTarget } : {})}
            />
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className={cn(
        'space-y-2 rounded-md border border-border bg-muted/40 p-3 text-[12.5px] text-foreground',
        className,
      )}
      data-testid="run-change-summary"
      data-variant="card"
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

          {summary.compareRevisionPair && onCompareRevisions && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="change-summary-compare-btn"
              onClick={() => onCompareRevisions(summary.compareRevisionPair!)}
            >
              <Columns2 size={11} aria-hidden="true" />
              {t('对比', 'Compare')}
            </Button>
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

      <ChangeSummaryGroupList groups={groups} {...(onJumpToTarget ? { onJumpToTarget } : {})} />
    </section>
  );
}
