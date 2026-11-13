import React from 'react';
import { Crosshair, RotateCcw, Sparkles, X } from 'lucide-react';
import type { PrototypeTargetAnchor } from '../../../packages/workspace-store/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { LocalImageThumbnail } from '../agent/VisionAttachmentControls.js';
import { Button } from '../beautifui/index.js';
import {
  usePrototypeSelectionStore,
  type BeforeAfterViewMode,
  type PostRunPrototypeReview,
  type PrototypeSelectionAttachment,
} from './prototypeSelectionStore.js';

const EMPTY_ATTACHMENTS: PrototypeSelectionAttachment[] = [];

function formatAnchorChip(anchor: PrototypeTargetAnchor): string {
  const parts: string[] = [];
  if (anchor.screenId) parts.push(anchor.screenId);
  if (anchor.elementId) parts.push(anchor.elementId);
  if (parts.length > 0) return parts.join(' · ');
  return anchor.label || anchor.cssSelector || '';
}

export interface SelectionAttachmentStripProps {
  prototypeId: string;
  className?: string;
}

export function SelectionAttachmentStrip({
  prototypeId,
  className,
}: SelectionAttachmentStripProps) {
  const { t } = usePreferences();
  const attachments = usePrototypeSelectionStore(
    (s) => s.attachmentsByPrototype[prototypeId] ?? EMPTY_ATTACHMENTS,
  );
  const removeSelectionAttachment = usePrototypeSelectionStore(
    (s) => s.removeSelectionAttachment,
  );
  const clearAttachments = usePrototypeSelectionStore((s) => s.clearAttachments);
  const hoverAttachment = usePrototypeSelectionStore((s) => s.hoverAttachment);

  if (attachments.length === 0) return null;

  return (
    <div
      data-testid="selection-attachment-strip"
      aria-label={t('画布框选附件列表', 'Canvas selection attachments')}
      className={cn(
        'flex flex-col gap-1.5 rounded-[8px] border border-line bg-surface-2/80 p-2',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-0.5 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink-2">
          <Crosshair size={12} className="text-accent shrink-0" aria-hidden="true" />
          <span>
            {t(
              `已框选目标 (${attachments.length})`,
              `Selected Regions (${attachments.length})`,
            )}
          </span>
        </span>
        <button
          type="button"
          data-testid="selection-attachment-clear-all"
          className="text-[11px] text-muted hover:text-ink transition-colors"
          onClick={() => clearAttachments(prototypeId)}
        >
          {t('清空', 'Clear')}
        </button>
      </div>

      <div className="flex flex-col gap-1.5 max-h-[196px] overflow-y-auto pr-0.5">
        {attachments.map((att, idx) => {
          const anchorBadge = [att.target.screenId, att.target.elementId]
            .filter(Boolean)
            .join(' · ');
          return (
            <div
              key={att.id}
              data-testid={`selection-attachment-card-${att.id}`}
              onMouseEnter={() => hoverAttachment(att)}
              onMouseLeave={() => hoverAttachment(null)}
              onFocus={() => hoverAttachment(att)}
              onBlur={() => hoverAttachment(null)}
              className="group relative flex items-center gap-2 rounded-[6px] border border-line bg-surface p-1.5 transition-colors hover:border-accent"
            >
              <LocalImageThumbnail
                attachment={att.imageRef}
                compact
                className="w-[68px] shrink-0"
              />

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold text-white shrink-0">
                    {idx + 1}
                  </span>
                  {anchorBadge ? (
                    <span
                      className="truncate font-mono text-[10.5px] font-medium text-accent"
                      title={anchorBadge}
                    >
                      {anchorBadge}
                    </span>
                  ) : (
                    <span className="truncate font-mono text-[10.5px] text-muted">
                      {att.target.cssSelector}
                    </span>
                  )}
                </div>

                <div
                  className="truncate text-[11.5px] font-medium text-ink"
                  title={att.target.label}
                >
                  {att.target.label}
                </div>

                {att.note && (
                  <div className="truncate text-[11px] text-muted" title={att.note}>
                    {att.note}
                  </div>
                )}
              </div>

              <button
                type="button"
                data-testid={`selection-attachment-remove-${att.id}`}
                aria-label={t(
                  `移除框选附件 ${att.semanticLabel}`,
                  `Remove selection ${att.semanticLabel}`,
                )}
                title={t('移除此框选目标', 'Remove selection')}
                onClick={() => removeSelectionAttachment(prototypeId, att.id)}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X size={12.5} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface PrototypePostRunBannerProps {
  review: PostRunPrototypeReview;
  mode: BeforeAfterViewMode;
  busy?: boolean;
  onModeChange: (mode: BeforeAfterViewMode) => void;
  onRevert: () => void;
  onDismiss: () => void;
  className?: string;
}

export function PrototypePostRunBanner({
  review,
  mode,
  busy = false,
  onModeChange,
  onRevert,
  onDismiss,
  className,
}: PrototypePostRunBannerProps) {
  const { t } = usePreferences();
  const anchorChips = review.modifiedAnchors.map(formatAnchorChip).filter(Boolean);

  return (
    <div
      data-testid="prototype-post-run-banner"
      role="region"
      aria-label={t('本轮原型修改前后对比与回退', 'Post-run Before/After comparison and revert')}
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-b border-line bg-accent-tint/50 px-3 py-1.5 text-[12px] text-ink shrink-0',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        <Sparkles size={13.5} className="text-accent shrink-0" aria-hidden="true" />
        <span className="badge badge-accent font-mono text-[10.5px]">
          R{review.revision.revisionNumber}
        </span>
        <span className="font-medium text-ink">
          {mode === 'BEFORE'
            ? t(
                `正在对比改前版本 R${review.previousRevision.revisionNumber}`,
                `Comparing Before (R${review.previousRevision.revisionNumber})`,
              )
            : t('已生成新修订', 'New revision ready')}
        </span>
        {anchorChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {anchorChips.slice(0, 3).map((chip) => (
              <span
                key={chip}
                className="rounded-[4px] border border-line bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
              >
                {chip}
              </span>
            ))}
            {anchorChips.length > 3 && (
              <span className="font-mono text-[10.5px] text-muted">
                +{anchorChips.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div
          role="group"
          aria-label={t('切换改前与改后预览', 'Toggle Before and After preview')}
          className="inline-flex items-center gap-0.5 rounded-[6px] border border-line bg-inset/50 p-0.5"
        >
          <Button
            type="button"
            variant="toggle"
            size="xs"
            data-testid="prototype-before-toggle-btn"
            aria-pressed={mode === 'BEFORE'}
            onClick={() => onModeChange('BEFORE')}
          >
            {t('改前', 'Before')}{' '}
            <span className="font-mono text-[10.5px] opacity-85">
              R{review.previousRevision.revisionNumber}
            </span>
          </Button>
          <Button
            type="button"
            variant="toggle"
            size="xs"
            data-testid="prototype-after-toggle-btn"
            aria-pressed={mode === 'AFTER'}
            onClick={() => onModeChange('AFTER')}
          >
            {t('改后', 'After')}{' '}
            <span className="font-mono text-[10.5px] opacity-85">
              R{review.revision.revisionNumber}
            </span>
          </Button>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="xs"
          data-testid="prototype-revert-prev-revision-btn"
          disabled={busy}
          onClick={onRevert}
        >
          <RotateCcw size={11.5} aria-hidden="true" />
          <span>{t('回到上一修订', 'Revert to previous revision')}</span>
        </Button>

        <button
          type="button"
          data-testid="prototype-post-run-dismiss-btn"
          aria-label={t('关闭改前改后对比条', 'Dismiss Before/After bar')}
          title={t('关闭', 'Dismiss')}
          onClick={onDismiss}
          className="inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
