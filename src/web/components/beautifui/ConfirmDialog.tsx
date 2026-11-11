import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './Button.js';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  children?: React.ReactNode;
  onConfirm?: () => void;
  onClose: () => void;
  testId?: string;
}

/**
 * Non-blocking native `<dialog>` modal following `modern-web-guidance` (`light-dismiss-a-dialog`):
 * - Uses declarative `closedby="any"` where supported.
 * - Includes progressive-enhancement backdrop click fallback (`event.target === dialogRef.current`).
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
  children,
  onConfirm,
  onClose,
  testId = 'bui-confirm-dialog',
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      className="bui-dialog"
      data-testid={testId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current.close();
        }
      }}
    >
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            {danger && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-tint text-red">
                <AlertTriangle size={13} strokeWidth={2} />
              </span>
            )}
            <h3 className="m-0 text-[14px] font-semibold text-ink">{title}</h3>
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

        <div className="flex items-center justify-end gap-2 border-t border-line bg-inset/45 px-4 py-2.5">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          {onConfirm && (
            <Button
              variant={danger ? 'danger' : 'accent'}
              size="sm"
              onClick={onConfirm}
              disabled={busy}
              data-testid={`${testId}-confirm-btn`}
            >
              {busy ? '处理中...' : confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}
