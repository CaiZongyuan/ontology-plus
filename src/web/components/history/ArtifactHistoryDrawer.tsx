import React from 'react';
import { History, RotateCcw, Sparkles, Undo2, User } from 'lucide-react';
import {
  BUSINESS_VOCABULARY,
  checkBusinessViewMarkup,
  type BilingualText,
} from '../../../packages/business-vocabulary/index.js';
import type {
  ArtifactHistoryEntryView,
  ArtifactJumpTarget,
} from '../../../packages/workspace-store/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../beautifui/index.js';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '../ui/drawer.js';

export interface ArtifactHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifactLabel: BilingualText;
  entries: readonly ArtifactHistoryEntryView[];
  busyEntryId?: string | null;
  onUndoLatest?: (entry: ArtifactHistoryEntryView) => void | Promise<void>;
  onRestoreBefore?: (entry: ArtifactHistoryEntryView) => void | Promise<void>;
  onJumpToTarget?: (target: ArtifactJumpTarget) => void;
}

function formatHistoryTimestamp(iso: string): string {
  const clean = iso.replace('T', ' ').slice(0, 19);
  return clean || iso;
}

function SourceGlyph({ kind }: { kind: ArtifactHistoryEntryView['source']['kind'] }) {
  if (kind === 'AGENT_RUN') {
    return <Sparkles size={13} className="shrink-0 text-primary" aria-hidden="true" />;
  }
  if (kind === 'UNDO') {
    return <Undo2 size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  if (kind === 'RESTORE') {
    return <RotateCcw size={13} className="shrink-0 text-primary" aria-hidden="true" />;
  }
  return <User size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />;
}

export function ArtifactHistoryDrawer({
  open,
  onOpenChange,
  artifactLabel,
  entries,
  busyEntryId = null,
  onUndoLatest,
  onRestoreBefore,
  onJumpToTarget,
}: ArtifactHistoryDrawerProps) {
  const { t } = usePreferences();
  const label = t(artifactLabel.zh, artifactLabel.en);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" closeLabel={t('关闭', 'Close')}>
        <div
          className="flex min-h-0 flex-1 flex-col gap-4"
          data-testid="artifact-history-drawer"
        >
          <DrawerHeader>
            <DrawerTitle>
              {t(`${label} · 历史与恢复`, `${label} · History & Restore`)}
            </DrawerTitle>
            <DrawerDescription>
              {t(
                `包含 ${BUSINESS_VOCABULARY.AI_ASSISTANT.zh}更新与手动修改的同一条历史。最近一次改动可直接撤销；恢复到更早状态会新增一条记录，不会抹掉之后的工作，并且这次恢复也能撤销。`,
                `One linear timeline combining ${BUSINESS_VOCABULARY.AI_ASSISTANT.en} updates and manual edits. Undo applies to the latest change; restoring to before an earlier change appends a new state that can itself be undone.`,
              )}
            </DrawerDescription>
          </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {entries.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-md border border-border bg-muted/40 px-4 py-10 text-center"
              data-testid="artifact-history-empty"
            >
              <History size={20} className="text-muted-foreground" aria-hidden="true" />
              <p className="m-0 text-[13px] font-medium text-foreground">
                {t('还没有记录到改动历史', 'No changes recorded yet')}
              </p>
              <p className="m-0 text-[12.5px] leading-relaxed text-muted-foreground">
                {t(
                  `当${BUSINESS_VOCABULARY.AI_ASSISTANT.zh}或你修改了${label}后，每次改动都会按时间顺序记录在这里。`,
                  `Changes made by the ${BUSINESS_VOCABULARY.AI_ASSISTANT.en} or by you will appear here in chronological order.`,
                )}
              </p>
            </div>
          ) : (
            <ol className="m-0 list-none space-y-3 p-0" data-testid="artifact-history-list">
              {entries.map((entry, idx) => {
                const isLatest = idx === 0 && entry.changeSummary.canUndo;
                const isBusy = busyEntryId === entry.id;
                const rawReason = entry.changeSummary.reason
                  ? t(entry.changeSummary.reason.zh, entry.changeSummary.reason.en).trim()
                  : '';
                const safeReason =
                  rawReason &&
                  checkBusinessViewMarkup(rawReason, { plainText: true }).length === 0
                    ? rawReason
                    : '';

                return (
                  <li
                    key={entry.id}
                    data-testid="artifact-history-item"
                    data-entry-id={entry.id}
                    data-source-kind={entry.source.kind}
                    className={cn(
                      'space-y-2 rounded-md border border-border p-3.5 text-[12.5px]',
                      isLatest ? 'bg-card' : 'bg-muted/35',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <SourceGlyph kind={entry.source.kind} />
                        <span className="font-semibold text-foreground">
                          {t(entry.title.zh, entry.title.en)}
                        </span>
                        {isLatest && (
                          <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[12px] font-medium text-primary">
                            {t('最近一次', 'Latest')}
                          </span>
                        )}
                        {entry.changeSummary.isUndone && (
                          <span className="rounded-sm border border-border bg-background px-1.5 py-0.5 text-[12px] text-muted-foreground">
                            {t('已撤销', 'Undone')}
                          </span>
                        )}
                      </div>
                      <time className="font-mono text-[12px] text-muted-foreground">
                        {formatHistoryTimestamp(entry.createdAt)}
                      </time>
                    </div>

                    {safeReason && (
                      <p className="m-0 text-[12.5px] leading-relaxed text-muted-foreground">
                        {safeReason}
                      </p>
                    )}

                    {entry.changeSummary.items.length > 0 && (
                      <ul className="m-0 list-none space-y-1 p-0">
                        {entry.changeSummary.items.slice(0, 6).map((item) => {
                          const itemLabel = t(item.label.zh, item.label.en);
                          const clickable = Boolean(item.jumpTarget && onJumpToTarget);
                          return (
                            <li key={item.id}>
                              {clickable ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onOpenChange(false);
                                    onJumpToTarget!(item.jumpTarget!);
                                  }}
                                  className="w-full cursor-pointer rounded-sm px-2 py-1 text-left text-[12px] text-foreground hover:bg-background"
                                >
                                  {itemLabel}
                                </button>
                              ) : (
                                <span className="block px-2 py-0.5 text-[12px] text-muted-foreground">
                                  {itemLabel}
                                </span>
                              )}
                            </li>
                          );
                        })}
                        {entry.changeSummary.items.length > 6 && (
                          <li className="px-2 text-[12px] text-muted-foreground">
                            {t(
                              `其余 ${entry.changeSummary.items.length - 6} 项改动…`,
                              `${entry.changeSummary.items.length - 6} more changes…`,
                            )}
                          </li>
                        )}
                      </ul>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      {isLatest && onUndoLatest ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="xs"
                          data-testid="history-undo-latest-btn"
                          disabled={Boolean(busyEntryId)}
                          onClick={() => void onUndoLatest(entry)}
                        >
                          <Undo2 size={11} aria-hidden="true" />
                          {isBusy
                            ? t('正在撤销…', 'Undoing…')
                            : t('撤销这次改动', 'Undo this change')}
                        </Button>
                      ) : !isLatest && onRestoreBefore ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          data-testid="history-restore-before-btn"
                          disabled={Boolean(busyEntryId)}
                          onClick={() => void onRestoreBefore(entry)}
                        >
                          <RotateCcw size={11} aria-hidden="true" />
                          {isBusy
                            ? t('正在恢复…', 'Restoring…')
                            : t('恢复到此改动之前', 'Restore to before this change')}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
