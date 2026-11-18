import * as React from 'react';
import { Dialog as DrawerPrimitive } from '@base-ui/react/dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { XIcon } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const DrawerSsrOpenContext = React.createContext(false);

export type DrawerProps<Payload = unknown> = DrawerPrimitive.Root.Props<Payload>;

export function Drawer<Payload = unknown>(props: DrawerProps<Payload>) {
  const ssrOpen = Boolean(props.open ?? props.defaultOpen);
  return (
    <DrawerSsrOpenContext.Provider value={ssrOpen}>
      <DrawerPrimitive.Root {...props} />
    </DrawerSsrOpenContext.Provider>
  );
}

export type DrawerTriggerProps = DrawerPrimitive.Trigger.Props;

export function DrawerTrigger({ className, ...props }: DrawerTriggerProps) {
  return (
    <DrawerPrimitive.Trigger
      data-slot="drawer-trigger"
      className={cn(className)}
      {...props}
    />
  );
}

export type DrawerPortalProps = DrawerPrimitive.Portal.Props;

export function DrawerPortal({ children, keepMounted, ...props }: DrawerPortalProps) {
  const ssrOpen = React.useContext(DrawerSsrOpenContext);
  if (typeof document === 'undefined') {
    if (!ssrOpen && !keepMounted) return null;
    return <div data-slot="drawer-portal">{children}</div>;
  }
  return (
    <DrawerPrimitive.Portal data-slot="drawer-portal" keepMounted={keepMounted} {...props}>
      {children}
    </DrawerPrimitive.Portal>
  );
}

export type DrawerCloseProps = DrawerPrimitive.Close.Props;

export function DrawerClose({ className, ...props }: DrawerCloseProps) {
  return (
    <DrawerPrimitive.Close
      data-slot="drawer-close"
      className={cn(className)}
      {...props}
    />
  );
}

export type DrawerOverlayProps = DrawerPrimitive.Backdrop.Props;

export function DrawerOverlay({ className, ...props }: DrawerOverlayProps) {
  const overlayClassName = cn(
    'fixed inset-0 bg-overlay/45 backdrop-blur-xs transition-opacity duration-200 ease-out-strong data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
    className,
  );
  if (typeof document === 'undefined') {
    return <div data-slot="drawer-overlay" data-open="" className={overlayClassName} />;
  }
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={overlayClassName}
      {...props}
    />
  );
}

export const drawerContentVariants = cva(
  'fixed flex flex-col gap-4 border-solid border-border bg-popover font-sans text-popover-foreground shadow-overlay transition-[opacity,transform] duration-200 ease-out-strong data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
  {
    variants: {
      side: {
        right:
          'inset-y-0 right-0 h-full w-full max-w-[min(460px,calc(100vw-32px))] border-l data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full',
        left: 'inset-y-0 left-0 h-full w-full max-w-[min(460px,calc(100vw-32px))] border-r data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full',
        top: 'inset-x-0 top-0 max-h-[85vh] w-full rounded-b-window border-b data-[starting-style]:-translate-y-full data-[ending-style]:-translate-y-full',
        bottom:
          'inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-window border-t data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full',
      },
    },
    defaultVariants: {
      side: 'right',
    },
  },
);

export interface DrawerContentProps
  extends DrawerPrimitive.Popup.Props,
    VariantProps<typeof drawerContentVariants> {
  showCloseButton?: boolean;
  closeLabel?: string;
}

export function DrawerContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  closeLabel = 'Close',
  ...props
}: DrawerContentProps) {
  const resolvedSide = side ?? 'right';
  const popupClassName = cn(drawerContentVariants({ side: resolvedSide }), className);
  const closeControl = showCloseButton ? (
    <DrawerPrimitive.Close
      data-slot="drawer-close"
      aria-label={closeLabel}
      className="absolute top-3.5 right-3.5 inline-flex size-7 cursor-pointer items-center justify-center rounded-sm text-faint-foreground hover:bg-accent hover:text-foreground [&_svg:not([class*='size-'])]:size-4"
    >
      <XIcon />
    </DrawerPrimitive.Close>
  ) : null;

  return (
    <DrawerPortal>
      <DrawerOverlay />
      {typeof document === 'undefined' ? (
        <div
          role="dialog"
          aria-modal="true"
          data-slot="drawer-content"
          data-side={resolvedSide}
          data-open=""
          className={popupClassName}
        >
          {children}
          {closeControl}
        </div>
      ) : (
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          data-side={resolvedSide}
          className={popupClassName}
          {...props}
        >
          {children}
          {closeControl}
        </DrawerPrimitive.Popup>
      )}
    </DrawerPortal>
  );
}

export function DrawerHeader({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        'flex flex-col gap-1 border-b border-solid border-border px-5 py-4 pr-11',
        className,
      )}
      {...props}
    />
  );
}

export function DrawerFooter({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn(
        'mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-solid border-border bg-muted/40 px-5 py-3',
        className,
      )}
      {...props}
    />
  );
}

export type DrawerTitleProps = DrawerPrimitive.Title.Props;

export function DrawerTitle({ className, ...props }: DrawerTitleProps) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn(
        'font-title text-[16px] leading-snug font-semibold text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export type DrawerDescriptionProps = DrawerPrimitive.Description.Props;

export function DrawerDescription({
  className,
  ...props
}: DrawerDescriptionProps) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn(
        'font-sans text-[13px] leading-relaxed text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export {
  Drawer as Sheet,
  DrawerTrigger as SheetTrigger,
  DrawerPortal as SheetPortal,
  DrawerClose as SheetClose,
  DrawerOverlay as SheetOverlay,
  DrawerContent as SheetContent,
  DrawerHeader as SheetHeader,
  DrawerFooter as SheetFooter,
  DrawerTitle as SheetTitle,
  DrawerDescription as SheetDescription,
};
