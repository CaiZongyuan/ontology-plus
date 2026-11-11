import React, { useEffect, useId, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Button } from './Button.js';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
  size?: 'default' | 'wide';
  footerExtra?: React.ReactNode;
  children?: React.ReactNode;
  onConfirm?: () => void;
  onClose: () => void;
  testId?: string;
}

/**
 * Non-blocking native `<dialog>` modal following `modern-web-guidance` (`dialog` & `light-dismiss-a-dialog`):
 * - Uses declarative `closedby="any"` opened via `showModal()` and named via `aria-labelledby`.
 * - Includes progressive-enhancement coordinate fallback when `closedBy` is unsupported.
 * - Replaces all forbidden `window.alert / confirm / prompt` browser dialogs.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  busy = false,
  confirmDisabled = false,
  size = 'default',
  footerExtra,
  children,
  onConfirm,
  onClose,
  testId = 'bui-confirm-dialog',
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          dialog.setAttribute('open', '');
        }
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (
      !dialog ||
      typeof HTMLDialogElement === 'undefined' ||
      'closedBy' in HTMLDialogElement.prototype
    ) {
      return;
    }

    const isOutsideContent = (event: PointerEvent) => {
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };

    let pressedOutside = false;
    const handlePointerDown = (event: PointerEvent) => {
      pressedOutside = event.target === dialog && isOutsideContent(event);
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (pressedOutside && event.target === dialog && isOutsideContent(event)) {
        dialog.close();
      }
      pressedOutside = false;
    };

    dialog.addEventListener('pointerdown', handlePointerDown);
    dialog.addEventListener('pointerup', handlePointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', handlePointerDown);
      dialog.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      aria-labelledby={titleId}
      className={cn('bui-dialog', size === 'wide' && 'bui-dialog-wide')}
      data-testid={testId}
      onClose={onClose}
    >
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            {danger && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-tint text-red">
                <AlertTriangle size={13} strokeWidth={2} />
              </span>
            )}
            <h3 id={titleId} className="m-0 text-[14px] font-semibold text-ink">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="primitive-icon-button cursor-pointer text-ink-3 hover:bg-hover hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3.5 text-[13px] leading-relaxed text-ink-2">
          {description && <div>{description}</div>}
          {children}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-inset/45 px-4 py-2.5">
          <div>{footerExtra}</div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
              {cancelLabel}
            </Button>
            {onConfirm && (
              <Button
                variant={danger ? 'danger' : 'accent'}
                size="sm"
                onClick={onConfirm}
                disabled={busy || confirmDisabled}
                data-testid={`${testId}-confirm-btn`}
              >
                {busy ? '处理中...' : confirmLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
