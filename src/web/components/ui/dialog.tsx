import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const DialogSsrOpenContext = React.createContext(false);

export type DialogProps<Payload = unknown> = DialogPrimitive.Root.Props<Payload>;

export function Dialog<Payload = unknown>(props: DialogProps<Payload>) {
  const ssrOpen = Boolean(props.open ?? props.defaultOpen);
  return (
    <DialogSsrOpenContext.Provider value={ssrOpen}>
      <DialogPrimitive.Root {...props} />
    </DialogSsrOpenContext.Provider>
  );
}

export type DialogTriggerProps = DialogPrimitive.Trigger.Props;

export function DialogTrigger({ className, ...props }: DialogTriggerProps) {
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
      className={cn(className)}
      {...props}
    />
  );
}

export type DialogPortalProps = DialogPrimitive.Portal.Props;

export function DialogPortal({ children, keepMounted, ...props }: DialogPortalProps) {
  const ssrOpen = React.useContext(DialogSsrOpenContext);
  if (typeof document === 'undefined') {
    if (!ssrOpen && !keepMounted) return null;
    return <div data-slot="dialog-portal">{children}</div>;
  }
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal" keepMounted={keepMounted} {...props}>
      {children}
    </DialogPrimitive.Portal>
  );
}

export type DialogCloseProps = DialogPrimitive.Close.Props;

export function DialogClose({ className, ...props }: DialogCloseProps) {
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      className={cn(className)}
      {...props}
    />
  );
}

export type DialogOverlayProps = DialogPrimitive.Backdrop.Props;

export function DialogOverlay({ className, ...props }: DialogOverlayProps) {
  const overlayClassName = cn(
    'fixed inset-0 bg-overlay/45 backdrop-blur-xs transition-opacity duration-150 ease-out-strong data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
    className,
  );
  if (typeof document === 'undefined') {
    return <div data-slot="dialog-overlay" data-open="" className={overlayClassName} />;
  }
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={overlayClassName}
      {...props}
    />
  );
}

export interface DialogContentProps extends DialogPrimitive.Popup.Props {
  showCloseButton?: boolean;
  closeLabel?: string;
}

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel = 'Close',
  ...props
}: DialogContentProps) {
  const popupClassName = cn(
    'fixed top-1/2 left-1/2 grid w-full max-w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-window border border-solid border-border bg-popover p-5 font-sans text-popover-foreground shadow-overlay transition-[opacity,transform] duration-150 ease-out-strong data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98]',
    className,
  );
  const closeControl = showCloseButton ? (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      aria-label={closeLabel}
      className="absolute top-3.5 right-3.5 inline-flex size-7 cursor-pointer items-center justify-center rounded-sm text-faint-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground [&_svg:not([class*='size-'])]:size-4"
    >
      <XIcon />
    </DialogPrimitive.Close>
  ) : null;

  return (
    <DialogPortal>
      <DialogOverlay />
      {typeof document === 'undefined' ? (
        <div
          role="dialog"
          aria-modal="true"
          data-slot="dialog-content"
          data-open=""
          className={popupClassName}
        >
          {children}
          {closeControl}
        </div>
      ) : (
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={popupClassName}
          {...props}
        >
          {children}
          {closeControl}
        </DialogPrimitive.Popup>
      )}
    </DialogPortal>
  );
}

export function DialogHeader({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5 pr-6', className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-wrap items-center justify-end gap-2', className)}
      {...props}
    />
  );
}

export type DialogTitleProps = DialogPrimitive.Title.Props;

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        'font-title text-[16px] leading-snug font-semibold text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export type DialogDescriptionProps = DialogPrimitive.Description.Props;

export function DialogDescription({
  className,
  ...props
}: DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'font-sans text-[13px] leading-relaxed text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
